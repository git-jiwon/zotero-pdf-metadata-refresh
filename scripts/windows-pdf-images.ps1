param(
  [Parameter(Mandatory = $true)][string]$PdfPath,
  [Parameter(Mandatory = $true)][int]$MaxPages,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  # The pixel budget: the image sent is never larger than a whole page (or the
  # requested top part of it) rendered at this width, so the cost of a page in
  # image tokens is what it was before v5.
  [int]$Width = 1800,
  # The fraction of the page height to keep, from the top: 0.5 renders the top
  # half, where a title page prints its title and by-line, at the full width -
  # twice the effective resolution of a whole page for the same image tokens.
  [double]$TopFraction = 1.0,
  # v5: the page is rendered at RenderScale x Width and then cut down to the
  # printed matter. A book cover is mostly blank paper around a few lines of
  # display type; sent whole, the vision model scales the frame and the glyphs
  # shrink with it, and a 5-glyph Korean title was misread at every resolution
  # tried (700, 1400, 2800px). The same page cut to its ink read correctly. If
  # the cut is still larger than the budget it is scaled down to fit, so a dense
  # page costs what it did and a sparse page gets its glyphs up to RenderScale
  # times larger. The cut is decided from the pixels alone: rows and columns
  # that carry ink in runs longer than scanner specks and rules, with a margin.
  [int]$RenderScale = 2,
  [switch]$NoInkCrop,
  [double]$InkMargin = 0.05,
  # v6: render only these pages (1-based, comma separated: "2,4"); empty means
  # pages 1..MaxPages. The caller uses it to draw again, in a fresh renderer,
  # the pages that came out white. File names stay page-NNN.png.
  #
  # Keep this file ASCII. It is installed without a BOM, and Windows PowerShell
  # 5.1 reads a BOM-less script in the ANSI code page (949 on a Korean system):
  # a multi-byte UTF-8 comment then swallows the line break after it and the
  # next line of code with it.
  [string]$OnlyPages = ''
)
$ErrorActionPreference = 'Stop'
$errorPath = Join-Path $OutputDirectory 'render.error'
trap {
  try { [IO.File]::WriteAllText($errorPath, ($_ | Out-String), [Text.UTF8Encoding]::new($false)) }
  catch { }
  exit 1
}
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing

function Await-WinRT($Operation, [Type]$ResultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.GetAwaiter().GetResult()
}

function Await-WinRTAction($Operation) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1
  $task = $method.Invoke($null, @($Operation))
  $null = $task.GetAwaiter().GetResult()
}

# The ink scan runs over every pixel, which PowerShell itself does too slowly
# for a 1400px page (millions of GetPixel calls). A small compiled helper does
# it in milliseconds. If the compiler is unavailable the page is sent as before
# v5: rendered at the budget width, uncut.
$inkBoxSource = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class InkBox {
  // The bounding box {x0, y0, x1, y1} of the printed matter, or null when the
  // page carries nothing that looks printed.
  public static int[] Find(Bitmap bitmap, int threshold) {
    int width = bitmap.Width, height = bitmap.Height;
    BitmapData data = bitmap.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    byte[] pixels = new byte[data.Stride * height];
    Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
    bitmap.UnlockBits(data);
    bool[] dark = new bool[width * height];
    int[] rowInk = new int[height];
    for (int y = 0; y < height; y++) {
      int row = y * data.Stride;
      for (int x = 0; x < width; x++) {
        int offset = row + x * 4;
        int luminance = (pixels[offset + 2] * 299 + pixels[offset + 1] * 587 + pixels[offset] * 114) / 1000;
        if (luminance < threshold) { dark[y * width + x] = true; rowInk[y]++; }
      }
    }
    // Rows: a printed line is several rows deep, each with several dark pixels.
    // A scanner speck or a hairline rule is not, and is left out.
    bool[] keepRow = KeepRuns(rowInk, Math.Max(2, width / 700), Math.Max(3, height / 150), 1);
    int[] colInk = new int[width];
    for (int y = 0; y < height; y++) {
      if (!keepRow[y]) continue;
      for (int x = 0; x < width; x++) if (dark[y * width + x]) colInk[x]++;
    }
    // Columns: glyphs and words leave gaps, so a run may bridge gaps of a few
    // per cent of the width; a lone vertical rule does not make a run.
    bool[] keepCol = KeepRuns(colInk, Math.Max(2, height / 500), Math.Max(3, width / 100), Math.Max(2, width / 40));
    int x0 = -1, x1 = -1, y0 = -1, y1 = -1;
    for (int y = 0; y < height; y++) if (keepRow[y]) { if (y0 < 0) y0 = y; y1 = y; }
    for (int x = 0; x < width; x++) if (keepCol[x]) { if (x0 < 0) x0 = x; x1 = x; }
    if (x0 < 0 || y0 < 0) return null;
    if (x1 - x0 < width * 0.06 || y1 - y0 < height * 0.03) return null;
    return new int[] { x0, y0, x1, y1 };
  }
  // v6: true when the image carries no ink: every pixel, laid on white paper
  // (a transparent pixel shows the paper), is near-white, save for at most
  // 'allowance' specks. Not the same as Find returning null, which also happens
  // for a page with a single short line: this is a page the renderer did not draw.
  public static bool Blank(Bitmap bitmap, int threshold, int allowance) {
    int width = bitmap.Width, height = bitmap.Height;
    BitmapData data = bitmap.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    try {
      byte[] row = new byte[width * 4];
      int dark = 0;
      for (int y = 0; y < height; y++) {
        Marshal.Copy(IntPtr.Add(data.Scan0, y * data.Stride), row, 0, row.Length);
        for (int x = 0; x < width; x++) {
          int offset = x * 4, alpha = row[offset + 3];
          int luminance = (row[offset + 2] * 299 + row[offset + 1] * 587 + row[offset] * 114) / 1000;
          int seen = (luminance * alpha + 255 * (255 - alpha)) / 255;
          if (seen < threshold && ++dark > allowance) return false;
        }
      }
      return true;
    }
    finally { bitmap.UnlockBits(data); }
  }
  static bool[] KeepRuns(int[] ink, int minimumInk, int minimumRun, int gapTolerance) {
    bool[] keep = new bool[ink.Length];
    int start = -1, gap = 0;
    for (int i = 0; i <= ink.Length; i++) {
      bool on = i < ink.Length && ink[i] >= minimumInk;
      if (on) { if (start < 0) start = i; gap = 0; continue; }
      if (start < 0) continue;
      if (i < ink.Length && ++gap <= gapTolerance) continue;
      int end = i - gap;
      if (end - start >= minimumRun) for (int k = start; k < end; k++) keep[k] = true;
      start = -1; gap = 0;
    }
    return keep;
  }
}
'@
# v6: the helper is compiled under -NoInkCrop too: an uncut render is still
# checked for a white page (Test-Blank). Only $inkCrop cuts.
$inkBoxReady = $false
try { Add-Type -TypeDefinition $inkBoxSource -ReferencedAssemblies System.Drawing; $inkBoxReady = $true }
catch { $inkBoxReady = $false }
$inkCrop = $inkBoxReady -and -not $NoInkCrop -and $RenderScale -ge 1
$renderWidth = if ($inkCrop) { $Width * $RenderScale } else { $Width }
# PowerShell names are not case-sensitive: a variable spelt like the parameter
# (in any case) would overwrite the [string] parameter itself.
$drawOnly = @()
if ($OnlyPages) { $drawOnly = @($OnlyPages -split '[,\s]+' | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ }) }

# v6: does the rendered page carry no ink at all? With the helper every pixel
# is looked at; without it, a 120px-wide copy drawn on white: shrinking
# averages pixels, so a page with print keeps darker cells and a lone speck
# does not. A page that cannot be measured counts as inked (sent as before).
function Test-Blank([string]$Path) {
  try { $bitmap = [System.Drawing.Bitmap]::FromFile($Path) } catch { return $false }
  try {
    if ($inkBoxReady) { return [InkBox]::Blank($bitmap, 235, 8 + [int](($bitmap.Width * [double]$bitmap.Height) / 500000)) }
    $thumbWidth = 120
    $thumbHeight = [Math]::Max(1, [int][Math]::Round($bitmap.Height * $thumbWidth / [double]$bitmap.Width))
    $thumb = New-Object System.Drawing.Bitmap($thumbWidth, $thumbHeight)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($thumb)
      try {
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.DrawImage($bitmap, 0, 0, $thumbWidth, $thumbHeight)
      }
      finally { $graphics.Dispose() }
      $dark = 0
      for ($y = 0; $y -lt $thumbHeight; $y++) {
        for ($x = 0; $x -lt $thumbWidth; $x++) {
          $color = $thumb.GetPixel($x, $y)
          if ((($color.R * 299 + $color.G * 587 + $color.B * 114) / 1000) -lt 245) { $dark++; if ($dark -gt 2) { return $false } }
        }
      }
      return $true
    }
    finally { $thumb.Dispose() }
  }
  catch { return $false }
  finally { $bitmap.Dispose() }
}

# Rewrites the PNG at $Path as the rectangle $Rect of itself, scaled by $Scale
# (1 keeps the pixels as rendered; below 1 shrinks to the budget).
function Replace-WithCrop([string]$Path, [System.Drawing.Rectangle]$Rect, [double]$Scale) {
  $whole = [System.Drawing.Bitmap]::FromFile($Path)
  $temporary = $Path + '.crop.png'
  try {
    $cropped = $whole.Clone($Rect, $whole.PixelFormat)
    try {
      if ($Scale -lt 1) {
        $targetWidth = [Math]::Max(1, [int][Math]::Round($Rect.Width * $Scale))
        $targetHeight = [Math]::Max(1, [int][Math]::Round($Rect.Height * $Scale))
        $scaled = New-Object System.Drawing.Bitmap($targetWidth, $targetHeight)
        try {
          $graphics = [System.Drawing.Graphics]::FromImage($scaled)
          try {
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $graphics.Clear([System.Drawing.Color]::White)
            $graphics.DrawImage($cropped, 0, 0, $targetWidth, $targetHeight)
          }
          finally { $graphics.Dispose() }
          $scaled.Save($temporary, [System.Drawing.Imaging.ImageFormat]::Png)
        }
        finally { $scaled.Dispose() }
      }
      else { $cropped.Save($temporary, [System.Drawing.Imaging.ImageFormat]::Png) }
    }
    finally { $cropped.Dispose() }
  }
  finally { $whole.Dispose() }
  [IO.File]::Delete($Path)
  [IO.File]::Move($temporary, $Path)
}

function Ink-Rectangle([string]$Path) {
  $bitmap = [System.Drawing.Bitmap]::FromFile($Path)
  try {
    $box = [InkBox]::Find($bitmap, 140)
    if ($null -eq $box) { return $null }
    $boxWidth = $box[2] - $box[0] + 1; $boxHeight = $box[3] - $box[1] + 1
    $margin = [Math]::Max(6, [int]([Math]::Max($boxWidth, $boxHeight) * $InkMargin))
    $x0 = [Math]::Max(0, $box[0] - $margin); $y0 = [Math]::Max(0, $box[1] - $margin)
    $x1 = [Math]::Min($bitmap.Width - 1, $box[2] + $margin); $y1 = [Math]::Min($bitmap.Height - 1, $box[3] + $margin)
    return New-Object System.Drawing.Rectangle($x0, $y0, ($x1 - $x0 + 1), ($y1 - $y0 + 1))
  }
  finally { $bitmap.Dispose() }
}

$storageFileType = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$pdfDocumentType = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
$streamType = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$renderOptionsType = [Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType = WindowsRuntime]
$dataReaderType = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]

[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$file = Await-WinRT ($storageFileType::GetFileFromPathAsync($PdfPath)) $storageFileType
$pdf = Await-WinRT ($pdfDocumentType::LoadFromFileAsync($file)) $pdfDocumentType
$limit = [Math]::Min([int]$pdf.PageCount, [Math]::Max(1, $MaxPages))
for ($index = 0; $index -lt $limit; $index++) {
  if ($drawOnly.Count -gt 0 -and -not ($drawOnly -contains ($index + 1))) { continue }
  $page = $pdf.GetPage($index)
  try {
    $target = Join-Path $OutputDirectory ('page-{0:D3}.png' -f ($index + 1))
    # The Windows renderer now and then returns a blank white page for a page
    # that is not blank (a scanned cover rendered fine twice and blank once, at
    # the same width). A blank page is cheap to detect, so a render that shows
    # no ink at all is repeated here three times.
    #
    # v6: "no ink" is Test-Blank (near-white pixels only). It used to be
    # InkBox.Find returning null, which redrew a page with one short line and
    # never redrew a render that came back transparent (its transparent black
    # pixels counted as ink, and shrinking it onto white made a white page).
    # A page still white after three draws may be a failed render, not a page:
    # page-NNN.blank is left beside it, and the caller draws it again in a fresh
    # renderer or records a render failure. In the 2.1.11 live run all four
    # pages of C2VCXCGZ went out as pure white 900px images.
    $ink = $null
    $blank = $false
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
      $stream = New-Object $streamType
      try {
        $options = New-Object $renderOptionsType
        $options.DestinationWidth = $renderWidth
        Await-WinRTAction ($page.RenderToStreamAsync($stream, $options))
        $size = [uint32]$stream.Size
        $inputStream = $stream.GetInputStreamAt(0)
        $reader = New-Object $dataReaderType($inputStream)
        try {
          $null = Await-WinRT ($reader.LoadAsync($size)) ([uint32])
          $bytes = New-Object byte[] $size
          $reader.ReadBytes($bytes)
          [IO.File]::WriteAllBytes($target, $bytes)
        }
        finally { $reader.Dispose(); $inputStream.Dispose() }
      }
      finally { if ($stream -is [IDisposable]) { $stream.Dispose() } }
      $blank = Test-Blank $target
      if (-not $blank) { break }
    }
    if ($blank) { [IO.File]::WriteAllText(($target -replace '\.png$', '.blank'), '', [Text.UTF8Encoding]::new($false)) }
    elseif ($inkCrop) { try { $ink = Ink-Rectangle $target } catch { $ink = $null } }
    $whole = [System.Drawing.Bitmap]::FromFile($target)
    try { $wholeWidth = $whole.Width; $wholeHeight = $whole.Height }
    finally { $whole.Dispose() }
    $keep = $wholeHeight
    if ($TopFraction -gt 0 -and $TopFraction -lt 1) {
      $keep = [Math]::Max(1, [int][Math]::Round($wholeHeight * $TopFraction))
      Replace-WithCrop $target (New-Object System.Drawing.Rectangle(0, 0, $wholeWidth, $keep)) 1.0
      # The ink was measured on the whole page; measure it again on the part kept.
      if ($inkCrop -and -not $blank) { try { $ink = Ink-Rectangle $target } catch { $ink = $null } }
    }
    if ($inkCrop) {
      # The budget is the page part at the requested width; the render is
      # RenderScale times wider, so the budget is that many times smaller.
      $budget = [double]($wholeWidth * $keep) / ($RenderScale * $RenderScale)
      if ($null -eq $ink) { $ink = New-Object System.Drawing.Rectangle(0, 0, $wholeWidth, $keep) }
      $scale = [Math]::Min(1.0, [Math]::Sqrt($budget / ([double]$ink.Width * $ink.Height)))
      if ($ink.Width -lt $wholeWidth -or $ink.Height -lt $keep -or $scale -lt 1) { Replace-WithCrop $target $ink $scale }
    }
  }
  finally { $page.Dispose() }
}
# Completion sentinel. The caller cannot tell "still rendering" from "produced
# nothing" by listing the directory, so record the page count that was written.
[IO.File]::WriteAllText((Join-Path $OutputDirectory 'render.done'), [string]$limit, [Text.UTF8Encoding]::new($false))

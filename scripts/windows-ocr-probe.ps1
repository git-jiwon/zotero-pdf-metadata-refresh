param(
  [Parameter(Mandatory = $true)][string]$PdfPath,
  [Parameter(Mandatory = $true)][int]$MaxPages,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  # Which recognizer to use. Left empty this follows the user's profile
  # languages, which on a machine set to English reads a Korean cover with the
  # English engine: 세종대학교 came back as 세종디학교 and 형광스펙트럼 as
  # 영광스멕트럼. Naming the language is the largest quality lever this engine has.
  [string]$Language = '',
  # Render width in pixels. Windows renders a page at its natural size, which for
  # a scan downsampled into a small page box loses strokes that OCR needs.
  [int]$RenderWidth = 0
)
$ErrorActionPreference = 'Stop'
trap {
  try { [IO.File]::WriteAllText(($OutputPath + '.error'), ($_ | Out-String), [Text.UTF8Encoding]::new($false)) }
  catch { }
  exit 1
}
Add-Type -AssemblyName System.Runtime.WindowsRuntime

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

$storageFileType = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$pdfDocumentType = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
$streamType = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$decoderType = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$softwareBitmapType = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$ocrEngineType = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
$renderOptionsType = [Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType = WindowsRuntime]

$file = Await-WinRT ($storageFileType::GetFileFromPathAsync($PdfPath)) $storageFileType
$pdf = Await-WinRT ($pdfDocumentType::LoadFromFileAsync($file)) $pdfDocumentType
$engine = $null
$engineLanguage = 'user-profile'
if ($Language) {
  $languageType = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
  $candidate = [Activator]::CreateInstance($languageType, @($Language))
  if ($ocrEngineType::IsLanguageSupported($candidate)) {
    $engine = $ocrEngineType::TryCreateFromLanguage($candidate)
    $engineLanguage = $Language
  }
}
if (-not $engine) { $engine = $ocrEngineType::TryCreateFromUserProfileLanguages(); $engineLanguage = 'user-profile' }
if ($null -eq $engine) { throw 'Windows OCR language pack is unavailable.' }
$limit = [Math]::Min([int]$pdf.PageCount, [Math]::Max(1, $MaxPages))
$parts = [System.Collections.Generic.List[string]]::new()
for ($index = 0; $index -lt $limit; $index++) {
  $page = $pdf.GetPage($index)
  try {
    $stream = New-Object $streamType
    try {
      # The render size, and what it took to find out that it was never applied.
      #
      # This read `[Math]::Min($width, [int]$engine.MaxImageDimension)`.
      # MaxImageDimension is a STATIC property of OcrEngine; read off the
      # instance it comes back as 0, Min(width, 0) is 0, and 0 means "natural
      # size" to the renderer. So the width argument reached nothing: three runs
      # at 700, 1400 and 2200 pixels produced byte-identical text, which looks
      # exactly like a setting that does not matter.
      #
      # Both dimensions have to be set together — a width alone leaves the height
      # at zero, and the renderer then either refuses the call or never returns.
      #
      # With the option actually working, 2200px measured WORSE on this library
      # than the natural size: the Korean OCR read 에너지 as 에니지 and lost the
      # author from a scanned book cover. So natural size is the default, by
      # measurement rather than by accident, and a width is used only when asked.
      $options = New-Object $renderOptionsType
      $effectiveWidth = 0
      if ($RenderWidth -gt 0) {
        $effectiveWidth = $RenderWidth
        $natural = $page.Size
        $ratio = if ($natural.Width -gt 0) { $natural.Height / $natural.Width } else { 1.414 }
        $options.DestinationWidth = [uint32]$effectiveWidth
        $options.DestinationHeight = [uint32][Math]::Round($effectiveWidth * $ratio)
      }
      Await-WinRTAction ($page.RenderToStreamAsync($stream, $options))
      $stream.Seek(0)
      $decoder = Await-WinRT ($decoderType::CreateAsync($stream)) $decoderType
      $bitmap = Await-WinRT ($decoder.GetSoftwareBitmapAsync()) $softwareBitmapType
      try {
        $result = Await-WinRT ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult, Windows.Media.Ocr, ContentType = WindowsRuntime])
        # OcrResult.Text flattens some Korean title pages into one long line.
        # Preserve the OCR engine's detected visual lines so the bibliography
        # parser can distinguish title, adviser, institution, author and date.
        $pageLines = [System.Collections.Generic.List[string]]::new()
        foreach ($line in $result.Lines) {
          if (-not [string]::IsNullOrWhiteSpace($line.Text)) { $pageLines.Add($line.Text.Trim()) }
        }
        $parts.Add("--- PAGE $($index + 1) ---`n$($pageLines -join "`n")")
      }
      finally { if ($bitmap -is [IDisposable]) { $bitmap.Dispose() } }
    }
    finally { if ($stream -is [IDisposable]) { $stream.Dispose() } }
  }
  finally { $page.Dispose() }
}
[IO.File]::WriteAllText($OutputPath, ($parts -join "`n`f`n"), [Text.UTF8Encoding]::new($false))

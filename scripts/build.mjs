import { build } from "esbuild";
import archiver from "archiver";
import fs from "node:fs";
import path from "node:path";
import { archiveFiles, assertSafePath, manifestProblems, ICON_PNG_SIZES, publicFileFindings } from './release-files.mjs';
import { checkRelease } from './release-check.mjs';

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const release = process.argv.includes('--release');
// The update checksum is generated from this package afterwards. Final
// release:check validates updates.json and compares it with the resulting XPI.
const problems = release ? checkRelease(root, { requireUpdateManifest: false }).errors : manifestProblems(manifest, pkg);
if (problems.length) throw new Error(`Build blocked:\n${problems.join('\n')}`);
if (path.dirname(dist) !== root || path.basename(dist) !== 'dist') throw new Error('Unsafe build directory');
assertSafePath(root, dist, { kind: 'directory' });
assertSafePath(root, path.join(dist, 'content'), { kind: 'directory' });
assertSafePath(root, path.join(dist, 'icons'), { kind: 'directory' });
for (const name of archiveFiles({ sourceMap: true })) assertSafePath(root, path.join(dist, name));
for (const name of ['bootstrap.js', 'manifest.json', 'content/batch.xhtml', 'src/index.ts', 'scripts/windows-pdf-images.ps1', ...Object.keys(ICON_PNG_SIZES)]) assertSafePath(root, path.join(root, name));
for (const name of Object.keys(ICON_PNG_SIZES)) {
  const findings = publicFileFindings(fs.readFileSync(path.join(root, name)), name);
  if (findings.length) throw new Error(`Build blocked: ${name}: ${findings.map(finding => finding.kind).join(', ')}`);
}
assertSafePath(root, path.join(root, 'pdf-metadata-refresh.xpi'));
assertSafePath(root, path.join(root, `pdf-metadata-refresh-${manifest.version}.xpi`));
fs.mkdirSync(path.join(dist, "content"), { recursive: true });
fs.mkdirSync(path.join(dist, 'icons'), { recursive: true });

await build({
  entryPoints: [path.join(root, "src", "index.ts")],
  outfile: path.join(dist, "content", "main.js"),
  bundle: true,
  format: "iife",
  globalName: "PDFMetadataRefresh",
  target: "firefox128",
  loader: { '.ps1': 'text' },
  define: { __ADDON_VERSION__: JSON.stringify(manifest.version) },
  // Development keeps line mappings without embedding source. Public releases
  // remove comments and maps without changing recognition rules or syntax.
  minifyWhitespace: release,
  minifyIdentifiers: false,
  minifySyntax: false,
  legalComments: 'none',
  sourcemap: !release,
  sourcesContent: false
});

for (const name of ["bootstrap.js", "manifest.json"]) {
  fs.copyFileSync(path.join(root, name), path.join(dist, name));
}
fs.copyFileSync(path.join(root, 'content', 'batch.xhtml'), path.join(dist, 'content', 'batch.xhtml'));
for (const name of Object.keys(ICON_PNG_SIZES)) fs.copyFileSync(path.join(root, name), path.join(dist, name));

const output = fs.createWriteStream(path.join(root, "pdf-metadata-refresh.xpi"));
const zip = archiver("zip", { zlib: { level: 9 } });
const completed = new Promise((resolve, reject) => {
  output.on('close', resolve).on('error', reject);
  zip.on('error', reject).on('warning', reject);
});
zip.pipe(output);
for (const name of archiveFiles({ sourceMap: !release })) {
  const file = path.join(dist, name);
  if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error(`Unsafe archive entry: ${name}`);
  // file() performs asynchronous stat calls, which can reorder entries. Public
  // builds append the reviewed bytes directly in the fixed allowlist order.
  if (release) zip.append(fs.readFileSync(file), { name, date: new Date('1980-01-01T00:00:00Z'), mode: 0o644 });
  else zip.file(file, { name });
}
await zip.finalize();
await completed;
fs.copyFileSync(path.join(root, 'pdf-metadata-refresh.xpi'), path.join(root, `pdf-metadata-refresh-${manifest.version}.xpi`));
console.log(`Built ${release ? 'release' : 'development'} pdf-metadata-refresh.xpi (${zip.pointer()} bytes)`);

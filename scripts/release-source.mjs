import fs from 'node:fs';
import path from 'node:path';
import ts from '@typescript/typescript6';
import { assertSafePath, collectPublicFiles, decodePublicText, isPublicImage, publicFileFindings } from './release-files.mjs';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const outputAt = args.indexOf('--output');
if (outputAt >= 0 && (!args[outputAt + 1] || args[outputAt + 1].startsWith('--'))) throw new Error('--output requires a path');
const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
const stamp = new Date().toISOString().replace(/[^0-9]/g, '');
const exportRoot = path.join(root, 'release');
const output = path.resolve(root, outputAt >= 0 ? args[outputAt + 1] : `release/source-${version}-${stamp}`);
const relative = path.relative(exportRoot, output);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Export must be a new directory inside release/');
assertSafePath(root, output, { kind: 'directory' });
if (fs.existsSync(output)) throw new Error('Export destination exists; refusing to overwrite it');

const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const emitOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true };
const canonicalJS = code => printer.printFile(ts.createSourceFile('emitted.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS));
const prepared = [];
for (const name of collectPublicFiles(root)) {
  const input = fs.readFileSync(path.join(root, name));
  let contents = isPublicImage(name) ? input : decodePublicText(input, name).replace(/\r\n?/g, '\n');
  if (name.endsWith('.ts')) {
    const source = ts.createSourceFile(name, contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const clean = printer.printFile(source);
    // This public copy omits historical case comments. Verify emitted JavaScript
    // remains identical so code privacy cleanup cannot alter a recognizer rule.
    if (!name.endsWith('.d.ts')) {
      const before = ts.transpileModule(contents, { compilerOptions: emitOptions }).outputText;
      const after = ts.transpileModule(clean, { compilerOptions: emitOptions }).outputText;
      if (canonicalJS(before) !== canonicalJS(after)) throw new Error(`Comment cleanup changed emitted JavaScript: ${name}`);
    }
    contents = clean;
  }
  if (name === '.gitignore') contents = contents.replace('!/PUBLIC-README.md', '!/README.md');
  const destination = name === 'PUBLIC-README.md' ? 'README.md' : name;
  const findings = publicFileFindings(contents, destination);
  if (findings.length) throw new Error(`Public source privacy review required: ${findings.map(finding => `${finding.file}:${finding.line}: ${finding.kind}`).join(', ')}`);
  prepared.push({ name: destination, contents });
}
fs.mkdirSync(output, { recursive: true });
for (const file of prepared) {
  const destination = path.join(output, file.name);
  assertSafePath(root, destination);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, file.contents, { flag: 'wx' });
}
console.log(`Prepared ${prepared.length} public files at ${output}`);
console.log('Review this directory and complete the release configuration before creating a GitHub repository or publishing.');

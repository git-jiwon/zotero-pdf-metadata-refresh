import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { deflateSync, inflateRawSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { archiveFiles, assertSafePath, imageFindings, iconPNGFindings, manifestProblems, privacyFindings, publicFileFindings, publicPath,
  updatesProblems, PUBLIC_DOCUMENT_FILES, PUBLIC_IMAGE_FILES, PUBLIC_ICON_FILES, ICON_PNG_SIZES } from '../scripts/release-files.mjs';
import { checkRelease } from '../scripts/release-check.mjs';

const manifest = {
  manifest_version: 2, version: '1.0.0', author: 'Example Maintainer',
  icons: { 48: 'icons/icon.png', 96: 'icons/icon@2x.png' },
  applications: { zotero: { id: 'addon@example.org', strict_min_version: '10.0.1', strict_max_version: '10.*',
    update_url: 'https://updates.example.org/addon.json' } }
};
const pkg = { version: '1.0.0', license: 'MIT', repository: 'https://github.com/example/example-addon' };
const copy = value => JSON.parse(JSON.stringify(value));
const segment = (marker, payload) => {
  const length = Buffer.alloc(2); length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), length, payload]);
};
// Synthetic marker-level fixtures exercise metadata boundaries without a library screenshot.
const jpeg = (...extra) => Buffer.concat([Buffer.from([0xff, 0xd8]), ...extra,
  segment(0xc0, Buffer.from([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
  segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.from([0x42, 0xff, 0xd9])]);
const pngChunk = (type, payload) => {
  const name = Buffer.from(type, 'ascii'), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  let value = 0xffffffff;
  for (const byte of Buffer.concat([name, payload])) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  checksum.writeUInt32BE((value ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, name, payload, checksum]);
};
const png = (size, ...extra) => {
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), ...extra,
    pngChunk('IDAT', deflateSync(Buffer.alloc(size * (size * 4 + 1)))), pngChunk('IEND', Buffer.alloc(0))]);
};
const updates = () => ({ addons: { [manifest.applications.zotero.id]: { updates: [{ version: pkg.version,
  update_link: `${pkg.repository}/releases/download/v${pkg.version}/pdf-metadata-refresh-${pkg.version}.xpi`,
  update_hash: `sha256:${'a'.repeat(64)}`, applications: { zotero: {
    strict_min_version: manifest.applications.zotero.strict_min_version,
    strict_max_version: manifest.applications.zotero.strict_max_version
  } } }] } } });

test('release source denies library files, private fixtures, path traversal, and historical bundles', () => {
  for (const name of ['audit/reports/row.json', 'tmp/ocr.txt', 'test/support/fixtures/page.txt',
    'pdf-metadata-refresh-0.1.0.xpi', '.env', 'scripts/unreviewed.mjs', '../src/index.ts', '/src/index.ts']) {
    assert.equal(publicPath(name), false, name);
  }
  for (const name of ['src/index.ts', 'src/ui/batch-window.ts', 'scripts/build.mjs', 'test/release-security.test.mjs']) {
    assert.equal(publicPath(name), true, name);
  }
  for (const name of ['docs/RELEASING.md', 'docs/RELEASE-SECURITY-REVIEW.md', 'docs/images/library.jpg',
    'docs/images/demo-fr-list.jpg', 'icons/private.png', 'icons/icon.jpg', 'icons/icon.svg/extra', 'src//index.ts', 'C:/src/index.ts']) assert.equal(publicPath(name), false, name);
  for (const name of [...PUBLIC_DOCUMENT_FILES, ...PUBLIC_IMAGE_FILES, ...PUBLIC_ICON_FILES, 'updates.json', 'test/i18n.test.mjs',
    'src/ui/i18n.ts', 'src/ui/i18n-en.ts']) assert.equal(publicPath(name), true, name);
});

test('public PNG icons preserve binary pixels and enforce sizes, checksums, complete raster data and metadata boundaries', () => {
  for (const [file, size] of Object.entries(ICON_PNG_SIZES)) {
    assert.deepEqual(publicFileFindings(png(size), file), []);
    const density = Buffer.alloc(9); density.writeUInt32BE(2835); density.writeUInt32BE(2835, 4); density[8] = 1;
    assert.deepEqual(iconPNGFindings(png(size, pngChunk('pHYs', density)), file), []);
    assert.match(iconPNGFindings(png(size === 48 ? 96 : 48), file)[0].kind, /pixels/);
    for (const type of ['eXIf', 'tEXt', 'iTXt', 'zTXt', 'iCCP', 'tIME', 'acTL']) {
      const findings = iconPNGFindings(png(size, pngChunk(type, Buffer.from('Synthetic metadata'))), file);
      assert.match(findings[0].kind, /metadata/);
      assert.equal(JSON.stringify(findings).includes('Synthetic metadata'), false);
    }
    const broken = Buffer.from(png(size)); broken[29] ^= 1;
    assert.match(iconPNGFindings(broken, file)[0].kind, /checksum/);
    assert.ok(iconPNGFindings(png(size).subarray(0, -1), file).length);
    assert.ok(iconPNGFindings(Buffer.concat([png(size), Buffer.from('trailer')]), file).length);
    assert.ok(iconPNGFindings(jpeg(), file).length);
    assert.ok(iconPNGFindings(png(size, pngChunk('IDAT', deflateSync(Buffer.from('incomplete pixels')))), file).length);
  }
});

test('public demo JPEGs allow clean raster headers and reject hidden metadata, thumbnails, trailers, and malformed data', () => {
  const file = PUBLIC_IMAGE_FILES[0];
  assert.deepEqual(publicFileFindings(jpeg(), file), []);
  const jfif = Buffer.concat([Buffer.from('JFIF\0'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])]);
  assert.deepEqual(imageFindings(jpeg(segment(0xe0, jfif)), file), []);
  assert.deepEqual(imageFindings(jpeg(segment(0xee, Buffer.concat([Buffer.from('Adobe'), Buffer.alloc(7)]))), file), []);
  for (const marker of [0xe1, 0xe2, 0xed, 0xfe]) {
    const findings = imageFindings(jpeg(segment(marker, Buffer.from('Synthetic hidden metadata'))), file);
    assert.match(findings[0].kind, /metadata/);
    assert.equal(JSON.stringify(findings).includes('Synthetic hidden'), false);
  }
  const thumbnail = Buffer.from(jfif); thumbnail[12] = 1;
  assert.match(imageFindings(jpeg(segment(0xe0, thumbnail)), file)[0].kind, /thumbnail/);
  assert.ok(imageFindings(Buffer.concat([jpeg(), Buffer.from('hidden trailer')]), file).length);
  assert.ok(imageFindings(jpeg().subarray(0, -2), file).length);
  assert.ok(imageFindings(Buffer.from('not a JPEG'), file).length);
  const oversize = Buffer.alloc(12 * 1024 * 1024 + 1);
  assert.match(imageFindings(oversize, file)[0].kind, /exceeds/);
});

test('public text rejects binary bytes and identifies local account or library links without disclosing them', () => {
  assert.ok(publicFileFindings(Buffer.from([0xff, 0xfe]), 'README.md').length);
  assert.ok(publicFileFindings(Buffer.from('text\0hidden'), 'README.md').length);
  const account = '/home/' + 'synthetic-user/private';
  const library = 'zotero://select/library/items/' + ['ABCD', '1234'].join('');
  for (const input of [account, library]) {
    const findings = privacyFindings(input, 'README.md');
    assert.equal(findings.length, 1);
    assert.equal(JSON.stringify(findings).includes(input), false);
  }
});

test('privacy scan permits only the reviewed icon path while still detecting contacts on the same line', () => {
  const filename = 'icon' + '@2x.png', reviewed = 'icons/' + filename;
  for (const line of [`!/${reviewed}`, JSON.stringify({ 96: reviewed }), `['${reviewed}']`]) {
    assert.deepEqual(publicFileFindings(line, '.gitignore'), []);
  }
  const contact = 'synthetic-contact' + '@' + 'private.test';
  for (const line of [filename, `${reviewed}.private`, `other/${reviewed}`, `other${reviewed}`,
    `${reviewed} ${contact}`, `${contact} ${reviewed}`]) {
    assert.ok(privacyFindings(line, 'README.md').some(finding => finding.kind === 'personal contact example'));
  }
  const token = `ghp_${'B'.repeat(36)}`;
  assert.deepEqual(privacyFindings(`${reviewed} ${token}`, 'README.md'),
    [{ file: 'README.md', line: 1, kind: 'access token' }]);
});

test('update manifest permits only the current owned release, SHA-256 and tested Zotero compatibility', () => {
  assert.deepEqual(updatesProblems(updates(), manifest, pkg), []);
  const malformed = [null, {}, { addons: [] }, { addons: { wrong: { updates: [] } } }];
  for (const value of malformed) assert.ok(updatesProblems(value, manifest, pkg).length);
  const get = value => value.addons[manifest.applications.zotero.id].updates[0];
  for (const modify of [
    entry => { entry.version = '9.0.0'; },
    entry => { entry.update_hash = 'sha256:missing'; },
    entry => { entry.update_link = entry.update_link.replace('https:', 'http:'); },
    entry => { entry.update_link += '?private=example'; },
    entry => { entry.update_link = entry.update_link.replace('/example/', '/other/'); },
    entry => { entry.applications.zotero.strict_max_version = '*'; },
    entry => { entry.applications.gecko = {}; }
  ]) {
    const value = updates(); modify(get(value)); assert.ok(updatesProblems(value, manifest, pkg).length);
  }
  assert.ok(updatesProblems(updates(), manifest, pkg, { artifactHash: 'b'.repeat(64) }).some(problem => /differs/.test(problem)));
  assert.deepEqual(updatesProblems(updates(), manifest, pkg, { artifactHash: 'a'.repeat(64) }), []);
  const historical = updates(); historical.addons[manifest.applications.zotero.id].updates.push(copy(get(historical)));
  assert.ok(updatesProblems(historical, manifest, pkg).length);
});

test('final public gate requires guides, demos and updates; package preparation precedes final checksum validation', () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'zpmr-public-gate-'));
  const put = (name, contents) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), contents); };
  put('manifest.json', JSON.stringify(manifest)); put('package.json', JSON.stringify(pkg));
  put('README.md', 'Synthetic public guide'); put('LICENSE', 'MIT');
  put('src/index.ts', 'export {};'); put('content/batch.xhtml', '<html/>');
  assert.ok(checkRelease(root).errors.some(problem => /Required public guide/.test(problem)));
  for (const file of PUBLIC_DOCUMENT_FILES) put(file, 'Synthetic guide');
  for (const file of PUBLIC_IMAGE_FILES) put(file, jpeg());
  assert.ok(checkRelease(root, { requireUpdateManifest: false }).errors.some(problem => /icon is missing/.test(problem)));
  put('icons/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M0 0h1v1z"/></svg>');
  for (const [file, size] of Object.entries(ICON_PNG_SIZES)) put(file, png(size));
  assert.deepEqual(checkRelease(root, { requireUpdateManifest: false }).errors, []);
  assert.ok(checkRelease(root).errors.some(problem => /updates.json/.test(problem)));
  const artifact = Buffer.from('Synthetic release bytes');
  put(`pdf-metadata-refresh-${pkg.version}.xpi`, artifact);
  const value = updates(), entry = value.addons[manifest.applications.zotero.id].updates[0];
  entry.update_hash = 'sha256:' + createHash('sha256').update(artifact).digest('hex');
  put('updates.json', JSON.stringify(value)); assert.deepEqual(checkRelease(root).errors, []);
  put(`pdf-metadata-refresh-${pkg.version}.xpi`, Buffer.from('Different synthetic release'));
  assert.ok(checkRelease(root).errors.some(problem => /hash differs/.test(problem)));
  assert.deepEqual(checkRelease(root, { verifyArtifactHash: false }).errors, []);
});

test('release archive has an exact allowlist and omits development maps', () => {
  assert.deepEqual(archiveFiles(), ['bootstrap.js', 'manifest.json', 'content/batch.xhtml', 'content/main.js', 'icons/icon.png', 'icons/icon@2x.png']);
  assert.equal(archiveFiles({ sourceMap: true }).at(-1), 'content/main.js.map');
});

test('release build packages both declared PNG icons with reproducible archive attributes', context => {
  const project = path.resolve(import.meta.dirname, '..');
  const root = fs.mkdtempSync(path.join(tmpdir(), 'zpmr-icon-build-'));
  const put = (name, contents) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), contents); };
  try { fs.symlinkSync(path.join(project, 'node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (cause) { if (['EPERM', 'EACCES'].includes(cause.code)) { context.skip('Dependency link unavailable'); return; } throw cause; }
  for (const name of ['build.mjs', 'release-check.mjs', 'release-files.mjs']) put(`scripts/${name}`, fs.readFileSync(path.join(project, 'scripts', name)));
  put('manifest.json', JSON.stringify(manifest)); put('package.json', JSON.stringify(pkg)); put('README.md', 'Synthetic public guide'); put('LICENSE', 'MIT');
  put('bootstrap.js', 'function startup() {}'); put('content/batch.xhtml', '<html/>'); put('src/index.ts', 'export const version = __ADDON_VERSION__;'); put('scripts/windows-pdf-images.ps1', '# Synthetic renderer');
  for (const file of PUBLIC_DOCUMENT_FILES) put(file, 'Synthetic guide');
  for (const file of PUBLIC_IMAGE_FILES) put(file, jpeg());
  put('icons/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  for (const [file, size] of Object.entries(ICON_PNG_SIZES)) put(file, png(size));
  const build = spawnSync(process.execPath, ['scripts/build.mjs', '--release'], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const data = fs.readFileSync(path.join(root, `pdf-metadata-refresh-${pkg.version}.xpi`));
  const end = data.length - 22, entries = []; let at = data.readUInt32LE(end + 16);
  for (let index = 0; index < data.readUInt16LE(end + 10); index++) {
    assert.equal(data.readUInt32LE(at), 0x02014b50);
    const nameLength = data.readUInt16LE(at + 28), name = data.subarray(at + 46, at + 46 + nameLength).toString();
    entries.push(name); assert.equal(data.readUInt16LE(at + 12), 0); assert.equal(data.readUInt16LE(at + 14), 33);
    assert.equal((data.readUInt32LE(at + 38) >>> 16) & 0o777, 0o644);
    const local = data.readUInt32LE(at + 42), start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const contents = inflateRawSync(data.subarray(start, start + data.readUInt32LE(at + 20)));
    if (Object.hasOwn(ICON_PNG_SIZES, name)) assert.deepEqual(contents, fs.readFileSync(path.join(root, name)));
    if (name === 'manifest.json') assert.deepEqual(JSON.parse(contents.toString()).icons, manifest.icons);
    at += 46 + nameLength + data.readUInt16LE(at + 30) + data.readUInt16LE(at + 32);
  }
  assert.deepEqual(entries, archiveFiles());
});

test('manifest blocks unsafe artifact names, credentials, mismatched versions, and placeholder releases', () => {
  assert.deepEqual(manifestProblems(manifest, pkg, { release: true }), []);
  for (const icons of [undefined, { 48: 'icons/icon.png' }, { 48: '../private.png', 96: 'icons/icon@2x.png' }, { ...manifest.icons, 128: 'icons/private.png' }]) {
    assert.ok(manifestProblems({ ...manifest, icons }, pkg).some(problem => /PNG icons/.test(problem)));
  }
  const unsafe = copy(manifest); unsafe.version = '../../private';
  assert.ok(manifestProblems(unsafe, pkg).some(problem => problem.includes('Unsafe')));
  const credential = copy(manifest);
  credential.applications.zotero.update_url = 'https://' + ['name', 'password'].join(':') + '@' + 'updates.example.org/addon.json';
  assert.ok(manifestProblems(credential, pkg).some(problem => problem.includes('credentials')));
  const placeholder = copy(manifest); placeholder.applications.zotero.update_url = 'https://addon.invalid/updates.json';
  assert.deepEqual(manifestProblems(placeholder, pkg), []);
  assert.ok(manifestProblems(placeholder, pkg, { release: true }).some(problem => problem.includes('placeholder')));
  assert.ok(manifestProblems(manifest, { ...pkg, version: '2.0.0' }).some(problem => problem.includes('versions differ')));
});

test('privacy scan reports location and kind without disclosing the matching value', () => {
  const credential = `ghp_${'A'.repeat(36)}`;
  const findings = privacyFindings(`plain\n${credential}`, 'sample.txt');
  assert.deepEqual(findings, [{ file: 'sample.txt', line: 2, kind: 'access token' }]);
  assert.equal(JSON.stringify(findings).includes(credential), false);
  assert.deepEqual(privacyFindings('https://example.org/record', 'sample.txt'), []);
});

test('output path guard rejects traversal and existing file/directory mismatches', () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'zpmr-safe-path-'));
  fs.writeFileSync(path.join(root, 'existing.txt'), 'synthetic');
  assert.throws(() => assertSafePath(root, path.join(root, '..', 'outside.txt')), /inside/);
  assert.throws(() => assertSafePath(root, path.join(root, 'existing.txt', 'child.txt')), /path type/);
  assert.doesNotThrow(() => assertSafePath(root, path.join(root, 'new', 'file.txt')));
});

test('output path guard rejects intermediate symlinks or Windows junctions before writing', context => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'zpmr-safe-link-'));
  const target = fs.mkdtempSync(path.join(tmpdir(), 'zpmr-link-target-'));
  const link = path.join(root, 'link');
  try { fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (cause) { if (['EPERM', 'EACCES'].includes(cause.code)) { context.skip('Link creation unavailable'); return; } throw cause; }
  assert.throws(() => assertSafePath(root, path.join(link, 'nested', 'file.txt')), /Symlinks and junctions/);
  assert.equal(fs.existsSync(path.join(target, 'nested')), false);
});

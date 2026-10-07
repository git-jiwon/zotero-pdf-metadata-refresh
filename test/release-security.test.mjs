import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { archiveFiles, assertSafePath, imageFindings, manifestProblems, privacyFindings, publicFileFindings, publicPath,
  updatesProblems, PUBLIC_DOCUMENT_FILES, PUBLIC_IMAGE_FILES } from '../scripts/release-files.mjs';
import { checkRelease } from '../scripts/release-check.mjs';

const manifest = {
  manifest_version: 2, version: '1.0.0', author: 'Example Maintainer',
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
    'docs/images/demo-fr-list.jpg', 'src//index.ts', 'C:/src/index.ts']) assert.equal(publicPath(name), false, name);
  for (const name of [...PUBLIC_DOCUMENT_FILES, ...PUBLIC_IMAGE_FILES, 'updates.json', 'test/i18n.test.mjs',
    'src/ui/i18n.ts', 'src/ui/i18n-en.ts']) assert.equal(publicPath(name), true, name);
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
  assert.deepEqual(archiveFiles(), ['bootstrap.js', 'manifest.json', 'content/batch.xhtml', 'content/main.js']);
  assert.equal(archiveFiles({ sourceMap: true }).at(-1), 'content/main.js.map');
});

test('manifest blocks unsafe artifact names, credentials, mismatched versions, and placeholder releases', () => {
  assert.deepEqual(manifestProblems(manifest, pkg, { release: true }), []);
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

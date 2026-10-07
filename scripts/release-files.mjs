import fs from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

export const PUBLIC_DOCUMENT_FILES = [
  'docs/README.ko.md', 'docs/USER-GUIDE.md', 'docs/USER-GUIDE.ko.md',
  'docs/RELEASE-NOTES-1.0.0.md', 'docs/GITHUB-PUBLISHING.md', 'docs/PRIVACY.md'
];
export const PUBLIC_IMAGE_FILES = ['en', 'ko'].flatMap(language =>
  ['list', 'detail', 'settings'].map(view => `docs/images/demo-${language}-${view}.jpg`));
export const PUBLIC_ICON_FILES = ['icons/icon.svg', 'icons/icon.png', 'icons/icon@2x.png'];
export const ICON_PNG_SIZES = Object.freeze({ 'icons/icon.png': 48, 'icons/icon@2x.png': 96 });

export const PUBLIC_FILES = [
  '.gitignore', '.gitattributes', 'bootstrap.js', 'manifest.json', 'updates.json', 'package.json', 'package-lock.json', 'tsconfig.json',
  'PUBLIC-README.md', 'SECURITY.md',
  ...PUBLIC_DOCUMENT_FILES, ...PUBLIC_IMAGE_FILES, ...PUBLIC_ICON_FILES,
  'scripts/build.mjs', 'scripts/release-check.mjs', 'scripts/release-files.mjs', 'scripts/release-source.mjs',
  'scripts/verify.mjs', 'scripts/snapshot.mjs', 'scripts/official-source.mjs',
  'scripts/windows-pdf-images.ps1', 'scripts/windows-ocr-probe.ps1',
  'test/release-security.test.mjs', 'test/release-ui.test.mjs', 'test/external-url.test.mjs', 'test/public-url.test.mjs',
  'test/addon-shutdown.test.mjs', 'test/bootstrap-shutdown.test.mjs', 'test/i18n.test.mjs', 'test/selected-export.test.mjs',
  'test/helpers/load-module.mjs', 'test/synthetic-policy.test.mjs', 'test/support/policy-harness.mjs',
  'test/support/fake-window.mjs', 'test/support/window-entry.mjs',
  '.github/workflows/ci.yml', '.github/dependabot.yml'
];

export function isPublicImage(file) { return PUBLIC_IMAGE_FILES.includes(file) || Object.hasOwn(ICON_PNG_SIZES, file); }

const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crc32 = data => {
  let value = 0xffffffff;
  for (const byte of data) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

/** Small static PNG icons cannot carry textual, EXIF, profile or animation payloads. */
export function iconPNGFindings(contents, file) {
  const issue = kind => [{ file, line: 1, kind }];
  const data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  const size = ICON_PNG_SIZES[file];
  if (!size) return issue('unreviewed PNG icon path');
  if (data.length > 1024 * 1024) return issue('icon PNG exceeds 1 MiB');
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (data.length < 45 || !data.subarray(0, 8).equals(signature)) return issue('icon must be PNG');
  const invalid = () => issue('invalid or unsupported icon PNG structure');
  const compressed = [];
  let at = 8, header = false, endedIDAT = false, palette = 0, color;
  const optional = new Set();
  while (at < data.length) {
    if (at + 12 > data.length) return invalid();
    const length = data.readUInt32BE(at);
    if (length > data.length - at - 12) return invalid();
    const type = data.subarray(at + 4, at + 8).toString('latin1');
    const payload = data.subarray(at + 8, at + 8 + length);
    if (crc32(data.subarray(at + 4, at + 8 + length)) !== data.readUInt32BE(at + 8 + length)) return issue('icon PNG chunk checksum is invalid');
    if (!header && type !== 'IHDR') return invalid();
    if (compressed.length && type !== 'IDAT') endedIDAT = true;
    if (type === 'IHDR') {
      if (header || length !== 13) return invalid();
      if (payload.readUInt32BE(0) !== size || payload.readUInt32BE(4) !== size) return issue(`icon PNG must be ${size} by ${size} pixels`);
      color = payload[9];
      if (payload[8] !== 8 || ![0, 2, 3, 4, 6].includes(color) || payload[10] || payload[11] || payload[12]) return invalid();
      header = true;
    } else if (type === 'PLTE') {
      if (palette || compressed.length || ![2, 3, 6].includes(color) || !length || length % 3 || length > 768) return invalid();
      palette = length / 3;
    } else if (type === 'IDAT') {
      if (endedIDAT || !length || (color === 3 && !palette)) return invalid();
      compressed.push(payload);
    } else if (type === 'IEND') {
      if (length || !compressed.length || at + 12 !== data.length) return invalid();
      const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color], stride = size * channels + 1;
      try {
        const pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: size * stride });
        if (pixels.length !== size * stride) return invalid();
        for (let row = 0; row < size; row++) if (pixels[row * stride] > 4) return invalid();
      } catch { return issue('icon PNG raster data is invalid'); }
      return [];
    } else if (['tRNS', 'sRGB', 'gAMA', 'cHRM', 'pHYs'].includes(type)) {
      if (optional.has(type) || compressed.length) return invalid();
      optional.add(type);
      if (type === 'tRNS' && !((color === 0 && length === 2) || (color === 2 && length === 6) || (color === 3 && palette && length > 0 && length <= palette))) return invalid();
      if (type === 'sRGB' && (length !== 1 || payload[0] > 3)) return invalid();
      if (type === 'gAMA' && (length !== 4 || !payload.readUInt32BE(0))) return invalid();
      if (type === 'cHRM' && length !== 32) return invalid();
      if (type === 'pHYs' && (length !== 9 || payload[8] > 1)) return invalid();
    } else return issue('icon PNG contains unreviewed metadata or animation');
    at += length + 12;
  }
  return invalid();
}

/** Only raster data and standard non-personal JPEG headers may enter a public demo. */
export function imageFindings(contents, file) {
  const issue = kind => [{ file, line: 1, kind }];
  const data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  if (data.length > 12 * 1024 * 1024) return issue('demo image exceeds 12 MiB');
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return issue('demo image must be JPEG');
  let at = 2, frame = false, scan = false;
  const invalid = () => issue('invalid or unsupported JPEG structure');
  while (at < data.length) {
    if (data[at++] !== 0xff) return invalid();
    while (data[at] === 0xff) at++;
    if (at >= data.length) return invalid();
    const marker = data[at++];
    if (marker === 0xd9) return frame && scan && at === data.length ? [] : invalid();
    if (at + 2 > data.length) return invalid();
    const length = data.readUInt16BE(at);
    if (length < 2 || at + length > data.length) return invalid();
    const payload = data.subarray(at + 2, at + length);
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      const jfif = marker === 0xe0 && payload.length === 14 && payload.subarray(0, 5).equals(Buffer.from('JFIF\0'))
        && payload[12] === 0 && payload[13] === 0;
      const adobe = marker === 0xee && payload.length === 12 && payload.subarray(0, 5).equals(Buffer.from('Adobe'));
      if (!jfif && !adobe) return issue('demo image contains metadata or an embedded thumbnail');
    } else if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (frame || payload.length < 6 || payload[0] !== 8 || ![1, 3, 4].includes(payload[5])
        || payload.length !== 6 + 3 * payload[5]) return invalid();
      const height = payload.readUInt16BE(1), width = payload.readUInt16BE(3);
      if (!height || !width || width * height > 25_000_000) return issue('demo image dimensions are invalid or excessive');
      frame = true;
    } else if (marker === 0xda) {
      if (!frame || payload.length < 6 || ![1, 2, 3, 4].includes(payload[0])
        || payload.length !== 4 + 2 * payload[0]) return invalid();
      scan = true;
    } else if (![0xc4, 0xdb, 0xdd].includes(marker)) return invalid();
    at += length;
    if (marker !== 0xda) continue;
    // Entropy bytes are opaque. Stuffed bytes and restart markers are part of
    // the raster; another marker starts a new segment or ends the image.
    let boundary = false;
    while (at < data.length) {
      if (data[at] !== 0xff) { at++; continue; }
      const start = at;
      while (data[at] === 0xff) at++;
      if (at >= data.length) return invalid();
      const next = data[at++];
      if (next === 0 || (next >= 0xd0 && next <= 0xd7)) continue;
      at = start; boundary = true; break;
    }
    if (!boundary) return invalid();
  }
  return invalid();
}

export function decodePublicText(contents, file) {
  const text = typeof contents === 'string' ? contents : new TextDecoder('utf-8', { fatal: true }).decode(contents);
  if (text.includes('\0')) throw new Error(`Public text contains a null byte: ${file}`);
  return text;
}

export function publicFileFindings(contents, file) {
  if (Object.hasOwn(ICON_PNG_SIZES, file)) return iconPNGFindings(contents, file);
  if (PUBLIC_IMAGE_FILES.includes(file)) return imageFindings(contents, file);
  try { return privacyFindings(decodePublicText(contents, file), file); }
  catch { return [{ file, line: 1, kind: 'public text must be UTF-8 without null bytes' }]; }
}

/** Exact archive entries: an old map or an unrelated file in dist cannot enter an XPI. */
export function archiveFiles({ sourceMap = false } = {}) {
  return ['bootstrap.js', 'manifest.json', 'content/batch.xhtml', 'content/main.js',
    ...Object.keys(ICON_PNG_SIZES),
    ...(sourceMap ? ['content/main.js.map'] : [])];
}

export function publicPath(relative) {
  const name = String(relative).replace(/\\/g, '/');
  if (name.startsWith('/') || name.includes(':') || name.includes('\0')
    || name.split('/').some(part => !part || part === '..' || part === '.')) return false;
  return PUBLIC_FILES.includes(name) || name === 'README.md' || name === 'LICENSE'
    || /^src\/[A-Za-z0-9_./-]+\.ts$/.test(name) || name === 'content/batch.xhtml';
}

/** Inspect existing ancestors before any read/write, including junctions on Windows. */
export function assertSafePath(root, target, { kind = 'file' } = {}) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Path must remain inside the project directory');
  }
  const parts = relative.split(path.sep);
  let current = path.resolve(root);
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (cause) { if (cause.code === 'ENOENT') continue; throw cause; }
    if (stat.isSymbolicLink()) throw new Error(`Symlinks and junctions are not allowed: ${relative}`);
    const directory = index < parts.length - 1 || kind === 'directory';
    if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error(`Unexpected path type: ${relative}`);
  }
}

export function collectPublicFiles(root) {
  const files = PUBLIC_FILES.filter(name => fs.existsSync(path.join(root, name)));
  if (!files.includes('PUBLIC-README.md') && fs.existsSync(path.join(root, 'README.md'))) files.push('README.md');
  if (fs.existsSync(path.join(root, 'LICENSE'))) files.push('LICENSE');
  const walk = directory => {
    assertSafePath(root, path.join(root, directory), { kind: 'directory' });
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const name = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Public source may not contain symlinks: ${name}`);
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile() && publicPath(name)) files.push(name);
      else throw new Error(`Unreviewed file in public source directory: ${name}`);
    }
  };
  walk('src');
  files.push('content/batch.xhtml');
  for (const file of files) {
    if (!publicPath(file)) throw new Error(`Unreviewed public file: ${file}`);
    assertSafePath(root, path.join(root, file));
    if (!fs.lstatSync(path.join(root, file)).isFile()) throw new Error(`Public input must be a regular file: ${file}`);
  }
  return [...new Set(files)].sort();
}

/** Findings identify file and line without printing any suspected secret. */
export function privacyFindings(text, file) {
  const found = [];
  const lines = String(text).split(/\r?\n/);
  const rules = [
    ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['access token', /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,})\b/],
    ['local account path', /[A-Za-z]:[/\\]{1,2}(?:Users[/\\]{1,2}(?!you(?:[/\\]|$))|Codex_zone[/\\])/i],
    ['local account path', /\/(?:Users|home)\/(?!you(?:\/|$))[^/\s]+\//],
    ['local library link', /zotero:\/\/(?:select|open-pdf)\/(?:library|groups\/\d+)\/items\/[A-Z0-9]{8}\b/],
    ['credential in URL', /https?:\/\/[^/\s:@]+:[^/\s@]+@/i],
    ['personal contact example', /\b[\w.+-]+@(?!example\.(?:com|org|net)\b|zotero\.org\b)[\w-]+\.[\w.-]+\b/i]
  ];
  for (const [kind, pattern] of rules) {
    // Registry deprecation notices identify upstream maintainers, not the local
    // library user. Continue checking the lockfile for actual credential shapes.
    if (file === 'package-lock.json' && kind === 'personal contact example') continue;
    for (let at = 0; at < lines.length; at++) {
      // The reviewed high-resolution icon contains an @ in its filename.
      // Exempt only that complete path from the email rule, then still scan
      // the rest of the line for contacts and every rule for actual secrets.
      const line = kind === 'personal contact example'
        ? lines[at].replace(/(?<![\w.@/-])\/?icons\/icon@2x\.png(?![\w.@/-])/g, '') : lines[at];
      if (pattern.test(line)) found.push({ file, line: at + 1, kind });
    }
  }
  return found;
}

export function manifestProblems(manifest, pkg, { release = false } = {}) {
  const problems = [];
  const zotero = manifest.applications?.zotero;
  if (manifest.manifest_version !== 2) problems.push('manifest_version must be 2');
  if (!/^\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?$/.test(String(manifest.version || ''))) problems.push('Unsafe or invalid add-on version');
  if (manifest.version !== pkg.version) problems.push('package.json and manifest.json versions differ');
  if (!manifest.icons || typeof manifest.icons !== 'object' || Array.isArray(manifest.icons)
    || Object.keys(manifest.icons).length !== 2 || manifest.icons['48'] !== 'icons/icon.png' || manifest.icons['96'] !== 'icons/icon@2x.png') {
    problems.push('Manifest must reference the reviewed 48px and 96px PNG icons');
  }
  for (const key of ['id', 'strict_min_version', 'strict_max_version', 'update_url']) {
    if (!zotero?.[key]) problems.push(`applications.zotero.${key} is required`);
  }
  try {
    const url = new URL(zotero?.update_url);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) problems.push('Update URL must use HTTPS without credentials or a fragment');
    if (release && (/\.(?:invalid|test|localhost|example)$/.test(url.hostname) || /^example\.(?:com|org|net)$/.test(url.hostname)
      || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) problems.push('Replace the placeholder update URL with the owned update endpoint');
  } catch { problems.push('Invalid update URL'); }
  if (release) {
    if (!manifest.author || /local|development|placeholder/i.test(manifest.author)) problems.push('Set the public maintainer name in manifest.author');
    if (!pkg.license || /UNLICENSED|SEE LICENSE/i.test(pkg.license)) problems.push('Choose and declare a distribution license in package.json');
    const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    if (!repository || !/^https:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?$/.test(repository)) problems.push('Set the actual GitHub repository URL in package.json');
  }
  return problems;
}

/** A first public release offers only this add-on, version, artifact and tested range. */
export function updatesProblems(updates, manifest, pkg, { artifactHash } = {}) {
  const problems = [];
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const onlyKeys = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
  const id = manifest.applications?.zotero?.id;
  if (!onlyKeys(updates, ['addons']) || !object(updates.addons)
    || Object.keys(updates.addons).length !== 1 || !Object.hasOwn(updates.addons, id)) {
    return ['Update manifest must contain only the current add-on ID'];
  }
  const addon = updates.addons[id];
  if (!onlyKeys(addon, ['updates']) || !Array.isArray(addon.updates) || addon.updates.length !== 1) {
    return ['Update manifest must offer exactly the current public release'];
  }
  const entry = addon.updates[0];
  if (!onlyKeys(entry, ['version', 'update_link', 'update_hash', 'applications'])) return ['Invalid update entry structure'];
  if (entry.version !== manifest.version || entry.version !== pkg.version) problems.push('Update version must match the add-on and package versions');
  const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const repositoryURL = String(repository || '').replace(/\.git$/, '');
  const expectedURL = `${repositoryURL}/releases/download/v${manifest.version}/pdf-metadata-refresh-${manifest.version}.xpi`;
  try {
    const url = new URL(entry.update_link);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.search || url.hash
      || !/^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repositoryURL) || entry.update_link !== expectedURL) {
      problems.push('Update link must be the HTTPS versioned XPI in the configured GitHub repository');
    }
  } catch { problems.push('Invalid public update link'); }
  if (!/^sha256:[a-f0-9]{64}$/.test(String(entry.update_hash || ''))) problems.push('Update hash must be a lowercase SHA-256 digest');
  else if (artifactHash && entry.update_hash !== `sha256:${artifactHash}`) problems.push('Update hash differs from the current local XPI');
  const applications = entry.applications, compatibility = applications?.zotero;
  if (!onlyKeys(applications, ['zotero']) || !onlyKeys(compatibility, ['strict_min_version', 'strict_max_version'])) {
    problems.push('Update compatibility must contain only the Zotero minimum and maximum versions');
  } else {
    for (const key of ['strict_min_version', 'strict_max_version']) {
      if (typeof compatibility[key] !== 'string' || compatibility[key] !== manifest.applications.zotero[key]) {
        problems.push(`Update ${key} must match the tested manifest compatibility`);
      }
    }
    const minimum = compatibility.strict_min_version, maximum = compatibility.strict_max_version;
    if (!/^\d+(?:\.\d+){1,3}$/.test(String(minimum || '')) || !/^\d+(?:\.\d+){0,3}(?:\.\*)?$/.test(String(maximum || ''))) {
      problems.push('Invalid Zotero compatibility version range');
    } else {
      const min = minimum.split('.').map(Number), max = maximum.split('.').map(part => part === '*' ? Infinity : Number(part));
      let comparison = 0;
      for (let index = 0; index < Math.max(min.length, max.length); index++) {
        const difference = (max[index] ?? (max.includes(Infinity) ? Infinity : 0)) - (min[index] ?? 0);
        if (difference) { comparison = difference; break; }
      }
      if (comparison < 0) problems.push('Zotero compatibility maximum precedes its minimum');
    }
  }
  return problems;
}

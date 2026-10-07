import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertSafePath, collectPublicFiles, manifestProblems, publicFileFindings, publicPath, updatesProblems, PUBLIC_DOCUMENT_FILES, PUBLIC_IMAGE_FILES } from './release-files.mjs';

export function checkRelease(root, { development = false, requireUpdateManifest = true, verifyArtifactHash = true } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const errors = manifestProblems(manifest, pkg, { release: !development });
  const warnings = [];
  const files = collectPublicFiles(root);
  for (const file of files) {
    const findings = publicFileFindings(fs.readFileSync(path.join(root, file)), file);
    for (const finding of findings) {
      const message = `${finding.file}:${finding.line}: ${finding.kind}`;
      if (finding.kind === 'personal contact example') warnings.push(message);
      else errors.push(message);
    }
  }
  // Ignore rules do not untrack already committed files. Inspect the actual index too.
  const gitRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' });
  if (gitRoot.status === 0 && path.resolve(gitRoot.stdout.trim()) === path.resolve(root)) {
    const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
    if (tracked.status !== 0) errors.push('Could not inspect Git tracked files');
    else for (const name of tracked.stdout.split('\0').filter(Boolean)) {
      if (!publicPath(name)) errors.push(`Private or unreviewed file is tracked: ${name}`);
    }
  } else warnings.push('No Git repository at this root; no tracked-file check was possible');
  if (!development && !fs.existsSync(path.join(root, 'LICENSE'))) errors.push('Add the chosen LICENSE before distribution');
  if (!development) for (const file of [...PUBLIC_DOCUMENT_FILES, ...PUBLIC_IMAGE_FILES]) {
    if (!files.includes(file)) errors.push(`Required public guide or demo is missing: ${file}`);
  }
  if (!development && requireUpdateManifest) {
    if (!files.includes('updates.json')) errors.push('Add updates.json after building the current release XPI');
    else {
      let artifactHash;
      const artifact = path.join(root, `pdf-metadata-refresh-${manifest.version}.xpi`);
      if (verifyArtifactHash && fs.existsSync(artifact)) {
        assertSafePath(root, artifact);
        artifactHash = createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
      } else if (verifyArtifactHash) warnings.push('No local current-version XPI was available to verify the update hash');
      try {
        errors.push(...updatesProblems(JSON.parse(fs.readFileSync(path.join(root, 'updates.json'), 'utf8')), manifest, pkg, { artifactHash }));
      } catch { errors.push('updates.json must be valid JSON'); }
    }
  }
  if (!development && fs.existsSync(path.join(root, 'PUBLIC-README.md'))) errors.push('Run release:source and publish from the reviewed export, whose README is the public guide');
  return { files: files.length, errors, warnings };
}

function main() {
  const root = path.resolve(import.meta.dirname, '..');
  const result = checkRelease(root, { development: process.argv.includes('--development'), verifyArtifactHash: !process.argv.includes('--skip-artifact-hash') });
  for (const warning of result.warnings) console.warn(`Review: ${warning}`);
  for (const error of result.errors) console.error(`Blocked: ${error}`);
  console.log(`Public source check: ${result.files} files, ${result.errors.length} blocker(s), ${result.warnings.length} review note(s)`);
  if (result.errors.length) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

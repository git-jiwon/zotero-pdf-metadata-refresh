/**
 * Load a TypeScript source module the way the recognizer's CLI does.
 *
 * The add-on's rules live in `src/`, are bundled into the XPI, and are the same
 * files the evaluation runner imports. Tests build them the same way so that
 * what is measured here is what ships — not a second copy written for the test.
 */
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const scratch = mkdtempSync(path.join(tmpdir(), 'zpmr-modules-'));
const loaded = new Map();

export async function moduleAt(entry) {
  if (loaded.has(entry)) return loaded.get(entry);
  const file = path.join(scratch, `${path.basename(entry, '.ts')}-${loaded.size}.mjs`);
  await build({
    entryPoints: [entry], outfile: file, bundle: true, format: 'esm', platform: 'neutral',
    define: { __ADDON_VERSION__: '"test"' }, loader: { '.ps1': 'text' }
  });
  const module = await import(pathToFileURL(file).href);
  loaded.set(entry, module);
  return module;
}

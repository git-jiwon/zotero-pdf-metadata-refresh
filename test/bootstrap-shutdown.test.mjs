import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('bootstrap.js', 'utf8');
const scope = () => {
  const sandbox = { Zotero: { PDFMetadataRefresh: {} }, PDFMetadataRefresh: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox;
};

test('bootstrap always unregisters chrome and clears globals after addon shutdown rejects', async () => {
  const sandbox = scope();
  let closed = 0;
  sandbox.addon = { shutdown: async () => { throw new Error('shutdown failure'); } };
  sandbox.chromeHandle = { destruct: () => { closed++; } };
  await assert.rejects(sandbox.shutdown(), /shutdown failure/);
  assert.equal(closed, 1);
  assert.equal(sandbox.addon, null);
  assert.equal(sandbox.chromeHandle, null);
  assert.equal('PDFMetadataRefresh' in sandbox.Zotero, false);
  assert.equal(sandbox.PDFMetadataRefresh, undefined);
});

test('bootstrap clears globals even when chrome disposal throws', async () => {
  const sandbox = scope();
  sandbox.chromeHandle = { destruct: () => { throw new Error('disposal failure'); } };
  await assert.rejects(sandbox.shutdown(), /disposal failure/);
  assert.equal(sandbox.chromeHandle, null);
  assert.equal('PDFMetadataRefresh' in sandbox.Zotero, false);
  assert.equal(sandbox.PDFMetadataRefresh, undefined);
});

test('bootstrap shutdown can be called after cleanup', async () => {
  const sandbox = scope();
  await sandbox.shutdown();
  await sandbox.shutdown();
  assert.equal(sandbox.addon, null);
  assert.equal(sandbox.chromeHandle, null);
});

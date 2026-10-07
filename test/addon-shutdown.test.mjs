import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleAt } from './helpers/load-module.mjs';

const { Addon } = await moduleAt('src/index.ts');

test('addon shutdown waits for the window to finish before unregistering its menu', async () => {
  const addon = new Addon();
  let finish, removed = false;
  const pending = new Promise(resolve => { finish = resolve; });
  addon.menu = { unregister: () => { removed = true; } };
  addon.batchWindow = { pdfMetadataRefreshShutdown: () => pending };
  const shutdown = addon.shutdown();
  await Promise.resolve();
  assert.equal(removed, false);
  finish();
  await shutdown;
  assert.equal(removed, true);
  assert.equal(addon.batchWindow, null);
  assert.equal(addon.busy, false);
});

test('addon cleanup still unregisters its menu if window shutdown fails', async () => {
  const addon = new Addon();
  let removed = false;
  addon.menu = { unregister: () => { removed = true; } };
  addon.batchWindow = { pdfMetadataRefreshShutdown: async () => { throw new Error('synthetic failure'); } };
  await assert.rejects(addon.shutdown(), /synthetic failure/);
  assert.equal(removed, true);
  assert.equal(addon.batchWindow, null);
});

test('addon shutdown with no window is safe', async () => {
  const addon = new Addon();
  let removed = false;
  addon.menu = { unregister: () => { removed = true; } };
  await addon.shutdown();
  assert.equal(removed, true);
});

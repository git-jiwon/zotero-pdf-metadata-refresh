import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleAt } from './helpers/load-module.mjs';

const { assertPublicURL, safePublicURL, PUBLIC_URL_ERROR } = await moduleAt('src/utils/public-url.ts');
const { getPublicPage } = await moduleAt('src/utils/http.ts');
const { zoteroBrowser } = await moduleAt('src/restore/browser.ts');
const { zoteroFetcher } = await moduleAt('src/restore/outcome.ts');
const { ProviderLedger } = await moduleAt('src/restore/outcome.ts');
const { googleDiscover, resetGoogleState } = await moduleAt('src/restore/google.ts');

test('public lookup accepts public hosts and IPv4/IPv6 literals', () => {
  for (const url of ['https://example.org/record?q=title', 'http://example.org:8080/paper',
    'https://8.8.8.8/', 'https://[2606:4700:4700::1111]/']) assert.ok(safePublicURL(url), url);
});

test('public lookup refuses privileged URLs, URL credentials and known local address forms', () => {
  const credential = new URL('https://example.org/'); credential.username = 'test'; credential.password = 'test';
  for (const url of [credential.href, 'file:///C:/private.pdf', 'javascript:alert(1)', 'https://example.org/\npath',
    'http://localhost/', 'http://localhost./', 'http://node.localhost/', 'http://printer.local/', 'http://router.home.arpa/',
    'http://127.0.0.1/', 'http://127.2.3.4/', 'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/',
    'http://10.0.0.1/', 'http://172.16.0.1/', 'http://192.168.1.1/', 'http://169.254.169.254/', 'http://100.64.0.1/',
    'http://0.0.0.0/', 'http://224.0.0.1/', 'http://[::]/', 'http://[::1]/', 'http://[fc00::1]/',
    'http://[fe80::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:192.168.1.1]/', 'http://[::127.0.0.1]/']) {
    assert.equal(safePublicURL(url), null, url);
  }
});

test('invalid public URL errors do not include the rejected address or credentials', () => {
  const credential = new URL('https://example.org/'); credential.username = 'test'; credential.password = 'private-value';
  assert.throws(() => assertPublicURL(credential.href), error => error.message === PUBLIC_URL_ERROR);
});

test('rejected public requests never call the HTTP client', async () => {
  const held = globalThis.Zotero;
  let calls = 0;
  globalThis.Zotero = { HTTP: { request: async () => { calls++; return {}; } } };
  try {
    await assert.rejects(getPublicPage('http://127.0.0.1/private'), { message: PUBLIC_URL_ERROR });
    assert.equal(calls, 0);
    assert.deepEqual(await getPublicPage('https://example.org/paper', 1000), {});
    assert.equal(calls, 1);
  } finally { globalThis.Zotero = held; }
});

test('manual redirect resolution refuses a local Location before following it', async () => {
  const held = globalThis.Zotero;
  const requested = [];
  globalThis.Zotero = { HTTP: { request: async (_method, url) => {
    requested.push(url);
    return { status: 302, getResponseHeader: name => name === 'Location' ? 'http://127.0.0.1/private' : 'text/html' };
  } } };
  try {
    await assert.rejects(zoteroBrowser()().resolve('https://example.org/redirect'), { message: PUBLIC_URL_ERROR });
    assert.deepEqual(requested, ['https://example.org/redirect']);
  } finally { globalThis.Zotero = held; }
});

test('HTTP auto-redirect results at a local address are rejected before content is returned', async () => {
  const held = globalThis.Zotero;
  globalThis.Zotero = { HTTP: { request: async () => ({ responseURL: 'http://10.0.0.1/private', responseText: 'private' }) } };
  try { await assert.rejects(getPublicPage('https://example.org/redirect'), { message: PUBLIC_URL_ERROR }); }
  finally { globalThis.Zotero = held; }
});

test('provider fetcher refuses a private target before calling the HTTP client', async () => {
  const held = globalThis.Zotero;
  let calls = 0;
  globalThis.Zotero = { HTTP: { request: async () => { calls++; return {}; } } };
  try {
    const result = await zoteroFetcher()('http://192.168.1.1/private', { provider: 'synthetic' });
    assert.equal(calls, 0);
    assert.equal(result.body, '');
    assert.equal(result.error, PUBLIC_URL_ERROR);
    assert.equal(result.url, '(blocked URL)');
  } finally { globalThis.Zotero = held; }
});

test('Google discovery stops a forbidden resolved redirect without browser or PDF fallback', async () => {
  const title = 'Transport safety sample article';
  const html = `<html><head><title>Results</title></head><body><div id="rso"><a href="https://example.org/redirect"><h3>${title}</h3></a><cite>https://example.org/redirect</cite></div></body></html>`;
  for (const throwOnResolve of [true, false]) {
    resetGoogleState();
    let detailLoads = 0, resolves = 0, pdfReads = 0;
    const browser = {
      live: false, release() {},
      load: async url => {
        if (!url.startsWith('https://www.google.com/search')) detailLoads++;
        return { url, finalURL: url, status: 200, html, ms: 0 };
      },
      resolve: async () => {
        resolves++;
        if (throwOnResolve) throw new Error(PUBLIC_URL_ERROR);
        return { finalURL: 'http://127.0.0.1/private.pdf', contentType: 'application/pdf', status: 302 };
      },
      readPDF: async url => { pdfReads++; return { url, text: 'synthetic', pages: 1 }; }
    };
    const ledger = new ProviderLedger();
    const clues = { kind: 'article', titles: [title], surnames: [], years: [], identifiers: { ISBN: [] }, script: 'latin' };
    const result = await googleDiscover({ text: title }, clues, {
      browser, ledger, fetch: async () => { throw new Error('Network should not be called'); }
    });
    assert.equal(resolves, 1);
    assert.equal(detailLoads, 0);
    assert.equal(pdfReads, 0);
    assert.equal(result.search.hits[0].detail.kind, 'rejected');
    assert.ok(result.search.hits[0].detail.note.startsWith(PUBLIC_URL_ERROR));
  }
});

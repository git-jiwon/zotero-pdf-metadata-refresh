import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleAt } from './helpers/load-module.mjs';

const { safeExternalURL } = await moduleAt('src/utils/external-url.ts');

test('candidate links permit ordinary HTTP and HTTPS URLs', () => {
  assert.equal(safeExternalURL(' https://example.org/paper?q=review#doi '), 'https://example.org/paper?q=review#doi');
  assert.equal(safeExternalURL('http://example.org/paper'), 'http://example.org/paper');
  assert.equal(safeExternalURL('https://doi.org/10.1000/example'), 'https://doi.org/10.1000/example');
});

test('candidate links reject privileged schemes, credentials and control characters', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///C:/private.pdf',
    'chrome://zotero/content/', 'resource://gre/', 'zotero://select/items/test',
    'https://user@example.org/', '//example.org/paper',
    '/relative', '', 'not a url', 'https://example.org/\nprivate', 'https://example.org/\tprivate']) {
    assert.equal(safeExternalURL(url), null, url);
  }
  const withCredentials = new URL('https://example.org/');
  withCredentials.username = 'synthetic-user';
  withCredentials.password = 'synthetic-password';
  assert.equal(safeExternalURL(withCredentials.href), null);
});

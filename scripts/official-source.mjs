import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The CLI's side of the official-source lookup.
 *
 * Every rule — what a bound record is, which fields it states, how a lost
 * ligature is told from a different title — is in
 * src/recognition/official-source.ts, which the add-on loads too. What is here
 * is node's fetch, the user agent this project identifies itself with, and the
 * frozen response on disk that lets a run repeat without the network.
 *
 * Nothing is sent but the DOI the document printed: no PDF, no page text, no
 * library contents.
 *
 * https://api.crossref.org
 */

const AGENT = 'zotero-pdf-metadata-refresh (bibliographic audit)';

export function frozenPath(cacheDir, doi) {
  return path.join(cacheDir, `crossref-${doi.replace(/[^A-Za-z0-9.]+/g, '_')}.json`);
}

/**
 * A fetcher for the shared module, with the frozen copy read first and written
 * after. `offline` refuses the network entirely, so a run repeats on a machine
 * with no connection and produces the same numbers.
 */
export function nodeCrossrefFetch({ cacheDir, offline = false, timeout = 12000 } = {}) {
  return async url => {
    const doi = decodeURIComponent(url.split('/works/')[1] || '');
    mkdirSync(cacheDir, { recursive: true });
    const file = frozenPath(cacheDir, doi);
    if (existsSync(file)) {
      const frozen = JSON.parse(readFileSync(file, 'utf8'));
      return { ok: !!frozen.message, status: frozen.status ?? 200, json: { message: frozen.message }, fromCache: true };
    }
    if (offline) return { ok: false, status: 0, failure: 'offline and no frozen response' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': AGENT, Accept: 'application/json' },
        signal: controller.signal
      });
      const json = response.ok ? await response.json() : null;
      writeFileSync(file, JSON.stringify({
        ok: response.ok, doi, status: response.status, retrievedAt: new Date().toISOString(),
        message: json?.message ? trimForFreeze(json.message) : null
      }, null, 1), 'utf8');
      return { ok: response.ok, status: response.status, json, failure: response.ok ? null : `HTTP ${response.status}` };
    }
    finally { clearTimeout(timer); }
  };
}

function trimForFreeze(message) {
  const keep = ['DOI', 'type', 'title', 'container-title', 'volume', 'issue', 'page',
    'article-number', 'issued', 'published', 'published-print', 'published-online',
    'publisher', 'ISSN', 'ISBN', 'is-referenced-by-count'];
  const out = {};
  for (const key of keep) if (message[key] !== undefined) out[key] = message[key];
  out.author = (message.author || []).map(entry => ({ given: entry.given, family: entry.family, sequence: entry.sequence }));
  return out;
}

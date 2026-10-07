import { normalizedISBN } from '../metadata/identifier-compare';
import { PUBLIC_URL_ERROR, safePublicURL } from '../utils/public-url';
import { samePersonAcrossScripts } from '../metadata/name-equivalence';
import { personCreator } from '../recognition/agents';
import { classifyFetch, looksLikeChallenge, type FetchOutcome } from './outcome';
import { askableBySearchEngine, type DocumentClues, type SearchQuery } from './clues';
import type { BrowserPage, SearchBrowser } from './browser';
import { crossrefByDOI, recordFromYes24Page, type ExternalRecord, type ProviderContext, type PublicationStage, type RecordPerson } from './records';
import { collectFromPage, collectionSummary, looksLikeBrowserError, notAPerson, TRACKED_FIELDS, type Collection } from './collect';
export interface GoogleHit {
    rank: number;
    title: string;
    href: string;
    display: string;
    host: string;
    snippet: string;
    file?: boolean;
}
export interface HitTrace extends GoogleHit {
    score: number;
    followed: boolean;
    skipped?: string;
    detail?: {
        kind: FetchOutcome['kind'];
        finalURL: string;
        status: number;
        note: string;
        recordTitle?: string;
        standards?: string[];
        doi?: string;
        collection?: {
            access: string;
            accessNote: string;
            routes: string;
            collected: string[];
            extractionFailed: string[];
            absent: string[];
            inaccessible: number;
            fields: Collection['fields'];
        };
    };
}
export interface GoogleDiscovery {
    outcome: FetchOutcome;
    records: ExternalRecord[];
    search: {
        query: string;
        url: string;
        state: ResultState;
        hits: HitTrace[];
    };
    assistURL: string;
}
export type ResultState = 'results' | 'empty' | 'blocked' | 'scriptsRequired' | 'unreadable';
const MIN_INTERVAL_MS = 4000;
const BLOCK_HOLD_MS = 30 * 60 * 1000;
const PAGE_CACHE_MS = 24 * 60 * 60 * 1000;
const PAGE_CACHE_MAX = 400;
let lastLoadAt = 0;
let blockedUntil = 0;
let blockedNote = '';
const pageCache = new Map<string, {
    page: BrowserPage;
    at: number;
}>();
function cachedPage(url: string): BrowserPage | null {
    const held = pageCache.get(url);
    if (!held)
        return null;
    if (Date.now() - held.at > PAGE_CACHE_MS) {
        pageCache.delete(url);
        return null;
    }
    return held.page;
}
function rememberPage(url: string, page: BrowserPage): void {
    if (!page.html || page.status >= 400 || page.finalURL === 'about:blank')
        return;
    if (pageCache.size >= PAGE_CACHE_MAX)
        pageCache.delete(pageCache.keys().next().value as string);
    pageCache.set(url, { page, at: Date.now() });
}
export function resetGoogleState(): void { lastLoadAt = 0; blockedUntil = 0; blockedNote = ''; pageCache.clear(); }
const clean = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const decode = (value: string) => value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, '\'').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
const untag = (value: string) => decode(value.replace(/<[^>]+>/g, ''));
export function googleSearchURL(query: string, script: DocumentClues['script'] = 'latin'): string {
    const hl = script === 'latin' ? 'en' : 'ko';
    return `https://www.google.com/search?q=${encodeURIComponent(query.slice(0, 200))}&hl=${hl}&num=10`;
}
const BIBLIOGRAPHIC = /(^|\.)(doi\.org|yes24\.com|aladin\.co\.kr|kyobobook\.co\.kr|nl\.go\.kr|nlk\.go\.kr|riss\.kr|dbpia\.co\.kr|kci\.go\.kr|scienceon\.kisti\.re\.kr|nkis\.re\.kr|prism\.go\.kr|dcollection\.net|s-space\.snu\.ac\.kr|sciencedirect\.com|springer\.com|link\.springer\.com|wiley\.com|ieee\.org|ieeexplore\.ieee\.org|acm\.org|tandfonline\.com|nature\.com|mdpi\.com|copernicus\.org|thescipub\.com|acs\.org|pmc\.ncbi\.nlm\.nih\.gov|pubmed\.ncbi\.nlm\.nih\.gov|arxiv\.org|osti\.gov|worldcat\.org|openlibrary\.org|archive\.org|cambridge\.org|oup\.com|academic\.oup\.com|sagepub\.com|iopscience\.iop\.org|aip\.org|aps\.org|elsevier\.com|degruyter\.com|jstor\.org|semanticscholar\.org|statista\.com|marketsandmarkets\.com|researchandmarkets\.com|grandviewresearch\.com|kr\.krei\.re\.kr|krei\.re\.kr|kisti\.re\.kr|kostat\.go\.kr|go\.kr|re\.kr|ac\.kr|edu)$/i;
const SOCIAL = /(^|\.)(blog\.naver\.com|m\.blog\.naver\.com|cafe\.naver\.com|post\.naver\.com|tistory\.com|brunch\.co\.kr|instagram\.com|facebook\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|namu\.wiki|pinterest\.[a-z.]+|linkedin\.com|reddit\.com|quora\.com|threads\.net|tiktok\.com|coupang\.com|11st\.co\.kr|gmarket\.co\.kr|smartstore\.naver\.com|shopping\.naver\.com|millie\.co\.kr|ridibooks\.com)$/i;
const WALLED = /(^|\.)(researchgate\.net|academia\.edu|scribd\.com|studocu\.com|coursehero\.com)$/i;
const GOOGLE_OWN = /(^|\.)(google\.[a-z.]+|gstatic\.com|googleusercontent\.com|youtube\.com)$/i;
function hostOf(display: string): string {
    const match = display.match(/^(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})/i);
    return (match?.[1] || '').toLowerCase().replace(/^www\./, '');
}
export function classifyResultPage(html: string, finalURL: string): ResultState {
    if (/\/sorry\/index|\/sorry\?/.test(finalURL))
        return 'blocked';
    if (looksLikeChallenge(html) || /recaptcha\/(?:api|enterprise)|unusual traffic|비정상적인 트래픽/i.test(html))
        return 'blocked';
    if (/id="rso"|id="search"/.test(html))
        return 'results';
    if (/enablejs|httpservice\/retry/i.test(html))
        return 'scriptsRequired';
    if (!/<html|<body/i.test(html.slice(0, 5000)))
        return 'unreadable';
    return 'empty';
}
export function parseGoogleResults(html: string): GoogleHit[] {
    const anchors = [...html.matchAll(/<a\b([^>]*?)href="([^"]+)"([^>]*)>(?:\s*<br\s*\/?>)?\s*<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)];
    const hits: GoogleHit[] = [];
    const seen = new Set<string>();
    for (const [index, match] of anchors.entries()) {
        const href = decode(match[2]);
        const title = clean(untag(match[4]));
        if (!title)
            continue;
        const start = match.index! + match[0].length;
        const end = index + 1 < anchors.length ? anchors[index + 1].index! : Math.min(html.length, start + 6000);
        const block = html.slice(start, end);
        const display = clean(untag(block.match(/<cite\b[^>]*>([\s\S]*?)<\/cite>/i)?.[1] || ''));
        const snippet = clean(untag(block.match(/<div\b[^>]*class="[^"]*\bVwiC3b\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || block.match(/<span\b[^>]*>([^<]{60,400})<\/span>/i)?.[1] || ''));
        const host = /^https?:/i.test(href) && !/^https?:\/\/(?:www\.)?google\./i.test(href) ? hostOf(href) : hostOf(display);
        const key = `${title.toLowerCase()}|${host}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        const file = /<span\b[^>]*>\s*PDF\s*<\/span>/i.test(block.slice(0, 2500)) || /\.pdf(?:$|[?#])/i.test(display) || /\bPDF\s*$/.test(title);
        hits.push({ rank: hits.length, title, href, display, host, snippet: snippet.slice(0, 300), file });
    }
    return hits;
}
const tokens = (value: string): string[] => {
    const out: string[] = [];
    for (const word of clean(value).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
        if (/[가-힣]/.test(word)) {
            const bare = word.replace(/[^가-힣0-9a-z]/g, '');
            if (bare.length <= 2)
                out.push(bare);
            for (let i = 0; i + 2 <= bare.length; i++)
                out.push(bare.slice(i, i + 2));
        }
        else if (word.length >= 2)
            out.push(word);
    }
    return out;
};
export function titleOverlap(query: string, title: string): number {
    const wanted = new Set(tokens(query));
    if (!wanted.size)
        return 0;
    const found = new Set(tokens(title));
    let shared = 0;
    for (const token of wanted)
        if (found.has(token))
            shared++;
    return shared / wanted.size;
}
export function rankHits(hits: GoogleHit[], clues: DocumentClues, query: string): HitTrace[] {
    const bookish = clues.kind === 'book';
    const ranked = hits.map(hit => {
        const overlap = Math.max(titleOverlap(query, hit.title), ...clues.titles.map(title => titleOverlap(title, hit.title)));
        let score = overlap;
        let skipped: string | undefined;
        if (GOOGLE_OWN.test(hit.host) || !hit.host)
            skipped = hit.host ? 'a Google page, not a record' : 'no address shown';
        else if (overlap < 0.25 && !/^https?:\/\//i.test(hit.title))
            skipped = `the heading shares too little with the title as read (${Math.round(overlap * 100)}%)`;
        if (BIBLIOGRAPHIC.test(hit.host))
            score += 0.3;
        if (bookish && /yes24|aladin|kyobobook|nl\.go\.kr/.test(hit.host))
            score += 0.2;
        if (WALLED.test(hit.host))
            score -= 0.3;
        if (SOCIAL.test(hit.host))
            score -= 0.6;
        if (/yes24\.com/.test(hit.host) && /›\s*author|\/product\/author\//i.test(hit.display + ' ' + hit.href))
            score -= 0.5;
        if (/^https?:\/\//i.test(hit.title))
            score -= 0.4;
        if (hit.file || /^\[PDF\]/i.test(hit.title) || /\.pdf(?:$|[?#])/i.test(hit.display))
            score -= 0.2;
        score -= hit.rank * 0.01;
        return { ...hit, score, followed: false, skipped };
    });
    return ranked.sort((a, b) => Number(!!a.skipped) - Number(!!b.skipped) || b.score - a.score);
}
const TYPE_BY_KIND: Record<DocumentClues['kind'], string> = { article: 'journalArticle', book: 'book', thesis: 'thesis', report: 'report', unknown: 'document' };
const KCI_MENU = /^(?:HOME|KCI|논문|연구분야|발행기관|초록|키워드|참고문헌|학술지|검색|로그인|회원)/;
const AFFILIATION = /(?:대학교|대학원|대학|연구원|연구소|연구센터|센터|병원|공사|공단|학회|협회|재단|기술원|과학원|㈜|\(주\)|주식회사|[청부처원]$|University|Institute|College|Hospital|Center|Centre|Corporation|Inc\.?|Ltd\.?|KAIST|POSTECH|UNIST|DGIST|GIST)/i;
export function kciKoreanTitle(text: string, english: string): string {
    const probe = clean(english).toLowerCase().slice(0, 40);
    if (probe.length < 12)
        return '';
    const lines = String(text || '').split(/\n+/).map(clean).filter(Boolean);
    const hangulOf = (line: string) => (line.match(/[가-힣]/g) || []).length;
    const lastCrumb = (line: string) => line.split(/\s+[>›»|]\s+/).filter(Boolean).pop() || '';
    const titleLike = (line: string) => hangulOf(line) >= 6 && hangulOf(line) * 2 >= (line.match(/\p{L}/gu) || []).length
        && !KCI_MENU.test(line) && !/[:：]$/.test(line);
    const index = lines.findIndex(line => line.toLowerCase().includes(probe));
    if (index < 0)
        return '';
    const before = lastCrumb(lines[index].slice(0, lines[index].toLowerCase().indexOf(probe)).replace(/[\s/=:：|·-]+$/, '').trim());
    if (titleLike(before))
        return before;
    for (const near of [lines[index - 1], lines[index + 1]]) {
        const crumb = near ? lastCrumb(near) : '';
        if (titleLike(crumb))
            return crumb;
    }
    return '';
}
export function kciHangulAuthors(text: string, english: string, latin: RecordPerson[]): RecordPerson[] | null {
    if (latin.some(person => /[가-힣]/.test(`${person.lastName}${person.firstName || ''}`)))
        return null;
    const lines = String(text || '').split(/\n+/).map(clean).filter(Boolean);
    const probe = clean(english).toLowerCase().slice(0, 40);
    const anchor = probe.length >= 12 ? lines.findIndex(line => line.toLowerCase().includes(probe)) : -1;
    const found: RecordPerson[] = [];
    const affiliations: string[] = [];
    for (const line of anchor >= 0 ? lines.slice(anchor, anchor + 12) : lines) {
        if (!line.includes('/'))
            continue;
        for (const segment of line.split(/\s*[,;]\s*/)) {
            const slash = segment.indexOf('/');
            if (slash < 0)
                continue;
            const name = segment.slice(0, slash).replace(/[(（][^)）]*[)）]/g, '').replace(/[\d*†‡]+$/, '').trim();
            const affiliation = segment.slice(slash + 1).trim();
            if (!/^[가-힣]{2,5}$/.test(name) || !affiliation)
                continue;
            const person = personCreator(name, 'author');
            if (!person)
                continue;
            found.push({ lastName: person.lastName, ...(person.firstName ? { firstName: person.firstName } : {}), ...(person.fieldMode ? { fieldMode: person.fieldMode } : {}), creatorType: 'author' });
            affiliations.push(affiliation);
        }
    }
    if (!found.length)
        return null;
    if (latin.length) {
        if (found.length !== latin.length)
            return null;
        const paired = found.filter((person, index) => samePersonAcrossScripts(person, latin[index])).length;
        if (paired < Math.max(1, found.length - 1))
            return null;
        return found.map((person, index) => ({ ...person, creatorType: latin[index].creatorType || 'author' }));
    }
    if (anchor < 0 || !affiliations.every(affiliation => AFFILIATION.test(affiliation)))
        return null;
    return found;
}
export function recordFromCollection(collection: Collection, clues: DocumentClues, outcome: FetchOutcome, requested: string): ExternalRecord | null {
    const url = collection.finalURL && collection.finalURL !== 'about:blank' ? collection.finalURL : (collection.fields.url?.value as string) || requested;
    const host = hostOf(url);
    const value = (field: string) => collection.fields[field]?.status === 'collected' ? collection.fields[field].value : undefined;
    let title = clean(value('title'));
    const structured = collection.routes.some(route => route.route !== 'pageText' && route.fields.some(field => !['title', 'url'].includes(field)));
    const kci = /(^|\.)kci\.go\.kr$/i.test(host) && (clues.titles[0] ? /[가-힣]/.test(clues.titles[0]) : clues.script !== 'latin');
    const english = title;
    if (kci && !/[가-힣]/.test(title))
        title = kciKoreanTitle(collection.textExcerpt, english) || title;
    const fields: Record<string, string> = { url };
    for (const field of ['date', 'publisher', 'publicationTitle', 'volume', 'issue', 'pages', 'numPages', 'edition', 'institution', 'university', 'language']) {
        const held = value(field);
        if (!held)
            continue;
        if (collection.fields[field]?.route === 'pageText' && ['volume', 'issue', 'pages', 'edition'].includes(field))
            continue;
        fields[field] = clean(held);
    }
    let creators: RecordPerson[] = (Array.isArray(value('creators')) ? value('creators') as RecordPerson[] : []).filter(person => !notAPerson(person));
    if (kci)
        creators = kciHangulAuthors(collection.textExcerpt, english, creators) || creators;
    const doi = value('DOI') && collection.fields.DOI?.route !== 'pageText' ? String(value('DOI')).toLowerCase() : undefined;
    const isbn = value('ISBN') ? normalizedISBN(String(value('ISBN'))) : '';
    const form: ExternalRecord['form'] = (collection as any).form || 'unknown';
    if (!title && collection.access === 'detail')
        title = clean(collection.fields.title?.alternatives?.[0]?.value);
    const statedTitle = /^(?:meta:(?:citation_title|dc\.title|dcterms\.title)|json-ld|site:)/.test(String(collection.fields.title?.source || ''));
    if (title && !statedTitle && /\s[>›»]\s/.test(title))
        title = title.split(/\s+[>›»]\s+/).filter(Boolean).pop() || title;
    if (!title)
        return null;
    if (fields.language)
        fields.language = languageCode(fields.language);
    if (doi)
        fields.DOI = doi;
    if (isbn)
        fields.ISBN = isbn;
    const stage: PublicationStage = /(^|\.)(arxiv\.org|researchsquare\.com|ssrn\.com|biorxiv\.org|medrxiv\.org|preprints\.org)$/.test(host) ? 'preprint'
        : fields.volume || fields.pages ? 'versionOfRecord' : 'unknown';
    const date = fields.date;
    let itemType = collection.itemType || TYPE_BY_KIND[clues.kind];
    if (itemType === 'journalArticle' && !fields.publicationTitle && !fields.volume && !doi && (isbn || fields.publisher))
        itemType = 'book';
    if (itemType === 'webpage' && clues.kind !== 'unknown')
        itemType = TYPE_BY_KIND[clues.kind];
    return {
        provider: 'google', url, retrievedAt: outcome.fetchedAt, live: outcome.live, method: collection.access === 'file' ? 'api' : 'browser',
        itemType, title, creators,
        date: date ? { value: date, precision: collection.fields.date?.precision || (date.length >= 10 ? 'day' : date.length >= 7 ? 'month' : 'year'), role: collection.fields.date?.source || 'page',
            ...(collection.fields.date?.defaulted ? { defaulted: collection.fields.date.defaulted } : {}) } : undefined,
        fields, identifiers: { DOI: doi, ISBN: isbn ? [isbn] : [] }, publicationStage: stage,
        relations: { isPreprintOf: [], hasPreprint: [] }, form,
        pageType: collection.access === 'file' ? `file via Google (${host}; pdf text)` : structured ? `web page via Google (${host}; ${collection.routes.filter(route => route.fields.length).map(route => route.route).join('+')})` : `web page via Google (${host}; title only)`,
        collected: collection
    };
}
export function languageCode(value: unknown): string {
    const text = clean(value).toLowerCase();
    const table: Record<string, string> = { english: 'en', eng: 'en', en: 'en', korean: 'ko', kor: 'ko', ko: 'ko', kr: 'ko', '한국어': 'ko', '한글': 'ko', japanese: 'ja', jpn: 'ja', ja: 'ja', jp: 'ja', '일본어': 'ja', chinese: 'zh', zho: 'zh', chi: 'zh', zh: 'zh', '중국어': 'zh', german: 'de', deu: 'de', ger: 'de', de: 'de', french: 'fr', fra: 'fr', fre: 'fr', fr: 'fr', spanish: 'es', spa: 'es', es: 'es' };
    const key = text.replace(/[-_].*$/, '');
    return table[text] || table[key] || clean(value);
}
const now = () => new Date().toISOString();
async function spaced(): Promise<void> {
    const wait = lastLoadAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0)
        await new Promise(resolve => setTimeout(resolve, wait));
    lastLoadAt = Date.now();
}
const FILE_TYPE = /application\/(?:pdf|octet-stream|x-download|force-download)|binary\//i;
async function browse(ctx: ProviderContext, browser: SearchBrowser, url: string, phase: 'search' | 'detail', settledWhen?: RegExp): Promise<FetchOutcome & {
    html: string;
    file?: boolean;
}> {
    const refused = (): FetchOutcome & {
        html: string;
    } => {
        const address = safePublicURL(url) ? url : '(blocked URL)';
        const outcome: FetchOutcome & {
            html: string;
        } = { kind: 'rejected', provider: 'google', url: address, finalURL: address, status: 0,
            fetchedAt: now(), ms: 0, method: 'browser', live: browser.live, phase, note: PUBLIC_URL_ERROR, html: '' };
        ctx.ledger.record(outcome);
        return outcome;
    };
    if (!safePublicURL(url))
        return refused();
    const allowed = ctx.ledger.canCall('google');
    if (!allowed.ok) {
        return { kind: allowed.waitMs ? 'rateLimited' : /blocked|authRequired/.test(allowed.reason || '') ? 'blocked' : 'rejected', provider: 'google', url, finalURL: url, status: 0, fetchedAt: now(), ms: 0, method: 'browser', live: false, note: `not asked: ${allowed.reason}`, phase, html: '' };
    }
    if (blockedUntil > Date.now()) {
        const skipped: FetchOutcome = { kind: 'blocked', provider: 'google', url, finalURL: url, status: 0, fetchedAt: now(), ms: 0, method: 'browser', live: false,
            note: `not asked: Google answered a bot check earlier this session (${blockedNote}); held for ${Math.round((blockedUntil - Date.now()) / 60000)} more minutes`, phase };
        ctx.ledger.record(skipped);
        return { ...skipped, html: '' };
    }
    if (phase === 'detail' && browser.resolve) {
        try {
            const resolved = await browser.resolve(url);
            if (!safePublicURL(resolved.finalURL || url))
                return refused();
            if (FILE_TYPE.test(resolved.contentType) || /\.pdf(?:$|[?#])/i.test(resolved.finalURL)) {
                const outcome: FetchOutcome & {
                    html: string;
                    file: boolean;
                } = {
                    kind: 'record', provider: 'google', url, finalURL: resolved.finalURL || url, status: resolved.status || 200, fetchedAt: now(), ms: 0, method: 'browser', live: browser.live,
                    note: 'a file: not opened in the browser, read by the PDF reader instead', phase, host: hostOf(resolved.finalURL || url), html: '', file: true
                };
                ctx.ledger.record(outcome);
                return outcome;
            }
        }
        catch (cause) {
            if (cause instanceof Error && cause.message === PUBLIC_URL_ERROR)
                return refused();
        }
    }
    const remembered = browser.live ? cachedPage(url) : null;
    if (!remembered && browser.live)
        await spaced();
    const page = remembered || await browser.load(url, { settleMs: phase === 'search' ? 7000 : 4000, timeoutMs: ctx.ledger.limits.requestTimeoutMs + 15000, settledWhen });
    if ((page.file && !safePublicURL(page.file.url || page.finalURL))
        || (page.finalURL !== 'about:blank' && !safePublicURL(page.finalURL || url)))
        return refused();
    const errorPage = !page.status && looksLikeBrowserError(page.html, page.finalURL);
    if (!remembered && browser.live && page.status)
        rememberPage(url, page);
    if (page.file) {
        const outcome: FetchOutcome & {
            html: string;
            file: boolean;
        } = {
            kind: 'record', provider: 'google', url, finalURL: page.file.url || page.finalURL, status: page.status || 200, fetchedAt: now(), ms: page.ms, method: 'browser', live: browser.live,
            note: `a file (${page.file.contentType.slice(0, 40)}): the browser refused to download it; read by the PDF reader instead`, phase, host: hostOf(page.file.url || page.finalURL), html: '', file: true
        };
        ctx.ledger.record(outcome);
        return outcome;
    }
    let outcome = classifyFetch({ url, finalURL: page.finalURL, status: page.status || (page.html && !errorPage ? 200 : 0), body: page.html, ms: page.ms, timedOut: page.timedOut,
        error: page.error || (errorPage ? 'the browser showed its own error page (certificate warning or connection failure)' : undefined), fixture: page.fixture }, { provider: 'google', method: 'browser', expect: 'html' });
    outcome = { ...outcome, phase, host: hostOf(page.finalURL) };
    if (phase === 'search') {
        const state = classifyResultPage(page.html, page.finalURL);
        if (state === 'blocked')
            outcome = { ...outcome, kind: 'blocked', note: `Google answered a bot check (${/\/sorry\//.test(page.finalURL) ? 'sorry page' : 'CAPTCHA in the page'}); the route stops for this session` };
        else if (state === 'scriptsRequired')
            outcome = { ...outcome, kind: 'parseError', note: 'the result page did not render (scripts did not run)' };
        else if (state === 'unreadable')
            outcome = { ...outcome, kind: 'parseError', note: 'nothing readable rendered' };
        else if (outcome.kind === 'record' && state === 'empty')
            outcome = { ...outcome, kind: 'noMatch', note: 'a result page with no results' };
    }
    else if (outcome.kind === 'record' && (page.finalURL === 'about:blank' || page.html.length < 200)) {
        outcome = { ...outcome, kind: 'rejected', note: 'nothing rendered: the link opened a file or an empty frame' };
    }
    if (outcome.kind === 'blocked' && phase === 'search' && page.status !== 0) {
        blockedUntil = Date.now() + BLOCK_HOLD_MS;
        blockedNote = outcome.note;
    }
    if (remembered)
        outcome = { ...outcome, note: `${outcome.note} (page rendered earlier this session, reused)` };
    ctx.ledger.record(outcome);
    return { ...outcome, html: page.html };
}
const READER_TIMEOUT_MS = 45000;
async function bounded<T>(work: Promise<T>, ctx: ProviderContext, what: string): Promise<T> {
    const limit = Math.max(0, Math.min(READER_TIMEOUT_MS, ctx.ledger.remainingMs()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    const stop = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} did not finish within ${Math.round(limit / 1000)} s`)), limit);
        if (ctx.cancelled)
            poll = setInterval(() => { if (ctx.cancelled?.())
                reject(new Error(`${what} stopped by the person`)); }, 500);
    });
    try {
        return await Promise.race([work, stop]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
        if (poll)
            clearInterval(poll);
    }
}
export interface DiscoverOptions {
    maxFollow?: number;
    maxSearches?: number;
    settled?: (record: ExternalRecord) => boolean;
    allowCrossref?: boolean;
}
export async function googleDiscover(query: SearchQuery, clues: DocumentClues, ctx: ProviderContext, options: DiscoverOptions = {}): Promise<GoogleDiscovery> {
    const url = googleSearchURL(query.text, clues.script);
    const assistURL = url;
    const empty = (outcome: FetchOutcome, state: ResultState): GoogleDiscovery => ({ outcome, records: [], search: { query: query.text, url, state, hits: [] }, assistURL });
    if (!ctx.browser) {
        return empty({ kind: 'rejected', provider: 'google', url, finalURL: url, status: 0, fetchedAt: now(), ms: 0, method: 'browser', live: false, phase: 'search',
            note: 'no page browser in this host: Google renders results only in a browser — open the query yourself' }, 'unreadable');
    }
    if (!askableBySearchEngine(query.text)) {
        return empty({ kind: 'rejected', provider: 'google', url, finalURL: url, status: 0, fetchedAt: now(), ms: 0, method: 'browser', live: false, phase: 'search',
            note: 'not asked: the text is a label, not a title' }, 'unreadable');
    }
    const maxSearches = options.maxSearches ?? ctx.ledger.limits.maxGoogleSearches ?? 3;
    if (ctx.ledger.searchesOf('google') >= maxSearches) {
        return empty({ kind: 'rejected', provider: 'google', url, finalURL: url, status: 0, fetchedAt: now(), ms: 0, method: 'browser', live: false, phase: 'search',
            note: `not asked: ${maxSearches} Google searches already spent on this document` }, 'unreadable');
    }
    const search = await browse(ctx, ctx.browser, url, 'search', /id="rso"|\/sorry\/|recaptcha/);
    const state = classifyResultPage(search.html, search.finalURL);
    if (search.kind !== 'record')
        return { ...empty(search, state), search: { query: query.text, url, state, hits: [] } };
    const hits = rankHits(parseGoogleResults(search.html), clues, query.text);
    const records: ExternalRecord[] = [];
    let followed = 0;
    const maxFollow = options.maxFollow ?? ctx.ledger.limits.maxFollowPerSearch ?? 2;
    for (const hit of hits) {
        if (hit.skipped || followed >= maxFollow)
            continue;
        if (ctx.cancelled?.()) {
            hit.skipped = 'stopped by the person';
            continue;
        }
        if (ctx.ledger.exhausted()) {
            hit.skipped = 'time budget spent';
            continue;
        }
        const target = (() => { try {
            return new URL(hit.href, search.finalURL || url).href;
        }
        catch {
            return hit.href;
        } })();
        followed++;
        hit.followed = true;
        const page = await browse(ctx, ctx.browser, target, 'detail', /citation_title|application\/ld\+json|og:title|ISBN13/);
        hit.detail = { kind: page.kind, finalURL: page.finalURL, status: page.status, note: page.note };
        if (page.kind === 'blocked' && /(^|\.)google\./.test(page.host || ''))
            break;
        let translated = null;
        if (page.kind === 'record' && !page.file && ctx.browser.translate && !ctx.cancelled?.()) {
            try {
                translated = await bounded(ctx.browser.translate(), ctx, 'the site’s translator');
            }
            catch (cause: any) {
                translated = { translator: '', items: [], error: String(cause?.message || cause).slice(0, 120) };
            }
        }
        let pdf = null;
        if (page.note !== PUBLIC_URL_ERROR && (page.file || page.finalURL === 'about:blank' || page.kind === 'rejected') && ctx.browser.resolve && ctx.browser.readPDF && !ctx.ledger.exhausted() && !ctx.cancelled?.()) {
            try {
                const resolved = page.file ? { finalURL: page.finalURL, contentType: 'application/pdf', status: page.status } : await ctx.browser.resolve(target);
                if (!safePublicURL(resolved.finalURL))
                    throw new Error(PUBLIC_URL_ERROR);
                if (/\.pdf(?:$|[?#])/i.test(resolved.finalURL) || /application\/pdf/i.test(resolved.contentType) || page.finalURL === 'about:blank')
                    pdf = await bounded(ctx.browser.readPDF(resolved.finalURL), ctx, 'the PDF reader');
                hit.detail.finalURL = resolved.finalURL || hit.detail.finalURL;
            }
            catch (cause: any) {
                pdf = { url: target, text: '', pages: 0, error: String(cause?.message || cause).slice(0, 120) };
            }
        }
        let site = null;
        let form: ExternalRecord['form'] | undefined;
        if (page.kind === 'record' && /(^|\.)yes24\.com$/.test(page.host || '') && /\/product\/goods\//i.test(page.finalURL)) {
            const shop = recordFromYes24Page(page.html, page.finalURL, page);
            if (shop) {
                site = { name: 'yes24', values: { ...shop.fields, title: shop.title, ISBN: shop.identifiers.ISBN[0] }, creators: shop.creators };
                form = shop.form;
            }
        }
        const collection = collectFromPage({ url: target, finalURL: page.finalURL, status: page.status, html: page.html }, { translator: translated, pdf, site });
        if (form)
            (collection as any).form = form;
        const summary = collectionSummary(collection);
        hit.detail.collection = {
            access: collection.access, accessNote: collection.accessNote,
            routes: collection.routes.map(route => `${route.route}: ${route.tried ? route.outcome : 'not tried'}`).join(' / '),
            collected: TRACKED_FIELDS.filter(field => collection.fields[field]?.status === 'collected'),
            extractionFailed: TRACKED_FIELDS.filter(field => collection.fields[field]?.status === 'extractionFailed'),
            absent: TRACKED_FIELDS.filter(field => collection.fields[field]?.status === 'absent'),
            inaccessible: summary.inaccessible, fields: collection.fields
        };
        if (pdf && page.kind !== 'record') {
            hit.detail.kind = pdf.error ? 'rejected' : 'record';
            hit.detail.note = pdf.error ? `file: ${pdf.error}` : `file read: ${pdf.pages} page(s)`;
        }
        const record = recordFromCollection(collection, clues, page, target);
        if (!record) {
            hit.detail.note = `${hit.detail.note}; nothing usable collected (${collection.access})`;
            continue;
        }
        hit.detail.recordTitle = record.title;
        hit.detail.standards = collection.routes.filter(route => route.fields.length).map(route => route.route);
        hit.detail.doi = record.identifiers.DOI;
        records.push(record);
        const lead = record.identifiers.DOI || (collection.fields.DOI?.status === 'collected' && collection.fields.DOI.route === 'pageText' ? String(collection.fields.DOI.value || '') : '');
        if (lead && options.allowCrossref !== false && !ctx.cancelled?.() && ctx.ledger.canCall('crossref').ok) {
            const official = await crossrefByDOI(lead, ctx);
            for (const found of official.records)
                records.push(found);
        }
        if (options.settled && records.some(entry => options.settled!(entry)))
            break;
    }
    const outcome: FetchOutcome = records.length ? search : { ...search, kind: 'noMatch', note: hits.length ? `${hits.length} results, none read as a record (${hits.filter(h => h.followed).length} followed)` : 'no results' };
    return { outcome, records, search: { query: query.text, url, state, hits }, assistURL };
}

import { crossrefContainerOf, crossrefDate, decodeEntities, itemTypeFromCrossref, trimMessage } from '../recognition/official-source';
import { isValidISBN, metaTags, parseWebCitation, roleFromCredit } from '../recognition/web-metadata';
import { personCreator } from '../recognition/agents';
import { isOrganisationName, isOrganisationOnly } from '../recognition/title-guards';
import { publicationStatementOf } from '../recognition/byline-row';
import { nameShape, personParts, registryPerson } from '../metadata/person-name';
import { normalizedISBN, validISSN } from '../metadata/identifier-compare';
import { titleSimilarity } from '../metadata/match';
import { classifyFetch, type FetchMethod, type FetchOutcome, type Fetcher, ProviderLedger } from './outcome';
import { journalNamesAgree, titlesAgree } from './link';
import type { PrintedCoordinates, ProviderId, SearchQuery } from './clues';
import type { SearchBrowser } from './browser';
import type { Collection } from './collect';
export type PublicationStage = 'preprint' | 'acceptedManuscript' | 'versionOfRecord' | 'unknown';
export type DatePrecision = 'year' | 'month' | 'day';
export interface RecordPerson {
    firstName?: string;
    lastName: string;
    creatorType?: string;
    fieldMode?: number;
}
export interface ExternalRecord {
    provider: ProviderId;
    url: string;
    retrievedAt: string;
    live: boolean;
    method: FetchMethod;
    itemType: string;
    title: string;
    creators: RecordPerson[];
    date?: {
        value: string;
        precision: DatePrecision;
        role: string;
        defaulted?: string;
    };
    fields: Record<string, string>;
    identifiers: {
        DOI?: string;
        ISBN: string[];
    };
    publicationStage: PublicationStage;
    relations: {
        isPreprintOf: string[];
        hasPreprint: string[];
    };
    form: 'print' | 'ebook' | 'unknown';
    pageType: string;
    collected?: Collection;
    typeStated?: boolean;
}
export interface ProviderContext {
    fetch: Fetcher;
    ledger: ProviderLedger;
    keys?: {
        aladin?: string;
        nlk?: string;
    };
    isbnLookup?: (isbn: string) => Promise<{
        outcome: string;
        json?: any;
        reason: string;
    }>;
    browser?: SearchBrowser;
    cancelled?: () => boolean;
}
export interface ProviderResult {
    outcome: FetchOutcome;
    records: ExternalRecord[];
}
const clean = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const now = () => new Date().toISOString();
const MIN_INTERVAL_MS: Partial<Record<ProviderId, number>> = { crossref: 1000, yes24: 1500, arxiv: 3000, aladin: 500, nlk: 500, hal: 500 };
const lastCallAt = new Map<string, number>();
async function spaced(provider: ProviderId): Promise<void> {
    const wait = (lastCallAt.get(provider) || 0) + (MIN_INTERVAL_MS[provider] || 0) - Date.now();
    if (wait > 0)
        await new Promise(resolve => setTimeout(resolve, wait));
    lastCallAt.set(provider, Date.now());
}
async function guarded(ctx: ProviderContext, provider: ProviderId, url: string, options: {
    method: FetchMethod;
    expect: 'json' | 'html' | 'xml' | 'any';
    accept?: string;
}): Promise<FetchOutcome & {
    body: string;
}> {
    const allowed = ctx.ledger.canCall(provider);
    if (!allowed.ok) {
        const skipped: FetchOutcome = { kind: allowed.waitMs ? 'rateLimited' : 'blocked', provider, url, finalURL: url, status: 0,
            fetchedAt: now(), ms: 0, method: options.method, live: false, retryAfterMs: allowed.waitMs, note: `not asked: ${allowed.reason}` };
        return { ...skipped, body: '' };
    }
    await spaced(provider);
    const result = await ctx.fetch(url, { provider, accept: options.accept, timeoutMs: ctx.ledger.limits.requestTimeoutMs });
    let outcome = classifyFetch(result, { provider, method: options.method, expect: options.expect });
    ctx.ledger.record(outcome);
    if ((outcome.kind === 'rateLimited' || outcome.kind === 'serverError') && ctx.ledger.mayRetry(provider)) {
        const wait = Math.min(outcome.retryAfterMs ?? 2000, ctx.ledger.remainingMs());
        if (wait < ctx.ledger.remainingMs()) {
            await new Promise(resolve => setTimeout(resolve, wait));
            await spaced(provider);
            const again = await ctx.fetch(url, { provider, accept: options.accept, timeoutMs: ctx.ledger.limits.requestTimeoutMs });
            outcome = classifyFetch(again, { provider, method: options.method, expect: options.expect });
            ctx.ledger.record(outcome);
            return { ...outcome, body: again.body };
        }
    }
    return { ...outcome, body: result.body };
}
const CROSSREF = 'https://api.crossref.org/works';
const CROSSREF_SELECT = 'DOI,type,title,author,issued,published-print,published-online,container-title,short-container-title,volume,issue,page,article-number,publisher,ISSN,ISBN,relation';
const PUBLISHED_FORMS = new Set(['journal-article', 'proceedings-article', 'book-chapter', 'book']);
export function postedContentSuffix(doi: unknown): boolean {
    const value = String(doi ?? '').trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
    const slash = value.indexOf('/');
    if (slash < 0 || !/^10\.\d{4,9}$/.test(value.slice(0, slash)))
        return false;
    const suffix = value.slice(slash + 1);
    return /^(?:19|20)\d{2}\.[01]\d\.[0-3]\d\.\d{5,}(?:v\d{1,3})?$/.test(suffix)
        || /^arxiv\.(?:\d{4}\.\d{4,5}|[a-z][a-z.-]{0,20}\/\d{7})(?:v\d{1,3})?$/.test(suffix)
        || /[./-]v\d{1,3}$/.test(suffix);
}
export function stageFromCrossref(message: any): PublicationStage {
    const type = String(message?.type || '').trim().toLowerCase();
    const subtype = String(message?.subtype || '').trim().toLowerCase();
    const related = (name: string) => (Array.isArray(message?.relation?.[name]) ? message.relation[name] : []).some((entry: any) => String(entry?.id || '').trim());
    if (type === 'posted-content' || subtype === 'preprint' || related('is-preprint-of'))
        return 'preprint';
    if (PUBLISHED_FORMS.has(type)) {
        return message?.volume || message?.page || message?.['published-print'] || message?.issue ? 'versionOfRecord' : 'unknown';
    }
    if (!type && !related('has-preprint') && postedContentSuffix(message?.DOI))
        return 'preprint';
    return 'unknown';
}
export function recordFromCrossref(message: any, url: string, outcome: FetchOutcome): ExternalRecord | null {
    const title = decodeEntities((message?.title || [])[0]);
    if (!title)
        return null;
    const date = crossrefDate(message);
    const fields: Record<string, string> = {};
    const { container, series } = crossrefContainerOf(message);
    if (container)
        fields.publicationTitle = container;
    if (series)
        fields.series = series;
    const short = decodeEntities((message['short-container-title'] || [])[0]);
    if (short && short !== container)
        fields.journalAbbreviation = short;
    if (message.volume)
        fields.volume = String(message.volume);
    if (message.issue)
        fields.issue = String(message.issue);
    if (message.page)
        fields.pages = String(message.page);
    else if (message['article-number'])
        fields.pages = String(message['article-number']);
    if (message.publisher)
        fields.publisher = decodeEntities(message.publisher);
    if (message.DOI)
        fields.DOI = String(message.DOI);
    const issn = Array.isArray(message.ISSN) ? message.ISSN[0] : message.ISSN;
    if (issn)
        fields.ISSN = String(issn);
    const isbn = (Array.isArray(message.ISBN) ? message.ISBN : []).map(normalizedISBN).filter(Boolean);
    if (isbn.length)
        fields.ISBN = isbn[0];
    if (date)
        fields.date = date.value;
    const relation = message.relation || {};
    const ids = (list: any) => (Array.isArray(list) ? list : []).map((entry: any) => String(entry?.id || '').toLowerCase()).filter(Boolean);
    return {
        provider: 'crossref', url, retrievedAt: outcome.fetchedAt, live: outcome.live, method: outcome.method,
        itemType: itemTypeFromCrossref(String(message.type || '')) || 'journalArticle',
        typeStated: !!itemTypeFromCrossref(String(message.type || '')),
        title,
        creators: (message.author || []).filter((entry: any) => entry.family || entry.name)
            .map((entry: any) => entry.family ? { ...registryPerson(clean(entry.given), clean(entry.family), clean(entry.suffix))!, creatorType: 'author' }
            : { lastName: clean(entry.name), fieldMode: 1, creatorType: 'author' }),
        date: date ? { value: date.value, precision: date.precision as DatePrecision, role: message['published-print'] ? 'published-print' : 'issued' } : undefined,
        fields,
        identifiers: { DOI: message.DOI ? String(message.DOI).toLowerCase() : undefined, ISBN: isbn },
        publicationStage: stageFromCrossref(message),
        relations: { isPreprintOf: ids(relation['is-preprint-of']), hasPreprint: ids(relation['has-preprint']) },
        form: 'unknown',
        pageType: 'registry record'
    };
}
export async function crossrefSearch(query: string, ctx: ProviderContext, rows = 5): Promise<ProviderResult> {
    const url = `${CROSSREF}?rows=${rows}&select=${CROSSREF_SELECT}&query.bibliographic=${encodeURIComponent(query.slice(0, 300))}`;
    const outcome = await guarded(ctx, 'crossref', url, { method: 'api', expect: 'json', accept: 'application/json' });
    if (outcome.kind !== 'record')
        return { outcome, records: [] };
    let items: any[] = [];
    try {
        items = JSON.parse(outcome.body)?.message?.items || [];
    }
    catch {
        return { outcome: { ...outcome, kind: 'parseError', note: 'work list did not parse' }, records: [] };
    }
    const records = items.map((item: any) => recordFromCrossref(trimRecord(item), `https://doi.org/${item?.DOI}`, outcome)).filter(Boolean) as ExternalRecord[];
    return { outcome: records.length ? outcome : { ...outcome, kind: 'noMatch', note: 'the registry returned no works for this query' }, records };
}
function trimRecord(item: any): any {
    return { ...trimMessage(item), relation: item?.relation, 'short-container-title': item?.['short-container-title'], subtype: item?.subtype };
}
export async function crossrefByDOI(doi: string, ctx: ProviderContext): Promise<ProviderResult> {
    const value = clean(doi).toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
    if (!/^10\.\d{4,9}\//.test(value)) {
        return { outcome: { kind: 'rejected', provider: 'crossref', url: value, finalURL: value, status: 0, fetchedAt: now(), ms: 0, method: 'api', live: false, note: 'not a DOI' }, records: [] };
    }
    const url = `${CROSSREF}/${encodeURIComponent(value)}`;
    const outcome = await guarded(ctx, 'crossref', url, { method: 'api', expect: 'json', accept: 'application/json' });
    if (outcome.kind !== 'record')
        return { outcome, records: [] };
    let message: any = null;
    try {
        message = JSON.parse(outcome.body)?.message;
    }
    catch {
        return { outcome: { ...outcome, kind: 'parseError', note: 'record did not parse' }, records: [] };
    }
    const record = message ? recordFromCrossref(trimRecord(message), `https://doi.org/${value}`, outcome) : null;
    return { outcome: record ? outcome : { ...outcome, kind: 'noMatch', note: 'no record for this DOI' }, records: record ? [record] : [] };
}
function recordSpan(record: ExternalRecord): {
    start: number;
    end: number;
} | null {
    const found = /^\s*(\d{1,6})(?:\s*[-‐‑‒–—―−]\s*(\d{1,6}))?\s*$/u.exec(String(record.fields.pages || ''));
    if (!found)
        return null;
    const start = Number(found[1]), end = found[2] ? Number(found[2]) : start;
    return start > 0 && end >= start ? { start, end } : null;
}
const spanText = (span: {
    start: number;
    end: number;
}) => span.end > span.start ? `${span.start}-${span.end}` : String(span.start);
const surnameLetters = (value: unknown) => String(value ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}]+/gu, '');
export function coordinateTerms(at: PrintedCoordinates): string {
    const end = at.end ?? at.start;
    const folios = end - at.start <= 7 ? Array.from({ length: end - at.start + 1 }, (_, index) => String(at.start + index)) : [String(at.start), String(end)];
    return [...(at.title && !at.runningHead ? [at.title] : []), at.volume, ...folios].join(' ').slice(0, 300);
}
export function crossrefCoordinatesURL(at: PrintedCoordinates, route: 'issn' | 'container'): string {
    const dates = `from-pub-date:${at.year}-01-01,until-pub-date:${at.year}-12-31`;
    const terms = `query.bibliographic=${encodeURIComponent(coordinateTerms(at))}`;
    return route === 'issn'
        ? `${CROSSREF}?rows=20&select=${CROSSREF_SELECT}&filter=issn:${at.ISSN},${dates}&${terms}`
        : `${CROSSREF}?rows=20&select=${CROSSREF_SELECT}&filter=${dates}&query.container-title=${encodeURIComponent(String(at.journal || '').slice(0, 120))}&${terms}`;
}
export interface CoordinatesPick {
    chosen?: {
        record: ExternalRecord;
        basis: 'article';
        evidence: string[];
    };
    refused: Array<{
        record: ExternalRecord;
        reason: string;
    }>;
    reason: string;
}
export function recordAtCoordinates(at: PrintedCoordinates, records: ExternalRecord[]): CoordinatesPick {
    const numberOf = (value: unknown) => String(Number((/^\s*(\d{1,5})/.exec(String(value ?? '')) || [])[1]) || '');
    const end = at.end ?? at.start;
    const placed = records.map(record => ({ record, span: recordSpan(record) }))
        .filter((entry): entry is {
        record: ExternalRecord;
        span: {
            start: number;
            end: number;
        };
    } => !!entry.span
        && numberOf(entry.record.fields.volume) === numberOf(at.volume)
        && String(entry.record.fields.date || '').slice(0, 4) === at.year);
    const seen = new Set<string>();
    const onPages = placed.filter(entry => entry.span.start >= at.start && entry.span.start <= end)
        .filter(entry => { const key = entry.record.identifiers.DOI || entry.record.url; if (seen.has(key))
        return false; seen.add(key); return true; });
    const where = `${at.journal || at.ISSN} ${at.volume}${at.issue ? `(${at.issue})` : ''}, ${at.end ? `${at.start}-${at.end}` : at.start}, ${at.year}`;
    const printed = `the page prints ${at.ISSN ? `ISSN ${at.ISSN}, ` : ''}${at.journal ? `${at.journal}, ` : ''}volume ${at.volume}, pages ${at.end ? `${at.start}-${at.end}` : at.start}, ${at.year}`;
    const people = at.surnames.map(surnameLetters).filter(name => name.length >= 2);
    const bylineRefuses = (record: ExternalRecord) => {
        const families = record.creators.map(person => surnameLetters(person.lastName)).filter(name => name.length >= 2);
        return !!people.length && !!families.length && !families.some(family => people.some(name => name.includes(family) || family.includes(name)));
    };
    const titled = (record: ExternalRecord) => !!at.title && (titlesAgree(at.title, record.title) || titleSimilarity(at.title, record.title) >= 0.9);
    const within = (span: {
        start: number;
    }) => !!at.extent && span.start >= at.extent.start && span.start <= at.extent.end;
    const refuse = (entries: typeof onPages, reason: string, except?: ExternalRecord): CoordinatesPick => ({
        refused: entries.filter(entry => entry.record !== except).map(entry => ({ record: entry.record, reason })), reason
    });
    if (!onPages.length)
        return { refused: [], reason: `no registry record begins on the printed pages ${where}` };
    const agreeing = onPages.filter(entry => titled(entry.record));
    if (agreeing.length > 1)
        return refuse(onPages, `${agreeing.length} records at ${where} carry the reading’s title — not settled here`);
    if (agreeing.length === 1) {
        const { record, span } = agreeing[0];
        if (bylineRefuses(record))
            return refuse(onPages, `the record at ${where} with the reading’s title names none of the surnames the reading read (${at.surnames.join(', ')})`);
        if (span.start === at.start || within(span)) {
            return { chosen: { record, basis: 'article', evidence: [printed, `one registry record at these coordinates carries the reading’s title and begins on page ${span.start}${span.start === at.start ? ', the printed first page' : ', a page this file holds'}`] },
                refused: onPages.filter(entry => entry.record !== record).map(entry => ({ record: entry.record, reason: `another record at ${where}; the reading’s title is “${record.title.slice(0, 60)}”` })),
                reason: `citation coordinates ${where} with the reading’s title` };
        }
    }
    const section = at.runningHead || onPages.length >= 2;
    if (section) {
        const why = at.runningHead ? `the reading’s title “${at.title}” runs as the head beside the folios of the following pages — the name of a section` : `${onPages.length} registry records begin on the printed pages ${at.end ? `${at.start}-${at.end}` : at.start}`;
        return refuse(onPages, `${why}; this file is the section itself, not one of its items`);
    }
    const starting = onPages.filter(entry => entry.span.start === at.start);
    if (starting.length !== 1)
        return refuse(onPages, `no record begins on the printed first page ${at.start} of ${where}`);
    const { record, span } = starting[0];
    if (at.title && !titled(record))
        return refuse(onPages, `the record at ${where} is “${record.title.slice(0, 60)}”; the reading’s title “${at.title.slice(0, 60)}” does not agree`);
    if (at.end && span.end !== span.start && span.end !== at.end)
        return refuse(onPages, `the record at ${where} runs ${spanText(span)}, the page prints ${at.start}-${at.end}`);
    if (bylineRefuses(record))
        return refuse(onPages, `the record at ${where} names none of the surnames the reading read (${at.surnames.join(', ')})`);
    return { chosen: { record, basis: 'article', evidence: [printed, `one registry record begins on the printed first page ${at.start}${at.title ? ' and carries the reading’s title' : ''}`] },
        refused: [], reason: `citation coordinates ${where}` };
}
export function withPlaceholderMonths(records: ExternalRecord[]): ExternalRecord[] {
    const byVolume = new Map<string, ExternalRecord[]>();
    for (const record of records) {
        const key = `${record.fields.publicationTitle || ''}|${record.fields.volume || ''}|${String(record.fields.date || '').slice(0, 4)}`;
        if (record.fields.volume && record.date)
            byVolume.set(key, [...(byVolume.get(key) || []), record]);
    }
    const placeholder = new Map<ExternalRecord, string>();
    for (const group of byVolume.values()) {
        const monthly = group.filter(record => record.date?.precision === 'month');
        const issues = [...new Set(monthly.map(record => String(record.fields.issue || '')).filter(Boolean))];
        const months = new Set(monthly.map(record => String(record.date!.value).slice(5, 7)));
        if (issues.length < 2 || months.size !== 1)
            continue;
        const month = [...months][0];
        for (const record of monthly)
            placeholder.set(record, `the registry states month ${month} for every issue of volume ${record.fields.volume} it answered (issues ${issues.sort((a, b) => Number(a) - Number(b)).join(', ')}) — a placeholder, not this issue’s month`);
    }
    return records.map(record => {
        const reason = placeholder.get(record);
        if (!reason || !record.date)
            return record;
        const year = String(record.date.value).slice(0, 4);
        return { ...record, date: { ...record.date, value: year, precision: 'year', defaulted: reason }, fields: { ...record.fields, date: year } };
    });
}
export interface CoordinatesAnswer extends CoordinatesPick {
    outcome: FetchOutcome;
    records: ExternalRecord[];
    queries: string[];
}
export async function crossrefByCoordinates(at: PrintedCoordinates, ctx: ProviderContext): Promise<CoordinatesAnswer> {
    const routes: Array<'issn' | 'container'> = [...(at.ISSN ? ['issn' as const] : []), ...(at.journal ? ['container' as const] : [])];
    const queries: string[] = [];
    let last: FetchOutcome | null = null;
    let records: ExternalRecord[] = [];
    let pick: CoordinatesPick = { refused: [], reason: 'the page prints no ISSN and no journal name to ask by' };
    for (const route of routes) {
        if (ctx.cancelled?.())
            break;
        const url = crossrefCoordinatesURL(at, route);
        queries.push(url);
        const outcome = await guarded(ctx, 'crossref', url, { method: 'api', expect: 'json', accept: 'application/json' });
        last = outcome;
        if (outcome.kind !== 'record')
            continue;
        let items: any[] = [];
        try {
            items = JSON.parse(outcome.body)?.message?.items || [];
        }
        catch {
            last = { ...outcome, kind: 'parseError', note: 'work list did not parse' };
            continue;
        }
        const ofTheJournal = items.filter((item: any) => route === 'issn'
            ? (Array.isArray(item?.ISSN) ? item.ISSN : [item?.ISSN]).map(validISSN).includes(String(at.ISSN))
            : journalNamesAgree(at.journal, decodeEntities((item?.['container-title'] || [])[0]), decodeEntities((item?.['short-container-title'] || [])[0])));
        records = withPlaceholderMonths(ofTheJournal.map((item: any) => recordFromCrossref(trimRecord(item), `https://doi.org/${item?.DOI}`, outcome)).filter(Boolean) as ExternalRecord[]);
        pick = recordAtCoordinates(at, records);
        if (pick.chosen || pick.refused.length)
            break;
    }
    const outcome: FetchOutcome = last || { kind: 'rejected', provider: 'crossref', url: '', finalURL: '', status: 0, fetchedAt: now(), ms: 0, method: 'api', live: false, note: pick.reason };
    return { ...pick, outcome: pick.chosen || pick.refused.length || outcome.kind !== 'record' ? outcome : { ...outcome, kind: 'noMatch', note: pick.reason }, records, queries };
}
const YES24 = 'https://www.yes24.com';
const SHOP_NOISE = /\s*[\[(](?:예약판매|예약|세트|리커버|한정판|특별판|사은품|무료배송|당일배송|초판\s*한정|\d+\s*권\s*세트)[^\])]*[\])]\s*/g;
export function stripShopWording(title: unknown): string {
    return clean(title).replace(SHOP_NOISE, ' ').replace(/\s*-\s*예스24\s*$/, '').replace(/\s+/g, ' ').trim();
}
function specCell(html: string, label: string): string {
    const match = html.match(new RegExp(`<th[^>]*>\\s*${label}\\s*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`, 'i'));
    return match ? clean(match[1].replace(/<[^>]+>/g, ' ')) : '';
}
function koreanDate(value: string): {
    value: string;
    precision: DatePrecision;
} | undefined {
    const match = clean(value).match(/((?:19|20)\d{2})\s*년(?:\s*(\d{1,2})\s*월(?:\s*(\d{1,2})\s*일)?)?/);
    if (!match)
        return undefined;
    const [, year, month, day] = match;
    if (day)
        return { value: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`, precision: 'day' };
    if (month)
        return { value: `${year}-${month.padStart(2, '0')}`, precision: 'month' };
    return { value: year, precision: 'year' };
}
const LATIN_BODY_WORD = /\b(?:Press|Publish(?:ing|ers?)|Books?|Review|Magazine|Journal|Media|Group|Team|Staff|Editors|Editorial|Board|Company|Inc|Ltd|Corp|Bank|Office|Department|Center|Centre|Studio|Lab(?:s|oratory)?|Institute|University|College|School|Society|Association|Council|Committee|Foundation|Agency|Ministry|Organi[sz]ation|OECD|UNESCO|WHO)\b/i;
export function personFromCreditName(raw: string, creatorType: string): RecordPerson | null {
    let name = clean(raw);
    if (/[가-힣]/.test(name))
        name = name.replace(/\s*[(（][^)）]*[A-Za-z\p{Script=Han}][^)）]*[)）]\s*$/u, '').trim();
    if (!name || /^https?:/.test(name))
        return null;
    if (publicationStatementOf(name))
        return null;
    const body = /(?:편집부|편집실|편집팀|출판부|위원회|연구회|학회|협회)$/.test(name);
    if (body || isOrganisationName(name) || isOrganisationOnly(name))
        return { lastName: name, fieldMode: 1, creatorType };
    if (/^[가-힣]+(?: (?:[가-힣]+|[A-Z]\.))* [가-힣]+$/.test(name)) {
        const parts = personParts(name);
        if (parts && parts.fieldMode === 0)
            return { lastName: parts.lastName, firstName: parts.firstName, creatorType };
    }
    const latinPerson = (/^[A-Z][\p{L}'’-]*\.?(?: [A-Z][\p{L}'’-]*\.?){1,3}$/u.test(name)
        || (/^[\p{Script=Latin}\s.'’-]+$/u.test(name) && nameShape(name).person !== 'no' && nameShape(name).kind === 'western')) && !LATIN_BODY_WORD.test(name);
    const split = /^[가-힣]{2,5}$/.test(name) || latinPerson ? personCreator(name, creatorType) : null;
    if (!split)
        return { lastName: name, fieldMode: 1, creatorType };
    return { lastName: split.lastName, ...(split.firstName ? { firstName: split.firstName } : {}), ...(split.fieldMode ? { fieldMode: 1 } : {}), creatorType };
}
export function peopleFromCredits(html: string): RecordPerson[] {
    const area = html.match(/gd_pubArea[\s\S]{0,2500}?<\/div>/i)?.[0] || '';
    const people: RecordPerson[] = [];
    for (const match of area.matchAll(/<span class="gd_auth"[^>]*>([\s\S]*?)<\/span>/gi)) {
        const text = clean(match[1].replace(/<[^>]+>/g, ' '));
        const role = roleFromCredit(text.split(',').pop() || text).creatorType || 'author';
        for (const part of text.replace(/\s*(?:저|역|그림|편|글|옮김|지음|엮음)\s*$/, '').split(/\s*,\s*/)) {
            const person = personFromCreditName(part, role);
            if (person)
                people.push(person);
        }
    }
    return people;
}
export function recordFromYes24Page(html: string, url: string, outcome: FetchOutcome): ExternalRecord | null {
    const parsed = parseWebCitation(html, url);
    const tags = metaTags(html);
    const og = tags.get('og:title')?.[0] || '';
    const ld = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/i)?.[1];
    let name = '';
    try {
        name = clean(JSON.parse(ld || 'null')?.name);
    }
    catch {
        name = '';
    }
    const title = stripShopWording(name || og.split('|')[0] || parsed?.fields.title || '');
    if (!title)
        return null;
    const isbn13 = normalizedISBN(specCell(html, 'ISBN13'));
    const isbn10 = specCell(html, 'ISBN10');
    const isbns = isbn13 ? [isbn13] : [isValidISBN(isbn10) ? normalizedISBN(isbn10) : ''].filter(Boolean);
    const published = koreanDate(specCell(html, '발행일'));
    const size = specCell(html, '쪽수, 무게, 크기') || specCell(html, '쪽수');
    const pages = size.match(/(\d{1,5})\s*쪽/)?.[1];
    const publisher = clean((html.match(/gd_pub"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i) || [])[1]) || clean(og.split('|').pop()?.replace(/-\s*예스24\s*$/, ''));
    const ebook = /전자책|eBook/i.test(og) || /\/product\/goods\/\d+.*ebook/i.test(url) || /<meta property="og:type" content="book"[^>]*>[\s\S]{0,400}eBook/i.test(html) && /eBook/.test(og);
    const fields: Record<string, string> = { url };
    if (isbns[0])
        fields.ISBN = isbns[0];
    if (published)
        fields.date = published.value;
    if (pages)
        fields.numPages = pages;
    if (publisher)
        fields.publisher = publisher;
    return {
        provider: 'yes24', url, retrievedAt: outcome.fetchedAt, live: outcome.live, method: outcome.method,
        itemType: 'book', title, creators: peopleFromCredits(html),
        date: published ? { ...published, role: '발행일' } : undefined,
        fields, identifiers: { ISBN: isbns }, publicationStage: 'versionOfRecord',
        relations: { isPreprintOf: [], hasPreprint: [] }, form: ebook ? 'ebook' : 'print', pageType: 'bookshop product page'
    };
}
export async function yes24Search(query: string, ctx: ProviderContext): Promise<ProviderResult> {
    const url = `${YES24}/Product/Search?domain=BOOK&query=${encodeURIComponent(query.slice(0, 120))}`;
    const outcome = await guarded(ctx, 'yes24', url, { method: 'html', expect: 'html' });
    if (outcome.kind !== 'record')
        return { outcome, records: [] };
    const list = outcome.body.match(/id="yesSchList"[\s\S]*$/i)?.[0] || outcome.body;
    const goods = [...new Set([...list.matchAll(/data-goods-no="(\d+)"/g)].map(match => match[1]))].slice(0, 2);
    if (!goods.length)
        return { outcome: { ...outcome, kind: 'noMatch', note: 'the shop listed nothing for this query' }, records: [] };
    const records: ExternalRecord[] = [];
    for (const id of goods) {
        const page = await guarded(ctx, 'yes24', `${YES24}/product/goods/${id}`, { method: 'html', expect: 'html' });
        if (page.kind !== 'record')
            continue;
        const record = recordFromYes24Page(page.body, `${YES24}/product/goods/${id}`, page);
        if (record)
            records.push(record);
    }
    return { outcome: records.length ? outcome : { ...outcome, kind: 'noMatch', note: 'no product page could be read' }, records };
}
export async function zoteroISBN(isbn: string, ctx: ProviderContext): Promise<ProviderResult> {
    const base = { provider: 'zoteroISBN' as ProviderId, url: `isbn:${isbn}`, finalURL: `isbn:${isbn}`, status: 0, fetchedAt: now(), method: 'translator' as FetchMethod, live: true };
    const allowed = ctx.ledger.canCall('zoteroISBN');
    if (!allowed.ok)
        return { outcome: { ...base, kind: 'blocked', ms: 0, note: `not asked: ${allowed.reason}` }, records: [] };
    if (!ctx.isbnLookup) {
        const outcome: FetchOutcome = { ...base, kind: 'rejected', ms: 0, note: 'no translator host in this process (unimplemented here)' };
        ctx.ledger.record(outcome);
        return { outcome, records: [] };
    }
    const started = Date.now();
    const answer = await ctx.isbnLookup(isbn);
    const kind = answer.outcome === 'record' ? 'record' : answer.outcome === 'noMatch' ? 'noMatch' : /timed out|끝나지 않았습니다/.test(answer.reason) ? 'timeout' : 'serverError';
    const outcome: FetchOutcome = { ...base, kind, ms: Date.now() - started, note: answer.reason };
    ctx.ledger.record(outcome);
    if (kind !== 'record' || !answer.json)
        return { outcome, records: [] };
    const json = answer.json;
    const fields: Record<string, string> = {};
    for (const field of ['publisher', 'place', 'numPages', 'edition', 'series', 'seriesNumber', 'language', 'url']) {
        if (json[field])
            fields[field] = clean(json[field]);
    }
    const isbns = clean(json.ISBN).split(/\s+/).map(normalizedISBN).filter(Boolean);
    if (isbns[0])
        fields.ISBN = isbns[0];
    const date = clean(json.date);
    const parsed = date.match(/^((?:1[5-9]|20)\d{2})(?:-(\d{2})(?:-(\d{2}))?)?/);
    if (parsed)
        fields.date = parsed[0];
    return { outcome, records: [{
                provider: 'zoteroISBN', url: `isbn:${isbn}`, retrievedAt: outcome.fetchedAt, live: true, method: 'translator',
                itemType: String(json.itemType || 'book'), title: clean(json.title),
                creators: (json.creators || []).map((creator: any) => creator.fieldMode === 1 || !creator.firstName
                    ? { lastName: clean(creator.lastName || creator.name), fieldMode: 1, creatorType: creator.creatorType || 'author' }
                    : { firstName: clean(creator.firstName), lastName: clean(creator.lastName), creatorType: creator.creatorType || 'author' }),
                date: parsed ? { value: parsed[0], precision: parsed[3] ? 'day' : parsed[2] ? 'month' : 'year', role: 'date' } : undefined,
                fields, identifiers: { ISBN: isbns }, publicationStage: 'versionOfRecord',
                relations: { isPreprintOf: [], hasPreprint: [] }, form: 'unknown', pageType: `library record (${json.libraryCatalog || 'translator'})`
            }] };
}
export function recordsFromArxivFeed(xml: string, outcome: FetchOutcome): ExternalRecord[] {
    const records: ExternalRecord[] = [];
    for (const match of String(xml || '').matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
        const entry = match[1];
        const pick = (tag: string) => clean((entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1]);
        const id = pick('id');
        const title = pick('title');
        if (!id || !title)
            continue;
        const authors = [...entry.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)].map(m => clean(m[1]));
        const doi = pick('arxiv:doi').toLowerCase();
        const journalRef = pick('arxiv:journal_ref');
        const published = pick('published').slice(0, 10);
        const arxivId = id.replace(/^https?:\/\/arxiv\.org\/abs\//, '');
        const fields: Record<string, string> = { url: id, archiveID: `arXiv:${arxivId}` };
        if (published)
            fields.date = published;
        if (journalRef)
            fields.extra = `journal_ref: ${journalRef}`;
        records.push({
            provider: 'arxiv', url: id, retrievedAt: outcome.fetchedAt, live: outcome.live, method: outcome.method,
            itemType: 'preprint', title,
            creators: authors.map(name => { const parts = personParts(name); return parts && parts.fieldMode === 0 ? { firstName: parts.firstName, lastName: parts.lastName, creatorType: 'author' } : { lastName: name, fieldMode: 1, creatorType: 'author' }; }),
            date: published ? { value: published, precision: 'day', role: 'published' } : undefined,
            fields, identifiers: { DOI: doi || undefined, ISBN: [] }, publicationStage: 'preprint',
            relations: { isPreprintOf: doi ? [doi] : [], hasPreprint: [] }, form: 'unknown', pageType: 'preprint server record'
        });
    }
    return records;
}
export async function arxivSearch(query: string, ctx: ProviderContext): Promise<ProviderResult> {
    const url = `https://export.arxiv.org/api/query?max_results=3&search_query=${encodeURIComponent(`all:${query.slice(0, 200)}`)}`;
    const outcome = await guarded(ctx, 'arxiv', url, { method: 'api', expect: 'xml' });
    if (outcome.kind !== 'record')
        return { outcome, records: [] };
    const records = recordsFromArxivFeed(outcome.body, outcome);
    return { outcome: records.length ? outcome : { ...outcome, kind: 'noMatch', note: 'the feed listed no entries' }, records };
}
const HAL_SEARCH = 'https://api.archives-ouvertes.fr/search/';
const HAL_FIELDS = 'halId_s,uri_s,title_s,authFirstName_s,authLastName_s,authFullName_s,language_s,docType_s,defenseDate_s,producedDate_s,doiId_s,authorityInstitution_s';
const HAL_TYPES: Record<string, string> = { THESE: 'thesis', HDR: 'thesis', ART: 'journalArticle', COMM: 'conferencePaper', OUV: 'book', COUV: 'bookSection', REPORT: 'report', UNDEFINED: 'preprint' };
export function recordFromHAL(doc: any, outcome: FetchOutcome): ExternalRecord | null {
    const title = clean((Array.isArray(doc?.title_s) ? doc.title_s : [doc?.title_s])[0]);
    const url = clean(doc?.uri_s);
    if (!title || !url)
        return null;
    const firsts = Array.isArray(doc.authFirstName_s) ? doc.authFirstName_s : [];
    const lasts = Array.isArray(doc.authLastName_s) ? doc.authLastName_s : [];
    const creators: RecordPerson[] = lasts.map((last: unknown, at: number) => ({ lastName: clean(last), ...(clean(firsts[at]) ? { firstName: clean(firsts[at]) } : { fieldMode: 1 }), creatorType: 'author' }))
        .filter((person: RecordPerson) => !!person.lastName);
    const dated = clean(doc.defenseDate_s || doc.producedDate_s);
    const date = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(dated) ? { value: dated, precision: (dated.length === 10 ? 'day' : dated.length === 7 ? 'month' : 'year') as DatePrecision, role: doc.defenseDate_s ? 'defended' : 'produced' } : undefined;
    const fields: Record<string, string> = { url };
    const language = clean((Array.isArray(doc.language_s) ? doc.language_s : [doc.language_s])[0]).toLowerCase();
    if (/^[a-z]{2}$/.test(language))
        fields.language = language;
    if (date)
        fields.date = date.value;
    const institution = clean((Array.isArray(doc.authorityInstitution_s) ? doc.authorityInstitution_s : [doc.authorityInstitution_s])[0]);
    const itemType = HAL_TYPES[clean(doc.docType_s).toUpperCase()] || 'document';
    if (institution && itemType === 'thesis')
        fields.university = institution;
    const doi = clean(doc.doiId_s).toLowerCase();
    if (doi)
        fields.DOI = doi;
    if (clean(doc.halId_s))
        fields.archiveID = `HAL: ${clean(doc.halId_s)}`;
    return {
        provider: 'hal', url, retrievedAt: outcome.fetchedAt, live: outcome.live, method: outcome.method,
        itemType, title, creators, date, fields,
        identifiers: { DOI: doi || undefined, ISBN: [] }, publicationStage: 'versionOfRecord',
        relations: { isPreprintOf: [], hasPreprint: [] }, form: 'unknown', pageType: 'open archive record (HAL)'
    };
}
export async function halSearch(query: SearchQuery, ctx: ProviderContext): Promise<ProviderResult> {
    const doi = query.kind === 'doi' ? clean(query.text).toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '') : '';
    const words = clean(query.text).replace(/[^\p{L}\p{N}\s'’-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    const q = doi ? `doiId_s:"${doi.replace(/"/g, '')}"` : `title_t:(${words})`;
    if (!doi && !words)
        return { outcome: { kind: 'rejected', provider: 'hal', url: '', finalURL: '', status: 0, fetchedAt: now(), ms: 0, method: 'api', live: false, note: 'nothing to ask' }, records: [] };
    const url = `${HAL_SEARCH}?q=${encodeURIComponent(q)}&fl=${HAL_FIELDS}&rows=3&wt=json`;
    const outcome = await guarded(ctx, 'hal', url, { method: 'api', expect: 'json', accept: 'application/json' });
    if (outcome.kind !== 'record')
        return { outcome, records: [] };
    let docs: any[] = [];
    try {
        docs = JSON.parse(outcome.body)?.response?.docs || [];
    }
    catch {
        return { outcome: { ...outcome, kind: 'parseError', note: 'search answer did not parse' }, records: [] };
    }
    const records = docs.map(doc => recordFromHAL(doc, outcome)).filter(Boolean) as ExternalRecord[];
    return { outcome: records.length ? outcome : { ...outcome, kind: 'noMatch', note: 'the archive returned no deposit for this query' }, records };
}
function keyless(provider: ProviderId, url: string): ProviderResult {
    return { outcome: { kind: 'rejected', provider, url, finalURL: url, status: 0, fetchedAt: now(), ms: 0, method: 'api', live: false,
            note: 'not configured: no API key (extensions.zotero.pdfMetadataRefresh.' + (provider === 'aladin' ? 'aladinTTBKey' : 'nlkCertKey') + ')' }, records: [] };
}
export async function aladinLookup(isbn: string, ctx: ProviderContext): Promise<ProviderResult> {
    const key = ctx.keys?.aladin;
    const url = `https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx?ttbkey=${encodeURIComponent(key || '')}&itemIdType=ISBN13&ItemId=${encodeURIComponent(isbn)}&output=js&Version=20131101&OptResult=packing`;
    if (!key) {
        const answer = keyless('aladin', url);
        ctx.ledger.record(answer.outcome);
        return answer;
    }
    const outcome = await guarded(ctx, 'aladin', url, { method: 'api', expect: 'json' });
    if (outcome.kind !== 'record')
        return { outcome, records: [] };
    let json: any;
    try {
        json = JSON.parse(outcome.body);
    }
    catch {
        return { outcome: { ...outcome, kind: 'parseError', note: 'did not parse' }, records: [] };
    }
    if (json?.errorCode)
        return { outcome: { ...outcome, kind: json.errorCode === 1 ? 'authRequired' : 'rejected', note: clean(json.errorMessage) }, records: [] };
    const item = json?.item?.[0];
    if (!item)
        return { outcome: { ...outcome, kind: 'noMatch', note: 'no item for this ISBN' }, records: [] };
    const fields: Record<string, string> = { url: clean(item.link) };
    if (item.publisher)
        fields.publisher = clean(item.publisher);
    if (item.pubDate)
        fields.date = clean(item.pubDate);
    if (item.isbn13)
        fields.ISBN = normalizedISBN(item.isbn13);
    const pages = item.subInfo?.itemPage || item.subInfo?.packing?.sizeDepth;
    if (item.subInfo?.itemPage)
        fields.numPages = String(item.subInfo.itemPage);
    void pages;
    return { outcome, records: [{
                provider: 'aladin', url: clean(item.link), retrievedAt: outcome.fetchedAt, live: outcome.live, method: 'api',
                itemType: 'book', title: stripShopWording(item.title), creators: clean(item.author).split(/\s*,\s*/).filter(Boolean)
                    .map(part => { const credit = roleFromCredit(part.replace(/\s*\((?:지은이|옮긴이|엮은이)\)\s*$/, match => match.includes('옮긴이') ? ' 역' : match.includes('엮은이') ? ' 편' : ' 저')); return personFromCreditName(credit.name, credit.creatorType || 'author'); })
                    .filter((person): person is RecordPerson => !!person),
                date: item.pubDate ? { value: clean(item.pubDate), precision: 'day', role: 'pubDate' } : undefined,
                fields, identifiers: { ISBN: [normalizedISBN(item.isbn13)].filter(Boolean) }, publicationStage: 'versionOfRecord',
                relations: { isPreprintOf: [], hasPreprint: [] }, form: /ebook/i.test(String(item.mallType)) ? 'ebook' : 'print', pageType: 'bookshop API item'
            }] };
}
export async function nlkLookup(isbn: string, ctx: ProviderContext): Promise<ProviderResult> {
    const key = ctx.keys?.nlk;
    const url = `https://www.nl.go.kr/seoji/SearchApi.do?cert_key=${encodeURIComponent(key || '')}&result_style=json&page_no=1&page_size=2&isbn=${encodeURIComponent(isbn)}`;
    if (!key) {
        const answer = keyless('nlk', url);
        ctx.ledger.record(answer.outcome);
        return answer;
    }
    const outcome = await guarded(ctx, 'nlk', url, { method: 'api', expect: 'json' });
    if (outcome.kind !== 'record')
        return { outcome, records: [] };
    let json: any;
    try {
        json = JSON.parse(outcome.body);
    }
    catch {
        return { outcome: { ...outcome, kind: 'parseError', note: 'did not parse' }, records: [] };
    }
    if (json?.RESULT === 'ERROR')
        return { outcome: { ...outcome, kind: /인증키/.test(String(json.ERR_MESSAGE)) ? 'authRequired' : 'rejected', note: clean(json.ERR_MESSAGE) }, records: [] };
    const doc = json?.docs?.[0];
    if (!doc)
        return { outcome: { ...outcome, kind: 'noMatch', note: 'no document for this ISBN' }, records: [] };
    const date = clean(doc.PUBLISH_PREDATE || doc.REAL_PUBLISH_DATE).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
    const fields: Record<string, string> = {};
    if (doc.PUBLISHER)
        fields.publisher = clean(doc.PUBLISHER);
    if (date)
        fields.date = date;
    if (doc.EA_ISBN)
        fields.ISBN = normalizedISBN(doc.EA_ISBN);
    if (doc.PAGE)
        fields.numPages = clean(doc.PAGE).replace(/\D.*$/, '');
    return { outcome, records: [{
                provider: 'nlk', url: `https://www.nl.go.kr/seoji/contents/S80100000000.do?schType=simple&schStr=${isbn}`, retrievedAt: outcome.fetchedAt, live: outcome.live, method: 'api',
                itemType: 'book', title: clean(doc.TITLE), creators: clean(doc.AUTHOR).split(/\s*[;,]\s*/).filter(Boolean)
                    .map(part => { const credit = roleFromCredit(part); return personFromCreditName(credit.name, credit.creatorType || 'author'); })
                    .filter((person): person is RecordPerson => !!person),
                date: date ? { value: date, precision: date.length === 10 ? 'day' : date.length === 7 ? 'month' : 'year', role: 'PUBLISH_PREDATE' } : undefined,
                fields, identifiers: { ISBN: [normalizedISBN(doc.EA_ISBN)].filter(Boolean) }, publicationStage: 'versionOfRecord',
                relations: { isPreprintOf: [], hasPreprint: [] }, form: /전자/.test(String(doc.EBOOK_YN)) || doc.EBOOK_YN === 'Y' ? 'ebook' : 'print', pageType: 'national ISBN record'
            }] };
}

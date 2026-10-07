import { doiFromURL, isValidISBN, metaTags, parseWebCitation, personFromDisplayName, splitCreditLine } from '../recognition/web-metadata';
import { normalizedISBN } from '../metadata/identifier-compare';
import { scanIdentifiers } from '../recognition/pdf-identifiers';
import { buildCandidate } from '../recognition/candidate';
import { citationLineOf } from './clues';
import { withoutGenreTag } from '../recognition/title-guards';
import { KOREAN_TRANSLATOR_LABEL, withKoreanTranslatorLayout } from '../metadata/korean-fields';
import { looksLikeChallenge, looksLikeLoginWall } from './outcome';
import type { RecordPerson } from './records';
import { BYLINE_MEANINGS, bylineRoleOf, labelWordOf, roleWordAt, type Meaning } from '../recognition/label-words';
import { publicationStatementOf } from '../recognition/byline-row';
const CREDIT_TAIL_MEANINGS: ReadonlySet<Meaning> = new Set<Meaning>([...BYLINE_MEANINGS, 'others']);
export type Access = 'detail' | 'login' | 'blocked' | 'error' | 'file' | 'empty';
export type FieldStatus = 'collected' | 'absent' | 'extractionFailed' | 'inaccessible';
export type RouteName = 'structured' | 'translator' | 'pageText' | 'pdf';
export const TRACKED_FIELDS = ['title', 'creators', 'date', 'publisher', 'publicationTitle', 'volume', 'issue', 'pages', 'DOI', 'ISBN', 'numPages', 'edition', 'institution', 'university', 'language', 'url'] as const;
export type TrackedField = typeof TRACKED_FIELDS[number];
export interface CollectedValue {
    value: any;
    source: string;
    locator?: string;
    route: RouteName;
    raw?: string;
    precision?: DatePrecision;
    defaulted?: string;
}
export interface FieldReport {
    status: FieldStatus;
    value?: any;
    source?: string;
    locator?: string;
    route?: RouteName;
    alternatives?: CollectedValue[];
    reason?: string;
    raw?: string;
    precision?: DatePrecision;
    defaulted?: string;
}
export interface RouteReport {
    route: RouteName;
    tried: boolean;
    outcome: string;
    fields: string[];
}
export interface Collection {
    url: string;
    finalURL: string;
    access: Access;
    accessNote: string;
    itemType?: string;
    routes: RouteReport[];
    fields: Record<string, FieldReport>;
    labelsSeen: string[];
    textExcerpt: string;
}
export interface PageInput {
    url: string;
    finalURL: string;
    status: number;
    html: string;
    error?: string;
    timedOut?: boolean;
}
export interface TranslatorInput {
    translator: string;
    items: any[];
    error?: string;
}
export interface PdfInput {
    url: string;
    text: string;
    pages: number;
    error?: string;
}
export interface SiteReaderInput {
    name: string;
    values: Record<string, any>;
    creators?: RecordPerson[];
}
const clean = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const decode = (value: string) => value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, '\'').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
export function looksLikeBrowserError(html: string, finalURL = ''): boolean {
    if (/^about:(?:neterror|certerror|blocked|tabcrashed)/i.test(finalURL))
        return true;
    const head = String(html || '').slice(0, 20000);
    return /aboutNetError|about:neterror|about:certerror|id="errorPageContainer"|id="errorShortDesc|netErrorButtonContainer|certErrorAndCaptivePortalButtonContainer/i.test(head)
        || /<title>\s*(?:Warning: Potential Security Risk Ahead|Problem loading page|Server Not Found|Unable to connect|Secure Connection Failed|Hmm\. We’re having trouble finding that site\.)\s*<\/title>/i.test(head);
}
export function classifyAccess(page: PageInput): {
    access: Access;
    note: string;
} {
    if (page.timedOut)
        return { access: 'error', note: `timed out${page.error ? ` (${page.error})` : ''}` };
    if (looksLikeBrowserError(page.html, page.finalURL))
        return { access: 'error', note: `the browser showed its own error page${page.error ? ` (${page.error})` : ''}` };
    if (page.finalURL === 'about:blank' || (!page.html && !page.status))
        return { access: 'file', note: page.error || 'the link opened a download or nothing rendered' };
    if (page.status === 401 || page.status === 407)
        return { access: 'login', note: `HTTP ${page.status}` };
    if (page.status === 403)
        return { access: looksLikeLoginWall(page.html) ? 'login' : 'blocked', note: `HTTP 403${looksLikeChallenge(page.html) ? ' with a bot check' : ''}` };
    if (page.status === 429)
        return { access: 'blocked', note: 'HTTP 429' };
    if (page.status >= 400 || (page.status >= 300 && page.status < 400))
        return { access: 'error', note: `HTTP ${page.status}` };
    if (looksLikeChallenge(page.html))
        return { access: 'blocked', note: 'HTTP 200 carrying a bot check' };
    if (looksLikeLoginWall(page.html))
        return { access: 'login', note: 'HTTP 200 carrying a login page' };
    const text = visibleText(page.html);
    if (text.length < 80)
        return { access: 'empty', note: `nothing rendered but "${text.slice(0, 40)}"` };
    return { access: 'detail', note: `HTTP ${page.status || 200}` };
}
export function visibleText(html: string): string {
    return decode(String(html || '')
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<(?:br|p|div|li|tr|td|th|h[1-6]|dt|dd|section|article)\b[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' '))
        .replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}
const META_FOR: Record<string, string[]> = {
    title: ['citation_title', 'dc.title', 'dcterms.title', 'og:title', 'twitter:title'],
    publicationTitle: ['citation_journal_title', 'citation_journal_abbrev', 'dc.source', 'prism.publicationname'],
    volume: ['citation_volume', 'prism.volume'], issue: ['citation_issue', 'prism.number'],
    pages: ['citation_firstpage', 'prism.startingpage'],
    date: ['citation_publication_date', 'citation_date', 'citation_online_date', 'citation_cover_date', 'dc.date', 'dcterms.date', 'dcterms.issued', 'article:published_time', 'prism.publicationdate'],
    DOI: ['citation_doi', 'dc.identifier', 'prism.doi'], ISBN: ['citation_isbn', 'dc.identifier', 'og:isbn', 'book:isbn', 'books:isbn'],
    publisher: ['citation_publisher', 'dc.publisher', 'dcterms.publisher'], institution: ['citation_technical_report_institution'],
    university: ['citation_dissertation_institution'], language: ['citation_language', 'dc.language', 'dcterms.language', 'og:locale'],
    url: ['citation_abstract_html_url', 'citation_public_url', 'citation_fulltext_html_url', 'og:url'],
    creators: ['citation_author', 'citation_authors', 'dc.creator', 'dcterms.creator', 'author', 'book:author']
};
function attribute(field: string, value: string, tags: Map<string, string[]>, ldText: string, pageTitle: string): {
    source: string;
    locator?: string;
} {
    const wanted = clean(value).toLowerCase();
    for (const name of META_FOR[field] || []) {
        for (const candidate of tags.get(name) || []) {
            const held = clean(candidate).toLowerCase();
            if (held === wanted || (held.length > 6 && (held.includes(wanted) || wanted.includes(held))))
                return { source: `meta:${name}`, locator: `<meta ${name}>` };
        }
    }
    if (ldText && ldText.toLowerCase().includes(wanted.slice(0, 60)))
        return { source: 'json-ld', locator: 'script[type=application/ld+json]' };
    if (pageTitle && pageTitle.toLowerCase().includes(wanted.slice(0, 60)))
        return { source: 'page title', locator: '<title>' };
    return { source: 'page markup' };
}
export function structuredRoute(html: string, url: string): {
    values: Record<string, CollectedValue>;
    itemType?: string;
    outcome: string;
} {
    const values: Record<string, CollectedValue> = {};
    const parsed = parseWebCitation(html, url);
    if (!parsed)
        return { values, outcome: 'no structured data and no usable page title' };
    const tags = metaTags(html);
    const ldText = [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map(match => decode(match[1])).join('\n');
    const pageTitle = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
    const standards = [...new Set(parsed.standards || [parsed.standard])];
    for (const [field, raw] of Object.entries(parsed.fields)) {
        if (!raw || !(TRACKED_FIELDS as readonly string[]).includes(field))
            continue;
        const dated = field === 'date' ? readStatedDate(raw) : null;
        const value = field === 'date' ? dated?.value || clean(raw) : field === 'DOI' ? clean(raw).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase() : field === 'ISBN' ? normalizedISBN(raw) : clean(raw);
        if (!value)
            continue;
        if (['volume', 'issue', 'pages', 'numPages'].includes(field) && !/\d/.test(value))
            continue;
        values[field] = { value, route: 'structured', ...attribute(field, clean(raw), tags, ldText, pageTitle), ...(dated ? { raw: dated.raw, precision: dated.precision, ...(dated.defaulted ? { defaulted: dated.defaulted } : {}) } : {}) };
    }
    if (parsed.creators.length) {
        const people: RecordPerson[] = parsed.creators.map(person => ({ lastName: person.lastName, firstName: person.firstName, creatorType: person.creatorType }));
        const where = tags.has('citation_author') ? { source: 'meta:citation_author', locator: '<meta citation_author>' }
            : tags.has('dc.creator') ? { source: 'meta:dc.creator', locator: '<meta dc.creator>' } : ldText ? { source: 'json-ld', locator: 'author' } : { source: 'page markup' };
        values.creators = { value: people, route: 'structured', ...where };
    }
    const doi = values.DOI?.value || doiFromURL(url);
    if (doi && !values.DOI)
        values.DOI = { value: String(doi).toLowerCase(), route: 'structured', source: 'address', locator: url };
    return { values, itemType: parsed.itemType || undefined, outcome: `${standards.join('+')}: ${Object.keys(values).length} field(s)` };
}
const LABELS: Array<{
    field: TrackedField;
    re: RegExp;
}> = [
    { field: 'ISBN', re: /\bISBN(?:-?1[03])?\b[^\n\d]{0,12}\d|\bISBN(?:-?1[03])?\s*\n\s*\d/i },
    { field: 'date', re: /발행일|출간일|출판일|발행년|발행연도|발행년도|출판연도|발행사항|발행\s*[:：]|출판\s*[:：]|Published(?:\s+online)?\s*[:：]|Publication\s+date|Date\s+published|Published\s+\d|Year\s*[:：]/i },
    { field: 'numPages', re: /쪽수|페이지\s*수|면수|형태사항|\d{2,5}\s*쪽\b|\d{2,5}\s*pages\b|Number of pages\s*[:：]?\s*\d|Page count\s*[:：]?\s*\d/i },
    { field: 'publisher', re: /출판사|발행처|발행자|발행사항|Publisher\s*[:：]|Published by/i },
    { field: 'creators', re: /(?:^|\n)\s*(?:저자|개인저자|저자정보|저자명)\s*(?:[:：]|\n)|지은이|엮은이|옮긴이|Authors?\s*[:：]|Editors?\s*[:：]/ },
    { field: 'edition', re: /\b\d+(?:st|nd|rd|th)\s+ed(?:ition|\.)|\b(?:Second|Third|Fourth|Fifth|Revised)\s+Edition|(?:제\s*)?\d{1,2}\s*판(?![결례매권정형])|개정판|증보판/i },
    { field: 'DOI', re: /\bDOI\b[^\n]{0,40}10\.\d{4}|doi\.org\/10\./i },
    { field: 'volume', re: /\bVol(?:ume)?\.?\s*\d|\d+\s*권\b|제\s*\d+\s*권/i },
    { field: 'issue', re: /\bNo\.\s*\d|\bIssue\s*\d|\d+\s*권[^\n]{0,12}\d+\s*호\b|제\s*\d+\s*권[^\n]{0,12}제\s*\d+\s*호/i },
    { field: 'pages', re: /\bpp?\.\s*\d+\s*[-–]\s*\d+|\d+\s*[-–]\s*\d+\s*쪽/ },
    { field: 'language', re: /언어\s*[:：]|Language\s*[:：]/i },
    { field: 'publicationTitle', re: /학술지\s*[:：]|저널\s*[:：]|Journal\s*[:：]|수록지/i }
];
const DATE_TEXT = String.raw `((?:1[89]|20)\d{2})(?:\s*[./년-]\s*(\d{1,2})(?:\s*[./월-]\s*(\d{1,2}))?\s*일?)?`;
export function isoDate(value: string): string {
    const match = clean(value).match(new RegExp(DATE_TEXT));
    if (!match)
        return '';
    const [, year, month, day] = match;
    return [year, month && month.padStart(2, '0'), day && day.padStart(2, '0')].filter(Boolean).join('-');
}
export type DatePrecision = 'year' | 'month' | 'day';
const MONTH_ABBREVIATIONS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
export function readStatedDate(raw: unknown): {
    value: string;
    precision: DatePrecision;
    raw: string;
    defaulted?: string;
} | null {
    const text = clean(String(raw ?? ''));
    if (!text)
        return null;
    const stamp = text.match(/^(?:[A-Za-z]{3},?\s+)?([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{2}:\d{2}(?::\d{2})?)\s+(?:[A-Z]{2,5}\s+)?((?:1[89]|20)\d{2})$/)
        || text.match(/^(?:[A-Za-z]{3},?\s+)?(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+((?:1[89]|20)\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)/);
    const iso = text.match(/^((?:1[89]|20)\d{2})-(\d{2})-(\d{2})[T\s](\d{2}:\d{2}(?::\d{2})?)/);
    let year = '', month = '', day = '';
    if (stamp) {
        const monthWord = /^\d/.test(stamp[1]) ? stamp[2] : stamp[1];
        day = /^\d/.test(stamp[1]) ? stamp[1] : stamp[2];
        year = /^\d/.test(stamp[1]) ? stamp[3] : stamp[4];
        month = MONTH_ABBREVIATIONS[monthWord.toLowerCase()] || '';
        if (!month)
            return null;
    }
    else if (iso) {
        [, year, month, day] = iso;
    }
    if (year)
        return { value: `${year}-${month.padStart(2, '0')}-${String(day).padStart(2, '0')}`, precision: 'day', raw: text };
    const value = isoDate(text);
    if (!value)
        return null;
    return { value, precision: value.length >= 10 ? 'day' : value.length >= 7 ? 'month' : 'year', raw: text };
}
export function notAPerson(person: any): boolean {
    const whole = clean(`${person?.lastName ?? person?.name ?? ''} ${person?.firstName ?? ''}`);
    if (!whole)
        return true;
    if (/@|^https?:\/\//i.test(whole))
        return true;
    if (publicationStatementOf(whole) || publicationStatementOf(clean(`${person?.firstName ?? ''} ${person?.lastName ?? person?.name ?? ''}`)))
        return true;
    return !!labelWordOf(whole);
}
export function pageTextRoute(html: string): {
    values: Record<string, CollectedValue>;
    labelsSeen: string[];
    outcome: string;
} {
    const text = visibleText(html);
    const values: Record<string, CollectedValue> = {};
    const labelsSeen: string[] = [];
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    const take = (field: TrackedField, value: any, locator: string, source = 'text label') => { if (value && !values[field])
        values[field] = { value, route: 'pageText', source, locator: locator.slice(0, 120) }; };
    for (const { field, re } of LABELS)
        if (re.test(text))
            labelsSeen.push(field);
    const headingTags = [...html.matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/gi), ...html.matchAll(/<(?:dt|strong|em|span|div|p|td)\b[^>]*class="[^"]*(?:title|subject|tit\b|sbj)[^"]*"[^>]*>([\s\S]*?)<\/(?:dt|strong|em|span|div|p|td)>/gi), ...html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>/gi)];
    const heading = headingTags.map(match => clean(decode(match[1].replace(/<[^>]+>/g, ' ')))).find(line => line.length >= 8 && line.length <= 200 && /\p{L}/u.test(line) && !/[:：]$/.test(line));
    if (heading)
        values.title = { value: heading, route: 'pageText', source: 'page heading', locator: `<h1>/<h2>: ${heading.slice(0, 80)}` };
    const probes: string[] = [];
    for (const [index, line] of lines.entries()) {
        probes.push(line);
        if (line.length <= 30 && lines[index + 1])
            probes.push(`${line} : ${lines[index + 1]}`);
    }
    for (const line of probes) {
        const isbn = line.match(/ISBN(?:-?1[03])?\s*[:：]?\s*((?:97[89][-\s]?)?\d[\d-\s]{8,16}[\dX])/i);
        if (isbn) {
            const valid = isValidISBN(isbn[1].replace(/\s+/g, ''));
            if (valid)
                take('ISBN', normalizedISBN(valid), line);
        }
        const date = line.match(new RegExp(String.raw `(?:발행일|출간일|출판일|발행년월|발행연도|발행년도|출판연도|발행|출판|Published(?:\s+online)?|Publication date|Date published|Year)\s*[:：]?\s*${DATE_TEXT}`, 'i'));
        if (date)
            take('date', isoDate(date[0].slice(date[0].search(/(?:1[89]|20)\d{2}/))), line);
        const imprint = line.match(/발행사항\s*[:：]?\s*(?:\[[^\]]*\]|[^:：\n]{1,20}\s*[:：])?\s*([^\d\n,]{2,40}?)\s*[,]?\s*((?:1[89]|20)\d{2})/);
        if (imprint) {
            take('publisher', clean(imprint[1]).replace(/[.,;:]+$/, ''), line, 'text label (imprint)');
            take('date', imprint[2], line, 'text label (imprint)');
        }
        const physical = line.match(/(?:형태사항|면수)\s*[:：]?\s*(?:[ivxlc]+,\s*)?(\d{2,5})\s*(?:p\.|p\b|쪽|면)/i);
        if (physical)
            take('numPages', physical[1], line, 'text label (physical description)');
        const pages = line.match(/(?:쪽수|페이지\s*수|Number of pages|Page count|Pages)\s*[:：]?\s*(\d{2,5})\s*(?:쪽|p|pages)?/i) || line.match(/(?:쪽수|페이지\s*수)[^\d\n]{0,24}(\d{2,5})\s*쪽/) || line.match(/^(\d{2,5})\s*(?:쪽|p\.|pp\.|pages)\s*(?:[|·,;]|$)/i);
        const locator = pages && new RegExp(`${pages[1]}\\s*[-–—]\\s*\\d`).test(line);
        if (pages && !locator && Number(pages[1]) >= 10)
            take('numPages', pages[1], line);
        const publisher = line.match(/(?:^|[\s|·:：])(?:(?:출판사|발행처|발행자)\s*[:：]?|Publisher\s*[:：])\s*([^|·;,()\[\]]{2,60})/i)
            || line.match(/^Published\s+by\b\s*[:：]?\s*([^|·;,()\[\]]{2,60})/i);
        if (publisher && !/^\s*(?:정보|검색)/.test(publisher[1]))
            take('publisher', clean(publisher[1]).replace(/\s+(?:저자|지은이|발행일|출간일).*$/, ''), line);
        const credits = line.match(/(?:^|[:：\s])(?:저자정보|저자명|개인저자|저자|지은이|Authors?)\s*[:：]?\s*([^|·;()\[\]]{2,120})/);
        if (credits && !/^(?:정보|소개|명|와의|에게|는|가|의)\b/.test(credits[1].trim())) {
            const trimmed = clean(credits[1]).replace(/\s+(?:출판사|발행처|출간일|발행일|Publisher).*$/, '');
            const tail = roleWordAt(trimmed, 'tail', CREDIT_TAIL_MEANINGS);
            const named = tail ? tail.rest : trimmed;
            const creatorType = tail && tail.word.meaning !== 'others' ? bylineRoleOf(tail.word.form) : 'author';
            const people = (splitCreditLine(named).map(personFromDisplayName).filter(Boolean) as RecordPerson[]).filter(person => !notAPerson(person))
                .map(person => creatorType === 'author' ? person : { ...person, creatorType });
            if (people.length && people.length <= 12)
                take('creators', people, line);
        }
        const doi = line.match(/\b(10\.\d{4,9}\/[^\s"'<>]+)/);
        if (doi && /doi/i.test(line))
            take('DOI', doi[1].replace(/[.,;)]+$/, '').toLowerCase(), line);
        const edition = line.match(/\b(\d+(?:st|nd|rd|th)\s+ed(?:ition|\.))|\b((?:Second|Third|Fourth|Fifth|Revised)\s+Edition)|((?:제\s*)?\d{1,2}\s*판(?![결례매권정형])|개정판|증보판)/i);
        if (edition)
            take('edition', clean(edition[1] || edition[2] || edition[3]), line);
        const volume = line.match(/\bVol(?:ume)?\.?\s*(\d+)|제?\s*(\d+)\s*권\b/i);
        if (volume)
            take('volume', volume[1] || volume[2], line);
        const issue = line.match(/\bNo\.\s*(\d+)|\bIssue\s*(\d+)|(?:권[^\n]{0,12}|Vol\.?\s*\d+[^\n]{0,12})제?\s*(\d+)\s*호\b/i);
        if (issue)
            take('issue', issue[1] || issue[2] || issue[3], line);
        const range = line.match(/\bpp?\.\s*(\d+\s*[-–]\s*\d+)|(\d+\s*[-–]\s*\d+)\s*쪽/);
        if (range)
            take('pages', clean(range[1] || range[2]).replace(/\s+/g, ''), line);
    }
    return { values, labelsSeen, outcome: `${Object.keys(values).length} value(s) from labels, ${labelsSeen.length} label(s) seen` };
}
const TRANSLATOR_FIELDS = ['title', 'date', 'publisher', 'publicationTitle', 'volume', 'issue', 'pages', 'DOI', 'ISBN', 'numPages', 'edition', 'institution', 'university', 'language', 'url'];
export function translatorRoute(input: TranslatorInput | null | undefined): {
    values: Record<string, CollectedValue>;
    itemType?: string;
    outcome: string;
    tried: boolean;
} {
    const values: Record<string, CollectedValue> = {};
    if (!input)
        return { values, outcome: 'not available in this host', tried: false };
    if (input.error)
        return { values, outcome: `failed: ${input.error}`, tried: true };
    if (!input.translator)
        return { values, outcome: 'no translator detected for this page', tried: true };
    const found = input.items?.[0];
    if (!found)
        return { values, outcome: `${input.translator}: returned no item`, tried: true };
    const item = KOREAN_TRANSLATOR_LABEL.test(String(input.translator)) ? { ...found } : found;
    const moved = item === found ? {} : withKoreanTranslatorLayout(item);
    const source = `translator:${input.translator}`;
    for (const field of TRANSLATOR_FIELDS) {
        const raw = item[field];
        if (raw === undefined || raw === null || raw === '')
            continue;
        const dated = field === 'date' ? readStatedDate(raw) : null;
        const value = field === 'date' ? dated?.value || clean(raw) : field === 'title' ? withoutGenreTag(clean(raw)) : field === 'ISBN' ? normalizedISBN(String(raw).split(/\s+/)[0]) : field === 'DOI' ? clean(raw).toLowerCase() : clean(raw);
        const locator = (moved as Record<string, string>)[field] || field;
        if (value)
            values[field] = { value, route: 'translator', source, locator, ...(dated ? { raw: dated.raw, precision: dated.precision, ...(dated.defaulted ? { defaulted: dated.defaulted } : {}) } : {}) };
    }
    if (Array.isArray(item.creators) && item.creators.length) {
        values.creators = { value: item.creators.map((person: any) => person.name ? { lastName: clean(person.name), fieldMode: 1, creatorType: person.creatorType } : { lastName: clean(person.lastName), firstName: clean(person.firstName) || undefined, creatorType: person.creatorType }), route: 'translator', source, locator: 'creators' };
    }
    return { values, itemType: item.itemType, outcome: `${input.translator}: ${Object.keys(values).length} field(s)`, tried: true };
}
const PDF_READ_PAGES = 5;
export function pdfRoute(input: PdfInput | null | undefined): {
    values: Record<string, CollectedValue>;
    outcome: string;
    tried: boolean;
} {
    const values: Record<string, CollectedValue> = {};
    if (!input)
        return { values, outcome: 'not a file, or no reader in this host', tried: false };
    if (input.error)
        return { values, outcome: `failed: ${input.error}`, tried: true };
    if (!input.text.trim())
        return { values, outcome: `no text layer in ${input.pages} page(s)`, tried: true };
    const first = input.text.split('\f')[0] || input.text;
    const scan = scanIdentifiers({ text: first, complete: true } as any);
    const doi = scan.observations.find(entry => entry.kind === 'DOI' && entry.confidence !== 'ambiguous');
    if (doi)
        values.DOI = { value: doi.value.toLowerCase(), route: 'pdf', source: 'pdf text', locator: `p1: ${doi.value}` };
    const isbn = scan.observations.find(entry => entry.kind === 'ISBN' && entry.confidence !== 'ambiguous');
    if (isbn)
        values.ISBN = { value: normalizedISBN(isbn.value), route: 'pdf', source: 'pdf text', locator: `p1: ${isbn.value}` };
    const citation = citationLineOf(first);
    const pages = input.text.split('\f').slice(0, PDF_READ_PAGES).map((text, index) => ({ page: index + 1, text, kind: 'pdfText' as const }));
    let read: ReturnType<typeof buildCandidate> | null = null;
    try {
        read = buildCandidate(pages, { documentPages: input.pages });
    }
    catch {
        read = null;
    }
    const readFields = (read?.fields || {}) as Record<string, any>;
    const readPage = Number(read?.sources?.title?.page) || 1;
    if (typeof readFields.title === 'string' && readFields.title.trim()) {
        values.title = { value: readFields.title.trim(), route: 'pdf', source: 'pdf text (title block)', locator: `p${readPage}: ${readFields.title.trim().slice(0, 80)}` };
    }
    const people: any[] = Array.isArray(readFields.creators) ? readFields.creators : [];
    if (people.length) {
        values.creators = { value: people.map((person: any) => ({ lastName: String(person.lastName ?? ''), ...(person.firstName ? { firstName: String(person.firstName) } : {}),
                ...(person.fieldMode === 1 ? { fieldMode: 1 } : {}), creatorType: person.creatorType || 'author' })), route: 'pdf', source: 'pdf text (by-line)', locator: `p${readPage}` };
    }
    if (citation) {
        if (citation.journal)
            values.publicationTitle = { value: citation.journal, route: 'pdf', source: 'pdf citation line', locator: citation.raw };
        if (citation.volume)
            values.volume = { value: citation.volume, route: 'pdf', source: 'pdf citation line', locator: citation.raw };
        if (citation.issue)
            values.issue = { value: citation.issue, route: 'pdf', source: 'pdf citation line', locator: citation.raw };
        if (citation.pages)
            values.pages = { value: citation.pages, route: 'pdf', source: 'pdf citation line', locator: citation.raw };
        if (citation.year)
            values.date = { value: citation.year, route: 'pdf', source: 'pdf citation line', locator: citation.raw };
    }
    const body = String(readFields.university || readFields.institution || '').trim();
    if (body)
        values.institution = { value: body, route: 'pdf', source: 'pdf text (issuing body)', locator: `p${readPage}: ${body.slice(0, 80)}` };
    if (!values.date && typeof readFields.date === 'string' && readFields.date.trim()) {
        values.date = { value: readFields.date.trim(), route: 'pdf', source: 'pdf text (date)', locator: `p${readPage}: ${readFields.date.trim()}` };
    }
    values.url = { value: input.url, route: 'pdf', source: 'address', locator: input.url };
    return { values, outcome: `${input.pages} page(s) read; ${Object.keys(values).length} value(s) from the first page`, tried: true };
}
const ROUTE_ORDER: RouteName[] = ['translator', 'structured', 'pageText', 'pdf'];
export function collectFromPage(page: PageInput, extras: {
    translator?: TranslatorInput | null;
    pdf?: PdfInput | null;
    site?: SiteReaderInput | null;
} = {}): Collection {
    const { access, note } = classifyAccess(page);
    const routes: RouteReport[] = [];
    const found: Record<string, CollectedValue[]> = {};
    const add = (values: Record<string, CollectedValue>) => { for (const [field, value] of Object.entries(values))
        (found[field] ||= []).push(value); };
    let itemType: string | undefined;
    let labelsSeen: string[] = [];
    const readable = access === 'detail' || (access === 'empty' && !!page.html);
    if (readable) {
        const translated = translatorRoute(extras.translator);
        routes.push({ route: 'translator', tried: translated.tried, outcome: translated.outcome, fields: Object.keys(translated.values) });
        add(translated.values);
        itemType = translated.itemType || itemType;
        const structured = structuredRoute(page.html, page.finalURL || page.url);
        if (extras.site) {
            const siteValues: Record<string, CollectedValue> = {};
            for (const [field, raw] of Object.entries(extras.site.values)) {
                if (raw === undefined || raw === null || raw === '' || !(TRACKED_FIELDS as readonly string[]).includes(field))
                    continue;
                const dated = field === 'date' ? readStatedDate(raw) : null;
                siteValues[field] = { value: field === 'ISBN' ? normalizedISBN(String(raw)) : field === 'date' ? dated?.value || clean(raw) : clean(raw), route: 'structured', source: `site:${extras.site.name}`, locator: field,
                    ...(dated ? { raw: dated.raw, precision: dated.precision, ...(dated.defaulted ? { defaulted: dated.defaulted } : {}) } : {}) };
            }
            if (extras.site.creators?.length)
                siteValues.creators = { value: extras.site.creators, route: 'structured', source: `site:${extras.site.name}`, locator: 'credits' };
            for (const [field, value] of Object.entries(structured.values))
                if (!siteValues[field])
                    siteValues[field] = value;
            structured.values = siteValues;
            structured.outcome = `site:${extras.site.name} + ${structured.outcome}`;
        }
        routes.push({ route: 'structured', tried: true, outcome: structured.outcome, fields: Object.keys(structured.values) });
        add(structured.values);
        itemType = itemType || structured.itemType;
        const text = pageTextRoute(page.html);
        routes.push({ route: 'pageText', tried: true, outcome: text.outcome, fields: Object.keys(text.values) });
        add(text.values);
        labelsSeen = text.labelsSeen;
    }
    else {
        for (const route of ['translator', 'structured', 'pageText'] as RouteName[])
            routes.push({ route, tried: false, outcome: `not read: ${access} (${note})`, fields: [] });
    }
    const pdf = pdfRoute(access === 'file' || extras.pdf ? extras.pdf : undefined);
    routes.push({ route: 'pdf', tried: pdf.tried, outcome: pdf.outcome, fields: Object.keys(pdf.values) });
    add(pdf.values);
    const fields: Record<string, FieldReport> = {};
    const pageRead = readable || (pdf.tried && !!Object.keys(pdf.values).length);
    for (const field of TRACKED_FIELDS) {
        const candidates = (found[field] || []).sort((a, b) => ROUTE_ORDER.indexOf(a.route) - ROUTE_ORDER.indexOf(b.route));
        if (candidates.length) {
            if (field === 'title' && candidates.length > 1 && /^[A-Za-z0-9_.\-]{1,24}$/.test(String(candidates[0].value))) {
                const worded = candidates.findIndex(entry => /\s/.test(String(entry.value)) && String(entry.value).length >= 8);
                if (worded > 0)
                    candidates.unshift(...candidates.splice(worded, 1));
            }
            if (field === 'date' && candidates.length > 1 && !candidates[0].defaulted) {
                const coarser = candidates.findIndex(entry => !!entry.defaulted && String(entry.value).slice(0, 4) === String(candidates[0].value).slice(0, 4));
                if (coarser > 0)
                    candidates.unshift(...candidates.splice(coarser, 1));
            }
            const [best, ...rest] = candidates;
            fields[field] = { status: 'collected', value: best.value, source: best.source, locator: best.locator, route: best.route, ...(rest.length ? { alternatives: rest } : {}),
                ...(best.raw ? { raw: best.raw } : {}), ...(best.precision ? { precision: best.precision } : {}), ...(best.defaulted ? { defaulted: best.defaulted } : {}) };
        }
        else if (!pageRead)
            fields[field] = { status: 'inaccessible', reason: `${access}: ${note}` };
        else if (labelsSeen.includes(field))
            fields[field] = { status: 'extractionFailed', reason: 'the page shows a label for this field; no reader got a value' };
        else
            fields[field] = { status: 'absent', reason: 'not stated on the page as read' };
    }
    return {
        url: page.url, finalURL: page.finalURL || page.url, access, accessNote: note, itemType, routes, fields, labelsSeen,
        textExcerpt: readable ? visibleText(page.html).slice(0, 4000) : ''
    };
}
export function collectionSummary(collection: Collection): {
    collected: number;
    absent: number;
    extractionFailed: number;
    inaccessible: number;
} {
    const out = { collected: 0, absent: 0, extractionFailed: 0, inaccessible: 0 };
    for (const report of Object.values(collection.fields))
        out[report.status]++;
    return out;
}

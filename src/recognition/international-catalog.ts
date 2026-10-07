import { buildDiff } from '../metadata/diff';
import { titleSimilarity } from '../metadata/match';
import { titleSupportedByPDF } from './pdf-identifiers';
import { crossrefDate, decodeEntities, fieldsFromCrossref, itemTypeFromCrossref } from './official-source';
import { classifyPage, editionStatements, parseDateValue, readDates, splitTrailingEdition } from './roles';
import { readBylineRow, rowIsByline } from './byline-row';
import { isInstitutionName, isNotATitle, isOrganisationName, isOrganisationOnly, serialNameShaped } from './title-guards';
import { withoutOtherWorksIn } from './page-structure';
import { parallelRestatement } from './title-grammar';
import { storableType } from './item-fields';
import { namedByTheReader, readerRoles, type ReaderRoles } from './korean-auto';
import { journalNamesAgree, longerThanThePart, partRange, partSpan, PART_TYPES, SERIAL_PART_TYPES } from '../restore/link';
import type { MetadataSnapshot } from '../types';
import { personParts, registryPerson } from '../metadata/person-name';
const CROSSREF = 'https://api.crossref.org/works';
const OPENLIBRARY = 'https://openlibrary.org/search.json';
const REQUEST_TIMEOUT = 12000;
const REQUEST_INTERVAL = 250;
const RETRY_BACKOFF = 2000;
const SEARCH_BUDGET = 20000;
const MINIMUM_TITLE_SCORE = 0.9;
const yearOf = (value: unknown) => String(value || '').match(/\b(?:18|19|20)\d{2}\b/)?.[0] || '';
function documentYear(text: string): string {
    const current = new Date().getFullYear();
    const front = String(text || '').split('\f').map(page => withoutOtherWorksIn(page)).join('\n')
        .split('\n').filter(line => !/\breprint(?:ed|ing|s)?\b/i.test(line)).join('\n').slice(0, 6000);
    return [...front.matchAll(/\b((?:19|20)\d{2})\b/g)]
        .map(match => match[1])
        .filter(value => Number(value) >= 1800 && Number(value) <= current + 1)
        .sort((a, b) => Number(b) - Number(a))[0] || '';
}
const EDITION_YEAR_TOLERANCE = 1;
export interface CatalogCandidate {
    title: string;
    url: string;
    score: number;
    provider: string;
    reason?: string;
}
export interface CatalogSearchOptions {
    pages?: string[];
    readings?: string[];
    reader?: Record<string, unknown>;
    documentPages?: number;
}
export interface CatalogOutcome {
    candidates: CatalogCandidate[];
    result?: {
        title: string;
        metadata: MetadataSnapshot;
        changes: ReturnType<typeof buildDiff>;
        notes: string[];
    };
    reason: string;
}
const NOTE_DIGITS = /(?<=\p{L}{3}|[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2})[¹²³⁰⁴-⁹]+(?:[,，˒][¹²³⁰⁴-⁹]+)*(?=\s*$)/u;
const NAME_NOTE_DIGITS = /(?<=\p{L})[¹²³⁰⁴-⁹]+(?:[,，˒][¹²³⁰⁴-⁹]+)*\s*$/u;
const withoutNoteDigits = (value: string) => value.replace(NOTE_DIGITS, '');
const nameWithoutNoteDigits = (value: unknown) => String(value ?? '').replace(NAME_NOTE_DIGITS, '');
const SUBSCRIPT_LETTER = /([ₐ-ₜ])/u;
const nfkc = (value: unknown) => withoutNoteDigits(String(value || '')).replace(/[ㆍᆞ]/g, '·').split(SUBSCRIPT_LETTER)
    .map(part => SUBSCRIPT_LETTER.test(part) ? part : part.normalize('NFKC')).join('');
const compactTitle = (value: string) => nfkc(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const clean = (value: unknown) => nfkc(value).replace(/\s+/g, ' ').trim();
let nextRequestAt = 0;
async function getJSON(url: string, cancelled: () => boolean): Promise<any> {
    for (let attempt = 0; attempt < 2; attempt++) {
        if (cancelled())
            throw new Error('취소됨');
        const wait = Math.max(0, nextRequestAt - Date.now());
        if (wait)
            await new Promise(resolve => setTimeout(resolve, wait));
        nextRequestAt = Date.now() + REQUEST_INTERVAL;
        try {
            const response = await Zotero.HTTP.request('GET', url, { responseType: 'json', timeout: REQUEST_TIMEOUT });
            return response.response;
        }
        catch (cause) {
            const status = Number((cause as any)?.status || (cause as any)?.xmlhttp?.status || 0);
            if (attempt || !(status === 429 || status >= 500) || cancelled())
                throw cause;
            nextRequestAt = Date.now() + RETRY_BACKOFF;
        }
    }
    throw new Error('요청 실패');
}
async function crossrefWorks(title: string, cancelled: () => boolean): Promise<any[]> {
    const url = `${CROSSREF}?rows=5&select=DOI,title,subtitle,author,editor,issued,published-print,published-online,container-title,volume,issue,page,article-number,publisher,publisher-location,ISSN,ISBN,type,abstract`
        + `&query.bibliographic=${encodeURIComponent(title)}`;
    const json = await getJSON(url, cancelled);
    return Array.isArray(json?.message?.items) ? json.message.items : [];
}
export async function openLibraryByISBN(parent: any, before: MetadataSnapshot, isbn: string, cancelled: () => boolean = () => false) {
    const value = String(isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase();
    if (value.length !== 10 && value.length !== 13)
        return null;
    const url = `${OPENLIBRARY}?limit=1&fields=key,title,author_name,first_publish_year,publisher,isbn,number_of_pages_median`
        + `&q=isbn:${encodeURIComponent(value)}`;
    const json = await getJSON(url, cancelled);
    const doc = Array.isArray(json?.docs) ? json.docs[0] : null;
    if (!doc)
        return null;
    let edition: any = null;
    try {
        edition = await getJSON(`https://openlibrary.org/isbn/${encodeURIComponent(value)}.json`, cancelled);
    }
    catch (cause) {
        Zotero.debug(`[PDF Metadata Refresh] OpenLibrary edition ${value} unavailable: ${String(cause)}`);
    }
    return fromOpenLibrary(parent, before, doc, { isbn: value, edition: edition && typeof edition === 'object' ? edition : null });
}
export async function crossrefWorkByDOI(parent: any, before: MetadataSnapshot, doi: string, cancelled: () => boolean = () => false) {
    const json = await getJSON(`${CROSSREF}/${encodeURIComponent(doi.trim())}`, cancelled);
    const work = json?.message;
    const found = work ? fromCrossref(parent, before, work) : null;
    if (found?.subtitle)
        found.metadata = { ...found.metadata, fields: { ...found.metadata.fields, title: `${found.title}: ${found.subtitle}` } };
    return found;
}
async function openLibraryDocs(title: string, cancelled: () => boolean): Promise<any[]> {
    const url = `${OPENLIBRARY}?limit=5&fields=key,title,subtitle,author_name,first_publish_year,publisher,isbn,number_of_pages_median`
        + `&title=${encodeURIComponent(title)}`;
    const json = await getJSON(url, cancelled);
    return Array.isArray(json?.docs) ? json.docs : [];
}
function crossrefItemType(type: string): string {
    const shared = itemTypeFromCrossref(type);
    if (shared)
        return shared;
    if (/^book(?:-set|-series)?$/.test(type))
        return 'book';
    if (type === 'book-chapter' || type === 'book-part' || type === 'book-section')
        return 'bookSection';
    if (type === 'proceedings-article')
        return 'conferencePaper';
    if (type === 'dissertation')
        return 'thesis';
    if (type === 'report' || type === 'report-component')
        return 'report';
    return 'journalArticle';
}
export function snapshotFrom(parent: any, before: MetadataSnapshot, itemType: string, values: Record<string, unknown>, creators: Array<{
    firstName?: string;
    lastName: string;
    creatorType?: string;
}>): MetadataSnapshot {
    const stored = storableType(itemType);
    const candidate = new Zotero.Item(stored);
    candidate.libraryID = parent.libraryID;
    for (const [field, raw] of Object.entries(values)) {
        const value = clean(raw);
        const id = Zotero.ItemFields.getID(field);
        if (value && id && Zotero.ItemFields.isValidForType(id, candidate.itemTypeID))
            candidate.setField(id, value);
    }
    const primary = Zotero.CreatorTypes.getName(Zotero.CreatorTypes.getPrimaryIDForType(candidate.itemTypeID)) || 'author';
    const roleFor = (stated?: string) => {
        if (!stated)
            return primary;
        const id = Zotero.CreatorTypes.getID(stated);
        return id && Zotero.CreatorTypes.isValidForItemType(id, candidate.itemTypeID) ? stated : primary;
    };
    candidate.setCreators(creators.map(person => person.firstName
        ? { firstName: nameWithoutNoteDigits(person.firstName), lastName: nameWithoutNoteDigits(person.lastName), creatorType: roleFor(person.creatorType), fieldMode: 0 }
        : { lastName: nameWithoutNoteDigits(person.lastName), creatorType: roleFor(person.creatorType), fieldMode: 1 }));
    const fields: Record<string, string> = {};
    for (const id of Zotero.ItemFields.getItemTypeFields(candidate.itemTypeID)) {
        const value = candidate.getField(id);
        if (value)
            fields[Zotero.ItemFields.getName(id)] = value;
    }
    return { ...before, itemTypeID: candidate.itemTypeID, itemType: stored, fields, creators: candidate.getCreators() };
}
function fromCrossref(parent: any, before: MetadataSnapshot, work: any): {
    title: string;
    metadata: MetadataSnapshot;
    subtitle: string;
} | null {
    if (!work)
        return null;
    const stated = fieldsFromCrossref(work);
    const title = clean(stated.title);
    if (!title)
        return null;
    const subtitle = clean(decodeEntities(Array.isArray(work?.subtitle) ? work.subtitle[0] : work?.subtitle));
    const itemType = crossrefItemType(String(work?.type || ''));
    const container = clean(stated.publicationTitle);
    const person = (role: string) => (entry: any) => entry?.family
        ? { ...(registryPerson(clean(decodeEntities(entry.given)), clean(decodeEntities(entry.family)), clean(decodeEntities(entry.suffix))) || { lastName: '', firstName: '' }), creatorType: role }
        : { lastName: clean(decodeEntities(entry?.name)), creatorType: role };
    const creators = [
        ...(Array.isArray(work?.author) ? work.author : []).map(person('author')),
        ...(Array.isArray(work?.editor) ? work.editor : []).map(person('editor'))
    ].filter((entry: any) => entry.lastName);
    const listed = (value: unknown, separator: string) => Array.isArray(value) ? value.join(separator) : value;
    const metadata = snapshotFrom(parent, before, itemType, {
        title,
        publicationTitle: itemType === 'journalArticle' ? container : '',
        bookTitle: itemType === 'bookSection' ? container : '',
        proceedingsTitle: itemType === 'conferencePaper' ? container : '',
        series: itemType === 'book' ? container : clean(stated.series),
        volume: stated.volume, issue: stated.issue, pages: stated.pages,
        date: crossrefDate(work)?.value || '', DOI: stated.DOI, publisher: stated.publisher,
        place: decodeEntities(work?.['publisher-location']),
        edition: Number(work?.['edition-number']) > 0 ? work['edition-number'] : '',
        ISSN: listed(work?.ISSN, ', '),
        ISBN: listed(work?.ISBN, ' ')
    }, creators);
    return { title, metadata, subtitle: subtitle && !compactTitle(title).includes(compactTitle(subtitle)) ? subtitle : '' };
}
function fromOpenLibrary(parent: any, before: MetadataSnapshot, doc: any, context: {
    isbn?: string;
    edition?: any;
    text?: string;
} = {}): {
    title: string;
    metadata: MetadataSnapshot;
    subtitle: string;
    work?: boolean;
} | null {
    const edition = context.edition || null;
    const editionTitle = clean(edition?.title);
    const subtitle = clean(edition?.subtitle);
    const title = editionTitle
        ? (subtitle && !compactTitle(editionTitle).includes(compactTitle(subtitle)) ? `${editionTitle}: ${subtitle}` : editionTitle)
        : clean(doc?.title);
    if (!title)
        return null;
    const creators = (Array.isArray(doc?.author_name) ? doc.author_name : [])
        .map((name: string) => {
        const value = clean(name);
        const parts = personParts(value);
        return parts && parts.fieldMode === 0 ? { firstName: parts.firstName, lastName: parts.lastName } : { lastName: value };
    })
        .filter((person: any) => person.lastName);
    const printedDigits = String(context.text || '').toUpperCase().replace(/[^0-9X]/g, '');
    const isbn = context.isbn || (Array.isArray(doc?.isbn) ? doc.isbn : []).map(clean)
        .map((value: string) => value.replace(/-/g, '').toUpperCase())
        .find((value: string) => /^(?:\d{9}[\dX]|97[89]\d{10})$/.test(value) && printedDigits.includes(value)) || '';
    const publishers = [...new Set((Array.isArray(doc?.publisher) ? doc.publisher : [doc?.publisher]).map(clean).filter(Boolean))];
    const fields: Record<string, unknown> = { title, ISBN: isbn };
    if (edition) {
        fields.date = parseDateValue(clean(edition.publish_date))?.value || '';
        fields.publisher = Array.isArray(edition.publishers) ? edition.publishers[0] : edition.publishers;
        fields.numPages = Number(edition.number_of_pages) > 0 ? String(edition.number_of_pages) : '';
        fields.edition = edition.edition_name;
        fields.place = Array.isArray(edition.publish_places) ? edition.publish_places[0] : '';
    }
    else if (!context.isbn) {
        fields.date = doc?.first_publish_year ? String(doc.first_publish_year) : '';
        fields.publisher = publishers.length === 1 ? publishers[0] : '';
    }
    const metadata = snapshotFrom(parent, before, 'book', fields, creators);
    const docSubtitle = edition ? '' : clean(doc?.subtitle);
    return { title, metadata, subtitle: docSubtitle && !compactTitle(title).includes(compactTitle(docSubtitle)) ? docSubtitle : '', ...(!edition && !context.isbn ? { work: true } : {}) };
}
interface FoundRecord {
    title: string;
    subtitle?: string;
    metadata: MetadataSnapshot;
    provider: string;
    url: string;
    score: number;
    work?: boolean;
}
interface EditionReading {
    number: number;
    atLeast: boolean;
    raw: string;
}
const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const EDITION_GAP = String.raw `(?:[,\s]+(?!(?:of|the|this|that|these|those|in|on|for|to|a|an|is|was|from|by|with|at|century|anniversary)\b)[\p{L}-]{2,}){0,3}?[,\s]+`;
const EDITION_NOUN = String.raw `(?:edition|édition|edición|edicion|edizione|auflage)\b`;
const EDITION_PATTERNS: Array<{
    pattern: RegExp;
    read: (match: RegExpMatchArray) => number;
}> = [
    { pattern: new RegExp(String.raw `\b(\d{1,2})\s*(?:st|nd|rd|th)${EDITION_GAP}(?:${EDITION_NOUN}|ed\.|edn\b)`, 'giu'), read: match => Number(match[1]) },
    { pattern: new RegExp(String.raw `\b(${ORDINAL_WORDS.join('|')})${EDITION_GAP}(?:${EDITION_NOUN}|ed\.|edn\b)`, 'giu'), read: match => ORDINAL_WORDS.indexOf(match[1].toLowerCase()) + 1 },
    { pattern: new RegExp(String.raw `(?<![\d.])(\d{1,2})(?:\.|\s?(?:ème|eme|er|re|e)|a|o)${EDITION_GAP}${EDITION_NOUN}`, 'giu'), read: match => Number(match[1]) },
    { pattern: /제\s*(\d{1,2})\s*판|(?<![\d\p{L}·×*/.-])(\d{1,2})\s*판(?![\p{L}])|第\s*(\d{1,2})\s*版/gu, read: match => Number(match[1] || match[2] || match[3]) },
    { pattern: /초판/g, read: () => 1 }
];
const REVISED_EDITION = /\b(?:revised|enlarged|expanded|updated)(?:[,\s]+(?:and\s+)?(?:revised|enlarged|expanded|updated))*[,\s]+edition\b|(?<!\p{L})(?:überarbeitete|erweiterte|neubearbeitete)\s+auflage\b|(?:전면\s*)?개정\s*(?:증보\s*)?(?:\d{1,2}\s*)?판|증보\s*판|(?:改訂|増補|增補|修訂)\s*新?版/iu;
export function editionIn(value: unknown, bare = false): EditionReading | null {
    const text = nfkc(value).replace(/<\/?su[pb]>/gi, '');
    let best = 0, raw = '';
    for (const { pattern, read } of EDITION_PATTERNS) {
        for (const match of text.matchAll(pattern)) {
            const number = read(match);
            if (number >= 1 && number <= 30 && number > best) {
                best = number;
                raw = match[0].trim();
            }
        }
    }
    if (!best && bare) {
        const plain = /^\s*(\d{1,2})\s*\.?\s*$/.exec(text);
        if (plain && Number(plain[1]) >= 1) {
            best = Number(plain[1]);
            raw = plain[1];
        }
    }
    const revised = REVISED_EDITION.exec(text);
    if (revised && best < 2)
        return { number: 2, atLeast: true, raw: revised[0].trim() };
    return best ? { number: best, atLeast: false, raw } : null;
}
function sameEdition(page: EditionReading, record: EditionReading): boolean {
    if (page.atLeast && record.atLeast)
        return true;
    if (page.atLeast)
        return record.number >= page.number;
    if (record.atLeast)
        return page.number >= record.number;
    return page.number === record.number;
}
type Script = 'ko' | 'cjk' | 'latin' | '';
const scriptOf = (value: string): Script => /[가-힣]/.test(value) ? 'ko'
    : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value) ? 'cjk' : /\p{L}/u.test(value) ? 'latin' : '';
const EAST_ASIAN = /[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const plainLetters = (value: unknown) => nfkc(value).normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const latest = (years: string[]) => years.map(Number).filter(Boolean).sort((a, b) => b - a)[0] || 0;
function personKeys(metadata: MetadataSnapshot): Array<{
    key: string;
    script: Script;
}> {
    return (metadata.creators || []).flatMap((person: any) => {
        const last = clean(person?.lastName), first = clean(person?.firstName);
        if (!last || !first)
            return [];
        const eastAsian = EAST_ASIAN.test(`${last}${first}`);
        const key = plainLetters(eastAsian ? `${last}${first}`.replace(/\s+/g, '') : last);
        return key.length >= 2 ? [{ key, script: scriptOf(key) }] : [];
    });
}
function namedIn(person: {
    key: string;
    script: Script;
}, text: string): boolean {
    if (person.script !== 'latin')
        return plainLetters(text).replace(/\s+/g, '').includes(person.key);
    return new RegExp(`(?<![\\p{L}])${escapeRegExp(person.key)}(?![\\p{L}])`, 'u').test(plainLetters(text));
}
const BY_LINE = /^(?:by|edited\s+by|written\s+by|compiled\s+by)\s+/i;
function nameLine(line: string): boolean {
    const value = clean(line);
    if (!value || value.length > 200)
        return false;
    return rowIsByline(value, 'strict');
}
interface DocumentStatements {
    pages: Array<{
        lines: string[];
        leaf: boolean;
    }>;
    readings: string[];
    edition: EditionReading | null;
    editionYears: string[];
    labelled: string[];
    printed: string;
    body: string;
    bylineScripts: Set<Script>;
    readType: string;
    roles: ReaderRoles;
    documentPages: number;
    serial: SerialStatement | null;
    publisher: string;
}
export interface SerialStatement {
    name: string;
    volume: string;
    page: string;
    shaped: boolean;
    issue?: string;
    last?: string;
}
const VOLUME_STATED = /(?:\bvol(?:ume)?\b\.?|\bv\.)\s*(\d{1,5})|(\d{1,5})\s*(?:권|巻|卷)|^\s*(\d{1,5})\s*(?:[(（,;:]|$)/iu;
const ISSUE_STATED = /^\s*[(（]\s*(\d{1,4})\s*[)）]|\b(?:no|nr|issue|number)\.?\s*(\d{1,4})|(\d{1,4})\s*(?:호|號|号)/iu;
const LEADING_YEAR = /^\s*[(（]?((?:1[5-9]|20)\d{2})[)）]?(?:\s*[,;:.]\s*|\s+|$)/u;
const FIRST_PAGE_STATED = /^\s*(?:pp?\.?\s*)?(\d{1,6})(?:\s*[-‐‑‒–—―−~]\s*\d{1,6})?\s*$/iu;
const PAGE_RANGE_STATED = /^\s*(?:pp?\.?\s*)?(\d{1,6})\s*[-‐‑‒–—―−~]{1,2}\s*(\d{1,6})\s*$/iu;
export function coordinatesOfTheReading(value: unknown): {
    year: string;
    volume: string;
    issue: string;
} {
    let text = clean(value);
    let year = '';
    const lead = LEADING_YEAR.exec(text);
    if (lead) {
        year = lead[1];
        text = text.slice(lead[0].length);
    }
    const numbers = VOLUME_STATED.exec(text);
    const volume = String(Number(numbers?.[1] || numbers?.[2] || numbers?.[3] || 0) || '');
    const rest = numbers ? text.slice((numbers.index ?? 0) + numbers[0].length - (/[(（]$/.test(numbers[0]) ? 1 : 0)) : '';
    const issued = volume ? ISSUE_STATED.exec(rest) : null;
    const issue = String(Number(issued?.[1] || issued?.[2] || issued?.[3] || 0) || '');
    return { year, volume, issue };
}
function readCoordinates(issueCell: unknown, pagesCell: unknown): {
    issue?: string;
    last?: string;
} {
    const issue = coordinatesOfTheReading(issueCell).issue;
    const range = PAGE_RANGE_STATED.exec(clean(pagesCell));
    const last = range && Number(range[1]) > 1 && Number(range[2]) > Number(range[1]) ? String(Number(range[2])) : '';
    return { ...(issue ? { issue } : {}), ...(last ? { last } : {}) };
}
export function journalFirstPageOf(value: unknown): string {
    const text = clean(value);
    if (/^\s*\d{1,5}\s*(?:of|\/)\s*\d{1,5}\s*$/i.test(text))
        return '';
    const stated = FIRST_PAGE_STATED.exec(text);
    if (!stated || Number(stated[1]) === 1)
        return '';
    return String(Number(stated[1]));
}
const VOLUME_CELL = /^vol(?:ume)?\.?\s*(\d{1,4})$/i;
const SERIAL_CELL = /^\p{Lu}[\p{L}'’&.\-]*(?: [\p{L}'’&.\-]+){1,7}$/u;
export function serialOfAVolumeLine(line: unknown): {
    name: string;
    volume: string;
} | null {
    const text = clean(String(line ?? ''));
    if (!text || text.length > 300 || !/[|•·‧∙]/u.test(text))
        return null;
    const cells = text.split(/\s*[|•·‧∙]\s*/u).map(cell => cell.trim());
    for (let at = 1; at < cells.length; at++) {
        const volume = VOLUME_CELL.exec(cells[at]);
        if (!volume)
            continue;
        const name = cells[at - 1];
        return SERIAL_CELL.test(name) && !/[\d:：]/.test(name) ? { name, volume: String(Number(volume[1])) } : null;
    }
    return null;
}
export function serialOfTheReading(reader: Record<string, unknown> | null | undefined, lines: string[] = [], printedLines: string[] = []): SerialStatement | null {
    const said = (name: string) => clean(reader?.[name]);
    const readType = said('유형');
    if (WHOLE_READING.test(readType))
        return null;
    const title = compactTitle(said('제목'));
    const roles = readerRoles(reader || {});
    const masthead = () => lines.map(clean).find(line => line.length <= 80 && serialNameShaped(line) && compactTitle(line) !== title
        && !roles.people.some(person => compactTitle(person) === compactTitle(line))) || '';
    const name = said('출판') || masthead();
    if (!name)
        return null;
    const shaped = serialNameShaped(name);
    if (!shaped && (!SERIAL_PART_READING.test(readType) || IMPRINT.test(name)
        || isOrganisationName(name) || isOrganisationOnly(name) || isInstitutionName(name)))
        return null;
    const { volume } = coordinatesOfTheReading(said('권호'));
    if (!volume)
        return null;
    if (!shaped) {
        const printed = [...lines, ...printedLines].map(serialOfAVolumeLine).find(entry => !!entry && entry.volume === volume && compactTitle(entry.name) !== compactTitle(name));
        if (printed)
            return { name: printed.name, volume, page: journalFirstPageOf(said('페이지')), shaped: true, ...readCoordinates(said('권호'), said('페이지')) };
    }
    return { name, volume, page: journalFirstPageOf(said('페이지')), shaped, ...readCoordinates(said('권호'), said('페이지')) };
}
const PAGE_HEADER = /^[-–—]{2,}\s*PAGE\s+\d+\s*[-–—]{2,}$/i;
const LEAF_LINES = 20;
const YEAR_ONLY_LINE = /^(?:\p{L}{3,12}\.?\s+)?(?:1[5-9]|20)\d{2}\.?$/u;
const yearsIn = (line: string) => (line.match(/\b(?:1[5-9]|20)\d{2}\b/g) || []);
function documentStatements(text: string, printed: string, options: CatalogSearchOptions): DocumentStatements {
    const reader = options.reader || {};
    const said = (name: string) => clean(reader[name]);
    const sheets = [
        ...String(text || '').split('\f').map(page => ({ page, read: true })),
        ...(options.pages || []).map(page => ({ page: String(page || ''), read: false }))
    ];
    const pages = sheets.map(({ page, read }) => {
        const lines = withoutOtherWorksIn(page).split('\n').map(clean).filter(line => line && !PAGE_HEADER.test(line));
        return { lines, leaf: read || lines.length <= LEAF_LINES || classifyPage(page, 1) === 'colophon' };
    }).filter(page => page.lines.length);
    const readTitle = said('제목'), readSubtitle = said('부제');
    const readings = [...new Set([...(options.readings || []).map(clean), readTitle, readTitle && readSubtitle ? `${readTitle}: ${readSubtitle}` : '']
            .filter(Boolean))];
    const editions = [...pages.filter(page => page.leaf).map(page => editionIn(page.lines.join('\n'))), ...readings.map(reading => editionIn(reading))]
        .filter((entry): entry is EditionReading => !!entry);
    const edition = editions.reduce<EditionReading | null>((best, entry) => !best || entry.number > best.number || (entry.number === best.number && best.atLeast && !entry.atLeast) ? entry : best, null);
    const editionYears: string[] = [], labelled: string[] = [];
    const bylineScripts = new Set<Script>();
    for (const page of pages) {
        const joined = page.lines.join('\n');
        for (const statement of editionStatements(joined)) {
            if (statement.scope === 'thisEdition' && page.leaf)
                editionYears.push(statement.year);
            if (statement.scope === 'thisEdition')
                labelled.push(statement.year);
            if (statement.scope === 'copyright')
                labelled.push(statement.year);
        }
        if (page.leaf) {
            page.lines.forEach((line, index) => {
                if (!editionIn(line))
                    return;
                const next = page.lines[index + 1] || '';
                for (const year of yearsIn(line).length ? yearsIn(line) : YEAR_ONLY_LINE.test(next) ? yearsIn(next) : []) {
                    editionYears.push(year);
                    labelled.push(year);
                }
            });
        }
        for (const reading of readDates(joined)) {
            if (reading.role === 'copyrightDate' || reading.role === 'publicationDate')
                labelled.push(reading.value.slice(0, 4));
        }
        for (const line of page.lines)
            if (nameLine(line))
                bylineScripts.add(scriptOf(line));
    }
    const readYear = yearOf(said('발행일'));
    if (readYear)
        labelled.push(readYear);
    const readByline = String(reader['저자'] ?? '').normalize('NFKC').trim();
    const script = scriptOf(readByline);
    if (script)
        bylineScripts.add(script);
    const body = [...pages.map(page => page.lines.join('\n')), ...(readByline ? [readByline] : [])].join('\n\f\n');
    const documentPages = Number(options.documentPages) > 0 ? Math.floor(Number(options.documentPages)) : 0;
    return { pages, readings, edition, editionYears, labelled, printed, body, bylineScripts,
        readType: said('유형'), roles: readerRoles(reader), documentPages, publisher: said('출판'),
        serial: serialOfTheReading(reader, String(text || '').split(/[\n\f]/).filter(line => !PAGE_HEADER.test(clean(line))), (options.pages || []).flatMap(page => String(page || '').split('\n'))) };
}
function mainTitleOf(title: string): string {
    const cut = /\s*[:：]\s*|\s+[-–—―]\s+/u.exec(title);
    const main = cut ? title.slice(0, cut.index).trim() : '';
    return compactTitle(main).length >= 4 ? main : title;
}
function remainderAfter(line: string, target: string): string {
    const value = nfkc(line);
    if (!compactTitle(value).startsWith(target))
        return '';
    let count = 0;
    for (let index = 0; index < value.length;) {
        const char = String.fromCodePoint(value.codePointAt(index)!);
        index += char.length;
        count += char.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').length;
        if (count >= target.length) {
            const rest = value.slice(index);
            return /^[\p{L}\p{N}]/u.test(rest) ? '' : rest.replace(/^[\s:：;,.·\-–—―~/]+/u, '').trim();
        }
    }
    return '';
}
const NUMBERING = /^(?:vol(?:ume)?|part|band|teil|tome|book|no|issue|chapter|section)\.?\s*[\dIVXLC]+\b|^\d{1,3}(?:\.\d{1,3})*\.?\s|^(?:제\s*)?\d{1,3}\s*(?:권|부|편|장|호)/i;
const IMPRINT = /\b(?:GmbH|KGaA|Verlag|Inc|Ltd|LLC|Press|Publishers?|Publishing|Co\.)(?![\p{L}])|출판|펴냄|펴낸/u;
const LABELLED = /^[\p{L}\s]{2,24}[:：]\s*\S/u;
function subtitleShaped(value: string, titleLine: string, entry: FoundRecord): boolean {
    const line = clean(value).replace(/^[\s\-–—―~:：]+|[\s\-–—―~]+$/gu, '').trim();
    if (line.length < 4 || line.length > 160)
        return false;
    if (isNotATitle(line) || editionIn(line) || serialNameShaped(line))
        return false;
    if (/\b(?:1[5-9]|20)\d{2}\b/.test(line) || /\b(?:ISBN|ISSN|DOI)\b|https?:|www\./i.test(line))
        return false;
    if (NUMBERING.test(line) || IMPRINT.test(line) || LABELLED.test(line) || BY_LINE.test(line))
        return false;
    const single = readBylineRow(line, { seated: true });
    const personShaped = single.kind === 'single' && (EAST_ASIAN.test(line) || line.split(/\s+/).length <= 3);
    if (nameLine(line) || personShaped)
        return false;
    if (personKeys(entry.metadata).some(person => namedIn(person, line)))
        return false;
    const fields = entry.metadata.fields || {};
    const key = compactTitle(line);
    const houses = [fields.publisher, fields.publicationTitle, fields.bookTitle, fields.proceedingsTitle, fields.series]
        .map(house => compactTitle(String(house || ''))).filter(house => house.length >= 4);
    if (houses.some(house => key.includes(house) || house.includes(key)))
        return false;
    const script = scriptOf(line);
    if (!script || script !== scriptOf(titleLine) || parallelRestatement(titleLine, line))
        return false;
    return script === 'latin' ? (line.match(/\p{L}{2,}/gu) || []).length >= 2 : (line.match(new RegExp(EAST_ASIAN.source, 'gu')) || []).length >= 4;
}
function unmatchedSubtitle(entry: FoundRecord, stated: DocumentStatements): string {
    const full = clean(`${entry.title} ${entry.subtitle || ''}`);
    const main = mainTitleOf(entry.title);
    const targets = [...new Set([main, entry.title, full].map(compactTitle))].filter(target => target.length >= 4);
    const recordLetters = compactTitle(full);
    const inRecord = (line: string) => {
        const key = compactTitle(line);
        return !key || recordLetters.includes(key) || titleSimilarity(`${main} ${line}`, full) >= 0.9
            || (!!entry.subtitle && titleSimilarity(line, entry.subtitle) >= 0.85);
    };
    const extra = (rest: string, titleLine: string) => !!rest && !namedByTheReader(rest, stated.roles) && subtitleShaped(rest, titleLine, entry) && !inRecord(rest);
    for (const page of stated.pages) {
        if (!page.leaf)
            continue;
        const { lines } = page;
        for (let index = 0; index < lines.length; index++) {
            for (let span = 1; span <= 3 && index + span <= lines.length; span++) {
                const titleLine = lines.slice(index, index + span).join(' ');
                if (!targets.includes(compactTitle(titleLine)))
                    continue;
                const next = lines[index + span];
                if (next && extra(next, titleLine))
                    return clean(next);
            }
            for (const target of targets) {
                const rest = remainderAfter(lines[index], target);
                if (extra(rest, lines[index]))
                    return rest;
            }
        }
    }
    for (const reading of stated.readings) {
        const { title } = splitTrailingEdition(reading);
        for (const target of targets) {
            const rest = remainderAfter(title, target);
            if (extra(rest, title))
                return rest;
        }
    }
    return '';
}
const WHOLE_READING = /^(?:book|thesis|report|책|단행본|도서|학위\s*논문|보고서)$/i;
const PART_READING = /^(?:journal\s*article|magazine\s*article|newspaper\s*article|article|conference\s*paper|book\s*section|chapter|논문|학술\s*논문|학술지\s*논문)$/i;
const SERIAL_PART_READING = /^(?:journal\s*article|magazine\s*article|newspaper\s*article|article|학술\s*논문|학술지\s*논문)$/i;
const TRAILING_ACRONYM = /\s+(?:[(（]\p{Lu}{2,8}[)）]|(?:\p{Lu}\.){2,8})\s*$/u;
const TYPE_WORDS: Record<string, string> = { book: '책', bookSection: '책의 한 부분', thesis: '학위논문', report: '보고서', conferencePaper: '학술대회 논문',
    encyclopediaArticle: '사전 항목', dictionaryEntry: '사전 항목', journalArticle: '학술지 논문', magazineArticle: '잡지 기사', newspaperArticle: '신문 기사' };
function containerOfAnotherWork(entry: FoundRecord, serial: SerialStatement | null, named: string): string {
    if (!serial)
        return '';
    const type = String(entry.metadata.itemType || '');
    const fields = entry.metadata.fields || {};
    const containers = [fields.publicationTitle, fields.bookTitle, fields.proceedingsTitle, fields.series].map(clean).filter(Boolean);
    const container = containers[0] || '';
    const agrees = (name: string) => journalNamesAgree(serial.name, name, fields.journalAbbreviation) || journalNamesAgree(name, serial.name)
        || (compactTitle(name).length >= 4 && compactTitle(name) === compactTitle(serial.name))
        || spelledByInitials(serial.name, name) || spelledByInitials(name, serial.name);
    const same = containers.some(agrees);
    const publisher = compactTitle(String(fields.publisher || '')), stated = compactTitle(serial.name);
    const namesThePublisher = publisher.length >= 3 && stated.length >= 3 && (publisher.includes(stated) || stated.includes(publisher));
    const read = `판독은 이 문서를 연속간행물 「${serial.name.slice(0, 60)}」 ${serial.volume}권${serial.page ? `(${serial.page}쪽)` : ''}의 글로 읽었는데`;
    const refuse = (what: string) => `${named}: ${read} 레코드는 ${what}이라, 다른 자료에 실린 같은 제목으로 보고 채택하지 않음`;
    if (!SERIAL_PART_TYPES.has(type)) {
        if (same)
            return '';
        return refuse(`${TYPE_WORDS[type] || type || '다른 유형의 기록'}${container ? `(「${container.slice(0, 60)}」)` : ''}`);
    }
    const within = (name: string) => {
        const a = compactTitle(name);
        if (Math.min(a.length, stated.length) >= 4)
            return a.includes(stated) || stated.includes(a);
        return a.length < stated.length ? wholeSegmentOf(name, serial.name) : stated.length < a.length && wholeSegmentOf(serial.name, name);
    };
    const comparable = containers.some(name => scriptOf(name) === scriptOf(serial.name));
    if (container && !same && !containers.some(within) && comparable && (serial.shaped || !namesThePublisher)) {
        return refuse(`「${container.slice(0, 60)}」의 ${TYPE_WORDS[type] || type}`);
    }
    const volume = /^\s*\d{1,5}\s*$/.test(String(fields.volume || '')) ? String(Number(fields.volume)) : '';
    const recordRange = partRange(fields.pages);
    const issueAgrees = !!serial.issue && /^\s*\d{1,4}\s*$/.test(String(fields.issue || '')) && String(Number(fields.issue)) === serial.issue;
    const spanAgrees = !!recordRange && !!serial.page && !!serial.last && recordRange[0] === Number(serial.page) && recordRange[1] === Number(serial.last);
    if (volume && volume !== serial.volume && !(same && issueAgrees && spanAgrees))
        return refuse(`${volume}권의 글${container ? `(「${container.slice(0, 60)}」)` : ''}`);
    const range = partRange(fields.pages);
    const page = Number(serial.page);
    if (range && page && (page < range[0] || page > range[1]))
        return refuse(`같은 권의 다른 글(${range[0]}-${range[1]}쪽)`);
    return '';
}
const HANGUL_OR_HAN_NAME = /^[가-힣\p{Script=Han}]+$/u;
function wholeSegmentOf(shorter: string, longer: string): boolean {
    const short = compactTitle(shorter);
    if (short.length < 2 || short.length > 3 || !HANGUL_OR_HAN_NAME.test(short))
        return false;
    const segments = nfkc(longer).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    for (let from = 0; from < segments.length; from++) {
        let joined = '';
        for (let to = from; to < segments.length && joined.length < short.length; to++) {
            joined += segments[to];
            if (joined === short)
                return true;
        }
    }
    return false;
}
const INITIALS_SKIP = /^(?:of|the|and|for|in|on|at|to|a|an|&|de|des|du|la|le|der|die|das|und|für|et|y|e)$/i;
function spelledByInitials(acronym: string, name: string): boolean {
    const letters = clean(acronym).replace(/[.\s]/g, '');
    if (!/^\p{Lu}{3,8}$/u.test(letters))
        return false;
    const initials = clean(name).split(/[\s\-‐–—:,/()]+/).filter(word => word && !INITIALS_SKIP.test(word))
        .map(word => word[0]).join('').toUpperCase();
    return initials.length >= letters.length && initials.startsWith(letters);
}
function partForTheWhole(entry: FoundRecord, stated: DocumentStatements, named: string): string {
    const type = String(entry.metadata.itemType || '');
    const pages = String(entry.metadata.fields?.pages || '');
    const span = partSpan(pages);
    if (PART_TYPES.has(type) && longerThanThePart(span, stated.documentPages)) {
        return `${named}: 레코드는 ${span}쪽(${pages})짜리 한 편(${type})인데 이 PDF는 ${stated.documentPages}쪽이라, 이 문서가 아니라 이 문서를 다룬 글(서평·부고·소식 등)로 보고 채택하지 않음`;
    }
    if (WHOLE_READING.test(stated.readType) && SERIAL_PART_TYPES.has(type)) {
        return `${named}: 판독기가 이 문서를 한 권(${stated.readType})으로 읽었는데 레코드는 연속간행물의 한 편(${type})이라 다른 저작으로 보고 채택하지 않음`;
    }
    const { roles } = stated;
    if ((roles.people.length || roles.others.length) && !stated.readings.some(reading => namedByTheReader(reading, roles))) {
        const title = entry.title.replace(TRAILING_ACRONYM, '');
        if ([entry.title, title].some(value => compactTitle(value).length >= 6 && namedByTheReader(value, roles))) {
            return `${named}: 레코드 제목이 판독기가 저자·출판으로 적은 이름 그 자체라, 이 문서가 아니라 그 사람·기관을 다룬 글로 보고 채택하지 않음`;
        }
    }
    return '';
}
function disagreement(entry: FoundRecord, stated: DocumentStatements): string {
    const named = `${entry.provider} 후보 「${entry.title.slice(0, 60)}」`;
    const whole = partForTheWhole(entry, stated, named);
    if (whole)
        return whole;
    const elsewhere = containerOfAnotherWork(entry, stated.serial, named);
    if (elsewhere)
        return elsewhere;
    const subtitle = unmatchedSubtitle(entry, stated);
    if (subtitle)
        return `${named}: 쪽에 인쇄된 부제 「${subtitle.slice(0, 60)}」가 레코드 제목에 없어 다른 판·다른 저작으로 보고 채택하지 않음`;
    const fields = entry.metadata.fields || {};
    const offered = yearOf(fields.date);
    const type = String(entry.metadata.itemType || '');
    if (stated.edition && stated.edition.number >= 2 && SERIAL_PART_TYPES.has(type) && !PART_READING.test(stated.readType)
        && !(partSpan(fields.pages) > 0 && stated.documentPages > 0 && !longerThanThePart(partSpan(fields.pages), stated.documentPages))) {
        return `${named}: 쪽에 「${stated.edition.raw}」가 인쇄되어 있는데 레코드는 판이 없는 연속간행물의 한 편(${type})이라 다른 저작으로 보고 채택하지 않음`;
    }
    const recordEdition = editionIn(fields.edition, true) || editionIn(entry.title);
    if (stated.edition && (recordEdition || entry.metadata.itemType === 'book' || entry.metadata.itemType === 'bookSection')) {
        if (recordEdition) {
            if (!sameEdition(stated.edition, recordEdition))
                return `${named}: 쪽의 판 표시 「${stated.edition.raw}」와 레코드의 판 「${recordEdition.raw}」가 달라 다른 판으로 보고 채택하지 않음`;
        }
        else if (stated.edition.number >= 2) {
            const tie = latest(stated.editionYears) || latest(stated.labelled) || Number(stated.printed) || 0;
            if (!tie || !offered)
                return `${named}: 쪽에 「${stated.edition.raw}」가 인쇄되어 있는데 레코드에는 판 표시가 없고 그 판의 연도로도 묶이지 않아 같은 판인지 확인할 수 없음`;
            if (Math.abs(tie - Number(offered)) > EDITION_YEAR_TOLERANCE)
                return `${named}: 쪽의 「${stated.edition.raw}」(${tie})와 레코드의 발행연도 ${offered}가 달라 다른 판으로 보고 채택하지 않음`;
        }
    }
    const { printed } = stated;
    if (printed && offered && Math.abs(Number(printed) - Number(offered)) > EDITION_YEAR_TOLERANCE) {
        return `${entry.provider} 후보의 발행연도 ${offered}가 PDF에 인쇄된 ${printed}와 달라 다른 판본으로 보고 채택하지 않음: ${entry.title.slice(0, 60)}`;
    }
    const labelled = latest(stated.labelled);
    if (labelled && offered && Math.abs(labelled - Number(offered)) > EDITION_YEAR_TOLERANCE) {
        return `${named}: 레코드의 발행연도 ${offered}가 쪽에 ©·발행 연도로 찍힌 ${labelled}와 달라 다른 판으로 보고 채택하지 않음`;
    }
    const people = personKeys(entry.metadata).filter(person => stated.bylineScripts.has(person.script));
    if (people.length && !people.some(person => namedIn(person, stated.body))) {
        return `${named}: 레코드의 저자(${people.slice(0, 3).map(person => person.key).join(', ')})가 쪽의 저자 줄에 없어 다른 저작으로 보고 채택하지 않음`;
    }
    if (!(entry.metadata.creators || []).length && stated.bylineScripts.size && !secondTie(entry, stated)) {
        return `${named}: 레코드는 사람을 적지 않았는데 쪽에는 저자 줄이 있고, 제목 말고 이 문서에 묶는 것(쪽이 말한 연도·발행처·실린 곳)이 없어 같은 제목의 다른 저작으로 보고 채택하지 않음`;
    }
    if (!stated.bylineScripts.size) {
        const script = dominantScript(stated.body);
        const unprinted = personKeys(entry.metadata).filter(person => person.script === script);
        if (unprinted.length && !unprinted.some(person => namedIn(person, stated.body))) {
            return `${named}: 레코드의 저자(${unprinted.slice(0, 3).map(person => person.key).join(', ')})가 문서 어디에도 인쇄되어 있지 않아 이 문서의 레코드로 보지 않음`;
        }
    }
    return '';
}
const statedYearsOf = (stated: DocumentStatements) => new Set([...stated.labelled, ...stated.editionYears, stated.printed].filter(Boolean));
function publisherStated(publisher: unknown, stated: DocumentStatements): boolean {
    const key = compactTitle(String(publisher || ''));
    if (key.length < 4)
        return false;
    const read = compactTitle(stated.publisher);
    return (read.length >= 4 && (read.includes(key) || key.includes(read))) || compactTitle(stated.body).includes(key);
}
function secondTie(entry: FoundRecord, stated: DocumentStatements): boolean {
    const fields = entry.metadata.fields || {};
    const offered = yearOf(fields.date);
    if (offered && statedYearsOf(stated).has(offered))
        return true;
    if (publisherStated(fields.publisher, stated))
        return true;
    const body = compactTitle(stated.body);
    return [fields.publicationTitle, fields.bookTitle, fields.proceedingsTitle, fields.series]
        .map(name => compactTitle(String(name || ''))).some(name => name.length >= 6 && body.includes(name));
}
function workLevelUnstated(entry: FoundRecord, metadata: MetadataSnapshot, stated: DocumentStatements): {
    metadata: MetadataSnapshot;
    dropped: string[];
} {
    if (!entry.work)
        return { metadata, dropped: [] };
    const fields = { ...(metadata.fields || {}) };
    const dropped: string[] = [];
    const year = yearOf(fields.date);
    if (fields.date && !(year && statedYearsOf(stated).has(year))) {
        dropped.push(`date ${fields.date}`);
        delete fields.date;
    }
    if (fields.publisher && !publisherStated(fields.publisher, stated)) {
        dropped.push(`publisher ${fields.publisher}`);
        delete fields.publisher;
    }
    return dropped.length ? { metadata: { ...metadata, fields }, dropped } : { metadata, dropped };
}
function dominantScript(text: string): Script {
    const value = nfkc(text);
    const counts: Array<[
        Script,
        number
    ]> = [
        ['ko', (value.match(/[가-힣]/g) || []).length * 2.5],
        ['cjk', (value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length * 2.5],
        ['latin', (value.match(/\p{Script=Latin}/gu) || []).length]
    ];
    const [script, count] = counts.reduce((best, entry) => entry[1] > best[1] ? entry : best);
    return count > 0 ? script : '';
}
function withStatedSubtitle(entry: FoundRecord, text: string): MetadataSnapshot {
    if (!entry.subtitle || !titleSupportedByPDF(`${entry.title}: ${entry.subtitle}`, text))
        return entry.metadata;
    return { ...entry.metadata, fields: { ...entry.metadata.fields, title: `${entry.title}: ${entry.subtitle}` } };
}
export async function searchInternationalCatalog(parent: any, before: MetadataSnapshot, text: string, titles: string[], material: 'article' | 'book' | 'thesis', cancelled: () => boolean, options: CatalogSearchOptions = {}): Promise<CatalogOutcome> {
    const errors: string[] = [];
    const found: FoundRecord[] = [];
    const queries = titles.map(clean).filter(value => value.length >= 8).slice(0, 3);
    if (!queries.length)
        return { candidates: [], reason: 'PDF에서 검색에 쓸 만한 제목을 찾지 못했습니다.' };
    const routes = material === 'book' ? ['openlibrary', 'crossref'] : ['crossref', 'openlibrary'];
    const deadline = Date.now() + SEARCH_BUDGET;
    let ranOut = false;
    const printed = documentYear(text);
    const stated = documentStatements(text, printed, options);
    const verdicts = new Map<FoundRecord, string>();
    const judged = (entry: FoundRecord) => {
        if (!verdicts.has(entry))
            verdicts.set(entry, disagreement(entry, stated));
        return verdicts.get(entry)!;
    };
    const settled = () => found.some(entry => entry.score >= MINIMUM_TITLE_SCORE && !judged(entry));
    const readKeys = stated.readings.map(compactTitle).filter(key => key.length >= 4);
    const readScripts = new Set(stated.readings.map(scriptOf));
    const anchors = !readKeys.length ? queries : [...new Set([...stated.readings, ...queries.filter(query => {
                if (namedByTheReader(query, stated.roles))
                    return false;
                const key = compactTitle(query);
                return readKeys.some(reading => key.includes(reading) || (key.length >= 8 && reading.includes(key)))
                    || (!!scriptOf(query) && !readScripts.has(scriptOf(query)));
            })])];
    for (const route of routes) {
        if (cancelled() || settled())
            break;
        if (Date.now() > deadline) {
            ranOut = true;
            break;
        }
        for (const query of queries) {
            if (cancelled() || settled())
                break;
            if (Date.now() > deadline) {
                ranOut = true;
                break;
            }
            try {
                const records = route === 'crossref'
                    ? (await crossrefWorks(query, cancelled)).map(work => ({ built: fromCrossref(parent, before, work), url: `https://doi.org/${clean(work?.DOI)}`, provider: 'Crossref' }))
                    : (await openLibraryDocs(query, cancelled)).map(doc => ({ built: fromOpenLibrary(parent, before, doc, { text }), url: `https://openlibrary.org${clean(doc?.key)}`, provider: 'OpenLibrary' }));
                for (const record of records) {
                    if (!record.built)
                        continue;
                    const { title, subtitle } = record.built;
                    const score = Math.max(...anchors.map(value => Math.max(titleSimilarity(value, title), subtitle ? titleSimilarity(value, `${title} ${subtitle}`) : 0)));
                    found.push({ ...record.built, provider: record.provider, url: record.url, score });
                }
            }
            catch (cause) {
                errors.push(`${route}: ${String(cause)}`);
            }
        }
    }
    const candidates = found
        .sort((a, b) => b.score - a.score)
        .filter((entry, index, all) => all.findIndex(other => other.url === entry.url) === index)
        .slice(0, 3);
    const shown = (entry: FoundRecord) => entry.subtitle ? `${entry.title}: ${entry.subtitle}` : entry.title;
    if (cancelled())
        return { candidates: candidates.map(entry => ({ title: shown(entry), url: entry.url, score: entry.score, provider: entry.provider })), reason: '취소됨' };
    const conflicts = new Map(candidates.map(entry => [entry, judged(entry)] as const));
    const listed: CatalogCandidate[] = candidates.map(entry => ({ title: shown(entry), url: entry.url, score: entry.score, provider: entry.provider,
        ...(conflicts.get(entry) ? { reason: conflicts.get(entry) } : {}) }));
    if (!candidates.length)
        return { candidates: listed, reason: ranOut ? 'Crossref·OpenLibrary 검색 제한 시간 초과 — 후보를 확인하지 못했습니다.'
                : errors.length ? errors.join('\n') : 'Crossref·OpenLibrary 제목 검색 일치 후보 없음' };
    const coversCover = (entry: FoundRecord) => {
        const record = compactTitle(entry.title);
        return anchors.some(query => {
            const cover = compactTitle(query);
            return cover.length >= 20 && record.includes(cover) && record.length <= cover.length * 1.6;
        });
    };
    const standing = candidates.filter(entry => !conflicts.get(entry));
    const refused = candidates.find(entry => conflicts.get(entry) && (entry.score >= MINIMUM_TITLE_SCORE || coversCover(entry)));
    const best = standing[0];
    const covered = standing.find(coversCover);
    if (!best || (best.score < MINIMUM_TITLE_SCORE && !covered)) {
        if (refused)
            return { candidates: listed, reason: conflicts.get(refused)! };
        const top = best || candidates[0];
        return { candidates: listed, reason: `Crossref·OpenLibrary 최고 후보 제목 일치도 ${Math.round(top.score * 100)}% — 자동 채택 기준(${Math.round(MINIMUM_TITLE_SCORE * 100)}%) 미달` };
    }
    const chosen = best.score >= MINIMUM_TITLE_SCORE ? best : covered!;
    const rival = standing.find(entry => entry !== chosen && chosen.score - entry.score < 0.05
        && titleSimilarity(entry.title, chosen.title) < 0.97);
    if (rival)
        return { candidates: listed, reason: '제목이 비슷한 별개 후보가 둘 이상 — 자동 채택 안 함' };
    if (!titleSupportedByPDF(chosen.title, text)) {
        return { candidates: listed, reason: `${chosen.provider} 후보 제목이 PDF 원문에서 확인되지 않아 채택하지 않음: ${chosen.title.slice(0, 80)}` };
    }
    const { metadata, dropped } = workLevelUnstated(chosen, withStatedSubtitle(chosen, stated.body), stated);
    const work = dropped.length ? ` · 저작의 기록이라 문서가 말하지 않은 ${dropped.join(', ')}는 이 판의 것으로 채우지 않음` : '';
    return {
        candidates: listed,
        result: {
            title: String(metadata.fields.title || chosen.title), metadata, changes: buildDiff(before, metadata),
            notes: [`${chosen.provider} ${chosen.url}`, ...(work ? [work.slice(3)] : [])]
        },
        reason: `PDF 제목으로 ${chosen.provider} 검색 · 제목 ${Math.round(chosen.score * 100)}% 일치${chosen.score >= MINIMUM_TITLE_SCORE ? '' : ' (PDF 제목을 온전히 포함하는 판본 제목)'}, PDF 원문에서 확인됨${work} — 수동 검토 필요`
    };
}

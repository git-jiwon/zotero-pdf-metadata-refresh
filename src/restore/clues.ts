import { feeCodeISSN, folioCandidates, isMonthName, journalHeadStatement, readDates, readPageRanges } from '../recognition/roles';
import { leafPages, legacyRole, stampRowsIn, statesTheWork, structureFromPageObservations, withoutOtherWorksIn, type PageStructure } from '../recognition/page-structure';
import type { PageObservation } from '../recognition/candidate';
import { isNotATitle, isSerialName, looksLikeBodyProse } from '../recognition/title-guards';
import { citationRegions, otherWorksISBNs, recordOfAListedWork, scanIdentifiers } from '../recognition/pdf-identifiers';
import { isbnsIn, normalizedISBN, sameDOI, validISSN } from '../metadata/identifier-compare';
import { storableType } from '../recognition/item-fields';
import { dayRangeOfADate, doiStandingsOf, doisOfTheDocument, legislationDesignation, titleFailsContract, titleUnderContract } from '../batch/field-contract';
import { observation, statementsOf, type EvidenceBundle } from '../batch/evidence';
import { datesThePublication } from '../recognition/candidate';
export type DocumentKind = 'article' | 'book' | 'thesis' | 'report' | 'unknown';
export interface CitationLine {
    raw: string;
    journal?: string;
    proceedings?: string;
    volume?: string;
    issue?: string;
    pages?: string;
    year?: string;
}
export interface DocumentClues {
    kind: DocumentKind;
    titles: string[];
    readTitle?: string;
    containingWork?: string;
    surnames: string[];
    people?: Array<{
        lastName?: string;
        firstName?: string;
        name?: string;
        fieldMode?: number;
    }>;
    years: string[];
    identifiers: {
        DOI?: string;
        ISBN: string[];
    };
    printedDOIs?: string[];
    carried?: {
        DOI?: string;
        ISBN: string[];
    };
    recordTitle?: string;
    banner?: {
        journal: string;
        volume: string;
        issue?: string;
        year?: string;
    };
    scopeOf?: (record: {
        itemType?: unknown;
        pages?: unknown;
        numPages?: unknown;
        title?: unknown;
        bookTitle?: unknown;
        creators?: unknown[];
    }) => 'same' | 'container' | 'part' | 'unknown';
    citation?: CitationLine;
    journal?: string;
    institution?: string;
    publisher?: string;
    docNumber?: string;
    edition?: string;
    script: 'korean' | 'latin' | 'mixed';
    text: string;
    ocr: boolean;
    sources?: Record<string, any>;
    locators?: {
        volume?: string;
        issue?: string;
        pages?: string;
    };
    folios?: {
        offset: number;
        pages: number[];
        ocr?: Array<{
            page: number;
            folios: number[];
        }>;
    };
    volume?: string;
    held?: {
        publicationTitle?: string;
        journalAbbreviation?: string;
        volume?: string;
        issue?: string;
        pages?: string;
        DOI?: string;
    };
    coordinates?: PrintedCoordinates;
    documentPages?: number;
    readType?: string;
}
export interface PrintedCoordinates {
    journal?: string;
    ISSN?: string;
    volume: string;
    issue?: string;
    year: string;
    start: number;
    end?: number;
    extent?: {
        start: number;
        end: number;
        confirmed: Array<{
            page: number;
            folio: number;
        }>;
    };
    title?: string;
    runningHead: boolean;
    surnames: string[];
    sources: Record<string, 'reading' | 'masthead'>;
}
export type ProviderId = 'crossref' | 'yes24' | 'zoteroISBN' | 'arxiv' | 'aladin' | 'nlk' | 'openalex' | 'hal' | 'google';
export interface SearchQuery {
    kind: 'doi' | 'isbn' | 'citation' | 'coordinates' | 'titleAuthor' | 'title' | 'fragment' | 'titleInstitution' | 'titlePublisher' | 'docNumber' | 'authorPublisher';
    text: string;
    providers: ProviderId[];
    note: string;
}
const NFKC = (value: unknown) => String(value || '').normalize('NFKC');
const clean = (value: unknown) => NFKC(value).replace(/\s+/g, ' ').trim();
const EAST_ASIAN_NAME = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
export function bylineName(person: any): string {
    const last = clean(person?.lastName || person?.name), first = clean(person?.firstName);
    return EAST_ASIAN_NAME.test(`${last}${first}`) ? `${last}${first}`.replace(/\s+/g, '') : last;
}
const ABBREVIATED_WORD = /(?:^|\s)\p{Lu}\p{Ll}*\.(?=\s|$)|(?:^|\s)\p{Lu}{2,}(?=\s|$)/u;
const monthAtEnd = (value: string) => isMonthName(value.trim().split(/\s+/).pop());
export function citationLineOf(text: string): CitationLine | undefined {
    const page = NFKC(text);
    const rows: Array<{
        line: string;
        at: number;
    }> = [];
    let offset = 0;
    for (const piece of page.split('\n')) {
        const line = piece.replace(/\s+/g, ' ').replace(/\s+([,:;)])/g, '$1').replace(/\(\s+/g, '(').trim();
        if (line.length >= 12 && line.length <= 400)
            rows.push({ line, at: offset });
        offset += piece.length + 1;
    }
    const year = String.raw `((?:1[89]|20)\d{2})`;
    const name = String.raw `([A-Z][\p{L}.&'’ -]{2,60}?)`;
    const folio = String.raw `(?:\d{1,6}\s+)?`;
    const dash = String.raw `[-–—−]`;
    const patterns: Array<{
        re: RegExp;
        map: (m: RegExpMatchArray) => CitationLine;
        abbreviated?: boolean;
    }> = [
        { re: new RegExp(String.raw `^${folio}${name},?\s+(\d{1,4})\s*\((\d{1,3})\)\s*[:,]\s*([A-Za-z]?\d{1,6}\s*${dash}\s*[A-Za-z]?\d{1,6}),?\s*${year}`, 'u'),
            map: m => ({ raw: m[0], journal: m[1], volume: m[2], issue: m[3], pages: m[4].replace(/\s+/g, ''), year: m[5] }) },
        { re: new RegExp(String.raw `^${folio}${name},\s+(\d{1,4}),\s+(\d{1,6}\s*${dash}\s*\d{1,6}),\s+${year}`, 'u'),
            map: m => ({ raw: m[0], journal: m[1], volume: m[2], pages: m[3].replace(/\s+/g, ''), year: m[4] }) },
        { re: new RegExp(String.raw `^${folio}${name},?\s+VOL\.?\s*(\d{1,4}),\s*NO\.?\s*(\d{1,3}),\s*(?:[A-Z]+\s+)?${year}`, 'iu'),
            map: m => ({ raw: m[0], journal: m[1], volume: m[2], issue: m[3], year: m[4] }) },
        { re: new RegExp(String.raw `^${folio}${name}\s+(\d{1,4})\s*\(${year}\)\s*(\d{1,7}(?:\s*${dash}\s*\d{1,6})?)`, 'u'),
            map: m => ({ raw: m[0], journal: m[1], volume: m[2], year: m[3], pages: m[4].replace(/\s+/g, '') }) },
        { re: new RegExp(String.raw `^${folio}${name}\s+(\d{1,4}),\s*(\d{1,7}(?:\s*${dash}\s*\d{1,6})?)\s*\(${year}\)`, 'u'),
            map: m => ({ raw: m[0], journal: m[1], volume: m[2], pages: m[3].replace(/\s+/g, ''), year: m[4] }) },
        { re: new RegExp(String.raw `^${folio}${name}\s+${year},\s*(?:(\d{1,4}),\s*)?(\d{1,6}\s*${dash}\s*\d{1,6}|[A-Za-z]?\d{4,8})(?![\d\p{L}.])`, 'u'),
            map: m => ({ raw: m[0], journal: m[1], ...(m[3] ? { volume: m[3] } : {}), pages: m[4].replace(/\s+/g, ''), year: m[2] }), abbreviated: true }
    ];
    const regions = rows.length ? citationRegions(page) : [];
    const quoted = (at: number) => regions.some(([start, end]) => at >= start && at < end);
    const seated = (index: number) => (index < 3 || index >= rows.length - 5) && !quoted(rows[index].at);
    const order = [...rows.slice(0, 60).map((_row, index) => index), ...(rows.length > 60 ? rows.slice(Math.max(60, rows.length - 5)).map((_row, index) => Math.max(60, rows.length - 5) + index) : [])];
    for (const index of order) {
        const { line } = rows[index];
        for (const { re, map, abbreviated } of patterns) {
            const match = line.match(re);
            if (!match)
                continue;
            const folioLed = /^\d{1,6}\s/.test(line);
            if ((abbreviated || folioLed) ? !seated(index) : index >= 60)
                continue;
            const found = map(match);
            const journal = clean(found.journal).replace(/,+$/, '');
            if (!/^[A-Z]/.test(journal) || /\d/.test(journal) || journal.length < 3)
                continue;
            if (abbreviated && (!ABBREVIATED_WORD.test(journal) || monthAtEnd(journal)))
                continue;
            return { ...found, journal, ...(found.pages ? { pages: found.pages.replace(/−/g, '-') } : {}) };
        }
        const proceedings = seated(index) ? proceedingsLineOf(line) : undefined;
        if (proceedings)
            return proceedings;
    }
    return undefined;
}
const PROCEEDINGS_LINE = /^([가-힣][^,\n]{2,80}?)\s*pp\.?\s*(\d{1,5})\s*[~\-–—]\s*(\d{1,5})$/u;
function proceedingsLineOf(line: string): CitationLine | undefined {
    const match = PROCEEDINGS_LINE.exec(line);
    if (!match)
        return undefined;
    const name = match[1].trim();
    const years = name.match(/(?<!\d)(?:19|20)\d{2}(?!\d)/g) || [];
    if (years.length !== 1 || (name.match(/[가-힣]/g) || []).length < 4)
        return undefined;
    const [start, end] = [Number(match[2]), Number(match[3])];
    if (!(end >= start))
        return undefined;
    return { raw: match[0], proceedings: name, pages: `${match[2]}-${match[3]}`, year: years[0] };
}
function structureOfPages(pages: Array<{
    page: number;
    text: string;
    kind?: string;
}>, documentPages?: number): PageStructure {
    return structureFromPageObservations(pages.map(page => ({ page: page.page, text: page.text, kind: page.kind === 'ocrText' ? 'ocrText' : 'pdfText' })) as PageObservation[], Number(documentPages) > 0 ? Number(documentPages) : undefined);
}
const roleNameOf = (structure: PageStructure, page: number) => { const entry = structure.pages.find(held => held.page === page); return entry ? legacyRole(entry) : ''; };
function statedYears(pages: Array<{
    text: string;
    dated: boolean;
    stampRows?: Set<number>;
}>, read: unknown[] = []): string[] {
    const counts = new Map<string, number>();
    const count = (year: string) => counts.set(year, (counts.get(year) || 0) + 1);
    for (const page of pages) {
        for (const reading of readDates(page.text, page.stampRows ? { stampRows: page.stampRows } : {})) {
            if (reading.role && !datesThePublication(reading.role))
                continue;
            if (!reading.role && !page.dated)
                continue;
            count(reading.value.slice(0, 4));
        }
    }
    for (const value of read) {
        const year = String(value ?? '').normalize('NFKC').trim().slice(0, 4);
        if (/^(?:1[5-9]|20)\d{2}$/.test(year))
            count(year);
    }
    const now = new Date().getFullYear() + 1;
    return [...counts].filter(([year]) => Number(year) >= 1800 && Number(year) <= now)
        .sort((a, b) => b[1] - a[1] || Number(b[0]) - Number(a[0])).map(([year]) => year).slice(0, 4);
}
const ENUMERATED_PROVISION = /^(?:[가-하][.)]|\d{1,2}[.)]|\(\s*\d{1,2}\s*\)|\(\s*[가-하]\s*\)|[IVX]{1,4}\.)\s/;
const lineWidth = (line: string) => [...line].reduce((sum, char) => sum + (/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿！-｠■□◆◇●○▣]/u.test(char) ? 2 : 1), 0);
export function stableFragments(text: string, limit = 3): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const rows = NFKC(text).split('\n').map(raw => raw.replace(/\s+/g, ' ').trim());
    const widths = rows.filter(row => row && row.length <= 200).map(lineWidth);
    const column = Math.max(0, ...widths);
    const paragraphed = column > 0 && widths.filter(width => width >= column * 0.8).length >= 4;
    let previous = '';
    for (const line of rows.slice(0, 40)) {
        const before = previous;
        previous = line;
        if (!line)
            continue;
        const words = line.split(' ').filter(Boolean);
        if (words.length < 5 || words.length > 20 || line.length > 160)
            continue;
        if (ENUMERATED_PROVISION.test(line))
            continue;
        if (paragraphed && before && lineWidth(before) >= column * 0.9)
            continue;
        if (isNotATitle(line))
            continue;
        if (/[.!?]\s+[A-Z가-힣]/.test(line) || /^\p{Ll}/u.test(line))
            continue;
        if ((line.match(/\d/g) || []).length > 6)
            continue;
        if (/[@|/=<>{}\\]/.test(line))
            continue;
        const letters = (line.match(/\p{L}/gu) || []).length;
        if (letters / line.length < 0.6)
            continue;
        const key = line.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(line);
        if (out.length >= limit)
            break;
    }
    return out;
}
export interface ClueSource {
    fields?: Record<string, any>;
    recordFields?: Record<string, any>;
    scopeOf?: DocumentClues['scopeOf'];
    sources?: Record<string, any>;
    alternatives?: Record<string, any>;
    itemType?: string | null;
    held?: Record<string, any>;
    pages: Array<{
        page: number;
        text: string;
        kind?: string;
    }>;
    documentPages?: number;
}
function numberPart(value: unknown): string {
    return (/\d{1,5}/.exec(clean(value)) || [])[0] || '';
}
function printedFolioRun(pages: Array<{
    page: number;
    text: string;
}>): {
    offset: number;
    pages: number[];
} | undefined {
    const byOffset = new Map<number, Set<number>>();
    for (const page of pages) {
        for (const candidate of folioCandidates(String(page.text || '').slice(0, 20000))) {
            const offset = candidate.folio - page.page;
            if (offset < 0)
                continue;
            const held = byOffset.get(offset) || new Set<number>();
            held.add(page.page);
            byOffset.set(offset, held);
        }
    }
    const ranked = [...byOffset.entries()].map(([offset, held]) => ({ offset, pages: [...held].sort((a, b) => a - b) })).filter(entry => entry.pages.length >= 2)
        .sort((a, b) => b.pages.length - a.pages.length);
    if (!ranked.length || (ranked[1] && ranked[1].pages.length === ranked[0].pages.length))
        return undefined;
    const run = ranked[0];
    return run.offset + run.pages[0] > 1 ? run : undefined;
}
function pageEvidence(pages: Array<{
    page: number;
    text: string;
    kind?: string;
}>): EvidenceBundle {
    return { observations: pages.map((page, index) => observation(page.kind === 'ocrText' ? 'ocrText' : 'pdfText', `${page.kind === 'ocrText' ? 'OCR ' : ''}page ${page.page}`, page.text, { index })) };
}
function spacedPattern(value: string): RegExp {
    return new RegExp(value.split('').map(character => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s{0,2}'), 'gi');
}
function doiPrintedOutsideCitations(doi: string, pages: Array<{
    text: string;
}>): boolean {
    if (!doi)
        return false;
    const pattern = spacedPattern(doi);
    return pages.some(page => {
        const text = NFKC(page.text);
        const regions = citationRegions(text);
        return [...text.matchAll(pattern)].some(match => !regions.some(([start, end]) => (match.index ?? 0) >= start && (match.index ?? 0) < end));
    });
}
export function cluesFrom(source: ClueSource): DocumentClues {
    const fields = source.fields || {};
    const record = source.recordFields || {};
    const pages = [...source.pages].sort((a, b) => a.page - b.page)
        .map(page => ({ ...page, text: withoutOtherWorksIn(page.text) }));
    const structure = structureOfPages(pages, source.documentPages);
    const framed = pages.filter(page => page.page <= 3 || ['cover', 'titlePage', 'colophon'].includes(roleNameOf(structure, page.page)));
    const wrapperLeaf = (page: number) => structure.pages.some(entry => entry.page === page && entry.role === 'insertedLeaf' && entry.leaf === 'wrapper');
    const ownPages = framed.filter(page => !wrapperLeaf(page.page));
    const opening = ownPages.length ? ownPages : framed;
    const text = opening.map(page => page.text).join('\n\f\n');
    const first = pages[0]?.text || '';
    const ocr = pages.some(page => page.kind === 'ocrText');
    const titles: string[] = [];
    const pushTitle = (value: unknown): string | undefined => {
        const title = clean(value);
        const floor = /[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(title) ? 3 : 8;
        if (title.length < floor || isNotATitle(title))
            return undefined;
        const key = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
        const known = titles.find(entry => entry.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') === key);
        if (known)
            return known;
        titles.push(title);
        return title;
    };
    const recordTitle = pushTitle(titleUnderContract(record.title));
    const readTitle = pushTitle(titleUnderContract(fields.title));
    const readPeople = ((fields.creators || []) as any[]).filter(person => clean(person?.lastName || person?.name || person?.firstName));
    const numbering = [fields.volume, fields.issue].map(clean).filter(Boolean).join(' ');
    const printedOCR = pages.filter(page => page.kind === 'ocrText').map(page => page.text).join('\n');
    const printedLayer = pages.filter(page => page.kind !== 'ocrText').map(page => page.text).join('\n');
    const readType = storableType(String(source.itemType || '').trim() || 'document');
    const coverHeading = !!readTitle && !readPeople.length && ['journalArticle', 'magazineArticle', 'newspaperArticle', 'document'].includes(readType)
        && isSerialName(readTitle, { numbering, printed: printedOCR || printedLayer, layer: printedLayer, byline: readPeople });
    if (readTitle && (coverHeading || titleFailsContract(readTitle, pageEvidence(pages), storableType(String(source.itemType || '').trim() || 'document')))) {
        titles.splice(titles.indexOf(readTitle), 1);
    }
    const designation = legislationDesignation(pageEvidence(pages));
    const containingWork = designation?.act ? pushTitle(`${designation.act} ${designation.number}`) : undefined;
    for (const fragment of stableFragments(first))
        pushTitle(fragment);
    const surnames = [...new Set([...((fields.creators || []) as any[]), ...((record.creators || []) as any[])]
            .map(bylineName).filter(name => name.length >= 2))].slice(0, 6);
    const listedReading = !!recordOfAListedWork({ ISBN: fields.ISBN, DOI: fields.DOI, title: fields.title }, source.pages);
    const listedRecord = !!recordOfAListedWork({ ISBN: record.ISBN, DOI: record.DOI, title: record.title }, source.pages);
    const listed = otherWorksISBNs(source.pages);
    const statedISBNs = (value: unknown, listedOne: boolean) => {
        if (listedOne)
            return [];
        const found = isbnsIn(value);
        return (found.length ? found : [normalizedISBN(value)].filter(entry => entry.length === 10 || entry.length === 13)).filter(entry => !listed.includes(entry));
    };
    const readISBNs = statedISBNs(fields.ISBN, listedReading);
    const printedDOIs = doisOfTheDocument(pageEvidence(pages), readTitle);
    const layerStandings = doiStandingsOf(pages.filter(page => page.kind !== 'ocrText'), readTitle);
    const ocrStandings = doiStandingsOf(pages.filter(page => page.kind === 'ocrText'), readTitle);
    const firstStandings = (pages[0]?.kind === 'ocrText' ? ocrStandings : layerStandings).filter(entry => entry.page === pages[0]?.page);
    const scanned = printedDOIs[0] || firstStandings.find(entry => entry.own)?.value;
    const standings = [...layerStandings, ...ocrStandings];
    const printedElsewhereOnly = (value: string) => standings.some(entry => !entry.own && sameDOI(entry.value, value))
        && !standings.some(entry => entry.own && sameDOI(entry.value, value));
    const onlyInCitations = (value: string) => (pages.some(page => spacedPattern(value).test(NFKC(page.text))) && !doiPrintedOutsideCitations(value, pages))
        || printedElsewhereOnly(value);
    const readDOI = listedReading ? '' : clean(fields.DOI);
    const recordDOI = listedRecord ? '' : clean(record.DOI);
    const doi = scanned || (readDOI && !onlyInCitations(readDOI) ? readDOI : '')
        || (recordDOI && doiPrintedOutsideCitations(recordDOI, pages) && !printedElsewhereOnly(recordDOI) ? recordDOI : '') || undefined;
    const carriedDOI = recordDOI && recordDOI.toLowerCase() !== String(doi || '').toLowerCase() && !onlyInCitations(recordDOI) ? recordDOI : undefined;
    const printedISBNs = pages.flatMap(page => scanIdentifiers({ text: page.text, complete: true } as any).observations
        .filter(entry => entry.kind === 'ISBN' && entry.confidence !== 'ambiguous').map(entry => normalizedISBN(entry.value)).filter(Boolean));
    const isbn = [...new Set([
            ...printedISBNs,
            ...readISBNs
        ].filter(Boolean))];
    const carriedISBNs = statedISBNs(record.ISBN, listedRecord).map(normalizedISBN).filter(value => value && !isbn.includes(value));
    const citation = citationLineOf(first) || citationLineOf(pages[1]?.text || '');
    const ownVolume = statementsOf(pageEvidence(pages)).volume?.number || '';
    const hangul = (text.match(/[가-힣]/g) || []).length, latin = (text.match(/[A-Za-z]/g) || []).length;
    const script: DocumentClues['script'] = hangul > latin ? 'korean' : hangul > latin * 0.2 ? 'mixed' : 'latin';
    const named = String(source.itemType || '').trim();
    const stored = named ? storableType(named) : '';
    const type = stored && stored !== 'document' ? stored : named;
    const kind: DocumentKind = /journalArticle|conferencePaper|preprint/i.test(type) || !!citation || !!doi ? 'article'
        : /book/i.test(type) || isbn.length ? 'book'
            : /thesis/i.test(type) ? 'thesis'
                : /report|document|manual|datasheet|standard/i.test(type) ? 'report' : 'unknown';
    const years = statedYears(opening.map(page => ({ text: page.text, dated: statesTheWork(structure, page.page), stampRows: stampRowsIn(structure, page.page, page.text) })), [fields.date, ...((source.alternatives?.date || []) as any[]).map(entry => entry?.value ?? entry)]);
    const journalOfCover = coverHeading ? readTitle : !readTitle ? clean(fields.publicationTitle || fields.journalAbbreviation) : '';
    const volume = numberPart(fields.volume), issue = numberPart(fields.issue);
    const bannerYear = years[0] || (/^(?:1[5-9]|20)\d{2}/.exec(clean(fields.date)) || [])[0];
    const banner = journalOfCover && volume && (issue || bannerYear) && !citation
        ? { journal: journalOfCover, volume, ...(issue ? { issue } : {}), ...(bannerYear ? { year: bannerYear } : {}) } : undefined;
    const coordinates = !['book', 'thesis', 'report', 'patent', 'manuscript', 'presentation', 'webpage', 'computerProgram', 'dataset', 'standard'].includes(readType)
        ? coordinatesOf({ fields, pages, documentPages: source.documentPages, title: readTitle,
            surnames: ((fields.creators || []) as any[]).map(bylineName).filter(name => name.length >= 2) })
        : undefined;
    const run = printedFolioRun(opening.filter(page => page.page <= 5));
    const layered = new Set(opening.filter(page => page.kind !== 'ocrText').map(page => page.page));
    const ocrFolios = run ? opening.filter(page => page.kind === 'ocrText' && run.pages.includes(page.page) && layered.has(page.page))
        .map(page => ({ page: page.page, folios: folioCandidates(String(page.text || '').slice(0, 20000)).map(entry => entry.folio) })) : [];
    const folios = run ? { ...run, ...(ocrFolios.length ? { ocr: ocrFolios } : {}) } : undefined;
    return {
        kind, titles, readTitle, ...(recordTitle && recordTitle !== readTitle ? { recordTitle } : {}), ...(containingWork ? { containingWork } : {}), surnames, years,
        ...(readPeople.length ? { people: readPeople.map(person => ({ lastName: clean(person?.lastName || person?.name), firstName: clean(person?.firstName), ...(person?.fieldMode === 1 ? { fieldMode: 1 } : {}) })) } : {}),
        identifiers: { DOI: doi, ISBN: isbn }, ...(printedDOIs.length ? { printedDOIs } : {}),
        ...(carriedDOI || carriedISBNs.length ? { carried: { ...(carriedDOI ? { DOI: carriedDOI } : {}), ISBN: carriedISBNs } } : {}),
        ...(banner ? { banner } : {}), ...(source.scopeOf ? { scopeOf: source.scopeOf } : {}),
        ...(coordinates ? { coordinates } : {}),
        ...(Number(source.documentPages) > 0 ? { documentPages: Math.floor(Number(source.documentPages)) } : {}),
        ...(type ? { readType: type } : {}),
        citation,
        journal: clean(fields.publicationTitle || fields.journalAbbreviation) || citation?.journal,
        institution: clean(fields.institution || fields.university) || undefined,
        publisher: clean(fields.publisher) || undefined,
        docNumber: clean(fields.reportNumber) || undefined,
        edition: clean(fields.edition) || undefined,
        script, text, ocr, sources: source.sources,
        locators: { volume: clean(fields.volume) || undefined, issue: clean(fields.issue) || undefined,
            pages: clean(fields.pages) && !dayRangeOfADate(clean(fields.pages), pageEvidence(pages)) ? clean(fields.pages) : undefined },
        ...(folios ? { folios } : {}),
        ...(ownVolume ? { volume: ownVolume } : {}),
        held: source.held ? {
            publicationTitle: clean(source.held.publicationTitle) || undefined,
            journalAbbreviation: clean(source.held.journalAbbreviation) || undefined,
            volume: clean(source.held.volume) || undefined,
            issue: clean(source.held.issue) || undefined,
            pages: clean(source.held.pages) || undefined,
            DOI: clean(source.held.DOI) || undefined
        } : undefined
    };
}
const SENTENCE_RUNS_ON = /[.!?。][\s\u3000]*[^\s\u3000]/u;
export function askableAsQuery(text: unknown): boolean {
    const value = String(text ?? '').trim();
    if (value.length < 4 || value.length > 200)
        return false;
    if (isNotATitle(value) || looksLikeBodyProse(value))
        return false;
    const stops = (value.match(/[.!?。]/gu) || []).length;
    if (stops >= 2 && SENTENCE_RUNS_ON.test(value))
        return false;
    return true;
}
export function askableBySearchEngine(text: unknown): boolean {
    const value = String(text ?? '').trim();
    if (!value || /[:：]$/.test(value))
        return false;
    const words = value.split(/\s+/).filter(word => /\p{L}/u.test(word));
    if (/^[○●■□▶►•·※\-*]\s*/.test(value) || /(?:다|요|음|함)\.$/.test(value) || (words.length > 14 && /\.$/.test(value)))
        return false;
    const titleSized = (word: string) => (word.match(/[가-힣]/g) || []).length >= 3
        || (word.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length >= 4;
    return words.length >= 2 || words.some(titleSized);
}
export function buildQueries(clues: DocumentClues): SearchQuery[] {
    const out: SearchQuery[] = [];
    const bookish = clues.kind === 'book' || (clues.kind === 'unknown' && clues.identifiers.ISBN.length > 0);
    const koreanBook = bookish && clues.script !== 'latin';
    if (clues.identifiers.DOI)
        out.push({ kind: 'doi', text: clues.identifiers.DOI, providers: ['crossref'], note: 'DOI printed in the opening pages' });
    for (const isbn of clues.identifiers.ISBN.slice(0, 2)) {
        out.push({ kind: 'isbn', text: isbn, providers: koreanBook ? ['yes24', 'aladin', 'nlk', 'zoteroISBN'] : ['zoteroISBN', 'yes24'], note: 'ISBN printed in the opening pages' });
    }
    if (clues.citation?.journal) {
        out.push({ kind: 'citation', text: clues.citation.raw, providers: ['crossref'], note: 'the journal’s citation line of this article' });
    }
    if (clues.banner) {
        const { journal, volume, issue, year } = clues.banner;
        out.push({ kind: 'citation', text: `${journal} ${volume}${issue ? ` (${issue})` : ''}${year ? ` ${year}` : ''}`, providers: ['crossref'],
            note: 'the issue the cover’s banner states (journal, volume, issue, year) — the page prints no article title' });
    }
    if (clues.carried?.DOI)
        out.push({ kind: 'doi', text: clues.carried.DOI, providers: ['crossref'], note: 'DOI another route’s record states — not printed on the pages read' });
    for (const isbn of (clues.carried?.ISBN || []).slice(0, 2)) {
        out.push({ kind: 'isbn', text: isbn, providers: koreanBook ? ['yes24', 'aladin', 'nlk', 'zoteroISBN'] : ['zoteroISBN', 'yes24'], note: 'ISBN another route’s record states — not printed on the pages read' });
    }
    const first = clues.titles[0];
    const surname = clues.surnames[0];
    if (first && surname)
        out.push({ kind: 'titleAuthor', text: `${first} ${surname}`, providers: bookish ? ['yes24', 'crossref', 'google'] : ['crossref', 'google'], note: 'title as read, with the first surname' });
    if (bookish && clues.ocr && surname) {
        out.push({ kind: 'authorPublisher', text: [surname, clues.publisher].filter(Boolean).join(' '), providers: koreanBook ? ['yes24', 'google'] : ['google'],
            note: clues.publisher ? 'the by-line and the publisher the page names — the title was read by OCR' : 'the by-line — the title was read by OCR' });
    }
    for (const [index, title] of clues.titles.entries()) {
        const read = title === clues.recordTitle ? 'title another route’s record states' : 'title as read';
        if (index === 0 && first && surname && !bookish) {
            out.push({ kind: 'title', text: title, providers: ['crossref', 'google'], note: read });
        }
        else {
            out.push({ kind: index === 0 || title === clues.readTitle ? 'title' : 'fragment', text: title, providers: bookish ? (koreanBook ? ['yes24', 'google'] : ['crossref', 'yes24', 'google']) : ['crossref', 'google'],
                note: index === 0 || title === clues.readTitle ? read : title === clues.containingWork ? 'the work the page names itself a part of (the act of an annex), with its number'
                    : 'a stable run of title words from the opening page' });
        }
        if (index === 0 && first && clues.publisher && bookish) {
            out.push({ kind: 'titlePublisher', text: `${first} ${clues.publisher}`, providers: koreanBook ? ['google', 'yes24'] : ['google'], note: 'title with the publisher the page names' });
        }
    }
    if (first && clues.institution && clues.kind !== 'article') {
        out.push({ kind: 'titleInstitution', text: `${first} ${clues.institution}`, providers: ['crossref', 'google'], note: 'title with the issuing body' });
    }
    if (clues.docNumber && clues.institution) {
        out.push({ kind: 'docNumber', text: `${clues.docNumber} ${clues.institution}`, providers: ['crossref', 'google'], note: 'document number with the issuing body' });
    }
    const seen = new Set<string>();
    return out.map(query => query.providers.includes('google') && !askableBySearchEngine(query.text)
        ? { ...query, providers: query.providers.filter(provider => provider !== 'google') } : query).filter(query => {
        if (!query.providers.length)
            return false;
        if (query.kind !== 'doi' && query.kind !== 'isbn' && query.kind !== 'citation' && !askableAsQuery(query.text))
            return false;
        const key = `${query.kind}:${query.text.toLowerCase().replace(/\s+/g, ' ')}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
export function pagesStated(text: string): string[] {
    return readPageRanges(text).map(range => `${range.start}-${range.end}`.replace(/\s+/g, ''));
}
function numberPrinted(value: number | string, text: string, rangeStart = false): boolean {
    const digits = String(value ?? '').replace(/\D/g, '');
    const after = rangeStart ? '(?![\\d/]|[.,]\\d)' : '(?![\\d\\-–—/]|[.,]\\d)';
    return !!digits && new RegExp(`(?<![\\d\\-–—/]|\\d[.,])${digits}${after}`).test(text);
}
function issnPrinted(issn: string, text: string): boolean {
    return text.replace(/[\s-]/g, '').toUpperCase().includes(issn.replace(/-/g, '').toUpperCase());
}
function volumeOf(value: unknown): string {
    const text = clean(value).replace(/^[(（]?(?:1[5-9]|20)\d{2}[)）]?(?:\s*[,;:.]\s*|\s+)(?=\S)/u, '');
    return numberPart(text);
}
function pageSpanOf(value: unknown): {
    start: number;
    end?: number;
} | null {
    const found = /^\s*(?:pp?\.?\s*)?(\d{1,6})(?:\s*[-‐‑‒–—―−~]\s*(\d{1,6}))?\s*$/iu.exec(clean(value));
    if (!found)
        return null;
    const start = Number(found[1]), end = found[2] ? Number(found[2]) : undefined;
    if (!(start > 0) || (end !== undefined && (end < start || end - start >= 1000)))
        return null;
    return { start, ...(end !== undefined && end > start ? { end } : {}) };
}
const foldedLetters = (value: unknown) => NFKC(value).toLowerCase().replace(/[^\p{L}]+/gu, '');
function fileExtentOf(pages: Array<{
    page: number;
    text: string;
}>, leaves: Set<number>, start: number, end: number | undefined, documentPages: number | undefined): PrintedCoordinates['extent'] {
    if (!Number.isInteger(documentPages) || !documentPages || documentPages < 1)
        return undefined;
    const content = pages.filter(page => !leaves.has(page.page)).sort((a, b) => a.page - b.page);
    const opening = content[0]?.page;
    if (!opening || opening > documentPages)
        return undefined;
    const last = start + (documentPages - opening);
    if (end !== undefined && last > end)
        return undefined;
    const confirmed: Array<{
        page: number;
        folio: number;
    }> = [];
    for (const page of content) {
        if (page.page === opening)
            continue;
        const place = start + (page.page - opening);
        const folios = folioCandidates(page.text).map(entry => entry.folio).filter(folio => folio >= start && folio <= last);
        if (!folios.length)
            continue;
        if (!folios.includes(place))
            return undefined;
        if (!confirmed.some(entry => entry.page === page.page))
            confirmed.push({ page: page.page, folio: place });
    }
    if (last > start && !confirmed.length)
        return undefined;
    return { start, end: last, confirmed };
}
function titleRunsAsHead(title: string, pages: Array<{
    page: number;
    text: string;
}>, leaves: Set<number>, start: number, last: number): boolean {
    const key = foldedLetters(title);
    if (key.length < 4)
        return false;
    const content = pages.filter(page => !leaves.has(page.page)).sort((a, b) => a.page - b.page);
    return content.slice(1).some(page => folioCandidates(page.text).some(entry => entry.folio >= start && entry.folio <= last
        && foldedLetters(entry.line) === key));
}
export function coordinatesOf(input: {
    fields: Record<string, any>;
    pages: Array<{
        page: number;
        text: string;
        kind?: string;
    }>;
    documentPages?: number;
    title?: string;
    surnames?: string[];
}): PrintedCoordinates | undefined {
    const fields = input.fields || {};
    const pages = [...input.pages].sort((a, b) => a.page - b.page);
    const text = pages.map(page => NFKC(page.text)).join('\n');
    if (!text.trim())
        return undefined;
    const leaves = leafPages(structureOfPages(pages, input.documentPages));
    const heads = pages.filter(page => page.page <= 3 && !leaves.has(page.page)).map(page => journalHeadStatement(page.text)).filter(Boolean) as NonNullable<ReturnType<typeof journalHeadStatement>>[];
    const head = (field: 'journal' | 'abbreviation' | 'volume' | 'issue' | 'pages' | 'year') => heads.map(entry => entry[field]).find(Boolean) || '';
    const sources: PrintedCoordinates['sources'] = {};
    const pick = <T>(field: string, read: T | null | '', stands: boolean, masthead: T | null | ''): T | null | '' => {
        if (read && stands) {
            sources[field] = 'reading';
            return read;
        }
        if (masthead)
            sources[field] = 'masthead';
        return masthead;
    };
    const readVolume = volumeOf(fields.volume);
    const volume = pick('volume', readVolume, !!readVolume && numberPrinted(readVolume, text), numberPart(head('volume')));
    const readYear = (/^(?:1[5-9]|20)\d{2}/.exec(clean(fields.date)) || [])[0] || '';
    const year = pick('year', readYear, !!readYear && numberPrinted(readYear, text), head('year'));
    const readSpan = pageSpanOf(fields.pages);
    const span = pick('pages', readSpan, !!readSpan && readSpan.start > 1 && numberPrinted(readSpan.start, text, true), pageSpanOf(head('pages')));
    if (!volume || !year || !span)
        return undefined;
    const issueRead = numberPart(fields.issue);
    const issue = issueRead && numberPrinted(issueRead, text) ? issueRead : numberPart(head('issue'));
    const issns = [
        ...String(fields.ISSN ?? '').split(/[\s,;]+/).map(validISSN).filter(value => value && issnPrinted(value, text)),
        ...heads.flatMap(entry => entry.issn.map(validISSN)),
        ...pages.map(page => feeCodeISSN(page.text) || '')
    ].filter(Boolean);
    const ISSN = issns[0] || undefined;
    if (ISSN)
        sources.ISSN = String(fields.ISSN ?? '').includes(ISSN) ? 'reading' : 'masthead';
    const journal = clean(fields.publicationTitle) || head('journal') || head('abbreviation') || clean(fields.journalAbbreviation);
    if (journal)
        sources.journal = clean(fields.publicationTitle) ? 'reading' : 'masthead';
    if (!ISSN && !journal)
        return undefined;
    const extent = fileExtentOf(pages, leaves, span.start, span.end, input.documentPages);
    const title = clean(input.title) || undefined;
    const last = extent?.end ?? span.end ?? span.start;
    return {
        ...(journal ? { journal } : {}), ...(ISSN ? { ISSN } : {}), volume, ...(issue ? { issue } : {}), year,
        start: span.start, ...(span.end ? { end: span.end } : {}), ...(extent ? { extent } : {}),
        ...(title ? { title } : {}), runningHead: !!title && titleRunsAsHead(title, pages, leaves, span.start, Math.max(last, span.start + 1)),
        surnames: [...new Set(input.surnames || [])], sources
    };
}

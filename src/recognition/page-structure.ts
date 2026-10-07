import { CLOCK_TIME, IPV4_ADDRESS, canonicalDate, carriesFolio, closesSentence, compact, continuesAcross, edgeKey, folioCandidates, issueHeadStatement, journalHeadStatement, pageCarriesWords, readDates, readVolumeIssue, splitBlocks, splitColumns, tidyOrganisation, withoutEdgeFolios, withoutEndMarks, type DatePrecision, type JournalHead, type RawBlock } from './roles';
import { LISTED_BOOK, isDateOnly, isInstitutionName, isIssueStatement, isOrganisationOnly, journalOfIssueStatement, serialNameShaped, statesAnIssue } from './title-guards';
import { isDegreeFormLine, isDegreeFormPage, isDegreeStatement } from './degree';
import { END_OF_REFERENCES, ENTRY_MARKER, citationSpansInPage, isReferenceListHeading, otherWorksISBNRegions } from './pdf-identifiers';
import { imprintMark, imprintSignal, rightsMark } from './imprint-marks';
import { CODE_TOKEN_SHAPE } from './title-grammar';
import { ROLE_ONLY_SOURCE } from './label-words';
import { HAN_INSTITUTION_UNIT, joinWrappedRows, misreadRoleWordLine, namesOfRow, peopleOfStatement, personShape, readBylineRow, rowIsByline } from './byline-row';
import { validISBN, validISSN } from '../metadata/identifier-compare';
import { NAME_AFTER_SCHOOL_WORD } from './agents';
import type { PageObservation } from './candidate';
export { edgeKey } from './roles';
export interface StructurePage {
    page: number;
    layer?: {
        text: string;
        stored?: string;
        layout?: string;
        lineHeights?: number[];
        truncated?: boolean;
        degraded?: boolean;
        glyphRisk?: boolean;
        encodingShift?: number;
    };
    ocr?: {
        text: string;
        truncated?: boolean;
    };
    size?: {
        width: number;
        height: number;
    };
    inserted?: boolean;
    readEmpty?: boolean;
}
export interface StructureInput {
    pages: StructurePage[];
    documentPages?: number;
}
export type PageRole = 'insertedLeaf' | 'cover' | 'halfTitle' | 'titlePage' | 'colophon' | 'formPage' | 'contents' | 'body' | 'references' | 'other';
export type LeafKind = 'foreignSize' | 'wrapper' | 'blank';
export type FormKind = 'submission' | 'approval' | 'degree' | 'labelled';
export type ForeignSignal = 'stamp' | 'otherEntries' | 'citedOnly' | 'issueCover';
export type RoleSignal = 'pageSize' | 'noWords' | 'openingPage' | 'outsideFolioRun' | 'insideFolioRun' | 'noSharedRunning' | 'displayBlock' | 'byline' | 'sameTitleAs' | 'differentTitle' | 'noClaim' | 'entryClaim' | ForeignSignal | 'formLines' | 'contentsEntries' | 'referenceRegion' | 'imprintBlock' | 'prose' | 'clauseList';
export interface PageEntry {
    page: number;
    role: PageRole;
    leaf?: LeafKind;
    form?: FormKind;
    because: Array<{
        signal: RoleSignal;
        detail?: string;
    }>;
    reading: 'layer' | 'ocr' | 'none';
    layer: 'readable' | 'broken' | 'none';
    folio?: {
        value: number;
        where: 'head' | 'foot';
    };
    claim?: {
        title: string;
        strength: 0 | 1 | 2 | 3;
        foreign: ForeignSignal[];
        entry?: boolean;
    };
    display?: {
        rows: [
            number,
            number
        ];
        height: number;
        basis: 'layout' | 'shape';
    };
    byline?: {
        rows: [
            number,
            number
        ];
    };
    titleBlock?: unknown;
}
export type RunningKind = 'runningHead' | 'runningFoot' | 'masthead' | 'downloadStamp' | 'documentNumber';
export interface RunningLine {
    key: string;
    kind: RunningKind;
    edge: 'head' | 'foot';
    pages: number[];
    carriesFolio: boolean;
    seen: Array<{
        page: number;
        row: number;
        rank: number;
        text: string;
        reading: 'layer' | 'ocr';
        basis: 'layout' | 'text';
    }>;
    cells: Array<{
        key: string;
        text: string;
        pages: number[];
    }>;
    codes: string[];
    issue: JournalHead | null;
    statement: {
        title?: string;
        names?: string[];
        beside?: 'names' | 'issue';
    } | null;
}
export type RegionKind = 'masthead' | 'stamp' | 'selfCitation' | 'references' | 'citation' | 'otherWorks' | 'imprint' | 'acknowledgements' | 'table' | 'contentsList';
export interface Region {
    kind: RegionKind;
    page: number;
    basis: 'text' | 'layout';
    rows: [
        number,
        number
    ];
    span?: [
        number,
        number
    ];
    because: string;
    identified?: boolean;
}
export interface PageStructure {
    pages: PageEntry[];
    opening: {
        page: number | null;
        afterLeaves: boolean;
    };
    leadingLeaves: number;
    frontMatter: number[];
    folioRun: {
        first: number;
        last: number;
        offset: number;
    } | null;
    running: RunningLine[];
    regions: Region[];
}
export const STRUCTURE = {
    edgeRows: 4, repeatPages: 2, rankSlack: 1, keyLetters: 4, display: 1.2, majority: 0.5,
    tableRows: 3, tableColumns: 2, imprintMarks: 2, proseRows: 3, proseWeight: 6, titleWeight: 16, bylineBlocks: 3,
    profileLetters: 20, storedLimit: 6000, lineChars: 400, listEntries: 3, entryWrap: 2, describedLines: 6, mastheadLead: 2
} as const;
function remembered<T extends string | number | boolean | null>(compute: (value: string) => T, longest: number = STRUCTURE.lineChars, entries = 20000): (value: string) => T {
    const held = new Map<string, T>();
    return (value: string) => {
        if (value.length > longest)
            return compute(value);
        const known = held.get(value);
        if (known !== undefined)
            return known;
        const answer = compute(value);
        if (held.size >= entries)
            held.clear();
        held.set(value, answer);
        return answer;
    };
}
const nfkcOf = (value: unknown) => String(value ?? '').replace(/ㆍ/g, '·').normalize('NFKC');
const nfkcText = remembered(nfkcOf);
const nfkc = (value: unknown) => typeof value === 'string' ? nfkcText(value) : nfkcOf(value);
const trimmedText = remembered(value => nfkc(value).replace(/\s+/g, ' ').trim());
const trimmed = (value: unknown) => typeof value === 'string' ? trimmedText(value) : nfkc(value).replace(/\s+/g, ' ').trim();
const lettersIn = remembered(value => (value.match(/\p{L}/gu) || []).length);
const CJK = /[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const YEAR = /(?<!\d)(?:1[5-9]|20)\d{2}(?!\d)/;
const widestColumnOf = remembered((row: string) => {
    const columns = splitColumns(nfkc(row));
    if (columns.length <= 1)
        return (columns[0] ?? '').trim();
    return columns.reduce((best, column) => lettersIn(column) > lettersIn(best) ? column : best).trim().replace(/\s+/g, ' ');
});
function widestColumn(row: string): string {
    return widestColumnOf(typeof row === 'string' ? row : String(row ?? ''));
}
const weightOf = remembered((value: string) => {
    const latin = (value.match(/[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]{2,}/gu) || []).length;
    const cjk = (value.match(/[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
    return latin + cjk / 3;
});
const endsSentence = remembered((value: string) => closesSentence(value) || (WORD_STOP.test(value) && weightOf(value) >= STRUCTURE.proseWeight));
const WORD_STOP = /(?<=\p{L}{2}[^\S\n]?)[.。!?]["”’)\]]?$/u;
const LOWER_STOP = /(?<=\p{Ll}{2})[.!?]["”’)\]]?$/u;
const REPORT_CLAUSE = /[가-힣](?:음|임|함|됨|짐|킴|옴|냄|봄|줌)[.。]?["”’)]?$/u;
const SENTENCE_SEAM = /(?<=\p{Ll}{2}[^\S\n]?)[.!?]["”’)]?\s+\p{Lu}(?:\p{Ll}|[^\S\n]\p{Ll}{2})|(?:^|[가-힣])다[.。]\s+[가-힣]/u;
const CLOCK = { test: (value: string) => CLOCK_TIME.test(value) };
const IPV4 = { test: (value: string) => IPV4_ADDRESS.test(value) };
function stampShaped(value: string, neighbours: string[] = []): boolean {
    if (!CLOCK.test(value) && !IPV4.test(value))
        return false;
    return [value, ...neighbours].some(row => !!row && readDates(row).some(entry => entry.precision === 'day'));
}
const LABEL_OPENED = /^\p{L}[\p{L} .]{0,20}:(?!\/\/)\s*\S/u;
const LABEL_INSIDE = /\p{L}\s*:(?!\/\/)\s*\S/u;
function withStampOpeners(rows: string[], stamp: Set<number>): void {
    for (const at of [...stamp]) {
        const above = at - 1;
        if (above < 0 || stamp.has(above) || !rows[above])
            continue;
        const opener = rows[above];
        if (/:$/.test(opener) || (LABEL_OPENED.test(rows[at]) && LABEL_INSIDE.test(opener)))
            stamp.add(above);
    }
}
const PAGE_OF_TOTAL = /\bpage[^\S\n]*\d{1,4}[^\S\n]*(?:of|\/)[^\S\n]*\d{1,4}\b/i;
const BARE_FOLIO = /^(?:[-–—][^\S\n]*)?(?:\d{1,4}|[ivxlcdm]{1,7})(?:[^\S\n]*[-–—])?$/;
const ROMAN_FOLIO = /^[ivxlc]{1,6}[^\S\n]+\S|\S[^\S\n]+[ivxlc]{1,6}$/;
const foliatedText = remembered((row: string) => carriesFolio(row) || PAGE_OF_TOTAL.test(nfkc(row)) || ROMAN_FOLIO.test(nfkc(row).trim()));
const foliated = (row: string) => typeof row === 'string' ? foliatedText(row) : carriesFolio(row) || PAGE_OF_TOTAL.test(nfkc(row)) || ROMAN_FOLIO.test(nfkc(row).trim());
function withoutTrailing(value: string, marks: string): string {
    let end = value.length;
    while (end > 0 && marks.includes(value[end - 1]))
        end--;
    return end === value.length ? value : value.slice(0, end);
}
function withoutLeading(value: string, marks: string): string {
    let start = 0;
    while (start < value.length && marks.includes(value[start]))
        start++;
    return start === 0 ? value : value.slice(start);
}
const serialNameText = remembered((value: string) => withoutTrailing(value.normalize('NFKC').replace(/\s+/g, ' ').trim(), '.,;').length <= 160 && serialNameShaped(value));
const serialName = (value: string) => serialNameText(String(value ?? ''));
const CODE_END = '.,;:';
const TOKEN_OPEN = '([{「', TOKEN_CLOSE = ')]}」,;:';
const unwrapped = (token: string) => {
    const opened = withoutLeading(token, TOKEN_OPEN);
    return withoutTrailing(opened, TOKEN_CLOSE);
};
const HOST = /(?:https?:\/\/|\bwww\.)\S|(?<![@\w.-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|edu|gov|int|info|ac|co|or|re|go|kr|jp|cn|de|uk|fr|it|es|ch|nl|se|au|ca|in|io|li|eu|us)(?:\/\S*)?(?![\w@])/i;
const EMAIL = /(?<![\w.+-])[\w.+-]+@[\w-]+\.[\w.-]+/;
const DOI_IN = /\b10\.\d{4,9}\/\S/;
const ISBN_IN = /\bISBN(?:-1[03])?\b/i;
const IDENTIFIER_ROW = /\b(?:doi|issn|isbn|e-?issn|p-?issn)\b\s*[:：]?|\b10\.\d{4,9}\//i;
const CONTAINER_ROW = /^(?:in|published\s+in|appeared\s+in)\s*[:：]\s*\S/i;
const COPYRIGHT_MARK = /©|ⓒ|\(c\)\s*(?:19|20)\d{2}|\bcopyright\b|all\s+rights\s+reserved/i;
const CODE_TOKEN = CODE_TOKEN_SHAPE;
export function codeToken(value: unknown): boolean {
    const token = withoutTrailing(String(value ?? '').trim(), CODE_END);
    if (!CODE_TOKEN.test(token))
        return false;
    if (/^(?:ISBN|ISSN|DOI|E?ISSN|P?ISSN)/i.test(token) || /^10\.\d/.test(token))
        return false;
    if (/^\d{1,4}[./-]\d{1,2}(?:[./-]\d{1,4})?$/.test(token) || /^\d{4}-\d{3}[\dX]$/.test(token))
        return false;
    if (HOST.test(token.toLowerCase()))
        return false;
    return !/^(?:p{1,2}\.?\d+|\d+\/\d+)$/i.test(token);
}
function bylineNames(value: string): string[] | null {
    if (!value || value.length > 300)
        return null;
    const row = readBylineRow(value);
    if (row.kind === 'none' || row.kind === 'affiliation' || row.kind === 'contact')
        return null;
    const names = namesOfRow(row);
    return names.length ? names : null;
}
const ROLE_LABEL = new RegExp(`^(?:${ROLE_ONLY_SOURCE})\\s*[:：]?$`, 'iu');
function bylineRow(value: string, single = true): boolean {
    if (!value || value.length > 300)
        return false;
    const kind = readBylineRow(value).kind;
    if (kind === 'shortened')
        return false;
    if (kind === 'pair')
        return true;
    const misread = misreadRoleWordLine(value);
    if (misread && misread.names.every(name => personShape(name).person !== 'no'))
        return true;
    return rowIsByline(value, single ? 'seated' : 'strict');
}
const labelledByline = (value: string) => readBylineRow(value).kind === 'labelled';
function spacedHangulNameRow(value: string): boolean {
    const text = trimmed(value);
    if (!/^[가-힣](?:[^\S\n][가-힣]){1,3}$/u.test(text))
        return false;
    const shape = personShape(text.replace(/\s+/g, ''), { marked: true });
    return shape.person !== 'no' && shape.script === 'hangul';
}
const LEGAL_FORM = /(?<![\p{L}'’-])(?:Inc|Ltd|LLC|GmbH|Corp|PLC|S\.A|B\.V|K\.K)\.?(?![\p{L}])|\(주\)|㈜|주식회사|株式会社|有限公司/u;
const INSTITUTION_HEAD = new RegExp(String.raw `(?<![\p{L}\p{N}])(?:University|${NAME_AFTER_SCHOOL_WORD}|Institute|Institut|Department|Dept\.|Faculty|School|College|Laborator(?:y|ies)|Cent(?:er|re)|Academy|Hospital|Corporation)(?![\p{L}\p{N}])`, 'u');
const KOREAN_UNIT = /(?:학과|학부|전공|과정|대학원|대학교|연구소|연구원)$/;
const responsibilityText = remembered(responsibilityRowOf);
function responsibilityRow(value: string): boolean {
    return typeof value === 'string' ? responsibilityText(value) : responsibilityRowOf(value);
}
export function isResponsibilityRow(value: unknown): boolean {
    return responsibilityRow(trimmed(value));
}
function responsibilityRowOf(value: string): boolean {
    if (!value)
        return false;
    const body = value.replace(/^(?:©\s*)?(?:1[5-9]|20)\d{2}\s*[,.]?\s+/, '');
    if (isDegreeFormLine(value) || isDegreeStatement(value) || isInstitutionName(body) || isOrganisationOnly(body))
        return true;
    if (LEGAL_FORM.test(value))
        return true;
    if (isDateOnly(value) || ROLE_LABEL.test(value))
        return true;
    if (INSTITUTION_HEAD.test(value) && !bylineNames(value))
        return true;
    const tokens = value.split(' ');
    if (tokens.length <= 4 && tokens.some(token => KOREAN_UNIT.test(token)) && tokens.every(token => /^[가-힣]+$/.test(token)))
        return true;
    return tokens.length <= 4 && HAN_INSTITUTION_UNIT.test(value) && /^[\p{Script=Han}\s()（）]+$/u.test(value);
}
const FIELD_LABEL = /^[\p{L}][\p{L}\p{N}’'.-]*(?:[^\S\n][\p{L}\p{N}’'.-]+){0,3}[^\S\n]*[:：](?:[^\S\n]|$)/u;
const titleShapes = [0, 1, 2, 3].map(flags => remembered((value: string) => titleShapeOf(value, (flags & 1) === 1, (flags & 2) === 2)));
function titleShaped(value: string, display: boolean, allowNames = false): boolean {
    if (typeof value !== 'string')
        return titleShapeOf(value, display, allowNames);
    return titleShapes[(display ? 1 : 0) + (allowNames ? 2 : 0)](value);
}
function titleShapeOf(value: string, display: boolean, allowNames = false): boolean {
    if (!value || value.length < 3 || value.length > 300)
        return false;
    const letters = lettersIn(value);
    if (letters < 3 || letters * 2 < value.replace(/\s+/g, '').length)
        return false;
    if (weightOf(value) > STRUCTURE.titleWeight)
        return false;
    if (/[:：]$/.test(value) && !display)
        return false;
    if (endsSentence(value) || LOWER_STOP.test(value) || SENTENCE_SEAM.test(value))
        return false;
    if (isDateOnly(value) || statesAnIssue(value) || isIssueStatement(value))
        return false;
    if (readDates(value).some(entry => entry.precision === 'day'))
        return false;
    if (FIELD_LABEL.test(value) && !/\p{L}{3,}/u.test(value.replace(FIELD_LABEL, '').replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi, '')))
        return false;
    if (HOST.test(value) || EMAIL.test(value) || IDENTIFIER_ROW.test(value) || COPYRIGHT_MARK.test(value) || CONTAINER_ROW.test(value))
        return false;
    if (CLOCK.test(value) || IPV4.test(value))
        return false;
    if (codeToken(value) || (!allowNames && bylineRow(value, false)) || responsibilityRow(value))
        return false;
    if (display)
        return true;
    const latinWords = (value.match(/[\p{Script=Latin}]{2,}/gu) || []).length;
    const cjk = (value.match(/[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
    return latinWords >= 2 || cjk >= 4 || (latinWords >= 1 && cjk >= 2);
}
function typeDateRow(value: string): boolean {
    if (!value || value.length > 80 || weightOf(value) > 5 || !YEAR.test(value) || isDateOnly(value))
        return false;
    return /(?<=\p{L}{3})\s*[·•|–—,]\s*\S/u.test(value);
}
function entrySourceRow(value: string): boolean {
    if (typeDateRow(value))
        return true;
    if (!value || value.length > 200 || !YEAR.test(value))
        return false;
    const cut = /^(.+?)\s*[·•]\s*([^·•]+)$/u.exec(value);
    if (!cut || !isDateOnly(cut[2].trim()))
        return false;
    const head = cut[1].trim();
    return /^\p{L}+(?:\s\p{L}+)?\s(?:in|for)[:\s]\s*\p{L}/u.test(head) && weightOf(head) <= 16 && !LOWER_STOP.test(head) && !/[.!?]$/.test(head);
}
function wrappedTitleTail(value: string): boolean {
    if (!value || IDENTIFIER_ROW.test(value) || HOST.test(value) || bylineRow(value, false))
        return false;
    return codeToken(value) || (/^\p{Ll}/u.test(value) && weightOf(value) <= 8 && !LOWER_STOP.test(value));
}
export function sameTitle(a: unknown, b: unknown): boolean {
    const matches = (left: string, right: string) => {
        if (!left || !right)
            return false;
        if (left === right)
            return true;
        const [short, long] = left.length <= right.length ? [left, right] : [right, left];
        return short.length >= 8 && long.startsWith(short);
    };
    if (matches(compact(a), compact(b)))
        return true;
    const bare = (value: unknown) => compact(String(value ?? '').replace(/\([^()\n]{0,40}\)|\[[^\[\]\n]{0,40}\]/g, ' '));
    if (matches(bare(a), bare(b)))
        return true;
    return sharesAParallelPart(a, b);
}
const PARALLEL_PART_LETTERS = 8;
const SCRIPT_RUN = /^\p{N}+|[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}][가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{N}]*|(?:(?![가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\p{L})(?:(?![가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[\p{L}\p{N}])*/gu;
function parallelPartsOf(value: unknown): string[] {
    const letters = nfkc(String(value ?? '')).replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
    const parts: string[] = [];
    let lead = '';
    for (const run of letters.matchAll(SCRIPT_RUN)) {
        if (run.index === 0 && /^\p{N}/u.test(run[0]) && !/[\p{L}]/u.test(run[0])) {
            lead = run[0];
            continue;
        }
        parts.push(lead + run[0]);
        lead = '';
    }
    if (lead)
        parts.push(lead);
    return parts.filter(part => part.length >= PARALLEL_PART_LETTERS);
}
function sharesAParallelPart(a: unknown, b: unknown): boolean {
    const left = parallelPartsOf(a), right = parallelPartsOf(b);
    if (left.length < 2 && right.length < 2)
        return false;
    const theirs = new Set(right);
    return left.some(part => theirs.has(part));
}
function sameWork(title: string, text: string, otherTitle: string, otherText: string): boolean {
    if (sameTitle(title, otherTitle))
        return true;
    const own = compact(title), other = compact(otherTitle);
    return (own.length >= 8 && compact(otherText).includes(own)) || (other.length >= 8 && compact(text).includes(other));
}
interface Reading {
    kind: 'layer' | 'ocr';
    text: string;
    rows: string[];
    starts: number[];
    basis: 'layout' | 'text';
    basisRows: string[];
    heights: number[] | null;
    truncated: boolean;
}
interface Entry {
    title: string;
    rows: [
        number,
        number
    ];
}
interface Work {
    page: number;
    input: StructurePage;
    layer: 'readable' | 'broken' | 'none';
    primary: Reading | null;
    readings: Reading[];
    words: boolean;
    bodySize: number;
    folios: Array<{
        folio: number;
        where: 'head' | 'foot';
        line: string;
    }>;
    textRunning: Set<number>;
    textStamp: Set<number>;
    basisRunning: Set<number>;
    basisHeadRunning: Set<number>;
    basisStamp: Set<number>;
    regions: Region[];
    excludedCompact: Set<string>;
    excludedJoined: string;
    textProse: boolean[];
    basisProse: boolean[];
    prose: boolean;
    firstProseBasisRow: number;
    masthead: [
        number,
        number
    ] | null;
    display: PageEntry['display'];
    byline: PageEntry['byline'];
    claimTitle: string;
    claimRows: [
        number,
        number
    ] | null;
    strength: 0 | 1 | 2 | 3 | null;
    entryClaim: boolean;
    foreign: ForeignSignal[];
    entries: Entry[];
    form: FormKind | null;
    issueCover: boolean;
    coverSheet?: boolean;
    clauses?: boolean;
}
const SPACED_SEPARATOR = /(^|\s)[•·‧∙|–—](?=\s|$)/g;
function unreadableLayer(text: string, flagged: boolean): boolean {
    const visible = text.replace(SPACED_SEPARATOR, '$1').replace(/\s+/g, '');
    return flagged || (visible.length > 40 && (visible.match(/[~{}|^\\`°•]/g) || []).length / visible.length > 0.02);
}
function layerStatusOf(page: StructurePage): 'readable' | 'broken' | 'none' {
    const layer = page.layer;
    if (!layer)
        return 'none';
    const counted = String(layer.stored ?? String(layer.text || '').slice(0, STRUCTURE.storedLimit)).normalize('NFKC');
    if ((counted.match(/[\p{L}\p{N}]/gu) || []).length < STRUCTURE.profileLetters)
        return 'none';
    const flagged = !!(layer.degraded || layer.glyphRisk || layer.encodingShift);
    return unreadableLayer(counted, flagged) ? 'broken' : 'readable';
}
const foldedLine = (value: string) => nfkc(value).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
function trigramsOf(value: string): string[] {
    const chars = [...value];
    const out: string[] = [];
    for (let at = 0; at + 3 <= chars.length; at++)
        out.push(chars[at] + chars[at + 1] + chars[at + 2]);
    return out;
}
function countedLines(text: string): string[] {
    return text.slice(0, STRUCTURE.storedLimit).split('\n').map(foldedLine)
        .filter(line => (line.match(/\p{L}/gu) || []).length >= STRUCTURE.keyLetters).slice(0, 400);
}
export function readingsShareNoLine(layerText: unknown, ocrText: unknown): boolean {
    const layer = countedLines(String(layerText ?? '')), ocr = countedLines(String(ocrText ?? ''));
    if (layer.length < 2 || ocr.length < 2)
        return false;
    const shared = (line: string, other: Set<string>) => {
        const grams = trigramsOf(line);
        if (!grams.length)
            return false;
        let hit = 0;
        for (const gram of grams)
            if (other.has(gram))
                hit++;
        return hit * 2 >= grams.length;
    };
    const layerGrams = new Set(trigramsOf(layer.join(''))), ocrGrams = new Set(trigramsOf(ocr.join('')));
    return !ocr.some(line => shared(line, layerGrams)) && !layer.some(line => shared(line, ocrGrams));
}
function rowsWithStarts(text: string): {
    rows: string[];
    starts: number[];
} {
    const rows = text.split('\n');
    const starts: number[] = [];
    let cursor = 0;
    for (const row of rows) {
        starts.push(cursor);
        cursor += row.length + 1;
    }
    return { rows, starts };
}
function readingOf(kind: 'layer' | 'ocr', page: StructurePage): Reading | null {
    if (kind === 'layer') {
        const layer = page.layer;
        const text = String(layer?.text ?? '');
        if (!layer || (!text.trim() && !String(layer.layout ?? '').trim()))
            return null;
        const { rows, starts } = rowsWithStarts(text);
        const layout = String(layer.layout ?? '');
        const laid = !!layout.trim();
        const heights = laid && Array.isArray(layer.lineHeights) && layer.lineHeights.length ? layer.lineHeights.map(Number) : null;
        return { kind, text, rows, starts, basis: laid ? 'layout' : 'text', basisRows: laid ? layout.split('\n') : rows, heights, truncated: !!layer.truncated };
    }
    const text = String(page.ocr?.text ?? '');
    if (!text.trim())
        return null;
    const { rows, starts } = rowsWithStarts(text);
    return { kind, text, rows, starts, basis: 'text', basisRows: rows, heights: null, truncated: !!page.ocr?.truncated };
}
const lowerMedian = (values: number[]) => {
    const sorted = values.filter(value => value > 0).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
};
const filledCache = new WeakMap<string[], number[]>();
const filledRows = (rows: string[]) => {
    const held = filledCache.get(rows);
    if (held)
        return held;
    const filled = rows.map((row, at) => row.trim() ? at : -1).filter(at => at >= 0);
    filledCache.set(rows, filled);
    return filled;
};
function widestValues(rows: string[]): string[] {
    const shapes = rowShapesOf(rows);
    if (!shapes.complete) {
        for (let at = 0; at < rows.length; at++)
            if (shapes.value[at] === undefined)
                shapes.value[at] = widestColumn(rows[at]);
        shapes.complete = true;
    }
    return shapes.value;
}
const trimmedCache = new WeakMap<string[], string[]>();
const CLAUSE_ROWS = 4;
function clauseListOf(work: Work): boolean {
    const reading = work.primary;
    if (!reading || work.prose || work.byline || work.display?.basis === 'layout')
        return false;
    const rows = trimmedRows(reading.rows);
    let filled = 0, clauses = 0;
    rows.forEach((row, at) => {
        if (!row || work.textRunning.has(at) || work.textStamp.has(at) || lettersIn(row) < 2)
            return;
        filled++;
        const value = widestColumn(row);
        if (endsSentence(value) || SENTENCE_SEAM.test(value))
            clauses++;
    });
    return clauses >= CLAUSE_ROWS && clauses * 2 >= filled;
}
function trimmedRows(rows: string[]): string[] {
    const held = trimmedCache.get(rows);
    if (held)
        return held;
    const values = rows.map(trimmed);
    trimmedCache.set(rows, values);
    return values;
}
function edgeRowsOf(rows: string[], truncated: boolean): Array<{
    row: number;
    rank: number;
    edge: 'head' | 'foot';
}> {
    const filled = filledRows(rows);
    const out: Array<{
        row: number;
        rank: number;
        edge: 'head' | 'foot';
    }> = [];
    const last = filled.length - 1;
    filled.slice(0, STRUCTURE.edgeRows).forEach((row, rank) => { if (truncated || rank <= last - rank)
        out.push({ row, rank, edge: 'head' }); });
    if (!truncated)
        filled.slice(-STRUCTURE.edgeRows).reverse().forEach((row, rank) => { if (rank < last - rank || last === 0)
            out.push({ row, rank, edge: 'foot' }); });
    return out;
}
const cellKeyOf = remembered((cell: string) => edgeKey(cell).replace(/(?:^|\s)(?:page\s*#(?:\s*of\s*#)?|#\s*\/\s*#)(?=\s|$)/g, ' ').replace(/\s+[ivxlc]{1,6}$/, '')
    .replace(/\s+/g, ' ').trim());
function cellKey(cell: string): string {
    return cellKeyOf(typeof cell === 'string' ? cell : String(cell ?? ''));
}
const keyLetters = (key: string) => lettersIn(key);
const rowKeyOf = remembered((row: string) => {
    const lone = withoutTrailing(withoutEdgeFolios(trimmed(row)), CODE_END);
    return codeToken(lone) ? lone : edgeKey(row);
});
function rowKey(row: string): string {
    return typeof row === 'string' ? rowKeyOf(row) : rowKeyOf(String(row ?? ''));
}
interface Occurrence {
    page: number;
    row: number;
    rank: number;
    text: string;
    reading: 'layer' | 'ocr';
    basis: 'layout' | 'text';
    numbered?: boolean;
}
function repeatedGroups(groups: Map<string, Occurrence[]>, furniture: (value: string) => boolean = () => false): Map<string, Occurrence[]> {
    const out = new Map<string, Occurrence[]>();
    for (const [id, all] of groups) {
        const numbered = all.filter(entry => entry.numbered ?? foliated(entry.text));
        const seen = numbered.length && numbered.length < all.length && !all.some(entry => furniture(entry.text)) ? numbered : all;
        const rankOf = new Map<number, number>();
        for (const entry of seen)
            rankOf.set(entry.page, Math.min(rankOf.get(entry.page) ?? Infinity, entry.rank));
        const ranks = [...rankOf.values()].sort((a, b) => a - b);
        const middle = ranks[Math.floor((ranks.length - 1) / 2)];
        const kept = seen.filter(entry => Math.abs((rankOf.get(entry.page) ?? 0) - middle) <= STRUCTURE.rankSlack);
        if (new Set(kept.map(entry => entry.page)).size >= STRUCTURE.repeatPages)
            out.set(id, kept);
    }
    return out;
}
function codesInRow(value: string): string[] {
    return nfkc(value).split(/\s+/).map(unwrapped).filter(codeToken);
}
const furnitureShaped = remembered((value: string) => {
    const bare = withoutEdgeFolios(trimmed(value)).trim();
    return isIssueStatement(bare) || !!journalHeadStatement(bare) || serialName(bare) || HOST.test(bare) || codeToken(bare)
        || CLOCK.test(bare) || IPV4.test(bare) || statesAnIssue(bare);
});
function runningLinesOf(works: Work[]): RunningLine[] {
    const rows = new Map<string, Occurrence[]>();
    const cells = new Map<string, Occurrence[]>();
    const cellText = new Map<string, string>();
    const run = folioRunOf(works);
    const bareFolioOf = (page: number, value: string) => {
        if (!BARE_FOLIO.test(value))
            return false;
        const digits = /\d{1,4}/.exec(value)?.[0];
        return !run || !digits || Number(digits) - page === run.offset;
    };
    for (const work of works) {
        for (const reading of work.primary ? [work.primary] : []) {
            for (const { row, rank, edge } of edgeRowsOf(reading.basisRows, reading.truncated)) {
                const text = reading.basisRows[row];
                if (endsSentence(widestColumn(text)) && !foliated(text))
                    continue;
                const filled = filledRows(reading.basisRows), index = filled.indexOf(row);
                const numbered = foliated(text) || [filled[index - 1], filled[index + 1]].some(at => at !== undefined && bareFolioOf(work.page, reading.basisRows[at].trim()));
                const seen: Occurrence = { page: work.page, row, rank, text: text.trim(), reading: reading.kind, basis: reading.basis, numbered };
                const key = rowKey(text);
                if (keyLetters(key) >= STRUCTURE.keyLetters || codeToken(key)) {
                    const id = `${edge}\u0000${key}`;
                    rows.set(id, [...(rows.get(id) || []), seen]);
                }
                const columns = splitColumns(nfkc(text));
                if (columns.length < 2)
                    continue;
                for (const column of columns) {
                    const cell = cellKey(column);
                    if (keyLetters(cell) < STRUCTURE.keyLetters || cell === key)
                        continue;
                    const id = `${edge}\u0000${cell}`;
                    cells.set(id, [...(cells.get(id) || []), seen]);
                    if (!cellText.has(id))
                        cellText.set(id, column.trim());
                }
            }
        }
    }
    const prosePages = new Set(works.filter(work => work.primary && proseFlags(work.primary.basisRows, () => false).some(Boolean)).map(work => work.page));
    const furnitureGroup = (seen: Occurrence[]) => seen.some(entry => foliated(entry.text)) || seen.some(entry => furnitureShaped(entry.text))
        || seen.some(entry => prosePages.has(entry.page));
    const rowGroups = repeatedGroups(rows, furnitureShaped);
    const folioRows = new Set<string>();
    for (const work of works)
        for (const reading of work.primary ? [work.primary] : []) {
            for (const { row } of edgeRowsOf(reading.basisRows, reading.truncated))
                if (foliated(reading.basisRows[row]))
                    folioRows.add(`${work.page}\u0000${reading.kind}\u0000${row}`);
        }
    const besideFolioLine = (seen: Occurrence[]) => seen.every(entry => {
        const all = works.find(work => work.page === entry.page)?.readings.find(reading => reading.kind === entry.reading)?.basisRows || [];
        const filled = filledRows(all);
        const at = filled.indexOf(entry.row);
        return [filled[at - 1], filled[at + 1]].some(row => row !== undefined && folioRows.has(`${entry.page}\u0000${entry.reading}\u0000${row}`));
    });
    const numberedPages = new Set([...folioRows].map(held => Number(held.slice(0, held.indexOf('\u0000')))));
    const onNumberedPages = (seen: Occurrence[]) => new Set(seen.map(entry => entry.page)).size >= 3 && seen.every(entry => numberedPages.has(entry.page));
    const readPages = new Set(works.filter(work => work.primary && filledRows(work.primary.basisRows).length > 0).map(work => work.page));
    const aroundKeys = (entry: Occurrence) => {
        const all = works.find(work => work.page === entry.page)?.readings.find(reading => reading.kind === entry.reading)?.basisRows || [];
        const filled = filledRows(all);
        const at = filled.indexOf(entry.row);
        return [filled[at - 1], filled[at + 1]].filter((row): row is number => row !== undefined).map(row => rowKey(all[row]));
    };
    const apartOnEveryPage = (edge: string, seen: Occurrence[]) => {
        if (edge !== 'foot' || readPages.size < STRUCTURE.repeatPages)
            return false;
        const pages = new Set(seen.map(entry => entry.page));
        if ([...readPages].some(page => !pages.has(page)))
            return false;
        const counts = new Map<string, number>();
        let beside = 0;
        for (const entry of seen)
            for (const key of new Set(aroundKeys(entry))) {
                beside++;
                counts.set(key, (counts.get(key) || 0) + 1);
            }
        return beside > 0 && [...counts.values()].every(count => count < 2);
    };
    const furnitureLine = (id: string, seen: Occurrence[]) => furnitureGroup(seen) || besideFolioLine(seen) || onNumberedPages(seen)
        || apartOnEveryPage(id.slice(0, id.indexOf('\u0000')), seen);
    const headRowsOnPage = new Set<string>();
    for (const [id, seen] of rowGroups)
        if (id.startsWith('head\u0000'))
            for (const entry of seen)
                headRowsOnPage.add(`${entry.page}\u0000${entry.reading}\u0000${entry.row}`);
    const rowsAt = (entry: Occurrence) => works.find(work => work.page === entry.page)?.readings.find(reading => reading.kind === entry.reading)?.basisRows || [];
    const titleEcho = (id: string, seen: Occurrence[]) => {
        if (!id.startsWith('head\u0000') || seen.some(entry => foliated(entry.text) || furnitureShaped(entry.text)))
            return false;
        return seen.every(entry => {
            const all = rowsAt(entry), filled = filledRows(all);
            let at = filled.indexOf(entry.row);
            if (at < 0)
                return false;
            while (at + 1 < filled.length && headRowsOnPage.has(`${entry.page}\u0000${entry.reading}\u0000${filled[at + 1]}`))
                at++;
            const next = filled[at + 1];
            return next !== undefined && rowIsByline(nfkc(all[next]).trim(), 'strict');
        });
    };
    const echoesTheTitle = (id: string, seen: Occurrence[]) => titleEcho(id, seen) && !besideFolioLine(seen) && !onNumberedPages(seen) && !apartOnEveryPage(id.slice(0, id.indexOf('\u0000')), seen);
    const repeatedRows = new Map([...rowGroups].filter(([id, seen]) => furnitureLine(id, seen) && !echoesTheTitle(id, seen)));
    const repeatedCells = new Map([...repeatedGroups(cells, furnitureShaped)].filter(([id, seen]) => furnitureLine(id, seen)));
    const lines: RunningLine[] = [];
    const covered = new Set<string>();
    const where = (entry: Occurrence) => `${entry.page}\u0000${entry.reading}\u0000${entry.row}`;
    const build = (id: string, seen: Occurrence[]): RunningLine => {
        const edge = id.slice(0, id.indexOf('\u0000')) as 'head' | 'foot';
        const key = id.slice(edge.length + 1);
        const pages = [...new Set(seen.map(entry => entry.page))].sort((a, b) => a - b);
        const lineCells: RunningLine['cells'] = [];
        const mine = new Set(seen.map(where));
        for (const [cellId, cellSeen] of repeatedCells) {
            if (!cellId.startsWith(`${edge}\u0000`))
                continue;
            const here = cellSeen.filter(entry => mine.has(where(entry)));
            if (new Set(here.map(entry => entry.page)).size < STRUCTURE.repeatPages)
                continue;
            lineCells.push({ key: cellId.slice(edge.length + 1), text: cellText.get(cellId) || '', pages: [...new Set(here.map(entry => entry.page))].sort((a, b) => a - b) });
        }
        return { key, kind: edge === 'head' ? 'runningHead' : 'runningFoot', edge, pages, carriesFolio: seen.some(entry => foliated(entry.text)),
            seen: [...seen].sort((a, b) => a.page - b.page || a.row - b.row), cells: lineCells, codes: [], issue: null, statement: null };
    };
    for (const [id, seen] of repeatedRows) {
        lines.push(build(id, seen));
        for (const entry of seen)
            covered.add(where(entry));
    }
    for (const [id, seen] of repeatedCells) {
        const loose = seen.filter(entry => !covered.has(where(entry)));
        if (new Set(loose.map(entry => entry.page)).size < STRUCTURE.repeatPages)
            continue;
        const line = build(id, loose);
        line.cells = [{ key: line.key, text: cellText.get(id) || '', pages: line.pages }];
        lines.push(line);
        for (const entry of loose)
            covered.add(where(entry));
    }
    const rowsOf = (entry: Occurrence) => works.find(work => work.page === entry.page)?.readings.find(reading => reading.kind === entry.reading)?.basisRows || [];
    const neighbours = (entry: Occurrence) => {
        const all = rowsOf(entry);
        const filled = filledRows(all);
        const at = filled.indexOf(entry.row);
        return [filled[at - 1], filled[at + 1]].filter((row): row is number => row !== undefined).map(row => nfkc(all[row]));
    };
    for (const line of lines)
        if (line.seen.some(entry => stampShaped(nfkc(entry.text), neighbours(entry))))
            line.kind = 'downloadStamp';
    const addressRows = new Set(lines.filter(line => line.edge === 'foot' && line.seen.some(entry => HOST.test(nfkc(entry.text)))).flatMap(line => line.seen.map(where)));
    const addressNear = (entry: Occurrence) => {
        const filled = filledRows(rowsOf(entry));
        const at = filled.indexOf(entry.row);
        return [filled[at - 2], filled[at - 1], filled[at + 1], filled[at + 2]].some(row => row !== undefined && addressRows.has(`${entry.page}\u0000${entry.reading}\u0000${row}`));
    };
    for (const line of lines) {
        if (line.kind === 'downloadStamp' || line.edge !== 'foot')
            continue;
        if (line.seen.some(entry => isIssueStatement(trimmed(entry.text)) || journalHeadStatement(entry.text)))
            continue;
        if (line.seen.every(entry => addressNear(entry) && readDates(nfkc(entry.text)).some(reading => reading.precision === 'day')))
            line.kind = 'downloadStamp';
    }
    const stampRows = new Set(lines.filter(line => line.kind === 'downloadStamp').flatMap(line => line.seen.map(where)));
    const nextToStamp = (entry: Occurrence) => {
        const filled = filledRows(rowsOf(entry));
        const at = filled.indexOf(entry.row);
        return [filled[at - 1], filled[at + 1]].some(row => row !== undefined && stampRows.has(`${entry.page}\u0000${entry.reading}\u0000${row}`));
    };
    for (const line of lines) {
        if (line.kind === 'downloadStamp')
            continue;
        const beside = line.seen.every(entry => nextToStamp(entry) || neighbours(entry).some(row => stampShaped(row, [])));
        if (beside && !line.seen.some(entry => isIssueStatement(trimmed(entry.text)) || journalHeadStatement(entry.text)))
            line.kind = 'downloadStamp';
    }
    for (const line of lines) {
        if (line.kind === 'downloadStamp')
            continue;
        const texts = line.seen.map(entry => trimmed(entry.text));
        const lone = (value: string) => codeToken(withoutEdgeFolios(value));
        if (texts.some(lone) || line.cells.some(cell => codeToken(cell.text))) {
            line.kind = 'documentNumber';
            continue;
        }
        const first = texts[0] || '';
        const statement = issueHeadStatement(first);
        const issue = journalHeadStatement(first);
        const bare = withoutEdgeFolios(first).trim();
        if (line.edge === 'head' && statement === null
            && (issue || isIssueStatement(bare) || serialName(bare) || (HOST.test(bare) && weightOf(bare.replace(HOST, ' ')) < 3)))
            line.kind = 'masthead';
    }
    for (const line of lines) {
        const texts = line.seen.map(entry => trimmed(entry.text));
        const counts = new Map<string, Set<number>>();
        line.seen.forEach(entry => codesInRow(entry.text).forEach(code => counts.set(code, (counts.get(code) || new Set()).add(entry.page))));
        line.codes = [...counts].filter(([, pages]) => pages.size >= STRUCTURE.repeatPages).map(([code]) => code);
        if (line.kind === 'masthead' || line.kind === 'runningHead')
            line.issue = journalHeadStatement(texts[0] || '');
        if (line.kind === 'runningHead')
            line.statement = statementOf(texts[0] || '');
    }
    return lines.sort((a, b) => a.pages[0] - b.pages[0] || (a.edge === b.edge ? 0 : a.edge === 'head' ? -1 : 1) || a.key.localeCompare(b.key));
}
function peopleOf(value: string): string[] | null {
    return peopleOfStatement(value);
}
function headSeams(value: string): Array<[
    number,
    number
]> {
    const out: Array<[
        number,
        number
    ]> = [];
    for (let at = 0; at < value.length; at++) {
        const mark = value[at];
        if (mark === '/') {
            out.push([at, at + 1]);
            continue;
        }
        if ('―—|｜:：'.includes(mark) && at > 0 && at + 1 < value.length && /\s/.test(value[at - 1]) && /\s/.test(value[at + 1]))
            out.push([at, at + 1]);
    }
    return out;
}
function statementOf(head: string): RunningLine['statement'] {
    const value = withoutEdgeFolios(head).trim();
    if (value.length > STRUCTURE.lineChars)
        return null;
    const issueSide = issueHeadStatement(value);
    const side = issueSide ?? value;
    for (const [start, end] of headSeams(side)) {
        const left = side.slice(0, start).trim(), right = side.slice(end).trim();
        if (!left || !right)
            continue;
        const leftNames = peopleOf(left), rightNames = peopleOf(right);
        if (!!leftNames === !!rightNames)
            continue;
        const names = (leftNames || rightNames) as string[];
        const title = leftNames ? right : left;
        return isIssueStatement(title) || lettersIn(title) < 4 ? { names } : { names, title, beside: 'names' };
    }
    const names = peopleOf(side);
    if (names?.length)
        return { names };
    if (lettersIn(side) < 4)
        return null;
    return issueSide !== null ? { title: side, beside: 'issue' } : { title: side };
}
const SELF_CITATION_OPENER = /^[^\S\n]*(?:please[^\S\n]+)?(?:to[^\S\n]+cite[^\S\n]+this|cite[^\S\n]+(?:this|as)\b|citation[^\S\n]*[:：]|how[^\S\n]+to[^\S\n]+cite|recommended[^\S\n]+citation|this[^\S\n]+(?:article|paper|chapter|work)[^\S\n]+(?:can|should|may)[^\S\n]+be[^\S\n]+cited|인용[^\S\n]*(?:방법|정보|하기)?[^\S\n]*[:：])/i;
const ACKNOWLEDGEMENT_HEADING = /^[^\S\n]*(?:\d+\.?[^\S\n]*)?(?:acknowledge?ments?|funding|감사의[^\S\n]*글|사[^\S\n]*사)(?![\p{L}\p{N}])[^\n]{0,60}$/iu;
const FUNDING_SENTENCE = /^(?:this\s+(?:work|research|study|project|paper)\s+)?(?:(?:was|is|has\s+been)\s+)?(?:partially\s+|partly\s+|financially\s+|jointly\s+)?(?:supported|funded|sponsored|financed)\s+(?:by|through|under)\b/i;
const HEADING_ROW = /^[^\S\n]*\p{Lu}[\p{Lu}\s&|:'’-]{2,60}$/u;
const RUNS_ON = /(?:[,，&]|\b(?:in|by|with|of|and|through|from|for|to|under|at))[^\S\n]*$/i;
const DOT_LEADER = /[.·…][^\S\n]?[.·…][^\S\n]?[.·…][^\S\n]*[\dIVXLivxl]{1,4}[^\S\n]*$/;
const TRAILING_PAGE = /\S[^\S\n]+(\d{1,4})[^\S\n]*$/;
const CONTENTS_HEADING = /^(?:목\s*차|차\s*례|contents|table\s+of\s+contents?|inhalt(?:sverzeichnis)?|table\s+des\s+mati[èe]res|índice|sommaire)$/i;
const LISTED_EXTENT = /(?:1[5-9]|20)\d{2}\s*[.,;]\s*(?:[xivlc]+\s*,\s*)?\d{1,4}\s*(?:pp?\.|pages?(?!\p{L}))/iu;
const LISTED_PRICE = /(?:US\s?\$|[$£€¥]|\bDM\s|\bSFr\.?\s?)\s?\d{1,5}(?:[.,]\d{1,2})?(?!\d)/u;
const LISTED_BINDING = /\b(?:hard(?:cover|back|bound)|soft(?:cover|back|bound)|paper(?:back|bound)|cloth(?:bound)?)\b/i;
const LISTED_ISBN = /\(\s*ISBN\b/i;
const LISTED_MAKERS = /\bedited\s+by\b|,\s*eds?\.(?=[\s,;]|$)|,\s*by\s+\p{Lu}/u;
const FEE_CODE = /\b\d{4}-\d{3}[\dXx] ?\/ ?(?:\d{2,4} ?\/? ?)?\$ ?\d{1,5}(?:[.,]\d{1,2})?/gu;
const PARAGRAPH_SENTENCE_END = /[.!?]["”’)\]]?\s*$/u;
const PARAGRAPH_INITIAL_END = /(?:^|[^\p{L}])\p{Lu}\.["”’)\]]?\s*$/u;
const PARAGRAPH_ABBREVIATION_END = /(?:^|[^\p{L}])(?:eds?|vols?|nos?|pp?|inc|co|corp|ltd|jr|sr|dr|st|prof|al|cf|ca|trans|rev|repr|comp)\.["”’)\]]?\s*$/iu;
const PARAGRAPH_CONTINUED = /(?:[-‐,&:;]|\b(?:and|of|the|for|in|on|to|by|und|et))\s*$/iu;
function endsAParagraphLine(line: string): boolean {
    const value = line.trim();
    if (!value)
        return true;
    if (PARAGRAPH_SENTENCE_END.test(value) && !PARAGRAPH_INITIAL_END.test(value) && !PARAGRAPH_ABBREVIATION_END.test(value))
        return true;
    const words = value.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word));
    return words.length >= 2 && words.length <= 4 && !PARAGRAPH_CONTINUED.test(value);
}
const NUMERIC_CELL = /^[<>≤≥±~+\-−(]?[^\S\n]*\d[\d.,]*[^\S\n]*\)?[^\S\n]*\S{0,6}$/u;
function spanOf(reading: Reading, first: number, last: number): [
    number,
    number
] {
    return [reading.starts[first], reading.starts[last] + reading.rows[last].length];
}
function regionAt(kind: RegionKind, page: number, reading: Reading, first: number, last: number, because: string): Region {
    return { kind, page, basis: 'text', rows: [first, last], span: spanOf(reading, first, last), because };
}
function rowsOfSpan(reading: Reading, [start, end]: [
    number,
    number
]): [
    number,
    number
] {
    let first = 0, last = reading.rows.length - 1;
    for (let at = 0; at < reading.rows.length; at++)
        if (reading.starts[at] <= start)
            first = at;
    for (let at = reading.rows.length - 1; at >= 0; at--)
        if (reading.starts[at] < end) {
            last = at;
            break;
        }
    return [first, Math.max(first, last)];
}
function textRegions(work: Work, previousOpenReferences: boolean): {
    regions: Region[];
    referencesOpen: boolean;
} {
    const reading = work.primary;
    if (!reading)
        return { regions: [], referencesOpen: false };
    const rows = trimmedRows(reading.rows);
    const regions: Region[] = [];
    const page = work.page;
    const blocked = (at: number) => work.textRunning.has(at) || work.textStamp.has(at);
    const taken = new Set<number>();
    const take = (region: Region) => { regions.push(region); for (let at = region.rows[0]; at <= region.rows[1]; at++)
        taken.add(at); };
    for (const at of [...work.textStamp].sort((a, b) => a - b))
        take(regionAt('stamp', page, reading, at, at, 'a clock time or IPv4 beside a date'));
    for (let at = 0; at < rows.length; at++) {
        if (taken.has(at) || !SELF_CITATION_OPENER.test(rows[at]))
            continue;
        let end = at;
        const closed = (upTo: number) => {
            const row = rows[upTo];
            if (DOI_IN.test(row) && !/(?:DOI|doi)\s*[:：]?\s*$/.test(row))
                return true;
            return /[.)\]]\s*$/.test(row) && YEAR.test(rows.slice(at, upTo + 1).join(' '));
        };
        while (!closed(end)) {
            const next = end + 1;
            if (next >= rows.length || !rows[next] || blocked(next) || taken.has(next) || HEADING_ROW.test(rows[next])
                || (FIELD_LABEL.test(rows[next]) && !SELF_CITATION_OPENER.test(rows[next])))
                break;
            end = next;
        }
        take(regionAt('selfCitation', page, reading, at, end, 'opens with how to cite this document'));
        at = end;
    }
    let referencesOpen = false;
    const firstBody = rows.findIndex((row, at) => !!row && !blocked(at) && !BARE_FOLIO.test(row));
    const referenceStarts: number[] = [];
    if (previousOpenReferences && firstBody >= 0 && ENTRY_MARKER.test(rows[firstBody]))
        referenceStarts.push(firstBody);
    for (let at = 0; at < rows.length; at++) {
        if (!rows[at] || blocked(at) || taken.has(at) || !isReferenceListHeading(rows[at]))
            continue;
        if (reading.starts[at] <= 120) {
            const after = rows.slice(at + 1, at + 6).join('\n');
            if (!/^\s*(?:\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3}[.)])\s+\S/m.test(after) && !/\b(?:1[6-9]|20)\d{2}\b/.test(after))
                continue;
        }
        referenceStarts.push(at);
    }
    const footRows = referenceStarts.length ? pageFurnitureRows(reading.text) : new Set<number>();
    for (const start of referenceStarts) {
        if (taken.has(start))
            continue;
        let end = start;
        let closed = false;
        for (let at = start + 1; at < rows.length; at++) {
            if (blocked(at))
                continue;
            if (footRows.has(at) && !/(?:^|\s)\[\d{1,3}\]\s/.test(rows[at] || ''))
                break;
            if (rows[at] && END_OF_REFERENCES.test(rows[at])) {
                closed = true;
                break;
            }
            if (rows[at])
                end = at;
        }
        take(regionAt('references', page, reading, start, end, 'a reference list heading to the next section heading'));
        if (!closed)
            referencesOpen = true;
    }
    let furniture: Set<number> | null = null;
    const chunkStop = (at: number) => blocked(at) || (furniture ??= pageFurnitureRows(reading.text)).has(at);
    for (const span of citationSpansInPage(reading.text, { stopAt: chunkStop })) {
        const [first, last] = rowsOfSpan(reading, span);
        if (taken.has(first) && taken.has(last))
            continue;
        regions.push({ kind: 'citation', page, basis: 'text', rows: [first, last], span, because: 'a citation of another work' });
        for (let at = first; at <= last; at++)
            taken.add(at);
    }
    for (const span of otherWorksISBNRegions(reading.text)) {
        const [first, last] = rowsOfSpan(reading, span);
        regions.push({ kind: 'otherWorks', page, basis: 'text', rows: [first, last], span, because: 'entries of other works, each with its own ISBN', identified: true });
        for (let at = first; at <= last; at++)
            taken.add(at);
    }
    {
        let run: number[] = [];
        let gap = 0;
        const close = () => {
            if (run.length >= STRUCTURE.listEntries) {
                let end = run[run.length - 1];
                for (let next = end + 1, wrapped = 0; next < rows.length && wrapped < STRUCTURE.entryWrap; next++) {
                    if (!rows[next] || blocked(next) || taken.has(next) || !continuesAcross(rows[end], rows[next]))
                        break;
                    end = next;
                    wrapped++;
                }
                take(regionAt('otherWorks', page, reading, run[0], end, `${run.length} listed books (author: title)`));
            }
            run = [];
            gap = 0;
        };
        for (let at = 0; at < rows.length; at++) {
            if (!rows[at])
                continue;
            if (blocked(at) || taken.has(at)) {
                close();
                continue;
            }
            if (LISTED_BOOK.test(rows[at])) {
                run.push(at);
                gap = 0;
                continue;
            }
            if (run.length && gap < STRUCTURE.entryWrap) {
                gap++;
                continue;
            }
            close();
        }
        close();
    }
    {
        let start = -1, lines = 0;
        const close = (end: number) => {
            if (start >= 0 && lines && lines <= STRUCTURE.describedLines) {
                const paragraph = rows.slice(start, end + 1).filter(Boolean).join(' ');
                const described = [LISTED_EXTENT, LISTED_PRICE, LISTED_BINDING, LISTED_ISBN, LISTED_MAKERS].filter(mark => mark.test(paragraph.replace(FEE_CODE, ' '))).length;
                const free = !rows.slice(start, end + 1).some((row, index) => !!row && (taken.has(start + index) || blocked(start + index)));
                if (free && YEAR.test(paragraph) && !imprintSignal(paragraph) && described >= 2)
                    take(regionAt('otherWorks', page, reading, start, end, 'the bibliographic paragraph of another book'));
            }
            start = -1;
            lines = 0;
        };
        for (let at = 0; at < rows.length; at++) {
            if (start < 0)
                start = at;
            if (rows[at])
                lines++;
            if (endsAParagraphLine(rows[at]))
                close(at);
        }
        if (lines)
            close(rows.length - 1);
    }
    for (let at = 0; at < rows.length; at++) {
        if (!rows[at] || blocked(at) || !imprintMark(rows[at]))
            continue;
        let end = at, marks = 1;
        for (let next = at + 1; next < rows.length; next++) {
            if (!rows[next] || blocked(next))
                break;
            const marked = imprintMark(rows[next]);
            const runs = RUNS_ON.test(rows[next - 1]) || /^\p{Ll}/u.test(rows[next]);
            const bridged = !marked && next + 1 < rows.length && !!rows[next + 1] && imprintMark(rows[next + 1]);
            if (!marked && !runs && !bridged)
                break;
            if (marked)
                marks++;
            end = next;
        }
        if (marks >= STRUCTURE.imprintMarks)
            take(regionAt('imprint', page, reading, at, end, `${marks} imprint marks in one block`));
        at = end;
    }
    for (let at = 0; at < rows.length; at++) {
        if (!rows[at] || taken.has(at) || blocked(at))
            continue;
        const headed = ACKNOWLEDGEMENT_HEADING.test(rows[at]);
        if (!headed && !FUNDING_SENTENCE.test(rows[at]))
            continue;
        let end = at;
        for (let next = at + 1; next < rows.length; next++) {
            if (blocked(next) || taken.has(next))
                break;
            if (!rows[next]) {
                if (!headed)
                    break;
                continue;
            }
            if (END_OF_REFERENCES.test(rows[next]) || isReferenceListHeading(rows[next]) || HEADING_ROW.test(rows[next]))
                break;
            end = next;
        }
        take(regionAt('acknowledgements', page, reading, at, end, headed ? 'an acknowledgements heading' : 'opens with a funding sentence'));
        at = end;
    }
    {
        const hits: Array<{
            at: number;
            page: number | null;
        }> = [];
        rows.forEach((row, at) => {
            if (!row || blocked(at) || taken.has(at))
                return;
            if (DOT_LEADER.test(row)) {
                hits.push({ at, page: null });
                return;
            }
            const trailing = TRAILING_PAGE.exec(row);
            if (!trailing || weightOf(row) > 12 || endsSentence(row) || isIssueStatement(row) || readDates(row).some(entry => entry.precision !== 'year'))
                return;
            hits.push({ at, page: Number(trailing[1]) });
        });
        let run: typeof hits = [];
        const close = () => {
            const numbered = run.filter(hit => hit.page !== null);
            const rising = numbered.every((hit, index) => index === 0 || (hit.page as number) >= (numbered[index - 1].page as number));
            if (run.length >= STRUCTURE.tableRows && rising && (run.some(hit => hit.page === null) || numbered.length >= STRUCTURE.tableRows)) {
                let first = run[0].at;
                for (let up = first - 1; up >= 0 && up >= first - 3; up--) {
                    if (!rows[up])
                        continue;
                    if (CONTENTS_HEADING.test(rows[up]))
                        first = up;
                    break;
                }
                take(regionAt('contentsList', page, reading, first, run[run.length - 1].at, 'entries ending on rising page numbers'));
            }
            run = [];
        };
        for (const hit of hits) {
            if (run.length && hit.at - run[run.length - 1].at > 2)
                close();
            run.push(hit);
        }
        close();
        const NUMBERED_ENTRY = /^(?:\d{1,4}(?:\.\d{1,3}){0,3}|[IVXLC]{1,6}\.?)(?:[^\S\n]+\S|$)|\S[^\S\n]+\d{1,4}$/;
        for (let at = 0; at < rows.length; at++) {
            if (!rows[at] || blocked(at) || taken.has(at) || !CONTENTS_HEADING.test(rows[at]))
                continue;
            let end = at, entries = 0, numbered = 0;
            for (let next = at + 1; next < rows.length; next++) {
                if (!rows[next])
                    continue;
                if (blocked(next))
                    continue;
                const numberedRow = NUMBERED_ENTRY.test(rows[next]);
                if (taken.has(next) || (!numberedRow && weightOf(rows[next]) > 12) || endsSentence(rows[next]) || SENTENCE_SEAM.test(rows[next]))
                    break;
                entries++;
                if (numberedRow)
                    numbered++;
                end = next;
            }
            if (numbered >= STRUCTURE.tableRows && numbered * 2 >= entries)
                take(regionAt('contentsList', page, reading, at, end, 'short numbered entries under a contents heading'));
            at = end;
        }
        const filled = rows.map((row, at) => row && !blocked(at) ? at : -1).filter(at => at >= 0);
        if (filled.length && !formOf(work)) {
            const edge = [filled[0], filled[filled.length - 1]];
            const romanFolio = edge.find(at => /^(?:[-–—][^\S\n]*)?[ivxlc]{1,6}(?:[^\S\n]*[-–—])?$/i.test(rows[at]));
            const headed = CONTENTS_HEADING.test(rows[filled[0]]) ? filled[0] : undefined;
            const anchor = headed ?? romanFolio;
            if (anchor !== undefined) {
                const entry = (at: number) => at !== anchor && !taken.has(at) && lettersIn(rows[at]) >= 2 && weightOf(rows[at]) <= 12
                    && !endsSentence(rows[at]) && !SENTENCE_SEAM.test(rows[at]) && !REPORT_CLAUSE.test(rows[at]) && !/[.?!]$/.test(rows[at]);
                const entries = filled.filter(entry);
                if (entries.length >= STRUCTURE.tableRows && entries.length > filled.length * STRUCTURE.majority) {
                    take(regionAt('contentsList', page, reading, Math.min(anchor, entries[0]), entries[entries.length - 1], headed !== undefined ? 'short entry lines under a contents heading' : 'short entry lines under a roman folio'));
                }
            }
        }
    }
    return { regions, referencesOpen };
}
const EMPTY_CELL = /^[-–—−]$/;
const BRACKETED_CELL = /^[(（[]\s*[^()（）[\]\s\d][^()（）[\]\s]{0,11}\s*[)）\]]$/u;
const MARKER_NUMBER = /^\d(?:[^\S\n]*,[^\S\n]*\d)*$/;
function cellTableRegions(work: Work, reading: Reading): Region[] {
    const rows = trimmedRows(reading.rows);
    const out: Region[] = [];
    const blocked = (at: number) => work.textRunning.has(at) || work.textStamp.has(at);
    const closes = (value: string) => closesSentence(value) || WORD_STOP.test(value) || REPORT_CLAUSE.test(value);
    let block: number[] = [];
    const close = () => {
        const short = block.filter(at => weightOf(widestColumn(rows[at])) <= 2);
        if (short.length >= STRUCTURE.tableRows) {
            const seen = new Map<string, number>();
            for (const at of short) {
                const key = compact(rows[at]);
                if (key)
                    seen.set(key, (seen.get(key) || 0) + 1);
            }
            let values = 0, measures = 0;
            for (const at of short) {
                const value = rows[at];
                const numeric = NUMERIC_CELL.test(value);
                if (numeric && !MARKER_NUMBER.test(value))
                    measures++;
                if (numeric || EMPTY_CELL.test(value) || BRACKETED_CELL.test(value) || (seen.get(compact(value)) || 0) >= 2)
                    values++;
            }
            if (values * 2 > short.length && measures >= STRUCTURE.tableRows) {
                out.push(regionAt('table', work.page, reading, short[0], short[short.length - 1], `${values} of ${short.length} short cells are values, ${measures} measured`));
            }
        }
        block = [];
    };
    rows.forEach((row, at) => {
        if (!row)
            return;
        if (blocked(at) || closes(row) || weightOf(widestColumn(row)) >= STRUCTURE.proseWeight) {
            close();
            return;
        }
        block.push(at);
    });
    close();
    return out;
}
function tableRegions(work: Work): Region[] {
    const reading = work.primary;
    if (!reading)
        return [];
    const out: Region[] = cellTableRegions(work, reading);
    if (reading.basis === 'layout') {
        const rows = reading.basisRows;
        const cellsOf = (row: string) => {
            const found: Array<{
                start: number;
                text: string;
            }> = [];
            for (const match of row.matchAll(/\S+(?: {1,2}\S+)*/g))
                found.push({ start: match.index ?? 0, text: match[0] });
            return found;
        };
        let run: Array<{
            row: number;
            starts: number[];
            numeric: number;
            cells: number;
        }> = [];
        const close = () => {
            if (run.length >= STRUCTURE.tableRows) {
                const cells = run.reduce((sum, entry) => sum + entry.cells, 0), numeric = run.reduce((sum, entry) => sum + entry.numeric, 0);
                if (numeric * 2 >= cells)
                    out.push({ kind: 'table', page: work.page, basis: 'layout', rows: [run[0].row, run[run.length - 1].row], because: `${run.length} aligned rows, ${numeric} of ${cells} cells numeric` });
            }
            run = [];
        };
        for (let at = 0; at < rows.length; at++) {
            if (!rows[at].trim())
                continue;
            const cells = cellsOf(rows[at]);
            if (cells.length < STRUCTURE.tableColumns) {
                close();
                continue;
            }
            const starts = cells.map(cell => cell.start);
            const previous = run[run.length - 1];
            const aligned = !previous || (starts.length === previous.starts.length && starts.every((start, index) => Math.abs(start - previous.starts[index]) <= 1));
            if (!aligned)
                close();
            run.push({ row: at, starts, numeric: cells.filter(cell => NUMERIC_CELL.test(cell.text)).length, cells: cells.length });
        }
        close();
    }
    return out;
}
export function tableSpansIn(text: unknown): Array<[
    number,
    number
]> {
    const out: Array<[
        number,
        number
    ]> = [];
    let offset = 0;
    for (const page of String(text ?? '').split('\f')) {
        const work = workOf({ page: 1, layer: { text: page } });
        if (work.primary)
            for (const region of cellTableRegions(work, work.primary))
                if (region.span)
                    out.push([offset + region.span[0], offset + region.span[1]]);
        offset += page.length + 1;
    }
    return out;
}
const textStructures = new Map<string, PageStructure>();
function textStructure(value: string, pages: string[]): PageStructure {
    const held = textStructures.get(value);
    if (held)
        return held;
    const structure = computeStructure({ pages: pages.map((page, index) => ({ page: index + 1, layer: { text: page } })) }, false, true);
    textStructures.set(value, structure);
    if (textStructures.size > 64)
        textStructures.delete(textStructures.keys().next().value as string);
    return structure;
}
export function regionSpansIn(text: unknown, kinds: RegionKind[]): Array<[
    number,
    number
]> {
    const value = String(text ?? '');
    const pages = value.split('\f');
    const out: Array<[
        number,
        number
    ]> = [];
    if (!pages.some(page => page.trim()))
        return out;
    const structure = textStructure(value, pages);
    let offset = 0;
    pages.forEach((page, index) => {
        for (const region of regionsOf(structure, index + 1, kinds))
            if (region.basis === 'text' && region.span)
                out.push([offset + region.span[0], offset + region.span[1]]);
        offset += page.length + 1;
    });
    return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
export function otherWorksSpansIn(text: unknown): Array<[
    number,
    number
]> {
    return regionSpansIn(text, ['otherWorks']);
}
export function anotherWorkTitled(title: unknown, text: unknown): string {
    const compact = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const key = compact(title), page = String(text ?? '');
    if (key.length < 8 || !page.trim())
        return '';
    const spans = otherWorksSpansIn(page);
    const holding = spans.map(([start, end]) => compact(page.slice(start, end))).filter(span => span.includes(key));
    if (!holding.length)
        return '';
    let outside = page;
    for (const [start, end] of [...spans].sort((a, b) => b[0] - a[0]))
        outside = outside.slice(0, start) + '\n' + outside.slice(end);
    const rows = outside.split(/\r?\n/).map(compact).filter(Boolean);
    for (let at = 0; at < rows.length; at++) {
        let joined = '';
        for (let span = 0; span < 3 && at + span < rows.length; span++) {
            joined += rows[at + span];
            if (joined === key)
                return '';
            if (joined.length >= key.length)
                break;
        }
    }
    return holding.join('\n');
}
export function withoutOtherWorksIn(text: unknown): string {
    let kept = String(text ?? '');
    const merged: Array<[
        number,
        number
    ]> = [];
    for (const [start, end] of otherWorksSpansIn(kept)) {
        const last = merged[merged.length - 1];
        if (last && start <= last[1])
            last[1] = Math.max(last[1], end);
        else
            merged.push([start, end]);
    }
    for (const [start, end] of merged.reverse())
        kept = kept.slice(0, start) + '\n' + kept.slice(end);
    return kept;
}
export function tableRowsIn(text: unknown): Set<number> {
    const value = String(text ?? '');
    const rows = new Set<number>();
    const spans = tableSpansIn(value);
    if (!spans.length)
        return rows;
    let cursor = 0;
    value.split('\n').forEach((row, at) => {
        const start = cursor, end = cursor + row.length;
        if (row.trim() && spans.some(([first, last]) => start < last && end > first))
            rows.add(at);
        cursor = end + 1;
    });
    return rows;
}
interface RowShapes {
    value: string[];
    weight: number[];
    letters: number[];
    lettered: boolean[];
    cjk: boolean[];
    shut: boolean[];
    complete?: boolean;
}
const rowShapeCache = new WeakMap<string[], RowShapes>();
function rowShapesOf(rows: string[]): RowShapes {
    const held = rowShapeCache.get(rows);
    if (held)
        return held;
    const shapes: RowShapes = { value: [], weight: [], letters: [], lettered: [], cjk: [], shut: [] };
    rowShapeCache.set(rows, shapes);
    return shapes;
}
function proseFlags(rows: string[], excluded: (at: number) => boolean): boolean[] {
    const flags = rows.map(() => false);
    const shapes = rowShapesOf(rows);
    const valueAt = (at: number) => shapes.value[at] ?? (shapes.value[at] = widestColumn(rows[at]));
    const weightAt = (at: number) => shapes.weight[at] ?? (shapes.weight[at] = weightOf(valueAt(at)));
    const lettersAt = (at: number) => shapes.letters[at] ?? (shapes.letters[at] = lettersIn(valueAt(at)));
    const letteredAt = (at: number) => shapes.lettered[at] ?? (shapes.lettered[at] = lettersAt(at) * 5 >= valueAt(at).replace(/\s+/g, '').length * 3);
    const cjkAt = (at: number) => shapes.cjk[at] ?? (shapes.cjk[at] = CJK.test(valueAt(at)));
    const shutAt = (at: number) => shapes.shut[at] ?? (shapes.shut[at] = endsSentence(valueAt(at)) || SENTENCE_SEAM.test(valueAt(at)) || REPORT_CLAUSE.test(valueAt(at)));
    let run: number[] = [];
    let shutInRun = 0;
    let endLine = -1;
    const push = (at: number) => { run.push(at); if (shutAt(at))
        shutInRun++; };
    const close = () => {
        if (!run.length)
            return;
        const closes = run.map(at => at === endLine || shutAt(at));
        const flowing = closes.filter((closed, index) => !closed && index + 1 < run.length).length;
        const wide = run.reduce((sum, at) => sum + weightAt(at), 0) / Math.max(1, run.length) >= STRUCTURE.titleWeight - 4;
        const paragraphLine = run.some((at, index) => closes[index] && weightAt(at) >= STRUCTURE.titleWeight * 2);
        if ((run.length >= STRUCTURE.proseRows && closes.some((closed, index) => closed && index >= STRUCTURE.proseRows - 1)
            && (flowing >= STRUCTURE.proseRows - 1 || wide)) || paragraphLine)
            run.forEach(at => { flags[at] = true; });
        run = [];
        shutInRun = 0;
    };
    rows.forEach((row, at) => {
        if (!row.trim())
            return;
        const full = !excluded(at) && weightAt(at) >= STRUCTURE.proseWeight && letteredAt(at);
        const sameScript = !run.length || cjkAt(run[run.length - 1]) === cjkAt(at);
        if (full) {
            if (!sameScript)
                close();
            push(at);
            return;
        }
        if (run.length && shutInRun === 0 && sameScript && !excluded(at) && lettersAt(at) >= 2 && letteredAt(at)) {
            const value = valueAt(at);
            if (WORD_STOP.test(value) || closesSentence(value) || REPORT_CLAUSE.test(value)) {
                push(at);
                endLine = at;
            }
        }
        close();
    });
    close();
    return flags;
}
function basisExcluded(work: Work, at: number): boolean {
    const reading = work.primary;
    if (!reading)
        return false;
    if (work.basisRunning.has(at) || work.basisStamp.has(at))
        return true;
    if (reading.basis === 'text')
        return work.regions.some(region => region.basis === 'text' && region.kind !== 'table' && at >= region.rows[0] && at <= region.rows[1]);
    const value = compact(widestColumn(reading.basisRows[at]));
    if (!value)
        return false;
    return work.excludedCompact.has(value) || (value.length >= 12 && work.excludedJoined.includes(value));
}
function inSelfCitation(work: Work, at: number): boolean {
    const reading = work.primary;
    if (!reading)
        return false;
    const regions = work.regions.filter(region => region.kind === 'selfCitation');
    if (!regions.length)
        return false;
    if (reading.basis === 'text')
        return regions.some(region => at >= region.rows[0] && at <= region.rows[1]);
    const value = compact(widestColumn(reading.basisRows[at]));
    return !!value && regions.some(region => {
        for (let row = region.rows[0]; row <= region.rows[1]; row++) {
            const own = compact(reading.rows[row]);
            if (own && (own.includes(value) || value.includes(own)))
                return true;
        }
        return false;
    });
}
const CITED_TITLE_LETTERS = 20;
function citesALaterTitle(work: Work, later: Work[]): boolean {
    const reading = work.primary;
    if (!reading)
        return false;
    const cited = work.regions.filter(region => region.kind === 'selfCitation' && region.basis === 'text')
        .map(region => compact(reading.rows.slice(region.rows[0], region.rows[1] + 1).join(' '))).filter(Boolean);
    if (!cited.length)
        return false;
    for (const other of later) {
        if (!other.claimTitle || other.entryClaim || (other.strength ?? 0) < 1 || other.prose)
            continue;
        const claimed = compact(other.claimTitle);
        if (lettersIn(claimed) <= CITED_TITLE_LETTERS || !cited.some(text => text.includes(claimed)))
            continue;
        if (work.claimTitle && !work.entryClaim && sameTitle(work.claimTitle, other.claimTitle))
            continue;
        return true;
    }
    return false;
}
function entriesOf(work: Work, values: string[]): Entry[] {
    const out: Entry[] = [];
    const inMasthead = (at: number) => !!work.masthead && at >= work.masthead[0] && at <= work.masthead[1];
    const sourceRow = (value: string) => YEAR.test(value) && weightOf(value) <= 8 && !titleShaped(value, false);
    const heights = work.primary?.heights || null;
    const sameSize = (a: number, b: number) => !!heights && heights[a] > 0 && heights[b] > 0 && Math.abs(heights[a] - heights[b]) <= 0.05 * Math.max(heights[a], heights[b]);
    const runUp = (bottom: number) => {
        let top = bottom;
        for (;;) {
            if (top - 1 >= 0 && values[top - 1] && titleShaped(values[top - 1], false)) {
                top--;
                continue;
            }
            if (top - 2 >= 0 && !values[top - 1] && values[top - 2] && sameSize(top - 2, top) && titleShaped(values[top - 2], false)) {
                top -= 2;
                continue;
            }
            return top;
        }
    };
    for (let at = 0; at < values.length; at++) {
        if (!DOI_IN.test(values[at]) && !ISBN_IN.test(values[at]))
            continue;
        if (inMasthead(at) || inSelfCitation(work, at) || basisExcluded(work, at))
            continue;
        let up = at - 1, passed = 0;
        while (up >= 0 && (!values[up] || bylineRow(values[up]) || sourceRow(values[up]))) {
            if (values[up])
                passed++;
            up--;
        }
        if (up < 0 || !passed || !titleShaped(values[up], false))
            continue;
        if (work.basisProse[up])
            continue;
        let down = at;
        while (down + 1 < values.length && values[down + 1] && (sourceRow(values[down + 1]) || isOrganisationOnly(values[down + 1].replace(YEAR, '').trim())))
            down++;
        const top = runUp(up);
        out.push({ title: values.slice(top, up + 1).join(' ').trim(), rows: [top, down] });
    }
    for (let at = 1; at < values.length; at++) {
        if (!entrySourceRow(values[at]))
            continue;
        let up = at - 1;
        while (up >= 0 && !values[up])
            up--;
        const tail = up;
        let titled = up >= 0 && titleShaped(values[up], false);
        if (!titled && up >= 1 && wrappedTitleTail(values[up])) {
            let above = up - 1;
            while (above >= 0 && !values[above])
                above--;
            if (above >= 0 && (titleShaped(values[above], false) || titleShaped(`${values[above]} ${values[tail]}`, false))) {
                up = above;
                titled = true;
            }
        }
        if (!titled)
            continue;
        if (work.basisProse[at] || work.basisProse[up] || work.basisProse[tail])
            continue;
        const top = runUp(up);
        if (out.some(entry => top >= entry.rows[0] && at <= entry.rows[1]))
            continue;
        out.push({ title: values.slice(top, tail + 1).filter(Boolean).join(' ').trim(), rows: [top, at] });
    }
    return out;
}
const NUMBER_TAIL = /[\d\s,.;:()–—-]/;
const NUMBER_LEAD = /[\s,;:]/;
function withoutTrailingNumbers(value: string): string {
    let tail = value.length;
    while (tail > 0 && NUMBER_TAIL.test(value[tail - 1]))
        tail--;
    let digit = tail;
    while (digit < value.length && !(value.charCodeAt(digit) >= 48 && value.charCodeAt(digit) <= 57))
        digit++;
    if (digit >= value.length)
        return value;
    let start = digit;
    while (start > tail && NUMBER_LEAD.test(value[start - 1]))
        start--;
    return value.slice(0, start);
}
const CITATION_BANNER_SHAPE = /^(.{2,80}?)\s\d{1,4}\s*\(\s*(?:1[89]|20)\d{2}\s*\)\s*[\d\s–—-]{1,24}$/;
function serialNamesOn(values: string[], serials: Set<string>): Set<string> {
    const names = new Set(serials);
    for (const value of values) {
        if (!value)
            continue;
        const stated = statedJournal(value);
        if (stated !== null)
            names.add(stated);
        const banner = bannerJournal(value);
        if (banner !== null)
            names.add(banner);
    }
    return names;
}
const statedJournal = remembered((value: string) => { const stated = journalOfIssueStatement(value); return stated ? compact(stated) : null; });
const bannerJournal = remembered((value: string) => { const banner = CITATION_BANNER_SHAPE.exec(value); return banner ? compact(banner[1]) : null; });
const bannerShaped = remembered((value: string) => (HOST.test(value) && !EMAIL.test(value) && weightOf(value.replace(HOST, ' ')) <= 6)
    || isIssueStatement(value) || statesAnIssue(value) || CITATION_BANNER_SHAPE.test(value) || IDENTIFIER_ROW.test(value) || CONTAINER_ROW.test(value));
const bannerFurniture = remembered((value: string) => isDateOnly(value) || codeToken(value) || /^(?:[ivxlcdm]+|\d{1,4}|[-–—·•]+)$/i.test(value) || (carriesFolio(value) && weightOf(value) <= 3));
function mastheadOf(work: Work, names: Set<string>, displayRow: number): [
    number,
    number
] | null {
    const reading = work.primary;
    if (!reading)
        return null;
    const rows = reading.basisRows;
    const values = widestValues(rows);
    const plainBanner = (at: number) => {
        const value = values[at];
        if (!value)
            return false;
        if (work.basisHeadRunning.has(at))
            return true;
        if (bannerShaped(value))
            return true;
        const key = compact(value);
        return !!key && names.has(key);
    };
    const filled = filledRows(rows);
    const serialShaped = (value: string) => {
        const bare = withoutTrailingNumbers(value).trim();
        return !!bare && weightOf(bare) <= 8 && (serialName(bare) || (bare.match(/\b\p{Lu}\p{Ll}{0,8}\./gu) || []).length >= 3);
    };
    const banner = (at: number) => {
        if (plainBanner(at))
            return true;
        if (!values[at] || !serialShaped(values[at]))
            return false;
        const index = filled.indexOf(at);
        return [filled[index - 1], filled[index + 1]].some(row => row !== undefined && plainBanner(row));
    };
    const furniture = (at: number) => bannerFurniture(values[at] ?? '');
    const issueBelow = (index: number) => {
        for (let ahead = index + 1; ahead < filled.length && ahead <= index + STRUCTURE.mastheadLead; ahead++) {
            const row = filled[ahead];
            if (row !== filled[ahead - 1] + 1 || (displayRow >= 0 && row >= displayRow))
                return false;
            const value = values[row] ?? '';
            if (isIssueStatement(value))
                return journalOfIssueStatement(value) === '';
            if (work.basisProse[row] || bylineRow(value, false))
                return false;
        }
        return false;
    };
    let last = -1;
    for (let index = 0; index < filled.length; index++) {
        const at = filled[index];
        if (displayRow >= 0 && at >= displayRow)
            break;
        if (plainBanner(at)) {
            last = at;
            continue;
        }
        if (work.basisProse[at] || bylineRow(values[at], false))
            break;
        if (banner(at)) {
            last = at;
            continue;
        }
        if (furniture(at))
            continue;
        const next = filled[index + 1];
        if (next !== undefined && (displayRow < 0 || next < displayRow) && banner(next) && (last >= 0 || index === 0))
            continue;
        if (last < 0 && issueBelow(index))
            continue;
        break;
    }
    return last >= 0 ? [filled[0], last] : null;
}
function claimOf(work: Work, serials: Set<string>): void {
    const reading = work.primary;
    work.display = undefined;
    work.byline = undefined;
    work.claimTitle = '';
    work.claimRows = null;
    work.strength = null;
    work.entryClaim = false;
    work.masthead = null;
    work.entries = [];
    if (!reading)
        return;
    const rows = reading.basisRows;
    const values = widestValues(rows);
    const firstProse = work.firstProseBasisRow;
    const names = serialNamesOn(values, serials);
    work.masthead = mastheadOf(work, names, -1);
    if (reading.kind === 'layer' && work.layer === 'broken')
        return;
    let display: {
        block: RawBlock;
        height: number;
    } | null = null;
    let namedDisplay: {
        block: RawBlock;
        height: number;
    } | null = null;
    let blocks: RawBlock[] = [];
    if (reading.heights && work.bodySize > 0) {
        blocks = splitBlocks(rows.map(row => nfkc(row)), { heights: reading.heights, pageHeight: work.bodySize, hasLayout: reading.basis === 'layout' });
        for (const block of blocks) {
            const lettered = block.rows.filter(row => lettersIn(values[row] || '') >= 2);
            const height = lowerMedian(lettered.map(row => reading.heights?.[row] || 0));
            if (!(height >= work.bodySize * STRUCTURE.display))
                continue;
            if (block.rows.some(row => basisExcluded(work, row)))
                continue;
            const joined = trimmed(block.lines.join(' '));
            if (block.rows.every(row => { const value = values[row]; return !!value && (isIssueStatement(value) || statesAnIssue(value) || names.has(compact(value)) || isDegreeStatement(value)); }))
                continue;
            const shaped = (allowNames: boolean) => titleShaped(joined, true, allowNames) && (titleShaped(trimmed(block.lines[0] || ''), true, allowNames) || lettersIn(joined) >= 6);
            if (shaped(false)) {
                if (!display || height > display.height)
                    display = { block, height };
            }
            else if (shaped(true) && (!namedDisplay || height > namedDisplay.height))
                namedDisplay = { block, height };
        }
        if (!display && namedDisplay)
            display = namedDisplay;
    }
    if (display)
        work.masthead = mastheadOf(work, names, display.block.rows[0]);
    work.entries = entriesOf(work, values);
    const inMasthead = (at: number) => !!work.masthead && at >= work.masthead[0] && at <= work.masthead[1];
    const inEntry = (first: number, last: number) => work.entries.some(entry => first >= entry.rows[0] && last <= entry.rows[1]);
    if (display) {
        const block = display.block;
        const index = blocks.indexOf(block);
        work.display = { rows: [block.rows[0], block.rows[block.rows.length - 1]], height: display.height, basis: 'layout' };
        work.claimTitle = block.lines.map(line => line.trim()).join(' ').replace(/\s+/g, ' ').trim();
        work.claimRows = work.display.rows;
        let looked = 0;
        for (const next of blocks.slice(index + 1)) {
            if (looked >= STRUCTURE.bylineBlocks)
                break;
            if (next.rows.every(row => basisExcluded(work, row)))
                continue;
            looked++;
            const at = next.rows.findIndex(row => bylineRow(values[row] || ''));
            if (at >= 0) {
                work.byline = { rows: [next.rows[at], next.rows[next.rows.length - 1]] };
                break;
            }
        }
        if (!work.byline && index > 0) {
            const above = blocks.slice(0, index).filter(previous => !previous.rows.every(row => basisExcluded(work, row)));
            const filled = above.flatMap(previous => previous.rows).filter(row => !!values[row] && !basisExcluded(work, row));
            const wraps = filled.length > 0 && joinWrappedRows([values[filled[filled.length - 1]], values[block.rows[0]] || ''], 0).end === 1;
            if (!wraps && above.length <= STRUCTURE.bylineBlocks && filled.length && filled.every(row => bylineRow(values[row], true) || ROLE_LABEL.test(values[row]))
                && filled.some(row => bylineRow(values[row], false)))
                work.byline = { rows: [filled[0], filled[filled.length - 1]] };
        }
        work.strength = work.byline ? 3 : 2;
    }
    else {
        const limit = firstProse >= 0 ? firstProse : rows.length;
        const usable = (at: number) => !!values[at] && !basisExcluded(work, at) && !inMasthead(at);
        const runs: Array<[
            number,
            number
        ]> = [];
        let start = -1, end = -1;
        let runRows: number[] = [], checked = 0, namesOnly = true;
        const namesSoFar = (): boolean => {
            while (namesOnly && checked < runRows.length) {
                if (!bylineRow(values[runRows[checked]], true))
                    namesOnly = false;
                checked++;
            }
            return namesOnly;
        };
        const script = (value: string) => CJK.test(value) ? 'cjk' : 'latin';
        const spacedByOneRow = (() => {
            const filledRows = rows.map((row, at) => row.trim() ? at : -1).filter(at => at >= 0 && at < limit);
            const gaps = filledRows.slice(1).map((row, index) => row - filledRows[index] - 1);
            return gaps.length >= 3 && gaps.filter(gap => gap === 1).length * 2 > gaps.length;
        })();
        const capitalsRow = (value: string) => !CJK.test(value) && /\p{Lu}/u.test(value) && !/\p{Ll}/u.test(value);
        for (let at = 0; at < limit; at++) {
            if (!values[at])
                continue;
            const continues = start >= 0 && (continuesAcross(values[end], values[at])
                || (spacedByOneRow && at === end + 2 && capitalsRow(values[end]) && capitalsRow(values[at]) && !endsSentence(values[end])));
            const shaped: boolean = usable(at) && (continues ? titleShaped(values[at], true) : titleShaped(values[at], false) && !(start >= 0 && !namesSoFar() && bylineRow(values[at], true)));
            const gapOnly = start >= 0 && rows.slice(end + 1, at).every(row => !row.trim());
            const joins = shaped && start >= 0 && (at === end + 1 || (gapOnly && (continues || script(values[at]) !== script(values[end]))));
            if (joins) {
                end = at;
                runRows.push(at);
                continue;
            }
            if (start >= 0)
                runs.push([start, end]);
            start = shaped ? at : -1;
            end = shaped ? at : -1;
            runRows = shaped ? [at] : [];
            checked = 0;
            namesOnly = true;
        }
        if (start >= 0)
            runs.push([start, end]);
        const bylineAround = (run: [
            number,
            number
        ], single: boolean): [
            number,
            number
        ] | null => {
            const test = (value: string) => single ? bylineRow(value, true) : bylineRow(value, false) || labelledByline(value);
            let seat = true;
            for (let at = run[1] + 1; at < rows.length; at++) {
                const value = values[at];
                if (!value || basisExcluded(work, at))
                    continue;
                const spacedName = seat && spacedHangulNameRow(value);
                seat = false;
                if (test(value) || spacedName) {
                    let last = at;
                    for (let next = at + 1; next < rows.length; next++) {
                        if (!values[next])
                            continue;
                        if (bylineRow(values[next])) {
                            last = next;
                            continue;
                        }
                        break;
                    }
                    return [at, last];
                }
                if (responsibilityRow(value))
                    continue;
                break;
            }
            for (let at = run[0] - 1; at >= 0; at--) {
                const value = values[at];
                if (!value || basisExcluded(work, at) || inMasthead(at))
                    continue;
                if (test(value))
                    return [at, at];
                if (ROLE_LABEL.test(value))
                    continue;
                break;
            }
            return null;
        };
        let chosen: [
            number,
            number
        ] | null = null, byline: [
            number,
            number
        ] | null = null;
        const sureName = (value: string) => {
            if (!bylineRow(value, true))
                return false;
            const row = readBylineRow(value);
            return row.kind !== 'single' || row.items[0]?.shape.person === 'sure';
        };
        const nameOnly = (run: [
            number,
            number
        ]) => values.slice(run[0], run[1] + 1).filter(Boolean).every(sureName);
        const titled = runs.filter(run => !nameOnly(run));
        const candidates = titled.length ? titled : runs;
        const fallback: [
            number,
            number
        ] | null = candidates[0] || null;
        for (const run of candidates) {
            if (inEntry(run[0], run[1]))
                continue;
            const found = bylineAround(run, run === candidates[0]);
            if (found) {
                chosen = run;
                byline = found;
                break;
            }
        }
        const claim = chosen || fallback;
        if (claim) {
            work.display = { rows: claim, height: 0, basis: 'shape' };
            work.claimTitle = values.slice(claim[0], claim[1] + 1).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
            work.claimRows = claim;
            if (byline)
                work.byline = { rows: byline };
            work.strength = work.byline ? 1 : 0;
        }
    }
    if (work.claimRows && work.strength !== null && inEntry(work.claimRows[0], work.claimRows[1])) {
        work.strength = 0;
        work.entryClaim = true;
    }
}
const APPROVAL_ROW = /(?:인준|인정|認准|認準|認定|承認|判定|審査|審查)\s*(?:함|합니다|하였음|하였습니다|하옵니다)\s*\.?$|[(（]\s*(?:인|印)\s*[)）]\s*$/;
const SUBMISSION_ROW = /(?:제출|提出)\s*(?:함|합니다|하였음|하였습니다|하옵니다)\s*\.?$|^(?:submitted\s+)?in\s+(?:partial\s+)?fulfil+ment\b|\bsubmitted\s+to\s+the\s+(?:graduate\s+)?(?:school|faculty|college|department|university|board)\b/i;
const formCache = new WeakMap<Work, FormKind | null>();
function formOf(work: Work): FormKind | null {
    if (formCache.has(work))
        return formCache.get(work) as FormKind | null;
    const form = formOfPage(work);
    formCache.set(work, form);
    return form;
}
function formOfPage(work: Work): FormKind | null {
    const reading = work.primary;
    if (!reading)
        return null;
    const rows = trimmedRows(reading.rows).filter((row, at) => !!row && !work.textRunning.has(at));
    if (!rows.length)
        return null;
    if (rows.some(row => APPROVAL_ROW.test(row)))
        return 'approval';
    if (rows.some(row => SUBMISSION_ROW.test(row)))
        return 'submission';
    const layoutRows = reading.basis === 'layout' ? reading.basisRows.filter(row => row.trim()) : [];
    const columnLabelled = layoutRows.filter(row => {
        const columns = splitColumns(nfkc(row));
        return columns.length === 2 && weightOf(columns[0]) <= 4 && !/\d{3,}/.test(columns[0]) && lettersIn(columns[0]) >= 2;
    }).length;
    const labelled = rows.filter(row => FIELD_LABEL.test(row) && row.replace(FIELD_LABEL, '').trim().length > 0).length;
    if ((labelled >= 2 && labelled * 2 >= rows.length) || (columnLabelled >= 2 && columnLabelled * 2 >= layoutRows.length))
        return 'labelled';
    if (degreeFormPage(rows.join('\n')))
        return 'degree';
    return null;
}
function issueCoverOf(work: Work, documentPages: number | undefined): boolean {
    if (!documentPages || !work.primary)
        return false;
    return work.primary.rows.some(row => {
        const value = trimmed(row);
        if (!statesAnIssue(value))
            return false;
        const range = /\bpages\s*[:：]?\s*(\d{1,5})\s*[-–—~]\s*(\d{1,5})/i.exec(value);
        return !!range && Number(range[2]) - Number(range[1]) + 1 > documentPages;
    });
}
interface Internal {
    works: Work[];
}
const internals = new WeakMap<PageStructure, Internal>();
function workOf(page: StructurePage): Work {
    const readings = [readingOf('layer', page), readingOf('ocr', page)].filter((reading): reading is Reading => !!reading);
    const layerReading = readings.find(reading => reading.kind === 'layer') || null;
    const ocrReading = readings.find(reading => reading.kind === 'ocr') || null;
    const flagged = !!(page.layer?.degraded || page.layer?.glyphRisk || page.layer?.encodingShift);
    const status = layerStatusOf(page);
    const disowned = !!layerReading && !!ocrReading && status !== 'broken' && readingsShareNoLine(layerReading.text, ocrReading.text);
    const layer = disowned && status === 'readable' ? 'broken' : status;
    const soundLayer = !!layerReading && !disowned && (layer === 'readable'
        || (layer === 'none' && !flagged && !unreadableLayer(nfkc(layerReading.text), false) && lettersIn(nfkc(layerReading.text)) > 0));
    const carries = (reading: Reading | null) => !!reading && pageCarries(reading.text);
    const primary = soundLayer && carries(layerReading) ? layerReading
        : carries(ocrReading) ? ocrReading : soundLayer ? layerReading : ocrReading || layerReading;
    const heights = primary?.heights || null;
    const bodySize = heights && primary ? lowerMedian(primary.basisRows.map((row, at) => row.trim() ? heights[at] || 0 : 0)) : 0;
    const printed = readings.some(reading => carries(reading) || pagePrints(reading.text)) || layer === 'broken';
    return {
        page: page.page, input: page, layer, primary, readings, words: printed,
        bodySize, folios: primary ? folioCandidates(primary.basis === 'layout' ? primary.basisRows.join('\n') : primary.text).map(({ folio, where, line }) => ({ folio, where, line: String(line ?? '') })) : [],
        textRunning: new Set(), textStamp: new Set(), basisRunning: new Set(), basisHeadRunning: new Set(), basisStamp: new Set(), regions: [],
        excludedCompact: new Set(), excludedJoined: '', textProse: [], basisProse: [], prose: false, firstProseBasisRow: -1,
        masthead: null, display: undefined, byline: undefined, claimTitle: '', claimRows: null, strength: null, entryClaim: false, foreign: [], entries: [],
        form: null, issueCover: false
    };
}
const pageCarries = remembered(text => pageCarriesWords(text), 20000, 128);
const pagePrints = remembered(text => printsALine(text), 20000, 128);
const degreeFormPage = remembered(text => isDegreeFormPage(text), 20000, 128);
function printsALine(text: string): boolean {
    const lines: string[] = [];
    let run = '';
    for (const line of String(text || '').split('\n')) {
        const bare = line.replace(/\s+/g, '');
        if (bare && bare.length <= 2 && CJK.test(bare)) {
            run += bare;
            continue;
        }
        if (run) {
            lines.push(run);
            run = '';
        }
        lines.push(line);
    }
    if (run)
        lines.push(run);
    return lines.some(line => {
        if (/[~=|{}\\^`]/.test(line) || /\p{L}\d{2,}\p{L}|\d\p{L}\d/u.test(line))
            return false;
        if ((line.match(/[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length >= 4)
            return true;
        return line.split(/\s+/).filter(token => /^\p{L}{3,}$/u.test(withoutEndMarks(token))).length >= 2;
    });
}
export function readPageStructure(input: StructureInput): PageStructure {
    return computeStructure(input, false);
}
export function roleOfALonePage(text: unknown, opening: boolean): PageEntry | null {
    const value = nfkc(text);
    if (!value.trim())
        return null;
    return computeStructure({ pages: [{ page: 1, layer: { text: value } }] }, !opening).pages[0] || null;
}
function computeStructure(input: StructureInput, noOpening: boolean, regionsOnly = false): PageStructure {
    const byPage = new Map<number, StructurePage>();
    for (const page of input?.pages || []) {
        const number = Number(page?.page);
        if (!Number.isInteger(number) || number < 1)
            continue;
        const held = byPage.get(number);
        byPage.set(number, held ? { ...held, ...page, layer: page.layer || held.layer, ocr: page.ocr || held.ocr } : page);
    }
    const documentPages = Number(input?.documentPages) > 0 ? Number(input.documentPages) : undefined;
    const works: Work[] = [...byPage.values()].sort((a, b) => a.page - b.page).map(workOf);
    const running = runningLinesOf(works);
    const runningKeysAll = new Set(running.map(line => line.key));
    const runningCells = new Set(running.flatMap(line => line.cells.map(cell => cell.key)));
    const stampKeys = new Set(running.filter(line => line.kind === 'downloadStamp').map(line => line.key));
    for (const work of works) {
        for (const line of running)
            for (const entry of line.seen) {
                if (entry.page !== work.page || entry.reading !== work.primary?.kind)
                    continue;
                work.basisRunning.add(entry.row);
                if (line.edge === 'head')
                    work.basisHeadRunning.add(entry.row);
                if (line.kind === 'downloadStamp')
                    work.basisStamp.add(entry.row);
            }
        const reading = work.primary;
        if (!reading)
            continue;
        for (const { row } of edgeRowsOf(reading.rows, reading.truncated)) {
            const key = rowKey(reading.rows[row]);
            if (runningKeysAll.has(key) || runningCells.has(cellKey(reading.rows[row]))) {
                work.textRunning.add(row);
                if (stampKeys.has(key))
                    work.textStamp.add(row);
            }
        }
        const rows = trimmedRows(reading.rows);
        rows.forEach((row, at) => { if (row && stampShaped(row, [rows[at - 1] || '', rows[at + 1] || '']))
            work.textStamp.add(at); });
        withStampOpeners(rows, work.textStamp);
        const basis = widestValues(reading.basisRows);
        basis.forEach((row, at) => { if (row && stampShaped(row, [basis[at - 1] || '', basis[at + 1] || '']))
            work.basisStamp.add(at); });
        withStampOpeners(basis, work.basisStamp);
    }
    let referencesOpen = false;
    let previousPage = 0;
    for (const work of works) {
        const { regions, referencesOpen: open } = textRegions(work, referencesOpen && work.page === previousPage + 1);
        referencesOpen = open;
        previousPage = work.page;
        work.regions = [...regions, ...tableRegions(work)];
        const reading = work.primary;
        if (reading) {
            for (const region of work.regions) {
                if (region.basis !== 'text' || region.kind === 'table')
                    continue;
                for (let at = region.rows[0]; at <= region.rows[1]; at++) {
                    const value = compact(reading.rows[at]);
                    if (value)
                        work.excludedCompact.add(value);
                }
            }
            work.excludedJoined = [...work.excludedCompact].join('\u0000');
            const notProse = new Set<RegionKind>(['stamp', 'selfCitation', 'references', 'citation', 'otherWorks', 'imprint', 'table', 'contentsList']);
            const inRegion = (at: number) => work.regions.some(region => region.basis === 'text' && notProse.has(region.kind) && at >= region.rows[0] && at <= region.rows[1]);
            work.textProse = proseFlags(reading.rows, at => inRegion(at) || work.textRunning.has(at));
            const held = new Set<string>();
            for (const region of work.regions) {
                if (region.basis !== 'text' || !notProse.has(region.kind))
                    continue;
                for (let at = region.rows[0]; at <= region.rows[1]; at++) {
                    const value = compact(reading.rows[at]);
                    if (value)
                        held.add(value);
                }
            }
            const joined = [...held].join('\u0000');
            const heldRow = (at: number) => { const value = compact(widestColumn(reading.basisRows[at])); return !!value && (held.has(value) || (value.length >= 12 && joined.includes(value))); };
            work.basisProse = reading.basis === 'text' ? work.textProse : proseFlags(reading.basisRows, at => work.basisRunning.has(at) || work.basisStamp.has(at) || heldRow(at));
            work.prose = work.textProse.some(Boolean) || work.basisProse.some(Boolean);
            work.firstProseBasisRow = work.basisProse.findIndex(Boolean);
        }
        work.form = formOf(work);
        work.issueCover = issueCoverOf(work, documentPages);
    }
    if (regionsOnly) {
        const structure: PageStructure = {
            pages: [], opening: { page: null, afterLeaves: false }, leadingLeaves: 0, frontMatter: [], folioRun: null, running,
            regions: works.flatMap(work => work.regions).sort((a, b) => a.page - b.page || a.rows[0] - b.rows[0])
        };
        internals.set(structure, { works });
        return structure;
    }
    for (const work of works) {
        const reading = work.primary;
        if (!reading)
            continue;
        const listed = new Set<string>();
        for (const region of work.regions) {
            if (region.kind !== 'contentsList' || region.basis !== 'text')
                continue;
            for (let at = region.rows[0]; at <= region.rows[1]; at++) {
                const value = compact(reading.rows[at]);
                if (value)
                    listed.add(value);
            }
        }
        if (listed.size)
            work.folios = work.folios.filter(entry => !listed.has(compact(entry.line)));
    }
    const folioRun = folioRunOf(works);
    const proseHeights = (work: Work) => {
        const reading = work.primary;
        if (!reading?.heights)
            return [] as number[];
        return reading.basisRows.map((_row, at) => work.basisProse[at] ? reading.heights?.[at] || 0 : 0).filter(value => value > 0);
    };
    const allHeights = works.flatMap(work => {
        const reading = work.primary;
        return reading?.heights ? reading.basisRows.map((row, at) => row.trim() ? reading.heights?.[at] || 0 : 0).filter(value => value > 0) : [];
    });
    const documentBody = lowerMedian(works.flatMap(proseHeights)) || (works.filter(work => work.primary?.heights).length >= 2 ? lowerMedian(allHeights) : 0);
    for (const work of works) {
        const own = lowerMedian(proseHeights(work));
        if (own > 0)
            work.bodySize = own;
        else if (documentBody > 0 && work.primary?.heights)
            work.bodySize = documentBody;
    }
    const serials = new Set<string>();
    for (const line of running) {
        const name = line.issue?.journal || (line.kind === 'masthead' ? journalOfIssueStatement(line.seen[0]?.text || '') : null);
        if (name)
            serials.add(compact(name));
    }
    for (const work of works)
        claimOf(work, serials);
    for (const work of works)
        work.clauses = clauseListOf(work);
    const marksAnother = (work: Work) => work.issueCover || [...work.textStamp].some(at => !work.textRunning.has(at))
        || work.regions.some(region => region.kind === 'selfCitation' || (region.kind === 'otherWorks' && region.identified))
        || work.entries.some(entry => entry.rows[0] > (work.claimRows ? work.claimRows[1] : -1) && !sameTitle(entry.title, work.claimTitle));
    const firstProsePage = works.find(work => work.prose && !marksAnother(work))?.page ?? Infinity;
    const frontEnd = Math.min(firstProsePage, folioRun ? folioRun.first : Infinity);
    const front = works.filter(work => work.page <= frontEnd);
    for (const work of works) {
        const foreign: ForeignSignal[] = [];
        if (work.textStamp.size || work.basisStamp.size)
            foreign.push('stamp');
        const claimEnd = work.claimRows ? work.claimRows[1] : -1;
        const others = work.entries.filter(entry => entry.rows[0] > claimEnd && !sameTitle(entry.title, work.claimTitle));
        if (others.length || work.regions.some(region => region.kind === 'otherWorks' && region.identified))
            foreign.push('otherEntries');
        const cites = work.regions.some(region => region.kind === 'selfCitation');
        if (cites && front.some(other => other.page > work.page && other.strength !== null && !other.entryClaim))
            foreign.push('citedOnly');
        if (work.issueCover)
            foreign.push('issueCover');
        work.foreign = foreign;
        work.coverSheet = foreign.includes('citedOnly') && citesALaterTitle(work, front.filter(other => other.page > work.page));
    }
    const leafLike = (work: Work) => !!work.input.inserted || !work.words;
    const standing = (work: Work) => (work.strength ?? -Infinity) - work.foreign.length;
    const listPage = (work: Work) => regionMajority(work, 'contentsList') || regionMajority(work, 'references') || regionMajority(work, 'imprint');
    const claimedAll = front.filter(work => !leafLike(work) && work.strength !== null && !work.entryClaim && !listPage(work) && !work.clauses);
    const claimed = claimedAll.some(work => !work.coverSheet) ? claimedAll.filter(work => !work.coverSheet) : claimedAll;
    const unformed = claimed.filter(work => !work.form || work.form === 'degree');
    const pool = unformed.length ? unformed : claimed;
    const echoed = (work: Work) => !!work.claimTitle && front.some(other => other !== work && !!other.claimTitle && !other.entryClaim && !listPage(other)
        && sameTitle(work.claimTitle, other.claimTitle));
    const unknownFront = !noOpening && !(works.length && works[0].page === 1);
    let opening: Work | null = null;
    if (unknownFront) {
        const titled = works.filter(work => !leafLike(work) && !work.prose && !work.clauses && (work.strength ?? 0) >= 1 && !work.entryClaim && !listPage(work) && (!work.form || work.form === 'degree'));
        for (const work of titled)
            if (!opening || standing(work) > standing(opening))
                opening = work;
    }
    else if (!noOpening) {
        for (const work of pool) {
            if (!opening || standing(work) > standing(opening)) {
                opening = work;
                continue;
            }
            if (standing(work) === standing(opening) && echoed(work) && !echoed(opening))
                opening = work;
        }
        if (!opening)
            opening = works.find(work => !leafLike(work) && !work.clauses) || null;
    }
    const entries = rolesOf(works, opening, running, folioRun, noOpening || unknownFront);
    let leadingLeaves = 0;
    for (const entry of entries) {
        if (entry.role !== 'insertedLeaf' || entry.page !== leadingLeaves + 1)
            break;
        leadingLeaves++;
    }
    const before = opening ? entries.filter(entry => entry.page < (opening as Work).page) : [];
    const afterLeaves = !!before.length && before.every(entry => entry.role === 'insertedLeaf');
    const openingPage = opening ? opening.page : null;
    const frontMatter: number[] = [];
    if (openingPage !== null)
        for (const entry of entries) {
            if (entry.page < openingPage)
                continue;
            if (entry.page > openingPage && ['contents', 'body', 'references'].includes(entry.role))
                break;
            if (entry.role !== 'insertedLeaf')
                frontMatter.push(entry.page);
        }
    const regions: Region[] = [];
    for (const work of works) {
        if (work.masthead && work.primary)
            regions.push({ kind: 'masthead', page: work.page, basis: work.primary.basis, rows: work.masthead, because: 'banner rows above the title' });
        regions.push(...work.regions);
    }
    const structure: PageStructure = {
        pages: entries, opening: { page: openingPage, afterLeaves }, leadingLeaves, frontMatter, folioRun, running,
        regions: regions.sort((a, b) => a.page - b.page || a.rows[0] - b.rows[0])
    };
    internals.set(structure, { works });
    return structure;
}
const SECTION_NUMBERED_CLAIM = /^\d{1,2}(?:[^\S\n]?\.[^\S\n]?\d{1,2}){1,3}\.?[^\S\n]+\p{L}/u;
const RUN_ON_PAIRS = 2;
function bodyRunsOn(work: Work): boolean {
    const reading = work.primary;
    if (!reading)
        return false;
    const values = reading.rows.map(row => widestColumn(row)).filter(Boolean);
    let pairs = 0;
    for (let at = 0; at + 1 < values.length; at++) {
        const line = values[at], next = values[at + 1];
        if (weightOf(line) < STRUCTURE.proseWeight || CJK.test(line) || /[.!?:;。]["”’)\]]?$/u.test(line))
            continue;
        if (/^\p{Ll}{2,}/u.test(next) && ++pairs >= RUN_ON_PAIRS)
            return true;
    }
    return false;
}
function rolesOf(works: Work[], opening: Work | null, running: RunningLine[], folioRun: PageStructure['folioRun'], inner = false): PageEntry[] {
    const entries: PageEntry[] = [];
    const openingTitle = opening?.claimTitle || '';
    const openingText = opening?.primary?.text || '';
    const inRun = (work: Work) => !!folioRun && work.page >= folioRun.first && work.page <= folioRun.last;
    const sharesRunning = (work: Work) => running.some(line => line.kind !== 'downloadStamp' && line.pages.includes(work.page) && line.pages.some(page => page > work.page)
        && (line.kind !== 'masthead' || line.seen.some(entry => entry.page === work.page && foliated(entry.text))));
    const firstBody = (() => {
        if (!opening)
            return Infinity;
        const later = works.find(work => work.page > (opening as Work).page && (work.prose || inRun(work)));
        return later ? later.page : Infinity;
    })();
    let leading = !inner && !!works.length && works[0].page === 1;
    let previous = 0;
    for (const work of works) {
        const because: PageEntry['because'] = [];
        let role: PageRole | null = null;
        let leaf: LeafKind | undefined;
        let form: FormKind | undefined;
        if (work.page !== previous + 1)
            leading = false;
        previous = work.page;
        const beforeOpening = !!opening && work.page < opening.page;
        const afterOpening = !!opening && work.page > opening.page && work.page < firstBody;
        const rowsOf = (kind: RegionKind) => regionRows(work, kind);
        const majority = (kind: RegionKind) => regionMajority(work, kind);
        const displayClaim = work.display?.basis === 'layout';
        const sameClaim = !!work.claimTitle && !work.entryClaim && sameWork(work.claimTitle, work.primary?.text || '', openingTitle, openingText);
        const reprintsOpeningTitle = sameClaim && !SECTION_NUMBERED_CLAIM.test(work.claimTitle) && !bodyRunsOn(work);
        const listed = majority('contentsList') || majority('references');
        if (work.input.inserted) {
            role = 'insertedLeaf';
            leaf = 'foreignSize';
            because.push({ signal: 'pageSize' });
        }
        else if (!work.words && leading && (beforeOpening || !opening)) {
            role = 'insertedLeaf';
            leaf = 'blank';
            because.push({ signal: 'noWords' });
        }
        else if (work.clauses && leading && (beforeOpening || !opening) && !inRun(work) && !sharesRunning(work)) {
            role = 'insertedLeaf';
            leaf = 'wrapper';
            because.push({ signal: 'outsideFolioRun' }, { signal: 'noSharedRunning' }, { signal: 'clauseList' });
        }
        else if (work === opening) {
            role = work.prose ? 'titlePage' : 'cover';
            because.push({ signal: 'openingPage' });
            if (displayClaim)
                because.push({ signal: 'displayBlock' });
            if (work.byline)
                because.push({ signal: 'byline' });
            if (work.prose)
                because.push({ signal: 'prose' });
        }
        else if (!work.prose && work.form && work.form !== 'degree' && !listed && (beforeOpening || afterOpening)) {
            role = 'formPage';
            form = work.form;
            because.push({ signal: 'formLines', detail: work.form });
        }
        else if (beforeOpening) {
            const outside = !inRun(work);
            const shared = sharesRunning(work);
            const differs = !work.byline && !!work.claimTitle && !work.entryClaim && !sameClaim;
            const unclaimed = work.strength === null || work.entryClaim;
            if (leading && outside && !shared && (work.foreign.length > 0 || unclaimed || differs)) {
                role = 'insertedLeaf';
                leaf = 'wrapper';
                because.push({ signal: 'outsideFolioRun' }, { signal: 'noSharedRunning' });
                for (const signal of work.foreign)
                    because.push({ signal });
                if (work.strength === null)
                    because.push({ signal: 'noClaim' });
                else if (work.entryClaim)
                    because.push({ signal: 'entryClaim' });
                if (differs)
                    because.push({ signal: 'differentTitle', detail: work.claimTitle.slice(0, 80) });
            }
            else if (!work.foreign.length && sameClaim) {
                role = work.page === works[0].page ? 'cover' : 'halfTitle';
                because.push({ signal: 'sameTitleAs', detail: String(opening?.page) });
                if (displayClaim)
                    because.push({ signal: 'displayBlock' });
            }
        }
        if (!role && afterOpening && !work.prose && !work.foreign.length && reprintsOpeningTitle && work.byline) {
            role = 'titlePage';
            because.push({ signal: 'sameTitleAs', detail: String(opening?.page) }, { signal: 'byline' });
        }
        const reprintsTitle = work.form === 'degree' && sameClaim;
        if (!role && !beforeOpening && !work.prose && work.form && !listed && !reprintsTitle) {
            role = 'formPage';
            form = work.form;
            because.push({ signal: 'formLines', detail: work.form });
        }
        if (!role && majority('contentsList')) {
            role = 'contents';
            because.push({ signal: 'contentsEntries' });
        }
        if (!role && majority('references')) {
            role = 'references';
            because.push({ signal: 'referenceRegion' });
        }
        if (!role && (majority('imprint') || (afterOpening && rowsOf('imprint') > 0 && !displayClaim))) {
            role = 'colophon';
            because.push({ signal: 'imprintBlock' });
        }
        if (!role && afterOpening && !work.prose && !work.foreign.length && reprintsOpeningTitle) {
            role = 'halfTitle';
            because.push({ signal: 'sameTitleAs', detail: String(opening?.page) });
        }
        if (!role && !beforeOpening && (inRun(work) || work.prose)) {
            role = 'body';
            because.push({ signal: inRun(work) ? 'insideFolioRun' : 'prose' });
        }
        if (!role)
            role = 'other';
        if (role !== 'insertedLeaf')
            leading = false;
        const folio = folioRun && inRun(work) ? work.folios.find(entry => entry.folio === work.page + folioRun.offset) : undefined;
        entries.push({
            page: work.page, role, ...(leaf ? { leaf } : {}), ...(form ? { form } : {}), because,
            reading: work.primary ? work.primary.kind : 'none', layer: work.layer,
            ...(folio ? { folio: { value: folio.folio, where: folio.where } } : {}),
            ...(work.strength !== null ? { claim: { title: work.claimTitle, strength: work.strength, foreign: work.foreign, ...(work.entryClaim ? { entry: true } : {}) } } : {}),
            ...(work.display ? { display: work.display } : {}),
            ...(work.byline ? { byline: work.byline } : {})
        });
    }
    return entries;
}
function regionRows(work: Work, kind: RegionKind): number {
    const reading = work.primary;
    if (!reading)
        return 0;
    const inside = new Set<number>();
    for (const region of work.regions) {
        if (region.kind !== kind || region.basis !== 'text')
            continue;
        for (let at = region.rows[0]; at <= region.rows[1]; at++)
            if (reading.rows[at]?.trim() && !work.textRunning.has(at))
                inside.add(at);
    }
    return inside.size;
}
function regionMajority(work: Work, kind: RegionKind): boolean {
    const reading = work.primary;
    const pageRows = reading ? reading.rows.filter((row, at) => !!row.trim() && !work.textRunning.has(at)).length : 0;
    return pageRows > 0 && regionRows(work, kind) > pageRows * STRUCTURE.majority;
}
function folioRunOf(works: Work[]): PageStructure['folioRun'] {
    const byOffset = new Map<number, number[]>();
    for (const work of works)
        for (const offset of new Set(work.folios.map(entry => entry.folio - work.page))) {
            byOffset.set(offset, [...(byOffset.get(offset) || []), work.page]);
        }
    let best: PageStructure['folioRun'] = null;
    const consider = (first: number, last: number, offset: number) => {
        if (last - first + 1 < 2)
            return;
        if (!best || last - first > best.last - best.first || (last - first === best.last - best.first && first < best.first))
            best = { first, last, offset };
    };
    for (const [offset, pages] of byOffset) {
        const sorted = [...new Set(pages)].sort((a, b) => a - b);
        let first = sorted[0], previous = sorted[0];
        for (const page of sorted.slice(1)) {
            if (page === previous + 1) {
                previous = page;
                continue;
            }
            consider(first, previous, offset);
            first = page;
            previous = page;
        }
        consider(first, previous, offset);
    }
    return best;
}
export function structureInputFromPageObservations(pages: PageObservation[], documentPages?: number): StructureInput {
    const byPage = new Map<number, StructurePage>();
    let known = Number(documentPages) > 0 ? Number(documentPages) : 0;
    for (const observation of pages || []) {
        const number = Number(observation?.page);
        if (!Number.isInteger(number) || number < 1)
            continue;
        const page = byPage.get(number) || { page: number };
        if (observation.kind === 'ocrText')
            page.ocr = { text: String(observation.text ?? ''), ...(observation.truncated ? { truncated: true } : {}) };
        else {
            page.layer = {
                text: String(observation.text ?? ''),
                ...(observation.layout !== undefined ? { layout: String(observation.layout) } : {}),
                ...(Array.isArray(observation.lineHeights) ? { lineHeights: observation.lineHeights } : {}),
                ...(observation.truncated ? { truncated: true } : {}),
                ...(observation.degraded ? { degraded: true } : {}),
                ...(observation.glyphRisk ? { glyphRisk: true } : {}),
                ...(observation.encodingShift ? { encodingShift: observation.encodingShift } : {})
            };
        }
        if (observation.size && observation.size.width > 0 && observation.size.height > 0)
            page.size = { width: observation.size.width, height: observation.size.height };
        if (observation.inserted)
            page.inserted = true;
        if (!known && Number.isInteger(observation.pageCount) && Number(observation.pageCount) > 0)
            known = Number(observation.pageCount);
        byPage.set(number, page);
    }
    const opening = (pages || []).find(observation => observation.afterLeaves);
    if (opening)
        for (let page = 1; page < Number(opening.page); page++)
            if (!byPage.has(page))
                byPage.set(page, { page, readEmpty: true });
    return { pages: [...byPage.values()].sort((a, b) => a.page - b.page), ...(known ? { documentPages: known } : {}) };
}
const observationCache = new WeakMap<object, PageStructure>();
export function structureFromPageObservations(pages: PageObservation[], documentPages?: number): PageStructure {
    const cacheable = Array.isArray(pages) && documentPages === undefined;
    if (cacheable) {
        const held = observationCache.get(pages);
        if (held)
            return held;
    }
    const structure = readPageStructure(structureInputFromPageObservations(pages, documentPages));
    if (cacheable)
        observationCache.set(pages, structure);
    return structure;
}
const entryOf = (s: PageStructure, page: number) => s.pages.find(entry => entry.page === page);
const workIn = (s: PageStructure, page: number) => internals.get(s)?.works.find(entry => entry.page === page);
export function roleOf(s: PageStructure, page: number): PageRole | '' {
    return entryOf(s, page)?.role || '';
}
export function titleOrder(s: PageStructure, page: number): 0 | 1 | 2 | null {
    const entry = entryOf(s, page);
    if (!entry)
        return null;
    if (entry.role === 'cover' || entry.role === 'halfTitle' || entry.role === 'titlePage')
        return 0;
    if (entry.role === 'formPage' || entry.role === 'colophon')
        return 1;
    if (entry.role === 'insertedLeaf' && entry.leaf === 'wrapper')
        return 2;
    return null;
}
export function statesTheWork(s: PageStructure, page: number): boolean {
    const order = titleOrder(s, page);
    return order === 0 || order === 1;
}
export function placeOf(s: PageStructure, page: number): {
    role: PageRole;
    order: 0 | 1 | 2 | null;
    leaf?: LeafKind;
    layer: PageEntry['layer'];
} | null {
    const entry = entryOf(s, page);
    if (!entry)
        return null;
    return { role: entry.role, order: titleOrder(s, page), ...(entry.leaf ? { leaf: entry.leaf } : {}), layer: entry.layer };
}
export function freeLeaf(s: PageStructure, page: number): boolean {
    const entry = entryOf(s, page);
    return !!entry && entry.role === 'insertedLeaf' && (entry.leaf === 'foreignSize' || entry.leaf === 'blank');
}
export function bodyPages(s: PageStructure): number[] {
    const works = internals.get(s)?.works || [];
    const carriesForm = (page: number) => ['degree', 'submission', 'approval'].includes(String(works.find(work => work.page === page)?.form || ''));
    return s.pages.filter(entry => !['insertedLeaf', 'formPage'].includes(entry.role) && !carriesForm(entry.page)).map(entry => entry.page);
}
export function leafPages(s: PageStructure): Set<number> {
    return new Set(s.pages.filter(entry => entry.role === 'insertedLeaf').map(entry => entry.page));
}
export function runningKeys(s: PageStructure, kinds?: RunningKind[]): Set<string> {
    return new Set(s.running.filter(line => !kinds || kinds.includes(line.kind)).map(line => line.key));
}
export function runningTexts(s: PageStructure, kinds?: RunningKind[]): string[] {
    const out = new Set<string>();
    for (const line of s.running) {
        if (kinds && !kinds.includes(line.kind))
            continue;
        for (const entry of line.seen) {
            const text = trimmed(entry.text);
            if (text)
                out.add(text);
        }
    }
    return [...out];
}
export function runningTitles(s: PageStructure): string[] {
    const out = new Set<string>();
    for (const line of s.running)
        if (line.kind === 'runningHead' && line.statement?.title && line.statement.beside)
            out.add(line.statement.title);
    for (const work of internals.get(s)?.works || []) {
        const reading = work.primary;
        if (!reading)
            continue;
        const rows = reading.basisRows;
        const filled = filledRows(rows);
        for (const { row, rank, edge } of edgeRowsOf(rows, reading.truncated)) {
            if (edge !== 'head' || rank > STRUCTURE.rankSlack || work.basisRunning.has(row))
                continue;
            const at = filled.indexOf(row);
            const numbered = work.folios.length > 0 || foliated(rows[row])
                || [filled[at - 1], filled[at + 1]].some(near => near !== undefined && BARE_FOLIO.test(rows[near].trim()));
            if (!numbered)
                continue;
            const statement = statementOf(trimmed(rows[row]));
            if (statement?.title && statement.beside)
                out.add(statement.title);
        }
    }
    return [...out];
}
export function runningRowsIn(s: PageStructure, page: number, text: string, kinds?: RunningKind[]): Set<number> {
    const here = s.running.filter(line => line.pages.includes(page) && (!kinds || kinds.includes(line.kind)));
    const out = new Set<number>();
    if (!here.length)
        return out;
    const keys = new Set<string>(), cells = new Set<string>();
    for (const line of here) {
        keys.add(line.key);
        line.cells.forEach(cell => cells.add(cell.key));
    }
    const seen = [...new Set(here.flatMap(line => line.seen.filter(entry => entry.page === page).map(entry => compact(entry.text))))].filter(Boolean);
    const sameLetters = (value: string) => seen.some(own => own === value || (Math.min(own.length, value.length) >= 12
        && Math.max(own.length, value.length) <= STRUCTURE.lineChars && (own.includes(value) || value.includes(own))));
    const rows = String(text ?? '').split(/\r?\n/);
    for (const { row } of edgeRowsOf(rows, false)) {
        const value = rows[row];
        if (keys.has(rowKey(value)) || cells.has(cellKey(value)) || splitColumns(nfkc(value)).some(column => cells.has(cellKey(column)))
            || sameLetters(compact(value)))
            out.add(row);
    }
    return out;
}
export function pageFurnitureRows(text: unknown): Set<number> {
    const rows = String(text ?? '').split('\n');
    const out = new Set<number>();
    rows.forEach((row, at) => { const value = trimmed(row); if (value && stampShaped(value, [trimmed(rows[at - 1] || ''), trimmed(rows[at + 1] || '')]))
        out.add(at); });
    const filled = filledRows(rows);
    const edges = edgeRowsOf(rows, false);
    const statement = (row: string) => {
        const bare = withoutEdgeFolios(trimmed(row)).trim();
        if (!bare || bare.length > STRUCTURE.lineChars)
            return false;
        return statesAnIssue(bare) || isIssueStatement(bare) || HOST.test(bare) || IDENTIFIER_ROW.test(bare) || COPYRIGHT_MARK.test(bare) || serialName(bare);
    };
    for (const { row, edge } of edges) {
        if (!foliated(rows[row]) || !statement(rows[row]))
            continue;
        out.add(row);
        const at = filled.indexOf(row);
        for (const near of [filled[at - 1], filled[at + 1]]) {
            if (near !== undefined && edges.some(entry => entry.row === near && entry.edge === edge))
                out.add(near);
        }
    }
    return out;
}
export function stampRowsIn(s: PageStructure, page: number, text: string): Set<number> {
    const out = runningRowsIn(s, page, text, ['downloadStamp']);
    const inStamp = inRegionsOf(s, page, ['stamp']);
    String(text ?? '').split(/\r?\n/).forEach((row, at) => { if (row.trim() && inStamp(row))
        out.add(at); });
    return out;
}
export function withoutRunningLines(s: PageStructure, page: number, text: string, kinds?: RunningKind[]): string {
    const dropped = runningRowsIn(s, page, text, kinds);
    if (!dropped.size)
        return String(text ?? '');
    return String(text ?? '').split(/\r?\n/).filter((_, at) => !dropped.has(at)).join('\n');
}
export function runningNeighbours(s: PageStructure): Map<string, Array<Set<string>>> {
    const out = new Map<string, Array<Set<string>>>();
    for (const line of s.running)
        for (const entry of line.seen) {
            const reading = workIn(s, entry.page)?.readings.find(candidate => candidate.kind === entry.reading);
            if (!reading)
                continue;
            const filled = filledRows(reading.basisRows);
            const at = filled.indexOf(entry.row);
            const around = new Set([filled[at - 1], filled[at + 1]].filter((row): row is number => row !== undefined).map(row => edgeKey(reading.basisRows[row])));
            out.set(line.key, [...(out.get(line.key) || []), around]);
        }
    return out;
}
export function runningDate(s: PageStructure): {
    value: string;
    precision: DatePrecision;
    line: string;
    pages: number[];
} | null {
    const fineness: Record<DatePrecision, number> = { year: 1, month: 2, day: 3 };
    const lines = s.running.filter(line => line.kind !== 'downloadStamp').sort((a, b) => b.pages.length - a.pages.length);
    for (const line of lines) {
        const text = line.seen[0]?.text || '';
        if (text.length < 12 || text.length > 200 || !readVolumeIssue(text).volumes.length)
            continue;
        const reading = readDates(text).filter(entry => (!entry.role || entry.role === 'publicationDate') && entry.precision !== 'year')
            .sort((a, b) => fineness[b.precision] - fineness[a.precision])[0];
        if (reading)
            return { value: reading.value, precision: reading.precision, line: text, pages: line.pages };
    }
    return null;
}
export function headStatement(s: PageStructure, page?: number): JournalHead | null {
    const lines: string[] = [];
    for (const line of s.running) {
        if (line.kind !== 'masthead' && line.kind !== 'runningHead')
            continue;
        const seen = page === undefined ? line.seen[0] : line.seen.find(entry => entry.page === page);
        if (seen)
            lines.push(seen.text);
    }
    const target = page ?? s.opening.page;
    const work = target === null ? undefined : workIn(s, target);
    const masthead = s.regions.find(region => region.kind === 'masthead' && region.page === target);
    if (work?.primary && masthead) {
        const rows = masthead.basis === 'layout' ? work.primary.basisRows : work.primary.rows;
        for (let at = masthead.rows[0]; at <= masthead.rows[1]; at++)
            if (rows[at]?.trim())
                lines.push(widestColumn(rows[at]));
    }
    return lines.length ? journalHeadStatement([...new Set(lines)].join('\n')) : null;
}
const STATED_NUMBER = /^(?=[\w./-]*\d)(?=[\w./-]*[A-Za-z]|[\w./-]*\d[-_./]\d)[A-Za-z0-9][\w./-]{3,39}$/;
export function statedNumberShaped(value: unknown): boolean {
    const text = nfkc(value).trim();
    if (!STATED_NUMBER.test(text))
        return false;
    if (canonicalDate(text) || /^(?:1[4-9]|20)\d{2}\s*[-–]\s*(?:\d{2}|(?:1[4-9]|20)\d{2})$/.test(text))
        return false;
    if (validISSN(text) || validISBN(text) || /^10\.\d{4,9}\//.test(text))
        return false;
    return !/^(?:https?:|www\.)|\.(?:com|org|net|edu|gov|html?|pdf)$/i.test(text);
}
const NUMBER_LABEL = /^(?:\d{1,3}\s+)?((?:[A-Za-z][A-Za-z.]*\s+){0,3}(?:number|no\.?|nr\.?|id))\s*[:：#]\s*(\S*)\s*$/i;
const NOT_THE_DOCUMENTS_NUMBER = /\b(?:phone|telephone|tel|fax|isbn|issn|doi|pages?|volume|issue|serial|customer|contract|grant|award|account|project|model|lot|batch|registration|tax|vat|case|patent|application|cas|ec|mdl|einecs|beilstein|pubchem|product|catalog(?:ue)?|cat)\b/i;
export function labelledNumber(text: unknown): string | null {
    const lines = nfkc(text).split('\n').map(line => line.trim());
    for (let at = 0; at < lines.length; at++) {
        if (lines[at].length > STRUCTURE.lineChars)
            continue;
        const label = NUMBER_LABEL.exec(lines[at]);
        if (!label || NOT_THE_DOCUMENTS_NUMBER.test(label[1]))
            continue;
        const value = label[2] || lines.slice(at + 1).find(line => line) || '';
        if (statedNumberShaped(value))
            return value;
    }
    return null;
}
const REVISION_MARK = /(?<![\p{L}])(?:rev(?:ision)?|version|ver)\.?[^\S\n]*[A-Za-z0-9][\w.]*/giu;
const FOLIO_MARK = /\bpage[^\S\n]*\d{1,4}(?:[^\S\n]*(?:of|\/)[^\S\n]*\d{1,4})?\b|(?<![\w/.])\d{1,4}[^\S\n]*\/[^\S\n]*\d{1,4}(?![\w/.])/gi;
function numberBesideADate(row: string): string | null {
    if (!row || row.length > STRUCTURE.lineChars)
        return null;
    const dates = readDates(row).filter(reading => reading.precision !== 'year').sort((a, b) => b.index - a.index);
    if (!dates.length)
        return null;
    let rest = row;
    for (const reading of dates)
        rest = `${rest.slice(0, reading.index)} ${rest.slice(reading.index + reading.raw.length)}`;
    const tokens = rest.replace(REVISION_MARK, ' ').replace(FOLIO_MARK, ' ').split(/\s+/)
        .map(unwrapped).filter(token => token && !/^[/|｜·•,;:–—−-]+$/.test(token));
    return tokens.length === 1 && statedNumberShaped(withoutStatus(tokens[0]).value) ? tokens[0] : null;
}
export function imprintNumber(text: unknown): string | null {
    const rows = nfkc(text).split('\n').map(row => row.trim()).filter(Boolean);
    const dated = (row: string) => row.length <= STRUCTURE.lineChars && readDates(row).some(reading => reading.precision !== 'year');
    for (const [at, row] of rows.entries()) {
        const parts = row.split(/\s+[/|｜]\s+|\s{2,}/).map(part => part.trim()).filter(Boolean);
        if (parts.length === 2) {
            const code = parts.find(statedNumberShaped), other = parts.find(part => part !== code);
            if (code && other && dated(other))
                return code;
        }
        const beside = numberBesideADate(row);
        if (beside)
            return beside;
        const nearby = [at - 2, at - 1, at + 1, at + 2].filter(index => index >= 0 && index < rows.length).map(index => rows[index]);
        if (statedNumberShaped(row) && nearby.some(dated))
            return row;
    }
    return null;
}
const STATUS_SUFFIX = /_(\p{Ll}+)$/u;
export function withoutStatus(value: string): {
    value: string;
    status?: string;
} {
    const suffix = STATUS_SUFFIX.exec(value);
    return suffix && value.length - suffix[0].length >= 4 ? { value: value.slice(0, suffix.index), status: suffix[1] } : { value };
}
export interface DocumentCode {
    value: string;
    kind: 'documentNumber' | 'part';
    pages: number[];
    from: Array<'label' | 'running' | 'display' | 'imprint' | 'folioRow'>;
    status?: string;
}
export function codesOf(s: PageStructure): DocumentCode[] {
    const out: DocumentCode[] = [];
    const add = (raw: string, kind: 'documentNumber' | 'part', pages: number[], from: DocumentCode['from'][number]) => {
        const cut = kind === 'documentNumber' ? withoutStatus(withoutTrailing(raw, CODE_END)) : { value: withoutTrailing(raw, CODE_END) } as {
            value: string;
            status?: string;
        };
        const { value, status } = cut;
        const held = out.find(entry => entry.value === value);
        if (held) {
            held.pages = [...new Set([...held.pages, ...pages])].sort((a, b) => a - b);
            if (kind === 'documentNumber')
                held.kind = kind;
            if (!held.from.includes(from))
                held.from.push(from);
            if (status && !held.status)
                held.status = status;
        }
        else
            out.push({ value, kind, pages, from: [from], ...(status ? { status } : {}) });
    };
    for (const line of s.running) {
        if (line.kind === 'documentNumber') {
            const lone = line.seen.map(entry => withoutEdgeFolios(trimmed(entry.text))).find(codeToken)
                || line.cells.map(cell => cell.text.trim()).find(codeToken);
            if (lone)
                add(lone, 'documentNumber', line.pages, 'running');
        }
        for (const code of line.codes)
            if (!out.some(entry => entry.value === code))
                add(code, 'part', line.pages, 'running');
    }
    const opening = s.opening.page;
    const work = opening === null ? undefined : workIn(s, opening);
    const display = opening === null ? undefined : entryOf(s, opening)?.display;
    if (work?.primary && display) {
        const rows = widestValues(work.primary.basisRows);
        const filled = filledRows(work.primary.basisRows);
        const first = filled.indexOf(display.rows[0]), last = filled.indexOf(display.rows[1]);
        for (const at of [filled[first - 1], filled[last + 1]]) {
            if (at === undefined)
                continue;
            const value = withoutTrailing(rows[at], CODE_END);
            if (codeToken(value))
                add(value, 'documentNumber', [work.page], 'display');
        }
    }
    const front = [...s.frontMatter];
    const after = s.pages.find(entry => entry.page > Math.max(opening ?? 0, ...front) && entry.role !== 'insertedLeaf');
    if (after)
        front.push(after.page);
    for (const page of front) {
        const text = workIn(s, page)?.primary?.text;
        const value = text ? labelledNumber(text) : null;
        if (value)
            add(value, 'documentNumber', [page], 'label');
    }
    if (work?.primary) {
        const value = imprintNumber(work.primary.text);
        if (value)
            add(value, 'documentNumber', [work.page], 'imprint');
        const rows = work.primary.basisRows;
        const filled = filledRows(rows);
        const edges = edgeRowsOf(rows, work.primary.truncated);
        const folioRows = new Set(edges.filter(({ row }) => foliated(rows[row])).map(({ row }) => row));
        for (const { row } of edges) {
            if (work.basisRunning.has(row))
                continue;
            const at = filled.indexOf(row);
            if (!folioRows.has(row) && ![filled[at - 1], filled[at + 1]].some(near => near !== undefined && folioRows.has(near)))
                continue;
            for (const code of codesInRow(rows[row]))
                add(code, 'part', [work.page], 'folioRow');
        }
    }
    return out;
}
export function mastheadFor(s: PageStructure | null | undefined, page: number, reading: {
    text?: unknown;
    layout?: unknown;
    lineHeights?: number[];
}): [
    number,
    number
] | null {
    const text = nfkc(reading.text);
    const layout = reading.layout === undefined || reading.layout === null ? '' : String(reading.layout);
    const basis = layout.trim() ? layout : text;
    const work = s ? workIn(s, page) : undefined;
    if (s && work?.primary && nfkc(work.primary.basisRows.join('\n')) === nfkc(basis)) {
        return s.regions.find(region => region.kind === 'masthead' && region.page === page)?.rows ?? null;
    }
    const one = readPageStructure({ pages: [{ page: 1, layer: { text, ...(layout.trim() ? { layout } : {}),
                    ...(Array.isArray(reading.lineHeights) && reading.lineHeights.length ? { lineHeights: reading.lineHeights } : {}) } }] });
    return one.regions.find(region => region.kind === 'masthead')?.rows ?? null;
}
const furnitureCells = (row: string) => nfkc(row).trim().split(/\s{2,}/).map(cell => cell.trim()).filter(Boolean);
function issuerCell(cell: string): string | null {
    if (rightsMark(cell))
        return null;
    const name = tidyOrganisation(cell);
    if (name.length < 2 || name.length > 40 || name.split(/\s+/).filter(word => word !== '/').length > 4 || !/\p{L}/u.test(name) || /[.;!?]$/.test(name))
        return null;
    return name.split(/\s*[,/]\s*/).some(piece => isOrganisationOnly(piece) || LEGAL_FORM.test(piece) || CELL_LEGAL_FORM.test(piece)) ? name : null;
}
const CELL_LEGAL_FORM = /(?<![\p{L}'’-])(?:AG|KG|N\.V|S\.p\.A|S\.r\.l)\.?(?![\p{L}])/u;
export function footerIssuerOf(s: PageStructure, page: number): string | null {
    const work = workIn(s, page);
    const reading = work?.primary;
    if (!work || !reading)
        return null;
    const rows = reading.basisRows;
    const furniture = edgeRowsOf(rows, reading.truncated)
        .filter(({ row }) => (work.basisRunning.has(row) && !work.basisStamp.has(row)) || foliated(rows[row]))
        .sort((a, b) => (a.edge === b.edge ? 0 : a.edge === 'foot' ? -1 : 1) || a.rank - b.rank);
    for (const { row } of furniture) {
        const cells = furnitureCells(rows[row]);
        if (cells.length < 2)
            continue;
        for (const cell of cells) {
            const name = issuerCell(cell);
            if (name)
                return name;
        }
    }
    return null;
}
export function regionsOf(s: PageStructure, page: number, kinds: RegionKind[]): Region[] {
    return s.regions.filter(region => region.page === page && kinds.includes(region.kind));
}
export function mostlyRegion(s: PageStructure, page: number, kind: RegionKind): boolean {
    const work = workIn(s, page);
    return !!work && regionMajority(work, kind);
}
export function inRegionsOf(s: PageStructure, page: number, kinds: RegionKind[]): (line: string) => boolean {
    const work = workIn(s, page);
    const reading = work?.primary;
    const held = new Set<string>();
    if (work && reading) {
        for (const region of work.regions) {
            if (region.basis !== 'text' || !kinds.includes(region.kind))
                continue;
            for (let at = region.rows[0]; at <= region.rows[1]; at++) {
                const value = compact(reading.rows[at]);
                if (value)
                    held.add(value);
            }
        }
    }
    return (line: string) => held.size > 0 && held.has(compact(line));
}
export function textOf(s: PageStructure, page: number, options: {
    without?: Array<RegionKind | 'running'>;
    reading?: 'layer' | 'ocr';
} = {}): string {
    const work = workIn(s, page);
    if (!work)
        return '';
    const reading = options.reading ? work.readings.find(entry => entry.kind === options.reading) : work.primary;
    if (!reading)
        return '';
    const without = new Set(options.without || []);
    const dropped = new Set<number>();
    if (reading === work.primary) {
        for (const region of work.regions) {
            if (region.basis !== 'text' || !without.has(region.kind))
                continue;
            for (let at = region.rows[0]; at <= region.rows[1]; at++)
                dropped.add(at);
        }
        if (without.has('running'))
            work.textRunning.forEach(at => dropped.add(at));
    }
    else if (without.has('running')) {
        const keys = runningKeys(s);
        for (const { row } of edgeRowsOf(reading.rows, reading.truncated))
            if (keys.has(rowKey(reading.rows[row])))
                dropped.add(row);
    }
    const kept: string[] = [];
    reading.rows.forEach((row, at) => {
        if (!dropped.has(at))
            kept.push(row);
        else if (kept[kept.length - 1] !== '')
            kept.push('');
    });
    return kept.join('\n');
}
export function frontMatterText(s: PageStructure, separator = '\f'): string {
    return s.frontMatter.map(page => textOf(s, page)).filter(text => text.trim()).join(separator);
}
export function legacyRole(entry: PageEntry): string {
    switch (entry.role) {
        case 'insertedLeaf': return 'platformCover';
        case 'halfTitle': return 'titlePage';
        case 'other': return 'unknown';
        case 'formPage': return entry.form === 'approval' ? 'approval' : entry.form === 'degree' ? 'titlePage' : 'submission';
        default: return entry.role;
    }
}
export function documentLayer(s: PageStructure): 'readable' | 'broken' | 'none' {
    let readable = 0, broken = 0;
    const inherited = pagesBehindABrokenWindow(s);
    const works = internals.get(s)?.works || [];
    for (const entry of s.pages) {
        if (entry.leaf === 'foreignSize')
            continue;
        if (entry.layer !== 'none' && inherited.has(entry.page)) {
            broken++;
            continue;
        }
        if (entry.layer === 'broken')
            broken++;
        else if (entry.layer === 'readable') {
            const stored = works.find(work => work.page === entry.page)?.input.layer;
            const text = String(stored?.stored ?? stored?.text ?? '');
            if (!text || countedLetters(withoutFurnitureLines(s, entry.page, text)) >= STRUCTURE.profileLetters)
                readable++;
        }
    }
    return !readable && !broken ? 'none' : broken > readable ? 'broken' : 'readable';
}
const countedLetters = (text: string) => (String(text || '').normalize('NFKC').match(/[\p{L}\p{N}]/gu) || []).length;
const furnitureViews = new WeakMap<PageStructure, PageStructure>();
export function furnitureView(s: PageStructure): PageStructure {
    const held = furnitureViews.get(s);
    if (held)
        return held;
    const marked = s.running.filter(line => line.carriesFolio || line.kind === 'downloadStamp' || line.kind === 'masthead' || line.kind === 'documentNumber'
        || line.seen.some(entry => /https?:\/\/|\bwww\./i.test(String(entry.text || ''))));
    const view = marked.length === s.running.length ? s : { ...s, running: marked };
    furnitureViews.set(s, view);
    return view;
}
export function withoutFurnitureLines(s: PageStructure, page: number, text: string): string {
    const view = furnitureView(s);
    return view.running.length && Number.isInteger(page) ? withoutRunningLines(view, page, text) : text;
}
const inheritedPages = new WeakMap<PageStructure, Set<number>>();
export function pagesBehindABrokenWindow(s: PageStructure): Set<number> {
    const held = inheritedPages.get(s);
    if (held)
        return held;
    const out = new Set<number>();
    inheritedPages.set(s, out);
    const works = internals.get(s)?.works || [];
    const laid = (work: Work) => typeof work.input.layer?.layout === 'string' || Array.isArray(work.input.layer?.lineHeights);
    const window = works.filter(laid);
    if (!window.length)
        return out;
    const anyOCR = works.some(work => !!work.input.ocr);
    const flagged = (work: Work) => !!(work.input.layer?.degraded || work.input.layer?.glyphRisk || work.input.layer?.encodingShift) || (anyOCR && work.layer === 'broken');
    const measured = window.filter(work => countedLetters(String(work.input.layer?.stored ?? work.input.layer?.text ?? '')) >= STRUCTURE.profileLetters);
    if (!measured.length || !measured.every(flagged))
        return out;
    const last = Math.max(...window.map(work => work.page));
    for (const work of works)
        if (work.page > last && work.input.layer && !laid(work))
            out.add(work.page);
    return out;
}
export interface StructureRow {
    row: number;
    text: string;
    block: number;
    region: RegionKind | null;
    running: RunningKind | null;
    claim: boolean;
    display: boolean;
    byline: boolean;
    prose: boolean;
    marked: boolean;
    primary: boolean;
}
const ROW_REGION_ORDER: RegionKind[] = ['stamp', 'references', 'citation', 'otherWorks', 'contentsList', 'acknowledgements', 'table', 'selfCitation', 'imprint', 'masthead'];
const structureRows = new WeakMap<PageStructure, Map<string, StructureRow[]>>();
export function rowsOf(s: PageStructure, page: number, reading?: 'layer' | 'ocr'): StructureRow[] {
    const work = workIn(s, page);
    const primary = work?.primary;
    if (!work || !primary)
        return [];
    const target = reading ? work.readings.find(entry => entry.kind === reading) : primary;
    if (!target)
        return [];
    let held = structureRows.get(s);
    if (!held) {
        held = new Map();
        structureRows.set(s, held);
    }
    const cacheKey = `${page}\u0000${target.kind}`;
    const known = held.get(cacheKey);
    if (known)
        return known;
    const rows = primary.rows;
    const regionAt: Array<RegionKind | null> = rows.map(() => null);
    const basisMarks = (range: [
        number,
        number
    ] | null | undefined): Set<number> => {
        const out = new Set<number>();
        if (!range)
            return out;
        if (primary.basis === 'text') {
            for (let at = range[0]; at <= range[1]; at++)
                out.add(at);
            return out;
        }
        const wanted: string[] = [];
        for (let at = range[0]; at <= range[1]; at++) {
            const value = compact(widestColumn(primary.basisRows[at] || ''));
            if (value)
                wanted.push(value);
        }
        rows.forEach((row, at) => {
            const value = compact(row);
            if (!value)
                return;
            if (wanted.some(own => own === value || (Math.min(own.length, value.length) >= 12 && Math.max(own.length, value.length) <= STRUCTURE.lineChars && (own.includes(value) || value.includes(own)))))
                out.add(at);
        });
        return out;
    };
    for (const kind of [...ROW_REGION_ORDER].reverse()) {
        for (const region of work.regions.filter(entry => entry.kind === kind)) {
            if (region.basis === 'text') {
                for (let at = region.rows[0]; at <= region.rows[1] && at < rows.length; at++)
                    regionAt[at] = kind;
            }
            else
                for (const at of basisMarks(region.rows))
                    regionAt[at] = kind;
        }
        if (kind === 'masthead' && work.masthead)
            for (const at of basisMarks(work.masthead))
                if (regionAt[at] === null)
                    regionAt[at] = 'masthead';
    }
    const runningAt: Array<RunningKind | null> = rows.map(() => null);
    for (const at of work.textRunning) {
        const key = rowKey(rows[at]), cell = cellKey(rows[at]);
        const line = s.running.find(entry => entry.pages.includes(page) && (entry.key === key || entry.cells.some(held => held.key === cell || held.key === key)));
        runningAt[at] = work.textStamp.has(at) ? 'downloadStamp' : line?.kind ?? (at < rows.length / 2 ? 'runningHead' : 'runningFoot');
    }
    const claims = basisMarks(work.claimRows), displays = basisMarks(work.display?.rows), bylines = basisMarks(work.byline?.rows);
    const proseAt = (at: number) => !!work.textProse[at];
    let block = 0, previousBlank = false;
    const own: StructureRow[] = rows.map((text, at) => {
        const blank = !text.trim();
        if (!blank && previousBlank && at > 0)
            block++;
        previousBlank = blank;
        return { row: at, text, block, region: regionAt[at], running: runningAt[at], claim: claims.has(at), display: displays.has(at), byline: bylines.has(at),
            prose: proseAt(at), marked: true, primary: true };
    });
    if (target === primary) {
        held.set(cacheKey, own);
        return own;
    }
    const byShape = new Map<string, StructureRow>();
    for (const entry of own) {
        const value = compact(entry.text);
        if (value && !byShape.has(value))
            byShape.set(value, entry);
    }
    const lone = target.rows.some(text => text.trim() && !byShape.has(compact(text))) ? loneRowsOf(target.text) : [];
    let otherBlock = 0, otherBlank = false;
    const other = target.rows.map((text, at): StructureRow => {
        const blank = !text.trim();
        if (!blank && otherBlank && at > 0)
            otherBlock++;
        otherBlank = blank;
        const match = byShape.get(compact(text));
        if (match)
            return { ...match, row: at, text, block: otherBlock, marked: true, primary: false };
        const alone = lone[at];
        return alone && alone.text === text
            ? { ...alone, row: at, text, block: otherBlock, marked: false, primary: false }
            : { row: at, text, block: otherBlock, region: null, running: null, claim: false, display: false, byline: false, prose: false, marked: false, primary: false };
    });
    held.set(cacheKey, other);
    return other;
}
const loneRows = new Map<string, StructureRow[]>();
function loneRowsOf(text: string): StructureRow[] {
    const held = loneRows.get(text);
    if (held)
        return held;
    const one = readPageStructure({ pages: [{ page: 1, layer: { text } }] });
    const rows = rowsOf(one, 1);
    loneRows.set(text, rows);
    if (loneRows.size > 64)
        loneRows.delete(loneRows.keys().next().value as string);
    return rows;
}
export interface TitleRow {
    row: number;
    text: string;
    height: number;
    indent: number;
    centre: number;
    blanksBefore: number;
    block: number;
    seat: 'masthead' | 'running' | 'stamp' | RegionKind | null;
    prose: boolean;
    claim: boolean;
    display: boolean;
    byline: boolean;
    marked: boolean;
}
export interface TitlePageFacts {
    page: number;
    reading: 'layer' | 'ocr';
    basis: 'layout' | 'text';
    bodySize: number;
    width: number | null;
    firstProse: number;
    role: PageRole | '';
    titleOrder: 0 | 1 | 2 | null;
    strength: 0 | 1 | 2 | 3 | null;
    entryClaim: boolean;
    masthead: [
        number,
        number
    ] | null;
    rendering: {
        text: string;
        layout?: string;
        lineHeights?: number[];
        degraded?: boolean;
        glyphRisk?: boolean;
    };
}
const titleRowCache = new WeakMap<PageStructure, Map<string, {
    rows: TitleRow[];
    facts: TitlePageFacts;
} | null>>();
export function titleRowsOf(s: PageStructure, page: number, reading?: 'layer' | 'ocr'): {
    rows: TitleRow[];
    facts: TitlePageFacts;
} | null {
    const work = workIn(s, page);
    const primary = work?.primary;
    if (!work || !primary)
        return null;
    const target = reading ? work.readings.find(entry => entry.kind === reading) : primary;
    if (!target)
        return null;
    let held = titleRowCache.get(s);
    if (!held) {
        held = new Map();
        titleRowCache.set(s, held);
    }
    const cacheKey = `${page}\u0000${target.kind}`;
    if (held.has(cacheKey))
        return held.get(cacheKey) ?? null;
    const own = target === primary;
    const basisRows = target.basisRows;
    const heights = target.heights;
    const regionByShape = new Map<string, RegionKind>();
    for (const kind of [...ROW_REGION_ORDER].reverse()) {
        for (const region of work.regions.filter(entry => entry.kind === kind && entry.basis === 'text')) {
            for (let at = region.rows[0]; at <= region.rows[1]; at++) {
                const value = compact(primary.rows[at]);
                if (value)
                    regionByShape.set(value, kind);
            }
        }
    }
    const primaryShapes = new Map<string, number>();
    if (!own)
        primary.basisRows.forEach((row, at) => { const value = compact(widestColumn(row)); if (value && !primaryShapes.has(value))
            primaryShapes.set(value, at); });
    const inRange = (range: [
        number,
        number
    ] | null | undefined, at: number) => !!range && at >= range[0] && at <= range[1];
    const rows: TitleRow[] = [];
    let blanks = 0, block = 0, previousFilled = false;
    basisRows.forEach((raw, at) => {
        if (!raw.trim()) {
            blanks++;
            previousFilled = false;
            return;
        }
        if (!previousFilled && rows.length)
            block++;
        previousFilled = true;
        const value = widestColumn(raw);
        const key = compact(value);
        const mapped = own ? at : (primaryShapes.get(key) ?? -1);
        const marked = mapped >= 0;
        const seat: TitleRow['seat'] = !marked ? null
            : inRange(work.masthead, mapped) ? 'masthead'
                : work.basisStamp.has(mapped) ? 'stamp'
                    : work.basisRunning.has(mapped) ? 'running'
                        : primary.basis === 'text' ? (work.regions.find(region => region.basis === 'text' && mapped >= region.rows[0] && mapped <= region.rows[1])?.kind ?? null)
                            : regionByShape.get(key) ?? null;
        const indent = raw.length - raw.trimStart().length;
        rows.push({ row: at, text: value, height: heights ? Number(heights[at]) || 0 : 0, indent, centre: indent + raw.trim().length / 2, blanksBefore: blanks, block,
            seat, prose: marked && !!work.basisProse[mapped], claim: marked && inRange(work.claimRows, mapped), display: marked && inRange(work.display?.rows, mapped),
            byline: marked && inRange(work.byline?.rows, mapped), marked });
        blanks = 0;
    });
    const entry = entryOf(s, page);
    const layer = work.input.layer;
    const rendering = target.kind === 'layer' && layer
        ? { text: String(layer.text ?? ''), ...(layer.layout !== undefined ? { layout: String(layer.layout) } : {}), ...(Array.isArray(layer.lineHeights) ? { lineHeights: layer.lineHeights.map(Number) } : {}),
            ...(layer.degraded ? { degraded: true } : {}), ...(layer.glyphRisk ? { glyphRisk: true } : {}) }
        : { text: target.text };
    const facts: TitlePageFacts = {
        page, reading: target.kind, basis: target.basis, bodySize: own || target.heights ? work.bodySize : 0,
        width: work.input.size && work.input.size.width > 0 ? work.input.size.width : null,
        firstProse: own ? work.firstProseBasisRow : -1, role: entry?.role || '', titleOrder: titleOrder(s, page),
        strength: work.strength, entryClaim: work.entryClaim, masthead: own ? work.masthead : null, rendering
    };
    const answer = { rows, facts };
    held.set(cacheKey, answer);
    return answer;
}
const textPageStructures = new Map<string, PageStructure>();
export function structureOfText(text: string, pages?: string[]): PageStructure {
    const value = String(text ?? '');
    const key = pages ? pages.join('\f') : value;
    const held = textPageStructures.get(key);
    if (held)
        return held;
    let split: Array<{
        page: number;
        text: string;
    }>;
    if (pages)
        split = pages.map((page, index) => ({ page: index + 1, text: page }));
    else if (value.includes('\f'))
        split = value.split('\f').map((page, index) => ({ page: index + 1, text: page }));
    else {
        const marked = [...value.matchAll(/^---[^\S\n]*PAGE[^\S\n]+(\d+)[^\S\n]*---[^\S\n]*$/gm)];
        split = marked.length
            ? marked.map((match, index) => ({ page: Number(match[1]) || index + 1, text: value.slice((match.index ?? 0) + match[0].length, marked[index + 1]?.index ?? value.length).replace(/^\n/, '') }))
            : [{ page: 1, text: value }];
    }
    const structure = readPageStructure({ pages: split.map(entry => ({ page: entry.page, layer: { text: entry.text } })) });
    textPageStructures.set(key, structure);
    if (textPageStructures.size > 64)
        textPageStructures.delete(textPageStructures.keys().next().value as string);
    return structure;
}
export function hasSentenceSeam(value: unknown): boolean {
    return SENTENCE_SEAM.test(trimmed(value));
}
export function readingsOf(s: PageStructure, page: number): Array<'layer' | 'ocr'> {
    const work = workIn(s, page);
    if (!work?.primary)
        return [];
    return [work.primary.kind, ...work.readings.filter(entry => entry !== work.primary).map(entry => entry.kind)];
}
export function explainPage(s: PageStructure, page: number): Record<string, unknown> | null {
    const work = workIn(s, page);
    if (!work)
        return null;
    return {
        basis: work.primary?.basis ?? null, bodySize: work.bodySize, masthead: work.masthead, entries: work.entries,
        claimRows: work.claimRows, claimTitle: work.claimTitle, strength: work.strength, entryClaim: work.entryClaim,
        firstProseRow: work.firstProseBasisRow, prose: work.prose, form: work.form, foreign: work.foreign, words: work.words
    };
}

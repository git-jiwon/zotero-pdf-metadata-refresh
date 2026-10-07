export type PageRole = 'platformCover' | 'cover' | 'titlePage' | 'colophon' | 'submission' | 'approval' | 'abstract' | 'contents' | 'body' | 'references' | 'unknown';
export type SemanticRole = 'workTitle' | 'author' | 'editor' | 'translator' | 'advisor' | 'committee' | 'publisher' | 'issuingBody' | 'fundingBody' | 'degreeGranting' | 'affiliation' | 'publicationDate' | 'onlineDate' | 'receivedDate' | 'acceptedDate' | 'submissionDate' | 'degreeDate' | 'copyrightDate' | 'surveyPeriod' | 'coveragePeriod' | 'revision' | 'documentNumber' | 'volume' | 'issue' | 'pages' | 'edition' | 'journal' | 'copyrightHolder' | 'accessDate';
export interface RoleSpan {
    id: string;
    observation: string;
    role: SemanticRole;
    raw: string;
    normalized: string;
    start: number;
    end: number;
    method: 'label' | 'pattern' | 'layout';
    page?: number;
    pageRole?: PageRole;
}
import { DOCUMENT_KIND, isHardFurniture, isIssueStatement, isOrganisationName, isPersonalName, journalOfIssueStatement, peopleRow } from './title-guards';
import { STRUCTURE, bodyPages, footerIssuerOf, isResponsibilityRow, leafPages, legacyRole, mastheadFor, readPageStructure, roleOfALonePage, structureInputFromPageObservations, type PageStructure } from './page-structure';
import type { PageObservation } from './candidate';
import { editionStatementsOfText, imprintStatementsOfText, organisationStatementsOfText } from './statements';
import { EDITION_ORDINALS } from './imprint-marks';
import { validISSN } from '../metadata/identifier-compare';
import { VERTICAL_STROKE_GLYPHS, confusionCost } from '../metadata/name-equivalence';
import { withoutBracketGroups, withoutTrailingBracketGroup } from '../metadata/text';
import { adverbialSubtitle, endsOnALatinFunctionWord, endsOpenInKorean, titleEnding, titleOpening, typefaceClass } from './title-grammar';
import { readPageTitleBlock, type readTitleBlock } from './title-block';
import { AUTHOR_LABEL_SOURCE, FUNDER_LABEL_SOURCE, KOREAN_ROLE_FORMS, LEADING_ROLE_SOURCE, NUMBER_LABEL_SOURCE, STATEMENT_LABEL_KO, STATEMENT_LABEL_LATIN, TAIL_ROLE_SOURCE, bylineRoleOf, labelPattern } from './label-words';
import { nameOfItem, personsOnly, positionIn, positionedName, readBylineRow, withoutLeadingConnective } from './byline-row';
import { givenAndSuffix, nameShape } from '../metadata/person-name';
import { NAME_AFTER_SCHOOL_WORD } from './agents';
const NFKC = (value: unknown) => String(value || '').replace(/ㆍ/g, '·').normalize('NFKC')
    .replace(/(?<![ᄀ-ᅟꥠ-ꥼ])ᆞ/g, '·');
function remembered<T extends string | number | boolean>(compute: (value: string) => T): (value: string) => T {
    const held = new Map<string, T>();
    return (value: string) => {
        if (value.length > 400)
            return compute(value);
        const known = held.get(value);
        if (known !== undefined)
            return known;
        const answer = compute(value);
        if (held.size >= 20000)
            held.clear();
        held.set(value, answer);
        return answer;
    };
}
const compactText = remembered(value => NFKC(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''));
export const compact = (value: unknown) => typeof value === 'string' ? compactText(value) : NFKC(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const SPACE_CHAR = /\s/;
const isSpace = (value: string, at: number) => SPACE_CHAR.test(value[at]);
const isDigit = (value: string, at: number) => { const code = value.charCodeAt(at); return code >= 48 && code <= 57; };
export function withoutEdgeFolios(value: string): string {
    let start = 0;
    let digits = 0;
    while (digits < value.length && isDigit(value, digits))
        digits++;
    if (digits >= 1 && digits <= 4 && digits < value.length && isSpace(value, digits)) {
        start = digits;
        while (start < value.length && isSpace(value, start))
            start++;
    }
    let end = value.length;
    let first = end;
    while (first > start && isDigit(value, first - 1))
        first--;
    const tail = end - first;
    if (tail >= 1 && tail <= 4 && first > start && isSpace(value, first - 1)) {
        end = first;
        while (end > start && isSpace(value, end - 1))
            end--;
    }
    return start === 0 && end === value.length ? value : value.slice(start, end);
}
const WORD_END_MARKS = new Set(['.', ',', ';', ':', '!', '?', '(', ')', "'", '’', '"', '”', '“', '-']);
export function withoutEndMarks(value: string): string {
    let end = value.length;
    while (end > 0 && WORD_END_MARKS.has(value[end - 1]))
        end--;
    return end === value.length ? value : value.slice(0, end);
}
export function classifyPage(text: unknown, index = 0): PageRole {
    const entry = roleOfALonePage(text, index === 0);
    return entry ? legacyRole(entry) as PageRole : 'unknown';
}
function structureOfPages(pages: Array<{
    page?: number;
    text?: unknown;
}>): PageStructure {
    return readPageStructure(structureInputFromPageObservations(pages as unknown as PageObservation[]));
}
export function reclassifyOpening<T extends {
    page: number;
    text: string;
    pageRole?: string;
}>(pages: T[]): T[] {
    const structure = structureOfPages(pages);
    for (const page of pages) {
        const entry = structure.pages.find(held => held.page === page.page);
        if (entry)
            page.pageRole = legacyRole(entry);
    }
    return pages;
}
export function openingLeaf(page: {
    text?: unknown;
    inserted?: boolean;
}): boolean {
    return !!page.inserted || !/\p{L}/u.test(NFKC(page.text));
}
export function markWorkOpening<T extends {
    page: number;
    text?: unknown;
    inserted?: boolean;
    afterLeaves?: boolean;
}>(pages: T[], readEmpty: (page: number) => boolean): T[] {
    const ordered = [...pages].sort((a, b) => a.page - b.page);
    const first = ordered.find(page => !openingLeaf(page));
    if (!first || !(first.page > 1))
        return pages;
    const byNumber = new Map(ordered.map(page => [page.page, page]));
    for (let page = 1; page < first.page; page++) {
        const seen = byNumber.get(page);
        if (seen ? !openingLeaf(seen) : !readEmpty(page))
            return pages;
    }
    first.afterLeaves = true;
    return pages;
}
export function pageCarriesWords(text: unknown): boolean {
    const lines = String(text || '').split('\n').map(line => line.trim()).filter(Boolean);
    const words = lines.flatMap(line => line.split(/\s+/)).filter(token => /^\p{L}{3,}$/u.test(withoutEndMarks(token)));
    if (words.length < 2)
        return false;
    const noisy = lines.filter(line => /[~=|{}\\^`]/.test(line) || /\p{L}\d{2,}\p{L}|\d\p{L}\d/u.test(line)).length;
    return noisy * 2 < lines.length;
}
interface LabelRule {
    role: SemanticRole;
    before: RegExp;
}
const LABELS: LabelRule[] = [
    { role: 'degreeGranting', before: /(?:학위\s*수여\s*기관|수여\s*기관|degree[- ]granting institution|awarded by)\s*[:：]?\s*$/i },
    { role: 'advisor', before: /(?:지도\s*교수|지도\s*위원|advisor|supervisor|supervised by)[^\n]{0,14}[:：]?\s*$/i },
    { role: 'committee', before: /(?:심사\s*위원(?:장)?|위\s*원\s*장|committee(?: member| chair)?)[^\n]{0,10}[:：]?\s*$/i },
    { role: 'issuingBody', before: /(?:발행\s*(?:기관|처)|발간\s*(?:기관|처)|펴낸\s*곳|issued by|published by|publisher)\s*[:：]?\s*$/i },
    { role: 'fundingBody', before: new RegExp(String.raw `(?:${FUNDER_LABEL_SOURCE})\s*[:：]?\s*$`, 'i') },
    { role: 'author', before: /(?:authors?|저\s*자|지은이|글|저|by)\s*[:：]\s*$/i },
    { role: 'author', before: /(?:연구\s*책임자|과제\s*책임자|principal\s+investigator)\s*[:：]?\s*$/i },
    { role: 'editor', before: /(?:편\s*저|엮은이|편집|editors?|edited by)\s*[:：]?\s*$/i },
    { role: 'translator', before: /(?:옮긴이|역자|번역|translated by|translators?)\s*[:：]?\s*$/i },
    { role: 'onlineDate', before: /(?:available\s+online|(?:first\s+)?published\s+on[\s-]?line|online(?:\s+first)?|epub\s+ahead\s+of\s+print|version\s+of\s+record\s+online)\s*[:：]?\s*$/i },
    { role: 'accessDate', before: /(?:downloaded\s+(?:from|by)[^\n]{0,80}?\bon|accessed(?:\s+on)?|retrieved(?:\s+on)?)\s*[:：]?\s*$/i },
    { role: 'publicationDate', before: /(?:발행\s*일(?:자)?|출간\s*일|(?<!\bfirst\s)(?<!\boriginally\s)(?<!\bonline\s)published(?!\s+online)|publication date|date of publication)\s*[:：]?\s*$/i },
    { role: 'receivedDate', before: /(?:received(?:\s+(?:in\s+(?:revised|final)\s+form|for\s+(?:publication|review)))?|접\s*수(?:일)?|투고(?:일)?)\s*[:：]?\s*$/i },
    { role: 'receivedDate', before: /(?<![\p{L}])(?:Read|READ)(?:\s+(?:before|at)\s+[^\n]{2,60}?)?\s*[:：,]?\s*$/u },
    { role: 'acceptedDate', before: /(?:accepted(?:\s+(?:for\s+publication|in\s+(?:revised|final)\s+form|manuscript))?|revised(?:\s+manuscript)?|in\s+final\s+form|게재\s*확정|채\s*택(?:일)?|수\s*정(?:일)?)\s*[:：]?\s*$/i },
    { role: 'submissionDate', before: /(?:제\s*출\s*일(?:자)?|submitted(?: on)?)\s*[:：]?\s*$/i },
    { role: 'degreeDate', before: /(?:학위\s*수여\s*일|수여\s*일자?|soutenue?\s+(?:publiquement\s+)?le|date\s+de\s+(?:la\s+)?soutenance|date\s+of\s+(?:the\s+)?(?:public\s+)?defen[cs]e|defen[cs]e\s+date|defended\s+on|fecha\s+de\s+(?:la\s+)?defensa|tag\s+der\s+(?:mündlichen\s+)?prüfung)\s*[:：]?\s*$/i },
    { role: 'copyrightDate', before: /(?:copyright|©|ⓒ)\s*$/i },
    { role: 'surveyPeriod', before: /(?:조사\s*기간|연구\s*기간|survey period|study period)\s*[:：]?\s*$/i },
    { role: 'revision', before: /(?:document\s*version|revision|rev\.?|개정(?:판|번호)?|버전|version)\s*[:：]?\s*$/i },
    { role: 'documentNumber', before: /(?:문서\s*번호|보고서\s*번호|report (?:no\.?|number)|document (?:no\.?|number)|part (?:no\.?|number))\s*[:：]?\s*$/i }
];
export function labelBefore(text: string, at: number): SemanticRole | null {
    const window = text.slice(Math.max(0, at - 40), at);
    for (const rule of LABELS)
        if (rule.before.test(window))
            return rule.role;
    return null;
}
export type DatePrecision = 'year' | 'month' | 'day';
export interface DateReading {
    value: string;
    precision: DatePrecision;
    raw: string;
    index: number;
    role: SemanticRole | null;
}
const MONTHS: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
    jan: '01', feb: '02', mar: '03', apr: '04', jun: '06', jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12'
};
const OTHER_LANGUAGE_MONTHS: Record<string, string> = {
    janvier: '01', février: '02', fevrier: '02', mars: '03', avril: '04', mai: '05', juin: '06', juillet: '07', août: '08', aout: '08', septembre: '09',
    octobre: '10', novembre: '11', décembre: '12', decembre: '12',
    januar: '01', jänner: '01', februar: '02', märz: '03', maerz: '03', juni: '06', juli: '07', oktober: '10', dezember: '12',
    enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06', julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10',
    noviembre: '11', diciembre: '12',
    gennaio: '01', febbraio: '02', aprile: '04', maggio: '05', giugno: '06', luglio: '07', settembre: '09', ottobre: '10', dicembre: '12',
    janeiro: '01', fevereiro: '02', março: '03', maio: '05', junho: '06', julho: '07', setembro: '09', outubro: '10', novembro: '11', dezembro: '12'
};
const monthNumber = (word: unknown, alone = false): string | undefined => {
    const key = String(word ?? '').replace(/\.$/, '').toLowerCase();
    return MONTHS[key] ?? (alone && [...key].length < 6 ? undefined : OTHER_LANGUAGE_MONTHS[key]);
};
const ADDRESS_ROW_CHARS = 400;
function insideAnAddressCell(text: string, at: number): boolean {
    const back = text.slice(Math.max(0, at - ADDRESS_ROW_CHARS), at);
    const breakBefore = back.lastIndexOf('\n');
    if (breakBefore < 0 && at > ADDRESS_ROW_CHARS)
        return false;
    const start = breakBefore < 0 ? Math.max(0, at - ADDRESS_ROW_CHARS) : at - back.length + breakBefore + 1;
    const ahead = text.slice(at, at + ADDRESS_ROW_CHARS);
    const breakAfter = ahead.indexOf('\n');
    if (breakAfter < 0 && at + ADDRESS_ROW_CHARS < text.length)
        return false;
    const stop = breakAfter < 0 ? text.length : at + breakAfter;
    const row = text.slice(start, stop);
    const cells = row.split(',');
    if (cells.length < 3)
        return false;
    let reach = start;
    for (let index = 0; index < cells.length; index++) {
        reach += cells[index].length + 1;
        if (at < reach)
            return index < cells.length - 1;
    }
    return false;
}
const pad = (value: string) => value.padStart(2, '0');
export const isMonthName = (word: unknown): boolean => Object.prototype.hasOwnProperty.call(MONTHS, String(word ?? '').replace(/\.$/, '').toLowerCase());
const DATE_MARK = '[•·‧∙|]';
const MARKED_GAP = String.raw `(?:,?\s+|[^\S\n]*${DATE_MARK}[^\S\n]*)`;
export const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function daysInMonth(year: number, month: number): number {
    if (!Number.isInteger(month) || month < 1 || month > 12)
        return 0;
    if (month === 2)
        return isLeapYear(year) ? 29 : 28;
    return MONTH_LENGTHS[month - 1];
}
export function isRealDate(year: unknown, month: unknown, day: unknown): boolean {
    const y = Number(year), m = Number(month), d = Number(day);
    if (!Number.isInteger(y) || !Number.isInteger(d))
        return false;
    return d >= 1 && d <= daysInMonth(y, m);
}
export function parseNumericDate(value: unknown): {
    value: string;
    precision: DatePrecision;
    year: number;
    month: number | null;
    day: number | null;
} | null {
    const text = NFKC(value).trim();
    const monthFirst = /^(\d{1,2})\s*[.\/]\s*(\d{4})$/.exec(text);
    if (monthFirst) {
        const month = Number(monthFirst[1]);
        if (month < 1 || month > 12)
            return null;
        return { value: monthFirst[2] + '-' + pad(monthFirst[1]), precision: 'month', year: Number(monthFirst[2]), month, day: null };
    }
    const match = /^(\d{4})(?:\s*[.\-/]\s*(\d{1,2})(?:\s*[.\-/]\s*(\d{1,2}))?\s*\.?)?$/.exec(text);
    if (!match)
        return null;
    const year = Number(match[1]);
    if (match[2] === undefined)
        return { value: match[1], precision: 'year', year, month: null, day: null };
    const month = Number(match[2]);
    if (month < 1 || month > 12)
        return null;
    if (match[3] === undefined) {
        return { value: match[1] + '-' + pad(match[2]), precision: 'month', year, month, day: null };
    }
    const day = Number(match[3]);
    if (!isRealDate(year, month, day))
        return null;
    return { value: match[1] + '-' + pad(match[2]) + '-' + pad(match[3]), precision: 'day', year, month, day };
}
export function parseNamedMonthDate(value: unknown): {
    value: string;
    precision: DatePrecision;
    year: number;
    month: number;
    day: number | null;
} | null {
    const text = NFKC(value).trim().replace(/\s+/g, ' ')
        .replace(/年/g, '년').replace(/月/g, '월').replace(/日/g, '일')
        .replace(new RegExp(`\\s*${DATE_MARK}\\s*`, 'g'), ', ');
    const monthOf = (word: string): string | null => {
        const korean = /^(\d{1,2})\s*월$/.exec(word);
        if (korean)
            return Number(korean[1]) >= 1 && Number(korean[1]) <= 12 ? pad(korean[1]) : null;
        return monthNumber(word) ?? null;
    };
    const assemble = (year: string, month: string | null, day?: string) => {
        if (!month)
            return null;
        if (day === undefined)
            return { value: `${year}-${month}`, precision: 'month' as DatePrecision, year: Number(year), month: Number(month), day: null };
        if (!isRealDate(year, month, day))
            return null;
        return { value: `${year}-${month}-${pad(day)}`, precision: 'day' as DatePrecision, year: Number(year), month: Number(month), day: Number(day) };
    };
    const korean = /^(\d{4})\s*년\s*(\d{1,2})\s*월(?:\s*(\d{1,2})\s*일)?\.?$/.exec(text);
    if (korean)
        return assemble(korean[1], monthOf(`${korean[2]}월`), korean[3]);
    const monthFirst = /^(\p{L}{3,10}|\d{1,2}\s*월)\.?\s*[,/]?\s*(?:(\d{1,2})(?:st|nd|rd|th|일)?\s*,?\s*)?(\d{4})\.?$/u.exec(text);
    if (monthFirst)
        return assemble(monthFirst[3], monthOf(monthFirst[1]), monthFirst[2]);
    const dayFirst = /^(\d{1,2})(?:st|nd|rd|th|er|º|ª)?\.?\s+(?:de\s+)?(\p{L}{3,10})\.?,?\s+(?:de\s+)?(\d{4})\.?$/u.exec(text);
    if (dayFirst)
        return assemble(dayFirst[3], monthOf(dayFirst[2]), dayFirst[1]);
    return null;
}
export function canonicalDate(value: unknown): string | null {
    const read = parseNumericDate(value) ?? parseNamedMonthDate(value);
    if (read)
        return read.value;
    const year = /^(\d{4})\s*[년年]\.?$/.exec(NFKC(value).trim());
    return year ? year[1] : null;
}
export function sameDate(left: unknown, right: unknown): boolean {
    const a = canonicalDate(left), b = canonicalDate(right);
    return a !== null && a === b;
}
export const DATE_FIELDS = new Set(['date', 'filingDate', 'issueDate']);
export function readDates(text: unknown, options: {
    stampRows?: Set<number>;
} = {}): DateReading[] {
    const page = NFKC(text);
    const found: DateReading[] = [];
    const push = (value: string, precision: DatePrecision, raw: string, index: number, unlabelled: SemanticRole | null = null) => {
        const year = Number(value.slice(0, 4));
        if (year < 1400 || year > 2100)
            return;
        if (insideIdentifier(page, index))
            return;
        const role = labelBefore(page, index) ?? unlabelled;
        found.push({ value, precision, raw, index, role });
    };
    for (const match of page.matchAll(/\b((?:1[4-9]|20)\d{2})\s*[.\-/]\s*(\d{1,2})(?:\s*[.\-/]\s*(\d{1,2}))?\b/g)) {
        const [, year, month, day] = match;
        if (Number(month) < 1 || Number(month) > 12)
            continue;
        if (day && !isRealDate(year, month, day))
            continue;
        push(day ? `${year}-${pad(month)}-${pad(day)}` : `${year}-${pad(month)}`, day ? 'day' : 'month', match[0], match.index ?? 0);
    }
    const spelled = new Set<string>();
    for (const match of page.matchAll(new RegExp(String.raw `\b([A-Za-z]{3,9})\.?${MARKED_GAP}(?:\d{1,2}(?:st|nd|rd|th)?${MARKED_GAP})?((?:1[4-9]|20)\d{2})\b`, 'g'))) {
        const month = MONTHS[match[1].toLowerCase()];
        if (month)
            spelled.add(`${match[2]}-${month}`);
    }
    for (const match of page.matchAll(/\b(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*((?:1[4-9]|20)\d{2})\b/g)) {
        const [, left, right, year] = match;
        const at = match.index ?? 0;
        if (found.some(entry => at >= entry.index && at < entry.index + entry.raw.length))
            continue;
        const first = Number(left), second = Number(right);
        if (first > 31 || second > 31 || !first || !second)
            continue;
        let month: number | null = null, day: number | null = null;
        if (first > 12 && second <= 12) {
            day = first;
            month = second;
        }
        else if (second > 12 && first <= 12) {
            month = first;
            day = second;
        }
        else if (spelled.has(`${year}-${pad(String(second))}`) && !spelled.has(`${year}-${pad(String(first))}`)) {
            month = second;
            day = first;
        }
        else if (spelled.has(`${year}-${pad(String(first))}`) && !spelled.has(`${year}-${pad(String(second))}`)) {
            month = first;
            day = second;
        }
        if (month === null)
            continue;
        if (day !== null && !isRealDate(year, month, day))
            continue;
        push(day === null ? `${year}-${pad(String(month))}` : `${year}-${pad(String(month))}-${pad(String(day))}`, day === null ? 'month' : 'day', match[0], at);
    }
    for (const match of page.matchAll(/\b((?:1[4-9]|20)\d{2})\s*[년年](?:\s*(\d{1,2})\s*[월月](?:\s*(\d{1,2})\s*[일日])?)?/g)) {
        const [, year, month, day] = match;
        if (month && (Number(month) < 1 || Number(month) > 12))
            continue;
        if (day && !isRealDate(year, month, day))
            continue;
        push(day ? `${year}-${pad(month)}-${pad(day)}` : month ? `${year}-${pad(month)}` : year, day ? 'day' : month ? 'month' : 'year', match[0], match.index ?? 0);
    }
    for (const match of page.matchAll(new RegExp(String.raw `\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?${MARKED_GAP}((?:1[4-9]|20)\d{2})\b`, 'g'))) {
        const month = MONTHS[match[1].toLowerCase()];
        if (!month)
            continue;
        if (!isRealDate(match[3], month, match[2]))
            continue;
        push(`${match[3]}-${month}-${pad(match[2])}`, 'day', match[0], match.index ?? 0);
    }
    for (const match of page.matchAll(/\b(\d{1,2})(?:st|nd|rd|th|er)?\.?\s+(?:de[^\S\n]+)?(\p{L}{3,10})\.?,?\s+(?:de[^\S\n]+)?((?:1[4-9]|20)\d{2})\b/gu)) {
        const month = monthNumber(match[2]);
        if (!month)
            continue;
        if (!isRealDate(match[3], month, match[1]))
            continue;
        if (!MONTHS[match[2].toLowerCase()] && insideAnAddressCell(page, match.index ?? 0))
            continue;
        if (!MONTHS[match[2].toLowerCase()] && match[0].slice(0, match[0].indexOf(match[2])).includes('\n'))
            continue;
        push(`${match[3]}-${month}-${pad(match[1])}`, 'day', match[0], match.index ?? 0);
    }
    for (const match of page.matchAll(new RegExp(String.raw `\b(\p{L}{3,10})\.?${MARKED_GAP}((?:1[4-9]|20)\d{2})\b`, 'gu'))) {
        const month = monthNumber(match[1], true);
        const at = match.index ?? 0;
        if (!month)
            continue;
        if (found.some(entry => at >= entry.index && at < entry.index + entry.raw.length))
            continue;
        if (!MONTHS[match[1].toLowerCase()] && insideAnAddressCell(page, at))
            continue;
        push(`${match[2]}-${month}`, 'month', match[0], at);
    }
    for (const match of page.matchAll(/^[^\S\n]*((?:1[4-9]|20)\d{2})[^\S\n]+(0?[1-9]|1[0-2])[^\S\n]*\.?[^\S\n]*$/gm)) {
        const at = (match.index ?? 0) + match[0].indexOf(match[1]);
        if (found.some(entry => at >= entry.index && at < entry.index + entry.raw.length))
            continue;
        push(`${match[1]}-${pad(match[2])}`, 'month', match[0].trim(), at);
    }
    for (const match of page.matchAll(/\b((?:1[4-9]|20)\d{2})\b/g)) {
        const at = match.index ?? 0;
        if (found.some(entry => at >= entry.index && at < entry.index + entry.raw.length))
            continue;
        const before = page.slice(Math.max(0, at - 12), at);
        const after = page.slice(at + match[1].length, at + match[1].length + 12);
        if (/\d{3,}[^\S\n]+$/.test(before) || /^[^\S\n]+\d{3,}/.test(after))
            continue;
        if (/^[-‐‑–][\dXx]{3,}/.test(after) && !/^[-‐‑–](?:1[4-9]|20)\d{2}(?![\dXx])/.test(after))
            continue;
        push(match[1], 'year', match[0], at, coverageEnd(page, at, match[1].length) ? 'coveragePeriod' : null);
    }
    markStampDates(page, found, options.stampRows);
    return found;
}
const RANGE_AFTER = /^[^\S\n]*(?:[-‐‑–—~]|to|until|through)[^\S\n]*(?:1[4-9]|20)\d{2}(?!\d)/i;
const RANGE_BEFORE = /(?:^|\D)((?:1[4-9]|20)\d{2})[^\S\n]*(?:[-‐‑–—~]|to|until|through)[^\S\n]*$/i;
const FROM_BEFORE = /(?:^|[^\p{L}])from[^\S\n]+$/iu;
function coverageEnd(page: string, at: number, length: number): boolean {
    const before = page.slice(Math.max(0, at - 16), at);
    const after = page.slice(at + length, at + length + 16);
    const start = RANGE_BEFORE.exec(before);
    if (start)
        return labelBefore(page, at - before.length + start.index + start[0].indexOf(start[1])) === null;
    return RANGE_AFTER.test(after) || FROM_BEFORE.test(before);
}
const MONTH_SLOT_DAY_FIRST = /(?<!\d)\d{1,2}[^\S\n]+([\p{L}|]{3,12})\.?,?[^\S\n]+((?:1[4-9]|20)\d{2})(?!\d)/gu;
const MONTH_SLOT_MONTH_FIRST = /(?<![\p{L}|])([\p{L}|]{3,12})\.?[^\S\n]+\d{1,2}[^\S\n]*,[^\S\n]*((?:1[4-9]|20)\d{2})(?!\d)/gu;
const MONTH_SLOT_MONTH_YEAR = /(?<![\p{L}|])([\p{L}|]{3,12})\.?,?[^\S\n]+((?:1[4-9]|20)\d{2})(?!\d)/gu;
const FULL_MONTH_NAMES = Object.keys(MONTHS).filter(name => name.length > 4 || name === 'june' || name === 'july' || name === 'may');
function misreadMonthWord(word: string): boolean {
    if (isMonthName(word))
        return false;
    const lower = word.toLowerCase();
    let from = 0;
    while (from < word.length && VERTICAL_STROKE_GLYPHS.includes(word[from]))
        from++;
    const stripped = lower.slice(from);
    return FULL_MONTH_NAMES.some(month => (stripped !== lower && stripped.length >= 3 && month.endsWith(stripped))
        || (Math.abs(month.length - lower.length) <= 2 && confusionCost(lower, month) <= 1));
}
const GLUED_MONTH_YEAR = /(\p{L}{3,60})((?:1[4-9]|20)\d{2})(?!\d)/gu;
const NUMERIC_MONTH_YEAR = /(?<![\d./-])(?:0?[1-9]|1[0-2])[^\S\n]*[./][^\S\n]*((?:1[4-9]|20)\d{2})(?![\d./-])/g;
export function unreadMonthYears(text: unknown): Set<string> {
    const page = NFKC(text);
    const out = new Set<string>();
    for (const pattern of [MONTH_SLOT_DAY_FIRST, MONTH_SLOT_MONTH_FIRST, MONTH_SLOT_MONTH_YEAR]) {
        for (const match of page.matchAll(pattern))
            if (misreadMonthWord(match[1]))
                out.add(match[2]);
    }
    for (const match of page.matchAll(GLUED_MONTH_YEAR)) {
        const letters = match[1].toLowerCase();
        if (Object.keys(MONTHS).some(month => letters.endsWith(month)))
            out.add(match[2]);
    }
    for (const match of page.matchAll(NUMERIC_MONTH_YEAR))
        out.add(match[1]);
    return out;
}
export interface CitationStatement {
    year: string;
    title: string;
    journal: string;
    journalAbbreviation?: string;
    volume: string | null;
    issue: string | null;
    pages: string | null;
    doi: string | null;
    raw: string;
}
const NLM_CITATION = /^\s*([A-Z][A-Za-z.&'\s-]{5,60}?)\.?\s+((?:1[5-9]|20)\d{2})(?:\s+([A-Z][a-z]{2,8}))?\s*;\s*(\d{1,4})\s*\(\s*(\d{1,4})\s*\)\s*:\s*(\d{1,6}\s*[-–—]\s*\d{1,6})/;
const FEE_CODE = /(?<![\d-])(\d{4}-\d{3}[\dXx])\/\d{2}[^\S\n]+\$[^\S\n]?\d+\.\d{2}/;
export function feeCodeISSN(text: unknown): string | null {
    const found = FEE_CODE.exec(NFKC(text));
    return found ? validISSN(found[1]) || null : null;
}
const VOLUME_CITATION = /^(.{3,80}?)[,.]?\s+vol(?:ume)?\.?\s*(\d{1,4})\s*,\s*(?:no\.?\s*(\d{1,4})\s*,\s*)?pp?\.\s*(\d{1,6})\s*[-–—]\s*(\d{1,6})\s*,\s*((?:1[5-9]|20)\d{2})\.?$/i;
export function volumeCitation(line: unknown): {
    journal: string;
    volume: string;
    issue: string | null;
    pages: string;
    year: string;
} | null {
    const value = NFKC(line).replace(/\s+/g, ' ').trim();
    if (value.length > 200)
        return null;
    const found = VOLUME_CITATION.exec(value);
    if (!found)
        return null;
    const start = Number(found[4]), end = Number(found[5]);
    if (!(start > 0) || end < start || end - start >= 1000)
        return null;
    let journal = found[1].trim();
    if (!/\s/.test(journal))
        journal = journal.replace(/(?<=\p{Ll}{3})(?=\p{Lu}\p{Ll}{2})/gu, ' ');
    return { journal, volume: found[2], issue: found[3] || null, pages: `${found[4]}-${found[5]}`, year: found[6] };
}
export interface JournalHead {
    journal: string | null;
    abbreviation: string | null;
    volume: string | null;
    issue: string | null;
    pages: string | null;
    year: string | null;
    issn: string[];
    raw: Partial<Record<JournalHeadField | 'issn', string>>;
    lines: string[];
}
type JournalHeadField = 'journal' | 'abbreviation' | 'volume' | 'issue' | 'pages' | 'year';
export function journalHeadStatement(text: unknown): JournalHead | null {
    const rows = NFKC(text).split('\n').map(row => row.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const edge = [...new Set([...rows.slice(0, 8), ...rows.slice(-3)])];
    const head: JournalHead = { journal: null, abbreviation: null, volume: null, issue: null, pages: null, year: null, issn: [], raw: {}, lines: [] };
    let line = '';
    const take = (field: JournalHeadField, value: string | null | undefined) => {
        const cleaned = String(value ?? '').trim();
        if (cleaned && !head[field]) {
            head[field] = cleaned;
            head.raw[field] = line;
        }
    };
    const pagesIn = (tail: string) => {
        const range = /(?:pp?\.\s*)?\b(e?\d{1,6})\s*[-–—]\s*(\d{1,6})\b/i.exec(tail);
        if (!range)
            return null;
        const start = Number(range[1].replace(/\D/g, '')), end = Number(range[2]);
        return end >= start && end - start < 1000 && !(start >= 1850 && end <= 2100) ? `${range[1]}-${range[2]}` : null;
    };
    const yearIn = (value: string) => /(?<!\d)((?:1[5-9]|20)\d{2})(?!\d)/.exec(value)?.[1] || null;
    const nameOf = (value: string) => {
        const name = value.replace(/^\s*[《〈<＜≪\[［【〔「『(（][^》〉>＞≫\]］】〕」』)）]{1,12}[》〉>＞≫\]］】〕」』)）]\s*/u, '')
            .replace(/^\s*(?:source|journal|published\s+in)\s*[:：]\s*/i, '')
            .replace(/^\d{1,4}\s+/, '').replace(/(?:^|[\s,])(?:1[5-9]|20)\d{2}\s*$/, '')
            .replace(/^[\s|/•·,，.;:–—-]+|[\s|/•·,，.;:–—-]+$/g, '').trim();
        return name && !/\d/.test(name) && (name.match(/\p{L}/gu) || []).length >= 3 && name.split(/\s+/).length <= 10 ? name : null;
    };
    const abbreviated = (name: string) => !/[가-힣\p{Script=Han}]/u.test(name)
        && (/\p{L}\.(?:\s|$)/u.test(name) || (!/\s/.test(name) && (name.match(/\p{Lu}/gu) || []).length >= 3));
    for (line of edge) {
        const nlm = NLM_CITATION.exec(line);
        if (nlm) {
            head.lines.push(line);
            take('abbreviation', nlm[1].replace(/\s+/g, ' ').replace(/\.$/, ''));
            take('year', nlm[2]);
            take('volume', nlm[4]);
            take('issue', nlm[5]);
            take('pages', nlm[6].replace(/\s*[-–—]\s*/, '-'));
            continue;
        }
        for (const match of line.matchAll(/\b(?:[pe]\s*-?\s*)?ISSN\s*[:：]?\s*(\d{4}\s*-?\s*\d{3}[\dXx])/gi)) {
            const issn = validISSN(match[1]);
            if (issn && !head.issn.includes(issn)) {
                head.issn.push(issn);
                head.raw.issn = head.raw.issn || line;
            }
        }
        const fee = feeCodeISSN(line);
        if (fee && !head.issn.includes(fee)) {
            head.issn.push(fee);
            head.raw.issn = head.raw.issn || line;
        }
        const cited = volumeCitation(line);
        if (cited) {
            head.lines.push(line);
            const name = cited.journal ? nameOf(cited.journal) : null;
            if (name)
                take(abbreviated(name) ? 'abbreviation' : 'journal', name);
            take('volume', cited.volume);
            take('issue', cited.issue);
            take('pages', cited.pages);
            take('year', cited.year);
            continue;
        }
        if (!isIssueStatement(line))
            continue;
        head.lines.push(line);
        const korean = /^(.*?)(?:제|第)?\s*(\d{1,4})\s*(?:권|卷|巻)\s*[,，]?\s*(?:(?:제|第)?\s*(\d{1,4})\s*(?:호|號|号))?(.*)$/u.exec(line);
        const latin = /^(.*?)\bvol(?:ume)?\.?\s*(\d{1,4})\s*[,.]?\s*(?:(?:no|number|issue|iss)\.?\s*(\d{1,4}))?(.*)$/i.exec(line);
        const found = korean && /(?:권|卷|巻)/u.test(line) ? korean : latin;
        if (!found)
            continue;
        const name = nameOf(found[1]);
        if (name)
            take(abbreviated(name) ? 'abbreviation' : 'journal', name);
        take('volume', found[2]);
        take('issue', found[3]);
        take('year', yearIn(found[4]) || yearIn(found[1]));
        take('pages', pagesIn(found[4]));
    }
    return head.lines.length || head.issn.length ? head : null;
}
export function citationStatement(text: unknown): CitationStatement | null {
    const page = NFKC(text).replace(/\s+/g, ' ');
    const nlmLine = NFKC(text).split('\n')
        .map(line => NLM_CITATION.exec(line.trim()))
        .find(Boolean);
    const nlm = nlmLine;
    if (nlm) {
        const month = MONTHS[String(nlm[3] || '').toLowerCase()];
        return {
            year: month ? `${nlm[2]}-${month}` : nlm[2],
            title: '',
            journal: '',
            journalAbbreviation: nlm[1].replace(/\s+/g, ' ').trim(),
            volume: nlm[4], issue: nlm[5],
            pages: nlm[6].replace(/\s*[-–—]\s*/, '-'),
            doi: null,
            raw: nlm[0]
        };
    }
    const at = page.search(/to\s+cite\s+this\s+article\s*[:：]/i);
    if (at < 0)
        return null;
    const span = page.slice(at, at + 900);
    const shape = /\(\s*((?:1[5-9]|20)\d{2})\s*\)\s*(.+?),\s*([^,]{4,80}?),\s*(\d{1,4})\s*(?::\s*(\d{1,4}))?\s*,\s*(\d{1,6}\s*[-–—]\s*\d{1,6})(?:\s*,\s*DOI\s*[:：]?\s*(10\.\d{4,9}\/\S+?))?[\s.,]*(?:$|To link)/i.exec(span);
    if (!shape)
        return null;
    const title = shape[2].replace(/\s+/g, ' ').trim();
    if (!title || title.length < 8)
        return null;
    return {
        year: shape[1],
        title,
        journal: shape[3].replace(/\s+/g, ' ').trim(),
        volume: shape[4] || null,
        issue: shape[5] || null,
        pages: shape[6].replace(/\s*[-–—]\s*/, '-'),
        doi: shape[7] ? shape[7].replace(/[.,;]+$/, '') : null,
        raw: span.slice(0, 300)
    };
}
export type ImprintRole = 'publisher' | 'issuingBody' | 'commissioningBody' | 'contractor' | 'copyrightHolder';
export interface ImprintStatement {
    role: ImprintRole;
    name: string;
    method: 'copyright' | 'publishedBy' | 'imprintStatement' | 'recipient' | 'contractorLabel' | 'footer' | 'addressBlock';
    parent?: string;
    raw: string;
    index: number;
}
const LEGAL_FORM = /[,\s]+(?:inc|inc\.|incorporated|corp|corp\.|corporation|ltd|ltd\.|limited|llc|l\.l\.c\.|plc|co|co\.|company)\s*\.?\s*$/i;
const RESERVATION = /\s*[.,;]?\s*(?:all rights reserved|this\s+(?:work|publication|document|manual|book|material|article|journal)\b|no\s+part\s+of\b|under\s+the\s+copyright\b|무단\s*전재|판권\s*소유|printed in|이 저작물).*$/i;
const LEGAL_FORM_NEXT = /^(?:KGaA|KG|GmbH|mbH|Ltd|LLC|Inc|AG|SE|S\.?A|B\.?V|N\.?V|Limited|Pty|OHG|Corp|Co)\b\.?/;
const endOfName = (value: string) => {
    for (const match of value.matchAll(/\.[^\S\n]+/g)) {
        const rest = value.slice((match.index ?? 0) + match[0].length);
        if (LEGAL_FORM_NEXT.test(rest))
            continue;
        const words = rest.split(/\s+/).filter(Boolean);
        if (words.length >= 3 && words.slice(0, 5).some(word => /^\p{Ll}/u.test(word))) {
            return value.slice(0, match.index);
        }
    }
    return value;
};
const TRAILING_YEARS = /[\s,]*(?:1[4-9]|20)\d{2}(?:\s*[,–—-]\s*(?:1[4-9]|20)\d{2})*\s*$/;
export const tidyOrganisation = (value: string) => endOfName(NFKC(value))
    .replace(RESERVATION, '')
    .replace(/\s+/g, ' ')
    .replace(TRAILING_YEARS, '')
    .replace(/^[\s:：·,]+|[\s:：·,;]+$/g, '')
    .replace(/^by\s+(?=\p{L})/iu, '')
    .replace(/\.$/, '')
    .replace(LEGAL_FORM, '')
    .trim();
export function imprintStatements(text: unknown): ImprintStatement[] {
    return imprintStatementsOfText(text) as ImprintStatement[];
}
const PUBLISHER_WORD = /(?:university\s+press|\bpress\b|\bverlag\b|publish(?:ers?|ing)|출판사|출판부|\bbooks\b)/i;
export function footerImprint(text: unknown): string | null {
    return footerIssuerOf(readPageStructure({ pages: [{ page: 1, layer: { text: NFKC(text) } }] }), 1);
}
export type EditionScope = 'firstPublished' | 'thisEdition' | 'reprint' | 'copyright';
export interface EditionStatement {
    scope: EditionScope;
    year: string;
    edition: string | null;
    raw: string;
    index: number;
}
export function editionStatements(text: unknown): EditionStatement[] {
    return editionStatementsOfText(text);
}
function insideIdentifier(page: string, at: number): boolean {
    const before = page.slice(Math.max(0, at - 40), at);
    if (/10\.\d{4,9}\/\S*$/.test(before))
        return true;
    if (/https?:\/\/\S*$/.test(before))
        return true;
    return /[\p{L}\p{N}][.\-/]?$/u.test(before) && /\S$/.test(before) && !/\s$/.test(before)
        && /[\p{L}\p{N}]/u.test(before.slice(-2, -1) || '');
}
export const CLOCK_TIME = /(?<![\d:.])(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?![\d:–-])/;
export const IPV4_ADDRESS = /(?<![\d.])\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?![\d.])/;
const CLOCK_TIMES = new RegExp(CLOCK_TIME.source, 'g');
const IPV4_ADDRESSES = new RegExp(IPV4_ADDRESS.source, 'g');
function markStampDates(page: string, found: DateReading[], stampRows?: Set<number>): void {
    if (!found.length)
        return;
    let start = 0;
    page.split('\n').forEach((row, index) => {
        const end = start + row.length;
        const here = found.filter(entry => entry.index >= start && entry.index < end);
        if (here.length) {
            const marks: Array<[
                number,
                number
            ]> = [];
            for (const pattern of [CLOCK_TIMES, IPV4_ADDRESSES]) {
                for (const match of row.matchAll(pattern))
                    marks.push([start + (match.index ?? 0), start + (match.index ?? 0) + match[0].length]);
            }
            if (marks.length) {
                marks.sort((a, b) => a[0] - b[0]);
                const gap = (entry: DateReading) => {
                    const from = entry.index, to = entry.index + entry.raw.length;
                    let low = 0, high = marks.length;
                    while (low < high) {
                        const middle = (low + high) >> 1;
                        if (marks[middle][0] < to)
                            low = middle + 1;
                        else
                            high = middle;
                    }
                    const after = marks[low], before = marks[low - 1];
                    return Math.min(after ? Math.max(0, after[0] - to) : Infinity, before ? Math.max(0, from - before[1]) : Infinity);
                };
                here.reduce((best, entry) => gap(entry) < gap(best) ? entry : best).role = 'accessDate';
            }
            else if (stampRows?.has(index))
                for (const entry of here)
                    entry.role = 'accessDate';
        }
        start = end + 1;
    });
}
export function parseDateValue(value: unknown): {
    value: string;
    precision: DatePrecision;
} | null {
    const direct = parseNumericDate(value);
    if (direct)
        return { value: direct.value, precision: direct.precision };
    const readings = readDates(String(value || ''));
    if (!readings.length)
        return null;
    const order: DatePrecision[] = ['day', 'month', 'year'];
    for (const precision of order) {
        const hit = readings.find(entry => entry.precision === precision);
        if (hit)
            return { value: hit.value, precision };
    }
    return null;
}
export interface RangeReading {
    start: string;
    end: string;
    raw: string;
    index: number;
}
export function readPageRanges(text: unknown): RangeReading[] {
    const page = NFKC(text);
    const found: RangeReading[] = [];
    for (const match of page.matchAll(/(\d{1,6})\s*[-–—~]\s*(\d{1,6})/g)) {
        const [raw, start, end] = match;
        const at = match.index ?? 0;
        if (/\d/.test(page[at - 1] || '') || /[\d-]/.test(page[at + raw.length] || ''))
            continue;
        if (/(?:issn|isbn|doi|tel|fax|no\.)[^\n]{0,12}$/i.test(page.slice(Math.max(0, at - 20), at)))
            continue;
        if (/^0\d/.test(start) || /^0\d/.test(end))
            continue;
        const from = Number(start), to = Number(end);
        if (to > from) {
            found.push({ start, end, raw, index: at });
            continue;
        }
        if (end.length < start.length) {
            const expanded = Number(start.slice(0, start.length - end.length) + end);
            if (expanded > from) {
                found.push({ start, end: String(expanded), raw, index: at });
            }
        }
    }
    return found;
}
export function readSinglePages(text: unknown): Array<{
    value: string;
    raw: string;
    index: number;
}> {
    const page = NFKC(text);
    const found: Array<{
        value: string;
        raw: string;
        index: number;
    }> = [];
    for (const match of page.matchAll(/(?:\bpages?\b|\bpp?\.|\barticle\b|쪽|면)\s*[:：]?\s*(\d{1,6})(?!\s*[-–—~]\s*\d)/gi)) {
        found.push({ value: match[1], raw: match[0], index: match.index ?? 0 });
    }
    return found;
}
export function volumeNumber(value: unknown): string {
    const text = NFKC(value).trim();
    if (!text)
        return '';
    if (/^\d{1,4}$/.test(text))
        return text;
    if (!/권|巻|卷|제|第|\bvol(?:ume)?\.?|\bno\.?\b/i.test(text))
        return '';
    return text.match(/\d{1,4}/)?.[0] || '';
}
const VOLUME_DESIGNATOR = /(?:제|第)[^\S\n]*(\d{1,4})[^\S\n]*(?:권|巻|卷|책|부)|(?<![\p{L}])(?:vol(?:ume)?\.?|part|book|band|tome)[^\S\n]*(\d{1,4}|[IVXLC]{1,6})(?![\p{L}\d])/iu;
const ISSUE_AFTER_VOLUME = /(?:제|第)[^\S\n]*\d{1,4}[^\S\n]*(?:호|號|号)|(?<![\p{L}])(?:no|number|issue|iss)[^\S\n]*\.?[^\S\n]*\d{1,4}|\([^\S\n]*\d{1,4}[^\S\n]*\)|(?<!\d)\d{1,6}[^\S\n]*[-–—~][^\S\n]*\d{1,6}(?!\d)|(?<!\d)(?:1[5-9]|20)\d{2}(?!\d)/iu;
export interface VolumeDesignator {
    number: string;
    at: number;
    end: number;
    before: string;
    after: string;
    issue: boolean;
    script: 'cjk' | 'latin';
}
export function volumeDesignator(row: unknown): VolumeDesignator | null {
    const text = NFKC(row);
    if (!text.trim() || text.length > 400)
        return null;
    const found = VOLUME_DESIGNATOR.exec(text);
    if (!found)
        return null;
    const at = found.index, end = at + found[0].length;
    const number = found[1] ? String(Number(found[1])) : found[2];
    const after = text.slice(end);
    return { number, at, end, before: text.slice(0, at).trim(), after: after.trim(), issue: ISSUE_AFTER_VOLUME.test(after), script: found[1] ? 'cjk' : 'latin' };
}
export function opensWithVolume(line: unknown): boolean {
    const volume = volumeDesignator(line);
    if (!volume || volume.script !== 'cjk' || volume.at !== NFKC(line).length - NFKC(line).trimStart().length)
        return false;
    const next = NFKC(line).charAt(volume.end);
    return !next || /\s/.test(next);
}
export function readVolumeIssue(text: unknown): {
    volumes: string[];
    issues: string[];
} {
    const page = NFKC(text);
    const volumes: string[] = [], issues: string[] = [];
    const standalone = (match: RegExpMatchArray, group: number) => {
        const at = (match.index ?? 0) + match[0].indexOf(match[group]);
        if (/[\d+\-]/.test(page[at - 1] || ''))
            return false;
        if (/[\d-]/.test(page[at + match[group].length] || ''))
            return false;
        return !/(?:\b(?:fax|tel|telephone|phone|mobile)\b|전화|팩스|휴대전화)[\s.:：]*[+\d()\s.-]*$/i.test(page.slice(Math.max(0, at - 24), at));
    };
    for (const match of page.matchAll(/\bvol(?:ume)?\.?\s*[:：]?\s*(\d{1,4})\b/gi))
        if (standalone(match, 1))
            volumes.push(match[1]);
    const marker = (unit: '권' | '호') => {
        const marked: string[] = [], bare: string[] = [];
        for (const match of page.matchAll(new RegExp(`(제)?\\s*(\\d{1,4})\\s*${unit}(?!(?!제)[가-힣])`, 'g'))) {
            if (!standalone(match, 2))
                continue;
            if (match[1]) {
                marked.push(match[2]);
                continue;
            }
            if (unit === '권') {
                bare.push(match[2]);
                continue;
            }
            const lead = page.slice(Math.max(0, (match.index ?? 0) - 14), match.index ?? 0);
            if (/(?:\d\s*권|\bvol(?:ume)?\.?\s*\d{1,4})[\s,.]*$/i.test(lead))
                bare.push(match[2]);
        }
        return marked.length ? marked : bare;
    };
    volumes.push(...marker('권'));
    for (const match of page.matchAll(/\b(?:no\.?|number|issue|iss\.?)\s*[:：]?\s*(\d{1,4})\b/gi))
        if (standalone(match, 1))
            issues.push(match[1]);
    issues.push(...marker('호'));
    for (const match of page.matchAll(/\b(\d{1,4})\s*\(\s*(\d{1,4})\s*\)/g)) {
        const inner = Number(match[2]);
        const isYear = match[2].length === 4 && inner >= 1400 && inner <= 2100;
        if (!standalone(match, 1))
            continue;
        const lead = page.slice(Math.max(0, (match.index ?? 0) - 12), match.index ?? 0);
        if (/\d{1,4}\s*,\s*$/.test(lead))
            continue;
        const trail = page.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 12);
        if (!isYear && !/^\s*[:,]?\s*\d/.test(trail))
            continue;
        volumes.push(match[1]);
        if (!isYear)
            issues.push(match[2]);
    }
    for (const match of page.matchAll(/[\p{L}][\p{L}.\s&-]{2,60},\s*(?:1[5-9]|20)\d{2}\s*,\s*(\d{1,4})\s*,\s*\d{1,7}/gu)) {
        if (standalone(match, 1))
            volumes.push(match[1]);
    }
    return { volumes, issues };
}
const LOCATOR_LABEL = /\b(vol(?:ume)?\.?|no\.?|number|issue|iss\.?)\s*[:：]?\s*(\d{1,4})\b/gi;
const VOLUME_BESIDE = /\bvol(?:ume)?\.?[^\S\n]*(?:\d{1,4}|[IVXLC]{1,6})(?![\p{L}\d])|(?:제|第)[^\S\n]*\d{1,4}[^\S\n]*(?:권|巻|卷)|\d{1,4}[^\S\n]*\([^\S\n]*\d{1,4}[^\S\n]*\)/iu;
const ISSUE_BESIDE = /(?<![\p{L}])(?:no\.?|number|issue|iss\.?)[^\S\n]*\d{1,4}(?!\d)|(?:제|第)[^\S\n]*\d{1,4}[^\S\n]*(?:호|號|号)|\([^\S\n]*\d{1,4}[^\S\n]*\)/iu;
const YEAR_BESIDE = /(?<![\d.,])(?:1[5-9]|20)\d{2}(?!\d|[.,]\d)/;
const MONTH_BESIDE = /(?<![\p{L}])(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUNE?|JULY?|AUG(?:UST)?|SEPT?(?:EMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)(?![\p{L}])/u;
const RANGE_BESIDE = /(?<![\d-])\d{1,6}[^\S\n]*[-–—][^\S\n]*\d{1,6}(?![\d-])|\bpp?\.[^\S\n]*\d/i;
export function readVolumeIssueStatements(text: unknown): {
    volumes: string[];
    issues: string[];
} {
    const page = NFKC(text);
    let screened = '', last = 0;
    for (const match of page.matchAll(LOCATOR_LABEL)) {
        const at = match.index ?? 0, end = at + match[0].length;
        const head = page.slice(Math.max(0, at - 200), at), tail = page.slice(end, end + 200);
        const before = head.slice(head.lastIndexOf('\n') + 1).split(/[^\S\n]{3,}/).pop() || '';
        const after = (tail.includes('\n') ? tail.slice(0, tail.indexOf('\n')) : tail).split(/[^\S\n]{3,}/)[0] || '';
        const label = match[1];
        const volume = /^vol/i.test(label);
        const acrossLines = match[0].includes('\n');
        const bareWord = /^no$/.test(label);
        const fraction = /^\/\d/.test(tail);
        const alone = !before.trim() && !/[\p{L}\d]/u.test(after);
        const beside = `${before} ${after}`;
        const coordinate = (volume ? ISSUE_BESIDE : VOLUME_BESIDE).test(beside) || YEAR_BESIDE.test(beside) || MONTH_BESIDE.test(beside) || RANGE_BESIDE.test(beside);
        if (acrossLines || bareWord || fraction || !(alone || coordinate)) {
            screened += page.slice(last, at) + ' '.repeat(match[0].length);
            last = end;
        }
    }
    screened += page.slice(last);
    return readVolumeIssue(screened);
}
export function citationPages(text: unknown): {
    start: string;
    end: string;
    volume: string;
    year: string;
    raw: string;
} | null {
    const page = NFKC(text);
    for (const match of page.matchAll(/[\p{L}][\p{L}.&'’\s-]{3,60}?\s*(\d{1,4})\s*\(\s*((?:1[5-9]|20)\d{2})\s*\)\s*[:,]?\s*(\d{1,6})\s*[-–—]\s*(\d{1,6})/gu)) {
        const start = Number(match[3]), end = Number(match[4]);
        if (!start || end < start || end - start > 400)
            continue;
        return { start: match[3], end: match[4], volume: match[1], year: match[2], raw: match[0].replace(/\s+/g, ' ').trim() };
    }
    return null;
}
export interface FolioReading {
    page: number;
    folio: number;
    where: 'head' | 'foot';
    line: string;
}
export interface PageExtent {
    start: string;
    end: string;
    folios: FolioReading[];
    contentPages: number[];
    lastContentPage: number;
    documentPages: number;
    raw: string;
    opening?: {
        page: number;
        folio: number;
    };
}
function leadingPages(firstRunPage: number, firstFolio: number, before: Array<{
    page: number;
    text: string;
    folios: number;
}>, leaves: Set<number>): {
    page: number;
    folio: number;
} | null | 'unexplained' {
    const loose = before.filter(entry => !leaves.has(entry.page));
    if (!loose.length)
        return null;
    if (loose.length === 1 && loose[0].page === firstRunPage - 1 && !loose[0].folios && firstFolio > 1) {
        return { page: loose[0].page, folio: firstFolio - 1 };
    }
    return 'unexplained';
}
export function folioCandidates(text: unknown, edge = 4): Array<{
    folio: number;
    where: 'head' | 'foot';
    line: string;
}> {
    const rows = NFKC(text).split('\n').map(row => row.trim()).filter(Boolean);
    const found: Array<{
        folio: number;
        where: 'head' | 'foot';
        line: string;
    }> = [];
    const scan = (row: string, where: 'head' | 'foot') => {
        const head = /^(\d{1,5})(?![\d\-–—/.\p{L}])/u.exec(row);
        const foot = /(?<![\d\-–—/.\p{L}])(\d{1,5})$/u.exec(row);
        for (const hit of [head, foot]) {
            if (!hit)
                continue;
            const folio = Number(hit[1]);
            if (folio > 0 && folio < 100000 && !found.some(entry => entry.folio === folio && entry.line === row)) {
                found.push({ folio, where, line: row });
            }
        }
    };
    rows.slice(0, edge).forEach(row => scan(row, 'head'));
    rows.slice(-edge).forEach(row => scan(row, 'foot'));
    const issueOnly = (value: string) => /\d/.test(value) && !/[•·‧∙|,，]$/u.test(value) && journalOfIssueStatement(value) === '';
    const take = (folio: string, where: 'head' | 'foot', line: string) => {
        const number = Number(folio);
        if (number > 0 && !found.some(entry => entry.folio === number && entry.line === line))
            found.push({ folio: number, where, line });
    };
    rows.forEach((row, at) => {
        const where = at < rows.length / 2 ? 'head' as const : 'foot' as const;
        const leading = /^(\d{1,5})\s+(\S.*)$/.exec(row), trailing = /^(.*\S)\s+(\d{1,5})$/.exec(row);
        if (leading && issueOnly(leading[2]))
            take(leading[1], where, row);
        else if (trailing && issueOnly(trailing[1]))
            take(trailing[2], where, row);
        else if (/^\d{1,5}$/.test(row) && [rows[at - 1], rows[at + 1]].some(next => !!next && issueOnly(next)))
            take(row, where, row);
    });
    return found;
}
export function layerFoliosLostLeadingDigits(range: {
    start: number;
    end: number;
}, run: {
    offset: number;
    pages: number[];
}, ocr: Array<{
    page: number;
    folios: number[];
}>): boolean {
    if (!run.pages.length || !(range.end >= range.start))
        return false;
    for (const read of ocr) {
        if (!run.pages.includes(read.page))
            continue;
        const printed = String(read.page + run.offset);
        for (const folio of read.folios) {
            const whole = String(folio);
            if (whole.length <= printed.length || !whole.endsWith(printed) || folio < range.start || folio > range.end)
                continue;
            const lead = whole.slice(0, whole.length - printed.length);
            if (run.pages.every(page => { const value = Number(`${lead}${page + run.offset}`); return value >= range.start && value <= range.end; }))
                return true;
        }
    }
    return false;
}
export function folioRange(pages: Array<{
    page?: number;
    text?: string;
    layout?: string;
    pageCount?: number;
}>, structure?: PageStructure): PageExtent | null {
    const known = pages.find(entry => Number.isInteger(entry.pageCount));
    if (!known)
        return null;
    const documentPages = Number(known.pageCount);
    const ordered = [...pages].filter(entry => Number.isInteger(entry.page)).sort((a, b) => (a.page || 0) - (b.page || 0));
    const substantial = ordered.filter(entry => String(entry.text || entry.layout || '').trim().length >= 40);
    if (substantial.length < 2)
        return null;
    const contentPages = substantial.map(entry => entry.page as number);
    const lastContentPage = contentPages[contentPages.length - 1];
    const byPage = new Map<number, Array<{
        folio: number;
        where: 'head' | 'foot';
        line: string;
    }>>();
    for (const entry of substantial)
        byPage.set(entry.page as number, folioCandidates(entry.layout || entry.text));
    for (const candidate of byPage.get(lastContentPage) || []) {
        const folios: FolioReading[] = [{ page: lastContentPage, folio: candidate.folio, where: candidate.where, line: candidate.line }];
        let page = lastContentPage - 1, want = candidate.folio - 1;
        while (byPage.has(page)) {
            const hit = (byPage.get(page) || []).find(entry => entry.folio === want);
            if (!hit)
                break;
            folios.unshift({ page, folio: want, where: hit.where, line: hit.line });
            page -= 1;
            want -= 1;
        }
        const countsItself = folios.every(reading => reading.folio === reading.page);
        if (folios.length >= 2 && !countsItself) {
            const before = substantial.filter(entry => (entry.page as number) < folios[0].page)
                .map(entry => ({ page: entry.page as number, text: String(entry.text || entry.layout || ''), folios: (byPage.get(entry.page as number) || []).length }));
            const lead = leadingPages(folios[0].page, folios[0].folio, before, leafPages(structure || structureOfPages(pages)));
            if (lead === 'unexplained' && !before.some(entry => entry.folios))
                continue;
            const opening = lead && lead !== 'unexplained' ? lead : undefined;
            return {
                start: String(opening ? opening.folio : folios[0].folio),
                end: String(folios[folios.length - 1].folio),
                folios, contentPages, lastContentPage, documentPages,
                raw: folios[0].line.slice(0, 80) + ' … ' + folios[folios.length - 1].line.slice(0, 80),
                ...(opening ? { opening } : {})
            };
        }
    }
    return null;
}
export function checkPageExtent(value: unknown, extent: PageExtent | null | undefined, pages: Array<{
    page?: number;
    text?: string;
}>): {
    ok: boolean;
    reason: string;
} {
    if (!extent)
        return { ok: false, reason: '쪽마다 인쇄된 번호를 읽은 기록이 전달되지 않았습니다.' };
    const range = /^(\d{1,6})\s*[-–—~]\s*(\d{1,6})$/.exec(String(value ?? '').trim());
    if (!range)
        return { ok: false, reason: '쪽 범위 형식이 아닙니다.' };
    const folios = Array.isArray(extent.folios) ? extent.folios : [];
    if (folios.length < 2)
        return { ok: false, reason: '쪽 번호가 두 쪽 이상에서 읽히지 않았습니다.' };
    const opening = extent.opening;
    if (opening && (opening.page !== folios[0].page - 1 || opening.folio !== folios[0].folio - 1)) {
        return { ok: false, reason: `번호 없는 첫 쪽(${opening.page}쪽, ${opening.folio})이 이어지는 번호 ${folios[0].page}쪽 ${folios[0].folio}의 바로 앞이 아닙니다.` };
    }
    const first = opening ? opening.folio : folios[0].folio;
    if (range[1] !== String(first) || range[2] !== String(folios[folios.length - 1].folio)) {
        return { ok: false, reason: `제안된 범위 ${range[1]}-${range[2]}가 읽어낸 쪽 번호 ${first}-${folios[folios.length - 1].folio}와 다릅니다.` };
    }
    for (let index = 1; index < folios.length; index++) {
        if (folios[index].page !== folios[index - 1].page + 1) {
            return { ok: false, reason: `쪽 번호가 물리적 페이지와 이어지지 않습니다 (${folios[index - 1].page}쪽 다음이 ${folios[index].page}쪽).` };
        }
        if (folios[index].folio !== folios[index - 1].folio + 1) {
            return { ok: false, reason: `인쇄된 번호가 건너뜁니다 (${folios[index - 1].folio} 다음이 ${folios[index].folio}).` };
        }
    }
    if (folios.length + (opening ? 1 : 0) !== Number(range[2]) - Number(range[1]) + 1) {
        return { ok: false, reason: '범위의 길이와 번호를 읽은 쪽 수가 맞지 않습니다.' };
    }
    if (folios.every(reading => reading.folio === reading.page)) {
        return { ok: false, reason: '인쇄된 번호가 파일의 페이지 번호와 같습니다 — 원고가 자기 장수를 센 것이지 권 안의 쪽수가 아닙니다.' };
    }
    if (!Number.isInteger(extent.documentPages) || extent.documentPages < 1) {
        return { ok: false, reason: '파일 전체 길이를 모르는 읽기입니다 — 일부만 읽은 파일에서는 마지막 쪽을 말할 수 없습니다.' };
    }
    if (folios[folios.length - 1].page !== extent.lastContentPage) {
        return { ok: false, reason: '마지막 쪽 번호가 내용이 있는 마지막 페이지에 있지 않습니다.' };
    }
    if (extent.documentPages - extent.lastContentPage > 1) {
        return { ok: false, reason: `마지막 쪽 번호 뒤로 ${extent.documentPages - extent.lastContentPage}쪽이 남아 있습니다 — 그 쪽들을 보지 않고 끝을 말할 수 없습니다.` };
    }
    const held = new Map<number, string>();
    for (const entry of pages) {
        if (Number.isInteger(entry.page))
            held.set(Number(entry.page), String(entry.text ?? ''));
    }
    for (const reading of folios) {
        const text = held.get(reading.page);
        if (text === undefined)
            return { ok: false, reason: `${reading.page}쪽 본문이 없어 확인할 수 없습니다.` };
        if (!folioCandidates(text).some(entry => entry.folio === reading.folio)) {
            return { ok: false, reason: `${reading.page}쪽에서 쪽 번호 ${reading.folio}을(를) 다시 확인하지 못했습니다.` };
        }
    }
    for (const [page, text] of held) {
        if (page >= folios[0].page)
            continue;
        if (folioCandidates(text).length) {
            return { ok: false, reason: `${page}쪽에도 따로 쪽 번호가 인쇄돼 있습니다 — 한 파일에 여러 편이나 부록이 묶여 있을 수 있습니다.` };
        }
    }
    if (opening && !held.has(opening.page))
        return { ok: false, reason: `${opening.page}쪽 본문이 없어 확인할 수 없습니다.` };
    const leaves = leafPages(readPageStructure({ pages: [...held].map(([page, text]) => ({ page, layer: { text } })),
        ...(Number.isInteger(extent.documentPages) && extent.documentPages > 0 ? { documentPages: extent.documentPages } : {}) }));
    for (const [page, text] of held) {
        if (page >= (opening ? opening.page : folios[0].page) || text.trim().length < 40)
            continue;
        if (!leaves.has(page)) {
            return { ok: false, reason: `${page}쪽에는 쪽 번호가 없는데 범위는 ${opening ? opening.page : folios[0].page}쪽에서 시작합니다 — 첫 쪽이 빠진 범위일 수 있습니다.` };
        }
    }
    for (let page = 1; page <= extent.lastContentPage; page++) {
        if (!held.has(page))
            return { ok: false, reason: `${page}쪽을 읽지 않았습니다 — 파일 전체를 본 읽기가 아닙니다.` };
    }
    return { ok: true,
        reason: folios.map(reading => `${reading.page}쪽에 ${reading.folio}`).join(', ')
            + ` — ${extent.documentPages}쪽 파일의 마지막 내용 쪽까지 이어집니다.` };
}
export function looksLikeNameList(line: unknown, _isName?: (value: string) => boolean): boolean {
    const value = NFKC(line).trim();
    if (!value || value.length > 200)
        return false;
    const row = readBylineRow(value);
    const people = (row.kind === 'list' || row.kind === 'marked' || row.kind === 'pair') && !row.organisations?.length ? row.items : [];
    return people.length >= 2 && people.every(item => item.shape.person !== 'no') && people.some(item => /(?:^|\s)\p{Lu}\.(?:\s|-|$)/u.test(item.text));
}
export function edgeKey(row: string): string {
    return typeof row === 'string' ? edgeKeyOf(row) : edgeKeyOfRow(row);
}
const edgeKeyOf = remembered(row => edgeKeyOfRow(row));
function edgeKeyOfRow(row: unknown): string {
    const columns = splitColumns(NFKC(row));
    const widest = columns.reduce((best, column) => column.length > best.length ? column : best, '');
    return withoutEdgeFolios(widest).replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
}
export function carriesFolio(row: string): boolean {
    const columns = splitColumns(NFKC(row));
    if (columns.length > 1 && columns.some(column => /^\d{1,4}$/.test(column)))
        return true;
    const value = columns.join(' ');
    return /^\d{1,4}\s+\S/.test(value) || /\S\s+\d{1,4}$/.test(value);
}
function lettersAlike(a: string, b: string): boolean {
    const pairs = (value: string) => {
        const letters = compact(value).replace(/\d+/g, '');
        const out = new Map<string, number>();
        for (let at = 0; at + 1 < letters.length; at++)
            out.set(letters.slice(at, at + 2), (out.get(letters.slice(at, at + 2)) || 0) + 1);
        return { out, size: Math.max(0, letters.length - 1) };
    };
    const left = pairs(a), right = pairs(b);
    if (!left.size || !right.size)
        return false;
    let shared = 0;
    for (const [pair, count] of left.out)
        shared += Math.min(count, right.out.get(pair) || 0);
    return (2 * shared) / (left.size + right.size) >= 0.5;
}
export function readRevisions(text: unknown): string[] {
    const page = NFKC(text);
    const found: string[] = [];
    for (const match of page.matchAll(/(?:document\s*version|version|rev(?:ision)?\.?|개정판?|버전)\s*[:：]?\s*v?\s*(\d+(?:\.\d+)*[A-Za-z]?)\b/gi)) {
        found.push(match[1]);
    }
    return found;
}
const AUTHOR_REGION_LABEL = new RegExp(`(?:${AUTHOR_LABEL_SOURCE})\\s*[:：]\\s*([^\\n]{2,300})`, 'giu');
export function authorRegion(text: unknown): {
    text: string;
    index: number;
} | null {
    const page = NFKC(text);
    for (const match of page.matchAll(AUTHOR_REGION_LABEL)) {
        const at = match.index ?? 0;
        const before = page.slice(Math.max(0, at - 24), at);
        if (/(?:corresponding|co-?corresponding|first|senior|lead|교신|공동|제\s*1\s*)\s*$/i.test(before))
            continue;
        return { text: match[1], index: at + match[0].length - match[1].length };
    }
    return null;
}
export function countNames(region: unknown): number | null {
    const value = NFKC(region);
    const row = readBylineRow(value.replace(/\s+with\s+/gi, ', '));
    if (row.shortened || /\bet\s+al\b/i.test(value))
        return null;
    const parts = row.items.filter(item => item.text.length >= 2 && /[\p{L}]/u.test(item.text));
    return parts.length || null;
}
export function nameForms(creator: any): string[] {
    const whole = NFKC(creator?.firstName || '').trim();
    const last = NFKC(creator?.lastName || creator?.name || '').trim();
    if (!last)
        return [];
    if (!whole)
        return [compact(last)].filter(form => form.length >= 2);
    const { given: first, suffix } = givenAndSuffix(whole);
    const forms = [compact(`${first}${last}`), compact(`${last}${first}`)];
    if (suffix)
        forms.unshift(compact(`${first}${last}${suffix}`), compact(`${last}${first}${suffix}`));
    const initials = first.split(/[\s.\-]+/).filter(Boolean).map(part => part[0]).join('');
    if (initials)
        forms.push(compact(`${initials}${last}`), compact(`${last}${initials}`));
    const words = first.split(/[\s.]+/).filter(Boolean);
    if (words.length >= 2 && words.length <= 3) {
        for (let mask = 1; mask < (1 << words.length) - 1; mask++) {
            const given = words.map((word, at) => (mask & (1 << at) ? word[0] : word)).join('');
            forms.push(compact(`${given}${last}`), compact(`${last}${given}`));
        }
    }
    return [...new Set(forms)].filter(form => form.length >= 3);
}
const ORGANISATION_LABELS: Array<{
    role: SemanticRole;
    re: RegExp;
}> = [
    { role: 'degreeGranting', re: /(?:학위\s*수여\s*기관|수여\s*기관|degree[- ]granting institution|awarded by)\s*[:：]?\s*([^\n]{2,60})/gi },
    { role: 'advisor', re: /(?:지도\s*교수|지도\s*위원|advisor|supervisor)[^\n]{0,14}[:：]\s*([^\n]{2,60})/gi },
    { role: 'committee', re: /(?:심사\s*위원(?:장)?|committee(?: chair| member)?)[^\n]{0,10}[:：]\s*([^\n]{2,60})/gi },
    { role: 'fundingBody', re: new RegExp(String.raw `(?:${FUNDER_LABEL_SOURCE})\s*[:：]?\s*([^\n]{2,60})`, 'gi') }
];
export interface OrganisationSpan {
    role: SemanticRole | null;
    raw: string;
    normalized: string;
    index: number;
}
export function organisationSpans(text: unknown): OrganisationSpan[] {
    const page = NFKC(text);
    const spans: OrganisationSpan[] = [];
    const labelled = (role: SemanticRole, re: RegExp) => {
        for (const match of page.matchAll(re)) {
            const raw = match[1].trim().replace(/[,;·]\s*$/, '');
            if (!raw)
                continue;
            spans.push({ role, raw, normalized: compact(raw), index: match.index ?? 0 });
        }
    };
    const statements = organisationStatementsOfText(page);
    const stated = (role: 'issuingBody' | 'publisher' | 'copyrightHolder') => {
        for (const entry of statements)
            if (entry.role === role)
                spans.push({ role, raw: entry.raw, normalized: compact(entry.raw), index: entry.index });
    };
    for (const { role, re } of ORGANISATION_LABELS.slice(0, 3))
        labelled(role, re);
    stated('issuingBody');
    labelled(ORGANISATION_LABELS[3].role, ORGANISATION_LABELS[3].re);
    stated('publisher');
    stated('copyrightHolder');
    return spans;
}
export function dominantScript(text: unknown): 'ko' | 'ja' | 'zh' | 'latin' | null {
    const page = NFKC(text);
    const hangul = (page.match(/[가-힯]/g) || []).length;
    const kana = (page.match(/[぀-ヿ]/g) || []).length;
    const han = (page.match(/[一-鿿]/g) || []).length;
    const latin = (page.match(/[A-Za-z]/g) || []).length;
    const total = hangul + kana + han + latin;
    if (total < 120)
        return null;
    if (hangul / total > 0.25)
        return 'ko';
    if (kana / total > 0.1)
        return 'ja';
    if (han / total > 0.25)
        return 'zh';
    if (latin / total > 0.6)
        return 'latin';
    return null;
}
const HANGUL_WEIGHT = 2.5;
export function bodyScriptOf(pages: Array<{
    page?: number;
    text?: unknown;
}>, options: {
    withFormPages?: boolean;
    structure?: PageStructure;
} = {}): 'ko' | 'ja' | 'zh' | 'latin' | null {
    let korean = 0, kana = 0, han = 0, latin = 0, letters = 0;
    const structure = options.structure || structureOfPages(pages);
    const body = new Set(bodyPages(structure));
    const leaves = leafPages(structure);
    for (const page of pages) {
        const raw = NFKC(page.text);
        if (!raw.trim())
            continue;
        const number = Number(page.page);
        if (leaves.has(number))
            continue;
        if (!options.withFormPages && !body.has(number))
            continue;
        const text = readableLines(raw) || raw;
        const hangul = (text.match(/[가-힯]/g) || []).length;
        const pageKana = (text.match(/[぀-ヿ]/g) || []).length;
        const pageHan = (text.match(/[一-鿿]/g) || []).length;
        const pageLatin = (text.match(/[A-Za-z]/g) || []).length;
        letters += hangul + pageKana + pageHan + pageLatin;
        const mixedScript = hangul > 0 && pageKana === 0;
        korean += hangul * HANGUL_WEIGHT + (mixedScript ? pageHan : 0);
        han += mixedScript ? 0 : pageHan;
        kana += pageKana;
        latin += pageLatin;
    }
    const total = korean + kana + han + latin;
    if (letters < 120 || !total)
        return null;
    if (korean / total > 0.25)
        return 'ko';
    if (kana / total > 0.1)
        return 'ja';
    if (han / total > 0.25)
        return 'zh';
    if (latin / total > 0.6)
        return 'latin';
    return null;
}
export function readArticleNumbers(text: unknown): string[] {
    const page = NFKC(text);
    const found: string[] = [];
    for (const match of page.matchAll(/\b(?:article|art\.?)\s*(?:no\.?|number|id)?\s*[:：]?\s*(\d{4,8})\b/gi))
        found.push(match[1]);
    for (const match of page.matchAll(/\b10\.\d{4,9}\/[A-Za-z0-9._;()/:+-]*?(\d{4,9})\b/g)) {
        const digits = match[1];
        found.push(digits);
        if (digits.length > 6)
            found.push(digits.slice(-6), digits.slice(-7));
    }
    return [...new Set(found.filter(Boolean))];
}
const DOCUMENT_LABEL = DOCUMENT_KIND;
const ROLE_LABEL_OPENING = /^(?:지도\s*교수|지도\s*위원|심사\s*위원|저\s*자|지은이|옮긴이|발행|펴낸|학위\s*수여|제\s*출|advisor|supervisor|submitted|edited\s+by|authors?(?:\(s\))?\s*[:：])/i;
const SECTION_HEADING_WORD = /^(?:(key\s?-?words?)|article\s+info|abstract|graphical\s+abstract|highlights|summary|supporting\s+information|초\s*록|(?:국문\s*|영문\s*)?요\s*약(?:\s*문)?)(?=$|[\s:：.—–-])/i;
const CITE_THIS_OPENING = /^to\s+cite\s+this\b/i;
const FIGURES_PHRASE = /^with\s+\d+\s+(?:figures|illustrations|tables)/i;
function endsTheTitle(line: string): boolean {
    const value = NFKC(line).replace(/\s+/g, ' ').trim();
    if (!value)
        return false;
    if (ROLE_LABEL_OPENING.test(value) || CITE_THIS_OPENING.test(value) || FIGURES_PHRASE.test(value))
        return true;
    const heading = SECTION_HEADING_WORD.exec(value);
    if (!heading)
        return false;
    const after = value.slice(heading[0].length);
    const marked = /^\s*[:：.—–-]/.test(after);
    const rest = after.replace(/^\s*[:：.—–-]?\s*/, '');
    if (!rest)
        return true;
    const words = rest.split(/\s+/).length;
    const listed = (rest.match(/[,;，；]/g) || []).length >= 2;
    const sentence = /[.!?]["”’)]?$/.test(rest) || sentenceLine(rest);
    if (heading[1])
        return listed || sentence || words > 12;
    return marked || listed || sentence || words >= 8;
}
const byAuthorLine = (line: string): boolean => {
    const value = NFKC(line).trim();
    if (!/^by\s+\S/i.test(value))
        return false;
    return readBylineRow(value).kind === 'labelled';
};
const afterTitle = (line: string): boolean => endsTheTitle(line) || byAuthorLine(line);
const BY_LINE = /^[^\S\n]*by[^\S\n]*$/i;
const DATE_ONLY = /^[\s(]*(?:1[4-9]|20)\d{2}\s*(?:년|年|\.|\/|-)?\s*(?:\d{1,2}\s*(?:월|月|\.|\/|-)?)?\s*(?:\d{1,2}\s*[일日]?)?\s*(?:号|호)?[\s)]*$/;
const PAGE_FURNITURE = /^(?:[ivxlcdm]+|\d{1,4}|[-–—·•]+)$/i;
const WEB_ADDRESS = /^(?:https?:\/\/|www\.)\S+$/i;
const CODE_LINE = new RegExp(`^(?:${NUMBER_LABEL_SOURCE}|[A-Z]{2,8}\\s*(?:NO\\.?|NUMBER))(?![\\p{L}\\p{N}])`, 'iu');
function looksLikeCode(line: string): boolean {
    const body = line.replace(/\s+/g, '');
    if (!body)
        return false;
    const letters = (body.match(/[\p{L}]/gu) || []).length;
    return body.length >= 4 && letters / body.length < 0.45;
}
const RESPONSIBILITY_LINE = /(?:연구원|연구소|대학교|대학원|학회|공사|재단|진흥원|과학원|위원회|주식회사|\bInc\b|\bLtd\b|\bLLC\b|\bGmbH\b|\bUniversity\b|\bInstitute\b|\bLaborator(?:y|ies)\b|\bDepartment\b|\bCorporation\b)/i;
const BODY_WORD_KO = /(?:연구원|연구소|대학교|대학원|학회지?|공사|재단|진흥원|과학원|위원회|주식회사)$/;
const AFTER_BODY_KO = /(?:학과|학부|전공|대학|대학원|연구실|연구원|연구소|센터|본부|사업단|연구단|연구부|학회|공사|재단|진흥원|과학원|위원회|교수|박사|석사|소장|원장|팀장|실|부|과|팀|처|국|청)$|^(?:제\s*)?\d{1,4}\s*(?:권|호|집)[,.]?$|^\(?(?:1[89]|20)\d{2}\)?[,.]?$/;
const PHRASE_PARTICLE = /(?:의|을|를|에|에서|에게|으로|로서|로써|관한|대한|위한|통한|의한|따른)$/;
function koreanBodyLine(value: string): boolean {
    const words = withoutBracketGroups(value, ' ').trim().split(/\s+/).map(word => word.replace(/[,·]$/, '')).filter(Boolean);
    if (!words.length || words.length > 6)
        return false;
    const at = words.findIndex(word => BODY_WORD_KO.test(word));
    if (at < 0 || words.some(word => PHRASE_PARTICLE.test(word)))
        return false;
    return words.slice(at + 1).every(word => AFTER_BODY_KO.test(word) || isPersonalName(word));
}
const BODY_LATIN = /\b(?:University|Institute|Laborator(?:y|ies)|Department)\s+(?:of|for)\b|\b(?:University|Institute|Institut|Laborator(?:y|ies)|Corporation)$/;
const SCHOOL_NAMED_AFTER = new RegExp(String.raw `^(?:${NAME_AFTER_SCHOOL_WORD})(?![\p{L}])\s+\S`, 'u');
const NAME_CONNECTIVE = /^(?:of|for|and|the|de|du|des|für|und|&)$/i;
function latinBodyLine(value: string): boolean {
    if (/\b(?:Inc|Ltd|LLC|GmbH)\b/i.test(value))
        return true;
    return value.split(/\s*[,;()]\s*/).some(segment => {
        const words = segment.trim().split(/\s+/).filter(Boolean);
        if (!words.length || words.length > 8)
            return false;
        if (!words.every(word => /^[\p{Lu}\d&]/u.test(word) || NAME_CONNECTIVE.test(word)))
            return false;
        return BODY_LATIN.test(words.join(' ')) || SCHOOL_NAMED_AFTER.test(words.join(' '));
    });
}
const EDITION_LINE = /^[-–—\s]*(?:e[-•·]?\s?edition|edition|revised\s+edition|(?:\d+\s*(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+edition|개정판|초판|제\s*\d+\s*판)[-–—\s]*$/i;
const HANGUL = /[\uac00-\ud7af]/;
const LATIN_WORD = /[A-Za-z]{3,}/;
const STATUTE_REFERENCE = /\s*\(\s*제\s*\d+\s*조(?:\s*제\s*\d+\s*항)?\s*관련\s*\)\s*$/;
export function withoutStatuteReference(title: unknown): string {
    return String(title ?? '').replace(STATUTE_REFERENCE, '').trim();
}
const EDITION_BODY = /((?<!\d)\d+\s*(?:st|nd|rd|th)|second|third|fourth|fifth)\s+edition(?:\s*\))?\s*$/i;
const EDITION_BODY_KO = /(?:전면\s*)?(개정\s*(?:증보\s*)?판|초판|제\s*\d+\s*판)\s*$/;
function trailingEditionMatch(value: string, body: RegExp, bracketAndDash: boolean): {
    index: number;
    0: string;
    1: string;
} | null {
    const found = body.exec(value);
    if (!found)
        return null;
    const space = (at: number) => at > 0 && /\s/.test(value[at - 1]);
    let start = found.index;
    if (bracketAndDash) {
        while (space(start))
            start--;
        if (start > 0 && value[start - 1] === '(') {
            start--;
            while (space(start))
                start--;
        }
        if (start > 0 && /[–—-]/.test(value[start - 1]))
            start--;
    }
    while (start > 0 && /[\s,·]/.test(value[start - 1]))
        start--;
    return { index: start, 0: value.slice(start), 1: found[1] };
}
const TRAILING_EDITION = { exec: (value: string) => trailingEditionMatch(value, EDITION_BODY, true) };
const TRAILING_EDITION_KO = { exec: (value: string) => trailingEditionMatch(value, EDITION_BODY_KO, false) };
export function splitTrailingEdition(value: unknown): {
    title: string;
    edition: string | null;
} {
    const title = String(value ?? '').trim();
    const match = TRAILING_EDITION.exec(title) || TRAILING_EDITION_KO.exec(title);
    if (!match || title.slice(0, match.index).trim().length < 8)
        return { title, edition: null };
    return { title: title.slice(0, match.index).replace(/[\s,·–—-]+$/, '').trim(), edition: match[1] ? match[1].replace(/\s+/g, '') : match[0].trim() };
}
const stripMarks = (line: string) => line.replace(/[™®]/g, '').replace(/(?<=\p{Ll})TM\b/gu, '').replace(/(?<=\p{L})[☆★]+(?=\s|$)/gu, '').trim();
export type BlockKind = 'banner' | 'label' | 'code' | 'date' | 'role' | 'byline' | 'institution' | 'notice' | 'prose' | 'list' | 'unreadable' | 'furniture' | 'text';
export type BylineRole = 'author' | 'editor' | 'translator' | 'contributor';
export interface PageBlock {
    kind: BlockKind;
    lines: string[];
    start: number;
    end: number;
    gapBefore: number;
    role?: BylineRole;
    reason: string;
    height: number;
    vertical?: boolean;
}
export interface BylineNear {
    lines: string[];
    role?: BylineRole;
    start: number;
    end: number;
    position: 'above' | 'below';
}
const ROLE_LABEL_KO = new RegExp(`^\\s*(?:${STATEMENT_LABEL_KO})(?:\\s*[:：]\\s*|\\s+)\\S`, 'u');
const ROLE_LABEL_LATIN = new RegExp(`^\\s*(?:thesis\\s+|dissertation\\s+)?(?:${STATEMENT_LABEL_LATIN})\\s*[:：]\\s*\\S`, 'iu');
const roleStatement = (line: string) => ROLE_LABEL_KO.test(line) || ROLE_LABEL_LATIN.test(line);
const ROLE_WORD = labelPattern(['author', 'editor', 'translator'], 'alone', { anchor: 'whole', capture: true });
const TRAILING_ROLE_WORD = new RegExp(`^(.+?\\S)\\s+\\(?\\s*(${TAIL_ROLE_SOURCE})\\s*\\)?\\s*$`, 'iu');
function roleOfWord(word: string): BylineRole {
    return bylineRoleOf(word);
}
const LEADING_ROLE_LABEL = new RegExp(`^\\s*(${LEADING_ROLE_SOURCE})\\s*[:：]?\\s+(\\S.*)$`, 'iu');
const ROLE_LABEL_SEPARATOR = '[,;；:：|\\u1173\\u3161\\-‐‑‒–—―~]';
const LEADING_ROLE_LABEL_MARKED = new RegExp(`^\\s*(${LEADING_ROLE_SOURCE})\\s*${ROLE_LABEL_SEPARATOR}+\\s*(\\S.*)$`, 'iu');
const SEPARATOR_OPENING = new RegExp(`^${ROLE_LABEL_SEPARATOR}+\\s*`, 'u');
const ROLE_LABEL_OPENING_WHO = new RegExp(`^(?:${LEADING_ROLE_SOURCE})(?![\\p{L}])`, 'iu');
export function responsibilityOfLine(line: unknown): {
    who: string;
    word: string;
    role: BylineRole;
} | null {
    const value = NFKC(line).replace(/\s+/g, ' ').trim();
    if (!value || value.length > 120)
        return null;
    const leading = LEADING_ROLE_LABEL.exec(value) || LEADING_ROLE_LABEL_MARKED.exec(value);
    if (leading) {
        const word = leading[1].replace(/\s+/g, '');
        const who = leading[2].replace(SEPARATOR_OPENING, '').trim();
        if (!who || ROLE_LABEL_OPENING_WHO.test(who))
            return null;
        return { who, word, role: bylineRoleOf(word) };
    }
    const trailing = TRAILING_ROLE_WORD.exec(value);
    if (!trailing)
        return null;
    const word = trailing[2].trim();
    return { who: trailing[1].trim().replace(/[,，]\s*$/, ''), word, role: bylineRoleOf(word) };
}
const roleOfWordToken = (token: string) => KOREAN_ROLE_FORMS.has(token);
function roleWordLine(line: string, _isName?: NameTest): boolean {
    return readBylineRow(NFKC(line).trim()).kind === 'roleMarked';
}
function titleOverByline(line: string, next: string, isName: NameTest | undefined): boolean {
    const value = NFKC(line).trim();
    if (!value || value.length > 30 || !roleWordLine(next, isName))
        return false;
    const role = TRAILING_ROLE_WORD.exec(NFKC(next).trim());
    if (!role || roleOfWord(role[2]) !== 'author')
        return false;
    if (isHardFurniture(value) || isOrganisationName(value) || institutionLine(value) || roleWordLine(value, isName)
        || !readableLine(value) || /\d/.test(value))
        return false;
    return isPersonShaped(value) || nameShape(value.replace(/\s+/g, '')).person !== 'no';
}
const ANNEX_DESIGNATION = /\[\s*별표\s*\d+(?:\s*의\s*\d+)?\s*\]\s*(?:<\s*(?:개정|신설|전문\s*개정)[^>]*>)?\s*$/;
const ORDINAL_PREFIX = /^\s*(?:\d{1,4}(?:st|nd|rd|th)|제\s*\d{1,4}\s*(?:호|회|권|집))\s+/i;
const documentLabel = (line: string) => DOCUMENT_LABEL.test(line) || DOCUMENT_LABEL.test(line.replace(ORDINAL_PREFIX, ''));
const ACADEMIC_UNIT = /(?:^|\s)(?:the\s+)?graduate\s+school\b|^(?:major|department|division|school|college|faculty|program(?:me)?|institute|laboratory)\s+(?:in|of|for)\b/i;
const ACADEMIC_UNIT_KO = /(?:학과|학부|전공|대학|대학원|연구실)$/;
function institutionLine(line: string): boolean {
    const value = NFKC(line).trim();
    if (!value)
        return false;
    if (koreanBodyLine(value) || latinBodyLine(value) || ACADEMIC_UNIT.test(value))
        return true;
    const words = value.split(/\s+/).length;
    return words <= 5 && ACADEMIC_UNIT_KO.test(withoutTrailingBracketGroup(value));
}
function dateStatement(line: string): boolean {
    const value = NFKC(line).trim();
    if (!value)
        return false;
    if (DATE_ONLY.test(value))
        return true;
    const readings = readDates(value);
    if (!readings.length)
        return false;
    let rest = value;
    for (const reading of readings)
        rest = rest.replace(reading.raw, ' ');
    const words = rest.split(/[\s:：;,.()\-–—/|]+/).filter(word => /\p{L}/u.test(word));
    if (!words.length)
        return true;
    return readings.some(reading => reading.role && reading.role !== 'coveragePeriod') && words.length <= 3 * readings.length;
}
export function readableLines(text: unknown): string {
    return NFKC(text).split('\n').filter(line => line.trim() && readableLine(line)).join('\n');
}
function readableLine(line: string): boolean {
    const value = NFKC(line).trim();
    if (!value)
        return true;
    if (/[~=|{}\\^`]/.test(value))
        return false;
    const tokens = value.split(/\s+/).filter(token => /[\p{L}\p{N}]/u.test(token));
    if (!tokens.length)
        return true;
    const singles = tokens.filter(token => token.length === 1).length;
    if (tokens.length >= 4 && singles * 2 >= tokens.length)
        return false;
    const wordish = tokens.filter(token => /^[\p{L}\p{N}(“"'‘\-‐‑–—[]?[\p{L}\p{N}'’“”".,;:!?()[\]\-‐‑–—/&+%·†‡§¶*<>]*$/u.test(token)
        && !/\p{L}\d{2,}\p{L}|\d\p{L}\d/u.test(token)).length;
    return wordish / tokens.length >= 0.7;
}
function looksLikeParagraph(lines: string[], structured: boolean): string | null {
    const text = lines.join(' ');
    const citations = (text.match(/\[\d{1,3}(?:\s*[,–—-]\s*\d{1,3})*\]/g) || []).length;
    const sentences = (text.match(/[.!?]['”")\]]?\s+[A-Z가-힣]/g) || []).length;
    const first = lines[0] || '';
    if (/^\p{Ll}/u.test(first) && !HANGUL.test(first) && lines.length >= 2 && (citations || sentences))
        return 'opens mid-sentence';
    if (!structured)
        return null;
    if (citations >= 2)
        return `${citations} bracketed citations`;
    if (lines.length >= 4 && sentences >= 2)
        return `${lines.length} lines broken into sentences`;
    return null;
}
const sentenceLine = (line: string) => (NFKC(line).match(/[.!?]['”")\]]?\s+[A-Z가-힣]/g) || []).length >= 2;
const fullMeasureOpening = (lines: string[]): boolean => {
    const lengths = lines.map(line => NFKC(line).trim().length).filter(Boolean);
    if (lengths.length < 4)
        return false;
    const median = [...lengths].sort((a, b) => a - b)[Math.floor(lengths.length / 2)];
    return median > 0 && lengths[0] >= median * 0.85;
};
const proseBlock = (lines: string[]): boolean => {
    if (lines.length < 3)
        return false;
    const joined = NFKC(lines.join(' '));
    if (joined.length < 120)
        return false;
    const finished = (joined.match(/(?<!\p{L})\p{L}{4,}[.!?]['”")\]]?(?:\s+[\p{Lu}가-힣]|$)|(?:습니다|입니다|합니다|됩니다|하였다|했다|이었다|이다|한다|된다)[.。]?(?:\s|$)/gu) || []).length;
    return finished >= 2;
};
type NameTest = (line: string) => boolean;
function personLine(line: string, _isName?: NameTest): boolean {
    return !!personsOnly(withoutLeadingConnective(NFKC(line)));
}
const CJK_LETTER = /[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
function cjkNameList(line: string, _isName?: NameTest): boolean {
    const value = NFKC(line).trim();
    if (!value || value.length > 120 || !CJK_LETTER.test(value))
        return false;
    const row = readBylineRow(value);
    if (!(row.kind === 'list' || row.kind === 'marked' || (row.kind === 'pair' && row.items.some(item => CJK_LETTER.test(item.text)))))
        return false;
    return row.items.length >= 2 && !row.organisations?.length && row.items.every(item => item.shape.person !== 'no');
}
function nameListRow(line: string, isName?: NameTest): boolean {
    return cjkNameList(line, isName) || looksLikeNameList(line, isName);
}
const keyedItem = (item: {
    keys: string[];
    marks: string[];
    alternates: string[];
}) => item.keys.length > 0 || item.marks.length > 0 || item.alternates.length > 0;
function keyedNameList(line: string, isName?: NameTest): boolean {
    return cjkNameList(line, isName) && readBylineRow(NFKC(line).trim()).items.some(keyedItem);
}
export function isBylineRow(line: unknown, isName?: NameTest): boolean {
    const value = NFKC(line).trim();
    return !!value && (markedNameList(value, isName) || !!personWithContact(value, isName)?.email);
}
function markedNameList(line: string, isName?: NameTest): boolean {
    if (looksLikeNameList(line, isName))
        return true;
    if (!cjkNameList(line, isName))
        return false;
    const items = readBylineRow(NFKC(line).trim()).items;
    return items.length >= 3 || items.some(keyedItem);
}
const median = (values: number[]) => {
    const sorted = values.filter(value => value > 0).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};
export interface RawBlock {
    lines: string[];
    rows: number[];
    gapBefore: number;
    vertical?: boolean;
}
export function splitBlocks(raw: string[], options: {
    heights?: number[] | null;
    pageHeight?: number;
    hasLayout?: boolean;
    limit?: number;
    displayFloor?: number;
} = {}): RawBlock[] {
    const heights = options.heights && options.heights.length ? options.heights : null;
    const pageHeight = options.pageHeight || 0;
    const displayFloor = Number(options.displayFloor) > 0 ? Number(options.displayFloor) : pageHeight;
    const hasLayout = !!options.hasLayout;
    const limit = options.limit ?? raw.length;
    type Raw = RawBlock;
    const blocks: Raw[] = [];
    let current: Raw | null = null;
    let currentHeights: number[] = [];
    const addHeight = (value: number) => {
        if (!(value > 0))
            return;
        let low = 0, high = currentHeights.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if (currentHeights[middle] <= value)
                low = middle + 1;
            else
                high = middle;
        }
        currentHeights.splice(low, 0, value);
    };
    const currentMedian = () => currentHeights.length ? currentHeights[Math.floor(currentHeights.length / 2)] : 0;
    let blanks = 0;
    const edgesOf = (line: string) => {
        const indent = line.length - line.trimStart().length;
        const width = line.trim().length;
        return { indent, centre: indent + width / 2 };
    };
    let previousEdges: {
        indent: number;
        centre: number;
    } | null = null;
    for (const [index, line] of raw.slice(0, limit).entries()) {
        if (!line.trim()) {
            blanks++;
            if (current) {
                blocks.push(current);
                current = null;
                currentHeights = [];
            }
            previousEdges = null;
            continue;
        }
        const edges = edgesOf(line);
        const sameDisplaySize = (() => {
            if (!current || !heights || !current.rows.length || !(pageHeight > 0))
                return false;
            const above = currentMedian(), here = heights[index] || 0;
            return Math.min(above, here) >= displayFloor * 1.2 && Math.abs(above - here) <= Math.max(above, here) * 0.15;
        })();
        const runsOnFromAbove = !!current && current.lines.length > 0 && /^\p{Ll}/u.test(line.trim()) && !HANGUL.test(line);
        if (current && hasLayout && previousEdges && !sameDisplaySize && !runsOnFromAbove
            && Math.abs(edges.indent - previousEdges.indent) >= 8 && Math.abs(edges.centre - previousEdges.centre) >= 8) {
            blocks.push(current);
            current = null;
            currentHeights = [];
            blanks = 0;
        }
        if (current && heights && current.rows.length) {
            const above = currentMedian();
            const here = heights[index] || 0;
            const displaySized = pageHeight > 0 && Math.max(above, here) >= pageHeight * 1.2;
            const runsOn = continuesAcross(current.lines[current.lines.length - 1] || '', line.trim());
            const closedAbove = closesSentence(current.lines[current.lines.length - 1] || '');
            const risesAfterSentence = closedAbove && pageHeight > 0 && here >= pageHeight * 1.3 && here >= above * 1.25;
            if (above > 0 && here > 0 && displaySized && !runsOn && (here <= above * 0.6 || above <= here * 0.6 || risesAfterSentence)) {
                blocks.push(current);
                current = null;
                currentHeights = [];
                blanks = 0;
            }
        }
        previousEdges = edges;
        if (!current) {
            current = { lines: [], rows: [], gapBefore: blanks };
            blanks = 0;
        }
        const columns = splitColumns(line);
        const widest = columns.length > 1
            ? columns.reduce((best, column) => (column.match(/\p{L}/gu) || []).length > (best.match(/\p{L}/gu) || []).length ? column : best)
            : columns[0] ?? line.trim();
        current.lines.push(stripMarks(widest));
        current.rows.push(index);
        if (heights)
            addHeight(heights[index] || 0);
    }
    if (current)
        blocks.push(current);
    return blocks;
}
export function pageBlocks(text: unknown, furniture: (line: string) => boolean, options: {
    layout?: unknown;
    isName?: NameTest;
    lineHeights?: number[];
    runningHeads?: Set<string>;
    masthead?: [
        number,
        number
    ] | null;
    bodySize?: number;
} = {}): PageBlock[] {
    const layout = NFKC(options.layout ?? '');
    const raw = (layout.trim() ? layout : NFKC(text)).split('\n');
    const heights = Array.isArray(options.lineHeights) && options.lineHeights.length ? options.lineHeights : null;
    const pageHeight = heights ? (Number(options.bodySize) > 0 ? Number(options.bodySize) : median(raw.map((row, index) => (row.trim() ? heights[index] || 0 : 0)))) : 0;
    const masthead = options.masthead !== undefined ? options.masthead
        : mastheadFor(null, 1, { text, layout: options.layout, lineHeights: heights ?? undefined });
    const start = masthead ? masthead[1] + 1 : 0;
    type Raw = RawBlock;
    const pageMedian = heights ? median(raw.map((row, index) => (row.trim() ? heights[index] || 0 : 0))) : 0;
    const blocks: Raw[] = splitBlocks(raw, { heights, pageHeight, hasLayout: !!layout.trim(), limit: start + 80, displayFloor: pageMedian || pageHeight });
    const roleOrName = (line: string) => roleOfWordToken(line.trim()) || ROLE_WORD.test(line);
    for (const block of blocks) {
        for (let at = 0; at + 1 < block.lines.length; at++) {
            if (/^[가-힣]{2}$/.test(block.lines[at].trim()) && /^[가-힣]{2}$/.test(block.lines[at + 1].trim())
                && !roleOrName(block.lines[at]) && !roleOrName(block.lines[at + 1])) {
                block.lines.splice(at, 2, block.lines[at].trim() + block.lines[at + 1].trim());
                block.rows.splice(at + 1, 1);
            }
        }
    }
    const glyphRow = (line: string) => /^[가-힣\p{Script=Han}]{1,2}$/u.test(line.replace(/\s+/g, ''));
    const verticalBlock = (block: Raw) => block.lines.length >= 3 && block.lines.every(line => line.replace(/\s+/g, '').length <= 6)
        && block.lines.filter(glyphRow).length * 3 >= block.lines.length * 2;
    for (const block of blocks) {
        if (!verticalBlock(block))
            continue;
        block.lines = [block.lines.map(line => line.trim()).join('')];
        block.vertical = true;
    }
    for (let at = blocks.length - 1; at > 0; at--) {
        if (!blocks[at].vertical || !blocks[at - 1].vertical || blocks[at].gapBefore > 1)
            continue;
        blocks[at - 1] = { ...blocks[at - 1], lines: [blocks[at - 1].lines[0] + blocks[at].lines[0]], rows: [...blocks[at - 1].rows, ...blocks[at].rows] };
        blocks.splice(at, 1);
    }
    const heightOf = (block: Raw) => heights ? median(block.rows.map(row => heights[row] || 0)) : 0;
    const titleShaped = (line: string) => !!line.trim() && !furniture(line) && !institutionLine(line)
        && !roleStatement(line) && !dateStatement(line) && !PAGE_FURNITURE.test(line) && !CODE_LINE.test(line)
        && !looksLikeCode(line) && !ROLE_WORD.test(line) && !documentLabel(line) && !EDITION_LINE.test(line)
        && !personLine(line, options.isName) && !nameListRow(line, options.isName) && readableLine(line);
    const gapsSeen: number[] = [];
    {
        let lastFilled = -1;
        for (let row = 0; row < Math.min(raw.length, start + 80); row++) {
            if (!raw[row].trim())
                continue;
            if (lastFilled >= 0)
                gapsSeen.push(row - lastFilled - 1);
            lastFilled = row;
        }
    }
    const spacedByOneRow = gapsSeen.length >= 3 && gapsSeen.filter(gap => gap === 1).length * 2 > gapsSeen.length;
    for (let at = blocks.length - 1; at > 0; at--) {
        if (blocks[at].gapBefore !== 1)
            continue;
        const previous = blocks[at - 1];
        const last = previous.lines[previous.lines.length - 1];
        const first = blocks[at].lines[0];
        if (nameListRow(first, options.isName))
            continue;
        if (isResponsibilityRow(first))
            continue;
        let joins = continuesAcross(last, first);
        const above = heightOf(previous), below = heightOf(blocks[at]);
        if (!joins && heights) {
            const floor = pageHeight > 0 && pageMedian > 0 ? Math.min(pageHeight, pageMedian) : pageHeight || pageMedian;
            const display = floor > 0 && Math.min(above, below) >= floor * 1.2;
            const same = above > 0 && below > 0 && Math.abs(above - below) <= Math.max(above, below) * 0.08;
            const script = HANGUL.test(last) === HANGUL.test(first);
            const soleName = !titleShaped(first) && personLine(first, options.isName) && !nameListRow(first, options.isName)
                && [1, 2, 3].some(step => blocks[at + step]?.lines.some(line => nameListRow(line, options.isName) || markedNameList(line, options.isName) || peopleRow(line)));
            joins = display && same && script && titleShaped(last) && (titleShaped(first) || soleName);
        }
        if (!joins && spacedByOneRow && titleEnding(last) === 'maybe' && HANGUL.test(last) && HANGUL.test(first)
            && (!(above > 0 && below > 0) || Math.abs(above - below) <= Math.max(above, below) * 0.15)
            && !personLine(first, options.isName) && !spacedHangulName(first, options.isName) && readableLine(first))
            joins = true;
        if (!joins && spacedByOneRow && typefaceClass(last) === 'capitals' && typefaceClass(first) === 'capitals' && !HANGUL.test(last) && !HANGUL.test(first)
            && (!(above > 0 && below > 0) || Math.abs(above - below) <= Math.max(above, below) * 0.08)
            && !closesSentence(last) && titleShaped(last) && titleShaped(first))
            joins = true;
        if (!joins)
            continue;
        blocks[at - 1] = { lines: [...previous.lines, ...blocks[at].lines], rows: [...previous.rows, ...blocks[at].rows], gapBefore: previous.gapBefore };
        blocks.splice(at, 1);
    }
    const structured = blocks.length >= 3;
    const out: PageBlock[] = [];
    const place = (kind: BlockKind, lines: string[], rows: number[], gapBefore: number, reason: string, role?: BylineRole, vertical?: boolean) => {
        if (!lines.length)
            return;
        out.push({ kind, lines, start: rows[0], end: rows[rows.length - 1], gapBefore, reason, height: heights ? median(rows.map(row => heights[row] || 0)) : 0,
            ...(role ? { role } : {}), ...(vertical ? { vertical } : {}) });
    };
    for (const whole of blocks) {
        let block = whole;
        const firstIssue = whole.rows.find(row => row < start && isIssueStatement(raw[row] || ''));
        if (!layout.trim() && whole.rows[0] < start && whole.rows[whole.rows.length - 1] >= start && isIssueStatement(raw[start - 1] || '')
            && firstIssue !== undefined && journalOfIssueStatement(raw[firstIssue] || '') === '') {
            const cut = whole.rows.findIndex(row => row >= start);
            place('banner', whole.lines.slice(0, cut), whole.rows.slice(0, cut), whole.gapBefore, 'inside the masthead above the title');
            block = { ...whole, lines: whole.lines.slice(cut), rows: whole.rows.slice(cut), gapBefore: 0 };
        }
        const { lines, rows, gapBefore } = block;
        if (rows[rows.length - 1] < start) {
            place('banner', lines, rows, gapBefore, 'inside the masthead above the title');
            continue;
        }
        const every = (test: (line: string) => boolean) => lines.every(test);
        const garbled = lines.filter(line => !readableLine(line)).length;
        if (garbled === lines.length || (lines.length >= 3 && garbled * 2 > lines.length)) {
            place('unreadable', lines, rows, gapBefore, 'not made of words');
            continue;
        }
        if (block.vertical) {
            place('text', lines, rows, gapBefore, 'a title set one glyph to a row', undefined, true);
            continue;
        }
        if (every(dateStatement)) {
            place('date', lines, rows, gapBefore, 'dates and their labels');
            continue;
        }
        if (every(line => PAGE_FURNITURE.test(line) || CODE_LINE.test(line) || looksLikeCode(line))) {
            place('code', lines, rows, gapBefore, 'codes and page furniture');
            continue;
        }
        if (lines.length === 1 && (documentLabel(lines[0]) || EDITION_LINE.test(lines[0]) || ANNEX_DESIGNATION.test(lines[0]))) {
            place('label', lines, rows, gapBefore, 'names the kind of document');
            continue;
        }
        if (every(roleStatement)) {
            place('role', lines, rows, gapBefore, 'a role and its name');
            continue;
        }
        const roleAt = lines.findIndex(line => ROLE_WORD.test(line));
        if (roleAt > 0) {
            let from = roleAt;
            while (from > 0 && personLine(lines[from - 1], options.isName))
                from--;
            if (from < roleAt) {
                const role = roleOfWord(lines[roleAt]);
                const head = { lines: lines.slice(0, from), rows: rows.slice(0, from) };
                if (head.lines.length) {
                    const kind = classifyText(head.lines, furniture, options.isName, structured);
                    place(kind.kind, head.lines, head.rows, gapBefore, kind.reason);
                }
                place('byline', lines.slice(from, roleAt), rows.slice(from, roleAt), head.lines.length ? 0 : gapBefore, `names closed by "${lines[roleAt].trim()}"`, role);
                const tail = { lines: lines.slice(roleAt + 1), rows: rows.slice(roleAt + 1) };
                if (tail.lines.length) {
                    const kind = classifyText(tail.lines, furniture, options.isName, structured);
                    place(kind.kind, tail.lines, tail.rows, 0, kind.reason);
                }
                continue;
            }
        }
        const trailing = lines.length <= 6 && lines.every(line => personLine(line, options.isName))
            ? lines.map(line => TRAILING_ROLE_WORD.exec(line)).find(Boolean) : null;
        const bylineSignal = (line: string) => nameParts(line).length >= 3 || carriesAnApposition(line)
            || /\b\p{Lu}\.\s?\p{Lu}/u.test(line)
            || /[*†‡§¶]|\p{L}\d\b/u.test(line)
            || TRAILING_ROLE_WORD.test(line)
            || (HANGUL.test(line) && !!options.isName && options.isName(line))
            || cjkNameList(line, options.isName)
            || positionedName(line);
        const listed = lines.some(bylineSignal) || !!trailing;
        const nextBlock = blocks[blocks.indexOf(block) + 1];
        const titleOverAuthor = lines.length === 1 && !trailing && nameParts(lines[0]).length <= 1
            && !out.some(entry => entry.kind === 'text')
            && !!nextBlock && titleOverByline(lines[0], nextBlock.lines[0] || '', options.isName);
        const continuesAbove = withoutLeadingConnective(NFKC(lines[0])) !== NFKC(lines[0]).trim();
        if (structured && listed && !titleOverAuthor && !continuesAbove && lines.length <= 6 && every(line => personLine(line, options.isName))) {
            place('byline', lines.map(line => line.replace(TRAILING_ROLE_WORD, '$1')), rows, gapBefore, 'every line is a name', trailing ? roleOfWord(trailing[2]) : undefined);
            continue;
        }
        if (structured && every(institutionLine)) {
            place('institution', lines, rows, gapBefore, 'every line names a body or a unit');
            continue;
        }
        const displayed = !!heights && pageHeight > 0 && rows.some(row => (Number(heights[row]) || 0) >= pageHeight * STRUCTURE.display);
        const kind = classifyText(lines, furniture, options.isName, structured, out.some(entry => entry.kind === 'text') ? undefined : nextBlock?.lines[0] || '', displayed);
        place(kind.kind, lines, rows, gapBefore, kind.reason);
    }
    return out;
}
function classifyText(lines: string[], furniture: (line: string) => boolean, isName: NameTest | undefined, structured: boolean, nextBlockLine?: string, displayed = false): {
    kind: BlockKind;
    reason: string;
} {
    if (CITATION_OPENER.test(lines[0] || ''))
        return { kind: 'furniture', reason: 'how to cite the document' };
    if (opensWithVolume(lines[0] || ''))
        return { kind: 'label', reason: 'a volume statement' };
    if (lines.length >= 2 && lines.slice(1).some((line, at) => line.trim().toLowerCase() === lines[at].trim().toLowerCase() && (line.match(/\p{L}/gu) || []).length >= 4)) {
        return { kind: 'furniture', reason: 'a line repeated under itself' };
    }
    if (lines.length === 1 && /[,;]$/.test(lines[0].trim()) && lines[0].trim().split(/\s+/).length >= 6) {
        return { kind: 'prose', reason: 'a clause cut from a paragraph' };
    }
    if (!displayed) {
        const joined = lines.map(line => line.trim()).join(' ');
        if (lines.length >= 2 && lines.length <= 5 && /[.!?]["”’)]?$/.test(joined) && joined.split(/\s+/).length >= 12 && !/[.!?]["”’)]?\s+\p{Lu}/u.test(joined.slice(0, -1))) {
            return { kind: 'prose', reason: 'a standfirst: one sentence over several lines' };
        }
    }
    if (lines.length >= 2 && lines.slice(0, 2).every(line => /^[가-힣]$/.test(line.trim()))) {
        return { kind: 'prose', reason: 'a heading broken into syllables over its paragraph' };
    }
    let from = 0;
    while (from < lines.length) {
        const line = lines[from];
        if (documentLabel(line) || EDITION_LINE.test(line) || ANNEX_DESIGNATION.test(line) || CODE_LINE.test(line) || looksLikeCode(line)
            || PAGE_FURNITURE.test(line) || dateStatement(line) || afterTitle(line) || roleStatement(line) || ROLE_WORD.test(line)
            || institutionLine(line) || !readableLine(line) || sentenceLine(line)) {
            from++;
            continue;
        }
        if (furniture(line) && !(from === 0 && nextBlockLine !== undefined
            && titleOverByline(line, from + 1 < lines.length ? lines[from + 1] : nextBlockLine, isName))) {
            from++;
            continue;
        }
        break;
    }
    const content = lines.slice(from);
    if (!content.length) {
        if (lines.every(line => COPYRIGHT_OR_PERMISSION.test(line)))
            return { kind: 'notice', reason: 'a rights notice' };
        return { kind: 'furniture', reason: 'nothing a title opens with' };
    }
    if (structured && content.filter(line => /^\s*\(?\d{1,3}\s*[.)]\s+\S/.test(line)).length >= 2)
        return { kind: 'list', reason: 'numbered entries' };
    const paragraph = looksLikeParagraph(content, structured);
    if (paragraph)
        return { kind: 'prose', reason: paragraph };
    void isName;
    return { kind: 'text', reason: 'a statement' };
}
const COPYRIGHT_OR_PERMISSION = /(?:©|ⓒ|\(c\)|copyright|all\s+rights\s+reserved|무단\s*전재|판권)/i;
const CITATION_OPENER = /^(?:please\s+)?(?:cite\s+(?:as|this)\b|citation\s*:|how\s+to\s+cite\b|to\s+cite\s+this\b)/i;
export function titleBlock(text: unknown, furniture: (line: string) => boolean, options: {
    layout?: unknown;
    isName?: NameTest;
    lineHeights?: number[];
    skipAt?: Set<number>;
    runningHeads?: Set<string>;
    runningNeighbours?: Map<string, Array<Set<string>>>;
    script?: 'hangul' | 'latin';
    masthead?: [
        number,
        number
    ] | null;
    bodySize?: number;
    width?: number | null;
    bodyScript?: 'hangul' | 'latin' | null;
} = {}): ReturnType<typeof readTitleBlock> {
    return readPageTitleBlock(text, furniture, options);
}
function isPersonShaped(line: string): boolean {
    const value = NFKC(line).trim();
    if (!value || /[@\d]/.test(value) || value.length > 40)
        return false;
    const parts = value.split(/\s+/);
    if (parts.length < 2 || parts.length > 3)
        return false;
    return parts.every(part => /^\p{Lu}\.?$/u.test(part) || (/^[\p{Lu}][\p{L}'’.-]*$/u.test(part) && /\p{Ll}/u.test(part)));
}
const SECTION_NUMBER = /^(?:\d{1,2}\.(?!\d)\s*|[IVX]{1,5}\.\s*(?=[가-힣]|\p{Lu}{2,}(?:\s|$))|제\s*\d{1,2}\s*[장절]\s*|\d{1,2}\s+(?=\p{Lu}\p{Ll}+$))/u;
const BARE_SECTION_NUMBER = /^(?:\d{1,2}(?:\.\d{1,2}){1,3}\.?\s*|\d{1,2}\s+(?=[가-힣]))/u;
const ROMAN_NUMERAL_SIGN = /^[\u2160-\u217F]{1,4}(?:\s*[.．)]\s*|\s+)(?=\p{L})/u;
export function numberedSectionHeading(line: unknown, following: string[] = []): boolean {
    const printed = String(line ?? '').replace(/\s+/g, ' ').trim();
    const value = NFKC(line).replace(/\s+/g, ' ').trim();
    const sign = ROMAN_NUMERAL_SIGN.exec(printed);
    const number = sign ? null : SECTION_NUMBER.exec(value) || BARE_SECTION_NUMBER.exec(value);
    if (!sign && !number)
        return false;
    const rest = (sign ? NFKC(printed.slice(sign[0].length)).trim() : value.slice(number![0].length).trim()).replace(/(?<=\p{L})(?:\d{1,2}\)|[*†‡§]+)$/u, '');
    if (!/^\p{L}[\p{L}\s&·-]*$/u.test(rest) || rest.length > 40 || rest.split(/\s+/).length > 6)
        return false;
    return !!sign || SECTION_NUMBER.test(value) || runsAsBody(following);
}
function runsAsBody(lines: string[]): boolean {
    const rows = lines.map(line => NFKC(line).trim()).filter(Boolean).slice(0, 4);
    return rows.some(line => opensMidWord(line, { stop: true }) || SENTENCE_INSIDE.test(line) || CROSS_REFERENCE.test(line))
        || rows.some((line, at) => at + 1 < rows.length && HANGUL.test(line) && !/[.!?:;]$/.test(line) && opensMidWord(rows[at + 1]))
        || rows.some((line, at) => at + 1 < rows.length && wordBrokenAcross(line, rows[at + 1]));
}
const CROSS_REFERENCE = /\((?:see\s+)?(?:fig(?:ure)?s?|tables?|eqs?|equations?|schemes?|charts?)\.?\s*S?\d/i;
function wordBrokenAcross(line: unknown, next: unknown): boolean {
    return /\p{Ll}{2,}-$/u.test(NFKC(line).trim()) && /^\p{Ll}{2,}/u.test(NFKC(next).trim());
}
const SENTENCE_INSIDE = /[가-힣][.!?]["”’)]?\s+\S|\p{Ll}{2,}[.!?]["”’)]?\s+\p{Lu}/u;
const CITATION_MARK = /(?:[가-힣]|\p{Ll}{2}|[).,])\s?\[\d{1,3}(?:\s*[,–—-]\s*\d{1,3})*\](?![A-Za-z\d])/u;
const KOREAN_SENTENCE_END = /[가-힣]다[.。]["”’)]?$/;
export function closesSentence(line: unknown): boolean {
    const value = NFKC(line).trim();
    return KOREAN_SENTENCE_END.test(value) || (/(?<=\p{Ll}{2})[.!?]["”’)]?$/u.test(value) && value.split(/\s+/).length >= 6);
}
const PARTICLE_OPENING = /^(?:의|을|를|는|에|로|와|과|에서|으로|에게|에는|에도|으며|이며|이고|이다|한다|된다|했다|였다|있다|없다|하여|되어)(?=[\s.,;:!?)]|$)/;
const ENDING_WITH_STOP = /^[가-힣][.,](?=\s|$)/;
const AMBIGUOUS_OPENING = /^(?:이|가|은|도|만|고|며|서|게|지|요|다)(?=\s)/;
function opensMidWord(line: string, also: {
    stop?: boolean;
    ambiguous?: boolean;
} = {}): boolean {
    const value = NFKC(line).replace(/\s+/g, ' ').trim();
    const rest = (opener: RegExpExecArray) => (value.slice(opener[0].length).match(/[가-힣]/g) || []).length;
    const particle = PARTICLE_OPENING.exec(value);
    if (particle)
        return rest(particle) >= 4;
    const stop = ENDING_WITH_STOP.exec(value);
    if (stop)
        return rest(stop) >= (also.stop || also.ambiguous ? 4 : 12);
    const word = also.ambiguous ? AMBIGUOUS_OPENING.exec(value) : null;
    return !!word && rest(word) >= 4;
}
export function continuesAcross(previous: string, next: string): boolean {
    const before = String(previous || '').trim();
    const after = String(next || '').trim();
    if (!before || !after)
        return false;
    if (/[.:;!?]$/.test(before))
        return false;
    if (!HANGUL.test(after) && titleOpening(after) === 'continuing')
        return true;
    if (endsOnALatinFunctionWord(before))
        return true;
    if (HANGUL.test(before) && HANGUL.test(after)) {
        if (institutionLine(after))
            return false;
        if (titleOpening(after) === 'continuing' && !roleStatement(after))
            return true;
        if (endsOpenInKorean(before))
            return true;
    }
    return false;
}
export function normaliseEdition(value: unknown): string {
    const text = NFKC(value).trim();
    const ordinal = /^(\d+)\s*(?:st|nd|rd|th)?\s+edition$/i.exec(text);
    if (ordinal)
        return ordinal[1] + suffixFor(Number(ordinal[1]));
    const word = /^(\p{L}+)\s+edition$/iu.exec(text);
    const at = word ? (EDITION_ORDINALS as readonly string[]).indexOf(word[1].toLowerCase()) + 1 : 0;
    if (at > 0)
        return at + suffixFor(at);
    const bare = /^(\d+)\s*(st|nd|rd|th)$/i.exec(text);
    if (bare)
        return bare[1] + suffixFor(Number(bare[1]));
    return text;
}
function suffixFor(value: number): string {
    const tens = value % 100;
    if (tens >= 11 && tens <= 13)
        return 'th';
    return ['th', 'st', 'nd', 'rd'][value % 10] || 'th';
}
function joinTitleLines(lines: string[]): string {
    return lines.reduce((joined, line, index) => {
        if (!index)
            return line;
        const before = joined.trim();
        if (adverbialSubtitle(line) && HANGUL.test(before) && titleEnding(before) === 'closed' && !before.includes(':'))
            return before + ' : ' + line;
        return /[‐-―-]$/.test(joined) ? joined.replace(/[‐-―-]$/, '') + line : joined + ' ' + line;
    }, '').replace(/\s+/g, ' ').trim();
}
const compactLetters = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
function sharedPrefix(a: string, b: string): number {
    let at = 0;
    while (at < a.length && at < b.length && a[at] === b[at])
        at++;
    return at;
}
function statedByRunningHead(heads: Set<string>, title: string): boolean {
    const letters = (value: string) => value.replace(/[^\p{L}#]+/gu, '');
    const own = letters(edgeKey(title));
    if (own.replace(/#/g, '').length < 8)
        return false;
    for (const head of heads) {
        const statement = issueHeadStatement(head);
        if (statement !== null) {
            const side = letters(statement);
            if (side.replace(/#/g, '').length < 8)
                continue;
            if (side === own || (side.length >= 12 && own.startsWith(side) && !own.slice(side.length).includes('#')))
                return true;
            continue;
        }
        const said = letters(head);
        if (said.replace(/#/g, '').length < 8)
            continue;
        if (said === own)
            return true;
        if (said.length >= 12 && own.startsWith(said) && !own.slice(said.length).includes('#'))
            return true;
        const at = said.indexOf(own);
        if (at < 0)
            continue;
        const rest = said.slice(0, at) + said.slice(at + own.length);
        if (!rest.includes('#') && own.length >= rest.length)
            return true;
    }
    return false;
}
const HEAD_SEPARATOR = /\s+[:：|｜]\s+|\s+[―—]\s+/gu;
export function issueHeadStatement(head: unknown): string | null {
    const value = NFKC(head).replace(/\s+/g, ' ').trim();
    const issue = (side: string) => !!side && isIssueStatement(side.replace(/#+/g, '2000'));
    const seams = [...value.matchAll(HEAD_SEPARATOR)].map(match => ({ at: match.index ?? 0, length: match[0].length }));
    for (const seam of [...seams].reverse()) {
        const left = value.slice(0, seam.at).trim(), right = value.slice(seam.at + seam.length).trim();
        if (left && issue(right) && !issue(left))
            return left;
    }
    for (const seam of seams) {
        const left = value.slice(0, seam.at).trim(), right = value.slice(seam.at + seam.length).trim();
        if (right && issue(left) && !issue(right))
            return right;
    }
    return null;
}
const EMAIL_LINE = /(?<![\w.+-])[\w.+-]+@[\w-]+\.[\w.-]+/;
const ORCID_LINE = /\borcid\b|\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/i;
const AFFILIATION_LINE = /^[a-z\d]\s+\p{Lu}[\p{L}\s]{6,}|^\s*\*+\s*Corresponding|^\s*Received\b|^\s*Accepted\b/u;
const CORRESPONDING_MARK = /(?<![*†‡§¶])[*†‡§¶]+\s*$/;
const TRAILING_MARKS = /(?<![*†‡§¶\d])[*†‡§¶\d]+$/;
export function splitColumns(line: string): string[] {
    const value = String(line ?? '').trimEnd();
    const body = value.trimStart();
    if (!body)
        return [];
    const parts = body.split(/ {3,}/).map(part => part.trim()).filter(Boolean);
    return parts.length > 1 ? parts : [body];
}
const NAME_SEPARATOR = /\s*[,;·ㆍᆞ･・•∙‧⋅⸱/&]\s*|\s+and\s+|\s+(?:및|와|과)\s+/i;
function personWithContact(line: string, _isName?: NameTest): {
    name: string;
    email: string | null;
    rest: string;
} | null {
    const row = readBylineRow(NFKC(line).trim());
    const first = row.items[0];
    if (row.items.length !== 1 || !first || !CJK_LETTER.test(first.text) || first.shape.person === 'no' || !(first.contact || first.alternates.length))
        return null;
    return { name: nameOfItem(first), email: first.contact ?? null, rest: row.affiliations.join(', ') };
}
function spacedHangulName(name: string, _isName?: NameTest): string | null {
    const value = NFKC(name).trim();
    if (!/^(?:[가-힣]{1,2}|\p{Script=Han})(?:\s+[가-힣]{1,2}){1,3}$/u.test(value))
        return null;
    const shape = nameShape(value, { listed: true });
    return shape.person !== 'no' && shape.kind === 'korean' && shape.text.length <= 4 ? shape.text : null;
}
export function isPositionPhrase(value: unknown): boolean {
    const text = NFKC(value).replace(/\s+/g, ' ').trim().replace(/\.$/, '');
    if (!text || text.split(' ').length > 8 || !/^[\p{L}&.\s-]+$/u.test(text))
        return false;
    const head = text.split(/\s+(?:of|for|at|in)\s+/i)[0].split(' ');
    if (head.length > 5)
        return false;
    const last = head[head.length - 1];
    return positionIn(last) || (/s$/i.test(last) && positionIn(last.slice(0, -1)));
}
const affiliationPiece = (value: string) => isOrganisationName(value) || LEGAL_FORM.test(value) || RESPONSIBILITY_LINE.test(value);
function carriesAnApposition(line: string): boolean {
    const items = NFKC(line).split(NAME_SEPARATOR).map(part => part.trim()).filter(Boolean);
    return items.length >= 2 && items.slice(1).some(isPositionPhrase);
}
export function withoutAppositions(items: string[]): string[] {
    const kept: string[] = [];
    for (let at = 0; at < items.length; at++) {
        if (!kept.length || !isPositionPhrase(items[at])) {
            kept.push(items[at]);
            continue;
        }
        const closes = items.findIndex((item, index) => index > at && affiliationPiece(item));
        if (closes > at)
            at = closes;
    }
    return kept;
}
type NamePart = {
    name: string;
    keyRemoved: boolean;
    gloss?: string;
};
function nameParts(text: string): NamePart[] {
    return readBylineRow(String(text ?? '')).items.map(item => ({ name: nameOfItem(item), keyRemoved: keyedItem(item), ...(item.alternates[0] ? { gloss: item.alternates[0] } : {}) }));
}
export { bylineBlock, formPeople, formPeopleAcrossPages, formStatesItsPersons, namesInLines, responsibilityLines, runningHeadNames } from './byline';
export const BYLINE_READING_SHAPES = { NFKC, afterTitle, byAuthorLine, BY_LINE, DATE_ONLY, CODE_LINE, EDITION_LINE, documentLabel, HANGUL, LATIN_WORD, RESPONSIBILITY_LINE, AFFILIATION_LINE, EMAIL_LINE, ORCID_LINE, CORRESPONDING_MARK, TRAILING_MARKS, CJK_LETTER };
export const TITLE_LINE_SHAPES = { NFKC, PUBLISHER_WORD, lettersAlike, afterTitle, BY_LINE, DATE_ONLY, PAGE_FURNITURE, WEB_ADDRESS, CODE_LINE, looksLikeCode, EDITION_LINE, HANGUL, LATIN_WORD, STATUTE_REFERENCE, TRAILING_EDITION, TRAILING_EDITION_KO, stripMarks, roleStatement, ROLE_WORD, TRAILING_ROLE_WORD, roleOfWord, roleWordLine, titleOverByline, ANNEX_DESIGNATION, documentLabel, institutionLine, dateStatement, readableLine, sentenceLine, fullMeasureOpening, proseBlock, personLine, cjkNameList, nameListRow, keyedNameList, markedNameList, median, isPersonShaped, ROMAN_NUMERAL_SIGN, CROSS_REFERENCE, wordBrokenAcross, SENTENCE_INSIDE, CITATION_MARK, KOREAN_SENTENCE_END, opensMidWord, joinTitleLines, compactLetters, sharedPrefix, statedByRunningHead, personWithContact, spacedHangulName, nameParts };

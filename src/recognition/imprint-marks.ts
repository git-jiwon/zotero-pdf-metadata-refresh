import { isOrganisationName } from './title-guards';
import { PUBLISHER_TAIL_SOURCE, frequencyStatementOf } from './label-words';
export const IMPRINT_MARKS = {
    rights: /©|ⓒ|\(c\)\s*(?:19|20)\d{2}|\bcopyright\b|all\s+rights\s+reserved|판권|저작권/iu,
    catalogue: /library\s+of\s+congress|catalog(?:u)?ing[-\s]+in[-\s]+publication|\bCIP\b|british\s+library|nationalbibliothek|biblioth[eè]que\s+nationale|\bp\.\s*cm\b/iu,
    issue: /first\s+published|printed\s+(?:in|on|and\s+bound)|발행처|발행인|발행일|펴낸\s*(?:곳|이|날)|초판|\d\s*쇄(?![가-힣])|인쇄|출판\s*등록|등록\s*번호/iu,
    edition: /\bISBN\b|\b(?:first|second|third|\d+(?:st|nd|rd|th))\s+(?:edition|printing)\b|\bpublished\s+(?:in|by)\b|발행|판\s*\d+\s*쇄/iu
} as const;
export function imprintSignal(value: unknown): boolean {
    const text = String(value ?? '');
    return IMPRINT_MARKS.rights.test(text) || IMPRINT_MARKS.catalogue.test(text) || IMPRINT_MARKS.issue.test(text);
}
export function imprintMark(value: unknown): boolean {
    const text = String(value ?? '');
    return imprintSignal(text) || IMPRINT_MARKS.edition.test(text);
}
export function rightsMark(value: unknown): boolean {
    return IMPRINT_MARKS.rights.test(String(value ?? ''));
}
export const STATEMENT_LABELS = {
    house: /(?<![\p{L}])(?:발\s*행\s*처|펴\s*낸\s*곳|발\s*간\s*처|발\s*행\s*기\s*관|발\s*간\s*기\s*관|출\s*판\s*사(?=\s*[:：])|publisher(?=\s*[:：])|issued\s+by)(?![\p{L}])\s*[:：]?\s*/giu,
    person: /(?<![\p{L}])(?:발\s*행\s*인|펴\s*낸\s*이|편\s*집\s*인)(?![\p{L}])\s*[:：]?\s*/gu,
    printer: /(?<![\p{L}])(?:인\s*쇄\s*인|인\s*쇄\s*처|인\s*쇄\s*소|printed\s+by)(?![\p{L}])\s*[:：]?\s*/giu,
    date: /(?<![\p{L}])(?:발\s*행\s*일|펴\s*낸\s*날|발\s*간\s*일)(?![\p{L}])\s*[:：]?\s*/gu
} as const;
export const EDITION_LEADS = {
    published: /(?<![\p{L}])(originally|previously|formerly|first)\s+published(?![\p{L}])/iu,
    original: /原著|原書|原作|原題|(?<![가-힣])원\s*(?:서|저)(?![가-힣])|(?<![\p{L}])original\s+title\s*[:：]/iu,
    earlier: /(?:previously|originally|formerly|first|earlier|초판은|원래)\s*$/iu
} as const;
export const ARRANGEMENT = {
    statement: /(?<![\p{L}])(?:by|through|under)\s+(?:special\s+)?(?:arrangement|agreement|permission|licen[cs]e)\s+(?:with|of|from)\s+/iu,
    opens: /^\s*(?:special\s+)?(?:arrangement|agreement|permission|licen[cs]e)\s+(?:with|of|from)\b/iu,
    through: /\s+through\s+/iu
} as const;
export const TRANSLATION_RIGHTS = {
    before: /(?:(?<![\p{L}])(?:translation|edition)\s*|(?:한국어|번역)\s?판\s*(?:저작권\s*)?)$/iu,
    inLine: /(?<![\p{L}])(?:translation|edition)\s+copyright|한국어\s?판|번역\s?판/iu
} as const;
export const EDITION_ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'] as const;
export const EDITION_ORDINAL = String.raw `(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th))`;
export const JURISDICTION: ReadonlyArray<{
    issuer: RegExp;
    country: string;
    state: string;
}> = [
    { issuer: /^(?:대한민국\s*)?특허청(?:장)?$|^KIPO$|^Korean\s+Intellectual\s+Property\s+Office$/iu, country: 'KR', state: '대한민국' },
    { issuer: /^USPTO$|^United\s+States\s+Patent\s+and\s+Trademark\s+Office$/iu, country: 'US', state: 'United States' },
    { issuer: /^(?:日本国?\s*)?特許庁(?:長官)?$|^JPO$|^Japan\s+Patent\s+Office$/iu, country: 'JP', state: '日本' },
    { issuer: /^[가-힣]{1,12}(?:부|처|청|위원회)$/u, country: 'KR', state: '대한민국' }
];
export function jurisdictionOf(issuer: unknown): {
    country: string;
    state: string;
} | null {
    const name = String(issuer ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!name)
        return null;
    const found = JURISDICTION.find(entry => entry.issuer.test(name));
    return found ? { country: found.country, state: found.state } : null;
}
const ORDINANCE_NUMBER = /([가-힣]{1,12}(?:부|처|청|위원회))령\s*제\s*\d+\s*호/u;
export function ordinanceMinistry(text: unknown): string {
    return ORDINANCE_NUMBER.exec(String(text ?? '').normalize('NFKC'))?.[1] || '';
}
export function stateBody(issuer: string): string {
    const where = jurisdictionOf(issuer);
    return where ? `${where.state} ${issuer}` : issuer;
}
const IMPRINT_TAIL = /\s*(?:[|｜❙│┃]|\s[Iㅣl]\s|(?<![\p{L}])(?:발\s*행\s*인|편\s*집\s*인|인\s*쇄\s*인|인\s*쇄\s*처|편\s*집\s*처|ISSN|ISBN|e-?ISSN|주\s*소|전\s*화|TEL|FAX|팩\s*스|홈\s*페\s*이\s*지|E-?mail|등록\s*번호|발간\s*등록\s*번호|All\s+rights\s+reserved)(?![\p{L}])|https?:|www\.).*$/iu;
const IMPRINT_FIELD_LABEL = /^\s*(?:(?:©|\(c\)|copyright)\s*(?:(?:19|20)\d{2}\s*[,.]?\s*)?|(?:발\s*행\s*처|발\s*행\s*기\s*관|발\s*행|펴\s*낸\s*곳|출\s*판\s*사|출\s*판|publisher|published\s+by|by)\s*[:：]?\s*)/i;
const CONTAINER_LEAD = /^\s*(?:(?:originally\s+|first\s+)?(?:published|appeared|reprinted|republished)\s+(?:in|from)\s+|in\s*[:：]\s*)(?=\S)/i;
const OFFICE_HEAD = /^(.{3,}?(?:원|소|청|처|회|부|공단|공사|대학교))(?:장|이사장|총장)$/;
export function nameInImprint(value: unknown): string {
    const text = String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!text)
        return '';
    const bare = text.replace(CONTAINER_LEAD, '').replace(IMPRINT_FIELD_LABEL, '').replace(IMPRINT_TAIL, '').replace(/[\s,;:·]+$/, '').trim();
    let named = withoutPublisherTail(bare);
    if (bare && !named)
        return '';
    const head = OFFICE_HEAD.exec(named.replace(/\s+/g, ''));
    if (head && isOrganisationName(head[1]))
        named = head[1];
    return named.length >= 2 ? named : text;
}
const PUBLISHER_TAIL_END = new RegExp(`(?:[^\\S\\n]+|[^\\S\\n]*[(（][^\\S\\n]*)(?:${PUBLISHER_TAIL_SOURCE})[^\\S\\n]*[)）]?[^\\S\\n]*$`, 'u');
export function withoutPublisherTail(value: string): string {
    const text = String(value ?? '');
    if (!text || text.length > 400)
        return text;
    if (frequencyStatementOf(text))
        return '';
    const found = PUBLISHER_TAIL_END.exec(text);
    if (!found)
        return text;
    const rest = text.slice(0, found.index).replace(/[\s,;:·/]+$/u, '').trim();
    return rest.replace(/[^\p{L}\p{N}]/gu, '').length >= 2 ? rest : text;
}
export interface PrintingStatement {
    edition: number;
    printing: number;
    date: {
        value: string;
        precision: 'year' | 'month' | 'day';
    };
    raw: string;
    row: number;
}
const ordinalNumber = (word: string): number => {
    const lower = String(word ?? '').toLowerCase();
    const at = (EDITION_ORDINALS as readonly string[]).indexOf(lower);
    if (at >= 0)
        return at + 1;
    const digits = /^(\d{1,2})(?:st|nd|rd|th)$/.exec(lower);
    return digits ? Number(digits[1]) : 0;
};
const PRINTING_MARK = new RegExp(String.raw `(?<!\d)(\d{1,3})[^\S\n]*(?:쇄|刷)|(?<![\p{L}])(${EDITION_ORDINAL})[^\S\n]+printing(?![\p{L}])`, 'iu');
const EDITION_MARK = new RegExp(String.raw `개정[^\S\n]*(\d{1,2})[^\S\n]*판|제[^\S\n]*(\d{1,2})[^\S\n]*판|(?<![\d\p{L}·×*/.\-])(\d{1,2})[^\S\n]*판(?![\p{L}])|第[^\S\n]*(\d{1,2})[^\S\n]*版`
    + String.raw `|(초판|初版)|((?:전면[^\S\n]*)?개정[^\S\n]*(?:증보[^\S\n]*)?판|증보[^\S\n]*판|신판|改訂版|改訂新版|増補版|增補版|修訂版)`
    + String.raw `|(?<![\p{L}])(${EDITION_ORDINAL})[^\S\n]+(?:\p{L}{2,20}[^\S\n]+){0,2}?edition(?![\p{L}])|(?<![\p{L}])(revised|enlarged|expanded)[^\S\n]+edition(?![\p{L}])`, 'iu');
function editionOf(cell: string): number {
    const found = EDITION_MARK.exec(cell);
    if (!found)
        return 0;
    if (found[1])
        return Number(found[1]) + 1;
    const number = found[2] || found[3] || found[4];
    if (number)
        return Number(number);
    if (found[5])
        return 1;
    if (found[6] || found[8])
        return 2;
    return found[7] ? ordinalNumber(found[7]) : 0;
}
const PRINTING_MARKS = new RegExp(PRINTING_MARK.source, 'giu');
const EDITION_MARKS = new RegExp(EDITION_MARK.source, 'giu');
function countOf(pattern: RegExp, cell: string): number {
    let count = 0;
    for (const _ of cell.matchAll(pattern))
        if (++count >= 3)
            break;
    return count;
}
const ISSUE_WORD = /발행|펴냄|펴낸|인쇄|간행|発行|發行|刊行|印刷|published|printed|printing|issued/iu;
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthOfName = (word: string): number => {
    const lower = String(word ?? '').toLowerCase().replace(/\.$/, '');
    if (lower.length < 3)
        return 0;
    return MONTH_NAMES.findIndex(name => name.startsWith(lower)) + 1;
};
const pad2 = (value: number) => String(value).padStart(2, '0');
const YEAR_SOURCE = String.raw `(?:1[4-9]|20)\d{2}`;
const DATE_CJK = new RegExp(String.raw `(${YEAR_SOURCE})[^\S\n]*[년年](?:[^\S\n]*(\d{1,2})[^\S\n]*[월月](?:[^\S\n]*(\d{1,2})[^\S\n]*[일日])?)?`, 'u');
const DATE_NUMERIC = new RegExp(String.raw `(?<!\d)(${YEAR_SOURCE})[^\S\n]*[.\-/][^\S\n]*(\d{1,2})(?:[^\S\n]*[.\-/][^\S\n]*(\d{1,2}))?(?!\d)`, 'u');
const DATE_MONTH_DAY = new RegExp(String.raw `(?<![\p{L}])(\p{L}{3,9})\.?[^\S\n]+(\d{1,2})(?:st|nd|rd|th)?,?[^\S\n]+(${YEAR_SOURCE})(?!\d)`, 'u');
const DATE_DAY_MONTH = new RegExp(String.raw `(?<!\d)(\d{1,2})(?:st|nd|rd|th)?[^\S\n]+(\p{L}{3,9})\.?,?[^\S\n]+(${YEAR_SOURCE})(?!\d)`, 'u');
const DATE_MONTH_YEAR = new RegExp(String.raw `(?<![\p{L}])(\p{L}{3,9})\.?,?[^\S\n]+(${YEAR_SOURCE})(?!\d)`, 'u');
const DATE_YEAR = new RegExp(String.raw `(?<!\d)(${YEAR_SOURCE})(?!\d)`, 'u');
export function printedDateIn(cell: unknown): {
    value: string;
    precision: 'year' | 'month' | 'day';
    index: number;
} | null {
    const text = String(cell ?? '');
    if (!text || text.length > 400)
        return null;
    const shaped = (year: string, month: number, day: number, index: number) => {
        if (month && (month < 1 || month > 12))
            return null;
        if (day && (day < 1 || day > 31))
            return null;
        const precision: 'year' | 'month' | 'day' = month && day ? 'day' : month ? 'month' : 'year';
        return { value: precision === 'day' ? `${year}-${pad2(month)}-${pad2(day)}` : precision === 'month' ? `${year}-${pad2(month)}` : year, precision, index };
    };
    const cjk = DATE_CJK.exec(text);
    if (cjk)
        return shaped(cjk[1], Number(cjk[2] || 0), cjk[2] ? Number(cjk[3] || 0) : 0, cjk.index);
    const numeric = DATE_NUMERIC.exec(text);
    if (numeric)
        return shaped(numeric[1], Number(numeric[2]), Number(numeric[3] || 0), numeric.index);
    const monthDay = DATE_MONTH_DAY.exec(text);
    if (monthDay && monthOfName(monthDay[1]))
        return shaped(monthDay[3], monthOfName(monthDay[1]), Number(monthDay[2]), monthDay.index);
    const dayMonth = DATE_DAY_MONTH.exec(text);
    if (dayMonth && monthOfName(dayMonth[2]))
        return shaped(dayMonth[3], monthOfName(dayMonth[2]), Number(dayMonth[1]), dayMonth.index);
    const monthYear = DATE_MONTH_YEAR.exec(text);
    if (monthYear && monthOfName(monthYear[1]))
        return shaped(monthYear[2], monthOfName(monthYear[1]), 0, monthYear.index);
    const year = DATE_YEAR.exec(text);
    return year ? shaped(year[1], 0, 0, year.index) : null;
}
export function printingsIn(text: unknown): PrintingStatement[] {
    const out: PrintingStatement[] = [];
    const rows = String(text ?? '').normalize('NFKC').split(/[\n\f]/);
    let edition = 0;
    rows.forEach((line, row) => {
        if (!line.trim() || line.length > 200 || EDITION_LEADS.original.test(line) || EDITION_LEADS.published.test(line))
            return;
        const cells = line.split(/[^\S\n]*[;；|｜][^\S\n]*|[^\S\n]{2,}/).flatMap(cell => countOf(PRINTING_MARKS, cell) >= 2 || countOf(EDITION_MARKS, cell) >= 2 ? cell.split(/[,，]/) : [cell]);
        for (const cell of cells) {
            const value = cell.trim();
            if (!value)
                continue;
            const printing = PRINTING_MARK.exec(value);
            const stated = editionOf(value);
            if (stated)
                edition = stated;
            const date = printedDateIn(value);
            if (!date || (!printing && !(stated && ISSUE_WORD.test(value))))
                continue;
            const number = printing ? (printing[1] ? Number(printing[1]) : ordinalNumber(printing[2])) : 1;
            if (!number)
                continue;
            out.push({ edition, printing: number, date: { value: date.value, precision: date.precision }, raw: value, row });
        }
    });
    return out;
}
export function firstPrintingIn(text: unknown): {
    chosen: PrintingStatement;
    others: PrintingStatement[];
} | null {
    const statements = printingsIn(text);
    if (statements.length < 2)
        return null;
    const latest = Math.max(...statements.map(entry => entry.edition));
    const chosen = statements.filter(entry => entry.edition === latest)
        .sort((a, b) => a.printing - b.printing || a.date.value.localeCompare(b.date.value) || a.row - b.row)[0];
    return { chosen, others: statements.filter(entry => entry !== chosen) };
}

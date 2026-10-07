import { buildDiff } from '../metadata/diff';
import { LABELLED_READING_SOURCE } from './label-words';
import { looksLikeJournalArticle } from './local-publication';
import { titleSimilarity } from '../metadata/match';
import { isbnsIn, normalizedISBN, sameDOI, SICI_TAIL, validISBN } from '../metadata/identifier-compare';
import { assertIdentityUnchanged, captureIdentity } from '../metadata/snapshot';
import { imprintSignal } from './imprint-marks';
import { storableType } from './item-fields';
import { numberedSectionHeading } from './roles';
import { rowIsNameList } from './byline-row';
import { isCitationAuthorList, isNotATitle, looksLikeBodyProse, serialNameShaped } from './title-guards';
import { foldedLetters, linesOf, shouting } from './folded-letters';
import { leafPages, readPageStructure, regionSpansIn, regionsOf, withoutOtherWorksIn } from './page-structure';
import type { MetadataSnapshot, RecognitionResult } from '../types';
export type PDFIdentifier = {
    kind: 'DOI' | 'ISBN';
    value: string;
};
const nfkc = (value: unknown) => String(value || '').replace(/[ㆍᆞ]/g, '·').normalize('NFKC');
const printedDOI = (value: unknown) => nfkc(value).trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/[\s.,;:)}\]>]+$/g, '');
const cleanDOI = (value: unknown) => printedDOI(value).toLowerCase();
const cleanISBN = (value: unknown) => String(value || '').toUpperCase().replace(/[^0-9X]/g, '');
const searchable = (value: unknown) => nfkc(value).toLowerCase()
    .replace(/<\/?(?:sub|sup|i|b)>/gi, '').replace(/[^\p{L}\p{N}]+/gu, '');
const ISBN_SHAPE = /^(?:\d{9}[\dX]|97[89]\d{10})$/;
function checksumHolds(digits: string): boolean {
    return !!validISBN(digits);
}
export function isbnFromPrinted(run: unknown): string {
    const printed = String(run || '');
    const digits = cleanISBN(printed);
    if (ISBN_SHAPE.test(digits))
        return digits;
    if (/^97[89]/.test(digits) && digits.length >= 13) {
        if (checksumHolds(digits.slice(0, 13)))
            return digits.slice(0, 13);
    }
    else if (digits.length > 10 && checksumHolds(digits.slice(0, 10)))
        return digits.slice(0, 10);
    const head = cleanISBN(printed.trim().split(/\s+/)[0]);
    return ISBN_SHAPE.test(head) ? head : '';
}
const ISBN_LABELLED = /\bISBNs?(?:[-\s]?1[03]\b)?\s*[:：]?\s*((?:97[89][\s-]*)?\d[\d\s-]{7,20}[\dX])/gi;
export const OTHER_WORKS_HEADING = new RegExp('^[^\\S\\n]*(?:' + [
    'related\\s+(?:[\\p{L}-]+\\s+)?titles?',
    'also\\s+(?:of\\s+interest|available(?!\\s+(?:as|in|on)\\b)|from|by|in\\s+(?:this|the)\\s+series)',
    'other\\s+(?:titles?|books?|volumes?)(?:\\s+(?:of\\s+interest|in\\s+(?:this|the)\\s+series|from|by))?',
    'further\\s+(?:titles?|reading)', 'titles?\\s+of\\s+related\\s+interest', '(?:more|recent|forthcoming|new)\\s+titles?',
    'books?\\s+in\\s+(?:this|the)\\s+series', 'from\\s+the\\s+same\\s+(?:publisher|author|series)',
    'books?\\s+(?:reviews?|received)', 'reviews?\\s+of\\s+books?',
    '관련\\s*(?:도서|서적|책)', '추천\\s*(?:도서|서적|책)', '함께\\s*(?:읽(?:을|으면)|보면)[^\\n]{0,6}책', '같은\\s*(?:출판사|저자|시리즈)',
    '이\\s*(?:저자|시리즈)의\\s*(?:다른\\s*)?책', '서평', '신간\\s*안내', '도서\\s*목록', '関連書籍', '既刊'
].join('|') + ')(?![\\p{L}])(?![^\\n]*ISBN)[^\\n]{0,40}$', 'imu');
const FORMAT_LABEL = /\b(?:print(?:ed)?|online|electronic|e-?books?|e-?pdf|pdf|e-?pub|mobi|o-?book|kindle|web|digital|hard(?:back|cover|bound)?|paper(?:back|bound)?|soft(?:cover|back|bound)?|cloth|pbk|hbk|hb|pb|alk|acid-free|set|vols?|volumes?|v|pt|isbns?|e|cd-?rom|dvd|and|or)\b\.?|양장본?|반양장|무선철?|전자책|종이책|세트|낱권|부가기호/giu;
const FORMAT_TAIL = /^[^\S\n]*[(\[]?[^\S\n]*(?:print|online|electronic|e-?books?|ebk|e-?pdf|e-?pub|mobi|o-?book|kindle|hard(?:back|cover|bound)|paper(?:back|bound)?|soft(?:cover|back|bound)|cloth|pbk|hbk|hb\b|pb\b|set\b|v\.\s*\d|vol\b|양장|반양장|무선|전자책|종이책|세트)/iu;
const VOLUME_DESIGNATION = /\b(?:vol(?:ume)?|part|band|tome)\.?\s*[\dIVX]+\b|제?\s*\d+\s*권/iu;
function holdsAWork(gap: string): boolean {
    const words = gap.replace(FORMAT_LABEL, ' ')
        .match(/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}|\p{L}{3,}/gu) || [];
    return words.length >= 2;
}
interface ISBNCluster {
    blockStart: number;
    start: number;
    end: number;
    matchEnd: number;
    values: Set<string>;
}
const EXTENT_AFTER_YEAR = /(?:1[5-9]|20)\d{2}\s*[.,;]\s*(?:[xivlc]+\s*,\s*)?\d{1,4}\s*(?:pp?\.|pages?(?!\p{L})|쪽|면(?![가-힣]))/iu;
const BOOK_PRICE = /(?:US\s?\$|[$£€¥]|\bDM|\bSFr\.?)\s?\d{1,5}(?:[.,]\d{1,2})?(?!\d)|\d{1,3}(?:,\d{3})+\s*원/u;
const INITIAL_END = /(?:^|[^\p{L}])\p{Lu}\.["”’)\]]?[^\S\n]*$/u;
const ABBREVIATION_END = /(?:^|[^\p{L}])(?:eds?|vols?|nos?|pp?|inc|co|corp|ltd|jr|sr|dr|st|prof|al|cf|ca|trans|rev|repr|comp)\.["”’)\]]?[^\S\n]*$/iu;
const SENTENCE_END = /[.!?]["”’)\]]?[^\S\n]*$/u;
const CONTINUED_END = /(?:[-‐,&:;]|\b(?:and|of|the|for|in|on|to|by|und|et))[^\S\n]*$/iu;
function endsAParagraph(line: string): boolean {
    const value = line.trim();
    if (!value)
        return true;
    if (SENTENCE_END.test(value) && !INITIAL_END.test(value) && !ABBREVIATION_END.test(value))
        return true;
    const words = value.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word));
    return words.length <= 4 && !CONTINUED_END.test(value);
}
function paragraphStart(page: string, at: number): number {
    let lineStart = page.lastIndexOf('\n', Math.max(0, at - 1)) + 1;
    if (lineStart > at)
        lineStart = 0;
    for (let taken = 1; taken < 6 && lineStart > 0; taken++) {
        const previousStart = page.lastIndexOf('\n', Math.max(0, lineStart - 2)) + 1;
        const from = previousStart >= lineStart ? 0 : previousStart;
        if (endsAParagraph(page.slice(from, lineStart - 1)))
            break;
        lineStart = from;
    }
    return Math.max(lineStart, at - 600);
}
function otherWorksInPage(page: string, offset: number, out: Array<[
    number,
    number
]>) {
    const hits: Array<{
        start: number;
        end: number;
        matchEnd: number;
        value: string;
    }> = [];
    for (const match of page.matchAll(ISBN_LABELLED)) {
        const value = normalizedISBN(isbnFromPrinted(match[1]));
        if (!value)
            continue;
        const start = match.index ?? 0;
        const newline = page.indexOf('\n', start);
        const end = newline >= 0 && newline < start + match[0].length ? newline : start + match[0].length;
        hits.push({ start, end, matchEnd: start + match[0].length, value });
    }
    if (!hits.length)
        return;
    const clusters: ISBNCluster[] = [];
    let previous = 0;
    for (const hit of hits) {
        const last = clusters[clusters.length - 1];
        if (last && !holdsAWork(page.slice(previous, hit.start))) {
            last.end = hit.end;
            last.matchEnd = hit.matchEnd;
            last.values.add(hit.value);
        }
        else
            clusters.push({ blockStart: previous, start: hit.start, end: hit.end, matchEnd: hit.matchEnd, values: new Set([hit.value]) });
        previous = hit.end;
    }
    const entries = clusters.map(cluster => {
        const block = page.slice(cluster.blockStart, cluster.start);
        const heading = OTHER_WORKS_HEADING.exec(block);
        const own = heading ? block.slice(heading.index) : block;
        const lineEnd = page.indexOf('\n', cluster.end);
        const from = paragraphStart(page, cluster.start);
        const paragraphEnd = page.indexOf('\n', cluster.matchEnd);
        const to = paragraphEnd >= 0 ? Math.min(paragraphEnd, cluster.matchEnd + 120) : Math.min(page.length, cluster.matchEnd + 120);
        const paragraph = page.slice(from, to);
        const described = [EXTENT_AFTER_YEAR.test(paragraph), BOOK_PRICE.test(paragraph),
            /\([^\S\n]*$/.test(page.slice(Math.max(0, cluster.start - 3), cluster.start))].filter(Boolean).length >= 2;
        const single = described && holdsAWork(paragraph) && !imprintSignal(paragraph);
        const listed = own.length <= 900 && holdsAWork(own) && !imprintSignal(own);
        return { ...cluster, heading: heading ? cluster.blockStart + heading.index : -1, block: own,
            formatted: FORMAT_TAIL.test(page.slice(cluster.end, lineEnd >= 0 ? Math.min(lineEnd, cluster.end + 40) : cluster.end + 40)),
            listed: listed || single, single, alone: single && !listed, from, to };
    });
    const imprinted = imprintSignal(page);
    const close = (run: typeof entries) => {
        if (!run.length)
            return;
        const headed = run[0].heading >= 0;
        if (run.length < 2 && !headed) {
            if (run[0].single)
                out.push([offset + run[0].from, offset + Math.max(run[0].to, run[0].end)]);
            return;
        }
        if (!headed && imprinted && !run.every(entry => entry.single)
            && (run.every(entry => VOLUME_DESIGNATION.test(entry.block)) || run.some(entry => entry.formatted)))
            return;
        const first = run[0], last = run[run.length - 1];
        let start = first.heading;
        if (start < 0) {
            const longest = Math.max(0, ...run.slice(1).map(entry => entry.start - entry.blockStart));
            const floor = Math.max(first.blockStart, first.start - (longest || first.start - first.blockStart) - 40);
            const lineStart = floor > first.blockStart ? page.indexOf('\n', floor - 1) : -1;
            start = lineStart >= 0 && lineStart < first.start ? lineStart + 1 : floor;
        }
        const next = clusters.find(cluster => cluster.start > last.end);
        const lineEnd = page.indexOf('\n', last.end);
        const end = Math.min(lineEnd >= 0 ? lineEnd : page.length, next ? next.start : page.length, last.end + 80);
        out.push([offset + start, offset + Math.max(end, last.end)]);
    };
    let run: typeof entries = [];
    const seen = new Set<string>();
    for (const entry of entries) {
        if (entry.alone) {
            close(run);
            run = [];
            seen.clear();
            out.push([offset + entry.from, offset + Math.max(entry.to, entry.end)]);
            continue;
        }
        const repeated = [...entry.values].some(value => seen.has(value));
        if (!entry.listed || repeated) {
            close(run);
            run = [];
            seen.clear();
            if (!entry.listed)
                continue;
        }
        if (run.length && entry.heading >= 0) {
            close(run);
            run = [];
            seen.clear();
        }
        run.push(entry);
        entry.values.forEach(value => seen.add(value));
    }
    close(run);
}
export function otherWorksISBNRegions(text: unknown): Array<[
    number,
    number
]> {
    const value = String(text || '');
    const out: Array<[
        number,
        number
    ]> = [];
    let offset = 0;
    for (const page of value.split('\f')) {
        otherWorksInPage(page, offset, out);
        offset += page.length + 1;
    }
    return out;
}
export function withoutOtherWorks(text: unknown): string {
    let kept = String(text || '');
    for (const [start, end] of [...otherWorksISBNRegions(kept)].sort((a, b) => b[0] - a[0]))
        kept = kept.slice(0, start) + '\n' + kept.slice(end);
    return kept;
}
type PageLike = string | {
    text?: unknown;
} | null | undefined;
const textOfPage = (page: PageLike) => typeof page === 'string' ? page : String(page?.text || '');
export function ownISBNs(pages: PageLike[] | PageLike): string[] {
    const list = Array.isArray(pages) ? pages : [pages];
    const out: string[] = [];
    for (const page of list) {
        for (const entry of scanIdentifiers({ text: textOfPage(page), complete: true }).observations) {
            if (entry.kind !== 'ISBN' || entry.confidence === 'ambiguous')
                continue;
            const value = normalizedISBN(entry.value);
            if (value && !out.includes(value))
                out.push(value);
        }
    }
    return out;
}
export function otherWorksISBNs(pages: PageLike[] | PageLike): string[] {
    const list = Array.isArray(pages) ? pages : [pages];
    const own = ownISBNs(list);
    const out: string[] = [];
    for (const page of list) {
        for (const entry of scanIdentifiers({ text: textOfPage(page), complete: true }).otherWorks) {
            const value = normalizedISBN(entry.value);
            if (value && !own.includes(value) && !out.includes(value))
                out.push(value);
        }
    }
    return out;
}
export function recordOfAListedWork(record: {
    ISBN?: unknown;
    DOI?: unknown;
    title?: unknown;
} | null | undefined, pages: PageLike[] | PageLike): string | null {
    const isbns = isbnsIn(record?.ISBN);
    if (!isbns.length)
        return null;
    const list = Array.isArray(pages) ? pages : [pages];
    const own = ownISBNs(list);
    if (isbns.some(isbn => own.includes(isbn)))
        return null;
    const listed = otherWorksISBNs(list);
    const hit = isbns.find(isbn => listed.includes(isbn));
    if (!hit)
        return null;
    const outside = list.map(page => withoutOtherWorks(textOfPage(page))).join('\n\f\n');
    if (record?.title && titleSupportedByPDF(record.title, outside))
        return null;
    const doi = cleanDOI(record?.DOI);
    if (doi && scanIdentifiers({ text: outside, complete: true }).observations.some(entry => entry.kind === 'DOI' && entry.value.toLowerCase() === doi))
        return null;
    return `ISBN ${hit}은(는) 문서가 다른 책 목록(관련 도서 등)에 다른 책의 것으로 인쇄한 번호입니다 — 이 문서 자신의 ISBN(${own.join(', ') || '인쇄되지 않음'})이 아닙니다`;
}
const ATTRIBUTED_ELSEWHERE = /\b(?:original|corrected|retracted|withdrawn|superseded|preprint|earlier)\s+(?:article|paper|version|work|manuscript)\b[^\n]{0,20}$|\b(?:원문|원저|원본)\s*(?:논문|기사)?\s*(?:DOI)?\s*[:：]?\s*$/i;
export function attributedToAnotherWork(before: unknown): boolean {
    return ATTRIBUTED_ELSEWHERE.test(String(before || '').slice(-60));
}
const DOI_LABEL = /(?:\bdoi\b|doi\.org\/|\bdigital\s+object\s+identifier\b)/i;
const BARE_REFERENCE_HEADING = /^[^\S\n]*(?:\d+\.?[^\S\n]*)?(?:references?|bibliography|literature[^\S\n]+cited|works[^\S\n]+cited|reference[^\S\n]+list|참[^\S\n]*고[^\S\n]*문[^\S\n]*헌|인[^\S\n]*용[^\S\n]*문[^\S\n]*헌|引用文献|参考文献)[^\S\n]*[:：]?[^\S\n]*$/i;
const QUALIFIED_REFERENCE_HEADING = /^[^\S\n]*(?:\d+\.?[^\S\n]*)?(?:(?:(?:\p{Lu}[\p{L}’'-]{0,14}|and|AND|of|OF|&)[^\S\n]+){1,2}(?:References?|REFERENCES?|Bibliography|BIBLIOGRAPHY)|(?:References?|REFERENCES?)[^\S\n]+(?:and|AND|&)[^\S\n]+(?:Notes?|NOTES?))[^\S\n]*[:：]?[^\S\n]*$/u;
export function isReferenceListHeading(line: unknown): boolean {
    const value = String(line ?? '');
    return BARE_REFERENCE_HEADING.test(value) || QUALIFIED_REFERENCE_HEADING.test(value);
}
export const END_OF_REFERENCES = /^[^\S\n]*(?:\d+\.?[^\S\n]*)?(?:acknowledge?ments?|funding|author[^\S\n]+contributions?|competing[^\S\n]+interests?|conflicts?[^\S\n]+of[^\S\n]+interests?|declaration[^\S\n]+of[^\S\n]+(?:competing[^\S\n]+)?interests?|supplementary[^\S\n]+(?:materials?|information|data)|supporting[^\S\n]+information|appendix|appendices|about[^\S\n]+the[^\S\n]+authors?|author[^\S\n]+biograph(?:y|ies)|biograph(?:y|ies)|figure[^\S\n]+(?:legends?|captions?)|감사의[^\S\n]*글|사[^\S\n]*사|부[^\S\n]*록)(?![\p{L}\p{N}])[^\n]{0,60}$/iu;
export const ENTRY_MARKER = /^[^\S\n]*(?:\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3}[.)])[^\S\n]+\p{L}/u;
const LEAD_IN_LABEL = /^[^\S\n]*\p{L}[\p{L}’'-]*(?:[^\S\n]+[\p{L}’'-]+){0,4}[^\S\n]*[:：](?!\/\/)/u;
const TITLE_RUN = /(?<![\p{L}’'-])\p{L}[\p{Ll}\p{Lo}]+(?:[^\S\n]+[\p{L}][\p{L}’'-]*){3,}/u;
const CONTACT_IN = /(?<![\w.+-])[\w.+-]+@[\w-]+\.\s?[\w.]+/;
const IDENTIFIER_LINE = /^[^\S\n]*(?:e-?|p-?)?(?:ISBN|ISSN|DOI)\b/i;
const RIGHTS_IN_LINE = /©|ⓒ|\(c\)\s*(?:19|20)\d{2}|\bcopyright\b/i;
const LISTED_ENTRY = /^\s*\[\s*\d{1,3}\s*\]/;
const PERSON_FIRST = /^\s*(?:\p{Lu}[\p{L}'’-]+,[^\S\n]*(?:\p{Lu}\.[^\S\n-]*-?){1,3}|(?:\p{Lu}\.[^\S\n]*-?){1,3}[^\S\n]*\p{Lu}[\p{Ll}'’-]+|\p{Lu}[\p{L}'’-]+(?:[^\S\n]+\p{Lu}[\p{L}'’-]+)?[^\S\n]+et[^\S\n]+al\b)/u;
const OWN_STATEMENT_LABEL = /^[^\S\n]*(?:in|published[^\S\n]+in|appears?[^\S\n]+in|part[^\S\n]+of|수록|게재)[^\S\n]*[:：]/iu;
function leadInLabel(line: string): RegExpExecArray | null {
    const label = LEAD_IN_LABEL.exec(line);
    if (!label || SELF_CITATION.test(label[0]) || OWN_STATEMENT_LABEL.test(label[0]))
        return null;
    return label;
}
const SELF_CITATION = /\b(?:cite[^\S\n]+this|to[^\S\n]+cite|how[^\S\n]+to[^\S\n]+cite|please[^\S\n]+cite|cite[^\S\n]+as|citation|recommended[^\S\n]+citation)\b|인용[^\S\n]*(?:방법|정보|하기)/i;
const HEADING_LIKE = /^[^\S\n]*\p{Lu}[\p{Lu}\s&|:'’-]{2,60}$/u;
const FIELD_LABEL_LINE = /^[^\S\n]*\p{Lu}[\p{L}’'-]*(?:[^\S\n]+[\p{L}’'-]+){0,3}[^\S\n]*[:：](?:\s|$)/u;
const DATA_AVAILABILITY = /\b(?:data\s+(?:and\s+(?:materials?|code)\s+)?availability|availability\s+of\s+(?:data|materials)(?:\s+and\s+materials)?|data\s+accessibility|data\s+access|code\s+availability)(?:\s+statement)?\s*[:：.]/gi;
const FIGURE_CREDIT = /\b(?:reproduced|reprinted|adapted|redrawn)\s+(?:with\s+permission\s+)?from\b|©\s*(?:1[6-9]|20)\d{2}\s*,\s*\p{Lu}[\p{L}'’-]+,\s*(?:\p{Lu}\.\s*){1,3}(?:et\s+al\.?)?/giu;
const QUOTED_TITLE = /[“"「『《][^”"」』》]{8,}[”"」』》]/u;
const INITIALS_THEN_NAME = /(?:^|[\s,;(])\p{Lu}\.(?:[^\S\n]*-?\p{Lu}\.)*[^\S\n]*\p{Lu}[\p{Ll}'’-]+/u;
const NAME_THEN_INITIALS = /\p{Lu}[\p{Ll}'’-]+,[^\S\n]*(?:\p{Lu}\.[^\S\n-]*-?){1,3}/u;
function entryIsCitation(entry: string): boolean {
    const value = entry.replace(/(?:https?:\/\/\S+|\b10\.\d{4,9}\/\S+)/g, ' ');
    const identifier = /(?:https?:\/\/|\b10\.\d{4,9}\/|\bdoi\b)/i.test(entry);
    const year = /(?<!\d)(?:1[6-9]|20)\d{2}[a-z]?(?!\d)/.test(value);
    const person = /\bet\s+al\b/i.test(value) || INITIALS_THEN_NAME.test(value) || NAME_THEN_INITIALS.test(value) || QUOTED_TITLE.test(value);
    const source = identifier || /\(\s*(?:1[6-9]|20)\d{2}[a-z]?\s*\)/.test(value) || /\b\d{1,5}\s*[–—-]\s*\d{1,5}\b/.test(value)
        || /\b(?:vol|no|pp|issue)\.?\s*\d/i.test(value) || /\b\d{1,4}\s*[,:]\s*\d{1,6}\b/.test(value) || /\d+\s*[권호]/.test(value);
    return person && year && source;
}
interface PageLine {
    start: number;
    end: number;
    text: string;
}
function citationsInPage(page: string, out: Array<[
    number,
    number
]>, stopAt: (line: number) => boolean) {
    const lines: PageLine[] = [];
    let cursor = 0;
    for (const text of page.split('\n')) {
        lines.push({ start: cursor, end: cursor + text.length, text });
        cursor += text.length + 1;
    }
    const regions: Array<[
        number,
        number
    ]> = [];
    const inside = (at: number) => regions.some(([start, end]) => at >= start && at < end);
    for (let at = 0; at < lines.length; at++) {
        const line = lines[at].text;
        if (!line.trim() || inside(lines[at].start))
            continue;
        const numbered = ENTRY_MARKER.test(line) && !numberedSectionHeading(line, lines.slice(at + 1, at + 5).map(entry => entry.text));
        const label = numbered || stopAt(at) ? null : leadInLabel(line);
        if (!numbered && !label)
            continue;
        const labelled = !!label && !!line.slice((label.index ?? 0) + label[0].length).trim();
        const from = numbered || labelled ? at : at + 1;
        if (from >= lines.length || !lines[from].text.trim())
            continue;
        const judge = (entry: string) => entryIsCitation(entry)
            && (numbered || LISTED_ENTRY.test(entry) || (PERSON_FIRST.test(entry) && !CONTACT_IN.test(entry) && TITLE_RUN.test(entry.replace(/(?:https?:\/\/\S+|\b10\.\d{4,9}\/\S+)/g, ' '))));
        let to = from;
        let joined = labelled && label ? line.slice((label.index ?? 0) + label[0].length) : lines[from].text;
        while (to - from < 6 && !(/[.)\]”"」』][^\S\n]*$/.test(lines[to].text) && judge(joined))) {
            const next = lines[to + 1];
            if (!next || !next.text.trim() || ENTRY_MARKER.test(next.text) || HEADING_LIKE.test(next.text) || isReferenceListHeading(next.text)
                || stopAt(to + 1)
                || RIGHTS_IN_LINE.test(next.text)
                || (!numbered && (FIELD_LABEL_LINE.test(next.text) || SELF_CITATION.test(next.text) || !!leadInLabel(next.text) || IDENTIFIER_LINE.test(next.text))))
                break;
            to++;
            joined += ' ' + next.text;
        }
        if (!judge(joined))
            continue;
        regions.push([lines[at].start, lines[to].end]);
        at = to;
    }
    for (const match of page.matchAll(DATA_AVAILABILITY)) {
        const start = match.index ?? 0, from = start + match[0].length;
        const rest = page.slice(from, from + 400);
        const stop = /\n[^\S\n]*\n|\n(?=[^\S\n]*\p{Lu}[\p{Lu}\s&|:'’-]{2,60}(?:\n|$))|[.!?](?=\s+\p{Lu}\p{Ll}+(?:\s+\p{Ll}+){0,3}\s*[:：])/u.exec(rest);
        regions.push([start, from + (stop ? stop.index + (/^[.!?]/.test(stop[0]) ? 1 : 0) : rest.length)]);
    }
    for (const match of page.matchAll(FIGURE_CREDIT)) {
        const start = match.index ?? 0, from = start + match[0].length;
        const rest = page.slice(from, from + 240);
        const skip = /^\s*ref(?:erence)?s?\.?\s*\[?\d+\]?/i.exec(rest)?.[0].length ?? 0;
        const stop = /[.;](?=\s|$)|\n[^\S\n]*\n/.exec(rest.slice(skip));
        let end = from + skip + (stop ? stop.index + 1 : rest.length - skip);
        const holder = /^[^\S\n]*\n?[^\S\n]*(?:©|copyright\b)\s*(?:1[6-9]|20)\d{2}[^\n.]*\.?/i.exec(page.slice(end));
        if (holder)
            end += holder[0].length;
        if (!/\bref(?:erence)?s?\.?\s*\[?\d|\bet\s+al\b|\(\s*(?:1[6-9]|20)\d{2}\s*\)|10\.\d{4,9}\//i.test(page.slice(start, end)))
            continue;
        regions.push([start, end]);
    }
    for (const [start, end] of regions)
        out.push([start, end]);
}
export function citationSpansInPage(page: string, options: {
    stopAt: (line: number) => boolean;
}): Array<[
    number,
    number
]> {
    const out: Array<[
        number,
        number
    ]> = [];
    citationsInPage(String(page ?? ''), out, options.stopAt);
    return mergedRegions(out);
}
export function mergedRegions(regions: Array<[
    number,
    number
]>): Array<[
    number,
    number
]> {
    const sorted = regions.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged: Array<[
        number,
        number
    ]> = [];
    for (const [start, end] of sorted) {
        const last = merged[merged.length - 1];
        if (last && start <= last[1])
            last[1] = Math.max(last[1], end);
        else
            merged.push([start, end]);
    }
    return merged;
}
export function citationRegions(text: unknown): Array<[
    number,
    number
]> {
    return mergedRegions(regionSpansIn(text, ['references', 'citation']));
}
export function insideCitedEntry(text: unknown, at: number): boolean {
    return regionSpansIn(String(text ?? ''), ['citation']).some(([start, end]) => at >= start && at < end);
}
export function withoutRegions(text: unknown, regions: Array<[
    number,
    number
]>): string {
    let kept = String(text ?? '');
    for (const [start, end] of [...mergedRegions(regions)].sort((a, b) => b[0] - a[0]))
        kept = kept.slice(0, start) + '\n' + kept.slice(end);
    return kept;
}
export function withoutCitations(text: unknown): string {
    const value = String(text ?? '');
    return withoutRegions(value, citationRegions(value));
}
const CONTAINER_LABEL = /^[^\S\n]*(?:in|published[^\S\n]+in|appears?[^\S\n]+in|part[^\S\n]+of|수록|게재)[^\S\n]*[:：][^\n]*$/gim;
const CONTAINER_EDITED = /^[^\S\n]*In[^\S\n]+[^\n]{3,160}?,[^\S\n]*(?:[Ee]d(?:s|ited)?\.?(?:[^\S\n]+by)?|[Ee]ditors?)(?![\p{L}])[^\n]*$/gmu;
const CONTAINER_EDITED_FOOT = /^[^\S\n]*(?!In[^\S\n])\S[^\n]{2,160}?,[^\S\n]*edited[^\S\n]+by[^\S\n]+\S[^\n]{1,120}?,[^\S\n]*(?:pp?\.[^\S\n]*)?\d{1,5}(?:[^\S\n]*[-–—][^\S\n]*\d{1,5})?[^\S\n]*\.?[^\S\n]*$/gimu;
export function withoutContainerStatements(text: unknown): string {
    return String(text ?? '').replace(CONTAINER_LABEL, '').replace(CONTAINER_EDITED, '').replace(CONTAINER_EDITED_FOOT, '');
}
export function namesAsContainer(text: unknown, title: unknown): boolean {
    const page = String(text ?? '').normalize('NFKC');
    const wanted = String(title ?? '').normalize('NFKC').trim();
    if (wanted.length < 4 || !page.trim())
        return false;
    const statements = [...page.matchAll(CONTAINER_LABEL), ...page.matchAll(CONTAINER_EDITED), ...page.matchAll(CONTAINER_EDITED_FOOT)].map(match => match[0]);
    if (statements.some(line => titleSupportedByPDF(wanted, line) || searchable(line).includes(searchable(wanted))))
        return true;
    const at = page.toLowerCase().indexOf(wanted.toLowerCase());
    return at >= 0 && CONTAINED_IN.test(page.slice(Math.max(0, at - 24), at));
}
function rejoinWrappedDOI(source: string, at: number, value: string): string | null {
    const suffix = value.split('/').slice(1).join('/');
    if (/\d/.test(suffix))
        return null;
    const tail = source.slice(at, at + 60).match(/^[.\s]{1,3}([A-Za-z0-9][A-Za-z0-9._;()/:+-]{3,})/);
    if (!tail || !/\d/.test(tail[1]))
        return null;
    if (/^,\d/.test(source.slice(at + tail[0].length, at + tail[0].length + 2)))
        return null;
    return `${value.replace(/\.$/, '')}.${tail[1].replace(/[\s.,;:)}\]>]+$/, '')}`;
}
function rejoinSpacedDOI(source: string, at: number, value: string): string | null {
    if (/[./]$/.test(value))
        return null;
    const tail = /^[^\S\n]{1,2}([./][A-Za-z0-9][A-Za-z0-9._;()/:+-]{0,60}?)[.,;:]?(?=[\s)\]>]|$)/.exec(source.slice(at, at + 80));
    if (!tail || !/\d/.test(tail[1]))
        return null;
    return `${value}${tail[1]}`;
}
function chapterOfABookDOI(source: string, at: number, value: string): string | null {
    const suffix = value.split('/').slice(1).join('/');
    if (!/^97[89]-?(?:\d-?){9}\d$/.test(suffix))
        return null;
    const tail = /^[^\S\n]{1,2}(\d{1,3})(?=[^\S\n]*(?:[,;]|\.(?!\d)|$|\n))/.exec(source.slice(at, at + 12));
    return tail ? `${value}_${tail[1]}` : null;
}
export interface IdentifierInput {
    text: string;
    complete?: boolean;
}
export type IdentifierConfidence = 'exact' | 'repaired' | 'ambiguous';
export interface IdentifierRepair {
    kind: 'dash' | 'rejoin' | 'trailingPunctuation' | 'derived' | 'gluedTail';
    from: string;
    to: string;
    reason: string;
}
export interface IdentifierObservation {
    kind: PDFIdentifier['kind'];
    value: string;
    raw: string;
    confidence: IdentifierConfidence;
    repairs: IdentifierRepair[];
    boundary: 'interior' | 'tokenEnd' | 'documentEnd' | 'windowEnd';
    reason: string;
    at: number;
    cited?: boolean;
    occurrences?: Array<{
        at: number;
        raw: string;
        cited?: boolean;
    }>;
}
export interface IdentifierScan {
    observations: IdentifierObservation[];
    observed: number;
    listTruncated: boolean;
    inputComplete: boolean;
    otherWorks: IdentifierObservation[];
}
const DOI_SYNTAX = /^10\.\d{4,9}\/[A-Za-z0-9][A-Za-z0-9._;()/:+-]*(?:<\d{1,6}::aid-[a-z0-9-]{1,40}>\d{1,2}\.\d{1,2}\.co;\d-[\dx])?$/i;
const DOI_PLACEHOLDER = /(?:x0xx|00000x|xxxxx)/i;
const TRAILING_PUNCTUATION = /[\s.,;:)}\]>]+$/;
const GLUED_ADDRESS = /https?:\/\/|www\./i;
const GLUED_HOST = /(?<=\d)[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*\.(?:com|org|net|edu|gov|int|info|io)(?:\/[^\s]*)?$/i;
const GLUED_WORD = /(?<=\d)\p{Lu}\p{Ll}{2,}$/u;
const GLUED_PHRASE = /(?<=\d)\p{Ll}{1,4}(?:-?\p{Lu}\p{Ll}+){2,}$/u;
const GLUED_DIGIT_PROBE = /\(?0123456789/;
const GLUED_SUFFIX_LIMIT = 400;
export function withoutGluedTail(doi: string): string {
    const value = String(doi ?? '');
    const slash = value.indexOf('/');
    if (slash < 0)
        return value;
    const suffix = value.slice(slash + 1);
    if (suffix.length > GLUED_SUFFIX_LIMIT)
        return value;
    const cuts = [GLUED_ADDRESS.exec(suffix), GLUED_HOST.exec(suffix), GLUED_WORD.exec(suffix), GLUED_PHRASE.exec(suffix), GLUED_DIGIT_PROBE.exec(suffix)]
        .filter((match): match is RegExpExecArray => !!match && match.index > 0).map(match => match.index);
    if (!cuts.length)
        return value;
    const kept = suffix.slice(0, Math.min(...cuts)).replace(/[.,;:/_-]+$/, '');
    return kept && /\d/.test(kept) ? `${value.slice(0, slash + 1)}${kept}` : value;
}
const OCCURRENCE_LIMIT = 12;
export const IDENTIFIER_LIST_LIMIT = 8;
const DOI_ADDRESS_LABEL = String.raw `(?:(?:https?:\/\/(?:dx\.)?|\b(?:dx\.)?)doi\.org\/(?:[^\S\n\f]*\n)?[^\S\n\f]*|\bdoi\s*(?:[:：]\s*)?|\bdigital\s+object\s+identifier\s*(?:[:：]\s*)?)`;
export function scanIdentifiers(input: IdentifierInput): IdentifierScan {
    const base = String(input.text || '').normalize('NFKC').replace(/­/g, '');
    const repaired = base.replace(/[‐-―]/g, '-');
    const body = repaired;
    const printedBody = base;
    const observations: IdentifierObservation[] = [];
    const seen = new Set<string>();
    let citing = false;
    const citedObservations: IdentifierObservation[] = [];
    const alsoAt = (held: IdentifierObservation | undefined, entry: IdentifierObservation) => {
        if (!held || held.kind !== 'DOI')
            return;
        const places = held.occurrences || [{ at: held.at, raw: held.raw, ...(held.cited ? { cited: true } : {}) }];
        if (places.length >= OCCURRENCE_LIMIT || places.some(place => place.at === entry.at && place.raw === entry.raw))
            return;
        held.occurrences = [...places, { at: entry.at, raw: entry.raw, ...(citing ? { cited: true } : {}) }];
    };
    const keyOf = (entry: IdentifierObservation) => `${entry.kind}:${entry.value.toLowerCase()}`;
    const push = (entry: IdentifierObservation) => {
        const key = keyOf(entry);
        if (!entry.value)
            return;
        if (seen.has(key)) {
            alsoAt(observations.find(held => keyOf(held) === key), entry);
            return;
        }
        if (citing) {
            const held = citedObservations.find(other => keyOf(other) === key);
            if (held)
                alsoAt(held, entry);
            else
                citedObservations.push(entry);
            return;
        }
        seen.add(key);
        observations.push(entry);
    };
    const addDOI = (printed: string, at: number, extra: IdentifierRepair[], boundary: IdentifierObservation['boundary'], raw: string) => {
        const repairs = [...extra];
        let candidate = printed;
        const unglued = withoutGluedTail(candidate);
        if (unglued !== candidate) {
            repairs.push({ kind: 'gluedTail', from: candidate, to: unglued,
                reason: '글자층이 DOI 바로 뒤의 주소·낱말을 띄어쓰기 없이 이어 찍었습니다 — 붙은 부분을 뗀 값입니다.' });
            candidate = unglued;
        }
        if (TRAILING_PUNCTUATION.test(candidate)) {
            const trimmed = candidate.replace(TRAILING_PUNCTUATION, '');
            repairs.push({ kind: 'trailingPunctuation', from: candidate, to: trimmed,
                reason: 'DOI 자체가 구두점으로 끝날 수도 있으므로 잘라낸 것은 확정이 아닙니다.' });
            candidate = trimmed;
        }
        const value = printedDOI(candidate);
        if (!DOI_SYNTAX.test(value) || DOI_PLACEHOLDER.test(value))
            return;
        let confidence: IdentifierConfidence = repairs.length ? 'repaired' : 'exact';
        let reason = citing ? '다른 저작을 인용한 자리 안에 인쇄된 DOI입니다 — 그 저작의 번호이지 이 문서의 것이 아닙니다.'
            : repairs.length ? repairs[repairs.length - 1].reason : '문서가 인쇄한 그대로입니다.';
        if (boundary === 'windowEnd') {
            confidence = 'ambiguous';
            reason = '건네받은 본문 조각의 끝에서 끝나 DOI가 잘렸는지 알 수 없습니다.';
        }
        else {
            const suffix = value.split('/').slice(1).join('/');
            if (suffix.length <= 4 && !/\d/.test(suffix)) {
                confidence = 'ambiguous';
                reason = '접미사가 짧고 숫자가 없어 줄바꿈으로 끊긴 조각일 수 있습니다.';
            }
        }
        push({ kind: 'DOI', value, raw, confidence, repairs, boundary, reason, at, ...(citing ? { cited: true } : {}) });
    };
    const lineAt = (at: number) => {
        const start = Math.max(body.lastIndexOf('\n', at), body.lastIndexOf('\f', at)) + 1;
        const ends = [body.indexOf('\n', at), body.indexOf('\f', at)].filter(end => end >= 0);
        return { start, line: body.slice(start, ends.length ? Math.min(...ends) : body.length) };
    };
    const references = regionSpansIn(body, ['references']);
    const cited = citationRegions(body);
    const listedAt = (at: number) => references.some(([start, end]) => at >= start && at < end);
    const citedAt = (at: number) => cited.some(([start, end]) => at >= start && at < end);
    for (const match of body.matchAll(new RegExp(String.raw `${DOI_ADDRESS_LABEL}(10\.\d{4,9}\/[A-Za-z0-9][A-Za-z0-9._;()/:+-]*)`, 'gi'))) {
        const at = match.index ?? 0;
        if (attributedToAnotherWork(body.slice(Math.max(0, at - 60), at)))
            continue;
        const start = at + match[0].length - match[1].length;
        const sici = SICI_TAIL.exec(body.slice(at + match[0].length, at + match[0].length + 80));
        const printed = sici ? `${match[1]}${sici[0]}` : match[1];
        citing = citedAt(start);
        const asPrinted = printedBody.slice(start, start + printed.length);
        const repairs: IdentifierRepair[] = [];
        if (asPrinted !== printed) {
            repairs.push({ kind: 'dash', from: asPrinted, to: printed,
                reason: '출판사가 DOI 안의 하이픈을 엔대시로 조판했습니다 — DOI는 ASCII이므로 하이픈으로 되돌린 후보입니다.' });
        }
        const endsInput = start + printed.length >= body.length;
        const boundary: IdentifierObservation['boundary'] = endsInput
            ? (input.complete ? 'documentEnd' : 'windowEnd')
            : 'tokenEnd';
        addDOI(printed, at, repairs, boundary, asPrinted);
        const rejoined = rejoinWrappedDOI(body, at + match[0].length, printed);
        if (rejoined) {
            addDOI(rejoined, at, [...repairs, { kind: 'rejoin', from: printed, to: rejoined,
                    reason: '두 단 조판에서 DOI가 줄을 넘어가며 끊긴 것으로 보고 이어 붙인 후보입니다.' }], endsInput && !input.complete ? 'windowEnd' : 'tokenEnd', asPrinted);
        }
        const spaced = rejoined ? null : rejoinSpacedDOI(body, at + match[0].length, printed);
        if (spaced) {
            addDOI(spaced, at, [...repairs, { kind: 'rejoin', from: printed, to: spaced,
                    reason: '글자층이 DOI 한가운데에 넣은 빈칸(뒤 마디가 마침표·빗금으로 연다)을 빼고 이은 후보입니다. 레지스트리나 판독이 확인해야 섭니다.' }], 'tokenEnd', asPrinted);
        }
        const chapter = chapterOfABookDOI(body, at + match[0].length, printed);
        if (chapter) {
            addDOI(chapter, at, [...repairs, { kind: 'rejoin', from: printed, to: chapter,
                    reason: '책의 DOI(ISBN) 바로 뒤에 띄어 찍힌 수는 장의 번호입니다 — 글자층이 장 DOI의 밑줄(「_」)을 잃은 것으로 보고 이은 후보입니다. 레지스트리가 확인해야 섭니다.' }], endsInput && !input.complete ? 'windowEnd' : 'tokenEnd', asPrinted);
        }
        citing = false;
    }
    for (const match of body.matchAll(new RegExp(String.raw `${DOI_ADDRESS_LABEL}(10\.\d{4,9}\/)[^\S\n\f]*\n[^\S\n\f]*([A-Za-z0-9][A-Za-z0-9._;()/:+-]*)`, 'gi'))) {
        const at = match.index ?? 0;
        if (attributedToAnotherWork(body.slice(Math.max(0, at - 60), at)))
            continue;
        const start = at + match[0].indexOf(match[1]);
        const end = at + match[0].length;
        citing = citedAt(start);
        const joined = `${match[1]}${match[2]}`;
        addDOI(joined, at, [{ kind: 'rejoin', from: match[1], to: joined,
                reason: 'DOI가 접두의 빗금 뒤에서 줄을 넘어갔습니다 — 접미가 빈 DOI는 없으므로 다음 줄의 첫 덩이를 접미로 이은 후보입니다.' }], end >= body.length ? (input.complete ? 'documentEnd' : 'windowEnd') : 'tokenEnd', printedBody.slice(start, end));
        citing = false;
    }
    for (const match of body.matchAll(/\/doi\/(?:(?:abs|full|pdf|epdf|pdfdirect|pdfplus|reader|book|chapter)\/)?(10\.\d{4,9}\/[A-Za-z0-9][A-Za-z0-9._;()+:-]*)/gi)) {
        const printed = match[1];
        const start = (match.index ?? 0) + match[0].length - printed.length;
        citing = citedAt(start);
        const asPrinted = printedBody.slice(start, start + printed.length);
        const endsInput = start + printed.length >= body.length;
        addDOI(printed, start, asPrinted === printed ? [] : [{ kind: 'dash', from: asPrinted, to: printed,
                reason: '출판사가 DOI 안의 하이픈을 엔대시로 조판했습니다 — DOI는 ASCII이므로 하이픈으로 되돌린 후보입니다.' }], endsInput ? (input.complete ? 'documentEnd' : 'windowEnd') : 'tokenEnd', asPrinted);
        citing = false;
    }
    for (const match of body.matchAll(/^[^\S\n]*(10\.\d{4,9}\/[A-Za-z0-9][A-Za-z0-9._;()/:+-]*[A-Za-z0-9])[^\S\n]*$/gm)) {
        const printed = match[1];
        const lineStart = match.index ?? 0;
        const start = lineStart + match[0].indexOf(printed);
        if (attributedToAnotherWork(body.slice(Math.max(0, start - 60), start)))
            continue;
        const previous = lineStart > 0 ? body.slice(body.lastIndexOf('\n', lineStart - 2) + 1, lineStart - 1) : '';
        if (DOI_LABEL.test(previous.slice(-24)))
            continue;
        citing = citedAt(start);
        const asPrinted = printedBody.slice(start, start + printed.length);
        const repairs: IdentifierRepair[] = asPrinted === printed ? [] : [{ kind: 'dash', from: asPrinted, to: printed,
                reason: '출판사가 DOI 안의 하이픈을 엔대시로 조판했습니다 — DOI는 ASCII이므로 하이픈으로 되돌린 후보입니다.' }];
        const endsInput = start + printed.length >= body.length;
        addDOI(printed, start, repairs, endsInput ? (input.complete ? 'documentEnd' : 'windowEnd') : 'tokenEnd', asPrinted);
        citing = false;
    }
    for (const match of body.matchAll(/\bSci\.?\s*Adv\.?\s*\d+\s*,\s*e([a-z0-9]{5,})\s*\((?:19|20)\d{2}\)/gi)) {
        const at = match.index ?? 0;
        const { start, line } = lineAt(at);
        const before = body.slice(start, at).replace(/\bet\s+al\.?\s*,?\s*$/i, '');
        if (/^\s*(?:\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3}[.)])\s+\p{L}/u.test(line) || /\p{L}{2,}\.\s*$/u.test(before) || citedAt(at))
            continue;
        const value = `10.1126/sciadv.${match[1]}`;
        push({ kind: 'DOI', value, raw: match[0], confidence: 'repaired', boundary: 'interior', at,
            repairs: [{ kind: 'derived', from: match[0], to: value,
                    reason: 'Science Advances는 DOI 대신 머리말의 논문 코드를 인쇄하며, DOI는 그 코드에서 앞의 e를 뺀 형태입니다.' }],
            reason: '머리말의 논문 코드에서 구성한 DOI입니다 — 문서가 인쇄한 DOI가 아닙니다.' });
    }
    for (const match of body.matchAll(/\b10\.1016\/B((?:97[89][\s-]*)?\d[\d\s-]{8,20}[\dX])\.\d+/gi)) {
        const at = match.index ?? 0;
        if (citedAt(at))
            continue;
        const value = cleanISBN(match[1]);
        if (!ISBN_SHAPE.test(value))
            continue;
        push({ kind: 'ISBN', value, raw: match[0], confidence: 'repaired', boundary: 'interior', at,
            repairs: [{ kind: 'derived', from: match[0], to: value, reason: 'Elsevier 장 DOI에 포함된 모체 도서의 ISBN입니다.' }],
            reason: '장 DOI에서 꺼낸 모체 도서 ISBN입니다 — 이 문서 자신의 식별자가 아닐 수 있습니다.' });
    }
    const listed = otherWorksISBNRegions(body);
    const otherWorks: IdentifierObservation[] = [];
    for (const match of body.matchAll(ISBN_LABELLED)) {
        const value = isbnFromPrinted(match[1]);
        if (!value)
            continue;
        const at = match.index ?? 0;
        const entry: IdentifierObservation = { kind: 'ISBN', value, raw: match[1], confidence: 'exact', boundary: 'tokenEnd', at,
            repairs: [], reason: '문서가 ISBN으로 표시한 값입니다.' };
        if (listed.some(([start, end]) => at >= start && at < end)) {
            otherWorks.push({ ...entry, reason: '다른 저작의 목록 안에 인쇄된 ISBN입니다 — 이 문서의 것이 아닙니다.' });
            continue;
        }
        if (listedAt(at)) {
            otherWorks.push({ ...entry, reason: '참고문헌 목록 안에 인쇄된 ISBN입니다 — 인용한 책의 번호이지 이 문서의 것이 아닙니다.' });
            continue;
        }
        push(entry);
    }
    const own = observations.slice(0, IDENTIFIER_LIST_LIMIT);
    const citedKept = citedObservations.filter(entry => !seen.has(`${entry.kind}:${entry.value.toLowerCase()}`));
    return {
        observations: [...own, ...citedKept.slice(0, Math.max(0, IDENTIFIER_LIST_LIMIT - own.length))],
        observed: observations.length,
        listTruncated: observations.length > IDENTIFIER_LIST_LIMIT,
        inputComplete: !!input.complete,
        otherWorks
    };
}
export function extractIdentifierObservations(input: IdentifierInput): IdentifierObservation[] {
    return scanIdentifiers(input).observations;
}
const LOOKUP_LIMIT = 4;
export function extractPDFIdentifiers(text: string | IdentifierInput): PDFIdentifier[] {
    return lookupCandidates(text).slice(0, LOOKUP_LIMIT);
}
function lookupCandidates(text: string | IdentifierInput): PDFIdentifier[] {
    const input: IdentifierInput = typeof text === 'string' ? { text } : text;
    return scanIdentifiers(input).observations
        .filter(entry => entry.confidence !== 'ambiguous' && !entry.cited)
        .map(entry => ({ kind: entry.kind, value: entry.kind === 'DOI' ? entry.value.toLowerCase() : entry.value }));
}
export interface DOIStanding {
    value: string;
    page: number;
    own: boolean;
    why: 'masthead' | 'ownEntry' | 'otherEntry' | 'prose' | 'cited' | 'platform';
    titlePage: boolean;
}
const scriptOfText = (value: string) => /[가-힣]/.test(value) ? 'hangul' : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value) ? 'cjk' : 'latin';
function withinEdits(a: string, b: string, limit: number): boolean {
    if (a === b)
        return true;
    const x = [...a], y = [...b];
    if (Math.abs(x.length - y.length) > limit)
        return false;
    const beyond = limit + 1;
    let previous = Array.from({ length: y.length + 1 }, (_, at) => at <= limit ? at : beyond);
    for (let i = 1; i <= x.length; i++) {
        const row = new Array<number>(y.length + 1).fill(beyond);
        row[0] = i <= limit ? i : beyond;
        let best = row[0];
        for (let j = Math.max(1, i - limit); j <= Math.min(y.length, i + limit); j++) {
            row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
            if (row[j] < best)
                best = row[j];
        }
        if (best > limit)
            return false;
        previous = row;
    }
    return previous[y.length] <= limit;
}
const TITLE_LINE_LIMIT = 600;
export function printsTitleAsALine(text: string, title: unknown): boolean {
    const target = foldedLetters(title);
    if (target.length < 6 || target.length > TITLE_LINE_LIMIT)
        return false;
    const lines = linesOf(text).map(line => foldedLetters(line));
    const slack = Math.max(1, Math.floor(target.length / 20));
    for (let at = 0; at < lines.length; at++) {
        if (!lines[at])
            continue;
        let joined = '';
        for (let end = at; end < lines.length && end - at < 6; end++) {
            joined += lines[end];
            if (joined.length > target.length + slack)
                break;
            if (joined.length >= target.length - slack && withinEdits(joined, target, slack))
                return true;
        }
    }
    return false;
}
export function sentenceShapedLine(line: string): boolean {
    const value = line.replace(/\s+/g, ' ').trim();
    if (/[가-힣](?:다|요|음|함|임)[.。](?=\s|$|["”’)])/u.test(value))
        return true;
    if (value.length < 50 || value.split(' ').length < 7)
        return false;
    return /\p{Ll}{2}[.!?]["”’)]?$/u.test(value) || /\p{Ll}{2}[.!?] \p{Lu}\p{Ll}/u.test(value);
}
const DOI_LEAD = /(?:https?:\/\/(?:dx\.)?doi\.org\/|\bdoi[^\S\n]*[:：]?[^\S\n]*|\bdigital[^\S\n]+object[^\S\n]+identifier[^\S\n]*[:：]?[^\S\n]*)$/i;
const KOREAN_LEAD_PARTICLE = /^[가-힣]+(?:은|는|을|를|에서|에게|으로)$/;
const KOREAN_TRAILING_PARTICLE = /^(?:에서|에게|으로|에|을|를|은|는|로)(?=\s|$|[.,])/;
const SELF_CITATION_LEAD = /(?:\bcite[^\S\n]+(?:this[^\S\n]+\p{L}+[^\S\n]+)?as|\bcited[^\S\n]+as|\bcite[^\S\n]+this|\bplease[^\S\n]+cite\b[^\n]{0,150}|\bto[^\S\n]+cite[^\S\n]+this\b[^\n]{0,150}|\bhow[^\S\n]+to[^\S\n]+cite\b[^\n]{0,150})[^\S\n]*[:：]?[^\S\n]*$/iu;
function sentenceRunsInto(lead: string): boolean {
    const last = lead.replace(/[\s(\[]+$/u, '').split(/\s+/).pop() || '';
    return /^[(\[]?\p{Ll}{2,}$/u.test(last) || KOREAN_LEAD_PARTICLE.test(last);
}
function sentenceRunsOn(after: string): boolean {
    const rest = after.replace(/^[)\]}]*[,;]?/u, '');
    if (KOREAN_TRAILING_PARTICLE.test(rest.trimStart()))
        return true;
    if (!/^\s/.test(rest))
        return false;
    const words = rest.trim().split(/\s+/).slice(0, 3);
    if (words.some(word => /[:：]$/.test(word)))
        return false;
    return /^\p{Ll}{2,}[,;.]?$/u.test(words[0] || '');
}
const TYPE_AND_DATE_LINE = /^\p{Lu}[\p{L}'’&-]*(?:\s+[\p{L}\p{N}'’&:,.()-]+){0,14}\s·\s*(?:\p{L}{3,9}\.?\s+)?(?:\d{1,2},?\s+)?(?:1[5-9]|20)\d{2}(?!\d)/u;
const PAGES_LINE = /^\s*(?:pages?|pp\.?)\s*\d/i;
const ET_AL = /\bet\s+al\b/i;
const ENTRY_LINE_LIMIT = 300;
function entrySignal(line: string): boolean {
    if (line.length > ENTRY_LINE_LIMIT)
        return false;
    return ET_AL.test(line) || TYPE_AND_DATE_LINE.test(line) || PAGES_LINE.test(line) || rowIsNameList(line) || isCitationAuthorList(line);
}
function citedEntrySignal(line: string): boolean {
    if (line.length > ENTRY_LINE_LIMIT)
        return false;
    return ET_AL.test(line) || TYPE_AND_DATE_LINE.test(line) || PAGES_LINE.test(line) || isCitationAuthorList(line);
}
function titleLinesEnd(lines: string[], title: unknown): number {
    const target = foldedLetters(title);
    if (target.length < 6 || target.length > TITLE_LINE_LIMIT)
        return -1;
    const folded = lines.map(line => line.length <= ENTRY_LINE_LIMIT * 4 ? foldedLetters(line) : '');
    const slack = Math.max(1, Math.floor(target.length / 20));
    for (let at = 0; at < folded.length; at++) {
        if (!folded[at])
            continue;
        let joined = '';
        for (let end = at, taken = 0; end < folded.length && taken < 6; end++) {
            if (!folded[end])
                continue;
            taken++;
            joined += folded[end];
            if (joined.length > target.length + slack)
                break;
            if (joined.length >= target.length - slack && withinEdits(joined, target, slack))
                return end;
        }
    }
    return -1;
}
const LABEL_LINE = /^\p{Lu}[\p{L}’'-]*(?: [\p{L}’'-]+){0,3} ?[:：]/u;
function endsAnEntry(line: string): boolean {
    return !line || line.length > ENTRY_LINE_LIMIT || /\b10\.\d{4,9}\/|https?:\/\/|www\./i.test(line) || LABEL_LINE.test(line)
        || (shouting(line) && line.length <= 80) || sentenceShapedLine(line) || looksLikeBodyProse(line);
}
const OPENS_WITH_A_DATE = /^(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2},?\s+(?:1[5-9]|20)\d{2}|\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(?:1[5-9]|20)\d{2})(?!\d)/i;
function namesAWorkTitle(line: string): boolean {
    if (!line || line.length > ENTRY_LINE_LIMIT || /https?:|www\.|@|\b10\.\d{4,9}\//i.test(line) || /^[^\p{L}]*\p{Ll}/u.test(line) || OPENS_WITH_A_DATE.test(line))
        return false;
    if (shouting(line) || entrySignal(line) || serialNameShaped(line) || isNotATitle(line))
        return false;
    const words = line.split(' ').filter(word => /\p{L}{2}/u.test(word)).length;
    const glyphs = (line.match(/[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
    return words >= 3 || glyphs >= 5;
}
function doiStandingsOnAPage(page: {
    page: number;
    text: string;
    complete?: boolean;
}, readTitle: string, titlePage: boolean, wrapper: Array<[
    number,
    number
]> | null = null): DOIStanding[] {
    const base = String(page.text || '').normalize('NFKC').replace(/­/g, '');
    const lines = base.split('\n');
    const starts: number[] = [];
    let cursor = 0;
    for (const line of lines) {
        starts.push(cursor);
        cursor += line.length + 1;
    }
    const lineOf = (offset: number) => {
        let low = 0, high = starts.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >> 1;
            if (starts[middle] <= offset)
                low = middle;
            else
                high = middle - 1;
        }
        return low;
    };
    const collapsed = (line: string | undefined) => String(line ?? '').replace(/\s+/g, ' ').trim();
    const target = foldedLetters(readTitle);
    const script = scriptOfText(readTitle);
    let headings: Map<string, number[]> | null = null;
    const nameElsewhere = (lead: string, index: number) => {
        const key = foldedLetters(lead);
        if (key.length < 8)
            return false;
        if (!headings) {
            const held = new Map<string, number[]>();
            for (const [at, line] of lines.entries()) {
                if (line.length > ENTRY_LINE_LIMIT)
                    continue;
                for (const cell of line.split('|')) {
                    const text = collapsed(cell);
                    if (!/^\p{Lu}/u.test(text) || sentenceShapedLine(text))
                        continue;
                    const folded = foldedLetters(text);
                    const seats = held.get(folded);
                    if (!seats)
                        held.set(folded, [at]);
                    else if (seats.length < 2)
                        seats.push(at);
                }
            }
            headings = held;
        }
        return (headings.get(key) || []).some(at => at !== index);
    };
    const standing = (entry: {
        value: string;
        raw?: string;
        at?: number;
        cited?: boolean;
    }): DOIStanding['why'] | 'entry' | 'weakEntry' => {
        if (entry.cited)
            return 'cited';
        const raw = String(entry.raw || entry.value);
        const from = Math.max(0, Number(entry.at) || 0);
        let start = base.indexOf(raw, from), length = raw.length;
        if (start < 0) {
            start = base.indexOf(entry.value, from);
            length = entry.value.length;
        }
        if (start < 0)
            return 'masthead';
        const index = lineOf(start);
        const line = lines[index], column = start - starts[index];
        const before = line.slice(0, column), after = line.slice(column + length);
        const label = DOI_LEAD.exec(before.slice(-80));
        const lead = collapsed(label ? before.slice(0, before.length - label[0].length) : before);
        const askedToCite = SELF_CITATION_LEAD.test(`${collapsed(lines[index - 1])} ${lead}`.slice(-200));
        const previous = collapsed(lines[index - 1]).split(' ');
        const flowsIn = previous.length >= 4 && /^\p{Ll}{2,}$/u.test(previous[previous.length - 1]);
        const opensWithLabel = !!label && !lead && !flowsIn;
        if (!askedToCite && ((lead && sentenceRunsInto(lead) && !nameElsewhere(lead, index)) || (!opensWithLabel && sentenceRunsOn(after))))
            return 'prose';
        const alone = !/[\p{L}\p{N}]/u.test(lead) && !/[\p{L}\p{N}]/u.test(after);
        if (!askedToCite && alone && previous.length >= 4 && /^\p{Ll}{2,}$/u.test(previous[previous.length - 1]) && (/[.;]$/.test(raw) || /^\s*[.,;]/.test(after)))
            return 'prose';
        const block: string[] = [];
        for (let at = index - 1; at >= 0 && block.length < 5; at--) {
            const above = collapsed(lines[at]);
            if (endsAnEntry(above))
                break;
            block.unshift(above);
        }
        if (/\p{L}/u.test(lead))
            block.push(lead);
        if (!block.length)
            return 'masthead';
        const joined = block.join('\n');
        if (target && (printsTitleAsALine(joined, readTitle) || (target.length >= 12 && foldedLetters(joined).includes(target))))
            return 'ownEntry';
        if (!block.some(entrySignal))
            return 'masthead';
        if (!target)
            return block.some(namesAWorkTitle) ? 'entry' : 'masthead';
        const titled = block.some((entryLine, at) => namesAWorkTitle(entryLine) && scriptOfText(entryLine) === script
            && (at >= block.length - 2 || block.slice(Math.max(0, at - 2), at + 3).some((near, offset) => offset !== Math.min(at, 2) && entrySignal(near))));
        if (!titled)
            return 'masthead';
        const affiliation = block.some(entryLine => !entrySignal(entryLine) && isNotATitle(entryLine));
        return label && !lead && affiliation && !block.some(citedEntrySignal) ? 'weakEntry' : 'otherEntry';
    };
    let titleEnd: number | null = null;
    const underOwnTitle = (entry: {
        value: string;
        raw?: string;
        at?: number;
    }) => {
        titleEnd ??= titleLinesEnd(lines, readTitle);
        if (titleEnd < 0)
            return false;
        const raw = String(entry.raw || entry.value);
        const start = base.indexOf(raw, Math.max(0, Number(entry.at) || 0));
        const at = start >= 0 ? lineOf(start) : -1;
        if (at <= titleEnd || at - titleEnd > 40)
            return false;
        const value = entry.value.toLowerCase();
        const inWrapper = (index: number) => !!wrapper && wrapper.some(([first, last]) => index >= first && index <= last);
        const anotherTitle = (index: number, line: string) => {
            if (!namesAWorkTitle(line) || scriptOfText(line) !== script || target.includes(foldedLetters(line)))
                return false;
            for (let next = index + 1, seen = 0; next < Math.min(lines.length, index + 6) && seen < 2; next++) {
                const below = collapsed(lines[next]);
                if (!below)
                    continue;
                seen++;
                if (entrySignal(below))
                    return true;
            }
            return false;
        };
        for (let index = titleEnd + 1; index < at; index++) {
            const line = collapsed(lines[index]);
            if (!line || inWrapper(index))
                continue;
            if (/\b10\.\d{4,9}\//.test(line) && !line.toLowerCase().includes(value))
                return false;
            if (anotherTitle(index, line))
                return false;
        }
        return true;
    };
    const inSelfCitation = (entry: {
        value: string;
        raw?: string;
        at?: number;
    }) => {
        if (!wrapper)
            return false;
        const raw = String(entry.raw || entry.value);
        const start = base.indexOf(raw, Math.max(0, Number(entry.at) || 0));
        const at = start >= 0 ? lineOf(start) : -1;
        return at >= 0 && wrapper.some(([first, last]) => at >= first && at <= last);
    };
    const found = scanIdentifiers({ text: page.text, complete: page.complete !== false }).observations
        .filter(entry => entry.kind === 'DOI' && entry.confidence !== 'ambiguous').map(entry => {
        const places = entry.occurrences?.length ? entry.occurrences.map(place => ({ value: entry.value, raw: place.raw, at: place.at, cited: place.cited })) : [entry];
        const whys = places.map(place => {
            const why = standing(place);
            if (!wrapper || !target || why === 'ownEntry' || why === 'cited' || inSelfCitation(place))
                return why;
            if (!underOwnTitle(place))
                return 'otherEntry' as const;
            return why === 'otherEntry' || why === 'weakEntry' ? 'masthead' as const : why;
        });
        const why = whys.find(seat => seat === 'masthead' || seat === 'ownEntry') || whys.find(seat => seat !== 'cited') || whys[0];
        return { value: entry.value, why, guessed: !!entry.repairs?.some(repair => repair.kind === 'rejoin') };
    });
    const listed = new Set(found.filter(entry => entry.why === 'entry').map(entry => entry.value.toLowerCase()));
    const printed = new Set(found.filter(entry => entry.why !== 'cited' && entry.why !== 'prose' && !entry.guessed).map(entry => entry.value.toLowerCase()));
    return found.map(({ value, why }) => {
        const settled: DOIStanding['why'] = why === 'entry' ? (listed.size >= 2 ? 'otherEntry' : 'masthead')
            : why === 'weakEntry' ? (printed.size >= 2 ? 'otherEntry' : 'masthead') : why;
        return { value, page: page.page, own: settled === 'masthead' || settled === 'ownEntry', why: settled, titlePage };
    });
}
export function doiStandingsOf(pages: Array<{
    page: number;
    text: string;
    complete?: boolean;
}>, readTitle?: unknown): DOIStanding[] {
    const marked = String(readTitle ?? '').replace(/<\/?(?:sub|sup|i|b|em|strong|scp|sc|span|u|tt)\b[^<>\n]{0,40}>/gi, '').replace(/\s+/g, ' ').trim();
    const title = /^\p{Ll}{4,}(?:\s|$)/u.test(marked) ? '' : marked;
    const ordered = [...pages].filter(page => String(page.text || '').trim()).sort((a, b) => a.page - b.page);
    const structure = ordered.length > 1 ? readPageStructure({ pages: ordered.map(page => ({ page: page.page, layer: { text: String(page.text) } })) }) : null;
    const leaves = structure ? leafPages(structure) : new Set<number>();
    const titlePage = title ? ordered.find(page => !leaves.has(page.page) && printsTitleAsALine(page.text, title))?.page : undefined;
    const standings = ordered.flatMap(page => doiStandingsOnAPage(page, title, page.page === titlePage, structure && leaves.has(page.page)
        ? regionsOf(structure, page.page, ['selfCitation']).filter(region => region.basis === 'text').map(region => region.rows) : null));
    const firstOfTheWork = titlePage ?? (ordered.length && leaves.has(ordered[0].page) ? ordered.find(page => !leaves.has(page.page))?.page : undefined);
    if (firstOfTheWork === undefined)
        return standings;
    const workOwn = standings.filter(entry => entry.page === firstOfTheWork && entry.own);
    if (!workOwn.length)
        return standings;
    return standings.map(entry => entry.own && entry.page < firstOfTheWork && (leaves.has(entry.page) || entry.why === 'ownEntry')
        && !workOwn.some(own => sameDOI(own.value, entry.value)) ? { ...entry, own: false, why: 'platform' as const } : entry);
}
export function ownDOIsInOrder(standings: DOIStanding[]): string[] {
    const own = standings.filter(entry => entry.own);
    const found: string[] = [];
    for (const entry of [...own.filter(entry => entry.titlePage), ...own.filter(entry => !entry.titlePage)]) {
        if (!found.some(doi => sameDOI(doi, entry.value)))
            found.push(entry.value);
    }
    return found;
}
function doisToAsk(candidates: string[], pages: string[], readTitle: unknown, complete: boolean): {
    asked: string[];
    refused: Array<{
        value: string;
        reason: string;
    }>;
} {
    if (!candidates.length)
        return { asked: [], refused: [] };
    const numbered = pages.map((text, index) => ({ page: index + 1, text, complete: complete || index < pages.length - 1 }));
    const standings = doiStandingsOf(numbered, readTitle);
    const own = ownDOIsInOrder(standings).map(doi => candidates.find(value => sameDOI(value, doi))).filter((value): value is string => !!value);
    const refused: Array<{
        value: string;
        reason: string;
    }> = [];
    const rest: string[] = [];
    for (const value of candidates) {
        if (own.includes(value))
            continue;
        const other = standings.find(entry => sameDOI(entry.value, value) && (entry.why === 'otherEntry' || entry.why === 'prose' || entry.why === 'platform'));
        if (!other) {
            rest.push(value);
            continue;
        }
        refused.push({ value, reason: other.why === 'otherEntry'
                ? `${other.page}번째 쪽에서 다른 제목을 찍은 서지 항목(겉장의 관련 논문·표지 논문·목차의 항목) 안에만 인쇄된 DOI입니다 — 그 저작의 번호라 묻지 않았습니다`
                : other.why === 'platform'
                    ? `${other.page}번째 쪽(겉장)이 붙인 DOI입니다 — 저작 자신의 첫 쪽은 다른 DOI를 이 문서의 것으로 찍었습니다. 겉장을 만든 곳이 붙인 표시라 묻지 않았습니다`
                    : `${other.page}번째 쪽의 문장 안에서 다른 저작·자료를 가리키는 DOI입니다 — 이 문서의 번호가 아니라 묻지 않았습니다` });
    }
    return { asked: [...own, ...rest], refused };
}
function pageText(page: any): string {
    const pieces: Array<{
        x: number;
        y: number;
        text: string;
    }> = [];
    const loose: string[] = [];
    const visit = (value: any) => {
        if (!Array.isArray(value)) {
            if (typeof value === 'string')
                loose.push(value);
            return;
        }
        const text = value[value.length - 1];
        if (typeof text === 'string' && typeof value[0] === 'number' && typeof value[1] === 'number') {
            pieces.push({ x: value[0], y: value[1], text });
            return;
        }
        value.forEach(visit);
    };
    visit(page?.[2]);
    const rows = new Map<number, Array<{
        x: number;
        text: string;
    }>>();
    for (const piece of pieces) {
        const key = Math.round(piece.y);
        rows.set(key, [...(rows.get(key) || []), { x: piece.x, text: piece.text }]);
    }
    const lines = [...rows.entries()].sort((a, b) => a[0] - b[0])
        .map(([, row]) => row.sort((a, b) => a.x - b.x).map(entry => entry.text).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
    return [...lines, ...loose.map(value => value.replace(/\s+/g, ' ').trim()).filter(Boolean)].join('\n');
}
export function withoutDecoyLeaves(pages: string[]): string[] {
    if (pages.length < 2)
        return pages.map(page => withoutOtherWorksIn(page));
    const structure = readPageStructure({ pages: pages.map((text, index) => ({ page: index + 1, layer: { text } })) });
    const leaves = leafPages(structure);
    return pages.map((text, index) => {
        if (!leaves.has(index + 1))
            return withoutRegions(text, regionsOf(structure, index + 1, ['otherWorks']).flatMap(region => region.span ? [region.span] : []));
        return regionsOf(structure, index + 1, ['selfCitation']).map(region => region.span ? text.slice(region.span[0], region.span[1]) : '').filter(Boolean).join('\n');
    });
}
export function bibliographicFrontMatter(data: any, pageLimit = 5): string {
    const pages = (data?.pages || []).slice(0, pageLimit).map(pageText);
    if (!pages.length)
        return '';
    return withoutDecoyLeaves(pages).join(' ').slice(0, 50000);
}
export function containerMismatch(itemType: unknown, frontMatter: string): boolean {
    const container = ['book', 'bookSection', 'conferencePaper', 'report'].includes(String(itemType || ''));
    return container && looksLikeJournalArticle(frontMatter);
}
export function titleSupportedByPDF(title: unknown, frontMatter: string): boolean {
    const candidate = searchable(title), evidence = searchable(frontMatter);
    const floor = /[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(String(title || '')) ? 3 : 12;
    if (candidate.length < floor || evidence.length < candidate.length)
        return false;
    if (evidence.includes(candidate))
        return true;
    const words = nfkc(title).toLowerCase().replace(/<\/?(?:sub|sup|i|b)>/gi, ' ')
        .match(/[\p{L}\p{N}]{3,}/gu) || [];
    const distinctive = [...new Set(words)].filter(word => !/^(?:the|and|for|with|from|this|that|study|review)$/.test(word));
    if (distinctive.length < 5)
        return false;
    const needed = Math.ceil(distinctive.length * 0.85);
    const span = Math.max(candidate.length * 2, candidate.length + 80);
    const hits: Array<{
        start: number;
        end: number;
        word: number;
    }> = [];
    distinctive.forEach((word, index) => {
        const key = searchable(word);
        if (!key)
            return;
        for (let at = evidence.indexOf(key), count = 0; at >= 0 && count < 200; at = evidence.indexOf(key, at + 1), count++) {
            hits.push({ start: at, end: at + key.length, word: index });
        }
    });
    hits.sort((a, b) => a.start - b.start);
    const inWindow = new Map<number, number>();
    for (let left = 0, right = 0; left < hits.length; left++) {
        while (right < hits.length && hits[right].end - hits[left].start <= span) {
            inWindow.set(hits[right].word, (inWindow.get(hits[right].word) || 0) + 1);
            right++;
        }
        if (inWindow.size >= needed)
            return true;
        const leaving = hits[left].word, remaining = (inWindow.get(leaving) || 0) - 1;
        if (remaining > 0)
            inWindow.set(leaving, remaining);
        else
            inWindow.delete(leaving);
    }
    return false;
}
const COMPANION_TITLE = /^[^\p{L}\p{N}]*(?:data(?:set)?|supplementa(?:ry|l)\s+(?:data|materials?|information)|supporting\s+information|source\s+data|replication\s+data)\s+(?:from|for|to)\s*[:：]/iu;
const DATASET_DOCUMENT = /\b(?:data\s*set|data\s+package|data\s+deposit|repository\s+record)\b/i;
const LABELLED_READING = new RegExp(`^[^\\p{L}]*(?:${LABELLED_READING_SOURCE}|copyright)\\s*[—–:：-]`, 'iu');
const scriptOf = (value: string): 'hangul' | 'cjk' | 'latin' => /[가-힣]/.test(value) ? 'hangul' : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value) ? 'cjk' : 'latin';
const clipped = (value: string) => value.length > 80 ? `${value.slice(0, 77)}…` : value;
function nameKeys(creators: unknown): Array<{
    script: 'hangul' | 'cjk' | 'latin';
    keys: string[];
}> {
    const out: Array<{
        script: 'hangul' | 'cjk' | 'latin';
        keys: string[];
    }> = [];
    for (const creator of Array.isArray(creators) ? creators : []) {
        let whole = '';
        let family = '';
        if (typeof creator === 'string')
            whole = creator;
        else if (creator && typeof creator === 'object') {
            const person = creator as {
                firstName?: unknown;
                lastName?: unknown;
                name?: unknown;
                fieldMode?: unknown;
            };
            if (person.fieldMode === 1 && !person.firstName)
                continue;
            family = String(person.lastName ?? '');
            whole = `${String(person.firstName ?? '')} ${family || String(person.name ?? '')}`;
        }
        whole = nfkc(whole).trim();
        if (!whole)
            continue;
        const script = scriptOf(whole);
        const keys = script === 'latin'
            ? [...new Set((nfkc(family || whole).toLowerCase().match(/\p{L}{2,}/gu) || []))]
            : [searchable(whole)];
        if (keys.length)
            out.push({ script, keys });
    }
    return out;
}
function readingNamesTheRecord(read: string, title: string, stated: string): boolean {
    const a = searchable(read), b = searchable(title);
    if (!a || !b)
        return false;
    if (a === b)
        return true;
    if (b.startsWith(a) && a.length >= 6)
        return true;
    if (a.includes(b))
        return true;
    if (b.includes(a))
        return b.length - a.length <= 3 || searchable(stated).includes(b);
    return titleSimilarity(read, title) >= 0.9;
}
function doiOnlyInCitations(doi: string, pages: string[]): boolean {
    if (!doi)
        return false;
    const pattern = new RegExp(doi.split('').map(character => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s{0,2}'), 'gi');
    let inside = 0, outside = 0;
    for (const page of pages) {
        const regions = citationRegions(page);
        for (const match of page.matchAll(pattern)) {
            const at = match.index ?? 0;
            if (regions.some(([start, end]) => at >= start && at < end))
                inside++;
            else
                outside++;
        }
    }
    return inside > 0 && outside === 0;
}
export type ReadWorkRelation = 'same' | 'container' | 'cited' | 'companion' | 'otherReading' | 'otherPeople' | 'notPrinted';
export function recordIsTheReadWork(record: {
    title?: unknown;
    creators?: unknown[];
    itemType?: unknown;
    DOI?: unknown;
    pages?: unknown;
    publicationTitle?: unknown;
}, context: {
    pages: string[];
    readTitle?: unknown;
    readCreators?: unknown[];
}): {
    same: boolean;
    reason: string;
    relation: ReadWorkRelation;
} {
    const title = nfkc(record?.title).replace(/\s+/g, ' ').trim();
    if (!title)
        return { same: false, reason: '레코드에 제목이 없습니다', relation: 'notPrinted' };
    const pages = (Array.isArray(context?.pages) ? context.pages : []).map(page => nfkc(page));
    const shown = withoutDecoyLeaves(pages);
    const opening = shown.find(page => page.trim()) || '';
    if (COMPANION_TITLE.test(title) || /^dataset$/i.test(String(record?.itemType ?? ''))) {
        if (!DATASET_DOCUMENT.test(opening.slice(0, 400))) {
            return { same: false, relation: 'companion',
                reason: `「${clipped(title)}」은(는) 이 문서에 딸린 데이터·보충 자료의 기록입니다 — 문서 자신의 기록이 아닙니다` };
        }
    }
    const own = shown.map(page => withoutCitations(page));
    const stated = own.map(page => withoutContainerStatements(page)).join('\n\f\n');
    if (!titleSupportedByPDF(title, stated)) {
        if (titleSupportedByPDF(title, own.join('\n\f\n'))) {
            return { same: false, relation: 'container',
                reason: `레코드 제목 「${clipped(title)}」은(는) 쪽의 수록처 진술(「In: …」)에만 인쇄돼 있습니다 — 이 문서를 담은 자료의 기록입니다` };
        }
        if (titleSupportedByPDF(title, shown.join('\n\f\n'))) {
            return { same: false, relation: 'cited',
                reason: `레코드 제목 「${clipped(title)}」은(는) 쪽의 인용(참고문헌·요약 대상·데이터 공개) 안에만 인쇄돼 있습니다 — 이 문서가 인용한 다른 저작입니다` };
        }
        return { same: false, relation: 'notPrinted', reason: '레코드의 제목이 이 문서의 본문에 나타나지 않습니다' };
    }
    const doi = cleanDOI(record?.DOI);
    if (doi && doiOnlyInCitations(doi, shown)) {
        return { same: false, relation: 'cited', reason: `DOI ${doi}은(는) 쪽의 인용 안에만 인쇄돼 있습니다 — 이 문서가 인용한 다른 저작의 번호입니다` };
    }
    const read = nfkc(context?.readTitle).replace(/\s+/g, ' ').trim();
    const container = nfkc(record?.publicationTitle);
    const readUsable = !!read && searchable(read).length >= (scriptOf(read) === 'latin' ? 12 : 4) && !isNotATitle(read) && !LABELLED_READING.test(read)
        && !(searchable(container) && searchable(container) === searchable(read)) && scriptOf(read) === scriptOf(title);
    const printedWhole = searchable(stated).includes(searchable(title));
    if (readUsable && !printedWhole && !readingNamesTheRecord(read, title, stated)) {
        return { same: false, relation: 'otherReading', reason: `판독한 제목 「${clipped(read)}」과 레코드 제목 「${clipped(title)}」은 다른 저작입니다` };
    }
    const readPeople = nameKeys(context?.readCreators), recordPeople = nameKeys(record?.creators);
    const comparable = readPeople.length && recordPeople.length && readPeople.some(person => recordPeople.some(other => other.script === person.script));
    if (comparable) {
        const shared = recordPeople.some(person => readPeople.some(other => other.script === person.script
            && person.keys.some(key => other.keys.some(value => person.script === 'latin' ? value === key : value.includes(key) || key.includes(value)))));
        if (!shared) {
            return { same: false, relation: 'otherPeople', reason: '판독한 저자와 레코드의 저자가 한 사람도 겹치지 않습니다 — 다른 저작의 기록입니다' };
        }
    }
    return { same: true, relation: 'same', reason: '레코드 제목이 인용 밖에서 이 문서의 제목으로 인쇄돼 있습니다' };
}
function identifierMatches(json: any, identifier: PDFIdentifier): boolean {
    if (identifier.kind === 'DOI')
        return cleanDOI(json?.DOI) === cleanDOI(identifier.value);
    const raw = String(json?.ISBN || '');
    const values = [...raw.split(/[\s;,]+/), raw].map(cleanISBN).filter(value => ISBN_SHAPE.test(value)).map(normalizedISBN);
    return values.includes(normalizedISBN(identifier.value));
}
function metadataFromJSON(parent: any, before: MetadataSnapshot, json: any): MetadataSnapshot {
    const candidate = new Zotero.Item(storableType(json.itemType || 'journalArticle'));
    candidate.libraryID = parent.libraryID;
    for (const id of Zotero.ItemFields.getItemTypeFields(candidate.itemTypeID)) {
        const field = Zotero.ItemFields.getName(id), value = json[field];
        if (typeof value === 'string' && value.trim())
            candidate.setField(id, value.trim());
    }
    candidate.setCreators(json.creators || []);
    const fields: Record<string, string> = {};
    for (const id of Zotero.ItemFields.getItemTypeFields(candidate.itemTypeID)) {
        const value = candidate.getField(id);
        if (value)
            fields[Zotero.ItemFields.getName(id)] = value;
    }
    return { ...before, itemTypeID: candidate.itemTypeID, itemType: Zotero.ItemTypes.getName(candidate.itemTypeID), fields, creators: candidate.getCreators() };
}
function metadataText(data: any): string {
    const values: string[] = [];
    const visit = (value: any) => {
        if (typeof value === 'string')
            values.push(value);
        else if (Array.isArray(value))
            value.forEach(visit);
        else if (value && typeof value === 'object')
            Object.values(value).forEach(visit);
    };
    visit(data?.metadata);
    return values.join(' ').slice(0, 10000);
}
export async function recognizeFromPDFIdentifiers(parent: any, attachment: any, before: MetadataSnapshot, supplementalEvidence = '', options: {
    timeoutMs?: number;
} = {}): Promise<IdentifierLookup> {
    const data = await Zotero.PDFWorker.getRecognizerData(attachment.id, true);
    const frontMatter = bibliographicFrontMatter(data, 5);
    return recognizeFromTextIdentifiers(parent, before, frontMatter, `${metadataText(data)} ${supplementalEvidence}`, options);
}
const COVER_ANNOUNCEMENT = /^(?:front\s+cover|back\s+cover|inside\s+(?:front\s+|back\s+)?cover|cover\s+(?:picture|feature|image|story)|frontispiece|masthead)\b[:\s]/i;
export function isCoverEntry(title: unknown, publicationTitle: unknown): boolean {
    const value = String(title || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!value)
        return false;
    if (COVER_ANNOUNCEMENT.test(value))
        return true;
    const journal = String(publicationTitle || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (journal.length < 3)
        return false;
    const trailing = value.match(/\(([^()]{3,80})\)\s*$/);
    if (!trailing)
        return false;
    const inside = trailing[1].normalize('NFKC').replace(/\s+/g, ' ').trim();
    return inside.toLowerCase().startsWith(journal.toLowerCase())
        && /\d/.test(inside.slice(journal.length));
}
export type LookupOutcome = 'record' | 'rejected' | 'noMatch' | 'failed' | 'notAsked';
export interface IdentifierAttempt {
    kind: PDFIdentifier['kind'];
    value: string;
    outcome: LookupOutcome;
    reason: string;
}
export interface IdentifierLookup {
    record: (RecognitionResult & {
        identifier: PDFIdentifier;
    }) | null;
    tried: IdentifierAttempt[];
    unreachable: boolean;
    related?: {
        record: RecognitionResult & {
            identifier: PDFIdentifier;
        };
        scope: 'container' | 'part';
        reason: string;
    } | null;
}
export type RecordScope = 'same' | 'container' | 'part' | 'unknown';
const NOTHING_FOUND = /no items?\s+(?:were\s+)?(?:returned|found)/i;
export const LOOKUP_TIMEOUT_MS = 30000;
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<{
    ok: true;
    value: T;
} | {
    ok: false;
    reason: string;
}> {
    let timer: any = null;
    try {
        const expiry = new Promise<{
            ok: false;
            reason: string;
        }>(resolve => {
            timer = setTimeout(() => resolve({ ok: false, reason: `${Math.round(ms / 1000)}초 안에 응답이 없었습니다` }), ms);
        });
        return await Promise.race([work.then(value => ({ ok: true as const, value })), expiry]);
    }
    finally {
        if (timer !== null)
            clearTimeout(timer);
    }
}
export async function lookupIdentifier(identifier: PDFIdentifier, options: {
    timeoutMs?: number;
} = {}): Promise<{
    outcome: Exclude<LookupOutcome, 'rejected' | 'notAsked'>;
    json?: any;
    reason: string;
}> {
    const timeoutMs = options.timeoutMs ?? LOOKUP_TIMEOUT_MS;
    let translate: any;
    try {
        translate = new Zotero.Translate.Search();
        translate.setIdentifier({ [identifier.kind]: identifier.value });
    }
    catch (cause) {
        return { outcome: 'failed', reason: `조회를 시작하지 못했습니다: ${String((cause as any)?.message || cause).slice(0, 120)}` };
    }
    const translators = await withDeadline(Promise.resolve(translate.getTranslators()), timeoutMs)
        .catch((cause: any) => ({ ok: false as const, reason: String(cause?.message || cause).slice(0, 120) }));
    if (!translators.ok)
        return { outcome: 'failed', reason: `번역기 목록을 받지 못했습니다: ${translators.reason}` };
    const list = (translators.value || []) as any[];
    if (!list.length)
        return { outcome: 'failed', reason: '이 식별자를 다룰 번역기가 없습니다 — 번역기가 로드되지 않았을 수 있습니다' };
    translate.setTranslator(list);
    let items: any[];
    try {
        const answered = await withDeadline(Promise.resolve(translate.translate({ libraryID: false, saveAttachments: false })), timeoutMs);
        if (!answered.ok)
            return { outcome: 'failed', reason: `조회가 끝나지 않았습니다: ${answered.reason}` };
        items = (answered.value || []) as any[];
    }
    catch (cause) {
        const message = String((cause as any)?.message || cause).slice(0, 160);
        return NOTHING_FOUND.test(message)
            ? { outcome: 'noMatch', reason: `레지스트리에 이 식별자의 레코드가 없습니다 (${message})` }
            : { outcome: 'failed', reason: `조회가 실패했습니다: ${message}` };
    }
    const json = items.find((item: any) => item?.title && identifierMatches(item, identifier));
    if (json)
        return { outcome: 'record', json, reason: '레지스트리가 이 식별자의 레코드를 반환했습니다' };
    return { outcome: 'noMatch',
        reason: items.length ? '반환된 레코드의 식별자가 문서의 것과 다릅니다' : '레지스트리에 이 식별자의 레코드가 없습니다' };
}
export async function recognizeFromTextIdentifiers(parent: any, before: MetadataSnapshot, frontMatter: string, supplementalEvidence = '', options: {
    timeoutMs?: number;
    complete?: boolean;
    readTitle?: unknown;
    readCreators?: unknown[];
    scopeOf?: (metadata: MetadataSnapshot) => RecordScope;
    textLayer?: string;
    readText?: string;
} = {}): Promise<IdentifierLookup> {
    const tried: IdentifierAttempt[] = [];
    const note = (identifier: PDFIdentifier, outcome: LookupOutcome, reason: string) => tried.push({ kind: identifier.kind, value: identifier.value, outcome, reason });
    let related: IdentifierLookup['related'] = null;
    const relate = (identifier: PDFIdentifier, metadata: MetadataSnapshot, scope: 'container' | 'part', reason: string) => {
        if (!related)
            related = { record: { source: null, metadata, changes: buildDiff(before, metadata, true), identifier }, scope, reason };
    };
    const pages = String(frontMatter || '').split('\f');
    frontMatter = withoutDecoyLeaves(pages).join('\f');
    const layerPages = String(options.textLayer || '').split('\f');
    const layerDOIs = options.textLayer
        ? lookupCandidates({ text: withoutDecoyLeaves(layerPages).join('\f'), complete: true })
            .filter(entry => entry.kind === 'DOI').map(entry => entry.value)
        : [];
    const found = lookupCandidates({ text: `${supplementalEvidence} ${frontMatter}`, complete: !!options.complete });
    const fromLayer = layerDOIs.length ? doisToAsk(layerDOIs, layerPages, options.readTitle, true) : null;
    const judged = fromLayer && fromLayer.asked.length ? fromLayer
        : doisToAsk(found.filter(entry => entry.kind === 'DOI' && !fromLayer?.refused.some(held => sameDOI(held.value, entry.value))).map(entry => entry.value), pages, options.readTitle, !!options.complete);
    const readDOIs = options.readText ? lookupCandidates({ text: String(options.readText), complete: true }).filter(entry => entry.kind === 'DOI').map(entry => entry.value) : [];
    const fromRead = readDOIs.length ? doisToAsk(readDOIs, pages, options.readTitle, true) : null;
    const refusedNotes = [...(fromRead?.refused || []), ...(fromLayer?.refused || []), ...(judged === fromLayer ? [] : judged.refused)];
    const noted: string[] = [];
    for (const entry of refusedNotes) {
        if (noted.some(value => sameDOI(value, entry.value)) || (fromRead?.asked || []).some(value => sameDOI(value, entry.value)))
            continue;
        noted.push(entry.value);
        note({ kind: 'DOI', value: entry.value }, 'notAsked', entry.reason);
    }
    const doiOrder: string[] = [];
    for (const value of [...(fromRead?.asked || []), ...judged.asked])
        if (!doiOrder.some(held => sameDOI(held, value)))
            doiOrder.push(value);
    const asked: PDFIdentifier[] = [...doiOrder.map(value => ({ kind: 'DOI' as const, value })), ...found.filter(entry => entry.kind !== 'DOI')].slice(0, LOOKUP_LIMIT);
    for (const identifier of asked) {
        const answer = await lookupIdentifier(identifier, options);
        if (answer.outcome !== 'record') {
            note(identifier, answer.outcome, answer.reason);
            continue;
        }
        const json = answer.json;
        const identity = recordIsTheReadWork({ title: json.title, creators: json.creators, itemType: json.itemType, DOI: json.DOI, pages: json.pages, publicationTitle: json.publicationTitle }, { pages: frontMatter.split('\f'), readTitle: options.readTitle, readCreators: options.readCreators });
        if (!identity.same) {
            if (identity.relation === 'container')
                relate(identifier, metadataFromJSON(parent, before, json), 'container', identity.reason);
            note(identifier, 'rejected', identity.reason);
            continue;
        }
        const metadata = metadataFromJSON(parent, before, json);
        if (!titleSupportedByPDF(metadata.fields.title, frontMatter)
            && titleSimilarity(json.title, metadata.fields.title) < 0.94) {
            note(identifier, 'rejected', '저장 형태로 바뀐 제목이 본문과 맞지 않습니다');
            continue;
        }
        if (isCoverEntry(metadata.fields.title, metadata.fields.publicationTitle)) {
            Zotero.debug(`[PDF Metadata Refresh] ${identifier.value} resolves to a cover entry, not the article: ${metadata.fields.title}`);
            note(identifier, 'rejected', '표지 항목의 레코드입니다 — 논문이 아닙니다');
            continue;
        }
        if (containerMismatch(metadata.itemType, frontMatter)) {
            Zotero.debug(`[PDF Metadata Refresh] ${identifier.value} resolves to a ${metadata.itemType} while the page reads as a journal article`);
            note(identifier, 'rejected', `${metadata.itemType} 레코드인데 본문은 학술지 논문으로 읽힙니다`);
            continue;
        }
        const scope = options.scopeOf ? options.scopeOf(metadata) : 'unknown';
        if (scope === 'container' || scope === 'part') {
            const why = scope === 'container'
                ? `${metadata.itemType} 레코드는 이 문서를 담은 자료입니다 — 문서의 쪽 수와 쪽에 인쇄된 제 쪽 범위가 그 일부를 가리킵니다`
                : `${metadata.itemType} 레코드는 이 문서의 한 부분입니다 — 레코드의 쪽 범위가 문서의 쪽 수보다 훨씬 좁습니다`;
            relate(identifier, metadata, scope, why);
            note(identifier, 'rejected', why);
            continue;
        }
        assertIdentityUnchanged(before.identity, await captureIdentity(parent));
        note(identifier, 'record', answer.reason);
        return { record: { source: null, metadata, changes: buildDiff(before, metadata, true), identifier }, tried, unreachable: false, related };
    }
    return { record: null, tried, unreachable: tried.some(attempt => attempt.outcome === 'failed'), related };
}
const CONTAINED_IN = /(?:\bin:?\b|\bfrom\b|\bpart of\b|수록|소재)[^\n]{0,12}$/i;

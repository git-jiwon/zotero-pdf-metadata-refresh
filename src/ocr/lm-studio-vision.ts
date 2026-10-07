import renderPagesScript from '../../scripts/windows-pdf-images.ps1';
import { normalizeOCRPageLimit, type OCRResult } from './windows-ocr';
import { sameFile } from '../batch/cache';
import { isPlaceholderTitle, titleSimilarity } from '../metadata/match';
import { isSerialName } from '../recognition/title-guards';
import { canonicalDate, journalHeadStatement, pageCarriesWords } from '../recognition/roles';
import { colophonLabelled, isOrganisationItem, peopleOfField } from '../recognition/byline-row';
import { shouting } from '../recognition/folded-letters';
import { firstPrintingIn, imprintSignal, withoutPublisherTail } from '../recognition/imprint-marks';
import { personParts } from '../metadata/person-name';
import { sameName } from '../metadata/name-equivalence';
import { identifiersIn, pagesAsWritten } from './vision-record';
import { otherWorksSpansIn } from '../recognition/page-structure';
import type { LMStudioSettings } from './lm-studio';
const RENDER_VERSION = 'lmstudio-vision-render-v5';
const RENDER_SCRIPT = 'lmstudio-vision-render-v6';
const PROMPT_VERSION = 'p10-page-gather';
const PROMPT_FAMILY = 'p7-page-by-page';
const COMPATIBLE_PROMPTS = new Set(['p7-page-by-page', 'p8-edition-date', PROMPT_VERSION]);
export interface VisionRenderOptions {
    width?: number;
    region?: 'full';
}
export interface VisionStep {
    step: 1;
    width: number;
    region: 'full';
    label: string;
}
export const VISION_STEPS: readonly VisionStep[] = [
    { step: 1, width: 900, region: 'full', label: '전체 쪽 (렌더 예산 900)' }
];
function failureDetail(cause: unknown): string {
    const xhr = (cause as any)?.xmlhttp;
    if (xhr) {
        try {
            const body = xhr.response;
            if (body)
                return typeof body === 'string' ? body : JSON.stringify(body);
        }
        catch { }
        try {
            if (xhr.responseText)
                return String(xhr.responseText);
        }
        catch { }
        try {
            if (xhr.status)
                return `HTTP ${xhr.status}${xhr.statusText ? ' ' + xhr.statusText : ''}`;
        }
        catch { }
    }
    return String((cause as any)?.message || cause);
}
const RENDER_TIMEOUT = 120000;
const VISION_REQUEST_TIMEOUT = 180000;
const PAGE_PROMPT = [
    '이 쪽에 인쇄된 서지정보만 아래 두 부분으로 출력한다. 번역하거나 바꿔 쓰지 않되, 줄바꿈으로 끊긴 낱말·붙임표·깨진 띄어쓰기·대소문자는 바로잡아 적는다.',
    '번역·설명·요약·본문 문단·그림 설명은 한 줄도 쓰지 않는다. 없는 항목은 빈칸으로 둔다.',
    '언어는 이 문서의 본문이 쓰인 언어를 ko·ja·zh·en 같은 두 글자 코드로 적는다.',
    '제목·부제·저자는 본문 언어의 표기를 쓴다. 다른 언어로 병기된 제목은 제목 값에 넣지 않고 표제면 원문에만 남긴다.',
    '각 값에는 라벨(제목:, 발행기관:, 저자:), INID 번호, 문서 유형, 서지 설명을 붙이지 않는다. 제목은 한 줄 한 값으로만 출력한다.',
    '유형은 지면에서 확인되는 journalArticle·book·bookSection·thesis·report·conferencePaper·patent 중 하나로 적고 모르면 빈칸으로 둔다.',
    '저자 곁의 소속(대학·연구소·학과)은 출판이 아니다.',
    '한 사람이 두 문자로 인쇄돼 있으면(홍길동(Gil-dong Hong)) 본문 언어의 표기 하나만 적는다. 여러 저자는 세미콜론(;)으로 구분한다.',
    '학위는 학위논문의 표지·인준면이 이 논문에 대해 적은 학위 표기를 적는다. 지도교수·심사위원 이름 곁의 학위는 적지 않는다.',
    '이 문서 자신의 서지정보만 적는다. 이 저작의 표지·표제면·판권면·인준면에 인쇄된 것이다. 같은 쪽에 실린 다른 저작(추천 도서, 「함께 읽으면 좋은 책」, 총서·시리즈 목록, 광고, 「같은 저자의 책」, 뒤표지 소개글, 학술지 목차의 다른 논문, 참고문헌)의 제목·저자·ISBN·출판사·발행일은 모두 무시한다. 다른 저작만 실린 쪽은 서지정보가 없는 쪽으로 답한다.',
    '쪽이 라벨과 값으로 된 서식·표이면, 제목은 저작을 가리키는 라벨(제목, 과제명, 연구과제명, 보고서명, 기술명, 특허 기술명, 발명의 명칭, 논문명, 서명, Title)이 붙은 칸의 값이다. 그런 칸이 여러 언어로 있으면 본문 언어의 칸을 쓴다.',
    '서식 자체의 머리글(「…설명자료」, 「…신청서」, 「…계획서」, 「…양식」, 「…보고서 (양식)」, 「기술이전을 위한 …」)은 제목이 아니다.',
    '서식의 저자는 사람을 가리키는 라벨(성명, 발명자, 연구책임자, 저자)이 붙은 칸의 이름이다. 소속 칸의 기관은 저자가 아니다.',
    '쪽 번호만 있는 줄(「- 2 -」)은 페이지 값이 아니고 서지정보도 아니다.',
    '페이지는 이 글이 실린 쪽 범위(인용 줄의 879-893 같은 것)다. 쪽 머리·꼬리에 찍힌 쪽 번호 하나는 페이지가 아니다.',
    '발행일은 이 판의 발행 날짜다(발행 칸·판권면·©·학술지 쪽 머리나 꼬리 인용 줄의 연도). 투고·접수·승인일, 내려받기 날짜, 번역서의 원서 연도, 참고문헌의 연도는 적지 않는다.',
    '판권면에 판이 여럿이면(First published 1983 / e-edition 2013) 이 판, 곧 마지막 판의 발행처와 연도(©의 연도)를 적는다.',
    '',
    '[항목]',
    '유형:', '제목:', '부제:', '저자:', '학위:', '출판:', '권호:', '페이지:', '발행일:', '식별자:', '언어:',
    '',
    '[표제면 원문]',
    '제목·부제·저자·학위·출판 정보가 인쇄된 줄만 보이는 순서대로 그대로 옮긴다. 본문은 옮기지 않는다.',
    '',
    '맨 끝에는 이 문서의 다음 쪽을 더 읽어야 하는지 「다음 쪽: 필요」 또는 「다음 쪽: 불필요」 한 줄을 적는다.',
    '이 문서의 제목과 저자를 읽었고, 책이면 ISBN이나 발행일까지, 학위논문이면 학위와 발행일까지 읽었으면(앞 쪽에서 읽은 것 포함) 불필요다. 이 쪽이 표지·겉장(저장소·내려받기 안내)·동의서·빈 쪽·다른 저작만 실린 쪽이거나 서지가 아직 모자라면 필요다.'
].join(String.fromCharCode(10));
const LATER_PAGE_RULE = '위 서지는 앞 쪽에서 이미 읽은 것이다. 이 쪽에 인쇄되지 않은 값을 위에서 옮겨 적지 않는다. 이 쪽의 서지가 위 문서가 아닌 다른 저작의 것이면 적지 않는다.';
const FIELD_LINE = /^(유형|제목|부제|저자|학위|출판|권호|페이지|발행일|식별자|언어)\s*[:：]\s*(.*)$/;
const NEXT_PAGE_LINE = /^[\s*_>#「『\[(]*(?:다음\s*(?:쪽|페이지|장)|next\s+page)(?:\s*(?:이|은|는|가))?[\s*_」』\])]*(?:[:：=–—-]\s*|\s+|$)(.*)$/i;
export function pageTextFromAnswer(answer: string): string {
    const lines = String(answer || '').split(/\r?\n/).map(line => line.trim());
    const printed: string[] = [];
    for (const line of lines) {
        if (/^\[?표제면\s*원문\]?/.test(line))
            continue;
        if (/^\[?항목\]?$/.test(line))
            continue;
        if (!line)
            continue;
        if (FIELD_LINE.test(line))
            continue;
        if (NEXT_PAGE_LINE.test(line))
            continue;
        printed.push(line);
    }
    return (printed.length ? printed : Object.entries(fieldsFromAnswer(answer))
        .filter(([name]) => name !== '언어' && name !== '유형').map(([, value]) => value)).join(String.fromCharCode(10));
}
export function fieldsFromAnswer(answer: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of String(answer ?? '').split(/\r?\n/)) {
        const field = FIELD_LINE.exec(line.trim());
        if (!field || !field[2].trim())
            continue;
        const [name, value] = [field[1], field[2].trim()];
        if (!out[name])
            out[name] = value;
        else if (name === '저자')
            out[name] = `${out[name]}\n${value}`;
    }
    return out;
}
const SYSTEM_PROMPT = 'You are a precise multilingual document OCR engine. Preserve Korean, Hanja, scientific symbols, capitalization, punctuation and complete wrapped titles. Never infer text that is not visible.';
function sectionForPage(answer: string): string {
    let text = String(answer || '').split(/\r?\n/).filter(line => !NEXT_PAGE_LINE.test(line.trim())).join('\n').trim();
    text = text.replace(/^```(?:text)?\s*/i, () => '').replace(/\s*```$/i, () => '').trim();
    if (text.length <= 80 && /^\(?[^\n]*(?:존재하지\s*않|찾을\s*수\s*없|없습니다|없는\s|없음|해당\s*없|no\s+bibliographic|not\s+(?:found|visible|present)|none)[^\n]{0,20}$/i.test(text))
        return '';
    return text;
}
export function nextPageNeeded(answer: string): boolean {
    let stated: string | null = null;
    for (const line of String(answer ?? '').split(/\r?\n/)) {
        const found = NEXT_PAGE_LINE.exec(line.trim());
        if (found)
            stated = found[1];
    }
    if (stated === null)
        return true;
    const value = stated.replace(/[*_「」『』]/g, '').trim();
    if (/필요\s*(?:또는|혹은|이나|or|\/|·|,)\s*불필요|불필요\s*(?:또는|혹은|이나|or|\/|·|,)\s*필요/i.test(value))
        return true;
    return !/불필요|필요\s*(?:없|하지\s*않|치\s*않)|^아니|^no\b|^false\b|not\s+(?:needed|required|necessary)|unnecessary/i.test(value);
}
export function coreComplete(fields: Record<string, string>): boolean {
    if (!String(fields['제목'] || '').trim())
        return false;
    const type = String(fields['유형'] || '').trim().toLowerCase();
    if (!type)
        return false;
    if (/thesis|학위\s*논문/.test(type))
        return !!fields['학위'] && !!fields['발행일'];
    if (/^(?:book\b|책|단행본|도서)/.test(type))
        return !!fields['발행일'];
    return true;
}
export interface PagePlace {
    role: string;
    order: 0 | 1 | 2 | null;
    leaf?: string;
    layer?: string;
}
const NOT_THE_TITLE_PAGE = new Set(['cover', 'halfTitle', 'insertedLeaf']);
function placeAt(reading: VisionReadOptions, page: number): PagePlace | null {
    try {
        return reading.pagePlace?.(page) ?? null;
    }
    catch {
        return null;
    }
}
export function titlePageAhead(pageFields: Record<string, Record<string, string>>, read: number[], page: number, reading: VisionReadOptions, reach: number): number | null {
    if (!reading.pagePlace)
        return null;
    const order = [...read].sort((a, b) => a - b);
    if (order.some(number => placeAt(reading, number)?.role === 'titlePage'))
        return null;
    const titleFrom = order.find(number => String(pageFields[String(number)]?.['제목'] || '').trim());
    if (titleFrom === undefined)
        return null;
    const place = placeAt(reading, titleFrom);
    if (!place || !NOT_THE_TITLE_PAGE.has(place.role))
        return null;
    for (let next = page + 1; next <= reach; next++) {
        if (read.includes(next))
            continue;
        const ahead = placeAt(reading, next);
        if (ahead && (ahead.order === 0 || ahead.order === 1))
            return next;
    }
    return null;
}
function nameWords(name: string): string[] {
    return name.normalize('NFKC').replace(/[.,]/g, ' ').replace(/-(?=\p{Lu}\b)/gu, ' ').split(/\s+/).filter(Boolean);
}
const INITIAL = /^\p{Lu}$/u;
const latinName = (name: string) => /\p{Script=Latin}/u.test(name) && !/[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name);
function shortenedForm(name: string): 'surname' | 'initials' | '' {
    if (!latinName(name))
        return '';
    const words = nameWords(name);
    if (words.length === 1)
        return /^\p{L}{2,}$/u.test(words[0]) ? 'surname' : '';
    const given = words.slice(0, -1);
    return given.length > 0 && given.every(word => INITIAL.test(word)) ? 'initials' : '';
}
const folded = (value: string) => value.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase();
function shortenedOf(held: string, offered: string): boolean {
    const form = shortenedForm(held);
    if (!form || !latinName(offered) || shortenedForm(offered))
        return false;
    const a = nameWords(held), b = nameWords(offered);
    if (b.length < 2 || folded(a[a.length - 1]) !== folded(b[b.length - 1]))
        return false;
    if (form === 'surname')
        return true;
    const initials = a.slice(0, -1).map(folded), given = b.slice(0, -1).map(word => folded(word)[0]);
    return initials.length <= given.length && initials.every((letter, at) => given[at] === letter);
}
const FEWER_NAMES = /\bet\.?\s*al\b|\band\s+others\b|\b\d{1,3}\s+authors?\b|\bincluding\s*:|(?:^|\s)외(?:\s*\d{1,3}\s*(?:명|인))?\s*$/iu;
export function bylineAbbreviated(fields: Record<string, string>, printed = ''): boolean {
    const value = String(fields['저자'] || '').trim();
    if (!value)
        return false;
    if (value.split(/\n|;/).some(line => FEWER_NAMES.test(line.trim())) || String(printed || '').split(/\n/).some(line => /\b\d{1,3}\s+authors?\s*,\s*including\b/i.test(line)))
        return true;
    const names = bylineNames(value).filter(latinName);
    if (!names.length || names.length !== bylineNames(value).length)
        return false;
    const forms = names.map(shortenedForm);
    if (forms.every(form => form === 'surname'))
        return true;
    const cited = !!String(fields['권호'] || '').trim() || !!String(fields['페이지'] || '').trim();
    return !cited && forms.every(form => form === 'surname' || form === 'initials');
}
export type ReadOnReason = 'titlePageAhead' | 'bylineAbbreviated' | 'titlePageVerso' | 'colophonIdentifier';
const printsAnISBN = (value: string) => { const text = String(value || '').slice(0, 20000); return /(?<![\p{L}])ISBN(?![\p{L}])/iu.test(text) || !!identifiersIn(text).ISBN; };
export function colophonToAskAgain(fields: Record<string, string>, pageFields: Record<string, Record<string, string>>, read: number[], side: (page: number) => {
    printed: string;
    layer: string;
    place: PagePlace | null;
    cover: boolean;
} | undefined, colophonPage: number | null = null): number | null {
    if (String(fields['유형'] || '').trim() !== 'book' || identifiersIn(fields['식별자']).ISBN)
        return null;
    const date = String(fields['발행일'] || '').trim();
    const pages = [...read].sort((a, b) => a - b);
    const colophon = pages.find(page => side(page)?.place?.role === 'colophon' && !side(page)?.cover)
        ?? (colophonPage !== null && pages.includes(colophonPage) && !side(colophonPage)?.cover ? colophonPage : undefined)
        ?? (date ? pages.find(page => String(pageFields[String(page)]?.['발행일'] || '').trim() === date && !side(page)?.cover) : undefined);
    const stated = String(pageFields[String(colophon)]?.['식별자'] || '');
    if (colophon === undefined || printsAnISBN(stated) || /(?:\d[\s-]?){9}[\dX]/i.test(stated))
        return null;
    const at = side(colophon);
    return printsAnISBN(`${at?.printed || ''}\n${at?.layer || ''}`) ? colophon : null;
}
export function readOnReason(fields: Record<string, string>, pageFields: Record<string, Record<string, string>>, read: number[], page: number, reading: VisionReadOptions, reach: number, printedOf: (page: number) => string = () => ''): ReadOnReason | null {
    if (titlePageAhead(pageFields, read, page, reading, reach) !== null)
        return 'titlePageAhead';
    const held = String(fields['저자'] || '').trim();
    const from = [...read].sort((a, b) => a - b).find(number => {
        const value = String(pageFields[String(number)]?.['저자'] || '').trim();
        if (!value)
            return false;
        const printed = bylineAsThePagePrints(value, layerOf(reading.layerText, number));
        return value === held || printed === held || (!!printed && held.startsWith(`${printed}; `));
    });
    if (held && from !== undefined && from >= page && bylineAbbreviated(fields, printedOf(from)))
        return 'bylineAbbreviated';
    return null;
}
const SUMMARY_FIELDS = ['유형', '제목', '부제', '저자', '학위', '출판', '권호', '페이지', '발행일', '식별자'];
export function summaryOfEarlierPages(fields: Record<string, string>): string {
    const parts = SUMMARY_FIELDS.filter(name => String(fields[name] || '').trim())
        .map(name => name + ' ' + String(fields[name]).trim().split(/\s*\n\s*/).join('; ').slice(0, 200));
    return '앞 쪽에서 읽은 이 문서의 서지: ' + (parts.length ? parts.join(' · ') : '없음');
}
const SAME_WORK_SIMILARITY = 0.5;
function sameWork(title: string, reference: string, subtitle = ''): boolean {
    const flat = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const a = flat(title);
    const references = [reference, subtitle, subtitle ? reference + ' ' + subtitle : ''].filter(value => flat(value));
    if (!a || !references.length)
        return true;
    const contains = (value: string) => {
        const b = flat(value);
        const [short, long] = a.length <= b.length ? [a, b] : [b, a];
        return short.length >= 4 && long.includes(short);
    };
    if (references.some(contains))
        return true;
    const script = (value: string) => /[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value) ? 'cjk' : /[A-Za-z]/.test(value) ? 'latin' : '';
    const comparable = references.filter(value => !script(title) || !script(value) || script(value) === script(title));
    if (!comparable.length)
        return true;
    return comparable.some(value => titleSimilarity(title, value) >= SAME_WORK_SIMILARITY);
}
const OWN_WORK_FIELDS = ['제목', '부제', '저자', '식별자'];
export function ownContribution(named: Record<string, string>, earlier: Record<string, string>): Record<string, string> {
    const title = String(named['제목'] || '').trim();
    const without = (names: string[]) => Object.fromEntries(Object.entries(named).filter(([name]) => !names.includes(name)));
    if (!title)
        return named;
    if (isPlaceholderTitle(title))
        return without(['제목', '부제']);
    const reference = String(earlier['제목'] || '').trim();
    if (!reference || sameWork(title, reference, earlier['부제']))
        return named;
    return without(OWN_WORK_FIELDS);
}
function bylineNames(value: unknown): string[] {
    return peopleOfField(value).filter(entry => !entry.organisation).map(entry => entry.text);
}
function sameNameAs(a: string, b: string): boolean {
    const parts = (name: string) => personParts(name) || name;
    return sameName(parts(a), parts(b), 'bylineMerge');
}
export function partialByline(held: unknown, offered: unknown): boolean {
    const earlier = bylineNames(held), later = bylineNames(offered);
    if (!earlier.length || later.length < earlier.length)
        return false;
    const matches = (name: string, other: string) => sameNameAs(name, other) || shortenedOf(name, other);
    if (later.length > earlier.length)
        return earlier.every(name => later.some(other => matches(name, other)));
    return earlier.every((name, at) => matches(name, later[at])) && earlier.some((name, at) => shortenedOf(name, later[at]));
}
export function fullestByline(values: unknown[]): string {
    let held = '';
    for (const value of values) {
        const raw = String(value ?? '').trim();
        const pieces = raw.split(/[;；\n]/).map(piece => piece.trim()).filter(Boolean);
        const named = pieces.map(catalogueHeadingAsName);
        const offered = named.some((piece, at) => piece !== pieces[at]) ? named.join('; ') : raw;
        if (!offered)
            continue;
        if (!held || partialByline(held, offered))
            held = offered;
    }
    return held;
}
function printedOnPage(text: string, page: string): string {
    for (const section of String(text || '').split(/\n\f\n/)) {
        const head = /^--- PAGE (\d+) ---\n?/.exec(section);
        if (head && head[1] === page)
            return section.slice(head[0].length);
    }
    return '';
}
export function withFullestByline(fields: Record<string, string>, pageFields: Record<string, Record<string, string>> | undefined, text = '', layerText: (page: number) => string = () => ''): Record<string, string> {
    const held = String(fields?.['저자'] || '').trim();
    if (!held || !pageFields)
        return fields;
    const offered = Object.keys(pageFields).sort((a, b) => Number(a) - Number(b))
        .map(page => ({ page, answer: pageFields[page] || {} }))
        .filter(({ page, answer }) => !!answer['저자'] && !coverOfASerial({ 유형: fields['유형'] || '', ...answer }, printedOnPage(text, page), layerOf(layerText, Number(page))))
        .map(({ answer }) => answer['저자']);
    const fullest = fullestByline([held, ...offered]);
    return fullest && fullest !== held ? { ...fields, 저자: fullest } : fields;
}
const ARTICLE_TYPE = /^(?:journalArticle|magazineArticle|newspaperArticle)$/i;
export function coverOfASerial(named: Record<string, string>, printed = '', layer = ''): boolean {
    const title = String(named['제목'] || '').trim();
    const type = String(named['유형'] || '').trim();
    if (!title || (type && !ARTICLE_TYPE.test(type)))
        return false;
    const numbering = [named['권호'], named['페이지']].filter(Boolean).join(' ');
    const stated = [printed, named['식별자']].filter(value => String(value || '').trim()).join('\n');
    const ownSerial = String(layer || '').trim() ? journalHeadStatement(layer)?.journal || '' : '';
    return isSerialName(title, { containers: type ? [named['출판']] : [], numbering, printed: stated, layer, byline: named['저자'], ownSerial });
}
export interface VisionReadOptions {
    layerText?: (page: number) => string;
    documentPages?: number | null;
    insertedLeaf?: (page: number) => boolean;
    pagePlace?: (page: number) => PagePlace | null;
}
function layerOf(layerText: VisionReadOptions['layerText'], page: number): string {
    try {
        return String(layerText?.(page) ?? '');
    }
    catch {
        return '';
    }
}
export function freeLeaf(page: number, answer: Record<string, string> | null | undefined, reading: VisionReadOptions = {}): boolean {
    let inserted = false;
    try {
        inserted = !!reading.insertedLeaf?.(page);
    }
    catch {
        inserted = false;
    }
    if (inserted)
        return true;
    if (Object.keys(answer || {}).some(name => name !== '언어' && name !== '유형'))
        return false;
    return !pageCarriesWords(layerOf(reading.layerText, page));
}
function layerSpeaks(reading: VisionReadOptions, upTo: number): boolean {
    for (let page = 1; page <= upTo; page++)
        if (placeAt(reading, page)?.layer === 'readable' && pageCarriesWords(layerOf(reading.layerText, page)))
            return true;
    return false;
}
function spendsBudget(page: number, answer: Record<string, string> | null | undefined, reading: VisionReadOptions, seen: boolean, speaks: boolean): boolean {
    if (listOfOtherWorks(page, answer, reading))
        return false;
    const free = freeLeaf(page, answer, reading);
    const blankBack = free && speaks && placeAt(reading, page)?.layer === 'none';
    return (seen || !free) && !blankBack;
}
function listOfOtherWorks(page: number, answer: Record<string, string> | null | undefined, reading: VisionReadOptions): boolean {
    if (String(answer?.['제목'] || '').trim())
        return false;
    const layer = layerOf(reading.layerText, page);
    if (!layer || layer.length > 100000 || !pageCarriesWords(layer))
        return false;
    const letters = (value: string) => (value.match(/[\p{L}\p{N}]/gu) || []).length;
    const total = letters(layer);
    const listed = otherWorksSpansIn(layer).reduce((sum, [start, end]) => sum + letters(layer.slice(start, end)), 0);
    return total > 0 && listed * 3 >= total * 2;
}
export function pagesCounted(read: number[] | null | undefined, pageFields: Record<string, Record<string, string>> | null | undefined, reading: VisionReadOptions = {}): number {
    let seen = false, counted = 0;
    const known = Number(reading.documentPages) > 0 ? Math.min(VISION_MAX_PAGES, Math.floor(Number(reading.documentPages))) : VISION_MAX_PAGES;
    const speaks = layerSpeaks(reading, known);
    for (const page of [...(read || [])].sort((a, b) => a - b)) {
        const answer = pageFields?.[String(page)];
        if (spendsBudget(page, answer, reading, seen, speaks))
            counted++;
        if (!seen && !freeLeaf(page, answer, reading))
            seen = true;
    }
    return counted;
}
interface PageSide {
    printed: string;
    layer: string;
    place: PagePlace | null;
    cover: boolean;
}
interface PageMerge {
    fields: Record<string, string>;
    pageFields: Record<string, Record<string, string>>;
    coverHeld: Record<string, string>;
    sides: Record<string, PageSide>;
    titlePage: number | null;
    colophonPage: number | null;
}
const newMerge = (fields: Record<string, string> = {}, pageFields: Record<string, Record<string, string>> = {}, coverHeld: Record<string, string> = {}): PageMerge => ({ fields, pageFields, coverHeld, sides: {}, titlePage: null, colophonPage: null });
const compactOf = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
function imprintPage(answer: Record<string, string> | undefined, side: PageSide | undefined): boolean {
    if (side?.cover)
        return false;
    if (side?.place?.role === 'colophon')
        return true;
    if (!String(answer?.['발행일'] || '').trim())
        return false;
    if (identifiersIn(answer?.['식별자']).ISBN)
        return true;
    if (!String(answer?.['출판'] || '').trim() || String(answer?.['제목'] || '').trim())
        return false;
    return imprintSignal(`${side?.printed || ''}\n${side?.layer || ''}`);
}
function restatesTheImprint(answer: Record<string, string> | undefined, side: PageSide | undefined, titledPublishers: string[]): boolean {
    if (side?.cover || !String(answer?.['발행일'] || '').trim() || String(answer?.['제목'] || '').trim())
        return false;
    const name = compactOf(String(answer?.['출판'] || '').split(/\s*[,，]\s*/)[0]);
    return name.length >= 4 && titledPublishers.some(value => compactOf(value).includes(name));
}
function titleRank(answer: Record<string, string> | undefined, side: PageSide | undefined): number {
    const place = side?.place;
    const role = place?.role || '';
    if (role === 'contents' || role === 'body' || role === 'references')
        return 6;
    if (role === 'insertedLeaf' && (place?.leaf === 'wrapper' || place?.leaf === 'foreignSize'))
        return 5;
    if (role === 'titlePage')
        return 0;
    if (role === 'formPage' || imprintPage(answer, side))
        return 4;
    if (role === 'cover')
        return 1;
    if (role === 'halfTitle')
        return 2;
    return 3;
}
function workTitlePage(order: number[], answer: (page: number) => Record<string, string>, side: (page: number) => PageSide | undefined): number | null {
    const candidates = order.filter(page => String(answer(page)['제목'] || '').trim() && !side(page)?.cover);
    if (!candidates.length)
        return null;
    const ranked = [...candidates].sort((a, b) => titleRank(answer(a), side(a)) - titleRank(answer(b), side(b)) || a - b);
    const best = statesMoreThanAHalfTitle(ranked, answer, side) ?? ranked[0];
    const colophons = order.filter(page => imprintPage(answer(page), side(page)));
    if (!colophons.length)
        return best;
    const printedOnAColophon = (page: number) => {
        const key = compactOf(answer(page)['제목']);
        return key.length >= 4 && colophons.some(colophon => colophon !== page
            && compactOf(`${side(colophon)?.printed || ''}\n${side(colophon)?.layer || ''}\n${answer(colophon)['제목'] || ''}`).includes(key));
    };
    if (printedOnAColophon(best))
        return best;
    const nested = (a: number, b: number) => { const x = compactOf(answer(a)['제목']), y = compactOf(answer(b)['제목']); return x.includes(y) || y.includes(x); };
    const bestRank = titleRank(answer(best), side(best));
    const mayStand = (page: number) => { const rank = titleRank(answer(page), side(page)); return rank === 0 || (rank === 3 && bestRank > 0); };
    return ranked.find(page => page !== best && mayStand(page) && printedOnAColophon(page) && !nested(page, best)) ?? best;
}
function statesMoreThanAHalfTitle(ranked: number[], answer: (page: number) => Record<string, string>, side: (page: number) => PageSide | undefined): number | null {
    const best = ranked[0];
    const held = answer(best);
    const key = compactOf(held['제목']);
    if (key.length < 4 || String(held['부제'] || '').trim() || String(held['저자'] || '').trim() || imprintPage(held, side(best)))
        return null;
    return ranked.find(page => {
        if (page === best || titleRank(answer(page), side(page)) >= 5)
            return false;
        const other = answer(page);
        const whole = compactOf(`${other['제목'] || ''} ${other['부제'] || ''}`);
        return !!String(other['저자'] || '').trim() && whole.length > key.length && whole.startsWith(key);
    }) ?? null;
}
function layerRows(layer: string): string[] {
    return String(layer || '').normalize('NFKC').split(/\r?\n/).map(row => row.replace(/\s+/g, ' ').trim()).filter(row => row && !FOLIO.test(row));
}
export function continuedOnNextPage(names: string[], next: string[], layer: string, nextLayer: string): boolean {
    if (names.length < 2 || !next.length || next.some(name => names.some(held => sameNameAs(held, name))))
        return false;
    const rows = layerRows(layer), after = layerRows(nextLayer);
    if (!rows.length || !after.length)
        return false;
    const rowsOfNames = (lines: string[], people: string[]): number[] | null => {
        const at: number[] = [];
        let from = 0;
        for (const name of people) {
            const key = compactOf(name);
            if (key.length < 2)
                return null;
            const found = lines.findIndex((line, index) => index >= from && compactOf(line).includes(key));
            if (found < 0)
                return null;
            at.push(found);
            from = found + 1;
        }
        return at;
    };
    const here = rowsOfNames(rows, names), there = rowsOfNames(after, next);
    if (!here || !there)
        return false;
    const headOf = (line: string) => line.split(' ')[0];
    const records = here.slice(1).map((end, index) => rows.slice(here[index], end).map(headOf).join('\u0001'));
    if (!records.length || records.some(record => record !== records[0]))
        return false;
    const record = records[0].split('\u0001');
    if (record.length < 2)
        return false;
    const tail = rows.slice(here[here.length - 1]).map(headOf), head = after.slice(0, there[0]).map(headOf);
    const joined = [...tail, ...head];
    return tail.length <= record.length && joined.length === record.length && joined.every((key, index) => key === record[index]);
}
const LIFE_DATES = /^(?:(?:1[5-9]|20)\d{2}\s*[-–]\s*(?:(?:1[5-9]|20)\d{2})?|[bd]\.\s*(?:1[5-9]|20)\d{2})\.?$/;
const NOT_A_GIVEN_NAME = /^(?:jr|sr|ii|iii|iv|inc|ltd|llc|co|corp|gmbh|ag|plc|ed|eds|editor|editors|trans|comp)\.?$/i;
export function catalogueHeadingAsName(entry: string): string {
    const value = entry.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!value || value.length > 120 || !/^[\p{Script=Latin}\s.,'’\-–\d]+$/u.test(value))
        return entry;
    const parts = value.split(',').map(part => part.trim());
    if (parts.length !== 3 || !LIFE_DATES.test(parts[2]))
        return entry;
    const surname = parts[0], given = (/(?:^|\s)\p{Lu}\.$/u.test(parts[1]) ? parts[1] : parts[1].replace(/\.$/, '')).trim();
    const surnameWords = surname.split(' '), givenWords = given.split(' ').filter(Boolean);
    const capitalised = (word: string) => /^\p{Lu}[\p{L}'’.-]*$/u.test(word);
    if (!surnameWords.length || surnameWords.length > 2 || !surnameWords.every(word => capitalised(word) && word.replace(/[^\p{L}]/gu, '').length >= 2))
        return entry;
    if (!givenWords.length || givenWords.length > 4 || !givenWords.every(capitalised) || givenWords.some(word => NOT_A_GIVEN_NAME.test(word)))
        return entry;
    return `${givenWords.join(' ')} ${surname}`;
}
function bylineAsThePagePrints(value: unknown, layer: string): string {
    const text = String(value ?? '').trim();
    if (!text)
        return '';
    const flat = String(layer || '').normalize('NFKC').replace(/\s+/g, ' ');
    const MARKS = ',;:·•';
    const bare = (token: string) => { let from = 0, to = token.length; while (from < to && MARKS.includes(token[from]))
        from++; while (to > from && MARKS.includes(token[to - 1]))
        to--; return token.slice(from, to); };
    const tokens = flat.trim() ? new Set(flat.split(' ').map(bare).filter(token => token.length >= 4)) : null;
    const asPrinted = (entry: string): string => {
        if (!tokens)
            return entry;
        const words = entry.split(/\s+/);
        if (entry.length > 200)
            return entry;
        for (let start = 0; start < words.length - 1; start++) {
            for (let end = Math.min(words.length - 1, start + 3); end > start; end--) {
                const glued = words.slice(start, end + 1).join('');
                if (!/[가-힣]/.test(glued) || !tokens.has(glued) || flat.includes(words.slice(start, end + 1).join(' ')) || !isOrganisationItem(glued))
                    continue;
                words.splice(start, end - start + 1, glued);
                break;
            }
        }
        return words.join(' ');
    };
    const kept: string[] = [];
    let changed = false;
    for (const piece of text.split(/[;；\n]/)) {
        const entry = piece.trim();
        if (!entry)
            continue;
        if (colophonLabelled(entry)) {
            changed = true;
            continue;
        }
        const printed = asPrinted(catalogueHeadingAsName(entry));
        if (printed !== entry)
            changed = true;
        kept.push(printed);
    }
    return changed ? kept.join('; ') : text;
}
function bylineAside(side: PageSide | undefined): boolean {
    const place = side?.place;
    return !!place && (place.role === 'contents' || place.role === 'references' || (place.role === 'insertedLeaf' && (place.leaf === 'wrapper' || place.leaf === 'foreignSize')));
}
function bylineOfPages(order: number[], answer: (page: number) => Record<string, string>, side: (page: number) => PageSide | undefined): string {
    const lists: Array<{
        page: number;
        through: number;
        value: string;
        tail: string;
    }> = [];
    for (const page of order) {
        if (side(page)?.cover)
            continue;
        const value = bylineAsThePagePrints(answer(page)['저자'], side(page)?.layer || '');
        if (!value)
            continue;
        const last = lists[lists.length - 1];
        if (last && page === last.through + 1 && continuedOnNextPage(bylineNames(last.tail), bylineNames(value), side(last.through)?.layer || '', side(page)?.layer || '')) {
            last.value = `${last.value}; ${value}`;
            last.through = page;
            last.tail = value;
            continue;
        }
        lists.push({ page, through: page, value, tail: value });
    }
    const held = lists.filter(list => !bylineAside(side(list.page))).map(list => list.value);
    return fullestByline(held) || fullestByline(lists.map(list => list.value));
}
function scriptOfValue(value: string): 'hangul' | 'cjk' | 'latin' | '' {
    if (/[가-힣]/.test(value))
        return 'hangul';
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value))
        return 'cjk';
    return /\p{Script=Latin}/u.test(value) ? 'latin' : '';
}
function publisherOfPages(order: number[], answer: (page: number) => Record<string, string>, imprint: (page: number) => boolean, language: string): string {
    let pool = order.map(page => ({ page, value: withoutPublisherTail(String(answer(page)['출판'] || '').trim()) })).filter(entry => entry.value);
    if (!pool.length)
        return '';
    const body = /^ko\b/i.test(language) ? 'hangul' : /^(?:ja|zh)\b/i.test(language) ? 'cjk' : language.trim() ? 'latin' : '';
    if (body && pool.some(entry => scriptOfValue(entry.value) === body) && pool.some(entry => scriptOfValue(entry.value) !== body)) {
        pool = pool.filter(entry => scriptOfValue(entry.value) === body);
    }
    const key = (value: string) => compactOf(value.replace(/[™℠®]/gu, ''));
    const covering = pool.filter(entry => pool.every(other => !key(other.value) || key(entry.value).includes(key(other.value))));
    if (covering.length) {
        const longest = Math.max(...covering.map(entry => key(entry.value).length));
        const first = covering.find(entry => key(entry.value).length === longest)!;
        const sameLetters = covering.filter(entry => entry.value.toLowerCase() === first.value.toLowerCase());
        return (sameLetters.find(entry => imprint(entry.page)) || (shouting(first.value) ? sameLetters.find(entry => !shouting(entry.value)) : undefined) || first).value;
    }
    return (pool.find(entry => imprint(entry.page)) || pool[0]).value;
}
function identifierWorth(value: string): number {
    const ids = identifiersIn(value);
    if (ids.DOI || ids.arXiv || ids.ISBN || ids.ISSN)
        return 3;
    if (ids.number)
        return 2;
    return /^\d+$/.test(value.normalize('NFKC').trim()) ? 0 : 1;
}
function identifierOfPages(order: number[], answer: (page: number) => Record<string, string>, imprint: (page: number) => boolean): string {
    const values = order.map(page => ({ page, value: String(answer(page)['식별자'] || '').trim() })).filter(entry => entry.value)
        .map(entry => ({ ...entry, worth: identifierWorth(entry.value) })).filter(entry => entry.worth > 0);
    if (!values.length)
        return '';
    const top = Math.max(...values.map(entry => entry.worth));
    const best = values.filter(entry => entry.worth === top);
    return (best.find(entry => imprint(entry.page)) || best[0]).value;
}
const yearOf = (value: unknown) => /(?<!\d)(?:1[5-9]|20)\d{2}(?!\d)/.exec(canonicalDate(value) || String(value ?? ''))?.[0] || '';
function dateOfPages(order: number[], answer: (page: number) => Record<string, string>, imprint: (page: number) => boolean, side: (page: number) => PageSide | undefined = () => undefined): string {
    const dated = order.filter(page => String(answer(page)['발행일'] || '').trim());
    if (!dated.length)
        return '';
    const stated = dated.find(imprint);
    const held = String(answer(stated ?? dated[0])['발행일']).trim();
    const printing = firstPrintingIn(`${side(stated ?? dated[0])?.printed || ''}\n${side(stated ?? dated[0])?.layer || ''}`);
    const heldDate = canonicalDate(held) || '';
    if (printing && heldDate && heldDate !== printing.chosen.date.value && printing.others.some(other => other.date.value === heldDate))
        return printing.chosen.date.value;
    if (stated === undefined)
        return held;
    const year = yearOf(held), fineness = (canonicalDate(held) || '').length;
    if (!year)
        return held;
    const finer = dated.map(page => String(answer(page)['발행일']).trim())
        .filter(value => yearOf(value) === year && (canonicalDate(value) || '').length > fineness)
        .sort((a, b) => (canonicalDate(b) || '').length - (canonicalDate(a) || '').length)[0];
    return finer || held;
}
function pagesOfPages(order: number[], answer: (page: number) => Record<string, string>): string {
    for (const page of order) {
        const value = String(answer(page)['페이지'] || '').trim();
        if (value && pagesAsWritten(value, answer(page)['출판']))
            return value;
    }
    return '';
}
function gatherPages(state: PageMerge): void {
    const order = Object.keys(state.pageFields).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const side = (page: number) => state.sides[String(page)];
    const answer = (page: number) => state.pageFields[String(page)] || {};
    const lent = (page: number) => {
        const own = answer(page);
        if (!side(page)?.cover)
            return own;
        return Object.fromEntries(Object.entries(own).filter(([name]) => !COVER_WITHHELD.includes(name) && !COVER_YIELDS.includes(name)));
    };
    const first = (name: string) => { const page = order.find(number => String(lent(number)[name] || '').trim()); return page === undefined ? '' : String(lent(page)[name]).trim(); };
    const out: Record<string, string> = {};
    const say = (name: string, value: unknown) => { const text = String(value ?? '').trim(); if (text)
        out[name] = text; };
    const titlePage = workTitlePage(order, lent, side);
    const type = String((titlePage !== null && lent(titlePage)['유형']) || first('유형') || '').trim();
    say('유형', type);
    const articleLike = /^(?:journalArticle|magazineArticle|newspaperArticle|conferencePaper)$/i.test(type);
    const titledPublishers = order.filter(page => !side(page)?.cover && String(lent(page)['제목'] || '').trim()).map(page => String(lent(page)['출판'] || '')).filter(Boolean);
    const imprint = (page: number) => !articleLike && (imprintPage(lent(page), side(page)) || restatesTheImprint(lent(page), side(page), titledPublishers));
    if (titlePage !== null) {
        let title = String(lent(titlePage)['제목'] || '').trim(), subtitle = String(lent(titlePage)['부제'] || '').trim();
        const same = order.filter(page => page !== titlePage && !side(page)?.cover && compactOf(lent(page)['제목']) === compactOf(title));
        if (shouting(title)) {
            const cased = same.find(page => !shouting(String(lent(page)['제목'])));
            if (cased !== undefined)
                title = String(lent(cased)['제목']).trim();
        }
        if (shouting(title) && subtitle) {
            const whole = compactOf(`${title} ${subtitle}`);
            for (const page of order) {
                if (page === titlePage || side(page)?.cover)
                    continue;
                const written = String(lent(page)['제목'] || '').trim();
                if (shouting(written) || compactOf(written) !== whole)
                    continue;
                const cut = /\s*[:：]\s+|\s+[-–—]\s+/u.exec(written);
                if (!cut || compactOf(written.slice(0, cut.index)) !== compactOf(title))
                    continue;
                title = written.slice(0, cut.index).trim();
                if (shouting(subtitle))
                    subtitle = written.slice(cut.index + cut[0].length).trim();
                break;
            }
        }
        if (!subtitle)
            subtitle = same.map(page => String(lent(page)['부제'] || '').trim()).find(Boolean) || '';
        else if (shouting(subtitle))
            subtitle = same.map(page => String(lent(page)['부제'] || '').trim()).find(value => value && !shouting(value) && compactOf(value) === compactOf(subtitle)) || subtitle;
        say('제목', title);
        say('부제', subtitle);
    }
    const language = String((titlePage !== null && lent(titlePage)['언어']) || first('언어') || '').trim();
    say('저자', bylineOfPages(order, lent, side));
    say('학위', first('학위'));
    say('출판', publisherOfPages(order, lent, imprint, language));
    say('권호', first('권호'));
    say('페이지', pagesOfPages(order, lent));
    say('발행일', dateOfPages(order, lent, imprint, side));
    say('식별자', identifierOfPages(order, lent, imprint));
    say('언어', language);
    for (const name of Object.keys(state.fields))
        delete state.fields[name];
    Object.assign(state.fields, out);
    for (const name of Object.keys(state.coverHeld))
        delete state.coverHeld[name];
    const coverByline = order.filter(page => side(page)?.cover).map(page => bylineAsThePagePrints(answer(page)['저자'], side(page)?.layer || '')).find(Boolean);
    if (coverByline)
        state.coverHeld['저자'] = coverByline;
    state.titlePage = titlePage;
    state.colophonPage = order.find(page => page !== titlePage && imprint(page)) ?? null;
}
function mergePageAnswer(state: PageMerge, page: number, named: Record<string, string>, printed: string, layer: string, place: PagePlace | null = null): boolean {
    const folio = folioOnly(named);
    const cover = !folio && coverOfASerial({ 유형: state.fields['유형'] || '', ...named }, printed, layer);
    const own = folio ? {} : ownContribution(named, state.fields);
    state.pageFields[String(page)] = own;
    state.sides[String(page)] = { printed, layer, place, cover };
    gatherPages(state);
    return folio;
}
function finishMerge(state: PageMerge): void {
    for (const [name, value] of Object.entries(state.coverHeld))
        if (!state.fields[name])
            state.fields[name] = value;
}
export function remergedPages(pageFields: Record<string, Record<string, string>>, text = '', stored?: Record<string, string> | null, reading: VisionReadOptions['layerText'] | VisionReadOptions = undefined): {
    fields: Record<string, string>;
    pageFields: Record<string, Record<string, string>>;
    titlePage: number | null;
    colophonPage: number | null;
} {
    const options: VisionReadOptions = typeof reading === 'function' ? { layerText: reading } : (reading || {});
    const state = newMerge();
    for (const page of Object.keys(pageFields || {}).sort((a, b) => Number(a) - Number(b))) {
        mergePageAnswer(state, Number(page), { ...(pageFields[page] || {}) }, printedOnPage(text, page), layerOf(options.layerText, Number(page)), placeAt(options, Number(page)));
    }
    finishMerge(state);
    const fields = stored && typeof stored === 'object'
        ? Object.fromEntries(Object.entries(state.fields).filter(([name]) => String(stored[name] ?? '').trim()))
        : state.fields;
    return { fields, pageFields: state.pageFields, titlePage: state.titlePage, colophonPage: state.colophonPage };
}
const COVER_WITHHELD = ['제목', '부제', '권호', '페이지'];
const COVER_YIELDS = ['저자'];
const FOLIO = /^[-–—\s]*\d+[-–—\s]*$/;
export function folioOnly(named: Record<string, string>): boolean {
    const bibliographic = Object.keys(named).filter(name => name !== '언어' && name !== '유형');
    return bibliographic.length === 1 && bibliographic[0] === '페이지' && FOLIO.test(String(named['페이지'] || ''));
}
function pageInstruction(page: number, earlier: Record<string, string> | null): string {
    const lines = ['이 이미지는 이 문서의 ' + page + '쪽이다.'];
    if (earlier)
        lines.push(summaryOfEarlierPages(earlier), LATER_PAGE_RULE);
    return [...lines, '', PAGE_PROMPT].join(String.fromCharCode(10));
}
function messageText(value: unknown): string {
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value))
        return value.map(messageText).filter(Boolean).join('\n');
    if (!value || typeof value !== 'object')
        return '';
    const object = value as Record<string, unknown>;
    for (const key of ['text', 'content', 'value', 'output_text']) {
        const found = messageText(object[key]);
        if (found)
            return found;
    }
    return '';
}
function responseAnswer(response: any): string {
    const body = response?.response ?? response;
    const choice = body?.choices?.[0];
    return messageText(choice?.message?.content ?? choice?.text ?? body?.output_text ?? body?.content);
}
function finishReason(response: any): string {
    const body = response?.response ?? response;
    return String(body?.choices?.[0]?.finish_reason ?? '').trim();
}
const SCAFFOLD_LINE = /^(?:\[?항목\]?|\[?표제면\s*원문\]?|(?:유형|제목|부제|저자|학위|출판|권호|페이지|발행일|식별자|언어)\s*[:：]\s*)$/;
function answerNote(answer: string, finish: string): string {
    if (!answer.trim())
        return '(빈 답' + (finish ? ', finish_reason=' + finish : '') + ')';
    const said = answer.split(/\r?\n/).map(line => line.trim()).filter(line => line && !SCAFFOLD_LINE.test(line));
    const note = said.length ? said.join(' / ').replace(/\s+/g, ' ').slice(0, 160) : '(빈 칸만 답함)';
    return finish === 'length' ? note + ' (finish_reason=length)' : note;
}
const VISION_PAGE_TOKENS = 700;
const BODY_STARTS_HERE = ['\nABSTRACT', '\nAbstract', '\n초  록', '\n초록', '\n요  약', '\n요약', '\nKeywords', '\nKey words', '\nKEY WORDS', '\n주제어', '\n핵심어',
    '\n1. Introduction', '\nI. Introduction', '\n1. 서론', '\nⅠ. 서론', '\n1. 서 론', '\n참고문헌', '\nReferences'];
const VISION_MAX_PAGES = 8;
function chatURL(endpoint: string): string {
    const url = new URL(String(endpoint || '').trim().replace(/\/$/, '') + '/chat/completions');
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
        || url.username || url.password)
        throw new Error('LM Studio 주소는 localhost 또는 127.0.0.1만 허용됩니다.');
    return url.href;
}
function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}
async function requestOrCancel(url: string, options: any, cancelled: () => boolean): Promise<any> {
    let transport: any = null;
    let watcher = 0;
    const observed = { ...options, requestObserver: (xhr: any) => { transport = xhr; options.requestObserver?.(xhr); } };
    const stopped = new Promise((_resolve, reject) => {
        watcher = setInterval(() => {
            if (!cancelled())
                return;
            clearInterval(watcher);
            watcher = 0;
            try {
                transport?.abort?.();
            }
            catch { }
            reject(new Error('Cancelled'));
        }, 250) as unknown as number;
    });
    try {
        return await Promise.race([Zotero.HTTP.request('POST', url, observed), stopped]);
    }
    finally {
        if (watcher)
            clearInterval(watcher);
    }
}
const OVER_CONTEXT = /exceed(?:s|_)_?context|exceeds the available context size|n_prompt_tokens/i;
const ENGINE_STALLED = /failed to process mtmd chunk|bad allocation|Engine protocol predict/i;
export function engineStalled(detail: unknown): boolean {
    const text = String(detail || '');
    return ENGINE_STALLED.test(text) && !OVER_CONTEXT.test(text);
}
const RELOAD_MODEL = 'LM Studio 비전 엔진이 응답할 수 없는 상태입니다. LM Studio에서 해당 VLM을 Eject 후 다시 Load한 뒤 재시도하세요.';
async function removeRendered(files: string[], directory: string): Promise<void> {
    for (const file of files) {
        try {
            if (await IOUtils.exists(file))
                await IOUtils.remove(file);
        }
        catch { }
    }
    try {
        if (await IOUtils.exists(directory))
            await IOUtils.remove(directory);
    }
    catch { }
}
export type VisionStop = 'complete' | 'limit';
export interface VisionOCRResult extends OCRResult {
    read?: number[];
    stoppedBecause?: VisionStop;
    nothingPrinted?: boolean;
    answers?: Record<string, string>;
    readOn?: Array<{
        page: number;
        because: ReadOnReason;
    }>;
    abstained?: boolean;
    whitePages?: number[];
    renderFailed?: number[];
    titlePage?: number;
    colophonPage?: number;
}
export function whiteVerdict(page: number, reading: VisionReadOptions, drewInk: boolean, speaks: boolean): 'blank' | 'failed' {
    if (pageCarriesWords(layerOf(reading.layerText, page)))
        return 'failed';
    if (drewInk)
        return 'blank';
    return speaks && placeAt(reading, page)?.layer === 'none' ? 'blank' : 'failed';
}
export function saidNothing(answer: unknown): boolean {
    return String(answer ?? '').split(/\r?\n/).map(line => line.trim())
        .every(line => !line || NEXT_PAGE_LINE.test(line) || SCAFFOLD_LINE.test(line) || /^```\w*$/.test(line));
}
function noteSaysNothing(note: unknown): boolean {
    return String(note ?? '').split(' / ').map(piece => piece.trim())
        .every(piece => !piece || NEXT_PAGE_LINE.test(piece) || /^\((?:빈 답[^)]*|빈 칸만 답함)\)$/.test(piece));
}
export function abstainedEverywhere(result: Partial<VisionOCRResult> | null | undefined): boolean {
    if (!result?.nothingPrinted || !(result.read || []).length)
        return false;
    if (result.abstained === true)
        return true;
    const answers = result.answers || {};
    return (result.read || []).every(page => noteSaysNothing(answers[String(page)]));
}
function readLabel(read: unknown, stoppedBecause: unknown): string {
    if (!Array.isArray(read) || !read.length)
        return '';
    return ', ' + read.join('·') + '쪽 ' + (stoppedBecause === 'complete' ? '읽고 멈춤' : '읽음');
}
const NOTHING_PRINTED_LABEL = ', 서지 없음';
export async function runLMStudioVisionOCR(attachment: any, pdfFingerprint: string, requestedPages: number, settings: LMStudioSettings, cancelled: () => boolean = () => false, render: VisionRenderOptions & VisionReadOptions = {}): Promise<VisionOCRResult> {
    let pending: any = null;
    const reading: VisionReadOptions = { layerText: render.layerText, documentPages: render.documentPages, insertedLeaf: render.insertedLeaf, pagePlace: render.pagePlace };
    if (Services.appinfo.OS !== 'WINNT')
        throw new Error('LM Studio 비전 OCR용 PDF 페이지 렌더링은 현재 Windows에서만 지원됩니다.');
    if (!settings.visionModel)
        throw new Error('LM Studio 설정에서 비전(VLM) 모델을 선택하세요.');
    const pages = Math.min(VISION_MAX_PAGES, normalizeOCRPageLimit(requestedPages));
    const knownPages = Number(reading.documentPages) > 0 ? Math.floor(Number(reading.documentPages)) : VISION_MAX_PAGES;
    const reach = Math.max(pages, Math.min(VISION_MAX_PAGES, knownPages));
    const width = (VISION_STEPS.find(step => step.width === Number(render.width)) || VISION_STEPS[0]).width;
    const renderLabel = `${width}px`;
    const root = PathUtils.join(Zotero.DataDirectory.dir, 'pdf-metadata-refresh-ocr');
    await IOUtils.makeDirectory(root, { ignoreExisting: true, createAncestors: true });
    const modelStem = settings.visionModel.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 72);
    const stem = `vision-${attachment.libraryID || 0}-${attachment.key}-${pages}p${width}-${modelStem}-${PROMPT_FAMILY}`.replace(/[^A-Za-z0-9_-]/g, '_');
    const textPath = PathUtils.join(root, `${stem}.txt`), metaPath = PathUtils.join(root, `${stem}.json`);
    if (await IOUtils.exists(textPath) && await IOUtils.exists(metaPath)) {
        try {
            const meta = await IOUtils.readJSON(metaPath);
            if (meta.engine === RENDER_VERSION && sameFile(meta.pdfFingerprint, pdfFingerprint) && meta.pages === pages
                && meta.model === settings.visionModel && (meta.width || VISION_STEPS[0].width) === width && (meta.region || 'full') === 'full'
                && !meta.onlyPage && COMPATIBLE_PROMPTS.has(meta.prompt || 'p1')) {
                const text = String(await Zotero.File.getContentsAsync(textPath, 'utf-8', 500000));
                const read = Array.isArray(meta.read) ? meta.read : undefined;
                const replayed = meta.pageFields && typeof meta.pageFields === 'object'
                    ? remergedPages(meta.pageFields, text, meta.fields, reading) : { fields: meta.fields, pageFields: meta.pageFields, titlePage: null, colophonPage: null };
                const readable = Math.min(pages, Number(reading.documentPages) > 0 ? Number(reading.documentPages) : pages);
                const lastRead = Math.max(0, ...(read || []).map(Number).filter(Number.isFinite));
                const leavesSpent = !Number(meta.reach) && meta.stoppedBecause === 'limit' && !String(replayed.fields?.['제목'] || '').trim()
                    && lastRead >= pages && lastRead < reach && pagesCounted(read, replayed.pageFields, reading) < pages;
                const reached = Math.max(lastRead, ...(Array.isArray(meta.whitePages) ? meta.whitePages : []).map(Number).filter(Number.isFinite));
                const lastPage = Math.min(reach, Number(meta.reach), knownPages, Number(meta.rendered) > 0 && Number(meta.rendered) < pages ? Number(meta.rendered) : Infinity);
                const recounted = (Array.isArray(meta.whitePages) && meta.whitePages.length > 0)
                    || (read || []).some((page: unknown) => listOfOtherWorks(Number(page), replayed.pageFields?.[String(page)], reading));
                const budgetLeft = !leavesSpent && recounted && meta.stoppedBecause === 'limit' && Number(meta.reach) > 0 && reached < lastPage
                    && pagesCounted(read, replayed.pageFields, reading) < pages;
                const ruledOn = meta.stoppedBecause === 'complete' && !!replayed.pageFields && Array.isArray(read)
                    && readOnReason(replayed.fields || {}, replayed.pageFields, read, lastRead, reading, reach, page => printedOnPage(text, String(page))) !== null;
                const nothingPrinted = meta.nothingPrinted === true && !text.trim();
                const answers = meta.answers && typeof meta.answers === 'object' ? meta.answers : {};
                const whiteSuspect = nothingPrinted && meta.inkChecked !== true
                    && abstainedEverywhere({ nothingPrinted: true, read, answers, ...(meta.abstained === true ? { abstained: true } : {}) });
                const stale = (meta.stoppedBecause === 'complete' && (!coreComplete(replayed.fields || {}) || ruledOn) && (read || []).length < readable) || leavesSpent
                    || budgetLeft || whiteSuspect;
                if (!stale && (text.trim() || nothingPrinted) && meta.fields && meta.pageFields)
                    return { text, pages, fields: replayed.fields, pageFields: replayed.pageFields,
                        ...(replayed.titlePage ? { titlePage: replayed.titlePage } : {}), ...(replayed.colophonPage ? { colophonPage: replayed.colophonPage } : {}), read, stoppedBecause: meta.stoppedBecause, ...(Array.isArray(meta.readOn) && meta.readOn.length ? { readOn: meta.readOn } : {}),
                        ...(Array.isArray(meta.whitePages) && meta.whitePages.length ? { whitePages: meta.whitePages } : {}),
                        ...(nothingPrinted ? { nothingPrinted: true, answers, ...(meta.abstained === true ? { abstained: true } : {}) } : {}),
                        cacheHit: true, provider: `LM Studio 비전 OCR (${settings.visionModel}, ${renderLabel}${readLabel(meta.read, meta.stoppedBecause)}${nothingPrinted ? NOTHING_PRINTED_LABEL : ''})` };
            }
        }
        catch (cause) {
            Zotero.debug(`[PDF Metadata Refresh] LM Studio vision cache ignored: ${String(cause)}`);
        }
    }
    const scriptPath = PathUtils.join(root, `${RENDER_SCRIPT}.ps1`);
    if (!await IOUtils.exists(scriptPath)) {
        try {
            await IOUtils.writeUTF8(scriptPath, renderPagesScript);
        }
        catch (cause) {
            if (!await IOUtils.exists(scriptPath))
                throw cause;
        }
    }
    const pdfPath = await attachment.getFilePath();
    if (!pdfPath || !await IOUtils.exists(pdfPath))
        throw new Error('비전 OCR할 PDF 파일을 찾을 수 없습니다.');
    const nonce = `${Date.now()}-${Math.floor(Math.random() * 0x1000000).toString(16)}`;
    const renderDirectory = PathUtils.join(root, `render-${attachment.key}-${nonce}`.replace(/[^A-Za-z0-9_-]/g, '_'));
    const directories = [renderDirectory];
    await IOUtils.makeDirectory(renderDirectory, { ignoreExisting: false, createAncestors: false });
    let rendered: string[] = [];
    try {
        const systemRoot = Services.env.get('SystemRoot') || 'C:\\Windows';
        const powershell = PathUtils.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        if (!await IOUtils.exists(powershell))
            throw new Error('Windows PowerShell을 찾을 수 없어 PDF 페이지를 렌더링할 수 없습니다.');
        const white = new Set<string>();
        let drewInk = false;
        const renderInto = async (directory: string, count: number, extra: string[] = []): Promise<string[]> => {
            const donePath = PathUtils.join(directory, 'render.done');
            const errorPath = PathUtils.join(directory, 'render.error');
            const rendering = Zotero.Utilities.Internal.subprocess(powershell, [
                '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
                '-PdfPath', pdfPath, '-MaxPages', String(count), '-OutputDirectory', directory,
                '-Width', String(width), ...extra
            ]);
            await Promise.race([rendering, new Promise((resolve, reject) => {
                    let waited = 0;
                    const watcher = setInterval(() => {
                        waited += 250;
                        if (cancelled()) {
                            clearInterval(watcher);
                            reject(new Error('Cancelled'));
                            return;
                        }
                        if (waited >= RENDER_TIMEOUT) {
                            clearInterval(watcher);
                            reject(new Error(`PDF 이미지 렌더링이 ${Math.round(RENDER_TIMEOUT / 1000)}초 안에 끝나지 않았습니다.`));
                            return;
                        }
                        if (waited % 1000 === 0) { }
                    }, 250);
                    rendering.then(() => { clearInterval(watcher); resolve(undefined); }, (cause: unknown) => { clearInterval(watcher); reject(cause); });
                })]);
            for (let attempt = 0; attempt < 300 && !await IOUtils.exists(donePath) && !await IOUtils.exists(errorPath); attempt++) {
                if (cancelled())
                    throw new Error('Cancelled');
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            const children: string[] = await IOUtils.getChildren(directory);
            const files = children.filter((path: string) => /page-\d{3}\.png$/i.test(path)).sort().slice(0, count);
            if (!files.length) {
                const detail = await IOUtils.exists(errorPath) ? String(await Zotero.File.getContentsAsync(errorPath, 'utf-8', 12000)).trim()
                    : await IOUtils.exists(donePath) ? 'Windows PDF 렌더러가 페이지를 0쪽 반환했습니다. PDF가 손상됐거나 암호로 보호돼 있을 수 있습니다.'
                        : '렌더링 helper가 60초 안에 응답하지 않았습니다.';
                throw new Error(`LM Studio 비전 OCR용 PDF 이미지를 만들지 못했습니다. ${detail}`);
            }
            const marked = new Set(children.filter((path: string) => /page-\d{3}\.blank$/i.test(path)).map((path: string) => path.replace(/\.blank$/i, '.png')));
            for (const file of files) {
                if (marked.has(file))
                    white.add(file);
                else
                    drewInk = true;
            }
            return files;
        };
        rendered = await renderInto(renderDirectory, pages);
        let renderedFor = pages;
        const renderReach = async () => {
            renderedFor = reach;
            try {
                const directory = PathUtils.join(root, `render-${attachment.key}-${nonce}-${reach}`.replace(/[^A-Za-z0-9_-]/g, '_'));
                await IOUtils.makeDirectory(directory, { ignoreExisting: false, createAncestors: false });
                directories.push(directory);
                const more = await renderInto(directory, reach);
                if (more.length > rendered.length)
                    rendered = more;
            }
            catch (cause) {
                if (cancelled())
                    throw cause;
                Zotero.debug(`[PDF Metadata Refresh] LM Studio vision: rendering up to page ${reach} failed: ${String(cause)}`);
            }
        };
        const redrawn = new Set<number>();
        const REDRAWS: readonly string[][] = [[], [], ['-NoInkCrop']];
        const pageOfImage = (file: string) => Number(/page-(\d{3})\.png$/i.exec(file)?.[1] || 0);
        const redrawWhite = async (from: number): Promise<void> => {
            const wanted = rendered.map((file, at) => at >= from && white.has(file) && !redrawn.has(at + 1) ? at + 1 : 0).filter(page => page > 0);
            for (const page of wanted)
                redrawn.add(page);
            for (const [attempt, extra] of REDRAWS.entries()) {
                const still = wanted.filter(page => white.has(rendered[page - 1]));
                if (!still.length)
                    return;
                if (cancelled())
                    throw new Error('Cancelled');
                try {
                    const directory = PathUtils.join(root, `render-${attachment.key}-${nonce}-white${from + 1}-${attempt + 1}`.replace(/[^A-Za-z0-9_-]/g, '_'));
                    await IOUtils.makeDirectory(directory, { ignoreExisting: false, createAncestors: false });
                    directories.push(directory);
                    const again = await renderInto(directory, Math.max(...still), ['-OnlyPages', still.join(','), ...extra]);
                    for (const file of again) {
                        const page = pageOfImage(file);
                        if (still.includes(page) && !white.has(file))
                            rendered[page - 1] = file;
                    }
                }
                catch (cause) {
                    if (cancelled())
                        throw cause;
                    Zotero.debug(`[PDF Metadata Refresh] LM Studio vision: redrawing white page(s) ${still.join(',')} failed: ${String(cause)}`);
                }
            }
        };
        const failures: string[] = [];
        const spent: number[] = [];
        const fields: Record<string, string> = {};
        const pageFields: Record<string, Record<string, string>> = {};
        const parts: string[] = [];
        const read: number[] = [];
        const answers: Record<string, string> = {};
        const blank = new Map<number, string>();
        const coverHeld: Record<string, string> = {};
        const merge: PageMerge = newMerge(fields, pageFields, coverHeld);
        let stoppedBecause: VisionStop = 'limit';
        let counted = 0, seen = false;
        const speaks = layerSpeaks(reading, reach);
        const readOn: Array<{
            page: number;
            because: ReadOnReason;
        }> = [];
        const silent = new Set<number>();
        const whitePages: number[] = [];
        const renderFailed: number[] = [];
        let versoRead = false;
        const askPage = async (index: number, summary: Record<string, string> | null, lost: boolean): Promise<{
            answer: string;
            finish: string;
        } | null> => {
            const page = index + 1;
            const where = page + '쪽';
            const bytes = await IOUtils.read(rendered[index], { maxBytes: 8000000 });
            const content: any[] = [
                { type: 'text', text: pageInstruction(page, summary) },
                { type: 'image_url', image_url: { url: 'data:image/png;base64,' + bytesToBase64(bytes) } }
            ];
            const body = JSON.stringify({
                model: settings.visionModel,
                messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content }],
                temperature: 0, max_tokens: VISION_PAGE_TOKENS, stream: false,
                stop: BODY_STARTS_HERE
            });
            for (let attempt = 0; attempt < 2; attempt++) {
                if (cancelled())
                    throw new Error('Cancelled');
                try {
                    const response = await requestOrCancel(chatURL(settings.endpoint), {
                        headers: { 'Content-Type': 'application/json' }, responseType: 'json', timeout: VISION_REQUEST_TIMEOUT,
                        requestObserver: (xhr: any) => { pending = xhr; }, body
                    }, cancelled);
                    const promptTokens = Number(response.response?.usage?.prompt_tokens);
                    if (Number.isFinite(promptTokens) && promptTokens > 0)
                        spent.push(promptTokens);
                    return { answer: responseAnswer(response), finish: finishReason(response) };
                }
                catch (cause) {
                    if (cancelled())
                        throw cause;
                    const detail = failureDetail(cause);
                    if (engineStalled(detail))
                        throw new Error(RELOAD_MODEL + ' (' + where + '에서 중단: ' + detail.slice(0, 200) + ')');
                    Zotero.debug('[PDF Metadata Refresh] LM Studio vision ' + where + ' failed' + (attempt ? ' again' : '') + ': ' + detail);
                    if (attempt && lost)
                        failures.push(where + ': ' + detail);
                }
            }
            return null;
        };
        const goOn = async (index: number): Promise<boolean> => {
            if (counted >= pages) {
                if (versoRead || merge.titlePage !== index + 1 || String(fields['발행일'] || '').trim() || index + 2 > reach)
                    return false;
                versoRead = true;
                readOn.push({ page: index + 1, because: 'titlePageVerso' });
            }
            if (index + 1 >= rendered.length && rendered.length >= renderedFor && renderedFor < reach)
                await renderReach();
            return true;
        };
        for (let index = 0; index < rendered.length; index++) {
            if (cancelled())
                throw new Error('Cancelled');
            const page = index + 1;
            if (white.has(rendered[index]) && !redrawn.has(page))
                await redrawWhite(index);
            if (white.has(rendered[index])) {
                if (whiteVerdict(page, reading, drewInk, speaks) === 'blank') {
                    whitePages.push(page);
                    if (!seen && !freeLeaf(page, {}, reading))
                        seen = true;
                }
                else {
                    renderFailed.push(page);
                    counted++;
                }
                if (!await goOn(index))
                    break;
                continue;
            }
            const asked = await askPage(index, index ? fields : null, true);
            if (asked === null) {
                counted++;
                if (!await goOn(index))
                    break;
                continue;
            }
            const { answer, finish } = asked;
            read.push(page);
            answers[String(page)] = answerNote(answer, finish);
            if (!answer.trim())
                blank.set(page, finish);
            if (saidNothing(answer))
                silent.add(page);
            const section = sectionForPage(answer);
            const named = fieldsFromAnswer(section);
            const printed = pageTextFromAnswer(section);
            const folio = mergePageAnswer(merge, page, named, printed, layerOf(reading.layerText, page), placeAt(reading, page));
            const kept = folio && printed.split(/\n/).every(line => FOLIO.test(line)) ? '' : printed;
            if (kept)
                parts.push('--- PAGE ' + page + ' ---' + String.fromCharCode(10) + kept);
            if (spendsBudget(page, pageFields[String(page)], reading, seen, speaks))
                counted++;
            if (!seen && !freeLeaf(page, pageFields[String(page)], reading))
                seen = true;
            if (!nextPageNeeded(answer) && coreComplete(fields)) {
                const because = readOnReason(fields, pageFields, read, page, reading, reach, number => number === page ? printed : printedOnPage(parts.join('\n\f\n'), String(number)));
                if (!because) {
                    stoppedBecause = 'complete';
                    break;
                }
                readOn.push({ page, because });
            }
            if (!await goOn(index))
                break;
        }
        const again = cancelled() ? null : colophonToAskAgain(fields, pageFields, read, page => merge.sides[String(page)], merge.colophonPage);
        if (again !== null && rendered[again - 1] && !white.has(rendered[again - 1])) {
            const asked = await askPage(again - 1, fields, false);
            const named = asked ? fieldsFromAnswer(sectionForPage(asked.answer)) : {};
            if (asked && identifiersIn(named['식별자']).ISBN) {
                const side = merge.sides[String(again)];
                mergePageAnswer(merge, again, { ...(pageFields[String(again)] || {}), 식별자: named['식별자'] }, side?.printed || '', side?.layer || '', side?.place || null);
                const printedAgain = pageTextFromAnswer(sectionForPage(asked.answer));
                const at = parts.findIndex(part => part.startsWith('--- PAGE ' + again + ' ---'));
                const added = printedAgain.split(/\n/).filter(line => line.trim() && printsAnISBN(line) && !(at >= 0 && parts[at].includes(line.trim())));
                if (at >= 0 && added.length)
                    parts[at] += String.fromCharCode(10) + added.join(String.fromCharCode(10));
            }
            readOn.push({ page: again, because: 'colophonIdentifier' });
        }
        finishMerge(merge);
        const text = parts.join('\n\f\n');
        const cost = spent.length ? ', 프롬프트 ' + Math.max(...spent).toLocaleString() + '토큰/요청' : '';
        const drawn = (whitePages.length ? ', ' + whitePages.join('·') + '쪽 하얀 쪽(빈 쪽으로 보고 보내지 않음)' : '')
            + (renderFailed.length ? ', ' + renderFailed.join('·') + '쪽 렌더 실패(다시 그려도 하얀 이미지 — 보내지 않음)' : '');
        const drawnResult = { ...(whitePages.length ? { whitePages } : {}), ...(renderFailed.length ? { renderFailed } : {}) };
        const unrendered = () => Object.assign(new Error('LM Studio 비전 OCR용 쪽 이미지를 그리지 못했습니다 — ' + renderFailed.join('·') + '쪽이 새 렌더러로 두 번, 자르지 않고 '
            + '한 번 더 그려도 하얀 이미지입니다(렌더 실패). 하얀 쪽은 모델에게 보내지 않았고, 이 판독은 「서지 없음」이 아닙니다 — 다음 실행이 다시 그립니다.'
            + (read.length ? ' 읽은 ' + read.join('·') + '쪽에서는 이 문서의 서지를 찾지 못했습니다.' : '') + (failures.length ? ' ' + failures[0] : '')), { renderFailed });
        if (!text) {
            if (renderFailed.length)
                throw unrendered();
            if (!read.length)
                throw new Error(`LM Studio 비전 모델이 OCR 텍스트를 반환하지 않았습니다 — 모든 쪽 요청이 실패했습니다. ${failures[0] || ''}`.trim());
            if (read.every(page => blank.has(page))) {
                const reasons = [...new Set(read.map(page => blank.get(page)).filter(Boolean))];
                throw Object.assign(new Error(`LM Studio 비전 모델이 ${read.join('·')}쪽에 빈 답을 보냈습니다${reasons.length ? ` (finish_reason=${reasons.join('/')})` : ''}. `
                    + `추론형 VLM이면 쪽당 출력 상한 VISION_PAGE_TOKENS(${VISION_PAGE_TOKENS}토큰)을 추론에 다 써서 답을 적지 못했을 수 있습니다 — `
                    + `추론을 끄거나 다른 VLM을 고르세요.${failures.length ? ` ${failures[0]}` : ''}`), failures.length ? {} : { abstained: true });
            }
            if (failures.length)
                throw new Error(`LM Studio 비전 모델이 OCR 텍스트를 반환하지 않았습니다. ${failures[0]}`);
            const abstained = read.every(page => silent.has(page));
            await IOUtils.writeUTF8(textPath, '');
            await IOUtils.writeJSON(metaPath, { engine: RENDER_VERSION, pdfFingerprint, pages, reach, rendered: rendered.length, read, stoppedBecause, fields, pageFields,
                nothingPrinted: true, answers, ...(abstained ? { abstained: true } : {}), ...(readOn.length ? { readOn } : {}), ...drawnResult, inkChecked: true,
                model: settings.visionModel, width, region: 'full', prompt: PROMPT_VERSION, savedAt: Date.now() }, { tmpPath: metaPath + '.tmp' });
            return { text: '', pages, cacheHit: false, promptTokens: spent, fields, pageFields, ...(merge.titlePage ? { titlePage: merge.titlePage } : {}), ...(merge.colophonPage ? { colophonPage: merge.colophonPage } : {}), read, stoppedBecause, nothingPrinted: true, answers,
                ...(abstained ? { abstained: true } : {}), ...(readOn.length ? { readOn } : {}), ...drawnResult,
                provider: 'LM Studio 비전 OCR (' + settings.visionModel + ', ' + renderLabel + readLabel(read, stoppedBecause) + cost + drawn + NOTHING_PRINTED_LABEL + ')' };
        }
        if (!failures.length && !renderFailed.length) {
            await IOUtils.writeUTF8(textPath, text);
            await IOUtils.writeJSON(metaPath, { engine: RENDER_VERSION, pdfFingerprint, pages, reach, rendered: rendered.length, read, stoppedBecause, fields, pageFields,
                ...(readOn.length ? { readOn } : {}), ...drawnResult, inkChecked: true, model: settings.visionModel, width, region: 'full', prompt: PROMPT_VERSION, savedAt: Date.now() }, { tmpPath: metaPath + '.tmp' });
        }
        const lost = failures.length ? ', ' + failures.length + '쪽 읽지 못함' : '';
        return { text, pages, cacheHit: false, promptTokens: spent, fields, pageFields, ...(merge.titlePage ? { titlePage: merge.titlePage } : {}), ...(merge.colophonPage ? { colophonPage: merge.colophonPage } : {}), read, stoppedBecause, ...(readOn.length ? { readOn } : {}), ...drawnResult,
            provider: 'LM Studio 비전 OCR (' + settings.visionModel + ', ' + renderLabel + readLabel(read, stoppedBecause) + cost + drawn + lost + ')' };
    }
    finally {
        try {
            pending?.abort?.();
        }
        catch { }
        for (const directory of directories) {
            const children = await IOUtils.getChildren(directory).catch(() => [] as string[]);
            await removeRendered(children, directory);
        }
    }
}

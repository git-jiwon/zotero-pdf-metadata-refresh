import { BYLINE_MEANINGS, COLOPHON_LABEL_SOURCE, KOREAN_ROLE_FORMS, MARKED_ROLE_FORMS, MEMBERSHIP_GRADE, PUBLISHER_TAIL_SOURCE, SOCIETY_ACRONYM, alternationOf, bylineRoleOf, frequencyStatementOf, labelWordOf, roleWordAt, wordsOf, type LabelWord, type Meaning } from './label-words';
import { confusionCost } from '../metadata/name-equivalence';
import { DERIVED_ENDING, NAME_JOINERS, NAME_SUFFIX, isKoreanSurname, nameShape, scriptOfName, withoutOrcidMark, type NameShape } from '../metadata/person-name';
import { DOCUMENT_KIND, EDITION_STATEMENT, isInstitutionName, isOrganisationName, isOrganisationOnly, isPublishingHouse, isRubricLine, notAKoreanName } from './title-guards';
export type BylineRowKind = 'labelled' | 'roleMarked' | 'marked' | 'list' | 'shortened' | 'single' | 'pair' | 'affiliation' | 'contact' | 'none';
export interface BylineItem {
    text: string;
    shape: NameShape;
    alternates: string[];
    keys: string[];
    marks: string[];
    role?: 'author' | 'editor' | 'translator' | 'contributor';
    apposition?: string[];
    organisation?: boolean;
    contact?: string;
    weldedKey?: boolean;
    run?: string[];
    keyAfterMark?: boolean;
    wrapped?: boolean;
}
export interface BylineRow {
    kind: BylineRowKind;
    items: BylineItem[];
    role?: 'author' | 'editor' | 'translator' | 'contributor';
    shortened: boolean;
    keyed: boolean;
    ambiguousKeys: boolean;
    affiliations: string[];
    contacts: string[];
    why: string[];
    organisations?: string[];
    publishers?: string[];
}
const LINE_CHARS = 400;
const NFKC = (value: unknown) => String(value ?? '').replace(/[ㆍ․]/g, '·').replace(/\s+(?=\p{M})/gu, '').normalize('NFKC').replace(/\s+(?=\p{M})/gu, '').normalize('NFC');
const clean = (value: unknown) => NFKC(value).replace(/\s+/g, ' ').trim();
const SEPARATOR_MARKS = new Set([',', ';', '，', '；', '、', '·', 'ᆞ', '･', '・', '•', '∙', '‧', '⋅', '⸱', '|', '｜', '&']);
const SEPARATOR_WORD = /^(?:and|And|AND|und|et|y|e|및|와|과|と|和|及)$/;
const SUPERSCRIPT_KEY = /^[a-z\d*⁎∗†‡§¶∥‖⊥∇Ψ✉#⇑]{1,3}\)?$/;
function splitItems(value: string): Array<{
    text: string;
    separator: string;
}> {
    const out: Array<{
        text: string;
        separator: string;
    }> = [];
    let depth = 0, start = 0, separator = '';
    const push = (end: number, next: string) => { out.push({ text: value.slice(start, end).trim(), separator }); separator = next; };
    for (let at = 0; at < value.length; at++) {
        const mark = value[at];
        if (mark === '(' || mark === '（' || mark === '[') {
            depth++;
            continue;
        }
        if (mark === ')' || mark === '）' || mark === ']') {
            depth = Math.max(0, depth - 1);
            continue;
        }
        if (depth)
            continue;
        if (SEPARATOR_MARKS.has(mark)) {
            push(at, mark);
            start = at + 1;
            continue;
        }
        if (mark === '/') {
            push(at, '/');
            start = at + 1;
            continue;
        }
        if (mark === ' ') {
            let end = at + 1;
            while (end < value.length && value[end] !== ' ')
                end++;
            const word = value.slice(at + 1, end);
            const single = word.length === 1 && !/^\s*\p{Lu}/u.test(value.slice(end + 1, end + 4));
            if (word && end < value.length && SEPARATOR_WORD.test(word) && !single) {
                push(at, word.toLowerCase());
                start = end + 1;
                at = end;
                continue;
            }
        }
    }
    out.push({ text: value.slice(start).trim(), separator });
    return out.filter(part => part.text || part.separator);
}
export function nameCells(value: unknown, options: {
    comma?: boolean;
} = {}): string[] {
    const out: string[] = [];
    for (const line of String(value ?? '').split(/\r?\n/)) {
        const cells: string[] = [];
        for (const part of splitItems(clean(line))) {
            if (options.comma === false && (part.separator === ',' || part.separator === '，') && cells.length)
                cells[cells.length - 1] += `, ${part.text}`;
            else if (part.text)
                cells.push(part.text);
        }
        out.push(...cells.map(cell => cell.trim()).filter(Boolean));
    }
    return out;
}
const TRANSLITERATED_PAIR = /^([가-힣]{1,6}|[\p{Script=Katakana}ー]{2,12})\s*[·・•･‧∙]\s*([가-힣]{1,6}|[\p{Script=Katakana}ー]{2,12})$/u;
export function transliteratedPerson(text: unknown): string | null {
    const match = TRANSLITERATED_PAIR.exec(clean(text));
    if (!match)
        return null;
    const [, given, family] = match;
    const kana = (value: string) => /\p{Script=Katakana}/u.test(value);
    if (kana(given) !== kana(family))
        return null;
    const korean = (value: string) => { const shape = nameShape(value); return shape.person !== 'no' && shape.kind === 'korean' && value.length >= 2; };
    if (!kana(given) && (given.length + family.length < 3 || (korean(given) && korean(family))))
        return null;
    return `${given} ${family}`;
}
const LATIN_GLOSS = /(?<=[\p{Script=Latin}.])\s*[(（]\s*([가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}][가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\s]{0,11})\s*[)）]/u;
const NAME_GLOSS = /(?<=[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s*[(（]\s*((?:\p{Script=Han}[\p{Script=Han}\s]{0,7})|(?:[\p{Script=Hiragana}\p{Script=Katakana}ー・][\p{Script=Hiragana}\p{Script=Katakana}ー・\s]{1,15})|(?:[가-힣][가-힣\s]{1,7})|(?!(?:eds?|editors?|trans(?:l|lated|lator)?|comp)\b)(?:[A-Za-z][A-Za-z'’.\-]*(?:[\s,]+[A-Za-z][A-Za-z'’.\-]*){0,3}))\s*[)）]/u;
const EMAIL = /(?<![\w.+-])[\w.+-]+@[\w-]+\.[\w.-]+/;
const ORCID = /\borcid\b|\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/i;
const CJK_KEYED_NAME = /^([가-힣]{2,4}|[\p{Script=Han}][\p{Script=Han}가-힣]{1,5})((?:\d{1,2}[a-z]?|[a-z]\d{0,2})\)?(?:\s*[,;]\s*(?:\d{1,2}[a-z]?|[a-z]\d{0,2})\)?)*)$/u;
const NAME_MARK_CHAR = /[*⁎∗†‡§¶∥‖⊥∇Ψ✉#⇑]/;
const NAME_MARKS = /[*⁎∗†‡§¶∥‖⊥∇Ψ✉#⇑]+/g;
const DEGREE_ONLY = /^(?:Ph\.?\s*D\.?|M\.?\s*D\.?|D\.?\s*Sc\.?|M\.?\s*Sc\.?|M\.?\s*S\.?|B\.?\s*S\.?|M\.?\s*A\.?|B\.?\s*A\.?|P\.?\s*E\.?|[ECM]\.\s*E\.|LL\.\s*[BDM]\.|Dr\.?\s*(?:phil|rer\.?\s*nat|med|ing|jur|sc|habil)\.?)$/i;
const POST_NOMINAL_DOTTED = /^(?:\p{Lu}\.[^\S\n]?){1,4}\p{Lu}\.?$/u;
const POST_NOMINAL_BARE = /^\p{Lu}{2,5}$/u;
function replaceAtEnd(value: string, allowed: RegExp, pattern: RegExp): string {
    let at = value.length;
    while (at > 0 && allowed.test(value[at - 1]))
        at--;
    return value.slice(0, at) + value.slice(at).replace(pattern, '');
}
function keyAfterMark(value: string): string | null {
    const n = value.length;
    if (n < 3 || !/[a-z]/.test(value[n - 1]))
        return null;
    let at = n - 1;
    while (at > 0 && NAME_MARK_CHAR.test(value[at - 1]))
        at--;
    if (at === n - 1 || at === 0 || !/\p{L}/u.test(value[at - 1]))
        return null;
    return value.slice(0, at);
}
interface Stripped {
    name: string;
    keys: string[];
    marks: string[];
    alternates: string[];
    keyAfterMark: boolean;
    contact?: string;
    rest?: string;
}
function stripItem(raw: string): Stripped {
    let value = raw.replace(/^\s*(?:and|&|및|와|과)\s+/i, '');
    const alternates: string[] = [];
    let contact: string | undefined;
    let rest: string | undefined;
    const bracket = /\s*[(（]([^()（）]{1,80})[)）]/u.exec(value);
    if (bracket && EMAIL.test(bracket[1])) {
        contact = EMAIL.exec(bracket[1])?.[0];
        const romanised = bracket[1].replace(EMAIL, '').replace(/[\s,;]+/g, ' ').trim();
        if (romanised)
            alternates.push(romanised);
        const after = value.slice(bracket.index + bracket[0].length);
        const lead = after.length - after.trimStart().length;
        let cut = lead;
        while (cut < after.length && NAME_MARK_CHAR.test(after[cut]))
            cut++;
        rest = after.slice(cut).trim() || undefined;
        value = value.slice(0, bracket.index) + after.slice(0, cut);
    }
    const latinGloss = LATIN_GLOSS.exec(value);
    const nameGloss = NAME_GLOSS.exec(value);
    const glossed = nameGloss && (!/^[A-Za-z]/.test(nameGloss[1]) || /[\s,]/.test(nameGloss[1].trim())) ? nameGloss : null;
    const gloss = glossed || (latinGloss && nameShape(latinGloss[1], { marked: true }).person !== 'no' ? latinGloss : null);
    if (gloss) {
        alternates.push(gloss[1].replace(/\s+/g, ' ').trim());
        value = value.slice(0, gloss.index) + value.slice(gloss.index + gloss[0].length);
    }
    else {
        const mixed = /(?<=[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s*[(（]\s*([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}][\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\s]{0,10})\s+([A-Za-z][A-Za-z'’.\-]*(?:[\s,]+[A-Za-z][A-Za-z'’.\-]*){0,3})\s*[)）]/u.exec(value);
        if (mixed) {
            alternates.push(mixed[1].replace(/\s+/g, ' ').trim(), mixed[2].replace(/\s+/g, ' ').trim());
            value = value.slice(0, mixed.index) + value.slice(mixed.index + mixed[0].length);
        }
    }
    const email = EMAIL.exec(value);
    if (email) {
        contact = contact || email[0];
        value = value.replace(EMAIL, ' ');
    }
    const marks = (value.match(NAME_MARKS) || []).join('');
    const beforeMark = keyAfterMark(value.trimEnd());
    const unmarked = withoutOrcidMark((beforeMark ?? value).replace(/(?<=[\d*⁎∗†‡§¶∥‖⊥∇Ψ✉#⇑])\.\s*$/, '').replace(NAME_MARKS, ' '));
    const keys: string[] = [];
    const keyed = CJK_KEYED_NAME.exec(unmarked.trim());
    if (keyed)
        keys.push(...keyed[2].split(/\s*[,;]\s*/).filter(Boolean));
    const cut = keyed ? keyed[1] : replaceAtEnd(unmarked, /[\s\d),]/, /(?:(?<![\s\d])(?=\d)|(?<!\s)(?=\s))\s*\d+\)?(?:\s*,\s*\d+\)?)*\s*$/);
    const digits = !keyed && cut !== unmarked && /\p{Lu}{2}$/u.test(cut) && /^\d{3}/.test(unmarked.slice(cut.length).trim()) ? unmarked : cut;
    if (!keyed && digits !== unmarked)
        keys.push(...(unmarked.slice(digits.length).match(/\d+/g) || []));
    const letters = digits.replace(/(?<!\s)\s+(?:[a-z]|[a-h]{2,4})(?:\s*[,;]\s*(?:[a-z]|[a-h]{2,4}))*\s*$/, found => { keys.push(...found.replace(/[\s,;]+/g, ' ').trim().split(' ')); return ''; });
    if (beforeMark !== null)
        keys.push(value.trimEnd().slice(-1));
    const trimmed = letters.replace(/^[\s,;]+/, '').trimEnd();
    const name = (/(?:^|[\s,])(?:\p{Lu}|Jr|Sr)\.$/u.test(trimmed) ? trimmed : trimmed.replace(/(?<![\s,;.])[\s,;.]+$/, '')).trim();
    return { name, keys, marks: marks ? [marks] : [], alternates, keyAfterMark: beforeMark !== null, ...(contact ? { contact } : {}), ...(rest ? { rest } : {}) };
}
const LEGAL_FORM = /(?<![\p{L}'’-])(?:Inc|Ltd|LLC|GmbH|Corp|PLC|S\.A|B\.V|K\.K|Limited|Co)\.?(?![\p{L}])|\(주\)|㈜|주식회사|株式会社|有限公司/u;
const INSTITUTION_HEAD = /(?<!\p{L})(?:Universi\p{L}*|Institut\p{L}*|Istituto|Departa?ment\p{L}*|Dipartimento|Département|Dept\.|Facult\p{L}*|School|College|Laborator\p{L}*|Cent(?:er|re)|Academ\p{L}*|Hospital|Corporation|Company|Society|Association|Ministry|Agency|Council|Foundation|Labs?)(?!\p{L})/u;
export const unitHeadIn = (value: unknown): boolean => INSTITUTION_HEAD.test(clean(value));
export function isOrganisationItem(value: unknown): boolean {
    const text = clean(value);
    if (!text || sentenceLike(text))
        return false;
    return isOrganisationName(text) || isPublishingHouse(text) || isOrganisationOnly(text) || LEGAL_FORM.test(text) || INSTITUTION_HEAD.test(text) || HAN_INSTITUTION_UNIT.test(text)
        || (/^[가-힣\s]+$/.test(text) && text.split(' ').some(token => HANGUL_INSTITUTION_UNIT.test(token))) || isInstitutionName(text);
}
export const HAN_INSTITUTION_UNIT = /(?:學科|學部|專攻|大學院|大學校|大學|研究所|研究院)/u;
const HANGUL_INSTITUTION_UNIT = /(?:학과|학부|전공|대학원|대학교|대학|학교|교실|연구소|연구실)$/;
function sentenceLike(text: string): boolean {
    const words = text.split(' ');
    const head = words.findIndex(word => INSTITUTION_HEAD.test(word));
    return head > 0 && hasLowercaseWord(words.slice(0, head).join(' '));
}
function hasLowercaseWord(text: string): boolean {
    return text.split(' ').some(word => /^\p{Ll}{2,}$/u.test(word) && !NAME_JOINERS.connective.test(word) && !NAME_JOINERS.particle.test(word));
}
const positionWord = (word: string) => labelWordOf(word)?.meaning === 'position';
export function positionIn(text: unknown): boolean {
    const words = String(text ?? '').normalize('NFKC').split(/\s+/).filter(Boolean);
    const bare = words.map(word => word.replace(/[.,]$/, ''));
    return bare.some((word, at) => (!/^(?:\p{Lu}\.){2,}$/u.test(words[at]) && positionWord(word)) || (at > 0 && /^[가-힣]+$/.test(bare[at - 1] + word) && positionWord(bare[at - 1] + word)));
}
export function unitPhraseIn(text: unknown): boolean {
    const value = clean(text);
    if (/(?<!\p{L})Dept\.(?!\p{L})/u.test(value))
        return true;
    const words = value.split(' ');
    return words.some((word, at) => at + 1 < words.length && INSTITUTION_HEAD.test(word) && /^(?:of|for|de|des|du|für|fur|di|del|della)$/i.test(words[at + 1]));
}
export function withoutPositionWords(value: unknown): string {
    const words = String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const aside = (word: string) => /^[가-힣]+$/.test(word) ? positionWord(word) || labelWordOf(word)?.meaning === 'advisor' : !/^(?:\p{Lu}\.){2,}$/u.test(word) && positionWord(word);
    const kept: string[] = [];
    for (let at = 0; at < words.length; at++) {
        const word = words[at].replace(/[.,]$/, ''), next = words[at + 1]?.replace(/[.,]$/, '');
        if (next && /^[가-힣]+$/.test(word + next) && aside(word + next)) {
            at++;
            continue;
        }
        if (/^(?:\p{Lu}\.){2,}$/u.test(words[at]) || !aside(word))
            kept.push(words[at]);
    }
    return kept.join(' ');
}
export function withoutLeadingPositions(value: unknown): string {
    const words = String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    let at = 0;
    while (at < words.length && !/^(?:\p{Lu}\.){2,}$/u.test(words[at]) && positionWord(words[at].replace(/[.,]$/, '')))
        at++;
    return words.slice(at).join(' ');
}
export function holdsPosition(text: string): boolean {
    return text.split(/\s+/).some(word => !/^(?:\p{Lu}\.){2,}$/u.test(word) && (positionWord(word.replace(/[.,]$/, '')) || MEMBERSHIP_GRADE.test(word)));
}
const LEADING_KEY = /^((?:\d{1,2}[a-h]?|[a-h]{1,3})?(?:[*⁎∗†‡§¶∥‖⊥∇Ψ✉#⇑]+[a-h\d]{0,3})?)\s+(?=\p{Lu})/u;
function latinWithPosition(text: string): {
    name: string;
    position: string;
} | null {
    const tokens = text.split(' ');
    let at = 0;
    while (at < tokens.length - 2 && positionWord(tokens[at].replace(/[.,]$/, '')))
        at++;
    if (!at)
        return null;
    const name = tokens.slice(at).join(' ');
    return scriptOfName(name) === 'latin' && nameShape(name).person !== 'no' ? { name, position: tokens.slice(0, at).join(' ') } : null;
}
function koreanWithPosition(text: string): {
    name: string;
    position: string;
} | null {
    const tokens = text.split(/\s+/);
    if (tokens.length < 2)
        return null;
    const aside = tokens.filter(token => positionWord(token) || (token.length >= 3 && isOrganisationItem(token)));
    if (!aside.length)
        return null;
    const rest = tokens.filter(token => !aside.includes(token));
    const korean = (name: string, marked: boolean) => { const shape = nameShape(name, { marked }); return shape.person !== 'no' && shape.kind === 'korean'; };
    if (rest.length === 1 && korean(rest[0], false))
        return { name: rest[0], position: aside.join(' ') };
    if (rest.length >= 2 && rest.every(token => /^[가-힣]$/.test(token)) && korean(rest.join(' '), true))
        return { name: rest.join(' '), position: aside.join(' ') };
    return null;
}
export function positionedName(value: unknown): boolean {
    const text = String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 80)
        return false;
    return !!(latinWithPosition(text) || koreanWithPosition(text));
}
const EMPTY_ROW = (why: string): BylineRow => ({ kind: 'none', items: [], shortened: false, keyed: false, ambiguousKeys: false, affiliations: [], contacts: [], why: [why] });
const HOST = /(?:https?:\/\/|\bwww\.)\S|(?<![@\w.-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|edu|gov|int|info|ac|co|or|re|go|kr|jp|cn|de|uk|fr|it|es|ch|nl|se|au|ca|in|io|li|eu|us)(?:\/\S*)?(?![\w@])/i;
const DOI_IN = /\b10\.\d{4,9}\/\S/;
const AFFILIATION_OPENER = /^(?:[a-z\d]\s*\p{Lu}[\p{L}\s]{6,}|\s*\*+\s*Corresponding|\s*Received\b|\s*Accepted\b)/u;
const DERIVED_WORD = DERIVED_ENDING;
const CONTINUING_ROW = /^(?:and|&|및)\s+\S/i;
export function withoutLeadingConnective(text: unknown): string {
    return String(text ?? '').trim().replace(/^(?:and|&|및)\s+(?=\S)/i, '');
}
const OTHERS_WORDS = wordsOf(['others'], 'tail');
const SECTION_TAIL = new RegExp(`\\s(?:${alternationOf(wordsOf(['section'], 'alone'), 'label')})$`, 'iu');
const OTHERS_TAIL = new RegExp(`(?:(?:^|\\s|(?<=[가-힣]))(?:외(?:\\s*\\d+\\s*(?:인|명))?|${alternationOf(OTHERS_WORDS.filter(word => word.form !== '외' && !word.needsName), 'tail')})`
    + `|(?:^|\\s)(?:${alternationOf(OTHERS_WORDS.filter(word => word.needsName), 'tail')}))$`, 'iu');
const COLOPHON_MEANINGS: readonly Meaning[] = ['publisherPerson', 'publisherHouse', 'printer'];
export function colophonLabelled(text: unknown): boolean {
    const value = clean(text);
    if (!value)
        return false;
    for (const seat of ['label', 'lead'] as const) {
        const found = roleWordAt(value, seat, COLOPHON_MEANINGS);
        if (!found)
            continue;
        if (seat === 'label' && found.word.colon === 'required' && !/^\s*[:：]/.test(value.slice(value.indexOf(found.text) + found.text.length)))
            continue;
        return true;
    }
    return false;
}
const HOUSE_MEANING: readonly Meaning[] = ['publisherHouse'];
const NOT_A_HOUSE = /(?:1[4-9]|20)\d{2}|\d[^\S\n]*(?:쇄|刷|판|版|월|일|년|年|月|日)|(?:초|개정|증보|신|재|중|전정|수정)[^\S\n]*판|^[\d\s.,\-/()]+$/u;
function houseNameShaped(name: string): boolean {
    if (!name || name.length > 60 || (name.match(/\p{L}/gu) || []).length < 2)
        return false;
    if (/^\p{Ll}/u.test(name))
        return false;
    const words = name.split(' ');
    if (words.length > 6 || NOT_A_HOUSE.test(name) || EDITION_STATEMENT.test(name) || HOST.test(name) || EMAIL.test(name) || labelWordOf(name))
        return false;
    if (frequencyStatementOf(name))
        return false;
    return !words.some(word => { const found = labelWordOf(word); return !!found && (BYLINE_MEANINGS.includes(found.meaning) || COLOPHON_MEANINGS.includes(found.meaning)); });
}
export interface TailSeat {
    imprint?: boolean;
}
export interface PublicationTail {
    kind: 'house' | 'frequency' | 'unnamed';
    name: string;
    house: string | null;
}
function tailCell(name: string, word: LabelWord, seat: TailSeat): PublicationTail | null {
    if (!name)
        return null;
    if (frequencyStatementOf(name))
        return { kind: 'frequency', name, house: null };
    if (!houseNameShaped(name))
        return null;
    if (!word.common || isOrganisationItem(name) || (seat.imprint && personShape(name).person === 'sure'))
        return { kind: 'house', name, house: name };
    return { kind: 'unnamed', name, house: null };
}
export function publicationTailOf(text: unknown, seat: TailSeat = {}): PublicationTail | null {
    const value = clean(text);
    if (!value || value.length > 120)
        return null;
    const found = roleWordAt(value, 'tail', HOUSE_MEANING);
    if (!found)
        return null;
    return tailCell(found.rest.replace(/^[\s,;:·/]+|[\s,;:·/]+$/gu, '').trim(), found.word, seat);
}
export function publicationStatementOf(text: unknown, seat: TailSeat = {}): PublicationTail | null {
    const tail = publicationTailOf(text, seat);
    if (tail)
        return tail;
    const value = clean(text);
    return value && frequencyStatementOf(value) ? { kind: 'frequency', name: value, house: null } : null;
}
export function publisherTailOf(text: unknown, seat: TailSeat = {}): string | null {
    return publicationTailOf(text, seat)?.house ?? null;
}
function bylineBeforeTheHouse(name: string, word: LabelWord, seat: TailSeat): {
    byline: string;
    tail: PublicationTail;
} | null {
    const words = name.split(' ');
    for (let at = words.length - 2; at >= 1; at--) {
        if (!MARKED_ROLE_FORMS.includes(words[at]))
            continue;
        const tail = tailCell(words.slice(at + 1).join(' '), word, seat);
        return tail ? { byline: words.slice(0, at + 1).join(' '), tail } : null;
    }
    return null;
}
const INNER_COLOPHON = new RegExp(`(?<=\\s)(?:${COLOPHON_LABEL_SOURCE})(?=[^\\S\\n]*[:：]|[^\\S\\n]+\\S)`, 'giu');
const HOUSE_HINT = new RegExp(`(?:${PUBLISHER_TAIL_SOURCE})|(?:${COLOPHON_LABEL_SOURCE})`, 'iu');
const ARRANGED = /^\s*published\s+by\s+(?:special\s+)?(?:arrangement|agreement|permission|licen[cs]e)(?![\p{L}])/iu;
function colophonStatement(text: string): boolean {
    return colophonLabelled(text) && !ARRANGED.test(text);
}
function colophonHousesIn(text: string): string[] {
    const out: string[] = [];
    const starts = [0];
    for (const match of text.matchAll(INNER_COLOPHON)) {
        const at = match.index ?? 0;
        if (at > 0 && colophonStatement(text.slice(at)))
            starts.push(at);
    }
    starts.forEach((start, index) => {
        const piece = text.slice(start, starts[index + 1] ?? text.length).replace(/[\s,，;；/|｜·・•]+$/u, '').trim();
        const found = roleWordAt(piece, 'label', HOUSE_MEANING) || roleWordAt(piece, 'lead', HOUSE_MEANING);
        if (!found)
            return;
        const value = found.rest.replace(/^[\s:：]+/u, '').trim();
        const tail = publicationTailOf(value, { imprint: true });
        const name = tail ? (tail.kind === 'frequency' ? '' : tail.name) : value;
        if (name && houseNameShaped(name) && !out.includes(name))
            out.push(name);
    });
    return out;
}
function separatedCells(value: string): Array<{
    text: string;
    separator: string;
}> {
    const out: Array<{
        text: string;
        separator: string;
    }> = [];
    let depth = 0, start = 0, separator = '';
    for (let at = 0; at < value.length; at++) {
        const mark = value[at];
        if (mark === '(' || mark === '（' || mark === '[') {
            depth++;
            continue;
        }
        if (mark === ')' || mark === '）' || mark === ']') {
            depth = Math.max(0, depth - 1);
            continue;
        }
        if (depth || !',;，；/|｜·・•'.includes(mark))
            continue;
        out.push({ text: value.slice(start, at).trim(), separator });
        separator = mark;
        start = at + 1;
    }
    out.push({ text: value.slice(start).trim(), separator });
    return out;
}
export function publisherStatementsIn(text: unknown, seat: TailSeat = {}): {
    rest: string;
    publishers: string[];
    frequencies?: string[];
} | null {
    const value = clean(text);
    if (!value || value.length > LINE_CHARS || !HOUSE_HINT.test(value))
        return null;
    const publishers: string[] = [];
    const frequencies: string[] = [];
    const said = (tail: PublicationTail) => { if (tail.house)
        publishers.push(tail.house);
    else if (tail.kind === 'frequency')
        frequencies.push(tail.name); };
    const kept: Array<{
        text: string;
        separator: string;
    }> = [];
    let removed = false;
    for (const cell of separatedCells(value)) {
        let own = cell.text;
        if (!own) {
            kept.push(cell);
            continue;
        }
        if (kept.length && colophonStatement(own)) {
            removed = true;
            publishers.push(...colophonHousesIn(own));
            continue;
        }
        for (const match of own.matchAll(INNER_COLOPHON)) {
            const at = match.index ?? 0;
            if (at === 0 || !colophonStatement(own.slice(at)))
                continue;
            publishers.push(...colophonHousesIn(own.slice(at)));
            own = own.slice(0, at).trim();
            removed = true;
            break;
        }
        const found = own.length <= 120 ? roleWordAt(own, 'tail', HOUSE_MEANING) : null;
        const before = found ? found.rest.replace(/^[\s,;:·/]+|[\s,;:·/]+$/gu, '').trim() : '';
        const split = found && before ? bylineBeforeTheHouse(before, found.word, seat) : null;
        if (split) {
            removed = true;
            kept.push({ text: split.byline, separator: cell.separator });
            said(split.tail);
            continue;
        }
        const tail = found && before ? tailCell(before, found.word, seat) : null;
        if (tail) {
            removed = true;
            said(tail);
            continue;
        }
        kept.push({ text: own, separator: cell.separator });
    }
    if (!removed)
        return null;
    const rest = kept.filter(cell => cell.text).map((cell, at) => at === 0 ? cell.text : `${cell.separator === '/' ? ' /' : cell.separator} ${cell.text}`).join('').trim();
    return { rest, publishers: [...new Set(publishers)], ...(frequencies.length ? { frequencies } : {}) };
}
export function colophonHousesOf(text: unknown): string[] {
    const value = clean(text);
    return value && value.length <= LINE_CHARS && colophonLabelled(value) ? colophonHousesIn(value) : [];
}
const rowCache = new Map<string, BylineRow>();
export interface RowContext {
    pageKeys?: ReadonlySet<string>;
    bodyScript?: 'hangul' | 'latin' | 'cjk' | null;
    field?: boolean;
    seated?: boolean;
}
export function readBylineRow(text: string, context: RowContext = {}): BylineRow {
    const value = clean(String(text ?? '').replace(/[(（[][\s\p{Co}]*[)）\]]/gu, ' '));
    const key = context.pageKeys?.size ? '' : `${context.field ? 'F' : 'R'}${context.seated ? 'S' : ''}${context.bodyScript || ''}|${value}`;
    if (key) {
        const held = rowCache.get(key);
        if (held)
            return held;
    }
    const row = readRow(value, context);
    if (key) {
        if (rowCache.size > 20000)
            rowCache.clear();
        rowCache.set(key, row);
    }
    return row;
}
function readRow(value: string, context: RowContext): BylineRow {
    if (!value || value.length > LINE_CHARS)
        return EMPTY_ROW(value ? 'longer than a row' : 'empty');
    if (HOST.test(value) || DOI_IN.test(value))
        return { ...EMPTY_ROW('an address or an identifier'), kind: EMAIL.test(value) ? 'contact' : 'none' };
    if (/(?:\.\s?){4}|…{2}/.test(value))
        return EMPTY_ROW('a contents row with a dot leader');
    if (colophonLabelled(value)) {
        const houses = colophonHousesIn(value);
        return { ...EMPTY_ROW('a colophon label (a publisher, its head or a printer)'), ...(houses.length ? { publishers: houses } : {}) };
    }
    if (frequencyStatementOf(value))
        return EMPTY_ROW('a frequency statement');
    const statement = publisherStatementsIn(value);
    if (statement) {
        const publishers = statement.publishers.length ? { publishers: statement.publishers } : {};
        if (!statement.rest)
            return { ...EMPTY_ROW(statement.publishers.length || !statement.frequencies ? 'a publisher statement' : 'a frequency statement'), ...publishers };
        const read = readRow(statement.rest, context);
        return { ...read, why: [...read.why, 'a publisher statement set aside'], ...(read.publishers || statement.publishers.length ? { publishers: [...new Set([...(read.publishers || []), ...statement.publishers])] } : {}) };
    }
    const why: string[] = [];
    let body = value;
    let role: BylineRow['role'];
    let labelled = false, roleMarked = false, shortened = false, bareBy = false;
    const leading = roleWordAt(body, 'lead', BYLINE_MEANINGS);
    const lead = leading || roleWordAt(body, 'label', LEAD_LABEL_MEANINGS);
    const colon = /^\s*[:：]/.test(body.slice(lead ? lead.text.length : 0));
    if (lead && !lead.word.common && !(lead.word.needsName && !colon) && (leading || lead.word.colon !== 'required' || colon)) {
        labelled = true;
        role = bylineRoleOf(lead.word.form);
        body = lead.rest;
        bareBy = lead.word.form === 'by';
        why.push(`label 「${lead.text}」`);
    }
    const tail = roleWordAt(body, 'tail', BYLINE_MEANINGS);
    if (tail && !(tail.word.needsName && tail.word.script === 'latin')) {
        roleMarked = true;
        role = role || bylineRoleOf(tail.word.form);
        body = tail.rest;
        why.push(`role word 「${tail.text}」`);
    }
    const tailNeedsName = !!tail && !!tail.word.needsName;
    const section = SECTION_TAIL.exec(body);
    if (section && section.index > 0)
        body = body.slice(0, section.index).trim();
    const others = OTHERS_TAIL.exec(body);
    if (others && others.index > 0) {
        shortened = true;
        body = body.slice(0, others.index).replace(/[\s,;]+$/, '').trim();
        why.push('shortened list');
    }
    const wrappedEnd = /(?:\s+(?:and|And|und|et|및|와|과)|\s*[,;&·])$/.exec(body);
    if (wrappedEnd)
        body = body.slice(0, wrappedEnd.index).trim();
    if (!body)
        return EMPTY_ROW('no names');
    const items: BylineItem[] = [];
    const affiliations: string[] = [], contacts: string[] = [];
    const pieces = pieceTexts(body, !!context.field);
    if (!pieces.length)
        return EMPTY_ROW('no pieces');
    if (CONTINUING_ROW.test(value) && pieces.filter(piece => piece.text).length === 1)
        return EMPTY_ROW('continues the row above');
    let pendingPosition: string[] | null = null;
    let graded = false;
    for (let at = 0; at < pieces.length; at++) {
        const piece = pieces[at];
        if (!piece.text)
            continue;
        if (SUPERSCRIPT_KEY.test(piece.text)) {
            const previous = items[items.length - 1];
            if (previous) {
                previous.keys.push(piece.text);
                (previous.run ||= []).push(piece.text);
            }
            continue;
        }
        if (NAME_SUFFIX.test(piece.text) && items.length) {
            items[items.length - 1].text += ` ${piece.text}`;
            continue;
        }
        if (MEMBERSHIP_GRADE.test(piece.text)) {
            const next = pieces[at + 1]?.text || '';
            if (next && (SOCIETY_ACRONYM.test(next) || isOrganisationItem(next)))
                at++;
            why.push('society grade');
            graded = true;
            continue;
        }
        if (DEGREE_ONLY.test(piece.text)) {
            if (items.length)
                graded = true;
            continue;
        }
        const previousItem = items[items.length - 1];
        if (previousItem && !previousItem.organisation && previousItem.shape.person !== 'no' && previousItem.text.split(/\s+/).length >= 2
            && (POST_NOMINAL_DOTTED.test(piece.text) || (!!context.field && POST_NOMINAL_BARE.test(piece.text)))) {
            graded = true;
            continue;
        }
        if (EMAIL.test(piece.text) && !/[가-힣\p{Script=Han}]/u.test(piece.text.replace(EMAIL, '')) && clean(piece.text.replace(EMAIL, '')).length < 3) {
            contacts.push(EMAIL.exec(piece.text)![0]);
            continue;
        }
        if (ORCID.test(piece.text) && clean(piece.text.replace(ORCID, '')).length < 3) {
            contacts.push(piece.text);
            continue;
        }
        const found = items.length ? LEADING_KEY.exec(piece.text) : null;
        const leading = found && found[1] && !NAME_JOINERS.particle.test(found[1]) ? found : null;
        if (leading) {
            const previous = items[items.length - 1];
            previous.keys.push(leading[1]);
            (previous.run ||= []).push(leading[1]);
        }
        const stripped = stripItem(leading ? piece.text.slice(leading[0].length) : piece.text);
        if (stripped.contact)
            contacts.push(stripped.contact);
        if (!stripped.name)
            continue;
        if (pendingPosition) {
            pendingPosition.push(stripped.name);
            if (isOrganisationItem(stripped.name)) {
                affiliations.push(stripped.name);
                pendingPosition = null;
            }
            continue;
        }
        const before = items[items.length - 1];
        if (before?.organisation && ['and', 'und', 'et', 'y', 'e', '&'].includes(piece.separator) && nameShape(stripped.name).person !== 'sure') {
            before.text += ` ${piece.separator} ${stripped.name}`;
            continue;
        }
        const withPosition = koreanWithPosition(stripped.name) || latinWithPosition(stripped.name);
        const name = withPosition ? withPosition.name : stripped.name;
        const organisation = isOrganisationItem(name);
        const shape = organisation ? { text: name, script: scriptOfName(name), person: 'no' as const, why: ['an organisation'] }
            : personShape(name, { marked: stripped.keys.length > 0 || stripped.marks.length > 0 || stripped.alternates.length > 0 || !!stripped.contact, roleStated: roleMarked || (labelled && !bareBy) || !!context.field, listed: pieces.filter(entry => entry.text).length >= 2 || !!context.seated, bodyScript: context.bodyScript });
        const item: BylineItem = { text: name, shape, alternates: stripped.alternates, keys: stripped.keys, marks: stripped.marks,
            ...(withPosition || stripped.rest ? { apposition: [...(withPosition ? [withPosition.position] : []), ...(stripped.rest ? [stripped.rest] : [])] } : {}),
            ...(organisation ? { organisation: true } : {}), ...(stripped.contact ? { contact: stripped.contact } : {}), ...(stripped.keyAfterMark ? { keyAfterMark: true } : {}) };
        if (stripped.rest)
            affiliations.push(stripped.rest);
        const previous = items[items.length - 1];
        if (previous && !previous.organisation && previous.shape.person !== 'no' && !organisation && (holdsPosition(name) || shape.person === 'no') && !hasLowercaseWord(name.split(' ').filter(word => !positionWord(word)).join(' '))
            && pieces.slice(at + 1).some(later => isOrganisationItem(stripItem(later.text).name))) {
            previous.apposition = [...(previous.apposition || []), name];
            pendingPosition = previous.apposition;
            continue;
        }
        if (previous && !previous.organisation && previous.shape.person !== 'no' && !organisation && holdsPosition(name) && shape.person !== 'sure') {
            previous.apposition = [...(previous.apposition || []), name];
            continue;
        }
        items.push(item);
    }
    const rowMarked = !/^(?:and|&|및)\s/i.test(value) && (graded || labelled || items.some(item => item.keys.length || item.marks.length));
    if (rowMarked) {
        for (const item of items) {
            if (item.organisation || item.shape.person !== 'no' || !item.shape.why.includes('set in capitals'))
                continue;
            item.shape = personShape(item.text, { marked: true, bodyScript: context.bodyScript });
        }
    }
    pairParallels(items, pieces);
    const people = items.filter(item => !item.organisation);
    const orgs = items.filter(item => item.organisation);
    const fragment = (item: BylineItem | undefined) => !!item && item.shape.person === 'no'
        && (/^\p{Lu}[\p{Ll}'’]+(?:-\p{Lu}?\p{Ll}*)?$/u.test(item.text) || /^(?:\p{Lu}\.\s?){1,3}$/u.test(item.text) || /^\p{Lu}\p{Ll}+(?:\s+\p{Lu}\.?)+$/u.test(item.text));
    const edges = people.length >= 3 && !orgs.length ? [people[people.length - 1], people[0]].filter(fragment) : [];
    const middle = people.filter(item => !edges.includes(item));
    for (const edge of edges) {
        if (!middle.every(item => item.shape.person !== 'no') || !(middle.length >= 3 || middle.some(item => item.shape.person === 'sure')))
            break;
        edge.shape = { ...edge.shape, person: 'shape', why: [edge === people[0] ? 'the tail of a name the row carries over' : 'the head of a name the row wraps'] };
        if (edge !== people[0])
            edge.wrapped = true;
    }
    for (const org of orgs)
        affiliations.push(org.text);
    if (role)
        for (const person of people)
            person.role = role;
    const keyed = people.some(item => item.keys.length || item.marks.length);
    const persons = people.filter(item => item.shape.person !== 'no');
    const every = persons.length === people.length && people.length > 0;
    const out = (kind: BylineRowKind, reason: string): BylineRow => ({ kind, items: people, ...(role ? { role } : {}), shortened, keyed, ambiguousKeys: false, affiliations, contacts, why: [...why, reason],
        ...(orgs.length ? { organisations: orgs.map(org => org.text) } : {}) });
    if (people.length >= 2 && new Set(people.map(item => nameOfItem(item).replace(/\s+/g, '').toLowerCase())).size < people.length)
        return out('none', 'the same name twice');
    if (!people.length) {
        if (orgs.length)
            return out('affiliation', 'organisations only');
        if (contacts.length)
            return out('contact', 'contact only');
        return out('none', 'no person');
    }
    if (!every) {
        if (AFFILIATION_OPENER.test(value) && !labelled)
            return out('affiliation', 'a keyed affiliation row');
        return out('none', 'an item that is not a name');
    }
    if (/(?<!\p{L})\d{3,}/u.test(value.replace(EMAIL, ' ').replace(ORCID, ' ')))
        return out('none', 'a number of three digits or more');
    const firstOrg = items.findIndex(item => item.organisation), firstPerson = items.findIndex(item => !item.organisation);
    if (firstOrg >= 0 && firstOrg < firstPerson)
        return out(orgs.length ? 'affiliation' : 'none', 'an organisation before the names');
    const sure = persons.filter(item => item.shape.person === 'sure');
    const cjk = (item: BylineItem) => /[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(item.text);
    if (roleMarked && tailNeedsName && !persons.every(item => item.shape.kind === 'korean' || item.shape.kind === 'western' || item.shape.person === 'sure'))
        return out('none', 'a one-syllable role word after no name');
    if (labelled && !bareBy)
        return out('labelled', 'labelled names');
    const titleWord = (item: BylineItem) => !item.shape.why.includes('an initial') && item.text.split(/\s+/).some(word => word.length >= 7 && DERIVED_WORD.test(word));
    const initialled = persons.some(item => item.shape.why.includes('an initial'));
    const byNames = initialled || (!persons.some(titleWord) && (sure.length > 0 || persons.length >= 2));
    if (labelled && bareBy)
        return byNames || persons.some(item => item.apposition?.length) || orgs.length ? out('labelled', 'by and names') : out('none', '「by」 before what is not a name');
    if (roleMarked)
        return out('roleMarked', 'names closed by a role word');
    if (shortened)
        return out('shortened', 'a shortened list');
    const marked = people.some(item => item.keys.length || item.marks.length || item.alternates.length || item.contact);
    if (people.length >= 2 && marked)
        return out('marked', 'names with keys, marks or glosses');
    if (graded)
        return out('marked', 'names with society grades');
    if (people.length === 1 && (people[0].contact || people[0].alternates.length))
        return out('marked', 'a person with a contact or a gloss');
    if (people.length === 1 && orgs.length)
        return sure.length ? out('marked', 'a person and an affiliation') : out('none', 'a name-shaped piece beside an organisation');
    const strongly = (item: BylineItem) => item.keys.length > 0 || item.marks.length > 0 || !!item.contact || item.alternates.length > 0 || cjk(item)
        || (item.shape.person === 'sure' && item.shape.why.some(reason => reason !== 'a surname particle' && reason !== 'capitalised words'));
    if (orgs.length && people.length >= 2 && !people.every(strongly))
        return out('affiliation', 'a unit beside an organisation');
    if (people.length >= 2) {
        const latin = people.filter(item => !cjk(item));
        if (!sure.length && pieces.some(piece => piece.separator === '|' || piece.separator === '｜'))
            return out('none', 'cells split by a bar');
        if (latin.length === people.length && !sure.length && !/^[•∙]/.test(value) && pieces.some(piece => piece.separator === '•' || piece.separator === '∙'))
            return out('list', 'names joined by bullets');
        if (latin.length === people.length && !sure.length)
            return out('pair', 'capitalised name shapes without a sure item');
        if (latin.length && !latin.some(item => item.shape.person === 'sure') && people.length < 3)
            return out('pair', 'two name shapes');
        const hangulOnly = people.every(item => /^[가-힣]+$/.test(item.text));
        if (hangulOnly && people.length < 3 && !people.some(item => item.text.length >= 3))
            return out('none', 'two short Hangul words');
        return out('list', 'a list of names');
    }
    return out('single', 'one name');
}
export function personShape(name: string, context: {
    marked?: boolean;
    roleStated?: boolean;
    listed?: boolean;
    bodyScript?: 'hangul' | 'latin' | 'cjk' | null;
} = {}): NameShape {
    const no = (why: string): NameShape => ({ text: name, script: scriptOfName(name), person: 'no', why: [why] });
    const word = labelWordOf(name);
    if (word && word.meaning !== 'position')
        return no('a label or role word');
    if (name.split(/\s+/).some(word => !/^(?:\p{Lu}\.){2,}$/u.test(word) && positionWord(word.replace(/[.,]$/, ''))))
        return no('holds a position word');
    if (EDITION_STATEMENT.test(name))
        return no('an edition statement');
    const words = name.split(/\s+/);
    if (isRubricLine(name) || [1, 2, 3].some(count => words.length >= count && DOCUMENT_KIND.test(words.slice(-count).join(' '))))
        return no('a document kind or a rubric');
    const shape = nameShape(name, context);
    if (shape.person === 'no')
        return shape;
    if (shape.kind === 'transliterated' && !context.roleStated)
        return no('transliterated chunks with no role word');
    if (shape.kind === 'korean' && notAKoreanName(name))
        return no('a Hangul word that is not a name');
    return shape;
}
const NAME_DOTS = new Set(['·', 'ᆞ', '･', '・', '•', '∙', '‧', '⋅', '⸱']);
const KEY_TAIL_CHAR = /[\s\d*⁎∗†‡§¶∥‖⊥∇Ψ✉#⇑,)）a-z]/;
function keyTailAt(text: string): number {
    let at = text.length;
    while (at > 0 && KEY_TAIL_CHAR.test(text[at - 1]))
        at--;
    return at;
}
function withTransliteratedPairs(split: Array<{
    text: string;
    separator: string;
}>): Array<{
    text: string;
    separator: string;
}> {
    const parts = split.filter(piece => piece.text);
    const otherSeparator = parts.some((piece, at) => at > 0 && !NAME_DOTS.has(piece.separator));
    if (parts.length < 2 || (!otherSeparator && parts.length !== 2))
        return split;
    const out: Array<{
        text: string;
        separator: string;
    }> = [];
    for (const piece of split) {
        const previous = out[out.length - 1];
        if (previous && piece.text && NAME_DOTS.has(piece.separator) && keyTailAt(previous.text) === previous.text.length) {
            const cut = keyTailAt(piece.text);
            const person = transliteratedPerson(`${previous.text}·${piece.text.slice(0, cut)}`);
            if (person) {
                previous.text = `${person}${piece.text.slice(cut)}`;
                continue;
            }
        }
        out.push({ ...piece });
    }
    return out;
}
function pieceTexts(body: string, field: boolean): Array<{
    text: string;
    separator: string;
}> {
    const transliterated = transliteratedPerson(body);
    if (transliterated)
        return [{ text: transliterated, separator: '' }];
    const split = withTransliteratedPairs(splitItems(body));
    const commaPieces = split.filter(piece => piece.text);
    const latin = /^[\p{Script=Latin}\s.,'’\-‐]+$/u.test(body);
    const oneWord = (text: string) => !/\s/.test(text.replace(/\.\s+(?=[A-Z]\.)/g, '.'));
    const initials = (text: string) => /^(?:[A-Z]\.?\s*-?\s*){1,4}$/.test(text);
    const allCommas = split.every((piece, at) => at === 0 || piece.separator === ',');
    if (field && latin && allCommas && commaPieces.length === 2 && oneWord(commaPieces[0].text) && !NAME_SUFFIX.test(commaPieces[1].text) && !SUPERSCRIPT_KEY.test(commaPieces[1].text)
        && !MEMBERSHIP_GRADE.test(commaPieces[1].text) && /^\p{Lu}/u.test(commaPieces[1].text)) {
        return [{ text: `${commaPieces[0].text}, ${commaPieces[1].text}`, separator: '' }];
    }
    if (field && latin && allCommas && commaPieces.length === 3 && oneWord(commaPieces[0].text) && /^\p{Lu}/u.test(commaPieces[1].text) && !NAME_SUFFIX.test(commaPieces[1].text)
        && NAME_SUFFIX.test(commaPieces[2].text) && !SUPERSCRIPT_KEY.test(commaPieces[1].text) && !MEMBERSHIP_GRADE.test(commaPieces[1].text)
        && (oneWord(commaPieces[1].text) || initials(commaPieces[1].text))) {
        return [{ text: `${commaPieces[0].text}, ${commaPieces[1].text}, ${commaPieces[2].text}`, separator: '' }];
    }
    if (field && latin && allCommas && commaPieces.length >= 4 && commaPieces.length % 2 === 0
        && commaPieces.every((piece, at) => at % 2 ? oneWord(piece.text) || initials(piece.text) : oneWord(piece.text) && /^\p{Lu}[\p{Ll}'’-]+$/u.test(piece.text))) {
        const pairs: Array<{
            text: string;
            separator: string;
        }> = [];
        for (let at = 0; at < commaPieces.length; at += 2)
            pairs.push({ text: `${commaPieces[at].text}, ${commaPieces[at + 1].text}`, separator: at ? ',' : '' });
        return pairs;
    }
    const full = (text: string) => { const shape = nameShape(text); return shape.person !== 'no' && shape.kind === 'korean' && !(text.length === 2 && isKoreanSurname(text)) && !notAKoreanName(text); };
    if (field && /^[가-힣]+\s*,\s*[가-힣]+$/.test(body)) {
        const [a, b] = body.split(/\s*,\s*/);
        if (!(full(a) && full(b)))
            return [{ text: `${a}, ${b}`, separator: '' }];
    }
    const spaced = body.split(' ');
    if (split.length === 1 && spaced.length >= 2 && spaced.every(token => /^[가-힣]{3,4}$/.test(token) && full(token)))
        return spaced.map((text, at) => ({ text, separator: at ? ' ' : '' }));
    if (field && split.length === 1 && spaced.length >= 2 && spaced.every(token => /^[가-힣]{2,4}$/.test(token) && full(token) && !positionWord(token))) {
        return spaced.map((text, at) => ({ text, separator: at ? ' ' : '' }));
    }
    const keyedGroups = (text: string): string[] | null => {
        const tokens = text.split(' ').filter(Boolean);
        if (tokens.length < 4)
            return null;
        const groups: string[][] = [[]];
        tokens.forEach((token, at) => {
            groups[groups.length - 1].push(token);
            if (at + 1 < tokens.length && /\p{L}\d{1,2}(?:[,;]\d{1,2})*[*⁎∗†‡§¶#✉]*$/u.test(token) && /^\p{Lu}/u.test(tokens[at + 1]))
                groups.push([]);
        });
        return groups.length >= 2 && groups.every(group => group.length >= 2 && group.length <= 5 && /\p{Ll}/u.test(group.join(' '))) ? groups.map(group => group.join(' ')) : null;
    };
    return split.flatMap(piece => { const groups = keyedGroups(piece.text); return groups ? groups.map((text, at) => ({ text, separator: at ? ' ' : piece.separator })) : [piece]; });
}
function pairParallels(items: BylineItem[], pieces: Array<{
    text: string;
    separator: string;
}>): void {
    const surnameWord = (item: BylineItem, other: BylineItem) => /^\p{Lu}[\p{Ll}'’-]+(?:\p{Lu}\p{Ll}+)?$/u.test(item.text) && other.shape.person !== 'no' && other.shape.kind === 'korean';
    for (let at = items.length - 1; at > 0; at--) {
        const piece = pieces.find(entry => stripItem(entry.text).name === items[at].text);
        if (!piece || !['/', '|', '｜'].includes(piece.separator))
            continue;
        const a = items[at - 1], b = items[at];
        const scriptA = scriptOfName(a.text), scriptB = scriptOfName(b.text);
        const people = (a.shape.person !== 'no' || surnameWord(a, b)) && (b.shape.person !== 'no' || surnameWord(b, a));
        if (scriptA === scriptB || a.organisation || b.organisation || !people)
            continue;
        const [head, other] = a.shape.person === 'no' ? [b, a] : [a, b];
        head.alternates.push(other.text, ...other.alternates);
        head.keys.push(...other.keys);
        head.marks.push(...other.marks);
        items.splice(head === a ? at : at - 1, 1);
    }
}
const LEAD_LABEL_MEANINGS: ReadonlySet<Meaning> = new Set<Meaning>([...BYLINE_MEANINGS, 'responsible']);
export function rowIsByline(text: string, tier: 'strict' | 'seated'): boolean {
    const kind = readBylineRow(text).kind;
    if (kind === 'labelled' || kind === 'roleMarked' || kind === 'marked' || kind === 'list' || kind === 'shortened')
        return true;
    return tier === 'seated' && (kind === 'single' || kind === 'pair');
}
export function rowIsNameList(text: string): boolean {
    const row = readBylineRow(text);
    return rowIsByline(text, 'strict') || (row.kind === 'pair' && row.items.length >= 3 && row.items.every(item => !item.shape.why.some(reason => /name the row (?:carries over|wraps)/.test(reason))));
}
export function namesOfRow(row: BylineRow): string[] {
    return row.items.filter(item => !item.organisation && item.shape.person !== 'no').map(item => item.text);
}
export const PERSON_ROW_KINDS: ReadonlySet<BylineRowKind> = new Set<BylineRowKind>(['labelled', 'roleMarked', 'marked', 'list', 'shortened', 'single', 'pair']);
export function personsOnly(text: unknown, context: RowContext = {}): BylineItem[] | null {
    const row = readBylineRow(String(text ?? ''), context);
    if (!PERSON_ROW_KINDS.has(row.kind) || row.organisations?.length)
        return null;
    return row.items.length && row.items.every(item => item.shape.person !== 'no') ? row.items : null;
}
export function nameOfItem(item: BylineItem): string {
    if (item.shape.kind === 'korean' || item.shape.why.includes('a name whose space was lost'))
        return item.shape.text;
    return item.shape.script === 'latin' && item.shape.person !== 'no' ? item.text.replace(/(?<=\p{Lu}\.)(?=\p{Lu}\p{Ll})/gu, ' ') : item.text;
}
export function pageKeysOf(rows: readonly string[]): Set<string> {
    const keys = new Set<string>();
    for (const row of rows) {
        const key = /^\s*([a-z\d])\s*\p{Lu}\p{L}{2}[^\n]{4,}$/u.exec(String(row ?? ''));
        if (key)
            keys.add(key[1].toLowerCase());
    }
    return keys;
}
export function joinWrappedRows(rows: readonly string[], at: number, context: RowContext = {}): {
    row: BylineRow;
    end: number;
} {
    let text = clean(rows[at] ?? '');
    let row = readBylineRow(text, context), end = at;
    let blanks = 0;
    for (let next = at + 1; next < rows.length && next <= at + 8; next++) {
        const following = clean(rows[next] ?? '');
        if (!following) {
            if (++blanks > 1)
                break;
            continue;
        }
        blanks = 0;
        if (!/(?:[,;·&]|\band|-)$/i.test(text) && !row.items[row.items.length - 1]?.wrapped && !CONTINUING_ROW.test(following))
            break;
        const joined = /-$/.test(text) ? `${text}${following}` : `${text} ${following}`;
        if (joined.length > LINE_CHARS)
            break;
        const read = readBylineRow(joined, context);
        const head = row.items[row.items.length - 1], tail = read.items[read.items.length - 1];
        const completes = !!head?.wrapped && namesOfRow(read).length === namesOfRow(row).length && PERSON_ROW_KINDS.has(read.kind)
            && (/^\p{Lu}[\p{L}'’-]+(?:\s\p{Lu}[\p{L}'’-]+)?[\d*⁎∗†‡§¶#✉,]*$/u.test(following)
                || (read.items.length === row.items.length && !!tail && tail.shape.person !== 'no' && tail.text.startsWith(`${head.text} `)));
        if (read.kind === 'none' || (namesOfRow(read).length <= namesOfRow(row).length && !completes))
            break;
        text = joined;
        row = read;
        end = next;
    }
    return { row, end };
}
export function peopleOfStatement(value: string): string[] | null {
    const row = readBylineRow(value);
    const names = namesOfRow(row);
    if (row.kind === 'none' || row.kind === 'affiliation' || row.kind === 'contact' || !names.length)
        return null;
    if (row.kind === 'single' && !row.shortened)
        return names;
    return names;
}
export function peopleOfField(value: unknown): Array<{
    text: string;
    role?: 'author' | 'editor' | 'translator' | 'contributor';
    alternates: string[];
    organisation?: boolean;
}> {
    return readField(value).people;
}
export function publishersOfField(value: unknown): string[] {
    return readField(value).publishers;
}
type FieldPerson = {
    text: string;
    role?: 'author' | 'editor' | 'translator' | 'contributor';
    alternates: string[];
    organisation?: boolean;
};
function readField(value: unknown): {
    people: FieldPerson[];
    publishers: string[];
} {
    const out: FieldPerson[] = [];
    const publishers: string[] = [];
    const addHouse = (name: string) => { if (name && !publishers.includes(name))
        publishers.push(name); };
    let labelled: 'author' | 'editor' | 'translator' | 'contributor' | undefined;
    let unassigned: typeof out = [];
    let previousOrganisations: FieldPerson[] = [];
    for (const line of NFKC(value).replace(/\r\n?/g, '\n').split(/[\n;；]/)) {
        const bare = withoutLeadingConnective(clean(line));
        const head = /^(\S{1,12})\s*[•·・∙]\s*(?=\S)/u.exec(bare);
        const labelledHead = head && labelWordOf(head[1]) && BYLINE_MEANINGS.includes(labelWordOf(head[1])!.meaning) && labelWordOf(head[1])!.seats.some(seat => seat === 'label' || seat === 'lead');
        const text = labelledHead ? `${head![1]} ${bare.slice(head![0].length)}` : bare;
        if (!text)
            continue;
        const before = previousOrganisations;
        previousOrganisations = [];
        if (colophonLabelled(text)) {
            for (const house of colophonHousesIn(text))
                addHouse(house);
            labelled = undefined;
            unassigned = [];
            continue;
        }
        const word = labelWordOf(text);
        if (word && COLOPHON_MEANINGS.includes(word.meaning)) {
            if (word.meaning === 'publisherHouse' && word.seats.includes('tail'))
                for (const entry of before) {
                    const at = out.indexOf(entry);
                    if (at >= 0)
                        out.splice(at, 1);
                    addHouse(entry.text);
                }
            labelled = undefined;
            unassigned = [];
            continue;
        }
        if (word && BYLINE_MEANINGS.includes(word.meaning)) {
            if (word.seats.includes('tail') && unassigned.length) {
                for (const person of unassigned)
                    person.role = bylineRoleOf(word.form);
                unassigned = [];
            }
            else {
                labelled = bylineRoleOf(word.form);
                unassigned = [];
            }
            continue;
        }
        if (word)
            continue;
        const opening = text.split(/\s*[,，]\s*/)[0];
        if (holdsPosition(opening) && !latinWithPosition(opening) && !koreanWithPosition(opening))
            continue;
        const row = readBylineRow(text, { field: true });
        for (const house of row.publishers || [])
            addHouse(house);
        if (row.publishers?.length && !row.items.length && !row.organisations?.length) {
            labelled = undefined;
            unassigned = [];
            continue;
        }
        const people = row.items.filter(item => !item.organisation && !labelWordOf(item.text) && !colophonLabelled(item.text) && !publicationStatementOf(item.text));
        const role = row.role || labelled;
        for (const organisation of row.organisations || []) {
            if (colophonLabelled(organisation))
                continue;
            const said = publicationStatementOf(organisation);
            if (said) {
                if (said.house)
                    addHouse(said.house);
                continue;
            }
            const entry: FieldPerson = { text: organisation, ...(role ? { role } : {}), alternates: [], organisation: true };
            out.push(entry);
            if (!row.role && !people.length)
                previousOrganisations.push(entry);
        }
        if (!people.length)
            continue;
        for (const person of people) {
            const entry = { text: person.text, ...(role ? { role } : {}), alternates: person.alternates };
            out.push(entry);
            if (!role)
                unassigned.push(entry);
        }
        if (row.role)
            unassigned = [];
    }
    return { people: out, publishers };
}
export function fieldIsShortened(value: unknown): boolean {
    const lines = NFKC(value).replace(/\r\n?/g, '\n').split(/[\n;；]/).map(clean).filter(Boolean);
    return lines.length > 0 && readBylineRow(withoutLeadingConnective(lines[lines.length - 1]), { field: true }).shortened;
}
export function misreadRoleWord(token: string): string | null {
    const value = NFKC(token).trim();
    if (!/^[가-힣]{2}$/.test(value) || MARKED_ROLE_FORMS.includes(value))
        return null;
    const near = MARKED_ROLE_FORMS.map(word => ({ word, distance: confusionCost(value, word, { keepInitials: true }) }))
        .filter(entry => entry.distance <= 3).sort((a, b) => a.distance - b.distance);
    if (!near.length || (near.length > 1 && near[1].distance === near[0].distance))
        return null;
    return near[0].word;
}
export function misreadRoleWordLine(line: string): {
    names: string[];
    token: string;
    word: string;
} | null {
    const value = NFKC(line).replace(/\s+/g, ' ').trim();
    if (!value || value.length > 40 || !/^[가-힣]+(?:(?: |\s?[·,，、]\s?)[가-힣]+)+$/.test(value))
        return null;
    const parts = value.split(/\s?[·,，、]\s?/);
    const last = parts[parts.length - 1].split(' ');
    if (last.length < 2)
        return null;
    const tokens = [...parts.slice(0, -1).flatMap(part => part.split(' ')), ...last];
    if (tokens.some(token => KOREAN_ROLE_FORMS.has(token)))
        return null;
    const token = last[last.length - 1];
    if (labelWordOf(token)?.meaning === 'position')
        return null;
    const word = misreadRoleWord(token);
    if (!word)
        return null;
    const names = [...parts.slice(0, -1), last.slice(0, -1).join(' ')].map(name => name.replace(/\s+/g, ''))
        .filter(name => name.length >= 2 && name.length <= 8);
    return names.length === parts.length ? { names, token, word } : null;
}

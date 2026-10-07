import { foldedLetters } from '../recognition/folded-letters';
import { INITIAL_SOUND_PAIRS, NAME_JOINERS, crossesScripts, isKoreanSurname, koreanSurnameOfHanja, ROMANISED_SYLLABLES, givenAndSuffix, scriptOfName, splitHangulName } from './person-name';
const HANGUL_SYLLABLE = /^[가-힣]+$/;
const INITIALS = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const MEDIALS = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const FINALS = ['', 'k', 'k', 'ks', 'n', 'nj', 'nh', 't', 'l', 'lk', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'p', 'ps', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 'h'];
export const SURNAME_SPELLINGS: Readonly<Record<string, readonly string[]>> = {
    김: ['kim', 'gim'], 이: ['lee', 'yi', 'rhee', 'i', 'ee', 'li', 'rhie'], 박: ['park', 'pak', 'bak', 'bahk'],
    최: ['choi', 'choe', 'che', 'chwe'], 정: ['jung', 'jeong', 'chung', 'cheong', 'chong'], 강: ['kang', 'gang'],
    조: ['cho', 'jo', 'joe'], 윤: ['yoon', 'yun', 'youn', 'yune'], 장: ['jang', 'chang'], 임: ['im', 'lim', 'rim', 'yim'],
    한: ['han', 'hahn'], 오: ['oh', 'o', 'oe'], 서: ['seo', 'suh', 'sur', 'so'], 신: ['shin', 'sin'],
    권: ['kwon', 'gwon', 'kweon'], 황: ['hwang', 'whang'], 안: ['ahn', 'an'], 송: ['song'], 류: ['ryu', 'ryoo', 'yu', 'lyu'],
    전: ['jeon', 'jun', 'chun', 'chon'], 홍: ['hong'], 유: ['yu', 'yoo', 'you'], 고: ['ko', 'go', 'koh', 'goh'],
    문: ['moon', 'mun'], 양: ['yang'], 손: ['son', 'sohn'], 배: ['bae', 'pae', 'bai'], 백: ['baek', 'paek', 'back', 'baik'],
    남: ['nam'], 심: ['sim', 'shim'], 노: ['noh', 'no', 'roh'], 하: ['ha'], 곽: ['kwak', 'gwak', 'kwag'],
    성: ['sung', 'seong'], 차: ['cha'], 주: ['joo', 'ju', 'chu'], 우: ['woo', 'wu', 'u'], 구: ['koo', 'gu', 'ku', 'goo'],
    민: ['min'], 진: ['jin', 'chin'], 지: ['ji', 'chi'], 연: ['yeon', 'youn'], 방: ['bang', 'pang'],
    채: ['chae', 'chai'], 여: ['yeo', 'yuh'], 위: ['wi'], 표: ['pyo'], 마: ['ma'], 길: ['gil', 'kil'],
    허: ['heo', 'hur', 'huh', 'her', 'hu'], 원: ['won', 'weon'], 천: ['cheon', 'chun'], 엄: ['eom', 'um', 'uhm'],
    석: ['seok', 'suk', 'sok'], 선: ['seon', 'sun'], 설: ['seol', 'sul'], 함: ['ham'], 변: ['byeon', 'byun', 'pyun'],
    염: ['yeom', 'yum'], 추: ['chu', 'choo'], 도: ['do', 'doh', 'to'], 소: ['so', 'soh'],
    국: ['kook', 'guk'], 명: ['myeong', 'myung'], 반: ['ban', 'pan'], 왕: ['wang'], 모: ['mo'], 육: ['yuk', 'yook'],
    인: ['in'], 탁: ['tak'], 옥: ['ok', 'ock'], 금: ['keum', 'geum'], 라: ['ra', 'na'], 계: ['gye', 'kye'],
    피: ['pi'], 두: ['du', 'doo'], 감: ['gam', 'kam'], 편: ['pyeon', 'pyun'], 용: ['yong'], 봉: ['bong'], 부: ['bu', 'boo']
};
function romaniseSyllable(syllable: string): string {
    const code = syllable.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171)
        return syllable.toLowerCase();
    return INITIALS[Math.floor(code / 588)] + MEDIALS[Math.floor((code % 588) / 28)] + FINALS[code % 28];
}
export function romanise(hangul: string): string {
    return [...String(hangul || '')].map(romaniseSyllable).join('');
}
export function jamoOf(syllable: string): [
    number,
    number,
    number
] | null {
    const code = String(syllable || '').charCodeAt(0) - 0xac00;
    if (!(code >= 0 && code <= 11171))
        return null;
    return [Math.floor(code / 588), Math.floor((code % 588) / 28), code % 28];
}
export function jamoSubstitutions(a: string, b: string, options: {
    keepInitials?: boolean;
} = {}): number {
    const x = [...String(a ?? '').normalize('NFC')], y = [...String(b ?? '').normalize('NFC')];
    if (x.length !== y.length)
        return Infinity;
    let count = 0;
    for (let at = 0; at < x.length; at++) {
        if (x[at] === y[at])
            continue;
        const p = jamoOf(x[at]), q = jamoOf(y[at]);
        if (!p || !q)
            return Infinity;
        if (options.keepInitials && p[0] !== q[0])
            return Infinity;
        count += (p[0] !== q[0] ? 1 : 0) + (p[1] !== q[1] ? 1 : 0) + (p[2] !== q[2] ? 1 : 0);
    }
    return count;
}
let SYLLABLES_BY_ROMANISATION: Map<string, string[]> | null = null;
function syllablesRomanisedAs(latin: string): string[] {
    if (!SYLLABLES_BY_ROMANISATION) {
        SYLLABLES_BY_ROMANISATION = new Map();
        for (let code = 0; code <= 11171; code++) {
            const syllable = String.fromCharCode(0xac00 + code);
            const spelled = romaniseSyllable(syllable);
            const list = SYLLABLES_BY_ROMANISATION.get(spelled);
            if (list)
                list.push(syllable);
            else
                SYLLABLES_BY_ROMANISATION.set(spelled, [syllable]);
        }
    }
    return SYLLABLES_BY_ROMANISATION.get(latin) || [];
}
export function hangulRespelledByRomanisation(read: string, latin: string, limit = 2): string | null {
    const syllables = [...String(read ?? '').normalize('NFC')];
    const target = String(latin ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
    if (syllables.length < 2 || target.length < 4 || !syllables.every(syllable => HANGUL_SYLLABLE.test(syllable)))
        return null;
    const found = new Map<string, number>();
    for (let span = syllables.length; span >= 2; span--) {
        if (fold(romanise(syllables.slice(0, span).join(''))) === fold(target))
            return null;
        const walk = (at: number, rest: string, spent: number, built: string) => {
            if (at === span) {
                if (!rest && spent > 0)
                    found.set(built + syllables.slice(span).join(''), spent);
                return;
            }
            for (let cut = 1; cut <= Math.min(7, rest.length); cut++) {
                for (const syllable of syllablesRomanisedAs(rest.slice(0, cut))) {
                    const cost = jamoSubstitutions(syllables[at], syllable);
                    if (spent + cost <= limit)
                        walk(at + 1, rest.slice(cut), spent + cost, built + syllable);
                }
            }
        };
        walk(0, target, 0, '');
    }
    if (!found.size)
        return null;
    const least = Math.min(...found.values());
    const best = [...found].filter(([, spent]) => spent === least).map(([form]) => form);
    return best.length === 1 ? best[0] : null;
}
export function fold(latin: string): string {
    let value = String(latin || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '');
    value = value.replace(/^(.*?)h$/, '$1');
    value = value.replace(/wh/g, 'hw').replace(/([bcdgjkpst])h/g, '$1');
    value = value.replace(/eo|eu|oo|ou|wu/g, 'u').replace(/ee/g, 'i').replace(/ui/g, 'i').replace(/ae|ai/g, 'e').replace(/oe/g, 'e');
    value = value.replace(/sh/g, 's').replace(/ch/g, 'j').replace(/[kq]/g, 'g').replace(/t/g, 'd').replace(/p/g, 'b')
        .replace(/l/g, 'r').replace(/c/g, 'g').replace(/y(?=[aeiou])/g, '').replace(/w(?=[aeiou])/g, '');
    return value.replace(/(.)\1+/g, '$1');
}
function distance(a: string, b: string): number {
    if (Math.abs(a.length - b.length) > 3)
        return 99;
    const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++)
        rows[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
    }
    return rows[a.length][b.length];
}
export interface KoreanName {
    surname: string;
    given: string;
}
export function splitLatinName(lastName: unknown, firstName?: unknown): Array<KoreanName> {
    const last = String(lastName || '').trim(), first = String(firstName || '').trim();
    if (last && first)
        return [{ surname: last, given: first }];
    const parts = last.split(/[\s,]+/).filter(Boolean);
    if (parts.length < 2)
        return parts.length === 1 ? [{ surname: parts[0], given: '' }] : [];
    return [
        { surname: parts[0], given: parts.slice(1).join('') },
        { surname: parts[parts.length - 1], given: parts.slice(0, -1).join('') }
    ];
}
function surnameMatches(hangul: string, latin: string): boolean {
    const spellings = isKoreanSurname(hangul) ? SURNAME_SPELLINGS[hangul] : undefined;
    const candidate = fold(latin);
    if (!candidate)
        return false;
    if (spellings?.some(spelling => fold(spelling) === candidate))
        return true;
    return fold(romanise(hangul)) === candidate;
}
export function sameKoreanPerson(hangulName: unknown, latinName: unknown, latinFirst?: unknown): boolean {
    const korean = splitHangulName(hangulName);
    if (!korean || !korean.given)
        return false;
    const given = fold(romanise(korean.given));
    if (!given)
        return false;
    for (const reading of splitLatinName(latinName, latinFirst)) {
        if (!reading.given)
            continue;
        if (!surnameMatches(korean.surname, reading.surname))
            continue;
        const offered = fold(reading.given);
        if (!offered)
            continue;
        const slack = given.length >= 8 ? 1 : 0;
        if (distance(given, offered) <= slack)
            return true;
    }
    return false;
}
const sameHangulSurname = (read: string, written: string) => read === written || INITIAL_SOUND_PAIRS[read] === written;
const HAN_ONLY = /^[\p{Script=Han}]+$/u;
function nameParts(person: {
    lastName?: unknown;
    firstName?: unknown;
} | null | undefined): {
    whole: string;
    surname: string;
} {
    const last = String(person?.lastName ?? '').normalize('NFKC').replace(/\s+/g, '');
    const first = String(person?.firstName ?? '').normalize('NFKC').replace(/\s+/g, '');
    return { whole: `${last}${first}`, surname: first ? last : '' };
}
export function sameKoreanPersonAcrossScripts(a: {
    lastName?: unknown;
    firstName?: unknown;
}, b: {
    lastName?: unknown;
    firstName?: unknown;
}): boolean {
    const first = nameParts(a), second = nameParts(b);
    const hanja = HAN_ONLY.test(first.whole) ? first : HAN_ONLY.test(second.whole) ? second : null;
    const hangul = hanja === first ? second : first;
    if (!hanja || hanja === hangul || !HANGUL_SYLLABLE.test(hangul.whole))
        return false;
    if (hanja.whole.length < 2 || hanja.whole.length > 5 || hangul.whole.length !== hanja.whole.length)
        return false;
    const hanjaSurnames = hanja.surname ? [hanja.surname] : [hanja.whole.slice(0, 2), hanja.whole.slice(0, 1)];
    for (const surname of hanjaSurnames) {
        if (surname.length >= hanja.whole.length)
            continue;
        const read = koreanSurnameOfHanja(surname);
        if (!read)
            continue;
        const written = hangul.surname || hangul.whole.slice(0, read.length);
        if (written.length !== read.length || !sameHangulSurname(read, written))
            continue;
        if (hanja.whole.length - surname.length === hangul.whole.length - written.length)
            return true;
    }
    return false;
}
const whole = (creator: any) => [creator?.lastName ?? creator?.name ?? '', creator?.firstName ?? ''].filter(Boolean).join(' ').trim();
const PAIRED = /^\s*([가-힣][가-힣\s]*?)\s*[(（]\s*([^)）]+?)\s*[)）]\s*$/;
export function nameScripts(creator: any): {
    hangul: string;
    latin: {
        lastName: string;
        firstName: string;
    } | null;
} {
    const last = String(creator?.lastName ?? creator?.name ?? '').trim();
    const first = String(creator?.firstName ?? '').trim();
    const paired = PAIRED.exec(last);
    if (paired) {
        const [lastName, firstName = ''] = paired[2].split(/\s*,\s*/);
        return { hangul: paired[1].replace(/\s+/g, ''), latin: { lastName: lastName.trim(), firstName: firstName.trim() } };
    }
    if (/[가-힣]/.test(`${last}${first}`))
        return { hangul: `${last}${first}`.replace(/\s+/g, ''), latin: null };
    return { hangul: '', latin: { lastName: last, firstName: first } };
}
export function samePersonAcrossScripts(a: any, b: any): boolean {
    if (!whole(a) || !whole(b))
        return false;
    const first = nameScripts(a), second = nameScripts(b);
    if (first.hangul && second.hangul)
        return first.hangul === second.hangul;
    const korean = first.hangul ? first : second, latin = first.hangul ? second : first;
    if (!korean.hangul || !latin.latin)
        return false;
    return sameKoreanPerson(korean.hangul, latin.latin.lastName, latin.latin.firstName);
}
export function pairedByLine(creators: unknown): Map<unknown, unknown> {
    const list = (Array.isArray(creators) ? creators : []).filter(Boolean);
    const pairs = new Map<unknown, unknown>();
    const script = (entry: unknown) => { const parts = nameScripts(entry); return parts.hangul ? (parts.latin ? 'both' : 'hangul') : 'latin'; };
    const korean = list.filter(entry => script(entry) === 'hangul');
    const roman = list.filter(entry => script(entry) === 'latin');
    if (korean.length < 2 || korean.length !== roman.length || list.length !== korean.length + roman.length)
        return pairs;
    if (list.indexOf(korean[korean.length - 1]) > list.indexOf(roman[0]))
        return pairs;
    const role = (entry: any) => String(entry?.creatorType ?? entry?.creatorTypeID ?? '');
    if (korean.some((entry, index) => role(entry) !== role(roman[index])))
        return pairs;
    let read = 0;
    for (let i = 0; i < korean.length; i++) {
        for (let j = 0; j < roman.length; j++) {
            if (!samePersonAcrossScripts(korean[i], roman[j]))
                continue;
            if (i !== j)
                return pairs;
            read++;
        }
    }
    if (read < korean.length - 1 || read < 2)
        return pairs;
    korean.forEach((entry, index) => { pairs.set(entry, roman[index]); pairs.set(roman[index], entry); });
    return pairs;
}
export function ocrConfusedName(read: unknown, form: unknown): boolean {
    const a = String(read ?? '').normalize('NFC').replace(/\s+/g, ' ').trim(), b = String(form ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!a || !b || a === b)
        return false;
    if (/[가-힣]/.test(a) || /[가-힣]/.test(b)) {
        if (!/[가-힣]/.test(a) || !/[가-힣]/.test(b))
            return false;
        return jamoSubstitutions(a, b) <= confusableJamo(a) && jamoSubstitutions(a, b) >= 1;
    }
    const x = [...a], y = [...b];
    if (x.length !== y.length || x.length < 5)
        return false;
    const differ = x.map((char, at) => char === y[at] ? -1 : at).filter(at => at >= 0);
    if (!differ.length || differ.length > 2)
        return false;
    if (differ.some(at => /\p{N}/u.test(x[at]) || /\p{N}/u.test(y[at]) || crossesScripts(x[at], y[at]) || !/\p{L}/u.test(x[at]) || !/\p{L}/u.test(y[at])))
        return false;
    const words = a.split(' ');
    let from = 0;
    for (const word of words) {
        const inside = differ.filter(at => at >= from && at < from + [...word].length).length;
        if (inside > Math.floor([...word].length / 4))
            return false;
        from += [...word].length + 1;
    }
    return differ.some(at => x[at].toLowerCase() !== y[at].toLowerCase());
}
const ONSET_LATIN: readonly string[] = ['gk', 'kg', 'n', 'dt', 'td', 'rl', 'm', 'bpv', 'pb', 's', 's', 'aeiouyw', 'jz', 'jzt', 'ct', 'kcq', 't', 'pf', 'hf'];
export function hangulTransliterates(hangul: unknown, latin: unknown): boolean {
    const chunks = String(hangul ?? '').normalize('NFC').trim().split(/\s+/).filter(Boolean);
    const words = String(latin ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().split(/[\s\-‐]+/).map(word => word.replace(/[^a-z]/g, '')).filter(Boolean);
    if (chunks.length < 2 || chunks.length !== words.length || chunks.length > 4 || !chunks.every(chunk => /^[가-힣]{1,8}$/.test(chunk)) || words.some(word => word.length < 2 || word.length > 20))
        return false;
    const pairs = (hangulChunk: string, word: string) => {
        const syllables = [...hangulChunk].map(jamoOf);
        if (syllables.some(jamo => !jamo))
            return false;
        const onset = syllables[0]![0];
        if (!ONSET_LATIN[onset].includes(word[0]))
            return false;
        const vowels = (word.match(/[aeiouy]+/g) || []).length;
        const bare = syllables.filter(jamo => jamo![1] === 18 && jamo![2] === 0).length;
        return vowels <= syllables.length && vowels >= syllables.length - bare;
    };
    const inOrder = (list: string[]) => chunks.every((chunk, at) => pairs(chunk, list[at]));
    return inOrder(words) || inOrder([...words].reverse());
}
export function confusableJamo(value: string): number {
    const syllables = (String(value ?? '').match(/[가-힣]/g) || []).length;
    return syllables >= 3 ? 2 : syllables === 2 ? 1 : 0;
}
export function misreadAgainstRecord(read: unknown, form: unknown): boolean {
    const syllables = (String(read ?? '').normalize('NFC').match(/[가-힣]/g) || []).length;
    if (syllables > 0 && syllables < 3)
        return false;
    return ocrConfusedName(read, form);
}
export function hangulNamesOf(stated: any): string[] {
    if (stated && typeof stated === 'object') {
        const last = String(stated.lastName ?? stated.name ?? '').replace(/\s+/g, ''), first = String(stated.firstName ?? '').replace(/\s+/g, '');
        return /^[가-힣]{2,6}$/.test(last + first) ? [last + first, first + last] : [];
    }
    const tokens = String(stated ?? '').normalize('NFC').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length || !tokens.every(token => /^[가-힣]+$/.test(token)))
        return [];
    const joined = tokens.join('');
    return joined.length >= 2 && joined.length <= 6 ? [...new Set([joined, [...tokens].reverse().join('')])] : [];
}
export const personKey = (person: any) => foldedLetters(`${person?.lastName ?? person?.name ?? ''}${person?.firstName ?? ''}`);
const hangulWhole = (person: any) => { const whole = `${person?.lastName ?? ''}${person?.firstName ?? ''}`.normalize('NFC').replace(/\s+/g, ''); return /^[가-힣]{2,6}$/.test(whole) ? whole : ''; };
const latinPerson = (person: any) => /^[\p{Script=Latin}\s.'’\-‐]+$/u.test(`${person?.lastName ?? ''} ${person?.firstName ?? ''}`.trim());
export function samePerson(a: any, b: any): boolean {
    const x = personKey(a);
    if (x && (x === personKey(b) || x === foldedLetters(`${b?.firstName ?? ''}${b?.lastName ?? ''}`)))
        return true;
    const ha = hangulWhole(a), hb = hangulWhole(b);
    if (ha && hb)
        return misreadAgainstRecord(ha, hb);
    if (sameKoreanPersonAcrossScripts(a || {}, b || {}))
        return true;
    if (ha && latinPerson(b))
        return sameKoreanPerson(ha, b?.lastName, b?.firstName);
    if (hb && latinPerson(a))
        return sameKoreanPerson(hb, a?.lastName, a?.firstName);
    return false;
}
export type NameRelation = 'identical' | 'spelling' | 'initials' | 'romanised' | 'hanjaReading' | 'hanRomanised' | 'romanisedVariant' | 'transliterationOrder' | 'misread' | 'different' | 'unknown';
export interface NameContext {
    field?: 'person' | 'house' | 'place';
    positional?: boolean;
    allowMisread?: boolean;
    pageShows?: boolean;
}
export interface NameVerdict {
    relation: NameRelation;
    cost: number;
    basis: string;
}
interface Parts {
    last: string;
    first: string;
    text: string;
}
function partsOf(value: unknown): Parts {
    if (value && typeof value === 'object') {
        const person = value as {
            lastName?: unknown;
            firstName?: unknown;
            name?: unknown;
        };
        const last = String(person.lastName ?? person.name ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
        const first = String(person.firstName ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
        return { last, first, text: `${first} ${last}`.trim() };
    }
    const text = String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    return { last: text, first: '', text };
}
const letters = (value: string) => foldedLetters(value.normalize('NFKD').replace(/\p{M}+/gu, ''));
function suffixedForms(p: Parts): {
    forms: string[];
    suffixed: boolean;
} {
    const family = givenAndSuffix(p.last), given = givenAndSuffix(p.first);
    const suffix = given.suffix || (p.first ? family.suffix : '');
    const last = p.first ? family.given : p.last, first = given.given;
    if (!suffix)
        return { forms: [letters(`${p.last}${p.first}`), letters(`${p.first}${p.last}`)].filter(Boolean), suffixed: false };
    return { forms: [letters(`${last}${first}${suffix}`), letters(`${first}${last}${suffix}`)].filter(Boolean), suffixed: true };
}
const wordsOf = (value: string) => value.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().split(/[\s,]+/).map(word => word.replace(/[^\p{L}\p{N}]+/gu, '')).filter(Boolean);
function withoutMcCuneReischauer(value: string): string {
    const text = String(value ?? '');
    if (!/[ŏŭŎŬ]|[kKtTpPhH]['’ʼ]/.test(text))
        return text;
    return text.replace(/([cC])h(?!['’ʼ])/g, (_, c) => c === 'C' ? 'J' : 'j').replace(/(?<=[kKtTpPhH])['’ʼ]/g, '')
        .replace(/[ŏŎ]/g, match => match === 'ŏ' ? 'eo' : 'Eo').replace(/[ŭŬ]/g, match => match === 'ŭ' ? 'eu' : 'Eu');
}
function romanisedKey(value: string): string {
    let text = String(value ?? '').normalize('NFKD').replace(/(?<=[oOuU])̄/g, '_').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^a-z_]+/g, '');
    text = text.replace(/o_|ou|oo|oh(?![aeiou])/g, 'o').replace(/u_|uu/g, 'u');
    return text;
}
export function nameRelation(a: unknown, b: unknown, context: NameContext = {}): NameVerdict {
    const x = partsOf(a), y = partsOf(b);
    if (!x.text || !y.text || x.text.length > 400 || y.text.length > 400)
        return { relation: 'unknown', cost: 0, basis: 'empty or overlong' };
    const lx = letters(`${x.last}${x.first}`), ly = letters(`${y.last}${y.first}`);
    if (lx && (lx === ly || lx === letters(`${y.first}${y.last}`)))
        return { relation: 'identical', cost: 0, basis: 'same letters' };
    const sx0 = suffixedForms(x), sy0 = suffixedForms(y);
    if ((sx0.suffixed || sy0.suffixed) && sx0.forms.some(form => sy0.forms.includes(form)))
        return { relation: 'identical', cost: 0, basis: 'same letters, the generation suffix placed apart' };
    const sx = scriptOfName(a), sy = scriptOfName(b);
    const latinBoth = sx === 'latin' && sy === 'latin';
    if (latinBoth) {
        const bare = (value: string) => wordsOf(value).filter(word => !NAME_JOINERS.particle.test(word)).join('');
        if (x.first && y.first && letters(x.first) === letters(y.first) && bare(x.last) && bare(x.last) === bare(y.last))
            return { relation: 'spelling', cost: 0, basis: 'surname particle' };
        const particles = (p: Parts) => wordsOf(`${p.first} ${p.last}`).filter(word => NAME_JOINERS.particle.test(word)).map(word => word.toLowerCase()).sort().join(' ');
        if (x.first && y.first && bare(x.first) && bare(x.first) === bare(y.first) && bare(x.last) && bare(x.last) === bare(y.last) && particles(x) && particles(x) === particles(y)) {
            return { relation: 'spelling', cost: 0, basis: 'surname particle placed on the other side' };
        }
        const initialsOf = (value: string) => value.split(/[\s.\-‐]+/).filter(Boolean).map(part => part[0].toLowerCase()).join('');
        const onlyInitials = (value: string) => /^(?:\p{Lu}\.?[\s\-‐]*)+$/u.test(value.trim()) || /^\p{Lu}{1,3}$/u.test(value.trim());
        const sameSurname = (p: Parts, q: Parts) => !!p.last && letters(p.last) === letters(q.last);
        if (sameSurname(x, y) && x.first && y.first && (onlyInitials(x.first) || onlyInitials(y.first)) && initialsOf(x.first) === initialsOf(y.first)) {
            return { relation: 'initials', cost: 0, basis: 'initials of the given name' };
        }
        if (sameSurname(x, y) && x.first && y.first && givenWordsAgree(x.first, y.first))
            return { relation: 'initials', cost: 0, basis: 'given names that agree word by word' };
        if (sameSurname(x, y) && (!x.first || !y.first))
            return { relation: 'initials', cost: 0, basis: 'surname only' };
        const kx = [romanisedKey(x.last), romanisedKey(x.first)].filter(Boolean), ky = [romanisedKey(y.last), romanisedKey(y.first)].filter(Boolean);
        const joined = (parts: string[]) => parts.join('');
        const variantOf = (p: Parts) => { const words = wordsOf(p.text).map(romanisedKey).filter(Boolean); return [...words].sort().join(' '); };
        if ((kx.length && joined(kx) === joined(ky)) || (kx.length && joined(kx) === joined([...ky].reverse())) || variantOf(x) === variantOf(y)) {
            return { relation: 'romanisedVariant', cost: 0, basis: 'the same romanisation, written another way' };
        }
    }
    if ((sx === 'hangul' && sy === 'latin') || (sx === 'latin' && sy === 'hangul')) {
        const hangul = sx === 'hangul' ? x : y, latin = sx === 'hangul' ? y : x;
        const joinedHangul = `${hangul.last}${hangul.first}`.replace(/\s+/g, '');
        const last = withoutMcCuneReischauer(latin.last), first = withoutMcCuneReischauer(latin.first);
        if (sameKoreanPerson(joinedHangul, last, first) || (first && sameKoreanPerson(joinedHangul, first, last)))
            return { relation: 'romanised', cost: 0, basis: 'Hangul and its romanisation' };
    }
    const hanjaSide = (script: string) => script === 'han';
    if ((hanjaSide(sx) && sy === 'hangul') || (sx === 'hangul' && hanjaSide(sy))) {
        const hx = { lastName: x.last, firstName: x.first }, hy = { lastName: y.last, firstName: y.first };
        if (sameKoreanPersonAcrossScripts(hx, hy))
            return { relation: 'hanjaReading', cost: 0, basis: 'Hanja surname reading and syllable count' };
        return { relation: 'different', cost: 0, basis: 'Hanja and Hangul do not agree on the surname or the length' };
    }
    if ((sx === 'han' || sx === 'kana') !== (sy === 'han' || sy === 'kana') && (sx === 'latin' || sy === 'latin')) {
        if (!context.positional)
            return { relation: 'unknown', cost: 0, basis: 'Han and Latin, with no seat that pairs them' };
        const native = sx === 'latin' ? y : x, latin = sx === 'latin' ? x : y;
        const nativeTokens = native.text.split(' ').filter(Boolean), latinTokens = latin.text.split(/[\s,]+/).filter(Boolean);
        const plausible = latinTokens.every(token => /^[a-z]\.?$/i.test(token) || ROMANISED_SYLLABLES.test(token.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[.'’-]/g, '')));
        const tokensAgree = nativeTokens.length < 2 || nativeTokens.length === latinTokens.length;
        const hanCount = native.text.replace(/\s+/g, '').length;
        const syllables = romanisedSyllables(latinTokens.join(''));
        const chinese = sx === 'han' || sy === 'han' ? syllables === hanCount : true;
        const japanese = nativeTokens.length === 1 && latinTokens.length === 2 && latinTokens.every(token => !/^[a-z]\.?$/i.test(token))
            && syllables > hanCount && syllables <= 3 * hanCount;
        if (plausible && tokensAgree && (chinese || japanese || scriptOfName(native.text) === 'kana' || nativeTokens.length === 2))
            return { relation: 'hanRomanised', cost: 0, basis: 'syllables and chunks agree in a pairing seat' };
        return { relation: 'different', cost: 0, basis: 'the romanisation does not read as that name' };
    }
    if (sx === 'hangul' && sy === 'hangul') {
        const chunks = (p: Parts) => (p.first ? [p.last, ...p.first.split(' ')] : p.last.split(/[\s,]+/)).map(chunk => chunk.trim()).filter(Boolean);
        const cx = chunks(x), cy = chunks(y);
        const korean = (list: string[]) => list.length === 1 || (list.length === 2 && isKoreanSurname(list[0]) && list[1].length <= 3);
        if (cx.length >= 2 && cy.length >= 2 && !korean(cx) && !korean(cy) && [...cx].sort().join(' ') === [...cy].sort().join(' ')) {
            return { relation: 'transliterationOrder', cost: 0, basis: 'the same chunks of a transliterated name' };
        }
    }
    if (context.allowMisread && sx === sy && sx !== 'none' && sx !== 'mixed') {
        const read = latinBoth ? `${x.first} ${x.last}`.trim() : `${x.last}${x.first}`.replace(/\s+/g, ''), other = latinBoth ? `${y.first} ${y.last}`.trim() : `${y.last}${y.first}`.replace(/\s+/g, '');
        if (/\d/.test(read) || /\d/.test(other))
            return { relation: 'different', cost: 0, basis: 'digits differ' };
        const cost = latinBoth ? latinMisreadCost(read, other, (context.field ?? 'person') === 'person') : confusionCost(read, other);
        if (cost <= misreadBudget(read, context.field ?? 'person'))
            return { relation: 'misread', cost, basis: 'letters that look alike' };
        return { relation: 'different', cost: Number.isFinite(cost) ? cost : 0, basis: 'more than a misreading apart' };
    }
    return { relation: 'different', cost: 0, basis: 'no relation found' };
}
function givenWords(value: string): string[] {
    return value.normalize('NFKD').replace(/\p{M}+/gu, '').replace(/\.\s*(?=[-‐])|(?<=[-‐])\s+/gu, '').split(/[\s.]+/).map(word => word.replace(/‐/g, '-')).filter(Boolean);
}
function givenWordAgrees(a: string, b: string): boolean {
    const x = a.toLowerCase(), y = b.toLowerCase();
    if (x === y)
        return true;
    const px = x.split('-').filter(Boolean), py = y.split('-').filter(Boolean);
    if (px.length > 1 || py.length > 1)
        return px.length === py.length && px.every((part, at) => givenWordAgrees(part, py[at]));
    return (x.length === 1 && y.startsWith(x)) || (y.length === 1 && x.startsWith(y));
}
function givenWordsAgree(a: string, b: string): boolean {
    const x = givenWords(a), y = givenWords(b);
    if (!x.length || !y.length)
        return false;
    const [short, long] = x.length <= y.length ? [x, y] : [y, x];
    return short.every((word, at) => givenWordAgrees(word, long[at])) && long.slice(short.length).every(word => /^\p{L}$/u.test(word));
}
export function romanisedSyllables(latin: unknown): number {
    const text = String(latin ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^a-zü]+/g, '');
    if (text.length > 400)
        return 0;
    return (text.match(/(?:ch|sh|ts|zh|ng|[bcdfghjklmnpqrstvwxz])?[yw]?[aeiouü]+(?:ng|n(?![aeiou])|r(?![aeiou]))?/g) || []).length;
}
export function surnameAgrees(hangulName: string, person: any): boolean {
    const korean = splitHangulName(hangulName);
    if (!korean?.given)
        return false;
    const given = romanise(korean.given);
    return splitLatinName(person?.lastName, person?.firstName).some(reading => sameKoreanPerson(hangulName, reading.surname, given));
}
export type NamePolicy = 'merge' | 'link' | 'bodyLanguage' | 'hanjaInHangul' | 'storedDifference' | 'bylineMerge' | 'printedOnPage' | 'misreadCorrection';
const POLICY: Record<Exclude<NamePolicy, 'merge' | 'printedOnPage'>, ReadonlySet<NameRelation>> = {
    link: new Set<NameRelation>(['identical', 'spelling', 'initials', 'hanjaReading', 'romanised', 'romanisedVariant']),
    bodyLanguage: new Set<NameRelation>(['identical', 'romanised', 'hanRomanised']),
    hanjaInHangul: new Set<NameRelation>(['identical', 'hanjaReading']),
    storedDifference: new Set<NameRelation>(['identical', 'spelling', 'initials', 'romanised', 'hanjaReading', 'romanisedVariant', 'transliterationOrder']),
    bylineMerge: new Set<NameRelation>(['identical', 'spelling', 'initials', 'hanjaReading', 'romanised', 'hanRomanised', 'transliterationOrder', 'misread', 'romanisedVariant']),
    misreadCorrection: new Set<NameRelation>(['misread'])
};
export function sameName(a: unknown, b: unknown, policy: NamePolicy, context: NameContext = {}): boolean {
    if (policy === 'merge')
        return samePerson(typeof a === 'string' ? { lastName: a } : a, typeof b === 'string' ? { lastName: b } : b);
    if (policy === 'printedOnPage')
        return printedPerson(String(a ?? ''), b);
    const verdict = nameRelation(a, b, { ...context, ...(policy === 'misreadCorrection' || policy === 'bylineMerge' && context.allowMisread ? { allowMisread: true } : {}) });
    return POLICY[policy].has(verdict.relation);
}
const NEAR_INITIALS: ReadonlyArray<readonly number[]> = [[18, 14, 12], [11, 18], [0, 15], [3, 16], [7, 17], [9, 12]];
const VERTICAL_VOWELS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 20]);
const HORIZONTAL_VOWELS = new Set([8, 12, 13, 17, 18]);
const NEAR_VOWEL_PAIRS: ReadonlyArray<readonly number[]> = [[9, 14], [10, 15]];
const NEAR_FINALS: ReadonlyArray<readonly number[]> = [[8, 10, 11], [1, 2], [16, 21]];
const near = (groups: ReadonlyArray<readonly number[]>, a: number, b: number) => groups.some(group => group.includes(a) && group.includes(b));
export const VERTICAL_STROKE_GLYPHS: readonly string[] = ['l', 'I', '1', 'i', '|'];
const NEAR_LATIN: ReadonlyArray<readonly string[]> = [VERTICAL_STROKE_GLYPHS, ['O', '0', 'o', 'Q'], ['c', 'e'], ['u', 'v'], ['h', 'b'], ['S', '5'], ['B', '8']];
const NEAR_LATIN_PAIRS: ReadonlyArray<readonly [
    string,
    string
]> = [['rn', 'm'], ['cl', 'd'], ['vv', 'w']];
export function confusionCost(a: string, b: string, options: {
    keepInitials?: boolean;
} = {}): number {
    const x = [...String(a ?? '').normalize('NFC')], y = [...String(b ?? '').normalize('NFC')];
    if (x.length > 400 || y.length > 400)
        return Infinity;
    const hangul = x.some(char => /[가-힣]/.test(char)) || y.some(char => /[가-힣]/.test(char));
    if (hangul) {
        if (x.length !== y.length)
            return Infinity;
        let cost = 0;
        for (let at = 0; at < x.length; at++) {
            if (x[at] === y[at])
                continue;
            const p = jamoOf(x[at]), q = jamoOf(y[at]);
            if (!p || !q)
                return Infinity;
            if (options.keepInitials && p[0] !== q[0])
                return Infinity;
            if (p[0] !== q[0])
                cost += near(NEAR_INITIALS, p[0], q[0]) ? 0.5 : 1;
            if (p[1] !== q[1])
                cost += (VERTICAL_VOWELS.has(p[1]) && VERTICAL_VOWELS.has(q[1])) || (HORIZONTAL_VOWELS.has(p[1]) && HORIZONTAL_VOWELS.has(q[1])) || near(NEAR_VOWEL_PAIRS, p[1], q[1]) ? 0.5 : 1;
            if (p[2] !== q[2])
                cost += p[2] && q[2] && near(NEAR_FINALS, p[2], q[2]) ? 0.5 : 1;
        }
        return cost;
    }
    return latinEdits(x, y).cost;
}
function latinEdits(x: string[], y: string[], dropped = false): {
    cost: number;
    positions: number;
} {
    let i = 0, j = 0, cost = 0, positions = 0;
    const same = (a: string | undefined, b: string | undefined) => a !== undefined && b !== undefined && (a === b || a.toLowerCase() === b.toLowerCase());
    if (dropped && Math.abs(x.length - y.length) === 1) {
        const [longer, shorter] = x.length > y.length ? [x, y] : [y, x];
        let at = 0;
        while (at < shorter.length && same(longer[at], shorter[at]))
            at++;
        if (at > 0 && at < longer.length - 1 && /\p{Script=Latin}/u.test(longer[at]) && longer.slice(at + 1).every((char, k) => same(char, shorter[at + k])))
            return { cost: 1, positions: 1 };
    }
    while (i < x.length || j < y.length) {
        if (i < x.length && j < y.length && same(x[i], y[j])) {
            i++;
            j++;
            continue;
        }
        const pair = NEAR_LATIN_PAIRS.find(([two, one]) => (x.slice(i, i + 2).join('') === two && y[j] === one) || (y.slice(j, j + 2).join('') === two && x[i] === one));
        if (pair) {
            if (x.slice(i, i + 2).join('') === pair[0]) {
                i += 2;
                j += 1;
            }
            else {
                i += 1;
                j += 2;
            }
            cost += 0.5;
            positions++;
            continue;
        }
        if (i >= x.length || j >= y.length)
            return { cost: Infinity, positions };
        if (crossesScripts(x[i], y[j]))
            return { cost: Infinity, positions };
        if (same(x[i], y[j + 1]) && same(x[i + 1], y[j]) && !same(x[i], x[i + 1])) {
            cost += 1;
            positions++;
            i += 2;
            j += 2;
            continue;
        }
        cost += NEAR_LATIN.some(group => group.includes(x[i]) && group.includes(y[j])) ? 0.5 : 1;
        positions++;
        i++;
        j++;
    }
    return { cost, positions };
}
function latinMisreadCost(read: string, other: string, dropped = false): number {
    const a = read.split(/\s+/).filter(Boolean), b = other.split(/\s+/).filter(Boolean);
    if (!a.length || a.length !== b.length)
        return Infinity;
    let total = 0;
    for (let at = 0; at < a.length; at++) {
        if (a[at] === b[at])
            continue;
        const x = [...a[at].normalize('NFC')], y = [...b[at].normalize('NFC')];
        if (x.some(char => /[가-힣]/.test(char)) || y.some(char => /[가-힣]/.test(char)))
            return Infinity;
        const { cost, positions } = latinEdits(x, y, dropped);
        if (!Number.isFinite(cost) || positions > Math.floor(x.length / 4))
            return Infinity;
        total += cost;
    }
    return total;
}
export function misreadBudget(value: string, field: 'person' | 'house' | 'place'): number {
    void field;
    const text = String(value ?? '').normalize('NFC');
    const syllables = (text.match(/[가-힣]/g) || []).length;
    if (syllables)
        return syllables >= 3 ? 1 : syllables === 2 ? 0.5 : 0;
    const size = (text.match(/\p{L}/gu) || []).length;
    return size >= 5 ? Math.floor(size / 5) + 0.5 : 0;
}
let lastPage: {
    text: string;
    folded: string;
} | null = null;
const foldedPage = (text: string) => { if (lastPage && lastPage.text === text)
    return lastPage.folded; const folded = letters(text); lastPage = { text, folded }; return folded; };
export function printedPerson(text: string, person: unknown, options: {
    ocr?: boolean;
} = {}): boolean {
    const p = partsOf(person);
    if (!p.text)
        return false;
    const page = foldedPage(String(text ?? '')), forms = [letters(`${p.first}${p.last}`), letters(`${p.last}${p.first}`), ...suffixedForms(p).forms].filter(form => form.length >= 2);
    if (!page || !forms.length)
        return false;
    if (forms.some(form => page.includes(form)))
        return true;
    if (!options.ocr)
        return false;
    const words = String(text ?? '').normalize('NFKC').split(/[^\p{L}\p{N}'’-]+/u).filter(Boolean);
    if (words.length > 200000)
        return false;
    for (const target of [`${p.first} ${p.last}`, `${p.last} ${p.first}`].map(form => form.trim().split(/\s+/).filter(Boolean))) {
        const joined = target.join(' ');
        if (joined.replace(/\s+/g, '').length < 5)
            continue;
        const budget = misreadBudget(joined.replace(/\s+/g, ''), 'person');
        const hangul = /[가-힣]/.test(joined);
        for (let at = 0; at + target.length <= words.length; at++) {
            const window = words.slice(at, at + target.length);
            if (window.some((word, index) => [...word].length !== [...target[index]].length))
                continue;
            const cost = hangul ? confusionCost(window.join(''), target.join('')) : latinMisreadCost(window.join(' '), joined);
            if (cost <= budget)
                return true;
        }
    }
    return false;
}
export function casedAsPrinted(name: string, evidence: {
    pages?: string;
    records?: readonly string[];
    opens?: boolean;
} = {}): string {
    const value = String(name ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!value)
        return value;
    const fromPage = printedForm(value, evidence.pages);
    if (fromPage)
        return fromPage;
    for (const record of evidence.records || []) {
        const form = printedForm(value, record);
        if (form)
            return form;
    }
    const words = value.split(' ');
    return words.map((word, index) => {
        if (index > 0 && /^(?:II|III|IV),?$/i.test(word) && !/\p{Ll}/u.test(word))
            return word.toUpperCase();
        if (index > 0 && /^(?:JR|SR)\.?,?$/.test(word))
            return word[0] + word.slice(1).toLowerCase();
        if (!/\p{L}/u.test(word) || (/\p{Lu}/u.test(word) && /\p{Ll}/u.test(word)) || initialsWord(word))
            return word;
        if ((index > 0 || evidence.opens === false) && index < words.length - 1 && (NAME_JOINERS.particle.test(word) || NAME_JOINERS.connective.test(word)))
            return word.toLowerCase();
        return word.toLowerCase().replace(/(^|[-‐'’])(\p{L})/gu, (_, mark, letter) => mark + letter.toUpperCase()).replace(/^Mc(\p{L})/u, (_, letter) => `Mc${letter.toUpperCase()}`);
    }).join(' ');
}
export function initialsWord(token: string): boolean {
    if (!/^[\p{Lu}.\-‐]+$/u.test(token))
        return false;
    const segments = token.split(/[.\-‐]+/).filter(Boolean);
    return !!segments.length && (segments.every(segment => [...segment].length === 1) || (segments.length === 1 && [...token].length <= 3 && !/[AEIOUY]/.test(token)));
}
export function printedForm(name: string, source: string | undefined): string {
    if (String(name ?? '').length > 400)
        return '';
    const tokens = String(name ?? '').trim().split(/\s+/).filter(Boolean).map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!tokens.length || tokens.length > 40 || !source || !/\p{Ll}/u.test(source))
        return '';
    const counts = new Map<string, number>();
    try {
        const pattern = new RegExp(`(?<![\\p{L}])${tokens.join('\\s+')}(?![\\p{L}])`, 'giu');
        for (const match of source.normalize('NFC').matchAll(pattern)) {
            const form = match[0].replace(/\s+/g, ' ');
            if (/\p{Lu}/u.test(form) && /\p{Ll}/u.test(form))
                counts.set(form, (counts.get(form) || 0) + 1);
        }
    }
    catch {
        return '';
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

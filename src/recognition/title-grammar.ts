import { INFLECTIONAL_ENDING } from '../metadata/person-name';
export type TitleEnding = 'open' | 'maybe' | 'closed';
const nfkc = (value: unknown) => String(value ?? '').replace(/ㆍ/g, '·').normalize('NFKC');
const HANGUL = /[가-힯]/;
const CJK = /[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
function bare(value: unknown): string {
    const text = nfkc(value).trim();
    let end = text.length;
    while (end > 0 && /[\s*†‡§¶∗⁎#]/u.test(text[end - 1]))
        end--;
    return text.slice(0, end);
}
function endsOnAFootnoteMark(value: unknown): boolean {
    return /[*†‡§¶∗⁎]$/u.test(nfkc(value).trim());
}
function withoutEndStops(value: string): string {
    let end = value.length;
    while (end > 0 && '.,;:·'.includes(value[end - 1]))
        end--;
    return value.slice(0, end);
}
function lastWords(value: string): {
    last: string;
    previous: string;
} {
    const end = value.length;
    let at = end;
    while (at > 0 && !/\s/.test(value[at - 1]))
        at--;
    const last = value.slice(at, end);
    let stop = at;
    while (stop > 0 && /\s/.test(value[stop - 1]))
        stop--;
    let start = stop;
    while (start > 0 && !/\s/.test(value[start - 1]))
        start--;
    return { last, previous: value.slice(start, stop) };
}
const LATIN_FUNCTION_WORD = /^(?:of|for|in|on|with|and|or|by|to|from|using|via|the|a|an|its|their|under|over|between|through|into|towards?|based)$/i;
const OPEN_MARK = /[:：;,，\-‐‑–—―/]$/u;
function unclosedBracket(value: string): boolean {
    let round = 0, square = 0;
    for (const ch of value) {
        if (ch === '(' || ch === '（')
            round++;
        else if ((ch === ')' || ch === '）') && round > 0)
            round--;
        else if (ch === '[' || ch === '［')
            square++;
        else if ((ch === ']' || ch === '］') && square > 0)
            square--;
    }
    return round > 0 || square > 0;
}
const UNSTRANDABLE = /^(?:the|a|an|and|or|its|their)$/i;
function endsOnLatinFunctionWord(value: string): boolean {
    const { last } = lastWords(value);
    let from = last.length;
    while (from > 0 && /[A-Za-z]/.test(last[from - 1]))
        from--;
    const word = last.slice(from);
    if (!word || !LATIN_FUNCTION_WORD.test(word))
        return false;
    if (word.length < last.replace(/[^\p{L}\-]/gu, '').length && !/-based$/i.test(last))
        return false;
    const mixed = /\p{Ll}/u.test(value);
    if (mixed && /^\p{Lu}/u.test(word) && !UNSTRANDABLE.test(word) && value.trim().split(/\s+/).length > 1)
        return false;
    return true;
}
export function endsOnALatinFunctionWord(value: unknown): boolean {
    if (endsOnAFootnoteMark(value))
        return false;
    const text = bare(value);
    return !!text && endsOnLatinFunctionWord(text);
}
export function endsOpenInLatinOrMark(value: unknown): boolean {
    if (endsOnAFootnoteMark(value))
        return false;
    const text = bare(value);
    if (!text)
        return false;
    return (OPEN_MARK.test(text) && !closesADashPair(text)) || unclosedBracket(text) || endsOnLatinFunctionWord(text);
}
const DASH = /[-‐‑–—―]/u;
function closesADashPair(text: string): boolean {
    const last = text.length - 1;
    if (!DASH.test(text[last] || '') || !/\s/.test(text[last - 1] || ''))
        return false;
    for (let at = last - 2; at >= 0; at--) {
        if (!DASH.test(text[at]))
            continue;
        const opens = (at === 0 || /\s/.test(text[at - 1])) && /\s/.test(text[at + 1] || '');
        return opens && /[\p{L}\p{N}]/u.test(text.slice(at + 1, last));
    }
    return false;
}
const CASE_PARTICLE_END = /(?:에게|에서|으로|에|을|를|로|와|과)$/;
const DOUBLE_PARTICLE_GENITIVE = /(?:에서의|으로서의|로서의|으로의|로의|에의|와의|과의|에게의)$/;
const CONJUNCTION = /^(?:및|또는|그리고|혹은|내지)$/;
const POSTPOSITION = /^(?:대한|관한|위한|통한|의한|따른|인한|향한|비롯한|대해|관해)$/;
const LIGHT_VERB_MODIFIER = /(?:하는|되는|한|된|할|될)$/;
const CONNECTIVE_ENDING = /(?:하여|어서)의?$/;
const DETERMINER_JEOK = /(?<=[가-힣]{2})적$/;
export function endsOpenInKorean(value: unknown): boolean {
    if (endsOnAFootnoteMark(value))
        return false;
    const text = withoutEndStops(bare(value));
    if (!text || !HANGUL.test(text))
        return false;
    const { last, previous } = lastWords(text);
    if (!last || !HANGUL.test(last))
        return false;
    if (DOUBLE_PARTICLE_GENITIVE.test(last) && last.length >= 3)
        return true;
    if (CONJUNCTION.test(last))
        return true;
    if (DETERMINER_JEOK.test(last) && (/(?<=[가-힣]{2})적[,，·]$/.test(previous) || /(?<=[가-힣]{2})적[,，·](?=[가-힣]{2,6}적$)/.test(last)))
        return true;
    const afterParticle = !!previous && HANGUL.test(previous) && CASE_PARTICLE_END.test(previous);
    if (!afterParticle)
        return false;
    if (POSTPOSITION.test(last))
        return true;
    if (last.length >= 3 && LIGHT_VERB_MODIFIER.test(last))
        return true;
    return CONNECTIVE_ENDING.test(last);
}
const MAYBE_ONE = /[의과와을를에로도은는이가]$/;
const MAYBE_TWO = /(?:에서|으로|에게|에는|부터|까지|이나|처럼|보다)$/;
export function titleEnding(line: unknown): TitleEnding {
    if (endsOnAFootnoteMark(line))
        return 'closed';
    const text = bare(line);
    if (!text)
        return 'closed';
    if (endsOpenInLatinOrMark(text) || endsOpenInKorean(text))
        return 'open';
    const hangul = withoutEndStops(text);
    if (HANGUL.test(hangul[hangul.length - 1] || '') && (MAYBE_TWO.test(hangul) || MAYBE_ONE.test(hangul)))
        return 'maybe';
    return 'closed';
}
function opensWithLowerWord(value: string): boolean {
    const lower = /^\p{Ll}+/u.exec(value);
    if (!lower || [...lower[0]].length < 2)
        return false;
    const word = /^[\p{L}\p{N}]*/u.exec(value)?.[0] ?? '';
    return !'*†‡§¶'.includes(value[word.length] ?? '\u0000');
}
const ADDRESS_OPENING = /^(?:https?:\/\/|www\.|doi\.org\/|[\w.+-]+@[\w-]+\.)/i;
const CONTINUING_KOREAN = /^(?:관한|대한|위한|통한|의한|따른|인한|향한|및|그리고|또는|있는|없는)(?=\s|$)/;
const LATIN_FUNCTION_OPENING = /^(?:of|for|in|on|with|and|or|by|to|from|using|via|the|a|an|its|their|under|over|between|through|at|as|into|towards?)\b/i;
export function titleOpening(line: unknown): 'continuing' | 'other' {
    const text = nfkc(line).trim();
    if (!text || ADDRESS_OPENING.test(text))
        return 'other';
    if (!HANGUL.test(text) && opensWithLowerWord(text))
        return 'continuing';
    if (/^[&＆]\s/.test(text))
        return 'continuing';
    if (HANGUL.test(text[0] || '') && CONTINUING_KOREAN.test(text))
        return 'continuing';
    return 'other';
}
export function opensOnAFunctionWord(line: unknown): boolean {
    return LATIN_FUNCTION_OPENING.test(nfkc(line).trim());
}
export function adverbialSubtitle(line: unknown): boolean {
    const text = withoutEndStops(bare(line));
    if (!HANGUL.test(text))
        return false;
    const { last, previous } = lastWords(text);
    return /^[가-힣]{1,6}으?로$/.test(last) && last.length >= 2 && /[을를]$/.test(previous) && HANGUL.test(previous);
}
export function typefaceClass(line: unknown): 'capitals' | 'mixed' | 'caseless' {
    const text = nfkc(line);
    if (CJK.test(text))
        return 'caseless';
    const upper = /\p{Lu}/u.test(text), lower = /\p{Ll}/u.test(text);
    if (upper && !lower)
        return 'capitals';
    return upper || lower ? 'mixed' : 'caseless';
}
export function looksCutOff(value: unknown): boolean {
    return endsOpenInLatinOrMark(value);
}
export function endsOnADanglingModifier(value: unknown): boolean {
    return endsOpenInKorean(value);
}
export function looksTruncatedTitle(value: unknown): boolean {
    return titleEnding(value) === 'open';
}
export const CODE_TOKEN_SHAPE = /^(?=[^\s]*\d)(?=[^\s]*[A-Z])[A-Z0-9][A-Za-z0-9._/+-]{2,39}$/;
const RESTATEMENT_WORD = 4;
const RESTATEMENT_STEM = 5;
const INFLECTION = INFLECTIONAL_ENDING;
function contentWords(value: unknown): string[] {
    return nfkc(value).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
        .split(/[^\p{L}]+/u).filter(word => word.length > RESTATEMENT_WORD);
}
export function parallelRestatement(title: unknown, part: unknown): boolean {
    const main = nfkc(title), other = nfkc(part);
    if (!main.trim() || !other.trim())
        return false;
    const cjkMain = CJK.test(main), cjkOther = CJK.test(other);
    const latinMain = /\p{Script=Latin}/u.test(main.replace(/[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/gu, '')), latinOther = /\p{Script=Latin}/u.test(other.replace(/[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/gu, ''));
    if ((cjkMain && !latinMain && !cjkOther && latinOther) || (!cjkMain && latinMain && cjkOther && !latinOther))
        return true;
    if (cjkMain || cjkOther)
        return false;
    const counted = kinOfTitleWords(main, other);
    if (counted.theirs < 4 || counted.words < 3)
        return shortRestatement(main, other);
    return counted.cognate >= 2 && counted.cognate + counted.shared >= 4;
}
const SHORT_STEM = 4;
function shortRestatement(title: string, part: string): boolean {
    const words = contentWords(title), theirs = contentWords(part);
    if (theirs.length !== 3 || words.length !== theirs.length)
        return false;
    const pool = [...words];
    for (const word of theirs) {
        const at = pool.findIndex(entry => entry.slice(0, SHORT_STEM) === word.slice(0, SHORT_STEM));
        if (at < 0)
            return false;
        pool.splice(at, 1);
    }
    return true;
}
function kinOfTitleWords(title: string, part: string): {
    cognate: number;
    shared: number;
    words: number;
    theirs: number;
} {
    const words = contentWords(title), theirs = contentWords(part);
    let cognate = 0, shared = 0;
    const held = new Set(words);
    const firstOfStem = new Map<string, string>();
    for (const entry of words)
        if (entry.length >= RESTATEMENT_STEM && !firstOfStem.has(entry.slice(0, RESTATEMENT_STEM)))
            firstOfStem.set(entry.slice(0, RESTATEMENT_STEM), entry);
    for (const word of theirs) {
        if (held.has(word)) {
            shared++;
            continue;
        }
        const stem = word.slice(0, RESTATEMENT_STEM);
        const kin = firstOfStem.get(stem);
        if (!kin)
            continue;
        if (kin.replace(INFLECTION, '') === word.replace(INFLECTION, '')) {
            shared++;
            continue;
        }
        cognate++;
    }
    return { cognate, shared, words: words.length, theirs: theirs.length };
}
export function titleWordsRespelled(title: unknown, line: unknown): number {
    const main = nfkc(title), other = nfkc(line);
    if (!main.trim() || !other.trim() || CJK.test(main) || CJK.test(other))
        return 0;
    return kinOfTitleWords(main, other).cognate;
}

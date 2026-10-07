const COMMON = new Set(('the of and in to for with is are on by from this that as be at an or which can was were has ' +
    'have its their between into these also we our based using such than when where these more other been where high').split(' '));
const MIN_DECODED_HITS = 8;
function decodeToken(token: string, shift: number): string | null {
    let out = '';
    let lower = 0;
    for (const character of token) {
        const code = character.charCodeAt(0) + shift;
        const upper = code >= 0x41 && code <= 0x5a, small = code >= 0x61 && code <= 0x7a;
        if (!upper && !small)
            return null;
        if (small)
            lower++;
        out += String.fromCharCode(code);
    }
    if (out.length === 1)
        return /^[aAI]$/.test(out) ? out : null;
    if (!lower || !/[aeiouy]/i.test(out))
        return null;
    return out;
}
function commonHits(tokens: string[]): number {
    return tokens.filter(token => COMMON.has(token.toLowerCase())).length;
}
function decodeText(text: string, shift: number): {
    text: string;
    decoded: string[];
} {
    const decoded: string[] = [];
    const repaired = text.replace(/\S+/g, token => {
        const letters = decodeToken(token, shift);
        if (letters === null)
            return token;
        decoded.push(letters);
        return letters;
    });
    return { text: repaired, decoded };
}
export function repairShiftedEncoding(text: string): {
    text: string;
    shift: number;
} {
    const value = String(text || '');
    const tokens = value.match(/\S+/g) || [];
    if (tokens.length < 30)
        return { text: value, shift: 0 };
    let best = { shift: 0, hits: 0, text: value };
    for (let shift = 1; shift <= 63; shift++) {
        if (shift === 32)
            continue;
        const attempt = decodeText(value, shift);
        if (attempt.decoded.length < 20 || attempt.decoded.length < tokens.length * 0.2)
            continue;
        const hits = commonHits(attempt.decoded);
        const distinct = new Set(attempt.decoded.map(token => token.toLowerCase()).filter(token => COMMON.has(token))).size;
        if (hits >= MIN_DECODED_HITS && distinct >= 4 && hits / attempt.decoded.length >= 0.15 && hits > best.hits)
            best = { shift, hits, text: attempt.text };
    }
    return { text: best.text, shift: best.shift };
}
export function repairShiftedPages(text: string): string {
    return String(text || '').split('\f').map(page => repairShiftedEncoding(page).text).join('\f');
}
const SPACING_ACCENTS: Readonly<Record<string, string>> = {
    '\u00B4': '\u0301', '`': '\u0300', '\u00A8': '\u0308', '\u02C6': '\u0302', '\u02DC': '\u0303', '\u02D8': '\u0306', '\u02DA': '\u030A',
    '\u02DD': '\u030B', '\u00AF': '\u0304', '\u00B8': '\u0327', '\u02C7': '\u030C', '\u02D9': '\u0307'
};
const CONSONANT_MARKS = new Set(['\u0327', '\u030C', '\u0307']);
const DETACHED_ACCENT = /[\u00B4`\u00A8\u02C6\u02DC\u02D8\u02DA\u02DD\u00AF\u00B8\u02C7\u02D9]|\s[\u0300-\u036F]/u;
const LATIN_VOWEL = /^[aeiouyAEIOUYıæøÆØ]$/u;
function composedWith(letter: string | undefined, mark: string): string | null {
    if (!letter || !/^\p{Script=Latin}$/u.test(letter))
        return null;
    const base = letter === 'ı' ? 'i' : letter;
    const composed = (base + mark).normalize('NFC');
    return [...composed].length === 1 && composed !== base ? composed : null;
}
export function withAttachedAccents(text: string): string {
    const value = String(text ?? '');
    if (!DETACHED_ACCENT.test(value))
        return value;
    const chars = [...value];
    const out: string[] = [];
    for (let at = 0; at < chars.length; at++) {
        const here = chars[at];
        let mark = SPACING_ACCENTS[here] || '', width = 1;
        if (!mark && /^\s$/u.test(here) && here !== '\n' && /^[\u0300-\u036F]$/u.test(chars[at + 1] || '')) {
            mark = chars[at + 1];
            width = 2;
        }
        if (!mark) {
            out.push(here);
            continue;
        }
        const before = out[out.length - 1], after = chars[at + width];
        if (here === '`' && !(/^\p{L}$/u.test(before || '') && /^\p{L}$/u.test(after || ''))) {
            out.push(here);
            continue;
        }
        const vowelsOnly = !CONSONANT_MARKS.has(mark);
        const fits = (letter: string | undefined) => !vowelsOnly || LATIN_VOWEL.test(letter || '');
        const onBefore = fits(before) ? composedWith(before, mark) : null;
        const onAfter = fits(after) ? composedWith(after, mark) : null;
        const toAfter = !!onAfter && (!onBefore || (vowelsOnly && /^[eE]$/.test(after || '') && !/^[eE]$/.test(before || '')));
        if (toAfter) {
            out.push(onAfter!);
            at += width;
            continue;
        }
        if (onBefore) {
            out[out.length - 1] = onBefore;
            at += width - 1;
            continue;
        }
        out.push(...chars.slice(at, at + width));
        at += width - 1;
    }
    return out.join('');
}

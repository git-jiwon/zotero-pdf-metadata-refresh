export const NOTE_MARK = '[*∗⁎†‡§¶#☆★✝✉∥]';
const SUPERSCRIPT_DIGIT = '[⁰¹²³⁴⁵⁶⁷⁸⁹]';
const TRAILING_NOTE_MARKS = new RegExp(`(?:(?<=\\p{L}{2}|[\\p{N})\\]’'"”」』])\\s*${NOTE_MARK}|(?<=\\p{L}{3})${SUPERSCRIPT_DIGIT})`
    + `(?:[\\s,]*(?:${NOTE_MARK}|${SUPERSCRIPT_DIGIT}))*(?=\\s*(?:$|[:：]))`, 'gu');
export function withoutNoteMarks(value: string): string {
    return String(value ?? '').replace(TRAILING_NOTE_MARKS, '').trim();
}
const foldedHeld = new Map<string, string>();
export const foldedLetters = (value: unknown) => {
    const text = String(value ?? '');
    if (text.length <= 400) {
        const held = foldedHeld.get(text);
        if (held !== undefined)
            return held;
    }
    const bare = text.length <= 400 ? withoutNoteMarks(text) : text.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, '');
    const folded = bare.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    if (text.length <= 400) {
        if (foldedHeld.size > 50000)
            foldedHeld.clear();
        foldedHeld.set(text, folded);
    }
    return folded;
};
export const shouting = (value: string) => (value.match(/\p{Lu}/gu) || []).length >= 2 && !/\p{Ll}/u.test(value);
export const linesOf = (text: unknown) => String(text ?? '').normalize('NFKC').split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
export function journalKey(value: unknown): string {
    const text = String(value ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
        .replace(/&amp;/g, '&').replace(/[&＆]/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return text.replace(/^the\s+/, '').replace(/\s+/g, '');
}

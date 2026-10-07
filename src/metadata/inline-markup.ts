const MATHML_NAMES = ['math', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mrow', 'msub', 'msup', 'msubsup', 'mfrac', 'mover', 'munder', 'munderover', 'msqrt', 'mroot', 'mfenced',
    'mspace', 'mstyle', 'mpadded', 'mphantom', 'semantics'];
const TAG_SOURCE = `<(\\/?)\\s*((?:jats|mml):[\\w.-]+|sub|sup|i|b|em|strong|scp|sc|span|u|tt|italic|bold|underline|sans-serif|monospace|small-caps|inline-formula|${MATHML_NAMES.join('|')})(?=[\\s/>])[^<>]{0,300}>`;
const TAG = new RegExp(TAG_SOURCE, 'gi');
const ONE_TAG = new RegExp(TAG_SOURCE, 'i');
const REPEATED = /<((?:mml:|jats:)?(?:annotation(?:-xml)?|tex-math))\b[^<>]{0,300}>[\s\S]{0,2000}?<\/\1\s*>/gi;
const SUB_SUP = new Set(['sub', 'sup', 'jats:sub', 'jats:sup', 'mml:msub', 'mml:msup', 'msub', 'msup']);
const MATH_ROOT = new Set(['math', 'mml:math']);
const isMathML = (name: string) => name.startsWith('mml:') || MATHML_NAMES.includes(name);
type Item = {
    char: string;
} | {
    tag: string;
    close: boolean;
    self: boolean;
};
const isTag = (item: Item | undefined): item is {
    tag: string;
    close: boolean;
    self: boolean;
} => !!item && 'tag' in item;
const isSpace = (item: Item | undefined) => !!item && 'char' in item && /\s/u.test(item.char);
export function hasInlineMarkup(value: unknown): boolean {
    const text = String(value ?? '');
    return text.includes('<') && ONE_TAG.test(text);
}
function itemsOf(text: string): Item[] {
    const plain = text.replace(REPEATED, '');
    const items: Item[] = [];
    let last = 0;
    for (const match of plain.matchAll(TAG)) {
        const at = match.index ?? 0;
        for (const char of plain.slice(last, at))
            items.push({ char });
        items.push({ tag: match[2].toLowerCase(), close: !!match[1], self: /\/\s*>$/.test(match[0]) });
        last = at + match[0].length;
    }
    for (const char of plain.slice(last))
        items.push({ char });
    return items;
}
function spaceStands(items: Item[], from: number, to: number): boolean {
    const before = items[from - 1], after = items[to];
    if (!before || !after || isTag(before) || isTag(after))
        return false;
    const a = before.char, b = after.char;
    let outer = false, attaches = false, closedSub = false, closedSubBeforeOuter = false;
    for (let k = from; k < to;) {
        const item = items[k];
        if (isTag(item)) {
            if (item.close && SUB_SUP.has(item.tag))
                closedSub = true;
            k++;
            continue;
        }
        let end = k;
        while (end < to && !isTag(items[end]))
            end++;
        const prev = k > from ? items[k - 1] : undefined, next = end < to ? items[end] : undefined;
        const inner = (isTag(prev) && !prev.close && !prev.self) || (isTag(next) && next.close)
            || (isTag(prev) && isTag(next) && isMathML(prev.tag) && isMathML(next.tag) && !(prev.close && MATH_ROOT.has(prev.tag)) && !(!next.close && MATH_ROOT.has(next.tag)));
        if (!inner) {
            outer = true;
            if (closedSub)
                closedSubBeforeOuter = true;
            if (isTag(next) && !next.close && SUB_SUP.has(next.tag))
                attaches = true;
        }
        k = end;
    }
    if (!outer || attaches)
        return false;
    const DASH = /[-‐‑‒–—−/]/u;
    if (/[)\]}.,;:!?’”]/u.test(b))
        return false;
    if (DASH.test(b) && !isSpace(items[to + 1]))
        return false;
    if (/[(\[{‘“]/u.test(a))
        return false;
    if (DASH.test(a) && !isSpace(items[from - 2]))
        return false;
    if (closedSubBeforeOuter) {
        for (let k = to; k < items.length && !isSpace(items[k]); k++) {
            const item = items[k];
            if (isTag(item) && !item.close && SUB_SUP.has(item.tag))
                return false;
        }
    }
    return true;
}
export function withoutInlineMarkup(value: unknown): string {
    const text = String(value ?? '');
    if (!hasInlineMarkup(text))
        return text;
    const items = itemsOf(text);
    const out: string[] = [];
    for (let at = 0; at < items.length;) {
        const item = items[at];
        if (!isTag(item) && !isSpace(item)) {
            out.push(item.char);
            at++;
            continue;
        }
        let end = at;
        while (end < items.length && (isTag(items[end]) || isSpace(items[end])))
            end++;
        const run = items.slice(at, end);
        const tagged = run.some(isTag), spaced = run.some(isSpace);
        if (spaced && (!tagged || spaceStands(items, at, end)))
            out.push(' ');
        at = end;
    }
    return out.join('').replace(/\s+/gu, ' ').trim();
}
export function markupJointsAlong(marked: unknown, plain: unknown): boolean[] | null {
    const text = String(marked ?? '');
    if (!hasInlineMarkup(text))
        return null;
    const isMark = (char: string) => /[\p{L}\p{N}]/u.test(char);
    const fold = (char: string) => { const lower = char.toLowerCase(); return [...lower].length === 1 ? lower : char; };
    const marks: string[] = [], joints: boolean[] = [];
    let tagged = false;
    for (const item of itemsOf(text.normalize('NFKC'))) {
        if (isTag(item)) {
            tagged = true;
            continue;
        }
        if (!isMark(item.char))
            continue;
        if (marks.length)
            joints.push(tagged);
        marks.push(fold(item.char));
        tagged = false;
    }
    const own = [...String(plain ?? '').normalize('NFKC')].filter(isMark).map(fold);
    if (!own.length)
        return null;
    for (let start = 0; start + own.length <= marks.length; start++) {
        if (own.every((char, k) => marks[start + k] === char))
            return joints.slice(start, start + own.length - 1);
    }
    return null;
}

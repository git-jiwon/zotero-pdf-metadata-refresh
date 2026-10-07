export type ScientificMarkupToken = {
    type: 'text';
    value: string;
} | {
    type: 'open' | 'close';
    tag: 'sub' | 'sup' | 'i' | 'b';
    value: string;
};
export function tokenizeScientificMarkup(value: string): ScientificMarkupToken[] {
    const tokens: ScientificMarkupToken[] = [];
    const pattern = /<\s*(\/?)\s*(sub|sup|i|b)\s*>/gi;
    let last = 0, match: RegExpExecArray | null;
    while ((match = pattern.exec(value))) {
        if (match.index > last)
            tokens.push({ type: 'text', value: value.slice(last, match.index) });
        tokens.push({ type: match[1] ? 'close' : 'open', tag: match[2].toLowerCase() as 'sub' | 'sup' | 'i' | 'b', value: match[0] });
        last = pattern.lastIndex;
    }
    if (last < value.length)
        tokens.push({ type: 'text', value: value.slice(last) });
    return tokens;
}

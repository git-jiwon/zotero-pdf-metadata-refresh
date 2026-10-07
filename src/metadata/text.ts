const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
    micro: 'µ', ndash: '–', mdash: '—', times: '×', plusmn: '±',
    deg: '°', copy: '©', reg: '®', alpha: 'α', beta: 'β', gamma: 'γ',
    mu: 'μ', Omega: 'Ω', omega: 'ω', le: '≤', ge: '≥', minus: '−'
};
export function decodeMetadataText(value: string): string {
    for (let pass = 0; pass < 3; pass++) {
        const next = value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (token, entity: string) => {
            if (!entity.startsWith('#'))
                return named[entity] ?? token;
            const hex = entity[1].toLowerCase() === 'x';
            const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
            if (!Number.isFinite(point) || point < 32 || (point >= 127 && point <= 159)
                || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff))
                return token;
            return String.fromCodePoint(point);
        });
        if (next === value)
            break;
        value = next;
    }
    return value;
}
const PARAGRAPH_JOINER = /\s*\n\s*,\s*\n\s*/;
const ABSTRACT_LABEL = '(?:abstract|초\\s*록|요\\s*약|摘\\s*要|resumen|r[eé]sum[eé]|resumo)';
const ABSTRACT_HEADING = new RegExp(`^[\\s\\u00a0]*${ABSTRACT_LABEL}(?:[ \\t\\u00a0]*[.:：][ \\t\\u00a0]*|[ \\t\\u00a0]*\\r?\\n[\\s\\u00a0]*)`, 'i');
export function titleScript(value: unknown): 'hangul' | 'mixed' | 'none' {
    const text = String(value ?? '').normalize('NFKC');
    const hangul = (text.match(/[가-힣]/g) || []).length;
    if (!hangul)
        return 'none';
    const latin = (text.match(/[A-Za-zÀ-ɏ]/g) || []).length;
    return hangul >= latin ? 'hangul' : 'mixed';
}
export function tidyAbstract(value: string): string {
    const collapse = (part: string) => part.replace(/\s+/g, ' ').trim();
    const heading = value.match(ABSTRACT_HEADING);
    if (heading) {
        const rest = value.slice(heading[0].length);
        if (rest.trim().length >= 80)
            value = rest;
    }
    const parts = value.split(PARAGRAPH_JOINER).map(collapse).filter(Boolean);
    if (parts.length < 2)
        return collapse(value);
    const contained = (part: string) => parts.some(other => other !== part && other.includes(part));
    const kept = parts.filter(part => !contained(part));
    return (kept.length ? kept : parts).join(' ');
}
export const textualFields = new Set([
    'title', 'shortTitle', 'abstractNote', 'publicationTitle', 'journalAbbreviation',
    'bookTitle', 'proceedingsTitle', 'conferenceName', 'publisher', 'place',
    'series', 'seriesTitle', 'rights', 'university', 'institution'
]);
export function withoutBracketGroups(value: string, replacement: string): string {
    let out = '', from = 0;
    for (;;) {
        const open = value.indexOf('(', from);
        if (open < 0)
            break;
        const close = value.indexOf(')', open + 1);
        if (close < 0)
            break;
        let start = open;
        while (start > from && /\s/.test(value[start - 1]))
            start--;
        let end = close + 1;
        while (end < value.length && /\s/.test(value[end]))
            end++;
        out += value.slice(from, start) + replacement;
        from = end;
    }
    return out + value.slice(from);
}
export function withoutTrailingBracketGroup(value: string): string {
    let end = value.length;
    while (end > 0 && /\s/.test(value[end - 1]))
        end--;
    if (end === 0 || value[end - 1] !== ')')
        return value;
    const close = end - 1;
    const open = value.indexOf('(', value.lastIndexOf(')', close - 1) + 1);
    if (open < 0 || open >= close)
        return value;
    let start = open;
    while (start > 0 && /\s/.test(value[start - 1]))
        start--;
    return value.slice(0, start);
}

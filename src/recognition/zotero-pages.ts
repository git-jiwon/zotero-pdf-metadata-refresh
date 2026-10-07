import { markWorkOpening, pageCarriesWords } from './roles';
import { repairShiftedEncoding } from './text-encoding';
import type { PageObservation } from './candidate';
interface Word {
    x: number;
    y: number;
    right: number;
    bottom: number;
    text: string;
    size: number;
}
interface Line {
    words: Word[];
    x: number;
    y: number;
    right: number;
    bottom: number;
}
function asWord(node: any): Word | null {
    if (!Array.isArray(node))
        return null;
    const text = node[node.length - 1];
    if (typeof text !== 'string' || !text.length)
        return null;
    const [x, y, right, bottom] = node;
    if (![x, y, right, bottom].every(value => typeof value === 'number'))
        return null;
    const size = typeof node[4] === 'number' && node[4] > 0 ? node[4] : bottom - y;
    return { x, y, right, bottom, text, size };
}
function glyphEm(glyph: string): number {
    if (/[\u1100-\u11ff\u2e80-\u303f\u3040-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe4f\uff01-\uff60\uffe0-\uffe6\u{20000}-\u{3ffff}]/u.test(glyph))
        return 0.95;
    if (/[\u2190-\u21ff\u2460-\u27bf\u2b00-\u2bff]/u.test(glyph))
        return 0.95;
    if (/[.,:;·'"`‘’“”()[\]{}!|/\\\-ijlIftr]/u.test(glyph))
        return 0.3;
    if (/[mwMW]/.test(glyph))
        return 0.85;
    if (/\p{Lu}/u.test(glyph))
        return 0.7;
    return 0.55;
}
function glyphRuns(text: string): string[][] {
    const runs: string[][] = [];
    for (const glyph of text) {
        const last = runs[runs.length - 1];
        if (last && last[0] === glyph)
            last.push(glyph);
        else
            runs.push([glyph]);
    }
    return runs;
}
function unstruck(word: Word): Word {
    const runs = glyphRuns(word.text);
    if (!runs.length || !runs.some(run => run.length > 1))
        return word;
    if (runs.length < 2 && glyphEm(runs[0][0]) < 0.9)
        return word;
    const width = word.right - word.x;
    const high = word.bottom - word.y;
    const size = word.size > 0 && (!(high > 0) || (word.size >= high * 0.5 && word.size <= high * 2)) ? word.size : high;
    if (!(width > 0) || !(size > 0))
        return word;
    const full = runs.reduce((sum, run) => sum + glyphEm(run[0]) * run.length, 0) * size;
    if (width >= full * 0.6)
        return word;
    let best: {
        text: string;
        misfit: number;
    } | null = null;
    for (const k of [4, 3, 2]) {
        if (!runs.every(run => run.length % k === 0))
            continue;
        const misfit = Math.abs(Math.log(width / (full / k)));
        if (!best || misfit < best.misfit)
            best = { text: runs.map(run => run.slice(0, run.length / k).join('')).join(''), misfit };
    }
    return best ? { ...word, text: best.text } : word;
}
function signatureOf(line: Line): {
    letters: string;
    all: string;
    raw: number;
} {
    const joined = line.words.map(word => word.text).join('');
    const once = glyphRuns(joined.replace(/\s+/g, '')).map(run => run[0]).join('').normalize('NFKC').replace(/\s+/g, '');
    return { letters: once.replace(/[^\p{L}\p{N}]+/gu, ''), all: once, raw: [...joined.replace(/\s+/g, '')].length };
}
function sameText(a: string, b: string): boolean {
    if (!a || !b)
        return false;
    if (a === b)
        return true;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    return short.length >= 2 && short.length * 2 >= long.length && long.includes(short);
}
function overprints(a: Line, b: Line): boolean {
    const high = Math.min(a.bottom - a.y, b.bottom - b.y);
    const wide = Math.min(a.right - a.x, b.right - b.x);
    if (!(high > 0) || !(wide > 0))
        return false;
    const down = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
    const across = Math.min(a.right, b.right) - Math.max(a.x, b.x);
    return down >= high * 0.5 && across >= wide * 0.5;
}
function withoutOverprint(raw: Array<Line | null>): {
    lines: Array<Line | null>;
    overprint: number;
} {
    const kept: Array<{
        line: Line;
        sign: ReturnType<typeof signatureOf>;
    } | null> = [];
    let overprint = 0;
    for (const entry of raw) {
        if (!entry) {
            kept.push(null);
            continue;
        }
        const words = entry.words.map(unstruck);
        overprint += words.filter((word, at) => word !== entry.words[at]).length;
        const line: Line = { ...entry, words };
        const sign = signatureOf(line);
        const at = kept.findIndex(other => other !== null && overprints(other.line, line)
            && (other.sign.letters || sign.letters ? sameText(other.sign.letters, sign.letters) : sameText(other.sign.all, sign.all)));
        if (at < 0) {
            kept.push({ line, sign });
            continue;
        }
        overprint++;
        const other = kept[at]!;
        if (sign.all.length > other.sign.all.length || (sign.all.length === other.sign.all.length && sign.raw < other.sign.raw))
            kept[at] = { line, sign };
    }
    return { lines: kept.map(entry => entry && entry.line), overprint };
}
function linesOf(node: any, into: Array<Line | null> = []): Array<Line | null> {
    if (!Array.isArray(node) || !node.length)
        return into;
    const words = node.map(asWord);
    if (words.length && words.every(word => word)) {
        const list = words as Word[];
        into.push({
            words: list,
            x: Math.min(...list.map(word => word.x)),
            y: Math.min(...list.map(word => word.y)),
            right: Math.max(...list.map(word => word.right)),
            bottom: Math.max(...list.map(word => word.bottom))
        });
        return into;
    }
    for (const child of node)
        if (Array.isArray(child))
            linesOf(child, into);
    return into;
}
function flowsInReadingOrder(pageNode: any): any[] {
    if (!Array.isArray(pageNode))
        return [];
    const boxed = pageNode.map((flow: any) => {
        const [x, y, x2, y2] = Array.isArray(flow) ? flow : [];
        const usable = [x, y, x2, y2].every(value => typeof value === 'number');
        const width = usable ? Math.abs(x2 - x) : 0;
        const height = usable ? Math.abs(y2 - y) : 0;
        return { flow, x: usable ? x : 0, y: usable ? y : 0, sideways: usable && height > width * 3 };
    });
    if (!boxed.every(entry => typeof entry.y === 'number'))
        return pageNode;
    return [...boxed]
        .sort((a, b) => Number(a.sideways) - Number(b.sideways) || a.y - b.y || a.x - b.x)
        .map(entry => entry.flow);
}
export function renderPage(pageNode: any, pageWidth = 0): {
    text: string;
    layout: string;
    heights: number[];
    overprint: number;
} {
    const found: Array<Line | null> = [];
    for (const flow of flowsInReadingOrder(pageNode)) {
        const before = found.length;
        linesOf(flow, found);
        if (found.length > before)
            found.push(null);
    }
    const { lines: raw, overprint } = withoutOverprint(found);
    const lines = raw.filter(Boolean) as Line[];
    if (!lines.length)
        return { text: '', layout: '', heights: [], overprint };
    const heights = lines.map(line => line.bottom - line.y).filter(value => value > 0).sort((a, b) => a - b);
    const lineHeight = heights[Math.floor(heights.length / 2)] || 10;
    const gaps: number[] = [];
    for (const line of lines) {
        for (let at = 1; at < line.words.length; at++) {
            const gap = line.words[at].x - line.words[at - 1].right;
            if (gap > 0)
                gaps.push(gap);
        }
    }
    gaps.sort((a, b) => a - b);
    const space = gaps[Math.floor(gaps.length / 4)] || lineHeight * 0.25;
    const columnGap = Math.max(space * 8, (pageWidth || lineHeight * 40) * 0.05);
    const plain: string[] = [];
    const laid: string[] = [];
    const rowHeights: number[] = [];
    let previous: Line | null = null;
    for (const entry of raw) {
        if (!entry) {
            if (laid.length && laid[laid.length - 1] !== '') {
                laid.push('');
                rowHeights.push(0);
            }
            previous = null;
            continue;
        }
        const separation = Math.max(lineHeight, entry.bottom - entry.y, previous ? previous.bottom - previous.y : 0);
        if (previous && entry.y - previous.bottom > separation * 0.45 && laid[laid.length - 1] !== '') {
            laid.push('');
            rowHeights.push(0);
        }
        let text = entry.words[0].text;
        let laidLine = ' '.repeat(Math.max(0, Math.min(60, Math.round(entry.words[0].x / Math.max(space, 1))))) + entry.words[0].text;
        for (let at = 1; at < entry.words.length; at++) {
            const gap = entry.words[at].x - entry.words[at - 1].right;
            text += gap > space * 0.4 ? ` ${entry.words[at].text}` : entry.words[at].text;
            const columns = gap > columnGap ? Math.min(40, Math.max(3, Math.round(gap / Math.max(space, 1))))
                : gap > space * 0.4 ? 1 : 0;
            laidLine += ' '.repeat(columns) + entry.words[at].text;
        }
        plain.push(text.trim());
        laid.push(laidLine.replace(/\s+$/, ''));
        rowHeights.push(Math.max(0, entry.bottom - entry.y));
        previous = entry;
    }
    return { text: plain.join('\n'), layout: laid.join('\n'), heights: rowHeights, overprint };
}
export function pageDegraded(page: {
    text?: unknown;
}): boolean {
    const text = String(page.text || '');
    if (text.replace(/\s+/g, '').length < 20)
        return false;
    if (/[�þÿ]{2,}/.test(text) && text.length > 200)
        return true;
    const tokens = text.split(/\s+/).filter(Boolean).filter(token => !/^[가-힣\p{Script=Han}]$/u.test(token))
        .filter(token => !/^[•·‧∙|–—]$/u.test(token) && !/^\(?\d{1,3}[.,)]?$/.test(token));
    if (tokens.length < 5)
        return false;
    const wordy = tokens.filter(token => {
        const core = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
        return /^\p{L}{3,}$/u.test(core) || /^[가-힣]{2,}$/u.test(core) || /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}$/u.test(core) || /^\d{4}$/.test(core);
    }).length;
    const ratio = wordy / tokens.length;
    if (ratio < 0.4)
        return true;
    if (ratio < 0.5) {
        let run = 0;
        for (const token of tokens) {
            run = (token.match(/\p{L}/gu) || []).length <= 2 && !/\d/.test(token) ? run + 1 : 0;
            if (run >= FRAGMENT_RUN)
                return true;
        }
    }
    return false;
}
const FRAGMENT_RUN = 4;
export function pagesFromOCRText(text: unknown, pageLimit = 12, inserted?: (page: number) => boolean): PageObservation[] {
    const value = String(text || '').replace(/\r\n?/g, '\n');
    const pages: PageObservation[] = [];
    const parts = value.split(/^--- PAGE (\d+) ---[^\S\n]*\n?/m);
    const empty = new Set<number>();
    for (let at = 1; at + 1 < parts.length; at += 2) {
        const page = Number(parts[at]);
        const body = String(parts[at + 1] || '').replace(/\f/g, '').trim();
        if (Number.isInteger(page) && page >= 1 && !body)
            empty.add(page);
        if (!Number.isInteger(page) || page < 1 || page > pageLimit || !body)
            continue;
        const leaf = !!inserted?.(page);
        pages.push({
            page, text: body.slice(0, 12000), layout: body.slice(0, 24000), truncated: body.length > 12000,
            kind: 'ocrText', ...(leaf ? { inserted: true } : {})
        });
    }
    return markWorkOpening(pages, page => empty.has(page));
}
export function pagesFromRecognizerData(data: any, pageLimit = 12): PageObservation[] {
    return readRecognizerData(data, pageLimit).pages;
}
export function readRecognizerData(data: any, pageLimit = 12): {
    pages: PageObservation[];
    census: LeafCensus[];
    inserted: number[];
} {
    const pages: PageObservation[] = [];
    const all = Array.isArray(data?.pages) ? data.pages : [];
    const source = all.slice(0, pageLimit);
    const stated = Number((data as any)?.totalPages);
    const pageCount = Number.isInteger(stated) && stated > 0 && stated <= source.length ? stated : undefined;
    const read = readLeaves(source);
    const census = read.map(leaf => leaf.census);
    const insertedPages = insertedLeaves(census);
    const inserted = new Set(insertedPages);
    for (const { census, rendered, text, layout, shift } of read) {
        if (!rendered.text.trim())
            continue;
        const degraded = pageDegraded({ text });
        pages.push({
            page: census.page,
            pageCount,
            text: text.slice(0, 12000),
            layout: layout.slice(0, 24000),
            lineHeights: rendered.heights,
            truncated: text.length > 12000,
            kind: 'pdfText',
            ...(inserted.has(census.page) ? { inserted: true } : {}),
            ...(census.width > 0 && census.height > 0 ? { size: { width: census.width, height: census.height } } : {}),
            ...(degraded ? { degraded: true } : {}),
            ...(shift ? { encodingShift: shift, glyphRisk: true } : {})
        });
    }
    markWorkOpening(pages, page => page <= source.length);
    return { pages, census, inserted: insertedPages };
}
export interface LeafCensus {
    page: number;
    width: number;
    height: number;
    words: boolean;
    heights: number[];
}
function readLeaves(source: any[]): Array<{
    census: LeafCensus;
    rendered: ReturnType<typeof renderPage>;
    text: string;
    layout: string;
    shift: number;
}> {
    return source.map((page: any, index: number) => {
        const width = typeof page?.[0] === 'number' ? page[0] : 0, height = typeof page?.[1] === 'number' ? page[1] : 0;
        const rendered = renderPage(Array.isArray(page?.[2]) ? page[2] : page, width);
        const repaired = repairShiftedEncoding(rendered.text);
        const text = repaired.text, layout = repaired.shift ? repairShiftedEncoding(rendered.layout).text : rendered.layout;
        return { census: { page: index + 1, width, height, words: pageCarriesWords(text), heights: rendered.heights },
            rendered, text, layout, shift: repaired.shift || 0 };
    });
}
export function leafCensus(data: any, pageLimit = 12): LeafCensus[] {
    return readLeaves((Array.isArray(data?.pages) ? data.pages : []).slice(0, pageLimit)).map(leaf => leaf.census);
}
export function insertedLeaves(census: LeafCensus[]): number[] {
    const sized = (leaf: LeafCensus) => leaf.width > 0 && leaf.height > 0;
    const same = (a: LeafCensus, b: {
        width: number;
        height: number;
    }) => Math.abs(a.width - b.width) <= b.width * 0.03 && Math.abs(a.height - b.height) <= b.height * 0.03;
    const out: number[] = [];
    for (let at = 0; at < census.length - 1; at++) {
        const leaf = census[at];
        if (!leaf.words || !sized(leaf))
            break;
        const behind = census.slice(at + 1).filter(sized);
        if (!behind.length)
            break;
        const modal = behind.map(page => ({ page, count: behind.filter(other => same(other, page)).length }))
            .sort((a, b) => b.count - a.count)[0].page;
        if (same(leaf, modal))
            break;
        const work = behind.filter(page => same(page, modal));
        const measured = leaf.heights.filter(value => value > 0).sort((a, b) => a - b);
        const median = measured[Math.floor(measured.length / 2)] || 0;
        const notice = measured.length >= 12 && median > 0 && measured[measured.length - 1] <= median * 1.1;
        if (!work.every(page => !page.words) && !notice)
            break;
        out.push(leaf.page);
    }
    return out;
}

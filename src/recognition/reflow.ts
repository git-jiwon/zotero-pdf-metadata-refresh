const DEGREE_MARKER = /(?:[가-힣]{1,4}학\s*)?(?:석사|박사)\s*학위\s*(?:청구\s*)?논문|(?:碩士|博士)\s*(?:學位|学位)\s*(?:(?:請求|请求)\s*)?(?:論文|论文)/g;
const BREAK_BEFORE = [
    /지도\s*(?:교수|敎授)/g,
    /指導\s*(?:教|敎)?授/g,
    /이\s*(?:논문|論文)을/g,
    /[가-힣]{2,10}(?:대학교|대학원)/g,
    /(?:大學校|大學院)/g,
    /\b(?:THESIS|Submitted\s+to|Department\s+of|Graduate\s+School|A\s+(?:thesis|dissertation))\b/gi
];
const DATE = /(?:19|20)\d{2}\s*년\s*\d{1,2}\s*월/g;
const MAX_PARSABLE_LINE = 110;
const MIN_SCRIPT_SPLIT_LENGTH = 60;
const EAST_ASIAN = /[가-힣\p{Script=Han}]/u;
const LATIN = /[A-Za-z]/;
type Script = 'eastAsian' | 'latin' | 'neutral';
function scriptOf(token: string): Script {
    if (EAST_ASIAN.test(token))
        return 'eastAsian';
    if (LATIN.test(token))
        return 'latin';
    return 'neutral';
}
function splitOnScriptChange(segment: string): string[] {
    if (segment.length < MIN_SCRIPT_SPLIT_LENGTH)
        return [segment];
    const tokens = segment.split(/\s+/).filter(Boolean);
    const runs: Array<{
        script: Script;
        tokens: string[];
    }> = [];
    for (const token of tokens) {
        const script = scriptOf(token);
        const current = runs[runs.length - 1];
        if (current && (script === 'neutral' || current.script === script))
            current.tokens.push(token);
        else if (current && current.script === 'neutral') {
            current.script = script;
            current.tokens.push(token);
        }
        else
            runs.push({ script, tokens: [token] });
    }
    const parts: string[] = [];
    for (const run of runs) {
        const substantial = run.tokens.length >= 3 || run.script === 'eastAsian';
        if (parts.length && !substantial)
            parts[parts.length - 1] += ' ' + run.tokens.join(' ');
        else
            parts.push(run.tokens.join(' '));
    }
    return parts.length > 1 ? parts : [segment];
}
function segmentLine(line: string): string[] {
    let marked = line.replace(DEGREE_MARKER, match => `\u0000${match}\u0000`).replace(DATE, match => `\u0000${match}\u0000`);
    for (const anchor of BREAK_BEFORE)
        marked = marked.replace(anchor, match => `\u0000${match}`);
    const segments = marked.split('\u0000').map(part => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
    return segments.flatMap(splitOnScriptChange).map(part => part.trim()).filter(Boolean);
}
export function reflowFlattenedFrontMatter(text: string): string {
    const value = String(text || '');
    if (!value)
        return value;
    const source = value.replace(/\r\n?/g, '\n').replace(/^[-–—]{2,}\s*PAGE\s+\d+\s*[-–—]{2,}$/gim, '');
    if (!source.split('\n').some(line => line.length > MAX_PARSABLE_LINE))
        return source;
    return source.split('\n')
        .flatMap(line => (line.length > MAX_PARSABLE_LINE ? segmentLine(line) : [line]))
        .join('\n');
}

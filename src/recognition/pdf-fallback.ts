import { extractIdentifierObservations } from './pdf-identifiers';
import { isNotATitle, isPersonalName } from './title-guards';
import { documentTitle } from './title-block';
import { structureOfText } from './page-structure';
import { personCreator } from './agents';
export interface PDFDescription {
    title?: string;
    date?: string;
    pages?: string;
    volume?: string;
    issue?: string;
    publicationTitle?: string;
    publisher?: string;
    DOI?: string;
    ISBN?: string;
    creators?: Array<{
        firstName: string;
        lastName: string;
        fieldMode?: number;
        creatorType: string;
    }>;
}
const nfkc = (value: string) => String(value || '').replace(/[ㆍᆞ]/g, '·').normalize('NFKC');
const clean = (value: string) => nfkc(value).replace(/\s+/g, ' ').trim();
const firstPage = (text: string, characters = 3000) => (text.includes('\f') ? text.split('\f')[0] : text).slice(0, characters);
const firstPages = (text: string, count: number, characters: number) => text.split('\f').slice(0, count).join('\n').slice(0, characters);
function validRange(from: string, to: string): boolean {
    const start = Number(from), end = Number(to);
    return Number.isFinite(start) && Number.isFinite(end) && start >= 1 && end >= start && end - start <= 400;
}
function pageRange(text: string): string {
    const found: Array<{
        value: string;
        weight: number;
    }> = [];
    const add = (from: string, to: string, weight: number) => {
        if (validRange(from, to))
            found.push({ value: `${from}-${to}`, weight });
    };
    for (const m of text.matchAll(/\bpp?\.?\s*(\d{1,6})\s*[-–—~]\s*(\d{1,6})\b/gi))
        add(m[1], m[2], 5);
    for (const m of text.matchAll(/\b(\d{1,6})\s*[-–—~]\s*(\d{1,6})\s*(?:쪽|면)/g))
        add(m[1], m[2], 5);
    for (const m of text.matchAll(/\b\d{1,4}\s*\(\s*\d{1,3}\s*\)\s*[;:,]?\s*(\d{1,6})\s*[-–—~]\s*(\d{1,6})/g))
        add(m[1], m[2], 4);
    for (const m of text.matchAll(/,\s*\d{1,4}\s*:\s*(\d{1,6})\s*[-–—~]\s*(\d{1,6})/g))
        add(m[1], m[2], 3);
    for (const m of text.matchAll(/\b(?:19|20)\d{2}\s*,\s*\d{1,4}\s*,\s*(\d{1,6})\s*[-–—~]\s*(\d{1,6})/g))
        add(m[1], m[2], 3);
    found.sort((a, b) => b.weight - a.weight);
    return found[0]?.value || '';
}
function pageLocator(text: string): string {
    return text.match(/\b\d{1,4}\s*\(\s*(?:19|20)\d{2}\s*\)\s*(\d{4,7})\b/)?.[1]
        || text.match(/\b(e\d{4,7})\b/)?.[1] || '';
}
function citation(text: string): PDFDescription {
    const front = firstPage(text);
    const found: PDFDescription = {};
    const volumeIssue = front.match(/\b(\d{1,4})\s*\(\s*(\d{1,3})\s*\)\s*[;:,]?\s*\d{1,5}\s*[-–~]\s*\d{1,5}/);
    if (volumeIssue) {
        found.volume = volumeIssue[1];
        found.issue = volumeIssue[2];
    }
    const volumeColon = front.match(/,\s*(\d{1,4})\s*:\s*\d{1,5}\s*[-–~]\s*\d{1,5}/);
    if (volumeColon)
        found.volume ||= volumeColon[1];
    const korean = front.match(/제\s*(\d{1,4})\s*권\s*제?\s*(\d{1,3})\s*호/);
    if (korean) {
        found.volume ||= korean[1];
        found.issue ||= korean[2];
    }
    const volumeOnly = front.match(/\b(?:Vol\.?|Volume)\s*(\d{1,4})/i);
    if (volumeOnly)
        found.volume ||= volumeOnly[1];
    const issueOnly = front.match(/\b(?:No\.?|Issue)\s*(\d{1,3})\b/i);
    if (issueOnly)
        found.issue ||= issueOnly[1];
    const pages = pageRange(front) || pageLocator(front);
    if (pages)
        found.pages = pages;
    const journal = front.match(/(?:^|\n)\s*([A-Z][A-Za-z&.'\- ]{6,70}?)[,.]?\s*(?:\d{1,4}\s*\(\s*(?:19|20)\d{2}\s*\)|\bVol\.?\s*\d|,\s*\d{1,4}\s*:)/)
        || front.match(/(?:^|\n)\s*([가-힣][가-힣A-Za-z ]{3,40}(?:학회지|학회논문지|논문집|학술지|회지))\b/);
    if (journal)
        found.publicationTitle = clean(journal[1]);
    return found;
}
function year(text: string): string | undefined {
    const current = new Date().getFullYear();
    const latest = (source: string) => [...source.matchAll(/\b((?:19|20)\d{2})\b/g)]
        .map(match => match[1])
        .filter(value => Number(value) >= 1800 && Number(value) <= current + 1)
        .sort((a, b) => Number(b) - Number(a))[0];
    return latest(firstPage(text)) || latest(firstPages(text, 2, 6000)) || latest(firstPages(text, 6, 20000));
}
const PUBLISHER_ROLE = [
    /\bPublished\s+(?:and\s+)?(?:by|for)\s+([^\n,;]{3,60}?)(?=\s*(?:,|;|\.\s|\.$|\n|$))/i,
    /\bPublisher\s*[:：]\s*([^\n,;]{3,60}?)(?=\s*(?:,|;|\.\s|\.$|\n|$))/i,
    /(?:©|\(c\)|copyright\s*©?)\s*(?:19|20)\d{2}(?:\s*[-–]\s*(?:19|20)\d{2})?\s+(?:by\s+)?([^\n,;]{3,60}?)(?=\s*(?:,|;|\.\s|\.$|\n|$))/i,
    /(?:발행처|펴낸곳|발행인|출판사)\s*[:：]?\s*([^\n]{2,40})/
];
const PUBLISHER_SHAPE = /^(?:[A-Z][\p{L}\d&.'’-]*)(?:\s+(?:of|and|for|the|de|&|[A-Z(][\p{L}\d&.'’()-]*)){0,6}$/u;
const PUBLISHER_TRAILING = /\s*(?:All rights reserved.*|Published by.*|on behalf of.*|and licensee.*|This is an open access.*)$/i;
function publisher(text: string): string | undefined {
    const front = firstPages(text, 6, 20000);
    for (const pattern of PUBLISHER_ROLE) {
        const match = front.match(pattern);
        if (!match)
            continue;
        const value = clean(match[1]).replace(PUBLISHER_TRAILING, '').replace(/[.,;]+$/, '').trim();
        if (value.length < 3)
            continue;
        if (/^the\s+authors?\(?s?\)?$/i.test(value))
            continue;
        if (!PUBLISHER_SHAPE.test(value) && !/^[가-힣][가-힣A-Za-z\s]{2,30}$/.test(value))
            continue;
        return value;
    }
    return undefined;
}
function byline(front: string, title: string): PDFDescription['creators'] {
    const lines = front.split('\n').map(clean).filter(Boolean);
    const compact = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const index = lines.findIndex(line => compact(line).includes(compact(title).slice(0, 40)) && compact(title).length >= 12);
    if (index < 0)
        return undefined;
    for (const line of lines.slice(index + 1, index + 4)) {
        if (isNotATitle(line) && !/[,;·]/.test(line))
            continue;
        const parts = line.replace(/[\d*†‡§¶]/g, '').split(/\s*(?:,|;|·|&|\band\b)\s*/i).map(clean).filter(Boolean);
        if (parts.length < 1 || parts.length > 15)
            continue;
        const korean = parts.every(part => isPersonalName(part));
        const tokens = parts.length === 1 ? parts[0].split(' ') : [];
        const shouting = /^[^\p{Ll}]+$/u.test(line.replace(/[\d*†‡§¶]/g, '')) && tokens.length <= 3 && !/[,;·]/.test(line);
        const abbreviations = tokens.length >= 2 && tokens.every(token => token.endsWith('.'));
        const latin = !shouting && !abbreviations
            && parts.every(part => /^[A-Z][\p{L}'’.-]*(?:\s+[A-Z][\p{L}'’.-]*){1,3}$/u.test(part) && part.split(' ').length <= 4);
        if (!korean && !latin)
            continue;
        return parts.slice(0, 20).map(name => {
            if (korean)
                return personCreator(name, 'author') as {
                    firstName: string;
                    lastName: string;
                    fieldMode?: number;
                    creatorType: string;
                } | null;
            const tokens = name.split(' ');
            const lastName = tokens.pop() as string;
            return { firstName: tokens.join(' '), lastName, creatorType: 'author' };
        }).filter(Boolean) as Array<{
            firstName: string;
            lastName: string;
            fieldMode?: number;
            creatorType: string;
        }>;
    }
}
export function describeFromPDF(frontMatter: string, existingTitle = ''): PDFDescription {
    const front = nfkc(frontMatter).slice(0, 40000);
    if (!front.trim())
        return {};
    const found: PDFDescription = { ...citation(front) };
    const when = year(front);
    if (when)
        found.date = when;
    const imprint = publisher(front);
    if (imprint)
        found.publisher = imprint;
    for (const identifier of extractIdentifierObservations({ text: front }).filter(entry => entry.confidence !== 'ambiguous').slice(0, 4)) {
        if (identifier.kind === 'DOI')
            found.DOI ||= identifier.value;
        else
            found.ISBN ||= identifier.value;
    }
    const own = documentTitle(structureOfText(front))?.title || '';
    if (own)
        found.title = own;
    const anchorTitle = existingTitle || own;
    const creators = anchorTitle ? byline(front, anchorTitle) : undefined;
    if (creators?.length)
        found.creators = creators;
    return found;
}
export function fillEmptyFields(existing: Record<string, unknown>, existingCreators: unknown[], found: PDFDescription): {
    fields: Record<string, string>;
    creators?: unknown[];
} {
    const fields: Record<string, string> = {};
    for (const [field, value] of Object.entries(found)) {
        if (field === 'creators' || typeof value !== 'string' || !value.trim())
            continue;
        if (String(existing[field] || '').trim())
            continue;
        fields[field] = value.trim();
    }
    const creators = !existingCreators?.length && found.creators?.length ? found.creators : undefined;
    return { fields, creators };
}

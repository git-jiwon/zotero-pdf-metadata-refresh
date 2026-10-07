import type { MetadataSnapshot } from '../types';
import { isDocumentPartName, isNotATitle, isOrganisationName } from '../recognition/title-guards';
import { isOrganisationItem, personShape, rowIsByline } from '../recognition/byline-row';
import { BYLINE_MEANINGS, labelWordOf, type Meaning } from '../recognition/label-words';
import { isDegreeToken } from '../recognition/degree';
export interface Match {
    score: number | null;
    reasons: string[];
    review: boolean;
}
export function titleCore(value: unknown): string {
    let title = String(value || '').trim();
    const note = /\s*[(\[](?:hard\s*cover|paper\s*back|hbk|pbk|brochure|e-?book|kindle|audio\s*book|reprint|revised|\d+(?:st|nd|rd|th)?\s*(?:ed\.?|edition)|(?:first|second|third|fourth|fifth|new)\s+edition)[^)\]]*[)\]]\.?\s*$/iu;
    for (let round = 0; round < 2 && note.test(title); round++)
        title = title.replace(note, '').trim();
    return title;
}
function normalized(value: unknown): string {
    return titleCore(value).replace(/<\/?(?:sub|sup|i|b)>/gi, '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
export function titleSimilarity(a: unknown, b: unknown): number {
    const x = normalized(a), y = normalized(b);
    if (!x || !y)
        return 0;
    if (x === y)
        return 1;
    const grams = (s: string) => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
    const left = grams(x), right = grams(y);
    if (!left.size || !right.size)
        return 0;
    return 2 * [...left].filter(g => right.has(g)).length / (left.size + right.size);
}
export function isFileLikeTitle(value: unknown): boolean {
    const title = String(value || '').normalize('NFKC').trim();
    return /\.(?:pdf|djvu|epub)$/i.test(title)
        || /^(?:download|full\s*text|article|artipreview)(?:\s*[-_(].*)?$/i.test(title)
        || /\bDr\.?\s+[A-Z][\p{L}.'-]+(?:\s+[A-Z]\.)?\s+[\p{L}.'-]+$/u.test(title);
}
export function isTruncatedRewrite(oldTitle: unknown, newTitle: unknown): boolean {
    const oldValue = normalized(oldTitle), newValue = normalized(newTitle);
    return !isFileLikeTitle(oldTitle) && !!oldValue && !!newValue && oldValue !== newValue
        && oldValue.includes(newValue) && oldValue.length >= newValue.length + 12;
}
export function isPlaceholderTitle(value: unknown): boolean {
    const title = String(value || '').normalize('NFKC').trim();
    return /\.(?:pdf|djvu|epub)$/i.test(title)
        || /^(?:download|full\s*text|artipreview|untitled|document|scan)(?:\s*[-_(].*)?$/i.test(title)
        || isLabelTitle(title)
        || /^(?:저작자표시|attribution\b)[\s\S]{0,60}?\d\.\d/i.test(title)
        || /creative\s+commons/i.test(title);
}
export function isLabelTitle(value: unknown): boolean {
    const title = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!title)
        return false;
    if (/[:：]\s*$/.test(title))
        return true;
    const words = title.split(/[\s—–]+/).map(word => word.replace(/[.,;*†‡§¶]+$/u, '')).filter(Boolean);
    if (!words.length || words.length > 3)
        return false;
    const labelled = (count: number) => { const word = labelWordOf(words.slice(0, count).join(' ')); return !!word && (word.meaning === 'section' || word.meaning === 'contact'); };
    return labelled(1) || labelled(2) || isDocumentPartName(words[0]) || /^acknowledg/i.test(words[0]);
}
export function shouldKeepExistingTitle(oldTitle: unknown, newTitle: unknown): boolean {
    const oldValue = normalized(oldTitle), newValue = normalized(newTitle);
    if (isFileLikeTitle(oldTitle) || !oldValue || !newValue)
        return false;
    if (oldValue === newValue)
        return true;
    if (titleSimilarity(oldTitle, newTitle) >= 0.95)
        return true;
    if (!oldValue.includes(newValue) || oldValue.length < newValue.length + 2)
        return false;
    return !addedTextIsFurniture(oldTitle, newTitle);
}
function addedParts(oldTitle: unknown, newTitle: unknown): string[] {
    const words = String(oldTitle || '').normalize('NFKC').split(/\s+/).filter(Boolean);
    const target = normalized(newTitle);
    for (let start = 0; start < words.length; start++) {
        let joined = '';
        for (let end = start; end < words.length; end++) {
            joined = normalized(words.slice(start, end + 1).join(' '));
            if (joined.length > target.length)
                break;
            if (joined !== target)
                continue;
            return [words.slice(0, start).join(' '), words.slice(end + 1).join(' ')].filter(part => part.trim());
        }
    }
    return [];
}
function addedTextIsFurniture(oldTitle: unknown, newTitle: unknown): boolean {
    const parts = addedParts(oldTitle, newTitle);
    if (!parts.length)
        return false;
    const pieces = parts.flatMap(part => part.split(/\s*[,;·/|]\s*/)).map(piece => piece.trim()).filter(Boolean);
    if (!pieces.length)
        return false;
    return pieces.every(piece => isOrganisationName(piece) || rowIsByline(piece, 'strict') || isNotATitle(piece) || furnitureWordByWord(piece));
}
const ASIDE_MEANINGS: ReadonlySet<Meaning> = new Set<Meaning>([...BYLINE_MEANINGS, 'position', 'advisor']);
export function furnitureWordByWord(piece: string): boolean {
    const tokens = piece.split(/\s+/).filter(Boolean);
    if (tokens.length < 2)
        return false;
    const aside = (token: string) => { const word = labelWordOf(token); return !!word && ASIDE_MEANINGS.has(word.meaning); };
    return tokens.every(token => personShape(token).person !== 'no' || isOrganisationName(token) || isOrganisationItem(token) || aside(token) || isDegreeToken(token)
        || /^(?:19|20)\d{2}$/.test(token) || /^(?:by|and)$/i.test(token));
}
export function assessMatch(old: MetadataSnapshot, found: MetadataSnapshot): Match {
    let sum = 0, total = 0;
    let conflict = false;
    const reasons: string[] = [];
    const add = (weight: number, similarity: number, reason: string) => { total += weight; sum += weight * similarity; reasons.push(reason); };
    let title = 0;
    if (old.fields.title && found.fields.title) {
        title = titleSimilarity(old.fields.title, found.fields.title);
        add(60, title, `제목 유사도 ${Math.round(title * 100)}%`);
    }
    const doi = (v: unknown) => String(v || '').trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
    const a = doi(old.fields.DOI), b = doi(found.fields.DOI);
    if (a && b) {
        conflict = a !== b;
        add(25, conflict ? 0 : 1, conflict ? 'DOI 충돌 — 기존 DOI 오류 가능성 포함' : 'DOI 일치');
    }
    const year = (v: unknown) => String(v || '').match(/\b(?:18|19|20)\d{2}\b/)?.[0];
    const ay = year(old.fields.date), by = year(found.fields.date);
    if (ay && by)
        add(5, ay === by ? 1 : 0, ay === by ? '연도 일치' : `연도 차이 ${ay} → ${by}`);
    const authors = (s: MetadataSnapshot) => new Set(s.creators.map((c: any) => normalized(c.lastName || c.name)).filter(Boolean));
    const ac = authors(old), bc = authors(found);
    if (ac.size && bc.size) {
        const ratio = [...ac].filter(c => bc.has(c)).length / Math.max(ac.size, bc.size);
        add(10, ratio, `저자 성명 비교 ${Math.round(ratio * 100)}% (한글·로마자 표기는 다를 수 있음)`);
    }
    const score = total ? Math.round(sum / total * 100) : null;
    const review = conflict || title < 0.85 || total < 65 || score === null || score < 85;
    if (total < 65)
        reasons.push('비교 가능한 근거 부족');
    return { score, reasons, review };
}

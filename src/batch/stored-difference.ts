import type { MetadataSnapshot } from '../types';
import { isPlaceholderTitle, titleSimilarity } from '../metadata/match';
import { doiIn, normalizedISBN, rawDOI, sameDOI, validISBN } from '../metadata/identifier-compare';
import { creatorDisplayName, nameAsItIsWritten } from '../metadata/creator-text';
import { sameName, samePersonAcrossScripts } from '../metadata/name-equivalence';
export type DifferingField = 'title' | 'creators' | 'DOI' | 'ISBN';
export interface StoredDifference {
    fields: DifferingField[];
    details: Record<string, {
        before: string;
        after: string;
    }>;
}
export const DIFFERING_FIELD_LABEL: Record<DifferingField, string> = { title: '제목', creators: '저자', DOI: 'DOI', ISBN: 'ISBN' };
const KEPT = 300;
const kept = (value: string) => value.length > KEPT ? value.slice(0, KEPT) + '…' : value;
const fold = (value: unknown) => String(value ?? '').replace(/<\/?(?:sub|sup|i|b)>/gi, '')
    .normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
function titlesDiffer(stored: unknown, read: unknown): boolean {
    const a = fold(stored), b = fold(read);
    if (!a || !b || isPlaceholderTitle(stored))
        return false;
    if (a === b || a.includes(b) || b.includes(a))
        return false;
    return titleSimilarity(stored, read) < 0.8;
}
const CJK = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u;
function nameKey(creator: unknown): string {
    const shaped: any = nameAsItIsWritten(creator) || {};
    const last = String(shaped.lastName ?? shaped.name ?? '').trim();
    const first = String(shaped.firstName ?? '').trim();
    if (CJK.test(`${last}${first}`))
        return `${last}${first}`.normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');
    return (last || first).normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
function creatorsDiffer(stored: unknown[], read: unknown[]): boolean {
    const before = stored.filter(creator => nameKey(creator)), after = read.filter(creator => nameKey(creator));
    if (!before.length || !after.length)
        return false;
    const left = [...after];
    let shared = 0;
    for (const person of before) {
        const key = nameKey(person);
        const at = left.findIndex(other => nameKey(other) === key || samePersonAcrossScripts(nameAsItIsWritten(person), nameAsItIsWritten(other))
            || sameName(nameAsItIsWritten(person), nameAsItIsWritten(other), 'storedDifference'));
        if (at < 0)
            continue;
        shared++;
        left.splice(at, 1);
    }
    return shared / Math.max(before.length, after.length) < 0.5;
}
const doiOf = (value: unknown) => doiIn(value) || rawDOI(value);
function isbnsIn(value: unknown): Set<string> {
    const text = String(value ?? '');
    const tokens = text.split(/[\s,;/|]+/).map(token => token.replace(/^isbn[:：]?/i, '')).filter(Boolean);
    const valid = tokens.map(token => validISBN(token)).filter(Boolean).map(normalizedISBN);
    if (valid.length)
        return new Set(valid);
    const digits = tokens.map(token => token.replace(/[^0-9Xx]/g, '')).filter(token => token.length === 10 || token.length === 13);
    if (!digits.length) {
        const whole = text.replace(/^\s*isbn[:：]?/i, '').replace(/[^0-9Xx]/g, '');
        if (whole.length === 10 || whole.length === 13)
            digits.push(whole);
    }
    return new Set(digits.map(normalizedISBN));
}
function isbnsDiffer(stored: unknown, read: unknown): boolean {
    const a = isbnsIn(stored), b = isbnsIn(read);
    if (!a.size || !b.size)
        return false;
    return ![...a].some(isbn => b.has(isbn));
}
const text = (value: unknown) => String(value ?? '').trim();
const names = (creators: unknown[]) => creators.map(creator => creatorDisplayName((creator || {}) as any)).filter(Boolean).join('; ');
export function storedDifference(before: MetadataSnapshot, recognized: MetadataSnapshot, writing?: ReadonlySet<string>): StoredDifference | null {
    const stored = before?.fields || {}, read = recognized?.fields || {};
    const storedCreators = Array.isArray(before?.creators) ? before.creators : [];
    const readCreators = Array.isArray(recognized?.creators) ? recognized.creators : [];
    const fields: DifferingField[] = [];
    const details: StoredDifference['details'] = {};
    const note = (field: DifferingField, was: string, now: string) => {
        if (writing && !writing.has(field))
            return;
        fields.push(field);
        details[field] = { before: kept(was), after: kept(now) };
    };
    if (text(stored.title) && text(read.title) && titlesDiffer(stored.title, read.title))
        note('title', text(stored.title), text(read.title));
    if (creatorsDiffer(storedCreators, readCreators))
        note('creators', names(storedCreators), names(readCreators));
    if (text(stored.DOI) && text(read.DOI) && !sameDOI(doiOf(stored.DOI), doiOf(read.DOI)))
        note('DOI', text(stored.DOI), text(read.DOI));
    if (text(stored.ISBN) && text(read.ISBN) && isbnsDiffer(stored.ISBN, read.ISBN))
        note('ISBN', text(stored.ISBN), text(read.ISBN));
    return fields.length ? { fields, details } : null;
}

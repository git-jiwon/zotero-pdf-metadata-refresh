import type { MetadataSnapshot } from '../types';
import { isPlaceholderTitle, isTruncatedRewrite, titleSimilarity } from './match';
import { nameAsItIsWritten } from './creator-text';
export interface PublicationSafety {
    blocked: boolean;
    code?: 'published-over-preprint' | 'title-mismatch' | 'doi-title-conflict' | 'doi-author-conflict' | 'same-title-author-conflict';
    reason?: string;
}
function value(snapshot: MetadataSnapshot, field: string): string {
    return String(snapshot.fields[field] || '').trim();
}
const fold = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export function storedAuthorsCovered(existing: MetadataSnapshot, recognized: MetadataSnapshot): boolean {
    const key = (raw: any) => {
        const creator = nameAsItIsWritten(raw) || {};
        const last = String(creator.lastName || creator.name || ''), first = String(creator.firstName || '');
        return /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(last + first) ? fold(last + first) : fold(last);
    };
    const held = (existing.creators || []).map(key).filter(Boolean);
    const read = new Set((recognized.creators || []).map(key).filter(Boolean));
    return held.length > 0 && read.size > held.length && held.every(name => read.has(name));
}
function authorOverlap(existing: MetadataSnapshot, recognized: MetadataSnapshot): number | null {
    const normalize = (raw: any) => {
        const creator = nameAsItIsWritten(raw) || {};
        const last = String(creator.lastName || creator.name || ''), first = String(creator.firstName || '');
        return /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(last + first) ? fold(last + first) : fold(last);
    };
    const oldNames = new Set((existing.creators || []).map(normalize).filter(Boolean));
    const newNames = new Set((recognized.creators || []).map(normalize).filter(Boolean));
    if (!oldNames.size || !newNames.size)
        return null;
    return [...oldNames].filter(name => newNames.has(name)).length / Math.max(oldNames.size, newNames.size);
}
export function isResearchSquare(snapshot: MetadataSnapshot): boolean {
    const doi = value(snapshot, 'DOI').toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
    const url = value(snapshot, 'url').toLowerCase();
    return /^10\.21203\/rs\.3\.rs-/i.test(doi) || /(?:^|\.)researchsquare\.com\//i.test(url.replace(/^https?:\/\//, ''));
}
export function looksPublished(snapshot: MetadataSnapshot): boolean {
    if (isResearchSquare(snapshot))
        return false;
    const journal = value(snapshot, 'publicationTitle');
    const citation = value(snapshot, 'volume') || value(snapshot, 'issue') || value(snapshot, 'pages');
    const doi = value(snapshot, 'DOI');
    return snapshot.itemType === 'journalArticle' && !!journal && !!doi && !!citation;
}
export function assessPublicationSafety(existing: MetadataSnapshot, recognized: MetadataSnapshot): PublicationSafety {
    const titleScore = titleSimilarity(existing.fields.title, recognized.fields.title);
    const sameWork = titleScore >= 0.9;
    if (sameWork && looksPublished(existing) && isResearchSquare(recognized)) {
        return {
            blocked: true,
            code: 'published-over-preprint',
            reason: 'Research Square 사전출판본만 확인됨 — 최종 출판 후보를 확인하지 못해 자동 적용하지 않습니다.'
        };
    }
    const placeholderTitle = isPlaceholderTitle(existing.fields.title);
    const identifier = (v: unknown) => String(v || '').trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
    const sameIdentifier = !!identifier(existing.fields.DOI) && identifier(existing.fields.DOI) === identifier(recognized.fields.DOI);
    const partOfStored = isTruncatedRewrite(existing.fields.title, recognized.fields.title);
    if (!placeholderTitle && !sameIdentifier && !partOfStored && existing.fields.title && recognized.fields.title && titleScore < 0.65) {
        return {
            blocked: true,
            code: 'title-mismatch',
            reason: `서지 충돌 · 차단 — 기존 제목과 인식 제목의 유사도가 ${Math.round(titleScore * 100)}%로 너무 낮습니다.`
        };
    }
    const doi = (value: unknown) => String(value || '').trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
    const oldDOI = doi(existing.fields.DOI), newDOI = doi(recognized.fields.DOI);
    if (oldDOI && newDOI && oldDOI !== newDOI && existing.fields.title && recognized.fields.title && titleScore < 0.85) {
        return {
            blocked: true,
            code: 'doi-title-conflict',
            reason: `서지 충돌 · 차단 — DOI가 다르고 제목 유사도도 ${Math.round(titleScore * 100)}%에 불과합니다.`
        };
    }
    const authors = authorOverlap(existing, recognized);
    if (oldDOI && newDOI && oldDOI !== newDOI && authors !== null && authors < 0.5) {
        return {
            blocked: true,
            code: 'doi-author-conflict',
            reason: `서지 충돌 · 차단 — 제목이 같거나 비슷하지만 DOI가 다르고 저자 겹침이 ${Math.round(authors * 100)}%뿐입니다.`
        };
    }
    if (titleScore >= 0.95 && authors !== null && authors < 0.34 && !storedAuthorsCovered(existing, recognized)) {
        return {
            blocked: true,
            code: 'same-title-author-conflict',
            reason: `동일 제목 충돌 · 차단 — 제목은 같지만 저자 겹침이 ${Math.round(authors * 100)}%뿐이어서 다른 문서일 가능성이 높습니다.`
        };
    }
    return { blocked: false };
}

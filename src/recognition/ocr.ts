import type { MetadataSnapshot, RecognitionResult } from '../types';
import { recognizeKoreanPatentText } from './korean-patent';
import { recognizeTechnicalDocumentText } from './technical-document';
import { recognizeLocalPublicationText } from './local-publication';
import { recognizeFromTextIdentifiers } from './pdf-identifiers';
import { catalogueQueries, extractTitlesFromPlainText, materialFromPDFText, readerRoles, searchKoreanCatalog, type ReaderRoles, type SearchCandidate } from './korean-auto';
import { reflowFlattenedFrontMatter } from './reflow';
import { editionIn, searchInternationalCatalog } from './international-catalog';
import { classifyDocument, documentEvidence, leadingType } from './classify';
export interface OCRRecognition extends RecognitionResult {
    kind: 'patent' | 'technical' | 'local' | 'identifier' | 'catalog';
    evidence: string;
    candidates?: SearchCandidate[];
    parsed?: OCRRecognition | null;
}
export interface OCRTrace {
    steps: string[];
    titles: string[];
    candidates: SearchCandidate[];
}
export function newOCRTrace(): OCRTrace { return { steps: [], titles: [], candidates: [] }; }
export interface OCRRecognitionOptions {
    pageCount?: number;
    readingTitles?: string[];
    pageTitles?: string[];
    trace?: OCRTrace;
    cancelled?: () => boolean;
    searchCatalog?: boolean;
    searchAbroad?: boolean;
    identifiersTried?: boolean;
    statedPages?: string[];
    readerFields?: Record<string, unknown>;
    alsoParse?: boolean;
}
async function catalogFromOCR(parent: any, before: MetadataSnapshot, text: string, cancelled: () => boolean, trace?: OCRTrace, reading: string[] = [], roles?: ReaderRoles, pageTitles: string[] = []): Promise<OCRRecognition | null> {
    const material = materialFromPDFText(text);
    if (!/[가-힣]/.test(text)) {
        trace?.steps.push('국내 카탈로그: OCR 원문에 한글이 없어 검색하지 않음');
        return null;
    }
    const titles = catalogueQueries([...reading, ...pageTitles], extractTitlesFromPlainText(text, material === 'thesis', roles), hangulBody(text.split('\f')) || /[가-힣]/.test(reading.join(' ') + pageTitles.join(' ')));
    if (!titles.length) {
        trace?.steps.push('OCR 원문에서 제목 후보를 찾지 못함');
        return null;
    }
    const queries = titles;
    trace?.titles.push(...queries.slice(0, 2));
    const outcome = await searchKoreanCatalog(parent, before, text, queries, material, cancelled, {
        minimumScore: 0.88,
        evidence: 'OCR로 읽은 표지 제목으로 국내 학술 카탈로그 검색',
        pageTexts: text.split('\f')
    });
    if (!outcome.result) {
        trace?.steps.push(outcome.reason || 'RISS·KCI·DBpia에 일치하는 기록 없음');
        if (outcome.candidates?.length && trace)
            trace.candidates.push(...outcome.candidates);
        return null;
    }
    return {
        source: null, metadata: outcome.result.metadata, changes: outcome.result.changes,
        kind: 'catalog', evidence: outcome.reason, candidates: outcome.candidates
    };
}
async function abroadFromOCR(parent: any, before: MetadataSnapshot, text: string, cancelled: () => boolean, trace?: OCRTrace, reading: string[] = [], statedPages: string[] = [], context: {
    reader?: Record<string, unknown>;
    pageCount?: number;
} = {}): Promise<OCRRecognition | null> {
    const reader = context.reader || {};
    const roles = readerRoles(reader);
    const readSubtitle = String(reader['부제'] ?? '').replace(/<\/?su[pb]>/gi, '').replace(/\s+/g, ' ').trim();
    const subtitled = readSubtitle && !editionIn(readSubtitle) ? reading.map(title => `${title} ${readSubtitle}`) : [];
    const titles = [...new Set([...reading, ...subtitled, ...extractTitlesFromPlainText(text, true, roles), ...extractTitlesFromPlainText(text, false, roles)])].slice(0, 3);
    if (!titles.length)
        return null;
    const leading = leadingType(classifyDocument(documentEvidence(text))).type;
    const readType = String(reader['유형'] ?? '').trim();
    const material = /^book$/i.test(readType) ? 'book' : /^thesis$/i.test(readType) ? 'thesis'
        : /^(?:journalArticle|magazineArticle|newspaperArticle|conferencePaper|bookSection)$/i.test(readType) ? 'article'
            : leading === 'book' ? 'book' : leading === 'thesis' ? 'thesis' : 'article';
    const outcome = await searchInternationalCatalog(parent, before, text, titles, material, cancelled, { pages: statedPages, readings: reading, reader, documentPages: context.pageCount });
    if (!outcome.result) {
        trace?.steps.push(outcome.reason || 'Crossref·OpenLibrary에 일치하는 기록 없음');
        if (outcome.candidates?.length && trace)
            trace.candidates.push(...(outcome.candidates as any[]));
        return null;
    }
    return {
        source: null, metadata: outcome.result.metadata, changes: outcome.result.changes,
        kind: 'catalog', evidence: `OCR로 읽은 표지 제목으로 ${outcome.reason}`, candidates: outcome.candidates as any
    };
}
function hangulBody(pages: string[]): boolean {
    const weigh = (text: string) => ({ hangul: (text.match(/[가-힣]/g) || []).length * 2.5, latin: (text.match(/[A-Za-zÀ-ɏ]/g) || []).length });
    const body = pages.length >= 2 ? pages.slice(1) : pages;
    const votes = body.map(weigh).filter(count => count.hangul / 2.5 + count.latin >= 120);
    if (votes.length >= 2)
        return votes.filter(count => count.hangul >= count.latin).length * 2 > votes.length;
    const pooled = weigh(body.join('\n'));
    return pooled.hangul + pooled.latin >= 200 && pooled.hangul >= pooled.latin * 1.5;
}
export async function recognizeFromOCRText(parent: any, before: MetadataSnapshot, text: string, options: OCRRecognitionOptions = {}): Promise<OCRRecognition | null> {
    const normalized = String(text || '').replace(/[ㆍᆞ]/g, '·').normalize('NFKC').slice(0, 500000);
    const bounded = reflowFlattenedFrontMatter(normalized);
    if (!bounded.trim())
        return null;
    const { pageCount, cancelled = () => false, searchCatalog = true, searchAbroad = false, identifiersTried = false, trace } = options;
    const readingTitles = (options.readingTitles || []).map(title => String(title || '').trim()).filter(title => title.length >= 4);
    const readerFields = options.readerFields || {};
    const roles = readerRoles(readerFields);
    const patent = recognizeKoreanPatentText(parent, before, bounded);
    if (patent)
        return { ...patent, kind: 'patent', evidence: 'OCR에서 KIPO INID 번호·제목 구조 확인' };
    const technical = recognizeTechnicalDocumentText(parent, before, bounded, pageCount);
    const technicalReading: OCRRecognition | null = technical ? { ...technical, kind: 'technical', evidence: 'OCR에서 기술문서 유형·문서번호·기관 구조 확인' } : null;
    if (technicalReading && !options.alsoParse)
        return technicalReading;
    const parsedReading = (): OCRRecognition | null => {
        if (technicalReading)
            return technicalReading;
        const local = recognizeLocalPublicationText(parent, before, bounded, pageCount ? String(pageCount) : undefined);
        return local ? { ...local, kind: 'local', evidence: 'OCR에서 학위논문·보고서 표지 구조 확인' } : null;
    };
    const withParsed = (found: OCRRecognition): OCRRecognition => options.alsoParse ? { ...found, parsed: parsedReading() } : found;
    if (!identifiersTried) {
        const paged = reflowFlattenedFrontMatter(normalized.replace(/^[-–—]{2,}\s*PAGE\s+\d+\s*[-–—]{2,}[^\S\n]*$/gim, '\f'))
            .replace(/^\s*\f/, '');
        const lookup = await recognizeFromTextIdentifiers(parent, before, paged, '', { complete: true });
        let identified = lookup.record;
        if (identified && !/[가-힣]/.test(String(identified.metadata.fields.title || '')) && hangulBody(paged.split('\f'))) {
            trace?.steps.push(`OCR의 ${identified.identifier.kind} 레코드는 제목이 한국어가 아닌데 본문은 한국어라 채택하지 않음: ${String(identified.metadata.fields.title || '').slice(0, 80)}`);
            identified = null;
        }
        if (identified)
            return { ...identified, kind: 'identifier', evidence: `OCR의 ${identified.identifier.kind}와 제목을 Zotero 검색 결과와 교차 확인` };
        if (lookup.unreachable)
            trace?.steps.push(`OCR의 식별자 조회가 완료되지 않음: ${lookup.tried.map(entry => entry.reason).join(' · ').slice(0, 160)}`);
        if (!lookup.record)
            trace?.steps.push('OCR 원문에 검증 가능한 DOI·ISBN 없음');
    }
    if (searchCatalog) {
        try {
            const pageTitles = (options.pageTitles || []).map(title => String(title || '').trim()).filter(title => title.length >= 2);
            const catalog = await catalogFromOCR(parent, before, bounded, cancelled, trace, readingTitles, roles, pageTitles);
            if (catalog)
                return withParsed(catalog);
        }
        catch (cause) {
            Zotero.debug(`[PDF Metadata Refresh] OCR catalog search failed: ${String(cause)}`);
        }
        if (searchAbroad) {
            try {
                const statedPages = (options.statedPages || []).map(page => String(page || '').replace(/[ㆍᆞ]/g, '·').normalize('NFKC')).filter(page => page.trim());
                const abroad = await abroadFromOCR(parent, before, bounded, cancelled, trace, readingTitles, statedPages, { reader: readerFields, pageCount });
                if (abroad)
                    return withParsed(abroad);
            }
            catch (cause) {
                Zotero.debug(`[PDF Metadata Refresh] OCR international search failed: ${String(cause)}`);
            }
        }
    }
    const parsed = parsedReading();
    if (parsed)
        return parsed;
    trace?.steps.push('표지가 학위논문·보고서 구조와도 맞지 않음');
    return null;
}

import { buildCandidate } from './candidate';
import type { Candidate, PageObservation } from './candidate';
import { pageDegraded, pagesFromOCRText, readRecognizerData } from './zotero-pages';
import type { LeafCensus } from './zotero-pages';
import { closesSentence, markWorkOpening, pageCarriesWords } from './roles';
import { leafPages, structureFromPageObservations, titleOrder } from './page-structure';
import { readPDFFrontMatter } from './pdf-text';
import { boundToDocument, crossrefWork, fieldsFromCrossref, mergeOfficial } from './official-source';
import { containerDOIOf } from '../metadata/identifier-compare';
import type { Binding } from './official-source';
import type { Correction, FieldConflict } from '../restore/link';
import { titleSupportedByPDF } from './pdf-identifiers';
import { storableType, validForType } from './item-fields';
import type { MetadataSnapshot } from '../types';
export interface CoverProposal {
    typeRead: boolean;
    metadata: MetadataSnapshot;
    sources: Record<string, any>;
    alternatives: Record<string, any>;
    notStorable: Array<{
        field: string;
        value: unknown;
        reason: string;
    }>;
    pages: PageObservation[];
    documentPages: number | null;
    ocr: {
        provider: string;
        pages: number;
        cacheHit: boolean;
    } | null;
    census?: {
        pages: Array<Omit<LeafCensus, 'heights'>>;
        inserted: number[];
    };
    official: {
        doi: string;
        ok: boolean;
        bound: boolean;
        reason: string;
        checks: Binding['checks'];
        added: string[];
        corrections?: Correction[];
        conflicts?: FieldConflict[];
        notes?: string[];
    } | null;
    candidate: Candidate;
}
export interface CoverObservations {
    pages: PageObservation[];
    documentPages: number | null;
    census: {
        pages: Array<Omit<LeafCensus, 'heights'>>;
        inserted: number[];
    };
}
export type OCRReader = (pages: number) => Promise<{
    text: string;
    pages: number;
    provider: string;
    cacheHit?: boolean;
}>;
export const OCR_COVER_PAGES = 6;
export function openingReadable(pages: PageObservation[]): boolean {
    const structure = structureFromPageObservations(pages);
    const leaves = leafPages(structure);
    const speaks = (page: PageObservation) => {
        const entry = structure.pages.find(held => held.page === page.page);
        if (!entry || leaves.has(page.page))
            return false;
        if (entry.role !== 'cover' && entry.role !== 'other')
            return true;
        if (entry.claim && entry.claim.strength >= 1 && !entry.claim.entry)
            return true;
        return !String(page.text || '').split('\n').some(line => closesSentence(line));
    };
    return pages.some(page => page.page <= 3 && speaks(page) && pageReadable(page));
}
export { pageDegraded };
export function pageReadable(page: PageObservation): boolean {
    return pageCarriesWords(page.text);
}
export const FULL_TEXT_REACH = 12;
export async function pagesBehindTheWindow(attachment: any, window: number, reach = FULL_TEXT_REACH): Promise<{
    pages: PageObservation[];
    empty: number[];
}> {
    const pages: PageObservation[] = [], empty: number[] = [];
    if (!(window > 0) || reach <= window)
        return { pages, empty };
    let text = '';
    try {
        text = await readPDFFrontMatter(attachment, null, reach, 160000);
    }
    catch {
        return { pages, empty };
    }
    const parts = String(text || '').split('\f');
    if (parts.length <= window)
        return { pages, empty };
    parts.slice(window, reach).forEach((part, offset) => {
        const body = part.replace(/\r\n?/g, '\n').trim();
        const page = window + offset + 1;
        if (!body) {
            empty.push(page);
            return;
        }
        pages.push({ page, text: body.slice(0, 12000), layout: body.slice(0, 24000), truncated: body.length > 12000, kind: 'pdfText',
            ...(pageDegraded({ text: body }) ? { degraded: true } : {}) });
    });
    return { pages, empty };
}
export function versoBehindTheWindow(pages: PageObservation[], window: number, total: number): number | null {
    if (!(window > 0) || !(total > window) || pages.some(page => page.page === window + 1))
        return null;
    const last = pages.find(page => page.page === window);
    if (!last || !pageReadable(last) || pageDegraded(last))
        return null;
    const structure = structureFromPageObservations(pages, total);
    return titleOrder(structure, window) === 0 ? window + 1 : null;
}
export function zoteroCrossrefFetch() {
    const once = async (url: string) => {
        try {
            const response = await Zotero.HTTP.request('GET', url, {
                headers: { Accept: 'application/json' },
                responseType: 'json',
                timeout: 12000,
                errorDelayMax: 0
            });
            let json = response.response ?? null;
            if (json == null) {
                try {
                    const raw = response.responseText;
                    json = raw ? JSON.parse(raw) : null;
                }
                catch {
                    json = null;
                }
            }
            return { ok: response.status >= 200 && response.status < 300, status: response.status, json };
        }
        catch (cause: any) {
            return { ok: false, status: Number(cause?.status || 0), failure: String(cause?.message || cause).slice(0, 160) };
        }
    };
    return async (url: string) => {
        const first = await once(url);
        if (first.ok || (first.status >= 400 && first.status < 500))
            return first;
        await new Promise(resolve => setTimeout(resolve, 1500));
        const second = await once(url);
        return second.ok ? second : { ...second, failure: `${second.failure || `HTTP ${second.status}`} (after one retry)` };
    };
}
export async function readCoverCandidate(parent: any, attachment: any, before: MetadataSnapshot, options: {
    consultRegistry?: boolean;
    pageLimit?: number;
    ocr?: OCRReader;
} = {}): Promise<CoverProposal | null> {
    return (await readCoverPages(parent, attachment, before, options)).proposal;
}
export async function readCoverPages(parent: any, attachment: any, before: MetadataSnapshot, options: {
    consultRegistry?: boolean;
    pageLimit?: number;
    ocr?: OCRReader;
} = {}): Promise<{
    proposal: CoverProposal | null;
    observed: CoverObservations | null;
}> {
    const data = await Zotero.PDFWorker.getRecognizerData(attachment.id, true);
    const pageLimit = options.pageLimit ?? 12;
    const recognized = readRecognizerData(data, pageLimit);
    let pages = recognized.pages;
    const window = Math.min(Array.isArray(data?.pages) ? data.pages.length : 0, pageLimit);
    const total = Number((data as any)?.totalPages);
    if (window > 0 && Number.isInteger(total) && total > window && pages.every(page => page.inserted || !pageReadable(page))) {
        const behind = await pagesBehindTheWindow(attachment, window);
        if (behind.pages.length) {
            const empty = new Set(behind.empty);
            pages = [...pages, ...behind.pages].sort((a, b) => a.page - b.page);
            markWorkOpening(pages, page => page <= window || empty.has(page));
        }
    }
    const verso = Number.isInteger(total) ? versoBehindTheWindow(pages, window, total) : null;
    if (verso) {
        const behind = await pagesBehindTheWindow(attachment, window, verso);
        const page = behind.pages.find(entry => entry.page === verso);
        if (page)
            pages = [...pages, page].sort((a, b) => a.page - b.page);
    }
    let ocr: CoverProposal['ocr'] = null;
    const firstPageUnread = !pages.some(page => page.page === 1 && pageReadable(page) && !pageDegraded(page));
    if (options.ocr && (!openingReadable(pages) || firstPageUnread || pages.some(page => page.page <= 3 && pageDegraded(page)))) {
        const read = await options.ocr(OCR_COVER_PAGES);
        const observed = pagesFromOCRText(read.text, OCR_COVER_PAGES);
        if (observed.length) {
            const readable = new Set(pages.filter(page => pageReadable(page) && !pageDegraded(page)).map(page => page.page));
            const merged = [...pages.filter(page => readable.has(page.page)), ...observed.filter(page => !readable.has(page.page))]
                .sort((a, b) => a.page - b.page);
            pages = merged;
            ocr = { provider: read.provider, pages: observed.filter(page => !readable.has(page.page)).length, cacheHit: !!read.cacheHit };
        }
    }
    if (!pages.length)
        return { proposal: null, observed: null };
    const observed: CoverObservations = {
        pages,
        documentPages: Number.isInteger(total) && total > 0 ? total : null,
        census: { pages: recognized.census.map(({ heights, ...leaf }) => leaf), inserted: recognized.inserted }
    };
    const candidate = buildCandidate(pages, { documentPages: Number.isInteger(total) && total > 0 ? total : null });
    if (!candidate.fields.title && !candidate.fields.DOI)
        return { proposal: null, observed };
    let official: CoverProposal['official'] = null;
    if (options.consultRegistry && candidate.fields.DOI) {
        const fetched = await crossrefWork(candidate.fields.DOI, zoteroCrossrefFetch());
        const readable = pages.filter(page => !page.degraded).map(page => page.text).join('\n');
        const titlePage = pages.find(page => page.page === candidate.sources.title?.page);
        const printedDOI: any = candidate.identifiers.find(entry => entry.kind === 'DOI'
            && String(entry.value).toLowerCase() === String(candidate.fields.DOI).toLowerCase()) || null;
        const identifierLine = ((): string => {
            const hay = readable.normalize('NFKC'), lower = hay.toLowerCase(), needle = String(candidate.fields.DOI).toLowerCase();
            const windows: string[] = [];
            for (let from = 0; windows.length < 8;) {
                const at = lower.indexOf(needle, from);
                if (at < 0)
                    break;
                windows.push(hay.slice(Math.max(0, at - 200), at + needle.length + 40));
                from = at + needle.length;
            }
            return windows.join('\n');
        })();
        const container = containerDOIOf(before?.fields?.DOI, candidate.fields.DOI);
        const binding: Binding = container
            ? { bound: false, reason: `not bound: the page prints ${candidate.fields.DOI}, the container of the item’s own DOI ${String(before.fields.DOI)} — the record it names is the volume, not this part of it`, checks: [] }
            : fetched.ok && fetched.message
                ? boundToDocument(fetched.message, readable, titleSupportedByPDF, {
                    identifier: printedDOI,
                    titleRegion: [candidate.fields.title, titlePage?.layout, titlePage?.text].filter(Boolean).join('\n'),
                    statedYears: (candidate.alternatives?.date || []).map((entry: any) => String(entry.value).slice(0, 4))
                        .concat(String(candidate.fields.date || '').slice(0, 4)).filter(Boolean),
                    identifierLine
                })
                : { bound: false, reason: fetched.failure || fetched.reason || 'no record', checks: [] };
        const added = binding.bound
            ? mergeOfficial(candidate, fetched.message, binding, {
                text: readable, ocr: !!ocr,
                years: (candidate.alternatives?.date || []).map((entry: any) => String(entry.value).slice(0, 4)).concat(String(candidate.fields.date || '').slice(0, 4)).filter(Boolean)
            })
            : [];
        official = {
            doi: String(candidate.fields.DOI), ok: !!fetched.ok,
            bound: binding.bound, reason: binding.reason, checks: binding.checks, added,
            corrections: (candidate as any).corrections || [], conflicts: (candidate as any).conflicts || [], notes: (candidate as any).mergeNotes || []
        };
        if (binding.bound) {
            Zotero.debug(`[PDF Metadata Refresh] registry bound: ${Object.keys(fieldsFromCrossref(fetched.message)).join(', ')}`);
        }
    }
    const proposal: CoverProposal = { ...toSnapshot(parent, before, candidate), pages, official, candidate, ocr,
        documentPages: Number.isInteger(Number((data as any)?.totalPages)) ? Number((data as any).totalPages) : null,
        census: observed.census };
    return { proposal, observed };
}
function toSnapshot(parent: any, before: MetadataSnapshot, candidate: Candidate): {
    metadata: MetadataSnapshot;
    sources: Record<string, any>;
    alternatives: Record<string, any>;
    notStorable: CoverProposal['notStorable'];
    typeRead: boolean;
} {
    const namedType = candidate.itemType ? storableType(candidate.itemType) : null;
    const storedType = namedType || 'document';
    const item = new Zotero.Item(storedType);
    item.libraryID = parent.libraryID;
    const notStorable: CoverProposal['notStorable'] = [];
    for (const [field, value] of Object.entries(candidate.fields)) {
        if (field === 'creators' || value === '' || value === undefined || value === null)
            continue;
        if (!validForType(field, storedType)) {
            notStorable.push({ field, value, reason: `${storedType} 항목에 ${field} 필드가 없습니다` });
            continue;
        }
        const id = Zotero.ItemFields.getID(field);
        if (id && Zotero.ItemFields.isValidForType(id, item.itemTypeID))
            item.setField(id, String(value));
        else
            notStorable.push({ field, value, reason: `Zotero가 ${storedType}에서 ${field}를 받지 않습니다` });
    }
    const fields: Record<string, string> = {};
    for (const id of Zotero.ItemFields.getItemTypeFields(item.itemTypeID)) {
        const value = item.getField(id);
        if (value)
            fields[Zotero.ItemFields.getName(id)] = value;
    }
    const creators = Array.isArray(candidate.fields.creators) ? candidate.fields.creators : [];
    const metadata: MetadataSnapshot = {
        ...before,
        itemTypeID: item.itemTypeID,
        itemType: storedType,
        typeRead: !!namedType,
        fields,
        creators
    };
    return { metadata, sources: candidate.sources, alternatives: candidate.alternatives, notStorable, typeRead: !!namedType };
}

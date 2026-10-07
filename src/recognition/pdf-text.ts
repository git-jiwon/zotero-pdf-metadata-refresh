import { pdfFrontMatterText } from './korean';
import { repairShiftedPages } from './text-encoding';
function firstPages(text: string, pageLimit: number, characterLimit: number): string {
    return String(text || '').replace(/\r\n?/g, '\n').split('\f').slice(0, pageLimit).join('\n\f\n').slice(0, characterLimit);
}
function contentKey(text: string): string {
    return String(text || '').normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}
function extractionQuality(text: string): number {
    const sample = String(text || '').slice(0, 5000);
    const visible = sample.replace(/\s/g, '').length || 1;
    const letters = sample.match(/[\p{L}]/gu)?.length || 0;
    const words = sample.match(/[\p{L}]{2,}/gu)?.length || 0;
    return letters / visible + Math.min(words, 30) / 100;
}
export function combinePDFTextSources(workerText: string, cached: string, characterLimit: number): string {
    const cacheKey = contentKey(cached), workerKey = contentKey(workerText);
    if (!workerKey)
        return cached.slice(0, characterLimit);
    if (!cacheKey)
        return workerText.slice(0, characterLimit);
    if (cacheKey.includes(workerKey))
        return cached.slice(0, characterLimit);
    if (workerKey.includes(cacheKey))
        return workerText.slice(0, characterLimit);
    const cacheIsWrapper = /저작자표시[\s-]*비영리[\s-]*변경금지|creative\s+commons\s+(?:licen[cs]e|deed)/i.test(cached.slice(0, 2500));
    const workerFirst = cacheIsWrapper || extractionQuality(workerText) > extractionQuality(cached) + 0.12;
    return (workerFirst ? `${workerText}\n\f\n${cached}` : `${cached}\n\f\n${workerText}`).slice(0, characterLimit);
}
export async function readPDFFrontMatter(attachment: any, data?: any, pageLimit = 5, characterLimit = 60000): Promise<string> {
    const workerText = repairShiftedPages(data ? pdfFrontMatterText(data, pageLimit) : '');
    try {
        const cacheFile = Zotero.Fulltext?.getItemCacheFile?.(attachment);
        if (cacheFile?.path && await IOUtils.exists(cacheFile.path)) {
            const cached = repairShiftedPages(firstPages(await Zotero.File.getContentsAsync(cacheFile, 'utf-8', characterLimit * 2), pageLimit, characterLimit));
            return combinePDFTextSources(workerText, cached, characterLimit);
        }
    }
    catch (cause) {
        Zotero.debug(`[PDF Metadata Refresh] PDF full-text cache unavailable: ${String(cause)}`);
    }
    return firstPages(workerText, pageLimit, characterLimit);
}
export interface BodySample {
    pages: Array<{
        page?: number;
        text: string;
    }>;
    source: 'fullTextCache';
}
const BODY_SAMPLE_CHARS = 2400;
const BODY_SAMPLE_AT = [0.4, 0.5, 0.6];
const BODY_SAMPLE_MIN_TEXT = 20000;
const BODY_SAMPLE_READ = 2000000;
export function bodySampleOf(text: string, front: number): BodySample | null {
    const value = String(text || '').replace(/\r\n?/g, '\n');
    const parts = value.split('\f');
    while (parts.length > 1 && !parts[parts.length - 1].trim())
        parts.pop();
    const pages: BodySample['pages'] = [];
    if (parts.length > 1) {
        const first = Math.max(0, Math.floor(front));
        if (parts.length < first + 2)
            return null;
        const taken = new Set<number>();
        for (const at of BODY_SAMPLE_AT) {
            for (let index = Math.max(first, Math.floor(parts.length * at)), tries = 0; index < parts.length && tries < 3; index++, tries++) {
                const body = parts[index].trim();
                if (taken.has(index) || !body)
                    continue;
                taken.add(index);
                pages.push({ page: index + 1, text: body.slice(0, BODY_SAMPLE_CHARS) });
                break;
            }
        }
    }
    else {
        if (value.length < BODY_SAMPLE_MIN_TEXT)
            return null;
        for (const at of BODY_SAMPLE_AT) {
            const start = Math.floor(value.length * at);
            const body = value.slice(start, start + BODY_SAMPLE_CHARS).trim();
            if (body)
                pages.push({ text: body });
        }
    }
    return pages.length ? { pages, source: 'fullTextCache' } : null;
}
export async function readBodySample(attachment: any, front: number): Promise<BodySample | null> {
    try {
        const cacheFile = Zotero.Fulltext?.getItemCacheFile?.(attachment);
        if (!cacheFile?.path || !await IOUtils.exists(cacheFile.path))
            return null;
        return bodySampleOf(String(await Zotero.File.getContentsAsync(cacheFile, 'utf-8', BODY_SAMPLE_READ) || ''), front);
    }
    catch (cause) {
        Zotero.debug(`[PDF Metadata Refresh] body sample unavailable: ${String(cause)}`);
        return null;
    }
}

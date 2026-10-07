import type { MetadataSnapshot } from '../types';
import type { SearchCandidate } from '../recognition/korean-auto';
import type { EvidenceBundle } from './evidence';
import type { RestoreRecord } from './restore-step';
import type { Completion } from './completion';
import type { FieldConflict } from '../restore/link';
export function fileIdentity(fingerprint: unknown): string {
    try {
        const parsed = JSON.parse(String(fingerprint || ''));
        delete parsed.pipeline;
        return JSON.stringify(parsed);
    }
    catch {
        return String(fingerprint || '');
    }
}
export function sameFile(a: unknown, b: unknown): boolean {
    const parse = (value: unknown): any => { try {
        const parsed = JSON.parse(String(value || ''));
        return parsed && typeof parsed === 'object' ? parsed : null;
    }
    catch {
        return null;
    } };
    const x = parse(a), y = parse(b);
    const measured = (entry: any) => !!entry && Number(entry.size) > 0 && Number(entry.modified) > 0;
    if (!measured(x) || !measured(y))
        return fileIdentity(a) === fileIdentity(b);
    return String(x.attachmentKey ?? '') === String(y.attachmentKey ?? '') && Number(x.size) === Number(y.size) && Number(x.modified) === Number(y.modified);
}
export const RECOGNITION_PIPELINE_VERSION = 'p108';
const CACHE_SCHEMA = 1;
export interface RecognitionCacheEntry {
    schema: number;
    pipelineVersion: string;
    libraryID: number;
    itemKey: string;
    pdfFingerprint: string;
    savedAt: number;
    status: 'recognized' | 'noMatch' | 'textlessPDF';
    recognized?: MetadataSnapshot;
    rawRecognized?: MetadataSnapshot;
    authoritative?: boolean;
    ocrRead?: boolean;
    attempts?: string[];
    manualReview?: boolean;
    coverProposal?: import('./row').CoverProposalRecord;
    recognitionSource?: string;
    candidates?: SearchCandidate[];
    error?: string;
    koreanAttempted?: boolean;
    verifiedPDF?: boolean;
    patentPDF?: boolean;
    technicalPDF?: boolean;
    identifierPDF?: boolean;
    lookupUnreachable?: boolean;
    attachmentKey?: string;
    evidence?: EvidenceBundle;
    restore?: RestoreRecord;
    completion?: Completion;
    fieldConflicts?: FieldConflict[];
    selection?: import('./row').Row['selection'];
}
function cacheDirectory(): string {
    return PathUtils.join(Zotero.DataDirectory.dir, 'pdf-metadata-refresh-cache');
}
function cacheFile(libraryID: number, itemKey: string): string {
    if (!Number.isSafeInteger(libraryID) || libraryID <= 0 || !/^[A-Z0-9]+$/i.test(itemKey)) {
        throw new Error('Invalid cache item identity');
    }
    return PathUtils.join(cacheDirectory(), `${libraryID}-${itemKey}.json`);
}
export async function pdfInputFingerprint(attachment: any): Promise<string> {
    const path = await attachment.getFilePath();
    if (!path || !await IOUtils.exists(path))
        throw new Error('PDF file is unavailable');
    const stat = typeof IOUtils.stat === 'function' ? await IOUtils.stat(path) : {};
    return JSON.stringify({
        pipeline: RECOGNITION_PIPELINE_VERSION,
        attachmentKey: String(attachment.key || ''),
        path: String(path),
        size: Number(stat?.size || 0),
        modified: Number(stat?.lastModified ?? stat?.lastModifiedTime ?? 0)
    });
}
export async function readRecognitionCache(libraryID: number, itemKey: string, pdfFingerprint: string): Promise<RecognitionCacheEntry | null> {
    const path = cacheFile(libraryID, itemKey);
    if (!await IOUtils.exists(path))
        return null;
    try {
        const entry = await IOUtils.readJSON(path) as RecognitionCacheEntry;
        if (entry.schema !== CACHE_SCHEMA || entry.pipelineVersion !== RECOGNITION_PIPELINE_VERSION
            || entry.libraryID !== libraryID || entry.itemKey !== itemKey || !sameFile(entry.pdfFingerprint, pdfFingerprint))
            return null;
        if (!['recognized', 'noMatch', 'textlessPDF'].includes(entry.status))
            return null;
        if (entry.status === 'recognized' && !entry.recognized)
            return null;
        return entry;
    }
    catch (e) {
        Zotero.debug(`[PDF Metadata Refresh] cache read ignored: item=${itemKey}; ${String(e)}`);
        return null;
    }
}
export async function writeRecognitionCache(entry: Omit<RecognitionCacheEntry, 'schema' | 'pipelineVersion' | 'savedAt'>): Promise<void> {
    const directory = cacheDirectory();
    await IOUtils.makeDirectory(directory, { ignoreExisting: true, createAncestors: true });
    const path = cacheFile(entry.libraryID, entry.itemKey);
    await IOUtils.writeJSON(path, {
        ...entry,
        schema: CACHE_SCHEMA,
        pipelineVersion: RECOGNITION_PIPELINE_VERSION,
        savedAt: Date.now()
    }, { tmpPath: path + '.tmp' });
}
export async function clearRecognitionCache(rows: Array<{
    libraryID: number;
    key: string;
}>): Promise<number> {
    let removed = 0;
    for (const row of rows) {
        const path = cacheFile(row.libraryID, row.key);
        if (!await IOUtils.exists(path))
            continue;
        await IOUtils.remove(path);
        removed++;
    }
    return removed;
}

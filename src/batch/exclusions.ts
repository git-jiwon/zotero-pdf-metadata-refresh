import { fileIdentity, sameFile } from './cache';
interface PDFExclusionEntry {
    libraryID: number;
    itemKey: string;
    pdfIdentity: string;
    excludedAt: number;
    title: string;
}
interface PDFExclusionStore {
    schema: 1;
    entries: PDFExclusionEntry[];
}
const storePath = () => PathUtils.join(Zotero.DataDirectory.dir, 'pdf-metadata-refresh-exclusions.json');
const identity = (fingerprint: string): string => fileIdentity(fingerprint);
const keyFor = (libraryID: number, itemKey: string) => `${libraryID}:${itemKey}`;
async function readStore(): Promise<PDFExclusionStore> {
    const path = storePath();
    if (!await IOUtils.exists(path))
        return { schema: 1, entries: [] };
    try {
        const value = await IOUtils.readJSON(path);
        if (value?.schema !== 1 || !Array.isArray(value.entries))
            throw new Error('Invalid exclusion store');
        return value;
    }
    catch (e) {
        Zotero.debug(`[PDF Metadata Refresh] exclusion store ignored: ${String(e)}`);
        return { schema: 1, entries: [] };
    }
}
async function writeStore(store: PDFExclusionStore): Promise<void> {
    const path = storePath();
    await IOUtils.writeJSON(path, store, { tmpPath: path + '.tmp' });
}
export async function isPDFExcluded(libraryID: number, itemKey: string, fingerprint: string): Promise<boolean> {
    const wanted = keyFor(libraryID, itemKey), pdfIdentity = identity(fingerprint);
    return (await readStore()).entries.some(entry => keyFor(entry.libraryID, entry.itemKey) === wanted
        && (!entry.pdfIdentity || sameFile(entry.pdfIdentity, pdfIdentity)));
}
export async function isItemExcluded(libraryID: number, itemKey: string): Promise<boolean> {
    const wanted = keyFor(libraryID, itemKey);
    return (await readStore()).entries.some(entry => keyFor(entry.libraryID, entry.itemKey) === wanted && !entry.pdfIdentity);
}
export async function addPDFExclusion(libraryID: number, itemKey: string, fingerprint: string, title: string): Promise<void> {
    const store = await readStore(), wanted = keyFor(libraryID, itemKey);
    store.entries = store.entries.filter(entry => keyFor(entry.libraryID, entry.itemKey) !== wanted);
    store.entries.push({ libraryID, itemKey, pdfIdentity: fingerprint ? identity(fingerprint) : '', excludedAt: Date.now(), title });
    await writeStore(store);
}
export async function removePDFExclusion(libraryID: number, itemKey: string): Promise<void> {
    const store = await readStore(), wanted = keyFor(libraryID, itemKey);
    const entries = store.entries.filter(entry => keyFor(entry.libraryID, entry.itemKey) !== wanted);
    if (entries.length !== store.entries.length)
        await writeStore({ schema: 1, entries });
}

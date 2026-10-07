const acceptedSources = new Set(['content', 'methods', 'findings', 'fulltext']);
export interface ZotSeekChunk {
    chunkIndex?: number;
    chunkText?: string;
    textSource?: string;
    pageNumber?: number;
    title?: string;
}
function stripKnownPrefix(text: string, titles: string[]): string {
    let value = text.trim();
    for (const title of titles.map(x => x.trim()).filter(Boolean)) {
        if (value.startsWith(title))
            value = value.slice(title.length).replace(/^\s+/, '');
    }
    return value;
}
export function usableZotSeekChunks(chunks: ZotSeekChunk[], parentTitle = ''): ZotSeekChunk[] {
    return chunks
        .filter(chunk => acceptedSources.has(String(chunk.textSource || '').toLowerCase()))
        .filter(chunk => Number.isFinite(chunk.pageNumber) && Number(chunk.pageNumber) >= 1 && Number(chunk.pageNumber) <= 5)
        .map(chunk => ({ ...chunk, chunkText: stripKnownPrefix(String(chunk.chunkText || ''), [String(chunk.title || ''), parentTitle]) }))
        .filter(chunk => String(chunk.chunkText || '').trim().length >= 40)
        .sort((a, b) => Number(a.pageNumber) - Number(b.pageNumber) || Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0));
}
function libraryKey(item: any): string | null {
    const library = Zotero.Libraries.get(item.libraryID);
    if (library?.libraryType === 'user')
        return 'user';
    if (library?.libraryType === 'group' && library.groupID)
        return `group:${library.groupID}`;
    return null;
}
export async function getZotSeekFrontMatter(parent: any): Promise<{
    text: string;
    reason: string;
} | null> {
    const addon = Zotero.ZotSeek;
    if (!addon || typeof addon.ensureStoreReady !== 'function')
        return null;
    try {
        await addon.ensureStoreReady();
        const store = addon.vectorStore;
        if (!store || typeof store.getItemChunksByIdentity !== 'function')
            return null;
        const key = libraryKey(parent);
        if (!key)
            return null;
        const chunks = usableZotSeekChunks(await store.getItemChunksByIdentity(key, parent.key));
        if (!chunks.length)
            return null;
        const text = chunks.map(chunk => String(chunk.chunkText)).join('\n').slice(0, 50000);
        Zotero.debug(`[PDF Metadata Refresh] item=${parent.key} using ZotSeek PDF-text cache; chunks=${chunks.length}; chars=${text.length}`);
        return { text, reason: `ZotSeek PDF 본문 캐시 ${chunks.length}개 chunk 사용` };
    }
    catch (e) {
        Zotero.debug(`[PDF Metadata Refresh] item=${parent.key} ZotSeek text unavailable: ${String(e)}`);
        return null;
    }
}

import { titleSimilarity } from '../metadata/match';
import { isResearchSquare } from '../metadata/publication-state';
import type { MetadataSnapshot, RecognitionResult } from '../types';
import { buildDiff } from '../metadata/diff';
import { getPublicPage } from '../utils/http';
import { storableType } from './item-fields';
const normalizeName = (value: unknown) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const cleanDOI = (value: unknown) => String(value || '').trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
function authorOverlap(recognized: MetadataSnapshot, authors: any[]): number | null {
    const oldNames = new Set((recognized.creators || []).map((creator: any) => normalizeName(creator.lastName || creator.name)).filter(Boolean));
    const newNames = new Set((authors || []).map(author => normalizeName(author.family || author.name)).filter(Boolean));
    if (!oldNames.size || !newNames.size)
        return null;
    return [...oldNames].filter(name => newNames.has(name)).length / Math.min(oldNames.size, newNames.size);
}
export function selectPublishedCandidate(recognized: MetadataSnapshot, items: any[]): {
    doi: string;
    title: string;
    score: number;
} | null {
    const sourceTitle = String(recognized.fields.title || '');
    const ranked = (items || []).flatMap(item => {
        const title = String(Array.isArray(item.title) ? item.title[0] : item.title || '');
        const doi = cleanDOI(item.DOI);
        const score = titleSimilarity(sourceTitle, title);
        const authors = authorOverlap(recognized, item.author || []);
        if (item.type !== 'journal-article' || !doi || /^10\.21203\/rs\./i.test(doi) || score < 0.94 || (authors !== null && authors < 0.5))
            return [];
        return [{ doi, title, score }];
    }).sort((a, b) => b.score - a.score);
    if (!ranked.length || (ranked[1] && ranked[0].score - ranked[1].score < 0.03 && ranked[0].doi !== ranked[1].doi))
        return null;
    return ranked[0];
}
async function translateDOI(parent: any, doi: string, source: MetadataSnapshot): Promise<MetadataSnapshot | null> {
    const translate = new Zotero.Translate.Search();
    translate.setIdentifier({ DOI: doi });
    const translators = await translate.getTranslators();
    if (!translators.length)
        return null;
    translate.setTranslator(translators);
    const items = await translate.translate({ libraryID: false, saveAttachments: false });
    const json = items[0];
    if (!json?.title || cleanDOI(json.DOI) !== doi || titleSimilarity(source.fields.title, json.title) < 0.94)
        return null;
    const candidate = new Zotero.Item(storableType(json.itemType || 'journalArticle'));
    candidate.libraryID = parent.libraryID;
    for (const id of Zotero.ItemFields.getItemTypeFields(candidate.itemTypeID)) {
        const field = Zotero.ItemFields.getName(id), value = json[field];
        if (typeof value === 'string' && value.trim())
            candidate.setField(id, value.trim());
    }
    candidate.setCreators((json.creators || []).filter((creator: any) => creator.creatorType === 'author'));
    const fields: Record<string, string> = {};
    for (const id of Zotero.ItemFields.getItemTypeFields(candidate.itemTypeID)) {
        const value = candidate.getField(id);
        if (value)
            fields[Zotero.ItemFields.getName(id)] = value;
    }
    return { ...source, itemTypeID: candidate.itemTypeID, itemType: Zotero.ItemTypes.getName(candidate.itemTypeID), fields, creators: candidate.getCreators() };
}
export async function resolvePublishedVersion(parent: any, recognized: MetadataSnapshot): Promise<RecognitionResult | null> {
    if (!isResearchSquare(recognized) || !recognized.fields.title)
        return null;
    const url = 'https://api.crossref.org/works?filter=type:journal-article&rows=5&select=DOI,title,author,type&query.bibliographic=' + encodeURIComponent(String(recognized.fields.title).slice(0, 240));
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.crossref.org')
        return null;
    const response = await getPublicPage(url);
    const candidate = selectPublishedCandidate(recognized, JSON.parse(response.responseText)?.message?.items || []);
    if (!candidate)
        return null;
    const metadata = await translateDOI(parent, candidate.doi, recognized);
    return metadata ? { source: null, metadata, changes: buildDiff(recognized, metadata) } : null;
}

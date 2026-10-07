import { buildDiff } from '../metadata/diff';
import { assertIdentityUnchanged, captureIdentity } from '../metadata/snapshot';
import type { MetadataSnapshot, RecognitionResult } from '../types';
import { pdfFirstPageText } from './korean';
export interface GenericJournalHeader {
    title: string;
    publicationTitle: string;
    volume: string;
    pages: string;
    date: string;
    ISSN?: string;
}
export function parseGenericJournalHeader(data: any): GenericJournalHeader | null {
    const text = pdfFirstPageText(data).replace(/\s+/g, ' ').trim();
    if (!/\bBOOK\s+REVIEWS?\b/i.test(text))
        return null;
    const header = text.match(/^(.{3,100}?),\s*Vol\.?\s*(\d+[A-Za-z]?)\s*,\s*pp?\.?\s*(\d+\s*[-–]\s*\d+)\s*,\s*((?:18|19|20)\d{2})\b/i);
    if (!header)
        return null;
    const publicationTitle = header[1].trim();
    if (/^(?:book|review)/i.test(publicationTitle) || /https?:\/\//i.test(publicationTitle))
        return null;
    const issn = text.match(/\bISSN\s*([0-9]{4}-[0-9]{3}[0-9X])\b/i)?.[1]
        || text.match(/\b(\d{4}-\d{3}[\dX])\/(?:\d{2}|(?:19|20)\d{2})\b/i)?.[1];
    return {
        title: 'Book Reviews', publicationTitle, volume: header[2],
        pages: header[3].replace(/\s+/g, ''), date: header[4], ...(issn ? { ISSN: issn } : {})
    };
}
export async function recognizeGenericJournalHeader(parent: any, attachment: any, before: MetadataSnapshot): Promise<RecognitionResult | null> {
    const parsed = parseGenericJournalHeader(await Zotero.PDFWorker.getRecognizerData(attachment.id, true));
    if (!parsed)
        return null;
    const item = new Zotero.Item('journalArticle');
    item.libraryID = parent.libraryID;
    for (const [field, value] of Object.entries(parsed))
        item.setField(field, value);
    const fields: Record<string, string> = {};
    for (const id of Zotero.ItemFields.getItemTypeFields(item.itemTypeID)) {
        const value = item.getField(id);
        if (value)
            fields[Zotero.ItemFields.getName(id)] = value;
    }
    const metadata: MetadataSnapshot = {
        ...before, itemTypeID: item.itemTypeID, itemType: Zotero.ItemTypes.getName(item.itemTypeID),
        fields, creators: []
    };
    assertIdentityUnchanged(before.identity, await captureIdentity(parent));
    return { source: null, metadata, changes: buildDiff(before, metadata, true) };
}

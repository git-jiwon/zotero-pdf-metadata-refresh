import { buildDiff } from '../metadata/diff';
import { titleSupportedByPDF } from './pdf-identifiers';
import { pdfFirstPageText, pdfFrontMatterText } from './korean';
import type { MetadataSnapshot, RecognitionResult } from '../types';
export interface EmbeddedBookData {
    title: string;
    author?: string;
    date?: string;
}
function metadataField(metadata: any, name: string): string {
    if (!metadata || typeof metadata !== 'object')
        return '';
    const key = Object.keys(metadata).find(value => value.replace(/^\//, '').toLowerCase() === name.toLowerCase());
    return key ? String(metadata[key] || '').trim() : '';
}
export function parseEmbeddedBook(data: any): EmbeddedBookData | null {
    const front = pdfFrontMatterText(data, 3), first = pdfFirstPageText(data);
    if (!/(?:\btext[ -]?book\b|\bISBN(?:-1[03])?\b)/i.test(front))
        return null;
    if (/(?:accepted\s+manuscript|\bcommunication\b|\breceived\b.{0,80}\baccepted\b|\bDOI\s*:\s*10\.)/i.test(front)
        && !/(?:\btext[ -]?book\b|\bISBN(?:-1[03])?\b)/i.test(front))
        return null;
    const title = metadataField(data?.metadata, 'title');
    if (title.length < 8 || title.length > 220 || /^https?:\/\//i.test(title) || !titleSupportedByPDF(title, first))
        return null;
    const author = metadataField(data?.metadata, 'author').replace(/^Dr\.?\s*/i, '').trim() || undefined;
    const date = [...front.matchAll(/(?:©|copyright)\s*(?:\D{0,40})?((?:19|20)\d{2})/gi)].at(-1)?.[1]
        || front.match(/\b((?:19|20)\d{2})\b/)?.[1];
    return { title, author, date };
}
export function parseArchivedBookFilename(path: string, frontMatter: string): EmbeddedBookData | null {
    if (!/(?:digital\s+copy\s+of\s+a\s+book|scanned\s+by\s+google|public\s+domain\s+book)/i.test(frontMatter))
        return null;
    const filename = String(path || '').split(/[\\/]/).pop()?.replace(/\.pdf$/i, '').normalize('NFKC').trim() || '';
    const match = filename.match(/^(.{2,80}?)[_-]((?:1[5-9]|20)\d{2})[_-](.{8,220})$/);
    if (!match)
        return null;
    const title = match[3].replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    const latinWords = title.match(/[A-Za-z][A-Za-z'-]*/g)?.length || 0;
    if (latinWords < 3 || /^(?:scan|download|document|untitled)\b/i.test(title))
        return null;
    const author = match[1].replace(/,?\s*(?:B\.?S\.?|M\.?S\.?|Ph\.?D\.?).*$/i, '').replace(/_/g, ' ').trim();
    if (!/^[A-Za-z][A-Za-z.' -]{2,79}$/.test(author))
        return null;
    return { title, author, date: match[2] };
}
export function splitCreatorList(value: string | undefined): Array<{
    firstName: string;
    lastName: string;
    creatorType: string;
}> {
    const source = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!source)
        return [];
    const commas = (source.match(/,/g) || []).length;
    const inverted = commas === 1 && /^[^,]+,[^,]+$/.test(source)
        && source.split(',').every(part => part.trim().split(' ').length <= 2);
    const names = inverted ? [source] : source.split(/\s*(?:,|;|·|&|\band\b)\s*/i).map(part => part.trim()).filter(Boolean);
    return names.slice(0, 20).map(name => {
        const swapped = name.match(/^([^,]+),\s*(.+)$/);
        if (swapped)
            return { firstName: swapped[2].trim(), lastName: swapped[1].trim(), creatorType: 'author' };
        const parts = name.split(' ');
        const lastName = parts.pop() || name;
        return { firstName: parts.join(' '), lastName, creatorType: 'author' };
    }).filter(creator => !!creator.lastName);
}
export async function recognizeEmbeddedBook(parent: any, attachment: any, before: MetadataSnapshot): Promise<RecognitionResult | null> {
    const data = await Zotero.PDFWorker.getRecognizerData(attachment.id, true);
    let parsed = parseEmbeddedBook(data);
    if (!parsed) {
        const path = await attachment.getFilePath();
        parsed = path ? parseArchivedBookFilename(path, pdfFrontMatterText(data, 3)) : null;
    }
    if (!parsed)
        return null;
    const candidate = new Zotero.Item('book');
    candidate.libraryID = parent.libraryID;
    for (const [field, value] of Object.entries({ title: parsed.title, date: parsed.date })) {
        const id = Zotero.ItemFields.getID(field);
        if (value && id && Zotero.ItemFields.isValidForType(id, candidate.itemTypeID))
            candidate.setField(id, value);
    }
    const creators = splitCreatorList(parsed.author);
    if (creators.length)
        candidate.setCreators(creators);
    const fields: Record<string, string> = {};
    for (const id of Zotero.ItemFields.getItemTypeFields(candidate.itemTypeID)) {
        const value = candidate.getField(id);
        if (value)
            fields[Zotero.ItemFields.getName(id)] = value;
    }
    const metadata: MetadataSnapshot = { ...before, itemTypeID: candidate.itemTypeID, itemType: 'book', fields, creators: candidate.getCreators() };
    return { source: null, metadata, changes: buildDiff(before, metadata, true) };
}

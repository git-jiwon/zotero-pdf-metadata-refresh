import { buildDiff } from '../metadata/diff';
import { linesFromRecognizerData } from './korean-patent';
import type { MetadataSnapshot, RecognitionResult } from '../types';
import { readPDFFrontMatter } from './pdf-text';
import { dateFromText } from './local-publication';
import { codeToken, codesOf, readPageStructure, type DocumentCode, type PageStructure } from './page-structure';
import { issuingBodyOf } from './statements';
import { isDateOnly } from './title-guards';
export interface TechnicalDocumentData {
    title: string;
    reportType: string;
    reportNumber: string;
    institution: string;
    date?: string;
    numPages?: string;
    language: string;
}
function publicationDate(text: string): string | undefined {
    return dateFromText(text);
}
const LEGAL_SUFFIX = /(?:주식회사|㈜|(?<![\p{L}])(?:Inc|INC|Corp|CORP|Corporation|CORPORATION|Company|COMPANY|Co\.,?\s*Ltd|CO\.,?\s*LTD|Ltd|LTD|LLC|GmbH|GMBH|AG|S\.A|B\.V)\.?)$/u;
function companyMarked(lines: string[]): boolean {
    if (lines.some(line => line.length >= 2 && line.length <= 60 && LEGAL_SUFFIX.test(line)))
        return true;
    const text = lines.join('\n');
    const holder = text.match(/(?:©|\(c\)|Copyright)\s*(?:\d{4}(?:\s*[-–]\s*\d{4})?)?\s*,?\s*([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4})/)?.[1];
    if (holder && holder.length >= 3)
        return true;
    return /\bwww\.[a-z0-9-]{2,30}\.(?:com|co\.kr|kr|net|de|jp)\b/i.test(text);
}
function titleAfter(lines: string[], marker: RegExp, stop: RegExp): string {
    const index = lines.findIndex(line => marker.test(line));
    if (index < 0)
        return '';
    const values: string[] = [];
    const sameLine = lines[index].replace(marker, '').replace(/^\s*[-:|]\s*/, '').trim();
    if (sameLine.length >= 8)
        values.push(sameLine);
    for (let i = index + 1; i < Math.min(lines.length, index + 5); i++) {
        const line = lines[i].trim();
        if (!line || stop.test(line) || (line.length <= 60 && LEGAL_SUFFIX.test(line)))
            break;
        const imprint = isDateOnly(line) || codeToken(line);
        if (imprint && values.length)
            break;
        if (imprint || /^(?:Rev\b|Page\b|\d+\s*\/\s*\d+|www\.|https?:\/\/|Please\s+visit\b|(?:19|20)\d{2}\b)/i.test(line)
            || /\b(?:latest version of this document|copyright)\b/i.test(line))
            continue;
        values.push(line);
        if (values.join(' ').length >= 180)
            break;
    }
    return values.join(' ').replace(/\s+/g, ' ').trim();
}
function structureOfPages(pages: string[][]): PageStructure {
    return readPageStructure({ pages: pages.map((lines, index) => ({ page: index + 1, layer: { text: lines.join('\n') } })) });
}
function parseTechnicalLines(pages: string[][], pageCount?: number): TechnicalDocumentData | null {
    const lines = pages.flat();
    const text = lines.join('\n').normalize('NFKC');
    if (!companyMarked(lines.map(line => line.normalize('NFKC').replace(/\s+/g, ' ').trim())))
        return null;
    const application = /\bapplication\s+note\b/i.test(text);
    const dataSheet = /\bdata\s*sheet\b/i.test(text);
    const guide = /\b(?:installation|reference|user|design)\s+(?:guide|manual)\b/i.test(text);
    if (!application && !dataSheet && !guide)
        return null;
    const structure = structureOfPages(pages);
    const institution = issuingBodyOf(structure);
    const codes = codesOf(structure);
    const rank = (code: DocumentCode) => code.from.includes('label') ? 0 : code.from.includes('running') ? 1 : 2;
    const numbers = codes.filter(code => code.kind === 'documentNumber').sort((a, b) => rank(a) - rank(b));
    const orderIndex = lines.findIndex(line => numbers.some(code => line.replace(/\s+/g, '') === code.value));
    const afterOrder = orderIndex < 0 ? '' : (lines[orderIndex + 1] || '').trim();
    const orderTitle = afterOrder.length >= 12 && afterOrder.length <= 180 && /[A-Za-z]{3}/.test(afterOrder)
        && !/^(?:\d|www\.|https?:|©|Publication|Rev\b|Page\b)/i.test(afterOrder)
        && !/^(?:application\s+note|data\s*sheet|user\s+manual|installation\s+guide|technical\s+manual|reference\s+guide)$/i.test(afterOrder)
        ? afterOrder : undefined;
    let reportType = application ? 'Application Note' : dataSheet && guide ? 'Data Sheet and Installation Guide' : dataSheet ? 'Data Sheet' : 'Technical Manual';
    let reportNumber = numbers[0]?.value || '';
    let title = application
        ? orderTitle || titleAfter(lines, /\bapplication\s+note\b/i, /^(?:Introduction|Contents|Table\s+of\s+contents)\b/i)
        : text.match(/\b(?:Drive\s+)?Data\s*Sheet\s*(?:&|and)\s*(?:Installation\s+)?Guide\b/i)?.[0]
            || text.match(/\b(?:Drive\s+)?Data\s*Sheet\b/i)?.[0]
            || '';
    const productTitle = lines.find(line => /\b[A-Z][A-Z0-9-]*\d{3,6}[A-Z0-9-]*\b.*\b(?:servo\s+drives?|controllers?|motors?|sensors?)\b/i.test(line.trim()))?.trim();
    if (!application && productTitle)
        title = productTitle;
    if (!title && guide)
        title = titleAfter(lines, /\b(?:installation|reference|user|design)\s+(?:guide|manual)\b/i, /^(?:Documentation|Contents|Copyright|Please\s+visit|https?:\/\/|www\.)\b/i);
    const model = codes.find(code => code.kind === 'part')?.value
        ?? numbers.find(code => code.from.includes('running') || code.from.includes('display'))?.value;
    if (!application && model && title && !title.toLowerCase().includes(model.toLowerCase()))
        title = `${model} ${title}`;
    title = title.replace(/\s+/g, ' ').replace(/\s+[-|]\s+(?:Application Note|Data Sheet).*$/i, '').trim();
    if (!reportNumber && model && (dataSheet || guide))
        reportNumber = model.toUpperCase();
    if (!title || title.length < 12 || title.length > 240 || !reportNumber)
        return null;
    return {
        title, reportType, reportNumber, institution, date: publicationDate(text),
        numPages: pageCount ? String(pageCount) : undefined,
        language: /[가-힣]/.test(title) ? 'ko' : 'en'
    };
}
export function parseTechnicalDocumentText(text: string, pageCount?: number): TechnicalDocumentData | null {
    const front = String(text || '').replace(/\r\n?/g, '\n').split('\f').slice(0, 2);
    return parseTechnicalLines(front.map(page => page.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean)), pageCount);
}
export function parseTechnicalDocument(data: any): TechnicalDocumentData | null {
    return parseTechnicalLines([linesFromRecognizerData(data)], Array.isArray(data?.pages) ? data.pages.length : undefined);
}
export async function recognizeTechnicalDocument(parent: any, attachment: any, before: MetadataSnapshot): Promise<RecognitionResult | null> {
    const data = await Zotero.PDFWorker.getRecognizerData(attachment.id, true);
    const parsed = parseTechnicalDocument(data)
        || parseTechnicalDocumentText(await readPDFFrontMatter(attachment, data, 2), Array.isArray(data?.pages) ? data.pages.length : undefined);
    if (!parsed)
        return null;
    return technicalDocumentResult(parent, before, parsed);
}
export function recognizeTechnicalDocumentText(parent: any, before: MetadataSnapshot, text: string, pageCount?: number): RecognitionResult | null {
    const parsed = parseTechnicalDocumentText(text, pageCount);
    return parsed ? technicalDocumentResult(parent, before, parsed) : null;
}
function technicalDocumentResult(parent: any, before: MetadataSnapshot, parsed: TechnicalDocumentData): RecognitionResult {
    const candidate = new Zotero.Item('report');
    candidate.libraryID = parent.libraryID;
    const fields: Record<string, string | undefined> = { ...parsed };
    delete (fields as any).numPages;
    for (const [field, value] of Object.entries(fields)) {
        const id = Zotero.ItemFields.getID(field);
        if (value && id && Zotero.ItemFields.isValidForType(id, candidate.itemTypeID))
            candidate.setField(id, value);
    }
    const metadataFields: Record<string, string> = {};
    for (const id of Zotero.ItemFields.getItemTypeFields(candidate.itemTypeID)) {
        const value = candidate.getField(id);
        if (value)
            metadataFields[Zotero.ItemFields.getName(id)] = value;
    }
    const metadata: MetadataSnapshot = { ...before, itemTypeID: candidate.itemTypeID, itemType: 'report', fields: metadataFields, creators: [] };
    return { source: null, metadata, changes: buildDiff(before, metadata, true) };
}

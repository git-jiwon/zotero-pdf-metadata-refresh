import { buildDiff } from '../metadata/diff';
import { titleSimilarity } from '../metadata/match';
import { assertIdentityUnchanged, captureIdentity } from '../metadata/snapshot';
import type { MetadataSnapshot, RecognitionResult } from '../types';
import { debug } from '../utils/log';
const GOOGLE_PATENTS_TRANSLATOR_ID = 'd71e9b6d-2baa-44ed-acb4-13fe2fe592c0';
function normalizePatentNumber(value: unknown): string {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
export interface PrintedUSPatent {
    number: string;
    printed: string;
    labelled: boolean;
    count: number;
    fromFile?: boolean;
}
const PUBLICATION_NUMBER = /(?<![A-Za-z0-9])US\s*((?:19|20)\d{2})\s*(?:\/\s*)?(\d{7})\s*A\s*([1-9Il])(?![A-Za-z0-9])/g;
const GRANT_NUMBER = /(?<![A-Za-z0-9])US\s*(?:(RE|D|PP)\s*)?(\d{1,3}(?:,\d{3}){1,2}|\d{5,8})\s*([ABEPS])\s*([1-9Il])?(?![A-Za-z0-9])/g;
const OWN_NUMBER_LABEL = /(?:[([]\s*1[01]\s*[)\]]|\bNo\s*\.?)\s*:?\s*$/i;
export function printedUSPatentNumbers(texts: Array<string | null | undefined>): PrintedUSPatent[] {
    const found = new Map<string, PrintedUSPatent & {
        first: number;
    }>();
    let order = 0;
    const kind = (value: string | undefined) => value ? value.replace(/[Il]/, '1') : '';
    const note = (number: string, printed: string, labelled: boolean) => {
        const known = found.get(number);
        if (known) {
            known.count++;
            known.labelled = known.labelled || labelled;
            return;
        }
        found.set(number, { number, printed, labelled, count: 1, first: order++ });
    };
    for (const raw of texts) {
        const text = String(raw ?? '').normalize('NFKC');
        if (!/US/.test(text))
            continue;
        const whole = text.trim();
        const labelledAt = (index: number, match: string) => match.trim() === whole || OWN_NUMBER_LABEL.test(text.slice(Math.max(0, index - 40), index));
        for (const match of text.matchAll(PUBLICATION_NUMBER)) {
            note(`US${match[1]}${match[2]}A${kind(match[3])}`, match[0].trim(), labelledAt(match.index ?? 0, match[0]));
        }
        for (const match of text.matchAll(GRANT_NUMBER)) {
            const digits = match[2].replace(/,/g, '');
            if (!match[1] && digits.length < 7)
                continue;
            note(`US${match[1] || ''}${digits}${match[3]}${kind(match[4])}`, match[0].trim(), labelledAt(match.index ?? 0, match[0]));
        }
    }
    return [...found.values()].filter(entry => entry.labelled || entry.count >= 2)
        .sort((a, b) => Number(b.labelled) - Number(a.labelled) || b.count - a.count || a.first - b.first)
        .map(({ first: _first, ...entry }) => entry);
}
const titleLetters = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export function usPatentTitleAgrees(recordTitle: unknown, readTitles: Array<string | null | undefined>, printed = ''): boolean {
    const title = titleLetters(recordTitle);
    if (!title)
        return false;
    if (readTitles.some(read => titleLetters(read) && titleSimilarity(recordTitle, read) >= 0.9))
        return true;
    return title.length >= 16 && titleLetters(printed).includes(title);
}
export interface PrintedUSPatentOutcome {
    result: RecognitionResult | null;
    patent: PrintedUSPatent | null;
    notes: Array<{
        kind: string;
        value: string;
        outcome: string;
        reason: string;
    }>;
    unreachable: boolean;
}
export async function recognizePrintedUSPatent(parent: any, attachment: any, before: MetadataSnapshot, reading: {
    texts: Array<string | null | undefined>;
    readTitles: Array<string | null | undefined>;
    printed: string;
    embedded?: string | null;
    skip?: string[];
}, limit = 2): Promise<PrintedUSPatentOutcome> {
    const outcome: PrintedUSPatentOutcome = { result: null, patent: null, notes: [], unreachable: false };
    const numbers = printedUSPatentNumbers(reading.texts);
    const embedded = reading.embedded ? normalizePatentNumber(reading.embedded) : '';
    if (embedded && !numbers.some(entry => entry.number === embedded))
        numbers.push({ number: embedded, printed: embedded, labelled: true, count: 1, fromFile: true });
    const skip = new Set((reading.skip || []).map(normalizePatentNumber));
    for (const patent of numbers.filter(entry => !skip.has(entry.number)).slice(0, limit)) {
        let found: RecognitionResult | null = null;
        try {
            found = await recognizeUSPatent(parent, attachment, before, patent.number);
        }
        catch (cause) {
            if (/Safety invariant failed/.test(String(cause)))
                throw cause;
            const answered = (cause as any)?.answered === true;
            if (!answered)
                outcome.unreachable = true;
            outcome.notes.push({ kind: 'US patent', value: patent.number, outcome: answered ? 'noMatch' : 'failed', reason: String((cause as any)?.message || cause).slice(0, 200) });
            continue;
        }
        if (!found)
            continue;
        const title = String(found.metadata.fields.title || '');
        if (!usPatentTitleAgrees(title, reading.readTitles, reading.printed)) {
            const read = String(reading.readTitles.find(value => String(value || '').trim()) || '');
            outcome.notes.push({ kind: 'US patent', value: patent.number, outcome: 'rejected',
                reason: `Google Patents 기록의 제목 「${title.slice(0, 80)}」이 쪽에 인쇄된 제목${read ? `(판독 「${read.slice(0, 80)}」)` : ''}과 글자가 다릅니다 — 번호를 잘못 옮겼을 수 있어 받지 않음` });
            continue;
        }
        outcome.notes.push({ kind: 'US patent', value: patent.number, outcome: 'record', reason: `${patent.fromFile ? 'PDF 정보 제목의' : '쪽에 인쇄된'} ${patent.printed}의 Google Patents 기록 — 제목이 쪽의 제목과 같음` });
        outcome.result = found;
        outcome.patent = patent;
        return outcome;
    }
    return outcome;
}
export function parseUSPatentNumberFromPDFTitle(value: string): string | null {
    const compact = normalizePatentNumber(value);
    const match = compact.match(/^US0*(\d{7,11})([A-Z]\d)(?:(?:19|20)\d{6})?$/);
    if (!match)
        return null;
    const number = match[1].replace(/^0+(?=\d)/, '');
    if (number.length < 7 || number.length > 11)
        return null;
    return `US${number}${match[2]}`;
}
function decodeASCIIHex(value: string): string {
    let output = '';
    for (let i = 0; i + 1 < value.length; i += 2)
        output += String.fromCharCode(parseInt(value.slice(i, i + 2), 16));
    return output;
}
export function parseUSPatentNumberFromPDFHeader(header: string): string | null {
    if (!header.startsWith('%PDF-'))
        return null;
    const literal = header.match(/\/Title\s*\(((?:\\.|[^\\)]){1,180})\)/)?.[1]
        ?.replace(/\\([\\()])/g, '$1');
    const hex = header.match(/\/Title\s*<([0-9A-Fa-f]{14,360})>/)?.[1];
    return parseUSPatentNumberFromPDFTitle(literal || (hex ? decodeASCIIHex(hex) : ''));
}
export async function readEmbeddedUSPatentNumber(attachment: any): Promise<string | null> {
    const path = await attachment.getFilePath();
    if (!path || !await IOUtils.exists(path))
        return null;
    const bytes = await IOUtils.read(path, { maxBytes: 131072 });
    let header = '';
    for (let i = 0; i < bytes.length; i += 8192) {
        header += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
    }
    return parseUSPatentNumberFromPDFHeader(header);
}
function googlePatentURL(number: string): string {
    return `https://patents.google.com/patent/${number}/en`;
}
function assertGooglePatentURL(value: string, number: string): void {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'patents.google.com' || url.username || url.password || url.port
        || url.pathname !== `/patent/${number}/en`)
        throw new Error('Google Patents redirected outside the expected patent detail page');
}
function answeredRefusal(message: string): Error {
    return Object.assign(new Error(message), { answered: true });
}
async function translatePatent(number: string): Promise<any> {
    await Zotero.Translators.init();
    const translator = Zotero.Translators.get(GOOGLE_PATENTS_TRANSLATOR_ID);
    if (!translator)
        throw new Error('Zotero Google Patents translator is unavailable');
    const url = googlePatentURL(number);
    let response: any;
    try {
        response = await Zotero.HTTP.request('GET', url, { timeout: 20000 });
    }
    catch (cause) {
        const status = Number((cause as any)?.status || (cause as any)?.xmlhttp?.status || 0);
        if (status >= 400 && status < 500)
            throw answeredRefusal(`Google Patents has no page for ${number} (HTTP ${status})`);
        throw cause;
    }
    const finalURL = response.responseURL || url;
    try {
        assertGooglePatentURL(finalURL, number);
    }
    catch (cause) {
        throw answeredRefusal(String((cause as any)?.message || cause));
    }
    const Parser = Zotero.getMainWindow().DOMParser;
    const parsed = new Parser().parseFromString(response.responseText, 'text/html');
    const doc = Zotero.Translate.DOMWrapper.wrap(parsed, {
        documentURI: finalURL, URL: finalURL,
        location: new Zotero.HTTP.Location(Services.io.newURI(finalURL)), cookie: ''
    });
    const translate = new Zotero.Translate.Web();
    translate.setDocument(doc);
    translate.setTranslator(translator);
    const items = await translate.translate({ libraryID: false, saveAttachments: false });
    if (items.length !== 1 || items[0].itemType !== 'patent' || !items[0].title)
        throw answeredRefusal('Google Patents translator returned no patent metadata');
    if (normalizePatentNumber(items[0].patentNumber) !== number)
        throw answeredRefusal('Returned patent number does not match the PDF embedded identifier');
    return items[0];
}
export async function recognizeUSPatent(parent: any, attachment: any, before: MetadataSnapshot, knownNumber?: string | null): Promise<RecognitionResult | null> {
    const number = knownNumber === undefined ? await readEmbeddedUSPatentNumber(attachment) : knownNumber;
    if (!number)
        return null;
    debug(`item=${parent.key} pdf=${attachment?.key} US patent identifier ${knownNumber === undefined ? 'read from PDF Info Title' : 'printed in the document'}: ${number}`);
    const json = await translatePatent(number);
    assertIdentityUnchanged(before.identity, await captureIdentity(parent));
    const candidate = new Zotero.Item('patent');
    candidate.libraryID = parent.libraryID;
    const allowed = ['title', 'abstractNote', 'patentNumber', 'applicationNumber', 'filingDate', 'issueDate', 'assignee', 'country', 'issuingAuthority', 'language', 'url', 'legalStatus'];
    json.patentNumber = number;
    json.country = json.country || 'US';
    json.issuingAuthority = json.issuingAuthority || 'United States Patent and Trademark Office';
    json.url = googlePatentURL(number);
    json.libraryCatalog = 'Google Patents (Zotero translator)';
    allowed.push('libraryCatalog');
    for (const field of allowed) {
        const value = json[field];
        const id = Zotero.ItemFields.getID(field);
        if (id && Zotero.ItemFields.isValidForType(id, candidate.itemTypeID) && typeof value === 'string' && value.trim())
            candidate.setField(id, value.trim());
    }
    const inventors = (json.creators || []).filter((creator: any) => creator.creatorType === 'inventor')
        .map((creator: any) => ({ ...creator, creatorType: 'inventor' }));
    candidate.setCreators(inventors);
    const fields: Record<string, string> = {};
    for (const id of Zotero.ItemFields.getItemTypeFields(candidate.itemTypeID)) {
        const value = candidate.getField(id);
        if (value)
            fields[Zotero.ItemFields.getName(id)] = value;
    }
    const metadata: MetadataSnapshot = { ...before, itemTypeID: candidate.itemTypeID, itemType: 'patent', fields, creators: candidate.getCreators() };
    debug(`item=${parent.key} pdf=${attachment.key} US patent translated; publication=${number}; title=${fields.title || ''}`);
    return { source: null, metadata, changes: buildDiff(before, metadata, true) };
}

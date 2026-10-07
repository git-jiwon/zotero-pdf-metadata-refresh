const EVERY_TYPE = ['title', 'abstractNote', 'date', 'language', 'shortTitle', 'url',
    'accessDate', 'archive', 'archiveLocation', 'libraryCatalog', 'callNumber', 'rights', 'extra'];
export const FIELDS_BY_TYPE: Record<string, string[]> = {
    journalArticle: ['publicationTitle', 'volume', 'issue', 'pages', 'series', 'seriesTitle',
        'seriesText', 'journalAbbreviation', 'DOI', 'ISSN'],
    magazineArticle: ['publicationTitle', 'volume', 'issue', 'pages', 'ISSN'],
    newspaperArticle: ['publicationTitle', 'place', 'edition', 'section', 'pages', 'ISSN'],
    book: ['series', 'seriesNumber', 'volume', 'numberOfVolumes', 'edition', 'place',
        'publisher', 'numPages', 'ISBN'],
    bookSection: ['bookTitle', 'series', 'seriesNumber', 'volume', 'numberOfVolumes', 'edition',
        'place', 'publisher', 'pages', 'ISBN'],
    thesis: ['thesisType', 'university', 'place', 'numPages'],
    report: ['reportNumber', 'reportType', 'seriesTitle', 'place', 'institution', 'pages'],
    manuscript: ['manuscriptType', 'place', 'numPages'],
    document: ['publisher'],
    patent: ['place', 'country', 'assignee', 'issuingAuthority', 'patentNumber', 'filingDate',
        'pages', 'applicationNumber', 'priorityNumbers', 'issueDate', 'references', 'legalStatus'],
    conferencePaper: ['proceedingsTitle', 'conferenceName', 'place', 'publisher', 'volume',
        'pages', 'series', 'DOI', 'ISBN'],
    presentation: ['presentationType', 'place', 'meetingName'],
    webpage: ['websiteTitle', 'websiteType'],
    preprint: ['genre', 'repository', 'archiveID', 'place', 'DOI', 'citationKey'],
    standard: ['organization', 'committee', 'type', 'number', 'versionNumber', 'place', 'publisher', 'DOI'],
    dataset: ['identifier', 'type', 'versionNumber', 'repository', 'repositoryLocation', 'format', 'DOI', 'citationKey'],
    computerProgram: ['seriesTitle', 'versionNumber', 'place', 'company', 'programmingLanguage', 'system', 'ISBN'],
    blogPost: ['blogTitle', 'websiteType']
};
const NOT_A_FIELD = new Set(['creators', 'itemType']);
export const KIND_TO_TYPE: Record<string, {
    type: string;
    lossless: boolean;
    lost?: string;
}> = {
    journalArticle: { type: 'journalArticle', lossless: true },
    conferencePaper: { type: 'conferencePaper', lossless: true },
    thesis: { type: 'thesis', lossless: true },
    book: { type: 'book', lossless: true },
    bookSection: { type: 'bookSection', lossless: true },
    patent: { type: 'patent', lossless: true },
    preprint: { type: 'preprint', lossless: true },
    standard: { type: 'standard', lossless: true },
    report: { type: 'report', lossless: true },
    document: { type: 'document', lossless: true },
    manuscript: { type: 'manuscript', lossless: true },
    governmentReport: { type: 'report', lossless: false, lost: 'that the issuer is a government body' },
    technicalReport: { type: 'report', lossless: false, lost: 'that it is a technical report' },
    datasheet: { type: 'report', lossless: false, lost: 'that it is a product datasheet' },
    manual: { type: 'report', lossless: false, lost: 'that it is a manual' }
};
export function toStoredType(kind: string): string {
    const mapped = KIND_TO_TYPE[kind];
    if (mapped)
        return mapped.type;
    return FIELDS_BY_TYPE[kind] ? kind : 'document';
}
export function storableType(name: unknown): string {
    const stated = String(name ?? '').trim();
    const mapped = KIND_TO_TYPE[stated]?.type || stated;
    if (!mapped)
        return 'document';
    const types = (globalThis as {
        Zotero?: any;
    }).Zotero?.ItemTypes;
    if (typeof types?.getID === 'function') {
        try {
            return types.getID(mapped) ? mapped : 'document';
        }
        catch { }
    }
    return toStoredType(mapped);
}
export function validForType(field: string, itemType: string): boolean {
    if (NOT_A_FIELD.has(field))
        return true;
    const live = liveAnswer(field, itemType);
    if (live !== null)
        return live;
    const own = FIELDS_BY_TYPE[itemType];
    if (!own)
        return false;
    return EVERY_TYPE.includes(field) || own.includes(field);
}
export function validForTypeID(field: string, itemTypeID: unknown): boolean {
    const zotero = (globalThis as {
        Zotero?: any;
    }).Zotero;
    try {
        const fieldID = zotero?.ItemFields?.getID?.(field);
        if (fieldID && itemTypeID !== undefined && itemTypeID !== null) {
            return !!zotero.ItemFields.isValidForType(fieldID, itemTypeID);
        }
        const name = zotero?.ItemTypes?.getName?.(itemTypeID);
        if (typeof name === 'string' && name)
            return validForType(field, name);
    }
    catch { }
    return false;
}
function liveAnswer(field: string, itemType: string): boolean | null {
    const zotero = (globalThis as {
        Zotero?: any;
    }).Zotero;
    const fields = zotero?.ItemFields;
    const types = zotero?.ItemTypes;
    if (!fields?.getID || !fields?.isValidForType || !types?.getID)
        return null;
    try {
        const fieldID = fields.getID(field);
        const typeID = types.getID(itemType);
        if (!fieldID || !typeID)
            return null;
        const answer = fields.isValidForType(fieldID, typeID);
        if (answer === true && fields.getID('notAFieldAtAll'))
            return null;
        return !!answer;
    }
    catch {
        return null;
    }
}
export function keepValidFields<T extends Record<string, unknown>>(fields: T, itemType: string): {
    kept: Partial<T>;
    dropped: Array<{
        field: string;
        value: unknown;
    }>;
} {
    const kept: Record<string, unknown> = {};
    const dropped: Array<{
        field: string;
        value: unknown;
    }> = [];
    for (const [field, value] of Object.entries(fields)) {
        if (validForType(field, itemType))
            kept[field] = value;
        else
            dropped.push({ field, value });
    }
    return { kept: kept as Partial<T>, dropped };
}

import { getPublicPage } from '../utils/http';
import { crossrefWorkByDOI, openLibraryByISBN, snapshotFrom } from './international-catalog';
import { koreanRecordPerson } from '../metadata/korean-fields';
import { personParts } from '../metadata/person-name';
import type { MetadataSnapshot } from '../types';
import { validISBN } from '../metadata/identifier-compare';
import { providerFor, translateKoreanPage } from './korean';
const ENTITIES: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…'
};
function decodeEntities(value: string): string {
    return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
        if (body[0] === '#') {
            const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
            return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
        }
        return ENTITIES[body.toLowerCase()] ?? whole;
    });
}
const clean = (value: unknown) => decodeEntities(String(value ?? '')).replace(/\s+/g, ' ').trim();
function attribute(tag: string, name: string): string {
    const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
    return match ? clean(match[1] ?? match[2] ?? match[3] ?? '') : '';
}
export function metaTags(html: string): Map<string, string[]> {
    const tags = new Map<string, string[]>();
    const add = (key: string, content: string) => tags.set(key, [...(tags.get(key) || []), content]);
    for (const [tag] of String(html || '').matchAll(/<meta\b[^>]*>/gi)) {
        const key = (attribute(tag, 'name') || attribute(tag, 'property') || attribute(tag, 'http-equiv')).toLowerCase();
        const content = attribute(tag, 'content');
        if (!key || !content)
            continue;
        add(key, content);
        const scheme = attribute(tag, 'scheme').toLowerCase();
        if (scheme)
            add(`${key}@${scheme}`, content);
    }
    return tags;
}
export function stripCatalogueLabel(title: unknown): string {
    const value = clean(title);
    const match = value.match(/^[[〔【]\s*([\p{L}\s·.]{1,12})\s*[\]〕】]\s*(\p{L}[\s\S]*)$/u);
    return match && match[2].length >= 8 ? match[2].trim() : value;
}
const CREDIT_ROLES: Array<[
    RegExp,
    string
]> = [
    [/\s*(?:옮김|번역|역자|역)$/, 'translator'],
    [/\s*(?:엮음|편저|편집|엮은이|편)$/, 'editor'],
    [/\s*(?:그림|삽화|사진)$/, 'illustrator'],
    [/\s*(?:지음|저자|글|저)$/, 'author']
];
export function splitCreditLine(value: unknown): string[] {
    const line = clean(value);
    if (!line)
        return [];
    return line.includes('/') ? line.split('/').map(part => part.trim()).filter(Boolean) : [line];
}
export function roleFromCredit(value: unknown): {
    name: string;
    creatorType?: string;
} {
    const name = clean(value);
    for (const [marker, role] of CREDIT_ROLES) {
        if (marker.test(name)) {
            const stripped = name.replace(marker, '').trim();
            if (stripped)
                return { name: stripped, creatorType: role };
        }
    }
    return { name };
}
export function personFromDisplayName(value: unknown): WebPerson | null {
    const credit = roleFromCredit(clean(value).replace(/^(?:by|written by)\s*[:：]?\s*/i, ''));
    let name = credit.name;
    if (/^https?:\/\//i.test(name))
        return null;
    if (!name || name.length > 120)
        return null;
    const unbracketed = name.replace(/\s*[（(][^()（）]*[)）]\s*$/, '').trim();
    if (unbracketed !== name && /^[가-힣\s]+$/.test(unbracketed))
        name = unbracketed;
    if (/^[가-힣]+(?:\s[가-힣]+)*$/.test(name)) {
        const person = koreanRecordPerson(name);
        const role = credit.creatorType ? { creatorType: credit.creatorType } : {};
        if (!person)
            return null;
        return person.firstName ? { firstName: person.firstName, lastName: person.lastName, ...role } : { lastName: person.lastName, ...role };
    }
    const comma = name.indexOf(',');
    if (comma > 0) {
        const lastName = name.slice(0, comma).trim(), firstName = name.slice(comma + 1).trim();
        const role = credit.creatorType ? { creatorType: credit.creatorType } : {};
        return lastName ? (firstName ? { firstName, lastName, ...role } : { lastName, ...role }) : null;
    }
    const role = credit.creatorType ? { creatorType: credit.creatorType } : {};
    if (!name.includes(' '))
        return { lastName: name, ...role };
    if (!/^[\p{Script=Latin}\s.'-]+$/u.test(name))
        return { lastName: name, ...role };
    const modelled = personParts(name);
    if (modelled && modelled.fieldMode === 0 && modelled.lastName && modelled.firstName)
        return { firstName: modelled.firstName, lastName: modelled.lastName, ...role };
    const parts = name.split(' ').filter(Boolean);
    const lastName = parts.pop() as string;
    return parts.length ? { firstName: parts.join(' '), lastName, ...role } : { lastName, ...role };
}
export interface WebPerson {
    firstName?: string;
    lastName: string;
    creatorType?: string;
}
export interface WebCitation {
    itemType: string;
    fields: Record<string, string>;
    creators: WebPerson[];
    standard: 'citation' | 'json-ld' | 'dublin-core' | 'page';
    standards?: string[];
}
const first = (tags: Map<string, string[]>, ...names: string[]): string => {
    for (const name of names) {
        const value = tags.get(name)?.[0];
        if (value)
            return clean(value);
    }
    return '';
};
const all = (tags: Map<string, string[]>, ...names: string[]): string[] => names.flatMap(name => tags.get(name) || []).flatMap(value => clean(value).split(/\s*;\s*/)).filter(Boolean);
const people = (values: string[]) => values.flatMap(splitCreditLine).map(personFromDisplayName).filter(Boolean) as WebPerson[];
const hasAny = (fields: Record<string, string>) => Object.values(fields).some(Boolean);
function splitPatentNumber(value: string): {
    country: string;
    number: string;
} {
    const match = value.match(/^([A-Z]{2})\s*[:\s-]\s*(.+)$/);
    return match ? { country: match[1], number: match[2].trim() } : { country: '', number: value };
}
function typeFromCitation(tags: Map<string, string[]>): string {
    if (first(tags, 'citation_patent_number', 'citation_patent_application_number'))
        return 'patent';
    if (first(tags, 'citation_dissertation_institution', 'citation_dissertation_name'))
        return 'thesis';
    if (first(tags, 'citation_technical_report_number', 'citation_technical_report_institution'))
        return 'report';
    if (first(tags, 'citation_conference_title', 'citation_conference'))
        return 'conferencePaper';
    if (first(tags, 'citation_inbook_title'))
        return 'bookSection';
    if (first(tags, 'citation_journal_title', 'citation_journal_abbrev'))
        return 'journalArticle';
    if (first(tags, 'citation_isbn', 'citation_book_title'))
        return 'book';
    return '';
}
function fromCitationTags(tags: Map<string, string[]>): WebCitation | null {
    const firstPage = first(tags, 'citation_firstpage'), lastPage = first(tags, 'citation_lastpage');
    const doi = first(tags, 'citation_doi').replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, '');
    const patent = splitPatentNumber(first(tags, 'citation_patent_number'));
    const application = splitPatentNumber(first(tags, 'citation_patent_application_number'));
    const fields: Record<string, string> = {
        title: stripCatalogueLabel(first(tags, 'citation_title')),
        publicationTitle: first(tags, 'citation_journal_title', 'citation_journal_abbrev'),
        bookTitle: first(tags, 'citation_inbook_title', 'citation_book_title'),
        proceedingsTitle: first(tags, 'citation_conference_title', 'citation_conference'),
        volume: first(tags, 'citation_volume'),
        issue: first(tags, 'citation_issue'),
        pages: firstPage && lastPage && firstPage !== lastPage ? `${firstPage}-${lastPage}` : firstPage,
        date: first(tags, 'citation_publication_date', 'citation_date', 'citation_online_date', 'citation_cover_date'),
        DOI: doi,
        ISBN: first(tags, 'citation_isbn'),
        ISSN: first(tags, 'citation_issn'),
        publisher: first(tags, 'citation_publisher', 'citation_technical_report_institution', 'citation_dissertation_institution'),
        university: first(tags, 'citation_dissertation_institution'),
        institution: first(tags, 'citation_technical_report_institution'),
        reportNumber: first(tags, 'citation_technical_report_number'),
        patentNumber: patent.number,
        applicationNumber: application.number,
        country: patent.country || application.country,
        abstractNote: first(tags, 'citation_abstract'),
        language: first(tags, 'citation_language'),
        url: first(tags, 'citation_abstract_html_url', 'citation_public_url', 'citation_fulltext_html_url')
    };
    if (!hasAny(fields))
        return null;
    return { itemType: typeFromCitation(tags), standard: 'citation', creators: people(all(tags, 'citation_author', 'citation_authors')), fields };
}
export function ldValue(value: any): string {
    if (value === null || value === undefined)
        return '';
    if (Array.isArray(value)) {
        for (const entry of value) {
            const found = ldValue(entry);
            if (found)
                return found;
        }
        return '';
    }
    if (typeof value === 'object')
        return ldValue(value['@value'] ?? value.name ?? value['foaf:name'] ?? value.notation ?? value.title ?? '');
    return clean(value);
}
export function ldPick(node: any, ...names: string[]): any {
    if (!node || typeof node !== 'object')
        return undefined;
    for (const name of names) {
        for (const key of Object.keys(node)) {
            if ((key === name || key.replace(/^[^:]+:/, '') === name) && node[key] !== null && node[key] !== undefined)
                return node[key];
        }
    }
    return undefined;
}
export function ldIdentifier(node: any, kind: string): string {
    const entries = [ldPick(node, 'productIdentifier', 'identifier', 'identifiers')].flat().filter(Boolean) as any[];
    for (const entry of entries) {
        const inner = (entry && typeof entry === 'object' && 'identifier' in entry) ? (entry as any).identifier : entry;
        const stated = String(ldPick(inner, '@type', 'type', 'propertyID') ?? '').toLowerCase();
        const value = ldValue(inner);
        if (stated.includes(kind.toLowerCase()) && value)
            return value;
    }
    return '';
}
const JSON_LD_TYPES: Record<string, string> = {
    scholarlyarticle: 'journalArticle', article: 'journalArticle', newsarticle: 'newspaperArticle',
    report: 'report', thesis: 'thesis', book: 'book', chapter: 'bookSection', dataset: 'dataset',
    publicationissue: 'journalArticle', creativework: '',
    webpage: '', itempage: '', collectionpage: '', aboutpage: ''
};
function ldNodes(parsed: any): any[] {
    const roots = Array.isArray(parsed) ? parsed : [parsed];
    return roots.flatMap(root => [root, ...(Array.isArray(root?.['@graph']) ? root['@graph'] : [])]).filter(Boolean);
}
export function fromLinkedRecord(node: any): WebCitation | null {
    const types = [ldPick(node, '@type', 'type')].flat().filter(Boolean).map((value: unknown) => String(value).toLowerCase());
    const resourceType = String(ldValue(ldPick(node, 'resourceType')) || '').toLowerCase();
    const known = types.find(type => type in JSON_LD_TYPES)
        || Object.keys(JSON_LD_TYPES).find(type => resourceType.includes(type));
    const title = stripCatalogueLabel(ldValue(ldPick(node, 'headline', 'title', 'titles', 'name')));
    if (!title)
        return null;
    const named = (value: any, role?: string) => [value].flat().filter(Boolean)
        .map((person: any) => ldValue(person))
        .flatMap((name: any) => people([name]).map(person => role ? { ...person, creatorType: person.creatorType || role } : person));
    const authors = [
        ...named(ldPick(node, 'author', 'creator', 'creators')),
        ...named(ldPick(node, 'translator'), 'translator'),
        ...named(ldPick(node, 'editor'), 'editor')
    ];
    const editions = [ldPick(node, 'workExample')].flat().filter(Boolean) as any[];
    const container = ldValue(ldPick(node, 'isPartOf')) || ldValue(ldPick(node, 'publication')) || ldValue(ldPick(node, 'journal'));
    const partOf = ldPick(node, 'isPartOf');
    return {
        itemType: known ? JSON_LD_TYPES[known] : '', standard: 'json-ld', creators: authors,
        fields: {
            title,
            publicationTitle: container,
            volume: ldValue(ldPick(node, 'volumeNumber')) || ldValue(ldPick(partOf, 'volumeNumber')),
            issue: ldValue(ldPick(node, 'issueNumber')) || ldValue(ldPick(partOf, 'issueNumber')),
            pages: ldValue(ldPick(node, 'pagination', 'pages'))
                || [ldValue(ldPick(node, 'pageStart')), ldValue(ldPick(node, 'pageEnd'))].filter(Boolean).join('-'),
            date: ldValue(ldPick(node, 'datePublished', 'dateCreated', 'issued', 'date'))
                || editions.map(edition => String(ldValue(ldPick(edition, 'datePublished')) || '').replace(/^((?:1[5-9]|20)\d{2})-01-01$/, '$1')).find(Boolean) || '',
            DOI: (ldValue(ldPick(node, 'doi')) || ldIdentifier(node, 'doi')).replace(/^doi:\s*/i, ''),
            ISBN: ldValue(ldPick(node, 'isbn')) || ldIdentifier(node, 'isbn') || editions.map(edition => ldValue(ldPick(edition, 'isbn'))).find(Boolean) || '',
            ISSN: ldValue(ldPick(node, 'issn')) || ldIdentifier(node, 'issn'),
            numPages: ldValue(ldPick(node, 'numberOfPages')) || editions.map(edition => ldValue(ldPick(edition, 'numberOfPages'))).find(Boolean) || '',
            edition: ldValue(ldPick(node, 'bookEdition')),
            publisher: ldValue(ldPick(node, 'publisher')),
            abstractNote: ldValue(ldPick(node, 'abstract', 'description')),
            language: ldValue(ldPick(node, 'inLanguage', 'language')),
            url: ldValue(ldPick(node, 'url'))
        }
    };
}
function fromJsonLd(html: string): WebCitation | null {
    for (const [, body] of String(html || '').matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        let parsed: any;
        try {
            parsed = JSON.parse(body.trim());
        }
        catch {
            continue;
        }
        for (const node of ldNodes(parsed)) {
            const types = [node?.['@type']].flat().filter(Boolean).map((value: unknown) => String(value).toLowerCase());
            if (!types.some(type => type in JSON_LD_TYPES))
                continue;
            const reading = fromLinkedRecord(node);
            if (reading)
                return reading;
        }
    }
    return null;
}
const DC_TYPES: Record<string, string> = {
    patent: 'patent', thesis: 'thesis', dissertation: 'thesis', book: 'book', report: 'report',
    dataset: 'dataset', image: 'artwork', map: 'map', software: 'computerProgram',
    'journal article': 'journalArticle', article: 'journalArticle', 'conference paper': 'conferencePaper'
};
function typeFromDublinCore(tags: Map<string, string[]>): string {
    const stated = first(tags, 'dc.type', 'dcterms.type').toLowerCase();
    if (!stated)
        return '';
    return DC_TYPES[stated] || Object.entries(DC_TYPES).find(([word]) => stated.includes(word))?.[1] || '';
}
function fromDublinCore(tags: Map<string, string[]>): WebCitation | null {
    const identifiers = all(tags, 'dc.identifier', 'dcterms.identifier');
    const contributors = all(tags, 'dc.contributor@inventor', 'dc.contributor@author', 'dc.contributor@creator');
    const fields: Record<string, string> = {
        title: stripCatalogueLabel(first(tags, 'dc.title', 'dcterms.title')),
        date: first(tags, 'dc.date', 'dcterms.issued', 'dcterms.date'),
        issueDate: first(tags, 'dc.date@issue', 'dc.date@issued'),
        filingDate: first(tags, 'dc.date@datesubmitted', 'dc.date@filing'),
        assignee: first(tags, 'dc.contributor@assignee'),
        publisher: first(tags, 'dc.publisher', 'dcterms.publisher'),
        abstractNote: first(tags, 'dc.description', 'dcterms.abstract'),
        language: first(tags, 'dc.language', 'dcterms.language'),
        DOI: clean(identifiers.find(value => /^(?:doi:)?10\.\d{4,9}\//i.test(value))).replace(/^doi:\s*/i, ''),
        ISBN: clean(identifiers.find(value => /^(?:urn:)?isbn[:\s]/i.test(value))).replace(/^(?:urn:)?isbn[:\s]*/i, '')
    };
    if (!hasAny(fields))
        return null;
    return {
        itemType: typeFromDublinCore(tags), standard: 'dublin-core',
        creators: people(contributors.length ? contributors : all(tags, 'dc.creator', 'dcterms.creator')),
        fields
    };
}
function fromOpenGraph(tags: Map<string, string[]>): WebCitation | null {
    const kind = first(tags, 'og:type').toLowerCase().replace(/^books?\./, '');
    const fields: Record<string, string> = {
        ISBN: first(tags, 'books:isbn', 'book:isbn') || isbnLike(first(tags, 'og:barcode')),
        date: first(tags, 'books:release_date', 'book:release_date')
    };
    const authors = people(all(tags, 'books:author', 'book:author', 'og:author', 'author'));
    if (kind !== 'book' && !hasAny(fields) && !authors.length)
        return null;
    return { itemType: kind === 'book' ? 'book' : '', standard: 'page', creators: authors, fields };
}
export function isValidISBN(value: unknown): string {
    return validISBN(value);
}
const isbnLike = (value: unknown) => isValidISBN(value);
export function isbnFromText(html: unknown): string {
    const text = String(html ?? '');
    for (const match of text.matchAll(/ISBN(?:[-\s]?1[03])?/gi)) {
        const from = (match.index ?? 0) + match[0].length;
        const window = clean(text.slice(from, from + 120).replace(/<[^>]*>/g, ' '));
        const number = window.match(/^[^0-9]{0,12}((?:97[89][\s-]?)?[\d][\d\s-]{8,15}[\dXx])/);
        const value = number ? isbnLike(number[1]) : '';
        if (value)
            return value;
    }
    return '';
}
export function cutAtSiteName(title: string, siteNames: string[]): string {
    const parts = title.split(/\s*[|·–—]\s*|:\s+/).map(part => part.trim()).filter(Boolean);
    if (parts.length < 2)
        return title;
    const names = siteNames.map(name => name.toLowerCase()).filter(Boolean);
    const at = parts.findIndex(part => names.some(name => {
        const value = part.toLowerCase();
        return value === name || value.startsWith(`${name}.`) || value.startsWith(`${name} `);
    }));
    return at > 0 ? parts.slice(0, at).join(': ') : title;
}
export function splitEnglishCredits(title: string): {
    title: string;
    publisher?: string;
    date?: string;
} {
    const match = title.match(/^(.{4,}?)\s+by\s+(.+?)(?:\s+published\s+by\s+(.+?))?\s*\((\d{4})\)\s*$/i);
    if (!match)
        return { title };
    return { title: match[1].trim(), publisher: match[3]?.trim(), date: match[4] };
}
function fromPageTitle(html: string, tags: Map<string, string[]>, url = ''): WebCitation | null {
    const heading = first(tags, 'og:title') || first(tags, 'title') || clean((String(html || '').match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i) || [])[1]);
    const host = String(url).replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
    const siteName = first(tags, 'og:site_name');
    const named = cutAtSiteName(heading, [siteName, host, host.split('.')[0]]);
    const key = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const labels = [siteName, ...host.split('.')].map(key).filter(label => label.length >= 4 && !/^(?:www\d?|com|org|net|edu|gov)$/.test(label));
    const namesSite = (tail: string) => { const value = key(tail); return value.length >= 3 && labels.some(label => value.includes(label) || label.includes(value)); };
    let trimmed = named.replace(/\s*\|\s*[^|]{1,40}$/, '').trim() || named;
    const dashed = trimmed.match(/^(.*\S)\s+[-–—]\s+(.{1,40})$/);
    if (dashed && namesSite(dashed[2]))
        trimmed = dashed[1].trim();
    const packed = trimmed.split('|').map(part => part.trim()).filter(Boolean);
    const packedTitle = stripCatalogueLabel(packed.length > 1 && packed[0].length >= 8 ? packed[0] : trimmed);
    const credits = packed.length > 2 ? people(packed.slice(1, -1)) : [];
    const english = splitEnglishCredits(packedTitle);
    const title = english.title;
    const fields: Record<string, string> = { title, ISBN: isbnFromText(html), publisher: english.publisher || '', date: english.date || '' };
    return title.length >= 4 ? { itemType: '', standard: 'page', creators: credits, fields } : null;
}
export function parseWebCitation(html: string, url = ''): WebCitation | null {
    const tags = metaTags(html);
    const readings = [fromCitationTags(tags), fromJsonLd(html), fromDublinCore(tags), fromOpenGraph(tags), fromPageTitle(html, tags, url)]
        .filter(Boolean) as WebCitation[];
    if (!readings.length)
        return null;
    const fields: Record<string, string> = {};
    for (const reading of readings) {
        for (const [field, value] of Object.entries(reading.fields))
            if (value && !fields[field])
                fields[field] = value;
    }
    if (!fields.title)
        return null;
    const withTitle = readings.find(reading => reading.fields.title) as WebCitation;
    return {
        itemType: readings.map(reading => reading.itemType).find(Boolean) || '',
        standard: withTitle.standard,
        standards: readings.map(reading => reading.standard),
        creators: readings.map(reading => reading.creators).find(list => list.length) || [],
        fields
    };
}
export function titleFromSlug(url: unknown): string {
    const path = String(url ?? '').replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0];
    const slug = path.split('/').filter(Boolean).pop() || '';
    const words = decodeURIComponent(slug).replace(/\.\w{2,5}$/, '').split(/[-_+]/).filter(Boolean);
    if (words.length < 3 || !words.every(word => /^[\p{L}\d][\p{L}\d'’]*$/u.test(word)))
        return '';
    if (!words.some(word => /^\p{L}{3,}$/u.test(word)))
        return '';
    const sentence = words.join(' ');
    return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
const DOI_PATTERN = /\b(10\.\d{4,9}\/[^\s"'<>]+)/i;
export function doiFromURL(url: unknown): string {
    const value = String(url ?? '');
    const match = value.match(/\b(10\.\d{4,9}\/[^\s"'<>?&#]+)/i);
    if (!match)
        return '';
    return match[1].replace(/\.(?:pdf|html?|xml|full|abstract|epub)$/i, '');
}
export function parseReference(input: unknown): {
    kind: 'doi' | 'isbn' | 'url';
    value: string;
} | null {
    const value = String(input ?? '').trim().replace(/[.,;]+$/, '');
    if (!value)
        return null;
    const isbn = isValidISBN(value.replace(/^isbn[-\s:]*(?:1[03][-\s:]*)?/i, ''));
    if (isbn)
        return { kind: 'isbn', value: isbn };
    const doiUrl = value.match(/^https?:\/\/(?:dx\.)?doi\.org\/(.+)$/i);
    if (doiUrl)
        return { kind: 'doi', value: decodeURIComponent(doiUrl[1]) };
    if (/^https?:\/\//i.test(value))
        return { kind: 'url', value };
    const bare = value.replace(/^doi:\s*/i, '');
    const doi = bare.match(DOI_PATTERN);
    if (doi && doi.index === 0)
        return { kind: 'doi', value: bare };
    if (/^[\w.-]+\.[a-z]{2,}\//i.test(value))
        return { kind: 'url', value: `https://${value}` };
    return null;
}
export interface ReferenceRecognition {
    metadata: MetadataSnapshot;
    evidence: string;
    authoritative?: boolean;
    identifier?: {
        kind: 'DOI' | 'ISBN';
        value: string;
    };
}
const STANDARD_LABELS: Record<string, string> = {
    citation: 'Highwire citation 메타태그', 'json-ld': 'schema.org JSON-LD', 'dublin-core': 'Dublin Core 메타태그', page: '페이지 제목'
};
async function linkedRecordAt(url: string): Promise<WebCitation | null> {
    if (/\.\w{2,5}($|\?)/.test(url) || url.includes('?'))
        return null;
    try {
        const response = await getPublicPage(`${url}.json`);
        const body = String(response?.responseText || '').trim();
        if (!body.startsWith('{') && !body.startsWith('['))
            return null;
        const parsed = JSON.parse(body);
        for (const node of ldNodes(parsed)) {
            const reading = fromLinkedRecord(node);
            if (reading)
                return reading;
        }
    }
    catch (cause) {
        Zotero.debug(`[PDF Metadata Refresh] no linked record at ${url}.json: ${String(cause)}`);
    }
    return null;
}
function fromAddress(url: string): WebCitation | null {
    const title = titleFromSlug(url);
    return title ? { itemType: '', standard: 'page', standards: ['page'], creators: [], fields: { title, url } } : null;
}
export function sharesWords(left: unknown, right: unknown): boolean {
    const words = (value: unknown) => new Set(String(value ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 3));
    const theirs = words(right);
    if (!theirs.size)
        return true;
    for (const word of words(left))
        if (theirs.has(word))
            return true;
    return false;
}
export async function recognizeFromWebPage(parent: any, before: MetadataSnapshot, url: string, cancelled: () => boolean = () => false): Promise<ReferenceRecognition | null> {
    let response: any;
    try {
        response = await getPublicPage(url);
    }
    catch (cause) {
        const fallback = fromAddress(url);
        if (!fallback)
            throw cause;
        Zotero.debug(`[PDF Metadata Refresh] page refused (${String(cause)}); using the address`);
        return {
            metadata: snapshotFrom(parent, before, before.itemType, fallback.fields, []),
            evidence: `페이지가 접근을 거부해 주소의 제목만 읽음 — ${String(url).replace(/^https?:\/\//, '').split('/')[0]}`
        };
    }
    const html = String(response?.responseText || '');
    let citation = parseWebCitation(html, url) || await linkedRecordAt(url) || fromAddress(url);
    if (!citation?.fields.title)
        return null;
    const address = fromAddress(url);
    const brief = citation.fields.title.split(/[^\p{L}\p{N}]+/u).filter(Boolean).length <= 4;
    if (address && citation.standards?.every(standard => standard === 'page') && brief && !sharesWords(citation.fields.title, address.fields.title)) {
        citation = address;
    }
    if (citation.standards?.every(standard => standard === 'page') && citation.fields.ISBN) {
        try {
            const book = await openLibraryByISBN(parent, before, citation.fields.ISBN, cancelled);
            if (book)
                return { metadata: book.metadata, evidence: `주소의 ISBN ${citation.fields.ISBN}로 OpenLibrary 기록 확인 — ${String(url).replace(/^https?:\/\//, '').split('/')[0]}` };
        }
        catch (cause) {
            Zotero.debug(`[PDF Metadata Refresh] ISBN lookup failed: ${String(cause)}`);
        }
    }
    const fields: Record<string, string> = { ...citation.fields };
    if (!fields.url)
        fields.url = url;
    const used = [...new Set(citation.standards || [citation.standard])].map(name => STANDARD_LABELS[name]).join(' + ');
    return {
        metadata: snapshotFrom(parent, before, citation.itemType || before.itemType, fields, citation.creators),
        evidence: `입력한 주소의 ${used}에서 서지정보를 읽음 — ${String(url).replace(/^https?:\/\//, '').split('/')[0]}`
    };
}
async function withUndamagedCharacters(parent: any, before: MetadataSnapshot, metadata: MetadataSnapshot, doi: string, cancelled: () => boolean): Promise<{
    metadata: MetadataSnapshot;
    note: string;
}> {
    const damaged = (value: unknown) => typeof value === 'string' && value.includes('�');
    const fields = Object.entries(metadata.fields || {}).filter(([, value]) => damaged(value)).map(([field]) => field);
    const people = (metadata.creators || []).some((person: any) => damaged(person?.lastName) || damaged(person?.firstName));
    if (!fields.length && !people)
        return { metadata, note: '' };
    let page: ReferenceRecognition | null = null;
    try {
        page = await recognizeFromWebPage(parent, before, `https://doi.org/${doi}`, cancelled);
    }
    catch {
        page = null;
    }
    if (!page?.metadata)
        return { metadata, note: ' — 깨진 글자(�)가 든 칸이 있습니다: 출판사 페이지를 읽지 못해 그대로 둡니다' };
    const pattern = (value: string) => new RegExp(`^${value.normalize('NFC').split('�').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.{1,2}')}$`, 'u');
    const fits = (broken: unknown, clean: unknown) => typeof clean === 'string' && !damaged(clean) && pattern(String(broken)).test(clean.normalize('NFC'));
    const repairedFields: Record<string, any> = { ...metadata.fields };
    const repaired: string[] = [];
    for (const field of fields) {
        const clean = page.metadata.fields?.[field];
        if (fits(repairedFields[field], clean)) {
            repairedFields[field] = clean;
            repaired.push(field);
        }
    }
    const creators = (metadata.creators || []).map((person: any) => {
        const match: any = ((page!.metadata.creators || []) as any[]).find((other: any) => fits(person?.lastName, other?.lastName) || (!damaged(person?.lastName) && person?.lastName === other?.lastName));
        if (!match)
            return person;
        const next = { ...person };
        if (damaged(person.lastName) && fits(person.lastName, match.lastName)) {
            next.lastName = match.lastName;
            repaired.push('creators');
        }
        if (damaged(person.firstName) && fits(person.firstName, match.firstName)) {
            next.firstName = match.firstName;
            repaired.push('creators');
        }
        return next;
    });
    return { metadata: { ...metadata, fields: repairedFields, creators },
        note: repaired.length ? ` — 깨진 글자(�)는 출판사 페이지의 글자로 고쳤습니다(${[...new Set(repaired)].join(', ')})` : ' — 깨진 글자(�)가 든 칸이 있습니다: 출판사 페이지와 맞지 않아 그대로 둡니다' };
}
export async function recognizeFromReference(parent: any, before: MetadataSnapshot, input: unknown, cancelled: () => boolean = () => false): Promise<ReferenceRecognition | null> {
    const reference = parseReference(input);
    if (!reference)
        throw new Error('링크(http…), DOI(10.****/…) 또는 ISBN을 입력하세요.');
    if (reference.kind === 'isbn') {
        const book = await openLibraryByISBN(parent, before, reference.value, cancelled);
        if (!book)
            throw new Error(`OpenLibrary에 ISBN ${reference.value} 기록이 없습니다. 국내 단행본은 등록되지 않은 경우가 많습니다.`);
        return { metadata: book.metadata, evidence: `입력한 ISBN ${reference.value}의 OpenLibrary 기록`, authoritative: true, identifier: { kind: 'ISBN', value: reference.value } };
    }
    if (reference.kind === 'doi') {
        const work = await crossrefWorkByDOI(parent, before, reference.value, cancelled);
        if (!work)
            throw new Error(`Crossref에 ${reference.value} 기록이 없습니다.`);
        const repaired = await withUndamagedCharacters(parent, before, work.metadata, reference.value, cancelled);
        return { metadata: repaired.metadata, evidence: `입력한 DOI ${reference.value}의 Crossref 기록${repaired.note}`, authoritative: true, identifier: { kind: 'DOI', value: reference.value } };
    }
    const embedded = doiFromURL(reference.value);
    if (embedded) {
        try {
            const work = await crossrefWorkByDOI(parent, before, embedded, cancelled);
            if (work) {
                const repaired = await withUndamagedCharacters(parent, before, work.metadata, embedded, cancelled);
                return { metadata: repaired.metadata, evidence: `주소에 포함된 DOI ${embedded}의 Crossref 기록${repaired.note}`, authoritative: true, identifier: { kind: 'DOI', value: embedded } };
            }
        }
        catch (cause) {
            Zotero.debug(`[PDF Metadata Refresh] DOI in URL not resolvable: ${String(cause)}`);
        }
    }
    let catalogue: {
        file: string;
    } | null = null;
    try {
        catalogue = providerFor(reference.value);
    }
    catch {
        catalogue = null;
    }
    if (catalogue) {
        if (cancelled())
            return null;
        const record = await translateKoreanPage(parent, reference.value, before);
        return { metadata: record.metadata, evidence: `입력한 ${catalogue.file} 상세 페이지의 기록`, authoritative: false };
    }
    return await recognizeFromWebPage(parent, before, reference.value, cancelled);
}

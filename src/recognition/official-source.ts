import { mergeFields, type LinkDecision, type LocalStanding } from '../restore/link';
import type { ExternalRecord } from '../restore/records';
import { registryPerson } from '../metadata/person-name';
const ENDPOINT = 'https://api.crossref.org/works/';
export interface CrossrefFetch {
    (url: string): Promise<{
        ok: boolean;
        status: number;
        json?: any;
        failure?: string;
    }>;
}
export interface BindingCheck {
    check: string;
    passed: boolean;
    detail: string;
}
export interface Binding {
    bound: boolean;
    reason: string;
    checks: BindingCheck[];
}
export interface BindingContext {
    identifier?: {
        kind: string;
        value: string;
        confidence: string;
        page?: number;
        pageRole?: string;
        cited?: boolean;
    } | null;
    titleRegion?: string;
    statedYears?: string[];
    identifierLine?: string;
}
const CITED_PAGE_ROLES = new Set(['references', 'contents']);
export function normaliseDOI(value: unknown): string {
    return String(value || '').trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
}
export function trimMessage(message: any): any {
    if (!message)
        return null;
    return {
        DOI: message.DOI, type: message.type,
        title: message.title, 'container-title': message['container-title'],
        volume: message.volume, issue: message.issue, page: message.page,
        'article-number': message['article-number'],
        issued: message.issued, published: message.published,
        'published-print': message['published-print'], 'published-online': message['published-online'],
        publisher: message.publisher, ISSN: message.ISSN, ISBN: message.ISBN,
        author: (message.author || []).map((entry: any) => ({ given: entry.given, family: entry.family, ...(entry.suffix ? { suffix: entry.suffix } : {}), sequence: entry.sequence })),
        'is-referenced-by-count': message['is-referenced-by-count']
    };
}
export async function crossrefWork(doi: unknown, fetchJSON: CrossrefFetch): Promise<any> {
    const clean = normaliseDOI(doi);
    if (!/^10\.\d{4,9}\//.test(clean))
        return { ok: false, reason: 'not a DOI', doi: clean };
    const started = Date.now();
    try {
        const response = await fetchJSON(ENDPOINT + encodeURIComponent(clean));
        return {
            ok: !!response.ok && !!response.json?.message,
            doi: clean,
            status: response.status ?? 0,
            failure: response.failure || (response.ok ? null : `HTTP ${response.status}`),
            ms: Date.now() - started,
            retrievedAt: new Date().toISOString(),
            endpoint: ENDPOINT + clean,
            message: response.json?.message ? trimMessage(response.json.message) : null
        };
    }
    catch (cause) {
        return { ok: false, doi: clean, status: 0, failure: String((cause as any)?.message || cause).slice(0, 160), ms: Date.now() - started, message: null };
    }
}
export function crossrefDate(message: any): {
    value: string;
    precision: string;
} | null {
    const source = message?.['published-print'] || message?.issued || message?.published || message?.['published-online'];
    const parts = source?.['date-parts']?.[0];
    if (!Array.isArray(parts) || !parts.length)
        return null;
    const number = (value: unknown) => typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,4}$/.test(value.trim()) ? Number(value) : NaN;
    const [year, month, day] = parts.map(number);
    if (!Number.isInteger(year) || year < 1000 || year > 9999)
        return null;
    const monthOK = Number.isInteger(month) && month >= 1 && month <= 12;
    if (monthOK && Number.isInteger(day) && day >= 1 && day <= 31)
        return { value: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, precision: 'day' };
    if (monthOK)
        return { value: `${year}-${String(month).padStart(2, '0')}`, precision: 'month' };
    return { value: String(year), precision: 'year' };
}
export function boundToDocument(message: any, documentText: string, titleSupportedByPDF: (title: string, text: string) => boolean, context: BindingContext = {}): Binding {
    const title = (message?.title || [])[0];
    if (!title)
        return { bound: false, reason: 'the record states no title to compare', checks: [] };
    if (!String(documentText || '').trim())
        return { bound: false, reason: 'no document text to compare against', checks: [] };
    const checks: BindingCheck[] = [];
    const note = (name: string, passed: boolean, detail: string) => { checks.push({ check: name, passed, detail }); return passed; };
    const identifier = context.identifier || null;
    const identifierIsOwn = !identifier
        ? note('identifierRole', false, 'no identifier reading was supplied')
        : note('identifierRole', identifier.confidence !== 'ambiguous' && !CITED_PAGE_ROLES.has(String(identifier.pageRole)) && !identifier.cited, `read on page ${identifier.page} (${identifier.pageRole || 'unknown role'}), confidence ${identifier.confidence}${identifier.cited ? ', inside a citation of another work' : ''}`);
    const titleRegion = String(context.titleRegion || '');
    const inTitleRegion = note('selfTitleRegion', !!titleRegion && titleSupportedByPDF(title, titleRegion), titleRegion ? 'compared against the title block and the page it came from' : 'no title region was supplied');
    const inDocument = note('titleAnywhere', titleSupportedByPDF(title, documentText), 'compared against every page that was read');
    const families = (message.author || []).map((entry: any) => String(entry.family || '')).filter((name: string) => name.length >= 2);
    const haystack = String(documentText).normalize('NFKC').toLowerCase();
    const named = families.filter((name: string) => haystack.includes(name.normalize('NFKC').toLowerCase()));
    const creatorsAgree = note('creatorAgreement', !families.length || named.length > 0, families.length ? `${named.length} of ${families.length} surnames appear in the pages read` : 'the record names no authors');
    const registryYear = Number(String(crossrefDate(message)?.value || '').slice(0, 4)) || null;
    const stated = (context.statedYears || []).map(Number).filter(Boolean);
    const yearBeside = !!registryYear && new RegExp(`(?<!\\d)${registryYear}(?!\\d)`).test(String(context.identifierLine || ''));
    const yearAgrees = note('scopeAndEdition', !registryYear || !stated.length || yearBeside || stated.some(year => Math.abs(year - registryYear) <= 1), registryYear ? `registry ${registryYear} against ${stated.join(', ') || 'no year stated on the front matter'}${yearBeside ? `; the line that prints the identifier states ${registryYear}` : ''}` : 'the record states no year');
    const bound = identifierIsOwn && yearAgrees && (inTitleRegion || (inDocument && creatorsAgree));
    const failed = checks.filter(entry => !entry.passed).map(entry => entry.check);
    return {
        bound,
        reason: bound
            ? `bound by ${checks.filter(entry => entry.passed).map(entry => entry.check).join(', ')}`
            : `not bound: ${failed.join(', ')} did not hold`,
        checks
    };
}
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const decodeEntities = (value: unknown): string => String(value ?? '')
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name) => ENTITIES[String(name).toLowerCase()])
    .replace(/&#(\d{1,6});/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/<\/?[a-z][^>]{0,40}>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
const PART_OF_A_VOLUME_TYPES = new Set(['proceedings-article', 'book-chapter', 'book-part', 'book-section', 'reference-entry', 'other']);
export function crossrefContainerOf(message: any): {
    container: string;
    series: string;
} {
    const titles = (Array.isArray(message?.['container-title']) ? message['container-title'] : [message?.['container-title']])
        .map((entry: unknown) => decodeEntities(entry)).filter(Boolean);
    const distinct = titles.filter((entry: string, at: number) => titles.findIndex((other: string) => other.toLowerCase() === entry.toLowerCase()) === at);
    if (distinct.length >= 2 && PART_OF_A_VOLUME_TYPES.has(String(message?.type || '').trim().toLowerCase())) {
        return { container: distinct[distinct.length - 1], series: distinct[0] };
    }
    return { container: distinct[0] || '', series: '' };
}
export function fieldsFromCrossref(message: any): Record<string, any> {
    const fields: Record<string, any> = {};
    const title = decodeEntities((message.title || [])[0]);
    if (title)
        fields.title = title;
    const { container, series } = crossrefContainerOf(message);
    if (container)
        fields.publicationTitle = container;
    if (series)
        fields.series = series;
    if (message.volume)
        fields.volume = String(message.volume);
    if (message.issue)
        fields.issue = String(message.issue);
    if (message.page)
        fields.pages = String(message.page);
    else if (message['article-number'])
        fields.pages = String(message['article-number']);
    if (message.publisher)
        fields.publisher = decodeEntities(message.publisher);
    if (message.DOI)
        fields.DOI = message.DOI;
    const date = crossrefDate(message);
    if (date)
        fields.date = date.value;
    const creators = (message.author || [])
        .filter((entry: any) => entry.family)
        .map((entry: any) => ({ ...(registryPerson(entry.given, entry.family, entry.suffix) || { lastName: String(entry.family), firstName: '' }), creatorType: 'author' }));
    if (creators.length)
        fields.creators = creators;
    return fields;
}
export function itemTypeFromCrossref(type: string): string | null {
    return ({
        'journal-article': 'journalArticle',
        'proceedings-article': 'conferencePaper',
        'book-chapter': 'bookSection',
        book: 'book',
        monograph: 'book',
        'edited-book': 'book',
        'reference-book': 'book',
        dissertation: 'thesis',
        report: 'report',
        'posted-content': 'preprint'
    } as Record<string, string>)[type] || null;
}
export function lostGlyphsOnly(pageValue: unknown, registryValue: unknown): boolean {
    const letters = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const page = letters(pageValue), registry = letters(registryValue);
    if (!page || !registry || page === registry)
        return false;
    if (registry.length <= page.length)
        return false;
    if (registry.length - page.length > 8)
        return false;
    let at = 0, run = 0, longest = 0, runs = 0, inRun = false;
    for (const character of registry) {
        if (at < page.length && character === page[at]) {
            at++;
            if (inRun) {
                longest = Math.max(longest, run);
                inRun = false;
                run = 0;
            }
            continue;
        }
        if (!inRun) {
            inRun = true;
            runs++;
        }
        run++;
    }
    if (inRun)
        longest = Math.max(longest, run);
    return at === page.length && runs <= 3 && longest <= 4;
}
export interface MergeContext {
    text?: string;
    ocr?: boolean;
    years?: string[];
}
export function recordFromBoundMessage(message: any, doi: string, candidateType: string | null): ExternalRecord {
    const stated = fieldsFromCrossref(message);
    const { title, creators, ...rest } = stated;
    const date = crossrefDate(message);
    const fields: Record<string, string> = {};
    for (const [field, value] of Object.entries(rest))
        if (value !== undefined && value !== null && value !== '')
            fields[field] = String(value);
    return {
        provider: 'crossref', url: `https://doi.org/${doi}`, retrievedAt: new Date().toISOString(), live: true, method: 'api',
        itemType: itemTypeFromCrossref(String(message?.type || '')) || candidateType || 'journalArticle',
        title: String(title || ''), creators: Array.isArray(creators) ? creators : [],
        date: date ? { value: date.value, precision: date.precision as 'year' | 'month' | 'day', role: message?.['published-print'] ? 'published-print' : 'issued' } : undefined,
        fields, identifiers: { DOI: String(doi).toLowerCase(), ISBN: [] },
        publicationStage: 'versionOfRecord', relations: { isPreprintOf: [], hasPreprint: [] }, form: 'unknown', pageType: 'registry record'
    };
}
export function mergeOfficial(candidate: any, message: any, binding: Binding, context: MergeContext = {}): string[] {
    const added: string[] = [];
    const doi = String(candidate.fields.DOI || message?.DOI || '');
    const record = recordFromBoundMessage(message, doi, candidate.itemType);
    const link: LinkDecision = {
        relation: 'sameEdition', identifierMatch: true, titleScore: 1, rule: binding.reason,
        evidence: binding.checks.filter(check => check.passed).map(check => `${check.check}: ${check.detail}`), conflicts: []
    };
    const local: LocalStanding = { text: context.text || '', ocr: !!context.ocr, years: context.years || [], sources: candidate.sources };
    const glyphRepair = candidate.sources.title?.glyphRisk && candidate.fields.title && record.title && lostGlyphsOnly(candidate.fields.title, record.title);
    const merged = mergeFields({ ...candidate.fields }, { record, link }, [], { local });
    if (glyphRepair && merged.fields.title !== record.title) {
        merged.fields.title = record.title;
        merged.corrections.push({ field: 'title', from: candidate.fields.title, to: record.title, reason: 'glyphs missing from the page: the font declares no character mapping', provider: 'crossref', url: record.url });
    }
    for (const [field, value] of Object.entries(merged.fields)) {
        const held = candidate.fields[field];
        const same = JSON.stringify(held ?? '') === JSON.stringify(value ?? '');
        if (same)
            continue;
        const correction = merged.corrections.find(entry => entry.field === field);
        candidate.fields[field] = value;
        candidate.sources[field] = { from: 'crossref', doi, bound: binding.reason, ...(correction ? { replaced: correction.from, reason: correction.reason } : {}) };
        added.push(correction ? `${field}(corrected)` : field);
    }
    candidate.corrections = merged.corrections;
    candidate.conflicts = merged.conflicts;
    candidate.mergeNotes = merged.notes;
    const registryType = itemTypeFromCrossref(message.type);
    if (registryType && registryType !== candidate.itemType) {
        if (candidate.itemType) {
            candidate.alternatives.itemType = [{ value: candidate.itemType, from: 'structure' },
                ...(candidate.alternatives.itemType || [])].slice(0, 3);
        }
        candidate.itemType = registryType;
        candidate.sources.itemType = { from: 'crossref', crossrefType: message.type, bound: binding.reason };
        added.push('itemType');
    }
    return added;
}

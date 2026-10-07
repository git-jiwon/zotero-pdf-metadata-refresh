import { bodyScriptOf, citationPages, citationStatement, dominantScript, editionStatements, folioRange, journalHeadStatement, normaliseEdition, organisationSpans, readDates, feeCodeISSN, readPageRanges, readRevisions, readVolumeIssue } from './roles';
import { documentPeople } from './byline';
import { agentRoleOf, personCreator, placeAgents, type AgentMention } from './agents';
import { DEGREE_LABEL_LATIN, DEGREE_LABEL_SOURCE, thesisTypeOf, } from './title-guards';
import { classifyDocument, documentEvidence, MINIMUM_TYPE_SCORE } from './classify';
import { toStoredType } from './item-fields';
import { documentTitle } from './title-block';
export { citedWorkEntry, labelledTitle, runningHead } from './title-block';
import { doiStandingsOf, insideCitedEntry, scanIdentifiers } from './pdf-identifiers';
import { agentMentionsOf, readStatements } from './statements';
import { EDITION_ORDINAL } from './imprint-marks';
import { withAttachedAccents } from './text-encoding';
import { pageDegraded } from './zotero-pages';
import { footerIssuerOf, imprintNumber, labelledNumber, legacyRole, otherWorksSpansIn, regionsOf, runningDate, runningKeys, stampRowsIn, statesTheWork, structureFromPageObservations, textOf, withoutStatus } from './page-structure';
const ORDINAL_HEAD = new RegExp(String.raw `^(${EDITION_ORDINAL})[^\S\n]+[A-Za-z][^\n]*[^\S\n]edition$`, 'i');
export interface PageObservation {
    page: number;
    text: string;
    layout?: string;
    pageRole?: string;
    pageCount?: number;
    degraded?: boolean;
    glyphRisk?: boolean;
    truncated?: boolean;
    kind?: 'pdfText' | 'ocrText';
    lineHeights?: number[];
    encodingShift?: number;
    inserted?: boolean;
    afterLeaves?: boolean;
    size?: {
        width: number;
        height: number;
    };
}
export interface Candidate {
    itemType: string | null;
    fields: Record<string, any>;
    sources: Record<string, any>;
    alternatives: Record<string, any>;
    identifiers: Array<{
        kind: string;
        value: string;
        confidence: string;
        page?: number;
    }>;
    korean: boolean;
    corrections?: unknown[];
    conflicts?: unknown[];
    mergeNotes?: string[];
}
const KOREAN = /[가-힯]/;
const DEGREE_LINE = new RegExp(`(?:${DEGREE_LABEL_SOURCE}|${DEGREE_LABEL_LATIN})`, 'i');
const DEGREE_SOUGHT = /\bfor\s+the\s+degree\s+of\s+(?:doctor|master)\b/i;
export const DATE_ROLE_MEANING: Readonly<Record<string, 'published' | 'aheadOfIssue' | 'making'>> = {
    publicationDate: 'published', copyrightDate: 'published', degreeDate: 'published',
    onlineDate: 'aheadOfIssue',
    receivedDate: 'making', acceptedDate: 'making', submissionDate: 'making'
};
export const datesThePublication = (role: unknown) => ['published', 'aheadOfIssue'].includes(DATE_ROLE_MEANING[String(role ?? '')]);
const AUTHOR_BEFORE_YEAR = /\p{Lu}[\p{L}'’-]+(?:[^\S\n]\p{Lu}[\p{L}'’-]+){0,2}(?:\s+(?:and|&)\s+\p{Lu}[\p{L}'’-]+(?:[^\S\n]\p{Lu}[\p{L}'’-]+){0,2}|\s+et\s+al\.?)?[^\S\n]*\([^\S\n]*$/u;
const AUTHOR_COMMA_YEAR = /[(;]\s*\p{Lu}[\p{L}'’-]+(?:[^\S\n]\p{Lu}[\p{L}'’-]+){0,2}(?:\s+(?:and|&)\s+\p{Lu}[\p{L}'’-]+(?:[^\S\n]\p{Lu}[\p{L}'’-]+){0,2}|\s+et\s+al\.?)?,\s*$/u;
function authorYearCitation(text: string, reading: {
    index: number;
    raw: string;
    role: unknown;
    precision: string;
}, depth = 0): boolean {
    if (reading.role || reading.precision !== 'year' || depth > AUTHOR_YEAR_LIST)
        return false;
    const after = text.slice(reading.index + reading.raw.length, reading.index + reading.raw.length + 6);
    if (!/^[a-z]?(?:\)(?:[^\S\n]*[,;.:]|[^\S\n]+\p{Ll})|[^\S\n]*[;,])/u.test(after))
        return false;
    const before = text.slice(Math.max(0, reading.index - 80), reading.index);
    if (AUTHOR_BEFORE_YEAR.test(before) || AUTHOR_COMMA_YEAR.test(before))
        return true;
    const listed = /((?:1[5-9]|20)\d{2})[a-z]?,\s*$/.exec(before);
    if (!listed)
        return false;
    const earlier = Math.max(0, reading.index - 80) + listed.index;
    return authorYearCitation(text, { index: earlier, raw: listed[1], role: null, precision: 'year' }, depth + 1);
}
function aloneOnItsRow(text: string, reading: {
    index: number;
    raw: string;
}): boolean {
    const back = text.slice(Math.max(0, reading.index - 40), reading.index);
    const breakBefore = back.lastIndexOf('\n');
    if (breakBefore < 0 && reading.index > 40)
        return false;
    const start = breakBefore < 0 ? 0 : reading.index - back.length + breakBefore + 1;
    const ahead = text.slice(reading.index, reading.index + reading.raw.length + 40);
    const breakAfter = ahead.indexOf('\n');
    if (breakAfter < 0 && reading.index + reading.raw.length + 40 < text.length)
        return false;
    const stop = breakAfter < 0 ? text.length : reading.index + breakAfter;
    const row = text.slice(start, stop);
    const at = row.indexOf(reading.raw);
    return at >= 0 && !/[\p{L}\p{N}]/u.test(row.slice(0, at) + row.slice(at + reading.raw.length));
}
const AUTHOR_YEAR_LIST = 6;
export const datesTheHistory = (role: unknown) => ['making', 'aheadOfIssue'].includes(DATE_ROLE_MEANING[String(role ?? '')]);
export function insideCitationOfAnotherWork(text: string, at: number): boolean {
    const page = String(text || '');
    const before = page.slice(Math.max(0, at - 260), at);
    const after = page.slice(at, at + 90);
    if (/(?:to\s+cite\s+this|cite\s+this|cite\s+as|how\s+to\s+cite|citation\s*:|please\s+cite|인용)/i.test(before))
        return false;
    const referenceShaped = /\bet\s+al\.|[A-Z][\p{L}'’-]+,\s+[A-Z]\.(?:\s*[A-Z]\.)?(?:,|\s+&|\s+and)\s/u.test(before);
    const yearBeside = /\(\s*(?:19|20)\d{2}\s*\)/.test(after.slice(0, 90)) || /\((?:19|20)\d{2}\)\.?\s*$/.test(before.trimEnd());
    return (referenceShaped && yearBeside) || insideCitedEntry(page, at);
}
export function onTemplateLine(text: unknown, at: number): boolean {
    const page = String(text ?? '').normalize('NFKC');
    const start = page.lastIndexOf('\n', at) + 1;
    const stop = page.indexOf('\n', at);
    const line = page.slice(start, stop < 0 ? page.length : stop);
    return /\b(?:1[5-9]|20)xx\b/i.test(line) || /\b10\.\d{4,9}\/x[0-9a-z]{0,12}x\b/i.test(line) || /\bJ(?:ournal)?\.?\s+Name\b/i.test(line);
}
const PRECISION_RANK: Record<string, number> = { year: 1, month: 2, day: 3 };
function looksLikeYear(value: unknown): boolean {
    return /^(?:1[4-9]|20)\d{2}$/.test(String(value ?? '').trim());
}
function plausiblePageRange(range: {
    start: string;
    end: string;
}): boolean {
    const start = Number(String(range.start).replace(/\D/g, ''));
    const end = Number(String(range.end).replace(/\D/g, ''));
    if (!start || !end)
        return false;
    if (end < start)
        return false;
    if (start > 9999 || end > 9999)
        return false;
    const yearish = (value: number) => value >= 1850 && value <= 2100;
    if (yearish(start) && yearish(end) && end - start <= 30)
        return false;
    if (end - start >= 1000)
        return false;
    return true;
}
export function splitName(name: unknown): Record<string, any> | null {
    return personCreator(name);
}
export const REQUIRED: Record<string, string[]> = {
    journalArticle: ['title', 'creators', 'date', 'publicationTitle'],
    thesis: ['title', 'creators', 'date', 'university'],
    report: ['title', 'date', 'institution'],
    book: ['title', 'creators', 'date', 'publisher'],
    bookSection: ['title', 'creators', 'date'],
    document: ['title', 'date'],
    manuscript: ['title', 'date'],
    patent: ['title', 'creators', 'date']
};
function layerWithAttachedAccents(observations: PageObservation[]): PageObservation[] {
    let changed = false;
    const repaired = (observations || []).map(entry => {
        if (!entry || entry.kind === 'ocrText')
            return entry;
        const text = withAttachedAccents(String(entry.text ?? ''));
        const layout = entry.layout === undefined ? undefined : withAttachedAccents(String(entry.layout));
        const stale = !!entry.degraded && !pageDegraded({ text });
        if (text === String(entry.text ?? '') && layout === entry.layout && !stale)
            return entry;
        changed = true;
        const { degraded, ...rest } = entry;
        return { ...rest, text, ...(layout !== undefined ? { layout } : {}), ...(degraded && !stale ? { degraded } : {}) };
    });
    return changed ? repaired : observations;
}
export function buildCandidate(observations: PageObservation[], options: {
    documentPages?: number | null;
} = {}): Candidate {
    observations = layerWithAttachedAccents(observations);
    const documentPages = Number(options.documentPages) > 0 ? Number(options.documentPages) : undefined;
    const pageStructure = structureFromPageObservations(observations, documentPages);
    const roleByPage = new Map(pageStructure.pages.map(entry => [entry.page, legacyRole(entry)]));
    const roleAt = (entry: {
        page?: number;
    }) => roleByPage.get(Number(entry.page)) || '';
    const byRole = (role: string) => observations.filter(entry => roleAt(entry) === role);
    const openingPage = pageStructure.opening.page;
    const openingEnd = openingPage === null ? 3 : pageStructure.opening.afterLeaves ? Math.max(3, openingPage + 2) : Math.max(3, openingPage + 1);
    const opening = observations.filter(entry => (entry.page ?? 99) <= openingEnd);
    const roled = [...byRole('cover'), ...byRole('titlePage'), ...byRole('platformCover'),
        ...byRole('submission'), ...byRole('approval'), ...byRole('colophon')];
    const front = [...new Set([...opening, ...roled])].sort((a, b) => (a.page ?? 0) - (b.page ?? 0));
    const readable = front.filter(entry => !entry.degraded && roleAt(entry) !== 'platformCover');
    const evidenceText = readable.map(entry => entry.text).join('\n\f\n');
    const numericText = (front.length ? front : observations.slice(0, 3)).map(entry => entry.text).join('\n\f\n');
    const everything = observations.map(entry => entry.text).join('\n\f\n');
    const sources: Record<string, any> = {};
    const fields: Record<string, any> = {};
    const alternatives: Record<string, any> = {};
    const inPageOrder = observations
        .filter(entry => !entry.degraded && roleAt(entry) !== 'platformCover')
        .sort((a, b) => (a.page ?? 0) - (b.page ?? 0))
        .map(entry => entry.text).join('\n\f\n');
    const ranked = classifyDocument(documentEvidence(inPageOrder || evidenceText));
    const best = ranked[0];
    const kind = best && best.score >= MINIMUM_TYPE_SCORE ? best.type : null;
    const itemType = kind ? toStoredType(kind) : null;
    if (kind) {
        sources.itemType = { from: 'structure', kind, score: Number(best.score.toFixed(2)), evidence: (best.evidence || []).slice(0, 4) };
        alternatives.itemType = ranked.slice(1, 3).map(entry => ({ value: toStoredType(entry.type), kind: entry.type, score: Number(entry.score.toFixed(2)) }));
    }
    const citation = citationStatement(evidenceText);
    const citationAt = citation ? evidenceText.indexOf(citation.raw) : -1;
    const citesAnotherWork = !!citation && citationAt >= 0 && insideCitationOfAnotherWork(evidenceText, citationAt + citation.raw.length);
    if (citation && citesAnotherWork)
        alternatives.citation = { raw: citation.raw.slice(0, 160), from: 'citedWork', doi: citation.doi || null };
    if (citation && !citesAnotherWork) {
        sources.citation = { from: 'citationStatement', raw: citation.raw.slice(0, 160) };
        fields.date = citation.year;
        sources.date = { from: 'citationStatement', precision: 'year', raw: citation.raw.slice(0, 120) };
        if (citation.journal) {
            fields.publicationTitle = citation.journal;
            sources.publicationTitle = { from: 'citationStatement' };
        }
        if (citation.journalAbbreviation) {
            fields.journalAbbreviation = citation.journalAbbreviation;
            sources.journalAbbreviation = { from: 'citationStatement' };
        }
        if (citation.volume) {
            fields.volume = citation.volume;
            sources.volume = { from: 'citationStatement' };
        }
        if (citation.issue) {
            fields.issue = citation.issue;
            sources.issue = { from: 'citationStatement' };
        }
        if (citation.pages) {
            fields.pages = citation.pages;
            sources.pages = { from: 'citationStatement' };
        }
        if (citation.doi) {
            fields.DOI = citation.doi;
            sources.DOI = { from: 'citationStatement' };
        }
    }
    const bodyPages = observations.filter(entry => !entry.degraded);
    const bodyScript = bodyScriptOf(bodyPages, { structure: pageStructure }) ?? bodyScriptOf(bodyPages, { withFormPages: true, structure: pageStructure });
    const runningHeads = runningKeys(pageStructure, ['runningHead', 'runningFoot', 'masthead']);
    const read = documentTitle(pageStructure, { bodyScript,
        order: observations.map(entry => ({ page: Number(entry.page), reading: entry.kind === 'ocrText' ? 'ocr' as const : 'layer' as const })) });
    if (read) {
        fields.title = read.title;
        sources.title = read.source;
    }
    const peopleRead = documentPeople({ title: fields.title, source: sources.title, readable, pageStructure, runningHeads, evidenceText, roleAt });
    const people: AgentMention[] = peopleRead.people;
    const confirmedByHead = peopleRead.confirmedByHead;
    if (peopleRead.affiliations.length)
        alternatives.affiliations = peopleRead.affiliations.slice(0, 4);
    if (peopleRead.emails.length)
        alternatives.emails = peopleRead.emails.slice(0, 4);
    const namesAnotherWork = (page: number) => !!pageStructure.pages.find(held => held.page === page)?.claim?.foreign.includes('otherEntries');
    const inImprint = (entry: PageObservation, index: number) => {
        const regions = regionsOf(pageStructure, Number(entry.page), ['imprint']).filter(region => region.basis === 'text');
        if (!regions.length || textOf(pageStructure, Number(entry.page)) !== String(entry.text ?? ''))
            return false;
        const row = (String(entry.text ?? '').normalize('NFKC').slice(0, index).match(/\n/g) || []).length;
        return regions.some(region => row >= region.rows[0] && row <= region.rows[1]);
    };
    const dates = readable.flatMap(entry => {
        const normalised = String(entry.text || '').normalize('NFKC');
        const listed = otherWorksSpansIn(normalised);
        const bearing = statesTheWork(pageStructure, Number(entry.page));
        return readDates(entry.text, { stampRows: stampRowsIn(pageStructure, Number(entry.page), String(entry.text || '')) })
            .filter(reading => !onTemplateLine(entry.text, reading.index) && !listed.some(([start, end]) => reading.index >= start && reading.index < end)
            && !authorYearCitation(normalised, reading))
            .map(reading => ({ ...reading, page: entry.page, pageRole: roleAt(entry),
            dateBearing: !namesAnotherWork(Number(entry.page)) && (bearing || inImprint(entry, reading.index)), alone: aloneOnItsRow(normalised, reading) }));
    });
    const editions = editionStatements(evidenceText);
    const thisEdition = editions.find(entry => entry.scope === 'thisEdition');
    const firstPublished = editions.find(entry => entry.scope === 'firstPublished');
    const finest = (list: any[]) => list.filter(entry => !entry.role)
        .sort((a, b) => PRECISION_RANK[b.precision] - PRECISION_RANK[a.precision])[0];
    const onFront = dates.filter(entry => entry.dateBearing);
    const productionRun = new Set(dates.filter(entry => datesTheHistory(entry.role)).map(entry => String(entry.role))).size >= 2;
    let published: any = dates.find(entry => entry.role === 'publicationDate' && !productionRun)
        || dates.find(entry => entry.role === 'degreeDate')
        || dates.find(entry => entry.role === 'submissionDate' && !productionRun);
    let head: any = null;
    if (!published) {
        head = runningDate(pageStructure);
        if (head)
            published = { value: head.value, precision: head.precision, raw: head.line, role: 'publicationDate' };
    }
    let scope: any = null;
    if (!published && thisEdition) {
        published = { value: thisEdition.year, precision: 'year', raw: thisEdition.raw, role: 'publicationDate' };
        scope = { edition: thisEdition.edition, firstPublished: firstPublished?.year ?? null };
    }
    const inTitle = (entry: any) => entry.precision === 'year' && !!fields.title && String(fields.title).includes(entry.raw);
    published = published || finest(onFront.filter(entry => !inTitle(entry))) || finest(onFront) || dates.find(entry => entry.role === 'revision')
        || dates.find(entry => entry.role === 'copyrightDate');
    if (published && !fields.date) {
        fields.date = published.value;
        sources.date = {
            from: scope ? 'editionStatement' : head ? 'runningHeadStatement' : published.role || (published.alone && published.dateBearing ? 'dateRowOnFrontMatter' : 'unlabelledOnFrontMatter'),
            precision: published.precision, raw: published.raw,
            ...(head ? { pages: head.pages } : {}), ...(scope || {})
        };
        alternatives.date = dates.filter(entry => entry !== published).slice(0, 4)
            .map(entry => ({ value: entry.value, role: entry.role, precision: entry.precision }));
    }
    const identifiers: any[] = [];
    for (const entry of observations) {
        const scan = scanIdentifiers({ text: entry.text, complete: !entry.truncated } as any);
        const advertisedIn = otherWorksSpansIn(entry.text);
        for (const found of scan.observations) {
            const advertised = advertisedIn.some(([start, end]) => found.at >= start && found.at < end);
            identifiers.push({ ...found, page: entry.page, pageRole: roleAt(entry), advertised, cited: advertised || insideCitationOfAnotherWork(entry.text, found.at) });
        }
    }
    const printedDOIs = identifiers.filter(entry => entry.kind === 'DOI' && entry.confidence !== 'ambiguous' && !entry.cited);
    const notOwnDOIs = new Set<string>();
    if (printedDOIs.length) {
        const pagesOf = (ocr: boolean) => observations.filter(entry => (entry.kind === 'ocrText') === ocr).map(entry => ({ page: Number(entry.page), text: String(entry.text || ''), complete: !entry.truncated }));
        const standings = [...doiStandingsOf(pagesOf(false), fields.title), ...doiStandingsOf(pagesOf(true), fields.title)];
        for (const entry of standings) {
            const key = entry.value.toLowerCase();
            const seats = standings.filter(other => other.value.toLowerCase() === key);
            if (seats.every(other => other.why === 'cited' || other.why === 'platform'))
                notOwnDOIs.add(key);
        }
    }
    const eligibleDOIs = printedDOIs.filter(entry => !notOwnDOIs.has(String(entry.value).toLowerCase()));
    const pagesPrinting = (value: string) => new Set(eligibleDOIs.filter(entry => String(entry.value).toLowerCase() === value.toLowerCase()).map(entry => entry.page)).size;
    const doi = [...eligibleDOIs].sort((a, b) => pagesPrinting(String(b.value)) - pagesPrinting(String(a.value)))[0];
    const citedDOIs = identifiers.filter(entry => entry.kind === 'DOI' && entry.cited);
    if (citedDOIs.length)
        alternatives.DOI = [...(alternatives.DOI || []), ...citedDOIs.slice(0, 3).map(entry => ({ value: entry.value, from: 'citedWork', page: entry.page }))];
    const isbn = identifiers.find(entry => entry.kind === 'ISBN' && entry.confidence !== 'ambiguous' && !entry.cited);
    if (doi && !fields.DOI) {
        fields.DOI = doi.value;
        sources.DOI = { from: 'printed', page: doi.page, confidence: doi.confidence };
    }
    if (isbn) {
        fields.ISBN = isbn.value;
        sources.ISBN = { from: 'printed', page: isbn.page, confidence: isbn.confidence };
    }
    const mentions: AgentMention[] = [...people];
    const lines = evidenceText.split('\n').map(line => line.trim()).filter(Boolean);
    const findLine = (pattern: RegExp) => lines.find(line => pattern.test(line));
    const statements = readStatements(pageStructure);
    for (const mention of agentMentionsOf(statements)) {
        mentions.push({ name: mention.name, role: mention.role as AgentMention['role'], method: mention.method, ...(mention.raw ? { raw: mention.raw } : {}) });
        if (mention.role === 'editor' && !sources.editors)
            sources.editors = { from: 'statementOfResponsibility', raw: String(mention.raw || '').slice(0, 100) };
    }
    for (const span of organisationSpans(evidenceText)) {
        const role = agentRoleOf(span.role);
        if (!role || role === 'copyrightHolder' || role === 'publisher' || role === 'issuingBody')
            continue;
        mentions.push({ name: span.raw, role, method: 'roleLabel', raw: span.raw.slice(0, 80) });
    }
    const coverPage = readable.find(entry => roleAt(entry) === 'cover' || roleAt(entry) === 'titlePage');
    const footer = coverPage ? footerIssuerOf(pageStructure, Number(coverPage.page)) : null;
    if (footer)
        mentions.push({ name: footer, role: 'issuingBody', method: 'coverFooter' });
    const placed = placeAgents(mentions);
    if (placed.fields.creators && !fields.creators) {
        fields.creators = placed.fields.creators;
        sources.creators = { ...placed.sources.creators, advisorsExcluded: (placed.aside.advisors || []).length,
            ...(confirmedByHead ? { confirmedBy: 'runningHead' } : {}) };
    }
    if (placed.fields.university && !fields.university) {
        fields.university = placed.fields.university;
        sources.university = placed.sources.university;
    }
    if (placed.fields.institution && !fields.institution) {
        fields.institution = placed.fields.institution;
        sources.institution = placed.sources.institution;
    }
    if (placed.fields.publisher && !fields.publisher) {
        fields.publisher = placed.fields.publisher;
        sources.publisher = placed.sources.publisher;
    }
    for (const [name, value] of Object.entries(placed.aside)) {
        if (name === 'copyrightHolder' && Array.isArray(value) && value.length > 1) {
            alternatives.copyrightHolder = value.slice(0, 1);
            alternatives.copyrightHolders = value;
            continue;
        }
        alternatives[name] = value;
    }
    if (placed.refused.length)
        sources.refused = placed.refused;
    const copyrightHolder = statements.statements.find(entry => entry.kind === 'rights' && entry.scope === 'thisEdition' && entry.names?.length);
    if (copyrightHolder)
        sources.copyrightHolder = { from: 'copyrightLine', raw: copyrightHolder.raw.slice(0, 120) };
    if (alternatives.editors && !sources.editors)
        sources.editors = { from: 'roleWord' };
    const degreeLine = findLine(DEGREE_LINE) || findLine(DEGREE_SOUGHT);
    if (degreeLine && !fields.thesisType) {
        const stated = degreeLine.match(DEGREE_LINE) || degreeLine.match(DEGREE_SOUGHT);
        const kind = thesisTypeOf(stated ? stated[0] : '');
        if (kind) {
            fields.thesisType = kind;
            sources.thesisType = { from: 'degreeLine', stated: (stated ? stated[0] : degreeLine).replace(/\s+/g, ' ').trim().slice(0, 40) };
        }
    }
    if (!fields.edition) {
        const stated = sources.title?.edition || statements.thisEdition.edition?.edition;
        if (stated) {
            const ordinalHead = ORDINAL_HEAD.exec(String(stated).trim());
            fields.edition = normaliseEdition(ordinalHead ? `${ordinalHead[1]} edition` : stated);
            sources.edition = { from: sources.title?.edition ? 'titleLineEdition' : 'statedEdition', stated: String(stated).trim() };
        }
    }
    if (!fields.reportNumber) {
        const labelled = evidenceText.match(/(?:(?:행정|정부)?\s*(?:간행물\s*)?발간\s*등록\s*번호)\s*[:：]?\s*(\d{2}-\d{7}-\d{6}-\d{2})/)
            || evidenceText.match(/(?:문서\s*번호|보고서\s*번호|report (?:no\.?|number)|document (?:no\.?|number)|part (?:no\.?|number))\s*[:：]?\s*([A-Z0-9][A-Z0-9._/-]{3,30})/i);
        const series = evidenceText.match(/\b((?:NIER|KIER|KISTEP|ETRI|KAERI|KIGAM)\s*(?:NO\.?\s*)?[A-Z]{0,3}[-]?\d{2,6}[-\d]*)\b/i)
            || evidenceText.match(/(?<![\d-])(\d{6}[A-Z]?-\d{2,4})(?![\d-])/);
        const generic = labelled ? null : numberUnderALabel(evidenceText);
        const coverEntry = readable.find(entry => roleAt(entry) === 'cover' || roleAt(entry) === 'titlePage');
        const imprinted = labelled || generic || series ? null : codeInTheCoverImprint(coverEntry?.text || '');
        const value = labelled?.[1] || generic || series?.[1] || imprinted;
        if (value) {
            fields.reportNumber = value.replace(/\s+/g, ' ').trim();
            sources.reportNumber = { from: labelled || generic ? 'numberLabel' : series ? 'seriesCode' : 'coverImprint' };
        }
    }
    if (!fields.reportType) {
        const genre = genreOfTheDocument(readable.filter(entry => (entry.page ?? 99) <= (readable[0]?.page ?? 1) + 2).map(entry => entry.text), fields.title);
        if (genre) {
            fields.reportType = genre.value;
            sources.reportType = { from: genre.from };
        }
    }
    if (!fields.numPages) {
        const extent = evidenceText.match(/\bpage\s*\d{1,4}\s*(?:of|\/)\s*(\d{1,4})\b/i);
        if (extent) {
            fields.numPages = extent[1];
            sources.numPages = { from: 'runningHeadExtent' };
        }
    }
    const headPage = readable.find(entry => entry.page === sources.title?.page) || readable[0];
    const journalHead = headPage ? journalHeadStatement(headPage.layout || headPage.text) : null;
    if (journalHead) {
        const stated = (field: keyof typeof journalHead.raw) => ({ from: 'journalHead', page: headPage!.page, raw: String(journalHead.raw[field] || '').slice(0, 120) });
        if (journalHead.journal && !fields.publicationTitle) {
            fields.publicationTitle = journalHead.journal;
            sources.publicationTitle = stated('journal');
        }
        if (journalHead.abbreviation && !fields.journalAbbreviation) {
            fields.journalAbbreviation = journalHead.abbreviation;
            sources.journalAbbreviation = stated('abbreviation');
        }
        if (journalHead.volume && Number(journalHead.volume) > 0 && !fields.volume) {
            fields.volume = journalHead.volume;
            sources.volume = stated('volume');
        }
        if (journalHead.issue && Number(journalHead.issue) > 0 && !fields.issue) {
            fields.issue = journalHead.issue;
            sources.issue = stated('issue');
        }
        if (journalHead.pages && !fields.pages) {
            const [start, end] = journalHead.pages.split('-');
            if (plausiblePageRange({ start, end })) {
                fields.pages = journalHead.pages;
                sources.pages = stated('pages');
            }
        }
        if (journalHead.issn.length && !fields.ISSN) {
            const feeOnly = !/ISSN/i.test(String(journalHead.raw.issn || '')) && !!feeCodeISSN(journalHead.raw.issn);
            fields.ISSN = journalHead.issn.join(', ');
            sources.ISSN = { ...stated('issn'), from: feeOnly ? 'feeCodeISSN' : 'labelledISSN' };
        }
        const guessed = /^unlabelled/.test(String(sources.date?.from || '')) && String(fields.date || '').slice(0, 4) !== journalHead.year;
        if (journalHead.year && (!fields.date || guessed)) {
            if (guessed)
                alternatives.date = [{ value: fields.date, role: null, precision: sources.date?.precision, from: sources.date?.from }, ...(alternatives.date || [])].slice(0, 5);
            fields.date = journalHead.year;
            sources.date = { ...stated('year'), precision: 'year' };
        }
    }
    const { volumes, issues } = readVolumeIssue(numericText);
    const locatorPage = readable.find(entry => statesTheWork(pageStructure, Number(entry.page)));
    const marked = readVolumeIssue(locatorPage ? (locatorPage.layout || locatorPage.text) : '');
    if (!fields.volume) {
        const stated = marked.volumes.find(value => Number(value) > 0);
        if (stated) {
            fields.volume = stated;
            sources.volume = { from: 'statedMarker', page: locatorPage?.page ?? null };
        }
        else if (volumes.length)
            alternatives.volume = volumes.slice(0, 3);
    }
    if (!fields.issue) {
        const stated = marked.issues.find(value => Number(value) > 0);
        if (stated) {
            fields.issue = stated;
            sources.issue = { from: 'statedMarker', page: locatorPage?.page ?? null };
        }
        else if (issues.length)
            alternatives.issue = issues.slice(0, 3);
    }
    const ranges = readPageRanges(numericText).filter(range => plausiblePageRange(range));
    if (!fields.pages) {
        const head = readable.map(entry => citationPages(entry.layout || entry.text)).find(Boolean);
        const folios = folioRange(observations, pageStructure);
        const statementPages = readable.filter(entry => statesTheWork(pageStructure, Number(entry.page)));
        const labelledText = statementPages.map(entry => entry.text).join('\n\f\n');
        const labelled = readPageRanges(labelledText).filter(range => plausiblePageRange(range))
            .find(range => /\b(?:pp?\.|pages?|페이지|쪽|면)\s*$/i
            .test(labelledText.slice(Math.max(0, range.index - 12), range.index)));
        if (head) {
            fields.pages = `${head.start}-${head.end}`;
            sources.pages = { from: 'runningHeadCitation', raw: head.raw.slice(0, 90) };
            if (folios) {
                sources.pages.folios = folios.start === head.start && folios.end === head.end
                    ? 'agree' : `${folios.start}-${folios.end}`;
            }
        }
        else if (folios) {
            fields.pages = `${folios.start}-${folios.end}`;
            sources.pages = { from: 'printedFolios', raw: folios.raw.slice(0, 110), extent: folios };
        }
        else if (labelled) {
            fields.pages = `${labelled.start}-${labelled.end}`;
            sources.pages = { from: 'labelledRange', raw: labelled.raw };
        }
    }
    if (!fields.pages && ranges.length) {
        alternatives.pages = ranges.slice(0, 3).map(range => `${range.start}-${range.end}`);
    }
    const revisions = readRevisions(numericText).filter(value => !looksLikeYear(value));
    if (revisions.length) {
        fields.versionNumber = revisions[0];
        sources.versionNumber = { from: 'statedMarker' };
    }
    const script = dominantScript(everything);
    if (script && script !== 'latin') {
        fields.language = script;
        sources.language = { from: 'script' };
    }
    else if (script === 'latin')
        sources.language = { from: 'script', abstain: 'latin script does not settle a language' };
    return {
        itemType, fields, sources, alternatives,
        identifiers: identifiers.map(entry => ({ kind: entry.kind, value: entry.value, confidence: entry.confidence, page: entry.page })),
        korean: KOREAN.test(evidenceText)
    };
}
const numberUnderALabel = (text: string) => { const value = labelledNumber(text); return value ? withoutStatus(value).value : null; };
const codeInTheCoverImprint = (text: string) => { const value = imprintNumber(text); return value ? withoutStatus(value).value : null; };
export function documentNumberOnPages(texts: string[]): {
    value: string;
    from: 'numberLabel' | 'coverImprint';
} | null {
    const labelled = numberUnderALabel(texts.join('\n\f\n'));
    if (labelled)
        return { value: labelled, from: 'numberLabel' };
    const imprinted = codeInTheCoverImprint(texts[0] || '');
    return imprinted ? { value: imprinted, from: 'coverImprint' } : null;
}
const GENRE_WORD = String.raw `(?:application\s+notes?|data\s*sheets?|(?:user(?:['’]s)?|reference|installation|programming|operating|operation|service|owner(?:['’]s)?|hardware|software|technical|quick\s+start)\s+(?:manual|guide)s?|technical\s+(?:note|report|bulletin)s?|product\s+brief|white\s*paper|design\s+(?:guide|note)s?|release\s+notes)`;
const GENRE_ROW = new RegExp(`^${GENRE_WORD}$`, 'i');
const GENRE_ENDING = new RegExp(`(${GENRE_WORD}(?:\\s*(?:&|and)\\s*${GENRE_WORD})*)$`, 'i');
const asPrinted = (value: string) => /\p{Ll}/u.test(value) ? value : value.toLowerCase().replace(/(^|[\s&])(\p{L})/gu, (_, gap, letter) => gap + letter.toUpperCase());
export function genreOfTheDocument(texts: string[], title: unknown): {
    value: string;
    from: string;
} | null {
    for (const text of texts) {
        for (const row of String(text || '').normalize('NFKC').split('\n')) {
            const value = row.replace(/\s+/g, ' ').trim();
            if (GENRE_ROW.test(value))
                return { value: asPrinted(value), from: 'genreRow' };
        }
    }
    const ending = GENRE_ENDING.exec(String(title ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim());
    return ending ? { value: asPrinted(ending[1]), from: 'titleGenre' } : null;
}

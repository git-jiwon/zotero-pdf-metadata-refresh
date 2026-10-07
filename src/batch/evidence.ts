import { doiStandingsOf, namesAsContainer, scanIdentifiers, sentenceShapedLine, titleSupportedByPDF, withoutContainerStatements, withoutRegions } from '../recognition/pdf-identifiers';
import { authorRegion, checkPageExtent, compact, countNames, dominantScript, journalHeadStatement, nameForms, organisationSpans, parseDateValue, readArticleNumbers, readDates, readPageRanges, readRevisions, readSinglePages, readVolumeIssue, readVolumeIssueStatements, type SemanticRole } from '../recognition/roles';
import { sameFile } from './cache';
import { isbnsIn, normalizedDOI, normalizedISBN } from '../metadata/identifier-compare';
import { printedName } from '../metadata/person-name';
import { isIssueStatement, looksLikeBodyProse, withoutGenreTag } from '../recognition/title-guards';
import { titleBlocksOf } from '../recognition/title-block';
import { bodyPages, pagesBehindABrokenWindow, readPageStructure, regionSpansIn, roleOf, rowsOf, runningTitles, withoutFurnitureLines, withoutRunningLines, type PageStructure, type StructureInput, type StructurePage } from '../recognition/page-structure';
import { readStatements, statedAs, statedOnlyAsSponsor, statesContainment, type FrontStatements } from '../recognition/statements';
import type { FieldChange, MetadataSnapshot } from '../types';
export type ObservationKind = 'pdfText' | 'pdfMetadata' | 'ocrText' | 'externalRecord' | 'userInput' | 'pdfLayout';
export interface Observation {
    id: string;
    kind: ObservationKind;
    locator: string;
    text: string;
    retrievedAt: number;
    truncated?: boolean;
}
export interface IdentityDecision {
    id: string;
    kind: 'DOI' | 'ISBN' | 'patentNumber' | 'url' | 'none';
    value: string;
    scope: 'work' | 'container' | 'part' | 'unknown';
    itemType: string;
    corroboration: 'printedInDocument' | 'titleMatchesDocument' | 'suppliedByUser' | 'none';
    decidedAt: number;
    policyVersion: string;
    recordFields?: Record<string, string>;
}
export interface LinkRecord {
    provider: string;
    url: string;
    retrievedAt: string;
    live: boolean;
    relation: 'sameEdition' | 'sameWork' | 'unknown' | 'conflict';
    rule: string;
    evidence: string[];
    stage: string;
    stated: Record<string, {
        value: string;
        role?: string;
        precision?: string;
    }>;
}
export interface EvidenceBundle {
    observations: Observation[];
    identity?: IdentityDecision;
    links?: LinkRecord[];
}
export const OBSERVATION_TEXT_LIMIT = 6000;
export function observation(kind: ObservationKind, locator: string, text: unknown, options: {
    truncated?: boolean;
    index?: number;
} = {}): Observation {
    const value = String(text || '');
    const limit = kind === 'pdfLayout' ? 60000 : OBSERVATION_TEXT_LIMIT;
    return {
        id: `${kind}:${options.index ?? 0}`,
        kind,
        locator,
        text: value.slice(0, limit),
        retrievedAt: Date.now(),
        truncated: options.truncated || value.length > limit
    };
}
export function documentText(evidence: EvidenceBundle | undefined): string {
    if (!evidence)
        return '';
    return evidence.observations
        .filter(entry => entry.kind === 'pdfText' || entry.kind === 'ocrText' || entry.kind === 'pdfMetadata')
        .map(entry => entry.text).join('\n');
}
export type VerificationLevel = 'verified' | 'sourceStated' | 'conflicting' | 'proposed' | 'unknown';
export type VerificationOutcome = 'supported' | 'conflicting' | 'unconfirmed';
function sameShapeDifferentCode(value: string, sheets: string): boolean {
    const codes = (source: string) => (source.match(/[A-Za-z0-9]+(?:[-x./][A-Za-z0-9]+)+/g) || [])
        .filter(token => /[A-Za-z]/.test(token) && /\d/.test(token) && token.length >= 5);
    const shape = (token: string) => token.toUpperCase().replace(/\d/g, '9');
    const mine = codes(String(value || ''));
    if (!mine.length)
        return false;
    const page = codes(String(sheets || ''));
    return mine.some(code => !page.includes(code) && page.some(other => other !== code && shape(other) === shape(code)));
}
export interface FieldVerification {
    field: string;
    level: VerificationLevel;
    value: string;
    valueType: 'string' | 'creators' | 'itemType';
    rule: string;
    outcome: VerificationOutcome;
    note: string;
    contradicted?: boolean;
    itemType: string;
    pdfFingerprint: string;
    identity?: string;
    identityScope?: IdentityDecision['scope'];
    observations: string[];
    policyVersion: string;
    checkedAt: number;
}
export function valueText(value: unknown): string {
    if (typeof value === 'string')
        return value;
    if (value === null || value === undefined)
        return '';
    return JSON.stringify(value);
}
function valueTypeOf(field: string): FieldVerification['valueType'] {
    return field === 'creators' ? 'creators' : field === 'itemType' ? 'itemType' : 'string';
}
const searchable = (value: unknown) => String(value || '').normalize('NFKC').toLowerCase()
    .replace(/<\/?(?:sub|sup|i|b)>/gi, '').replace(/[^\p{L}\p{N}]+/gu, '');
const plain = (value: unknown) => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function looseMatcher(value: unknown): RegExp | null {
    const words = String(value || '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    if (!words.length)
        return null;
    return new RegExp(words.map(escapeRegExp).join('[^\\p{L}\\p{N}]{0,4}'), 'u');
}
function appearsInDocument(value: unknown, text: string): boolean {
    const needle = searchable(value);
    if (needle.length < 4)
        return false;
    return searchable(text).includes(needle);
}
function tokenPresent(token: unknown, text: string): boolean {
    const value = String(token || '').trim();
    if (!value)
        return false;
    const matcher = looseMatcher(value);
    if (!matcher)
        return false;
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${matcher.source}(?:[^\\p{L}\\p{N}]|$)`, 'u').test(plain(text));
}
export interface RuleContext {
    field: string;
    value: string;
    change: FieldChange;
    recognized?: MetadataSnapshot;
    text: string;
    evidence?: EvidenceBundle;
    itemType: string;
    readings?: Record<string, any>;
}
export interface FieldRule {
    id: string;
    fields: (field: string) => boolean;
    judge: (context: RuleContext) => {
        outcome: VerificationOutcome;
        note: string;
        contradicted?: boolean;
        coarser?: boolean;
    };
}
export function evidencePages(evidence: EvidenceBundle | undefined): Array<{
    page: number;
    text: string;
}> {
    const pages: Array<{
        page: number;
        text: string;
    }> = [];
    for (const entry of evidence?.observations || []) {
        if (!DOCUMENT_KINDS.has(entry.kind))
            continue;
        const stated = Number((entry as any).page);
        const located = /page\s+(\d{1,4})\b/i.exec(String(entry.locator || ""));
        const page = Number.isInteger(stated) && stated > 0 ? stated : located ? Number(located[1]) : NaN;
        if (!Number.isInteger(page))
            continue;
        pages.push({ page, text: String(entry.text || "") });
    }
    return pages.sort((a, b) => a.page - b.page);
}
function titleBearingText(evidence: EvidenceBundle | undefined, fallback: string): string {
    const pageOf = (entry: any) => {
        const stated = Number(entry.page);
        if (Number.isInteger(stated) && stated > 0)
            return stated;
        const located = /page\s+(\d{1,4})\b/i.exec(String(entry.locator || ''));
        return located ? Number(located[1]) : NaN;
    };
    const inserted = insertedPages(evidence);
    const all = (evidence?.observations || []).filter(entry => DOCUMENT_KINDS.has(entry.kind));
    const sheets = all.filter(entry => !inserted.has(pageOf(entry)));
    if (all.length && !sheets.length)
        return '';
    const pages = evidencePages(evidence).filter(entry => !inserted.has(entry.page));
    const structure = pageStructureOf(evidence);
    const first = pages.length ? pages[0].page : NaN;
    const texts = sheets.length ? sheets.map(entry => structure.running.length && pageOf(entry) !== first
        ? withoutRunningLines(structure, pageOf(entry), String(entry.text || '')) : entry.text) : [fallback];
    return texts.map(text => {
        const value = String(text).normalize('NFKC');
        const regions = regionSpansIn(value, ['references', 'citation', 'contentsList']);
        if (!regions.length)
            return text;
        return withoutRegions(value, regions);
    }).join('\n\f\n');
}
function identifierScans(evidence: EvidenceBundle | undefined, fallback: string) {
    const sheets = (evidence?.observations || []).filter(entry => DOCUMENT_KINDS.has(entry.kind));
    if (!sheets.length)
        return [scanIdentifiers({ text: fallback, complete: false })];
    return sheets.map(entry => scanIdentifiers({ text: entry.text, complete: !entry.truncated }));
}
function judgeISBN(value: string, scans: ReturnType<typeof identifierScans>): {
    outcome: VerificationOutcome;
    note: string;
    contradicted?: boolean;
} {
    const printed = scans.flatMap(scan => scan.observations).filter(entry => entry.kind === 'ISBN');
    const own = [...new Set(printed.map(entry => normalizedISBN(entry.value)).filter(Boolean))];
    const listed = [...new Set(scans.flatMap(scan => scan.otherWorks || []).filter(entry => entry.kind === 'ISBN').map(entry => normalizedISBN(entry.value)))]
        .filter(isbn => isbn && !own.includes(isbn));
    const proposed = isbnsIn(value);
    const wanted = proposed.length ? proposed : [normalizedISBN(value)].filter(Boolean);
    const foreign = wanted.filter(isbn => listed.includes(isbn));
    if (foreign.length) {
        const whose = `${foreign.join(', ')}은(는) 문서의 다른 책 목록(관련 도서 등)에 다른 책의 ISBN으로 인쇄돼 있습니다`;
        return own.length
            ? { outcome: 'conflicting', note: `문서가 이 책의 것으로 인쇄한 ISBN(${own.join(', ')})과 다릅니다 — ${whose}.` }
            : { outcome: 'unconfirmed', contradicted: true, note: `${whose} — 이 문서 자신의 ISBN이 아닙니다.` };
    }
    if (!own.length) {
        return { outcome: 'unconfirmed', note: listed.length
                ? '문서 본문에서 이 문서 자신의 ISBN을 찾지 못했습니다 — 다른 책 목록의 ISBN은 대조하지 않습니다.'
                : '문서 본문에서 같은 종류의 식별자를 찾지 못했습니다.' };
    }
    if (wanted.some(isbn => own.includes(isbn)))
        return { outcome: 'supported', note: '문서에 인쇄된 ISBN와 정확히 일치합니다.' };
    if (printed.some(entry => entry.confidence !== 'exact')) {
        return { outcome: 'unconfirmed', note: '문서에서 읽은 ISBN의 경계가 확실하지 않아 대조할 수 없습니다.' };
    }
    return { outcome: 'conflicting', note: `문서에 인쇄된 ISBN(${own.join(', ')})와 다릅니다.` };
}
const DOCUMENT_KINDS = new Set<ObservationKind>(['pdfText', 'ocrText']);
const observedPage = (entry: Observation) => Number(/^(?:OCR )?page (\d+)/.exec(String(entry.locator || ''))?.[1] || 0);
function readableLayerByPage(evidence: EvidenceBundle | undefined): Map<number, {
    text: string;
    complete: boolean;
}> {
    const out = new Map<number, {
        text: string;
        complete: boolean;
    }>();
    if (!evidence)
        return out;
    const broken = brokenLayerPages(evidence);
    for (const entry of evidence.observations || []) {
        const page = observedPage(entry);
        if (entry.kind !== 'pdfText' || !page || broken.has(page) || !/^page \d+/.test(String(entry.locator || '')))
            continue;
        const held = out.get(page);
        out.set(page, { text: `${held?.text ?? ''}\n${String(entry.text || '')}`, complete: (held?.complete ?? true) && !entry.truncated });
    }
    return out;
}
function identifierOnlyTranscribed(field: 'DOI' | 'ISBN', wanted: string, evidence: EvidenceBundle | undefined, normalize: (value: string) => string, readTitle?: unknown): {
    page: number;
    layer: string[];
} | null {
    const sheets = (evidence?.observations || []).filter(entry => DOCUMENT_KINDS.has(entry.kind));
    if (!sheets.some(entry => entry.kind === 'ocrText'))
        return null;
    const printedIn = (text: unknown, complete: boolean) => scanIdentifiers({ text: String(text ?? ''), complete }).observations
        .filter(found => found.kind === field && !found.cited).map(found => normalize(found.value)).filter(Boolean);
    if (sheets.some(entry => entry.kind === 'pdfText' && printedIn(entry.text, !entry.truncated).includes(wanted)))
        return null;
    const layer = readableLayerByPage(evidence);
    const transcribed = sheets.filter(entry => entry.kind === 'ocrText' && printedIn(entry.text, !entry.truncated).includes(wanted));
    if (!transcribed.length)
        return null;
    const standings = doiStandingsOf([...layer].map(([page, held]) => ({ page, text: held.text, complete: held.complete })), readTitle);
    let first: {
        page: number;
        layer: string[];
    } | null = null;
    for (const entry of transcribed) {
        const page = observedPage(entry);
        const own = [...new Set(standings.filter(standing => standing.page === page && standing.own).map(standing => normalize(standing.value)))]
            .filter(doi => !!doi && !wanted.startsWith(doi) && !doi.startsWith(wanted));
        if (!own.length)
            return null;
        first ??= { page, layer: own };
    }
    return first;
}
export function scannedPageSizes(evidence: EvidenceBundle | undefined): boolean {
    const sizes = new Set(structureInputOf(evidence).pages.filter(page => page.size && !page.inserted)
        .map(page => `${Math.round(Number(page.size?.width))}x${Math.round(Number(page.size?.height))}`));
    return sizes.size >= 3;
}
const tokensIn = (value: unknown) => String(value ?? '').normalize('NFKC').match(/[\p{L}\p{N}]+/gu) || [];
const LIGATURE_SEQUENCES = ['ffi', 'ffl', 'ffj', 'fft', 'tti', 'ff', 'fi', 'fl', 'fj', 'ft', 'tf', 'ti', 'tt', 'st', 'ct'];
function ligatureLost(layerWord: string, readWord: string): boolean {
    for (const sequence of LIGATURE_SEQUENCES) {
        for (let at = readWord.indexOf(sequence); at >= 0; at = readWord.indexOf(sequence, at + 1)) {
            const head = readWord.slice(0, at), tail = readWord.slice(at + sequence.length);
            if (layerWord === head + tail)
                return true;
            if (layerWord.length === head.length + tail.length + 1 && layerWord.startsWith(head) && layerWord.endsWith(tail))
                return true;
        }
    }
    return false;
}
export function nearWord(layerWord: string, readWord: string): boolean {
    const a = layerWord, b = readWord;
    if (a === b || Math.min(a.length, b.length) < 3 || Math.abs(a.length - b.length) > 2 || a.length > 40 || b.length > 40)
        return false;
    if (/\p{N}/u.test(a) || /\p{N}/u.test(b) || ligatureLost(a, b))
        return false;
    const limit = Math.max(a.length, b.length) > 5 ? 2 : 1;
    let previous = Array.from({ length: b.length + 1 }, (_, at) => at);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++)
            row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        previous = row;
    }
    return previous[b.length] <= limit;
}
export function layerSpellingOfAName(value: unknown, evidence: EvidenceBundle | undefined, pages?: number[]): {
    page: number;
    read: string;
    printed: string;
    layer: string;
} | null {
    const want = tokensIn(value).map(word => word.toLowerCase());
    if (want.length < 2 || want.length > 20 || want.join('').length < 6 || scannedPageSizes(evidence))
        return null;
    const layer = readableLayerByPage(evidence);
    if (!layer.size)
        return null;
    let everywhere: Set<string> | null = null;
    const printedSomewhere = (word: string) => (everywhere ??= new Set([...layer.values()].flatMap(held => tokensIn(held.text).map(token => token.toLowerCase())))).has(word);
    for (const [page, held] of layer) {
        if (pages && !pages.includes(page))
            continue;
        for (const line of held.text.split('\n')) {
            if (line.length > 400 || sentenceShapedLine(line) || looksLikeBodyProse(line))
                continue;
            const tokens = tokensIn(line);
            const have = tokens.map(token => token.toLowerCase());
            for (let at = 0; at + want.length <= have.length; at++) {
                let differing = -1;
                let fits = true;
                for (let j = 0; j < want.length && fits; j++) {
                    if (have[at + j] === want[j])
                        continue;
                    if (differing >= 0 || !nearWord(have[at + j], want[j]))
                        fits = false;
                    else
                        differing = j;
                }
                if (!fits || differing < 0 || printedSomewhere(want[differing]))
                    continue;
                return { page, read: want[differing], printed: tokens[at + differing], layer: have.slice(at, at + want.length).join(' ') };
            }
        }
    }
    return null;
}
function nameOnlyTranscribed(value: unknown, evidence: EvidenceBundle | undefined): {
    page: number;
    layer: string;
} | null {
    const sheets = (evidence?.observations || []).filter(entry => DOCUMENT_KINDS.has(entry.kind));
    if (!sheets.some(entry => entry.kind === 'ocrText'))
        return null;
    if (sheets.some(entry => entry.kind === 'pdfText' && appearsInDocument(value, String(entry.text || ''))))
        return null;
    const transcribed = sheets.filter(entry => entry.kind === 'ocrText' && appearsInDocument(value, String(entry.text || '')));
    if (!transcribed.length)
        return null;
    let first: {
        page: number;
        layer: string;
    } | null = null;
    for (const entry of transcribed) {
        const page = observedPage(entry);
        const otherwise = layerSpellingOfAName(value, evidence, [page]);
        if (!otherwise)
            return null;
        first ??= { page, layer: otherwise.layer };
    }
    return first;
}
const LIBRARY_BOOKKEEPING = new Set(['libraryCatalog', 'accessDate', 'extra', 'url', 'rights', 'callNumber']);
const LOCATOR_FIELDS = new Set(['volume', 'issue', 'pages', 'numPages', 'seriesNumber', 'section']);
const ROLE_FOR_FIELD: Record<string, SemanticRole[]> = {
    university: ['degreeGranting'],
    institution: ['issuingBody', 'degreeGranting'],
    publisher: ['issuingBody', 'publisher'],
    assignee: ['issuingBody'],
    company: ['issuingBody']
};
const FIELD_STATED_ROLES: Record<string, string[]> = {
    publisher: ['publisherHouse', 'issuer'], institution: ['issuer', 'commissioning', 'leadBody', 'degreeGranting', 'publisherHouse'], university: ['degreeGranting'],
    assignee: ['issuer'], company: ['issuer', 'publisherHouse']
};
const STATED_ROLE_NAME: Record<string, string> = {
    licensor: '권리를 준 곳(배치)', agency: '대리인(배치)', originalPublisher: '원판의 펴낸 곳', rightsHolder: '권리자', publisherPerson: '펴낸 곳의 대표(발행인·펴낸이)', contractor: '연구 수행 기관',
    sponsor: '연구비 기관(전담기관·지원기관·Funded by …)'
};
const NAMED_TEXT_FIELDS = new Set(['publicationTitle', 'bookTitle', 'proceedingsTitle', 'publisher', 'institution',
    'university', 'conferenceName', 'journalAbbreviation', 'series', 'seriesTitle', 'place', 'assignee', 'reportType',
    'publicationType', 'medium', 'type', 'websiteType', 'blogTitle', 'code', 'committee', 'legislativeBody',
    'edition']);
const NUMBER_FIELDS = new Set(['patentNumber', 'applicationNumber', 'reportNumber', 'docketNumber', 'issueDate',
    'filingDate', 'ISSN', 'archiveLocation']);
const REVISION_FIELDS = new Set(['versionNumber', 'revision']);
const PUBLICATION_DATE_ROLES: SemanticRole[] = ['publicationDate', 'onlineDate', 'copyrightDate', 'degreeDate'];
const NON_PUBLICATION_DATE_ROLES: Array<SemanticRole | 'coveragePeriod'> = ['receivedDate', 'acceptedDate', 'surveyPeriod', 'submissionDate',
    'accessDate',
    'coveragePeriod'];
export const FIELD_RULES: FieldRule[] = [
    {
        id: 'identifier/printed-in-document',
        fields: field => field === 'DOI' || field === 'ISBN',
        judge: ({ field, value, evidence, text, recognized }) => {
            const scans = identifierScans(evidence, text);
            if (field === 'ISBN')
                return judgeISBN(value, scans);
            const all = scans.flatMap(scan => scan.observations).filter(entry => entry.kind === field);
            const printed = all.filter(entry => !entry.cited);
            const normalize = field === 'DOI' ? normalizedDOI : normalizedISBN;
            const wanted = normalize(value);
            if (all.some(entry => entry.cited && normalize(entry.value) === wanted) && !printed.some(entry => normalize(entry.value) === wanted)) {
                return { outcome: 'unconfirmed', contradicted: true, note: '이 DOI는 쪽의 인용(참고문헌·요약 대상·데이터 공개) 안에만 인쇄돼 있습니다 — 이 문서가 인용한 다른 저작의 번호입니다.' };
            }
            if (!printed.length)
                return { outcome: 'unconfirmed', note: '문서 본문에서 같은 종류의 식별자를 찾지 못했습니다.' };
            const values = printed.map(entry => normalize(entry.value));
            if (values.includes(wanted)) {
                const transcribed = identifierOnlyTranscribed('DOI', wanted, evidence, normalize, recognized?.fields?.title);
                if (transcribed)
                    return { outcome: 'unconfirmed', contradicted: true,
                        note: `이 DOI는 쪽 이미지 판독(LM Studio의 옮김)에만 있습니다 — 그 쪽(${transcribed.page}쪽)의 글자층은 DOI ${transcribed.layer.join(', ')}을(를) 찍습니다.` };
                return { outcome: 'supported', note: `문서에 인쇄된 ${field}와 정확히 일치합니다.` };
            }
            if (printed.some(entry => entry.confidence !== 'exact')) {
                return { outcome: 'unconfirmed', note: `문서에서 읽은 ${field}의 경계가 확실하지 않아 대조할 수 없습니다.` };
            }
            return { outcome: 'conflicting', note: `문서에 인쇄된 ${field}(${values.join(', ')})와 다릅니다.` };
        }
    },
    {
        id: 'title/stated-as-this-document-title',
        fields: field => field === 'title' || field === 'shortTitle',
        judge: ({ value, evidence, text }) => {
            if (isIssueStatement(String(value ?? ''))) {
                return { outcome: 'unconfirmed', contradicted: true, note: '쪽 머리의 학술지·권호 표시입니다 — 이 문서의 제목으로 진술된 값이 아닙니다.' };
            }
            const sheets = titleBearingText(evidence, text);
            if (!sheets.trim()) {
                return { outcome: 'unconfirmed', note: '목차·참고문헌을 제외하면 대조할 본문이 없습니다 — 본문이 이미지일 수 있습니다.' };
            }
            if (titleSupportedByPDF(value, sheets)) {
                if (!titleSupportedByPDF(value, withoutContainerStatements(sheets))) {
                    return { outcome: 'unconfirmed', note: '이 제목은 쪽의 수록처 진술(「In: …」)에만 나타납니다 — 이 문서를 담은 자료의 제목입니다.' };
                }
                return { outcome: 'supported', note: '문서 본문에 이 제목이 그대로 나타납니다.' };
            }
            if (titleSupportedByPDF(value, text)) {
                return { outcome: 'unconfirmed', note: '이 제목은 목차나 참고문헌·인용에만 나타납니다 — 이 문서 자신의 제목이라는 근거가 아닙니다.' };
            }
            if (sameShapeDifferentCode(value, sheets)) {
                return { outcome: 'unconfirmed', contradicted: true, note: '제목에 든 번호가 본문의 번호와 다릅니다 — 같은 계열의 다른 문서입니다.' };
            }
            return { outcome: 'unconfirmed', note: '읽어들인 본문에서 이 제목을 찾지 못했습니다 — 본문이 이미지이거나 제목이 다를 수 있습니다.' };
        }
    },
    {
        id: 'creators/full-names-in-a-byline',
        fields: field => field === 'creators',
        judge: ({ change, evidence, text }) => {
            const creators = (Array.isArray(change.newValue) ? change.newValue : []) as any[];
            if (!creators.length)
                return { outcome: 'unconfirmed', note: '비어 있는 저자 목록은 저자가 없다는 진술이 아닙니다.' };
            const sheets = titleBearingText(evidence, text);
            const body = compact(sheets);
            if (!body)
                return { outcome: 'unconfirmed', note: '대조할 본문이 없습니다.' };
            const placed: number[] = [];
            for (const creator of creators) {
                const forms = nameForms(creator);
                if (!forms.length)
                    return { outcome: 'unconfirmed', note: '대조할 수 있는 이름 형태가 없습니다.' };
                const at = forms.map(form => body.indexOf(form)).filter(index => index >= 0).sort((a, b) => a - b)[0];
                if (at === undefined) {
                    const family = compact(String(creator?.lastName || creator?.name || ''));
                    const sameFamily = /[a-z]/i.test(family) && family.length >= 2 && body.includes(family);
                    return { outcome: 'unconfirmed', contradicted: sameFamily,
                        note: `「${printedName(creator)}」 형태의 이름을 본문에서 찾지 못했습니다 — 같은 성의 다른 사람일 수 있습니다.` };
                }
                placed.push(at);
            }
            const ordered = placed.every((at, index) => index === 0 || at >= placed[index - 1]);
            const spread = Math.max(...placed) - Math.min(...placed);
            if (!ordered)
                return { outcome: 'unconfirmed', note: '이름은 모두 본문에 있으나 순서가 레코드와 다릅니다.' };
            if (creators.length > 1 && spread > 260) {
                return { outcome: 'unconfirmed', note: '이름들이 한 곳의 저자 표시로 모여 있지 않습니다 — 본문 여기저기의 언급일 수 있습니다.' };
            }
            const region = authorRegion(sheets);
            if (region) {
                const stated = countNames(region.text);
                if (stated === null) {
                    return { outcome: 'unconfirmed', note: '저자 표시가 et al.·외 N인으로 끝나 전체 목록의 완전성을 확인할 수 없습니다.' };
                }
                if (stated !== creators.length) {
                    return { outcome: 'unconfirmed',
                        note: `저자 표시에는 ${stated}명이 있는데 레코드는 ${creators.length}명입니다 — 목록이 완전한지 확인이 필요합니다.` };
                }
            }
            else {
                const first = Math.min(...placed), last = Math.max(...placed) + 40;
                const byline = compact(sheets).slice(Math.max(0, first - 80), last + 80);
                if (/etal|외\d*인/.test(byline)) {
                    return { outcome: 'unconfirmed', note: '저자 표시가 et al.·외 N인으로 끝나 전체 목록의 완전성을 확인할 수 없습니다.' };
                }
            }
            return { outcome: 'supported', note: `저자 ${creators.length}명의 전체 이름이 본문의 저자 표시에 같은 순서로 나타납니다.` };
        }
    },
    {
        id: 'date/stated-to-this-precision',
        fields: field => field === 'date',
        judge: ({ value, evidence, text }) => {
            const wanted = parseDateValue(value);
            if (!wanted)
                return { outcome: 'unconfirmed', note: '연도를 읽을 수 없는 날짜 형식입니다.' };
            const sheets = titleBearingText(evidence, text);
            const readings = readDates(sheets);
            if (!readings.length)
                return { outcome: 'unconfirmed', note: '본문에 날짜 표기가 없습니다.' };
            const labelled = readings.filter(entry => entry.role && PUBLICATION_DATE_ROLES.includes(entry.role));
            const usable = labelled.length ? labelled
                : readings.filter(entry => !entry.role || !NON_PUBLICATION_DATE_ROLES.includes(entry.role));
            if (!usable.length) {
                return { outcome: 'unconfirmed',
                    note: `본문의 날짜는 접수·심사·조사기간 등 발행일이 아닌 역할로 표시돼 있습니다.` };
            }
            const match = usable.find(entry => entry.value.startsWith(wanted.value));
            if (match)
                return { outcome: 'supported', note: `본문이 ${match.raw}(으)로 이 날짜를 ${wanted.precision === 'year' ? '연도' : wanted.precision === 'month' ? '월' : '일'}까지 뒷받침합니다.` };
            if (labelled.length) {
                const finer = readings.find(entry => !entry.role
                    && entry.value.startsWith(wanted.value)
                    && labelled.some(label => entry.value.startsWith(label.value)));
                if (finer) {
                    return { outcome: 'supported',
                        note: `본문이 ${finer.raw}(으)로 이 날짜를 적고, 라벨이 붙은 ${labelled[0].value}와도 어긋나지 않습니다.` };
                }
            }
            const sameYear = usable.filter(entry => entry.value.slice(0, 4) === wanted.value.slice(0, 4));
            if (sameYear.length) {
                const coarser = sameYear.every(entry => wanted.value.length > entry.value.length && wanted.value.startsWith(entry.value));
                return { outcome: 'unconfirmed', contradicted: labelled.length > 0, ...(coarser ? { coarser: true } : {}),
                    note: `연도는 같지만 본문이 적은 날짜는 ${sameYear.map(entry => entry.value).slice(0, 3).join(', ')}입니다 — 연도만 맞는 것은 날짜가 맞다는 뜻이 아닙니다.` };
            }
            const years = new Set(usable.map(entry => entry.value.slice(0, 4)));
            const oneOtherYear = years.size === 1 && !years.has(wanted.value.slice(0, 4));
            return { outcome: 'unconfirmed', contradicted: labelled.length > 0 || oneOtherYear, note: `본문에 나타난 날짜(${usable.map(entry => entry.value).slice(0, 4).join(', ')})에 이 값이 없습니다.` };
        }
    },
    {
        id: 'abstract/wording-matches-document',
        fields: field => field === 'abstractNote',
        judge: ({ value, text }) => titleSupportedByPDF(value, text)
            ? { outcome: 'supported', note: '초록 본문이 문서에 그대로 나타납니다.' }
            : { outcome: 'unconfirmed', note: '초록은 본문 대조로 확인되지 않았습니다 — 레코드가 제공한 값입니다.' }
    },
    {
        id: 'organisation/stated-in-this-role',
        fields: field => field in ROLE_FOR_FIELD,
        judge: ({ field, value, evidence, text }) => {
            const sheets = titleBearingText(evidence, text);
            const wanted = compact(value);
            if (wanted.length < 2)
                return { outcome: 'unconfirmed', note: '대조할 수 있는 기관명이 아닙니다.' };
            const roles = ROLE_FOR_FIELD[field];
            const front = statementsOf(evidence);
            const stated = statedAs(front, value);
            const inThisRole = FIELD_STATED_ROLES[field] || [];
            if (stated.size && ![...stated].some(role => inThisRole.includes(role))) {
                const elsewhere = [...stated].filter(role => ['licensor', 'agency', 'originalPublisher', 'publisherPerson', 'contractor'].includes(role)
                    || (role === 'sponsor' && statedOnlyAsSponsor(front, value)));
                if (elsewhere.length) {
                    return { outcome: 'unconfirmed', contradicted: true,
                        note: `본문에 있기는 하나 역할이 다릅니다 — 문서가 이 이름을 ${elsewhere.map(role => STATED_ROLE_NAME[role] || role).join('·')}(으)로 진술합니다.` };
                }
            }
            const spans = organisationSpans(sheets);
            const forThisRole = spans.filter(span => span.role && roles.includes(span.role));
            if (forThisRole.length) {
                const hit = forThisRole.find(span => span.normalized.includes(wanted) || wanted.includes(span.normalized));
                if (hit)
                    return { outcome: 'supported', note: `본문이 "${hit.raw}"을(를) 이 역할로 명시합니다.` };
                const others = spans.filter(span => span.normalized.includes(wanted) || wanted.includes(span.normalized));
                return { outcome: 'unconfirmed', contradicted: others.length > 0,
                    note: others.length
                        ? `본문에 있기는 하나 역할이 다릅니다 — 이 역할로 명시된 것은 "${forThisRole[0].raw}"입니다.`
                        : `본문이 이 역할로 명시한 것은 "${forThisRole[0].raw}"입니다.` };
            }
            if (compact(sheets).includes(wanted)) {
                return { outcome: 'supported', note: '표지·본문에 이 이름이 나타나며, 다른 역할로 표시된 기관은 없습니다.' };
            }
            return { outcome: 'unconfirmed', note: '본문에서 이 이름을 찾지 못했습니다 — 약어로 표기됐을 수 있습니다.' };
        }
    },
    {
        id: 'name/appears-in-document',
        fields: field => NAMED_TEXT_FIELDS.has(field) && !(field in ROLE_FOR_FIELD),
        judge: ({ field, value, evidence, text }) => {
            const sheets = titleBearingText(evidence, text);
            if (!appearsInDocument(value, sheets))
                return { outcome: 'unconfirmed', note: '본문에서 이 이름을 찾지 못했습니다 — 약어로 표기됐을 수 있습니다.' };
            const transcribed = statedByLinkedEdition(evidence, field, value) ? null : nameOnlyTranscribed(value, evidence);
            if (transcribed)
                return { outcome: 'unconfirmed', contradicted: true,
                    note: `이 이름은 쪽 이미지 판독(LM Studio의 옮김)에만 있습니다 — 그 쪽(${transcribed.page}쪽)의 글자층은 「${transcribed.layer.slice(0, 80)}」로 찍습니다.` };
            return { outcome: 'supported', note: '이 이름이 본문에 그대로 나타납니다.' };
        }
    },
    {
        id: 'locator/stated-as-this-locator',
        fields: field => LOCATOR_FIELDS.has(field),
        judge: ({ field, value, evidence, text, readings }) => {
            const transcribed = (evidence?.observations || []).some(entry => entry.kind === 'ocrText');
            const layer = transcribed && evidence ? { ...evidence, observations: (evidence.observations || []).filter(entry => entry.kind !== 'ocrText') } : evidence;
            const sheets = !transcribed ? titleBearingText(evidence, text)
                : (layer?.observations || []).some(entry => entry.kind === 'pdfText') ? titleBearingText(layer, '') : '';
            if (field === 'pages') {
                const wanted = String(value || '').trim();
                const extent = readings?.pages?.extent;
                if (extent) {
                    const checked = checkPageExtent(wanted, extent, evidencePages(evidence));
                    return checked.ok
                        ? { outcome: 'supported', note: `문서가 쪽마다 인쇄한 번호로 확인했습니다 — ${checked.reason}` }
                        : { outcome: 'unconfirmed', note: checked.reason };
                }
                const range = wanted.match(/^(\d{1,6})\s*[-–—~]\s*(\d{1,6})$/);
                if (range) {
                    const hit = readPageRanges(sheets).find(entry => entry.start === range[1] && entry.end === range[2]);
                    if (hit)
                        return { outcome: 'supported', note: `본문이 쪽 범위 ${hit.raw}을(를) 그대로 인쇄합니다.` };
                    const sameStart = readPageRanges(sheets).filter(entry => entry.start === range[1]);
                    return { outcome: 'unconfirmed', contradicted: sameStart.length > 0,
                        note: sameStart.length
                            ? `시작 쪽은 같지만 본문의 범위는 ${sameStart[0].raw}입니다 — 시작 쪽만 맞는 것은 범위가 맞다는 뜻이 아닙니다.`
                            : '본문에서 이 쪽 범위를 찾지 못했습니다.' };
                }
                if (/^\d{1,8}$/.test(wanted)) {
                    const hit = readSinglePages(sheets).find(entry => entry.value === wanted);
                    if (hit)
                        return { outcome: 'supported', note: `본문이 쪽 번호 ${hit.raw}을(를) 표시합니다.` };
                    if (readArticleNumbers(sheets).includes(wanted)) {
                        return { outcome: 'supported', note: '본문의 DOI·논문번호 표기가 이 값을 문헌 번호로 뒷받침합니다.' };
                    }
                    return { outcome: 'unconfirmed', note: '쪽 표시가 붙은 이 번호도, 같은 값의 논문번호도 본문에서 찾지 못했습니다.' };
                }
                return { outcome: 'unconfirmed', note: '쪽 범위 형식을 해석하지 못했습니다.' };
            }
            if (field === 'volume' || field === 'issue') {
                const { volumes, issues } = readVolumeIssue(sheets);
                const stated = field === 'volume' ? volumes : issues;
                const wanted = String(value || '').trim();
                if (stated.includes(wanted))
                    return { outcome: 'supported', note: `본문이 이 값을 ${field === 'volume' ? '권' : '호'}으로 명시합니다.` };
                const statements = readVolumeIssueStatements(sheets);
                const contrary = field === 'volume' ? statements.volumes : statements.issues;
                if (contrary.length)
                    return { outcome: 'unconfirmed', contradicted: true, note: `본문이 명시한 값은 ${contrary.slice(0, 3).join(', ')}입니다.` };
                if (stated.length)
                    return { outcome: 'unconfirmed', note: `본문의 ${stated.slice(0, 3).join(', ')}은(는) 좌표 없는 칸의 이름표 번호입니다(그림·표의 이름표) — 이 저작의 ${field === 'volume' ? '권' : '호'} 진술이 아닙니다.` };
                return { outcome: 'unconfirmed', note: '본문에 권·호를 명시하는 표기가 없습니다 — 가까이 있는 숫자는 근거가 아닙니다.' };
            }
            if (field === 'numPages') {
                const hit = new RegExp(`(?:^|[^\\d])${String(value || '').trim()}\\s*(?:pages?|pp?\\.|쪽|면|p\\.)`, 'i').test(String(sheets).normalize("NFKC"));
                return hit ? { outcome: 'supported', note: '본문이 전체 쪽수를 이 값으로 표시합니다.' }
                    : { outcome: 'unconfirmed', note: '전체 쪽수 표기를 본문에서 찾지 못했습니다 — PDF 파일의 쪽수와 인쇄된 쪽 범위는 다른 값입니다.' };
            }
            return tokenPresent(value, sheets)
                ? { outcome: 'supported', note: '이 값이 본문에 그대로 나타납니다.' }
                : { outcome: 'unconfirmed', note: '본문에서 이 값을 찾지 못했습니다.' };
        }
    },
    {
        id: 'revision/stated-as-this-version',
        fields: field => REVISION_FIELDS.has(field),
        judge: ({ value, evidence, text }) => {
            const sheets = titleBearingText(evidence, text);
            const stated = readRevisions(sheets);
            const wanted = String(value || '').trim().replace(/^v/i, '');
            if (stated.includes(wanted))
                return { outcome: 'supported', note: `본문이 개정 번호를 ${wanted}(으)로 표시합니다.` };
            if (stated.length) {
                return { outcome: 'conflicting',
                    note: `본문이 표시한 개정 번호는 ${stated.join(', ')}입니다 — 개정이 다르면 다른 문서입니다.` };
            }
            return { outcome: 'unconfirmed', note: '본문에 개정·버전 표기가 없습니다.' };
        }
    },
    {
        id: 'number/appears-in-document',
        fields: field => NUMBER_FIELDS.has(field),
        judge: ({ value, evidence, text }) => {
            const sheets = titleBearingText(evidence, text);
            if (tokenPresent(value, sheets))
                return { outcome: 'supported', note: '이 번호가 본문에 그대로 나타납니다.' };
            return sameShapeDifferentCode(value, sheets)
                ? { outcome: 'unconfirmed', contradicted: true, note: '본문에는 같은 계열의 다른 번호가 찍혀 있습니다 — 이웃한 번호는 다른 문서입니다.' }
                : { outcome: 'unconfirmed', note: '본문에서 이 번호를 찾지 못했습니다.' };
        }
    },
    {
        id: 'language/script-of-the-document',
        fields: field => field === 'language',
        judge: ({ value, evidence, text }) => {
            const sheets = titleBearingText(evidence, text);
            const script = dominantScript(bodySampleText(evidence)) || dominantScript(sheets);
            const wanted = String(value || '').trim().toLowerCase().slice(0, 2);
            if (!script)
                return { outcome: 'unconfirmed', note: '본문이 짧아 표기 문자를 판정할 수 없습니다.' };
            if (script === 'latin') {
                return { outcome: 'unconfirmed',
                    note: '본문이 로마자입니다 — 로마자를 쓰는 언어는 여럿이라 문자만으로는 언어를 확정할 수 없습니다.' };
            }
            if (script === wanted)
                return { outcome: 'supported', note: `본문 표기 문자가 ${script}와 일치합니다.` };
            return { outcome: 'unconfirmed', contradicted: true, note: `본문 표기 문자는 ${script}로 읽힙니다.` };
        }
    },
    {
        id: 'itemType/structure-judged-person-decides',
        fields: field => field === 'itemType',
        judge: () => ({
            outcome: 'unconfirmed',
            note: '항목 유형은 구조로 판정하되 적용은 사람이 결정합니다 — 유형이 바뀌면 그 유형에 없는 필드가 사라지기 때문입니다.'
        })
    },
    {
        id: 'library-bookkeeping',
        fields: field => LIBRARY_BOOKKEEPING.has(field),
        judge: () => ({
            outcome: 'unconfirmed',
            note: '이 항목은 이 서재가 사본에 대해 기록하는 값이라 문서 본문으로 확인되지 않습니다.'
        })
    }
];
export function ruleFor(field: string): FieldRule | undefined {
    return FIELD_RULES.find(rule => rule.fields(field));
}
export interface VerificationContext {
    recognized?: MetadataSnapshot;
    evidence?: EvidenceBundle;
    itemType: string;
    pdfFingerprint: string;
    policyVersion: string;
    readings?: Record<string, any>;
    doiRecord?: {
        provider: string;
        DOI: string;
        fields: Record<string, string>;
    };
}
const WORK_SCOPED_FIELDS = new Set(['title', 'shortTitle', 'creators', 'abstractNote', 'pages', 'DOI', 'volume', 'issue']);
function recordStates(recognized: MetadataSnapshot | undefined, field: string): boolean {
    if (!recognized)
        return false;
    if (field === 'creators')
        return !!recognized.creators?.length;
    if (field === 'itemType')
        return !!recognized.itemType;
    const value = recognized.fields?.[field];
    return value !== undefined && value !== null && value !== '';
}
export function verifyFields(changes: FieldChange[], context: VerificationContext): Record<string, FieldVerification> {
    const text = documentText(context.evidence);
    const identity = context.evidence?.identity;
    const observationIDs = (context.evidence?.observations || []).map(entry => entry.id);
    const result: Record<string, FieldVerification> = {};
    for (const change of changes) {
        const value = valueText(change.newValue);
        const empty = value === '' || (Array.isArray(change.newValue) && !change.newValue.length);
        const base = {
            field: change.field,
            value,
            valueType: valueTypeOf(change.field),
            itemType: context.itemType,
            pdfFingerprint: context.pdfFingerprint,
            identity: identity?.id,
            identityScope: identity?.scope,
            policyVersion: context.policyVersion,
            checkedAt: Date.now()
        };
        if (empty) {
            result[change.field] = { ...base, level: 'unknown', outcome: 'unconfirmed', observations: [],
                rule: 'clearing/never-inferred', note: '값을 지우는 것은 근거로 도출되지 않습니다 — 사람이 결정합니다.' };
            continue;
        }
        const rule = ruleFor(change.field);
        const stated = recordStates(context.recognized, change.field);
        if (!rule || !text) {
            result[change.field] = {
                ...base,
                level: stated ? 'sourceStated' : 'proposed',
                outcome: 'unconfirmed',
                observations: observationIDs,
                rule: rule ? `${rule.id}/no-document-text` : 'no-rule',
                note: text ? '이 필드를 문서와 대조하는 규칙이 없습니다.' : '대조할 문서 본문이 없어 레코드의 진술에 머물렀습니다.'
            };
            continue;
        }
        let verdict = rule.judge({ field: change.field, value, change, recognized: context.recognized, text,
            evidence: context.evidence, itemType: context.itemType, readings: context.readings });
        let ruleID = rule.id;
        if (verdict.outcome === 'unconfirmed' && !verdict.contradicted) {
            const stated = statedByLinkedEdition(context.evidence, change.field, change.newValue);
            if (stated) {
                verdict = { outcome: 'supported', note: `이 문헌·판본에 연결된 ${stated.link.provider} 기록이 이 값을 명시합니다${stated.entry.role ? ` (${stated.entry.role}${stated.entry.precision ? `, ${stated.entry.precision}` : ''})` : ''} — 연결 근거: ${stated.link.rule}. ${stated.link.url}` };
                ruleID = 'external/linked-edition-states';
            }
        }
        const decided = context.doiRecord?.fields?.[change.field];
        if (decided !== undefined && valueText(change.newValue).trim() === String(decided).trim() && verdict.outcome !== 'supported') {
            const against = (verdict.outcome === 'conflicting' || verdict.contradicted) && !verdict.coarser;
            verdict = { outcome: against ? 'unconfirmed' : 'supported',
                note: `이 문서와 같은 판본으로 맞은 DOI 기록(${context.doiRecord!.provider}, ${context.doiRecord!.DOI})이 정한 값입니다 — 제목·저자 밖의 칸은 DOI 기록이 정합니다(2026-10-06 결정).${against ? ` 쪽의 대조: ${String(verdict.note || '').slice(0, 160)}` : ''}` };
            ruleID = against ? 'external/doi-record-decides-over-page' : 'external/doi-record-decides';
        }
        const containerScoped = (identity?.scope === 'container' || identity?.scope === 'part') && WORK_SCOPED_FIELDS.has(change.field);
        const outcome: VerificationOutcome = containerScoped && verdict.outcome === 'supported' ? 'unconfirmed' : verdict.outcome;
        const level: VerificationLevel = outcome === 'supported' ? 'verified'
            : outcome === 'conflicting' ? 'conflicting'
                : stated ? 'sourceStated' : 'proposed';
        result[change.field] = {
            ...base, level, outcome,
            ...(verdict.contradicted ? { contradicted: true } : {}),
            rule: containerScoped ? `${ruleID}/${identity?.scope === 'part' ? 'part' : 'container'}-scope` : ruleID,
            note: containerScoped
                ? identity?.scope === 'part'
                    ? `이 식별자는 이 문서의 한 부분(${identity?.value})을 가리킵니다 — 그 제목·저자·쪽은 문서 전체의 것이 아니어서 확인이 필요합니다.`
                    : `이 식별자는 이 문서를 담고 있는 자료(${identity?.value})를 가리킵니다 — 그 제목·저자·쪽수는 이 문서의 것이 아닐 수 있어 확인이 필요합니다.`
                : verdict.note,
            observations: observationIDs
        };
    }
    return result;
}
const LIBRARY_OWNED_FIELDS = new Set(['url', 'accessDate', 'libraryCatalog', 'callNumber', 'archive', 'archiveLocation', 'extra', 'rights', 'shortTitle']);
export function statedByLinkedEdition(evidence: EvidenceBundle | undefined, field: string, value: unknown): {
    link: LinkRecord;
    entry: {
        value: string;
        role?: string;
        precision?: string;
    };
} | null {
    for (const link of evidence?.links || []) {
        if (link.relation !== 'sameEdition')
            continue;
        if (String(link.provider || '').toLowerCase() === 'google')
            continue;
        if (LIBRARY_OWNED_FIELDS.has(field))
            continue;
        const entry = link.stated[field];
        if (!entry)
            continue;
        if (field === 'creators') {
            const wanted = (Array.isArray(value) ? value : []).map((creator: any) => compact(creator?.lastName || creator?.name)).filter(Boolean);
            const recorded = String(entry.value).split(/\s*;\s*/).map(person => compact(person.split(' ').pop() || person));
            if (wanted.length && wanted.length === recorded.length && wanted.every((name, index) => recorded[index].endsWith(name) || name.endsWith(recorded[index])))
                return { link, entry };
            continue;
        }
        if (field === 'date') {
            if (String(entry.value) === String(value))
                return { link, entry };
            continue;
        }
        if (field === 'ISBN') {
            const stated = isbnsIn(entry.value), wanted = isbnsIn(value);
            if (wanted.length && wanted.every(isbn => stated.includes(isbn)))
                return { link, entry };
            if (wanted.length)
                continue;
        }
        if (compact(entry.value) === compact(value))
            return { link, entry };
        if (field === 'title') {
            const stated = compact(entry.value), wanted = compact(value);
            if (wanted.length >= 6 && stated.startsWith(wanted) && /[:：\-–—]/.test(String(entry.value).slice(String(value).length, String(value).length + 3)))
                return { link, entry };
        }
    }
    return null;
}
export type VerificationMismatch = 'none' | 'notVerified' | 'valueChanged' | 'fileChanged' | 'typeChanged' | 'policyChanged' | 'conflicting';
export interface VerificationCheck {
    verified: boolean;
    code: VerificationMismatch;
    record?: FieldVerification;
}
export function verificationCovers(record: FieldVerification | undefined, change: FieldChange, context: {
    pdfFingerprint?: string;
    itemType: string;
    policyVersion: string;
}): VerificationCheck {
    if (!record)
        return { verified: false, code: 'none' };
    if (record.level === 'conflicting')
        return { verified: false, code: 'conflicting', record };
    if (record.level !== 'verified')
        return { verified: false, code: 'notVerified', record };
    if (record.value !== valueText(change.newValue))
        return { verified: false, code: 'valueChanged', record };
    if (!sameFile(record.pdfFingerprint, String(context.pdfFingerprint || '')))
        return { verified: false, code: 'fileChanged', record };
    if (record.itemType !== context.itemType)
        return { verified: false, code: 'typeChanged', record };
    if (record.policyVersion !== context.policyVersion)
        return { verified: false, code: 'policyChanged', record };
    return { verified: true, code: 'none', record };
}
export function normalizeVerification(stored: unknown, context: {
    itemType: string;
    pdfFingerprint: string;
    policyVersion: string;
}): Record<string, FieldVerification> {
    const result: Record<string, FieldVerification> = {};
    if (!stored || typeof stored !== 'object')
        return result;
    for (const [field, value] of Object.entries(stored as Record<string, unknown>)) {
        if (value && typeof value === 'object' && 'rule' in (value as any) && 'value' in (value as any)) {
            result[field] = value as FieldVerification;
            continue;
        }
        result[field] = {
            field, level: 'proposed', value: '', valueType: valueTypeOf(field),
            rule: 'legacy/no-evidence-recorded', outcome: 'unconfirmed',
            note: '이전 버전이 근거 없이 기록한 검증 표시입니다 — 근거를 복구하기 전에는 승격하지 않습니다.',
            itemType: context.itemType, pdfFingerprint: context.pdfFingerprint,
            observations: [], policyVersion: context.policyVersion, checkedAt: 0
        };
    }
    return result;
}
export function identityFromIdentifier(identifier: {
    kind: 'DOI' | 'ISBN';
    value: string;
}, record: {
    itemType?: string;
    fields?: Record<string, unknown>;
} | undefined, corroboration: IdentityDecision['corroboration'], policyVersion = '', document: string | EvidenceBundle = ''): IdentityDecision {
    const itemType = String(record?.itemType || '');
    const bundle = typeof document === 'object' && document ? document : undefined;
    const structure = bundle ? pageStructureOf(bundle) : null;
    const text = bundle && structure ? evidencePages(bundle).filter(page => !['insertedLeaf', 'contents'].includes(roleOf(structure, page.page)))
        .map(page => page.text).join('\n') : String(document || '');
    const extent = bundle ? scopeOfRecord({ itemType, ...(record?.fields || {}) }, bundle) : 'unknown';
    return {
        id: `${identifier.kind.toLowerCase()}:${identifier.value}`,
        kind: identifier.kind,
        value: identifier.value,
        scope: extent === 'container' || (bundle ? statesContainment(statementsOf(bundle), record?.fields?.title) : namesAsContainer(text, record?.fields?.title)) ? 'container'
            : extent === 'part' ? 'part'
                : itemType ? 'work' : 'unknown',
        itemType,
        corroboration,
        decidedAt: Date.now(),
        policyVersion
    };
}
export function documentExtent(evidence: EvidenceBundle | undefined): number {
    let most = 0;
    for (const entry of evidence?.observations || []) {
        if (!DOCUMENT_KINDS.has(entry.kind))
            continue;
        const stated = /page\s+\d{1,4}\s+of\s+(\d{1,4})\b/i.exec(String(entry.locator || ""));
        if (stated)
            most = Math.max(most, Number(stated[1]));
    }
    return most;
}
const WHOLE_TYPES = new Set(['book', 'report', 'thesis', 'manuscript', 'document']);
const OWN_PAGINATION_TYPES = new Set(['book', 'report', 'thesis']);
const FAR_PAST_THE_FIRST_PAGE = 20;
function rangeOf(value: unknown): {
    start: number;
    end: number;
    length: number;
} | null {
    const hit = /^\s*(\d{1,6})\s*[-–—~]\s*(\d{1,6})\s*$/.exec(String(value ?? ''));
    if (!hit)
        return null;
    const start = Number(hit[1]), end = Number(hit[2]);
    return end >= start ? { start, end, length: end - start + 1 } : null;
}
function partOpensAfter(s: PageStructure, after: number, people: string[]): boolean {
    return s.pages.some(entry => {
        if (entry.page <= after)
            return false;
        const rows = rowsOf(s, entry.page).filter(row => row.text.trim()).slice(0, 6);
        const head = rows.findIndex(row => row.claim || row.display);
        if (head < 0 || head > 2)
            return false;
        const byline = rows.slice(head + 1, head + 3).find(row => row.byline);
        return !!byline && !people.some(name => compact(byline.text).includes(name));
    });
}
export function scopeOfRecord(record: {
    itemType?: unknown;
    pages?: unknown;
    numPages?: unknown;
    title?: unknown;
    bookTitle?: unknown;
    creators?: unknown[];
}, evidence: EvidenceBundle | undefined): 'same' | 'container' | 'part' | 'unknown' {
    const extent = documentExtent(evidence);
    if (!extent)
        return 'unknown';
    const s = pageStructureOf(evidence);
    const st = statementsOf(evidence);
    const wrapper = s.leadingLeaves;
    const run = s.folioRun;
    const own = run && st.ownRange ? { first: wrapper + 1 + run.offset, last: extent + run.offset, seen: st.ownRange.last, slack: st.ownRange.unfoliated } : null;
    const type = String(record?.itemType ?? '');
    if (WHOLE_TYPES.has(type)) {
        const numPages = Number(/\d+/.exec(String(record?.numPages ?? ''))?.[0] || 0);
        const past = !!own && numPages > 0 && own.last > numPages + own.slack;
        const opening = evidencePages(evidence).find(entry => entry.page === (s.opening.page ?? wrapper + 1));
        const serial = !st.containment && !!opening && !!journalHeadStatement(opening.text)?.journal;
        if (!past && !serial && statesContainment(st, record?.title))
            return 'container';
        if (own && OWN_PAGINATION_TYPES.has(type) && own.first > FAR_PAST_THE_FIRST_PAGE + own.slack)
            return 'container';
        if (own && numPages && Math.abs(own.last - numPages) <= own.slack)
            return 'same';
        return 'unknown';
    }
    const span = rangeOf(record?.pages);
    if (!span || !own)
        return 'unknown';
    if (own.first === span.start && Math.abs(own.last - span.end) <= own.slack)
        return 'same';
    const inside = span.start >= own.first && span.end <= own.last;
    const people = (Array.isArray(record?.creators) ? record.creators : [])
        .map((creator: any) => compact(creator?.lastName || creator?.name || '')).filter(name => name.length >= 2);
    const after = span.start - (run?.offset ?? 0) + span.length - 1;
    if (inside && (own.seen > span.end || partOpensAfter(s, after, people)))
        return 'part';
    return 'unknown';
}
const HANGUL_WEIGHT = 2.5;
export interface DocumentProfile {
    textLayer: 'readable' | 'broken' | 'none';
    script: 'hangul' | 'latin' | null;
}
const SPACED_SEPARATOR = /(^|\s)[•·‧∙|–—](?=\s|$)/g;
export function unreadableTextLayer(text: string, flagged: boolean): boolean {
    const visible = text.replace(SPACED_SEPARATOR, '$1').replace(/\s+/g, '');
    return flagged || (visible.length > 40 && (visible.match(/[~{}|^\\`°•]/g) || []).length / visible.length > 0.02);
}
function perObservations<T>(compute: (evidence: EvidenceBundle | undefined) => T): (evidence: EvidenceBundle | undefined) => T {
    const cache = new WeakMap<object, {
        value: T;
    }>();
    return evidence => {
        const observations = evidence?.observations;
        if (!Array.isArray(observations))
            return compute(evidence);
        const held = cache.get(observations);
        if (held)
            return held.value;
        const value = compute(evidence);
        cache.set(observations, { value });
        return value;
    };
}
const layoutFlagsOf = perObservations(layoutFlagsOfObservations);
function layoutFlagsOfObservations(evidence: EvidenceBundle | undefined): Map<number, boolean> {
    const flags = new Map<number, boolean>();
    for (const entry of (evidence?.observations || []) as any[]) {
        const at = /^layout page (\d+)$/.exec(String(entry.locator || ''));
        if (!at)
            continue;
        try {
            const layout = JSON.parse(String(entry.text || '{}'));
            if (layout.degraded || layout.glyphRisk || layout.encodingShift)
                flags.set(Number(at[1]), true);
        }
        catch { }
    }
    return flags;
}
const disownedLayerPages = perObservations(disownedLayerPagesOfObservations);
function disownedLayerPagesOfObservations(evidence: EvidenceBundle | undefined): Set<number> {
    const pages = new Set<number>();
    if (!(evidence?.observations || []).some(entry => entry.kind === 'ocrText'))
        return pages;
    const flags = layoutFlagsOf(evidence);
    for (const entry of pageStructureOf(evidence).pages)
        if (entry.layer === 'broken' && !flags.get(entry.page))
            pages.add(entry.page);
    return pages;
}
export function brokenLayerPages(evidence: EvidenceBundle | undefined): Set<number> {
    const out = new Set<number>(disownedLayerPages(evidence));
    for (const [page, flagged] of layoutFlagsOf(evidence))
        if (flagged)
            out.add(page);
    return out;
}
function bodyTextOfPage(structure: PageStructure, page: number, text: string): string {
    return withoutFurnitureLines(structure, page, text);
}
const lettersIn = (text: string) => (String(text || '').normalize('NFKC').match(/[\p{L}\p{N}]/gu) || []).length;
function layerVerdictBrokenPages(evidence: EvidenceBundle | undefined): Set<number> {
    const out = new Set<number>(brokenLayerPages(evidence));
    for (const page of pagesBehindABrokenWindow(pageStructureOf(evidence)))
        out.add(page);
    return out;
}
const markedInserted = (value: any) => !!value && typeof value === 'object' && (value.inserted === true || value.pageRole === 'platformCover');
const insertedPages = perObservations(insertedPagesOfObservations);
function insertedPagesOfObservations(evidence: EvidenceBundle | undefined): Set<number> {
    const pages = new Set<number>();
    for (const entry of (evidence?.observations || []) as any[]) {
        const layout = /^layout page (\d+)$/.exec(String(entry?.locator || ''));
        if (layout) {
            try {
                if (markedInserted(JSON.parse(String(entry.text || '{}'))))
                    pages.add(Number(layout[1]));
            }
            catch { }
            continue;
        }
        if (!DOCUMENT_KINDS.has(entry?.kind) || !markedInserted(entry))
            continue;
        const stated = Number(entry.page);
        const located = /(?:^|\s)page\s+(\d{1,4})\b/i.exec(String(entry.locator || ''));
        const page = Number.isInteger(stated) && stated > 0 ? stated : located ? Number(located[1]) : NaN;
        if (Number.isInteger(page))
            pages.add(page);
    }
    return pages;
}
export function insertedLeaf(evidence: EvidenceBundle | undefined, page: number): boolean {
    if (!Number.isInteger(page))
        return false;
    const entry = pageStructureOf(evidence).pages.find(held => held.page === page);
    return !!entry && entry.role === 'insertedLeaf' && entry.leaf === 'foreignSize';
}
export function documentProfile(evidence: EvidenceBundle | undefined): DocumentProfile {
    return { ...profileOf(evidence) };
}
const profileOf = perObservations(profileOfObservations);
function profileOfObservations(evidence: EvidenceBundle | undefined): DocumentProfile {
    const flags = layerVerdictBrokenPages(evidence);
    const inserted = insertedPages(evidence);
    const structure = pageStructureOf(evidence);
    let readable = 0, broken = 0;
    for (const entry of evidence?.observations || []) {
        if (entry.kind !== 'pdfText')
            continue;
        const at = /^page (\d+)/.exec(String(entry.locator || ''));
        if (!at || inserted.has(Number(at[1])))
            continue;
        const whole = String(entry.text || '').normalize('NFKC');
        if (lettersIn(whole) < 20)
            continue;
        if (unreadableTextLayer(whole, flags.has(Number(at[1])))) {
            broken++;
            continue;
        }
        if (lettersIn(bodyTextOfPage(structure, Number(at[1]), whole)) >= 20)
            readable++;
    }
    const textLayer = !readable && !broken ? 'none' : broken > readable ? 'broken' : 'readable';
    return { textLayer, script: documentBodyScript(evidence) };
}
export function documentBodyScript(evidence: EvidenceBundle | undefined): 'hangul' | 'latin' | null {
    return bodyScriptOf(evidence);
}
export function bodySampleText(evidence: EvidenceBundle | undefined): string {
    const entry = (evidence?.observations || []).find(o => o.kind === 'pdfLayout' && String(o.locator || '') === 'body sample');
    if (!entry)
        return '';
    try {
        const sample = JSON.parse(String(entry.text || '{}'));
        return (Array.isArray(sample?.pages) ? sample.pages : []).map((page: any) => String(page?.text ?? '')).join('\n');
    }
    catch {
        return '';
    }
}
const bodyScriptOf = perObservations(bodyScriptOfObservations);
function bodyScriptOfObservations(evidence: EvidenceBundle | undefined): 'hangul' | 'latin' | null {
    const body = new Set(bodyPages(pageStructureOf(evidence)));
    const inserted = insertedPages(evidence);
    const pageNumberOf = (entry: Observation) => Number(/^(?:OCR )?page (\d+)/.exec(String(entry.locator || ''))?.[1] ?? NaN);
    const observations = (evidence?.observations || []).filter(entry => DOCUMENT_KINDS.has(entry.kind) && !inserted.has(pageNumberOf(entry)));
    const layoutFlags = layerVerdictBrokenPages(evidence);
    const noisy = (text: string) => unreadableTextLayer(text, false);
    const structure = pageStructureOf(evidence);
    const layerText = (page: number, text: string) => bodyTextOfPage(structure, page, text);
    let layerReadable = 0, layerBroken = 0;
    for (const entry of observations) {
        if (entry.kind !== 'pdfText')
            continue;
        const at = /^page (\d+)/.exec(String(entry.locator || ''));
        if (!at)
            continue;
        const whole = String(entry.text || '').normalize('NFKC');
        if (lettersIn(whole) < 20)
            continue;
        if (unreadableTextLayer(whole, layoutFlags.has(Number(at[1])))) {
            layerBroken++;
            continue;
        }
        if (lettersIn(layerText(Number(at[1]), whole)) >= 20)
            layerReadable++;
    }
    const layerFirst = layerReadable > 0 && layerReadable >= layerBroken;
    const byPage = new Map<number, {
        page: number;
        text: string;
        ocr: boolean;
    }>();
    for (const entry of observations) {
        const at = /^(OCR )?page (\d+)/.exec(String(entry.locator || ''));
        if (!at)
            continue;
        const page = Number(at[2]), ocr = !!at[1] || entry.kind === 'ocrText';
        const text = (ocr ? String(entry.text || '') : layerText(page, String(entry.text || ''))).normalize('NFKC');
        if (!body.has(page))
            continue;
        const whole = String(entry.text || '').normalize('NFKC');
        if (!ocr && (layoutFlags.has(page) || noisy(whole) || (lettersIn(whole) >= 20 && lettersIn(text) < 20)))
            continue;
        const held = byPage.get(page);
        if (!held || (layerFirst ? held.ocr && !ocr : ocr && !held.ocr))
            byPage.set(page, { page, text, ocr });
    }
    const pages = [...byPage.values()].sort((a, b) => a.page - b.page);
    const weigh = (text: string): 'hangul' | 'latin' | null => {
        const hangul = (text.match(/[가-힣]/g) || []).length;
        const latin = (text.match(/[A-Za-zÀ-ɏ]/g) || []).length;
        if (hangul + latin < 120)
            return null;
        return hangul * HANGUL_WEIGHT >= latin ? 'hangul' : 'latin';
    };
    const scored: Array<'hangul' | 'latin'> = [];
    for (const page of pages.slice(1)) {
        const verdict = weigh(String(page.text || '').normalize('NFKC'));
        if (verdict)
            scored.push(verdict);
    }
    if (scored.length >= 2) {
        const hangul = scored.filter(script => script === 'hangul').length;
        if (hangul * 2 > scored.length)
            return 'hangul';
        if ((scored.length - hangul) * 2 > scored.length)
            return 'latin';
        return null;
    }
    const pooled = pages.slice(pages.length >= 2 ? 1 : 0).map(page => String(page.text || '').normalize('NFKC')).join('\n');
    const hangulLetters = (pooled.match(/[가-힣]/g) || []).length;
    const latinLetters = (pooled.match(/[A-Za-zÀ-ɏ]/g) || []).length;
    if (hangulLetters * HANGUL_WEIGHT + latinLetters < 200)
        return null;
    if (hangulLetters * HANGUL_WEIGHT >= latinLetters * 1.5)
        return 'hangul';
    if (latinLetters >= hangulLetters * HANGUL_WEIGHT * 1.5)
        return 'latin';
    return null;
}
export function structureInputOf(evidence: EvidenceBundle | undefined): StructureInput {
    const pages = new Map<number, StructurePage>();
    const pageAt = (page: number) => { const held = pages.get(page) || { page }; pages.set(page, held); return held; };
    let documentPages = 0;
    const laidOut = new Map<number, any>();
    const layoutTruncated = new Map<number, boolean>();
    for (const entry of (evidence?.observations || []) as any[]) {
        const locator = String(entry?.locator || '');
        if (entry?.kind === 'pdfLayout') {
            const laid = /^layout page (\d+)$/.exec(locator);
            if (laid) {
                try {
                    laidOut.set(Number(laid[1]), JSON.parse(String(entry.text || '{}')));
                    layoutTruncated.set(Number(laid[1]), !!entry.truncated);
                }
                catch { }
                continue;
            }
            if (locator === 'census') {
                try {
                    const census = JSON.parse(String(entry.text || '{}'));
                    for (const leaf of Array.isArray(census?.pages) ? census.pages : []) {
                        const page = Number(leaf?.page);
                        if (!Number.isInteger(page) || page < 1)
                            continue;
                        const held = pageAt(page);
                        if (!held.size && Number(leaf.width) > 0 && Number(leaf.height) > 0)
                            held.size = { width: Number(leaf.width), height: Number(leaf.height) };
                        if (leaf.words === false)
                            held.readEmpty = true;
                    }
                    for (const page of Array.isArray(census?.inserted) ? census.inserted : [])
                        if (Number.isInteger(Number(page)) && Number(page) > 0)
                            pageAt(Number(page)).inserted = true;
                    if (Number(census?.documentPages) > 0)
                        documentPages = Math.max(documentPages, Number(census.documentPages));
                }
                catch { }
            }
            continue;
        }
        if (!DOCUMENT_KINDS.has(entry?.kind))
            continue;
        const ocr = entry.kind === 'ocrText' ? /^OCR page (\d+)(?: of (\d+))?/.exec(locator) : null;
        const layer = entry.kind === 'pdfText' ? /^page (\d+)(?: of (\d+))?/.exec(locator) : null;
        const at = ocr || layer;
        if (!at)
            continue;
        const page = pageAt(Number(at[1]));
        if (at[2])
            documentPages = Math.max(documentPages, Number(at[2]));
        if (markedInserted(entry))
            page.inserted = true;
        if (ocr)
            page.ocr = { text: String(entry.text || ''), ...(entry.truncated ? { truncated: true } : {}) };
        else
            page.layer = { text: String(entry.text || ''), stored: String(entry.text || ''), ...(entry.truncated ? { truncated: true } : {}) };
    }
    for (const [number, laid] of laidOut) {
        const page = pageAt(number);
        const text = typeof laid?.text === 'string' && laid.text.trim() ? laid.text : page.layer?.text ?? '';
        page.layer = {
            text, stored: page.layer?.stored ?? '',
            ...(typeof laid?.layout === 'string' ? { layout: laid.layout } : {}),
            ...(Array.isArray(laid?.lineHeights) ? { lineHeights: laid.lineHeights } : {}),
            ...((layoutTruncated.get(number) ?? page.layer?.truncated) ? { truncated: true } : {}),
            ...(laid?.degraded ? { degraded: true } : {}), ...(laid?.glyphRisk ? { glyphRisk: true } : {}),
            ...(laid?.encodingShift ? { encodingShift: laid.encodingShift } : {})
        };
        if (laid?.size && Number(laid.size.width) > 0 && Number(laid.size.height) > 0)
            page.size = { width: Number(laid.size.width), height: Number(laid.size.height) };
        if (markedInserted(laid))
            page.inserted = true;
    }
    return { pages: [...pages.values()].sort((a, b) => a.page - b.page), ...(documentPages ? { documentPages } : {}) };
}
const structureCache = new WeakMap<object, PageStructure>();
export function pageStructureOf(evidence: EvidenceBundle | undefined): PageStructure {
    const observations = evidence?.observations;
    if (Array.isArray(observations)) {
        const held = structureCache.get(observations);
        if (held)
            return held;
    }
    const structure = readPageStructure(structureInputOf(evidence));
    if (Array.isArray(observations))
        structureCache.set(observations, structure);
    return structure;
}
export interface TitleCandidate {
    title: string;
    source: 'linked' | 'cover' | 'page' | 'running';
}
export function titleCandidatesOf(evidence: EvidenceBundle | undefined, readings?: Record<string, any>): TitleCandidate[] {
    const out: TitleCandidate[] = [];
    const seen = new Set<string>();
    const add = (raw: unknown, source: TitleCandidate['source']) => {
        const title = withoutGenreTag(raw).replace(/\s+/g, ' ').trim();
        if (!title || seen.has(`${source}|${title}`))
            return;
        seen.add(`${source}|${title}`);
        out.push({ title, source });
    };
    for (const link of evidence?.links || []) {
        if (link?.relation === 'sameEdition' || link?.relation === 'sameWork')
            add(link.stated?.title?.value, 'linked');
    }
    for (const entry of evidence?.observations || []) {
        if (entry.kind !== 'externalRecord')
            continue;
        try {
            add(JSON.parse(String(entry.text || ''))?.stated?.title?.value, 'linked');
        }
        catch { }
    }
    if (readings?.title?.title)
        add(readings.title.title, 'cover');
    const structure = pageStructureOf(evidence);
    for (const block of titleBlocksOf(structure)) {
        add(block.main.text, 'page');
        for (const parallel of block.parallel)
            add(parallel.text, 'page');
    }
    for (const title of runningTitles(structure))
        add(title, 'running');
    return out;
}
export { citationRegions, withoutCitations } from '../recognition/pdf-identifiers';
export function statementsOf(evidence: EvidenceBundle | undefined): FrontStatements {
    return readStatements(pageStructureOf(evidence));
}

import type { MetadataSnapshot } from '../types';
import type { PageObservation } from '../recognition/candidate';
import { REQUIRED } from '../recognition/candidate';
import type { CoverProposal } from '../recognition/cover-candidate';
import { snapshotFrom } from '../recognition/international-catalog';
import { lookupIdentifier } from '../recognition/pdf-identifiers';
import { cluesFrom, type DocumentClues, type PrintedCoordinates, type ProviderId } from '../restore/clues';
import { containerDOIOf } from '../metadata/identifier-compare';
import { titleSimilarity } from '../metadata/match';
import { printedName } from '../metadata/person-name';
import { DEFAULT_LIMITS, ProviderLedger, type Fetcher, type FetchOutcome, type RestoreLimits } from '../restore/outcome';
import { restoreBySearch, type RestoreOutcome } from '../restore/restore';
import { crossrefByCoordinates, type CoordinatesAnswer } from '../restore/records';
import { mergeFields, type Correction, type FieldConflict, type FieldProvenance, type Linked, type LocalStanding } from '../restore/link';
import type { SearchBrowser } from '../restore/browser';
import { identityFromIdentifier, observation, type IdentityDecision, type LinkRecord, type Observation } from './evidence';
export interface RestoreRecord {
    status: RestoreOutcome['status'];
    queries: Array<{
        kind: string;
        text: string;
        providers: string[];
        asked: boolean;
        skipped?: string;
    }>;
    providers: Record<string, {
        calls: number;
        outcomes: Record<string, number>;
        blocked?: string;
    }>;
    log: FetchOutcome[];
    target: {
        provider: string;
        url: string;
        stage: string;
        relation: string;
        rule: string;
        evidence: string[];
        conflicts: string[];
        live: boolean;
        retrievedAt: string;
        pageType: string;
        identifierMatch?: boolean;
    } | null;
    targetReason: string;
    candidates: Array<{
        provider: string;
        url: string;
        stage: string;
        relation: string;
        rule: string;
        title: string;
        record: {
            itemType: string;
            title: string;
            creators: any[];
            fields: Record<string, string>;
            identifiers: {
                DOI?: string;
                ISBN: string[];
            };
            pageType: string;
            live: boolean;
            retrievedAt: string;
            collected?: Record<string, {
                status: string;
                source?: string;
            }>;
        };
        evidence: string[];
        conflicts: string[];
        notes?: string[];
    }>;
    corrections: Correction[];
    fieldConflicts: FieldConflict[];
    cancelled: boolean;
    provenance: Record<string, FieldProvenance>;
    unresolved: string[];
    notes: string[];
    elapsedMs: number;
    discoveries: RestoreOutcome['discoveries'];
    assist: RestoreOutcome['assist'];
    clues: {
        kind: string;
        titles: string[];
        surnames: string[];
        years: string[];
        identifiers: DocumentClues['identifiers'];
        carried?: DocumentClues['carried'];
        citation?: string;
        ocr: boolean;
    };
    coordinates?: {
        printed: PrintedCoordinates;
        queries: string[];
        basis?: 'article';
        doi?: string;
        reason: string;
    };
}
export interface RestoreStepInput {
    parent: any;
    before: MetadataSnapshot;
    proposal: CoverProposal | null;
    pages: PageObservation[];
    fetcher: Fetcher;
    limits?: RestoreLimits;
    keys?: {
        aladin?: string;
        nlk?: string;
    };
    translators: boolean;
    providers?: ProviderId[];
    browser?: SearchBrowser;
    documentFields?: Record<string, any>;
    documentType?: string;
    documentBase?: Record<string, any>;
    documentFieldsFrom?: 'reading' | 'record';
    documentRecordFields?: Record<string, any>;
    scopeOf?: DocumentClues['scopeOf'];
    protectedFields?: string[];
    cancelled?: () => boolean;
}
export interface RestoreStepResult {
    record: RestoreRecord;
    metadata: MetadataSnapshot | null;
    typeRead: boolean;
    linked?: MetadataSnapshot | null;
    evidence: {
        observation: Observation;
        link: LinkRecord;
        identity?: IdentityDecision;
    } | null;
}
const PREFIX = 'extensions.zotero.pdfMetadataRefresh.';
export function restoreLimitsFromPrefs(): RestoreLimits {
    const read = (name: string) => { try {
        return Zotero.Prefs.get(PREFIX + name, true);
    }
    catch {
        return undefined;
    } };
    const deep = read('restore.deep') === true;
    const number = (name: string, fallback: number) => { const value = Number(read(name)); return Number.isFinite(value) && value > 0 ? value : fallback; };
    const base: RestoreLimits = deep
        ? { ...DEFAULT_LIMITS, maxSearches: 10, maxMs: 300000, maxCallsPerProvider: 10, maxCallsFor: { google: 18 }, maxFollowPerSearch: 4, maxGoogleSearches: 6 }
        : { ...DEFAULT_LIMITS };
    return {
        ...base,
        maxSearches: number('restore.maxSearches', base.maxSearches),
        maxMs: number('restore.maxMs', base.maxMs),
        maxFollowPerSearch: number('restore.maxFollow', base.maxFollowPerSearch ?? 2),
        maxGoogleSearches: number('restore.maxGoogleSearches', base.maxGoogleSearches ?? 3)
    };
}
export function restoreKeysFromPrefs(): {
    aladin?: string;
    nlk?: string;
} {
    const read = (name: string) => { try {
        const value = String(Zotero.Prefs.get(PREFIX + name, true) || '').trim();
        return value || undefined;
    }
    catch {
        return undefined;
    } };
    return { aladin: read('aladinTTBKey'), nlk: read('nlkCertKey') };
}
export async function restoreStep(input: RestoreStepInput): Promise<RestoreStepResult> {
    const candidate = input.proposal?.candidate;
    const localFields = { ...(candidate?.fields || {}), ...(input.documentFields || {}) };
    const fromRecord = !!input.documentFields && input.documentFieldsFrom !== 'reading';
    const filledByRecord = !fromRecord && input.documentFields && input.documentRecordFields && Object.keys(input.documentRecordFields).length
        ? input.documentRecordFields : null;
    const readFields = filledByRecord
        ? { ...(candidate?.fields || {}), ...Object.fromEntries(Object.entries(input.documentFields || {}).filter(([field]) => !(field in filledByRecord))) }
        : localFields;
    const documentPages = documentPagesOf(input);
    const clues = cluesFrom({
        fields: fromRecord ? { ...(candidate?.fields || {}) } : readFields,
        ...(fromRecord ? { recordFields: input.documentFields } : filledByRecord ? { recordFields: filledByRecord } : {}),
        itemType: input.documentType && input.documentType !== 'document' ? input.documentType : candidate?.itemType, sources: input.proposal?.sources,
        alternatives: candidate?.alternatives,
        pages: input.pages.map(page => ({ page: page.page, text: page.text, kind: page.kind })),
        ...(input.scopeOf ? { scopeOf: input.scopeOf } : {}),
        ...(documentPages ? { documentPages } : {})
    });
    const container = containerDOIOf(localFields.DOI, clues.identifiers.DOI);
    if (container)
        clues.identifiers = { ...clues.identifiers, DOI: undefined };
    const local: LocalStanding = {
        sources: input.proposal?.sources, ocr: !!input.proposal?.ocr, vision: /LM\s*Studio/i.test(String(input.proposal?.ocr?.provider || '')), text: clues.text, years: clues.years,
        protectedFields: new Set(input.protectedFields || [])
    };
    const documentFields: Record<string, any> = input.documentBase
        || input.documentFields
        || (input.proposal ? { ...input.proposal.metadata.fields, creators: input.proposal.metadata.creators } : {});
    const proposalType = input.proposal?.typeRead ? String(input.proposal.metadata.itemType) : '';
    const statedType = input.documentType && input.documentType !== 'document' ? input.documentType : '';
    const documentType = statedType || (input.documentBase ? '' : proposalType);
    const requiredType = documentType || proposalType;
    const required = REQUIRED[requiredType] || (clues.kind === 'article' ? REQUIRED.journalArticle : clues.kind === 'book' ? REQUIRED.book : REQUIRED.document);
    const later = input.documentFields && input.documentFieldsFrom === 'reading' ? input.documentFields
        : input.proposal ? { ...input.proposal.metadata.fields, creators: input.proposal.metadata.creators } : {};
    const pending = input.documentBase
        ? Object.fromEntries(Object.entries(later).filter(([field]) => !(field in input.documentBase!)))
        : undefined;
    const ledger = new ProviderLedger(input.limits || DEFAULT_LIMITS);
    let outcome: RestoreOutcome;
    let located: CoordinatesAnswer | null = null;
    try {
        if (clues.coordinates && !clues.identifiers.DOI && (!input.providers || input.providers.includes('crossref')) && !input.cancelled?.() && ledger.canSearch().ok) {
            ledger.noteSearch();
            located = await crossrefByCoordinates(clues.coordinates, { fetch: input.fetcher, ledger, keys: input.keys, cancelled: input.cancelled });
        }
        outcome = located?.chosen
            ? linkedByCoordinates(located, clues, documentFields, required, local, ledger)
            : withCoordinateCandidates(await restoreBySearch({
                clues, documentFields, required, providers: input.providers, local, ...(pending ? { pending } : {}),
                context: {
                    fetch: input.fetcher, ledger, keys: input.keys, browser: input.browser, cancelled: input.cancelled,
                    isbnLookup: input.translators ? isbn => lookupIdentifier({ kind: 'ISBN', value: isbn }) : undefined
                }
            }), located);
    }
    finally {
        input.browser?.release();
    }
    const record: RestoreRecord = {
        status: outcome.status,
        queries: outcome.queries.map(query => ({ kind: query.kind, text: query.text, providers: query.providers, asked: query.asked, skipped: query.skipped })),
        providers: outcome.providers, log: outcome.log,
        target: outcome.target ? {
            provider: outcome.target.record.provider, url: outcome.target.record.url, stage: outcome.target.record.publicationStage,
            relation: outcome.target.link.relation, rule: outcome.target.link.rule, evidence: outcome.target.link.evidence,
            conflicts: outcome.target.link.conflicts, live: outcome.target.record.live, retrievedAt: outcome.target.record.retrievedAt,
            pageType: outcome.target.record.pageType, identifierMatch: outcome.target.link.identifierMatch
        } : null,
        targetReason: outcome.targetReason,
        candidates: outcome.records.filter(entry => entry !== outcome.target).map(entry => ({
            provider: entry.record.provider, url: entry.record.url, stage: entry.record.publicationStage,
            relation: entry.link.relation, rule: entry.link.rule, title: entry.record.title.slice(0, 120),
            record: {
                itemType: entry.record.itemType, title: entry.record.title, creators: entry.record.creators, fields: entry.record.fields,
                identifiers: entry.record.identifiers, pageType: entry.record.pageType, live: entry.record.live, retrievedAt: entry.record.retrievedAt,
                collected: entry.record.collected ? Object.fromEntries(Object.entries(entry.record.collected.fields).map(([field, report]) => [field, { status: report.status, source: report.source }])) : undefined
            },
            evidence: entry.link.evidence, conflicts: entry.link.conflicts, notes: entry.link.notes
        })),
        corrections: outcome.corrections, fieldConflicts: outcome.fieldConflicts || [], cancelled: outcome.cancelled,
        provenance: outcome.provenance, unresolved: outcome.unresolved, notes: outcome.notes, elapsedMs: outcome.elapsedMs,
        discoveries: outcome.discoveries, assist: outcome.assist,
        clues: { kind: clues.kind, titles: clues.titles, surnames: clues.surnames, years: clues.years, identifiers: clues.identifiers, ...(clues.carried ? { carried: clues.carried } : {}), citation: clues.citation?.raw, ocr: clues.ocr },
        ...(located && clues.coordinates ? { coordinates: { printed: clues.coordinates, queries: located.queries, reason: located.reason,
                ...(located.chosen ? { basis: located.chosen.basis, doi: located.chosen.record.identifiers.DOI } : {}) } } : {})
    };
    if (!outcome.target)
        return { record, metadata: null, typeRead: false, evidence: null, linked: null };
    const target = outcome.target.record;
    const itemType = documentType || target.itemType || (input.documentBase ? proposalType : '') || 'document';
    const { creators = [], ...fields } = outcome.fields;
    const metadata = snapshotFrom(input.parent, input.before, itemType, fields, creators);
    const linked = snapshotFrom(input.parent, input.before, target.itemType || itemType, { ...target.fields, title: target.title }, target.creators as any);
    const stated: LinkRecord['stated'] = {};
    for (const [field, value] of Object.entries({ ...target.fields, title: target.title })) {
        if (value === undefined || value === null || value === '')
            continue;
        stated[field] = { value: String(value), ...(field === 'date' ? { role: target.date?.role, precision: target.date?.precision } : {}) };
    }
    if (target.creators.length)
        stated.creators = { value: target.creators.map(person => person.firstName ? printedName(person) : person.lastName).join('; ') };
    if (target.itemType && target.itemType !== 'document' && target.typeStated !== false)
        stated.itemType = { value: target.itemType };
    const link: LinkRecord = {
        provider: target.provider, url: target.url, retrievedAt: target.retrievedAt, live: target.live,
        relation: outcome.target.link.relation, rule: outcome.target.link.rule, evidence: outcome.target.link.evidence,
        stage: target.publicationStage, stated
    };
    const identity = outcome.target.link.identifierMatch
        ? identityFromIdentifier(target.identifiers.DOI ? { kind: 'DOI', value: target.identifiers.DOI } : { kind: 'ISBN', value: target.identifiers.ISBN[0] }, { itemType, fields }, 'printedInDocument', '', clues.text)
        : undefined;
    return {
        record, metadata, linked, typeRead: !!documentType || !!target.itemType || (!!input.documentBase && !!proposalType),
        evidence: {
            observation: observation('externalRecord', `${target.provider}:${target.url}`, JSON.stringify({ url: target.url, retrievedAt: target.retrievedAt, stated }, null, 0)),
            link, identity
        }
    };
}
function documentPagesOf(input: RestoreStepInput): number | undefined {
    const told = Number(input.proposal?.documentPages);
    if (Number.isInteger(told) && told > 0)
        return told;
    const counted = Number(input.pages.find(page => Number.isInteger(page.pageCount))?.pageCount);
    return Number.isInteger(counted) && counted > 0 ? counted : undefined;
}
const COORDINATES_RULE = 'citation coordinates printed on the page pick out exactly one registry record';
function linkedByCoordinates(located: CoordinatesAnswer, clues: DocumentClues, documentFields: Record<string, any>, required: string[], local: LocalStanding, ledger: ProviderLedger): RestoreOutcome {
    const chosen = located.chosen!;
    const at = clues.coordinates!;
    const record = chosen.record;
    const target: Linked = { record, link: { relation: 'sameEdition', identifierMatch: true, evidence: chosen.evidence, conflicts: [],
            titleScore: at.title ? titleSimilarity(at.title, record.title) : 0, rule: COORDINATES_RULE } };
    const others: Linked[] = located.refused.map(entry => ({ record: entry.record,
        link: { relation: 'unknown', identifierMatch: false, evidence: [], conflicts: [entry.reason], titleScore: 0, rule: entry.reason } }));
    const standing: LocalStanding = { text: clues.text, years: clues.years, ocr: clues.ocr, sources: clues.sources, ...local };
    const merged = mergeFields(documentFields, target, [], { local: standing });
    const missing = required.filter(field => { const value = merged.fields[field]; return value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length); });
    return {
        status: 'linked',
        queries: located.queries.map(url => ({ kind: 'coordinates' as const, text: url, providers: ['crossref'] as ProviderId[], asked: true,
            note: 'the citation coordinates the page prints (journal or ISSN, volume, year, pages)' })),
        records: [target, ...others],
        target, targetReason: `${record.publicationStage} record, ${COORDINATES_RULE} — ${located.reason}`,
        fields: merged.fields, provenance: merged.provenance, log: ledger.log, providers: ledger.summary(),
        unresolved: missing.map(field => `${field}: not stated by the page or by a linked record`), notes: merged.notes, elapsedMs: ledger.elapsedMs(),
        discoveries: [], assist: [], corrections: merged.corrections, fieldConflicts: merged.conflicts, cancelled: false
    };
}
function withCoordinateCandidates(outcome: RestoreOutcome, located: CoordinatesAnswer | null): RestoreOutcome {
    if (!located)
        return outcome;
    const known = new Set(outcome.records.map(entry => entry.record.identifiers.DOI || entry.record.url));
    const listed = located.refused.filter(entry => !known.has(entry.record.identifiers.DOI || entry.record.url)).map(entry => ({ record: entry.record,
        link: { relation: 'unknown' as const, identifierMatch: false, evidence: [], conflicts: [entry.reason], titleScore: 0, rule: entry.reason } }));
    return {
        ...outcome,
        status: outcome.status === 'none' && listed.length ? 'candidates' : outcome.status,
        queries: [...located.queries.map(url => ({ kind: 'coordinates' as const, text: url, providers: ['crossref'] as ProviderId[], asked: true,
                note: `the citation coordinates the page prints — ${located.reason}` })), ...outcome.queries],
        records: [...listed, ...outcome.records],
        notes: [`coordinates: ${located.reason}`, ...outcome.notes]
    };
}
export function restoreSummary(record: RestoreRecord): string {
    if (record.target && record.coordinates?.basis) {
        return `쪽이 찍은 좌표로 찾은 ${record.target.provider} 기록(${record.target.pageType}, ${record.target.live ? '실시간' : '고정 응답'})을 이 문서의 기록으로 연결 — ${record.target.rule}; ${record.target.evidence.join('; ')}`;
    }
    if (record.target) {
        return `검색으로 찾은 ${record.target.provider} 기록(${record.target.pageType}, ${record.target.live ? '실시간' : '고정 응답'})을 이 문헌·판본에 연결 — ${record.target.rule}; ${record.target.evidence.join('; ')}`;
    }
    const spent = Object.entries(record.providers).map(([provider, row]) => `${provider} ${row.calls}회(${Object.entries(row.outcomes).map(([kind, count]) => `${kind} ${count}`).join(', ')})${row.blocked ? ' · 중단' : ''}`).join(' / ');
    const head = record.status === 'candidates' ? `검색 후보는 있으나 이 판본과의 연결이 확인되지 않아 보류 — ${record.targetReason}`
        : record.status === 'budget' ? '검색 예산 안에서 후보를 확인하지 못함'
            : '검색에서 이 문헌의 기록을 찾지 못함 — 시도한 출처와 응답만 기록';
    return `${head}${spent ? ` (${spent})` : ''}`;
}

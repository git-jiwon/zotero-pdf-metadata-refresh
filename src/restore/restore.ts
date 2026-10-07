import type { DocumentClues, ProviderId, SearchQuery } from './clues';
import { buildQueries } from './clues';
import { ProviderLedger, type FetchOutcome } from './outcome';
import { aladinLookup, arxivSearch, crossrefByDOI, crossrefSearch, halSearch, nlkLookup, yes24Search, zoteroISBN, type ExternalRecord, type ProviderContext, type ProviderResult } from './records';
import { type FieldConflict, chooseCitationTarget, judgeLink, mergeFields, type Correction, type FieldProvenance, type Linked, type LocalStanding } from './link';
import { googleDiscover, googleSearchURL, type GoogleDiscovery } from './google';
export interface RestoreInput {
    clues: DocumentClues;
    documentFields: Record<string, any>;
    required: string[];
    pending?: Record<string, any>;
    context: ProviderContext;
    providers?: ProviderId[];
    local?: LocalStanding;
    followRegistry?: boolean;
}
export interface RestoreOutcome {
    status: 'linked' | 'candidates' | 'none' | 'budget';
    queries: Array<SearchQuery & {
        asked: boolean;
        skipped?: string;
    }>;
    records: Array<{
        record: ExternalRecord;
        link: Linked['link'];
    }>;
    target: Linked | null;
    targetReason: string;
    fields: Record<string, any>;
    provenance: Record<string, FieldProvenance>;
    log: FetchOutcome[];
    providers: ReturnType<ProviderLedger['summary']>;
    unresolved: string[];
    notes: string[];
    elapsedMs: number;
    discoveries: GoogleDiscovery['search'][];
    assist: Array<{
        query: string;
        url: string;
        reason: string;
    }>;
    corrections: Correction[];
    fieldConflicts: FieldConflict[];
    cancelled: boolean;
}
const DEFAULT_PROVIDERS: ProviderId[] = ['crossref', 'yes24', 'zoteroISBN', 'aladin', 'nlk', 'arxiv', 'hal', 'google'];
async function ask(query: SearchQuery, provider: ProviderId, ctx: ProviderContext): Promise<ProviderResult> {
    switch (provider) {
        case 'crossref': return query.kind === 'doi' ? crossrefByDOI(query.text, ctx) : crossrefSearch(query.text, ctx);
        case 'yes24': return yes24Search(query.text, ctx);
        case 'zoteroISBN': return zoteroISBN(query.text, ctx);
        case 'aladin': return aladinLookup(query.text, ctx);
        case 'nlk': return nlkLookup(query.text, ctx);
        case 'arxiv': return arxivSearch(query.text, ctx);
        case 'hal': return halSearch(query, ctx);
        default: return { outcome: { kind: 'rejected', provider, url: '', finalURL: '', status: 0, fetchedAt: new Date().toISOString(), ms: 0, method: 'api', live: false, note: 'no adapter' }, records: [] };
    }
}
const missingRequired = (fields: Record<string, any>, required: string[]) => required.filter(field => { const value = fields[field]; return value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length); });
export async function restoreBySearch(input: RestoreInput): Promise<RestoreOutcome> {
    const { clues, context } = input;
    const ledger = context.ledger;
    const allowed = new Set(input.providers || DEFAULT_PROVIDERS);
    const followRegistry = input.followRegistry ?? (allowed.has('crossref') || (allowed.size === 1 && allowed.has('google')));
    const queries = buildQueries(clues).map(query => ({ ...query, asked: false as boolean, skipped: undefined as string | undefined }));
    const seen = new Map<string, Linked>();
    const followed = new Set<string>();
    const notes: string[] = [];
    const unresolved: string[] = [];
    const discoveries: GoogleDiscovery['search'][] = [];
    const assist: Array<{
        query: string;
        url: string;
        reason: string;
    }> = [];
    const offerAssist = (query: SearchQuery, reason: string) => {
        if (assist.length >= 3 || assist.some(entry => entry.query === query.text))
            return;
        assist.push({ query: query.text, url: googleSearchURL(query.text, clues.script), reason });
    };
    const consider = (record: ExternalRecord) => {
        const key = `${record.provider}:${record.identifiers.DOI || record.identifiers.ISBN[0] || record.url}`;
        const known = seen.get(key);
        if (known)
            return known;
        const link = judgeLink(clues, record);
        const entry = { record, link };
        seen.set(key, entry);
        return entry;
    };
    const settled = () => {
        const chosen = chooseCitationTarget([...seen.values()]);
        if (!chosen.target)
            return false;
        const merged = mergeFields(input.documentFields, chosen.target, [...seen.values()].filter(entry => entry !== chosen.target), { local });
        return missingRequired({ ...(input.pending || {}), ...merged.fields }, input.required).length === 0;
    };
    const cancelled = () => !!context.cancelled?.();
    const local: LocalStanding = { text: clues.text, years: clues.years, ocr: clues.ocr, sources: clues.sources, ...(input.local || {}) };
    const passes: ProviderId[][] = [[...allowed].filter(provider => provider !== 'google'), allowed.has('google') ? ['google'] : []];
    for (const pass of passes) {
        if (!pass.length)
            continue;
        for (const query of queries) {
            if (settled() || cancelled())
                break;
            const providers = query.providers.filter(provider => pass.includes(provider));
            if (!providers.length) {
                if (!query.asked && !query.skipped)
                    query.skipped = 'no allowed provider for this query';
                continue;
            }
            if (!query.asked) {
                const budget = ledger.canSearch();
                if (!budget.ok) {
                    query.skipped = budget.reason;
                    continue;
                }
                ledger.noteSearch();
                query.asked = true;
                query.skipped = undefined;
            }
            for (const provider of providers) {
                if (ledger.exhausted() || cancelled())
                    break;
                let answer: ProviderResult;
                if (provider === 'google') {
                    const found = await googleDiscover(query, clues, context, {
                        allowCrossref: followRegistry,
                        settled: record => judgeLink(clues, record).relation === 'sameEdition'
                    });
                    discoveries.push(found.search);
                    answer = { outcome: found.outcome, records: found.records };
                    if (found.outcome.kind !== 'record')
                        offerAssist(query, found.outcome.kind === 'blocked' ? `Google 차단: ${found.outcome.note}` : found.outcome.kind === 'noMatch' ? `자동 검색은 결과를 읽지 못함: ${found.outcome.note}` : found.outcome.note);
                }
                else
                    answer = await ask(query, provider, context);
                if (answer.outcome.kind === 'record' && answer.records.length) {
                    for (const record of answer.records)
                        consider(record);
                    for (const record of answer.records) {
                        for (const doi of record.relations.isPreprintOf.slice(0, 1)) {
                            if (!followRegistry || ledger.exhausted() || seen.has(doi) || followed.has(doi))
                                continue;
                            followed.add(doi);
                            const published = await crossrefByDOI(doi, context);
                            for (const found of published.records)
                                consider(found);
                            if (published.outcome.kind !== 'record')
                                notes.push(`published version ${doi} named by ${record.provider} could not be fetched: ${published.outcome.kind} — ${published.outcome.note}`);
                        }
                    }
                }
                else if (answer.outcome.kind !== 'noMatch') {
                    notes.push(`${provider}: ${answer.outcome.kind} — ${answer.outcome.note}`);
                }
                if (settled())
                    break;
                if (seen.size && [...seen.values()].some(entry => entry.link.relation === 'sameEdition' && entry.link.identifierMatch))
                    break;
            }
        }
    }
    if (allowed.has('hal') && !cancelled() && !ledger.exhausted()) {
        const thesis = chooseCitationTarget([...seen.values()]).target;
        const doi = thesis && thesis.link.relation === 'sameEdition' && thesis.record.itemType === 'thesis' ? thesis.record.identifiers.DOI : undefined;
        if (doi && ![...seen.values()].some(entry => entry.record.provider === 'hal')) {
            const answer = await halSearch({ kind: 'doi', text: doi, providers: ['hal'], note: 'the open-archive deposit of the linked thesis record' }, context);
            for (const record of answer.records)
                consider(record);
            if (answer.outcome.kind !== 'record' && answer.outcome.kind !== 'noMatch')
                notes.push(`hal: ${answer.outcome.kind} — ${answer.outcome.note}`);
        }
    }
    const linked = [...seen.values()];
    const chosen = chooseCitationTarget(linked);
    const target = chosen.target;
    const merged = target
        ? mergeFields(input.documentFields, target, linked.filter(entry => entry !== target), { local })
        : { fields: { ...input.documentFields }, provenance: {} as Record<string, FieldProvenance>, notes: [] as string[], corrections: [] as Correction[], conflicts: [] as FieldConflict[] };
    notes.push(...merged.notes);
    for (const field of missingRequired({ ...(input.pending || {}), ...merged.fields }, input.required))
        unresolved.push(`${field}: not stated by the page or by a linked record`);
    for (const entry of linked) {
        if (entry.link.relation === 'conflict')
            unresolved.push(`${entry.record.provider} ${entry.record.url}: ${entry.link.rule}`);
        if (entry.link.relation === 'sameWork' && entry !== target)
            unresolved.push(`${entry.record.provider} ${entry.record.url}: same work, version not settled (${entry.record.publicationStage})`);
    }
    if (!target)
        for (const query of queries)
            if (query.providers.includes('google') && !['doi', 'isbn'].includes(query.kind))
                offerAssist(query, query.asked ? '자동 검색이 이 판본을 연결하지 못함' : `자동 검색 미실행: ${query.skipped || '예산'}`);
    const askedAny = queries.some(query => query.asked);
    const status: RestoreOutcome['status'] = target ? 'linked'
        : linked.length ? 'candidates'
            : !askedAny && queries.some(query => query.skipped?.includes('budget')) ? 'budget'
                : ledger.exhausted() ? 'budget' : 'none';
    return {
        status, queries, records: linked.map(entry => ({ record: entry.record, link: entry.link })),
        target, targetReason: chosen.reason,
        fields: merged.fields, provenance: merged.provenance,
        log: ledger.log, providers: ledger.summary(), unresolved, notes, elapsedMs: ledger.elapsedMs(),
        discoveries, assist, corrections: merged.corrections, fieldConflicts: merged.conflicts, cancelled: cancelled()
    };
}

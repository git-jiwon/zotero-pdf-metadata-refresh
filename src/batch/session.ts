import { resetRecognitionAttempt } from './attempt';
import { recognizeFromOCRText, newOCRTrace, type OCRRecognition } from '../recognition/ocr';
import { getInternationalSearch } from '../ocr/lm-studio';
import { matchesFingerprint } from '../metadata/snapshot';
import type { RunMetrics } from './row';
import type { ApprovalState } from './approval';
import { observation, type Observation, type ObservationKind, type IdentityDecision } from './evidence';
import { runRecognitionPipeline } from './pipeline';
import { folioRunOfPageAnswers, readVisionPage } from '../ocr/vision-record';
import { emptyFieldsFilledBy, mergeSources, type MergeContext, type MergeOutcome, type MergeSource } from './source-merge';
import type { RecognitionResult } from '../types';
import type { FieldChange, MetadataSnapshot } from '../types';
import { snapshotItem, emptyRecord } from '../metadata/snapshot';
import { restoreSnapshot } from '../metadata/apply';
import { recognizeFromPDF } from '../recognition/recognize-from-pdf';
import { recognizeKoreanPatent, recognizeKoreanPatentText, shouldTryKoreanPatent } from '../recognition/korean-patent';
import { readEmbeddedUSPatentNumber, recognizePrintedUSPatent } from '../recognition/us-patent';
import { selectPrimaryPDF } from '../utils/attachments';
import { isStandalonePDF } from '../utils/recognition-target';
import { detachCreatedParent } from '../metadata/create-parent';
import { creatorsFromText, isKnownItemType } from '../metadata/creator-text';
import { printedName } from '../metadata/person-name';
import { recognizeFromTextIdentifiers, recordIsTheReadWork, titleSupportedByPDF, type IdentifierLookup } from '../recognition/pdf-identifiers';
import { readBodySample, readPDFFrontMatter } from '../recognition/pdf-text';
import { readCoverPages } from '../recognition/cover-candidate';
import { isNotATitle } from '../recognition/title-guards';
import { koreanTitleBesideRecord } from '../recognition/title-block';
import { autoKorean, titlesOfTheWorksPages } from '../recognition/korean-auto';
import { buildDiff } from '../metadata/diff';
import { fileIdentity, RECOGNITION_PIPELINE_VERSION, type RecognitionCacheEntry } from './cache';
import { type EligibilityReason } from './approval';
import { DEFAULT_METHODS, type RecognitionMethods, type Row, type Status } from './row';
import { applyEvaluation, evaluateRecognition, reclassifyCachedRow as reclassify } from './evaluate';
import { brokenLayerPages, documentBodyScript, documentExtent, documentProfile, documentText, identityFromIdentifier, pageStructureOf, scopeOfRecord, verifyFields, type EvidenceBundle } from './evidence';
import { phaseOutcome, restoreGate, restoreHeld } from './restore-gate';
import { buildWritePlan, createPlannedParent, writePlannedChanges, type WritePlan, type WriteResult } from '../metadata/write-service';
import { clearRecognitionCache, pdfInputFingerprint, readRecognitionCache, writeRecognitionCache } from './cache';
import { addPDFExclusion, isItemExcluded, isPDFExcluded, removePDFExclusion } from './exclusions';
import { restoreKeysFromPrefs, restoreLimitsFromPrefs, restoreStep, type RestoreRecord } from './restore-step';
import { recordApproval } from './approval';
import { approvalScopeFor } from '../metadata/write-service';
import { rowStanding } from './status-label';
import { appliedRecord, appliedRecordOf, failureReason, fieldCountsOf, isAppliedStatus, notWrittenOf, setCreatedParentEstimator, skipCodeOf, type ApplyRun, type AppliedRecord, type SkipCode } from './applied-record';
import { snapshotFrom } from '../recognition/international-catalog';
import { reportCompletion } from './completion';
import { zoteroFetcher, type Fetcher } from '../restore/outcome';
import { zoteroBrowser, type BrowserFactory } from '../restore/browser';
import type { ProviderId } from '../restore/clues';
import type { CoverObservations, CoverProposal } from '../recognition/cover-candidate';
import { buildCandidate } from '../recognition/candidate';
import { markWorkOpening, readPageRanges } from '../recognition/roles';
import { freeLeaf, leafPages, placeOf, roleOf, titleOrder } from '../recognition/page-structure';
import { asPartOf, asWholeOf, type ScopedRecord } from '../restore/link';
import type { LinkRecord } from './evidence';
import { recognizeFromReference, recognizeFromWebPage } from '../recognition/web-metadata';
import { isResearchSquare } from '../metadata/publication-state';
import { bodyLanguageOf, folioOfAnotherPage, guessesOfAReading, titleUnderContract } from './field-contract';
import { resolvePublishedVersion } from '../recognition/published-followup';
import { getLMStudioSettings } from '../ocr/lm-studio';
import { peopleOfField } from '../recognition/byline-row';
import { abstainedEverywhere, coverOfASerial, engineStalled, fullestByline, partialByline, runLMStudioVisionOCR, VISION_STEPS, type VisionReadOptions, type VisionRenderOptions } from '../ocr/lm-studio-vision';
import { pagesFromOCRText } from '../recognition/zotero-pages';
export type { RecognitionMethods, Status, Row, RunMetrics } from './row';
export { DEFAULT_METHODS } from './row';
export { substantiveChanges, adviseAgainst, statusFor, recommendedChanges, needsReview, sanitizeRecognizedTitle, sanitizeCreators, evaluateRecognition, applyEvaluation, fieldsLostToTypeChange } from './evaluate';
export const STRONG_LOCAL_CONFIDENCE = 0.8;
export function reclassifyCachedRow(row: Row): void {
    reclassify(row, RECOGNITION_PIPELINE_VERSION);
}
export function isApplicable(row: Row): boolean {
    return row.changes.length > 0 && !['pending', 'applying', 'updated', 'excluded', 'noPDF', 'multiplePDFs', 'missingFile'].includes(row.status);
}
export function isSelectable(row: Pick<Row, 'status'>): boolean {
    return !['applying', 'noPDF', 'multiplePDFs', 'missingFile'].includes(row.status);
}
export function chosenValue(row: Row, change: FieldChange): FieldChange {
    const edited = row.fieldEdit?.[change.field];
    if (edited === undefined)
        return change;
    if (change.field === 'creators')
        return { ...change, newValue: creatorsFromText(edited, change.newValue) };
    if (change.field === 'itemType')
        return isKnownItemType(edited) ? { ...change, newValue: edited.trim() } : change;
    return { ...change, newValue: edited };
}
export function writePlanFor(row: Row, fields: Set<string>): WritePlan {
    return buildWritePlan(row, fields, RECOGNITION_PIPELINE_VERSION, chosenValue);
}
export function applySkipCode(row: Row, fields: Set<string>): SkipCode | null {
    return skipCodeOf(row, isApplicable(row) ? writePlanFor(row, fields) : undefined, RECOGNITION_PIPELINE_VERSION);
}
setCreatedParentEstimator(row => writePlanFor({ ...row, status: 'review' }, new Set((row.changes || []).map((change: FieldChange) => change.field))).changes);
export function eligibility(row: Row, fields: Set<string>): EligibilityReason[] {
    const plan = writePlanFor(row, fields);
    return row.changes.map(change => plan.decided.find(entry => entry.field === change.field)
        || { field: change.field, eligible: false, code: 'notSelected' as const, reason: '선택되지 않았습니다' });
}
export function eligibleChanges(row: Row, fields: Set<string>): FieldChange[] {
    return writePlanFor(row, fields).changes;
}
export function allowedChanges(row: Row, fields: Set<string>): FieldChange[] {
    const included = (change: FieldChange) => {
        const choice = row.fieldChoice?.[change.field];
        return choice === undefined ? fields.has(change.field) : choice;
    };
    const selected = row.changes.filter(included).map(change => chosenValue(row, change));
    const typeChange = row.changes.find(c => c.field === 'itemType');
    if (!typeChange || fields.has('itemType') || !row.before)
        return selected;
    return selected.filter(change => {
        if (change.field === 'creators')
            return false;
        const id = Zotero.ItemFields.getID(change.field);
        return !!id && Zotero.ItemFields.isValidForType(id, row.before!.itemTypeID);
    });
}
function normalizeLegacyOutcome(row: Row): void {
    if (row.status === 'noMatch' && row.error === '추출 가능한 한국어 없음') {
        row.koreanAttempted = false;
        row.error = 'Zotero Native 인식 결과 없음 · PDF 앞부분이 영문/비한국어이므로 RISS·KCI·DBpia 검색은 수행하지 않음';
    }
    if (row.status === 'failed' && /인식 이후 PDF 파일이 바뀌었습니다/.test(String(row.error || '')) && row.rawRecognized && !row.applied) {
        row.status = 'review';
        delete row.error;
    }
}
export function sourcesAfterTheRestoreLink(combined: MergeSource, linked: {
    label: string;
    metadata: MetadataSnapshot;
    linkedAbstract?: unknown;
} | null, earlier: MergeSource[]): MergeSource[] {
    const abstractOf = (value: unknown): Record<string, string> => typeof value === 'string' && value.trim() ? { abstractNote: value } : {};
    const abstractOnly = (source: MergeSource): MergeSource => ({ ...source, metadata: { ...source.metadata, fields: abstractOf(source.metadata?.fields?.abstractNote) as any, creators: [] } });
    return [
        combined,
        ...earlier.filter(source => source.kind === 'link' && Object.keys(abstractOf(source.metadata?.fields?.abstractNote)).length).map(abstractOnly),
        ...(linked ? [{ kind: 'link' as const, label: linked.label, metadata: { ...linked.metadata, fields: abstractOf(linked.linkedAbstract) as any } }] : []),
        ...earlier.filter(source => source.kind === 'layer')
    ];
}
function combineRestore(first: RestoreRecord, second: RestoreRecord): RestoreRecord {
    const queries = [...first.queries];
    for (const query of second.queries) {
        const known = queries.find(entry => entry.kind === query.kind && entry.text === query.text);
        if (!known)
            queries.push(query);
        else if (query.asked) {
            known.asked = true;
            known.skipped = undefined;
        }
    }
    const providers: RestoreRecord['providers'] = { ...first.providers };
    for (const [provider, row] of Object.entries(second.providers)) {
        const held = providers[provider];
        providers[provider] = held
            ? { calls: held.calls + row.calls, outcomes: Object.fromEntries([...new Set([...Object.keys(held.outcomes), ...Object.keys(row.outcomes)])].map(kind => [kind, (held.outcomes[kind] || 0) + (row.outcomes[kind] || 0)])), blocked: row.blocked || held.blocked }
            : row;
    }
    const seen = new Set(first.candidates.map(entry => `${entry.provider}:${entry.url}`));
    const target = second.target || first.target;
    return {
        ...second,
        status: target ? 'linked' : (first.candidates.length || second.candidates.length) ? 'candidates' : second.status,
        queries, providers, log: [...first.log, ...second.log],
        target, targetReason: second.target ? second.targetReason : first.target ? first.targetReason : second.targetReason,
        candidates: [...first.candidates, ...second.candidates.filter(entry => !seen.has(`${entry.provider}:${entry.url}`))],
        provenance: Object.keys(second.provenance).length ? second.provenance : first.provenance,
        unresolved: second.unresolved, notes: [...first.notes, ...second.notes], elapsedMs: first.elapsedMs + second.elapsedMs,
        discoveries: [...first.discoveries, ...second.discoveries], assist: target ? [] : second.assist.length ? second.assist : first.assist,
        corrections: [...first.corrections, ...second.corrections], cancelled: first.cancelled || second.cancelled,
        ...(second.coordinates || first.coordinates ? { coordinates: second.coordinates || first.coordinates } : {})
    };
}
const EARLIER_JOBS_CONSULTED = 10;
interface VisionReading {
    metadata: MetadataSnapshot;
    proposal: CoverProposal | null;
    source: string;
    record?: MetadataSnapshot | null;
    sources?: MergeSource[];
}
interface StructuredReading {
    reading: VisionReading;
    confirmed: boolean;
    note: string;
    kind?: OCRRecognition['kind'];
    parsed?: MetadataSnapshot | null;
}
const DOCUMENT_READINGS = new Set<ObservationKind>(['pdfText', 'pdfLayout', 'pdfMetadata', 'ocrText']);
const ACCEPTED_RECORD = /: the pipeline accepted this record as the document's$/;
interface CarriedChoices {
    fieldChoice: Record<string, boolean>;
    fieldEdit: Record<string, string>;
    proposed: Record<string, string>;
}
function personChoices(row: Pick<Row, 'changes' | 'fieldChoice' | 'fieldEdit' | 'advice'>): CarriedChoices | undefined {
    const proposed = Object.fromEntries((row.changes || []).map(change => [change.field, JSON.stringify(change.newValue ?? '')]));
    const fieldChoice = Object.fromEntries(Object.entries(row.fieldChoice || {})
        .filter(([field, chosen]) => field in proposed && (chosen === true || !row.advice?.[field])));
    const fieldEdit = Object.fromEntries(Object.entries(row.fieldEdit || {}).filter(([field]) => field in proposed));
    if (!Object.keys(fieldChoice).length && !Object.keys(fieldEdit).length)
        return undefined;
    return { fieldChoice, fieldEdit, proposed };
}
function restoreRow(row: Row, held: Row): void {
    for (const key of Object.keys(row))
        if (!(key in held))
            delete (row as any)[key];
    Object.assign(row, held);
}
function cloneValue<T>(value: T): T {
    return typeof (globalThis as any).structuredClone === 'function' ? (globalThis as any).structuredClone(value) : JSON.parse(JSON.stringify(value));
}
export const THESIS_WORD = /(?:학위논문|석사학위|박사학위|(?<!\p{L})(?:thesis|dissertation)(?!\p{L}))/iu;
function withoutStoredValues(before: MetadataSnapshot): MetadataSnapshot {
    return { ...before, fields: {}, creators: [] };
}
export class BatchSession {
    rows: Row[];
    busy = false;
    cancel = false;
    stopNote = '';
    methods: RecognitionMethods = { ...DEFAULT_METHODS };
    overwriteFromDocument = true;
    progress = '';
    metrics: RunMetrics = { operation: '', startedAt: 0, endedAt: 0, total: 0, completed: 0, currentTitle: '', lastItemMs: 0 };
    lastApply?: ApplyRun;
    lastRun?: ApplyRun;
    path: string;
    onChange: () => void = () => { };
    constructor(items: any[], path?: string) {
        this.path = path || PathUtils.join(Zotero.DataDirectory.dir, 'pdf-metadata-refresh-jobs', `${Date.now()}`);
        this.rows = items.map(item => ({ id: item.id, key: item.key, libraryID: item.libraryID, title: item.getField('title'), status: 'pending', checked: false, changes: [] }));
    }
    async initialize() {
        await IOUtils.makeDirectory(this.path, { ignoreExisting: true, createAncestors: true });
        await IOUtils.writeJSON(PathUtils.join(this.path, 'job.json'), { version: 1, rows: this.rows.map(r => ({ id: r.id, key: r.key, libraryID: r.libraryID, title: r.title })) }, { tmpPath: PathUtils.join(this.path, 'job.tmp') });
        await this.carryDecisionsFromEarlierJobs();
    }
    private async carryDecisionsFromEarlierJobs(): Promise<void> {
        let open = this.rows.filter(row => !row.reportFlag && !row.approvals && !row.protections);
        if (!open.length)
            return;
        try {
            const base = PathUtils.join(Zotero.DataDirectory.dir, 'pdf-metadata-refresh-jobs');
            if (!await IOUtils.exists(base))
                return;
            const own = PathUtils.filename(this.path);
            const jobs = ((await IOUtils.getChildren(base)) as string[])
                .filter(path => /^\d+$/.test(PathUtils.filename(path)) && PathUtils.filename(path) !== own)
                .sort((a, b) => Number(PathUtils.filename(b)) - Number(PathUtils.filename(a)))
                .slice(0, EARLIER_JOBS_CONSULTED);
            for (const job of jobs) {
                const left: Row[] = [];
                for (const row of open) {
                    const file = PathUtils.join(job, `${row.id}.json`);
                    const saved = await IOUtils.exists(file) ? await IOUtils.readJSON(file).catch(() => null) : null;
                    if (!saved || saved.key !== row.key || saved.libraryID !== row.libraryID) {
                        left.push(row);
                        continue;
                    }
                    if (saved.reportFlag)
                        row.reportFlag = true;
                    if (saved.approvals && Object.keys(saved.approvals).length)
                        row.approvals = saved.approvals;
                    if (saved.protections && Object.keys(saved.protections).length)
                        row.protections = saved.protections;
                    const choices = personChoices(saved);
                    if (choices)
                        this.earlierChoices.set(row.id, choices);
                }
                open = left;
                if (!open.length)
                    break;
            }
        }
        catch (cause) {
            Zotero.debug(`[PDF Metadata Refresh] earlier job decisions not carried: ${String(cause)}`);
        }
    }
    async exportReport(): Promise<{
        path: string;
        rows: number;
    }> {
        const flagged = this.rows.filter(row => row.reportFlag);
        if (!flagged.length)
            throw new Error('확인 필요로 표시한 행이 없습니다.');
        const cut = (value: unknown): unknown => {
            if (typeof value === 'string')
                return value.length > 20000 ? value.slice(0, 20000) + '…[' + (value.length - 20000) + '자 생략]' : value;
            if (Array.isArray(value))
                return value.map(cut);
            if (value && typeof value === 'object') {
                const layout = (value as any).kind === 'pdfLayout' && typeof (value as any).text === 'string';
                return Object.fromEntries(Object.entries(value as any).map(([key, inner]) => [key, layout && key === 'text' ? inner : cut(inner)]));
            }
            return value;
        };
        const report = {
            version: 1,
            pipeline: RECOGNITION_PIPELINE_VERSION,
            exportedAt: new Date().toISOString(),
            job: this.path,
            note: '각 행의 evidence에 실제로 읽은 쪽 텍스트(와 레이아웃)가, coverProposal에 판독기가 만든 값과 그 대안이, recognitionSource·attempts에 어느 경로가 답했는지가, restore·restoreGate에 검색이 무엇을 묻고 무엇을 연결했는지가 들어 있습니다.',
            rows: flagged.map(row => cut(row)),
        };
        const folder = PathUtils.join(this.path, 'reports');
        await IOUtils.makeDirectory(folder, { ignoreExisting: true, createAncestors: true });
        const path = PathUtils.join(folder, `report-${Date.now()}.json`);
        await IOUtils.writeJSON(path, report, { tmpPath: path + '.tmp' });
        return { path, rows: flagged.length };
    }
    async save(row: Row) {
        const path = PathUtils.join(this.path, `${row.id}.json`);
        await IOUtils.writeJSON(path, row, { tmpPath: path + '.tmp' });
    }
    static async loadLatest(onProgress?: (done: number, total: number, title?: string) => void, shouldStop?: () => boolean): Promise<BatchSession> {
        const base = PathUtils.join(Zotero.DataDirectory.dir, 'pdf-metadata-refresh-jobs');
        const paths: string[] = await IOUtils.getChildren(base);
        const jobs = paths.filter(p => /^\d+$/.test(PathUtils.filename(p))).sort((a, b) => Number(PathUtils.filename(b)) - Number(PathUtils.filename(a)));
        if (!jobs.length)
            throw new Error('저장된 작업이 없습니다.');
        let path = '', manifest: any = null;
        for (const job of jobs) {
            const candidate = await IOUtils.readJSON(PathUtils.join(job, 'job.json')).catch(() => null);
            if (candidate?.version === 1 && Array.isArray(candidate.rows) && candidate.rows.length) {
                path = job;
                manifest = candidate;
                break;
            }
        }
        if (!manifest)
            throw new Error('열 수 있는 저장된 작업이 없습니다.');
        const session = new BatchSession([], path);
        const total = manifest.rows.length;
        let done = 0, shown = 0;
        try {
            onProgress?.(0, total);
        }
        catch { }
        for (const identity of manifest.rows) {
            if (!Number.isSafeInteger(identity.id) || identity.id <= 0)
                throw new Error('Invalid item ID');
            const file = PathUtils.join(path, `${identity.id}.json`);
            const saved = await IOUtils.exists(file) ? await IOUtils.readJSON(file).catch(() => null) : null;
            const row = saved || { ...identity, status: 'pending', checked: false, changes: [] };
            done++;
            if (Date.now() - shown >= 100 || done === total) {
                shown = Date.now();
                try {
                    onProgress?.(done, total, String(row.title || identity.title || ''));
                }
                catch { }
                await new Promise(resolve => setTimeout(resolve, 0));
                if (shouldStop?.())
                    throw new Error('최근 작업 불러오기를 멈췄습니다.');
            }
            if (row.id !== identity.id || row.key !== identity.key || row.libraryID !== identity.libraryID)
                throw new Error('Invalid saved identity');
            if (row.recognizedWith && row.recognizedWith !== RECOGNITION_PIPELINE_VERSION)
                row.staleGeneration = row.recognizedWith;
            if (row.status === 'applying') {
                row.status = 'failed';
                row.error = '적용 중 중단됨: 현재 metadata와 backup 확인 필요';
                const item = Zotero.Items.get(row.before?.itemID || row.id);
                if (item && row.before?.appliedMetadata && matchesFingerprint(await snapshotItem(item), row.before.appliedMetadata, row.before)) {
                    row.status = 'updated';
                    row.error = '적용 중에 중단됐지만 지금 항목이 적용 지문과 같아 적용된 것으로 봅니다 — 적용한 값은 지문에서 복원했습니다.';
                }
            }
            row.checked = false;
            try {
                normalizeLegacyOutcome(row);
                reclassifyCachedRow(row);
                delete row.reloadError;
            }
            catch (cause) {
                const where = String((cause as any)?.stack || '').split('\n').map(line => (/^\s*(?:at\s+)?([\w$.<>]+)[@\s(]/.exec(line) || [])[1]).filter(Boolean).slice(0, 8).join(' ← ');
                row.reloadError = `${String(cause)}${where ? ` (${where})` : ''}`.slice(0, 400);
                row.match = row.match || { score: null, reasons: [], review: true };
                row.match.reasons = [`불러올 때 지금 규칙으로 다시 판정하지 못해 저장된 판정을 그대로 둡니다 — ${row.reloadError}`, ...(row.match.reasons || []).filter((reason: string) => !reason.startsWith('불러올 때 지금 규칙으로'))];
                session.reloadFailures.push(`${row.key}: ${row.reloadError}`);
                try {
                    Zotero.debug(`[PDF Metadata Refresh] reclassify failed for ${row.key}: ${String(cause)}\n${String((cause as any)?.stack || '')}`);
                }
                catch { }
                await session.save(row).catch(() => undefined);
            }
            session.rows.push(row);
        }
        return session;
    }
    reloadFailures: string[] = [];
    private item(row: Row) {
        let item = Zotero.Items.get(row.id);
        if (item && row.createdParentID && item.parentID === row.createdParentID) {
            const parent = Zotero.Items.get(row.createdParentID);
            if (parent && !parent.deleted)
                return parent;
        }
        const usable = item && !item.deleted && (item.isRegularItem() || isStandalonePDF(item));
        if (!usable || item.key !== row.key || item.libraryID !== row.libraryID)
            throw new Error('항목이 삭제되거나 변경됐습니다.');
        return item;
    }
    private carriedDecisions?: ApprovalState;
    private carriedChoices?: CarriedChoices;
    private earlierChoices = new Map<number, CarriedChoices>();
    private rereading = false;
    private evidence?: EvidenceBundle;
    private noteEvidence(text: unknown, locator: string, options: {
        complete?: boolean;
        kind?: ObservationKind;
    } = {}): void {
        const value = String(text || '');
        if (!value.trim())
            return;
        const bundle = this.evidence || { observations: [] };
        bundle.observations = [...bundle.observations.filter(entry => entry.locator !== locator),
            observation(options.kind || 'pdfText', locator, value, { truncated: !options.complete, index: bundle.observations.length })];
        this.evidence = bundle;
    }
    private noteIdentity(identity: IdentityDecision | undefined): void {
        if (!identity)
            return;
        this.evidence = { ...(this.evidence || {}), observations: this.evidence?.observations || [], identity };
    }
    private noteLink(link: LinkRecord): void {
        const bundle = this.evidence || { observations: [] };
        bundle.links = [...(bundle.links || []).filter(entry => entry.url !== link.url), link];
        this.evidence = bundle;
    }
    private related?: {
        metadata: MetadataSnapshot;
        scope: 'container' | 'part';
        reason: string;
    };
    private scopeOf = (record: {
        itemType?: unknown;
        pages?: unknown;
        numPages?: unknown;
        title?: unknown;
        bookTitle?: unknown;
        creators?: unknown[];
    }) => scopeOfRecord(record, this.evidence);
    private scopeOfMetadata = (metadata: MetadataSnapshot) => this.scopeOf({ itemType: metadata.itemType, ...(metadata.fields || {}), creators: metadata.creators });
    private noteRelated(metadata: MetadataSnapshot, scope: 'container' | 'part', reason: string, row: Row): void {
        if (this.related)
            return;
        this.related = { metadata, scope, reason };
        row.attempts = [...(row.attempts || []), `${scope === 'container' ? '이 문서를 담은 자료' : '이 문서의 한 부분'}의 기록 — 판독의 빈 칸만 채움: ${String(metadata.fields?.title || '').slice(0, 60)} (${reason.slice(0, 120)})`];
    }
    private scoped(metadata: MetadataSnapshot): ScopedRecord {
        const roleOf = (person: any) => {
            if (person?.creatorType)
                return String(person.creatorType);
            try {
                return person?.creatorTypeID ? String(Zotero.CreatorTypes.getName(person.creatorTypeID) || '') || undefined : undefined;
            }
            catch {
                return undefined;
            }
        };
        return { itemType: String(metadata.itemType || ''), fields: { ...(metadata.fields || {}) },
            creators: (metadata.creators || []).map((person: any) => ({ ...person, creatorType: roleOf(person) })) };
    }
    private ownRange(): string {
        const extent = documentExtent(this.evidence);
        if (!extent)
            return '';
        const byPage = new Map<number, string>();
        for (const entry of this.evidence?.observations || []) {
            if (entry.kind !== 'pdfText' && entry.kind !== 'ocrText')
                continue;
            const at = /^(?:OCR )?page (\d+)/.exec(String(entry.locator || ''));
            if (at)
                byPage.set(Number(at[1]), `${byPage.get(Number(at[1])) || ''}\n${String(entry.text || '')}`);
        }
        const pages = [...byPage.entries()].sort((a, b) => a[0] - b[0]);
        const wrapper = pageStructureOf(this.evidence).leadingLeaves;
        const body = extent - wrapper;
        for (const [, text] of pages.filter(([page]) => page > wrapper).slice(0, 2)) {
            for (const range of readPageRanges(text)) {
                const length = Number(range.end) - Number(range.start) + 1;
                if (length > 1 && Math.abs(length - body) <= 2)
                    return `${range.start}-${range.end}`;
            }
        }
        return '';
    }
    private withRelated(row: Row, item: any, before: MetadataSnapshot, reading: MetadataSnapshot, quiet = false, recordFirst = false): MetadataSnapshot {
        const related = this.related;
        if (!related)
            return reading;
        const leaves = leafPages(pageStructureOf(this.evidence));
        const pages = (this.evidence?.observations || [])
            .filter(entry => (entry.kind === 'pdfText' || entry.kind === 'ocrText')
            && !leaves.has(Number(/page (\d+)/.exec(String(entry.locator || ''))?.[1] ?? NaN)))
            .map(entry => String(entry.text || ''));
        const fill = related.scope === 'container'
            ? asPartOf(this.scoped(reading), this.scoped(related.metadata), this.ownRange(), pages, recordFirst)
            : asWholeOf(this.scoped(related.metadata), this.scoped(reading));
        if (!fill) {
            if (related.scope === 'container' && !quiet)
                row.attempts = [...(row.attempts || []), `담은 자료의 기록을 판독에 맞추지 않음: 쪽이 「${String(related.metadata.fields?.title || '').slice(0, 60)}」를 이 글이 실린 자료로 부르지 않음 — 판독이 그대로 섬`];
            return reading;
        }
        if (!quiet)
            row.attempts = [...(row.attempts || []), `${related.scope === 'container' ? '담은 자료의 기록이 판독에 맞춰짐' : '한 부분의 기록으로 문서 전체를 세움'}: ${fill.notes.join(' · ').slice(0, 240)}`];
        const metadata = snapshotFrom(item, before, fill.itemType, fill.fields, fill.creators as any);
        return { ...metadata, typeRead: fill.itemType !== reading.itemType ? true : reading.typeRead } as MetadataSnapshot;
    }
    private rawLayerText(number: number): string {
        const observations = this.evidence?.observations || [];
        const entry = observations.find(candidate => candidate.kind === 'pdfText'
            && (candidate.locator === `page ${number}` || String(candidate.locator || '').startsWith(`page ${number} of `)));
        return String(entry?.text || '');
    }
    private readings = new WeakSet<object>();
    private recordFilled = new WeakMap<object, Record<string, unknown>>();
    private merges = new WeakMap<object, MergeSource[]>();
    private textStageLinks: Array<{
        source: MergeSource;
        links: LinkRecord[];
        records: Observation[];
        rule: string;
    }> = [];
    private restoredRecord: MetadataSnapshot | null = null;
    private untitledReading: MetadataSnapshot | null = null;
    private noteTextStageLink(metadata: MetadataSnapshot, label: string, rule: string, restoreLinked = false): void {
        const links = restoreLinked ? (this.evidence?.links || []).filter(link => link.relation === 'sameEdition' || link.relation === 'sameWork') : [];
        const records = restoreLinked ? (this.evidence?.observations || []).filter(entry => entry.kind === 'externalRecord') : [];
        this.textStageLinks = [...this.textStageLinks.filter(entry => entry.source.metadata !== metadata), { source: { kind: 'link', label, metadata }, links, records, rule }];
    }
    private textStageLinksOfTheReading(row: Row, found: VisionReading): BatchSession['textStageLinks'] {
        if (!this.textStageLinks.length)
            return [];
        const leaves = leafPages(pageStructureOf(this.evidence));
        const pages = (this.evidence?.observations || [])
            .filter(entry => (entry.kind === 'ocrText' || entry.kind === 'pdfText')
            && !leaves.has(Number(/page (\d+)/.exec(String(entry.locator || ''))?.[1] ?? NaN)))
            .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'ocrText' ? -1 : 1))
            .map(entry => String(entry.text || ''));
        const reading = found.metadata;
        return this.textStageLinks.filter(entry => {
            const record = entry.source.metadata, fields = record.fields || {};
            const identity = recordIsTheReadWork({ title: fields.title, creators: record.creators, itemType: record.itemType, DOI: fields.DOI, pages: fields.pages,
                publicationTitle: fields.publicationTitle }, { pages, readTitle: reading.fields?.title, readCreators: reading.creators || [] });
            if (!identity.same)
                row.attempts = [...(row.attempts || []), `텍스트층 단계에서 연결된 기록(${entry.source.label})을 비전 판독에 얹지 않음: ${identity.reason}`];
            return identity.same;
        });
    }
    private candidates = new WeakSet<object>();
    restoreFetcher: Fetcher = zoteroFetcher();
    restoreBrowser: BrowserFactory | null = zoteroBrowser();
    restoreProviders?: ProviderId[];
    private classifyRecognized(row: Row, before: MetadataSnapshot, recognized: MetadataSnapshot, verifiedPDF = false, patentPDF = false, technicalPDF = false, identifierPDF = false) {
        row.rawRecognized = recognized;
        row.evidence = this.evidence;
        const evaluation = evaluateRecognition({
            before,
            recognized,
            route: {
                verifiedPDF, patentPDF, technicalPDF, identifierPDF,
                lookupUnreachable: !!row.lookupUnreachable && !!row.coverProposal?.used,
                ocrRead: !!row.ocrRead && !!row.coverProposal?.used,
                authoritative: !!row.authoritative,
                standalonePDF: !!row.standalonePDF,
                koreanAttempted: !!row.koreanAttempted,
                manualReview: !!row.manualReview,
                overwriteFromDocument: row.replaceMetadata ?? this.overwriteFromDocument,
                independentMetadata: !!row.independentMetadata,
                recognitionSource: String(row.recognitionSource || ''),
                error: row.error
            },
            evidence: this.evidence,
            readings: row.coverProposal?.sources,
            searchedRecords: (row.restore?.candidates || []).map((candidate: any) => candidate?.record).filter(Boolean),
            carried: this.carriedDecisions,
            existing: { approvals: row.approvals, protections: row.protections },
            pdfFingerprint: fileIdentity(row.pdfFingerprint || ''),
            policyVersion: RECOGNITION_PIPELINE_VERSION
        });
        this.carriedDecisions = undefined;
        applyEvaluation(row, evaluation, RECOGNITION_PIPELINE_VERSION);
        if (this.rereading)
            row.checked = true;
        const carried = this.carriedChoices;
        this.carriedChoices = undefined;
        if (carried)
            for (const change of row.changes) {
                if (carried.proposed[change.field] !== JSON.stringify(change.newValue ?? ''))
                    continue;
                const chosen = carried.fieldChoice[change.field], edited = carried.fieldEdit[change.field];
                if (chosen !== undefined)
                    row.fieldChoice = { ...(row.fieldChoice || {}), [change.field]: chosen };
                if (edited !== undefined)
                    row.fieldEdit = { ...(row.fieldEdit || {}), [change.field]: edited };
            }
    }
    private async documentPageCount(row: Row, attachment: any): Promise<number | undefined> {
        const known = Number(row.coverProposal?.documentPages);
        if (Number.isInteger(known) && known > 0)
            return known;
        try {
            const data: any = await Zotero.PDFWorker.getRecognizerData(attachment.id, true);
            const total = Number(data?.totalPages);
            return Number.isInteger(total) && total > 0 ? total : undefined;
        }
        catch {
            return undefined;
        }
    }
    private stoppable<T>(work: Promise<T>): Promise<T> {
        let watcher: any = null;
        const stopped = new Promise<never>((_, reject) => {
            watcher = setInterval(() => { if (this.cancel)
                reject(new Error('Cancelled')); }, 250);
        });
        return Promise.race([work, stopped]).finally(() => clearInterval(watcher));
    }
    private async usPatentOfPrinted(row: Row, item: any, attachment: any, before: MetadataSnapshot, reading: {
        texts: Array<string | null | undefined>;
        readTitles: Array<string | null | undefined>;
        printed: string;
        embedded?: boolean;
    }): Promise<{
        result: RecognitionResult;
        printed: string;
        where: string;
    } | null> {
        if (!this.methods.identifiers || this.cancel)
            return null;
        let embedded: string | null = null;
        if (reading.embedded) {
            try {
                embedded = await readEmbeddedUSPatentNumber(attachment);
            }
            catch {
                embedded = null;
            }
        }
        const skip = (row.lookupNotes || []).filter(note => note.kind === 'US patent' && note.outcome !== 'failed').map(note => note.value);
        let outcome: Awaited<ReturnType<typeof recognizePrintedUSPatent>>;
        try {
            outcome = await this.stoppable(recognizePrintedUSPatent(item, attachment, before, { ...reading, embedded, skip }));
        }
        catch (cause) {
            if (this.cancel)
                return null;
            if (/Safety invariant failed/.test(String(cause)))
                throw cause;
            row.lookupUnreachable = true;
            row.attempts = [...(row.attempts || []), 'US 공보 Google Patents 조회 실패: ' + String(cause).slice(0, 200)];
            return null;
        }
        if (outcome.notes.length)
            row.lookupNotes = [...(row.lookupNotes || []), ...outcome.notes];
        if (outcome.unreachable)
            row.lookupUnreachable = true;
        if (!outcome.result || !outcome.patent) {
            const refused = outcome.notes.map(note => `${note.value}: ${note.reason}`).join(' · ');
            if (refused)
                row.attempts = [...(row.attempts || []), 'US 공보 Google Patents 기록을 받지 않음 — ' + refused.slice(0, 300)];
            return null;
        }
        return { result: outcome.result, printed: outcome.patent.printed, where: outcome.patent.fromFile ? 'PDF 정보 제목의' : '쪽에 인쇄된' };
    }
    private async structuredFromOCR(row: Row, item: any, before: MetadataSnapshot, ocrText: string, pagesText: string, pageCount: number | undefined, readingTitles: string[] = [], reader: Record<string, string> = {}, answers: Array<Record<string, string>> = [], pageTitles: string[] = []): Promise<StructuredReading | null> {
        const layerPages = [1, 2, 3, 4, 5].map(number => this.textLayerPage(number)?.text).filter(Boolean) as string[];
        const layer = layerPages.join('\f');
        if (this.methods.identifiers) {
            try {
                const readCreators = peopleOfField(reader['저자']).filter(entry => !entry.organisation).map(entry => entry.text);
                const readText = [...answers.flatMap(fields => Object.values(fields || {}).map(value => String(value ?? ''))), pagesText].join('\n');
                const lookup = await this.stoppable(recognizeFromTextIdentifiers(item, before, layer ? `${pagesText}\f${layer}` : pagesText, '', { complete: true,
                    readTitle: readingTitles[0], readCreators, scopeOf: this.scopeOfMetadata, readText, ...(layer ? { textLayer: layer } : {}) }));
                row.lookupNotes = [...(row.lookupNotes || []), ...lookup.tried];
                if (lookup.unreachable)
                    row.lookupUnreachable = true;
                const related = lookup.related as IdentifierLookup['related'];
                if (related)
                    this.noteRelated(related.record.metadata, related.scope, related.reason, row);
                if (lookup.record) {
                    row.identifierPDF = true;
                    row.authoritative = true;
                    this.noteIdentity(identityFromIdentifier(lookup.record.identifier, lookup.record.metadata, 'printedInDocument', RECOGNITION_PIPELINE_VERSION, this.evidence || pagesText));
                    row.attempts = [...(row.attempts || []), 'LM Studio OCR → DOI/ISBN 서지정보 확인'];
                    return { reading: { metadata: lookup.record.metadata, proposal: null, source: 'LM Studio OCR → 식별자 서지정보 확인' }, confirmed: true, note: '', kind: 'identifier' };
                }
            }
            catch (cause) {
                if (this.cancel)
                    return null;
                row.lookupUnreachable = true;
                row.attempts = [...(row.attempts || []), 'LM Studio OCR 식별자 조회 실패: ' + String(cause)];
            }
        }
        if (this.cancel)
            return null;
        const trace = newOCRTrace();
        let found: OCRRecognition | null = null;
        try {
            found = await this.stoppable(recognizeFromOCRText(item, before, ocrText, { cancelled: () => this.cancel, pageCount, readingTitles, pageTitles, statedPages: layerPages,
                identifiersTried: true, searchCatalog: this.methods.searchRestore, searchAbroad: this.methods.searchRestore && getInternationalSearch(), trace,
                alsoParse: true, readerFields: reader }));
        }
        catch (cause) {
            if (!this.cancel)
                row.attempts = [...(row.attempts || []), 'LM Studio OCR 구조·카탈로그 대조 실패: ' + String(cause)];
        }
        const confirmed = !!found && ['patent', 'identifier', 'catalog'].includes(found.kind);
        if (!confirmed && trace.steps.length)
            row.attempts = [...(row.attempts || []), 'LM Studio OCR 구조·카탈로그 대조: ' + trace.steps.join(' · ').slice(0, 300)];
        if (!confirmed && trace.candidates.length)
            row.candidates = trace.candidates.slice(0, 5);
        if (!found)
            return null;
        switch (found.kind) {
            case 'patent':
                row.koreanAttempted = true;
                row.patentPDF = true;
                row.authoritative = true;
                row.verifiedPDF = true;
                row.attempts = [...(row.attempts || []), 'LM Studio OCR → 한국 특허 공보 직접 분석'];
                return { reading: { metadata: found.metadata, proposal: null, source: 'LM Studio OCR → 대한민국특허청 공보 분석' }, confirmed: true, note: '', kind: 'patent' };
            case 'identifier':
                row.identifierPDF = true;
                row.authoritative = true;
                row.attempts = [...(row.attempts || []), 'LM Studio OCR → DOI/ISBN 서지정보 확인'];
                return { reading: { metadata: found.metadata, proposal: null, source: 'LM Studio OCR → 식별자 서지정보 확인' }, confirmed: true, note: '', kind: 'identifier' };
            case 'catalog':
                {
                    const scope = this.scopeOfMetadata(found.metadata);
                    if (scope === 'container' || scope === 'part') {
                        const why = `카탈로그의 ${found.metadata.itemType} 기록은 이 문서의 ${scope === 'container' ? '담은 자료' : '한 부분'}입니다 — 문서의 쪽 수와 쪽이 찍은 제 쪽 번호가 가리킵니다`;
                        this.noteRelated(found.metadata, scope, why, row);
                        row.attempts = [...(row.attempts || []), `LM Studio OCR → 카탈로그 대조: 받지 않음 — ${why}`];
                        if (found.parsed)
                            this.readings.add(found.parsed.metadata);
                        return null;
                    }
                }
                row.attempts = [...(row.attempts || []), 'LM Studio OCR → 카탈로그 대조'];
                if (found.parsed)
                    this.readings.add(found.parsed.metadata);
                return { reading: { metadata: found.metadata, proposal: null, source: 'LM Studio OCR → 카탈로그 확인 (' + (found.evidence || '') + ')' }, confirmed: true, note: '', kind: 'catalog',
                    parsed: found.parsed?.metadata || null };
            case 'technical':
                this.readings.add(found.metadata);
                return { reading: { metadata: found.metadata, proposal: null, source: 'LM Studio OCR → 기술문서 구조 분석' }, confirmed: false, note: 'LM Studio OCR → 기술문서 구조 파서' };
            default:
                this.readings.add(found.metadata);
                return { reading: { metadata: found.metadata, proposal: null, source: 'LM Studio OCR → 국내 간행물 구조 분석' }, confirmed: false, note: 'LM Studio OCR → 국내 간행물 구조 파서' };
        }
    }
    private textLayerPage(number: number): any | null {
        const observations = (this.evidence as EvidenceBundle | undefined)?.observations || [];
        const text = observations.find(entry => entry.kind === 'pdfText' && (entry.locator === `page ${number}` || String(entry.locator || '').startsWith(`page ${number} of `)))?.text;
        if (!text || !String(text).trim())
            return null;
        const entry = observations.find(candidate => candidate.kind === 'pdfLayout' && candidate.locator === `layout page ${number}`);
        let layout: any = {};
        try {
            layout = entry ? JSON.parse(String(entry.text || '{}')) : {};
        }
        catch {
            layout = {};
        }
        if (layout.degraded || layout.glyphRisk || layout.encodingShift)
            return null;
        if (brokenLayerPages(this.evidence as EvidenceBundle | undefined).has(number))
            return null;
        return { page: number, text: String(text), layout: layout.layout, lineHeights: layout.lineHeights, kind: 'pdfText' };
    }
    private readableLayerAt(number: number): boolean {
        const observations = (this.evidence as EvidenceBundle | undefined)?.observations || [];
        return observations.some(entry => entry.kind === 'pdfLayout' && entry.locator === `layout page ${number}`) && !!this.textLayerPage(number);
    }
    private foreignLeafAt(number: number): boolean {
        const structure = pageStructureOf(this.evidence as EvidenceBundle | undefined);
        return roleOf(structure, number) === 'insertedLeaf' && structure.pages.find(entry => entry.page === number)?.leaf === 'foreignSize';
    }
    private async readVisionCandidate(row: Row, item: any, attachment: any, before: MetadataSnapshot, pageLimit = 4): Promise<VisionReading | null> {
        const settings = getLMStudioSettings();
        if (!settings.visionModel) {
            row.attempts = [...(row.attempts || []), 'LM Studio 이미지 인식 불가: 비전 모델 미설정 또는 자동 OCR 꺼짐'];
            return null;
        }
        const pageCount = await this.documentPageCount(row, attachment);
        for (const rung of VISION_STEPS) {
            if (this.cancel)
                return null;
            try {
                const render: VisionRenderOptions & VisionReadOptions = { width: rung.width, region: rung.region,
                    layerText: (page: number) => this.rawLayerText(page), documentPages: pageCount ?? null };
                render.insertedLeaf = (page: number) => this.foreignLeafAt(page);
                const layerStructure = pageStructureOf(this.evidence as EvidenceBundle | undefined);
                render.pagePlace = (page: number) => {
                    const place = placeOf(layerStructure, page);
                    return place ? { ...place, layer: this.readableLayerAt(page) ? 'readable' : place.layer === 'none' ? 'none' : 'broken' } : null;
                };
                const ocr = await runLMStudioVisionOCR(attachment, row.pdfFingerprint || '', pageLimit, settings, () => this.cancel, render);
                const readOn = ((ocr as any).readOn || []) as Array<{
                    page: number;
                    because: string;
                }>;
                const pastTheModel = readOn.filter(entry => entry.because !== 'titlePageVerso'), verso = readOn.filter(entry => entry.because === 'titlePageVerso');
                if (pastTheModel.length)
                    row.attempts = [...(row.attempts || []), `LM Studio 판독: 모델이 「다음 쪽: 불필요」라 했으나 더 읽음 — ${pastTheModel.map(entry => `${entry.page}쪽 뒤(${entry.because === 'titlePageAhead' ? '표제면·판권면이 뒤에 있음' : '저자 줄이 줄여 적힘'})`).join(', ')}`];
                if (verso.length)
                    row.attempts = [...(row.attempts || []), `LM Studio 판독: 읽을 쪽 수를 다 쓴 ${verso.map(entry => `${entry.page}쪽 표제면의 뒷면(${entry.page + 1}쪽, 판권면)`).join(', ')}을 더 읽음 — 이 판의 발행일이 없었음`];
                const whitePages = ((ocr as any).whitePages || []) as number[];
                const renderFailed = ((ocr as any).renderFailed || []) as number[];
                if (renderFailed.length)
                    row.attempts = [...(row.attempts || []), `LM Studio 판독: ${renderFailed.join('·')}쪽 렌더 실패 — 다시 그려도 하얀 이미지라 모델에게 보내지 않음(그 쪽은 읽지 않은 쪽이다)`];
                if (whitePages.length)
                    row.attempts = [...(row.attempts || []), `LM Studio 판독: ${whitePages.join('·')}쪽은 하얀 쪽 — 다시 그려도 잉크가 없고 글자층에도 낱말이 없어 빈 쪽으로 보고 보내지 않음`];
                const vision = ocr as typeof ocr & {
                    nothingPrinted?: boolean;
                    answers?: Record<string, string>;
                };
                if (vision.nothingPrinted) {
                    const said = Object.entries(vision.answers || {}).map(([page, answer]) => `${page}쪽 「${String(answer).slice(0, 50)}」`).join(' / ');
                    row.attempts = [...(row.attempts || []), `${ocr.provider}: 읽은 쪽에서 이 문서의 서지를 찾지 못함${said ? ' — ' + said : ''}`];
                    if (abstainedEverywhere(vision))
                        row.attempts = [...(row.attempts || []), 'LM Studio 판독이 모든 쪽에서 기권 — 쪽 이미지에는 잉크가 있었고 모델이 칸만 답함(다른 폭으로 다시 묻지 않음)'];
                    this.keepOCR(row, ocr, pageCount);
                    return null;
                }
                const readPages = (((ocr as any).read || []) as number[]).map(Number).filter(Number.isFinite);
                const readUpTo = Math.max(Number(ocr.pages) || 0, ...readPages);
                const pages = markWorkOpening(pagesFromOCRText(ocr.text, readUpTo, (page: number) => this.foreignLeafAt(page)), page => readPages.includes(page));
                for (const page of pages)
                    this.noteEvidence(page.text, 'OCR page ' + page.page + (pageCount ? ' of ' + pageCount : ''), { kind: 'ocrText', complete: false });
                const structure = pageStructureOf(this.evidence as EvidenceBundle | undefined);
                const links: MergeSource[] = [];
                const parses: MergeSource[] = [];
                const via: string[] = [];
                let patentGazette = false;
                let structured: StructuredReading | null = null;
                if (shouldTryKoreanPatent(before, attachment, [...pages.map(page => page.text), this.textLayerPage(1)?.text || ''].join(' '))) {
                    const patent = recognizeKoreanPatentText(item, before, pages.map(page => page.text).join('\f'));
                    if (patent) {
                        row.koreanAttempted = true;
                        row.patentPDF = true;
                        row.authoritative = true;
                        row.verifiedPDF = true;
                        row.attempts = [...(row.attempts || []), 'LM Studio OCR → 한국 특허 공보 직접 분석'];
                        parses.push({ kind: 'layer', label: '대한민국특허청 공보 분석', metadata: patent.metadata, typeRead: true });
                        via.push('대한민국특허청 공보 분석');
                        patentGazette = true;
                    }
                }
                else {
                    const answered = [ocr.fields || {}, ...Object.values(ocr.pageFields || {})] as Array<Record<string, string>>;
                    const transcribed = pages.map(page => page.text).join('\f');
                    const layerText = [1, 2, 3].map(number => this.textLayerPage(number)?.text).filter(Boolean).join('\f');
                    const us = await this.usPatentOfPrinted(row, item, attachment, before, {
                        texts: [...answered.flatMap(fields => ['식별자', '권호', '제목'].map(name => fields?.[name])), transcribed, layerText],
                        readTitles: answered.map(fields => fields?.['제목']),
                        printed: [transcribed, layerText].filter(Boolean).join('\f')
                    });
                    if (this.cancel)
                        return null;
                    if (us) {
                        row.patentPDF = true;
                        row.authoritative = true;
                        row.verifiedPDF = true;
                        row.attempts = [...(row.attempts || []), `LM Studio OCR → 쪽에 인쇄된 US 공보번호 ${us.printed} → Google Patents 기록`];
                        links.push({ kind: 'link', label: `Google Patents 기록 (쪽에 인쇄된 US 공보번호 ${us.printed})`, metadata: us.result.metadata });
                        this.noteRecordAsLink(us.result.metadata, 'US patent');
                        via.push(`Google Patents 기록 (쪽에 인쇄된 US 공보번호 ${us.printed})`);
                        patentGazette = true;
                    }
                }
                const ocrText = pages.map(page => page.text).join('\f');
                const modelTitle = String(ocr.fields?.['제목'] || '').trim();
                const namedPages = Object.entries(ocr.pageFields || {}).map(([number, fields]) => ({ number: Number(number), fields }));
                const neverTitlePage = (number: number) => !pages.some(p => p.page === number)
                    || ['contents', 'references'].includes(roleOf(structure, number)) || freeLeaf(structure, number);
                const wrapperPage = (number: number) => titleOrder(structure, number) === 2;
                const notTitlePage = (number: number) => neverTitlePage(number) || wrapperPage(number);
                namedPages.sort((a, b) => Number(wrapperPage(a.number)) - Number(wrapperPage(b.number)));
                const titlePage = Number((ocr as any).titlePage) || 0;
                if (titlePage)
                    namedPages.sort((a, b) => Number(b.number === titlePage) - Number(a.number === titlePage));
                const byline = fullestByline([ocr.fields?.['저자'], ...namedPages.filter(named => !notTitlePage(named.number)
                        && !coverOfASerial(named.fields, pages.find(p => p.page === named.number)?.text || '', this.rawLayerText(named.number))).map(named => named.fields['저자'])]);
                const merged: Record<string, string> = { ...(ocr.fields || {}), ...(byline ? { 저자: byline } : {}) };
                const folioRun = folioRunOfPageAnswers(ocr.pageFields, (ocr as any).read, pageCount, ocr.text, number => this.rawLayerText(number));
                if (folioRun)
                    merged['페이지'] = folioRun.range;
                if (!patentGazette) {
                    const folioHint = !merged['페이지'] && titlePage ? String(ocr.pageFields?.[String(titlePage)]?.['페이지'] || '').trim() : '';
                    structured = await this.structuredFromOCR(row, item, before, ocr.text, ocrText, pageCount, modelTitle ? [modelTitle] : [], folioHint && /^\d{1,6}$/.test(folioHint) ? { ...merged, 페이지: folioHint } : merged, [merged, ...Object.values(ocr.pageFields || {})], titlesOfTheWorksPages(merged, Object.fromEntries(namedPages.filter(named => !notTitlePage(named.number)).map(named => [String(named.number), named.fields]))));
                    if (this.cancel)
                        return null;
                    const gazette = structured?.kind === 'patent';
                    if (structured?.confirmed && structured.kind !== 'catalog' && !gazette) {
                        links.push({ kind: 'link', label: structured.reading.source.replace(/^LM Studio OCR → /, ''), metadata: structured.reading.metadata });
                        this.noteRecordAsLink(structured.reading.metadata, 'identifier');
                        via.push(structured.reading.source.replace(/^LM Studio OCR → /, ''));
                    }
                    const own = !!structured && (!structured.confirmed || gazette);
                    const parsed = own ? structured!.reading.metadata : structured?.parsed || null;
                    if (parsed) {
                        parses.push({ kind: 'layer', label: own ? structured!.reading.source.replace(/^LM Studio OCR → /, '') : '구조 파서의 판독', metadata: parsed, ...(gazette ? { typeRead: true } : {}) });
                        if (structured?.note)
                            row.attempts = [...(row.attempts || []), structured.note];
                        if (gazette) {
                            via.push(structured!.reading.source.replace(/^LM Studio OCR → /, ''));
                            patentGazette = true;
                        }
                    }
                }
                const catalogue = structured?.confirmed && structured.kind === 'catalog' ? structured.reading : null;
                let reading: ReturnType<typeof readVisionPage> | null = null;
                let untitled: ReturnType<typeof readVisionPage> | null = null;
                let readFrom = 0;
                const titled = (read: ReturnType<typeof readVisionPage>) => !!String(read.reading.metadata.fields?.title || '').trim() || !!String(read.page?.metadata.fields?.title || '').trim();
                for (const named of namedPages) {
                    const page = pages.find(p => p.page === named.number);
                    if (!page || neverTitlePage(named.number))
                        continue;
                    const filled: Record<string, string> = { ...named.fields };
                    for (const name of ['유형', '식별자', '발행일', '학위', '출판', '권호', '페이지', '저자']) {
                        if (name === '페이지' && folioOfAnotherPage(merged[name], this.evidence as EvidenceBundle | undefined, named.number)) {
                            delete filled[name];
                            continue;
                        }
                        if (merged[name])
                            filled[name] = merged[name];
                        else
                            delete filled[name];
                    }
                    if (filled['저자'] && merged['저자'] && partialByline(filled['저자'], merged['저자']))
                        filled['저자'] = merged['저자'];
                    if (folioRun && named.number === folioRun.firstPage && String(filled['페이지'] || '').trim() === folioRun.start)
                        filled['페이지'] = folioRun.range;
                    const printedPage = this.textLayerPage(named.number);
                    const read = readVisionPage(item, before, filled, printedPage ? [page, printedPage] : [page], { transcribed: pages });
                    untitled = untitled || read;
                    if (titled(read)) {
                        reading = read;
                        readFrom = named.number;
                        break;
                    }
                }
                if (!namedPages.length) {
                    const read = readVisionPage(item, before, ocr.fields || {}, pages);
                    untitled = read;
                    if (titled(read))
                        reading = read;
                }
                const chosen = reading || (untitled && (catalogue || links.length || parses.length) ? untitled : null);
                const readingSource: MergeSource | null = chosen ? (patentGazette && parses.length && chosen.reading.metadata.itemType !== 'patent' && chosen.reading.typeRead
                    ? { ...chosen.reading, typeRead: 'weak' } : chosen.reading) : null;
                const colophonPage = Number((ocr as any).colophonPage) || 0;
                const colophonLayer = chosen && colophonPage && colophonPage !== readFrom ? this.textLayerPage(colophonPage) : null;
                const colophonReading = colophonLayer ? readVisionPage(item, before, {}, [colophonLayer]).page : null;
                const sources: MergeSource[] = chosen && readingSource ? [readingSource, ...links, ...parses, ...(chosen.page ? [chosen.page] : []),
                    ...(colophonReading ? [{ ...colophonReading, label: `판권면(${colophonPage}쪽) 쪽 판독기` }] : [])] : [];
                let metadata: MetadataSnapshot | null = null;
                if (chosen) {
                    const withCatalogue = !reading && catalogue ? [...sources, { kind: 'link' as const, label: this.catalogueLabel(catalogue.metadata), metadata: catalogue.metadata }] : sources;
                    const built = this.merged(row, item, before, withCatalogue);
                    if (String(built.metadata.fields?.title || '').trim()) {
                        metadata = built.metadata;
                        if (withCatalogue !== sources) {
                            sources.push(withCatalogue[withCatalogue.length - 1]);
                            via.push('카탈로그 기록');
                            this.noteRecordAsLink(catalogue!.metadata, 'catalogue');
                        }
                    }
                }
                row.attempts = [...(row.attempts || []), ocr.provider + ': ' + (metadata ? String(metadata.fields.title) : '제목 확인 불가')];
                if (!metadata) {
                    if (untitled && Object.keys(untitled.reading.metadata.fields || {}).some(field => field !== 'language'))
                        this.untitledReading = untitled.reading.metadata;
                    return null;
                }
                this.readings.add(metadata);
                const candidate = buildCandidate(pages, { documentPages: pageCount ?? null });
                const proposal: CoverProposal = { metadata, pages, typeRead: metadata.typeRead !== false,
                    sources: candidate.sources, alternatives: candidate.alternatives, notStorable: [],
                    documentPages: pageCount ?? null, ocr, official: null, candidate };
                row.coverProposal = { sources: proposal.sources, alternatives: proposal.alternatives, notStorable: [],
                    used: true, fields: metadata.fields, itemType: metadata.itemType, typeRead: proposal.typeRead,
                    pagesRead: pages.length, documentPages: pageCount ?? null, ocr };
                const source = 'LM Studio 비전 OCR → 구조화 서지정보 (' + ocr.provider + ')' + (via.length ? ` · 연결·구조 판독이 빈 칸을 채움: ${via.join(', ')}` : '');
                return { metadata, proposal, source, record: reading ? catalogue?.metadata || null : null, sources };
            }
            catch (cause) {
                row.attempts = [...(row.attempts || []), 'LM Studio 이미지 인식 실패: ' + String(cause)];
                if (engineStalled(String(cause)) || /비전 엔진이 응답할 수 없는 상태/.test(String(cause))) {
                    this.stopNote = 'LM Studio 비전 엔진이 멈춰 실행을 중지했습니다. LM Studio에서 VLM을 Eject 후 다시 Load한 뒤 「검색」으로 이어서 실행하세요.';
                    this.cancel = true;
                    return null;
                }
                if (this.cancel || /엔진|reload|다시 로드/i.test(String(cause)))
                    return null;
                return null;
            }
        }
        return null;
    }
    private merged(row: Row, item: any, before: MetadataSnapshot, sources: MergeSource[], quiet = false): {
        metadata: MetadataSnapshot;
        outcome: MergeOutcome;
    } {
        const outcome = mergeSources(item, before, sources, this.mergeContext(row));
        const metadata = this.withRelated(row, item, before, outcome.metadata, quiet);
        this.merges.set(metadata, sources);
        const carried: Record<string, unknown> = {};
        for (const [field, origin] of Object.entries(outcome.origin)) {
            if (origin.kind !== 'link' || field === 'itemType')
                continue;
            if (field === 'creators') {
                if ((metadata.creators || []).length)
                    carried.creators = metadata.creators;
            }
            else if (metadata.fields[field] !== undefined)
                carried[field] = metadata.fields[field];
        }
        if (Object.keys(carried).length)
            this.recordFilled.set(metadata, carried);
        return { metadata, outcome };
    }
    private mergeContext(row: Row): MergeContext {
        const pages = (this.evidence?.observations || []).filter(entry => entry.kind === 'pdfText' || entry.kind === 'ocrText').map(entry => String(entry.text || '')).join('\n');
        return { evidence: this.evidence, lookups: (row.lookupNotes || []) as MergeContext['lookups'], pages };
    }
    private sourcesOf(found: VisionReading): MergeSource[] {
        return found.sources || this.merges.get(found.metadata)
            || [{ kind: 'reading', label: 'LM Studio 판독', metadata: found.metadata, typeRead: found.metadata.typeRead, abbreviated: !!found.metadata.creatorsAbbreviated }];
    }
    private addSource(row: Row, item: any, before: MetadataSnapshot, found: VisionReading, source: MergeSource): string[] {
        const sources = [...this.sourcesOf(found), source];
        const { metadata, outcome } = this.merged(row, item, before, sources, true);
        const filled = outcome.filled.filter(entry => entry.label === source.label && entry.kind === source.kind).flatMap(entry => entry.fields)
            .map(field => field === 'itemType' ? `itemType(${metadata.itemType})` : field);
        const refined = outcome.refined.filter(entry => entry.label === source.label && entry.kind === source.kind).map(entry => `${entry.field}(같은 진술)`);
        found.sources = sources;
        if (!filled.length && !refined.length) {
            this.merges.set(found.metadata, sources);
            return [];
        }
        found.metadata = metadata;
        this.readings.add(metadata);
        if (found.proposal) {
            found.proposal.metadata = metadata;
            found.proposal.typeRead = metadata.typeRead !== false;
        }
        if (row.coverProposal)
            row.coverProposal = { ...row.coverProposal, fields: metadata.fields, itemType: metadata.itemType, typeRead: metadata.typeRead !== false };
        return [...filled, ...new Set(refined)];
    }
    private fillFromLayerReading(row: Row, item: any, before: MetadataSnapshot, found: VisionReading, layer: CoverProposal): void {
        if (!found.proposal || !layer?.metadata)
            return;
        if (row.patentPDF)
            return;
        const filled = this.addSource(row, item, before, found, { kind: 'layer', label: '텍스트층 표지 판독', metadata: layer.metadata,
            typeRead: layer.typeRead !== false, guessed: guessesOfAReading(layer.sources, (layer.metadata.creators || []).length > 0) });
        if (filled.length)
            row.attempts = [...(row.attempts || []), '텍스트층 표지 판독이 비전 판독의 빈 칸을 채움: ' + filled.join(', ')];
    }
    private catalogueLabel(record: MetadataSnapshot): string {
        const catalogue = String(record.fields?.libraryCatalog || '').trim();
        return `카탈로그 기록${catalogue ? `(${catalogue})` : ''}`;
    }
    private noteRecordAsLink(record: MetadataSnapshot, rule: string): void {
        const fields = record.fields || {};
        const catalogue = String(fields.libraryCatalog || rule);
        const stated: LinkRecord['stated'] = {};
        for (const [field, value] of Object.entries(fields)) {
            if (value === undefined || value === null || value === '' || ['accessDate', 'libraryCatalog', 'extra'].includes(field))
                continue;
            stated[field] = { value: String(value) };
        }
        const people = (record.creators || []) as any[];
        if (people.length)
            stated.creators = { value: people.map(person => person?.firstName ? printedName(person) : String(person?.lastName ?? person?.name ?? '')).join('; ') };
        if (record.itemType && record.itemType !== 'document')
            stated.itemType = { value: String(record.itemType) };
        const url = String(fields.url || `${rule}:${String(fields.DOI || fields.ISBN || fields.title || '').slice(0, 120)}`);
        this.noteLink({ provider: catalogue, url, retrievedAt: String(fields.accessDate || ''), live: true,
            relation: /open\s*library/i.test(catalogue) ? 'sameWork' : 'sameEdition', rule: `${rule}: the pipeline accepted this record as the document's`,
            evidence: [], stage: '', stated });
    }
    private fillFromRecord(row: Row, item: any, before: MetadataSnapshot, found: VisionReading): void {
        const record = found.record;
        found.record = null;
        if (!record || !found.proposal)
            return;
        this.noteRecordAsLink(record, 'catalogue');
        const filled = this.addSource(row, item, before, found, { kind: 'link', label: this.catalogueLabel(record), metadata: record });
        if (!filled.length)
            return;
        found.source += ' · 카탈로그 기록이 빈 칸을 채움';
        row.attempts = [...(row.attempts || []), '카탈로그 기록이 비전 판독의 빈 칸을 채움: ' + filled.join(', ')];
    }
    private keepOCR(row: Row, ocr: {
        provider: string;
        pages: number;
        cacheHit?: boolean;
    }, pageCount: number | undefined): void {
        const kept = ocr as NonNullable<Row['coverProposal']>['ocr'];
        row.coverProposal = row.coverProposal ? { ...row.coverProposal, ocr: kept }
            : { sources: {}, alternatives: {}, notStorable: [], used: false, pagesRead: 0, documentPages: pageCount ?? null, ocr: kept };
    }
    private gateFor(row: Row, result: {
        metadata: MetadataSnapshot;
        changes: FieldChange[];
    } | null, proposal: CoverProposal | null, phase: 'registries' | 'browser') {
        const type = String(result?.metadata.itemType || proposal?.metadata.itemType || 'document');
        const verification = result?.changes?.length
            ? verifyFields(result.changes.filter(change => change.field !== 'itemType'), {
                recognized: result.metadata, evidence: this.evidence, itemType: type,
                pdfFingerprint: fileIdentity(row.pdfFingerprint || ''), policyVersion: RECOGNITION_PIPELINE_VERSION,
                readings: row.coverProposal?.sources
            })
            : {};
        const gate = restoreGate({ phase, result, proposal, verification, authoritative: !!row.authoritative, restore: row.restore });
        row.restoreGate = [...(row.restoreGate || []).filter(entry => entry.phase !== phase), gate];
        return gate;
    }
    private async restorePhase(row: Row, item: any, before: MetadataSnapshot, proposal: CoverProposal | null, attachment: any, result: {
        source: any;
        metadata: MetadataSnapshot;
        changes: FieldChange[];
    } | null, phase: 'registries' | 'browser', force = false) {
        const gate = this.gateFor(row, result, proposal, phase);
        if (!force && gate.decision !== 'ask')
            return result;
        if (force) {
            gate.decision = 'ask';
            gate.reason = '순차 파이프라인: 후보의 존재와 URL 확인은 별도 단계';
        }
        const { open } = gate;
        const allowed = this.restoreProviders || ['crossref', 'yes24', 'zoteroISBN', 'aladin', 'nlk', 'arxiv', 'hal', 'google'];
        const providers = phase === 'registries' ? allowed.filter(provider => provider !== 'google') : allowed.filter(provider => provider === 'google');
        if (!providers.length)
            return result;
        try {
            const held = result?.metadata;
            const readPages = (kind: 'ocrText' | 'pdfText') => (this.evidence?.observations || []).filter(entry => entry.kind === kind)
                .map(entry => ({ page: Number(/page (\d+)/.exec(String(entry.locator || ''))?.[1] || 0), text: String(entry.text || ''), kind }))
                .filter(page => page.page > 0 && page.text.trim()).sort((a, b) => a.page - b.page);
            const readSoFar = documentProfile(this.evidence).textLayer === 'readable' ? readPages('pdfText') : readPages('ocrText');
            const pages = proposal?.pages?.length ? proposal.pages
                : readSoFar.length ? readSoFar
                    : [{ page: 1, text: await readPDFFrontMatter(attachment, null, 3, 12000), kind: 'pdfText' as const }];
            const read = !!held && (held === proposal?.metadata || this.readings.has(held));
            const carried = read && held ? this.recordFilled.get(held) : undefined;
            const sources = held ? this.merges.get(held) : undefined;
            const upper = sources ? this.merged(row, item, before, sources.filter(source => source.kind !== 'layer'), true).metadata : null;
            const layerLocators = read && held && upper ? Object.fromEntries((['volume', 'issue', 'pages'] as const)
                .filter(field => String(held.fields?.[field] ?? '').trim() && !String(upper.fields?.[field] ?? '').trim()).map(field => [field, held.fields[field]])) : {};
            const recordSide = Object.keys(layerLocators).length ? { ...(carried || {}), ...layerLocators } : carried;
            const bare = !held || this.candidates.has(held);
            const weakType = !!upper && (sources || []).some(source => source.kind === 'reading' && source.typeRead === 'weak' && source.metadata.itemType === upper.itemType);
            const step = await restoreStep({
                parent: item, before, proposal, pages, fetcher: this.restoreFetcher, keys: restoreKeysFromPrefs(),
                browser: phase === 'browser' && this.restoreBrowser ? this.restoreBrowser() : undefined,
                translators: this.methods.identifiers, providers, limits: restoreLimitsFromPrefs(),
                documentFields: held ? { ...held.fields, creators: held.creators } : undefined,
                documentFieldsFrom: read ? 'reading' : 'record', scopeOf: this.scopeOf,
                ...(recordSide ? { documentRecordFields: recordSide } : {}),
                ...(upper ? { documentBase: { ...upper.fields, creators: upper.creators } } : bare ? { documentBase: {} } : {}),
                documentType: upper ? (!weakType && upper.typeRead !== false && upper.itemType !== 'document' ? String(upper.itemType) : undefined)
                    : bare ? undefined : held?.itemType ? String(held.itemType) : undefined,
                protectedFields: Object.keys(row.protections || {}),
                cancelled: () => this.cancel
            });
            if (this.cancel)
                return result;
            row.restore = row.restore ? combineRestore(row.restore, step.record) : step.record;
            const ended = phaseOutcome(step.record);
            gate.outcome = ended.outcome;
            gate.outcomeNote = ended.note;
            if (step.record.status === 'linked' && !step.record.target && open.length)
                gate.outcomeNote += ` · still empty: ${open.join(', ')}`;
            if (step.evidence) {
                this.noteEvidence(step.evidence.observation.text, step.evidence.observation.locator, { kind: 'externalRecord', complete: true });
                this.noteLink(step.evidence.link);
                const known = this.evidence as EvidenceBundle | undefined;
                if (step.evidence.identity && !known?.identity)
                    this.noteIdentity(step.evidence.identity);
            }
            if (step.metadata) {
                const previous = result ? row.recognitionSource : '';
                this.restoredRecord = step.metadata;
                let metadata = step.metadata;
                if (sources) {
                    const reading = sources.find(source => source.kind === 'reading');
                    const next: MergeSource[] = sourcesAfterTheRestoreLink({ kind: 'reading', label: '판독과 연결된 기록', metadata: step.metadata, typeRead: step.typeRead, abbreviated: !!upper?.creatorsAbbreviated, rolesStated: reading?.rolesStated }, step.linked ? { label: `검색 복원으로 연결된 기록(${step.record.target?.provider || ''})`, metadata: step.linked,
                        linkedAbstract: step.record.provenance?.abstractNote?.source === 'external' ? step.metadata.fields?.abstractNote : undefined } : null, sources);
                    metadata = this.merged(row, item, before, next, true).metadata;
                    this.readings.add(metadata);
                }
                else {
                    const layers: MergeSource[] = proposal?.metadata ? [{ kind: 'layer', label: '텍스트층 표지 판독', metadata: proposal.metadata, typeRead: proposal.typeRead !== false,
                            guessed: guessesOfAReading(proposal.sources, (proposal.metadata.creators || []).length > 0) }] : [];
                    const candidateTitle = held && this.candidates.has(held) ? String(held.fields?.title || '').trim() : '';
                    if (candidateTitle && titleSupportedByPDF(candidateTitle, pages.map(page => String(page.text || '')).join('\n')))
                        layers.push({ kind: 'layer', label: '쪽에 찍힌 후보의 제목', metadata: { ...held!, fields: { title: candidateTitle }, creators: [] }, typeRead: false });
                    const outcome = layers.length ? mergeSources(item, before, [
                        { kind: 'link', label: `검색 복원으로 연결된 기록(${step.record.target?.provider || ''})`, metadata: step.metadata, typeRead: step.typeRead },
                        ...layers
                    ], this.mergeContext(row)) : null;
                    if (outcome && (outcome.filled.length || outcome.refined.length)) {
                        metadata = outcome.metadata;
                        for (const source of layers) {
                            const filled = outcome.filled.filter(entry => entry.label === source.label).flatMap(entry => entry.fields)
                                .map(field => field === 'itemType' ? `itemType(${metadata.itemType})` : field);
                            const refined = [...new Set(outcome.refined.filter(entry => entry.label === source.label).map(entry => `${entry.field}(같은 진술)`))];
                            if (filled.length || refined.length)
                                row.attempts = [...(row.attempts || []), `${source.label}이 연결된 기록의 빈 칸을 채움: ${[...filled, ...refined].join(', ')}`];
                        }
                    }
                }
                const typeRead = metadata !== step.metadata ? metadata.typeRead !== false : step.typeRead;
                const changes = buildDiff(withoutStoredValues(before), metadata, typeRead).filter(change => typeRead || change.field !== 'itemType');
                result = { source: null, metadata, changes };
                const target = step.record.target!;
                row.recognitionSource = `${previous ? `${previous} + ` : ''}검색 복원 → ${target.provider} ${target.pageType} (${target.live ? 'live' : 'fixture'})`;
                if (!(target.relation === 'sameEdition' && target.identifierMatch))
                    row.manualReview = true;
            }
        }
        catch (cause) {
            Zotero.debug(`[PDF Metadata Refresh] search restore (${phase}) skipped: ${String(cause)}`);
        }
        return result;
    }
    async adoptCandidate(target: Row, index: number): Promise<void> {
        if (this.busy)
            return;
        await this.run([target], async (row) => {
            const candidate = row.restore?.candidates?.[index];
            if (!candidate)
                throw new Error('선택한 후보가 없습니다.');
            this.evidence = row.evidence ? cloneValue(row.evidence) : undefined;
            this.carriedDecisions = { approvals: row.approvals, protections: row.protections };
            const item = this.item(row);
            const applied = isAppliedStatus(row.status);
            const before = !applied && row.before ? row.before : await snapshotItem(item);
            if (applied)
                row.before = before;
            const held = row.recognized;
            const edited: Record<string, string> = { ...(row.fieldEdit || {}) };
            const protectedFields = new Set([...Object.keys(row.protections || {}), ...Object.keys(edited)]);
            const fields: Record<string, any> = { ...(held?.fields || {}) };
            for (const [field, value] of Object.entries({ ...candidate.record.fields, title: candidate.record.title })) {
                if (value === undefined || value === null || value === '' || protectedFields.has(field))
                    continue;
                fields[field] = value;
            }
            for (const [field, value] of Object.entries(edited))
                if (field !== 'creators' && field !== 'itemType')
                    fields[field] = value;
            const creators = candidate.record.creators?.length && !protectedFields.has('creators') ? candidate.record.creators : (held?.creators || []);
            const itemType = isKnownItemType(edited.itemType) ? String(edited.itemType).trim()
                : candidate.record.itemType && candidate.record.itemType !== 'document' ? candidate.record.itemType : String(held?.itemType || before.itemType);
            const metadata = snapshotFrom(item, before, itemType, fields, creators);
            const stated: LinkRecord['stated'] = {};
            for (const [field, value] of Object.entries({ ...candidate.record.fields, title: candidate.record.title })) {
                if (value !== undefined && value !== null && value !== '')
                    stated[field] = { value: String(value) };
            }
            if (candidate.record.creators?.length)
                stated.creators = { value: candidate.record.creators.map((person: any) => person.firstName ? printedName(person) : person.lastName).join('; ') };
            this.noteEvidence(JSON.stringify({ url: candidate.url, chosenBy: 'person', stated }), `${candidate.provider}:${candidate.url}`, { kind: 'externalRecord', complete: true });
            this.noteLink({ provider: candidate.provider, url: candidate.url, retrievedAt: candidate.record.retrievedAt, live: candidate.record.live,
                relation: 'sameEdition', rule: 'confirmed by the person', evidence: ['the person chose this record for this document', ...candidate.evidence], stage: candidate.stage as any, stated });
            if (row.restore) {
                row.restore = { ...row.restore, status: 'linked', targetReason: 'confirmed by the person',
                    target: { provider: candidate.provider, url: candidate.url, stage: candidate.stage, relation: 'sameEdition', rule: 'confirmed by the person',
                        evidence: ['the person chose this record for this document', ...candidate.evidence], conflicts: candidate.conflicts, live: candidate.record.live, retrievedAt: candidate.record.retrievedAt, pageType: candidate.record.pageType } };
            }
            row.recognitionSource = `${row.recognitionSource ? `${row.recognitionSource} + ` : ''}사용자가 선택한 후보 → ${candidate.provider} ${candidate.record.pageType}`;
            const editedFields = Object.keys(edited);
            const keptChoice = Object.fromEntries(Object.entries(row.fieldChoice || {}).filter(([field]) => editedFields.includes(field)));
            row.fieldChoice = Object.keys(keptChoice).length ? keptChoice : undefined;
            row.fieldEdit = editedFields.length ? edited : undefined;
            this.classifyRecognized(row, before, metadata, false, false, false, false);
            row.manualReview = true;
            if (row.status === 'ready')
                row.status = 'review';
            row.checked = false;
            row.completion = reportCompletion(row, row.coverProposal?.documentPages ?? undefined);
            await this.cacheResult(row, 'recognized');
        }, '후보 채택', { keep: true });
    }
    approveFields(row: Row, fields: string[]): number {
        const wanted = new Set(fields);
        const typeChange = row.changes.find(change => change.field === 'itemType');
        const itemType = typeChange ? String(typeChange.newValue) : String(row.before?.itemType || row.recognized?.itemType || '');
        const scope = approvalScopeFor(row, itemType, RECOGNITION_PIPELINE_VERSION);
        let count = 0;
        for (const change of row.changes) {
            if (!wanted.has(change.field))
                continue;
            recordApproval(row, change, scope, 'accepted');
            count++;
        }
        row.fieldChoice = { ...(row.fieldChoice || {}), ...Object.fromEntries(fields.map(field => [field, true])) };
        return count;
    }
    standing(row: Row) { return rowStanding(row); }
    chooseItemType(row: Row, itemType: string): void {
        if (!Zotero.ItemTypes.getID(itemType))
            throw new Error(`알 수 없는 항목 유형: ${itemType}`);
        const existing = row.changes.find(change => change.field === 'itemType');
        if (existing)
            existing.newValue = itemType;
        else
            row.changes.unshift({ field: 'itemType', oldValue: String(row.before?.itemType || ''), newValue: itemType } as FieldChange);
        row.fieldEdit = { ...(row.fieldEdit || {}), itemType };
        this.approveFields(row, [...Object.keys(row.approvals || {}), 'itemType']);
    }
    private async cacheResult(row: Row, status: 'recognized' | 'noMatch' | 'textlessPDF') {
        if (!row.pdfFingerprint)
            return;
        if (this.cancel)
            return;
        if (status === 'recognized' && row.lookupUnreachable && !row.restore?.target && !row.authoritative)
            return;
        try {
            await writeRecognitionCache({
                libraryID: row.libraryID, itemKey: row.key, pdfFingerprint: row.pdfFingerprint, status,
                recognized: status === 'recognized' ? row.recognized : undefined,
                rawRecognized: row.rawRecognized, authoritative: row.authoritative, ocrRead: row.ocrRead,
                attempts: row.attempts, manualReview: row.manualReview, coverProposal: row.coverProposal,
                recognitionSource: row.recognitionSource, candidates: row.candidates, error: row.error,
                koreanAttempted: row.koreanAttempted, verifiedPDF: row.verifiedPDF, patentPDF: row.patentPDF, technicalPDF: row.technicalPDF, identifierPDF: row.identifierPDF,
                lookupUnreachable: !!row.lookupUnreachable,
                attachmentKey: row.attachmentKey, evidence: row.evidence,
                restore: row.restore, completion: row.completion, fieldConflicts: row.fieldConflicts, selection: row.selection
            });
        }
        catch (e) {
            Zotero.debug(`[PDF Metadata Refresh] cache write failed: item=${row.key}; ${String(e)}`);
        }
    }
    private restoreFromCache(row: Row, before: MetadataSnapshot, cached: RecognitionCacheEntry, note = ''): void {
        const attemptsHere = row.attempts || [];
        Object.assign(row, { recognitionSource: note ? `${cached.recognitionSource || ''}${cached.recognitionSource ? ' · ' : ''}${note}` : cached.recognitionSource,
            restore: cached.restore, candidates: cached.candidates || [],
            fieldConflicts: cached.fieldConflicts, verifiedPDF: cached.verifiedPDF,
            patentPDF: cached.patentPDF, technicalPDF: cached.technicalPDF, identifierPDF: cached.identifierPDF,
            authoritative: cached.authoritative, ocrRead: cached.ocrRead,
            lookupUnreachable: cached.lookupUnreachable,
            attempts: note ? [...(cached.attempts || []), ...attemptsHere] : cached.attempts,
            manualReview: cached.manualReview, coverProposal: cached.coverProposal, selection: cached.selection });
        this.evidence = cached.evidence;
        row.cacheState = 'hit';
        this.classifyRecognized(row, before, cached.rawRecognized || cached.recognized!, !!row.verifiedPDF, !!row.patentPDF, !!row.technicalPDF, !!row.identifierPDF);
        row.completion = reportCompletion(row, row.coverProposal?.documentPages ?? undefined);
    }
    async preview(useCache = true, targetRows?: Row[], options: {
        keep?: boolean;
        reread?: boolean;
    } = {}) {
        if (!targetRows)
            await this.clearRescanMarks();
        const reread = options.reread ?? !!targetRows;
        await this.run(targetRows || this.rows.filter(r => r.status === 'pending'), async (row) => {
            const item = this.item(row);
            this.carriedDecisions = { approvals: row.approvals, protections: row.protections };
            this.carriedChoices = personChoices(row) || this.earlierChoices.get(row.id);
            this.earlierChoices.delete(row.id);
            resetRecognitionAttempt(row);
            if (this.rereading)
                row.checked = true;
            this.evidence = undefined;
            this.related = undefined;
            this.textStageLinks = [];
            this.untitledReading = null;
            row.independentMetadata = true;
            row.replaceMetadata = this.overwriteFromDocument;
            row.standalonePDF = isStandalonePDF(item);
            const before = row.standalonePDF ? await emptyRecord(item) : await snapshotItem(item);
            row.before = before;
            row.title = String(before.fields.title || row.title || '');
            if (await isItemExcluded(row.libraryID, row.key)) {
                row.status = 'excluded';
                return;
            }
            const choice = row.standalonePDF ? { attachment: item } : await selectPrimaryPDF(item);
            if (!choice.attachment) {
                row.status = choice.reason as Status;
                return;
            }
            const attachment = choice.attachment;
            row.attachmentKey = String(attachment.key || '');
            row.pdfFingerprint = await pdfInputFingerprint(attachment);
            if (await isPDFExcluded(row.libraryID, row.key, row.pdfFingerprint)) {
                row.status = 'excluded';
                return;
            }
            const cached = useCache ? await readRecognitionCache(row.libraryID, row.key, row.pdfFingerprint) : null;
            const unfinished = !!cached?.lookupUnreachable && !cached?.restore?.target && !cached?.authoritative;
            if (cached?.status === 'recognized' && cached.recognized && (cached.restore?.target || cached.authoritative || cached.ocrRead) && !restoreHeld(cached.restore) && !unfinished) {
                this.restoreFromCache(row, before, cached);
                return;
            }
            row.cacheState = useCache ? 'miss' : 'refreshed';
            let proposal: CoverProposal | null = null;
            let front = '';
            const trace = (note: string) => { row.attempts = [...(row.attempts || []), note]; };
            const select = (candidate: NonNullable<Row['selection']>[number]['candidate'], chosen: boolean, reason: string) => {
                row.selection = [...(row.selection || []).filter(entry => entry.candidate !== candidate), { candidate, chosen, reason }];
            };
            const resultOf = (metadata: MetadataSnapshot): RecognitionResult => ({ source: null, metadata,
                changes: buildDiff(withoutStoredValues(before), metadata, metadata.typeRead !== false) });
            const search = async (candidate: RecognitionResult | null) => {
                let result = candidate;
                if (this.methods.searchRestore) {
                    result = await this.restorePhase(row, item, before, proposal, attachment, result, 'registries', !row.authoritative);
                    if (!row.restore?.target && !this.cancel)
                        result = await this.restorePhase(row, item, before, proposal, attachment, result, 'browser', !row.authoritative);
                    const linked = row.restore?.target;
                    select('searchRestore', !!linked, linked ? `${linked.provider} ${linked.pageType} 연결 (${linked.relation})` : (row.restore?.targetReason || '연결된 레코드 없음'));
                }
                const readTitle = titleUnderContract(proposal?.metadata.fields.title);
                let korean: ReturnType<typeof koreanTitleBesideRecord> = null;
                const language = String(proposal?.metadata.fields.language || '');
                const bodyIsLatin = (documentBodyScript(this.evidence) === 'latin' && !/^ko\b/i.test(language)) || bodyLanguageOf(this.evidence as EvidenceBundle | undefined)?.language === 'en';
                if (result && !bodyIsLatin && (/^ko\b/i.test(language) || /[가-힣]/.test(readTitle)) && /[가-힣]/.test(readTitle)
                    && !/[가-힣]/.test(String(result.metadata.fields.title || ''))
                    && !!(korean = koreanTitleBesideRecord(pageStructureOf(this.evidence), readTitle, result.metadata.fields.title))) {
                    result = resultOf({ ...result.metadata, fields: { ...result.metadata.fields, title: korean.title, language: 'ko' } });
                    trace(korean.because === 'adjacent' ? '연결된 레코드의 영문 제목 대신 PDF에 그 제목과 나란히 찍힌 한국어 제목을 채택' : '연결된 레코드의 영문 제목 대신 PDF에서 인식한 한국어 제목을 채택');
                }
                return result;
            };
            let frontRead = false;
            let seen: CoverObservations | null = null;
            const readFront = async () => {
                if (frontRead)
                    return;
                frontRead = true;
                try {
                    const cover = await readCoverPages(item, attachment, before, { consultRegistry: false });
                    proposal = cover.proposal;
                    const observed = cover.observed;
                    seen = observed;
                    if (proposal) {
                        row.coverProposal = { sources: proposal.sources, alternatives: proposal.alternatives,
                            notStorable: proposal.notStorable, used: false, fields: proposal.metadata.fields,
                            itemType: proposal.metadata.itemType, typeRead: proposal.typeRead,
                            pagesRead: proposal.pages.length, documentPages: proposal.documentPages, ocr: null };
                    }
                    if (observed) {
                        const extent = Number(observed.documentPages);
                        for (const page of observed.pages)
                            this.noteEvidence(page.text, 'page ' + page.page + (Number.isInteger(extent) && extent > 0 ? ' of ' + extent : ''), { kind: 'pdfText', complete: !page.truncated });
                        for (const page of observed.pages as any[]) {
                            if (!page.inserted && (!page.layout || !String(page.layout).trim() || page.layout === page.text))
                                continue;
                            this.noteEvidence(JSON.stringify({ text: page.text, layout: page.layout,
                                lineHeights: page.lineHeights, degraded: page.degraded, glyphRisk: page.glyphRisk,
                                pageCount: page.pageCount, encodingShift: page.encodingShift, size: page.size,
                                ...(page.inserted ? { inserted: true } : {}) }), 'layout page ' + page.page, { kind: 'pdfLayout', complete: !page.truncated });
                        }
                        if (observed.census?.pages?.length) {
                            this.noteEvidence(JSON.stringify({
                                pages: observed.census.pages.map(leaf => ({ page: leaf.page, width: leaf.width, height: leaf.height, words: leaf.words })),
                                inserted: observed.census.inserted || [],
                                ...(Number.isInteger(extent) && extent > 0 ? { documentPages: extent } : {})
                            }), 'census', { kind: 'pdfLayout', complete: true });
                        }
                    }
                    const insertedNumbers = new Set<number>([...(seen?.pages || []).filter((page: any) => page.inserted).map(page => Number(page.page)),
                        ...((seen?.census?.inserted || []) as number[]).map(Number)]);
                    let wrapper = 0;
                    while (insertedNumbers.has(wrapper + 1))
                        wrapper++;
                    const likelyThesis = proposal?.metadata.itemType === 'thesis'
                        || THESIS_WORD.test(`${(seen?.pages || []).filter((page: any) => !page.inserted).map(page => page.text).join(' ')} ${String(attachment.attachmentFilename || '')}`);
                    if (wrapper) {
                        const limit = likelyThesis ? 12000 : 6000;
                        const read = await readPDFFrontMatter(attachment, null, wrapper + (likelyThesis ? 3 : 1), limit + wrapper * 6000);
                        front = read.split('\f').slice(wrapper).join('\f').replace(/^\s+/, '').slice(0, limit);
                    }
                    else
                        front = await readPDFFrontMatter(attachment, null, likelyThesis ? 3 : 1, likelyThesis ? 12000 : 6000);
                    if (!seen)
                        this.noteEvidence(front, 'page 1', { kind: 'pdfText', complete: false });
                }
                catch (cause) {
                    trace('PDF 텍스트 읽기: ' + String(cause));
                }
            };
            await readFront();
            let profile = documentProfile(this.evidence as EvidenceBundle | undefined);
            if (profile.textLayer === 'readable') {
                const window = Math.max(0, ...((this.evidence as EvidenceBundle | undefined)?.observations || []).filter(entry => entry.kind === 'pdfText')
                    .map(entry => Number(/^page (\d+)/.exec(String(entry.locator || ''))?.[1] || 0)));
                const sample = await readBodySample(attachment, window);
                if (sample)
                    this.noteEvidence(JSON.stringify(sample), 'body sample', { kind: 'pdfLayout', complete: true });
            }
            let visionReady = false;
            try {
                visionReady = !!getLMStudioSettings().visionModel;
            }
            catch {
                visionReady = false;
            }
            if (profile.textLayer !== 'readable' && visionReady)
                trace(`글자층이 ${profile.textLayer === 'broken' ? '깨져' : '비어'} 있어 Zotero 인식·식별자·URL 검색을 건너뛰고 쪽 이미지로 읽습니다`);
            let result = await runRecognitionPipeline<RecognitionResult>({
                textUsable: () => profile.textLayer === 'readable' || !visionReady,
                cancelled: () => this.cancel,
                failed: (stage, cause) => { trace(stage + ' 실패: ' + String(cause)); row.error = stage + ' 실패: ' + String(cause); },
                native: async () => {
                    let opening = (proposal?.pages || []).map(page => page.text).join(' ');
                    if (!opening) {
                        try {
                            opening = await readPDFFrontMatter(attachment, null, 1, 6000);
                        }
                        catch {
                            opening = '';
                        }
                    }
                    if (shouldTryKoreanPatent(before, attachment, opening)) {
                        row.koreanAttempted = true;
                        const patent = await recognizeKoreanPatent(item, attachment, before);
                        trace('1. 한국 특허 공보 직접 분석: ' + (patent ? '후보 수신' : '결과 없음'));
                        if (patent) {
                            row.patentPDF = true;
                            row.authoritative = true;
                            row.verifiedPDF = true;
                            row.recognitionSource = '대한민국특허청 공보 PDF 직접 분석';
                            return patent;
                        }
                    }
                    else {
                        const front3 = proposal?.pages?.length ? proposal.pages.filter(page => Number(page.page) <= 3).map(page => page.text).join('\f') : opening;
                        const us = await this.usPatentOfPrinted(row, item, attachment, before, {
                            texts: [front3], readTitles: [String(proposal?.metadata.fields.title || '')], printed: front3, embedded: true
                        });
                        if (us) {
                            row.patentPDF = true;
                            row.authoritative = true;
                            row.verifiedPDF = true;
                            row.recognitionSource = `Google Patents 기록 (${us.where} US 공보번호 ${us.printed})`;
                            trace(`1. US 공보: ${us.where} 공보번호 ${us.printed} → Google Patents 기록 수신`);
                            return us.result;
                        }
                    }
                    if (!this.methods.native) {
                        trace('Zotero 인식: 설정에서 꺼짐');
                        select('nativeRecognizer', false, '묻지 않음: 인식 방법 선택에서 꺼짐');
                        return null;
                    }
                    const found = await recognizeFromPDF(item, attachment, true);
                    trace('1. Zotero 인식: ' + (found ? '후보 수신' : '결과 없음'));
                    const scope = found ? this.scopeOfMetadata(found.metadata) : 'unknown';
                    if (found && (scope === 'part' || scope === 'container')) {
                        const why = scope === 'part' ? `인식기의 ${found.metadata.itemType} 기록(${String(found.metadata.fields.pages || '')})은 이 문서의 한 부분입니다 — 문서가 그 범위 뒤로 이어집니다`
                            : `인식기의 ${found.metadata.itemType} 기록은 이 문서를 담은 자료입니다 — 문서의 쪽 수와 쪽이 적은 제 범위가 그 일부를 가리킵니다`;
                        this.noteRelated(found.metadata, scope, why, row);
                        const whole = scope === 'part' ? asWholeOf(this.scoped(found.metadata)) : null;
                        if (whole) {
                            const metadata = snapshotFrom(item, before, whole.itemType, whole.fields, whole.creators as any);
                            select('nativeRecognizer', true, `${why} — 그 부분을 담은 「${String(whole.fields.title || '').slice(0, 60)}」로 세움`);
                            row.recognitionSource = 'Zotero native PDF recognizer → 한 부분의 기록이 가리키는 전체';
                            this.candidates.add(metadata);
                            return resultOf(metadata);
                        }
                        select('nativeRecognizer', false, why);
                        return null;
                    }
                    select('nativeRecognizer', !!found, found ? '후보 수신 — 뒤 단계가 확인하거나 대신할 수 있음' : '결과 없음');
                    if (found)
                        row.recognitionSource = 'Zotero native PDF recognizer';
                    if (found)
                        this.candidates.add(found.metadata);
                    return found;
                },
                urls: async (candidate) => {
                    await readFront();
                    let found = candidate;
                    const identifierText = (proposal?.pages || []).filter(page => Number(page.page) <= 5 && !(page as any).inserted).map(page => page.text).join('\f') || front;
                    if (this.methods.identifiers && front) {
                        try {
                            const readTitle = String(proposal?.metadata.fields.title || '');
                            const readCreators = proposal?.metadata.creators || [];
                            const lookup = await this.stoppable(recognizeFromTextIdentifiers(item, before, identifierText, '', { readTitle, readCreators, scopeOf: this.scopeOfMetadata }));
                            row.lookupNotes = [...(row.lookupNotes || []), ...lookup.tried];
                            row.lookupUnreachable = !!lookup.unreachable;
                            const related = lookup.related as IdentifierLookup['related'];
                            if (related)
                                this.noteRelated(related.record.metadata, related.scope, related.reason, row);
                            let record = lookup.record;
                            const missed = !record && !lookup.unreachable ? lookup.tried.find((entry: any) => entry.kind === 'DOI' && entry.outcome === 'noMatch' && entry.value) : null;
                            if (missed) {
                                try {
                                    const landing = await this.stoppable(recognizeFromWebPage(item, before, `https://doi.org/${missed.value}`, () => this.cancel));
                                    if (landing?.metadata) {
                                        const fields = landing.metadata.fields || {};
                                        const identity = recordIsTheReadWork({ title: fields.title, creators: landing.metadata.creators, itemType: landing.metadata.itemType,
                                            DOI: fields.DOI || missed.value, pages: fields.pages, publicationTitle: fields.publicationTitle }, { pages: identifierText.split('\f'), readTitle, readCreators });
                                        const scope = identity.same ? this.scopeOfMetadata(landing.metadata) : 'unknown';
                                        if (identity.same && scope !== 'container' && scope !== 'part') {
                                            record = { source: null, metadata: landing.metadata, changes: [], identifier: { kind: 'DOI', value: String(missed.value) } } as any;
                                            row.lookupNotes = [...(row.lookupNotes || []), { kind: 'DOI', value: String(missed.value), outcome: 'record', reason: `Crossref에 없는 DOI — doi.org가 가리키는 페이지의 서지정보(${landing.evidence})` }];
                                        }
                                        else {
                                            const why = identity.same ? `${landing.metadata.itemType} 기록은 이 문서의 ${scope === 'container' ? '담은 자료' : '한 부분'}입니다 — 문서의 쪽 수와 쪽이 적은 제 범위가 가리킵니다` : identity.reason;
                                            if (identity.relation === 'container' || scope === 'container' || scope === 'part')
                                                this.noteRelated(landing.metadata, scope === 'part' ? 'part' : 'container', why, row);
                                            row.lookupNotes = [...(row.lookupNotes || []), { kind: 'DOI', value: String(missed.value), outcome: 'rejected', reason: `doi.org가 가리키는 페이지의 기록 — ${why}` }];
                                        }
                                    }
                                }
                                catch (cause) {
                                    trace('DOI 주소 페이지 읽기 실패: ' + String(cause).slice(0, 160));
                                }
                            }
                            if (record) {
                                found = record;
                                row.identifierPDF = true;
                                row.authoritative = true;
                                row.recognitionSource = 'PDF 식별자 → Zotero 식별자 검색';
                                this.noteTextStageLink(record.metadata, `PDF에 인쇄된 ${record.identifier.kind}의 레지스트리 기록`, 'identifier');
                                this.noteIdentity({ ...identityFromIdentifier(record.identifier, record.metadata, 'printedInDocument', RECOGNITION_PIPELINE_VERSION, this.evidence || identifierText),
                                    recordFields: Object.fromEntries(Object.entries(record.metadata.fields || {}).filter(([, value]) => String(value ?? '').trim()).map(([field, value]) => [field, String(value)])) });
                                select('identifierRecord', true, `PDF에 인쇄된 ${record.identifier.kind}의 레코드이고, 인용 밖에서 이 문서의 제목으로 인쇄됨`);
                                if (candidate)
                                    select('nativeRecognizer', false, '인쇄된 식별자의 레코드가 대신 섬');
                            }
                            else {
                                const refused = [...(row.lookupNotes || [])].reverse().find((entry: any) => entry.outcome === 'rejected');
                                const skipped = lookup.tried.find((entry: any) => entry.outcome === 'notAsked');
                                select('identifierRecord', false, refused ? `인쇄된 ${refused.kind}의 기록을 거절: ${String(refused.reason).slice(0, 160)}`
                                    : lookup.unreachable ? '조회가 끝나지 않음'
                                        : skipped ? `쪽의 DOI ${skipped.value}을(를) 묻지 않음: ${String(skipped.reason).slice(0, 160)}` : '쪽에 풀리는 DOI·ISBN 없음');
                            }
                        }
                        catch (cause) {
                            row.lookupUnreachable = true;
                            row.lookupNotes = [...(row.lookupNotes || []), { kind: 'identifier', value: '', outcome: 'failed', reason: String(cause).slice(0, 200) }];
                            trace('식별자 URL 조회 실패: ' + String(cause));
                            select('identifierRecord', false, '조회 실패: ' + String(cause).slice(0, 120));
                        }
                    }
                    if (this.cancel)
                        return found;
                    const thesisHint = proposal?.metadata.itemType === 'thesis'
                        || THESIS_WORD.test(`${front} ${String(attachment.attachmentFilename || '')}`);
                    if (thesisHint && front && this.methods.searchRestore && !row.identifierPDF && !this.cancel) {
                        try {
                            const readingTitle = String(proposal?.metadata.fields.title || '');
                            const korean = await autoKorean(item, attachment, before, () => this.cancel, undefined, {
                                material: 'thesis',
                                frontText: front, readingTitles: readingTitle ? [readingTitle] : [],
                                pageTexts: (proposal?.pages || []).map(page => page.text)
                            });
                            if (korean.result) {
                                found = { source: null, metadata: korean.result.metadata, changes: korean.result.changes };
                                if (korean.verified)
                                    this.noteTextStageLink(korean.result.metadata, 'RISS가 확인한 학위논문 기록', 'RISS');
                                else
                                    this.candidates.add(korean.result.metadata);
                                row.lookupNotes = [...(row.lookupNotes || []), { kind: 'RISS', value: '학위논문', outcome: korean.verified ? 'verified' : 'review', reason: korean.reason }];
                                row.authoritative = !!korean.verified;
                                row.manualReview = !korean.verified;
                                row.recognitionSource = `학위논문 RISS 우선 검색${korean.verified ? ' · PDF 근거 확인' : ' · 검토 필요'}`;
                                trace('2. 학위논문 RISS 우선 검색: 서지정보 수신');
                                if (candidate)
                                    select('nativeRecognizer', false, '학위논문 RISS 레코드가 대신 섬');
                                return found;
                            }
                            trace('2. 학위논문 RISS 우선 검색: ' + korean.reason);
                            row.lookupNotes = [...(row.lookupNotes || []), { kind: 'RISS', value: '학위논문', outcome: 'noMatch', reason: korean.reason }];
                            if (!row.candidates?.length && korean.candidates?.length)
                                row.candidates = korean.candidates.slice(0, 5);
                        }
                        catch (cause) {
                            trace('학위논문 RISS 검색 실패: ' + String(cause));
                        }
                    }
                    trace('2. URL·카탈로그 검색');
                    this.restoredRecord = null;
                    const searched = await search(found);
                    const target = row.restore?.target;
                    if (searched && target && target.relation === 'sameEdition' && searched !== found)
                        this.noteTextStageLink(this.restoredRecord || searched.metadata, `검색 복원으로 연결된 기록(${target.provider})`, 'restore', true);
                    return searched;
                },
                settled: candidate => {
                    if (!candidate)
                        return false;
                    if (row.patentPDF && row.authoritative)
                        return true;
                    const title = String(candidate.metadata.fields.title || '');
                    if (row.authoritative && title && !isNotATitle(title) && titleSupportedByPDF(title, front))
                        return true;
                    const pageTitle = String(proposal?.metadata.fields.title || '');
                    const korean = profile.script ? profile.script === 'hangul'
                        : /^ko\b/i.test(String(candidate.metadata.fields.language || ''))
                            || /^ko\b/i.test(String(proposal?.metadata.fields.language || '')) || /[가-힣]/.test(pageTitle);
                    if (!title || isNotATitle(title) || (korean && !/[가-힣]/.test(title)))
                        return false;
                    const printedText = [front, ...(proposal?.pages || []).map(page => page.text)].filter(Boolean).join('\n');
                    if (!titleSupportedByPDF(title, printedText))
                        return false;
                    const target = row.restore?.target;
                    return (!!target && target.relation === 'sameEdition' && !target.conflicts.length && !row.restore?.fieldConflicts.length)
                        || (!!row.authoritative && titleSupportedByPDF(title, front));
                },
                vision: async () => {
                    trace('3. URL 결과 미확정 → LM Studio 이미지 인식');
                    const held = { authoritative: row.authoritative, identifierPDF: row.identifierPDF, patentPDF: row.patentPDF, verifiedPDF: row.verifiedPDF };
                    row.authoritative = false;
                    row.identifierPDF = false;
                    row.patentPDF = false;
                    row.verifiedPDF = false;
                    const earlierEvidence = this.evidence;
                    const layerReading = profile.textLayer === 'readable' ? proposal : null;
                    const found = await this.readVisionCandidate(row, item, attachment, before);
                    profile = documentProfile(this.evidence as EvidenceBundle | undefined);
                    if (!found) {
                        Object.assign(row, held);
                        return null;
                    }
                    const earlier = this.textStageLinksOfTheReading(row, found);
                    for (const entry of earlier) {
                        const filled = this.addSource(row, item, before, found, entry.source);
                        if (filled.length)
                            row.attempts = [...(row.attempts || []), `텍스트층 단계에서 연결된 기록(${entry.source.label})이 비전 판독의 빈 칸을 채움: ${filled.join(', ')}`];
                    }
                    this.fillFromRecord(row, item, before, found);
                    if (layerReading)
                        this.fillFromLayerReading(row, item, before, found, layerReading);
                    for (const entry of [...(row.selection || [])])
                        if (entry.chosen)
                            select(entry.candidate, false, '텍스트층 결과가 확정되지 않아 쪽 이미지 판독이 대신 섬');
                    select('coverReading', true, '쪽 이미지(비전 OCR)로 읽은 표지 — ' + found.source);
                    proposal = found.proposal;
                    row.restore = undefined;
                    row.restoreGate = undefined;
                    row.fieldConflicts = undefined;
                    const identity = this.evidence?.identity !== earlierEvidence?.identity ? this.evidence?.identity : undefined;
                    const keptLinks = [...earlier.flatMap(entry => entry.links), ...(this.evidence?.links || []).filter(link => ACCEPTED_RECORD.test(String(link.rule || '')))];
                    const keptRecords = earlier.flatMap(entry => entry.records);
                    this.evidence = { observations: (this.evidence?.observations || []).filter(entry => DOCUMENT_READINGS.has(entry.kind)), ...(identity ? { identity } : {}) };
                    for (const record of keptRecords)
                        this.noteEvidence(record.text, record.locator, { kind: 'externalRecord', complete: true });
                    for (const link of keptLinks)
                        this.noteLink(link);
                    for (const entry of earlier)
                        if (!entry.links.length)
                            this.noteRecordAsLink(entry.source.metadata, entry.rule);
                    row.recognitionSource = found.source;
                    row.ocrRead = true;
                    row.manualReview = true;
                    return resultOf(found.metadata);
                },
                visionUrls: async (candidate) => {
                    trace('4. LM Studio 서지정보로 URL 재검색');
                    const linked = await search(candidate);
                    if (row.restore?.target)
                        return linked;
                    trace('5. 연결된 URL 없음 → LM Studio 서지정보 채택');
                    return candidate;
                },
                fallback: async () => {
                    if (!proposal?.metadata.fields.title)
                        return null;
                    row.recognitionSource = 'PDF 표지 문서 판독 · LM Studio 결과 없음';
                    row.manualReview = true;
                    if (row.coverProposal)
                        row.coverProposal.used = true;
                    select('coverReading', true, '텍스트층 표지 판독 — 앞 단계가 아무것도 내놓지 못함');
                    return resultOf(this.withRelated(row, item, before, proposal.metadata, false, true));
                }
            });
            if (this.cancel)
                return;
            const settledHere = !!result && (!!row.restore?.target || !!row.authoritative);
            if (row.lookupUnreachable && row.pdfFingerprint && !settledHere) {
                const kept = await readRecognitionCache(row.libraryID, row.key, row.pdfFingerprint);
                const confirmed = !!kept && (!!kept.restore?.target || !!kept.authoritative) && !kept.lookupUnreachable;
                if (kept?.status === "recognized" && kept.recognized && (!result || confirmed)) {
                    this.restoreFromCache(row, before, kept, '외부 조회 실패로 같은 PDF·정책의 기존 결과 유지');
                    return;
                }
            }
            if (!result) {
                row.status = front.trim() ? 'noMatch' : 'textlessPDF';
                row.error = (row.error ? row.error + '\n' : '') + (row.attempts || []).join('\n');
                if (!row.lookupUnreachable)
                    await this.cacheResult(row, row.status);
                return;
            }
            if (result && !row.ocrRead && this.untitledReading) {
                const filled = emptyFieldsFilledBy(result.metadata, this.untitledReading);
                if (filled.filled.length) {
                    if (this.candidates.has(result.metadata))
                        this.candidates.add(filled.metadata);
                    if (this.readings.has(result.metadata))
                        this.readings.add(filled.metadata);
                    result = resultOf(filled.metadata);
                    trace('제목을 세우지 못한 LM Studio 판독이 앞 단계의 답의 빈 칸을 채움: ' + filled.filled.join(', '));
                }
            }
            const layer = proposal as CoverProposal | null;
            if (result && !row.ocrRead && !row.patentPDF && !row.coverProposal?.used && layer?.metadata && result.metadata !== layer.metadata
                && !this.candidates.has(result.metadata)) {
                const outcome = mergeSources(item, before, [
                    { kind: 'link', label: '연결된 기록', metadata: result.metadata },
                    { kind: 'layer', label: '텍스트층 표지 판독', metadata: layer.metadata, typeRead: layer.typeRead !== false,
                        guessed: guessesOfAReading(layer.sources, (layer.metadata.creators || []).length > 0) }
                ], this.mergeContext(row));
                const filled = outcome.filled.filter(entry => entry.kind === 'layer').flatMap(entry => entry.fields)
                    .map(field => field === 'itemType' ? `itemType(${outcome.metadata.itemType})` : field);
                const refined = [...new Set(outcome.refined.filter(entry => entry.kind === 'layer').map(entry => `${entry.field}(같은 진술)`))];
                if (filled.length || refined.length) {
                    result = resultOf(outcome.metadata);
                    trace('텍스트층 표지 판독이 연결된 기록의 빈 칸을 채움: ' + [...filled, ...refined].join(', '));
                }
            }
            if (isResearchSquare(result.metadata)) {
                const published = await resolvePublishedVersion(item, result.metadata).catch(() => null);
                if (published) {
                    result = published;
                    row.recognitionSource = `${row.recognitionSource ? `${row.recognitionSource} → ` : ''}사전출판본의 최종 출판본 (Crossref)`;
                    row.attempts?.push(`Research Square 사전출판본 → 최종 출판본 ${published.metadata.fields.DOI || ''}`.trim());
                }
                else
                    row.attempts?.push('Research Square 사전출판본 — 최종 출판본을 찾지 못함');
            }
            if (row.coverProposal && !row.coverProposal.used)
                select('coverReading', false, '앞 단계의 답이 섬 — 표지 판독은 필드 확인에만 쓰임');
            row.fieldConflicts = row.restore?.fieldConflicts || [];
            this.classifyRecognized(row, before, result.metadata, !!row.authoritative, !!row.patentPDF, !!row.technicalPDF, !!row.identifierPDF);
            row.match?.reasons.unshift(...(row.attempts || []));
            row.completion = reportCompletion(row, row.coverProposal?.documentPages ?? undefined);
            await this.cacheResult(row, 'recognized');
        }, 'Preview', { ...options, reread });
    }
    async clearRescanMarks(): Promise<number> {
        if (this.busy)
            return 0;
        const marked = this.rows.filter(row => row.rescannedAt !== undefined);
        for (const row of marked) {
            delete row.rescannedAt;
            await this.save(row);
        }
        if (marked.length)
            this.onChange();
        return marked.length;
    }
    async clearCacheAndReset(): Promise<number> {
        if (this.busy)
            return 0;
        const removed = await clearRecognitionCache(this.rows);
        for (const row of this.rows) {
            if (['updated', 'applying', 'excluded'].includes(row.status))
                continue;
            resetRecognitionAttempt(row);
            row.before = undefined;
            row.pdfFingerprint = undefined;
            await this.save(row);
        }
        return removed;
    }
    async exclude(row: Row): Promise<void> {
        if (this.busy)
            throw new Error('작업이 끝난 뒤에 제외할 수 있습니다.');
        await this.excludeRow(row);
        this.onChange();
    }
    private async excludeRow(row: Row): Promise<void> {
        await addPDFExclusion(row.libraryID, row.key, row.pdfFingerprint || '', row.title);
        row.status = 'excluded';
        row.checked = false;
        row.changes = [];
        delete row.storedDifference;
        row.error = row.pdfFingerprint
            ? '현재 PDF를 이후 검색·검토에서 제외했습니다. PDF가 변경되면 자동으로 다시 검색합니다.'
            : '이 항목을 이후 검색·검토에서 제외했습니다. PDF를 읽지 못한 상태라 파일이 바뀌어도 자동으로 돌아오지 않습니다.';
        await this.save(row);
    }
    async excludeSelected(): Promise<number> {
        if (this.busy)
            throw new Error('작업이 끝난 뒤에 제외할 수 있습니다.');
        const rows = this.rows.filter(row => row.checked && row.status !== 'excluded' && row.status !== 'applying');
        try {
            for (const row of rows)
                await this.excludeRow(row);
        }
        finally {
            if (rows.length)
                this.onChange();
        }
        return rows.length;
    }
    async includeSelected(): Promise<number> {
        if (this.busy)
            throw new Error('작업이 끝난 뒤에 해제할 수 있습니다.');
        const rows = this.rows.filter(row => row.checked && row.status === 'excluded');
        try {
            for (const row of rows)
                await this.includeRow(row);
        }
        finally {
            if (rows.length)
                this.onChange();
        }
        return rows.length;
    }
    async include(row: Row): Promise<void> {
        if (this.busy)
            return;
        await this.includeRow(row);
        this.onChange();
    }
    private async includeRow(row: Row): Promise<void> {
        await removePDFExclusion(row.libraryID, row.key);
        row.status = 'pending';
        row.checked = false;
        row.changes = [];
        row.before = undefined;
        row.recognized = undefined;
        row.error = '';
        row.match = undefined;
        row.safety = undefined;
        row.recognitionSource = '';
        row.candidates = [];
        row.koreanAttempted = false;
        row.verifiedPDF = false;
        row.patentPDF = false;
        row.technicalPDF = false;
        row.identifierPDF = false;
        row.pdfFingerprint = undefined;
        row.cacheState = undefined;
        delete row.storedDifference;
        await this.save(row);
    }
    async recognizeFromReference(target: Row, input: string): Promise<void> {
        if (this.busy)
            return;
        await this.run([target], async (row) => {
            const item = this.item(row);
            this.carriedDecisions = { approvals: row.approvals, protections: row.protections };
            this.carriedChoices = personChoices(row);
            resetRecognitionAttempt(row);
            this.evidence = undefined;
            this.related = undefined;
            row.independentMetadata = true;
            row.replaceMetadata = this.overwriteFromDocument;
            row.standalonePDF = isStandalonePDF(item);
            const before = row.standalonePDF ? await emptyRecord(item) : await snapshotItem(item);
            const found = await recognizeFromReference(item, before, input, () => this.cancel);
            if (!found)
                throw new Error('입력한 주소에서 서지정보를 읽지 못했습니다. 초록·서지 페이지 주소인지 확인하세요.');
            row.before = before;
            this.evidence = undefined;
            try {
                const choice = row.standalonePDF ? { attachment: item } : await selectPrimaryPDF(item);
                if (choice.attachment) {
                    row.attachmentKey = String(choice.attachment.key || '');
                    row.pdfFingerprint = await pdfInputFingerprint(choice.attachment);
                    this.noteEvidence(await readPDFFrontMatter(choice.attachment, null, 3, 6000), `attachment:${row.attachmentKey}#pages1-3`, { complete: false });
                }
            }
            catch (cause) {
                Zotero.debug(`[PDF Metadata Refresh] reference corroboration unavailable for item=${row.key}: ${String(cause)}`);
            }
            this.noteEvidence(String(input || ''), `reference:${String(input || '').slice(0, 120)}`, { kind: 'userInput', complete: true });
            row.recognized = undefined;
            row.changes = [];
            row.candidates = [];
            row.error = '';
            row.match = undefined;
            row.safety = undefined;
            row.koreanAttempted = false;
            row.fieldChoice = undefined;
            row.fieldEdit = undefined;
            row.advice = undefined;
            row.verifiedPDF = false;
            row.patentPDF = false;
            row.technicalPDF = false;
            row.identifierPDF = false;
            row.recognitionSource = found.evidence;
            row.authoritative = !!found.authoritative;
            if (found.identifier) {
                this.noteIdentity(identityFromIdentifier(found.identifier, found.metadata, 'suppliedByUser', RECOGNITION_PIPELINE_VERSION, documentText(this.evidence)));
            }
            this.classifyRecognized(row, before, found.metadata);
            row.manualReview = true;
            if (row.status === 'ready')
                row.status = 'review';
            row.checked = false;
            await this.cacheResult(row, 'recognized');
        }, '링크·DOI로 인식', { keep: true });
    }
    async apply(fields: Set<string>, rows?: Row[]): Promise<ApplyRun | undefined> {
        if (this.busy)
            return undefined;
        const ticked = (rows ?? this.rows).filter(row => row.checked);
        const planned: Row[] = [], skipped: ApplyRun['skipped'] = [];
        for (const row of ticked) {
            const code = applySkipCode(row, fields);
            if (code === 'alreadyApplied')
                row.checked = false;
            if (code)
                skipped.push({ id: row.id, code });
            else
                planned.push(row);
        }
        const startedAt = Date.now();
        const run: ApplyRun = { id: startedAt, kind: 'apply', startedAt, endedAt: 0, asked: ticked.length, done: [], fieldCounts: {}, skipped, failed: [], conflicts: [], stopped: false };
        const write = async (row: Row) => {
            const item = this.item(row);
            const plan = writePlanFor(row, fields);
            const refusedFields = plan.refused.filter(entry => entry.code !== 'notSelected');
            if (!plan.changes.length) {
                run.skipped.push({ id: row.id, code: applySkipCode(row, fields) || 'other' });
                return;
            }
            const earlier = row.applied;
            delete row.applied;
            let result: WriteResult;
            try {
                result = row.standalonePDF
                    ? await createPlannedParent(item, row, plan, RECOGNITION_PIPELINE_VERSION, r => this.save(r))
                    : await writePlannedChanges(item, row, plan, RECOGNITION_PIPELINE_VERSION, r => this.save(r));
            }
            catch (cause) {
                if (earlier)
                    row.applied = earlier;
                throw cause;
            }
            if (!result.written.length) {
                if (earlier)
                    row.applied = earlier;
                row.status = 'review';
                row.checked = false;
                row.error = result.refused.map(entry => `${entry.field}: ${entry.reason}`).join(' · ');
                return;
            }
            if (result.createdParentID !== undefined)
                row.createdParentID = result.createdParentID;
            row.status = 'updated';
            row.checked = false;
            const notWritten = notWrittenOf(plan.refused, row.fieldChoice, row.advice);
            row.applied = result.expected && row.before
                ? appliedRecordOf(row.before, result.expected, result.written, notWritten, Date.now(), run.id, result.createdParentID)
                : { source: 'recorded', at: Date.now(), run: run.id, notWritten,
                    fields: result.written.map(change => ({ field: change.field, old: change.oldValue, new: change.newValue,
                        kind: change.newValue === '' || change.newValue === null || change.newValue === undefined ? 'cleared' : String(change.oldValue ?? '') === '' ? 'added' : 'changed' })) };
            row.error = refusedFields.length
                ? `${result.written.length}개 항목을 적용했습니다. 적용하지 않은 항목 — ${refusedFields.map(entry => `${entry.field}: ${entry.reason}`).join(' · ')}`
                : '';
        };
        try {
            await this.run(planned, write, 'Metadata 적용');
        }
        finally {
            run.endedAt = Date.now();
            run.stopped = this.cancel;
            for (const [index, row] of planned.entries()) {
                if (row.status === 'updated' && row.applied?.run === run.id)
                    run.done.push(row.id);
                else if (index < this.metrics.completed && !run.skipped.some(entry => entry.id === row.id))
                    run.failed.push({ id: row.id, key: row.key, reason: failureReason(row.error, '쓰지 않았습니다') });
            }
            run.fieldCounts = fieldCountsOf(planned.filter(row => run.done.includes(row.id)).map(row => row.applied));
            this.lastApply = run;
            this.lastRun = run;
        }
        this.onChange();
        return run;
    }
    appliedOf(row: Row): AppliedRecord | null { return appliedRecord(row); }
    async appliedState(row: Row): Promise<'same' | 'changed' | 'missing' | 'unknown'> {
        try {
            const record = appliedRecord(row);
            if (record?.createdParentID)
                return (await this.createdParentCheck(row, record)).state;
            const meta = row.before?.appliedMetadata;
            if (!meta)
                return 'unknown';
            return matchesFingerprint(await snapshotItem(this.item(row)), meta, row.before) ? 'same' : 'changed';
        }
        catch {
            return 'missing';
        }
    }
    private async createdParentCheck(row: Row, record: AppliedRecord): Promise<{
        state: 'same' | 'changed' | 'missing' | 'unknown';
        reason: string;
        attachment?: any;
    }> {
        const parentID = record.createdParentID!;
        const attachment = Zotero.Items.get(row.id);
        if (!attachment || attachment.deleted || attachment.key !== row.key || attachment.libraryID !== row.libraryID) {
            return { state: 'missing', reason: 'PDF 첨부를 찾을 수 없습니다 — 삭제되거나 옮겨졌습니다.' };
        }
        const parent = Zotero.Items.get(parentID);
        if (!parent || parent.deleted)
            return { state: 'missing', reason: '만든 상위 항목을 찾을 수 없습니다 — 삭제됐거나 휴지통에 있습니다.' };
        if (attachment.parentItemID !== parentID) {
            return { state: 'changed', reason: '적용 뒤 PDF가 다른 항목으로 옮겨져 되돌리지 않았습니다 — 지금 상태를 그대로 둡니다.' };
        }
        if (!record.createdParentMetadata) {
            return { state: 'unknown', reason: '만든 상위 항목의 적용 지문이 없어(이전 빌드) Zotero에서 편집됐는지 알 수 없어 지우지 않았습니다. Zotero에서 직접 정리하세요.' };
        }
        if (!matchesFingerprint(await snapshotItem(parent), record.createdParentMetadata)) {
            return { state: 'changed', reason: '적용 뒤 Zotero에서 만든 상위 항목이 편집돼 되돌리지 않았습니다 — 지금 항목을 그대로 둡니다.' };
        }
        return { state: 'same', reason: '', attachment };
    }
    async undo(rows?: Row[]): Promise<ApplyRun | undefined> {
        if (this.busy)
            return undefined;
        const targets = (rows ?? this.rows).filter(row => row.status === 'updated');
        const startedAt = Date.now();
        const run: ApplyRun = { id: startedAt, kind: 'undo', startedAt, endedAt: 0, asked: targets.length, done: [], fieldCounts: {}, skipped: [], failed: [], conflicts: [], stopped: false };
        const conflicted = new Set<number>();
        const restore = async (row: Row) => {
            const record = appliedRecord(row);
            if (record?.createdParentID) {
                const check = await this.createdParentCheck(row, record);
                if (check.state === 'changed')
                    conflicted.add(row.id);
                if (check.state !== 'same')
                    throw new Error(check.reason);
                await detachCreatedParent(check.attachment, record.createdParentID);
                row.createdParentID = undefined;
            }
            else {
                if (!row.before)
                    throw new Error('되돌리기 백업이 없습니다.');
                this.item(row);
                try {
                    await restoreSnapshot(row.before);
                }
                catch (cause) {
                    if (!/Undo conflict/.test(String(cause)))
                        throw cause;
                    conflicted.add(row.id);
                    throw new Error('적용 뒤 Zotero에서 이 항목이 편집돼 되돌리지 않았습니다 — 지금 값을 그대로 둡니다.');
                }
            }
            row.status = 'undone';
            row.checked = false;
            row.error = '';
            row.applied = { ...(record ?? { source: 'derived' as const, fields: [], notWritten: [] }), undoneAt: Date.now() };
        };
        try {
            await this.run(targets, restore, '복원');
        }
        finally {
            run.endedAt = Date.now();
            run.stopped = this.cancel;
            for (const [index, row] of targets.entries()) {
                if (row.status === 'undone')
                    run.done.push(row.id);
                else if (index >= this.metrics.completed)
                    continue;
                else if (conflicted.has(row.id))
                    run.conflicts.push({ id: row.id, key: row.key });
                else
                    run.failed.push({ id: row.id, key: row.key, reason: failureReason(row.error, '되돌리지 못했습니다') });
            }
            this.lastRun = run;
        }
        this.onChange();
        return run;
    }
    private async run(rows: Row[], operation: (row: Row) => Promise<void>, label = '작업', options: {
        keep?: boolean;
        reread?: boolean;
    } = {}) {
        if (this.busy)
            return;
        this.busy = true;
        this.cancel = false;
        this.stopNote = '';
        this.metrics = { operation: label, startedAt: Date.now(), endedAt: 0, total: rows.length, completed: 0, currentTitle: '', lastItemMs: 0 };
        try {
            for (let i = 0; i < rows.length && !this.cancel; i++) {
                const row = rows[i];
                const itemStartedAt = Date.now();
                this.metrics.currentTitle = row.title;
                this.progress = `${label} ${i + 1} / ${rows.length}`;
                this.onChange();
                const statusBefore = row.status;
                this.carriedDecisions = undefined;
                this.carriedChoices = undefined;
                this.related = undefined;
                const ticked = !!options.reread && row.checked;
                this.rereading = ticked;
                const held = options.keep ? cloneValue(row) : undefined;
                let failure: unknown = null;
                try {
                    await operation(row);
                }
                catch (e) {
                    failure = e;
                    row.error = String(e);
                    if (row.status !== 'updated')
                        row.status = 'failed';
                }
                this.rereading = false;
                if (held && (this.cancel || failure)) {
                    restoreRow(row, held);
                    row.error = this.cancel
                        ? (this.stopNote || `중지됨 — ${label} 작업을 마치지 못해 이 행은 작업 전 상태 그대로입니다`)
                        : `${label} 실패 — 이 행은 작업 전 상태 그대로입니다: ${String(failure)}`;
                }
                else if (this.cancel && label === 'Preview' && statusBefore === 'pending' && (row.status !== 'pending' || this.stopNote)) {
                    row.status = 'pending';
                    row.checked = ticked;
                    row.changes = [];
                    row.recognized = undefined;
                    row.verification = undefined;
                    row.restoreGate = undefined;
                    row.error = this.stopNote || '중지됨 — 조사가 끝나기 전에 멈췄으므로 이어서 실행할 때 처음부터 다시 조사합니다';
                }
                if (ticked) {
                    row.checked = isSelectable(row);
                    if (!this.cancel)
                        row.rescannedAt = Date.now();
                }
                await this.save(row);
                this.metrics.completed = i + 1;
                this.metrics.lastItemMs = Date.now() - itemStartedAt;
                this.onChange();
            }
            this.progress = this.cancel ? (this.stopNote || '중지됨 — 미처리 항목은 이어서 실행 가능') : '완료';
        }
        finally {
            this.carriedDecisions = undefined;
            this.carriedChoices = undefined;
            this.rereading = false;
            this.busy = false;
            this.metrics.endedAt = Date.now();
            this.metrics.currentTitle = '';
            this.onChange();
        }
    }
}

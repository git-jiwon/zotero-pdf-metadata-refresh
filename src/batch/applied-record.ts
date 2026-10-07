import type { FieldChange } from '../types';
import type { EligibilityCode, EligibilityReason } from './approval';
import type { Row } from './row';
import { metadataFingerprint, parseFingerprint } from '../metadata/snapshot';
export type AppliedKind = 'changed' | 'added' | 'cleared' | 'typeLoss';
export const APPLIED_KINDS: AppliedKind[] = ['changed', 'added', 'cleared', 'typeLoss'];
export const APPLIED_KIND_LABEL: Record<AppliedKind, string> = { changed: '변경', added: '추가', cleared: '비움', typeLoss: '유형 변경으로 사라짐' };
export interface AppliedField {
    field: string;
    old: unknown;
    new: unknown;
    kind: AppliedKind;
}
export interface NotWrittenField {
    field: string;
    code: EligibilityCode;
    reason: string;
}
export interface AppliedRecord {
    source: 'recorded' | 'derived' | 'estimated';
    at?: number;
    run?: number;
    fields: AppliedField[];
    notWritten: NotWrittenField[];
    createdParentID?: number;
    createdParentMetadata?: string;
    undoneAt?: number;
}
export const isAppliedStatus = (status: string | undefined): boolean => status === 'updated' || status === 'applying';
const RECORDED_STATUSES = new Set(['updated', 'applying', 'undone']);
const empty = (value: unknown): boolean => value === '' || value === null || value === undefined || (Array.isArray(value) && !value.length);
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const sameValue = (left: unknown, right: unknown): boolean => JSON.stringify(canonical(left ?? '')) === JSON.stringify(canonical(right ?? ''));
export interface RecordShape {
    itemTypeID: number;
    itemType?: string;
    fields: Record<string, unknown>;
    creators: unknown[];
}
export function appliedFieldsBetween(before: RecordShape, after: RecordShape, written: FieldChange[]): AppliedField[] {
    const out: AppliedField[] = [];
    const typeChanged = after.itemTypeID !== before.itemTypeID;
    if (typeChanged) {
        const typeWrite = written.find(change => change.field === 'itemType');
        out.push({ field: 'itemType', old: before.itemType ?? '', new: after.itemType || String(typeWrite?.newValue ?? ''), kind: 'changed' });
    }
    const clearedByWrite = new Set(written.filter(change => change.field !== 'itemType' && change.field !== 'creators' && empty(change.newValue)).map(change => change.field));
    const fieldsBefore = before.fields || {}, fieldsAfter = after.fields || {};
    for (const field of new Set([...Object.keys(fieldsBefore), ...Object.keys(fieldsAfter)])) {
        const old = fieldsBefore[field] ?? '', now = fieldsAfter[field] ?? '';
        if (sameValue(old, now))
            continue;
        const kind: AppliedKind = empty(now) ? (typeChanged && !clearedByWrite.has(field) ? 'typeLoss' : 'cleared') : empty(old) ? 'added' : 'changed';
        out.push({ field, old, new: now, kind });
    }
    const creatorsBefore = before.creators || [], creatorsAfter = after.creators || [];
    if (!sameValue(creatorsBefore, creatorsAfter)) {
        out.push({ field: 'creators', old: creatorsBefore, new: creatorsAfter, kind: empty(creatorsAfter) ? 'cleared' : empty(creatorsBefore) ? 'added' : 'changed' });
    }
    return out;
}
export function notWrittenOf(refused: EligibilityReason[], fieldChoice?: Record<string, boolean>, advice?: Record<string, string>): NotWrittenField[] {
    return refused.filter(entry => entry.code !== 'notSelected' || fieldChoice?.[entry.field] === false)
        .map(entry => {
        if (entry.code !== 'notSelected')
            return { field: entry.field, code: entry.code, reason: entry.reason };
        const note = String(advice?.[entry.field] || '');
        return { field: entry.field, code: entry.code, reason: note ? `체크가 풀려 있었습니다 — ${note}` : '이 행에서 체크를 풀었습니다' };
    });
}
export function appliedRecordOf(before: RecordShape, expected: RecordShape, written: FieldChange[], notWritten: NotWrittenField[], at: number, run: number, createdParentID?: number): AppliedRecord {
    const fields = appliedFieldsBetween(before, expected, written);
    if (createdParentID === undefined)
        return { source: 'recorded', at, run, fields, notWritten };
    for (const entry of fields)
        if (entry.field === 'itemType') {
            entry.old = '';
            entry.kind = 'added';
        }
    return { source: 'recorded', at, run, fields, notWritten, createdParentID, createdParentMetadata: metadataFingerprint(expected) };
}
type RowShape = Pick<Row, 'status' | 'changes' | 'before'> & Partial<Pick<Row, 'fieldChoice' | 'fieldEdit' | 'advice' | 'createdParentID' | 'standalonePDF' | 'applied'>>;
const writtenAsChosen = (row: RowShape, change: FieldChange): FieldChange => {
    const edited = row.fieldEdit?.[change.field];
    if (edited === undefined || change.field === 'creators')
        return change;
    if (change.field === 'itemType')
        return String(edited).trim() ? { ...change, newValue: String(edited).trim() } : change;
    return { ...change, newValue: edited };
};
const legacyNotWritten = (row: RowShape, change: FieldChange): NotWrittenField => {
    const advice = String(row.advice?.[change.field] || '');
    if (row.fieldChoice?.[change.field] === false)
        return { field: change.field, code: 'notSelected', reason: advice ? `체크가 풀려 있었습니다 — ${advice}` : '체크가 풀려 있었습니다' };
    if (advice)
        return { field: change.field, code: 'advisedAgainst', reason: `권장하지 않는 규칙이 있었습니다 — ${advice}` };
    return { field: change.field, code: 'notSelected', reason: '적용 지문에 없습니다 — 그때 「설정과 도구」에서 꺼 두었거나 쓰기 계획이 받지 않았습니다' };
};
export function derivedAppliedRecord(row: RowShape, estimate?: (row: any) => FieldChange[]): AppliedRecord | null {
    const before = row.before;
    if (!before)
        return null;
    const written = (row.changes || []).map(change => writtenAsChosen(row, change));
    const createdParentID = row.standalonePDF && row.createdParentID ? row.createdParentID : undefined;
    const parsed = parseFingerprint(before.appliedMetadata);
    if (parsed) {
        const typeWrite = written.find(change => change.field === 'itemType');
        const itemType = parsed.itemTypeID === before.itemTypeID ? before.itemType : typeWrite ? String(typeWrite.newValue) : `#${parsed.itemTypeID}`;
        const fields = appliedFieldsBetween(before, { ...parsed, itemType }, written);
        const notWritten = (row.changes || []).filter(change => !fields.some(entry => entry.field === change.field)).map(change => legacyNotWritten(row, change));
        return { source: 'derived', fields, notWritten, ...(createdParentID ? { createdParentID } : {}) };
    }
    if (createdParentID && estimate) {
        const planned = estimate(row);
        const fields: AppliedField[] = planned.filter(change => !empty(change.newValue)).map(change => ({ field: change.field, old: '', new: change.newValue, kind: 'added' as const }));
        const notWritten = (row.changes || []).filter(change => !planned.some(entry => entry.field === change.field)).map(change => legacyNotWritten(row, change));
        return { source: 'estimated', fields, notWritten, createdParentID };
    }
    return null;
}
const derivedMemo = new WeakMap<object, {
    meta: string | undefined;
    changes: unknown;
    record: AppliedRecord | null;
}>();
let createdParentEstimator: ((row: any) => FieldChange[]) | undefined;
export function setCreatedParentEstimator(estimate: (row: any) => FieldChange[]): void { createdParentEstimator = estimate; }
export function appliedRecord(row: RowShape): AppliedRecord | null {
    if (row.applied)
        return row.applied;
    if (!RECORDED_STATUSES.has(row.status))
        return null;
    const meta = row.before?.appliedMetadata;
    const held = derivedMemo.get(row);
    if (held && held.meta === meta && held.changes === row.changes)
        return held.record;
    const record = derivedAppliedRecord(row, createdParentEstimator);
    derivedMemo.set(row, { meta, changes: row.changes, record });
    return record;
}
export type SkipCode = 'alreadyApplied' | 'noProposal' | 'statusClosed' | 'staleRules' | 'protected' | 'conflicting' | 'clearing' | 'typeBlocked' | 'advisedAgainst' | 'noFieldTicked' | 'fieldsOff' | 'standaloneNoType' | 'other';
export const SKIP_ORDER: SkipCode[] = ['alreadyApplied', 'noProposal', 'statusClosed', 'staleRules', 'protected', 'conflicting', 'clearing',
    'typeBlocked', 'advisedAgainst', 'noFieldTicked', 'fieldsOff', 'standaloneNoType', 'other'];
export const SKIP_LABEL: Record<SkipCode, string> = {
    alreadyApplied: '이미 적용', noProposal: '변경 제안 없음', statusClosed: '적용할 수 없는 상태', staleRules: '이전 규칙으로 판정',
    protected: '보호된 값과 다름', conflicting: '본문과 어긋남', clearing: '값 비우기뿐', typeBlocked: '유형 변경을 고르지 않음',
    advisedAgainst: '권장하지 않는 필드뿐', noFieldTicked: '체크한 필드 없음', fieldsOff: '「설정과 도구」에서 끈 필드뿐',
    standaloneNoType: '새 항목의 유형 미정', other: '그 밖의 사유'
};
const SKIP_HINT: Partial<Record<SkipCode, string>> = {
    statusClosed: '대기·제외·PDF 문제', staleRules: '「선택 재검색」 뒤 적용', protected: '보호 해제 뒤 적용',
    conflicting: '상세 비교에서 직접 체크하면 적용', clearing: '상세 비교에서 직접 체크하면 적용', typeBlocked: '상세 비교에서 항목 유형을 함께 체크',
    advisedAgainst: '상세 비교에서 직접 체크하면 적용', noFieldTicked: '상세 비교에서 필드를 체크', standaloneNoType: '상세 비교의 「유형 정하기」',
    other: '상세 비교에 필드별 사유'
};
export interface PlanShape {
    changes: FieldChange[];
    refused: EligibilityReason[];
}
export function skipCodeOf(row: Pick<Row, 'status' | 'changes'> & Partial<Pick<Row, 'recognizedWith' | 'standalonePDF' | 'fieldChoice'>>, plan: PlanShape | undefined, policyVersion: string): SkipCode | null {
    if (isAppliedStatus(row.status))
        return 'alreadyApplied';
    if (!row.changes?.length)
        return 'noProposal';
    if (!plan)
        return 'statusClosed';
    if (row.recognizedWith && row.recognizedWith !== policyVersion)
        return 'staleRules';
    if (plan.changes.length)
        return row.standalonePDF && !plan.changes.some(change => change.field === 'itemType') ? 'standaloneNoType' : null;
    const codes = new Set(plan.refused.map(entry => entry.code));
    if (codes.has('protected'))
        return 'protected';
    if (codes.has('conflicting'))
        return 'conflicting';
    if (codes.has('clearing'))
        return 'clearing';
    if (codes.has('typeFieldLoss') || codes.has('typeNotSelected'))
        return 'typeBlocked';
    if (codes.has('advisedAgainst'))
        return 'advisedAgainst';
    const unticked = plan.refused.filter(entry => entry.code === 'notSelected');
    if (unticked.some(entry => row.fieldChoice?.[entry.field] === false))
        return 'noFieldTicked';
    if (unticked.length)
        return 'fieldsOff';
    return 'other';
}
export function skipBreakdown(codes: SkipCode[], offFields: string[] = []): string {
    const counts = new Map<SkipCode, number>();
    for (const code of codes)
        counts.set(code, (counts.get(code) || 0) + 1);
    return SKIP_ORDER.filter(code => counts.has(code)).map(code => {
        const hint = code === 'fieldsOff' && offFields.length ? offFields.join('·') : SKIP_HINT[code];
        return `${SKIP_LABEL[code]} ${counts.get(code)}${hint ? `(${hint})` : ''}`;
    }).join(' · ');
}
export function formatWhen(ms: number | undefined): string {
    if (!ms)
        return '';
    const at = new Date(ms), pad = (value: number) => String(value).padStart(2, '0');
    return `${at.getMonth() + 1}월 ${at.getDate()}일 ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
export function applyBlockMessage(ticked: number, codes: SkipCode[], context: {
    lastApply?: {
        at?: number;
        rows: number;
    };
    legacyApplied?: number;
    offFields?: string[];
} = {}): string {
    if (!ticked) {
        if (context.lastApply?.rows) {
            const when = formatWhen(context.lastApply.at);
            return `체크한 항목이 없습니다 — 적용한 행은 체크가 풀립니다. 마지막 적용(${when ? `${when}, ` : ''}${context.lastApply.rows}개)의 결과는 아래 「마지막 적용」 줄과 「이번 적용 ${context.lastApply.rows}」 칩에 있습니다.`;
        }
        if (context.legacyApplied)
            return `체크한 항목이 없습니다 — 이미 적용한 ${context.legacyApplied}개는 「적용됨」 칩에서 행을 열면 적용한 값이 보입니다.`;
        return '적용할 항목을 체크하세요.';
    }
    const hint = codes.includes('alreadyApplied')
        ? ` 적용한 값은 ${context.lastApply?.rows ? '「적용됨」·「이번 적용」 칩' : '「적용됨」 칩'}에서 행을 열면 보입니다.` : '';
    return `체크한 ${ticked}개 중 적용할 값이 있는 행이 없습니다 — ${skipBreakdown(codes, context.offFields)}.${hint}`;
}
export interface ApplyRun {
    id: number;
    kind: 'apply' | 'undo';
    startedAt: number;
    endedAt: number;
    asked: number;
    done: number[];
    fieldCounts: Record<string, Record<AppliedKind, number>>;
    skipped: Array<{
        id: number;
        code: SkipCode;
    }>;
    failed: Array<{
        id: number;
        key: string;
        reason: string;
    }>;
    conflicts: Array<{
        id: number;
        key: string;
    }>;
    stopped: boolean;
}
export function emptyCounts(): Record<AppliedKind, number> { return { changed: 0, added: 0, cleared: 0, typeLoss: 0 }; }
export function fieldCountsOf(records: Array<AppliedRecord | null | undefined>): Record<string, Record<AppliedKind, number>> {
    const counts: Record<string, Record<AppliedKind, number>> = {};
    for (const record of records)
        for (const entry of record?.fields || [])
            (counts[entry.field] ||= emptyCounts())[entry.kind]++;
    return counts;
}
export function kindTotals(counts: Record<string, Record<AppliedKind, number>>): Record<AppliedKind, number> & {
    total: number;
} {
    const totals = { ...emptyCounts(), total: 0 };
    for (const byKind of Object.values(counts))
        for (const kind of APPLIED_KINDS) {
            totals[kind] += byKind[kind];
            totals.total += byKind[kind];
        }
    return totals;
}
export function fieldTotalText(counts: Record<string, Record<AppliedKind, number>>): string {
    const totals = kindTotals(counts);
    const parts = APPLIED_KINDS.filter(kind => totals[kind]).map(kind => `${APPLIED_KIND_LABEL[kind]} ${totals[kind]}`);
    return `필드 ${totals.total}개${parts.length ? ` (${parts.join(' · ')})` : ''}`;
}
export function fieldBreakdown(counts: Record<string, Record<AppliedKind, number>>, label: (field: string) => string): string[] {
    const line = (title: string, pick: (byKind: Record<AppliedKind, number>) => number) => {
        const entries = Object.entries(counts).map(([field, byKind]) => [field, pick(byKind)] as const).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]);
        return entries.length ? `${title}: ${entries.map(([field, count]) => `${label(field)} ${count}`).join(' · ')}` : '';
    };
    return [line('바꾸거나 채운 필드', byKind => byKind.changed + byKind.added), line('비운 칸', byKind => byKind.cleared),
        line('유형 변경으로 사라진 칸', byKind => byKind.typeLoss)].filter(Boolean);
}
export function applyRunLine(run: ApplyRun, offFields: string[] = []): string {
    const when = formatWhen(run.endedAt || run.startedAt);
    const failed = run.failed.length ? ` · 실패 ${run.failed.length}개(필드별 내역에서 행을 누르면 사유)` : '';
    const stopped = run.stopped ? ' — 중지로 멈춤' : '';
    if (run.kind === 'undo') {
        const conflicts = run.conflicts.length ? ` · 적용 뒤 편집돼 건너뜀 ${run.conflicts.length}개` : '';
        return `마지막 되돌리기 ${when} · 복원 ${run.done.length}개${conflicts}${failed}${stopped}`;
    }
    const already = run.skipped.filter(entry => entry.code === 'alreadyApplied').length;
    const kept = run.skipped.filter(entry => entry.code !== 'alreadyApplied').map(entry => entry.code);
    const skipped = (already ? ` · 이미 적용돼 건너뜀 ${already}개(체크 풂)` : '')
        + (kept.length ? ` · 쓰지 않음 ${kept.length}개 — 체크 유지: ${skipBreakdown(kept, offFields)}` : '');
    return `마지막 적용 ${when} · 항목 ${run.done.length}개 · ${fieldTotalText(run.fieldCounts)}${skipped}${failed}${stopped}`;
}
export function legacyApplyLine(rows: number, counts: Record<string, Record<AppliedKind, number>>): string {
    return `적용 기록이 없는 적용 행 ${rows}개(이전 빌드에서 적용했거나 적용 중에 끊긴 행) — 적용 전 백업과 적용 지문의 차이로 복원했습니다: ${fieldTotalText(counts)}. 적용 시각은 남아 있지 않습니다.`;
}
export function failureReason(text: unknown, fallback: string): string {
    return String(text || fallback).replace(/^(?:Error|TypeError|RangeError): /, '');
}

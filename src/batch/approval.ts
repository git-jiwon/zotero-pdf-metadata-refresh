import type { FieldChange } from '../types';
import { sameFile } from './cache';
import { valueText, verificationCovers, type FieldVerification } from './evidence';
export interface ApprovalScope {
    libraryID: number;
    itemKey: string;
    attachmentKey: string;
    pdfFingerprint: string;
    itemType: string;
    identity: string;
    policyVersion: string;
}
export interface FieldApproval {
    value: string;
    scope: ApprovalScope;
    approvedAt: number;
    basis: 'accepted' | 'edited';
}
export interface FieldProtection {
    value: string;
    protectedAt: number;
    reason: 'edited' | 'approved';
}
export interface ApprovalState {
    approvals?: Record<string, FieldApproval>;
    protections?: Record<string, FieldProtection>;
    verification?: Record<string, FieldVerification>;
}
export function sameValue(left: unknown, right: unknown): boolean {
    return valueText(left) === valueText(right);
}
export function approvalKey(change: FieldChange): string { return change.field; }
export function recordApproval(state: ApprovalState, change: FieldChange, scope: ApprovalScope, basis: FieldApproval['basis']): void {
    const value = valueText(change.newValue);
    state.approvals = {
        ...(state.approvals || {}),
        [approvalKey(change)]: { value, scope: { ...scope }, approvedAt: Date.now(), basis }
    };
    state.protections = {
        ...(state.protections || {}),
        [approvalKey(change)]: { value, protectedAt: Date.now(), reason: basis === 'edited' ? 'edited' : 'approved' }
    };
}
export function withdrawApproval(state: ApprovalState, field: string): void {
    if (!state.approvals)
        return;
    const next = { ...state.approvals };
    delete next[field];
    state.approvals = Object.keys(next).length ? next : undefined;
}
export function releaseProtection(state: ApprovalState, field: string): void {
    if (!state.protections)
        return;
    const next = { ...state.protections };
    delete next[field];
    state.protections = Object.keys(next).length ? next : undefined;
}
export type ApprovalMismatch = 'none' | 'valueChanged' | 'fileChanged' | 'documentChanged' | 'typeChanged' | 'identityChanged' | 'policyChanged';
export type ApprovalCheck = {
    approved: true;
} | {
    approved: false;
    reason: ApprovalMismatch;
};
export function approvalCovers(state: ApprovalState, change: FieldChange, scope: ApprovalScope): ApprovalCheck {
    const approval = state.approvals?.[approvalKey(change)];
    if (!approval)
        return { approved: false, reason: 'none' };
    if (!sameValue(approval.value, change.newValue))
        return { approved: false, reason: 'valueChanged' };
    const was = approval.scope || ({} as ApprovalScope);
    if (was.libraryID !== scope.libraryID || was.itemKey !== scope.itemKey || was.attachmentKey !== scope.attachmentKey) {
        return { approved: false, reason: 'documentChanged' };
    }
    if (!sameFile(was.pdfFingerprint, scope.pdfFingerprint))
        return { approved: false, reason: 'fileChanged' };
    if (was.itemType !== scope.itemType)
        return { approved: false, reason: 'typeChanged' };
    if (was.identity !== scope.identity)
        return { approved: false, reason: 'identityChanged' };
    if (was.policyVersion !== scope.policyVersion)
        return { approved: false, reason: 'policyChanged' };
    return { approved: true };
}
export function approvalStanding(state: ApprovalState, change: FieldChange, scope: ApprovalScope): 'valid' | 'stale' | 'none' {
    const check = approvalCovers(state, change, scope);
    if (check.approved)
        return 'valid';
    return check.reason === 'none' ? 'none' : 'stale';
}
export function protectionConflict(state: ApprovalState, change: FieldChange): FieldProtection | null {
    const protection = state.protections?.[approvalKey(change)];
    if (!protection)
        return null;
    return sameValue(protection.value, change.newValue) ? null : protection;
}
export function carryDecisionsForward(previous: ApprovalState, next: ApprovalState, proposals: FieldChange[]): void {
    next.protections = previous.protections;
    if (!previous.approvals)
        return;
    const kept: Record<string, FieldApproval> = {};
    for (const [field, approval] of Object.entries(previous.approvals)) {
        const proposal = proposals.find(change => change.field === field);
        if (proposal && sameValue(approval.value, proposal.newValue))
            kept[field] = approval;
    }
    next.approvals = Object.keys(kept).length ? kept : undefined;
}
export type EligibilityCode = 'verified' | 'approved' | 'chosen' | 'replacement' | 'selected' | 'notSelected' | 'protected' | 'approvalStale' | 'clearing' | 'advisedAgainst' | 'conflicting' | 'unverified' | 'typeFieldLoss' | 'typeNotSelected';
export interface EligibilityReason {
    field: string;
    eligible: boolean;
    code: EligibilityCode;
    detail?: ApprovalMismatch | string;
    reason: string;
}
const MISMATCH_TEXT: Record<ApprovalMismatch, string> = {
    none: '승인이 없습니다',
    valueChanged: '승인한 값과 지금 쓰려는 값이 다릅니다',
    fileChanged: '승인 이후 PDF 파일이 바뀌었습니다',
    documentChanged: '승인한 대상 문서가 아닙니다',
    typeChanged: '승인 이후 항목 유형이 바뀌었습니다',
    identityChanged: '승인한 판본·저작과 다른 후보입니다',
    policyChanged: '승인 이후 판정 규칙이 바뀌었습니다'
};
export interface EligibilityInput {
    state: ApprovalState;
    change: FieldChange;
    scope: ApprovalScope;
    advice?: Record<string, string>;
    typeFieldLoss?: Set<string>;
    explicit?: boolean;
}
export function fieldEligibility({ state, change, scope, advice, typeFieldLoss, explicit }: EligibilityInput): EligibilityReason {
    const field = change.field;
    const empty = change.newValue === '' || change.newValue === null || change.newValue === undefined
        || (Array.isArray(change.newValue) && !change.newValue.length);
    const approval = approvalCovers(state, change, scope);
    const conflict = protectionConflict(state, change);
    if (conflict && !approval.approved) {
        return { field, eligible: false, code: 'protected',
            reason: `이 필드에는 확인된 값(${String(conflict.value).slice(0, 40)})이 기록돼 있고 이 후보는 그와 다릅니다 — 보호를 해제하면 쓸 수 있습니다` };
    }
    if (explicit)
        return { field, eligible: true, code: 'chosen', reason: '이 행에서 직접 선택한 필드입니다' };
    if (approval.approved) {
        return { field, eligible: true, code: 'approved', reason: '이 값·이 문서·이 규칙에 대해 승인됐습니다' };
    }
    if (approval.reason !== 'none') {
        return { field, eligible: false, code: 'approvalStale', detail: approval.reason,
            reason: `승인이 더 이상 이 변경을 설명하지 않습니다 — ${MISMATCH_TEXT[approval.reason]}` };
    }
    if (empty) {
        if (change.replacedFromDocument) {
            return { field, eligible: true, code: 'replacement', reason: '문서 값으로 덮어쓰기 — 판독이 이 필드를 말하지 않아 비웁니다' };
        }
        return { field, eligible: false, code: 'clearing', reason: '값을 지우는 것은 사람이 내리는 결정입니다' };
    }
    if (typeFieldLoss?.has(field)) {
        return { field, eligible: false, code: 'typeFieldLoss',
            reason: '항목 유형이 바뀌면 이 필드는 저장되지 않고 사라집니다 — 옮길지 버릴지 직접 결정하세요' };
    }
    if (advice?.[field])
        return { field, eligible: false, code: 'advisedAgainst', reason: '이 필드에 대해 권장하지 않는 규칙이 있습니다' };
    const verification = verificationCovers(state.verification?.[field], change, { pdfFingerprint: scope.pdfFingerprint, itemType: scope.itemType, policyVersion: scope.policyVersion });
    if (verification.verified) {
        const external = String(verification.record?.rule || '').startsWith('external/');
        return { field, eligible: true, code: 'verified',
            reason: external
                ? `이 문헌·판본에 연결된 외부 기록이 명시함 (${verification.record?.rule})`
                : `문서 본문과 대조해 확인됨 (${verification.record?.rule})` };
    }
    if (verification.code === 'conflicting') {
        return { field, eligible: false, code: 'conflicting',
            reason: verification.record?.note || '문서 본문이 이 값과 어긋납니다' };
    }
    return { field, eligible: true, code: 'selected', detail: verification.code,
        reason: verification.record?.note ? `검증되지 않았지만 체크되어 적용합니다 — ${verification.record.note}` : '검증되지 않았지만 체크되어 적용합니다' };
}

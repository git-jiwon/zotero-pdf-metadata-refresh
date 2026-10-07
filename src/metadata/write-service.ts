import type { FieldChange, MetadataSnapshot } from '../types';
import { nameAsStored } from './creator-text';
import { validForTypeID } from '../recognition/item-fields';
import { applyChanges, CHANGED_SINCE_READ } from './apply';
import { createParentFromPDF } from './create-parent';
import { assertIdentityUnchanged, captureIdentity, metadataFingerprint, snapshotItem, storedCreator } from './snapshot';
import { carriedByTypeChange, retypedByTypeChange } from './type-change';
import { fieldEligibility, type ApprovalScope, type EligibilityReason } from '../batch/approval';
import { fieldsLostToTypeChange } from '../batch/evaluate';
import { fileIdentity, pdfInputFingerprint, sameFile } from '../batch/cache';
import type { Row } from '../batch/row';
export interface WritePlan {
    changes: FieldChange[];
    refused: EligibilityReason[];
    decided: EligibilityReason[];
    scope: ApprovalScope;
    typeFieldLoss: string[];
}
export function approvalScopeFor(row: Row, itemType: string, policyVersion: string): ApprovalScope {
    return {
        libraryID: row.libraryID,
        itemKey: row.key,
        attachmentKey: String(row.attachmentKey || ''),
        pdfFingerprint: fileIdentity(row.pdfFingerprint || ''),
        itemType,
        identity: row.evidence?.identity ? `${row.evidence.identity.id}#${row.evidence.identity.scope}` : '',
        policyVersion
    };
}
export function buildWritePlan(row: Row, fields: Set<string>, policyVersion: string, chosen: (row: Row, change: FieldChange) => FieldChange): WritePlan {
    const typeChange = row.changes.find(change => change.field === 'itemType');
    const targetType = typeChange ? String(chosen(row, typeChange).newValue)
        : String(row.before?.itemType || row.recognized?.itemType || '');
    const scope = approvalScopeFor(row, targetType, policyVersion);
    const typeFieldLoss = row.before ? fieldsLostToTypeChange(row.before, row.changes.map(change => chosen(row, change))) : new Set<string>();
    const state = { approvals: row.approvals, protections: row.protections, verification: row.verification };
    const decided = row.changes.map(change => {
        const value = chosen(row, change);
        const selected = row.fieldChoice?.[change.field] ?? fields.has(change.field);
        if (!selected)
            return { field: change.field, eligible: false, code: 'notSelected' as const, reason: '선택되지 않았습니다' };
        return fieldEligibility({ state, change: value, scope, advice: row.advice, typeFieldLoss, explicit: row.fieldChoice?.[change.field] === true });
    });
    const typeDecision = decided.find(entry => entry.field === 'itemType');
    if (typeChange && typeDecision && !typeDecision.eligible && row.before) {
        const currentTypeID = row.before.itemTypeID;
        for (const [at, entry] of decided.entries()) {
            if (!entry.eligible || entry.field === 'itemType')
                continue;
            const change = row.changes.find(candidate => candidate.field === entry.field);
            const invalidHere = entry.field !== 'creators' && !validForTypeID(entry.field, currentTypeID);
            if (invalidHere || change?.replacedFromDocument) {
                decided[at] = { field: entry.field, eligible: false, code: 'typeNotSelected',
                    reason: '항목 유형 변경이 적용되지 않아, 새 유형을 전제로 한 이 변경도 적용하지 않습니다 — 유형 변경을 선택하면 함께 적용됩니다' };
            }
        }
    }
    const permitted = new Set(decided.filter(entry => entry.eligible).map(entry => entry.field));
    return {
        changes: row.changes.filter(change => permitted.has(change.field)).map(change => chosen(row, change)),
        refused: decided.filter(entry => !entry.eligible),
        decided,
        scope,
        typeFieldLoss: [...typeFieldLoss]
    };
}
async function currentAttachment(item: any, row: Row): Promise<any | null> {
    if (row.standalonePDF)
        return item;
    if (!row.attachmentKey)
        return null;
    for (const id of item.getAttachments(true) as number[]) {
        const attachment = Zotero.Items.get(id);
        if (attachment?.key === row.attachmentKey)
            return attachment;
    }
    return null;
}
export async function assertWriteStillValid(item: any, row: Row, policyVersion: string): Promise<void> {
    if (row.recognizedWith && row.recognizedWith !== policyVersion) {
        throw new Error('이 판정은 이전 규칙 버전에서 나왔습니다 — 다시 인식한 뒤 적용하세요.');
    }
    const attachment = await currentAttachment(item, row);
    if (row.pdfFingerprint) {
        if (!attachment)
            throw new Error('인식에 사용한 PDF 첨부를 항목에서 찾을 수 없습니다 — 첨부가 옮겨졌거나 삭제됐습니다.');
        const now = await pdfInputFingerprint(attachment);
        if (!sameFile(now, row.pdfFingerprint)) {
            throw new Error('인식 이후 PDF 파일이 바뀌었습니다 — 다시 인식한 뒤 적용하세요.');
        }
    }
    if (row.standalonePDF) {
        if (item.parentItemID)
            throw new Error('이 PDF에는 이미 상위 항목이 생겼습니다 — 새로 만들지 않았습니다.');
    }
    else if (attachment && attachment.parentItemID !== item.id) {
        throw new Error('인식에 사용한 PDF가 다른 항목으로 옮겨졌습니다 — 적용하지 않았습니다.');
    }
}
export interface WriteResult {
    written: FieldChange[];
    refused: EligibilityReason[];
    createdParentID?: number;
    expected?: MetadataSnapshot;
}
export function expectedRecord(before: MetadataSnapshot, changes: FieldChange[]): MetadataSnapshot {
    const expected = JSON.parse(JSON.stringify(before)) as MetadataSnapshot;
    delete expected.appliedMetadata;
    const typeChange = changes.find(change => change.field === 'itemType');
    if (typeChange) {
        expected.itemType = String(typeChange.newValue);
        expected.itemTypeID = Zotero.ItemTypes.getID(typeChange.newValue);
        for (const [field, value] of Object.entries(carriedByTypeChange(before, expected.itemTypeID))) {
            if (value)
                expected.fields[field] = value;
            else
                delete expected.fields[field];
        }
        expected.creators = retypedByTypeChange(expected.creators || [], before.itemTypeID, expected.itemTypeID);
    }
    for (const change of changes) {
        if (change.field === 'itemType')
            continue;
        if (change.field === 'creators')
            expected.creators = (change.newValue as any[]).map(nameAsStored).map(creator => storedCreator(creator, expected.itemTypeID));
        else if (change.newValue === '' || change.newValue === null || change.newValue === undefined)
            delete expected.fields[change.field];
        else
            expected.fields[change.field] = change.newValue as string;
    }
    for (const field of Object.keys(expected.fields)) {
        if (!validForTypeID(field, expected.itemTypeID))
            delete expected.fields[field];
    }
    return expected;
}
export async function writePlannedChanges(item: any, row: Row, plan: WritePlan, policyVersion: string, save: (row: Row) => Promise<void>): Promise<WriteResult> {
    if (!plan.changes.length)
        return { written: [], refused: plan.refused };
    if (!row.before)
        throw new Error('Missing preview backup');
    await assertWriteStillValid(item, row, policyVersion);
    assertIdentityUnchanged(row.before.identity, await captureIdentity(item));
    if (metadataFingerprint(await snapshotItem(item)) !== metadataFingerprint(row.before)) {
        throw new Error(CHANGED_SINCE_READ);
    }
    const expected = expectedRecord(row.before, plan.changes);
    row.before.appliedMetadata = metadataFingerprint(expected);
    row.status = 'applying';
    await save(row);
    try {
        await applyChanges(item, plan.changes, row.before);
    }
    catch (cause) {
        delete row.before.appliedMetadata;
        await save(row);
        throw cause;
    }
    return { written: plan.changes, refused: plan.refused, expected };
}
export async function createPlannedParent(attachment: any, row: Row, plan: WritePlan, policyVersion: string, save: (row: Row) => Promise<void>): Promise<WriteResult> {
    const typeChange = plan.changes.find(change => change.field === 'itemType');
    if (!typeChange) {
        return {
            written: [], createdParentID: undefined,
            refused: [...plan.refused, {
                    field: 'itemType', eligible: false, code: 'unverified',
                    reason: '항목 유형이 결정되지 않아 새 항목을 만들지 않았습니다 — 상세 비교에서 유형을 확인하고 승인하세요.'
                }]
        };
    }
    await assertWriteStillValid(attachment, row, policyVersion);
    row.status = 'applying';
    await save(row);
    const parentID = await createParentFromPDF(attachment, String(typeChange.newValue), plan.changes);
    row.createdParentID = parentID;
    const filed = Zotero.Items.get(attachment.id);
    if (!filed || filed.parentItemID !== parentID) {
        throw new Error('새 상위 항목을 만들었지만 PDF가 그 항목에 연결되지 않았습니다 — Zotero에서 확인하세요.');
    }
    const base: MetadataSnapshot = row.before || { itemID: attachment.id, key: attachment.key, itemTypeID: attachment.itemTypeID, itemType: '', fields: {}, creators: [], identity: undefined as any };
    return { written: plan.changes, refused: plan.refused, createdParentID: parentID, expected: expectedRecord(base, plan.changes) };
}

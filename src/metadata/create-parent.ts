import type { FieldChange } from '../types';
import { nameAsStored } from './creator-text';
export async function createParentFromPDF(attachment: any, itemType: string, changes: FieldChange[]): Promise<number> {
    const typeID = Zotero.ItemTypes.getID(itemType);
    if (!typeID)
        throw new Error(`알 수 없는 항목 유형: ${itemType}`);
    const parent = new Zotero.Item(itemType);
    parent.libraryID = attachment.libraryID;
    for (const change of changes) {
        if (change.field === 'itemType')
            continue;
        if (change.field === 'creators') {
            parent.setCreators((change.newValue as any[]).map(nameAsStored));
            continue;
        }
        const fieldID = Zotero.ItemFields.getID(change.field);
        if (fieldID && Zotero.ItemFields.isValidForType(fieldID, typeID) && change.newValue)
            parent.setField(fieldID, change.newValue);
    }
    const collections: number[] = attachment.getCollections ? attachment.getCollections() : [];
    if (collections.length)
        parent.setCollections(collections);
    return await Zotero.DB.executeTransaction(async () => {
        const parentID = await parent.save();
        attachment.parentItemID = parentID;
        if (collections.length)
            attachment.setCollections([]);
        await attachment.save();
        return parentID;
    });
}
export async function detachCreatedParent(attachment: any, parentID: number): Promise<void> {
    const parent = Zotero.Items.get(parentID);
    if (!parent || parent.deleted)
        return;
    if (attachment.parentItemID !== parentID)
        throw new Error('PDF가 만든 상위 항목 아래에 있지 않아 자동으로 떼어 내지 않았습니다. Zotero에서 직접 정리하세요.');
    const children = [...parent.getAttachments(true), ...parent.getNotes(true)];
    if (children.some((id: number) => id !== attachment.id)) {
        throw new Error('이 항목에 다른 첨부·메모가 추가되어 자동으로 삭제하지 않았습니다. Zotero에서 직접 정리하세요.');
    }
    const collections: number[] = parent.getCollections ? parent.getCollections() : [];
    await Zotero.DB.executeTransaction(async () => {
        attachment.parentItemID = false;
        if (collections.length)
            attachment.setCollections(collections);
        await attachment.save();
        await parent.erase();
    });
}

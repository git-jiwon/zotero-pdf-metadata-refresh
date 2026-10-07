import type { FieldChange, MetadataSnapshot } from "../types";
import { assertIdentityUnchanged, captureIdentity, snapshotItem, metadataFingerprint, matchesFingerprint } from "./snapshot";
import { nameAsStored } from "./creator-text";
export const CHANGED_SINCE_READ = '검색한 뒤 Zotero에서 이 항목이 바뀌어 적용하지 않았습니다 — 「선택 재검색」으로 다시 읽은 뒤 적용하세요.';
export async function applyChanges(item: any, changes: FieldChange[], before: MetadataSnapshot): Promise<void> {
    await Zotero.DB.executeTransaction(async () => {
        if (metadataFingerprint(await snapshotItem(item)) !== metadataFingerprint(before))
            throw new Error(CHANGED_SINCE_READ);
        const typeChange = changes.find((x) => x.field === "itemType");
        if (typeChange)
            item.setType(Zotero.ItemTypes.getID(typeChange.newValue));
        for (const change of changes) {
            if (change.field === "itemType")
                continue;
            if (change.field === "creators")
                item.setCreators((change.newValue as any[]).map(nameAsStored));
            else {
                const fieldID = Zotero.ItemFields.getID(change.field);
                if (fieldID && Zotero.ItemFields.isValidForType(fieldID, item.itemTypeID))
                    item.setField(fieldID, change.newValue);
            }
        }
        await item.save();
        assertIdentityUnchanged(before.identity, await captureIdentity(item));
    });
}
export async function restoreSnapshot(snapshot: MetadataSnapshot): Promise<void> {
    const item = Zotero.Items.get(snapshot.itemID);
    if (!item || item.key !== snapshot.key)
        throw new Error(`Undo target not found: ${snapshot.key}`);
    await Zotero.DB.executeTransaction(async () => {
        if (!matchesFingerprint(await snapshotItem(item), snapshot.appliedMetadata, snapshot))
            throw new Error(`Undo conflict: ${snapshot.key} was edited after refresh`);
        if (item.itemTypeID !== snapshot.itemTypeID)
            item.setType(snapshot.itemTypeID);
        for (const fieldID of Zotero.ItemFields.getItemTypeFields(item.itemTypeID)) {
            const name = Zotero.ItemFields.getName(fieldID);
            item.setField(fieldID, snapshot.fields[name] ?? "");
        }
        item.setCreators(snapshot.creators);
        await item.save();
        assertIdentityUnchanged(snapshot.identity, (await snapshotItem(item)).identity);
    });
}

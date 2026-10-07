import type { ItemIdentity, MetadataSnapshot, Primitive } from "../types";
import { carriedByTypeChange, retypedByTypeChange } from "./type-change";
function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}
export async function captureIdentity(item: any): Promise<ItemIdentity> {
    await item.loadAllData();
    const isAttachment = typeof item.isAttachment === 'function' && item.isAttachment();
    const attachmentIDs: number[] = isAttachment ? [] : item.getAttachments(true);
    const attachments = isAttachment ? [item] : Zotero.Items.get(attachmentIDs);
    const noteIDs: number[] = [...item.getNotes(true)];
    const annotationIDs: number[] = [];
    for (const attachment of attachments) {
        await attachment.loadAllData();
        if (attachment !== item)
            noteIDs.push(...attachment.getNotes(true));
        if (attachment.isFileAttachment())
            annotationIDs.push(...attachment.getAnnotations(true).map((x: any) => x.id));
    }
    return {
        key: item.key,
        libraryID: item.libraryID,
        collections: [...item.getCollections()].sort((a, b) => a - b),
        tags: clone(item.getTags()),
        relations: clone(item.getRelations()),
        attachmentIDs: [...attachmentIDs].sort((a, b) => a - b),
        attachmentKeys: attachments.map((x: any) => x.key).sort(),
        attachmentPaths: await Promise.all(attachments.map((x: any) => x.getFilePath())),
        noteIDs: [...noteIDs].sort((a, b) => a - b),
        annotationIDs: annotationIDs.sort((a, b) => a - b)
    };
}
export async function snapshotItem(item: any): Promise<MetadataSnapshot> {
    await item.loadAllData();
    const fields: Record<string, Primitive> = {};
    for (const fieldID of Zotero.ItemFields.getItemTypeFields(item.itemTypeID)) {
        const name = Zotero.ItemFields.getName(fieldID);
        const value = item.getField(fieldID);
        if (value !== "" && value !== null && value !== undefined)
            fields[name] = value;
    }
    return {
        itemID: item.id,
        key: item.key,
        itemTypeID: item.itemTypeID,
        itemType: Zotero.ItemTypes.getName(item.itemTypeID),
        fields,
        creators: clone(item.getCreators()),
        identity: await captureIdentity(item)
    };
}
export async function emptyRecord(attachment: any): Promise<MetadataSnapshot> {
    return {
        itemID: attachment.id,
        key: attachment.key,
        itemTypeID: attachment.itemTypeID,
        itemType: Zotero.ItemTypes.getName(attachment.itemTypeID),
        fields: {},
        creators: [],
        identity: await captureIdentity(attachment)
    };
}
export function assertIdentityUnchanged(before: ItemIdentity, after: ItemIdentity): void {
    for (const key of Object.keys(before) as Array<keyof ItemIdentity>) {
        if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
            throw new Error(`Safety invariant failed: ${key} changed`);
        }
    }
}
export function storedCreator(creator: any, itemTypeID?: number): any {
    if (!creator || typeof creator !== 'object')
        return creator;
    const stored: any = { fieldMode: creator.fieldMode ? parseInt(creator.fieldMode, 10) : 0, firstName: '', lastName: '' };
    for (const key of ['firstName', 'lastName']) {
        const value = creator[key];
        if (value !== undefined && value !== null)
            stored[key] = String(value).trim().normalize();
    }
    if (creator.name !== undefined && creator.lastName === undefined) {
        stored.lastName = String(creator.name).trim().normalize();
        stored.fieldMode = 1;
    }
    const role = creator.creatorType || creator.creatorTypeID;
    const types = typeof Zotero === 'undefined' ? undefined : (Zotero as any).CreatorTypes;
    if (role && typeof types?.getID === 'function') {
        let id = types.getID(role);
        if (itemTypeID && typeof types.isValidForItemType === 'function' && typeof types.getPrimaryIDForType === 'function'
            && (!id || !types.isValidForItemType(id, itemTypeID)))
            id = types.getPrimaryIDForType(itemTypeID);
        stored.creatorTypeID = id;
    }
    else if (creator.creatorTypeID !== undefined)
        stored.creatorTypeID = creator.creatorTypeID;
    else if (creator.creatorType !== undefined)
        stored.creatorType = creator.creatorType;
    return stored;
}
export function metadataFingerprint(snapshot: Pick<MetadataSnapshot, 'itemTypeID'> & {
    fields: object;
    creators: unknown[];
}): string {
    const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
        : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    const creators = (snapshot.creators || []).map(creator => storedCreator(creator, snapshot.itemTypeID));
    return JSON.stringify(canonical([snapshot.itemTypeID, snapshot.fields, creators]));
}
export function matchesFingerprint(snapshot: Pick<MetadataSnapshot, 'itemTypeID'> & {
    fields: object;
    creators: unknown[];
}, stored: unknown, before?: Pick<MetadataSnapshot, 'itemTypeID' | 'fields' | 'creators'>): boolean {
    if (typeof stored !== 'string' || !stored)
        return false;
    const now = metadataFingerprint(snapshot);
    if (now === stored)
        return true;
    const parsed = parseFingerprint(stored);
    if (!parsed)
        return false;
    if (metadataFingerprint(parsed) === now)
        return true;
    if (!before || parsed.itemTypeID === before.itemTypeID)
        return false;
    const moved: FingerprintRecord = { ...parsed, fields: { ...parsed.fields } };
    for (const [field, value] of Object.entries(carriedByTypeChange(before as MetadataSnapshot, parsed.itemTypeID))) {
        if (value) {
            if (!(field in moved.fields))
                moved.fields[field] = value;
        }
        else if (moved.fields[field] === before.fields?.[field])
            delete moved.fields[field];
    }
    const retyped = (record: FingerprintRecord): FingerprintRecord => ({ ...record, creators: retypedByTypeChange(record.creators, before.itemTypeID, record.itemTypeID) });
    return [moved, retyped(parsed), retyped(moved)].some(record => metadataFingerprint(record) === now);
}
export interface FingerprintRecord {
    itemTypeID: number;
    fields: Record<string, Primitive>;
    creators: unknown[];
}
export function parseFingerprint(text: unknown): FingerprintRecord | null {
    if (typeof text !== 'string' || !text)
        return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return null;
    }
    if (!Array.isArray(parsed) || parsed.length !== 3)
        return null;
    const [itemTypeID, fields, creators] = parsed;
    if (typeof itemTypeID !== 'number' || !fields || typeof fields !== 'object' || Array.isArray(fields) || !Array.isArray(creators))
        return null;
    return { itemTypeID, fields: fields as Record<string, Primitive>, creators };
}

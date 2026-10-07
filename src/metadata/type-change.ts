import type { MetadataSnapshot } from '../types';
import { validForTypeID } from '../recognition/item-fields';
export function carriedByTypeChange(before: MetadataSnapshot, targetTypeID: number): Record<string, string> {
    const carried: Record<string, string> = {};
    const fields = Zotero.ItemFields as any;
    if (!targetTypeID || targetTypeID === before.itemTypeID)
        return carried;
    if (typeof fields.getBaseIDFromTypeAndField === 'function' && typeof fields.getFieldIDFromTypeAndBase === 'function') {
        for (const [field, value] of Object.entries(before.fields || {})) {
            if (value === '' || value === null || value === undefined || validForTypeID(field, targetTypeID))
                continue;
            try {
                const baseID = fields.getBaseIDFromTypeAndField(before.itemTypeID, Zotero.ItemFields.getID(field));
                const movedID = baseID ? fields.getFieldIDFromTypeAndBase(targetTypeID, baseID) : 0;
                if (movedID)
                    carried[Zotero.ItemFields.getName(movedID)] = String(value);
            }
            catch { }
        }
    }
    if (before.itemTypeID === Zotero.ItemTypes.getID('book') && targetTypeID === Zotero.ItemTypes.getID('bookSection')) {
        if (before.fields?.title) {
            carried.bookTitle = String(before.fields.title);
            carried.title = '';
        }
        if (before.fields?.shortTitle)
            carried.shortTitle = '';
    }
    if (before.itemTypeID === Zotero.ItemTypes.getID('bookSection') && targetTypeID === Zotero.ItemTypes.getID('book')
        && before.fields?.bookTitle && !before.fields?.title) {
        carried.title = String(before.fields.bookTitle);
        if (before.fields?.shortTitle)
            carried.shortTitle = '';
    }
    return carried;
}
export function retypedByTypeChange(creators: any[], fromTypeID: number, toTypeID: number): any[] {
    const types = Zotero.CreatorTypes as any;
    if (!types || typeof types.isValidForItemType !== 'function' || typeof types.getPrimaryIDForType !== 'function' || fromTypeID === toTypeID)
        return creators;
    const oldPrimary = types.getPrimaryIDForType(fromTypeID);
    return creators.map(creator => {
        if (!creator || creator.creatorTypeID === undefined || types.isValidForItemType(creator.creatorTypeID, toTypeID))
            return creator;
        const newPrimary = oldPrimary == creator.creatorTypeID ? types.getPrimaryIDForType(toTypeID) : false;
        return { ...creator, creatorTypeID: newPrimary ? newPrimary : 2 };
    });
}

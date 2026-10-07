export type Primitive = string | number | boolean;
export interface ItemIdentity {
    key: string;
    libraryID: number;
    collections: number[];
    tags: unknown[];
    relations: Record<string, unknown>;
    attachmentIDs: number[];
    attachmentKeys: string[];
    attachmentPaths: Array<string | false>;
    noteIDs: number[];
    annotationIDs: number[];
}
export interface MetadataSnapshot {
    appliedMetadata?: string;
    itemID: number;
    key: string;
    itemTypeID: number;
    itemType: string;
    typeRead?: boolean;
    creatorsAbbreviated?: boolean;
    fields: Record<string, Primitive>;
    creators: unknown[];
    identity: ItemIdentity;
}
export interface FieldChange {
    field: string;
    oldValue: unknown;
    newValue: unknown;
    replacedFromDocument?: boolean;
}
export interface RecognitionResult {
    source: any;
    metadata: MetadataSnapshot;
    changes: FieldChange[];
}

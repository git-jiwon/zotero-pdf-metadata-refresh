export function isStandalonePDF(item: any): boolean {
    return !!item && typeof item.isAttachment === 'function' && item.isAttachment()
        && !item.parentItemID && item.attachmentContentType === 'application/pdf' && !item.deleted;
}
export function isRecognitionTarget(item: any): boolean {
    return !!item && (item.isRegularItem?.() || isStandalonePDF(item));
}

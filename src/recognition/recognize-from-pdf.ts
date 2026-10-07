import type { RecognitionResult } from "../types";
import { buildDiff } from "../metadata/diff";
import { assertIdentityUnchanged, captureIdentity, snapshotItem } from "../metadata/snapshot";
import { debug } from "../utils/log";
import { assertNativeRecognizer } from "../utils/zotero-version";
import { recordOfAListedWork } from "./pdf-identifiers";
import { pagesFromRecognizerData } from "./zotero-pages";
async function namesAListedWork(recognized: RecognitionResult["metadata"], attachment: any, pages?: string[]): Promise<string | null> {
    const fields: Record<string, any> = recognized?.fields || {};
    if (!String(fields.ISBN || "").trim())
        return null;
    let texts = pages;
    if (!texts?.length) {
        try {
            const data = await Zotero.PDFWorker.getRecognizerData(attachment.id, true);
            texts = pagesFromRecognizerData(data, 8).map(page => page.text);
        }
        catch (cause) {
            debug(`native result check: pages unavailable (${String(cause).slice(0, 120)})`);
            return null;
        }
    }
    return texts?.length ? recordOfAListedWork({ ISBN: fields.ISBN, DOI: fields.DOI, title: fields.title }, texts) : null;
}
export async function recognizeFromPDF(parent: any, attachment: any, allowTypeChange = false, pages?: string[]): Promise<RecognitionResult | null> {
    assertNativeRecognizer();
    const parentIdentity = await captureIdentity(parent);
    const originalParentID = attachment.parentItemID;
    const originalKey = attachment.key;
    const originalPath = await attachment.getFilePath();
    let temp: any = null;
    debug(`item=${parent.key} title=${parent.getField("title")} pdf=${attachment.key} file=${PathUtils.filename(originalPath)} recognition started`);
    try {
        temp = await Zotero.RecognizeDocument._recognize(attachment);
        if (!temp)
            return null;
        await Zotero.DB.waitForTransaction();
        const recognized = await snapshotItem(temp);
        const listed = await namesAListedWork(recognized, attachment, pages);
        if (listed) {
            debug(`item=${parent.key} native recognizer result set aside: ${listed}; recognized title=${recognized.fields.title || ""}`);
            return null;
        }
        const existing = await snapshotItem(parent);
        const changes = buildDiff(existing, recognized, allowTypeChange);
        debug(`item=${parent.key} recognition succeeded; recognized title=${recognized.fields.title || ""}; changed=${changes.map(x => x.field).join(",")}`);
        return { source: null, metadata: recognized, changes };
    }
    finally {
        if (temp)
            await cleanupTemporaryItem(temp, attachment);
        if (attachment.parentItemID !== originalParentID || attachment.key !== originalKey || await attachment.getFilePath() !== originalPath) {
            throw new Error("Safety invariant failed: source PDF identity/parent/path changed during recognition");
        }
        assertIdentityUnchanged(parentIdentity, await captureIdentity(parent));
    }
}
export async function cleanupTemporaryItem(temp: any, sourceAttachment: any): Promise<void> {
    if (!temp)
        return;
    if (sourceAttachment.parentItemID === temp.id)
        throw new Error("Refusing cleanup: source PDF is attached to temporary item");
    if (temp.id === sourceAttachment.parentItemID || !temp.isRegularItem())
        throw new Error("Unsafe temporary item");
    const tempAttachments = temp.getAttachments(true);
    if (tempAttachments.length)
        throw new Error(`Refusing cleanup: temporary item owns ${tempAttachments.length} attachment(s)`);
    if (temp.getNotes(true).length)
        throw new Error(`Refusing cleanup: temporary item ${temp.key} owns notes`);
    const key = temp.key;
    await temp.eraseTx();
    debug(`temporary item cleanup succeeded: ${key}`);
}

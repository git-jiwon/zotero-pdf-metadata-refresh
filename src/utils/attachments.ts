import { debug } from "./log";
const SECONDARY_LABEL_RE = /(?:^|[\s._()\-[\]])(?:supp(?:lement(?:ary|al)?)?|suppinfo|supporting[\s._-]*(?:info(?:rmation)?|material)|esm|moesm\d*|mmc\d+|additional[\s._-]*file)(?:[\s._()\-[\]]|$)/i;
const TITLE_WORD_WHOLE_RE = /^\s*(?:si|esi|appendix|annex)(?:[\s._-]+(?:si|esi|appendix|annex))*(?:[\s._-]*(?:[a-z]|[a-z]?\d+))?(?:\.pdf)?\s*$/i;
const TITLE_WORD_SUFFIX_RE = /[._-](?:si|esi|appendix|annex)(?:[._-]*[a-z]?\d+)*\.pdf$/i;
const TITLED_FILENAME_RE = / - /;
const TITLE_WORD_UNDERSCORE_SUFFIX_RE = /_(?:si|esi|appendix|annex)(?:[._-]*[a-z]?\d+)*\.pdf$/i;
const BARE_SUPPORTING_FILE_RE = /(?:^|\s)supporting\.pdf(?:\s|$)|^supporting$/i;
const SECONDARY_FRONT_RE = /\b(?:supporting|supplementary|supplemental)\s+(?:information|materials?|data|methods?|figures?|file)\b|\belectronic\s+supplementary\s+(?:information|materials?)\b/i;
function recognizerFrontText(data: any): string {
    const values: string[] = [];
    const visit = (value: any) => {
        if (typeof value === "string")
            values.push(value);
        else if (Array.isArray(value))
            value.forEach(visit);
    };
    for (const page of (data?.pages || []).slice(0, 2))
        visit(page?.[2]);
    return values.join(" ").replace(/\s+/g, " ").trim().slice(0, 4000);
}
export function isSecondaryPDFLabel(label: string): boolean {
    if (SECONDARY_LABEL_RE.test(label) || BARE_SUPPORTING_FILE_RE.test(label))
        return true;
    if (TITLE_WORD_WHOLE_RE.test(label))
        return true;
    return (TITLED_FILENAME_RE.test(label) ? TITLE_WORD_UNDERSCORE_SUFFIX_RE : TITLE_WORD_SUFFIX_RE).test(label.trim());
}
export function isSecondaryPDFFrontMatter(data: any): boolean {
    const text = recognizerFrontText(data);
    const match = SECONDARY_FRONT_RE.exec(text);
    if (!match || match.index >= 1200)
        return false;
    const lead = text.slice(Math.max(0, match.index - 24), match.index);
    return !/\b(?:see|in|the)\s*$/i.test(lead);
}
async function exists(item: any): Promise<boolean> {
    const path = await item.getFilePath();
    return !!path && await IOUtils.exists(path);
}
async function isSecondaryByContent(item: any): Promise<boolean> {
    try {
        return isSecondaryPDFFrontMatter(await Zotero.PDFWorker.getRecognizerData(item.id, true));
    }
    catch (e) {
        debug(`Supplementary PDF front-matter check failed: attachment=${item.key || item.id}; ${String(e)}`);
        return false;
    }
}
export async function selectPrimaryPDF(parent: any): Promise<{
    attachment?: any;
    reason?: string;
}> {
    const attachments = Zotero.Items.get(parent.getAttachments()).filter((item: any) => item?.isPDFAttachment());
    if (!attachments.length)
        return { reason: "noPDF" };
    if (attachments.length === 1) {
        return await exists(attachments[0]) ? { attachment: attachments[0] } : { reason: "missingFile" };
    }
    let candidates = attachments.filter((item: any) => !isSecondaryPDFLabel(String(item.getField("title") || ""))
        && !isSecondaryPDFLabel(PathUtils.filename(item.getFilePath() || "unknown.pdf")));
    if (candidates.length === 1) {
        return await exists(candidates[0]) ? { attachment: candidates[0] } : { reason: "missingFile" };
    }
    const secondaryByContent = new Set<any>();
    for (const item of candidates) {
        if (await exists(item) && await isSecondaryByContent(item))
            secondaryByContent.add(item);
    }
    candidates = candidates.filter((item: any) => !secondaryByContent.has(item));
    if (candidates.length === 1) {
        return await exists(candidates[0]) ? { attachment: candidates[0] } : { reason: "missingFile" };
    }
    debug(`Multiple PDFs — skipped: parent=${parent.key}, count=${attachments.length}, supplementary=${attachments.length - candidates.length}`);
    return { reason: "multiplePDFs" };
}

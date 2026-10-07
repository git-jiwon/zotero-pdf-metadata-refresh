export const MINIMUM_ZOTERO_VERSION = "10.0.1";
function compare(left: string, right: string): number {
    const parts = (value: string) => value.replace(/[-+].*$/, "").split(".").map(part => parseInt(part, 10) || 0);
    const a = parts(left), b = parts(right);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const difference = (a[i] || 0) - (b[i] || 0);
        if (difference)
            return difference < 0 ? -1 : 1;
    }
    return 0;
}
export function assertNativeRecognizer(): void {
    const recognizer = Zotero.RecognizeDocument;
    const version = String(Zotero.version || "");
    if (compare(version, MINIMUM_ZOTERO_VERSION) < 0) {
        throw new Error(`Zotero ${MINIMUM_ZOTERO_VERSION} 이상이 필요합니다 (현재 ${version || "알 수 없음"}).`);
    }
    const missing = [
        ["Zotero.RecognizeDocument.canRecognize", recognizer?.canRecognize],
        ["Zotero.RecognizeDocument.recognizeItems", recognizer?.recognizeItems],
        ["Zotero.RecognizeDocument._recognize", recognizer?._recognize],
        ["Zotero.PDFWorker.getRecognizerData", Zotero.PDFWorker?.getRecognizerData]
    ].filter(([, value]) => typeof value !== "function").map(([name]) => name);
    if (missing.length) {
        throw new Error(`This Zotero version is not supported because the native PDF recognition API has changed. Missing: ${missing.join(", ")}`);
    }
}

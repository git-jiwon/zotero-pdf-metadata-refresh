import { ContextMenu } from "./ui/context-menu";
import { isRecognitionTarget } from "./utils/recognition-target";
import { assertNativeRecognizer } from "./utils/zotero-version";
import { openBatchWindow } from './ui/batch-window';
import { uiText } from './ui/i18n';
export { BatchSession, eligibility, writePlanFor } from './batch/session';
export { readCoverCandidate } from './recognition/cover-candidate';
export { renderPage, pagesFromRecognizerData } from './recognition/zotero-pages';
export { fixtureFetcher, zoteroFetcher } from './restore/outcome';
export { fixtureBrowser, zoteroBrowser } from './restore/browser';
export { classifyAccess, collectFromPage, collectionSummary, visibleText } from './restore/collect';
export { rowStanding } from './batch/status-label';
export { restoreGate, restoreHeld, phaseOutcome, wantedFields } from './batch/restore-gate';
export { readStatedDate } from './restore/collect';
export { dateRoleCategory } from './restore/link';
export { parseGoogleResults, classifyResultPage } from './restore/google';
export class Addon {
    private menu: ContextMenu;
    private busy = false;
    private batchWindow: any;
    constructor() {
        this.menu = new ContextMenu({ open: () => void this.open() });
    }
    async startup(): Promise<void> {
        await Zotero.initializationPromise;
        assertNativeRecognizer();
        for (const win of Zotero.getMainWindows())
            this.menu.register(win);
    }
    async shutdown(): Promise<void> {
        try {
            await this.batchWindow?.pdfMetadataRefreshShutdown?.();
        }
        finally {
            this.menu.unregister();
            this.batchWindow = null;
            this.busy = false;
        }
    }
    registerWindow(win: any): void { this.menu.register(win); }
    unregisterWindow(win: any): void { this.menu.unregisterWindow(win); }
    private async open(): Promise<void> {
        if (this.batchWindow && !this.batchWindow.closed) {
            this.batchWindow.focus();
            return;
        }
        if (this.busy)
            return;
        const items = Zotero.getActiveZoteroPane().getSelectedItems().filter(isRecognitionTarget);
        if (!items.length)
            return;
        this.busy = true;
        try {
            this.batchWindow = openBatchWindow(items, () => { this.busy = false; this.batchWindow = null; });
        }
        catch (e) {
            this.busy = false;
            Services.prompt.alert(null, uiText('PDF 정보 정리 화면을 열 수 없습니다'), uiText(String(e)));
        }
    }
}

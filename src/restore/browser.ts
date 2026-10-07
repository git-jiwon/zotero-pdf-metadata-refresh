import { assertPublicURL, safePublicURL } from '../utils/public-url';
export interface BrowserPage {
    file?: {
        url: string;
        contentType: string;
    };
    url: string;
    finalURL: string;
    status: number;
    html: string;
    ms: number;
    timedOut?: boolean;
    error?: string;
    fixture?: boolean;
}
export interface TranslatorResult {
    translator: string;
    items: any[];
    error?: string;
}
export interface PdfResult {
    url: string;
    text: string;
    pages: number;
    error?: string;
}
export interface SearchBrowser {
    load(url: string, options?: {
        settleMs?: number;
        timeoutMs?: number;
        settledWhen?: RegExp;
    }): Promise<BrowserPage>;
    translate?(): Promise<TranslatorResult>;
    resolve?(url: string): Promise<{
        finalURL: string;
        contentType: string;
        status: number;
    }>;
    readPDF?(url: string): Promise<PdfResult>;
    release(): void;
    readonly live: boolean;
}
export type BrowserFactory = () => SearchBrowser;
const FILE_RESPONSE = /application\/(?:pdf|octet-stream|x-download|x-msdownload|force-download|zip|x-pdf)|binary\//i;
export function zoteroBrowser(): BrowserFactory {
    return () => {
        let browser: any = null;
        const state: {
            file: {
                url: string;
                contentType: string;
            } | null;
        } = { file: null };
        const blocked = (): {
            url: string;
            contentType: string;
        } | null => state.file;
        let observing = false;
        const observer = {
            observe(subject: any) {
                let channel: any;
                try {
                    channel = subject.QueryInterface((globalThis as any).Components.interfaces.nsIHttpChannel);
                }
                catch {
                    return;
                }
                try {
                    if (!browser || channel.browserId === 0 || channel.browserId !== browser.browserId)
                        return;
                    if (!channel.isDocument)
                        return;
                    let type = '';
                    try {
                        type = String(channel.contentType || '');
                    }
                    catch {
                        type = '';
                    }
                    let disposition = '';
                    try {
                        disposition = String(channel.getResponseHeader('Content-Disposition') || '');
                    }
                    catch {
                        disposition = '';
                    }
                    if (FILE_RESPONSE.test(type) || /^\s*attachment/i.test(disposition)) {
                        state.file = { url: String(channel.URI?.spec || ''), contentType: type || disposition };
                        channel.cancel((globalThis as any).Components.results.NS_BINDING_ABORTED);
                        Zotero.debug(`[PDF Metadata Refresh] hidden browser: cancelled a file response (${type || disposition}) at ${state.file.url.slice(0, 120)}`);
                    }
                }
                catch (cause) {
                    Zotero.debug(`[PDF Metadata Refresh] hidden browser: response check failed: ${String(cause)}`);
                }
            }
        };
        const ensure = () => {
            if (browser)
                return browser;
            const { HiddenBrowser } = ChromeUtils.importESModule('chrome://zotero/content/HiddenBrowser.mjs');
            browser = new HiddenBrowser({ allowJavaScript: true, docShell: { allowContentRetargeting: false, allowContentRetargetingOnChildren: false } });
            return browser;
        };
        const watch = async (target: any) => {
            if (observing)
                return;
            try {
                await target._createdPromise;
            }
            catch { }
            if (observing || !browser)
                return;
            Services.obs.addObserver(observer, 'http-on-examine-response');
            Services.obs.addObserver(observer, 'http-on-examine-cached-response');
            observing = true;
        };
        const unwatch = () => {
            if (!observing)
                return;
            try {
                Services.obs.removeObserver(observer, 'http-on-examine-response');
            }
            catch { }
            try {
                Services.obs.removeObserver(observer, 'http-on-examine-cached-response');
            }
            catch { }
            observing = false;
        };
        return {
            live: true,
            async load(url, options = {}) {
                const started = Date.now();
                const timeoutMs = options.timeoutMs ?? 30000;
                const settleMs = options.settleMs ?? 5000;
                state.file = null;
                try {
                    assertPublicURL(url);
                    const target = ensure();
                    await watch(target);
                    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out loading the page')), timeoutMs));
                    await Promise.race([target.load(url, { requireSuccessfulStatus: false }), timeout]);
                    let html = '';
                    let status = 0;
                    const deadline = Date.now() + settleMs;
                    for (;;) {
                        await new Promise(resolve => setTimeout(resolve, Math.min(700, Math.max(50, deadline - Date.now()))));
                        const data = await Promise.race([target.getPageData(['documentHTML', 'channelInfo'], { timeout: 15000 }), timeout]);
                        html = String(data.documentHTML || '');
                        status = Number(data.channelInfo?.responseStatus) || 0;
                        if (options.settledWhen && options.settledWhen.test(html))
                            break;
                        if (Date.now() >= deadline)
                            break;
                    }
                    const finalURL = String(target.currentURI?.spec || url);
                    const metFile = blocked();
                    if (metFile)
                        assertPublicURL(metFile.url || finalURL);
                    else if (finalURL !== 'about:blank')
                        assertPublicURL(finalURL);
                    if (metFile)
                        return { url, finalURL: metFile.url || finalURL, status, html: '', ms: Date.now() - started, file: metFile };
                    return { url, finalURL, status, html, ms: Date.now() - started };
                }
                catch (cause: any) {
                    const message = String(cause?.message || cause).slice(0, 200);
                    const metFile = blocked();
                    if (metFile && safePublicURL(metFile.url || url))
                        return { url, finalURL: metFile.url || url, status: 0, html: '', ms: Date.now() - started, file: metFile };
                    const address = safePublicURL(url) ? url : '(blocked URL)';
                    return { url: address, finalURL: address, status: 0, html: '', ms: Date.now() - started, timedOut: /timed out/i.test(message), error: message };
                }
            },
            async translate() {
                if (!browser)
                    return { translator: '', items: [], error: 'no page loaded' };
                let translate: any = null;
                try {
                    const { RemoteTranslate } = ChromeUtils.importESModule('chrome://zotero/content/RemoteTranslate.mjs');
                    translate = new RemoteTranslate({ disableErrorReporting: true });
                    await translate.setBrowser(browser);
                    const found = await translate.detect();
                    if (!found || !found.length)
                        return { translator: '', items: [] };
                    const items = await translate.translate({ libraryID: false });
                    return { translator: String(found[0].label || found[0].translatorID || 'translator'), items: Array.isArray(items) ? items : [] };
                }
                catch (cause: any) {
                    return { translator: '', items: [], error: String(cause?.message || cause).slice(0, 200) };
                }
                finally {
                    try {
                        translate?.dispose();
                    }
                    catch { }
                }
            },
            async resolve(url) {
                let current = assertPublicURL(url);
                let contentType = '';
                let status = 0;
                for (let hop = 0; hop < 5; hop++) {
                    let response: any;
                    try {
                        response = await Zotero.HTTP.request('GET', current, { followRedirects: false, successCodes: false, timeout: 15000, errorDelayMax: 0, responseType: 'text' });
                    }
                    catch (cause: any) {
                        response = cause?.xmlhttp || { status: Number(cause?.status) || 0 };
                    }
                    status = Number(response?.status) || 0;
                    let location = '';
                    try {
                        location = String(response?.getResponseHeader?.('Location') || '');
                    }
                    catch {
                        location = '';
                    }
                    try {
                        contentType = String(response?.getResponseHeader?.('Content-Type') || '');
                    }
                    catch {
                        contentType = '';
                    }
                    if (status >= 300 && status < 400 && location) {
                        current = assertPublicURL(new URL(location, current).href);
                        continue;
                    }
                    break;
                }
                return { finalURL: current, contentType, status };
            },
            async readPDF(url) {
                try {
                    assertPublicURL(url);
                    const response = await Zotero.HTTP.request('GET', url, { responseType: 'arraybuffer', timeout: 60000, successCodes: false, errorDelayMax: 0 });
                    assertPublicURL(response.responseURL || url);
                    const status = Number(response.status) || 0;
                    if (status >= 400)
                        return { url, text: '', pages: 0, error: `HTTP ${status}` };
                    const buffer: ArrayBuffer = response.response;
                    if (!buffer || !buffer.byteLength)
                        return { url, text: '', pages: 0, error: 'empty body' };
                    if (buffer.byteLength > 40 * 1024 * 1024)
                        return { url, text: '', pages: 0, error: `file too large (${Math.round(buffer.byteLength / 1048576)} MB)` };
                    const head = String.fromCharCode(...new Uint8Array(buffer.slice(0, 5)));
                    if (!head.startsWith('%PDF'))
                        return { url, text: '', pages: 0, error: `not a PDF (${String(response.getResponseHeader?.('Content-Type') || 'unknown type')})` };
                    const data = await Zotero.PDFWorker._enqueue(() => Zotero.PDFWorker._query('pdf.getRecognizerData', { buf: buffer }, [buffer]), true);
                    const pages = Zotero.PDFMetadataRefresh.pagesFromRecognizerData(data, 3);
                    return { url, text: pages.map((page: any) => page.text).join('\f'), pages: Number(data?.totalPages) || pages.length };
                }
                catch (cause: any) {
                    return { url, text: '', pages: 0, error: String(cause?.message || cause).slice(0, 200) };
                }
            },
            release() {
                unwatch();
                try {
                    browser?.destroy();
                }
                catch { }
                browser = null;
            }
        };
    };
}
export interface BrowserFixture {
    match: string | RegExp;
    html?: string;
    status?: number;
    finalURL?: string;
    timedOut?: boolean;
    error?: string;
    translator?: TranslatorResult;
    resolvedURL?: string;
    contentType?: string;
    pdf?: PdfResult;
}
export function fixtureBrowser(fixtures: BrowserFixture[]): SearchBrowser {
    const matches = (fixture: BrowserFixture, url: string) => typeof fixture.match === 'string' ? url.includes(fixture.match) : fixture.match.test(url);
    let current: BrowserFixture | undefined;
    return {
        live: false,
        async load(url) {
            const fixture = fixtures.find(entry => matches(entry, url));
            current = fixture;
            if (!fixture)
                return { url, finalURL: url, status: 0, html: '', ms: 0, error: `no fixed page for ${url}`, fixture: true };
            if (fixture.timedOut)
                return { url, finalURL: url, status: 0, html: '', ms: 0, timedOut: true, error: 'timed out', fixture: true };
            if (fixture.error)
                return { url, finalURL: url, status: 0, html: '', ms: 0, error: fixture.error, fixture: true };
            return { url, finalURL: fixture.finalURL || url, status: fixture.status ?? 200, html: fixture.html || '', ms: 0, fixture: true };
        },
        async translate() { return current?.translator || { translator: '', items: [] }; },
        async resolve(url) {
            const fixture = fixtures.find(entry => matches(entry, url));
            return { finalURL: fixture?.resolvedURL || url, contentType: fixture?.contentType || '', status: fixture ? 200 : 0 };
        },
        async readPDF(url) {
            const fixture = fixtures.find(entry => matches(entry, url) || (entry.resolvedURL && url === entry.resolvedURL));
            return fixture?.pdf || { url, text: '', pages: 0, error: `no fixed PDF for ${url}` };
        },
        release() { }
    };
}

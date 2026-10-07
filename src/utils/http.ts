import { assertPublicURL } from './public-url';
export function isRetryableNetworkError(error: any): boolean {
    const status = Number(error?.status || error?.xmlhttp?.status || 0);
    if ([403, 404, 429].includes(status))
        return false;
    if ([408, 425, 500, 502, 503, 504].includes(status))
        return true;
    return /timed?\s*out|timeout|network|connection|연결|시간.*초과/i.test(String(error?.message || error));
}
export async function getPublicPage(url: string, timeout = 30000): Promise<any> {
    assertPublicURL(url);
    let lastError: any;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await Zotero.HTTP.request('GET', url, { timeout });
            assertPublicURL(response.responseURL || url);
            return response;
        }
        catch (error) {
            lastError = error;
            if (attempt || !isRetryableNetworkError(error))
                throw error;
            Zotero.debug(`[PDF Metadata Refresh] transient request failure; retrying once: ${url}`);
            await Zotero.Promise.delay(750);
        }
    }
    throw lastError;
}

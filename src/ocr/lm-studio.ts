import { DEFAULT_METHODS, type RecognitionMethods } from '../batch/session';
const PREFIX = 'extensions.zotero.pdfMetadataRefresh.';
export function getInternationalSearch(): boolean {
    return Zotero.Prefs.get(PREFIX + 'internationalSearch', true) === true;
}
export function loadMethods(): RecognitionMethods {
    try {
        const raw = String(Zotero.Prefs.get(PREFIX + 'methods', true) || '');
        if (!raw)
            return { ...DEFAULT_METHODS };
        const stored = JSON.parse(raw) as Partial<RecognitionMethods>;
        const methods = { ...DEFAULT_METHODS };
        for (const key of Object.keys(methods) as Array<keyof RecognitionMethods>) {
            if (typeof stored[key] === 'boolean')
                methods[key] = stored[key] as boolean;
        }
        return methods;
    }
    catch (cause) {
        Zotero.debug(`[PDF Metadata Refresh] stored method selection ignored: ${String(cause)}`);
        return { ...DEFAULT_METHODS };
    }
}
export function saveMethods(methods: RecognitionMethods): void {
    Zotero.Prefs.set(PREFIX + 'methods', JSON.stringify(methods), true);
}
export interface LMStudioSettings {
    endpoint: string;
    visionModel: string;
}
export interface LMStudioModelInfo {
    id: string;
    type: 'llm' | 'vlm';
    state: string;
}
function endpointURL(raw: string, suffix: string): string {
    const url = new URL(String(raw || '').trim().replace(/\/$/, '') + suffix);
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
        || url.username || url.password)
        throw new Error('LM Studio 주소는 localhost 또는 127.0.0.1만 허용됩니다.');
    return url.href;
}
export function getLMStudioSettings(): LMStudioSettings {
    return {
        endpoint: String(Zotero.Prefs.get(PREFIX + 'lmEndpoint', true) || 'http://127.0.0.1:1234/v1'),
        visionModel: String(Zotero.Prefs.get(PREFIX + 'lmVisionModel', true) || '')
    };
}
export function saveLMStudioSettings(settings: LMStudioSettings): void {
    endpointURL(settings.endpoint, '/models');
    Zotero.Prefs.set(PREFIX + 'lmEndpoint', settings.endpoint.replace(/\/$/, ''), true);
    Zotero.Prefs.set(PREFIX + 'lmVisionModel', settings.visionModel, true);
}
export async function listLMStudioModelCatalog(endpoint: string): Promise<LMStudioModelInfo[]> {
    const compatible = new URL(endpointURL(endpoint, '/models'));
    compatible.pathname = '/api/v0/models';
    compatible.search = '';
    try {
        const response = await Zotero.HTTP.request('GET', compatible.href, { responseType: 'json', timeout: 10000 });
        const models: LMStudioModelInfo[] = (response.response?.data || [])
            .filter((entry: any) => ['llm', 'vlm'].includes(String(entry?.type || '').toLowerCase()))
            .map((entry: any) => ({ id: String(entry?.id || ''), type: String(entry.type).toLowerCase(), state: String(entry.state || '') }))
            .filter((entry: LMStudioModelInfo) => !!entry.id) as LMStudioModelInfo[];
        return [...new Map(models.map(model => [model.id, model])).values()];
    }
    catch (cause) {
        Zotero.debug(`[PDF Metadata Refresh] LM Studio model metadata unavailable: ${String(cause)}`);
        const response = await Zotero.HTTP.request('GET', endpointURL(endpoint, '/models'), { responseType: 'json', timeout: 10000 });
        const models: LMStudioModelInfo[] = (response.response?.data || []).map((entry: any) => String(entry?.id || ''))
            .filter((id: string) => !!id && !/(?:^|[-_/])(?:text-)?embed(?:ding)?/i.test(id))
            .map((id: string) => ({ id, type: /(?:qwen\d*[-_.]?vl|vision|vlm|gemma[-_.]?3)/i.test(id) ? 'vlm' : 'llm', state: '' }));
        return [...new Map(models.map(model => [model.id, model])).values()];
    }
}

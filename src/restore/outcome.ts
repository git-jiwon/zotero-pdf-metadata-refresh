import { assertPublicURL, PUBLIC_URL_ERROR, safePublicURL } from '../utils/public-url';
export type OutcomeKind = 'record' | 'noMatch' | 'rejected' | 'blocked' | 'authRequired' | 'rateLimited' | 'timeout' | 'serverError' | 'parseError';
export type FetchMethod = 'api' | 'html' | 'translator' | 'fixture' | 'browser';
export interface FetchResult {
    url: string;
    finalURL?: string;
    status: number;
    headers?: Record<string, string>;
    body: string;
    ms: number;
    timedOut?: boolean;
    error?: string;
    fixture?: boolean;
}
export interface FetchOutcome {
    kind: OutcomeKind;
    provider: string;
    url: string;
    finalURL: string;
    status: number;
    fetchedAt: string;
    ms: number;
    method: FetchMethod;
    live: boolean;
    retryAfterMs?: number;
    note: string;
    phase?: 'search' | 'detail';
    host?: string;
}
export type Fetcher = (url: string, options: {
    provider: string;
    accept?: string;
    timeoutMs?: number;
}) => Promise<FetchResult>;
const SECRET_PARAMS = /([?&](?:ttbkey|cert_key|key|api_key|apikey|token|access_token|client_secret)=)[^&#]*/gi;
export function redactURL(url: unknown): string {
    return String(url || '').replace(SECRET_PARAMS, '$1***');
}
const CHALLENGE = /captcha|just a moment|attention required|access denied|cf-browser-verification|cf_chl_|verify you are human|unusual traffic|비정상적인 접근|접근이 제한|자동 등록 방지|robot check|are you a robot|ddos-guard|incapsula/i;
const LOGIN_TITLE = /<title>[^<]*(?:log ?in|sign ?in|로그인|member login|authenticate)[^<]*<\/title>/i;
const PASSWORD_FIELD = /<input[^>]+type\s*=\s*["']?password/i;
const RECORD_MARKERS = /citation_title|application\/ld\+json|dc\.title|og:type["']\s+content=["']book|ISBN/i;
const RESULT_MARKERS = /id="rso"|id="yesSchList"|data-goods-no=/i;
export function looksLikeChallenge(html: string): boolean {
    const head = String(html || '').slice(0, 20000);
    if (RECORD_MARKERS.test(head) || RESULT_MARKERS.test(head))
        return false;
    const title = head.match(/<title>([^<]*)<\/title>/i)?.[1] || '';
    return CHALLENGE.test(title) || (CHALLENGE.test(head) && head.length < 60000);
}
export function looksLikeLoginWall(html: string): boolean {
    const head = String(html || '').slice(0, 40000);
    if (RECORD_MARKERS.test(head))
        return false;
    return LOGIN_TITLE.test(head) && PASSWORD_FIELD.test(head);
}
function retryAfter(headers: Record<string, string> | undefined): number | undefined {
    const value = headers?.['retry-after'] ?? headers?.['Retry-After'];
    if (!value)
        return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds))
        return Math.max(0, seconds) * 1000;
    const at = Date.parse(value);
    return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}
export function classifyFetch(result: FetchResult, options: {
    provider: string;
    method: FetchMethod;
    expect: 'json' | 'html' | 'xml' | 'any';
}): FetchOutcome {
    const base = {
        provider: options.provider, url: redactURL(result.url), finalURL: redactURL(result.finalURL || result.url),
        status: result.status, fetchedAt: new Date().toISOString(), ms: result.ms,
        method: options.method, live: !result.fixture
    };
    if (result.timedOut)
        return { ...base, kind: 'timeout', note: `no answer within the time allowed${result.error ? ` (${result.error})` : ''}` };
    if (!result.status)
        return { ...base, kind: 'serverError', note: `no HTTP status: ${result.error || 'transport failure'}` };
    const status = result.status;
    const body = String(result.body || '');
    if (status === 401 || status === 407)
        return { ...base, kind: 'authRequired', note: `HTTP ${status}` };
    if (status === 403)
        return { ...base, kind: looksLikeLoginWall(body) ? 'authRequired' : 'blocked', note: `HTTP 403${looksLikeChallenge(body) ? ' with a bot check' : ''}` };
    if (status === 429)
        return { ...base, kind: 'rateLimited', retryAfterMs: retryAfter(result.headers), note: `HTTP 429${retryAfter(result.headers) !== undefined ? `, Retry-After ${Math.round((retryAfter(result.headers) || 0) / 1000)} s` : ''}` };
    if (status === 404 || status === 410)
        return { ...base, kind: 'noMatch', note: `HTTP ${status}: nothing at this address` };
    if (status >= 500)
        return { ...base, kind: 'serverError', note: `HTTP ${status}` };
    if (status >= 400)
        return { ...base, kind: 'rejected', note: `HTTP ${status}` };
    if (status >= 300)
        return { ...base, kind: 'rejected', note: `HTTP ${status} without a final page` };
    if (options.expect === 'json') {
        const trimmed = body.trim();
        let parsed = false;
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                JSON.parse(trimmed);
                parsed = true;
            }
            catch {
                parsed = false;
            }
        }
        if (parsed)
            return { ...base, kind: 'record', note: `HTTP ${status}` };
    }
    if (options.expect === 'xml' && /^\s*(?:<\?xml|<feed\b|<rss\b)/i.test(body))
        return { ...base, kind: 'record', note: `HTTP ${status}` };
    if (looksLikeChallenge(body))
        return { ...base, kind: 'blocked', note: 'HTTP 200 carrying a bot check instead of the page' };
    if (looksLikeLoginWall(body))
        return { ...base, kind: 'authRequired', note: 'HTTP 200 carrying a login page instead of the record' };
    if (options.expect === 'json') {
        const trimmed = body.trim();
        if (!trimmed.startsWith('{') && !trimmed.startsWith('['))
            return { ...base, kind: 'parseError', note: 'expected JSON, received something else' };
        return { ...base, kind: 'parseError', note: 'the JSON did not parse' };
    }
    if (options.expect === 'xml' && !/^\s*<\?xml|<feed\b|<rss\b|<[a-z]/i.test(body))
        return { ...base, kind: 'parseError', note: 'expected XML, received something else' };
    if (options.expect === 'html' && !/<html|<head|<body|<meta|<title/i.test(body.slice(0, 5000)))
        return { ...base, kind: 'parseError', note: 'expected a page, received something else' };
    return { ...base, kind: 'record', note: `HTTP ${status}` };
}
export interface RestoreLimits {
    maxCallsPerProvider: number;
    maxRetriesPerProvider: number;
    maxSearches: number;
    maxMs: number;
    requestTimeoutMs: number;
    maxCallsFor?: Partial<Record<string, number>>;
    maxFollowPerSearch?: number;
    maxGoogleSearches?: number;
}
export const DEFAULT_LIMITS: RestoreLimits = {
    maxCallsPerProvider: 6, maxRetriesPerProvider: 1, maxSearches: 6, maxMs: 90000, requestTimeoutMs: 15000,
    maxCallsFor: { google: 9 }
};
export class ProviderLedger {
    readonly log: FetchOutcome[] = [];
    private calls = new Map<string, number>();
    private retries = new Map<string, number>();
    private blockedUntil = new Map<string, {
        until: number;
        reason: string;
    }>();
    private searches = 0;
    private searchesBy = new Map<string, number>();
    private readonly started = Date.now();
    constructor(readonly limits: RestoreLimits = DEFAULT_LIMITS) { }
    elapsedMs(): number { return Date.now() - this.started; }
    remainingMs(): number { return Math.max(0, this.limits.maxMs - this.elapsedMs()); }
    exhausted(): boolean { return this.remainingMs() <= 0; }
    canSearch(): {
        ok: boolean;
        reason?: string;
    } {
        if (this.exhausted())
            return { ok: false, reason: `time budget (${this.limits.maxMs} ms) spent` };
        if (this.searches >= this.limits.maxSearches)
            return { ok: false, reason: `search budget (${this.limits.maxSearches}) spent` };
        return { ok: true };
    }
    noteSearch(): void { this.searches++; }
    searchesSpent(): number { return this.searches; }
    searchesOf(provider: string): number { return this.searchesBy.get(provider) || 0; }
    canCall(provider: string): {
        ok: boolean;
        reason?: string;
        waitMs?: number;
    } {
        if (this.exhausted())
            return { ok: false, reason: `time budget spent` };
        const block = this.blockedUntil.get(provider);
        if (block) {
            if (block.until === Infinity)
                return { ok: false, reason: block.reason };
            if (block.until > Date.now())
                return { ok: false, reason: block.reason, waitMs: block.until - Date.now() };
            this.blockedUntil.delete(provider);
        }
        const used = this.calls.get(provider) || 0;
        const allowed = this.callCeiling(provider);
        if (used >= allowed)
            return { ok: false, reason: `${provider}: call budget (${allowed}) spent` };
        return { ok: true };
    }
    callCeiling(provider: string): number {
        const configured = this.limits.maxCallsFor?.[provider] ?? this.limits.maxCallsPerProvider;
        if (provider !== 'google')
            return configured;
        return Math.max(configured, (this.limits.maxGoogleSearches ?? 3) * (1 + (this.limits.maxFollowPerSearch ?? 2)));
    }
    record(outcome: FetchOutcome): void {
        this.log.push(outcome);
        this.calls.set(outcome.provider, (this.calls.get(outcome.provider) || 0) + 1);
        if (outcome.phase === 'search')
            this.searchesBy.set(outcome.provider, (this.searchesBy.get(outcome.provider) || 0) + 1);
        if ((outcome.kind === 'blocked' || outcome.kind === 'authRequired') && outcome.phase !== 'detail') {
            this.blockedUntil.set(outcome.provider, { until: Infinity, reason: `${outcome.provider}: ${outcome.kind} (${outcome.note}) — no further calls this document` });
        }
        if (outcome.kind === 'rateLimited') {
            const wait = Math.min(outcome.retryAfterMs ?? 5000, this.remainingMs());
            this.blockedUntil.set(outcome.provider, { until: Date.now() + wait, reason: `${outcome.provider}: rate limited, wait ${Math.round(wait / 1000)} s` });
        }
    }
    mayRetry(provider: string): boolean {
        const used = this.retries.get(provider) || 0;
        if (used >= this.limits.maxRetriesPerProvider)
            return false;
        this.retries.set(provider, used + 1);
        return true;
    }
    summary(): Record<string, {
        calls: number;
        outcomes: Record<string, number>;
        blocked?: string;
    }> {
        const out: Record<string, {
            calls: number;
            outcomes: Record<string, number>;
            blocked?: string;
        }> = {};
        for (const entry of this.log) {
            const row = out[entry.provider] || (out[entry.provider] = { calls: 0, outcomes: {} });
            row.calls++;
            row.outcomes[entry.kind] = (row.outcomes[entry.kind] || 0) + 1;
        }
        for (const [provider, block] of this.blockedUntil)
            if (out[provider])
                out[provider].blocked = block.reason;
        return out;
    }
}
export function zoteroFetcher(): Fetcher {
    return async (url, options) => {
        const started = Date.now();
        if (!safePublicURL(url))
            return { url: '(blocked URL)', status: 0, body: '', ms: 0, error: PUBLIC_URL_ERROR };
        try {
            const response = await Zotero.HTTP.request('GET', url, {
                responseType: 'text',
                timeout: options.timeoutMs ?? DEFAULT_LIMITS.requestTimeoutMs,
                headers: options.accept ? { Accept: options.accept } : {},
                successCodes: false,
                errorDelayMax: 0
            });
            assertPublicURL(response.responseURL || url);
            const headers: Record<string, string> = {};
            for (const name of ['retry-after', 'content-type']) {
                try {
                    const value = response.getResponseHeader?.(name);
                    if (value)
                        headers[name] = String(value);
                }
                catch { }
            }
            return { url, finalURL: response.responseURL || url, status: Number(response.status) || 0, headers,
                body: String(response.responseText || ''), ms: Date.now() - started };
        }
        catch (cause: any) {
            const message = String(cause?.message || cause).slice(0, 200);
            const status = Number(cause?.status || cause?.xmlhttp?.status || 0);
            const timedOut = /timed?\s*out|timeout/i.test(message) || cause?.name === 'TimeoutException' || String(cause?.constructor?.name || '').includes('Timeout');
            let body = '';
            try {
                body = String(cause?.xmlhttp?.responseText || '');
            }
            catch {
                body = '';
            }
            return { url, status, headers: {}, body, ms: Date.now() - started, timedOut, error: message };
        }
    };
}
export interface Fixture {
    match: string | RegExp;
    status: number;
    body?: string;
    headers?: Record<string, string>;
    timedOut?: boolean;
    finalURL?: string;
}
export function fixtureFetcher(fixtures: Fixture[], fallback?: Fetcher): Fetcher {
    return async (url, options) => {
        const hit = fixtures.find(entry => typeof entry.match === 'string' ? url.includes(entry.match) : entry.match.test(url));
        if (hit) {
            return { url, finalURL: hit.finalURL || url, status: hit.timedOut ? 0 : hit.status, headers: hit.headers || {},
                body: hit.body || '', ms: 1, timedOut: !!hit.timedOut, fixture: true };
        }
        if (fallback)
            return fallback(url, options);
        return { url, status: 0, headers: {}, body: '', ms: 0, error: 'no fixture for this address and no live fetcher', fixture: true };
    };
}

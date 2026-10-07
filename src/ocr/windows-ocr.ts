export interface OCRResult {
    text: string;
    pages: number;
    cacheHit: boolean;
    provider: string;
    promptTokens?: number[];
    fields?: Record<string, string>;
    pageFields?: Record<string, Record<string, string>>;
}
export function normalizeOCRPageLimit(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(1, Math.min(20, Math.round(parsed))) : 10;
}

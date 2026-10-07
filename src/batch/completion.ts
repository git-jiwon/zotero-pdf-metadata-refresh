import type { Row } from './row';
export type EvidenceStatus = 'verified' | 'sourceStated' | 'proposed' | 'missing';
export interface CoreField {
    field: string;
    storedIn: string;
    value: string;
    evidence: EvidenceStatus;
    source: string;
    writable: boolean;
}
export interface Completion {
    kind: 'report' | 'other';
    coreComplete: boolean;
    core: CoreField[];
    missing: string[];
    evidenceStatus: EvidenceStatus;
    writeEligibility: 'all' | 'partial' | 'none';
    extent: {
        pdfPageCount?: number;
        fullReportPageCount?: number;
        attachmentExtent: 'full' | 'sample' | 'unknown';
    };
    notes: string[];
}
const REPORT_TYPES = new Set(['report', 'document']);
export const EXTRA_PDF_PAGES = 'PDF pages';
export const EXTRA_FULL_PAGES = 'Number of Pages';
export const EXTRA_ATTACHMENT_EXTENT = 'Attachment extent';
export function extraLine(extra: unknown, label: string): string {
    const match = String(extra || '').split('\n').map(line => line.trim()).find(line => line.toLowerCase().startsWith(`${label.toLowerCase()}:`));
    return match ? match.slice(label.length + 1).trim() : '';
}
export function withExtraLine(extra: unknown, label: string, value: string): string {
    const lines = String(extra || '').split('\n').filter(line => line.trim() && !line.trim().toLowerCase().startsWith(`${label.toLowerCase()}:`));
    if (value)
        lines.push(`${label}: ${value}`);
    return lines.join('\n');
}
export function isReportURL(value: unknown): boolean {
    const url = String(value || '').trim();
    if (!/^https?:\/\//i.test(url))
        return false;
    try {
        const parsed = new URL(url);
        if (parsed.pathname === '/' || parsed.pathname === '')
            return false;
        if (/[?&](?:q|query|keyword|search|s)=/i.test(parsed.search) || /\/search\b/i.test(parsed.pathname))
            return false;
        return true;
    }
    catch {
        return false;
    }
}
export function reportCompletion(row: Row, pdfPageCount?: number | null): Completion {
    const recognized = row.recognized;
    const itemType = String(recognized?.itemType || row.before?.itemType || '');
    const fields = { ...(row.before?.fields || {}), ...(recognized?.fields || {}) } as Record<string, any>;
    const verification = row.verification || {};
    const eligible = new Set((row.changes || []).map(change => change.field).filter(field => {
        const record = verification[field];
        return record && record.level === 'verified' && !row.advice?.[field];
    }));
    const changed = new Set((row.changes || []).map(change => change.field));
    const level = (field: string, value: string): EvidenceStatus => {
        if (!value)
            return 'missing';
        if (!changed.has(field))
            return 'verified';
        const record = verification[field];
        if (!record)
            return 'proposed';
        return record.level === 'verified' ? 'verified' : record.level === 'sourceStated' ? 'sourceStated' : 'proposed';
    };
    const extra = String(fields.extra || '');
    const fullPages = extraLine(extra, EXTRA_FULL_PAGES);
    const pdfPages = extraLine(extra, EXTRA_PDF_PAGES) || (pdfPageCount ? String(pdfPageCount) : '');
    const extentLine = extraLine(extra, EXTRA_ATTACHMENT_EXTENT);
    const attachmentExtent: Completion['extent']['attachmentExtent'] = /sample/i.test(extentLine) ? 'sample' : /full/i.test(extentLine) ? 'full' : 'unknown';
    const year = String(fields.date || '').slice(0, 4);
    const url = String(fields.url || '');
    const core: CoreField[] = [
        { field: '연구기관', storedIn: 'institution', value: String(fields.institution || ''), evidence: level('institution', String(fields.institution || '')), source: sourceOf(row, 'institution'), writable: eligible.has('institution') || !changed.has('institution') },
        { field: '제목', storedIn: 'title', value: String(fields.title || ''), evidence: level('title', String(fields.title || '')), source: sourceOf(row, 'title'), writable: eligible.has('title') || !changed.has('title') },
        { field: '발행연도', storedIn: 'date', value: year, evidence: level('date', year), source: sourceOf(row, 'date'), writable: eligible.has('date') || !changed.has('date') },
        { field: '페이지수', storedIn: fullPages ? `extra: ${EXTRA_FULL_PAGES}` : pdfPages ? `extra: ${EXTRA_PDF_PAGES}` : '—',
            value: fullPages ? `${fullPages} (전체 보고서)` : pdfPages ? `${pdfPages} (PDF 물리 쪽수)` : '',
            evidence: fullPages ? level('extra', fullPages) : pdfPages ? 'verified' : 'missing', source: fullPages ? sourceOf(row, 'extra') : pdfPages ? '첨부 PDF의 쪽 수' : '', writable: true },
        { field: '링크', storedIn: 'url', value: isReportURL(url) ? url : '', evidence: isReportURL(url) ? level('url', url) : 'missing', source: sourceOf(row, 'url'), writable: eligible.has('url') || !changed.has('url') }
    ];
    const missing = core.filter(entry => !entry.value).map(entry => entry.field);
    const filled = core.filter(entry => entry.value);
    const rank: Record<EvidenceStatus, number> = { verified: 3, sourceStated: 2, proposed: 1, missing: 0 };
    const evidenceStatus = filled.length ? filled.reduce<EvidenceStatus>((weakest, entry) => rank[entry.evidence] < rank[weakest] ? entry.evidence : weakest, 'verified') : 'missing';
    const writable = filled.filter(entry => entry.writable).length;
    const notes: string[] = [];
    if (pdfPages)
        notes.push(`PDF ${pdfPages}쪽 (표지·백지 포함한 파일의 쪽 수)`);
    if (fullPages)
        notes.push(`전체 보고서 ${fullPages}쪽 (외부 기록)`);
    if (attachmentExtent === 'sample')
        notes.push('첨부는 샘플/요약본 — 전체 보고서 쪽수와 구분');
    if (!isReportURL(url))
        notes.push(url ? '링크가 홈페이지·검색결과 URL이라 보고서 링크로 세지 않음 — localOnly' : '링크 없음 — localOnly');
    return {
        kind: REPORT_TYPES.has(itemType) ? 'report' : 'other',
        coreComplete: missing.length === 0,
        core, missing, evidenceStatus,
        writeEligibility: !filled.length ? 'none' : writable === filled.length ? 'all' : writable ? 'partial' : 'none',
        extent: { pdfPageCount: pdfPages ? Number(pdfPages) : undefined, fullReportPageCount: fullPages ? Number(fullPages) : undefined, attachmentExtent },
        notes
    };
}
function sourceOf(row: Row, field: string): string {
    const external = row.restore?.provenance?.[field];
    if (external?.source === 'external')
        return `${external.provider} ${external.url || ''}`.trim();
    const cover = (row.coverProposal?.sources as any)?.[field];
    if (cover?.from)
        return `원문 (${cover.from})`;
    return row.changes?.some(change => change.field === field) ? String(row.recognitionSource || '인식 결과') : '기존 레코드';
}

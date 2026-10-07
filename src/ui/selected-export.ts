import type { Row } from '../batch/row';
import { RECOGNITION_PIPELINE_VERSION } from '../batch/cache';
import { uiLocale, uiText } from './i18n';
const REPORT_NOTE = '각 행의 evidence에 실제로 읽은 쪽 텍스트(와 레이아웃)가, coverProposal에 판독기가 만든 값과 그 대안이, recognitionSource·attempts에 어느 경로가 답했는지가, restore·restoreGate에 검색이 무엇을 묻고 무엇을 연결했는지가 들어 있습니다.';
export async function exportSelectedItems(rows: readonly Row[], jobPath: string): Promise<{
    path: string;
    rows: number;
}> {
    const selected = rows.filter(row => row.checked === true);
    if (!selected.length)
        throw new Error(uiText('파일로 내보낼 항목을 선택하세요.'));
    const omissionLabel = (uiLocale() === 'en' ? ' ' : '') + uiText('자 생략');
    const cut = (value: unknown): unknown => {
        if (typeof value === 'string')
            return value.length > 20000 ? value.slice(0, 20000) + '…[' + (value.length - 20000) + omissionLabel + ']' : value;
        if (Array.isArray(value))
            return value.map(cut);
        if (value && typeof value === 'object') {
            const layout = (value as any).kind === 'pdfLayout' && typeof (value as any).text === 'string';
            return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, layout && key === 'text' ? inner : cut(inner)]));
        }
        return value;
    };
    const report = {
        version: 1,
        pipeline: RECOGNITION_PIPELINE_VERSION,
        exportedAt: new Date().toISOString(),
        job: jobPath,
        note: uiText(REPORT_NOTE),
        rows: selected.map(row => cut(row)),
    };
    const folder = PathUtils.join(jobPath, 'reports');
    await IOUtils.makeDirectory(folder, { ignoreExisting: true, createAncestors: true });
    const path = PathUtils.join(folder, `report-${Date.now()}.json`);
    await IOUtils.writeJSON(path, report, { tmpPath: path + '.tmp' });
    return { path, rows: selected.length };
}

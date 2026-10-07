import type { EvidenceKind } from '../batch/row';
import { uiText, uiTemplate } from './i18n';
export type EvidenceTone = 'muted' | 'danger' | 'attention' | 'warning' | 'info' | 'success';
export function evidenceTone(kind: EvidenceKind): EvidenceTone {
    if (kind === 'identifier' || kind === 'applied')
        return 'success';
    if (kind === 'missingFile' || kind === 'unread' || kind === 'failed')
        return 'danger';
    if (kind === 'pending' || kind === 'stopped' || kind === 'excluded')
        return 'muted';
    if (kind === 'catalogue' || kind === 'webPage')
        return 'warning';
    return 'attention';
}
const EVIDENCE_LABELS: Record<EvidenceKind, string> = {
    identifier: '식별번호로 찾음', catalogue: '도서·논문 목록', webPage: '웹페이지에서 찾음', documentRead: 'PDF에서 읽음', none: '대조할 자료 없음',
    applied: '적용 완료', excluded: '찾기에서 제외', noPDF: 'PDF 첨부 없음', multiplePDFs: 'PDF 선택 필요', missingFile: 'PDF 파일 없음', unread: 'PDF를 읽지 못함',
    pending: '찾기 전', stopped: '찾기 중단', failed: '처리 오류', preprintKept: '출판본 확인 필요'
};
export function evidenceLabel(kind: EvidenceKind, status?: string): string {
    return uiText(kind === 'applied' && status === 'applying' ? '적용 중' : EVIDENCE_LABELS[kind]);
}
export function friendlyActionCopy(text: string): string {
    const replacements = [
        ['「설정과 도구」', '「찾기 방법 및 설정」'], ['「선택 재검색」', '「선택 항목 다시 찾기」'],
        ['「적용됨」·「이번 적용」 칩', '「적용한 항목」과 상세 분류의 「이번 적용」'],
        ['「적용됨」 칩', '「적용한 항목」 분류'], ['「적용됨」', '「적용한 항목」'],
        ['「마지막 적용」 줄', '펼친 「최근 적용 결과」의 내역'], ['「마지막 되돌리기」 줄', '펼친 「최근 되돌리기 결과」의 내역'],
        ['「검색」', '「PDF 정보 찾기」'], ['「적용」', '「선택한 정보 적용」'], ['「되돌리기」', '「적용 되돌리기」']
    ];
    return uiText(replacements.reduce((value, [before, after]) => value.split(before).join(after), text)
        .replace(/「이번 적용([^」]*)」 칩/g, '상세 분류의 「이번 적용$1」'));
}
export function beginnerGuide(input: {
    items: number;
    pending: number;
    changes: number;
    applied: number;
    busy: boolean;
    operation: string;
}): {
    step: 1 | 2 | 3;
    heading: string;
    body: string;
} {
    if (input.busy) {
        const writing = input.operation === 'Metadata 적용', undoing = input.operation === '복원';
        return { step: writing ? 3 : undoing ? 2 : 1,
            heading: writing ? uiText('선택한 정보를 Zotero에 적용하고 있어요') : undoing ? uiText('적용 전 정보로 되돌리고 있어요') : input.operation === 'Load latest' ? uiText('지난 작업을 불러오고 있어요') : uiText('PDF에서 정보를 찾고 있어요'),
            body: writing || undoing ? uiText('진행 중인 항목은 안전하게 마칩니다. 멈추려면 「작업 멈추기」를 누르세요.') : uiText('찾은 결과를 확인한 뒤 직접 적용할 수 있어요. 지금은 Zotero의 정보를 바꾸지 않습니다.') };
    }
    if (!input.items)
        return { step: 1, heading: uiText('먼저 정리할 항목을 선택해 주세요'), body: uiText('Zotero에서 PDF가 첨부된 항목을 선택한 뒤 이 창을 다시 열어 주세요.') };
    if (input.pending === input.items)
        return { step: 1, heading: uiTemplate `선택한 ${input.items}개 항목의 PDF를 살펴볼까요?`, body: uiText('목록 전체에서 제목·저자·발행 정보를 찾습니다. 찾기만으로 Zotero의 정보가 바뀌지는 않아요.') };
    if (input.applied && !input.changes && !input.pending)
        return { step: 3, heading: uiText('적용한 내용을 확인해 주세요'), body: uiText('적용한 항목을 누르면 실제로 바뀐 정보가 보입니다. 적용 전 정보가 필요하면 「적용 되돌리기」를 사용하세요.') };
    if (!input.changes && !input.pending)
        return { step: 2, heading: uiText('지금 적용할 변경안이 없습니다'), body: uiText('목록에서 찾기 결과를 확인해 주세요. PDF 첨부나 읽기 문제가 있는 항목은 눌러서 자세한 내용을 볼 수 있어요.') };
    if (!input.changes && input.pending)
        return { step: 1, heading: uiTemplate `아직 ${input.pending}개 항목을 살펴보지 않았어요`, body: uiText('「PDF 정보 찾기」로 남은 항목을 이어서 확인할 수 있습니다. 먼저 찾은 결과는 목록에 남아 있어요.') };
    return { step: 2, heading: uiText('찾은 정보와 기존 정보를 비교해 주세요'), body: uiText('목록의 항목을 누르면 변경 내용을 볼 수 있어요. 적용할 항목을 선택하고 「선택한 정보 적용」을 누르세요.') };
}
export const EVIDENCE_FILTER_GROUPS: ReadonlyArray<{
    label: string;
    kinds: readonly EvidenceKind[];
}> = [
    { label: '인식 근거', kinds: ['identifier', 'catalogue', 'webPage', 'documentRead', 'none'] },
    { label: '처리 상태', kinds: ['applied', 'preprintKept', 'pending', 'stopped', 'unread', 'noPDF', 'multiplePDFs', 'missingFile', 'failed', 'excluded'] }
];
const TONE_ORDER: readonly EvidenceTone[] = ['muted', 'danger', 'attention', 'warning', 'info', 'success'];
const originalEvidenceOrder = EVIDENCE_FILTER_GROUPS.flatMap(group => group.kinds);
const evidenceRanks = new Map(originalEvidenceOrder
    .map((kind, index) => ({ kind, index }))
    .sort((a, b) => TONE_ORDER.indexOf(evidenceTone(a.kind)) - TONE_ORDER.indexOf(evidenceTone(b.kind)) || a.index - b.index)
    .map(({ kind }, index) => [kind, index]));
export function evidenceSortRank(kind: EvidenceKind): number {
    return evidenceRanks.get(kind) ?? evidenceRanks.size;
}
export function matchesListQuery(query: string, titles: readonly string[]): boolean {
    const words = query.normalize('NFKC').toLocaleLowerCase('ko').trim().split(/\s+/).filter(Boolean);
    if (!words.length)
        return true;
    const text = titles.join(' ').normalize('NFKC').toLocaleLowerCase('ko');
    return words.every(word => text.includes(word));
}

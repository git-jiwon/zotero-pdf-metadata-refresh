import { BatchSession, applySkipCode, chosenValue, eligibility, eligibleChanges, isApplicable, isSelectable, type Row } from '../batch/session';
import { APPLIED_KIND_LABEL, applyBlockMessage, applyRunLine, fieldBreakdown, fieldCountsOf, formatWhen, isAppliedStatus, legacyApplyLine, skipBreakdown, type ApplyRun, type SkipCode } from '../batch/applied-record';
import { DIFFERING_FIELD_LABEL } from '../batch/stored-difference';
import { titleSimilarity } from '../metadata/match';
import { releaseProtection } from '../batch/approval';
import { verificationCovers } from '../batch/evidence';
import { evidenceOf, EVIDENCE } from '../batch/row';
import { approvalScopeFor } from '../metadata/write-service';
import { creatorsToText, creatorDisplayName, isKnownItemType } from '../metadata/creator-text';
import { RECOGNITION_PIPELINE_VERSION } from '../batch/cache';
import { ADDON_VERSION } from '../version';
import { tokenizeScientificMarkup } from '../metadata/scientific-markup';
import { getLMStudioSettings, listLMStudioModelCatalog, loadMethods, saveMethods, saveLMStudioSettings, type LMStudioModelInfo } from '../ocr/lm-studio';
import { EVIDENCE_FILTER_GROUPS, evidenceSortRank, matchesListQuery, evidenceLabel, evidenceTone, beginnerGuide, friendlyActionCopy } from './list-presentation';
import { uiText, uiTemplate, uiLocale } from './i18n';
import { safeExternalURL } from '../utils/external-url';
const CREATORS_HINT = '한 줄에 한 명 · 사람은 「성, 이름」으로 적으면 성과 이름 두 칸으로 저장됩니다(예: 김, 철수 / Kim, Ki-Hyun) · 기관은 쉼표 없이 한 줄로 적습니다 · 역할(저자·발명자 등)은 줄 순서대로 이어받습니다.';
function chosenOnRelease(row: Row): Array<{
    field: string;
}> {
    return row.changes.filter(change => {
        if (row.advice?.[change.field])
            return false;
        const value = change.newValue;
        const empty = value === '' || value === null || value === undefined || (Array.isArray(value) && !value.length);
        return !empty;
    });
}
const KEEPS_THE_TITLE = /기존 제목|제목을 유지|유지를 권장|다른 언어|다국어|병기|본문의 언어|같은 페이지의 다른 줄|일부입니다/;
const OTHER_LANGUAGE = /다른 언어|다국어|병기|본문의 언어/;
const displayEvidenceNote = (grade: ReturnType<typeof evidenceOf>): string => grade.note === EVIDENCE[grade.kind].note ? friendlyActionCopy(grade.note) : uiText(grade.note);
export function titleCell(row: Pick<Row, 'title' | 'recognized' | 'changes' | 'advice'>): {
    kept: false;
    shown: string;
} | {
    kept: true;
    shown: string;
    otherLanguage: boolean;
} {
    const proposed = String(row.recognized?.fields.title || '');
    const titleChange = row.changes.find(change => change.field === 'title');
    const advisedTitle = String(row.advice?.title || '');
    const titleKept = KEEPS_THE_TITLE.test(advisedTitle);
    const offeredTitle = String(titleChange && titleKept ? titleChange.newValue : proposed);
    if ((!titleChange || titleKept) && offeredTitle && titleSimilarity(offeredTitle, row.title) < 0.95)
        return { kept: true, shown: offeredTitle, otherLanguage: OTHER_LANGUAGE.test(advisedTitle) };
    return { kept: false, shown: proposed || '—' };
}
export type HeaderMark = 'checked' | 'reportFlag';
export function headerBoxState(rows: Array<Partial<Pick<Row, HeaderMark>>>, mark: HeaderMark): {
    checked: boolean;
    indeterminate: boolean;
    ticked: number;
} {
    const ticked = rows.filter(row => !!row[mark]).length;
    return { checked: rows.length > 0 && ticked === rows.length, indeterminate: ticked > 0 && ticked < rows.length, ticked };
}
export function markRows<T extends Partial<Pick<Row, HeaderMark>>>(rows: T[], mark: HeaderMark, value: boolean): T[] {
    const changed = rows.filter(row => !!row[mark] !== value);
    for (const row of changed)
        (row as Partial<Pick<Row, HeaderMark>>)[mark] = value;
    return changed;
}
export function openBatchWindow(items: any[], onClose: () => void) {
    const win = Zotero.getMainWindow().openDialog('chrome://pdf-metadata-refresh/content/batch.xhtml', '', 'chrome,dialog=no,all=yes,resizable=yes,scrollbars=yes,centerscreen,width=1280,height=850', null);
    let session = new BatchSession(items);
    let pageSize = 300;
    let initialized = false, page = 0, filter = 'all', selectedRowID: number | null = null, detailOpen = false, focusTimer = 0, titleSplit = 0.5;
    let sortKey: 'oldTitle' | 'newTitle' | 'checked' | 'reportFlag' | 'evidence' | null = null, sortDirection: 1 | -1 = 1;
    let listQuery = '';
    let shuttingDown = false, shutdownTask: Promise<void> | null = null;
    const pendingOperations = new Set<Promise<void>>();
    win.pdfMetadataRefreshShutdown = () => {
        if (shutdownTask)
            return shutdownTask;
        shuttingDown = true;
        session.cancel = true;
        if (focusTimer)
            win.clearTimeout(focusTimer);
        shutdownTask = (async () => {
            await Promise.allSettled([...pendingOperations]);
            if (!win.closed)
                win.close();
        })();
        return shutdownTask;
    };
    const enabledFields = new Set<string>(), knownFields = new Set<string>();
    const labels: Record<string, string> = {
        pending: uiText('대기'), ready: uiText('검증 완료'), review: uiText('검토 필요'), mismatch: uiText('서지 후보 불일치'), protected: uiText('최종 출판본 확인 필요'), publishedKept: uiText('최종 출판본 확인 필요'), noChanges: uiText('변화 없음'),
        noPDF: uiText('PDF 없음'), multiplePDFs: uiText('다중 PDF'), missingFile: uiText('파일 없음'), textlessPDF: uiText('읽지 못함'), noMatch: uiText('인식 후보 없음'), failed: uiText('오류 · 재시도'),
        applying: uiText('적용 중'), updated: uiText('적용 완료'), undone: uiText('복원 완료'), excluded: uiText('스캔 제외')
    };
    const VISIBLE_STATUS = new Set(['mismatch', 'undone']);
    const fieldLabels: Record<string, string> = {
        title: uiText('제목'), abstractNote: uiText('초록'), publicationTitle: uiText('학술지'), date: uiText('발행일'), volume: uiText('권'), issue: uiText('호'),
        pages: uiText('페이지'), DOI: 'DOI', url: 'URL', accessDate: uiText('접근일'), libraryCatalog: uiText('라이브러리 카탈로그'),
        creators: uiText('저자/발명자'), publisher: uiText('발행기관'), language: uiText('언어'), rights: uiText('권리'), itemType: uiText('항목 유형'),
        patentNumber: uiText('공개/등록번호'), applicationNumber: uiText('출원번호'), filingDate: uiText('출원일'), issueDate: uiText('공개/공고일'),
        assignee: uiText('출원인/특허권자'), issuingAuthority: uiText('발행기관'), legalStatus: uiText('특허 상태'), country: uiText('국가'),
        ISBN: 'ISBN', ISSN: 'ISSN', journalAbbreviation: uiText('학술지 약어'), shortTitle: uiText('짧은 제목'), edition: uiText('판'), numPages: uiText('쪽수'),
        series: uiText('총서'), seriesTitle: uiText('총서 제목'), seriesNumber: uiText('총서 번호'), numberOfVolumes: uiText('권수'), bookTitle: uiText('책 제목'),
        proceedingsTitle: uiText('학술대회 자료집'), conferenceName: uiText('학술대회명'), meetingName: uiText('행사명'), sessionTitle: uiText('세션'),
        presentationType: uiText('발표 유형'), place: uiText('장소'), university: uiText('대학'), thesisType: uiText('학위 유형'), institution: uiText('기관'),
        reportNumber: uiText('보고서 번호'), reportType: uiText('보고서 유형'), manuscriptType: uiText('원고 유형'), number: uiText('번호'),
        callNumber: uiText('청구기호'), archive: uiText('보관처'), archiveLocation: uiText('보관 위치'), extra: uiText('기타')
    };
    win.addEventListener('close', (event: any) => { if (session.busy) {
        event.preventDefault();
        session.cancel = true;
    } });
    win.addEventListener('unload', () => { session.cancel = true; onClose(); }, { once: true });
    let mounted = false;
    const mount = () => {
        if (mounted || shuttingDown || win.closed || !win.document.getElementById('batch-root'))
            return;
        mounted = true;
        let timer = 0;
        try {
            const doc = win.document, root = doc.getElementById('batch-root');
            doc.title = uiText('PDF 정보 정리 — PDF Metadata Refresh');
            doc.documentElement.setAttribute('title', doc.title);
            doc.documentElement.setAttribute('lang', uiLocale());
            root.replaceChildren();
            root.className = 'app-shell';
            const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
            style.textContent = `
        *{box-sizing:border-box}
        body{margin:0}
        .app-shell{height:100%;min-height:0;display:flex;flex-direction:column;gap:12px;padding:16px;background:#f5f4f0;color:#25332e;overflow:auto;font:13px system-ui,sans-serif;line-height:1.45}
        .card{background:#fff;border:1px solid #dbe2da;border-radius:12px;box-shadow:0 2px 5px #25332e06}
        .header,.actions,.dashboard,.footer{flex:0 0 auto}
        .header{padding:4px 2px;display:flex;align-items:center;justify-content:space-between;gap:20px;background:transparent;border:0;box-shadow:none}
        .header h2{margin:0;font-size:19px}
        .muted{color:#66736c}
        .actions{overflow:visible}
        .toolbar{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:13px 18px 8px}
        .toolbar button,.pager button,.copy{border:1px solid #b7c0ce;border-radius:5px;background:#fff;padding:6px 10px;cursor:pointer}
        .toolbar button:hover,.pager button:hover,.copy:hover{background:#edf4f2}
        .toolbar button.primary{background:#256b65;color:#fff;border-color:#256b65}
        .toolbar button.danger{color:#a12622}
        .toolbar button:disabled,.pager button:disabled{opacity:.5;cursor:default}
        .setting-control{display:inline-flex;align-items:center;gap:5px;padding:6px 8px;border:1px solid #dbe2da;border-radius:6px;background:#f8fafc}
        .setting-control span{white-space:nowrap}
        .control-row{display:flex;align-items:center;gap:8px;padding:0 10px 10px;min-height:34px}
        .control-row.quiet{display:none}
        .message{margin:0 0 0 6px;color:#344054;min-height:18px;flex:1}
        .message.error{color:#a12622}
        .dashboard{padding:9px 14px}
        .dashboard.idle .progress,.dashboard.idle:not(.stopped) .progress-head{display:none}
        .dashboard.idle .metrics{margin-top:0}
        .progress-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:4px}
        .progress-head strong,.progress-head span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .progress{width:100%;height:6px}
        .metrics{display:flex;flex-wrap:wrap;gap:5px 18px;margin-top:5px;color:#66736c;font-size:12px}
        .metric{display:inline-flex;align-items:baseline;gap:5px}
        .metric b{font-size:12px;color:#25332e}
        .status-summary{margin-top:5px;display:grid;align-items:start;gap:7px 10px;flex-wrap:wrap;grid-template-columns:76px minmax(0,1fr);margin:0;padding:8px 12px 12px;border-bottom:1px solid #e3e7e0}
        .selection-row{display:inline-flex;align-items:center;gap:10px;margin-left:0;font-weight:400;font-size:12px;color:#53635a}
        .selection-count{color:#66736c;font-weight:400}
        .chip{border:1px solid transparent;border-radius:12px;background:#edf1f7;padding:2px 7px;font:inherit;font-size:12px;cursor:pointer}
        .chip:hover{border-color:#8da5c7}
        .chip.active:not([class*=tone-]){background:#256b65!important;color:#fff!important;border-color:#256b65}
        .chip:disabled{opacity:.5;cursor:default}
        .chip.group-rescanned{background:#efe6fb;color:#5b2a9e}
        .chip.group-storedDiffers{background:#fde7ee;color:#9b1c4a}
        .stored-differs{display:block;margin-top:3px;font-size:10px;color:#806545;text-align:center;white-space:normal}
        .reason.differs{border-left-color:#d6336c;background:#fff0f4}
        details.fields{display:block;padding:8px 12px;overflow:visible}
        details.fields summary{display:list-item;cursor:pointer;font-weight:600;line-height:22px}
        details.fields[open]{padding-bottom:12px;max-height:34vh;overflow:auto}
        details.evidence{margin:4px 0 8px;padding:4px 10px;border:1px solid #e5e9f0;border-radius:6px;background:#fafbfd}
        details.evidence summary{font-weight:500;color:#53635a;font-size:12px}
        details.evidence[open]{max-height:none;overflow:visible;padding-bottom:6px}
        .drawer-section{padding-top:2px}
        .section-title{font-weight:600;color:#53635a;margin:9px 0 0}
        .field-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:7px 12px;max-height:116px;overflow:auto;padding:9px 4px 2px;border-top:1px solid #e5e9f0;margin-top:5px}
        .field-grid label{display:flex;align-items:center;min-width:0;white-space:nowrap;line-height:20px}
        .field-grid input{flex:0 0 auto;margin:0 5px 0 0}
        .field-grid span{overflow:hidden;text-overflow:ellipsis}
        .workspace{position:relative;flex:1;min-height:330px;display:grid;grid-template-columns:minmax(520px,1fr);gap:10px;overflow:hidden;flex-shrink:0}
        .workspace.detail-open{grid-template-columns:minmax(280px,1fr) 6px minmax(280px,var(--detail-width,42%))}
        .pane-split{display:none;cursor:col-resize;background:transparent}
        .workspace.detail-open .pane-split{display:block}
        .pane-split::after{content:'';display:block;height:100%;margin:0 auto;width:1px;background:#ccd4df}
        .pane-split:hover::after,.pane-split.dragging::after{width:3px;background:#256b65}
        .pane{min-height:0;display:flex;flex-direction:column;overflow:hidden}
        .pane-titlebar{padding:12px 15px;border-bottom:1px solid #e3e7e0;font-weight:700;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
        .pane-titlebar>button{margin-left:0}
        .pane-titlebar button{border:1px solid #b7c0ce;border-radius:5px;background:#fff;padding:4px 9px;cursor:pointer}
        .detail-pane{display:none}
        .detail-pane.open{display:flex}
        .table-scroll{flex:1;min-height:0;overflow:auto}
        table{width:100%;min-width:520px;border-collapse:collapse;table-layout:fixed}
        th{position:sticky;top:0;z-index:1;background:#f3f5f1;padding:9px 7px;text-align:left;border-bottom:1px solid #ccd4df;color:#53635a;font-size:12px;font-weight:600}
        th.title-column{position:sticky}
        .column-resizer{position:absolute;z-index:3;right:-5px;top:0;width:10px;height:100%;cursor:col-resize;user-select:none}
        .column-resizer::after{content:'';position:absolute;left:4px;top:4px;bottom:4px;border-left:1px solid #aeb8c6}
        .column-resizer:hover::after,.column-resizer.dragging::after{border-left:2px solid #256b65}
        body.resizing-columns{cursor:col-resize;user-select:none}
        td{padding:10px 7px;border-bottom:1px solid #e4e8ee;vertical-align:top;overflow-wrap:anywhere;line-height:1.5}
        tr.result{cursor:pointer}
        tr.result:hover{background:#f2f6f3}
        tr.result.selected{background:#e8f1ed;box-shadow:inset 3px 0 #256b65}
        .col-check{width:42px}
        th.col-check{padding-left:0;padding-right:0;position:sticky}
        .head-box{display:flex;align-items:center;justify-content:center;gap:2px;white-space:nowrap}
        .head-box input{flex:0 0 auto;margin:0}
        th.col-check.sorted-up::after,th.col-check.sorted-down::after{position:absolute;right:1px;top:1px;font-size:8px;line-height:1;color:#256b65}
        th.col-check.sorted-up::after{content:'▲'}
        th.col-check.sorted-down::after{content:'▼'}
        .col-evidence{width:var(--evidence-column,112px)}
        .status-badge{display:block;border-radius:10px;background:#edf1f7;padding:2px 6px;white-space:nowrap;text-align:center}
        .evidence-identifier{background:#dff2e3;color:#14622c}
        .evidence-catalogue{background:#dfeaff;color:#12408f}
        .evidence-webPage{background:#fff0c9;color:#7a5100}
        .evidence-documentRead{background:#ffe2d1;color:#8f3f0b}
        .evidence-none{background:#e6e9ee;color:#4e5865}
        .evidence-applied{background:#e3f4e6;color:#14622c}
        .evidence-excluded{background:#e5e7eb;color:#4b5563}
        .evidence-noPDF{background:#f3f4f6;color:#6b7280}
        .evidence-unread{background:#fff2cc;color:#7a5100}
        .evidence-multiplePDFs,.evidence-missingFile{background:#f3f4f6;color:#6b7280}
        .evidence-pending{background:#f4f5f7;color:#66736c}
        .evidence-stopped{background:#fff4e5;color:#8a5200}
        .evidence-failed{background:#fdecec;color:#9a1b1b}
        .evidence-preprintKept{background:#fff2cc;color:#7a5100;border:1px solid #e0a400}
        .row-status{display:block;margin-top:3px;font-size:11px;color:#8a5200;text-align:center;white-space:normal}
        .setting-note{flex-basis:100%;color:#5a6472;font-size:12px;padding:2px 0 0;line-height:1.5}
        .kept-badge{display:inline-block;border-radius:9px;background:#e8f1ed;color:#256b65;padding:1px 6px;font-size:11px;margin-right:5px;white-space:nowrap}
        .rejected-title{color:#8b95a5;text-decoration:line-through}
        .pager{padding:7px 10px;border-top:1px solid #e3e7e0;display:flex;align-items:center;gap:7px;flex:0 0 auto}
        .pager .page-info{margin-left:auto;color:#66736c}
        .page-sizes{display:inline-flex;gap:4px;align-items:center}
        .page-sizes .chip{font-size:11px;padding:2px 7px}
        .settings{border-top:1px solid #e3e7e0;padding:8px 18px}
        .settings-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:9px 4px 2px;border-top:1px solid #e5e9f0;margin-top:5px}
        .settings-row button{border:1px solid #b7c0ce;border-radius:5px;background:#fff;padding:6px 10px;cursor:pointer}
        .settings-row button:hover{background:#edf4f2}
        .detail{flex:1;min-height:0;overflow:auto;padding:14px;user-select:text;line-height:1.6}
        .empty{color:#66736c;padding:28px;text-align:center}
        .reason{padding:6px 8px;margin-bottom:5px;border-left:3px solid #e0a400;background:#fff9e8}
        .reason.stale{border-left-color:#8da5c7;background:#f1f5fb;color:#3a4a5f}
        .advice{color:#7a5100;background:#fff9e8;border-left:3px solid #e0a400;padding:4px 7px;margin:0 0 5px;font-size:12px}
        .change{margin-top:10px;border-top:1px solid #dbe2da;padding-top:9px;border-left:3px solid transparent;padding-left:7px}
        .change.changed{border-left-color:#256b65}
        .change.added{border-left-color:#1e874b}
        .change.cleared{border-left-color:#c0392b}
        .state-chip{font-size:11px;border-radius:9px;padding:1px 7px;white-space:nowrap}
        .state-chip.changed{background:#e8f1ed;color:#256b65}
        .state-chip.added{background:#e6f4ec;color:#136b3b}
        .state-chip.cleared{background:#fdecec;color:#9a1b1b}
        .standing{font-size:11px;border-radius:9px;padding:1px 7px;border:1px solid transparent;white-space:nowrap}
        .standing.verified{background:#e6f4ec;color:#136b3b;border-color:#bde3cd}
        .standing.approved{background:#eef2ff;color:#33409e;border-color:#c9d2f5}
        .standing.proposed{background:#f4f5f7;color:#66736c;border-color:#dfe3ea}
        .standing.stale{background:#fff4e5;color:#8a5200;border-color:#f0d9b5}
        .standing.conflicting{background:#fdecec;color:#9a1b1b;border-color:#f3c9c9}
        .release{font-size:11px;padding:1px 6px;border:1px solid #dfe3ea;border-radius:9px;background:#fff;cursor:pointer}
        .change.cleared .value-edit{background:#fff6f6}
        .roster{margin-top:12px;border-top:1px solid #dbe2da;padding-top:9px}
        .roster-title{font-size:12px;color:#66736c;margin-bottom:5px}
        .roster-line{display:grid;grid-template-columns:104px 1fr;gap:8px;padding:2px 0;font-size:12px}
        .roster-field{color:#66736c;overflow:hidden;text-overflow:ellipsis}
        .roster-edit{font-size:12px;padding:2px 5px;min-height:20px}
        .change-master{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:11px;padding:6px 8px;background:#f6f8fb;border-radius:5px}
        .change-master label{display:inline-flex;align-items:center;gap:6px;font-weight:600;white-space:nowrap}
        .change-master input{margin:0}
        .change-master .muted{font-size:12px}
        .field-name{font-weight:700;margin-bottom:5px}
        .value-row{display:grid;grid-template-columns:38px 1fr;gap:5px;margin:3px 0;align-items:start}
        .value-label{color:#66736c;font-weight:600}
        :root[lang=en] .value-row{grid-template-columns:76px minmax(0,1fr);gap:8px}
        :root[lang=en] .value-label{white-space:nowrap}
        .value{white-space:pre-wrap;overflow-wrap:anywhere}
        .value.old{color:#6b7280}
        .change-head{display:flex;align-items:center;gap:7px;margin-bottom:5px;flex-wrap:wrap}
        .change-head input{margin:0}
        .value-edit{width:100%;min-width:120px;min-height:24px;max-width:100%;font:inherit;padding:3px 5px;border:1px solid #b7c0ce;border-radius:4px;resize:both;background:#fff}
        .value-edit.edited{border-color:#256b65;background:#f2f7ff}
        .value-edit.invalid{border-color:#c0392b;background:#fdecec}
        .detail a{color:#065fd4;text-decoration:underline;user-select:text}
        .copy{font-size:11px;padding:2px 6px;margin-left:7px}
        .reference-row{display:flex;gap:6px;align-items:center;margin:9px 0 4px}
        .reference-input{flex:1;min-width:0;font:inherit;padding:4px 6px;border:1px solid #b7c0ce;border-radius:4px;background:#fff}
        .reference-row .copy{margin-left:0;white-space:nowrap}
        .candidate{margin:7px 0;padding:7px;background:#f6f8fb;border-radius:5px}
        .footer{font-size:10px;color:#66736c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 3px}
        .lm-panel{display:none;margin:10px 0 0;padding:10px 12px;border:1px solid #dbe2da;border-radius:6px;background:#f8fafc}
        .lm-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
        .lm-row .lm-label{font-weight:600;white-space:nowrap}
        .lm-endpoint{flex:1;min-width:220px;padding:4px 6px;border:1px solid #b7c0ce;border-radius:4px;font:inherit}
        .lm-panel button{border:1px solid #b7c0ce;border-radius:5px;background:#fff;padding:5px 10px;cursor:pointer}
        .lm-panel button:hover{background:#edf4f2}
        .lm-panel button.primary{background:#256b65;color:#fff;border-color:#256b65}
        .lm-models{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:4px 12px;max-height:132px;overflow:auto;padding:6px;border:1px solid #e3e7e0;border-radius:5px;background:#fff}
        .lm-models label{display:flex;align-items:center;gap:6px;min-width:0;line-height:20px;white-space:nowrap}
        .lm-models label span{overflow:hidden;text-overflow:ellipsis}
        .lm-models input{flex:0 0 auto;margin:0}
        .lm-empty{color:#66736c;padding:4px}
        .lm-status{color:#66736c;flex:1;min-width:160px;line-height:1.5}
        .lm-panel.open{display:block}
        .apply-result{margin-top:9px;padding:8px 10px;border-left:3px solid #1e874b;background:#f1faf4;border-radius:4px;font-size:12px;color:#25332e}
        .apply-result.undo{border-left-color:#8da5c7;background:#f1f5fb}
        .apply-result.legacy{border-left-color:#8da5c7;background:#f6f8fb}
        .apply-result .apply-line{font-weight:600;line-height:1.6}
        .apply-result details{margin-top:3px;line-height:1.6}
        .apply-result summary{cursor:pointer;color:#53635a}
        .apply-result .apply-sub{margin:2px 0 0 12px;color:#53635a}
        .apply-result .apply-failure{margin:2px 0 0 12px;color:#9a1b1b;cursor:pointer;text-decoration:underline}
        .chip.group-lastApply{background:#e3f4e6;color:#14622c}
        .chip.group-lastSkipped{background:#fff4e5;color:#8a5200}
        .applied-block{margin-top:10px;padding:6px 9px;border:1px solid #bde3cd;border-radius:6px;background:#f6fbf8}
        .applied-block.undone{border-color:#dfe3ea;background:#f6f8fb;opacity:.75}
        .applied-title{font-weight:700;color:#14622c}
        .applied-block.undone .applied-title{color:#53635a}
        .change.typeLoss{border-left-color:#8a5200}
        .state-chip.typeLoss{background:#fff4e5;color:#8a5200}
        .applied-live{margin:6px 0 2px;font-size:12px;color:#53635a}
        .applied-live.changed{color:#9a1b1b}
        .reason.undone{border-left-color:#8da5c7;background:#f1f5fb;color:#3a4a5f}
        :root{color-scheme:light}
        button,input,textarea{font:inherit}
        button:focus-visible,input:focus-visible,textarea:focus-visible,summary:focus-visible,th:focus-visible,tr:focus-visible,a:focus-visible{outline:2px solid #256b65;outline-offset:3px}
        input[type=checkbox],input[type=radio],progress{accent-color:#256b65}
        button:disabled{cursor:default;opacity:.5}
        .header-main{min-width:0}
        .header-description{margin:3px 0 0;color:#53635a;line-height:1.5;font-size:12px}
        .version-note{font-size:11px;color:#66736c;display:none}
        .workflow{display:flex;align-items:center;gap:12px;flex:0 0 auto;color:#53635a;font-size:11px}
        .workflow-step{display:flex;align-items:center;gap:5px;font-size:11px;padding:6px 8px;border-radius:8px;color:#758279;white-space:nowrap}
        .workflow-step b{display:grid;place-items:center;border:1px solid #dbe2da;border-radius:50%;width:22px;height:22px;font-size:11px;background:transparent;border-color:#cfd8d0;color:inherit}
        .toolbar button{min-height:36px;border-radius:8px;padding:7px 13px;font-size:13px;font-weight:600}
        .toolbar button.danger:disabled{color:#66736c}
        .section-description{color:#66736c;font-size:12px;line-height:1.6;margin-top:5px}
        .method-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:10px 0}
        .method-card{min-width:0;border:1px solid #dbe2da;border-radius:9px;padding:12px;background:#f8faf7}
        .method-head{display:flex;align-items:center;gap:7px;margin-bottom:9px;color:#344054}
        .method-number{display:grid;place-items:center;border-radius:5px;background:#e8f1ed;color:#256b65;font-size:11px;width:22px;height:22px;flex:0 0 auto}
        .method-option{display:flex;align-items:flex-start;gap:7px;padding:6px 0;line-height:1.45;cursor:pointer}
        .method-option input{margin:3px 0 0;flex:0 0 auto}
        .method-copy{display:flex;flex-direction:column;gap:3px;min-width:0}
        .method-copy strong{font-size:12px;font-weight:600}
        .method-copy>span{font-size:11px;color:#66736c}
        .method-model{font-size:12px;color:#66736c;overflow-wrap:anywhere;margin:12px 0 7px}
        .method-model.configured{color:#14622c}
        .method-configure{font-size:12px;border:1px solid #b7c0ce;border-radius:5px;padding:5px 9px;background:#fff;margin-top:9px;cursor:pointer}
        .method-configure:hover{background:#edf4f2}
        .filter-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 15px 6px}
        .view-summary{font-size:12px;color:#53635a;margin-right:auto;white-space:nowrap}
        .list-search{display:flex;align-items:center;gap:7px;color:#66736c;font-size:12px}
        .list-search input{width:230px;max-width:100%;border:1px solid #b7c0ce;border-radius:6px;background:#fff;color:inherit;padding:6px 9px}
        .reset-view{border:0;background:transparent;color:#256b65;font-size:12px;padding:6px;cursor:pointer}
        .filter-overview{grid-column:1;grid-row:1 / span 4;align-self:start}
        .filter-overview .chip{width:100%;padding:5px 8px;white-space:nowrap}
        .filter-group{grid-column:2;display:flex;align-items:baseline;gap:10px;min-width:0}
        .filter-caption{width:82px;flex:0 0 auto;font-size:11px;color:#66736c}
        .filter-choices{display:flex;flex-wrap:wrap;gap:5px;min-width:0}
        .filter-choices .chip{padding:3px 8px;border-radius:5px;font-size:11px}
        .filter-choices .chip:not(.active):not([class*=tone-]){border-color:#dbe2da;background:#f2f4f0;color:#53635a}
        .filter-choices .chip:hover{box-shadow:0 0 0 1px #8da5c7}
        .dashboard.empty-dashboard{display:none}
        .pane-titlebar>button:first-of-type{margin-left:auto}
        .list-empty{padding:38px 16px;text-align:center;border-bottom:0;color:#66736c}
        .list-empty strong,.list-empty span{display:block}
        .list-empty strong{color:#344054;font-size:14px;margin-bottom:7px}
        th.sorted-up,th.sorted-down{color:#256b65}
        .advanced-settings{border-top:1px solid #e3e7e0;margin-top:10px;padding-top:7px}
        .advanced-settings>summary{cursor:pointer;font-size:12px;color:#53635a}
        .setting-note summary{cursor:pointer;font-size:11px}
        .setting-note>div{margin-top:6px}
        .list-pane .table-scroll{min-height:160px}
        @media(max-width:900px){
          .workflow{display:none}
          .method-grid{grid-template-columns:1fr}
          .method-card{padding:10px}
          .workspace.detail-open{grid-template-columns:minmax(520px,1fr)}
          .detail-pane.open{position:absolute;z-index:5;right:0;top:0;bottom:0;width:85%;min-width:320px;box-shadow:-8px 0 24px #0002}
          .pane-split{display:none!important}
          .filter-caption{width:72px}
          .status-summary{grid-template-columns:65px minmax(0,1fr);gap:7px}
          .list-search input{width:200px}
        }
        @media(max-width:640px){
          .app-shell{padding:8px;gap:8px}
          .header{padding:10px 12px}
          .header h2{font-size:18px}
          .filter-tools{gap:6px}
          .list-search{order:3;width:100%}
          .list-search input{width:100%;flex:1;min-width:0}
          .workspace,.workspace.detail-open{grid-template-columns:minmax(0,1fr)}
          .detail-pane.open{width:100%;min-width:0}
          .filter-group{display:block}
          .filter-caption{display:block;width:auto;margin-bottom:4px}
          .pager{flex-wrap:wrap}
          .page-sizes{order:3}
          .pager .page-info{font-size:11px}
          .selection-row{flex-basis:100%}
          .header-description{font-size:12px}
        }
        @media(max-height:700px){
          .app-shell{padding:8px;gap:6px}
          .header{padding:8px 12px}
          .header-main{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
          .header h2{font-size:18px;margin:0}
          .header-description{display:none}
          .version-note{font-size:10px}
          .workflow{gap:12px}
          .workflow-step b{width:20px;height:20px}
          .toolbar{padding:8px}
          .toolbar button{min-height:28px;padding:4px 8px}
          .settings{padding-top:5px;padding-bottom:5px}
          .dashboard{padding:6px 10px}
          .apply-result{margin-top:6px;padding:5px 8px}
          .filter-tools{padding:7px 10px 2px}
          .status-summary{padding:6px 10px 8px;gap:5px 8px}
          .filter-choices{gap:4px}
          .filter-choices .chip{padding:2px 7px}
          .pane-titlebar{padding:8px 10px}
          .workspace{min-height:400px}
          .footer{font-size:10px}
        }
        @media(prefers-color-scheme:dark){
          :root{color-scheme:dark}
          .app-shell{background:#191f1d;color:#e5e9f0}
          .card{background:#232b28;border-color:#46544d;box-shadow:none}
          .muted,.version-note,.selection-count,.metrics,.section-description,.method-copy>span,.filter-caption,.list-search,.lm-status,.lm-empty,.roster-title,.roster-field,.value-label,.footer{color:#abb5c5}
          .header-description,.workflow,.view-summary,.method-head,.section-title,.message,.setting-note,.advanced-settings>summary{color:#d1d8e3}
          .metric b{color:#eef2f8}
          .toolbar button,.pager button,.copy,.pane-titlebar button,.settings-row button,.lm-panel button,.method-configure,.release{background:#303b36;border-color:#566478;color:#e0e7f2}
          .toolbar button:hover,.pager button:hover,.copy:hover,.settings-row button:hover,.lm-panel button:hover,.method-configure:hover{background:#3d5148}
          .toolbar button.primary,.lm-panel button.primary,.chip.active{background:#2f7e72;color:#fff;border-color:#2f7e72}
          .toolbar button.danger,.message.error{color:#ffb0a7}
          .toolbar button.danger:disabled{color:#abb5c5}
          .setting-control,.method-card,.workflow-step b,.candidate,.change-master,.lm-panel,details.evidence{background:#1c232e;border-color:#46544d}
          .field-grid,.settings,.settings-row,.advanced-settings,.pane-titlebar,.status-summary,.pager,.change,.roster{border-color:#46544d}
          .method-number,.kept-badge{background:#293d5c;color:#b6d3ff}
          .method-model{color:#abb5c5}
          .method-model.configured{color:#a8dfb4}
          .lm-models{background:#232b28;border-color:#46544d}
          .lm-endpoint,.list-search input,.reference-input,.value-edit,.roster-edit{background:#171f2c;border-color:#566478;color:#e5e9f0}
          .value-edit.edited{background:#203550;border-color:#6ea7f3}
          .value-edit.invalid,.change.cleared .value-edit{background:#3e262c}
          .reset-view,.detail a,th.sorted-up,th.sorted-down{color:#a9cdff}
          th{background:#2b3442;border-color:#48566a}
          td{border-color:#46544d}
          tr.result:hover{background:#283750}
          tr.result.selected{background:#273e5c}
          .value.old,.rejected-title{color:#a3adbd}
          .empty,.list-empty{color:#abb5c5}
          .list-empty strong{color:#e5e9f0}
          .status-badge,.chip{background:#344052;color:#d7e0ed}
          .evidence-identifier,.evidence-applied,.standing.verified,.state-chip.added{background:#254336;color:#b4e5c2}
          .evidence-catalogue,.standing.approved,.state-chip.changed{background:#2b4165;color:#bdd5ff}
          .evidence-documentRead{background:#4a3427;color:#ffcfb0}
          .evidence-webPage,.evidence-unread,.evidence-stopped,.evidence-preprintKept,.standing.stale,.state-chip.typeLoss{background:#493e29;color:#f4d897}
          .evidence-failed,.standing.conflicting,.state-chip.cleared{background:#502e35;color:#ffb5bd}
          .evidence-noPDF,.evidence-multiplePDFs,.evidence-missingFile,.evidence-pending,.evidence-none,.evidence-excluded,.standing.proposed{background:#303844;color:#c2ccda}
          .row-status{color:#f4d897}
          .stored-differs{color:#ffb0cd}
          .reason,.advice{background:#3c3426;color:#f4ddb3}
          .reason.stale,.reason.undone,.apply-result.undo,.apply-result.legacy{background:#263549;color:#d1dcef}
          .reason.differs{background:#422b37;color:#ffc1d6}
          .apply-result,.applied-block{background:#20392d;color:#d0ecd8;border-color:#496f59}
          .apply-result .apply-sub,.apply-result summary,.applied-live,details.evidence summary{color:#c0cbda}
          .apply-result .apply-failure,.applied-live.changed{color:#ffb5bd}
          .applied-title{color:#b4e5c2}
          .applied-block.undone{background:#283241;border-color:#46544d}
          .applied-block.undone .applied-title{color:#c0cbda}
        }
        [hidden]{display:none!important}
        .workflow-step.current{background:#e8f1ed;color:#256b65;font-weight:650}
        .workflow-step.current b{background:#256b65;color:#fff;border-color:#256b65}
        .app-shell{gap:6px;padding:10px;overflow:hidden}
        .header{position:relative;display:grid;grid-template-columns:minmax(135px,1fr) auto auto;gap:3px 12px;padding:0 2px;align-items:center}
        .header-main{grid-column:1;grid-row:1;min-width:0}
        .header h2{font-size:17px;white-space:nowrap}
        .header-description,.header-main .version-note{display:none}
        .actions{display:contents}
        .header .toolbar{grid-column:2;grid-row:1;padding:0;gap:6px;flex-wrap:nowrap}
        .toolbar button{min-height:30px;padding:5px 10px;font-size:12px;white-space:nowrap}
        .guidance{grid-column:1;grid-row:2;min-width:0;padding:0;font-size:11px;color:#66736c}
        .guidance>summary{cursor:pointer;line-height:20px;white-space:nowrap;width:fit-content}
        .guidance[open]>.guidance-copy{position:absolute;z-index:40;top:100%;left:0;width:min(560px,calc(100vw - 24px));max-height:calc(100vh - 80px);overflow:auto;background:#fff;border:1px solid #dbe2da;border-radius:8px;padding:12px;box-shadow:0 6px 24px #25332e20}
        .guidance[open]>summary{font-weight:600}
        .guidance .workflow{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px}
        .guidance-step{font-size:11px;font-weight:650;color:#256b65}
        .guidance-heading{font-size:16px;line-height:1.4;margin:6px 0 4px;font-weight:650}
        .guidance-body{font-size:13px;line-height:1.65;margin:0;color:#53635a;max-width:920px}
        .toolbar button.primary:hover{background:#1e5954}
        .action-note{font-size:12px;color:#53635a;margin:6px 0;line-height:1.6}
        .policy-note{font-size:11px;color:#5c665d;background:#f5f6f1;border-left:3px solid #a1b6a8;border-radius:5px;line-height:1.6;margin:8px 0 0;padding:7px 9px}
        .action-blockers{grid-column:1 / -1;margin:0;font-size:11px;line-height:1.5}
        .action-blockers summary{cursor:pointer;color:#805f34}
        .action-blockers>div{white-space:pre-wrap;background:#faf6ed;color:#654f32;border-radius:6px;padding:9px;margin-top:6px}
        .header .settings{grid-column:3;grid-row:1;padding:0;border:0}
        .settings>summary{font-size:12px;font-weight:500;color:#66736c;line-height:30px;white-space:nowrap;cursor:pointer}
        .header .settings[open]{position:absolute;z-index:40;top:0;right:0;width:min(1000px,calc(100vw - 24px));max-height:calc(100vh - 24px);padding:10px 14px;background:#fff;border:1px solid #dbe2da;border-radius:8px;box-shadow:0 6px 24px #25332e20;overflow:auto}
        .header .settings[open]>summary{font-weight:600;text-align:right}
        .header .control-row{grid-column:2 / 4;grid-row:2;padding:0;min-height:0;min-width:0}
        .header .message{font-size:11px;line-height:20px;margin:0;min-height:0;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .header .message.error{white-space:normal;text-align:left}
        .header .dashboard{grid-column:1 / -1;border:0;border-top:1px solid #dbe2da;border-radius:0;background:transparent;box-shadow:none;padding:4px 0 0;display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:2px 12px;align-items:center}
        .dashboard .progress-head{grid-column:1;grid-row:1;min-width:0;margin:0;font-size:11px}
        .progress-head strong{flex:0 0 auto}
        .progress-head span{min-width:0;max-width:45%}
        .dashboard .progress{grid-column:1 / -1;grid-row:2;width:100%;height:4px}
        .dashboard.idle{display:flex;justify-content:flex-end;gap:12px;padding:2px 0 0}
        .progress-details,.result-details{position:relative;margin:0;font-size:11px;line-height:1.5;min-width:0}
        .progress-details{grid-column:2;grid-row:1}
        .result-details{grid-column:3;grid-row:1}
        .progress-details[open],.result-details[open]{position:absolute;z-index:35;top:100%;right:0;width:min(650px,calc(100vw - 24px));max-height:50vh;overflow:auto;background:#fff;border:1px solid #dbe2da;border-radius:8px;padding:10px 12px;box-shadow:0 6px 24px #25332e20}
        .progress-details>summary,.result-details>summary{cursor:pointer;color:#53635a}
        .progress-details .metrics{margin:7px 0}
        .selection-tools{position:relative;font-size:11px;font-weight:400}
        .selection-tools summary{cursor:pointer;color:#66736c;font-size:11px;padding:4px 0;white-space:nowrap}
        .selected-actions{position:absolute;z-index:20;top:100%;right:0;width:max-content;max-width:min(500px,80vw);display:flex;gap:6px;flex-wrap:wrap;margin:0;padding:10px;background:#fff;border:1px solid #dbe2da;border-radius:8px;box-shadow:0 6px 24px #25332e20}
        .selected-actions button{background:#fff;border:1px solid #cdd7cf;border-radius:6px;padding:6px 9px;font-size:12px;cursor:pointer}
        .list-pane{position:relative}
        .list-help{font-size:11px;line-height:1.5;margin:0;padding:0;color:#66736c;font-weight:400}
        .list-help summary{cursor:pointer}
        .list-help[open]{position:absolute;z-index:20;top:34px;right:8px;width:min(460px,90%);padding:10px;background:#fff;border:1px solid #dbe2da;border-radius:8px;box-shadow:0 6px 24px #25332e20}
        .list-help p{margin:5px 0 2px;max-width:900px}
        .dashboard.idle .result-details{margin-top:0}
        .workspace{flex:1 1 0;min-height:0;flex-shrink:1;grid-template-columns:minmax(0,1fr);gap:8px}
        .list-pane .table-scroll{min-height:0}
        .pane-titlebar{padding:5px 10px;min-height:34px;gap:8px;font-size:12px;flex:0 0 auto}
        .selection-row{font-size:11px;min-width:0}
        .view-summary{order:2;font-size:10px;margin:0 0 0 auto}
        .pane-titlebar>button:first-of-type{margin-left:auto}
        .pane-titlebar>button,.selection-tools,.list-help{order:3}
        .workspace.detail-open .view-summary{display:none}
        .filter-tools{position:relative;padding:4px 10px;gap:6px;flex-wrap:wrap;flex:0 0 auto;border-bottom:1px solid #e3e7e0}
        .basic-filters{order:0;display:flex;align-items:center;gap:4px;flex-wrap:nowrap;padding:0}
        .basic-filter{font:inherit;font-size:11px;cursor:pointer;padding:3px 6px;border:1px solid #dbe2da;border-radius:5px;background:#fff;color:#53635a;white-space:nowrap}
        .list-search{order:1;margin-left:auto;min-width:0}
        .list-search>span{display:none}
        .list-search input{width:140px;padding:4px 7px;font-size:11px}
        .reset-view{order:2;padding:2px 4px;font-size:16px;line-height:22px}
        .classification-details{order:3;padding:0;border:0;font-size:11px;white-space:nowrap}
        .classification-details>summary{cursor:pointer;line-height:24px}
        .classification-details[open]{position:absolute;z-index:20;top:0;right:8px;width:min(650px,calc(100% - 16px));max-height:45vh;padding:10px;background:#fff;border:1px solid #dbe2da;border-radius:8px;box-shadow:0 6px 24px #25332e20;overflow:auto;white-space:normal}
        .classification-details[open]>summary{text-align:right}
        th{padding:5px 7px;font-size:11px}
        .pager{padding:4px 8px;gap:4px;flex:0 0 auto;min-height:30px}
        .pager button{padding:3px 7px;font-size:11px}
        .basic-filter.active{background:#e8f1ed;border-color:#a7c3b5;color:#205f54;font-weight:650}
        .basic-filter:hover{border-color:#87a995}
        .classification-details .status-summary{padding:8px 0 0;border-bottom:0;grid-template-columns:minmax(0,1fr)}
        .classification-details .filter-overview{display:none}
        .classification-details .filter-group{grid-column:1}
        .list-pane .status-badge{background:#edf2ed;color:#53635a;border-radius:5px;font-size:11px;line-height:1.55}
        .detail-item-heading{font-size:15px;font-weight:650;line-height:1.5;margin:0 0 10px}
        .tone-legend{display:flex;flex-wrap:wrap;gap:5px;font-size:10px;white-space:normal;margin:7px 0 8px}
        .tone-legend span{border-radius:4px;padding:3px 6px}
        .classification-details .chip.tone-success,.list-pane .status-badge.tone-success,.tone-legend .tone-success{--tone-bg:#e2f0e5;--tone-fg:#235d35;--tone-border:#40864f;background:var(--tone-bg);color:var(--tone-fg)}
        .classification-details .chip.tone-attention,.list-pane .status-badge.tone-attention,.tone-legend .tone-attention{--tone-bg:#ffeadb;--tone-fg:#934b16;--tone-border:#b9692c;background:var(--tone-bg);color:var(--tone-fg)}
        .classification-details .chip.tone-warning,.list-pane .status-badge.tone-warning,.tone-legend .tone-warning{--tone-bg:#fff6cc;--tone-fg:#786012;--tone-border:#a68b2b;background:var(--tone-bg);color:var(--tone-fg)}
        .classification-details .chip.tone-danger,.list-pane .status-badge.tone-danger,.tone-legend .tone-danger{--tone-bg:#fae4e1;--tone-fg:#973b32;--tone-border:#b84e42;background:var(--tone-bg);color:var(--tone-fg)}
        .classification-details .chip.tone-muted,.list-pane .status-badge.tone-muted,.tone-legend .tone-muted{--tone-bg:#e9ece9;--tone-fg:#59655d;--tone-border:#748077;background:var(--tone-bg);color:var(--tone-fg)}
        .classification-details .chip.tone-info,.tone-legend .tone-info{--tone-bg:#e5effb;--tone-fg:#315e98;--tone-border:#4e78af;background:var(--tone-bg);color:var(--tone-fg)}
        .classification-details .chip[class*=tone-]{background:var(--tone-bg);color:var(--tone-fg);border-color:transparent}
        .classification-details .chip.active[class*=tone-]{font-weight:700;border-color:var(--tone-border);outline:2px solid var(--tone-border);outline-offset:1px}
        @media(max-height:700px){
          .app-shell{padding:8px;gap:5px}
        }
        @media(max-width:1100px){
          .workspace.detail-open{grid-template-columns:minmax(0,1fr)}
          .workspace.detail-open .pane-split{display:none}
          .detail-pane.open{position:absolute;z-index:10;right:0;top:0;bottom:0;width:60%;min-width:360px;box-shadow:-8px 0 24px #25332e20}
        }
        @media(max-width:760px){
          .header{grid-template-columns:1fr auto}
          .header .toolbar{grid-column:1 / -1;grid-row:2;flex-wrap:wrap}
          .header .settings{grid-column:2;grid-row:1}
          .guidance{grid-row:3}
          .header .control-row{grid-column:1 / -1;grid-row:4}
          .header .message{text-align:left}
          .detail-pane.open{width:90%;min-width:0}
        }
        @media(prefers-color-scheme:dark){
          .header{background:transparent}
          .workflow-step{color:#aebdb4}
          .workflow-step.current{background:#2b4b3e;color:#c4e8d4}
          .workflow-step.current b{background:#2f7e72}
          .guidance-step{color:#9dccb6}
          .guidance,.guidance-body,.action-note,.progress-details>summary,.result-details>summary,.selection-row,.selection-tools summary,.list-help,.settings>summary{color:#bfcdc3}
          .policy-note{background:#2c352c;border-color:#6d8879;color:#d0dbcb}
          .action-blockers summary{color:#e0c997}
          .action-blockers>div{background:#393325;color:#e6d1aa}
          .basic-filter,.selected-actions button{background:#2f3a34;border-color:#52665a;color:#d0dfd5}
          .basic-filter.active{background:#2a4a3e;border-color:#668a75;color:#c1e8d0}
          .classification-details{color:#b6c9bc;border-color:#46544d}
          .filter-choices .chip:not(.active):not([class*=tone-]){background:#2e3c33;border-color:#52665a;color:#ccdbd0}
          .list-pane .status-badge{background:#34433a;color:#cbdacf}
          .stored-differs{color:#dfc699}
          th{background:#2c3830;color:#ccdbd0}
          .method-card{background:#26342c}
          .guidance[open]>.guidance-copy,.header .settings[open],.progress-details[open],.result-details[open],.selected-actions,.list-help[open],.classification-details[open]{background:#232b28;border-color:#46544d}
          .classification-details .chip.tone-success,.list-pane .status-badge.tone-success,.tone-legend .tone-success{--tone-bg:#284832;--tone-fg:#c0e5cb;--tone-border:#84b394}
          .classification-details .chip.tone-attention,.list-pane .status-badge.tone-attention,.tone-legend .tone-attention{--tone-bg:#593a23;--tone-fg:#ffd2a9;--tone-border:#daa06f}
          .classification-details .chip.tone-warning,.list-pane .status-badge.tone-warning,.tone-legend .tone-warning{--tone-bg:#4e4322;--tone-fg:#f4dfa2;--tone-border:#c4ae68}
          .classification-details .chip.tone-danger,.list-pane .status-badge.tone-danger,.tone-legend .tone-danger{--tone-bg:#542e2b;--tone-fg:#ffc2b9;--tone-border:#d69286}
          .classification-details .chip.tone-muted,.list-pane .status-badge.tone-muted,.tone-legend .tone-muted{--tone-bg:#354039;--tone-fg:#cad4cd;--tone-border:#92a197}
          .classification-details .chip.tone-info,.tone-legend .tone-info{--tone-bg:#2d4058;--tone-fg:#c4ddfc;--tone-border:#91b7e6}
          .header .dashboard,.filter-tools{border-color:#46544d}
        }
      `;
            doc.documentElement.appendChild(style);
            const el = (tag: string, text = '', parent = root) => { const node = doc.createElementNS('http://www.w3.org/1999/xhtml', tag); node.textContent = text; parent.appendChild(node); return node; };
            const header = el('section');
            header.className = 'card header';
            const headerMain = el('div', '', header);
            headerMain.className = 'header-main';
            el('h2', uiText('PDF 정보 정리'), headerMain);
            el('p', uiText('제목·저자·발행 정보를 PDF와 비교해 정리하세요.'), headerMain).className = 'header-description';
            const version = el('div', uiTemplate `버전 ${ADDON_VERSION}`, headerMain);
            version.className = 'version-note';
            version.title = uiTemplate `버전 ${ADDON_VERSION} · 인식 파이프라인 ${RECOGNITION_PIPELINE_VERSION}`;
            const workflow = el('div', '', header);
            workflow.className = 'workflow';
            workflow.setAttribute('aria-label', uiText('정보 정리 순서'));
            const workflowSteps: any[] = [];
            for (const [index, label] of ['정보 찾기', '변경 내용 확인', '선택한 정보 적용'].entries()) {
                const step = el('span', '', workflow);
                step.className = 'workflow-step';
                el('b', String(index + 1), step);
                el('span', uiText(label), step);
                workflowSteps.push(step);
            }
            header.title = uiText('기본 검색은 PDF가 신규·변경된 항목만 처리하고, 동일 PDF는 저장된 인식 결과로 즉시 재검증합니다. 검색은 항목을 고치지 않습니다 — 항목에 쓰는 것은 「선택한 정보 적용」뿐입니다.');
            session.methods = loadMethods();
            const actions = el('div', '', header);
            actions.className = 'actions';
            const guidance = el('details', '', actions);
            guidance.className = 'guidance';
            const guidanceSummary = el('summary', uiText('사용 안내 · 교체 기준'), guidance);
            const guidanceCopy = el('div', '', guidance);
            guidanceCopy.className = 'guidance-copy';
            guidanceCopy.appendChild(workflow);
            const guidanceStep = el('span', '', guidanceCopy);
            guidanceStep.className = 'guidance-step';
            const guidanceHeading = el('h3', '', guidanceCopy);
            guidanceHeading.className = 'guidance-heading';
            const guidanceBody = el('p', '', guidanceCopy);
            guidanceBody.className = 'guidance-body';
            guidanceCopy.appendChild(version);
            const toolbar = el('div', '', actions);
            toolbar.className = 'toolbar';
            toolbar.setAttribute('aria-label', uiText('배치 작업'));
            const actionNote = el('p', '', guidanceCopy);
            actionNote.className = 'action-note';
            const actionBlockers = el('details', '', actions);
            actionBlockers.className = 'action-blockers';
            el('summary', uiText('선택했지만 적용할 변경이 없는 이유 보기'), actionBlockers);
            const actionBlockerBody = el('div', '', actionBlockers);
            const policyNote = el('p', '', guidanceCopy);
            policyNote.className = 'policy-note';
            const selectionTools = el('details', '', actions);
            selectionTools.className = 'selection-tools';
            el('summary', uiText('선택 항목 도구'), selectionTools);
            const selectedActions = el('div', '', selectionTools);
            selectedActions.className = 'selected-actions';
            const buttons: any[] = [];
            const scopeFor = (row: Row) => {
                const typeChange = row.changes.find(change => change.field === 'itemType');
                const itemType = typeChange ? String(chosenValue(row, typeChange).newValue)
                    : String(row.before?.itemType || row.recognized?.itemType || '');
                return approvalScopeFor(row, itemType, RECOGNITION_PIPELINE_VERSION);
            };
            const willWrite = (row: Row) => applySkipCode(row, enabledFields) === null;
            let errorText = '';
            const paintMessage = () => { message.title = message.textContent; message.classList.toggle('error', !!errorText && message.textContent === errorText); };
            let action = '';
            const execute = (fn: () => Promise<void>, name = ''): Promise<void> => {
                if (shuttingDown)
                    return Promise.resolve();
                action = name;
                const operation = (async () => {
                    try {
                        await fn();
                    }
                    catch (e) {
                        message.textContent = errorText = uiText(String(e));
                    }
                    finally {
                        action = '';
                        render();
                    }
                })();
                pendingOperations.add(operation);
                void operation.then(() => pendingOperations.delete(operation), () => pendingOperations.delete(operation));
                return operation;
            };
            const saveRow = (row: Row) => {
                if (shuttingDown)
                    return;
                const saving = session.save(row);
                pendingOperations.add(saving);
                void saving.then(() => pendingOperations.delete(saving), cause => {
                    pendingOperations.delete(saving);
                    Zotero.logError(cause);
                    message.textContent = errorText = uiTemplate `작업 저장 실패 — ${uiText(String(cause))}`;
                    render();
                });
            };
            const RESUME: Record<string, string> = {
                검색: uiText('남은 항목은 「PDF 정보 찾기」로 이어서 처리합니다.'),
                '선택 재검색': uiText('체크는 그대로 남으니 「선택 항목 다시 찾기」를 다시 누르면 체크한 행을 다시 읽습니다(「PDF 정보 찾기」는 재검색 표시를 지웁니다).'),
                적용: uiText('쓰지 못한 행은 체크가 남아 있어 「선택한 정보 적용」을 다시 누르면 이어서 씁니다.'),
                되돌리기: uiText('남은 행은 「적용 되돌리기」를 다시 누르면 이어서 되돌립니다.')
            };
            const LOADING = 'Load latest';
            const OPERATION_NAME: Record<string, string> = { Preview: uiText('정보 찾기'), 'Metadata 적용': uiText('정보 적용'), 복원: uiText('적용 되돌리기'), [LOADING]: uiText('지난 작업 불러오기') };
            const operationName = (label: string) => OPERATION_NAME[label] || label;
            const settingsPanel = el('details', '', actions);
            settingsPanel.className = 'fields settings';
            const settingsSummary = el('summary', uiText('찾기 방법 및 설정'), settingsPanel);
            const methodPanel = el('div', '', settingsPanel);
            methodPanel.className = 'drawer-section';
            const lmPanel = el('div', '', settingsPanel);
            lmPanel.className = 'lm-panel';
            const advancedSettings = el('details', '', settingsPanel);
            advancedSettings.className = 'advanced-settings';
            el('summary', uiText('적용할 필드 · 덮어쓰기 · 작업 도구'), advancedSettings);
            const fields = el('div', '', advancedSettings);
            fields.className = 'drawer-section';
            const settingsRow = el('div', '', advancedSettings);
            settingsRow.className = 'settings-row';
            const button = (label: string, fn: () => void, className = '', disableBusy = true, parent: any = toolbar, hint = '') => {
                const node = el('button', label, parent);
                node.onclick = fn;
                node.className = className;
                if (hint)
                    node.title = uiText(hint);
                if (disableBusy)
                    buttons.push(node);
                return node;
            };
            const startButton = button(uiText('PDF 정보 찾기'), () => void execute(async () => { if (!initialized) {
                await session.initialize();
                initialized = true;
            } if (shuttingDown)
                return; await session.preview(true); }, '검색'), 'primary', true, toolbar, 'PDF가 새로 추가되었거나 바뀐 항목만 처리하고, 이미 검색한 항목은 저장된 결과로 즉시 재검증합니다. 중단된 작업은 이어서 진행합니다. 「재검색」 표시는 이때 지워집니다.');
            const stopButton = button(uiText('작업 멈추기'), () => {
                session.cancel = true;
                message.textContent = session.busy && session.metrics.operation === LOADING ? uiText('최근 작업 불러오기를 멈추는 중…')
                    : uiTemplate `LM Studio 판독·검색은 즉시 중단하고, 적용 중인 항목은 안전하게 마친 뒤 멈춥니다.${session.busy && RESUME[action] ? ` ${RESUME[action]}` : ''}`;
                render();
            }, 'danger', false);
            button(uiText('선택 항목 다시 찾기'), () => void execute(async () => {
                if (!initialized) {
                    await session.initialize();
                    initialized = true;
                }
                if (shuttingDown)
                    return;
                const rows = session.rows.filter(row => row.checked);
                if (!rows.length) {
                    message.textContent = uiText('재검색할 항목을 체크박스로 선택하세요.');
                    return;
                }
                const applied = rows.filter(row => isAppliedStatus(row.status)).length;
                if (applied && !Services.prompt.confirm(win, uiText('적용된 행 다시 읽기'), uiTemplate `체크한 ${rows.length}개 중 적용된 ${applied}개가 있습니다. 다시 읽으면 이 행들의 되돌리기 백업이 지금 항목으로 바뀌어, 그 적용은 더 이상 되돌릴 수 없습니다. 계속할까요?`))
                    return;
                message.textContent = uiTemplate `${rows.length}개 항목을 저장된 인식 결과 없이 다시 검색합니다. 다시 읽은 행은 체크가 남고 「재검색」으로 모입니다.`;
                await session.preview(false, rows);
            }, '선택 재검색'), '', true, selectedActions, '체크한 항목만 저장된 인식 결과를 쓰지 않고 처음부터 다시 검색합니다 — 파일과 비전 모델이 그대로면 LM Studio의 쪽 판독은 저장된 것을 다시 씁니다. 다시 읽은 행은 체크가 그대로 남고, 상단의 「재검색」 칩으로 모아 볼 수 있습니다.');
            button(uiText('찾기에서 제외'), () => void execute(async () => {
                const selected = session.rows.filter(row => row.checked && row.status !== 'excluded');
                if (!selected.length) {
                    message.textContent = uiText('제외할 항목을 체크박스로 선택하세요.');
                    return;
                }
                const unread = selected.filter(row => !row.pdfFingerprint).length;
                const applied = selected.filter(row => isAppliedStatus(row.status)).length;
                if (!Services.prompt.confirm(win, uiText('PDF 스캔 제외'), uiTemplate `${selected.length}개 항목을 이후 검색·검토에서 제외합니다. 현재 서지정보는 그대로 둡니다.`
                    + (unread ? uiTemplate `\nPDF를 읽지 못한 ${unread}개는 파일이 바뀌어도 자동으로 돌아오지 않습니다.` : uiText('\nPDF 파일이 변경되면 자동으로 다시 검색합니다.'))
                    + (applied ? uiTemplate `\n그중 적용된 ${applied}개는 제외하면 「적용한 항목」에서 빠지고, 그 적용은 「적용 되돌리기」로 되돌릴 수 없게 됩니다(되돌리기는 적용된 행만 받습니다).` : '')))
                    return;
                const count = await session.excludeSelected();
                message.textContent = uiTemplate `${count}개를 스캔 제외로 저장했습니다.`;
            }), '', true, selectedActions, '체크한 항목을 이후 검색·검토에서 제외합니다. 서지정보는 그대로 둡니다.');
            button(uiText('제외한 항목 다시 포함'), () => void execute(async () => {
                const selected = session.rows.filter(row => row.checked && row.status === 'excluded');
                if (!selected.length) {
                    message.textContent = uiText('제외를 해제할 항목을 체크박스로 선택하세요 (스캔 제외 상태인 행만).');
                    return;
                }
                const count = await session.includeSelected();
                message.textContent = uiTemplate `${count}개의 스캔 제외를 해제했습니다. 「PDF 정보 찾기」를 누르면 다시 검색합니다.`;
            }), '', true, selectedActions, '체크한 스캔 제외 항목을 다시 검색·검토 대상으로 돌립니다.');
            const applyButton = button(uiText('선택한 정보 적용'), () => void execute(async () => {
                const ticked = session.rows.filter(row => row.checked);
                const codes = new Map(ticked.map(row => [row, applySkipCode(row, enabledFields)] as const));
                const rows = ticked.filter(row => codes.get(row) === null);
                const skippedCodes = ticked.map(row => codes.get(row)).filter((code): code is SkipCode => !!code);
                const offFields = [...new Set(ticked.filter(row => codes.get(row) === 'fieldsOff')
                        .flatMap(row => row.changes.map(change => change.field).filter(field => !enabledFields.has(field) && row.fieldChoice?.[field] === undefined)))]
                    .map(field => fieldLabels[field] || field);
                if (!rows.length) {
                    message.textContent = friendlyActionCopy(applyBlockMessage(ticked.length, skippedCodes, { ...lastApplyContext(), offFields }));
                    return;
                }
                const emptied = (value: unknown) => value === '' || value === null || value === undefined || (Array.isArray(value) && !value.length);
                const planned = new Map(rows.map(row => [row, eligibleChanges(row, enabledFields)]));
                const against = rows.filter(row => planned.get(row)!.some(change => row.advice?.[change.field] && !emptied(change.newValue))).length;
                const written = new Map<string, number>(), cleared = new Map<string, number>();
                for (const changes of planned.values())
                    for (const change of changes) {
                        const tally = emptied(change.newValue) ? cleared : written;
                        tally.set(change.field, (tally.get(change.field) || 0) + 1);
                    }
                const named = (tally: Map<string, number>) => [...tally].sort((a, b) => b[1] - a[1]).map(([field, count]) => `${fieldLabels[field] || field} ${count}`).join(' · ');
                const already = skippedCodes.filter(code => code === 'alreadyApplied').length;
                const kept = skippedCodes.filter(code => code !== 'alreadyApplied');
                const untouched = (already ? uiTemplate `\n이미 적용된 ${already}개는 건너뛰고 체크를 풉니다.` : '')
                    + (kept.length ? uiTemplate `\n체크했지만 쓸 것이 없는 ${kept.length}개는 건드리지 않고 체크를 둡니다 — ${uiText(skipBreakdown(kept, offFields))}.` : '');
                if (!Services.prompt.confirm(win, uiText('일괄 적용 확인'), uiTemplate `${rows.length}개 항목에 적용합니다.`
                    + (written.size ? uiTemplate `\n쓸 필드: ${named(written)}` : '')
                    + (cleared.size ? uiTemplate `\n기존 값을 비우는 필드: ${named(cleared)}` : '')
                    + (against ? uiTemplate `\n권장하지 않는 값을 직접 체크한 항목 ${against}개가 포함됩니다.` : '')
                    + untouched))
                    return;
                await session.apply(new Set(enabledFields));
                message.textContent = uiTemplate `적용을 마쳤습니다${session.lastApply?.stopped ? uiText(' — 중지로 멈춤') : ''}. 「최근 적용 결과」를 펼쳐 내역을 확인하세요. 쓴 항목은 상세 분류의 「이번 적용」으로 모입니다.`;
            }, '적용'), 'primary');
            const undoButton = button(uiText('적용 되돌리기'), () => void execute(async () => {
                const applied = session.rows.filter(row => row.status === 'updated');
                if (!applied.length) {
                    message.textContent = uiText('이 작업에는 되돌릴 적용 항목이 없습니다.');
                    return;
                }
                const ticked = applied.filter(row => row.checked);
                const scope = ticked.length ? uiTemplate `체크한 적용 항목 ${ticked.length}개` : uiTemplate `체크한 적용 항목이 없어, 이 작업에서 적용한 ${applied.length}개 모두`;
                const narrower = !ticked.length && lastWrittenIDs.size && lastWrittenIDs.size < applied.length
                    ? uiTemplate `\n마지막 적용(${lastWrittenIDs.size}개)만 되돌리려면 취소하고 상세 분류의 「이번 적용」을 고른 뒤 「선택」 머리 네모로 체크하세요.` : '';
                if (!Services.prompt.confirm(win, uiText('복원 확인'), uiTemplate `${scope}를 적용 전 값으로 되돌립니다. 적용 뒤 Zotero에서 편집된 항목은 건너뛰고 그대로 둡니다.${narrower}`))
                    return;
                await session.undo(ticked.length ? ticked : applied);
                message.textContent = uiTemplate `되돌리기를 마쳤습니다${session.lastRun?.stopped ? uiText(' — 중지로 멈춤') : ''}. 「최근 되돌리기 결과」를 펼쳐 내역을 확인하세요.`;
            }, '되돌리기'), '', true, toolbar, '체크한 적용 항목을, 체크한 것이 없으면 이 작업에서 적용한 항목 모두를 적용 전 값으로 되돌립니다.');
            const overwriteRow = el('label', '', settingsRow);
            overwriteRow.className = 'setting-control';
            const overwriteBox = el('input', '', overwriteRow);
            overwriteBox.type = 'checkbox';
            overwriteBox.checked = true;
            overwriteBox.onchange = () => { session.overwriteFromDocument = overwriteBox.checked; };
            el('span', uiText('문서 값으로 덮어쓰기'), overwriteRow);
            const overwriteNote = el('details', '', settingsRow);
            overwriteNote.className = 'setting-note';
            el('summary', uiText('덮어쓰기 동작과 주의사항'), overwriteNote);
            el('div', uiText('「문서 값으로 덮어쓰기」: 새로 인식한 서지정보로 레코드를 교체하고 결과에 없는 이전 필드와 저자를 비웁니다. 적용 전에 상세 비교에서 삭제 항목도 확인할 수 있습니다. 필드마다 체크를 바꿔 되돌릴 수 있습니다. 바꾼 설정은 그 뒤에 읽는 행에만 적용되고(이미 읽은 행은 읽을 때의 설정을 따릅니다), 창을 열 때마다 켜진 상태로 돌아갑니다.'), overwriteNote);
            button(uiText('LM Studio 설정'), () => { const open = lmPanel.classList.toggle('open'); if (open && !lmCatalog.length)
                void loadLMCatalog(); }, '', false, settingsRow, '쪽 이미지를 읽을 비전 OCR 모델(VLM)을 고릅니다.');
            const reportButton = button(uiText('나중에 볼 항목 저장'), () => void execute(async () => {
                const { path, rows } = await session.exportReport();
                message.textContent = uiTemplate `확인 필요 ${rows}개를 근거와 함께 저장했습니다 — ${path}`;
            }), '', false, settingsRow, '「표시」에 체크한 항목과 실제로 읽은 내용·찾은 정보·근거를 파일 하나로 저장합니다.');
            button(uiText('캐시 비우고 전체 재검색'), () => void execute(async () => {
                if (!initialized) {
                    await session.initialize();
                    initialized = true;
                }
                if (shuttingDown)
                    return;
                const applied = session.rows.filter(row => ['updated', 'applying'].includes(row.status)).length;
                const suffix = applied ? uiTemplate `\n이미 적용된 ${applied}개는 되돌리기 백업을 지키려고 다시 검색하지 않습니다.` : '';
                if (!Services.prompt.confirm(win, uiText('PDF 인식 캐시 초기화'), uiTemplate `현재 목록의 PDF 인식 캐시를 삭제하고 처음부터 다시 검색합니다.${suffix}`))
                    return;
                const removed = await session.clearCacheAndReset();
                if (shuttingDown)
                    return;
                message.textContent = uiTemplate `캐시 ${removed}개 삭제 — 전체 재검색을 시작합니다.`;
                await session.preview(false);
            }, '검색'), '', true, settingsRow, '저장된 인식 결과를 지우고 목록 전체를 처음부터 다시 검색합니다. 오래 걸립니다. LM Studio의 쪽 판독 캐시는 지우지 않으므로, 파일과 비전 모델이 그대로면 쪽 판독은 다시 쓰입니다.');
            button(uiText('지난 작업 이어보기'), () => void execute(async () => {
                const loading = session, kept = { busy: loading.busy, metrics: loading.metrics };
                loading.busy = true;
                loading.metrics = { operation: LOADING, startedAt: Date.now(), endedAt: 0, total: 0, completed: 0, currentTitle: '', lastItemMs: 0 };
                message.textContent = uiText('최근 작업을 불러오는 중…');
                render();
                let loaded: BatchSession;
                try {
                    loaded = await BatchSession.loadLatest((done, total, title) => {
                        Object.assign(loading.metrics, { total, completed: done, currentTitle: title || '' });
                        message.textContent = uiTemplate `최근 작업을 불러오는 중… ${done}/${total}행 다시 판정`;
                        scheduleRender();
                    }, () => loading.cancel);
                }
                catch (cause) {
                    const stopped = loading.cancel;
                    loading.busy = kept.busy;
                    loading.metrics = kept.metrics;
                    loading.cancel = false;
                    if (stopped) {
                        message.textContent = uiText('최근 작업 불러오기를 멈췄습니다 — 지금 목록은 그대로입니다.');
                        return;
                    }
                    throw cause;
                }
                loading.busy = kept.busy;
                if (shuttingDown) {
                    loaded.cancel = true;
                    return;
                }
                loaded.metrics = { ...loading.metrics, total: loaded.rows.length, completed: loaded.rows.length, currentTitle: '', endedAt: Date.now() };
                session = loaded;
                initialized = true;
                session.onChange = scheduleRender;
                session.overwriteFromDocument = overwriteBox.checked;
                session.methods = loadMethods();
                page = 0;
                selectedRowID = null;
                const failures = session.reloadFailures || [];
                message.textContent = failures.length
                    ? uiTemplate `작업을 불러왔습니다. ${failures.length}개 행은 지금 규칙으로 다시 판정하지 못해 저장된 판정을 그대로 두었습니다 — ${uiText(failures[0]).slice(0, 200)}`
                    : uiTemplate `작업을 불러왔습니다 — ${session.rows.length}행.`;
            }), '', true, settingsRow, '마지막으로 저장된 작업 목록과 그 결과를 다시 불러옵니다.');
            const controls = el('div', '', actions);
            controls.className = 'control-row';
            const message = el('p', '', controls);
            message.className = 'message';
            message.setAttribute('role', 'status');
            message.setAttribute('aria-live', 'polite');
            const fieldSummary = el('div', uiText('적용할 필드 선택'), fields);
            fieldSummary.className = 'section-title';
            const fieldGrid = el('div', '', fields);
            fieldGrid.className = 'field-grid';
            el('div', uiText('정보를 찾는 방법'), methodPanel).className = 'section-title';
            el('div', uiText('아래 순서대로 정보를 찾습니다. 사용할 방법만 선택하세요.'), methodPanel).className = 'section-description';
            const methodGrid = el('div', '', methodPanel);
            methodGrid.className = 'method-grid';
            const METHOD_LABELS: Array<[
                keyof typeof session.methods,
                string
            ]> = [
                ['native', 'Zotero 기본 인식'],
                ['identifiers', '문서번호로 찾기 (DOI·ISBN 등)'],
                ['searchRestore', '웹사이트·서지 목록 검색'],
            ];
            const methodStage = (number: string, title: string) => {
                const card = el('div', '', methodGrid);
                card.className = 'method-card';
                const head = el('div', '', card);
                head.className = 'method-head';
                el('span', number, head).className = 'method-number';
                el('strong', uiText(title), head);
                return card;
            };
            const documentMethods = methodStage('1', uiText('PDF에서 정보 읽기'));
            const searchMethods = methodStage('2', uiText('온라인 자료에서 찾기'));
            const METHOD_NOTES: Record<keyof typeof session.methods, string> = {
                native: 'Zotero의 기본 인식기로 서지정보를 찾습니다.',
                identifiers: 'PDF에 인쇄된 DOI·ISBN·공보번호를 조회합니다.',
                searchRestore: '웹사이트와 도서·논문 목록을 검색합니다. 이미지 페이지를 읽은 뒤의 추가 검색에도 사용합니다.'
            };
            const methodBoxes: any[] = [];
            for (const [key, label] of METHOD_LABELS) {
                const row = el('label', '', key === 'searchRestore' ? searchMethods : documentMethods);
                row.className = 'method-option';
                const box = el('input', '', row);
                box.type = 'checkbox';
                box.checked = session.methods[key];
                methodBoxes.push(box);
                box.onchange = () => { session.methods[key] = box.checked; saveMethods(session.methods); render(); };
                const copy = el('span', '', row);
                copy.className = 'method-copy';
                el('strong', uiText(label), copy);
                el('span', uiText(METHOD_NOTES[key]), copy);
            }
            const visionMethods = methodStage('3', uiText('스캔 PDF 읽기'));
            const visionSummary = el('div', '', visionMethods);
            visionSummary.className = 'method-model';
            el('div', uiText('글자로 확인되지 않은 페이지를 이 컴퓨터의 AI 모델로 읽습니다. LM Studio 설정이 필요합니다.'), visionMethods).className = 'section-description';
            const visionConfigure = el('button', uiText('모델 설정'), visionMethods);
            visionConfigure.className = 'method-configure';
            visionConfigure.onclick = () => { lmPanel.classList.add('open'); if (!lmCatalog.length)
                void loadLMCatalog(); };
            el('div', uiText('「PDF 정보 찾기」와 「선택 항목 다시 찾기」에 적용됩니다. 이미지 판독은 모델 설정에서 「사용 안 함」으로 끌 수 있습니다.'), methodPanel).className = 'section-description';
            const lmEndpointRow = el('div', '', lmPanel);
            lmEndpointRow.className = 'lm-row';
            el('span', uiText('LM Studio 주소'), lmEndpointRow).className = 'lm-label';
            const lmEndpoint = el('input', '', lmEndpointRow);
            lmEndpoint.type = 'text';
            lmEndpoint.className = 'lm-endpoint';
            lmEndpoint.setAttribute('aria-label', uiText('LM Studio 서버 주소'));
            lmEndpoint.placeholder = 'http://127.0.0.1:1234/v1';
            const lmReload = el('button', uiText('모델 목록 불러오기'), lmEndpointRow);
            const lmStatus = el('span', '', lmEndpointRow);
            lmStatus.className = 'lm-status';
            el('div', uiText('비전 OCR 모델 — PDF 페이지 이미지를 직접 판독합니다. VLM만 선택할 수 있습니다.'), lmPanel).className = 'lm-label';
            const lmVisionModels = el('div', '', lmPanel);
            lmVisionModels.className = 'lm-models';
            const lmActions = el('div', '', lmPanel);
            lmActions.className = 'lm-row';
            let lmCatalog: LMStudioModelInfo[] = [], lmVisionModel = '', configuredVisionModel = '';
            const lmOption = (parent: any, group: string, label: string, checked: boolean, pick: () => void) => {
                const option = el('label', '', parent), radio = el('input', '', option);
                radio.type = 'radio';
                radio.name = group;
                radio.checked = checked;
                radio.onchange = pick;
                el('span', label, option);
            };
            const renderLMPanel = () => {
                lmVisionModels.replaceChildren();
                lmOption(lmVisionModels, 'pdf-metadata-refresh-lm-vision', uiText('사용 안 함'), !lmVisionModel, () => { lmVisionModel = ''; });
                if (!lmCatalog.length) {
                    if (lmVisionModel)
                        lmOption(lmVisionModels, 'pdf-metadata-refresh-lm-vision', uiTemplate `현재 설정: ${lmVisionModel}`, true, () => { });
                    el('div', uiText('모델 목록을 불러와 사용할 비전 모델을 선택하세요.'), lmVisionModels).className = 'lm-empty';
                    return;
                }
                const vision = lmCatalog.filter(model => model.type === 'vlm');
                if (lmVisionModel && !vision.some(model => model.id === lmVisionModel))
                    lmOption(lmVisionModels, 'pdf-metadata-refresh-lm-vision', uiTemplate `현재 설정: ${lmVisionModel} (목록에 없음)`, true, () => { });
                for (const model of vision) {
                    lmOption(lmVisionModels, 'pdf-metadata-refresh-lm-vision', model.id, model.id === lmVisionModel, () => { lmVisionModel = model.id; });
                }
                if (!vision.length)
                    el('div', uiText('설치된 VLM이 없습니다. Qwen-VL 계열 모델을 내려받으세요.'), lmVisionModels).className = 'lm-empty';
            };
            const loadLMCatalog = async () => {
                if (shuttingDown || win.closed)
                    return;
                lmStatus.textContent = uiText('모델 목록을 불러오는 중…');
                try {
                    lmCatalog = await listLMStudioModelCatalog(lmEndpoint.value.trim() || String(lmEndpoint.placeholder));
                    if (shuttingDown || win.closed)
                        return;
                    lmStatus.textContent = lmCatalog.length
                        ? uiTemplate `${lmCatalog.length}개 모델 · VLM ${lmCatalog.filter(model => model.type === 'vlm').length}개`
                        : uiText('LM Studio에 LLM/VLM이 없습니다. 임베딩 모델은 사용할 수 없습니다.');
                }
                catch (cause) {
                    if (shuttingDown || win.closed)
                        return;
                    lmCatalog = [];
                    lmStatus.textContent = uiTemplate `LM Studio에 연결하지 못했습니다 — ${uiText(String(cause))}`;
                }
                renderLMPanel();
            };
            lmReload.onclick = () => void loadLMCatalog();
            const lmSave = el('button', uiText('저장'), lmActions);
            lmSave.className = 'primary';
            lmSave.onclick = () => {
                try {
                    saveLMStudioSettings({ endpoint: lmEndpoint.value.trim(), visionModel: lmVisionModel });
                    configuredVisionModel = lmVisionModel;
                    lmStatus.textContent = lmVisionModel
                        ? uiTemplate `저장됨 — 비전 OCR ${lmVisionModel}`
                        : uiText('저장됨 — 비전 OCR 사용 안 함 (검색의 쪽 이미지 판독이 동작하지 않습니다)');
                    render();
                }
                catch (cause) {
                    lmStatus.textContent = uiText(String(cause));
                }
            };
            const lmClose = el('button', uiText('닫기'), lmActions);
            lmClose.onclick = () => lmPanel.classList.remove('open');
            {
                const saved = getLMStudioSettings();
                lmEndpoint.value = saved.endpoint;
                lmVisionModel = configuredVisionModel = saved.visionModel;
                lmStatus.textContent = saved.visionModel ? uiTemplate `현재 — 비전 OCR ${saved.visionModel}` : uiText('현재 — 비전 OCR 모델 없음');
            }
            renderLMPanel();
            const dashboard = el('section', '', header);
            dashboard.className = 'card dashboard';
            const progressHead = el('div', '', dashboard);
            progressHead.className = 'progress-head';
            progressHead.setAttribute('role', 'status');
            progressHead.setAttribute('aria-live', 'polite');
            const progressTitle = el('strong', uiText('대기 중'), progressHead), currentTitle = el('span', '', progressHead);
            currentTitle.className = 'muted';
            const progressBar = el('progress', '', dashboard);
            progressBar.className = 'progress';
            progressBar.max = 1;
            progressBar.value = 0;
            const progressDetails = el('details', '', dashboard);
            progressDetails.className = 'progress-details';
            el('summary', uiText('처리 시간과 진행 정보'), progressDetails);
            const metrics = el('div', '', progressDetails);
            metrics.className = 'metrics';
            const metricNodes = ['진행', '경과 시간', '처리 속도', '예상 남은 시간', '최근 항목'].map(name => { const box = el('div', '', metrics); box.className = 'metric'; el('span', uiText(name), box); return el('b', '—', box); });
            const resultDetails = el('details', '', dashboard);
            resultDetails.className = 'result-details';
            const resultSummary = el('summary', uiText('최근 적용 내역'), resultDetails);
            const applyResult = el('div', '', resultDetails);
            applyResult.className = 'apply-result';
            let applyDetailsOpen = false;
            const selectionRow = el('div', '', dashboard);
            selectionRow.className = 'selection-row';
            const selectionCount = el('span', '', selectionRow);
            selectionCount.className = 'selection-count';
            const measureWidest = (samples: string[], weight = '400') => {
                const probe = el('span', '', root) as any;
                probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${weight} 13px system-ui,sans-serif`;
                const widest = samples.reduce((wide, text) => { probe.textContent = text; return Math.max(wide, probe.getBoundingClientRect().width); }, 0);
                probe.remove();
                return Math.ceil(widest);
            };
            const evidenceColumn = Math.max(112, measureWidest(Object.keys(EVIDENCE).map(kind => evidenceLabel(kind as keyof typeof EVIDENCE))) + 12 + 14 + 1);
            root.style.setProperty('--evidence-column', `${evidenceColumn}px`);
            const fixedColumns = 42 + 42 + evidenceColumn;
            const workspace = el('section');
            workspace.className = 'workspace';
            const listPane = el('div', '', workspace);
            listPane.className = 'card pane list-pane';
            const listTitle = el('div', '', listPane);
            listTitle.className = 'pane-titlebar';
            el('span', uiText('항목 목록'), listTitle);
            listTitle.appendChild(selectionRow);
            button(uiText('제안된 정보 선택·보호 해제'), () => void execute(async () => {
                const selected = session.rows.filter(row => row.checked && isApplicable(row));
                if (!selected.length) {
                    message.textContent = uiText('변경 제안이 있는 항목을 체크박스로 선택하세요.');
                    return;
                }
                const guarded = selected.filter(row => row.protections && Object.keys(row.protections).length).length;
                if (!Services.prompt.confirm(win, uiText('제안 필드 체크'), uiTemplate `${selected.length}개 항목에서 제안 필드를 그 행의 선택으로 체크합니다${guarded ? uiTemplate ` — 그중 ${guarded}개 항목은 이전에 확인한 값의 보호도 풉니다` : ''}.`
                    + uiText('\n권장하지 않는 값과 기존 값을 비우는 제안은 체크하지 않습니다 — 그 필드는 상세 비교에서 직접 체크하세요.')
                    + uiText('\n이렇게 체크한 필드는 「찾기 방법 및 설정」에서 끈 필드여도 「선택한 정보 적용」이 기록합니다.')
                    + uiText('\n이 단계는 서지정보를 바꾸지 않습니다. 「선택한 정보 적용」을 누르면 체크한 필드가 기록됩니다.')))
                    return;
                let fields = 0, ticked = 0;
                for (const row of selected) {
                    for (const field of Object.keys(row.protections || {})) {
                        releaseProtection(row, field);
                        fields++;
                    }
                    const chosen = chosenOnRelease(row);
                    ticked += chosen.length;
                    row.fieldChoice = { ...(row.fieldChoice || {}), ...Object.fromEntries(chosen.map(change => [change.field, true])) };
                    await session.save(row);
                }
                message.textContent = uiTemplate `${selected.length}개 항목에서 제안 필드 ${ticked}개를 체크했습니다${fields ? uiTemplate ` (보호 해제 ${fields}개 필드)` : ''}. 「선택한 정보 적용」으로 기록합니다.`;
            }), '', true, selectedActions, '체크한 항목에서 제안된 필드를 그 행의 선택으로 체크하고, 이전에 확인한 값의 보호가 있으면 풉니다 — 권장하지 않는 값과 기존 값을 비우는 제안은 빼고 체크합니다(그 필드는 상세 비교에서 직접). 이렇게 체크한 필드는 「찾기 방법 및 설정」에서 끈 필드여도 기록됩니다. 기록은 「선택한 정보 적용」이 합니다.');
            let displayedRows: Row[] = [];
            const detailToggle = el('button', uiText('변경 내용 확인'), listTitle);
            detailToggle.onclick = () => {
                if (detailOpen)
                    detailOpen = false;
                else {
                    const row = session.rows.find(row => row.id === selectedRowID && isVisible(row)) || displayedRows[0];
                    selectedRowID = row?.id ?? null;
                    detailOpen = !!row;
                }
                render();
            };
            listTitle.appendChild(selectionTools);
            const listHelp = el('details', '', listTitle);
            listHelp.className = 'list-help';
            el('summary', uiText('도움말'), listHelp).title = uiText('선택과 표시가 어떻게 다른가요?');
            el('p', uiText('정보 찾기는 목록 전체를 살펴봅니다. 선택 체크는 적용·선택 항목 도구에 쓰고, 표시는 나중에 다시 볼 항목의 메모입니다. 항목을 누르면 변경 내용을 볼 수 있어요.'), listHelp);
            const filterTools = el('div', '', listPane);
            filterTools.className = 'filter-tools';
            const viewSummary = el('span', '', listTitle);
            viewSummary.className = 'view-summary';
            const searchLabel = el('label', '', filterTools);
            searchLabel.className = 'list-search';
            el('span', uiText('제목 검색'), searchLabel);
            const searchInput = el('input', '', searchLabel);
            searchInput.type = 'search';
            searchInput.placeholder = uiText('기존·인식 제목에서 찾기');
            searchInput.setAttribute('aria-label', uiText('기존 제목과 새로 찾은 제목 검색'));
            searchInput.oninput = () => { listQuery = searchInput.value; page = 0; tableScroll.scrollTop = 0; render(); };
            const resetView = el('button', '↺', filterTools);
            resetView.className = 'reset-view';
            resetView.setAttribute('aria-label', uiText('보기 초기화'));
            resetView.title = uiText('분류와 제목 검색을 초기화합니다');
            resetView.onclick = () => { filter = 'all'; listQuery = ''; searchInput.value = ''; page = 0; selectedRowID = null; render(); };
            const basicFilters = el('div', '', filterTools);
            basicFilters.className = 'basic-filters';
            basicFilters.setAttribute('aria-label', uiText('결과 모아 보기'));
            const classificationDetails = el('details', '', filterTools);
            classificationDetails.className = 'classification-details';
            const classificationSummary = el('summary', uiText('상세 분류'), classificationDetails);
            classificationSummary.title = uiText('찾은 경로와 작업 기록으로 모아 보기');
            const toneLegend = el('div', '', classificationDetails);
            toneLegend.className = 'tone-legend';
            toneLegend.title = uiText('색은 검토 우선순위를 나타냅니다. 정확도나 적용 승인을 뜻하지 않으므로 항목별 변경 내용을 비교하세요.');
            for (const [tone, label, description] of [['muted', '대기·제외', '대기·제외'], ['danger', '오류', '오류·파일 문제'], ['attention', '직접 확인', '직접 확인 필요'], ['warning', '외부 자료', '외부 자료에서 찾음'], ['info', '재검색', '다시 찾은 기록'], ['success', '식별·적용', '식별 근거·적용 완료']]) {
                const entry = el('span', uiText(label), toneLegend);
                entry.className = `tone-${tone}`;
                entry.title = uiText(description);
            }
            const statusSummary = el('div', '', classificationDetails);
            statusSummary.className = 'status-summary';
            statusSummary.setAttribute('aria-label', uiText('항목 분류 필터'));
            const tableScroll = el('div', '', listPane);
            tableScroll.className = 'table-scroll';
            const table = el('table', '', tableScroll);
            table.setAttribute('aria-label', uiText('PDF 서지정보 인식 결과'));
            const colgroup = el('colgroup', '', table);
            for (const cls of ['col-check', 'col-check', 'col-evidence'])
                el('col', '', colgroup).className = cls;
            const oldTitleColumn = el('col', '', colgroup), newTitleColumn = el('col', '', colgroup);
            const head = el('tr', '', el('thead', '', table));
            const sortKeys: Record<string, 'oldTitle' | 'newTitle' | 'checked' | 'reportFlag' | 'evidence'> = { '선택': 'checked', '표시': 'reportFlag', '근거': 'evidence', '기존 제목': 'oldTitle', '새로 찾은 제목': 'newTitle' };
            const headBoxes: Record<string, any> = {};
            const sortHeads: Array<{
                key: string;
                th: any;
            }> = [];
            const sortLabels: Array<{
                key: string;
                value: string;
                label: any;
            }> = [];
            const markSortedHeads = () => {
                for (const { key, th } of sortHeads) {
                    th.classList.toggle('sorted-up', sortKey === key && sortDirection > 0);
                    th.classList.toggle('sorted-down', sortKey === key && sortDirection < 0);
                    th.setAttribute('aria-sort', sortKey === key ? sortDirection > 0 ? 'ascending' : 'descending' : 'none');
                }
                for (const { key, value, label } of sortLabels)
                    label.textContent = sortKey === key ? `${uiText(value)} ${sortDirection > 0 ? '▲' : '▼'}` : uiText(value);
            };
            for (const [value, cls] of [['선택', 'col-check'], ['표시', 'col-check'], ['근거', 'col-evidence'], ['기존 제목', 'title-column'], ['새로 찾은 제목', 'title-column']]) {
                const key = sortKeys[value];
                const th = el('th', '', head);
                th.className = cls;
                th.scope = 'col';
                if (cls === 'col-check') {
                    const holder = el('span', '', th);
                    holder.className = 'head-box';
                    const box = el('input', '', holder) as any;
                    box.type = 'checkbox';
                    box.onclick = (event: any) => event.stopPropagation();
                    box.setAttribute('aria-label', value === '선택' ? uiText('현재 보기의 모든 페이지 항목 선택') : uiText('현재 보기의 모든 페이지 항목 나중에 볼 표시'));
                    el('span', uiText(value), holder);
                    headBoxes[value] = box;
                }
                else {
                    const label = el('span', uiText(value), th);
                    if (key)
                        sortLabels.push({ key, value, label });
                }
                if (key)
                    sortHeads.push({ key, th });
                if (key) {
                    th.title = uiTemplate `${value === '근거' ? uiText('같은 근거 태그끼리 모아 정렬') : uiText('클릭하여 이 열로 정렬')} · 다시 클릭하면 반대 방향, 세 번째 클릭이면 원래 순서`;
                    th.style.cursor = 'pointer';
                    th.tabIndex = 0;
                    th.onclick = (event: any) => {
                        if (event.target?.classList?.contains('column-resizer'))
                            return;
                        if (sortKey !== key) {
                            sortKey = key;
                            sortDirection = 1;
                        }
                        else if (sortDirection > 0)
                            sortDirection = -1;
                        else
                            sortKey = null;
                        page = 0;
                        render();
                    };
                    th.onkeydown = (event: any) => {
                        if (event.target !== th || !['Enter', ' '].includes(event.key))
                            return;
                        event.preventDefault();
                        th.onclick(event);
                    };
                }
            }
            const selectAllBox = headBoxes['선택'], flagAllBox = headBoxes['표시'];
            selectAllBox.title = uiText('현재 분류와 제목 검색에 맞는 모든 페이지에서 선택할 수 있는 항목을 선택하거나 해제합니다.');
            flagAllBox.title = uiText('현재 분류와 제목 검색에 맞는 모든 페이지의 항목에 나중에 볼 표시를 하거나 해제합니다. 「나중에 볼 항목 저장」이 표시된 항목을 모읍니다.');
            selectAllBox.onchange = () => setVisibleSelection(selectAllBox.checked);
            flagAllBox.onchange = () => setVisibleReportFlags(flagAllBox.checked);
            const oldTitleHead = head.children[3], columnResizer = el('span', '', oldTitleHead);
            columnResizer.className = 'column-resizer';
            columnResizer.title = uiText('드래그하여 기존 제목과 인식 제목 열 너비 조절');
            const applyTitleWidths = () => {
                const available = Math.max(240, tableScroll.clientWidth - fixedColumns);
                const oldWidth = Math.round(available * titleSplit);
                oldTitleColumn.style.width = `${oldWidth}px`;
                newTitleColumn.style.width = `${available - oldWidth}px`;
            };
            const columnObserver = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(applyTitleWidths) : null;
            columnObserver?.observe(tableScroll);
            win.addEventListener('unload', () => columnObserver?.disconnect(), { once: true });
            columnResizer.onmousedown = (event: any) => {
                event.preventDefault();
                event.stopPropagation();
                columnResizer.classList.add('dragging');
                doc.body.classList.add('resizing-columns');
                const move = (moveEvent: any) => {
                    const available = Math.max(240, tableScroll.clientWidth - fixedColumns), left = table.getBoundingClientRect().left + fixedColumns;
                    const oldWidth = Math.max(120, Math.min(available - 120, moveEvent.clientX - left));
                    titleSplit = oldWidth / available;
                    applyTitleWidths();
                };
                const stop = () => { columnResizer.classList.remove('dragging'); doc.body.classList.remove('resizing-columns'); win.removeEventListener('mousemove', move); win.removeEventListener('mouseup', stop); };
                win.addEventListener('mousemove', move);
                win.addEventListener('mouseup', stop);
            };
            const body = el('tbody', '', table), pager = el('div', '', listPane);
            pager.className = 'pager';
            const previous = el('button', uiText('‹ 이전'), pager);
            previous.onclick = () => { page = Math.max(0, page - 1); tableScroll.scrollTop = 0; render(); };
            const next = el('button', uiText('다음 ›'), pager);
            next.onclick = () => { page++; tableScroll.scrollTop = 0; render(); };
            const pageSizes = el('span', '', pager);
            pageSizes.className = 'page-sizes';
            const pageSizeChips = [100, 300, 1000, 5000].map(size => {
                const chip = el('button', size >= 5000 ? uiText('전체') : String(size), pageSizes);
                chip.className = 'chip';
                chip.onclick = () => { pageSize = size; page = 0; tableScroll.scrollTop = 0; render(); };
                return { size, chip };
            });
            const pageInfo = el('span', '', pager);
            pageInfo.className = 'page-info';
            const paneSplit = el('div', '', workspace);
            paneSplit.className = 'pane-split';
            paneSplit.onmousedown = (event: any) => {
                event.preventDefault();
                paneSplit.classList.add('dragging');
                const move = (moved: any) => {
                    const box = workspace.getBoundingClientRect();
                    const width = Math.min(Math.max(box.right - moved.clientX, 280), box.width - 280);
                    workspace.style.setProperty('--detail-width', `${Math.round(width)}px`);
                };
                const done = () => {
                    paneSplit.classList.remove('dragging');
                    doc.removeEventListener('mousemove', move);
                    doc.removeEventListener('mouseup', done);
                };
                doc.addEventListener('mousemove', move);
                doc.addEventListener('mouseup', done);
            };
            const detailPane = el('div', '', workspace);
            detailPane.className = 'card pane detail-pane';
            const detailHead = el('div', '', detailPane);
            detailHead.className = 'pane-titlebar';
            const detailTitle = el('span', uiText('상세 비교'), detailHead);
            const detailClose = el('button', uiText('닫기'), detailHead);
            detailClose.onclick = () => { detailOpen = false; render(); };
            const detail = el('div', '', detailPane);
            detail.className = 'detail';
            const folder = el('div', '', advancedSettings);
            folder.className = 'footer';
            const formatDuration = (seconds: number) => { if (!Number.isFinite(seconds) || seconds < 0)
                return '—'; const rounded = Math.round(seconds), h = Math.floor(rounded / 3600), m = Math.floor((rounded % 3600) / 60), s = rounded % 60; return h ? uiTemplate `${h}시간 ${m}분` : m ? uiTemplate `${m}분 ${s}초` : uiTemplate `${s}초`; };
            const updateDashboard = () => {
                if (shuttingDown || win.closed)
                    return;
                const m = session.metrics, clock = m.endedAt || Date.now(), elapsed = m.startedAt ? Math.max(0, (clock - m.startedAt) / 1000) : 0;
                const rate = m.completed && elapsed ? m.completed / elapsed * 60 : 0, remaining = rate ? (m.total - m.completed) / rate * 60 : Infinity;
                dashboard.classList.toggle('idle', !session.busy);
                dashboard.classList.toggle('stopped', !session.busy && !!session.progress && session.progress !== '완료');
                const emptyDashboard = !session.busy && !m.startedAt && !session.progress && !session.lastRun && !session.lastApply && resultDetails.hidden;
                dashboard.classList.toggle('empty-dashboard', emptyDashboard);
                dashboard.hidden = emptyDashboard;
                progressTitle.textContent = session.busy ? uiTemplate `${operationName(m.operation)} 진행 중 · ${m.completed} / ${m.total}` : session.progress && session.progress !== '완료' ? uiText('작업을 멈췄습니다') : m.total ? uiTemplate `${operationName(m.operation)} 완료 · ${m.completed}개` : uiText('작업 준비');
                currentTitle.textContent = m.currentTitle || '';
                progressBar.max = Math.max(1, m.total);
                progressBar.value = m.completed;
                metricNodes[0].textContent = m.total ? `${!session.busy && m.operation ? `${operationName(m.operation)} ` : ''}${m.completed} / ${m.total} (${Math.round(m.completed / m.total * 100)}%)` : '—';
                paintMessage();
                metricNodes[1].textContent = m.startedAt ? formatDuration(elapsed) : '—';
                metricNodes[2].textContent = rate ? uiTemplate `${rate.toFixed(rate < 10 ? 1 : 0)}개/분` : session.busy ? uiText('측정 중') : '—';
                metricNodes[3].textContent = !m.total ? '—' : m.completed >= m.total ? uiText('완료') : session.busy ? formatDuration(remaining) : '—';
                metricNodes[4].textContent = m.lastItemMs ? formatDuration(m.lastItemMs / 1000) : '—';
            };
            const externalLink = (label: string, url: string, parent: any) => {
                const safeURL = safeExternalURL(url);
                if (!safeURL)
                    return el('span', label, parent);
                const link = el('a', label, parent);
                link.href = safeURL;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.draggable = true;
                link.onclick = (event: any) => { event.preventDefault(); event.stopPropagation(); Zotero.launchURL(safeURL); };
                return link;
            };
            const displayValue = (field: string, raw: unknown): string => field === 'creators'
                ? creatorsToText(raw)
                : typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
            const appendScientificText = (value: string, parent: any) => {
                const stack: Array<{
                    tag: string;
                    node: any;
                }> = [{ tag: '', node: parent }];
                for (const token of tokenizeScientificMarkup(value)) {
                    const current = stack[stack.length - 1].node;
                    if (token.type === 'text') {
                        current.appendChild(doc.createTextNode(token.value));
                        continue;
                    }
                    if (token.type === 'open') {
                        const node = el(token.tag, '', current);
                        node.className = 'scientific-markup';
                        stack.push({ tag: token.tag, node });
                        continue;
                    }
                    if (stack.length > 1 && stack[stack.length - 1].tag === token.tag)
                        stack.pop();
                    else
                        current.appendChild(doc.createTextNode(token.value));
                }
            };
            const renderValue = (field: string, raw: unknown, parent: any, old = false) => {
                const value = displayValue(field, raw), box = el('span', '', parent);
                box.className = `value${old ? ' old' : ''}`;
                if (field === 'DOI' && value)
                    externalLink(value, `https://doi.org/${value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')}`, box);
                else if (field.toLowerCase() === 'url' && /^https?:\/\//i.test(value))
                    externalLink(value, value, box);
                else
                    appendScientificText(value, box);
                if ((field === 'DOI' || field.toLowerCase() === 'url') && value) {
                    const copy = el('button', uiText('복사'), box);
                    copy.className = 'copy';
                    copy.onclick = async (event: any) => { event.stopPropagation(); try {
                        await win.navigator.clipboard.writeText(value);
                        message.textContent = uiTemplate `${field}를 복사했습니다.`;
                    }
                    catch {
                        message.textContent = uiTemplate `${field} 복사에 실패했습니다. 링크 텍스트를 드래그해 복사하세요.`;
                    } };
                }
            };
            const expanded = new Map<string, Set<string>>();
            const appliedLive = new Map<number, {
                meta: string;
                state: string;
            }>();
            const fieldName = (field: string) => fieldLabels[field] || field;
            const renderDetail = (row?: Row) => {
                detail.replaceChildren();
                if (!row) {
                    detailTitle.textContent = uiText('변경 내용 확인');
                    el('div', uiText('목록에서 항목을 누르면 기존 정보와 변경안을 비교할 수 있어요.'), detail).className = 'empty';
                    return;
                }
                detailTitle.textContent = uiTemplate `변경 내용 — ${labels[row.status] || row.status}`;
                const itemHeading = el('h3', '', detail);
                itemHeading.className = 'detail-item-heading';
                appendScientificText(shownTitleOf(row), itemHeading);
                const appliedNow = isAppliedStatus(row.status);
                const staleGeneration = row.recognizedWith && row.recognizedWith !== RECOGNITION_PIPELINE_VERSION && !appliedNow ? row.recognizedWith : '';
                if (staleGeneration) {
                    el('div', uiTemplate `이 결과는 이전 인식 규칙(${staleGeneration})으로 만들어졌습니다. 지금 규칙으로 다시 보려면 이 행을 「선택 항목 다시 찾기」하세요.`, detail).className = 'reason stale';
                }
                {
                    const standing = session.standing(row);
                    const translatedStanding = uiText(standing.detail);
                    const standingText = standing.unverified.length || standing.external.length || standing.page.length
                        ? translatedStanding.replace(/\b[A-Za-z]+\b/g, key => fieldLabels[key] || key) : translatedStanding;
                    const standingNote = el('div', uiTemplate `상태: ${uiText(standing.label)} — ${standingText}`, detail);
                    standingNote.className = 'reason';
                    standingNote.title = uiText(standing.detail);
                }
                if (row.storedDifference?.fields.length && !appliedNow) {
                    const trim = (value: string) => value.length > 80 ? value.slice(0, 80) + '…' : value;
                    const lines = row.storedDifference.fields.map(field => {
                        const entry = row.storedDifference!.details[field] || { before: '', after: '' };
                        return `${uiText(DIFFERING_FIELD_LABEL[field] || field)} 「${trim(entry.before)}」 → 「${trim(entry.after)}」`;
                    });
                    el('div', uiTemplate `기존과 다름 — ${lines.join(' · ')} · 적용은 평소와 같습니다.`, detail).className = 'reason differs';
                }
                const openSections = expanded.get(row.key) || new Set<string>();
                const section = (kind: string, title: (count: number) => string) => {
                    const box = el('details', '', detail) as any;
                    box.className = 'fields evidence';
                    const summary = el('summary', '…', box);
                    box.open = openSections.has(kind);
                    box.ontoggle = () => { if (box.open)
                        openSections.add(kind);
                    else
                        openSections.delete(kind); expanded.set(row.key, openSections); };
                    return { box, finish: () => { const count = box.children.length - 1; if (count <= 0)
                            box.remove();
                        else
                            summary.textContent = title(count); } };
                };
                const record = row.status === 'applying' ? null : session.appliedOf(row);
                if (record && (appliedNow || row.status === 'undone')) {
                    if (!appliedNow)
                        el('div', uiTemplate `되돌림 — ${record.undoneAt ? uiTemplate `${uiText(formatWhen(record.undoneAt))}에 ` : ''}적용 전 값으로 복원했습니다. 아래 「그때 적용했던 값」은 지금 항목에 없습니다.`, detail).className = 'reason undone';
                    const box = el('div', '', detail);
                    box.className = `applied-block${appliedNow ? '' : ' undone'}`;
                    const when = record.source === 'derived' ? uiText('적용 기록 없음 — 적용 전 백업과 적용 지문의 차이로 복원, 시각 없음')
                        : record.source === 'estimated' ? uiText('추정 — 새 상위 항목을 만든 이전 빌드의 쓰기 계획으로 다시 세움')
                            : `${uiText(formatWhen(record.at))}${record.createdParentID ? uiText(' · 새 상위 항목을 만들었습니다') : ''}`;
                    el('div', uiTemplate `${appliedNow ? uiText('적용한 값') : uiText('그때 적용했던 값')} ${record.fields.length}개 — ${when}`, box).className = 'applied-title';
                    for (const entry of record.fields) {
                        const block = el('div', '', box);
                        block.className = `change ${entry.kind}`;
                        const head = el('div', '', block);
                        head.className = 'change-head';
                        el('span', fieldName(entry.field), head).className = 'field-name';
                        el('span', uiText(APPLIED_KIND_LABEL[entry.kind]), head).className = `state-chip ${entry.kind}`;
                        const oldLine = el('div', '', block);
                        oldLine.className = 'value-row';
                        el('span', uiText('이전'), oldLine).className = 'value-label';
                        renderValue(entry.field, entry.old, oldLine, true);
                        const newLine = el('div', '', block);
                        newLine.className = 'value-row';
                        el('span', uiText('적용'), newLine).className = 'value-label';
                        if (entry.kind === 'cleared' || entry.kind === 'typeLoss')
                            el('span', entry.kind === 'cleared' ? uiText('(비움)') : uiText('(새 유형에 없는 칸이라 사라짐)'), newLine).className = 'value old';
                        else
                            renderValue(entry.field, entry.new, newLine);
                    }
                    if (appliedNow) {
                        const meta = `${row.before?.appliedMetadata || record.createdParentMetadata || record.createdParentID || ''}|${record.at || ''}`;
                        const known = appliedLive.get(row.id);
                        if (!known || known.meta !== meta) {
                            appliedLive.set(row.id, { meta, state: 'pending' });
                            void session.appliedState(row).then(state => { appliedLive.set(row.id, { meta, state }); if (selectedRowID === row.id && detailOpen)
                                render(); });
                        }
                        const state = appliedLive.get(row.id)!.state;
                        const live = state === 'pending' ? '지금 항목: 확인 중…'
                            : state === 'same' ? (record.createdParentID ? '지금 항목: 만든 상위 항목이 그대로 있습니다' : '지금 항목: 적용한 그대로')
                                : state === 'changed' ? '지금 항목: 적용 뒤 바뀜 — Zotero에서 편집됐습니다. 「적용 되돌리기」는 이 항목을 건너뜁니다.'
                                    : state === 'missing' ? '지금 항목: 찾을 수 없습니다 — 삭제되거나 옮겨졌습니다'
                                        : '지금 항목: 적용 지문이 없어 확인할 수 없습니다';
                        el('div', uiText(live), box).className = `applied-live${state === 'changed' || state === 'missing' ? ' changed' : ''}`;
                    }
                    const unwritten = section('notWritten', count => uiTemplate `쓰지 않은 제안 ${count}개`);
                    const written = new Set(record.fields.map(entry => entry.field));
                    const reasons = new Map(record.notWritten.map(entry => [entry.field,
                        entry.code === 'notSelected' && entry.reason.startsWith('적용 지문에 없습니다')
                            ? friendlyActionCopy(entry.reason) : uiText(entry.reason)]));
                    for (const change of row.changes) {
                        if (written.has(change.field))
                            continue;
                        const line = el('div', `${fieldName(change.field)} — ${reasons.get(change.field) || uiText('「찾기 방법 및 설정」에서 꺼 둔 필드였거나 쓰기 계획이 받지 않았습니다')}`, unwritten.box);
                        line.className = 'reason';
                        const proposed = displayValue(change.field, change.newValue);
                        el('div', uiTemplate `제안: ${proposed ? (proposed.length > 160 ? proposed.slice(0, 160) + '…' : proposed) : uiText('(비움)')}`, line).className = 'sub';
                    }
                    unwritten.finish();
                }
                else if (record && !record.undoneAt) {
                    const when = record.at ? uiTemplate `${uiText(formatWhen(record.at))}에 ` : '';
                    const count = uiTemplate `그때 쓴 값 ${record.fields.length}개는 항목에 남아 있고`;
                    el('div', row.status === 'excluded' ? uiTemplate `이 행은 ${when}적용한 뒤 스캔 제외했습니다 — ${count}, 제외한 행은 「적용 되돌리기」 대상이 아닙니다.`
                        : !row.before ? uiTemplate `이 행은 ${when}적용한 뒤 스캔 제외를 해제했습니다 — ${count}, 되돌리기 백업은 제외를 해제할 때 지워졌습니다.`
                            : writtenOver(row) ? uiTemplate `이 행은 ${when}적용했습니다 — ${count}, 「적용 되돌리기」는 적용 완료 상태의 행만 되돌립니다.`
                                : uiTemplate `이 행은 ${when}적용한 뒤 다시 읽었습니다 — ${count}, 되돌리기 백업은 다시 읽을 때의 항목으로 바뀌었습니다.`, detail).className = 'reason stale';
                }
                const evidence = section('evidence', count => uiTemplate `찾은 경로와 추가 설명 ${count}건`);
                el('div', uiTemplate `항목 키: ${row.key}${row.recognitionSource ? uiTemplate ` · 인식 출처: ${uiText(row.recognitionSource)}` : ''}${row.cacheState === 'hit' ? uiText(' · 이전에 찾은 결과 사용') : row.cacheState === 'refreshed' ? uiText(' · 새로 찾은 결과') : ''}`, evidence.box).className = 'muted';
                for (const reason of [...new Set([row.error, ...(row.match?.reasons || [])].filter(Boolean))])
                    el('div', uiText(String(reason)), evidence.box).className = 'reason';
                if (row.attempts?.length) {
                    el('div', uiText('시도 이력'), evidence.box).className = 'reason';
                    for (const attempt of row.attempts)
                        el('div', `· ${uiText(attempt)}`, evidence.box).className = 'reason';
                }
                if (row.restore?.discoveries?.length) {
                    for (const search of row.restore.discoveries) {
                        const followed = search.hits.filter(hit => hit.followed);
                        const line = el('div', '', evidence.box);
                        line.className = 'reason';
                        line.appendChild(doc.createTextNode(uiTemplate `Google 자동 검색 「${search.query}」 → ${search.state === 'results' ? uiTemplate `결과 ${search.hits.length}건, ${followed.length}건 따라감` : search.state === 'blocked' ? uiText('차단(봇 확인 페이지)') : search.state === 'scriptsRequired' ? uiText('결과 미렌더링') : search.state}`));
                        for (const hit of followed) {
                            const detailLine = el('div', '', line);
                            detailLine.className = 'sub';
                            detailLine.appendChild(doc.createTextNode(`  · ${hit.title.slice(0, 80)} → ${hit.detail?.kind || '—'}${hit.detail?.recordTitle ? uiText(' · 서지 읽음') : ''} `));
                            if (hit.detail?.finalURL)
                                externalLink(hit.detail.finalURL.replace(/^https?:\/\//, '').slice(0, 60), hit.detail.finalURL, detailLine);
                        }
                    }
                }
                if (row.restore?.assist?.length && !row.restore.target) {
                    const box = el('div', '', evidence.box);
                    box.className = 'reason assist';
                    box.appendChild(doc.createTextNode(uiText('사용자 보조 검색 — 아래 질의를 브라우저에서 열고, 맞는 문헌의 상세 URL을 아래 입력란에 붙여넣으세요: ')));
                    for (const entry of row.restore.assist) {
                        const item = el('div', '', box);
                        item.className = 'sub';
                        externalLink(uiTemplate `Google에서 「${entry.query.slice(0, 70)}」 검색`, entry.url, item);
                        item.appendChild(doc.createTextNode(` — ${uiText(entry.reason)}`));
                    }
                }
                const itemTools = section('tools', () => uiText('다른 방법으로 찾기 · 항목 제외'));
                if (row.protections && Object.keys(row.protections).length) {
                    const releaseAll = el('button', uiTemplate `이 항목 보호 전체 해제 (${Object.keys(row.protections).length}개 필드)`, itemTools.box);
                    releaseAll.className = 'copy';
                    releaseAll.title = uiText('이전에 확인한 값의 보호를 모두 풀고 제안된 정보도 선택합니다. 권장하지 않는 값과 비우기는 제외합니다. 항목에서 이렇게 선택한 정보는 기본 적용 필드 설정보다 우선합니다. 승인 철회와는 다른 동작으로, 다음 인식이 이 필드들을 다시 제안할 수 있습니다.');
                    releaseAll.onclick = () => {
                        for (const field of Object.keys(row.protections || {}))
                            releaseProtection(row, field);
                        row.fieldChoice = { ...(row.fieldChoice || {}), ...Object.fromEntries(chosenOnRelease(row).map(change => [change.field, true])) };
                        saveRow(row);
                        render();
                    };
                }
                if (row.status === 'excluded') {
                    const include = el('button', uiText('스캔 제외 해제'), itemTools.box);
                    include.className = 'copy';
                    include.disabled = session.busy;
                    include.onclick = () => void execute(async () => {
                        if (session.busy) {
                            message.textContent = uiText('작업이 끝난 뒤에 제외를 해제할 수 있습니다.');
                            return;
                        }
                        await session.include(row);
                        message.textContent = uiText('제외를 해제했습니다. 「PDF 정보 찾기」를 누르면 다시 검색합니다.');
                    });
                }
                else if (!['pending', 'applying', 'updated'].includes(row.status)) {
                    const exclude = el('button', uiText('이 PDF를 스캔 제외'), itemTools.box);
                    exclude.className = 'copy';
                    exclude.onclick = () => void execute(async () => {
                        const note = row.pdfFingerprint
                            ? '현재 서지정보를 유지하고 이 PDF를 이후 검색·검토에서 제외합니다. PDF 파일이 변경되면 자동으로 다시 검색합니다.'
                            : 'PDF를 읽지 못한 상태입니다. 이 항목을 이후 검색·검토에서 제외하며, 파일이 바뀌어도 자동으로 돌아오지 않습니다.';
                        if (!Services.prompt.confirm(win, uiText('PDF 스캔 제외'), uiText(note)))
                            return;
                        await session.exclude(row);
                        message.textContent = uiText('스캔 제외로 저장했습니다. 제외 항목은 목록 마지막에 표시됩니다.');
                    });
                }
                const referenceRow = el('div', '', itemTools.box);
                referenceRow.className = 'reference-row';
                const referenceInput = el('input', '', referenceRow) as any;
                referenceInput.type = 'text';
                referenceInput.className = 'reference-input';
                referenceInput.placeholder = uiText('링크 · DOI · ISBN으로 인식 — 붙여넣고 Enter');
                referenceInput.title = uiText('서지 페이지 주소·DOI·ISBN을 넣으면 그 페이지가 게시한 서지정보(citation 메타태그·schema.org·Dublin Core)나 등록기관 기록을 읽어 제안합니다.');
                const referenceGo = el('button', uiText('주소로 인식'), referenceRow);
                referenceGo.className = 'copy';
                const runReference = () => void execute(async () => {
                    const value = String(referenceInput.value || '').trim();
                    if (!value) {
                        message.textContent = uiText('링크 또는 DOI를 입력하세요.');
                        return;
                    }
                    if (session.busy) {
                        message.textContent = uiText('작업이 끝난 뒤에 주소로 인식할 수 있습니다.');
                        return;
                    }
                    if (isAppliedStatus(row.status) && !Services.prompt.confirm(win, uiText('적용된 행 다시 읽기'), uiText('이 행은 이미 적용됐습니다. 주소로 다시 인식하면 되돌리기 백업이 지금 항목으로 바뀌어, 그 적용은 더 이상 되돌릴 수 없습니다. 계속할까요?')))
                        return;
                    await session.recognizeFromReference(row, value);
                    if (/실패/.test(String(row.error || '')))
                        message.textContent = errorText = uiText(String(row.error));
                    else
                        message.textContent = uiText('입력한 주소에서 서지정보를 읽었습니다. 적용 전에 값을 확인하세요.');
                });
                referenceGo.onclick = runReference;
                referenceInput.onkeydown = (event: any) => { if (event.key === 'Enter') {
                    event.preventDefault();
                    runReference();
                } };
                referenceGo.disabled = session.busy;
                const nearCandidates = section('nearCandidates', count => uiTemplate `찾은 다른 후보 ${count}건`);
                for (const candidate of row.candidates || []) {
                    const box = el('div', '', nearCandidates.box);
                    box.className = 'candidate';
                    box.title = uiText('검색이 이 문서의 기록으로 받아 주지 않은 가까운 후보입니다. 숫자는 판독한 제목과 후보 제목의 유사도입니다.');
                    el('div', uiTemplate `검색 후보 · 제목 유사도 ${Math.round(candidate.score * 100)}% — ${candidate.title}`, box);
                    externalLink(candidate.url, candidate.url, box);
                }
                nearCandidates.finish();
                if (row.standalonePDF && row.changes.length && !row.changes.some(change => change.field === 'itemType' && change.newValue !== 'document')) {
                    const typeRow = el('div', '', itemTools.box);
                    typeRow.className = 'reference-row';
                    const typeInput = el('input', '', typeRow) as any;
                    typeInput.type = 'text';
                    typeInput.className = 'reference-input';
                    typeInput.placeholder = uiText('새 항목의 유형 키 (report, book, journalArticle, thesis …)');
                    typeInput.title = uiText('판독기가 이 문서의 유형을 읽지 못했습니다. 유형을 정하면 선택한 정보로 새 항목을 만듭니다.');
                    const typeGo = el('button', uiText('유형 정하기'), typeRow);
                    typeGo.className = 'copy';
                    typeGo.disabled = session.busy;
                    typeGo.onclick = () => void execute(async () => {
                        session.chooseItemType(row, String(typeInput.value || '').trim());
                        message.textContent = uiText('유형을 정했습니다. 필드를 확인해 적용하면 새 항목이 만들어집니다.');
                    });
                }
                itemTools.finish();
                if (row.selection?.length) {
                    const box = el('div', '', evidence.box);
                    box.className = 'reason';
                    box.appendChild(doc.createTextNode(uiTemplate `후보 선택: ${row.selection.map(entry => `${entry.candidate} ${uiText(entry.chosen ? '채택' : '제외')} (${uiText(entry.reason).slice(0, 160)})`).join(' · ')}`));
                }
                const official = row.coverProposal?.official as {
                    doi?: string;
                    bound?: boolean;
                    corrections?: Array<{
                        field: string;
                        from: any;
                        to: any;
                        reason: string;
                    }>;
                    conflicts?: Array<{
                        field: string;
                        role: string;
                        values: Array<{
                            provider?: string;
                            value: string;
                            role?: string;
                        }>;
                    }>;
                } | null | undefined;
                const names = (value: any) => Array.isArray(value) ? value.map((v: any) => v.lastName || v.name).join('; ') : String(value ?? '');
                if (official?.bound && official.corrections?.length) {
                    const box = el('div', '', evidence.box);
                    box.className = 'reason';
                    box.appendChild(doc.createTextNode(uiTemplate `공식 기록(DOI ${official.doi})으로 교정한 값 ${official.corrections.length}건: ` + official.corrections.map(entry => `${fieldName(entry.field)} 「${names(entry.from).slice(0, 60)}」 → 「${names(entry.to).slice(0, 60)}」 (${uiText(entry.reason)})`).join(' · ')));
                }
                if (row.fieldConflicts?.length) {
                    const box = el('div', '', evidence.box);
                    box.className = 'reason';
                    box.appendChild(doc.createTextNode(uiTemplate `출처 충돌 ${row.fieldConflicts.length}건 — 자동 확정하지 않음: ` + row.fieldConflicts.map(entry => `${fieldName(entry.field)}: ${entry.values.map(item => `${item.provider || uiText('문서')} ${item.value}${item.role ? ` (${uiText(item.role)})` : ''}`).join(' / ')}`).join(' · ')));
                }
                if (row.restore?.corrections?.length) {
                    const box = el('div', '', evidence.box);
                    box.className = 'reason';
                    box.appendChild(doc.createTextNode(uiTemplate `연결된 기록으로 교정한 값 ${row.restore.corrections.length}건: ` + row.restore.corrections.map(entry => `${fieldName(entry.field)} 「${String(Array.isArray(entry.from) ? entry.from.map((v: any) => v.lastName).join('; ') : entry.from).slice(0, 40)}」 → 「${String(Array.isArray(entry.to) ? entry.to.map((v: any) => v.lastName).join('; ') : entry.to).slice(0, 40)}」 (${uiText(entry.reason)})`).join(' · ')));
                }
                evidence.finish();
                const alternatives = section('candidates', count => uiTemplate `연결되지 않은 후보 기록 ${count}건 — 채택 버튼은 안에 있음`);
                for (const [index, candidate] of (row.restore?.candidates || []).entries()) {
                    if (!candidate.record)
                        continue;
                    const box = el('div', '', alternatives.box);
                    box.className = 'candidate';
                    const relation = uiText(candidate.relation === 'sameWork' ? '같은 저작, 다른 판본일 수 있음' : candidate.relation === 'conflict' ? '어긋남 있음' : '연결 근거 부족');
                    el('div', `${candidate.provider} · ${candidate.record.pageType} · ${relation} — ${uiText(candidate.rule)}`, box);
                    const stated = Object.entries({ title: candidate.record.title, ...candidate.record.fields }).filter(([field, value]) => value && field !== 'url').slice(0, 8)
                        .map(([field, value]) => `${fieldName(field)}: ${String(value).slice(0, 50)}`).join(' · ');
                    el('div', `${stated}${candidate.record.creators?.length ? uiTemplate ` · 저자: ${candidate.record.creators.map(creatorDisplayName).join('; ').slice(0, 60)}` : ''}`, box).className = 'sub';
                    if (candidate.conflicts?.length)
                        el('div', uiTemplate `어긋남: ${candidate.conflicts.map(uiText).join('; ').slice(0, 160)}`, box).className = 'sub';
                    externalLink(candidate.url.replace(/^https?:\/\//, '').slice(0, 70), candidate.url, box);
                    const adopt = el('button', uiText('이 기록을 이 문서의 기록으로 채택'), box);
                    adopt.className = 'copy';
                    adopt.disabled = session.busy;
                    adopt.onclick = () => void execute(async () => {
                        if (isAppliedStatus(row.status) && !Services.prompt.confirm(win, uiText('적용된 행에 후보 채택'), uiText('이 행은 이미 적용됐습니다. 후보를 채택하면 지금 항목을 새 기준으로 제안을 다시 만들고 되돌리기 백업도 지금 항목으로 바뀌어, 그 적용은 더 이상 되돌릴 수 없습니다. 계속할까요?')))
                            return;
                        await session.adoptCandidate(row, index);
                        message.textContent = uiText('선택한 기록의 값으로 제안을 다시 만들었습니다. 각 필드를 확인해 적용하세요.');
                    });
                }
                alternatives.finish();
                if (appliedNow)
                    return;
                const included = (change: any) => row.fieldChoice?.[change.field] ?? enabledFields.has(change.field);
                const decisions = new Map(eligibility(row, enabledFields).map(entry => [entry.field, entry]));
                if (row.changes.length) {
                    const masterRow = el('div', '', detail);
                    masterRow.className = 'change-master';
                    const masterLabel = el('label', '', masterRow);
                    const masterBox = el('input', '', masterLabel) as any;
                    masterBox.type = 'checkbox';
                    el('span', uiText('전체 선택'), masterLabel);
                    const chosen = row.changes.filter(included).length;
                    masterBox.checked = chosen === row.changes.length;
                    masterBox.indeterminate = chosen > 0 && chosen < row.changes.length;
                    masterBox.onchange = () => {
                        const choice = { ...(row.fieldChoice || {}) };
                        for (const change of row.changes)
                            choice[change.field] = masterBox.checked;
                        row.fieldChoice = choice;
                        saveRow(row);
                        render();
                    };
                    el('span', uiTemplate `${chosen} / ${row.changes.length} 필드 · 체크한 항목만 적용됩니다. 값은 직접 고쳐서 적용할 수 있습니다.`, masterRow).className = 'muted';
                }
                const stateOf = (change: any) => change.newValue === '' || change.newValue === null || change.newValue === undefined
                    || (Array.isArray(change.newValue) && !change.newValue.length) ? 'cleared'
                    : String(change.oldValue ?? '') === '' || (Array.isArray(change.oldValue) && !change.oldValue.length) ? 'added' : 'changed';
                const STATE_LABEL: Record<string, string> = { cleared: '삭제', added: '추가', changed: '변경' };
                for (const change of row.changes) {
                    const state = stateOf(change);
                    const block = el('div', '', detail);
                    block.className = `change ${state}`;
                    const head = el('div', '', block);
                    head.className = 'change-head';
                    const include = el('input', '', head);
                    include.type = 'checkbox';
                    include.checked = included(change);
                    include.title = uiText('체크하면 「선택한 정보 적용」이 이 값을 기록합니다 — 검증되지 않았거나 권장하지 않는 값이라도 그렇습니다. 보호된 이전 확인 값이 있으면 보호를 해제해야 기록됩니다.');
                    include.onchange = () => {
                        row.fieldChoice = { ...(row.fieldChoice || {}), [change.field]: include.checked };
                        saveRow(row);
                        render();
                    };
                    const name = el('span', fieldName(change.field), head);
                    name.className = 'field-name';
                    name.title = change.field;
                    el('span', uiText(STATE_LABEL[state]), head).className = `state-chip ${state}`;
                    const scope = scopeFor(row);
                    const proposed = chosenValue(row, change);
                    const verified = verificationCovers(row.verification?.[change.field], proposed, { pdfFingerprint: scope.pdfFingerprint, itemType: scope.itemType, policyVersion: RECOGNITION_PIPELINE_VERSION });
                    const printedOnly = /^title\/stated/.test(String(row.verification?.[change.field]?.rule || ''));
                    const decision = decisions.get(change.field);
                    const BY_CODE: Partial<Record<string, {
                        label: string;
                        kind: string;
                    }>> = {
                        verified: { label: printedOnly ? '페이지에 인쇄됨' : '검증됨', kind: 'verified' },
                        approved: { label: '승인됨', kind: 'approved' }, chosen: { label: '선택함', kind: 'approved' },
                        replacement: { label: '덮어쓰기로 비움', kind: 'proposed' }, protected: { label: '보호된 값과 다름 — 보호 해제 뒤 적용', kind: 'conflicting' },
                        approvalStale: { label: '승인 뒤 바뀜', kind: 'stale' }, clearing: { label: '비우기 — 이 행에서 직접 체크해야 적용', kind: 'stale' },
                        typeFieldLoss: { label: '유형 변경으로 사라짐 — 직접 체크해야 적용', kind: 'stale' }, typeNotSelected: { label: '유형 변경과 함께만 적용', kind: 'stale' },
                        advisedAgainst: { label: '권장하지 않음', kind: 'proposed' }, conflicting: { label: '본문과 불일치', kind: 'conflicting' }
                    };
                    const chip = (decision && BY_CODE[decision.code]) || (row.advice?.[change.field] ? { label: '권장하지 않음', kind: 'proposed' }
                        : verified.verified ? { label: printedOnly ? '페이지에 인쇄됨' : '검증됨', kind: 'verified' }
                            : verified.code === 'conflicting' ? { label: '본문과 불일치', kind: 'conflicting' }
                                : row.fieldChoice?.[change.field] === true ? { label: '선택함', kind: 'approved' }
                                    : { label: '미확인 — 체크되어 있으면 적용', kind: 'proposed' });
                    const chipNode = el('span', uiText(chip.label), head);
                    chipNode.className = `standing ${chip.kind}`;
                    if (decision)
                        chipNode.title = decision.eligible ? uiTemplate `적용합니다 — ${uiText(decision.reason)}` : uiTemplate `적용하지 않습니다 — ${uiText(decision.reason)}`;
                    if (row.protections?.[change.field]) {
                        const release = el('button', uiText('보호 해제'), head) as any;
                        release.className = 'release';
                        release.title = uiTemplate `이전에 확인한 값(${String(row.protections[change.field].value).slice(0, 40)})을 더 이상 보호하지 않습니다. 승인 철회와는 다른 동작입니다.`;
                        release.onclick = () => { releaseProtection(row, change.field); saveRow(row); render(); };
                    }
                    if (row.advice?.[change.field])
                        el('div', uiText(row.advice[change.field]), block).className = 'advice';
                    const oldLine = el('div', '', block);
                    oldLine.className = 'value-row';
                    el('span', uiText('기존'), oldLine).className = 'value-label';
                    renderValue(change.field, change.oldValue, oldLine, true);
                    const newLine = el('div', '', block);
                    newLine.className = 'value-row';
                    el('span', uiText('제안'), newLine).className = 'value-label';
                    {
                        const input = el('textarea', '', newLine) as any;
                        input.className = 'value-edit';
                        const proposedText = displayValue(change.field, change.newValue);
                        input.value = String(row.fieldEdit?.[change.field] ?? proposedText);
                        input.rows = Math.min(10, Math.max(1, String(input.value).split(String.fromCharCode(10)).length, Math.ceil(String(input.value).length / 60)));
                        if (change.field === 'creators') {
                            input.title = uiText(CREATORS_HINT);
                            el('div', uiText(CREATORS_HINT), block).className = 'setting-note';
                        }
                        if (change.field === 'itemType')
                            input.title = uiText('항목 유형 키를 입력합니다 (journalArticle, book, patent …). 알 수 없는 값은 적용되지 않습니다.');
                        const flagUnknownType = () => {
                            if (change.field !== 'itemType')
                                return;
                            input.classList.toggle('invalid', !isKnownItemType(input.value));
                        };
                        flagUnknownType();
                        input.oninput = () => {
                            const typed = String(input.value);
                            flagUnknownType();
                            const same = typed === proposedText;
                            const edits = { ...(row.fieldEdit || {}) };
                            if (same)
                                delete edits[change.field];
                            else
                                edits[change.field] = typed;
                            row.fieldEdit = Object.keys(edits).length ? edits : undefined;
                            input.classList.toggle('edited', !same);
                        };
                        input.onchange = () => {
                            if (JSON.stringify(change.newValue) === JSON.stringify(change.oldValue) && row.fieldEdit?.[change.field] === undefined) {
                                row.changes = row.changes.filter((other: any) => other !== change);
                                const choices = { ...(row.fieldChoice || {}) };
                                delete choices[change.field];
                                row.fieldChoice = Object.keys(choices).length ? choices : undefined;
                            }
                            saveRow(row);
                            render();
                        };
                        if (row.fieldEdit?.[change.field] !== undefined)
                            input.classList.add('edited');
                    }
                }
                const touched = new Set(row.changes.map((change: any) => change.field));
                const stale = !!writtenOver(row);
                const kept = Object.entries(stale ? {} : row.before?.fields || {})
                    .filter(([field, value]) => value && !touched.has(field))
                    .sort(([a], [b]) => (fieldLabels[a] || a).localeCompare(fieldLabels[b] || b));
                const keptCreators = !stale && !touched.has('creators') && (row.before?.creators || []).length;
                if (kept.length || keptCreators) {
                    const roster = el('div', '', detail);
                    roster.className = 'roster';
                    el('div', uiTemplate `그대로 두는 기존 필드 ${kept.length + (keptCreators ? 1 : 0)}개 — 고쳐 쓰면 적용 대상이 됩니다`, roster).className = 'roster-title';
                    const editKept = (field: string, stored: unknown) => {
                        const line = el('div', '', roster);
                        line.className = 'roster-line';
                        el('span', fieldLabels[field] || field, line).className = 'roster-field';
                        const input = el('textarea', '', line) as any;
                        input.className = 'value-edit roster-edit';
                        const storedText = displayValue(field, stored);
                        input.value = String(row.fieldEdit?.[field] ?? storedText);
                        input.rows = Math.min(6, Math.max(1, String(input.value).split(String.fromCharCode(10)).length, Math.ceil(String(input.value).length / 60)));
                        if (field === 'creators') {
                            input.title = uiText(CREATORS_HINT);
                            const hint = el('div', uiText(CREATORS_HINT), line) as any;
                            hint.className = 'setting-note';
                            hint.style.gridColumn = '2';
                        }
                        const sync = () => {
                            const typed = String(input.value);
                            const same = typed === storedText;
                            const edits = { ...(row.fieldEdit || {}) };
                            const choices = { ...(row.fieldChoice || {}) };
                            const others = row.changes.filter((change: any) => change.field !== field);
                            if (same) {
                                delete edits[field];
                                delete choices[field];
                                row.changes = others;
                            }
                            else {
                                edits[field] = typed;
                                choices[field] = true;
                                row.changes = [...others, { field, oldValue: stored as any, newValue: stored as any }];
                                if (row.status === 'noChanges')
                                    row.status = 'review';
                            }
                            row.fieldEdit = Object.keys(edits).length ? edits : undefined;
                            row.fieldChoice = Object.keys(choices).length ? choices : undefined;
                            input.classList.toggle('edited', !same);
                        };
                        input.oninput = sync;
                        input.onchange = () => { sync(); saveRow(row); render(); };
                        if (row.fieldEdit?.[field] !== undefined)
                            input.classList.add('edited');
                    };
                    if (keptCreators)
                        editKept('creators', row.before?.creators);
                    for (const [field, value] of kept)
                        editKept(field, value);
                }
                if (!row.changes.length && !kept.length && !keptCreators)
                    el('div', uiText('변경할 정보가 없습니다.'), detail).className = 'empty';
            };
            let lastWrittenIDs = new Set<number>(), lastSkippedIDs = new Set<number>();
            const ROW_GROUPS: Record<string, (row: Row) => boolean> = {
                changes: row => row.changes.length > 0 && !isAppliedStatus(row.status),
                flagged: row => !!row.reportFlag,
                written: row => row.status === 'updated',
                rescanned: row => row.rescannedAt !== undefined,
                storedDiffers: row => !!row.storedDifference?.fields?.length && !isAppliedStatus(row.status),
                lastApply: row => lastWrittenIDs.has(row.id),
                lastSkipped: row => lastSkippedIDs.has(row.id)
            };
            const lastApplyID = () => session.lastApply?.id
                ?? session.rows.reduce((latest, row) => {
                    const record = isAppliedStatus(row.status) ? row.applied : undefined;
                    const run = record?.source === 'recorded' && !record.undoneAt ? record.run || 0 : 0;
                    return run > latest ? run : latest;
                }, 0);
            const recomputeApplyGroups = () => {
                const id = lastApplyID();
                lastWrittenIDs = new Set(id ? session.rows.filter(row => {
                    if (!isAppliedStatus(row.status))
                        return false;
                    const record = session.appliedOf(row);
                    return record?.run === id && !record.undoneAt;
                }).map(row => row.id) : []);
                lastSkippedIDs = new Set((session.lastApply?.skipped || []).filter(entry => entry.code !== 'alreadyApplied').map(entry => entry.id));
            };
            const lastApplyContext = () => {
                const id = lastApplyID();
                if (id && lastWrittenIDs.size) {
                    const at = session.rows.filter(row => lastWrittenIDs.has(row.id)).reduce((latest, row) => Math.max(latest, session.appliedOf(row)?.at || 0), 0);
                    return { lastApply: { at: at || undefined, rows: lastWrittenIDs.size } };
                }
                return { legacyApplied: session.rows.filter(row => isAppliedStatus(row.status)).length };
            };
            const writtenOver = (row: Row) => {
                const record = session.appliedOf(row);
                if (!record || record.undoneAt)
                    return null;
                return isAppliedStatus(row.status) || row.status === 'excluded' || !row.before || row.before.appliedMetadata ? record : null;
            };
            const writtenTitle = (row: Row): string | null => {
                const entry = writtenOver(row)?.fields.find(field => field.field === 'title');
                return entry && entry.kind !== 'cleared' && entry.kind !== 'typeLoss' ? String(entry.new ?? '') : null;
            };
            const shownTitleOf = (row: Row) => writtenTitle(row) ?? row.title;
            const renderApplyResult = () => {
                applyResult.replaceChildren();
                const appliedRows = session.rows.filter(row => isAppliedStatus(row.status));
                const legacy = appliedRows.filter(row => session.appliedOf(row)?.source !== 'recorded');
                let run: ApplyRun | undefined = session.lastApply;
                if (!run) {
                    const id = lastApplyID();
                    const rows = appliedRows.filter(row => lastWrittenIDs.has(row.id));
                    if (id && rows.length) {
                        const records = rows.map(row => session.appliedOf(row));
                        const at = records.reduce((latest, record) => Math.max(latest, record?.at || 0), 0);
                        run = { id, kind: 'apply', startedAt: at, endedAt: at, asked: rows.length, done: rows.map(row => row.id), fieldCounts: fieldCountsOf(records), skipped: [], failed: [], conflicts: [], stopped: false };
                    }
                }
                const undo = session.lastRun?.kind === 'undo' ? session.lastRun : undefined;
                const legacyLine = legacy.length ? legacyApplyLine(legacy.length, fieldCountsOf(legacy.map(row => session.appliedOf(row)))) : '';
                if (!run && !undo && !legacyLine) {
                    applyResult.style.display = 'none';
                    resultDetails.hidden = true;
                    return;
                }
                resultDetails.hidden = false;
                resultSummary.textContent = undo ? uiTemplate `최근 되돌리기 결과 · ${undo.done.length}개 항목 복원` : run ? uiTemplate `최근 적용 결과 · ${run.done.length}개 항목 변경` : uiTemplate `이전에 적용한 ${legacy.length}개 항목의 기록`;
                applyResult.style.display = '';
                applyResult.className = `apply-result${undo ? ' undo' : !run ? ' legacy' : ''}`;
                if (undo)
                    el('div', friendlyActionCopy(applyRunLine(undo)), applyResult).className = 'apply-line';
                if (run || !undo)
                    el('div', friendlyActionCopy(run ? applyRunLine(run) : legacyLine), applyResult).className = 'apply-line';
                const extra: string[] = run ? fieldBreakdown(run.fieldCounts, field => fieldLabels[field] || field) : [];
                if ((run || undo) && legacyLine)
                    extra.push(legacyLine);
                const failures = [...(undo?.failed || []), ...(undo?.conflicts || []).map(entry => ({ ...entry, reason: '적용 뒤 Zotero에서 편집돼 되돌리지 않았습니다' })),
                    ...(run?.failed || [])];
                if (!extra.length && !failures.length)
                    return;
                const more = el('details', '', applyResult) as any;
                more.open = applyDetailsOpen;
                more.ontoggle = () => { applyDetailsOpen = more.open; };
                el('summary', failures.length ? uiTemplate `필드별 내역 · 실패 ${failures.length}개` : uiText('필드별 내역'), more);
                for (const line of extra)
                    el('div', friendlyActionCopy(line), more).className = 'apply-sub';
                for (const failure of failures) {
                    const line = el('div', `${failure.key} — ${uiText(failure.reason).slice(0, 200)}`, more);
                    line.className = 'apply-failure';
                    line.title = uiText('누르면 이 행의 상세 비교를 엽니다.');
                    line.onclick = () => { selectedRowID = failure.id; detailOpen = true; render(); };
                }
            };
            const isVisible = (row: Row) => (filter === 'all'
                || (Object.prototype.hasOwnProperty.call(ROW_GROUPS, filter) ? ROW_GROUPS[filter](row) : evidenceOf(row).kind === filter))
                && matchesListQuery(listQuery, [shownTitleOf(row), String(row.recognized?.fields.title || '')]);
            const focusZoteroItem = (row: Row) => {
                if (focusTimer)
                    win.clearTimeout(focusTimer);
                focusTimer = win.setTimeout(async () => {
                    try {
                        const pane = Zotero.getMainWindow()?.ZoteroPane;
                        if (pane?.selectItem) {
                            await pane.selectItem(row.id, { noWindowRestore: true });
                            const itemView = pane.itemsView;
                            const rowIndex = itemView?.getRowIndexByID?.(row.id);
                            if (rowIndex !== false && rowIndex != null) {
                                if (itemView?._treebox?.scrollToRow)
                                    itemView._treebox.scrollToRow(rowIndex, true);
                                else
                                    itemView?.ensureRowIsVisible?.(rowIndex);
                            }
                        }
                    }
                    catch (e) {
                        Zotero.debug(`[PDF Metadata Refresh] Zotero item selection failed: ${String(e)}`);
                    }
                }, 140);
            };
            const setVisibleSelection = (checked: boolean) => {
                const eligible = session.rows.filter(row => isVisible(row) && isSelectable(row));
                markRows(eligible, 'checked', checked);
                const writable = checked ? eligible.filter(willWrite).length : 0;
                message.textContent = !eligible.length ? uiText('현재 보기에는 선택 가능한 단일 PDF 항목이 없습니다.')
                    : checked ? uiTemplate `현재 보기에서 ${eligible.length}개를 선택했습니다 — 그중 적용할 값이 있는 행 ${writable}개.`
                        : uiTemplate `현재 보기에서 ${eligible.length}개의 선택을 풀었습니다.`;
                render();
            };
            const setVisibleReportFlags = (flagged: boolean) => {
                const shown = session.rows.filter(isVisible);
                for (const row of markRows(shown, 'reportFlag', flagged))
                    saveRow(row);
                message.textContent = shown.length
                    ? uiTemplate `현재 보기의 ${shown.length}개 항목을 확인 필요로 ${flagged ? uiText('표시') : uiText('해제')}했습니다.`
                    : uiText('현재 보기에는 항목이 없습니다.');
                render();
            };
            let renderQueued = false;
            const scheduleRender = () => {
                if (renderQueued || shuttingDown || win.closed)
                    return;
                renderQueued = true;
                win.requestAnimationFrame(() => { if (renderQueued)
                    render(); });
            };
            function render() {
                renderQueued = false;
                if (shuttingDown || win.closed)
                    return;
                for (const b of buttons)
                    b.disabled = session.busy;
                markSortedHeads();
                recomputeApplyGroups();
                stopButton.disabled = !session.busy;
                stopButton.hidden = !session.busy;
                statusSummary.replaceChildren();
                const allGroup = el('div', '', statusSummary);
                allGroup.className = 'filter-overview';
                const allChip = el('button', uiTemplate `전체 ${session.rows.length}`, allGroup);
                allChip.className = `chip${filter === 'all' ? ' active' : ''}`;
                allChip.setAttribute('aria-pressed', String(filter === 'all'));
                allChip.onclick = () => { filter = 'all'; page = 0; selectedRowID = null; render(); };
                const grades = new Map<string, {
                    label: string;
                    note: string;
                    count: number;
                }>();
                const rowGrades = new Map<number, ReturnType<typeof evidenceOf>>();
                for (const row of session.rows) {
                    const grade = evidenceOf(row), held = grades.get(grade.kind);
                    rowGrades.set(row.id, grade);
                    grades.set(grade.kind, { ...grade, count: (held?.count || 0) + 1 });
                }
                const filterGroup = (label: string) => {
                    const group = el('div', '', statusSummary);
                    group.className = 'filter-group';
                    el('span', uiText(label), group).className = 'filter-caption';
                    const choices = el('div', '', group);
                    choices.className = 'filter-choices';
                    return { group, choices };
                };
                for (const definition of EVIDENCE_FILTER_GROUPS) {
                    const group = filterGroup(definition.label);
                    for (const kind of [...definition.kinds].sort((a, b) => evidenceSortRank(a) - evidenceSortRank(b))) {
                        const grade = grades.get(kind) || { ...EVIDENCE[kind], count: 0 };
                        if (!grade.count && filter !== kind)
                            continue;
                        const chip = el('button', `${evidenceLabel(kind)} ${grade?.count || 0}`, group.choices);
                        chip.className = 'chip evidence-' + kind + ' tone-' + evidenceTone(kind) + (filter === kind ? ' active' : '');
                        chip.title = friendlyActionCopy(EVIDENCE[kind as keyof typeof EVIDENCE]?.note || grade.note);
                        chip.setAttribute('aria-pressed', String(filter === kind));
                        chip.onclick = () => { filter = filter === kind ? 'all' : kind; page = 0; selectedRowID = null; render(); };
                    }
                    if (!group.choices.children.length)
                        group.group.remove();
                }
                const reviewGroup = filterGroup(uiText('검토·최근 작업'));
                const groupChip = (key: string, label: string, note: string) => {
                    const count = session.rows.filter(ROW_GROUPS[key]).length;
                    if (!count && filter !== key)
                        return;
                    const chip = el('button', `${uiText(label)} ${count}`, reviewGroup.choices);
                    const tone = key === 'rescanned' ? 'info' : key === 'lastApply' ? 'success' : 'attention';
                    chip.className = `chip group-${key} tone-${tone}${filter === key ? ' active' : ''}`;
                    chip.title = uiText(note);
                    chip.setAttribute('aria-pressed', String(filter === key));
                    chip.onclick = () => { filter = filter === key ? 'all' : key; page = 0; selectedRowID = null; render(); };
                };
                groupChip('storedDiffers', '기존과 다름', '새 인식이 기존 항목의 제목·저자·DOI·ISBN과 크게 다른 행입니다 — 적용은 평소와 같습니다. 많이 바뀐 항목을 직접 검토하려고 모아 보는 알림입니다.');
                groupChip('lastSkipped', '이번에 쓰지 않음', '마지막 「선택한 정보 적용」 때 체크돼 있었지만 쓸 것이 없어(체크한 필드 없음·권장하지 않는 필드뿐·이전 규칙으로 판정 등) 건드리지 않은 행입니다 — 체크가 남아 있습니다. 까닭별 개수는 아래 「마지막 적용」 줄에 있습니다.');
                groupChip('rescanned', '재검색', '「선택 항목 다시 찾기」로 다시 읽은 행입니다. 다시 읽은 행은 체크가 그대로 남습니다. 이 표시는 다음 「PDF 정보 찾기」를 누를 때 지워집니다.');
                groupChip('lastApply', '이번 적용', '마지막 「선택한 정보 적용」이 값을 기록한 행입니다 — 행을 열면 「적용한 값」(이전 값 → 새 값)이 보입니다. 되돌린 행은 빠집니다.');
                if (!reviewGroup.choices.children.length)
                    reviewGroup.group.remove();
                basicFilters.replaceChildren();
                const BASIC_FILTERS = [['all', '전체'], ['changes', '변경안 있음'], ['flagged', '나중에 볼 항목'], ['written', '적용한 항목']];
                for (const [key, label] of BASIC_FILTERS) {
                    const count = key === 'all' ? session.rows.length : session.rows.filter(ROW_GROUPS[key]).length;
                    const chip = el('button', `${uiText(label)} ${count}`, basicFilters);
                    chip.className = `basic-filter${filter === key ? ' active' : ''}`;
                    chip.setAttribute('aria-pressed', String(filter === key));
                    chip.title = key === 'changes' ? uiText('변경 제안이 남아 있는 항목입니다. 선택한 정보가 실제로 적용 가능한지는 따로 확인합니다.') : key === 'flagged' ? uiText('직접 「표시」 체크를 한 항목입니다. 적용 승인과는 관계없습니다.') : key === 'written' ? uiText('정보가 Zotero에 실제로 적용된 항목입니다.') : uiText('이 작업의 전체 항목을 봅니다.');
                    chip.onclick = () => { filter = key; page = 0; selectedRowID = null; render(); };
                }
                const basicFilter = BASIC_FILTERS.some(([key]) => key === filter);
                const selectedDetail = [...statusSummary.querySelectorAll('button')].find(node => node.getAttribute('aria-pressed') === 'true');
                classificationSummary.textContent = basicFilter ? uiText('상세 분류') : uiTemplate `분류: ${selectedDetail?.textContent || filter}`;
                renderApplyResult();
                for (const row of session.rows)
                    for (const change of row.changes) {
                        if (knownFields.has(change.field))
                            continue;
                        knownFields.add(change.field);
                        enabledFields.add(change.field);
                        const label = el('label', '', fieldGrid);
                        const checkbox = el('input', '', label);
                        checkbox.type = 'checkbox';
                        checkbox.checked = true;
                        checkbox.onchange = () => { if (checkbox.checked)
                            enabledFields.add(change.field);
                        else
                            enabledFields.delete(change.field); render(); };
                        el('span', ` ${fieldLabels[change.field] || change.field}`, label);
                    }
                const visibleEligible = session.rows.filter(row => isVisible(row) && isSelectable(row));
                const selectState = headerBoxState(visibleEligible, 'checked'), visibleChecked = selectState.ticked;
                selectAllBox.disabled = session.busy || !visibleEligible.length;
                selectAllBox.checked = selectState.checked;
                selectAllBox.indeterminate = selectState.indeterminate;
                const visibleRows = session.rows.filter(isVisible), flagState = headerBoxState(visibleRows, 'reportFlag');
                flagAllBox.disabled = !visibleRows.length;
                flagAllBox.checked = flagState.checked;
                flagAllBox.indeterminate = flagState.indeterminate;
                const applicable = visibleEligible.filter(willWrite).length;
                const checkedTotal = session.rows.filter(row => row.checked).length;
                const checkedHidden = checkedTotal - visibleChecked;
                const checkedWritable = session.rows.filter(row => row.checked && willWrite(row)).length;
                selectionCount.textContent = uiTemplate `선택 ${checkedTotal}개 · 적용할 변경 ${checkedWritable}개`;
                if (checkedHidden)
                    selectionCount.textContent += uiTemplate ` · 다른 보기에 ${checkedHidden}개 포함`;
                selectionCount.title = uiTemplate `현재 보기에서 선택 ${visibleChecked} / 선택 가능 ${visibleEligible.length}개 · 변경이 있는 항목 ${applicable}개`;
                const changesCount = session.rows.filter(ROW_GROUPS.changes).length, appliedCount = session.rows.filter(ROW_GROUPS.written).length;
                const pendingCount = session.rows.filter(row => row.status === 'pending').length;
                const guide = beginnerGuide({ items: session.rows.length || items.length, pending: pendingCount, changes: changesCount, applied: appliedCount, busy: session.busy, operation: session.metrics.operation });
                guidanceStep.textContent = uiTemplate `${guide.step}단계 · ${uiText(['정보 찾기', '변경 내용 확인', '선택한 정보 적용'][guide.step - 1])}`;
                guidanceHeading.textContent = guide.heading;
                guidanceBody.textContent = guide.body;
                guidanceSummary.textContent = overwriteBox.checked ? uiText('사용 안내 · 교체/삭제 제안 확인') : uiText('사용 안내 · 기존 값 유지');
                guidanceSummary.title = uiText('정보 찾기는 변경안만 만듭니다. 기존 정보는 적용 전에 비교하고 확인할 수 있습니다.');
                guidance.hidden = session.busy;
                header.classList.toggle('running', session.busy);
                actions.classList.toggle('review-ready', pendingCount !== session.rows.length || !!session.metrics.startedAt);
                for (const [index, step] of workflowSteps.entries()) {
                    step.classList.toggle('current', index + 1 === guide.step);
                    step.setAttribute('aria-current', index + 1 === guide.step ? 'step' : 'false');
                }
                startButton.disabled = session.busy || !session.rows.length;
                startButton.classList.toggle('primary', guide.step === 1);
                applyButton.disabled = session.busy || !checkedWritable;
                applyButton.hidden = pendingCount === session.rows.length && !session.metrics.startedAt;
                applyButton.title = checkedWritable ? uiTemplate `선택한 ${checkedTotal}개 중 실제로 적용할 변경이 있는 ${checkedWritable}개 항목에 기록합니다. 적용 전에 변경·추가·비우기 내역을 다시 확인합니다.` : uiText('변경안이 있는 항목을 선택하면 적용할 수 있습니다. 선택했어도 적용할 값이 없는 항목은 기록하지 않습니다.');
                undoButton.hidden = !appliedCount;
                actionNote.hidden = applyButton.hidden || !checkedTotal;
                actionNote.textContent = checkedWritable ? uiTemplate `선택한 ${checkedTotal}개 중 ${checkedWritable}개 항목에 변경을 적용합니다.${checkedHidden ? uiTemplate ` 다른 보기에 숨은 선택 ${checkedHidden}개도 포함됩니다.` : ''} 적용 전 변경 내용과 비우는 값을 확인하세요.` : changesCount ? uiText('적용할 항목을 「선택」 칸에서 체크하세요. 항목을 누르면 어떤 정보가 바뀌는지 볼 수 있습니다.') : uiText('현재 적용할 변경안이 없습니다. 항목을 눌러 찾기 결과를 확인하세요.');
                actionBlockers.hidden = applyButton.hidden || !checkedTotal || !!checkedWritable;
                if (!actionBlockers.hidden) {
                    const ticked = session.rows.filter(row => row.checked);
                    const codes = new Map(ticked.map(row => [row, applySkipCode(row, enabledFields)] as const));
                    const skippedCodes = [...codes.values()].filter((code): code is SkipCode => !!code);
                    const offFields = [...new Set(ticked.filter(row => codes.get(row) === 'fieldsOff')
                            .flatMap(row => row.changes.map(change => change.field).filter(field => !enabledFields.has(field) && row.fieldChoice?.[field] === undefined)))].map(field => fieldLabels[field] || field);
                    actionBlockerBody.textContent = friendlyActionCopy(applyBlockMessage(ticked.length, skippedCodes, { ...lastApplyContext(), offFields }));
                    actionNote.textContent = uiTemplate `${checkedTotal}개를 선택했지만 지금 적용할 변경은 없습니다. 아래에서 이유를 확인할 수 있어요.`;
                }
                policyNote.textContent = overwriteBox.checked ? uiText('새로 찾을 때: PDF에서 찾은 값으로 교체합니다. 읽은 결과에 없는 기존 값은 삭제 제안에 포함될 수 있습니다.') : uiText('새로 찾을 때: PDF에서 찾지 못한 정보는 기존 값을 유지합니다.');
                policyNote.title = uiText('이 기준은 다음에 읽는 항목에 적용됩니다. 이미 읽은 변경안은 당시의 설정을 유지합니다. 적용 전에 항목별 변경 내용을 확인할 수 있습니다.');
                policyNote.hidden = session.busy;
                selectionRow.title = uiText('「선택」 열 머리의 네모는 현재 분류와 제목 검색에 맞는 모든 페이지의 항목을 체크하거나 풉니다. 체크는 보기를 바꿔도 남고, 「선택 항목 다시 찾기」·「찾기에서 제외」·「선택한 정보 적용」은 체크한 항목 모두를 처리합니다. 「적용 되돌리기」는 체크한 적용 항목을(없으면 이 작업의 적용 항목 모두) 되돌립니다.');
                if (detailOpen && !session.rows.some(row => row.id === selectedRowID && isVisible(row)))
                    detailOpen = false;
                workspace.className = `workspace${detailOpen ? ' detail-open' : ''}`;
                detailPane.className = `card pane detail-pane${detailOpen ? ' open' : ''}`;
                detailToggle.textContent = detailOpen ? uiText('변경 내용 닫기') : uiText('변경 내용 확인');
                detailToggle.setAttribute('aria-expanded', String(detailOpen));
                detailToggle.disabled = !visibleRows.length;
                folder.textContent = uiTemplate `작업·복구 파일: ${session.path}`;
                folder.title = uiTemplate `인식 파이프라인 ${RECOGNITION_PIPELINE_VERSION}\n${session.path}`;
                fieldSummary.textContent = knownFields.size ? uiTemplate `기본으로 사용할 정보 (${enabledFields.size}/${knownFields.size}) · 항목에서 직접 선택한 정보는 이 설정보다 우선합니다` : uiText('아직 찾은 변경 정보가 없습니다');
                const methodsOn = METHOD_LABELS.filter(([key]) => session.methods[key]).length;
                settingsSummary.textContent = uiText('찾기 방법 및 설정');
                settingsSummary.title = uiTemplate `사용할 정보 ${enabledFields.size}/${knownFields.size}개 · 찾기 경로 ${methodsOn}/${METHOD_LABELS.length}개`;
                visionSummary.textContent = configuredVisionModel ? uiTemplate `사용 중 · ${configuredVisionModel}` : uiText('사용 안 함 · 모델을 설정하세요');
                visionSummary.classList.toggle('configured', !!configuredVisionModel);
                controls.classList.toggle('quiet', !message.textContent || (session.busy && !errorText));
                for (const node of fieldGrid.querySelectorAll('input'))
                    node.disabled = session.busy;
                for (const node of methodBoxes)
                    node.disabled = session.busy;
                overwriteBox.disabled = session.busy;
                const sortValue = (row: Row): string | number => sortKey === 'oldTitle' ? String(shownTitleOf(row) || '')
                    : sortKey === 'newTitle' ? String(row.recognized?.fields.title || '')
                        : sortKey === 'checked' ? (row.checked ? 0 : 1)
                            : sortKey === 'reportFlag' ? (row.reportFlag ? 0 : 1)
                                : sortKey === 'evidence' ? evidenceSortRank(rowGrades.get(row.id)!.kind) : 0;
                const visible = session.rows.filter(isVisible).sort((a, b) => {
                    const excluded = sortKey === 'evidence' ? 0 : Number(a.status === 'excluded') - Number(b.status === 'excluded');
                    if (excluded || !sortKey)
                        return excluded;
                    const x = sortValue(a), y = sortValue(b);
                    const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko');
                    return order * sortDirection;
                });
                const flaggedCount = session.rows.filter(row => row.reportFlag).length;
                reportButton.textContent = flaggedCount ? uiTemplate `나중에 볼 항목 저장 (${flaggedCount})` : uiText('나중에 볼 항목 저장');
                reportButton.disabled = !flaggedCount;
                for (const { size, chip } of pageSizeChips)
                    chip.className = `chip${size === pageSize ? ' active' : ''}`;
                viewSummary.textContent = uiTemplate `표시 ${visible.length} / 전체 ${session.rows.length}개`;
                resetView.disabled = filter === 'all' && !listQuery;
                for (const { size, chip } of pageSizeChips)
                    chip.setAttribute('aria-pressed', String(size === pageSize));
                page = Math.min(page, Math.max(0, Math.ceil(visible.length / pageSize) - 1));
                previous.disabled = page === 0;
                next.disabled = (page + 1) * pageSize >= visible.length;
                pageInfo.textContent = visible.length ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, visible.length)} / ${visible.length}` : uiText('0개');
                body.replaceChildren();
                if (!visible.length) {
                    const emptyRow = el('tr', '', body), emptyCell = el('td', '', emptyRow);
                    emptyCell.colSpan = 5;
                    emptyCell.className = 'list-empty';
                    el('strong', session.rows.length ? uiText('조건에 맞는 항목이 없습니다') : items.length ? uiTemplate `${items.length}개 항목에서 정보를 찾을 준비가 되었어요` : uiText('정리할 항목을 선택해 주세요'), emptyCell);
                    el('span', session.rows.length ? uiText('분류를 바꾸거나 제목 검색을 지워 다시 확인하세요.') : items.length ? uiText('위의 「PDF 정보 찾기」를 눌러 시작하세요. 자동으로 적용하지 않습니다.') : uiText('Zotero에서 PDF가 첨부된 항목을 선택하고 이 창을 다시 여세요.'), emptyCell);
                }
                displayedRows = visible.slice(page * pageSize, (page + 1) * pageSize);
                for (const row of displayedRows) {
                    const tr = el('tr', '', body);
                    tr.className = `result${selectedRowID === row.id ? ' selected' : ''}`;
                    const checkbox = el('input', '', el('td', '', tr));
                    checkbox.type = 'checkbox';
                    checkbox.checked = row.checked;
                    checkbox.disabled = session.busy || !isSelectable(row);
                    checkbox.onclick = (event: any) => event.stopPropagation();
                    checkbox.onchange = () => { row.checked = checkbox.checked; render(); };
                    tr.tabIndex = 0;
                    tr.setAttribute('aria-selected', String(selectedRowID === row.id));
                    checkbox.setAttribute('aria-label', uiTemplate `${shownTitleOf(row)} 선택`);
                    const flag = el('input', '', el('td', '', tr)) as any;
                    flag.type = 'checkbox';
                    flag.checked = !!row.reportFlag;
                    flag.title = uiText('나중에 다시 볼 항목을 표시합니다. 적용할 항목을 선택하는 체크와는 별개입니다. 「나중에 볼 항목 저장」으로 표시한 항목과 근거를 모을 수 있습니다.');
                    flag.setAttribute('aria-label', uiTemplate `${shownTitleOf(row)} 나중에 볼 항목 표시`);
                    flag.onclick = (event: any) => event.stopPropagation();
                    flag.onchange = () => { row.reportFlag = flag.checked; saveRow(row); render(); };
                    const grade = evidenceOf(row);
                    const evidenceCell = el('td', '', tr);
                    const evidenceBadge = el('span', evidenceLabel(grade.kind, row.status), evidenceCell);
                    evidenceBadge.className = `status-badge evidence-${grade.kind} tone-${evidenceTone(grade.kind)}`;
                    evidenceBadge.title = displayEvidenceNote(grade);
                    if (VISIBLE_STATUS.has(row.status))
                        el('span', labels[row.status] || row.status, evidenceCell).className = 'row-status';
                    if (row.storedDifference?.fields.length && !isAppliedStatus(row.status)) {
                        const line = el('span', uiTemplate `기존과 다름: ${row.storedDifference.fields.map(field => uiText(DIFFERING_FIELD_LABEL[field] || field)).join('·')}`, evidenceCell);
                        line.className = 'stored-differs';
                        line.title = uiText('새 인식이 기존 항목과 크게 다른 칸입니다. 적용은 평소와 같습니다 — 상세 비교에 기존 값과 새 값이 있습니다.');
                    }
                    const shownTitle = writtenTitle(row);
                    const oldTitle = el('td', '', tr);
                    appendScientificText(shownTitle ?? row.title, oldTitle);
                    const newTitle = el('td', '', tr);
                    if (shownTitle !== null)
                        oldTitle.title = uiTemplate `적용한 제목입니다 — 적용 전 제목: ${row.title}`;
                    const proposed = String(row.recognized?.fields.title || '');
                    const cell = titleCell(row);
                    if (cell.kept) {
                        const kept = el('span', uiText('기존 제목 유지'), newTitle);
                        kept.className = 'kept-badge';
                        if (cell.otherLanguage) {
                            const other = el('span', uiText('다른 언어 표기'), newTitle);
                            other.className = 'kept-badge';
                            other.title = uiTemplate `이 문헌의 다른 언어 제목입니다 — 「${cell.shown}」. 본문의 언어를 따라 기존 제목을 씁니다.`;
                        }
                        else {
                            const rejected = el('span', '', newTitle);
                            rejected.className = 'rejected-title';
                            rejected.title = uiText('판독 결과 — 채택하지 않음');
                            appendScientificText(cell.shown, rejected);
                        }
                    }
                    else
                        appendScientificText(cell.shown, newTitle);
                    const raw = String(row.rawRecognized?.fields.title || '');
                    const reason = row.advice?.title || row.verification?.title?.note || '';
                    newTitle.title = [raw && raw !== proposed ? uiTemplate `원본 응답: ${raw}` : '', uiText(reason)].filter(Boolean).join(String.fromCharCode(10));
                    const appliedFields = isAppliedStatus(row.status) ? session.appliedOf(row)?.fields : undefined;
                    evidenceBadge.title = appliedFields
                        ? [displayEvidenceNote(grade), uiTemplate `적용한 필드 ${appliedFields.length}개: ${appliedFields.map(entry => `${fieldLabels[entry.field] || entry.field}(${uiText(APPLIED_KIND_LABEL[entry.kind])})`).join(' · ')}`].join(String.fromCharCode(10))
                        : [displayEvidenceNote(grade), labels[row.status] || row.status, ...(row.match?.reasons || []).map(uiText), ...Object.values(row.verification || {}).map(v => (fieldLabels[v.field] || v.field) + ': ' + uiText(v.note))].filter(Boolean).join(String.fromCharCode(10));
                    tr.onclick = () => { selectedRowID = row.id; detailOpen = true; appliedLive.delete(row.id); focusZoteroItem(row); render(); };
                    tr.onkeydown = (event: any) => {
                        if (event.target !== tr || !['Enter', ' '].includes(event.key))
                            return;
                        event.preventDefault();
                        tr.onclick();
                    };
                }
                if (detailOpen)
                    renderDetail(session.rows.find(row => row.id === selectedRowID));
                updateDashboard();
                win.requestAnimationFrame(applyTitleWidths);
            }
            const popovers = [guidance, settingsPanel, progressDetails, resultDetails, selectionTools, listHelp, classificationDetails];
            for (const popover of popovers)
                popover.ontoggle = () => {
                    if (popover.open)
                        for (const other of popovers)
                            if (other !== popover)
                                other.open = false;
                };
            doc.addEventListener('click', (event: any) => {
                for (const popover of popovers)
                    if (popover.open && !popover.contains(event.target))
                        popover.open = false;
            });
            doc.addEventListener('keydown', (event: any) => {
                if (event.key !== 'Escape')
                    return;
                const open = popovers.find(popover => popover.open);
                if (open) {
                    open.open = false;
                    open.querySelector('summary')?.focus();
                    event.preventDefault();
                }
            });
            session.onChange = scheduleRender;
            timer = win.setInterval(updateDashboard, 1000);
            win.addEventListener('unload', () => win.clearInterval(timer), { once: true });
            render();
        }
        catch (e) {
            Zotero.logError(e);
            const root = win.document.getElementById('batch-root');
            if (root)
                root.textContent = uiTemplate `배치 UI 초기화 실패: ${uiText(String(e))}`;
            if (timer)
                win.clearInterval(timer);
        }
    };
    win.addEventListener('DOMContentLoaded', mount);
    win.addEventListener('load', mount);
    if (win.document.readyState !== 'loading')
        mount();
    return win;
}

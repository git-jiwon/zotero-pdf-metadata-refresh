import type { FieldChange, MetadataSnapshot } from '../types';
import type { Match } from '../metadata/match';
import type { PublicationSafety } from '../metadata/publication-state';
import type { SearchCandidate } from '../recognition/korean-auto';
import type { ApprovalState } from './approval';
import type { EvidenceBundle, FieldVerification } from './evidence';
import type { RestoreRecord } from './restore-step';
import type { GateRecord } from './restore-gate';
import type { FieldConflict } from '../restore/link';
import type { Completion } from './completion';
import type { StoredDifference } from './stored-difference';
import type { AppliedRecord } from './applied-record';
export interface RecognitionMethods {
    native: boolean;
    identifiers: boolean;
    searchRestore: boolean;
}
export const DEFAULT_METHODS: RecognitionMethods = { native: true, identifiers: true, searchRestore: true };
export type Status = 'pending' | 'ready' | 'review' | 'mismatch' | 'protected' | 'publishedKept' | 'noChanges' | 'noPDF' | 'multiplePDFs' | 'missingFile' | 'textlessPDF' | 'noMatch' | 'failed' | 'applying' | 'updated' | 'undone' | 'excluded';
export interface Row {
    independentMetadata?: boolean;
    replaceMetadata?: boolean;
    rawRecognized?: MetadataSnapshot;
    lookupUnreachable?: boolean;
    lookupNotes?: Array<{
        kind: string;
        value: string;
        outcome: string;
        reason: string;
    }>;
    ocrRead?: boolean;
    attempts?: string[];
    reportFlag?: boolean;
    rescannedAt?: number;
    storedDifference?: StoredDifference;
    applied?: AppliedRecord;
    id: number;
    key: string;
    libraryID: number;
    title: string;
    status: Status;
    checked: boolean;
    changes: FieldChange[];
    before?: MetadataSnapshot;
    recognized?: MetadataSnapshot;
    error?: string;
    match?: Match;
    safety?: PublicationSafety;
    recognitionSource?: string;
    candidates?: SearchCandidate[];
    koreanAttempted?: boolean;
    verifiedPDF?: boolean;
    patentPDF?: boolean;
    technicalPDF?: boolean;
    identifierPDF?: boolean;
    pdfFingerprint?: string;
    cacheState?: 'hit' | 'miss' | 'refreshed';
    fieldChoice?: Record<string, boolean>;
    fieldEdit?: Record<string, string>;
    advice?: Record<string, string>;
    manualReview?: boolean;
    authoritative?: boolean;
    recognizedWith?: string;
    staleGeneration?: string;
    reloadError?: string;
    standalonePDF?: boolean;
    createdParentID?: number;
    attachmentKey?: string;
    evidence?: EvidenceBundle;
    approvals?: ApprovalState['approvals'];
    protections?: ApprovalState['protections'];
    verification?: Record<string, FieldVerification>;
    coverProposal?: CoverProposalRecord;
    restore?: RestoreRecord;
    fieldConflicts?: FieldConflict[];
    restoreGate?: GateRecord[];
    selection?: Array<{
        candidate: 'identifierRecord' | 'officialRecord' | 'nativeRecognizer' | 'coverReading' | 'searchRestore';
        chosen: boolean;
        reason: string;
    }>;
    completion?: Completion;
}
export interface CoverProposalRecord {
    sources: Record<string, unknown>;
    alternatives: Record<string, unknown>;
    notStorable: Array<{
        field: string;
        value: unknown;
        reason: string;
    }>;
    official?: {
        doi: string;
        ok: boolean;
        bound: boolean;
        reason: string;
        added: string[];
        corrections?: unknown[];
        conflicts?: unknown[];
        notes?: string[];
    } | null;
    used: boolean;
    fields?: Record<string, unknown>;
    itemType?: string | null;
    typeRead?: boolean;
    pagesRead: number;
    documentPages?: number | null;
    ocr?: {
        provider: string;
        pages: number;
        cacheHit: boolean;
    } | null;
}
export interface RunMetrics {
    operation: string;
    startedAt: number;
    endedAt: number;
    total: number;
    completed: number;
    currentTitle: string;
    lastItemMs: number;
}
export type EvidenceKind = 'applied' | 'excluded' | 'noPDF' | 'multiplePDFs' | 'missingFile' | 'unread' | 'pending' | 'stopped' | 'failed' | 'preprintKept' | 'identifier' | 'catalogue' | 'webPage' | 'documentRead' | 'none';
export interface EvidenceGrade {
    kind: EvidenceKind;
    label: string;
    note: string;
}
export const EVIDENCE: Record<EvidenceKind, {
    label: string;
    note: string;
}> = {
    applied: { label: '적용됨', note: '이 행의 값은 이미 항목에 기록됐습니다. 행을 열면 적용한 값(이전 값 → 새 값)과 쓰지 않은 제안이 보입니다.' },
    excluded: { label: '제외', note: '이 PDF는 스캔 대상에서 빠져 있습니다. 파일이 바뀌면 자동으로 다시 대상이 됩니다.' },
    noPDF: { label: 'PDF 없음', note: '읽을 파일이 붙어 있지 않습니다. 서지만 있고 첨부가 없는 항목입니다.' },
    multiplePDFs: { label: 'PDF 여러 개', note: '본문으로 볼 PDF가 둘 이상 붙어 있어 어느 것을 읽을지 정하지 못했습니다. 보조자료로 보이는 파일은 이미 뺐습니다 — 본문 PDF 하나만 남기면 읽습니다.' },
    missingFile: { label: '파일 없음', note: 'PDF 첨부는 있는데 파일이 디스크에 없습니다. 파일을 다시 연결하면 읽습니다.' },
    unread: { label: '읽지 못함', note: '파일은 있는데 글자를 얻지 못했습니다 — 스캔 이미지이거나 파일이 손상됐거나, 이미지 판독이 닿지 못했습니다.' },
    pending: { label: '대기', note: '아직 읽지 않았습니다. 「검색」을 누르면 이 행을 읽습니다.' },
    stopped: { label: '중지', note: '읽는 도중에 멈췄습니다. 멈추기 전까지 얻은 값은 쓰지 않고, 이어서 실행하면 처음부터 다시 읽습니다.' },
    failed: { label: '오류', note: '검색이나 적용이 오류로 끝났습니다. 오류 내용은 상세 비교에 있고, 다시 실행할 수 있습니다.' },
    preprintKept: { label: '출판본 확인', note: '판독이 Research Square 사전출판본에 머물렀고 최종 출판본을 찾지 못했습니다. 이미 출판된 기록을 덮지 않도록 모든 칸의 체크를 풀어 두었습니다 — 최종 출판본의 주소를 「주소로 인식」에 붙여 넣거나, 상세 비교에서 직접 고르세요.' },
    identifier: { label: '식별자 확인', note: '문서에 인쇄된 DOI·ISBN이 공식 레코드로 풀렸습니다. 남는 물음은 그 식별자가 이 문서의 것인가뿐입니다 — 책 소개란에 실린 남의 ISBN을 집는 경우가 있습니다.' },
    catalogue: { label: '카탈로그 확인', note: 'RISS·KCI·DBpia·Crossref가 제목과 저자로 일치를 찾았습니다. 레코드는 이 문헌의 것일 가능성이 높지만, 판본까지 같은지는 따로 봅니다.' },
    webPage: { label: '웹 페이지', note: '검색이 찾은 페이지를 읽었습니다. 그 페이지가 이 문헌의 것인지는 페이지가 스스로 밝히는 만큼만 확실합니다.' },
    documentRead: { label: '문서 판독', note: '쪽 자체를 읽었습니다 — 텍스트층이거나 비전 OCR입니다. 다른 무엇과도 대조되지 않았으므로 가장 집중해서 볼 부류입니다.' },
    none: { label: '근거 없음', note: '찾아본 곳 어디에서도 이 문헌의 레코드가 나오지 않았습니다.' }
};
const WEB_PAGE_PROVIDER = /google|yes24|aladin|kyobo|interpark/i;
const CATALOGUE_SOURCE = /학위논문 RISS 우선 검색|국내 제목 검색|^Zotero native PDF recognizer|카탈로그 검색|OCR → 카탈로그 확인|(?:RISS|KCI|DBpia|Crossref|OpenLibrary)(?:\s*:| 검색)/;
const STRUCTURE_PARSE = /OCR에서 (?:KIPO|기술문서|학위논문·보고서)/;
const IDENTIFIER_SOURCE = /OCR → 식별자 서지정보 확인|OCR의 (?:DOI|ISBN)와 제목을 Zotero 검색 결과와 교차 확인|PDF 식별자 → Zotero 식별자 검색|PDF에 인쇄된 (?:DOI|ISBN)/;
const DOCUMENT_SOURCE = /직접 분석|구조 분석|문서 판독|OCR/;
export function evidenceOf(row: Pick<Row, 'authoritative' | 'identifierPDF' | 'recognitionSource' | 'ocrRead' | 'restore' | 'recognized' | 'candidates' | 'evidence' | 'status'> & Partial<Pick<Row, 'error'>>): EvidenceGrade {
    const status = String((row as any).status || '');
    const graded = (kind: EvidenceKind, note = EVIDENCE[kind].note): EvidenceGrade => ({ kind, label: EVIDENCE[kind].label, note });
    if (status === 'updated' || status === 'applying')
        return graded('applied');
    if (status === 'excluded')
        return graded('excluded');
    if (status === 'noPDF')
        return graded('noPDF');
    if (status === 'multiplePDFs')
        return graded('multiplePDFs');
    if (status === 'missingFile')
        return graded('missingFile');
    if (status === 'textlessPDF')
        return graded('unread');
    if (status === 'pending')
        return graded(/^중지/.test(String(row.error || '')) ? 'stopped' : 'pending');
    if (status === 'failed')
        return graded('failed', row.error ? '오류: ' + String(row.error).slice(0, 300) : EVIDENCE.failed.note);
    if (status === 'publishedKept' || status === 'protected')
        return graded('preprintKept');
    const source = String(row.recognitionSource || '');
    const target = row.restore?.target;
    const identity = row.evidence?.identity;
    const identityStands = !!identity && identity.kind !== 'none'
        && (!!row.authoritative || identity.corroboration === 'printedInDocument' || identity.corroboration === 'suppliedByUser');
    const byIdentifier = identityStands || (!!row.identifierPDF && !!row.authoritative) || !!target?.identifierMatch
        || (!target && IDENTIFIER_SOURCE.test(source));
    const catalogueSource = CATALOGUE_SOURCE.test(source) && !STRUCTURE_PARSE.test(source);
    const linkedBy = target?.provider || [...source.matchAll(/(?:검색 복원|사용자가 선택한 후보) → (\S+)/g)].pop()?.[1] || '';
    const kind: EvidenceKind = byIdentifier ? 'identifier'
        : linkedBy ? (WEB_PAGE_PROVIDER.test(linkedBy) ? 'webPage' : 'catalogue')
            : catalogueSource ? 'catalogue'
                : row.ocrRead || row.evidence?.observations?.some(o => ['pdfText', 'ocrText'].includes(o.kind)) || DOCUMENT_SOURCE.test(source) ? 'documentRead'
                    : 'none';
    const printed = identity && identity.kind !== 'none' ? identity.kind + ': ' + identity.value
        : row.recognized?.fields?.DOI ? 'DOI: ' + row.recognized.fields.DOI
            : row.recognized?.fields?.ISBN ? 'ISBN: ' + row.recognized.fields.ISBN : '';
    const details = kind === 'identifier' ? [printed, source].filter(Boolean).join(' · ')
        : target ? [target.provider, target.url, target.rule, ...target.evidence].join(' · ')
            : kind === 'catalogue' || kind === 'webPage' ? source
                : row.recognized ? source + ' · 외부 레코드 연결 근거 없음' : '인식된 레코드 없음';
    return graded(kind, details);
}

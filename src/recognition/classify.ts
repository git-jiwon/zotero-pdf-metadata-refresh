import { reflowFlattenedFrontMatter } from './reflow';
import { DEGREE_LABEL } from './title-guards';
import { DEGREE_STATEMENT } from './degree';
import { codesOf, readPageStructure, type PageStructure } from './page-structure';
export type DocumentType = 'thesis' | 'journalArticle' | 'book' | 'datasheet' | 'manual' | 'technicalReport' | 'governmentReport' | 'standard' | 'unknown';
export interface DocumentEvidence {
    text: string;
    front: string;
    pages: string[][];
    lines: string[];
    numPages?: string;
}
export interface Classification {
    type: DocumentType;
    score: number;
    evidence: string[];
}
const clean = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
export function documentEvidence(text: string, numPages?: string, frontPages = 5): DocumentEvidence {
    const normalized = reflowFlattenedFrontMatter(String(text || '').normalize('NFKC').slice(0, 160000));
    const pages = normalized.split('\f').map(page => page.replace(/\r\n?/g, '\n').split('\n').map(clean).filter(Boolean));
    const front = pages.slice(0, frontPages).map(page => page.join('\n')).join('\n\f\n');
    return { text: normalized, front, pages, lines: pages.slice(0, frontPages).flat(), numPages };
}
interface Signal {
    weight: number;
    pattern?: RegExp;
    label: string;
    present?: (evidence: DocumentEvidence) => boolean;
}
function score(evidence: DocumentEvidence, signals: Signal[], saturation: number): {
    score: number;
    evidence: string[];
} {
    let total = 0;
    const found: string[] = [];
    for (const signal of signals) {
        if (!signal.pattern?.test(evidence.front) && !signal.present?.(evidence))
            continue;
        total += signal.weight;
        found.push(signal.label);
    }
    return { score: Math.min(1, total / saturation), evidence: found };
}
function statesItsNumber(evidence: DocumentEvidence): boolean {
    const structure = frontStructure(evidence);
    return !!structure && codesOf(structure).some(code => code.kind === 'documentNumber');
}
const frontStructures = new WeakMap<DocumentEvidence, PageStructure | null>();
function frontStructure(evidence: DocumentEvidence): PageStructure | null {
    if (!evidence || typeof evidence !== 'object')
        return null;
    if (frontStructures.has(evidence))
        return frontStructures.get(evidence) ?? null;
    const pages = String(evidence.front ?? '').split('\n\f\n').filter(page => page.trim());
    const structure = pages.length ? readPageStructure({ pages: pages.map((text, index) => ({ page: index + 1, layer: { text } })) }) : null;
    frontStructures.set(evidence, structure);
    return structure;
}
function hasAColophon(evidence: DocumentEvidence): boolean {
    const structure = frontStructure(evidence);
    return !!structure && structure.pages.some(entry => entry.role === 'colophon');
}
const THESIS: Signal[] = [
    { weight: 5, pattern: DEGREE_LABEL, label: '학위논문 표기' },
    { weight: 5, pattern: /\b(?:master'?s\s+thesis|doctoral\s+(?:thesis|dissertation)|a\s+dissertation\s+submitted)\b/i, label: 'degree statement' },
    { weight: 5, pattern: DEGREE_STATEMENT, label: 'degree statement' },
    { weight: 3, pattern: /지도\s*(?:교수|敎授)|指導\s*(?:教|敎)?授|\b(?:thesis\s+)?(?:advisor|supervisor|directors?)\b|director(?:es)?\s+del?\s+(?:la\s+)?(?:tesis|trabajo)|directeur\s+de\s+th[èe]se|betreuer/i, label: '지도교수' },
    { weight: 3, pattern: /대학원|大學院|\bgraduate\s+school\b/i, label: '대학원' },
    { weight: 3, pattern: /이\s*(?:논문|論文)을.{0,60}(?:학위|學位)\s*(?:논문|論文)/, label: '학위논문 제출문' },
    { weight: 2, pattern: /심사위원|審査委員|주심|부심|\bcommittee\s+member\b/i, label: '심사위원' },
    { weight: 2, pattern: /학위\s*수여|을\s*인정함|를\s*인준함/, label: '학위 인준' }
];
const JOURNAL: Signal[] = [
    { weight: 5, pattern: /[\p{L}][\p{L}.&'’\s-]{3,60}?\s*\d{1,4}\s*\(\s*(?:1[5-9]|20)\d{2}\s*\)\s*[:,]?\s*\d{1,6}\s*[-–—]\s*\d{1,6}/u, label: '학술지 자기인용' },
    { weight: 4, pattern: /제\s*\d+\s*권|\bVol\.?\s*\d+\b/i, label: '권 표기' },
    { weight: 3, pattern: /제\s*\d+\s*호|\bNo\.?\s*\d+\b/i, label: '호 표기' },
    { weight: 3, pattern: /\bpp?\.?\s*\d+\s*[-–~]\s*\d+|(?<!\d)\d+\s*[-–~]\s*\d+\s*(?:쪽|면)/i, label: '페이지 범위' },
    { weight: 4, pattern: /\b[pe]?ISSN\s*[:：]?\s*\d{4}\s*-\s*\d{3}[\dX]\b/i, label: 'ISSN' },
    { weight: 4, pattern: /\b\d{1,3}\s*\(\s*\d{1,3}\s*\)\s*[;:,]\s*\d{1,4}\s*[-–~]\s*\d{1,4}/, label: '권(호); 페이지' },
    { weight: 3, pattern: /\b(?:ORIGINAL|RESEARCH|REVIEW)\s+ARTICLE\b/i, label: '논문 구분' },
    { weight: 3, pattern: /학회지|학회논문지|논문집|학술지|회지|\bJournal\b|\bTransactions\b/i, label: '학술지명' },
    { weight: 2, pattern: /접수일|게재\s*확정|심사\s*완료|\breceived\b.{0,40}\baccepted\b/i, label: '투고·게재일' },
    { weight: 2, pattern: /\bdoi\s*[:：]?\s*10\.\d{4,9}\//i, label: 'DOI' }
];
const BOOK: Signal[] = [
    { weight: 5, pattern: /\bISBN\b\s*[:：]?\s*(?:97[89][-\s]?)?[\d-]{9,17}[\dXx]/, label: 'ISBN' },
    { weight: 3, pattern: /초판\s*(?:\d+\s*쇄|발행|인쇄)|제\s*\d+\s*판\s*발행|(?<!\d)\d+\s*쇄\s*발행/, label: '판·쇄 발행' },
    { weight: 3, pattern: /발행인|발행처|펴낸이|펴낸곳|지은이|엮은이|옮긴이/, label: '판권지' },
    { weight: 3, pattern: /\b(?:published\s+by|first\s+(?:published|edition)|all\s+rights\s+reserved)\b/i, label: 'imprint' },
    { weight: 2, pattern: /목\s*차|차\s*례|\btable\s+of\s+contents\b|\bcontents\b/i, label: '목차' },
    { weight: 2, pattern: /머리말|서문|저자\s*소개|\bpreface\b|\bforeword\b/i, label: '서문' },
    { weight: 2, pattern: /제\s*\d+\s*장|\bchapter\s+\d+\b/i, label: '장 구성' },
    { weight: 4, label: '판권면', present: hasAColophon },
    { weight: 3, pattern: /\be-?edition\b|\breprinted\b|\b(?:second|third|fourth|fifth|sixth|\d+(?:st|nd|rd|th))\s+edition\b/i, label: '판차 표기' }
];
const DATASHEET: Signal[] = [
    { weight: 5, pattern: /\bdata\s*sheet\b|데이터\s*시트|규격서|사양서/i, label: 'data sheet' },
    { weight: 4, pattern: /\babsolute\s+maximum\s+ratings\b|절대\s*최대\s*정격/i, label: 'absolute maximum ratings' },
    { weight: 4, pattern: /\belectrical\s+characteristics\b|전기적\s*특성/i, label: 'electrical characteristics' },
    { weight: 3, pattern: /\bordering\s+information\b|\bpart\s+number\b|주문\s*정보|품번/i, label: 'ordering information' },
    { weight: 3, pattern: /\bpin\s+(?:configuration|description|assignment)\b|핀\s*배치/i, label: 'pin configuration' },
    { weight: 2, pattern: /\bfeatures\b\s*$|\btypical\s+applications?\b|\bblock\s+diagram\b/im, label: 'features/applications' },
    { weight: 2, pattern: /\bRev\.?\s*[A-Z0-9.]+\b|\bRevision\s+history\b/i, label: 'revision' }
];
const MANUAL: Signal[] = [
    { weight: 5, pattern: /\b(?:user|owner'?s|operating|operation|instruction|installation|service|maintenance)\s+(?:manual|guide|handbook)\b/i, label: 'manual title' },
    { weight: 5, pattern: /사용\s*설명서|취급\s*설명서|사용자\s*설명서|사용자\s*안내서|운전\s*지침|설치\s*안내|정비\s*지침|매뉴얼/, label: '설명서 표기' },
    { weight: 3, pattern: /\b(?:safety\s+(?:precautions|instructions|warnings)|before\s+(?:use|operation))\b|안전\s*주의사항|사용\s*전\s*확인/i, label: '안전 주의사항' },
    { weight: 3, pattern: /\btroubleshooting\b|고장\s*진단|이상\s*조치|문제\s*해결/i, label: 'troubleshooting' },
    { weight: 2, pattern: /\bspecifications?\b|제품\s*사양|규격/i, label: 'specifications' },
    { weight: 2, pattern: /\bwarranty\b|보증\s*(?:서|기간|규정)/i, label: 'warranty' },
    { weight: 2, pattern: /\bmodel\s*(?:no\.?|number)\b|모델\s*명|형식\s*명/i, label: 'model number' }
];
const TECHNICAL_REPORT: Signal[] = [
    { weight: 5, pattern: /\bapplication\s+note\b|응용\s*노트|기술\s*자료|기술\s*보고서|기술\s*문서/i, label: '기술문서 표기' },
    { weight: 4, pattern: /시험\s*성적서|분석\s*보고서|측정\s*보고서|검사\s*성적서/, label: '시험·분석 보고서' },
    { weight: 3, pattern: /동향\s*(?:리포트|보고서|분석)|기술\s*동향|시장\s*동향/, label: '동향 보고서' },
    { weight: 3, pattern: /문서\s*번호|자료\s*번호/, present: statesItsNumber, label: '문서번호' },
    { weight: 3, pattern: /작성자|작성\s*년\s*월\s*일|작성기관|작성일/, label: '작성자·작성일' },
    { weight: 2, pattern: /연구원|기술원|연구소|산업기술|\bInstitute\b|\bLaborator(?:y|ies)\b/i, label: '연구기관' },
    { weight: 4, pattern: /^\s*Source\(s\)\s*[:：]/im, label: 'figure source note' },
    { weight: 3, pattern: /^\s*Note\(s\)\s*[:：]/im, label: 'figure note' },
    { weight: 3, pattern: /\b(?:INDUSTRIES\s*&\s*MARKETS|MARKET\s+(?:REPORT|INSIGHTS|OUTLOOK)|INDUSTRY\s+(?:REPORT|OVERVIEW)|market\s+dossier)\b/i, label: '시장 보고서 표제' }
];
const GOVERNMENT_REPORT: Signal[] = [
    { weight: 5, pattern: /발간\s*등록\s*번호|정책\s*연구\s*\d{4}|과제\s*고유\s*번호/, label: '발간등록번호' },
    { weight: 4, pattern: /주관\s*연구\s*기관|연구\s*책임자|위탁\s*연구\s*기관|연구\s*수행\s*기관/, label: '연구책임 구조' },
    { weight: 4, pattern: /최종\s*보고서|결과\s*보고서|연차\s*보고서|사업\s*보고서/, label: '보고서 유형' },
    { weight: 3, pattern: /제\s*출\s*문|귀하\s*$|을\s*제출합니다/m, label: '제출문' },
    { weight: 3, pattern: /환경부|국립환경과학원|산업통상자원부|과학기술정보통신부|보건복지부|한국환경공단/, label: '정부기관' },
    { weight: 2, pattern: /요약문|국문\s*요약|영문\s*요약|\bsummary\b/i, label: '요약문' }
];
const STANDARD: Signal[] = [
    { weight: 5, pattern: /\bKS\s*[A-Z]\s*\d{4}\b|\bISO(?:\/IEC)?\s*\d{3,5}\b|\bIEC\s*\d{5}\b|\bASTM\s*[A-Z]\d{2,4}\b/i, label: '규격번호' },
    { weight: 4, pattern: /\[별표\s*\d+\]|<개정\s*(?:19|20)\d{2}|고시\s*제\s*\d+\s*-\s*\d+\s*호/, label: '법령 별표·고시' },
    { weight: 3, pattern: /규칙|규정|시행령|시행규칙|기준\s*및\s*검사/, label: '법령 표기' },
    { weight: 3, pattern: /\bstandard\s+(?:specification|test\s+method)\b|표준\s*시험\s*방법/i, label: 'standard method' }
];
const CLASSIFIERS: Array<{
    type: DocumentType;
    signals: Signal[];
    saturation: number;
}> = [
    { type: 'thesis', signals: THESIS, saturation: 11 },
    { type: 'journalArticle', signals: JOURNAL, saturation: 11 },
    { type: 'book', signals: BOOK, saturation: 11 },
    { type: 'datasheet', signals: DATASHEET, saturation: 12 },
    { type: 'manual', signals: MANUAL, saturation: 11 },
    { type: 'technicalReport', signals: TECHNICAL_REPORT, saturation: 11 },
    { type: 'governmentReport', signals: GOVERNMENT_REPORT, saturation: 12 },
    { type: 'standard', signals: STANDARD, saturation: 9 }
];
export function classifyDocument(evidence: DocumentEvidence): Classification[] {
    return CLASSIFIERS
        .map(({ type, signals, saturation }) => ({ type, ...score(evidence, signals, saturation) }))
        .sort((a, b) => b.score - a.score);
}
export const MINIMUM_TYPE_SCORE = 0.45;
export const MINIMUM_TYPE_MARGIN = 0.1;
export function leadingType(ranked: Classification[]): Classification {
    const [best, second] = ranked;
    if (!best || best.score < MINIMUM_TYPE_SCORE)
        return { type: 'unknown', score: best?.score || 0, evidence: best?.evidence || [] };
    if (second && best.score - second.score < MINIMUM_TYPE_MARGIN) {
        return { type: 'unknown', score: best.score, evidence: [...best.evidence, `${best.type}·${second.type} 유형 구분 불충분`] };
    }
    return best;
}

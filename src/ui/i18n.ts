import { EN_DIAGNOSTIC_ARGUMENTS, EN_TEXT } from './i18n-en';
import { EN_DIAGNOSTICS_SECURITY } from './i18n-en-diagnostics-security';
export function uiLocale(): 'ko' | 'en' {
    const host = typeof Zotero !== 'undefined' ? Zotero.locale : undefined;
    const fallback = typeof Services !== 'undefined' ? Services.locale?.appLocaleAsBCP47 : undefined;
    const locale = String(host || fallback || '').trim().toLowerCase().replaceAll('_', '-');
    return locale.split('-')[0] === 'ko' ? 'ko' : 'en';
}
const englishCopy: Readonly<Record<string, string>> = { ...EN_TEXT, ...EN_DIAGNOSTICS_SECURITY };
const interpolate = (template: string, values: readonly unknown[]) => template.replace(/\{(\d+)\}/g, (token, index: string) => Number(index) < values.length ? String(values[Number(index)]) : token);
export function uiTemplate(parts: TemplateStringsArray, ...values: unknown[]): string {
    const source = parts.reduce((text, part, index) => text + (index ? `{${index - 1}}` : '') + part, '');
    return interpolate(uiLocale() === 'en' ? englishCopy[source] ?? source : source, values);
}
const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
type TextPattern = {
    source: string;
    translated: string;
    regex: RegExp;
    prefix: string;
    indexes: number[];
};
const destinationCopy = (text: string) => text
    .replaceAll('「설정과 도구」', '「찾기 방법 및 설정」')
    .replaceAll('「선택 재검색」', '「선택 항목 다시 찾기」')
    .replaceAll('「적용됨」·「이번 적용」 칩', '「적용한 항목」과 상세 분류의 「이번 적용」')
    .replaceAll('「적용됨」 칩', '「적용한 항목」 분류').replaceAll('「적용됨」', '「적용한 항목」')
    .replaceAll('「마지막 적용」 줄', '펼친 「최근 적용 결과」의 내역')
    .replaceAll('「마지막 되돌리기」 줄', '펼친 「최근 되돌리기 결과」의 내역')
    .replaceAll('「검색」', '「PDF 정보 찾기」').replaceAll('「적용」', '「선택한 정보 적용」').replaceAll('「되돌리기」', '「적용 되돌리기」')
    .replace(/「이번 적용([^」]*)」 칩/g, '상세 분류의 「이번 적용$1」');
const datedClause = '제목·저자 밖의 칸은 DOI 기록이 정합니다(2026-10-06 결정)';
const dateFreeClause = '제목·저자 밖의 칸은 DOI 기록이 정합니다';
const developmentDateAlias = (text: string) => {
    if (text === datedClause)
        return dateFreeClause;
    const marker = ' — ' + datedClause + '.';
    if ((text.startsWith('이 문서와 같은 판본으로 맞은 DOI 기록(') || /^「[\s\S]*」 대신 이 문서와 같은 판본으로 맞은 DOI 기록\(/.test(text)) && text.includes(marker)) {
        return text.replace(marker, ' — ' + dateFreeClause + '.');
    }
    return text;
};
const displayAliases = (source: string) => [...new Set([source, destinationCopy(source), developmentDateAlias(source), developmentDateAlias(destinationCopy(source))])];
const exact = new Map<string, string>();
for (const [source, translated] of Object.entries(englishCopy))
    for (const alias of displayAliases(source))
        exact.set(alias, translated);
const policyArguments: Readonly<Record<string, readonly number[]>> = {
    '체크한 항목이 없습니다 — 적용한 행은 체크가 풀립니다. 마지막 적용({0}{1}개)의 결과는 아래 「마지막 적용」 줄과 「이번 적용 {2}」 칩에 있습니다.': [0],
    ' 적용한 값은 {0}에서 행을 열면 보입니다.': [0],
    '체크한 {0}개 중 적용할 값이 있는 행이 없습니다 — {1}.{2}': [1, 2],
    '필드 {0}개{1}': [1],
    '마지막 되돌리기 {0} · 복원 {1}개{2}{3}{4}': [0, 2, 3, 4],
    ' · 쓰지 않음 {0}개 — 체크 유지: {1}': [1],
    '마지막 적용 {0} · 항목 {1}개 · {2}{3}{4}{5}': [0, 2, 3, 4, 5],
    '적용 기록이 없는 적용 행 {0}개(이전 빌드에서 적용했거나 적용 중에 끊긴 행) — 적용 전 백업과 적용 지문의 차이로 복원했습니다: {1}. 적용 시각은 남아 있지 않습니다.': [1],
    '승인이 더 이상 이 변경을 설명하지 않습니다 — {0}': [0],
    '{0} · 적용 기록이 없어 적용 지문에서 복원(시각 없음)': [0],
    '{0} · 쓰기 계획으로 추정(새 상위 항목, 지문 없음)': [0],
    '확인 필요: {0}{1}{2}{3}': [1, 2, 3],
    '외부 기록으로 확인: {0}{1}': [1]
};
const nested = new Map<string, readonly number[]>();
for (const [source, arguments_] of Object.entries(policyArguments)) {
    for (const alias of displayAliases(source))
        nested.set(alias, arguments_);
}
const diagnosticArguments = new Map<string, {
    readonly copy: readonly number[];
    readonly particles: readonly number[];
}>();
for (const [source, arguments_] of Object.entries(EN_DIAGNOSTIC_ARGUMENTS))
    for (const alias of displayAliases(source))
        diagnosticArguments.set(alias, arguments_);
const completedPolicyTemplates = new Set([
    ...Object.keys(policyArguments),
    ...Object.keys(EN_DIAGNOSTIC_ARGUMENTS), ...Object.keys(EN_DIAGNOSTICS_SECURITY).filter(source => /\{\d+\}/.test(source)),
    '체크가 풀려 있었습니다 — {0}', '권장하지 않는 규칙이 있었습니다 — {0}', '{0}월 {1}일 {2}:{3}',
    '체크한 항목이 없습니다 — 이미 적용한 {0}개는 「적용됨」 칩에서 행을 열면 적용한 값이 보입니다.',
    ' · 실패 {0}개(필드별 내역에서 행을 누르면 사유)', ' · 적용 뒤 편집돼 건너뜀 {0}개',
    ' · 이미 적용돼 건너뜀 {0}개(체크 풂)',
    '이 필드에는 확인된 값({0})이 기록돼 있고 이 후보는 그와 다릅니다 — 보호를 해제하면 쓸 수 있습니다',
    '이 문헌·판본에 연결된 외부 기록이 명시함 ({0})', '문서 본문과 대조해 확인됨 ({0})',
    '검증되지 않았지만 체크되어 적용합니다 — {0}', '필드 {0}개',
    ' · 연결되지 않은 후보 {0}건', ' · 외부 기록으로 확인: {0}', ' · PDF로 확인: {0}', 'PDF로 확인: {0}'
].flatMap(displayAliases));
const patterns: TextPattern[] = [];
for (const [source, translated] of exact) {
    if (!completedPolicyTemplates.has(source))
        continue;
    const indexes: number[] = [], marker = /\{(\d+)\}/g;
    let cursor = 0, expression = '^', hit: RegExpExecArray | null;
    while ((hit = marker.exec(source))) {
        const after = source.slice(hit.index + hit[0].length);
        expression += escapePattern(source.slice(cursor, hit.index)) + (/^(?:개|건|월|일|시간|분|초|%)/.test(after) ? '([0-9]+(?:\\.[0-9]+)?)' : '([\\s\\S]*?)');
        indexes.push(Number(hit[1]));
        cursor = hit.index + hit[0].length;
    }
    expression += escapePattern(source.slice(cursor)) + '$';
    patterns.push({ source, translated, regex: new RegExp(expression), prefix: source.split(/\{\d+\}/)[0], indexes });
}
patterns.sort((a, b) => b.source.replace(/\{\d+\}/g, '').length - a.source.replace(/\{\d+\}/g, '').length);
export function uiText(text: string): string {
    if (uiLocale() === 'ko')
        return developmentDateAlias(text);
    return translatedCopy(text) ?? policyText(text, false);
}
function translatedCopy(text: string, depth = 0): string | undefined {
    if (depth > 6)
        return undefined;
    const translated = exact.get(text);
    if (translated !== undefined)
        return translated;
    const vision = /^LM Studio 비전 OCR \(([\s\S]*), ([0-9]+px[\s\S]*)\)$/.exec(text);
    if (vision)
        return interpolate(englishCopy['LM Studio 비전 OCR ({0}, {1})'], [vision[1], visionDetails(vision[2], depth + 1)]);
    for (const pattern of patterns) {
        if (pattern.prefix && !text.startsWith(pattern.prefix))
            continue;
        const match = pattern.regex.exec(text);
        if (!match)
            continue;
        const values: string[] = [];
        pattern.indexes.forEach((index, at) => { values[index] = match[at + 1]; });
        for (const index of nested.get(pattern.source) ?? [])
            values[index] = policyText(values[index], true, depth + 1);
        const diagnostic = diagnosticArguments.get(pattern.source);
        for (const index of diagnostic?.copy ?? [])
            if (!(nested.get(pattern.source) ?? []).includes(index))
                values[index] = diagnosticCopy(values[index], depth + 1);
        for (const index of diagnostic?.particles ?? [])
            if (/^[은는을를]$/.test(values[index]))
                values[index] = '';
        return interpolate(pattern.translated, values);
    }
    return undefined;
}
const countLabels = ['변경', '추가', '비움', '유형 변경으로 사라짐', '이미 적용', '변경 제안 없음', '적용할 수 없는 상태',
    '이전 규칙으로 판정', '보호된 값과 다름', '본문과 어긋남', '값 비우기뿐', '유형 변경을 고르지 않음',
    '권장하지 않는 필드뿐', '체크한 필드 없음', '「설정과 도구」에서 끈 필드뿐', '「찾기 방법 및 설정」에서 끈 필드뿐', '새 항목의 유형 미정', '그 밖의 사유'];
const counts = countLabels.map(label => ({ label, expression: new RegExp('^' + escapePattern(label) + ' ([0-9]+)(?:\\((.*)\\))?$') }));
const prefixes = ['바꾸거나 채운 필드', '비운 칸', '유형 변경으로 사라진 칸'];
const diagnosticPrefixes = ['오류: ', '페이지 판독 실패: ', '선택되지 않았습니다 — '];
function visionDetails(text: string, depth: number): string {
    return text.split(', ').map((part, index) => {
        if (!index)
            return part;
        const known = translatedCopy(', ' + part, depth);
        return known?.startsWith(', ') ? known.slice(2) : part;
    }).join(', ');
}
function diagnosticCopy(text: string, depth: number): string {
    const known = translatedCopy(text, depth);
    if (known !== undefined)
        return known;
    const trimmed = text.trim();
    if (trimmed && trimmed !== text) {
        const translated = translatedCopy(trimmed, depth);
        if (translated !== undefined)
            return text.slice(0, text.indexOf(trimmed)) + translated + text.slice(text.indexOf(trimmed) + trimmed.length);
    }
    return text;
}
function policyText(text: string, matchTemplate = true, depth = 0): string {
    if (!text || depth > 6)
        return text;
    if (matchTemplate) {
        const known = translatedCopy(text, depth);
        if (known !== undefined)
            return known;
    }
    const parentheses = /^(\s*)\(([^()]*)\)$/.exec(text);
    if (parentheses)
        return parentheses[1] + '(' + policyText(parentheses[2], true, depth + 1) + ')';
    for (const { label, expression } of counts) {
        const matched = expression.exec(text);
        if (matched)
            return (exact.get(label) ?? label) + ' ' + matched[1] + (matched[2] ? '(' + policyText(matched[2], true, depth + 1) + ')' : '');
    }
    for (const prefix of prefixes)
        if (text.startsWith(prefix + ': '))
            return (exact.get(prefix) ?? prefix) + text.slice(prefix.length);
    for (const prefix of diagnosticPrefixes)
        if (text.startsWith(prefix))
            return (exact.get(prefix) ?? prefix) + (translatedCopy(text.slice(prefix.length), depth + 1) ?? text.slice(prefix.length));
    if (text.includes(' · '))
        return text.split(' · ').map((part, at) => {
            const translated = policyText(part, true, depth + 1);
            if (translated !== part || !at)
                return translated;
            const clause = translatedCopy(' · ' + part, depth + 1);
            return clause?.startsWith(' · ') ? clause.slice(3) : part;
        }).join(' · ');
    return text;
}

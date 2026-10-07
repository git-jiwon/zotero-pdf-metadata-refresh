import type { Row } from './row';
import { appliedRecord, formatWhen, isAppliedStatus, type AppliedRecord } from './applied-record';
export type Standing = '외부 기록과 대조 완료' | 'PDF 근거로 확인' | '일부 필드 확인 필요' | '접근 실패로 조사 미완료' | '변경 없음' | '조사 없음' | '적용됨' | '적용 중';
export interface StandingReport {
    label: Standing;
    detail: string;
    unverified: string[];
    external: string[];
    page: string[];
}
const INACCESSIBLE = new Set(['blocked', 'authRequired', 'timeout', 'serverError', 'rateLimited']);
export function appliedDetail(record: AppliedRecord | null): string {
    if (!record)
        return '적용 기록 없음 — 적용 지문이 남아 있지 않습니다';
    const count = `필드 ${record.fields.length}개`;
    if (record.source === 'derived')
        return `${count} · 적용 기록이 없어 적용 지문에서 복원(시각 없음)`;
    if (record.source === 'estimated')
        return `${count} · 쓰기 계획으로 추정(새 상위 항목, 지문 없음)`;
    return `${count}${record.at ? ` · ${formatWhen(record.at)}` : ''}`;
}
export function rowStanding(row: Row): StandingReport {
    if (row.status === 'applying')
        return { label: '적용 중', detail: '쓰는 중 — 끝나면 적용한 값이 보입니다', unverified: [], external: [], page: [] };
    if (isAppliedStatus(row.status))
        return { label: '적용됨', detail: appliedDetail(appliedRecord(row)), unverified: [], external: [], page: [] };
    const verification = row.verification || {};
    const proposed = ((row.changes || []).length ? (row.changes || []).map(change => change.field) : Object.keys(verification)).filter(field => field !== 'itemType' || verification.itemType);
    const external: string[] = [], page: string[] = [], unverified: string[] = [];
    for (const field of proposed) {
        const record = verification[field];
        if (!record) {
            unverified.push(field);
            continue;
        }
        if (record.level === 'verified')
            (String(record.rule || '').startsWith('external/') ? external : page).push(field);
        else
            unverified.push(field);
    }
    const failures = row.restore?.target ? [] : (row.restore?.log || []).filter(entry => INACCESSIBLE.has(entry.kind) && entry.phase !== 'detail');
    if (!proposed.length) {
        if (failures.length)
            return { label: '접근 실패로 조사 미완료', detail: failures.map(entry => `${entry.provider}${entry.host ? ` (${entry.host})` : ''}: ${entry.kind}`).join(' · '), unverified, external, page };
        if (row.status === 'noChanges')
            return { label: '변경 없음', detail: '이미 기록과 같습니다', unverified, external, page };
        return { label: '조사 없음', detail: row.error || '제안된 변경이 없습니다', unverified, external, page };
    }
    if (unverified.length) {
        const held = row.restore && !row.restore.target && row.restore.candidates?.length ? ` · 연결되지 않은 후보 ${row.restore.candidates.length}건` : '';
        return { label: '일부 필드 확인 필요', detail: `확인 필요: ${unverified.join(', ')}${external.length ? ` · 외부 기록으로 확인: ${external.join(', ')}` : ''}${page.length ? ` · PDF로 확인: ${page.join(', ')}` : ''}${held}`, unverified, external, page };
    }
    if (external.length)
        return { label: '외부 기록과 대조 완료', detail: `외부 기록으로 확인: ${external.join(', ')}${page.length ? ` · PDF로 확인: ${page.join(', ')}` : ''}`, unverified, external, page };
    return { label: 'PDF 근거로 확인', detail: `PDF로 확인: ${page.join(', ')}`, unverified, external, page };
}

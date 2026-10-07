import type { FieldChange, MetadataSnapshot } from '../types';
import type { FieldVerification } from './evidence';
import type { RestoreRecord } from './restore-step';
import { REQUIRED } from '../recognition/candidate';
export type GateDecision = 'complete' | 'identifierSettled' | 'linkedComplete' | 'ask';
export type PhaseOutcome = 'linked' | 'held' | 'candidates' | 'noRecord' | 'notRun';
export interface GateInput {
    phase: 'registries' | 'browser';
    result: {
        metadata: MetadataSnapshot;
        changes: FieldChange[];
    } | null;
    proposal: {
        typeRead?: boolean;
        metadata: MetadataSnapshot;
    } | null;
    verification: Record<string, FieldVerification>;
    authoritative: boolean;
    restore?: RestoreRecord;
}
export interface GateRecord {
    phase: 'registries' | 'browser';
    decision: GateDecision;
    open: string[];
    unverified: string[];
    type: string;
    typeRead: boolean;
    reason: string;
    outcome?: PhaseOutcome;
    outcomeNote?: string;
}
const IDENTITY_FIELDS = ['title', 'creators', 'date'];
const INACCESSIBLE = new Set(['blocked', 'authRequired', 'timeout', 'serverError', 'rateLimited']);
const empty = (value: unknown) => value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
export function wantedFields(type: string): string[] {
    return [...(REQUIRED[type] || REQUIRED.document),
        ...(type === 'journalArticle' || type === 'conferencePaper' ? ['DOI', 'volume', 'pages'] : type === 'book' ? ['ISBN', 'numPages'] : [])];
}
export function restoreGate(input: GateInput): GateRecord {
    const held = input.result?.metadata;
    const typeRead = !!held?.itemType && held.itemType !== 'document' ? true : !!input.proposal?.typeRead;
    const type = String(held?.itemType || input.proposal?.metadata.itemType || 'document');
    const wanted = wantedFields(type);
    const open = wanted.filter(field => field === 'creators'
        ? !(held?.creators?.length || input.proposal?.metadata.creators?.length)
        : empty(held?.fields?.[field]) && empty(input.proposal?.metadata.fields?.[field]));
    const checked = new Set([...wanted, ...IDENTITY_FIELDS]);
    const unverified: string[] = [];
    for (const change of input.result?.changes || []) {
        if (change.field === 'itemType' || !checked.has(change.field) || empty(change.newValue))
            continue;
        const record = input.verification[change.field];
        if (!record || record.outcome !== 'supported')
            unverified.push(change.field);
    }
    const base = { phase: input.phase, open, unverified, type, typeRead };
    if (input.result && typeRead && !open.length && !unverified.length) {
        return { ...base, decision: 'complete', reason: 'the kind of work was read, nothing it needs is empty, and every proposed value is verified' };
    }
    if (input.authoritative && !open.length) {
        return { ...base, decision: 'identifierSettled', reason: `a registry record for an identifier printed in the document stands and leaves no needed field empty${unverified.length ? ` (its statements not corroborated by the page: ${unverified.join(', ')})` : ''}` };
    }
    if (input.restore?.status === 'linked' && !open.length && !unverified.length) {
        return { ...base, decision: 'linkedComplete', reason: 'an earlier phase tied a record to this edition and nothing needed or unverified remains' };
    }
    const because = [open.length ? `empty: ${open.join(', ')}` : '', unverified.length ? `unverified: ${unverified.join(', ')}` : '', !typeRead ? 'kind of work not read' : '', !input.result ? 'no record yet' : ''].filter(Boolean).join(' · ');
    return { ...base, decision: 'ask', reason: because || 'nothing settled the document' };
}
export function restoreFailures(restore: RestoreRecord | undefined): RestoreRecord['log'] {
    return (restore?.log || []).filter(entry => INACCESSIBLE.has(entry.kind) && entry.phase !== 'detail');
}
export function restoreHeld(restore: RestoreRecord | undefined): boolean {
    if (!restore || restore.target)
        return false;
    return restore.status === 'budget' || restoreFailures(restore).length > 0;
}
export function phaseOutcome(restore: RestoreRecord | undefined): {
    outcome: PhaseOutcome;
    note: string;
} {
    if (!restore)
        return { outcome: 'notRun', note: 'the step did not run' };
    if (restore.target)
        return { outcome: 'linked', note: `${restore.target.provider} ${restore.target.url}` };
    const failures = restoreFailures(restore);
    if (restore.status === 'budget' || failures.length) {
        return { outcome: 'held', note: [restore.status === 'budget' ? 'budget spent' : '', ...failures.map(entry => `${entry.provider}${entry.host ? ` (${entry.host})` : ''}: ${entry.kind}`)].filter(Boolean).join(' · ') };
    }
    if (restore.candidates.length)
        return { outcome: 'candidates', note: `${restore.candidates.length} candidate(s), none tied to this edition` };
    return { outcome: 'noRecord', note: 'no record found in the sources asked' };
}

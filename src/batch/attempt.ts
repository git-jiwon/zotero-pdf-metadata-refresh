import type { Row } from './row';
export function resetRecognitionAttempt(row: Row): void {
    for (const key of [
        'recognized', 'rawRecognized', 'match', 'safety', 'recognitionSource', 'candidates',
        'error', 'koreanAttempted', 'verifiedPDF', 'patentPDF', 'technicalPDF', 'identifierPDF',
        'cacheState', 'fieldChoice', 'fieldEdit', 'advice', 'manualReview', 'authoritative',
        'verification', 'evidence', 'restore', 'restoreGate', 'coverProposal', 'completion',
        'fieldConflicts', 'selection', 'staleGeneration', 'lookupUnreachable', 'lookupNotes',
        'ocrRead', 'attempts', 'recognizedWith', 'storedDifference'
    ] as const)
        delete (row as any)[key];
    row.status = 'pending';
    row.checked = false;
    row.changes = [];
    row.attempts = [];
}

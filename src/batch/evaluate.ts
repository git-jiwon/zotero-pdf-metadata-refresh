import type { FieldChange, MetadataSnapshot } from '../types';
import { furnitureWordByWord, type Match } from '../metadata/match';
import { isbnsIn, registeredNumberWord, sameDOI, sameDOILink, validISSN } from '../metadata/identifier-compare';
import { assessPublicationSafety, type PublicationSafety } from '../metadata/publication-state';
import { isKoreanSurname, isNotATitle, isOrganisationOnly, lineIsNotATitle, looksLikeSectionLabel, withoutGenreTag } from '../recognition/title-guards';
import { titleEnding } from '../recognition/title-grammar';
import { BYLINE_MARKER_SOURCE, PERSON_MEANINGS, roleWordAt } from '../recognition/label-words';
import type { PageStructure } from '../recognition/page-structure';
import { TITLE, continuationOf, parallelOf, printedAsTitle } from '../recognition/title-block';
import { titleSupportedByPDF } from '../recognition/pdf-identifiers';
import { nameInImprint } from '../recognition/imprint-marks';
import { canonicalDate, DATE_FIELDS, sameDate, TITLE_LINE_SHAPES, withoutStatuteReference } from '../recognition/roles';
import { isDegreeFormLine, isDegreeStatement, personOfDegreeSentence } from '../recognition/degree';
import { nameShape, personParts, scriptOfName } from '../metadata/person-name';
import { koreanSurnameOfHanja, normaliseAgents } from '../recognition/agents';
import { isOrganisationName } from '../recognition/local-publication';
import { buildDiff, startPageTheDocumentPrints, BOOKKEEPING_FIELDS, publisherLetters } from '../metadata/diff';
import { titleScript } from '../metadata/text';
import { initialsSpacedText, looksLikeABody, nameAsItIsWritten } from '../metadata/creator-text';
import { fold, romanise } from '../metadata/korean-names';
import { nameRelation, printedPerson, romanisedSyllables, sameName, surnameAgrees } from '../metadata/name-equivalence';
import { bylinesPrintedTwice, namesOfPersonRows } from '../recognition/byline';
import { isOrganisationItem, personShape, personsOnly, positionIn, readBylineRow, rowIsByline, unitPhraseIn, withoutLeadingPositions, withoutPositionWords } from '../recognition/byline-row';
import { bodyLanguageOf, folioRunFrom, identifierPrintedAsTheDocumentsOwn, nameFieldsAsNames, noteExcerpt, storedRecordOfThisEdition, storedValueNoSourceContradicts, titleIsBodyAfterASectionHeading, titleUnderContract, underTheFieldContract, withoutGluedByline } from './field-contract';
import { evidencePages, documentExtent, documentBodyScript, pageStructureOf, statementsOf, titleCandidatesOf, verifyFields, normalizeVerification, type EvidenceBundle, type FieldVerification } from './evidence';
import { statedAs } from '../recognition/statements';
import { foldedLetters, journalKey } from '../recognition/folded-letters';
import { fileIdentity } from './cache';
import { carryDecisionsForward, protectionConflict, type ApprovalState } from './approval';
import { storedDifference, type StoredDifference } from './stored-difference';
import type { Row, Status } from './row';
export type ReasonCode = 'preprintKept';
export interface EvaluationRoute {
    verifiedPDF: boolean;
    patentPDF: boolean;
    technicalPDF: boolean;
    identifierPDF: boolean;
    authoritative: boolean;
    standalonePDF: boolean;
    koreanAttempted: boolean;
    manualReview: boolean;
    recognitionSource: string;
    overwriteFromDocument?: boolean;
    independentMetadata?: boolean;
    lookupUnreachable?: boolean;
    ocrRead?: boolean;
    error?: string;
}
export interface EvaluationInput {
    before: MetadataSnapshot;
    recognized: MetadataSnapshot;
    route: EvaluationRoute;
    evidence?: EvidenceBundle;
    readings?: Record<string, any>;
    searchedRecords?: SearchedRecord[];
    carried?: ApprovalState;
    existing?: ApprovalState;
    pdfFingerprint: string;
    policyVersion: string;
}
export interface Evaluation {
    changes: FieldChange[];
    recognized: MetadataSnapshot;
    screened: MetadataSnapshot;
    offered?: MetadataSnapshot;
    match: Match;
    safety: PublicationSafety;
    advice: Record<string, string>;
    fieldChoice?: Record<string, boolean>;
    verification: Record<string, FieldVerification>;
    approvals?: ApprovalState['approvals'];
    protections?: ApprovalState['protections'];
    manualReview: boolean;
    status: Status;
    codes: ReasonCode[];
    error?: string;
    storedDifference?: StoredDifference;
}
export function substantiveChanges(changes: FieldChange[]): FieldChange[] {
    return changes.filter(change => !BOOKKEEPING_FIELDS.has(change.field));
}
export function adviseAgainst(row: {
    advice?: Record<string, string>;
    fieldChoice?: Record<string, boolean>;
}, field: string, note: string): void {
    row.advice = { ...(row.advice || {}), [field]: note };
    if (row.fieldChoice?.[field] === undefined)
        row.fieldChoice = { ...(row.fieldChoice || {}), [field]: false };
}
export function recommendedChanges(row: {
    changes: FieldChange[];
    advice?: Record<string, string>;
}): FieldChange[] {
    return row.changes.filter(change => !row.advice?.[change.field]);
}
export function needsReview(before: MetadataSnapshot, changes: FieldChange[]): boolean {
    const korean = /[가-힣]/;
    const koreanRecord = korean.test(String(before.fields.title || ''));
    const title = changes.find(change => change.field === 'title');
    if (title)
        return koreanRecord || korean.test(String(title.newValue));
    return koreanRecord && changes.some(change => change.field === 'creators');
}
export function statusFor(row: {
    safety?: PublicationSafety;
    manualReview?: boolean;
    koreanAttempted?: boolean;
    match?: Match;
}, before: MetadataSnapshot | undefined, recommended: FieldChange[], verifiedPDF: boolean, doiConflict: boolean): Status {
    if (row.safety?.blocked)
        return row.safety.code === 'published-over-preprint' ? 'protected' : 'mismatch';
    if (!recommended.length)
        return 'noChanges';
    if (row.manualReview)
        return 'review';
    if (verifiedPDF && !doiConflict)
        return 'ready';
    return row.koreanAttempted || (before && needsReview(before, recommended)) || row.match?.review ? 'review' : 'ready';
}
const lettersOf = (value: unknown) => String(value ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const BYLINE_PREPOSITION = /^by\b[\s:.]*/i;
const BYLINE_MARKER = new RegExp(`^(?:${BYLINE_MARKER_SOURCE})(?![\\p{L}\\p{N}])[\\s:.]*`, 'iu');
function marksAByLine(line: string, creators: unknown[]): boolean {
    if (BYLINE_MARKER.test(line))
        return true;
    const marker = BYLINE_PREPOSITION.exec(line);
    if (!marker)
        return false;
    const rest = line.slice(marker[0].length).trim();
    if (!rest)
        return true;
    if (rowIsByline(line, 'strict'))
        return true;
    if ((creators as any[] || []).some(person => String(person?.firstName ?? '').trim() && printedPerson(rest, person)))
        return true;
    const held = new Set<string>();
    for (const person of (creators || []) as any[]) {
        const name = String(person?.lastName ?? person?.name ?? '');
        for (const part of [name, ...name.split(/[\s'’-]+/)]) {
            const folded = lettersOf(part);
            if (folded.length >= 2)
                held.add(folded);
        }
    }
    if (!held.size)
        return false;
    return rest.split(/[\s,;·&]+/).some(token => {
        const bare = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
        const head = [...bare][0];
        if (!head)
            return false;
        const cased = head.toLowerCase() !== head.toUpperCase();
        return (!cased || head === head.toUpperCase()) && held.has(lettersOf(bare));
    });
}
function soleKoreanName(line: string): boolean {
    const row = readBylineRow(line);
    return row.kind === 'single' && row.items.length === 1 && row.items[0].shape.kind === 'korean' && row.items[0].shape.person !== 'no';
}
function breakIsInsideAWord(reading: unknown, lettersBefore: number): boolean {
    if (lettersBefore <= 0)
        return false;
    const text = String(reading ?? '').normalize('NFKD').replace(/\p{M}+/gu, '');
    let seen = 0;
    for (let index = 0; index < text.length; index++) {
        if (!/[\p{L}\p{N}]/u.test(text[index]))
            continue;
        if (++seen !== lettersBefore)
            continue;
        const rest = text.slice(index + 1), next = rest.search(/[\p{L}\p{N}]/u);
        return next >= 0 && /^[-­‐‑]?$/.test(rest.slice(0, next));
    }
    return false;
}
export function titleFromHeadingBlock(reading: unknown, pageText: string | undefined, creators: unknown[] = []): string | null {
    const target = lettersOf(reading);
    if (!pageText || target.length < 20)
        return null;
    const lines = pageText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const words = (line: string) => line.split(/\s+/).filter(Boolean);
    const sentence = (line: string) => /[.!?]["”’)]?\s*$/.test(line) && words(line).length >= 4;
    const furnitureTail = (line: string) => {
        const value = String(line || '').trim();
        if (!value)
            return true;
        if (marksAByLine(value, creators))
            return true;
        if (/\b10\.\d{4,9}\/\S+|https?:\/\/|www\.|\bISSN\b|\bISBN\b|@/i.test(value))
            return true;
        if (/^[\s\d.,/()년월일-]+$/.test(value))
            return true;
        if (/^\(.*(?:received|submitted|accepted|revised|manuscript|접수|게재).*\)$/i.test(value))
            return true;
        if (rowIsByline(value, 'strict') || soleKoreanName(value) || isOrganisationOnly(value))
            return true;
        if (sentence(value) && words(value).length >= 8)
            return true;
        return furnitureWordByWord(value);
    };
    for (let start = 0; start < lines.length; start++) {
        let joined = '', end = start;
        while (end < lines.length && joined.length < target.length) {
            joined += lettersOf(lines[end]);
            end++;
        }
        if (!joined.startsWith(target) || end - start < 2)
            continue;
        const run = lines.slice(start, end);
        let kept = [...run];
        while (kept.length > 1 && furnitureTail(kept[kept.length - 1])) {
            const remaining = kept.slice(0, -1).reduce((total, line) => total + lettersOf(line).length, 0);
            if (breakIsInsideAWord(reading, remaining))
                break;
            kept.pop();
        }
        if (kept.length >= 2 && looksLikeSectionLabel(kept[0], kept[1]) && words(kept.slice(1).join(' ')).length >= 4)
            kept = kept.slice(1);
        if (kept.length === run.length)
            return null;
        const title = kept.join(' ').trim();
        return lettersOf(title).length >= 20 && lettersOf(title) !== target ? title : null;
    }
    return null;
}
export function isOwnRecordJournal(recognized: MetadataSnapshot, title: unknown): boolean {
    const reading = lettersOf(title);
    if (reading.length < 8)
        return false;
    const journal = lettersOf(recognized?.fields?.publicationTitle);
    if (journal.length < 8 || !reading.startsWith(journal))
        return false;
    return reading.length <= journal.length + 24;
}
export function scriptTheRecordStates(...records: Array<MetadataSnapshot | undefined>): 'hangul' | 'latin' | null {
    for (const record of records) {
        const stated = String(record?.fields?.language ?? '').trim().toLowerCase();
        if (!stated)
            continue;
        if (/^(?:ko|kor|korean|kr)\b/.test(stated))
            return 'hangul';
        if (/^(?:en|eng|english)\b/.test(stated))
            return 'latin';
    }
    return null;
}
const BESIDE_THE_TITLE = new Set(['title', 'shortTitle', 'language', 'itemType', 'accessDate', 'libraryCatalog', 'pages',
    'url', 'extra', 'rights', 'callNumber', 'archive', 'archiveLocation', 'citationKey']);
export function readAWholeRecord(offered: MetadataSnapshot): boolean {
    return Object.entries(offered?.fields || {})
        .some(([field, value]) => value !== '' && value !== null && value !== undefined && !BESIDE_THE_TITLE.has(field));
}
export function titleSide(value: unknown): 'hangul' | 'latin' | null {
    const script = titleScript(value);
    if (script === 'hangul')
        return 'hangul';
    const text = String(value ?? '').normalize('NFKC');
    return script === 'none' && /[A-Za-z]/.test(text) && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) ? 'latin' : null;
}
export function sanitizeRecognizedTitle(recognized: MetadataSnapshot, pageText?: string, options: {
    structure?: PageStructure;
} = {}): MetadataSnapshot {
    const title = String(recognized.fields.title || '');
    if (!title)
        return recognized;
    const withTitle = (value: string) => ({ ...recognized, fields: { ...recognized.fields, title: value } });
    const refused = lineIsNotATitle(title)
        && (lineIsNotATitle(title, { printedAsTitle: true }) || !options.structure || !printedAsTitle(options.structure, title));
    if (refused || isOwnRecordJournal(recognized, title))
        return withTitle('');
    const fromBlock = titleFromHeadingBlock(title, pageText, recognized.creators || []);
    if (fromBlock)
        return withTitle(fromBlock);
    const withoutByLine = withoutGluedByline(title, recognized.creators || []);
    if (withoutByLine !== title)
        return withTitle(withoutByLine);
    return recognized;
}
const PUBLISHER_CONNECTIVE = /^(?:of|for|the|a|an|and|in|on|at|to|by|with|behalf|de|del|della|di|da|do|dos|du|van|von|der|den|des|das|die|und|f[uü]r|y|et|la|le|les|el|op|en|och|og)$/u;
const FOREIGN_CONNECTIVE = /^(?:de|del|della|des|du|di|da|do|dos|van|von|der|den|das|die|und|f[uü]r|y|et|la|le|les|el|op|och|og)$/u;
const PUBLISHER_INITIAL = /^(?:\p{Lu}\.){1,3}$/u;
const PUBLISHER_NAME_WORD = /^[\p{Lu}\p{N}][\p{L}\p{N}'’&./-]*$/u;
const LOWER_CASE_BRAND = /^\p{Ll}+\p{Lu}/u;
const EAST_ASIAN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const KOREAN_POSTPOSITION = /(?:^|\s)(?:에서|에게|으로|부터|까지|에|의)\s/u;
const COPYRIGHT_TEXT = /©|\(c\)\s|\bcopyright\b|\ball rights reserved\b/i;
const HYPHENATED_NUMBER = /^\d[\d‐‑-]*[-‐‑][\d‐‑-]*[\dXx]$/u;
const publisherTokens = (value: string) => value.normalize('NFKC').replace(/[()（）[\]]/g, ' ')
    .split(/\s+|(?<=\.),(?=\p{L})/u).map(token => token.replace(/^[,;:]+|[,;:]+$/g, '')).filter(Boolean);
const bareWord = (token: string) => token.replace(/\.+$/, '').toLowerCase();
export function looksLikePublisherName(value: unknown): boolean {
    const text = String(value ?? '').trim();
    if (!text || text.length > 120)
        return false;
    if (COPYRIGHT_TEXT.test(text))
        return false;
    const tokens = publisherTokens(text);
    if (!tokens.length)
        return false;
    if (/^(?:publishers?|발행처|펴낸곳|출판사)\s*[:：]/iu.test(text))
        return false;
    if (tokens.some(token => /^\d+$/.test(token) || HYPHENATED_NUMBER.test(token) || registeredNumberWord(token)))
        return false;
    if (EAST_ASIAN.test(text))
        return !KOREAN_POSTPOSITION.test(` ${text} `);
    if (tokens.some(token => /[\p{L}\p{N}]-$/u.test(token)))
        return false;
    const foreign = tokens.some(token => FOREIGN_CONNECTIVE.test(bareWord(token)));
    if (!foreign && tokens.some(token => /^\p{Ll}/u.test(token) && !PUBLISHER_CONNECTIVE.test(bareWord(token))
        && !LOWER_CASE_BRAND.test(token) && publisherLetters(token) !== ''))
        return false;
    if (PUBLISHER_CONNECTIVE.test(bareWord(tokens[tokens.length - 1])))
        return false;
    if (!tokens.every(token => PUBLISHER_INITIAL.test(token) || PUBLISHER_NAME_WORD.test(token)
        || LOWER_CASE_BRAND.test(token) || PUBLISHER_CONNECTIVE.test(bareWord(token))
        || FOREIGN_CONNECTIVE.test(bareWord(token)) || publisherLetters(token) === ''
        || (foreign && /^\p{Ll}[\p{L}'’-]*$/u.test(token)) || /^[&+/–-]$/u.test(token)))
        return false;
    const named = tokens.filter(token => publisherLetters(token) !== '');
    if (named.length && named.length <= 3 && PUBLISHER_INITIAL.test(named[named.length - 1])
        && named.every(token => PUBLISHER_INITIAL.test(token) || PUBLISHER_NAME_WORD.test(token)))
        return false;
    return !!publisherLetters(text);
}
const nameLetters = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
function withoutCreatorName(value: string, creators: readonly any[]): string | null {
    const wanted = new Set<string>();
    for (const person of creators || []) {
        const last = nameLetters(person?.lastName ?? person?.name), first = nameLetters(person?.firstName);
        if (!last || !first)
            continue;
        wanted.add(first + last);
        wanted.add(last + first);
    }
    if (!wanted.size)
        return null;
    const tokens = value.split(/\s+/).filter(Boolean);
    for (let start = 0; start < tokens.length; start++) {
        for (let end = tokens.length; end - start >= 2; end--) {
            if (!wanted.has(nameLetters(tokens.slice(start, end).join(''))))
                continue;
            return [...tokens.slice(0, start), ...tokens.slice(end)].join(' ').trim();
        }
    }
    return null;
}
const AFTER_MARK = /^[\s\S]*(?:©|\(c\)|\bcopyright\b)\s+(?:\d{4}(?:\s*[-–—,]\s*\d{4})*[,\s]+)?(?:by\s+)?/i;
const LOST_MARK = /^(?:[^\p{L}\p{N}\s]|[^\x00-\x7F])\s+(?=\p{Lu})/u;
function peelPublisher(value: string): string[] {
    const out: string[] = [];
    const push = (candidate: string) => { const kept = candidate.trim(); if (kept && kept !== value)
        out.push(kept); };
    if (AFTER_MARK.test(value))
        push(value.replace(AFTER_MARK, ''));
    push(value.replace(/,\s+\p{Ll}.*$/u, ''));
    push(value.replace(/^(?:publishers?|발행처|펴낸곳|출판사)\s*[:：]\s*/iu, ''));
    if (value.includes('['))
        push(value.replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' '));
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length >= 3 && /^\p{Ll}{1,3}\.?$/u.test(words[words.length - 1]) && publisherLetters(words[words.length - 2]) === '') {
        push(words.slice(0, -1).join(' '));
    }
    for (let at = value.indexOf('. '); at > 0; at = value.indexOf('. ', at + 1)) {
        const head = value.slice(0, at).trim(), tail = value.slice(at + 2).trim();
        if (tail.split(/\s+/).filter(Boolean).length < 2)
            continue;
        const last = head.split(/\s+/).pop() || '';
        if (PUBLISHER_INITIAL.test(`${last}.`) && publisherLetters(last) !== '')
            continue;
        push(head);
    }
    return out;
}
export function publisherReadings(raw: string): string[] {
    const value = (LOST_MARK.test(raw) ? raw.replace(LOST_MARK, '') : raw).trim();
    const seen = new Set([value]), queue = [value], readings = [value];
    for (let at = 0; at < queue.length && at <= 8 && readings.length < 24; at++) {
        for (const next of peelPublisher(queue[at])) {
            if (seen.has(next))
                continue;
            seen.add(next);
            queue.push(next);
            readings.push(next);
        }
    }
    const imprint = nameInImprint(value);
    if (imprint && !seen.has(imprint))
        readings.push(imprint);
    return readings;
}
export function publisherNameIn(value: unknown, creators: readonly any[] = [], options: {
    stated?: (name: string) => boolean;
} = {}): string | null {
    const text = String(value ?? '').trim();
    if (!text)
        return null;
    const stripped = withoutCreatorName(text, creators);
    if (stripped !== null && !stripped.trim() && options.stated?.(text))
        return text;
    if (stripped !== null)
        return looksLikePublisherName(stripped) ? stripped : null;
    for (const reading of publisherReadings(text))
        if (looksLikePublisherName(reading))
            return reading;
    return null;
}
export function publisherTheDocumentStates(name: unknown, evidence: EvidenceBundle | undefined): boolean {
    const value = String(name ?? '').trim();
    if (!value || !evidence?.observations?.length)
        return false;
    const roles = statedAs(statementsOf(evidence), value, { explicit: true });
    return roles.has('publisherHouse') || roles.has('publisherPerson');
}
export function sanitizeRecognizedPublisher(recognized: MetadataSnapshot, evidence?: EvidenceBundle): MetadataSnapshot {
    const offered = String(recognized.fields.publisher || '').trim();
    if (!offered)
        return recognized;
    const kept = publisherNameIn(offered, recognized.creators || [], { stated: name => publisherTheDocumentStates(name, evidence) });
    if (kept === offered)
        return recognized;
    return { ...recognized, fields: { ...recognized.fields, publisher: kept ?? '' } };
}
export function withoutPortalTag(recognized: MetadataSnapshot): MetadataSnapshot {
    const title = String(recognized.fields.title || '');
    const bare = withoutGenreTag(title);
    return bare === title ? recognized : { ...recognized, fields: { ...recognized.fields, title: bare } };
}
export function normaliseDates(recognized: MetadataSnapshot): MetadataSnapshot {
    let fields: Record<string, any> | null = null;
    for (const field of DATE_FIELDS) {
        const value = recognized.fields[field];
        if (typeof value !== 'string' || !value)
            continue;
        const canonical = canonicalDate(value);
        if (!canonical || canonical === value)
            continue;
        fields = fields || { ...recognized.fields };
        fields[field] = canonical;
    }
    return fields ? { ...recognized, fields } : recognized;
}
function titleLanguage(text: unknown): 'ko' | 'ja' | 'zh' | null {
    const value = String(text ?? '').normalize('NFKC');
    const hangul = (value.match(/[가-힯]/g) || []).length;
    const kana = (value.match(/[぀-ヿ]/g) || []).length;
    const han = (value.match(/[一-鿿]/g) || []).length;
    const latin = (value.match(/[A-Za-z]/g) || []).length;
    const total = hangul + kana + han + latin;
    if (total < 4)
        return null;
    if (kana / total > 0.05)
        return 'ja';
    if (hangul / total > 0.25)
        return 'ko';
    if (hangul > 0 && han / total > 0.25)
        return 'ko';
    if (han / total > 0.25)
        return 'zh';
    return null;
}
const ISO_639_1: Record<string, string> = {
    eng: 'en', kor: 'ko', jpn: 'ja', zho: 'zh', chi: 'zh', deu: 'de', ger: 'de', fra: 'fr', fre: 'fr',
    spa: 'es', rus: 'ru', ita: 'it', por: 'pt', nld: 'nl', dut: 'nl', ara: 'ar', hin: 'hi', tur: 'tr',
    pol: 'pl', swe: 'sv', dan: 'da', nor: 'no', fin: 'fi', ces: 'cs', cze: 'cs', ell: 'el', gre: 'el',
    english: 'en', korean: 'ko', japanese: 'ja', chinese: 'zh', german: 'de', french: 'fr',
    spanish: 'es', russian: 'ru', italian: 'it', portuguese: 'pt'
};
const subtag = (part: string) => part.length === 4 ? part.charAt(0).toUpperCase() + part.slice(1)
    : part.length === 2 || /^[0-9]{3}$/.test(part) ? part.toUpperCase() : part;
export function documentTitle(before: MetadataSnapshot, recognized: MetadataSnapshot): string {
    return String(before.fields.title ?? '').trim() || String(recognized.fields.title ?? '');
}
export function normaliseLanguage(before: MetadataSnapshot, recognized: MetadataSnapshot): MetadataSnapshot {
    const raw = recognized.fields.language;
    if (typeof raw !== 'string' || !raw.trim())
        return recognized;
    const [head, ...rest] = raw.normalize('NFKC').trim().toLowerCase().split(/[-_]/);
    const primary = ISO_639_1[head] || head;
    const spelled = primary === 'kr' ? 'ko' : primary;
    const script = titleLanguage(documentTitle(before, recognized));
    const stated = script && primary !== script;
    const value = stated ? script : [spelled, ...rest.map(subtag)].join('-');
    return value === raw ? recognized : { ...recognized, fields: { ...recognized.fields, language: value } };
}
function romanisedName(value: string): string {
    const text = value.replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '');
    const comma = /^([A-Za-z][A-Za-z.\-']*)\s*,\s*([A-Za-z][A-Za-z.\-'\s]*)$/.exec(text);
    return comma ? `${comma[2].trim()} ${comma[1].trim()}` : text;
}
export function oneScriptName(value: unknown, body: 'hangul' | 'latin' | null): string | null {
    const text = String(value ?? '').normalize('NFKC').trim();
    if (!text || !/[(（/|｜]/.test(text))
        return null;
    const row = readBylineRow(text, { field: true });
    const item = row.items[0];
    if (row.items.length !== 1 || row.organisations?.length || !item || item.alternates.length !== 1 || item.apposition?.length || item.shape.person === 'no')
        return null;
    const sides = [item.text, item.alternates[0]].map(side => side.replace(/\s+/g, ' ').trim());
    const of = (wanted: (script: string) => boolean) => sides.find(side => wanted(scriptOfName(side)));
    const hangul = of(script => script === 'hangul'), han = of(script => script === 'han' || script === 'kana'), latin = of(script => script === 'latin');
    if (hangul && han)
        return hangul.replace(/\s+/g, '');
    if (han && latin) {
        const romanised = romanisedName(latin);
        return romanised.split(/\s+/).length <= 3 ? romanised : null;
    }
    if (hangul && latin)
        return body === 'latin' ? romanisedName(latin) : hangul.replace(/\s+/g, '');
    return null;
}
function withoutPositions(lastName: string, firstName: string): {
    lastName: string;
    firstName: string;
} {
    if (/[가-힣]/.test(`${lastName}${firstName}`)) {
        const bareLast = withoutPositionWords(lastName), bareFirst = withoutPositionWords(firstName);
        if (bareLast === lastName && bareFirst === firstName)
            return { lastName, firstName };
        const rest = `${bareLast}${bareFirst}`.replace(/\s+/g, '');
        if (!rest || nameShape(rest, { marked: true }).person === 'no')
            return { lastName, firstName };
        return bareLast ? { lastName: bareLast, firstName: bareFirst } : { lastName: bareFirst, firstName: '' };
    }
    const bareFirst = withoutLeadingPositions(firstName), bareLast = withoutLeadingPositions(lastName);
    return { lastName: bareLast && (firstName || /\s/.test(bareLast)) ? bareLast : lastName, firstName: bareFirst };
}
export function sanitizeCreators(recognized: MetadataSnapshot, body: 'hangul' | 'latin' | null = null): MetadataSnapshot {
    const creators = (recognized.creators || []) as any[];
    if (!creators.length)
        return recognized;
    const tidy = (value: unknown) => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const cleaned = creators.map(creator => {
        let firstName = tidy(creator.firstName), lastName = tidy(creator.lastName || creator.name);
        const oneSide = oneScriptName(lastName, body);
        if (oneSide)
            lastName = oneSide;
        const oneSideFirst = oneScriptName(firstName, body);
        if (oneSideFirst)
            firstName = oneSideFirst;
        if (/^[a-z\d*†‡§¶]{1,2}$/.test(lastName) && firstName.includes(' ')) {
            const parts = firstName.split(' ');
            lastName = parts.pop() as string;
            firstName = parts.join(' ');
        }
        lastName = lastName.replace(/[\s,]*[*†‡§¶\d]+$/, '').trim() || lastName;
        ({ lastName, firstName } = withoutPositions(lastName, firstName));
        return { ...creator, firstName, lastName };
    });
    const bodyOf = (creator: any) => {
        const spaced = `${creator.firstName || ''} ${creator.lastName || ''}`.trim();
        const joined = spaced.replace(/\s+/g, '');
        return isOrganisationOnly(spaced) || looksLikeABody(joined.length ? spaced : '');
    };
    const anyPerson = cleaned.some(creator => !!creator.lastName && !bodyOf(creator));
    const screened = cleaned.filter(creator => {
        const korean = /[가-힣]/.test(`${creator.lastName}${creator.firstName}`);
        const whole = (korean ? `${creator.lastName}${creator.firstName}` : `${creator.firstName}${creator.lastName}`)
            .replace(/\s+/g, '');
        if (!creator.lastName)
            return false;
        const fragment = (value: string) => /^(?:the|of|and|for|by|in|on|at|to)$/i.test(String(value || '').trim());
        if (fragment(creator.lastName) || fragment(creator.firstName))
            return false;
        if (bodyOf(creator))
            return !anyPerson;
        const named = `${creator.firstName} ${creator.lastName}`.trim();
        const givenSlot = korean && !!creator.firstName && !withoutPositionWords(creator.firstName) && isKoreanSurname(String(creator.lastName).trim());
        if ((positionIn(named) || (!korean && unitPhraseIn(named))) && !givenSlot && !isOrganisationName(whole))
            return false;
        const titleWords = String(recognized.fields?.title || '').split(/\s+/).filter(Boolean);
        const spansTitleWords = (() => {
            for (let from = 0; from < titleWords.length; from++) {
                let joined = titleWords[from];
                for (let to = from + 1; to < titleWords.length && joined.length < whole.length + 4; to++) {
                    joined += titleWords[to];
                    if (joined === whole && titleWords.length > to - from + 1)
                        return true;
                }
            }
            return false;
        })();
        if (whole.length >= 2 && spansTitleWords && !isOrganisationName(whole))
            return false;
        if (!/^[가-힣]+$/.test(whole))
            return true;
        const nameSized = String(creator.lastName).replace(/\s+/g, '').length <= 4 && String(creator.firstName).replace(/\s+/g, '').length <= 4;
        const orders = [`${creator.lastName} ${creator.firstName}`, `${creator.firstName} ${creator.lastName}`];
        const furniture = orders.some(spaced => personShape(spaced, { roleStated: true }).person === 'no' || isDegreeStatement(spaced) || isDegreeStatement(spaced.replace(/\s+/g, ''))
            || isDegreeFormLine(spaced)) || positionIn(orders[0]) || isOrganisationItem(whole);
        if (creator.firstName && creator.lastName && creator.fieldMode !== 1 && nameSized && !furniture)
            return true;
        return whole.length <= 4 || isOrganisationName(whole);
    });
    const written = screened.map(creator => bodyOf(creator) ? { ...creator, lastName: `${creator.firstName || ''} ${creator.lastName}`.trim(), firstName: '', fieldMode: 1 } : creator);
    if (written.length === creators.length
        && written.every((creator, index) => creator.lastName === tidy(creators[index].lastName || creators[index].name)
            && creator.firstName === tidy(creators[index].firstName)
            && (creator.fieldMode ?? 0) === (creators[index].fieldMode ?? 0)))
        return recognized;
    return { ...recognized, creators: written };
}
export function fieldsLostToTypeChange(before: MetadataSnapshot, changes: FieldChange[]): Set<string> {
    const typeChange = changes.find(change => change.field === 'itemType');
    const lost = new Set<string>();
    if (!typeChange)
        return lost;
    const targetTypeID = Zotero.ItemTypes.getID(typeChange.newValue);
    if (!targetTypeID || targetTypeID === before.itemTypeID)
        return lost;
    for (const [field, value] of Object.entries(before.fields)) {
        if (!value)
            continue;
        const fieldID = Zotero.ItemFields.getID(field);
        if (!fieldID || !Zotero.ItemFields.isValidForType(fieldID, targetTypeID))
            lost.add(field);
    }
    const creatorsChange = changes.find(change => change.field === 'creators');
    const creators = (creatorsChange ? (Array.isArray(creatorsChange.newValue) ? creatorsChange.newValue : []) : before.creators || []) as any[];
    if (creators.length) {
        const primary = Zotero.CreatorTypes?.getPrimaryIDForType?.(targetTypeID);
        const valid = typeof Zotero.CreatorTypes?.isValidForItemType === 'function'
            ? (creator: any) => {
                const id = Zotero.CreatorTypes.getID(creator.creatorType);
                return !!id && Zotero.CreatorTypes.isValidForItemType(id, targetTypeID);
            }
            : () => true;
        if (primary !== undefined && creators.some(creator => creator?.creatorType && !valid(creator)))
            lost.add('creators');
    }
    return lost;
}
export function evaluateRecognition(input: EvaluationInput): Evaluation {
    return evaluateIndependentRecord(input);
}
const BARE_NUMBER = /^\s*\d{1,7}\s*$/;
function readTheDocument(route: EvaluationRoute): boolean {
    return !!route.ocrRead || /검색 복원|웹 페이지|PDF 표지|PDF 앞부분|PDF 로컬|비전 OCR|OCR|판독|공보 PDF|PDF 직접 분석/.test(String(route.recognitionSource || ''));
}
const KEPT_WHEN_REPLACING = new Set(['itemType', 'accessDate', 'libraryCatalog', 'title', 'language', 'abstractNote']);
function placeInTheLatinByline(read: any[], index: number, pair: {
    hangul: string[];
    latin: string[];
}): number {
    const place = (person: any) => /\p{Script=Latin}/u.test(`${person?.lastName ?? ''}${person?.firstName ?? ''}`)
        ? pair.latin.findIndex(roman => ['identical', 'romanisedVariant'].includes(nameRelation(person, personParts(roman) ?? roman).relation)) : -1;
    const at = place(read[index]);
    if (at >= 0 || read.length !== pair.latin.length)
        return at;
    const hangulName = (person: any) => `${person?.lastName ?? ''}${person?.firstName ?? ''}`.replace(/\s+/g, '');
    const inPlace = read.every((other, j) => j === index || (/[가-힣]/.test(hangulName(other)) ? hangulName(other) === pair.hangul[j] : place(other) === j));
    return inPlace ? index : -1;
}
function romanisedBylines(pages: Array<{
    text?: string;
}>): string[][] {
    const out: string[][] = [];
    for (const page of pages) {
        const lines = String(page.text || '').normalize('NFKC').split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim());
        const nativeCounts = new Set<number>();
        const latinRows: string[][] = [];
        lines.forEach((line, at) => {
            if (!line || line.length > 400)
                return;
            const text = /^by$/i.test(line) ? `By ${lines.slice(at + 1).find(Boolean) || ''}` : line;
            const people = personsOnly(text);
            if (!people)
                return;
            const scripts = people.map(item => scriptOfName(item.text));
            if (scripts.every(script => script === 'han' || script === 'kana')) {
                nativeCounts.add(people.length);
                return;
            }
            if (!scripts.every(script => script === 'latin'))
                return;
            const names = people.map(item => item.text.replace(/\s+/g, ' '));
            if (/^by\s/i.test(text))
                out.push(names);
            else
                latinRows.push(names);
        });
        for (const names of latinRows)
            if (nativeCounts.has(names.length))
                out.push(names);
    }
    return out;
}
function hanPersonsAsRomanised(recognized: MetadataSnapshot, evidence?: EvidenceBundle): MetadataSnapshot {
    const creators = (recognized.creators || []) as any[];
    const hanOnly = (person: any) => {
        const whole = `${person?.lastName ?? ''}${person?.firstName ?? ''}`.replace(/\s+/g, '');
        return /^[\p{Script=Han}]{2,4}$/u.test(whole) || (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]{2,8}$/u.test(whole) && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(whole));
    };
    const han = creators.filter(hanOnly);
    if (!han.length)
        return recognized;
    const pages = (evidence?.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind));
    const bylines = romanisedBylines(pages).filter(names => names.length === han.length);
    const recorded = bylines.length ? null : romanisedPeopleOfTheLinks(evidence, creators.length);
    if (!bylines.length && !recorded)
        return recognized;
    const names = bylines[0];
    let changed = false;
    let place = 0;
    const out = creators.map((person, at) => {
        if (!hanOnly(person))
            return person;
        const printed = recorded ? recorded[at] : names[place++];
        if (!printed)
            return person;
        const whole = `${person.lastName ?? ''}${person.firstName ?? ''}`.replace(/\s+/g, '');
        if (nameRelation(whole, printed, { positional: true }).relation !== 'hanRomanised')
            return person;
        const hanSurname = String(person.firstName || '').trim() ? String(person.lastName).replace(/\s+/g, '') : whole.slice(0, 1);
        const tokens = printed.split(/\s+/);
        const first = romanisedSyllables(tokens[0]) === hanSurname.length, last = romanisedSyllables(tokens[tokens.length - 1]) === hanSurname.length;
        const parted = first || last ? null : personParts(printed);
        if (!first && !last && !(parted && parted.fieldMode === 0))
            return person;
        const surname = parted ? parted.lastName : first ? tokens[0] : tokens[tokens.length - 1];
        const given = parted ? parted.firstName : (first ? tokens.slice(1) : tokens.slice(0, -1)).join(' ');
        const korean = koreanSurnameOfHanja(parted ? whole.slice(0, 1) : hanSurname);
        if ((korean && fold(romanise(korean)) === fold(surname)) || /[-‐‑]/.test(given))
            return person;
        changed = true;
        return { ...person, lastName: surname, firstName: given, fieldMode: 0 };
    });
    return changed ? { ...recognized, creators: out } : recognized;
}
function romanisedPeopleOfTheLinks(evidence: EvidenceBundle | undefined, count: number): string[] | null {
    const lists: string[][] = [];
    for (const link of evidence?.links || []) {
        if (link?.relation !== 'sameEdition' && link?.relation !== 'sameWork')
            continue;
        const value = link.stated?.creators?.value;
        if (typeof value !== 'string' || value.length > 4000)
            continue;
        const people = value.split(/\s*;\s*/).map(piece => piece.normalize('NFKC').replace(/\s+/g, ' ').trim()).filter(Boolean);
        if (people.length !== count || !people.some(piece => scriptOfName(piece) === 'latin'))
            continue;
        lists.push(people);
    }
    if (!lists.length)
        return null;
    const key = (list: string[]) => list.map(piece => piece.toLowerCase()).join(';');
    return lists.every(list => key(list) === key(lists[0])) ? lists[0] : null;
}
export interface SearchedRecord {
    title?: unknown;
    creators?: unknown[];
    fields?: Record<string, unknown>;
    identifiers?: {
        DOI?: string;
    };
}
export interface StoredIdentifierStanding {
    standing: 'same' | 'another';
    record: SearchedRecord;
    why: string;
}
const YEAR_IN = /(?<!\d)((?:1[5-9]|20)\d{2})(?!\d)/;
const surnameKey = (person: any) => foldedLetters(String(person?.lastName ?? person?.name ?? ''));
export function storedIdentifierStanding(doi: unknown, read: MetadataSnapshot, records: SearchedRecord[] | undefined, evidence: EvidenceBundle | undefined): StoredIdentifierStanding | null {
    const held = String(doi ?? '').trim();
    if (!held || !records?.length)
        return null;
    const record = records.find(entry => sameDOI(String(entry?.identifiers?.DOI || entry?.fields?.DOI || ''), held));
    if (!record)
        return null;
    const text = evidencePages(evidence).map(entry => entry.text).join('\n');
    const flat = foldedLetters(text);
    if (flat.includes(foldedLetters(held)))
        return null;
    const titleKey = foldedLetters(read.fields?.title);
    if (titleKey.length < 6 || foldedLetters(record.title ?? record.fields?.title) !== titleKey)
        return null;
    const readNames = (read.creators || []).map(surnameKey).filter(name => name.length >= 2);
    if (!readNames.length)
        return null;
    const recordNames = (record.creators || []).map(surnameKey).filter(name => name.length >= 2);
    const recordYear = YEAR_IN.exec(String(record.fields?.date ?? ''))?.[1] || '';
    const readYear = YEAR_IN.exec(String(read.fields?.date ?? ''))?.[1] || '';
    const printedOnThePages = (value: unknown) => { const key = foldedLetters(value); return key.length >= 4 && flat.includes(key); };
    const container = String(record.fields?.publicationTitle ?? record.fields?.bookTitle ?? record.fields?.proceedingsTitle ?? '').trim();
    if (!recordNames.length) {
        const yearsPrinted = new Set((text.slice(0, 200000).match(/(?<!\d)(?:1[5-9]|20)\d{2}(?!\d)/g) || []));
        const tied = (!!recordYear && (readYear === recordYear || yearsPrinted.has(recordYear))) || printedOnThePages(record.fields?.publisher) || printedOnThePages(container);
        return tied ? null : { standing: 'another', record,
            why: `저장된 DOI ${held}의 기록은 같은 제목이지만 사람을 적지 않았고, 쪽의 저자 줄 말고도 이 문서에 묶는 것(쪽이 찍은 해·발행처·실린 곳)이 없는 다른 저작입니다` };
    }
    const shared = readNames.filter(name => recordNames.includes(name));
    if (!shared.length)
        return { standing: 'another', record, why: `저장된 DOI ${held}의 기록은 같은 제목이지만 사람(${recordNames.slice(0, 3).join(', ')})이 쪽의 저자와 겹치지 않는 다른 저작입니다` };
    const allPeople = shared.length === readNames.length && recordNames.every(name => readNames.includes(name));
    const sameYear = !!recordYear && recordYear === readYear;
    const sameContainer = !!container && journalKey(container).length >= 4 && journalKey(container) === journalKey(read.fields?.publicationTitle);
    return allPeople && (sameYear || sameContainer)
        ? { standing: 'same', record, why: `저장된 DOI ${held}의 기록은 같은 제목·같은 사람${sameYear ? `·같은 해(${recordYear})` : ''}${sameContainer ? '·같은 학술지' : ''}의 같은 저작입니다` } : null;
}
function statedByTheRecord(field: string, value: unknown, record: SearchedRecord, doi: unknown): boolean {
    const held = String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!held)
        return false;
    if (field === 'url')
        return !!String(doi ?? '').trim() && held.includes(String(doi).trim().toLowerCase());
    const stated = String(record.fields?.[field] ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!stated)
        return false;
    if (DATE_FIELDS.has(field))
        return canonicalDate(held) === canonicalDate(stated) || held === stated;
    return held === stated;
}
function hangulPeopleStated(value: unknown): string[] {
    return String(value ?? '').split(/\s*;\s*/).map(piece => {
        const tokens = piece.normalize('NFKC').trim().split(/\s+/).filter(Boolean);
        if (tokens.length === 2 && /^[가-힣]+$/.test(tokens.join('')) && tokens[0].length <= 3 && isKoreanSurname(tokens[1]))
            return `${tokens[1]}${tokens[0]}`;
        return tokens.join('');
    }).filter(name => /^[가-힣]{2,5}$/.test(name));
}
function hangulPeopleOfTheRecords(evidence: EvidenceBundle | undefined, records: SearchedRecord[] | undefined, title: string, pageText: string): string[] {
    const names: string[] = [];
    for (const link of evidence?.links || []) {
        if (link?.relation === 'sameEdition' || link?.relation === 'sameWork')
            names.push(...hangulPeopleStated(link.stated?.creators?.value));
    }
    for (const entry of (evidence?.observations || []) as Array<{
        kind?: string;
        text?: string;
    }>) {
        if (entry.kind !== 'externalRecord')
            continue;
        try {
            names.push(...hangulPeopleStated(JSON.parse(String(entry.text || ''))?.stated?.creators?.value));
        }
        catch { }
    }
    const key = lettersOf(title);
    if (key.length >= 6 && titleSupportedByPDF(title, pageText)) {
        for (const record of records || []) {
            if (lettersOf(record?.title) !== key)
                continue;
            for (const person of (record.creators || []) as any[]) {
                const name = `${person?.lastName ?? person?.name ?? ''}${person?.firstName ?? ''}`.normalize('NFKC').replace(/\s+/g, '');
                if (/^[가-힣]{2,5}$/.test(name))
                    names.push(name);
            }
        }
    }
    return [...new Set(names)];
}
function hangulPeopleOnThePages(pages: Array<{
    text?: string;
}>): Array<{
    name: string;
    hanja?: string;
}> {
    const found: Array<{
        name: string;
        hanja?: string;
    }> = [];
    const flat = (value: string) => value.replace(/\s+/g, '');
    for (const page of pages) {
        for (const raw of String(page.text || '').normalize('NFKC').split(/\r?\n/)) {
            const marked = raw.replace(/[*⁎∗†‡§¶∥✉#]+/g, ' ').replace(/\s+/g, ' ').trim();
            if (!marked || marked.length > 60)
                continue;
            for (const pair of marked.matchAll(/([가-힣](?: ?[가-힣]){1,4}) ?[(（] ?([\p{Script=Han}](?: ?[\p{Script=Han}]){1,4}) ?[)）]/gu))
                found.push({ name: flat(pair[1]), hanja: flat(pair[2]) });
            for (const pair of marked.matchAll(/([\p{Script=Han}](?: ?[\p{Script=Han}]){1,4}) ?[(（] ?([가-힣](?: ?[가-힣]){1,4}) ?[)）]/gu))
                found.push({ name: flat(pair[2]), hanja: flat(pair[1]) });
            const line = marked.replace(/[(（][^()（）]{0,80}[)）]/g, ' ').replace(/\s+/g, ' ').trim();
            if (line.length > 40)
                continue;
            const label = roleWordAt(line, 'label', PERSON_MEANINGS);
            const labelled = label && /^[가-힣](?: ?[가-힣]){1,4}$/.test(label.rest) ? label.rest : '';
            const approved = personOfDegreeSentence(line);
            for (const name of [labelled, approved])
                if (/^[가-힣]{2,5}$/.test(flat(name)))
                    found.push({ name: flat(name) });
        }
    }
    return found;
}
function hanjaPersonsInHangul(recognized: MetadataSnapshot, evidence: EvidenceBundle | undefined, records: SearchedRecord[] | undefined, body?: 'hangul' | 'latin' | null): MetadataSnapshot {
    const creators = (recognized.creators || []) as any[];
    const hanOnly = (person: any) => /^[\p{Script=Han}]{2,5}$/u.test(`${person?.lastName ?? ''}${person?.firstName ?? ''}`.replace(/\s+/g, ''));
    if (!creators.some(hanOnly) || (body !== undefined ? body || scriptTheRecordStates(recognized) : documentBodyScript(evidence) || scriptTheRecordStates(recognized)) !== 'hangul')
        return recognized;
    const pages = (evidence?.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind));
    const pageText = pages.map(o => o.text).join(String.fromCharCode(10));
    const fromRecords = hangulPeopleOfTheRecords(evidence, records, String(recognized.fields?.title || ''), pageText);
    let fromPages: Array<{
        name: string;
        hanja?: string;
    }> | null = null;
    const taken = new Set(creators.filter(person => !hanOnly(person)).map(person => `${person?.lastName ?? ''}${person?.firstName ?? ''}`.replace(/\s+/g, '')));
    let changed = false;
    const out = creators.map(person => {
        if (!hanOnly(person))
            return person;
        const same = (names: string[]) => [...new Set(names.filter(name => !taken.has(name) && sameName(person, { lastName: name }, 'hanjaInHangul')))];
        let found = same(fromRecords);
        const whole = `${person?.lastName ?? ''}${person?.firstName ?? ''}`.replace(/\s+/g, '');
        if (!found.length)
            found = same((fromPages ??= hangulPeopleOnThePages(pages)).filter(entry => !entry.hanja || entry.hanja === whole).map(entry => entry.name));
        if (found.length !== 1)
            return person;
        taken.add(found[0]);
        changed = true;
        return { ...person, lastName: found[0], firstName: '', fieldMode: 1 };
    });
    return changed ? { ...recognized, creators: out } : recognized;
}
function creatorsInTheBodyLanguage(offered: MetadataSnapshot, evidence?: EvidenceBundle, records?: SearchedRecord[], bodyScript?: 'hangul' | 'latin' | null): MetadataSnapshot {
    const romanised = hanPersonsAsRomanised(offered, evidence);
    const recognized = hanjaPersonsInHangul(romanised, evidence, records, bodyScript);
    const read = (recognized.creators || []) as any[];
    if (!read.length)
        return recognized;
    const hangul = (person: any) => /[가-힣]/.test(`${person?.lastName ?? ''}${person?.firstName ?? ''}`);
    const latin = (person: any) => /[A-Za-z]/.test(`${person?.lastName ?? ''}${person?.firstName ?? ''}`) && !hangul(person);
    if (!read.some(latin))
        return recognized;
    const body = documentBodyScript(evidence) || scriptTheRecordStates(recognized);
    if (body !== 'hangul')
        return recognized;
    const pages = (evidence?.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind));
    const text = pages.map(o => o.text).join(String.fromCharCode(10));
    const printed = namesOfPersonRows(text).filter(name => /^[가-힣]{2,4}$/.test(name));
    const taken = new Set(read.filter(hangul).map(person => `${person.lastName ?? ''}${person.firstName ?? ''}`.replace(/\s+/g, '')));
    let changed = false;
    const inHangul = (person: any, name: string) => { taken.add(name); changed = true; return { ...person, lastName: name, firstName: '', fieldMode: 1 }; };
    const matched = read.map(person => {
        if (!latin(person))
            return person;
        const name = printed.find(candidate => !taken.has(candidate) && sameName(candidate, person, 'bodyLanguage'));
        return name ? inHangul(person, name) : person;
    });
    const pairs = matched.some(latin) ? bylinesPrintedTwice(pages) : [];
    const people = matched.map((person, index) => {
        if (!latin(person))
            return person;
        for (const pair of pairs) {
            const at = placeInTheLatinByline(read, index, pair);
            const name = at >= 0 ? pair.hangul[at] : '';
            if (name && !taken.has(name) && surnameAgrees(name, person))
                return inHangul(person, name);
        }
        return person;
    });
    const firstPage = pages.filter(o => /^(?:OCR )?page 1\b/.test(String(o.locator || ''))).map(o => String(o.text || '')).join(' ').replace(/\s+/g, '');
    const at = people.map(person => hangul(person) ? firstPage.indexOf(`${person.lastName ?? ''}${person.firstName ?? ''}`.replace(/\s+/g, '')) : -1);
    let ordered = people;
    if (at.every(index => index >= 0) && new Set(at).size === at.length) {
        ordered = people.map((person, index) => ({ person, at: at[index] })).sort((a, b) => a.at - b.at).map(entry => entry.person);
        if (ordered.some((person, index) => person !== people[index]))
            changed = true;
    }
    return changed ? { ...recognized, creators: ordered } : recognized;
}
function completedFromTheDocument(title: string, pageText: string, evidence: EvidenceBundle | undefined, readings: Record<string, any> | undefined): {
    title: string;
} | {
    advice: string;
} | null {
    if (!title || titleEnding(title) !== 'open')
        return null;
    const read = lettersOf(title), page = lettersOf(pageText);
    const continued = continuationOf(pageStructureOf(evidence), title);
    const next = continued ? lettersOf(continued.rest) : '';
    if (next.length >= 2) {
        for (const candidate of titleCandidatesOf(evidence, readings)) {
            if (candidate.source !== 'linked')
                continue;
            const whole = lettersOf(candidate.title);
            if (whole.length <= read.length || !whole.startsWith(read) || titleEnding(candidate.title) === 'open')
                continue;
            const rest = whole.slice(read.length);
            if (rest.startsWith(next) && page.includes(rest))
                return { title: candidate.title };
        }
        const joined = TITLE_LINE_SHAPES.joinTitleLines([title, continued!.rest]);
        if (continued!.displaced !== 'onlyCandidate' && titleEnding(joined) !== 'open')
            return { title: joined };
    }
    return { advice: '제목이 끝나지 않았습니다(「' + title.slice(-12) + '」로 끝남) — 다음 줄을 잃은 판독으로 보여 체크를 풀었습니다. PDF 표지를 확인하세요.' };
}
function titleInTheBodyLanguage(title: string, recognized: MetadataSnapshot, pageText: string, evidence: EvidenceBundle | undefined, readings: Record<string, any> | undefined): {
    title: string;
} | {
    advice: string;
} | null {
    if (!title)
        return null;
    const body = documentBodyScript(evidence) || scriptTheRecordStates(recognized);
    if (!body)
        return null;
    const side = titleSide;
    const read = side(title);
    if (!read || read === body)
        return null;
    const structure = pageStructureOf(evidence);
    const statedElsewhere = new Set([recognized.fields.university, recognized.fields.institution, recognized.fields.publisher,
        ...((recognized.creators || []) as any[]).flatMap(person => [person?.lastName, `${person?.lastName ?? ''}${person?.firstName ?? ''}`, `${person?.firstName ?? ''}${person?.lastName ?? ''}`])]
        .map(value => lettersOf(value)).filter(value => value.length >= 2));
    for (const candidate of titleCandidatesOf(evidence, readings)) {
        if (candidate.title.length > TITLE.maxChars)
            continue;
        if (side(candidate.title) !== body || isNotATitle(candidate.title))
            continue;
        if (statedElsewhere.has(lettersOf(candidate.title)))
            continue;
        const printed = candidate.source === 'linked' ? titleSupportedByPDF(candidate.title, pageText)
            : candidate.source === 'page' ? parallelOf(structure, title, candidate.title) : !!printedAsTitle(structure, candidate.title);
        if (printed)
            return { title: candidate.title };
    }
    return { advice: '본문 언어와 다른 언어의 제목입니다 — 이 문서에서 본문 언어 제목을 찾지 못해 체크를 풀었습니다.' };
}
function titleTheDocumentGivesInstead(pageText: string, evidence: EvidenceBundle | undefined, body: 'hangul' | 'latin' | null, accept: (candidate: string) => boolean = () => true): string {
    for (const { title: candidate, source } of titleCandidatesOf(evidence)) {
        if (source !== 'linked' && source !== 'running')
            continue;
        if (isNotATitle(candidate) || titleEnding(candidate) === 'open')
            continue;
        if (body && titleSide(candidate) !== body)
            continue;
        if (!accept(candidate))
            continue;
        if (titleSupportedByPDF(candidate, pageText))
            return candidate;
    }
    return '';
}
function evaluateIndependentRecord(input: EvaluationInput): Evaluation {
    const { before, route } = input;
    const empty: MetadataSnapshot = { ...before, fields: {}, creators: [] };
    const offered = nameFieldsAsNames(withoutPortalTag(normaliseAgents(normaliseLanguage(empty, normaliseDates(input.recognized)))));
    const text = (input.evidence?.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind)).map(o => o.text).join('\n');
    const body = bodyLanguageOf(input.evidence)?.language === 'en' ? 'latin'
        : /^ko\b/i.test(String(offered.fields.language || '')) ? 'hangul' : documentBodyScript(input.evidence);
    const titleScreened = sanitizeRecognizedTitle(offered, text, { structure: pageStructureOf(input.evidence) });
    const titleAdvice: string[] = [];
    let title = withoutStatuteReference(titleScreened.fields.title || '');
    const completed = completedFromTheDocument(title, text, input.evidence, input.readings);
    if (completed && 'title' in completed)
        title = completed.title;
    else if (completed)
        titleAdvice.push(completed.advice);
    const inBodyScript = titleInTheBodyLanguage(title, titleScreened, text, input.evidence, input.readings);
    if (inBodyScript && 'title' in inBodyScript)
        title = inBodyScript.title;
    else if (inBodyScript)
        titleAdvice.push(inBodyScript.advice);
    const titleNotes: string[] = [];
    const offeredTitle = String(offered.fields.title || '').trim();
    if (!title && offeredTitle && isNotATitle(offeredTitle)) {
        const given = titleTheDocumentGivesInstead(text, input.evidence, body || scriptTheRecordStates(offered));
        if (given) {
            title = given;
            titleNotes.push(`판독한 제목 「${noteExcerpt(offeredTitle)}」은 제목이 아닙니다 — 이 문서가 주는 제목 「${noteExcerpt(given)}」(쪽에 찍혀 있음)으로 채웠습니다.`);
        }
    }
    const textScreened = sanitizeCreators({ ...titleScreened, fields: { ...titleScreened.fields, title } }, body);
    const publisherScreened = sanitizeRecognizedPublisher(textScreened, input.evidence);
    const inBodyLanguage = creatorsInTheBodyLanguage(publisherScreened, input.evidence, input.searchedRecords, body);
    const shaped: MetadataSnapshot = { ...inBodyLanguage,
        creators: (inBodyLanguage.creators || []).map(nameAsItIsWritten) };
    const contracted = underTheFieldContract(shaped, { evidence: input.evidence, registryBound: !!(route.identifierPDF && route.authoritative), registryRecords: input.searchedRecords });
    let contractedRecord = contracted.record;
    if (contracted.refusedTitle) {
        const refused = lettersOf(contracted.refusedTitle);
        const given = titleUnderContract(titleTheDocumentGivesInstead(text, input.evidence, body || scriptTheRecordStates(offered), candidate => lettersOf(candidate) !== refused && !titleIsBodyAfterASectionHeading(candidate, input.evidence)));
        if (given) {
            contractedRecord = { ...contractedRecord, fields: { ...contractedRecord.fields, title: given } };
            titleNotes.push(`판독한 제목 「${noteExcerpt(contracted.refusedTitle)}」은 본문입니다 — 이 문서가 주는 제목 「${noteExcerpt(given)}」(쪽에 찍혀 있음)으로 채웠습니다.`);
        }
    }
    const decidedByTheRecord = contracted.doiRecord?.fields || {};
    const folioRun = BARE_NUMBER.test(String(contractedRecord.fields.pages ?? '')) ? folioRunFrom(String(contractedRecord.fields.pages).trim(), input.evidence) : null;
    const screened: MetadataSnapshot = folioRun ? { ...contractedRecord, fields: { ...contractedRecord.fields, pages: folioRun } } : contractedRecord;
    const glyphs = (value: string) => value.replace(/[‐-―−﹘﹣－˗]/gu, '-').replace(/[‘’ʼ‛]/gu, "'").replace(/[­​-‍﻿]/gu, '');
    const person = (creator: any) => [glyphs(String(creator?.lastName ?? '').trim()), glyphs(initialsSpacedText(String(creator?.firstName ?? '').trim())),
        creator?.fieldMode === 1 ? 1 : 0];
    const roleNameOf = (creator: any): string => {
        if (creator?.creatorType)
            return String(creator.creatorType);
        if (creator?.creatorTypeID === undefined || creator?.creatorTypeID === null)
            return 'author';
        try {
            return String((globalThis as any).Zotero?.CreatorTypes?.getName?.(creator.creatorTypeID) || '');
        }
        catch {
            return '';
        }
    };
    const sameRole = (held: any, read: any) => { const x = roleNameOf(held), y = roleNameOf(read); return !x || !y || x === y || y === 'author'; };
    const issns = (value: unknown) => [...new Set(String(value ?? '').split(/[\s,;/]+/).map(token => validISSN(token)).filter(Boolean))].sort().join(' ');
    const sameISSNs = (a: unknown, b: unknown) => !!issns(a) && issns(a) === issns(b);
    const sameISBNs = (a: unknown, b: unknown) => { const held = isbnsIn(a), read = isbnsIn(b); return read.length > 0 && read.every(isbn => held.includes(isbn)); };
    const same = (a: unknown, b: unknown, field = '') => Array.isArray(a) && Array.isArray(b)
        ? a.length === b.length && a.every((creator, index) => JSON.stringify(person(creator)) === JSON.stringify(person(b[index])) && sameRole(creator, b[index]))
        : field === 'DOI' && sameDOI(a, b) ? true
            : field === 'url' && sameDOILink(a, b) ? true
                : field === 'ISSN' && sameISSNs(a, b) ? true
                    : field === 'ISBN' && sameISBNs(a, b) ? true
                        : DATE_FIELDS.has(field) && sameDate(a, b) ? true
                            : JSON.stringify(a ?? '') === JSON.stringify(b ?? '');
    let changes: FieldChange[] = buildDiff(empty, screened, screened.typeRead !== false).map(change => ({ ...change,
        oldValue: change.field === 'creators' ? before.creators : change.field === 'itemType' ? before.itemType : before.fields[change.field] ?? ''
    })).filter(change => !same(change.oldValue, change.newValue, change.field));
    const advice: Record<string, string> = {};
    const fieldChoice: Record<string, boolean> = {};
    const notes: string[] = [...titleNotes, ...Object.values(contracted.notes)];
    const readFromDocument = readTheDocument(route);
    if (titleAdvice.length)
        advice.title = titleAdvice.join(' ');
    const firstPageText = evidencePages(input.evidence).filter(entry => entry.page === 1).map(entry => entry.text).join('\n');
    for (const change of changes) {
        if (change.field !== 'pages' || 'pages' in decidedByTheRecord)
            continue;
        const printed = startPageTheDocumentPrints(change.newValue, firstPageText, documentExtent(input.evidence));
        if (printed)
            change.newValue = printed;
    }
    changes = changes.filter(change => !same(change.oldValue, change.newValue, change.field));
    for (const change of changes) {
        if (change.field !== 'pages' || !BARE_NUMBER.test(String(change.newValue ?? '')))
            continue;
        if (readFromDocument && !route.identifierPDF && !route.authoritative && !('pages' in decidedByTheRecord)) {
            advice.pages = '문서에서 읽은 쪽번호 하나입니다 — 그 쪽이 몇 쪽인지일 뿐 이 문헌의 수록 범위가 아닙니다.';
        }
    }
    if (route.lookupUnreachable) {
        for (const change of changes) {
            advice[change.field] = advice[change.field] || '외부 식별자 조회가 끝나지 않아 이 값을 레코드와 대조하지 못했습니다 — 확인 후 직접 선택하세요.';
        }
    }
    const standing = route.overwriteFromDocument && readFromDocument && !screened.fields.DOI
        ? storedIdentifierStanding(before.fields.DOI, screened, input.searchedRecords, input.evidence) : null;
    const ofThisEdition = route.overwriteFromDocument && standing?.standing !== 'another' ? storedRecordOfThisEdition(before, screened) : null;
    const keptAsThisEditions = (field: string, value: unknown) => !!ofThisEdition
        && storedValueNoSourceContradicts(field, value, screened, { evidence: input.evidence, notes: contracted.notes, heldDOI: before.fields.DOI });
    if (route.overwriteFromDocument && readFromDocument && readAWholeRecord(screened)) {
        let cleared = 0;
        const kept: string[] = [];
        for (const [field, oldValue] of Object.entries(before.fields)) {
            if (!oldValue || screened.fields[field] || changes.some(c => c.field === field))
                continue;
            if (KEPT_WHEN_REPLACING.has(field))
                continue;
            if (field === 'DOI' && standing?.standing === 'same') {
                notes.push(`덮어쓰기: ${standing.why} — 비우지 않습니다.`);
                continue;
            }
            if ((field === 'ISBN' || field === 'DOI') && identifierPrintedAsTheDocumentsOwn(field, oldValue, input.evidence, screened.fields.title))
                continue;
            if (keptAsThisEditions(field, oldValue)) {
                kept.push(field);
                continue;
            }
            changes.push({ field, oldValue, newValue: '', replacedFromDocument: true });
            cleared++;
        }
        if (before.creators.length && !screened.creators.length && !changes.some(c => c.field === 'creators')) {
            if (keptAsThisEditions('creators', before.creators))
                kept.push('creators');
            else {
                changes.push({ field: 'creators', oldValue: before.creators, newValue: [], replacedFromDocument: true });
                cleared++;
            }
        }
        if (kept.length)
            notes.push(`덮어쓰기: 저장된 기록은 같은 ${ofThisEdition}의 이 판의 기록입니다 — 어느 출처도 부정하지 않는 저장값 ${kept.length}개(${kept.join(', ')})는 비우지 않습니다.`);
        if (cleared)
            notes.push(`문서 값으로 덮어쓰기: 문서에 없는 필드 ${cleared}개를 비웁니다 — 남기려면 도구막대나 이 행에서 해당 필드를 해제하세요.`);
    }
    if (standing?.standing === 'another') {
        let cleared = 0;
        for (const [field, oldValue] of Object.entries(before.fields)) {
            if (!oldValue || screened.fields[field] || changes.some(c => c.field === field) || KEPT_WHEN_REPLACING.has(field))
                continue;
            if (field !== 'DOI' && !statedByTheRecord(field, oldValue, standing.record, before.fields.DOI))
                continue;
            changes.push({ field, oldValue, newValue: '', replacedFromDocument: true });
            cleared++;
        }
        if (cleared)
            notes.push(`문서 값으로 덮어쓰기: ${standing.why} — 그 번호와 그 기록이 적은 저장값 ${cleared}개를 비웁니다.`);
    }
    if (route.overwriteFromDocument) {
        const held = String(before.fields.publisher ?? '').trim();
        const container = String(screened.fields.publicationTitle ?? '').trim();
        if (held && container && !screened.fields.publisher && !changes.some(c => c.field === 'publisher')
            && foldedLetters(held).length >= 4 && foldedLetters(held) === foldedLetters(container) && !publisherTheDocumentStates(held, input.evidence)) {
            changes.push({ field: 'publisher', oldValue: before.fields.publisher, newValue: '', replacedFromDocument: true });
            notes.push(`문서 값으로 덮어쓰기: 저장된 발행처 「${held}」은 이 문서가 실린 곳(학술지)의 이름입니다 — 쪽이 발행처로 찍지 않아 비웁니다.`);
        }
    }
    const verification = verifyFields(changes, { recognized: screened, evidence: input.evidence,
        readings: input.readings, itemType: screened.itemType, pdfFingerprint: fileIdentity(input.pdfFingerprint), policyVersion: input.policyVersion,
        ...(contracted.doiRecord ? { doiRecord: contracted.doiRecord } : {}) });
    const state: ApprovalState = { approvals: input.existing?.approvals, protections: input.existing?.protections, verification };
    if (input.carried)
        carryDecisionsForward(input.carried, state, changes);
    for (const change of changes) {
        const conflict = protectionConflict(state, change);
        if (conflict) {
            advice[change.field] = '사용자가 보호한 값과 다릅니다 — 상세 비교에서 확인하세요.';
            fieldChoice[change.field] = false;
        }
        else if ((verification[change.field]?.outcome === 'conflicting' || verification[change.field]?.contradicted) && fieldChoice[change.field] === undefined) {
            advice[change.field] = advice[change.field] || `문서 본문이 이 값과 어긋납니다 — ${String(verification[change.field]?.note || '').slice(0, 120)}`;
            fieldChoice[change.field] = false;
        }
        else if (/\/(?:container|part)-scope$/.test(String(verification[change.field]?.rule || '')) && fieldChoice[change.field] === undefined) {
            advice[change.field] = advice[change.field] || String(verification[change.field]?.note || '');
            fieldChoice[change.field] = false;
        }
    }
    const match: Match = { score: null, reasons: [], review: true };
    const stored = assessPublicationSafety(before, screened);
    const safety: PublicationSafety = stored.code === 'published-over-preprint' ? stored : { blocked: false };
    if (safety.blocked) {
        for (const change of changes) {
            advice[change.field] = '사전출판본 기록입니다 — 이미 출판된 기록을 덮지 않습니다. 최종 출판본을 확인한 뒤 직접 선택하세요.';
            fieldChoice[change.field] = false;
        }
    }
    const conflicting = Object.values(verification).some(v => v.outcome === 'conflicting');
    const verified = changes.length > 0 && changes.every(c => verification[c.field]?.level === 'verified');
    let status: Status = conflicting ? 'mismatch'
        : !String(screened.fields.title || '').trim() ? 'review'
            : route.authoritative && verified && !route.manualReview ? 'ready' : 'review';
    if (Object.values(fieldChoice).includes(false) && status === 'ready')
        status = 'review';
    if (!String(screened.fields.title || '').trim()) {
        status = 'review';
        advice.title = '인식된 문자열을 제목으로 확인하지 못했습니다. 원본 응답과 PDF를 확인하세요.';
    }
    match.reasons.unshift(conflicting ? '문서 또는 연결된 레코드와 충돌하는 필드가 있습니다.'
        : route.authoritative && verified ? (route.identifierPDF ? '문서에 인쇄된 식별자로 공식 레코드를 확인했습니다.'
            : '공식 출처(국가 목록·특허 공보)의 기록으로 확인했습니다.')
            : '기존 Zotero 값은 판단 기준으로 사용하지 않았습니다. 새 문서 판독 결과와 근거를 확인하세요.');
    if (safety.blocked) {
        status = 'publishedKept';
        match.reasons.unshift(safety.reason || '');
    }
    match.reasons.push(...notes);
    const writing = new Set(changes.filter(change => !(change.newValue === '' || change.newValue === null || change.newValue === undefined
        || (Array.isArray(change.newValue) && !change.newValue.length))).map(change => change.field));
    const difference = route.standalonePDF ? null : storedDifference(before, screened, writing);
    return { changes, recognized: screened, screened, offered, match, safety, advice, fieldChoice,
        verification, approvals: state.approvals, protections: state.protections,
        manualReview: status !== 'ready', status, codes: safety.blocked ? ['preprintKept'] : [],
        error: safety.blocked ? '판독이 Research Square 사전출판본에 머물렀고 최종 출판본을 찾지 못했습니다. 이미 출판된 기록을 덮지 않습니다.' : route.error,
        ...(difference ? { storedDifference: difference } : {}) };
}
export function applyEvaluation(row: Row, evaluation: Evaluation, policyVersion: string): void {
    row.changes = evaluation.changes;
    row.recognized = evaluation.recognized;
    row.match = evaluation.match;
    row.safety = evaluation.safety;
    row.advice = Object.keys(evaluation.advice).length ? evaluation.advice : undefined;
    if (evaluation.fieldChoice && Object.keys(evaluation.fieldChoice).length) {
        row.fieldChoice = { ...evaluation.fieldChoice, ...(row.fieldChoice || {}) };
    }
    row.verification = evaluation.verification;
    row.approvals = evaluation.approvals;
    row.protections = evaluation.protections;
    row.manualReview = evaluation.manualReview;
    row.status = evaluation.status;
    if (evaluation.error !== undefined)
        row.error = evaluation.error;
    for (const field of Object.keys(evaluation.advice)) {
        if (row.fieldChoice?.[field] === undefined)
            row.fieldChoice = { ...(row.fieldChoice || {}), [field]: false };
    }
    row.recognizedWith = policyVersion;
    if (row.staleGeneration && row.staleGeneration !== policyVersion)
        row.staleGeneration = undefined;
    if (evaluation.storedDifference)
        row.storedDifference = evaluation.storedDifference;
    else
        delete row.storedDifference;
    row.checked = false;
    applyFieldConflicts(row, policyVersion);
}
export function applyFieldConflicts(row: Row, policyVersion: string): void {
    const conflicts = row.fieldConflicts || [];
    if (!conflicts.length)
        return;
    for (const conflict of conflicts) {
        const change = (row.changes || []).find(entry => entry.field === conflict.field);
        if (!change)
            continue;
        const held = row.verification?.[conflict.field];
        row.verification = {
            ...(row.verification || {}),
            [conflict.field]: {
                field: conflict.field, level: 'conflicting', outcome: 'conflicting',
                value: String(change.newValue ?? ''), valueType: held?.valueType || 'string',
                rule: 'external/sources-disagree',
                note: `같은 역할(${conflict.role})의 값을 출처들이 다르게 진술합니다: ${conflict.values.map(item => `${item.provider || '문서'} ${item.value}${item.role ? ` (${item.role})` : ''}`).join(' / ')} — 어느 값도 자동으로 확정하지 않습니다.`,
                itemType: held?.itemType || String(row.recognized?.itemType || row.before?.itemType || ''),
                pdfFingerprint: held?.pdfFingerprint || fileIdentity(row.pdfFingerprint || ''),
                observations: held?.observations || [], policyVersion, checkedAt: Date.now()
            }
        };
        if (row.fieldChoice?.[conflict.field] === undefined)
            row.fieldChoice = { ...(row.fieldChoice || {}), [conflict.field]: false };
        row.manualReview = true;
        if (row.status === 'ready')
            row.status = 'review';
    }
}
const JUDGED_STATUSES: readonly string[] = ['ready', 'review', 'mismatch', 'protected', 'publishedKept'];
export const NOT_REJUDGED_NOTE = '이 행은 판독 원본을 남기지 않은 옛 결과라 지금 규칙으로 다시 판정하지 않고 저장된 판정을 그대로 둡니다 — 지금 규칙으로 보려면 이 행을 「선택 재검색」하세요.';
export function reclassifyCachedRow(row: Row, policyVersion: string): void {
    if (!JUDGED_STATUSES.includes(row.status))
        return;
    const found = row.rawRecognized;
    if (!found) {
        const reasons = (row.match?.reasons || []).filter(reason => reason !== NOT_REJUDGED_NOTE);
        row.match = { ...(row.match || { score: null, review: true }), reasons: [NOT_REJUDGED_NOTE, ...reasons] };
        return;
    }
    if (!row.before)
        return;
    row.verification = normalizeVerification(row.verification, {
        itemType: String(found.itemType || row.before.itemType),
        pdfFingerprint: String(row.pdfFingerprint || ''),
        policyVersion
    });
    const evaluation = evaluateRecognition({
        before: row.before,
        recognized: found,
        route: {
            overwriteFromDocument: row.replaceMetadata,
            verifiedPDF: !!row.verifiedPDF, patentPDF: !!row.patentPDF, technicalPDF: !!row.technicalPDF,
            identifierPDF: !!row.identifierPDF, authoritative: !!row.authoritative,
            standalonePDF: !!row.standalonePDF, koreanAttempted: !!row.koreanAttempted,
            manualReview: !!row.manualReview, recognitionSource: String(row.recognitionSource || ''), error: row.error,
            ocrRead: !!row.ocrRead, lookupUnreachable: !!row.lookupUnreachable
        },
        evidence: row.evidence,
        readings: row.coverProposal?.sources,
        searchedRecords: (row.restore?.candidates || []).map(candidate => candidate?.record).filter(Boolean),
        existing: { approvals: row.approvals, protections: row.protections },
        pdfFingerprint: String(row.pdfFingerprint || ''),
        policyVersion
    });
    applyEvaluation(row, evaluation, row.recognizedWith || policyVersion);
}

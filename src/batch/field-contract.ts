import type { MetadataSnapshot } from '../types';
import { ISSUE_NUMBERS, abbreviatesTheSerial, isDateOnly, isDocumentPartName, isInstitutionName, isIssueStatement, isNotATitle, isOrganisationName, isOrganisationOnly, isOwnJournalName, isPublishingHouse, isSerialName, journalOfIssueStatement, monthNamedIssue, serialNameShaped, statesAnIssue, thesisTypeOf, withoutGenreTag } from '../recognition/title-guards';
import { canonicalDate, folioCandidates, folioRange, layerFoliosLostLeadingDigits, numberedSectionHeading, opensWithVolume, readDates, splitTrailingEdition, unreadMonthYears, volumeDesignator, withoutStatuteReference } from '../recognition/roles';
import { BYLINE_MEANINGS, NOT_A_PERSON_SOURCE, SPONSOR_LABEL_SOURCE, SPONSOR_LEAD_SOURCE, alternationOf, bylineRoleOf, formGrid, frequencyStatementOf, labelWordOf, roleWordAt, wordsOf } from '../recognition/label-words';
import { NAME_JOINERS, ROMANISED_COMPOUND_SURNAMES, crossesScripts, isPinyinSyllable, letterScript, nameShape, personParts, suffixOnTheGivenSide } from '../metadata/person-name';
import { PERSON_ROW_KINDS, misreadRoleWordLine, nameOfItem, publicationStatementOf, readBylineRow, rowIsByline, rowIsNameList, unitHeadIn, type PublicationTail } from '../recognition/byline-row';
import { SURNAME_SPELLINGS, casedAsPrinted, hangulTransliterates, initialsWord, nameRelation, printedForm, printedPerson, sameName, surnameAgrees } from '../metadata/name-equivalence';
import { universityName } from '../recognition/agents';
import { degreeStatedIn, isDegreeFormLine, isDegreeFormPage } from '../recognition/degree';
import { labelledTitle } from '../recognition/candidate';
import { FIELDS_BY_TYPE, KIND_TO_TYPE } from '../recognition/item-fields';
import { doiIn, isbnsIn, normalizedISBN, registeredNumberWord, sameDOI, validISBN, validISSN } from '../metadata/identifier-compare';
import { doiStandingsOf, ownDOIsInOrder, ownISBNs, sentenceShapedLine, titleSupportedByPDF, withoutCitations, withoutGluedTail, type DOIStanding } from '../recognition/pdf-identifiers';
import { NOTE_MARK, foldedLetters, linesOf, shouting, withoutNoteMarks } from '../recognition/folded-letters';
import { nameAsStored } from '../metadata/creator-text';
import { hasInlineMarkup, markupJointsAlong, withoutInlineMarkup } from '../metadata/inline-markup';
import { continuedTitle, creatorsFromVision, titleWithStatedSubtitle } from '../ocr/vision-record';
import { parallelRestatement, titleEnding } from '../recognition/title-grammar';
import { titleBlocksOf } from '../recognition/title-block';
import { fold, hangulRespelledByRomanisation, jamoOf, jamoSubstitutions, romanise } from '../metadata/korean-names';
import { bodySampleText, brokenLayerPages, documentBodyScript, documentExtent, documentProfile, insertedLeaf, layerSpellingOfAName, nearWord, pageStructureOf, scannedPageSizes, statementsOf, structureInputOf, unreadableTextLayer, type EvidenceBundle, type LinkRecord } from './evidence';
import { anotherWorkTitled, codesOf, footerIssuerOf, otherWorksSpansIn, regionSpansIn, roleOf, rowsOf, runningTexts, withoutOtherWorksIn, withoutStatus } from '../recognition/page-structure';
import { attributionOf, isTranslatedBook, originalAuthorOf, statedAs, statedOnlyAsSponsor, yearsOfEditions, type JudgedReading } from '../recognition/statements';
import { jurisdictionOf, nameInImprint, ordinanceMinistry, stateBody } from '../recognition/imprint-marks';
import { editionIn, serialOfAVolumeLine } from '../recognition/international-catalog';
import { withAttachedAccents } from '../recognition/text-encoding';
import { caseIsLowered, confusableJamo, oncePerPerson, editDistance, hangulNamesOf, ocrConfusedName, personKey, ocrConfusionOf, refinedForm, sameStatement, type RefinementContext } from './source-merge';
import { publisherNameIn, publisherTheDocumentStates, titleSide } from './evaluate';
export interface ContractOutcome {
    record: MetadataSnapshot;
    notes: Record<string, string>;
    refusedTitle?: string;
    doiRecord?: {
        provider: string;
        DOI: string;
        fields: Record<string, string>;
        itemType?: string;
    };
}
export interface ContractContext {
    evidence?: EvidenceBundle;
    registryBound?: boolean;
    registryRecords?: Array<{
        title?: unknown;
        fields?: Record<string, unknown>;
        identifiers?: {
            DOI?: string;
        };
        creators?: unknown[];
    }>;
}
export function dateAtThePrintedPrecision(value: string, pages: string, options: {
    flagged?: string;
    finerDay?: boolean;
} = {}): string {
    const held = canonicalDate(value);
    const flagged = String(options.flagged || '');
    if (!held || held.length < 7 || (!pages && !flagged))
        return value;
    const all = flagged ? `${pages}\n${flagged}` : pages;
    if (held.length === 7 && pages && options.finerDay !== false) {
        const day = printedDayOfTheMonth(held, pages);
        if (day)
            return day;
    }
    const printed = readDates(all).filter(reading => reading.role !== 'accessDate' && held.startsWith(reading.value));
    if (printed.some(reading => reading.value === held))
        return value;
    const month = printed.find(reading => reading.precision === 'month');
    if (month)
        return held.length === 10 && !printedInADayRange(held, all) ? month.value : value;
    const year = held.slice(0, 4);
    const own = readDates(withoutCitations(all)).filter(reading => reading.role !== 'accessDate' && reading.value.startsWith(year));
    if (own.some(reading => reading.precision !== 'year') || !own.length || dayRangeInYear(year, all))
        return value;
    if (own.every(reading => HISTORY_DATE_ROLES.has(String(reading.role))))
        return value;
    if (!readDates(withoutCitations(pages)).some(reading => reading.value === year && reading.role !== 'accessDate' && reading.role !== 'coveragePeriod'))
        return value;
    if ((flagged && readDates(flagged).some(reading => reading.value.startsWith(year))) || unreadMonthYears(all).has(year))
        return value;
    return year;
}
const PUBLICATION_DATE_ROLES = new Set(['publicationDate', 'onlineDate']);
const NUMBERING_BEFORE_A_DAY = /(?:(?:^|[^\p{L}])(?:vol|volume|no|nr|num|number|issue|iss)\.?|n°|№|\d[^\S\n]*:)[^\S\n]*$/iu;
function printedDayOfTheMonth(held: string, pages: string): string {
    const text = withoutCitations(pages).replace(/ㆍ/g, '·').normalize('NFKC');
    const readings = readDates(text);
    const lineAround = (index: number) => { const from = text.lastIndexOf('\n', index - 1) + 1, to = text.indexOf('\n', index); return { from, to: to < 0 ? text.length : to }; };
    const days = new Set<string>();
    for (const reading of readings) {
        if (reading.precision !== 'day' || !reading.value.startsWith(`${held}-`) || /\n/.test(reading.raw))
            continue;
        if (!/\p{L}/u.test(reading.raw) && !/^\s*(?:1[4-9]|20)\d{2}\s*[.\-/]/.test(reading.raw))
            continue;
        const role = String(reading.role ?? '');
        if (role === 'accessDate' || HISTORY_DATE_ROLES.has(role) || role === 'submissionDate' || role === 'revision')
            continue;
        const line = lineAround(reading.index);
        if (/^\s*\d/.test(reading.raw) && NUMBERING_BEFORE_A_DAY.test(text.slice(line.from, reading.index)))
            continue;
        const others = readings.some(other => other !== reading && other.precision !== 'year' && other.index >= line.from && other.index < line.to
            && (other.index + other.raw.length <= reading.index || other.index >= reading.index + reading.raw.length));
        if (others && !PUBLICATION_DATE_ROLES.has(role))
            continue;
        days.add(reading.value);
    }
    return days.size === 1 ? [...days][0] : '';
}
const DAY_RANGE_FIRST = /(?<!\d)(\d{1,2})[^\S\n]*[-–~][^\S\n]*(\d{1,2})[^\S\n]+([A-Za-z]{3,9}\.?),?[^\S\n]+((?:1[4-9]|20)\d{2})(?!\d)/g;
const DAY_RANGE_MONTH_FIRST = /(?<![A-Za-z])([A-Za-z]{3,9}\.?)[^\S\n]+(\d{1,2})[^\S\n]*[-–~][^\S\n]*(\d{1,2}),?[^\S\n]+((?:1[4-9]|20)\d{2})(?!\d)/g;
const DAY_RANGE_KOREAN = /((?:1[4-9]|20)\d{2})[^\S\n]*[년年][^\S\n]*(\d{1,2})[^\S\n]*[월月][^\S\n]*(\d{1,2})[^\S\n]*[일日]?[^\S\n]*[-–~][^\S\n]*(\d{1,2})[^\S\n]*[일日]/g;
function dayRangeInYear(year: string, pages: string): boolean {
    for (const found of pages.matchAll(DAY_RANGE_FIRST))
        if (found[4] === year && canonicalDate(`${found[3]} ${found[4]}`))
            return true;
    for (const found of pages.matchAll(DAY_RANGE_MONTH_FIRST))
        if (found[4] === year && canonicalDate(`${found[1]} ${found[4]}`))
            return true;
    for (const found of pages.matchAll(DAY_RANGE_KOREAN))
        if (found[1] === year)
            return true;
    return false;
}
const HISTORY_DATE_ROLES = new Set(['receivedDate', 'acceptedDate']);
function workDateTexts(evidence: EvidenceBundle | undefined): {
    workPages: string;
    flaggedPages: string;
    layerWork: string;
} {
    const structure = pageStructureOf(evidence);
    const leaf = (locator: unknown) => { const at = /^(?:OCR )?page (\d+)/.exec(String(locator || '')); return at ? structure.pages.find(entry => entry.page === Number(at[1]))?.role === 'insertedLeaf' : false; };
    const work = (evidence?.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind) && !leaf(o.locator));
    const broken = brokenLayerPages(evidence);
    const flaggedLayer = (o: {
        kind: string;
        locator?: unknown;
        text?: unknown;
    }) => o.kind === 'pdfText'
        && (broken.has(pageNumberOf({ locator: String(o.locator || '') })) || unreadableTextLayer(String(o.text || '').normalize('NFKC'), false));
    return {
        workPages: work.filter(o => !flaggedLayer(o)).map(o => withAttachedAccents(String(o.text || ''))).join('\n'),
        flaggedPages: work.filter(flaggedLayer).map(o => withAttachedAccents(String(o.text || ''))).join('\n'),
        layerWork: work.filter(o => o.kind === 'pdfText' && !flaggedLayer(o)).map(o => String(o.text || '')).join('\n')
    };
}
export function historyDateOfThePages(value: unknown, evidence: EvidenceBundle | undefined): {
    raw: string;
    role: string;
} | null {
    const held = canonicalDate(String(value ?? ''));
    if (!held || !evidence)
        return null;
    const { workPages, flaggedPages, layerWork } = workDateTexts(evidence);
    const statedText = /[\p{L}\p{N}]/u.test(layerWork) ? layerWork : `${workPages}\n${flaggedPages}`;
    const own = withoutCitations(statedText);
    const readings = readDates(own).filter(reading => reading.role !== 'accessDate');
    const history = (reading: {
        role: unknown;
    }) => HISTORY_DATE_ROLES.has(String(reading.role));
    if (!readings.some(history))
        return null;
    const exact = readings.find(reading => history(reading) && reading.value === held);
    if (exact && !readings.some(reading => !history(reading) && reading.value === held))
        return { raw: exact.raw, role: String(exact.role) };
    const year = held.slice(0, 4);
    const ofTheYear = readings.filter(reading => reading.value.startsWith(year));
    if (!ofTheYear.length || !ofTheYear.every(history))
        return null;
    const stated = ofTheYear.find(reading => reading.value.startsWith(held));
    if (!stated)
        return null;
    const pieces: string[] = [];
    let from = 0;
    for (const reading of [...ofTheYear].sort((a, b) => a.index - b.index)) {
        if (reading.index < from)
            continue;
        pieces.push(own.slice(from, reading.index));
        from = reading.index + reading.raw.length;
    }
    pieces.push(own.slice(from));
    if (new RegExp(`(?<!\\d)${year}(?!\\d)`).test(pieces.join(' ')))
        return null;
    return { raw: stated.raw, role: String(stated.role) };
}
function publicationDateOfTheLinkedRecord(evidence: EvidenceBundle | undefined): {
    value: string;
    provider: string;
} | null {
    for (const link of evidence?.links || []) {
        if (link?.relation !== 'sameEdition' || /^google/i.test(String(link.provider || '')))
            continue;
        const value = String(link.stated?.date?.value ?? '').trim();
        if (value && canonicalDate(value))
            return { value: canonicalDate(value)!, provider: String(link.provider || '') };
    }
    return null;
}
const sameDateValue = (a: unknown, b: unknown) => { const x = canonicalDate(String(a ?? '')), y = canonicalDate(String(b ?? '')); return !!x && x === y; };
function printedInADayRange(held: string, pages: string): boolean {
    const day = Number(held.slice(8, 10)), month = held.slice(0, 7);
    const covers = (monthOf: string | null, from: string, to: string) => monthOf === month && Number(from) <= day && day <= Number(to);
    for (const found of pages.matchAll(DAY_RANGE_FIRST))
        if (covers(canonicalDate(`${found[3]} ${found[4]}`), found[1], found[2]))
            return true;
    for (const found of pages.matchAll(DAY_RANGE_MONTH_FIRST))
        if (covers(canonicalDate(`${found[1]} ${found[4]}`), found[2], found[3]))
            return true;
    for (const found of pages.matchAll(DAY_RANGE_KOREAN))
        if (covers(`${found[1]}-${found[2].padStart(2, '0')}`, found[3], found[4]))
            return true;
    return false;
}
const repairText = (value: string) => value.replace(/ᆞ/g, '·');
export const diacriticsIn = (value: string) => (value.normalize('NFKD').match(/\p{M}/gu) || []).length;
const escapeForPattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export { withoutNoteMarks };
const nameWithoutNoteMarks = (value: string) => withoutNoteMarks(value).replace(new RegExp(`(?<=[\\p{Script=Hangul}\\p{Script=Han}])${NOTE_MARK}+$`, 'u'), '').trim();
const MARK_SIGN = /\s*[™℠®]/gu;
const GLUED_MARK = /(?<=\p{Ll})(?:TM|SM)(?=$|[\s,.;:)\]])/gu;
function withoutMarks(value: string, rawPages = ''): string {
    let text = String(value ?? '').replace(MARK_SIGN, '').replace(GLUED_MARK, '');
    if (rawPages && /[™℠]/.test(rawPages)) {
        text = text.replace(/(\p{Lu}{2,})(TM|SM)(?=$|[\s,.;:)\]])/gu, (whole, word: string, mark: string) => new RegExp(`(?<![\\p{L}])${escapeForPattern(word)}\\s*${mark === 'TM' ? '™' : '℠'}`, 'u').test(rawPages) ? word : whole);
    }
    return text.replace(/\s+/g, ' ').trim();
}
function firstOfTwoMarks(value: string, rawPages: string): string | null {
    const key = foldedLetters(value);
    if (key.length < 4 || !/[™℠®]/.test(rawPages))
        return null;
    for (const line of rawPages.split(/\r?\n/)) {
        const signs = line.match(/[™℠®]/gu);
        if (!signs)
            continue;
        if (foldedLetters(line.normalize('NFKC')) !== key && foldedLetters(line.replace(/[™℠®]/gu, '')) !== key)
            continue;
        const parts = line.split(/[™℠®]/u).map(part => part.replace(/\s+/g, ' ').trim()).filter(part => /\p{L}/u.test(part));
        if (parts.length >= 2)
            return parts[0];
    }
    return null;
}
export const NAME_FIELDS = ['publisher', 'institution', 'university', 'publicationTitle', 'proceedingsTitle', 'bookTitle', 'place', 'series', 'seriesTitle'];
function notANameBecause(text: string): string {
    if (!/\p{L}/u.test(text))
        return '글자가 없는 값입니다';
    if (/(?:https?:\/\/|\bwww\.)\S|(?<![\w.+-])[\w.+-]+@[\w-]+\.[\w.-]+/i.test(text))
        return '주소·전자우편입니다';
    if (/(?<![\p{L}])(?:orcid|doi|isbn|e-?issn|issn)(?![\p{L}])/iu.test(text) || text.split(/[\s,;:()（）[\]]+/u).some(word => registeredNumberWord(word.replace(/[.]+$/, ''))))
        return '등록 번호(ORCID iD·DOI·ISBN·ISSN)를 단 값입니다';
    return '';
}
export function imprintName(value: unknown): string {
    return nameInImprint(repairText(String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim()));
}
const SERIAL_WORD = /(?:학회지|학술지|논문집|회지|회보|학보|저널|誌|紀要|journal|review|letters|transactions|proceedings|bulletin|magazine|annals|quarterly|newsletter|research|reports?\b)/i;
export function isAnInstitutionNotASerial(value: unknown): boolean {
    const name = String(value ?? '').normalize('NFKC').trim();
    if (!name || SERIAL_WORD.test(name))
        return false;
    return isOrganisationName(name.replace(/\s+/g, '')) || isOrganisationOnly(name);
}
const UNIT_ONLY = /^(?:(?:일반\s*)?대학원|[가-힣]{0,12}(?:학부|학과|전공|대학원)|the\s+graduate\s+school|graduate\s+school|department\s+of\s+.+|school\s+of\s+.+|college\s+of\s+.+)$/i;
const TITLE_LABEL = /^\s*(?:제\s*목|title|article\s*title)\s*[:：]\s*/i;
const INID_TITLE_LABEL = /^\s*(?:\(\s*54\s*\)\s*)?(?:발명의\s*명칭|고안의\s*명칭|発明の名称|考案の名称)\s*[:：]?\s*/;
const LEADING_NUMBER = /^\s*(?:\(\s*\d{2}\s*\)|\d{1,2}[.)](?!\d))\s*/;
const TRAILING_BYLINE = /(?:\s*[―—–]\s*|\s+[-/]\s+)([^―—–/]{2,80}?)\s*(?:외(?:\s*\d+\s*(?:인|명))?|등|et\s*al\.?)\s*\d{0,4}\s*$/iu;
function withoutTrailingByline(value: string): string {
    const match = TRAILING_BYLINE.exec(value);
    if (!match)
        return value;
    const head = value.slice(0, match.index).trim();
    if (head.replace(/[^\p{L}\p{N}]+/gu, '').length < 4)
        return value;
    const hangulOnly = /^[가-힣\s·ㆍᆞ・•‧･∙⋅⸱,、\d*†‡]+$/.test(match[1]);
    const names = match[1].split(hangulOnly ? /\s*[·ㆍᆞ・•‧･∙⋅⸱,、;&]\s*|\s+/ : /\s*[·ㆍᆞ・•‧･∙⋅⸱,、;&]\s*|\s+and\s+/i)
        .map(name => name.replace(/\d+|[*∗⁎†‡§¶#✉∥]+/g, '').trim()).filter(Boolean);
    const etAl = /et\s*al/i.test(match[0]);
    const person = (name: string) => nameShape(name, { listed: true }).person !== 'no' || (etAl && /^\p{Lu}[\p{Ll}'’-]+$/u.test(name));
    return names.length && names.every(person) ? head : value;
}
const glyphRuns = (word: string) => word.match(/(.)\1*/gsu) || [];
function struckOnce(word: string, times: number): string | null {
    const runs = glyphRuns(word);
    if (!runs.length || !runs.every(run => [...run].length % times === 0))
        return null;
    return runs.map(run => [...run].slice(0, [...run].length / times).join('')).join('');
}
const phraseLetters = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
function withoutOverprint(title: string): string {
    let words = title.split(/\s+/).filter(Boolean);
    let struck = false;
    for (const times of [4, 3, 2]) {
        const once = words.map(word => struckOnce(word, times));
        const next = [...words];
        for (let at = 0; at < words.length; at++) {
            if (once[at] === null || glyphRuns(words[at]).length < 2)
                continue;
            let from = at, to = at;
            while (from > 0 && once[from - 1] !== null)
                from--;
            while (to + 1 < words.length && once[to + 1] !== null)
                to++;
            const phrase = once.slice(from, to + 1) as string[];
            at = to;
            if ((phrase.join('').match(/\p{L}/gu) || []).length < 2)
                continue;
            const key = phraseLetters(phrase.join(''));
            const size = to - from + 1;
            let copy = false;
            for (let start = 0; start + size <= words.length && !copy; start++) {
                if (start + size > from && start <= to)
                    continue;
                copy = phraseLetters(words.slice(start, start + size).join('')) === key;
            }
            const everyWord = from === 0 && to === words.length - 1 && (phrase.join('').match(/\p{L}/gu) || []).length >= 4;
            if (copy || everyWord) {
                for (let i = from; i <= to; i++)
                    next[i] = once[i] as string;
                struck = true;
            }
        }
        if (struck) {
            words = next;
            break;
        }
    }
    if (struck) {
        const collapse = (list: string[]): string[] => {
            for (let size = Math.floor(list.length / 2); size >= 1; size--) {
                for (let at = 0; at + 2 * size <= list.length; at++) {
                    const first = phraseLetters(list.slice(at, at + size).join(''));
                    if (first && first === phraseLetters(list.slice(at + size, at + 2 * size).join('')))
                        return collapse([...list.slice(0, at + size), ...list.slice(at + 2 * size)]);
                }
            }
            return list;
        };
        return collapse(words).join(' ');
    }
    for (let size = 2; size <= words.length / 2; size++) {
        if (words.length % size)
            continue;
        const unit = phraseLetters(words.slice(0, size).join(''));
        if (unit.length < 8)
            continue;
        let whole = true;
        for (let at = size; at < words.length && whole; at += size)
            whole = phraseLetters(words.slice(at, at + size).join('')) === unit;
        if (whole)
            return words.slice(0, size).join(' ');
    }
    return title;
}
function withoutRepeatedSubtitle(title: string): string {
    let value = title;
    for (;;) {
        const colons = [...value.matchAll(/\s*[:：]\s*/g)];
        if (colons.length < 2)
            return value;
        const last = colons[colons.length - 1], before = colons[colons.length - 2];
        const tail = phraseLetters(value.slice(last.index! + last[0].length));
        if (!tail || tail !== phraseLetters(value.slice(before.index! + before[0].length, last.index)))
            return value;
        value = value.slice(0, last.index).trim();
    }
}
function withoutDoubledTitle(title: string): string {
    const text = title.replace(/\s+/g, ' ').trim();
    for (const gap of [0, 1]) {
        if ((text.length - gap) % 2)
            continue;
        const size = (text.length - gap) / 2;
        if (size < 12)
            continue;
        const head = text.slice(0, size), seam = text.slice(size, size + gap);
        if ((gap === 0 || seam === ' ') && text.slice(size + gap) === head && /\p{L}/u.test(head))
            return head;
    }
    return title;
}
const furnitureHeld = new Map<string, {
    title: string;
    removed: string[];
}>();
function titleFurniture(value: string): {
    title: string;
    removed: string[];
} {
    const held = furnitureHeld.get(value);
    if (held)
        return { title: held.title, removed: [...held.removed] };
    const done = titleFurnitureOf(value);
    if (furnitureHeld.size >= 50000)
        furnitureHeld.clear();
    furnitureHeld.set(value, { title: done.title, removed: [...done.removed] });
    return done;
}
function titleFurnitureOf(value: string): {
    title: string;
    removed: string[];
} {
    const removed: string[] = [];
    const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();
    const step = (what: string, before: string, after: string) => { const done = tidy(after); if (done !== before)
        removed.push(what); return done; };
    let title = value.replace(TITLE_LABEL, '').replace(INID_TITLE_LABEL, '').replace(LEADING_NUMBER, '').replace(INID_TITLE_LABEL, '');
    if (tidy(title) !== tidy(value))
        removed.push('칸 이름·번호');
    title = tidy(title);
    title = step('머리표·자료 종류', title, withoutGenreTag(title));
    title = step('조문 참조', title, withoutStatuteReference(title));
    title = step('책임 표시', title, withoutTrailingByline(title));
    title = step('상표 표시', title, withoutMarks(title));
    title = step('겹쳐 찍힌 글자', title, withoutOverprint(title));
    title = step('두 번 이어 적은 제목', title, withoutDoubledTitle(title));
    title = step('각주 표시', title, withoutNoteMarks(title));
    title = step('되풀이된 부제', title, withoutNoteMarks(withoutRepeatedSubtitle(title)));
    title = step('기사 번호 꼬리', title, withoutArticleNumberTail(title));
    return { title, removed };
}
const ARTICLE_NUMBER_TAIL = /\s*[-–—:;,]?\s*\bart\.\s*no\.?(?:\s*[A-Za-z]{0,2}\d[\dA-Za-z]{0,11})?\s*$/i;
function withoutArticleNumberTail(title: string): string {
    const match = ARTICLE_NUMBER_TAIL.exec(title);
    if (!match)
        return title;
    const head = title.slice(0, match.index).trim();
    return foldedLetters(head).length > 8 ? head : title;
}
const CJK_LETTER = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const CATALOGUE_TITLE_FIELDS = ['title', 'shortTitle', 'bookTitle', 'proceedingsTitle', 'publicationTitle', 'seriesTitle', 'series', 'encyclopediaTitle', 'dictionaryTitle'];
function frenchShaped(value: string): boolean {
    return /(?:^|[\s(«"“‘])(?:[cdjlmnst]|qu)['’]\p{L}/iu.test(value) || /[çœ]/iu.test(value) || /\p{L}\s+[?!](?:\s|$)/u.test(value) || /«\s|\s»/u.test(value);
}
export function withoutCatalogueMarks(value: string, language: unknown, pages: string): string {
    let text = String(value ?? '');
    const trailing = /\s+[/:;=]\s*$/u.exec(text);
    if (trailing && foldedLetters(text.slice(0, trailing.index)).length > 4)
        text = text.slice(0, trailing.index).trimEnd();
    if (CJK_LETTER.test(text) || !/\p{Script=Latin}/u.test(text))
        return text;
    const code = String(language ?? '').trim().toLowerCase();
    if (/^(?:fr|fra|fre)(?:$|[-_])/.test(code) || (!code && frenchShaped(text)))
        return text;
    return text.replace(/(\S)\s+:\s+(?=(\S))/gu, (whole: string, before: string, after: string, at: number) => {
        if (/\d/.test(before) && /\d/.test(after))
            return whole;
        const headWord = /[\p{L}\p{N}]+$/u.exec(text.slice(0, at + before.length))?.[0] || '';
        const tailWord = /^[\p{L}\p{N}]+/u.exec(text.slice(at + whole.length))?.[0] || '';
        if (headWord && tailWord && new RegExp(`(?<![\\p{L}\\p{N}])${escapeForPattern(headWord)}\\s+:\\s*${escapeForPattern(tailWord)}`, 'iu').test(pages))
            return whole;
        return `${before}: `;
    });
}
const TRAILING_CONTAINER_STATEMENT = /\s+((?:originally\s+|first\s+)?(?:published|appeared|reprinted|republished)\s+(?:in|from)\s+(\S.{1,150}))$/i;
function withoutTrailingContainerStatement(title: string, fields: Record<string, any>, pages: string): string {
    const match = TRAILING_CONTAINER_STATEMENT.exec(title);
    if (!match)
        return title;
    const head = title.slice(0, match.index).trim();
    if (foldedLetters(head).length < 8)
        return title;
    const tail = foldedLetters(match[2]), statement = foldedLetters(match[1]);
    const named = CONTAINER_FIELDS.map(field => foldedLetters(imprintName(fields[field]))).filter(name => name.length >= 4);
    const printedApart = linesOf(pages).some(line => foldedLetters(line).startsWith(statement) && foldedLetters(line) !== foldedLetters(title));
    return named.some(name => tail === name || tail.startsWith(name)) || printedApart ? head : title;
}
const printedLinesOf = (text: unknown) => String(text ?? '').split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
export function withoutGluedHead(title: string, evidence: EvidenceBundle | undefined): string {
    if (!evidence || !title)
        return title;
    const whole = foldedLetters(title);
    for (const block of titleBlocksOf(pageStructureOf(evidence))) {
        if (block.reading !== 'layer' || block.basis !== 'layout' || !block.label)
            continue;
        const main = foldedLetters(block.main.text), label = foldedLetters(block.label.text);
        if (main.length < 12 || label.length < 6 || whole.length <= main.length || !whole.endsWith(main))
            continue;
        if (!whole.slice(0, whole.length - main.length).includes(label))
            continue;
        let count = 0, at = title.length;
        while (at > 0 && count < main.length) {
            at--;
            if (foldedLetters(title[at]))
                count++;
        }
        const kept = title.slice(at).replace(/^[\s:：\-–—,;.]+/u, '').trim();
        if (foldedLetters(kept) === main)
            return kept;
    }
    return title;
}
export function withoutGluedByline(title: string, creators: unknown): string {
    const words = title.split(/\s+/).filter(Boolean);
    if (words.length < 2)
        return title;
    const last = words[words.length - 1].replace(/[.,;:]+$/, '');
    if (/^\p{Ll}{3,}$/u.test(last) && !/^[a-h]{1,4}$/.test(last))
        return title;
    const held = new Set<string>();
    for (const person of (Array.isArray(creators) ? creators : []) as any[]) {
        const last = foldedLetters(person?.lastName ?? person?.name), first = foldedLetters(person?.firstName);
        for (const name of [last + first, first + last])
            if (name.length >= 2)
                held.add(name);
    }
    let cut = title, people = 0, named = 0;
    for (let take = 1; take < words.length && take <= 40; take++) {
        if (/^\p{Ll}{4,}/u.test(words[words.length - take]))
            continue;
        const tail = words.slice(words.length - take).join(' ');
        const row = gluedRow(tail);
        if (!row)
            continue;
        const theirs = row.names.filter(forms => forms.some(form => held.has(foldedLetters(form)))).length;
        if (row.names.length < people || (row.names.length === people && theirs <= named))
            continue;
        const printed = words.slice(0, words.length - take).join(' ').trim();
        const head = printed.replace(/[\s,;·]+$/, '').trim();
        if (foldedLetters(head).length < 6 || isNotATitle(head))
            continue;
        if (titleEnding(printed) === 'open')
            continue;
        if ((row.marked && row.names.length >= 2) || (theirs > 0 && theirs * 2 >= row.names.length)) {
            cut = head;
            people = row.names.length;
            named = theirs;
        }
    }
    return cut;
}
function gluedRow(tail: string): {
    names: string[][];
    marked: boolean;
} | null {
    const paired = /^([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}가-힣][\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}가-힣\s]*?)\s+(\p{Script=Latin}[\p{Script=Latin}\s.'’-]*)$/u.exec(tail);
    if (paired && [paired[1], paired[2]].every(part => nameShape(part, { marked: true }).person !== 'no'))
        return { names: [[paired[1], paired[2]]], marked: false };
    const row = readBylineRow(tail);
    if (!PERSON_ROW_KINDS.has(row.kind) || row.organisations?.length || !row.items.length || row.items.some(item => item.shape.person === 'no'))
        return null;
    return { names: row.items.map(item => [item.text, nameOfItem(item), ...item.alternates]), marked: row.keyed };
}
const KOREAN_CONTINUED_LINE = /^(?:의|이|가|을|를|은|는|에|로|와|과|도|에서|으로)\s/;
const paragraphGoesOn = (line: string) => sentenceShapedLine(line) || KOREAN_CONTINUED_LINE.test(line);
export function titleIsBodyAfterASectionHeading(title: unknown, evidence: EvidenceBundle | undefined): boolean {
    const target = foldedLetters(title);
    if (target.length < 8)
        return false;
    let afterHeading = 0;
    for (const page of frontPages(evidence)) {
        const lines = printedLinesOf(page.text);
        const folded = lines.map(line => foldedLetters(line));
        for (let at = 0; at < lines.length; at++) {
            if (!folded[at] || folded[at][0] !== target[0])
                continue;
            let joined = '', end = at;
            while (end < lines.length && joined.length < target.length && end - at < 12) {
                joined += folded[end];
                end++;
            }
            if (!joined.startsWith(target))
                continue;
            const heading = at > 0 && numberedSectionHeading(lines[at - 1], lines.slice(at, at + 4));
            const following = lines.slice(joined.length > target.length ? end - 1 : end, end + 3);
            const below = lines.slice(end, end + 6);
            const prose = below.findIndex(paragraphGoesOn);
            const bylineBelow = below.slice(0, prose < 0 ? below.length : prose)
                .some(line => rowIsByline(line, 'strict'));
            if (!heading || bylineBelow || !following.some(paragraphGoesOn))
                return false;
            afterHeading++;
        }
    }
    return afterHeading > 0;
}
function titleWithoutFurniture(value: string): string {
    return titleFurniture(value).title;
}
export function titleUnderContract(value: unknown): string {
    const title = titleWithoutFurniture(repairText(withoutInlineMarkup(String(value ?? ''))));
    return !title || isNotATitle(title) ? '' : title;
}
const heldForObservations = new WeakMap<object, {
    size: number;
    answers: Map<string, unknown>;
}>();
function heldAnswer<T>(evidence: EvidenceBundle | undefined, key: string, compute: () => T): T {
    const observations = evidence?.observations as unknown as object | undefined;
    if (!observations || typeof observations !== 'object')
        return compute();
    const size = (evidence!.observations || []).length;
    let held = heldForObservations.get(observations);
    if (!held || held.size !== size) {
        held = { size, answers: new Map() };
        heldForObservations.set(observations, held);
    }
    if (held.answers.has(key))
        return held.answers.get(key) as T;
    const answer = compute();
    if (key.length <= 4000)
        held.answers.set(key, answer);
    return answer;
}
function serialNamesOnThePages(evidence: EvidenceBundle | undefined): string[] {
    return heldAnswer(evidence, 'serialNamesOnThePages', () => serialNamesOnThePagesOf(evidence));
}
function serialNamesOnThePagesOf(evidence: EvidenceBundle | undefined): string[] {
    const names = new Set<string>();
    for (const line of runningTexts(pageStructureOf(evidence), ['masthead', 'runningHead', 'runningFoot'])) {
        const name = journalOfIssueStatement(line);
        if (name && foldedLetters(name).length >= 2)
            names.add(foldedLetters(name));
    }
    if (!names.size)
        return [];
    const heads = [...names];
    const alone = new Set<string>();
    for (const page of (evidence?.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind) && /page (\d+)/.test(String(o.locator || '')))) {
        for (const line of String(page.text || '').normalize('NFKC').split(/\r?\n/)) {
            const value = line.replace(/\s+/g, ' ').trim();
            if (!value)
                continue;
            const head = value.length > 400 ? '' : foldedLetters(value.slice(0, 12));
            if (value.length > 400 || heads.some(name => name.startsWith(head)))
                alone.add(foldedLetters(value));
        }
    }
    return [...names].filter(name => !alone.has(name));
}
function serialNameInAnIssueStatement(evidence: EvidenceBundle | undefined, fields: Record<string, any>): string {
    const volume = numberOnly(String(fields.volume ?? '')), issue = numberOnly(String(fields.issue ?? ''));
    const issns = String(fields.ISSN ?? '').split(/[\s,;]+/).map(value => value.trim()).filter(value => /^\d{4}-?\d{3}[\dXx]$/.test(value));
    for (const page of (evidence?.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind) && [1, 2].includes(pageNumberOf(o)))) {
        const lines = linesOf(page.text);
        const printsTheISSN = issns.some(issn => String(page.text || '').replace(/[\s-]/g, '').toUpperCase().includes(issn.replace(/-/g, '').toUpperCase()));
        for (const line of new Set([...lines.slice(0, 3), ...lines.slice(-3)])) {
            const name = journalOfIssueStatement(line);
            if (!name || !/[가-힣]/.test(name) || foldedLetters(name).length < 3)
                continue;
            const stated = issueNumbersOf(line);
            const agrees = !!volume && stated.volume === volume && (!issue || !stated.issue || stated.issue === issue);
            if (agrees || printsTheISSN)
                return name.replace(/[\s,，]+$/, '');
        }
    }
    return '';
}
function romanSerialNameShaped(value: string, title: string, options: {
    nameShaped?: boolean;
} = {}): boolean {
    const text = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const words = text.split(' ');
    return text.length >= 6 && text.length <= 120 && words.length >= 2 && words.length <= 10 && /^\p{Lu}/u.test(text)
        && !/[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\d]/u.test(text) && !/[.,:;!?]$/.test(text) && !/\p{L}\.(?:\s|$)/u.test(text)
        && words.every(word => word.length < 4 || /^[\p{Lu}(&]/u.test(word) || NAME_JOINERS.connective.test(word))
        && foldedLetters(text) !== title && !isInstitutionName(text) && !isOrganisationOnly(text) && (serialNameShaped(text) || !unitHeadIn(text)) && (options.nameShaped ? nameShape(text).person !== 'sure' : nameShape(text).person === 'no');
}
export function englishHalfOfABilingualName(value: unknown, fields: Record<string, any> = {}): string {
    const text = String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (text.length > 200)
        return '';
    const cjk = /[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
    const parts = text.split(/\s*[=/|·]\s*|\s+/).filter(Boolean);
    const kinds = parts.map(part => cjk.test(part) ? 'cjk' : /\p{Script=Latin}/u.test(part) ? 'latin' : 'other');
    if (kinds.includes('other'))
        return '';
    const runs: Array<{
        kind: string;
        words: string[];
    }> = [];
    parts.forEach((part, at) => { if (runs.length && runs[runs.length - 1].kind === kinds[at])
        runs[runs.length - 1].words.push(part);
    else
        runs.push({ kind: kinds[at], words: [part] }); });
    if (runs.length !== 2 || !runs.some(run => run.kind === 'cjk'))
        return '';
    const latin = runs.find(run => run.kind === 'latin')!.words.join(' ');
    return romanSerialNameShaped(latin, foldedLetters(String(fields.title ?? '')), { nameShaped: true }) ? latin : '';
}
function englishSerialNameOnThePages(evidence: EvidenceBundle | undefined, fields: Record<string, any>, held: string): string {
    const volume = numberOnly(String(fields.volume ?? '')), issue = numberOnly(String(fields.issue ?? ''));
    const year = /^(?:1[5-9]|20)\d{2}/.exec(String(fields.date ?? ''))?.[0] || '';
    const title = foldedLetters(String(fields.title ?? ''));
    const romanSerialName = (value: string) => romanSerialNameShaped(value, title);
    const agrees = (line: string) => {
        const stated = issueNumbersOf(line);
        if (volume && stated.volume && stated.volume !== volume)
            return false;
        if (issue && stated.issue && stated.issue !== issue)
            return false;
        const printedYear = /(?<!\d)((?:1[5-9]|20)\d{2})(?!\d)/.exec(line)?.[1];
        if (year && printedYear && printedYear !== year)
            return false;
        return (!!volume && stated.volume === volume) || (!!issue && stated.issue === issue);
    };
    const broken = brokenLayerPages(evidence);
    const pages = (evidence?.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind) && pageNumberOf(o) >= 1 && pageNumberOf(o) <= 5
        && !(o.kind === 'pdfText' && (broken.has(pageNumberOf(o)) || unreadableTextLayer(String(o.text || '').normalize('NFKC'), false))));
    for (const page of pages) {
        const lines = linesOf(page.text);
        const edge = [...new Set([...lines.keys()].filter(at => at < 8 || at >= lines.length - 3))];
        for (const at of edge) {
            const name = journalOfIssueStatement(lines[at]);
            if (name === null || !agrees(lines[at]))
                continue;
            const candidate = name || (at > 0 ? lines[at - 1] : '');
            if (romanSerialName(candidate))
                return candidate.replace(/\s+/g, ' ').trim();
        }
    }
    const heldKey = foldedLetters(held);
    const heads = pageStructureOf(evidence).running.filter(line => ['masthead', 'runningHead'].includes(line.kind)
        && line.seen.some(entry => { const name = journalOfIssueStatement(entry.text); return !!name && foldedLetters(name) === heldKey; }));
    if (!heads.length)
        return '';
    const headed = new Set(heads.flatMap(line => line.seen.map(entry => entry.page)));
    const opening = pages.map(pageNumberOf).filter(page => !headed.has(page)).sort((a, b) => a - b)[0];
    if (!opening || opening > Math.min(...headed))
        return '';
    for (const page of pages.filter(o => pageNumberOf(o) === opening)) {
        const first = linesOf(page.text)[0] || '';
        if (romanSerialName(first))
            return first;
    }
    return '';
}
export function titleFailsContract(title: unknown, evidence?: EvidenceBundle, itemType?: string, creators?: unknown): boolean {
    const value = titleWithoutFurniture(repairText(String(title ?? '')));
    if (!value || isNotATitle(value))
        return true;
    return namesTheSerial(value, evidence) || (!!itemType && SERIAL_PART_TYPES.has(itemType) && !!serialOnACover(value, evidence, creators));
}
function namesTheSerial(title: string, evidence: EvidenceBundle | undefined): boolean {
    if (!evidence)
        return false;
    const key = foldedLetters(title);
    if (key.length >= 2 && serialNamesOnThePages(evidence).includes(key))
        return true;
    const pages = (evidence.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind)).map(o => String(o.text || '')).join('\n');
    return isOwnJournalName(title, pages);
}
function serialOnACover(title: string, evidence: EvidenceBundle | undefined, creators?: unknown): string {
    const key = foldedLetters(title);
    if (key.length < 4)
        return '';
    const pages = new Map<string, {
        layer: string[];
        printed: string[];
    }>();
    (evidence?.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind)).forEach((observation, at) => {
        const number = pageNumberOf(observation);
        const id = number ? String(number) : `#${at}`;
        const page = pages.get(id) || { layer: [], printed: [] };
        (observation.kind === 'pdfText' ? page.layer : page.printed).push(String(observation.text || ''));
        pages.set(id, page);
    });
    const byline = Array.isArray(creators) ? creators : [];
    for (const page of pages.values()) {
        const layer = page.layer.join('\n'), printed = page.printed.join('\n');
        const text = [printed, layer].filter(Boolean).join('\n');
        if (!foldedLetters(text).includes(key))
            continue;
        if (isSerialName(title, { printed, layer, byline }))
            return text;
    }
    return '';
}
const mastheadDate = (value: unknown) => canonicalDate(value) || canonicalDate(String(value ?? '').normalize('NFKC').replace(/\s*[•‧∙|]\s*/gu, ', ').replace(/^[,\s]+|[,\s]+$/g, ''));
function bannerDateOf(pageText: string): string {
    let best = '';
    for (const line of linesOf(pageText)) {
        const issue = ISSUE_NUMBERS.exec(line);
        const tail = issue ? line.slice(issue.index + issue[0].length).replace(/^[\s,.;:•·‧∙|/–—-]+/u, '') : '';
        for (const candidate of [tail, isDateOnly(line) ? line : '']) {
            const date = candidate ? mastheadDate(candidate) : '';
            if (date && date.length > best.length)
                best = date;
        }
    }
    return best;
}
const SERIAL_PART_TYPES = new Set(['journalArticle', 'magazineArticle', 'newspaperArticle']);
function serialAsTitle(title: string, fields: Record<string, any>, evidence: EvidenceBundle | undefined, creators?: unknown): {
    why: string;
    cover: string;
} | null {
    const key = foldedLetters(title);
    if (key.length < 4)
        return null;
    const same = (value: unknown) => { const other = foldedLetters(value); return other.length >= 4 && other === key; };
    if (['publicationTitle', 'journalAbbreviation'].some(field => same(fields[field])))
        return { why: `이 기록의 학술지명과 같은 글자입니다`, cover: '' };
    for (const link of evidence?.links || []) {
        if (link?.relation !== 'sameEdition')
            continue;
        if (['publicationTitle', 'journalAbbreviation'].some(field => same(link.stated?.[field]?.value)))
            return { why: `연결된 같은 판본 기록(${link.provider})이 이 글이 실린 학술지로 적은 이름입니다`, cover: '' };
    }
    const cover = serialOnACover(title, evidence, creators);
    return cover ? { why: '학술지 표지가 한 호의 표시(권·호·쪽)와 함께 찍은 학술지 이름입니다', cover } : null;
}
function serialNameCased(name: string, pages: string): string {
    if (!shouting(name))
        return name;
    const printed = printedForm(name, pages);
    if (printed)
        return printed;
    return name.split(/(\s+)/).map((token, at) => {
        if (/^\s+$/.test(token) || !shouting(token))
            return token;
        const letters = token.replace(/[^\p{L}]/gu, '');
        if (at > 0 && /^(?:OF|AND|FOR|IN|ON|THE|TO|AT|BY|DE|DER|DES|DU|LA|LE|UND|FÜR|DI|DEL|Y|ET)$/.test(token))
            return token.toLowerCase();
        if (letters.length <= 3 || !/[AEIOUY]/.test(letters) || !/[^AEIOUY]/.test(letters))
            return token;
        return token.split(/([-‐'’&])/).map(piece => piece.length > 1 ? piece[0] + piece.slice(1).toLowerCase() : piece).join('');
    }).join('');
}
function spacedAsPrinted(name: string, evidence: EvidenceBundle | undefined): string {
    const key = foldedLetters(name);
    let best = name.replace(/\s+/g, ' ').trim();
    const words = (value: string) => value.split(/\s+/).filter(Boolean).length;
    for (const page of (evidence?.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind))) {
        const lines = String(page.text || '').normalize('NFKC').split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
        for (let at = 0; at < lines.length; at++) {
            for (const joined of [lines[at], at + 1 < lines.length ? `${lines[at]} ${lines[at + 1]}` : '']) {
                if (joined && foldedLetters(joined) === key && words(joined) > words(best))
                    best = joined;
            }
        }
    }
    return best;
}
function labelledTitlesOf(pageText: string): string[] {
    let lines = String(pageText || '').normalize('NFKC').split(/\r?\n/);
    const values: string[] = [];
    for (let round = 0; round < 6; round++) {
        const value = labelledTitle(lines.join('\n'));
        const key = foldedLetters(value);
        if (!value || !key || values.some(held => foldedLetters(held) === key))
            break;
        const readAt = (at: number) => foldedLetters(labelledTitle(lines[at])) === key;
        const readBelow = (at: number) => at > 0 && foldedLetters(lines[at]).includes(key) && foldedLetters(labelledTitle(`${lines[at - 1]}\n${lines[at]}`)) === key;
        const at = lines.findIndex((_, index) => readAt(index) || readBelow(index));
        if (at < 0)
            break;
        values.push(value);
        const drop = readAt(at) ? new Set([at]) : new Set([at - 1, at]);
        lines = lines.filter((_, index) => !drop.has(index));
    }
    return values;
}
const pageNumberOf = (observation: {
    locator?: string;
}) => Number(/page (\d+)/.exec(String(observation?.locator || ''))?.[1] || 0);
function labelledTitleOverTheFormHeading(title: string, evidence: EvidenceBundle | undefined): {
    title: string;
    page: number;
} | null {
    return heldAnswer(evidence, `labelledTitleOverTheFormHeading\u0000${title}`, () => labelledTitleOverTheFormHeadingOf(title, evidence));
}
function labelledTitleOverTheFormHeadingOf(title: string, evidence: EvidenceBundle | undefined): {
    title: string;
    page: number;
} | null {
    const key = foldedLetters(title);
    if (!evidence || key.length < 4)
        return null;
    const observations = (evidence.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind));
    const labelled = observations.map(o => ({ page: pageNumberOf(o), values: labelledTitlesOf(String(o.text || '')) }));
    if (labelled.some(entry => entry.values.some(value => foldedLetters(value).includes(key))))
        return null;
    let labelledOnAPage = false;
    try {
        const labelledLine = new RegExp(`^[^:：]{1,20}[:：]\\s*${escapeForPattern(title.replace(/\s+/g, ' ').trim())}$`, 'iu');
        labelledOnAPage = observations.some(o => linesOf(o.text).some(line => labelledLine.test(line)));
    }
    catch {
        labelledOnAPage = false;
    }
    if (labelledOnAPage)
        return null;
    const body = documentBodyScript(evidence);
    const inBody = (value: string) => body === 'latin' ? !/[가-힣]/.test(value) : body === 'hangul' ? /[가-힣]/.test(value) : true;
    const mayFoldTo = (text: string) => text.length > 400 || key.startsWith(foldedLetters(text.slice(0, 12)));
    const labelledHeading = (line: string) => {
        const words = line.split(' ');
        for (let cut = 1; cut <= Math.min(3, words.length - 1); cut++) {
            const label = words.slice(0, cut).join(' ').replace(/[:：]$/, '');
            if (!/^(?:[가-힣]{1,6}|[A-Za-z]+(?: [A-Za-z]+){0,2})$/.test(label))
                continue;
            const rest = words.slice(cut).join(' ');
            if (mayFoldTo(rest) && foldedLetters(rest) === key)
                return true;
        }
        return false;
    };
    for (const observation of observations) {
        const page = pageNumberOf(observation);
        if (!page)
            continue;
        const lines = linesOf(observation.text);
        const at = lines.findIndex((line, index) => (mayFoldTo(line) && foldedLetters(line) === key)
            || (index + 1 < lines.length && mayFoldTo(`${line} ${lines[index + 1]}`) && foldedLetters(`${line} ${lines[index + 1]}`) === key));
        const labelAt = at < 0 ? lines.findIndex(labelledHeading) : -1;
        const headingAt = at >= 0 ? at : labelAt;
        if (headingAt < 0)
            continue;
        const sameLeaf = observations.filter(other => pageNumberOf(other) === page).flatMap(other => linesOf(other.text));
        const values = labelled.filter(entry => entry.page === page).flatMap(entry => entry.values)
            .map(value => titleWithoutFurniture(repairText(value))).filter(value => !!value && !isNotATitle(value) && foldedLetters(value) !== key)
            .filter(value => { const row = lines.findIndex(line => foldedLetters(line).includes(foldedLetters(value).slice(0, 8))); return row < 0 || row > headingAt; });
        if (!values.length)
            continue;
        const shorter = values.some(value => foldedLetters(value).length > key.length);
        if (!(shorter && (labelAt >= 0 || formGrid(sameLeaf))))
            continue;
        return { title: values.find(inBody) || values[0], page };
    }
    return null;
}
const NOT_A_PERSON_WORD = new RegExp(`^(?:(?:${NOT_A_PERSON_SOURCE})(?:\\s*\\d*\\s*(?:인|명)?)?|et\\s*al\\.?|anonymous|unknown|제\\s*\\d\\s*저\\s*자)$`, 'iu');
const NOT_A_PERSON = { test: (value: string) => NOT_A_PERSON_WORD.test(value) || isDocumentPartName(value) };
const POST_NOMINAL_INITIALS = /^(?:\p{Lu}\.[^\S\n]?){1,4}\p{Lu}\.?$/u;
const LETTERED_ARTICLE_NUMBER = String.raw `\d{5,6}[A-Z]`;
const LETTERED_ARTICLE_PAGE = new RegExp(`^(${LETTERED_ARTICLE_NUMBER})(?:-(\\d{1,3}))?$`);
const LETTERED_ARTICLE_RANGE = new RegExp(`^(${LETTERED_ARTICLE_NUMBER})-(\\d{1,3})\\s*[-‐-―−~]\\s*(${LETTERED_ARTICLE_NUMBER})-(\\d{1,3})$`);
export function pagesAsARange(value: unknown): string {
    const labelled = String(value ?? '').normalize('NFKC').replace(/^\s*(?:pp?\.|pages?|쪽|페이지)\s*[:：]?\s*/i, '').trim();
    const article = LETTERED_ARTICLE_PAGE.exec(labelled);
    if (article)
        return article[1];
    const articleRange = LETTERED_ARTICLE_RANGE.exec(labelled);
    if (articleRange) {
        const [, head, from, otherHead, to] = articleRange;
        if (head !== otherHead || Number(to) < Number(from))
            return '';
        return from === to ? head : `${head}-${from}-${head}-${to}`;
    }
    const text = labelled.replace(/\s*(?:쪽|p\.?)$/i, '').trim();
    if (/^[-–—]\s*\d+\s*[-–—]$/.test(text))
        return '';
    const range = /^([A-Za-z]?\d{1,6})\s*[-‐-―−~]\s*([A-Za-z]?\d{1,6})$/.exec(text);
    if (range) {
        const [from, to] = [range[1], range[2]];
        const n = (value: string) => Number(value.replace(/\D/g, ''));
        if (/^(?:19|20)\d{2}$/.test(from) && n(to) <= 12)
            return '';
        if (from.length === 4 && /^\d{3}[\dXx]$/.test(to) && from !== to && !(n(to) > n(from) && n(to) - n(from) <= 300))
            return '';
        if (/^(?:19|20)\d{2}$/.test(from) && /^(?:19|20)\d{2}$/.test(to))
            return '';
        if (n(to) < n(from) && !(to.length < from.length))
            return '';
        if (from === to)
            return from;
        return `${from}-${to}`;
    }
    const prefixed = /^([A-Za-z]\d{1,3})([-.])(\d{1,6})\s*[-‐-―−~]\s*([A-Za-z]\d{1,3})([-.])(\d{1,6})$/.exec(text);
    if (prefixed) {
        const [, head, mark, from, otherHead, otherMark, to] = prefixed;
        if (head.toUpperCase() !== otherHead.toUpperCase() || mark !== otherMark || Number(to) < Number(from))
            return '';
        return from === to ? `${head}${mark}${from}` : `${head}${mark}${from}-${head}${mark}${to}`;
    }
    if (/^(?:[A-Za-z]?\d{1,8}|[A-Za-z]\d{9,10})$/.test(text))
        return text;
    return '';
}
export function templateDOI(value: unknown): boolean {
    const suffix = /^10\.\d{4,9}\/(.+)$/.exec(String(value ?? '').trim())?.[1] || '';
    if (!suffix)
        return false;
    const digits = suffix.replace(/\D/g, ''), letters = suffix.replace(/[^A-Za-z]/g, '');
    return (digits.length >= 3 && /^0+$/.test(digits)) || (letters.length >= 2 && /^x+$/i.test(letters)) || /x0xx|00000x|xxxxx/i.test(suffix);
}
function rangeLength(value: string): number {
    const range = /^[A-Za-z]?(\d{1,6})-[A-Za-z]?(\d{1,6})$/.exec(pagesAsARange(value));
    if (!range)
        return 0;
    const from = range[1];
    const to = range[2].length < from.length ? from.slice(0, from.length - range[2].length) + range[2] : range[2];
    return Number(to) >= Number(from) ? Number(to) - Number(from) + 1 : 0;
}
export const REFINABLE_DATES = new Set(['date', 'filingDate', 'issueDate']);
const REFINED_FIELDS = new Set(['title', ...NAME_FIELDS, 'journalAbbreviation', 'pages', ...REFINABLE_DATES]);
export { confusableJamo, ocrConfusedName, refinedForm, type RefinementContext };
const objectParticle = (word: string) => { const last = [...String(word ?? '').trim()].pop() || ''; return (jamoOf(last)?.[2] ?? 0) > 0 ? '을' : '를'; };
const topicParticle = (word: string) => { const last = [...String(word ?? '').trim()].pop() || ''; return (jamoOf(last)?.[2] ?? 0) > 0 ? '은' : '는'; };
const LATIN_NAME_PART = /^[\p{Script=Latin}\s.'’\-‐]+$/u;
const whispering = (value: string) => /^[\p{Script=Latin}\s.&'’\-‐]+$/u.test(value) && !/\p{Lu}/u.test(value) && /\p{Ll}{3}/u.test(value) && !/\p{L}\.\p{L}{2}/u.test(value)
    && value.trim().split(/\s+/).length <= 3;
function wordmarkCased(name: string, pages: string): string {
    return whispering(name) ? casedAsPrinted(name, { pages }) : name;
}
const LANGUAGE_CODE = /^[a-z]{2}(?:-[a-z0-9]{2,8})?$/;
const CONTAINER_OF: Record<string, string> = {
    journalArticle: 'publicationTitle', magazineArticle: 'publicationTitle', newspaperArticle: 'publicationTitle',
    conferencePaper: 'proceedingsTitle', bookSection: 'bookTitle', thesis: 'university', report: 'institution'
};
const CONTAINER_FIELDS = ['publicationTitle', 'proceedingsTitle', 'bookTitle'];
const CONTAINER_SLOT_TYPES = new Set(['journalArticle', 'conferencePaper', 'bookSection']);
function degreeLabel(degree: string, language: string): string {
    const doctor = /박사/.test(degree);
    if (/^ja\b/.test(language))
        return doctor ? '博士論文' : '修士論文';
    if (/^zh\b/.test(language))
        return doctor ? '博士学位论文' : '硕士学位论文';
    if (/^ko\b/.test(language) || !language)
        return doctor ? '박사학위논문' : '석사학위논문';
    return doctor ? 'Doctoral dissertation' : "Master's thesis";
}
const has = (fields: Record<string, any>, field: string) => !!String(fields[field] ?? '').trim();
export function noteExcerpt(value: unknown, budget = 60): string {
    const text = String(value ?? '');
    if (text.length <= budget)
        return text;
    const head = text.slice(0, budget - 1).replace(/[\uD800-\uDBFF]$/, '');
    const whole = /\s/.test(text.charAt(head.length)) ? head : head.replace(/\s+\S*$/, '');
    const kept = whole.length >= budget / 2 ? whole : head;
    return `${kept.replace(/[\s,;:·]+$/u, '')}…`;
}
function statesAJournal(fields: Record<string, any>): boolean {
    return has(fields, 'publicationTitle');
}
function numberOfTheIssue(fields: Record<string, any>, evidence?: EvidenceBundle): string {
    const volume = numberOnly(String(fields.volume ?? '')) || String(fields.volume ?? '').trim();
    const issue = numberOnly(String(fields.issue ?? '')) || String(fields.issue ?? '').trim();
    if (!volume && !issue)
        return '';
    const front = (evidence?.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind) && pageNumberOf(o) >= 1 && pageNumberOf(o) <= 3);
    const digits = (value: string) => `0*${escapeForPattern(value)}(?!\\d)`;
    const latinVolume = volume ? String.raw `\bvol(?:ume)?\.?\s*${digits(volume)}` : '';
    const latinIssue = issue ? String.raw `\b(?:no|number|issue)\.?\s*${digits(issue)}` : '';
    const koreanVolume = volume ? String.raw `제\s*${digits(volume)}\s*권` : '';
    const koreanIssue = issue ? String.raw `제\s*${digits(issue)}\s*호` : '';
    const shapes = [
        latinVolume && latinIssue ? `${latinVolume}\\s*[,.;:•·|/]?\\s*${latinIssue}` : '', koreanVolume && koreanIssue ? `${koreanVolume}\\s*[,.·]?\\s*${koreanIssue}` : '',
        !issue ? latinVolume : '', !issue ? koreanVolume : '', !volume ? latinIssue : '', !volume ? koreanIssue : ''
    ].filter(Boolean).map(shape => new RegExp(shape, 'iu'));
    for (const shape of shapes) {
        for (const page of front) {
            const found = shape.exec(String(page.text || '').normalize('NFKC'));
            if (found)
                return found[0].replace(/\s+/g, ' ').replace(/(?<=제) (?=\d)|(?<=\d) (?=[권호])/g, '').trim();
        }
    }
    return volume && issue ? `${volume}(${issue})` : volume || issue;
}
function sponsorOnly(name: string, evidence: EvidenceBundle | undefined): boolean {
    if (!evidence || !name.trim())
        return false;
    return statedOnlyAsSponsor(statementsOf(evidence), name);
}
function coverInstitutionOf(evidence: EvidenceBundle | undefined): string {
    const issuer = statementsOf(evidence).thisEdition.issuer;
    const named = issuer?.kind === 'publication' ? issuer.names?.[0] : undefined;
    return named ? named.printed || named.text : '';
}
function coverInstitutionInsteadOf(held: string, evidence: EvidenceBundle | undefined): {
    cover: string;
    as: 'leadBody' | 'addressee';
} | null {
    if (!evidence || !held.trim())
        return null;
    const cover = coverInstitutionOf(evidence);
    if (!cover || foldedLetters(cover) === foldedLetters(held))
        return null;
    const stated = statementsOf(evidence);
    const roles = statedAs(stated, held);
    if (roles.has('leadBody') && !statedAs(stated, cover).has('leadBody'))
        return { cover, as: 'leadBody' };
    if (roles.size && [...roles].every(role => role === 'commissioning' || role === 'sponsor'))
        return { cover, as: 'addressee' };
    return null;
}
function issuerOnTheCover(evidence: EvidenceBundle | undefined): string {
    const cover = (evidence?.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind)
        && /^(?:OCR )?page [12]\b/.test(String(o.locator || '')));
    for (const page of cover) {
        for (const line of String(page.text || '').normalize('NFKC').split(/\r?\n/).map(value => value.trim()).filter(Boolean).slice(0, 40)) {
            if (line.length > 40)
                continue;
            const tokens = line.split(/\s+/);
            if (!tokens.every(token => isOrganisationName(token)))
                continue;
            if (sponsorOnly(tokens[tokens.length - 1], evidence))
                continue;
            return tokens[tokens.length - 1];
        }
    }
    return '';
}
function issuerInThePageFurniture(evidence: EvidenceBundle | undefined): string {
    const structure = pageStructureOf(evidence);
    for (const entry of structure.pages) {
        const issuer = footerIssuerOf(structure, entry.page);
        if (issuer && !sponsorOnly(issuer, evidence))
            return issuer;
    }
    return '';
}
function editionOnTheFrontPages(evidence: EvidenceBundle | undefined): {
    number: number;
    raw: string;
    page: number;
} | null {
    const structure = pageStructureOf(evidence);
    let best: {
        number: number;
        raw: string;
        page: number;
    } | null = null;
    for (const page of readableLayerPages(evidence).sort((a, b) => a.page - b.page)) {
        if (['contents', 'body', 'references', 'insertedLeaf'].includes(roleOf(structure, page.page)))
            continue;
        for (const line of linesOf(withoutOtherWorksIn(page.text))) {
            if (line.length > 80)
                continue;
            const found = editionIn(line);
            if (!found || found.atLeast)
                continue;
            const rest = line.normalize('NFKC').replace(found.raw, ' ').replace(/(?<!\d)(?:1[5-9]|20)\d{2}(?!\d)/g, ' ');
            if (/\p{L}{2,}/u.test(rest))
                continue;
            if (!best || found.number > best.number)
                best = { number: found.number, raw: line.trim(), page: page.page };
        }
    }
    return best;
}
export function editionNumberOf(value: unknown): number | null {
    const text = String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 80)
        return null;
    const bare = /^(\d{1,3})(?:\s*(?:st|nd|rd|th|e|er|re|ème|판|版))?(?:\s+(?:ed|edn|edition|éd|édition|aufl|auflage)\.?)?\.?$/iu.exec(text);
    if (bare)
        return Number(bare[1]);
    const found = editionIn(text);
    return found && !found.atLeast ? found.number : null;
}
function editionNumberPrinted(number: number, evidence: EvidenceBundle | undefined): boolean {
    for (const page of pagesRead(evidence)) {
        for (const line of linesOf(withoutOtherWorksIn(page.lines.join('\n')))) {
            if (line.length > 200)
                continue;
            const found = editionIn(line);
            if (found && !found.atLeast && found.number === number)
                return true;
        }
    }
    return false;
}
export function editionThePagePrintsInsteadOf(value: unknown, evidence: EvidenceBundle | undefined): {
    number: number;
    raw: string;
    page: number;
} | null {
    const held = editionNumberOf(value);
    if (held === null)
        return null;
    const stated = editionOnTheFrontPages(evidence);
    if (!stated || stated.number === held || editionNumberPrinted(held, evidence))
        return null;
    return stated;
}
const ARXIV_NUMBER = String.raw `(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?`;
function arXivNumberOf(fields: Record<string, any>, pages: string): string {
    const sources = [
        [String(fields.DOI ?? ''), new RegExp(String.raw `^10\.48550\/arxiv\.${ARXIV_NUMBER}$`, 'i')],
        [String(fields.archiveID ?? ''), new RegExp(String.raw `^arxiv:\s*${ARXIV_NUMBER}$`, 'i')],
        [String(fields.url ?? ''), new RegExp(String.raw `arxiv\.org\/abs\/${ARXIV_NUMBER}`, 'i')],
        [String(pages ?? '').slice(0, 200000), new RegExp(String.raw `(?<![\p{L}\d])arxiv:\s?${ARXIV_NUMBER}`, 'iu')]
    ] as const;
    for (const [text, shape] of sources) {
        const found = shape.exec(text.trim());
        if (found)
            return found[1];
    }
    return '';
}
function inidStructureOn(evidence: EvidenceBundle | undefined): boolean {
    const codes = new Set<string>();
    for (const page of readableLayerPages(evidence)) {
        for (const line of linesOf(page.text)) {
            const code = /^\s*[(\[]\s*(\d{2})\s*[)\]]\s*\S/.exec(line.normalize('NFKC'))?.[1];
            if (code)
                codes.add(code);
            if (codes.size > 2)
                return true;
        }
    }
    return false;
}
function roleWordSlotName(people: any[] | undefined, evidence: EvidenceBundle | undefined): string {
    if (!Array.isArray(people) || people.length < 2 || !evidence)
        return '';
    const last = people[people.length - 1];
    const whole = `${String(last?.lastName ?? '')}${String(last?.firstName ?? '')}`.replace(/\s+/g, '');
    if (!/^[가-힣]{2,5}$/.test(whole) || isOrganisationName(whole))
        return '';
    const observations = evidence.observations || [];
    if (observations.some(o => o.kind === 'pdfText' && String(o.text || '').replace(/\s+/g, '').includes(whole)))
        return '';
    const imaged = new Set(observations.filter(o => o.kind === 'ocrText' && String(o.text || '').replace(/\s+/g, '').includes(whole)).map(o => pageNumberOf(o)));
    if (imaged.size > 1)
        return '';
    const linked = (evidence.links || []).filter(link => (link?.relation === 'sameEdition' || link?.relation === 'sameWork') && String(link.stated?.creators?.value ?? '').trim())
        .map(link => String(link.stated!.creators!.value).split(/\s*;\s*/).filter(Boolean));
    if (!linked.length)
        return '';
    const names = (stated: string) => hangulNamesOf(stated);
    const listed = (person: any, list: string[]) => {
        const own = hangulNamesOf(person);
        return list.some(stated => names(stated).some(name => own.includes(name)) || foldedLetters(stated) === personKey(person));
    };
    const corroborated = linked.some(list => list.length >= people.length && people.slice(0, -1).every(person => listed(person, list)));
    return corroborated && !linked.some(list => listed(last, list)) ? whole : '';
}
function reviewedWorkOfTheTitle(title: unknown, evidence: EvidenceBundle | undefined): string {
    const layer = readableLayerPages(evidence).map(page => page.text).join('\n');
    if (!layer.trim())
        return '';
    return anotherWorkTitled(title, layer).replace(/\n/g, ' ');
}
const LEGAL_FORM_TAIL = /^[\s,]*(?:corporation|corp\.?|incorporated|inc\.?|limited|ltd\.?|llc|gmbh|ag|co\.?|company|plc|s\.?\s?a\.?|kgaa|b\.?v\.?)$/i;
function institutionOverARightsHolder(held: string, evidence: EvidenceBundle | undefined): {
    name: string;
    from: string;
} | null {
    if (!evidence || !held.trim())
        return null;
    const front = statementsOf(evidence);
    if (!statedAs(front, held).has('rightsHolder'))
        return null;
    const key = foldedLetters(held);
    const furniture = issuerInThePageFurniture(evidence);
    if (furniture && foldedLetters(furniture) !== key && foldedLetters(furniture).includes(key))
        return { name: furniture, from: '쪽 머리·꼬리' };
    const issuer = front.thisEdition.issuer;
    const named = issuer?.names?.[0];
    const name = named ? String(named.printed || named.text || '').trim() : '';
    const short = foldedLetters(name);
    if (!short || short === key || !key.startsWith(short))
        return null;
    const rest = held.normalize('NFKC').trim().slice(name.length);
    if (!held.normalize('NFKC').toLowerCase().startsWith(name.toLowerCase()) || !LEGAL_FORM_TAIL.test(rest))
        return null;
    const open = pageStructureOf(evidence).opening.page || 1;
    const cover = (evidence.observations || []).filter(o => (o.kind === 'pdfText' || o.kind === 'ocrText') && pageNumberOf(o) === open).map(o => String(o.text || '')).join('\n');
    return foldedLetters(cover).includes(short) ? { name, from: '표지' } : null;
}
function titleAsTheTextLayerSpellsIt(title: string, evidence: EvidenceBundle | undefined): string | null {
    if (documentProfile(evidence).textLayer !== 'readable')
        return null;
    const target = flatLetters(title);
    if (target.length < 6)
        return null;
    const limit = target.length >= 12 ? 2 : 1;
    const targetLetters = [...target];
    const layers = (evidence?.observations || []).filter(o => o.kind === 'pdfText' && /^page \d+ of /.test(String(o.locator || '')));
    let best: {
        text: string;
        differ: number;
    } | null = null;
    let spaced: string | null = null;
    let words: Set<string> | null = null;
    const printed = () => (words = words || layerWords(layers));
    for (const layer of layers.slice(0, 4)) {
        const lines = linesOf(layer.text).slice(0, 60);
        for (let from = 0; from < lines.length; from++) {
            for (let to = from; to < Math.min(lines.length, from + 3); to++) {
                const block = lines.slice(from, to + 1);
                const text = titleWithoutFurniture(block.join(' '));
                const letters = flatLetters(text);
                if (letters === target) {
                    const cased = printedCasing(title, text);
                    const joined = cased || (text === block.join(' ') ? spacingAtTheLineBreaks(title, block) : null);
                    if (!joined)
                        return null;
                    spaced = spaced || joined;
                    continue;
                }
                if (shouting(text) && !shouting(title))
                    continue;
                const layerLetters = [...letters];
                if (layerLetters.length === targetLetters.length) {
                    let differ = 0, crosses = false, digit = false, jamo = 0;
                    for (let at = 0; at < layerLetters.length && differ <= limit; at++) {
                        if (layerLetters[at] === targetLetters[at])
                            continue;
                        differ++;
                        if (crossesScripts(targetLetters[at], layerLetters[at]))
                            crosses = true;
                        if (/\p{N}/u.test(targetLetters[at]) || /\p{N}/u.test(layerLetters[at]))
                            digit = true;
                        if (/[가-힣]/.test(targetLetters[at]) && /[가-힣]/.test(layerLetters[at]))
                            jamo += jamoSubstitutions(targetLetters[at], layerLetters[at]);
                    }
                    if (digit && !linkedStatementsOf(evidence, 'title').some(stated => flatLetters(stated.value) === letters))
                        continue;
                    if (!crosses && jamo <= 2 && differ <= limit && (!best || differ < best.differ) && !readWordPrinted(title, text, printed()))
                        best = { text, differ };
                }
                else if (Math.abs(layerLetters.length - targetLetters.length) <= limit) {
                    const digitsOf = (value: string) => (value.match(/\p{N}/gu) || []).join('');
                    if (digitsOf(target) !== digitsOf(letters) && !linkedStatementsOf(evidence, 'title').some(stated => flatLetters(stated.value) === letters))
                        continue;
                    const differ = lettersSlippedInsideWords(title, text, limit);
                    if (differ && (!best || differ < best.differ) && !readWordPrinted(title, text, printed()))
                        best = { text, differ };
                }
            }
        }
    }
    return spaced ?? (best ? best.text : null);
}
const DASH_ONLY = /^[-‐‑‒–—]$/u;
function loudly(letters: string): boolean {
    const all = (letters.match(/\p{L}/gu) || []).length, lower = (letters.match(/\p{Ll}/gu) || []).length;
    return all > 0 && (lower <= 2 || lower * 10 <= all) && lower < all;
}
const INID_TITLE_FIELD = /^\s*[(\[]\s*54\s*[)\]]/;
function titleCasedAsPrinted(title: string, evidence: EvidenceBundle | undefined, patent = false): string | null {
    const held = title.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!evidence || held.length > 400)
        return null;
    const fromRecord = linkedStatementsOf(evidence, 'title').some(stated => stated.value.normalize('NFKC').replace(/\s+/g, ' ').trim() === held);
    const loud = shouting(held);
    const inidOnly = !fromRecord && !loud && caseIsLowered(held);
    if (!fromRecord && !loud && !inidOnly)
        return null;
    const isMark = (char: string) => /[\p{L}\p{N}]/u.test(char);
    const target = [...held].filter(isMark).map(char => char.toLowerCase()).join('');
    if (target.length < 8)
        return null;
    const structure = pageStructureOf(evidence);
    const leaf = (page: number) => structure.pages.some(entry => entry.page === page && entry.role === 'insertedLeaf');
    const flagged = layerPagesFlagged(evidence);
    const pages = (evidence.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind))
        .map(o => ({ page: pageNumberOf(o), kind: o.kind, text: String(o.text || '') }))
        .filter(entry => entry.page >= 1 && entry.page <= 5 && !leaf(entry.page) && !(entry.kind === 'pdfText' && flagged.has(entry.page)))
        .sort((a, b) => a.page - b.page || (a.kind === 'pdfText' ? -1 : 1));
    const mixed: string[] = [], inidForms: string[] = [];
    const dashes = new Map<string, string[]>();
    let reworded = '';
    const heldWords = held.split(' ').map(word => [...word].filter(isMark).join('').toLowerCase()).filter(Boolean);
    const heldMarks = [...held].filter(isMark).length;
    for (const page of pages) {
        const lines = linesOf(page.text.normalize('NFKC')).slice(0, 80);
        const lineMarks = lines.map(line => (line.match(/[\p{L}\p{N}]/gu) || []).length);
        for (let from = 0; from < lines.length; from++) {
            let block = '', blockMarks = 0;
            for (let to = from; to < Math.min(lines.length, from + 4); to++) {
                if (lines[to].length > STRUCTURE_LINE_CHARS)
                    break;
                block = !block ? lines[to] : /[-‐]$/.test(block) ? block + lines[to] : `${block} ${lines[to]}`;
                blockMarks += lineMarks[to];
                if (inidOnly && !INID_TITLE_FIELD.test(block))
                    continue;
                if (blockMarks >= heldMarks) {
                    const titled = titleWithoutFurniture(block);
                    const marks: Array<{
                        char: string;
                        at: number;
                    }> = [];
                    [...titled].forEach((char, at) => { if (isMark(char))
                        marks.push({ char, at }); });
                    const flat = marks.map(mark => mark.char.toLowerCase()).join('');
                    const chars = [...titled];
                    for (let start = flat.indexOf(target); start >= 0; start = flat.indexOf(target, start + 1)) {
                        const first = marks[start], last = marks[start + target.length - 1];
                        if (!first || !last || (first.at > 0 && isMark(chars[first.at - 1])) || (last.at + 1 < chars.length && isMark(chars[last.at + 1])))
                            continue;
                        if (/\p{L}/u.test(chars.slice(0, first.at).join('')) || /\p{L}/u.test(chars.slice(last.at + 1).join('')) || !/^[\p{Lu}\p{N}]/u.test(first.char))
                            break;
                        const inid = INID_TITLE_FIELD.test(block) || (patent && page.page === 1);
                        if (loudly(marks.slice(start, start + target.length).map(mark => mark.char).join('')) && !inid)
                            break;
                        if (strayCapitalWords(chars.slice(first.at, last.at + 1).join(''), held) >= 2)
                            break;
                        const span = marks.slice(start, start + target.length);
                        const printed = span.map(mark => mark.char).join('');
                        dashes.set(printed, span.slice(0, -1).map((mark, k) => { const gap = chars.slice(mark.at + 1, span[k + 1].at).join('').trim(); return DASH_ONLY.test(gap) ? gap : ''; }));
                        (loudly(printed) ? inidForms : mixed).push(printed);
                        break;
                    }
                }
                if (!reworded && fromRecord && !loud && heldWords.length >= 6 && !shouting(block)) {
                    const words = block.split(/\s+/).map(word => [...word].filter(isMark).join('').toLowerCase()).filter(Boolean);
                    const [longer, shorter] = words.length > heldWords.length ? [words, heldWords] : [heldWords, words];
                    if (longer.length === shorter.length + 1) {
                        let at = 0;
                        while (at < shorter.length && longer[at] === shorter[at])
                            at++;
                        if (at > 0 && at < longer.length - 1 && [...longer[at]].length <= 3 && longer.slice(at + 1).every((word, k) => word === shorter[at + k]))
                            reworded = block.replace(/\s+/g, ' ').trim();
                    }
                }
            }
        }
    }
    const recased = (printed: string) => {
        const letters = [...printed], gaps = dashes.get(printed) || [];
        let at = 0;
        return [...held].map(char => {
            if (!isMark(char))
                return DASH_ONLY.test(char) && at > 0 && gaps[at - 1] ? gaps[at - 1] : char;
            const model = letters[at++] || char;
            const upper = model !== model.toLowerCase() && model === model.toUpperCase();
            const next = upper ? char.toUpperCase() : char.toLowerCase();
            return [...next].length === 1 ? next : char;
        }).join('');
    };
    const informative = (value: string) => /\p{Lu}/u.test([...value].slice(1).join('')) && !caseIsLowered(value);
    const page = mixed.map(recased).find(out => !loud || informative(out));
    if (page)
        return page !== held ? page : null;
    if (inidForms.length && (fromRecord || inidOnly) && !loud && caseIsLowered(held))
        return held.toUpperCase() !== held ? recased(inidForms[0]) : null;
    if (reworded && reworded !== held)
        return reworded;
    return null;
}
function layerWords(layers: Array<{
    text?: unknown;
}>): Set<string> {
    return new Set(layers.slice(0, 4).flatMap(layer => linesOf(layer.text).join(' ').split(' ').map(flatLetters).filter(Boolean)));
}
function readWordPrinted(title: string, text: string, printed: Set<string>): boolean {
    const read = title.normalize('NFKC').split(/\s+/).map(flatLetters).filter(Boolean);
    const layer = text.split(/\s+/).map(flatLetters).filter(Boolean);
    if (read.length !== layer.length)
        return false;
    return read.some((word, at) => word !== layer[at] && printed.has(word));
}
const flatLetters = (value: string) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export { crossesScripts };
function slipWithinOneScript(read: string, layer: string): boolean {
    const rest = [...layer];
    const unmatched: string[] = [];
    for (const char of read) {
        const at = rest.indexOf(char);
        if (at >= 0)
            rest.splice(at, 1);
        else
            unmatched.push(char);
    }
    const layerScripts = new Set([...layer].map(letterScript).filter(Boolean));
    if (unmatched.some(char => !!letterScript(char) && !layerScripts.has(letterScript(char))))
        return false;
    return !unmatched.some(char => rest.some(added => crossesScripts(char, added)));
}
function printedCasing(title: string, printed: string): string | null {
    const read = title.normalize('NFKC').replace(/\s+/g, ' ').trim(), line = printed.replace(/\s+/g, ' ').trim();
    if (read === line || read.toLowerCase() !== line.toLowerCase() || !/\p{Ll}/u.test(line) || shouting(line))
        return null;
    if (strayCapitalWords(line, read) >= 2)
        return null;
    const x = [...read], y = [...line];
    if (x.length !== y.length)
        return null;
    const upper = (char: string | undefined) => !!char && /\p{Lu}/u.test(char);
    const words: Array<[
        number,
        number
    ]> = [];
    for (let at = 0; at < y.length;) {
        if (!/\p{L}/u.test(y[at])) {
            at++;
            continue;
        }
        let end = at;
        while (end < y.length && /\p{L}/u.test(y[end]))
            end++;
        words.push([at, end]);
        at = end;
    }
    const capital = words.map(([from, to]) => y.slice(from, to).every(char => upper(char)));
    const capsRun = new Set<number>();
    for (let k = 0; k < words.length;) {
        let j = k;
        while (j < words.length && capital[j])
            j++;
        if (j - k >= 3)
            for (let i = k; i < j; i++)
                capsRun.add(words[i][0]);
        k = j > k ? j : k + 1;
    }
    let out = '', changed = false;
    for (let at = 0; at < x.length;) {
        if (!/\p{L}/u.test(y[at])) {
            out += x[at];
            at++;
            continue;
        }
        let end = at;
        while (end < y.length && /\p{L}/u.test(y[end]))
            end++;
        const mine = x.slice(at, end), theirs = y.slice(at, end);
        const inner = theirs.some((char, i) => i > 0 && upper(char) && !upper(mine[i]));
        const lowered = mine.some((char, i) => upper(char) && !upper(theirs[i]));
        const typeface = (theirs.length >= 6 && shouting(theirs.join(''))) || capsRun.has(at);
        if (inner && !lowered && !typeface) {
            out += theirs.join('');
            changed = true;
        }
        else
            out += mine.join('');
        at = end;
    }
    return changed ? out : null;
}
function strayCapitalWords(text: string, against?: string): number {
    const theirs = against === undefined ? null : String(against).normalize('NFKC').match(/\p{L}/gu) || [];
    const letters = String(text ?? '').normalize('NFKC').match(/\p{L}/gu) || [];
    const aligned = !!theirs && theirs.length === letters.length && theirs.every((char, at) => char.toLowerCase() === letters[at].toLowerCase());
    let count = 0, offset = 0;
    for (const word of String(text ?? '').normalize('NFKC').match(/\p{L}+/gu) || []) {
        const chars = [...word];
        const start = offset;
        offset += chars.length;
        if (/^(?:\p{Lu}\p{Ll}?)+$/u.test(word))
            continue;
        const stray = chars.some((char, at) => at > 0 && /\p{Lu}/u.test(char) && /\p{Ll}/u.test(chars[at - 1]) && !(aligned && /\p{Lu}/u.test(theirs![start + at])));
        if (stray)
            count++;
    }
    return count;
}
function capitalsOfPlainWords(line: string, record: string): boolean {
    if (!shouting(line))
        return false;
    if (shouting(record) || !/\p{Ll}/u.test(record))
        return true;
    const plain = new Map<string, boolean>();
    for (const run of record.normalize('NFKC').match(/\p{L}+/gu) || []) {
        const key = run.toLowerCase();
        plain.set(key, plain.get(key) === true || !/\p{Lu}/u.test([...run].slice(1).join('')));
    }
    return (line.normalize('NFKC').match(/\p{L}+/gu) || []).some(run => /\p{Lu}/u.test(run) && [...run].length >= 2 && (plain.get(run.toLowerCase()) ?? true));
}
function addressToken(token: string): boolean {
    return token.includes('@') || /^[(<\[]?(?:https?:\/\/|www\.)/i.test(token) || /^[(<\[]?(?:doi:)?10\.\d{4,9}\//i.test(token) || /^[(<\[]?[\w-]+(?:\.[\w-]+)+\//.test(token);
}
function withoutAddresses(line: string): string {
    return line.replace(/(?<![\p{L}])e-?mails?(?:\s+address(?:es)?)?\s*[:：].*$/iu, ' ').split(' ').filter(token => !addressToken(token)).join(' ');
}
function layerCaseIsTheFont(text: string, people: unknown, serial: unknown): boolean {
    const runs = (value: unknown) => String(value ?? '').normalize('NFKC').match(/\p{L}+/gu) || [];
    const latin = (words: string[]) => words.length > 0 && words.every(word => /^\p{Script=Latin}+$/u.test(word));
    const lines = linesOf(text).slice(0, 150).map(line => runs(withoutAddresses(line)));
    const differs = (printed: string, stated: string) => printed !== stated && [...stated].length >= 3 && !shouting(printed)
        && ((/^\p{Ll}/u.test(printed) && /^\p{Lu}/u.test(stated)) || (/\p{Ll}\p{Lu}/u.test(printed) && !/\p{Ll}\p{Lu}/u.test(stated)));
    const printedOtherwise = (words: string[]) => {
        const low = words.map(word => word.toLowerCase());
        for (const tokens of lines) {
            for (let at = 0; at + low.length <= tokens.length; at++) {
                if (low.every((word, k) => tokens[at + k].toLowerCase() === word) && words.some((word, k) => differs(tokens[at + k], word)))
                    return true;
            }
        }
        return false;
    };
    for (const person of (Array.isArray(people) ? people : []) as any[]) {
        const first = runs(person?.firstName), last = runs(person?.lastName);
        if (!latin(first) || !latin(last))
            continue;
        if (printedOtherwise([...first, ...last]) || printedOtherwise([...first.slice(0, 1), ...last]) || printedOtherwise([...last, ...first]))
            return true;
    }
    const name = runs(serial);
    return latin(name) && name.length >= 2 && printedOtherwise(name);
}
const TITLE_PAGE_RANK: Record<string, number> = { titlePage: 0, halfTitle: 1, cover: 2 };
function titleCasedAsTheTitlePagePrintsIt(title: string, evidence: EvidenceBundle | undefined, people: unknown, serial: unknown, marked = ''): string | null {
    const held = title.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!evidence || held.length > 400 || !/\p{Script=Latin}/u.test(held))
        return null;
    const isMark = (char: string) => /[\p{L}\p{N}]/u.test(char);
    const lettersOf = (value: string) => [...value.normalize('NFKC')].filter(isMark).map(char => char.toLowerCase()).join('');
    const target = lettersOf(held);
    if (target.length < 8)
        return null;
    const structure = pageStructureOf(evidence);
    const flagged = layerPagesFlagged(evidence);
    const rank = (page: number) => TITLE_PAGE_RANK[roleOf(structure, page)] ?? -1;
    const blocks = titleBlocksOf(structure).filter(block => block.page >= 1 && block.page <= 5 && rank(block.page) >= 0 && !(block.reading === 'layer' && flagged.has(block.page)));
    const pages = [...new Set(blocks.map(block => block.page))].sort((a, b) => rank(a) - rank(b) || a - b);
    const tidy = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const titleWords = new Set(held.toLowerCase().match(/\p{L}+/gu) || []);
    const wordsOfName = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().match(/\p{L}+/gu) || [];
    const named = (Array.isArray(people) ? people : []) as any[];
    const notTheTitle = (row: string) => {
        const words = row.normalize('NFKC').toLowerCase().match(/\p{L}+/gu) || [];
        if (!words.length || words.every(word => titleWords.has(word)))
            return false;
        if (rowIsByline(row, 'strict') || isOrganisationOnly(row) || isInstitutionName(row))
            return true;
        const present = new Set(words);
        const people = named.filter(person => person?.fieldMode !== 1).map(person => ({ family: wordsOfName(person?.lastName), first: wordsOfName(person?.firstName)[0] ?? '' }))
            .filter(person => person.family.length > 0 && !person.family.some(word => titleWords.has(word)) && person.family.every(word => present.has(word)));
        return people.some(person => !!person.first && (present.has(person.first) || present.has([...person.first][0]))) || (people.length > 0 && rowIsNameList(row));
    };
    const subtitleRows = (block: (typeof blocks)[number]): string[] => {
        if (!block.subtitle)
            return [];
        const placed = rowsOf(structure, block.page, block.reading);
        const texts = block.subtitle.rows.map(row => placed.find(entry => entry.row === row)?.text);
        if (texts.length !== (block.read?.subtitle?.rows?.length ?? -1) || texts.some(text => text === undefined))
            return [block.subtitle.text];
        const kept: string[] = [];
        for (const text of texts as string[]) {
            if (notTheTitle(text))
                break;
            kept.push(text);
        }
        return kept;
    };
    const joined = (rows: string[]) => rows.map(tidy).filter(Boolean).reduce((out, row) => !out ? row : /[-‐]$/u.test(out) ? out + row : `${out} ${row}`, '');
    for (const page of pages) {
        const readings: Array<{
            text: string;
            lines: string[];
            reading: 'layer' | 'ocr';
        }> = [];
        for (const block of blocks.filter(entry => entry.page === page)) {
            const whole = block.subtitle ? [block.subtitle.text] : [], cut = subtitleRows(block);
            const head = tidy(block.main.text);
            const label = /^(\p{L}[\p{L}'’-]*(?: \p{L}[\p{L}'’-]*){0,2}) ?[:：] /u.exec(head);
            const unlabelled = label && (label[1].toLowerCase().match(/\p{L}+/gu) || []).every(word => !titleWords.has(word)) ? head.slice(label[0].length) : '';
            const mains = [...new Set([head, tidy(titleWithoutFurniture(block.main.text)), unlabelled])].filter(Boolean);
            const tried = mains.flatMap(main => [whole, cut].map(rows => ({ text: tidy([main, joined(rows)].join(' ')), rows })));
            for (const entry of tried) {
                if (lettersOf(entry.text) !== target && !/\p{N}$/u.test(held) && /\p{L}\p{N}{1,2}$/u.test(entry.text) && lettersOf(entry.text.replace(/\p{N}{1,2}$/u, '')) === target)
                    entry.text = entry.text.replace(/\p{N}{1,2}$/u, '');
            }
            const found = tried.find(entry => lettersOf(entry.text) === target);
            if (!found)
                continue;
            const lines = [...block.main.lines, ...found.rows].map(tidy).filter(Boolean);
            readings.push({ text: found.text, lines, reading: block.reading });
        }
        if (!readings.length)
            continue;
        const capitals = readings.some(entry => entry.lines.some(line => capitalsOfPlainWords(line, held) && target.includes(lettersOf(line))) || capitalsOfPlainWords(entry.text, held));
        const layerText = () => (evidence.observations || []).filter(o => o.kind === 'pdfText' && pageNumberOf(o) === page).map(o => String(o.text || '')).join('\n');
        const usable = capitals ? [] : readings.filter(entry => strayCapitalWords(entry.text, held) < 2 && !(entry.reading === 'layer' && layerCaseIsTheFont(layerText(), people, serial)));
        const caseKnown = usable.length > 0;
        const pool = caseKnown ? usable : readings;
        const chosen = pool.find(entry => entry.reading === 'layer') || pool[0];
        const chars = [...chosen.text];
        const marks: Array<{
            char: string;
            at: number;
        }> = [];
        chars.forEach((char, at) => { if (isMark(char))
            marks.push({ char, at }); });
        const gaps = marks.slice(0, -1).map((mark, k) => { const gap = chars.slice(mark.at + 1, marks[k + 1].at).join('').trim(); return DASH_ONLY.test(gap) ? gap : ''; });
        const own = new Set<number>();
        if (!shouting(held)) {
            for (const run of held.matchAll(/\p{L}+/gu)) {
                if (/\p{Lu}/u.test([...run[0]].slice(1).join('')))
                    for (let k = 0; k < run[0].length; k++)
                        own.add((run.index ?? 0) + k);
            }
        }
        const joints = marked ? markupJointsAlong(marked, held) : null;
        const heldChars = [...held];
        let at = 0, changed = false, offset = 0;
        const out = heldChars.map((char, index) => {
            const position = offset;
            offset += char.length;
            if (!isMark(char)) {
                if (char === ' ' && joints?.[at - 1] && at > 0 && at < marks.length && isMark(heldChars[index - 1] ?? '') && isMark(heldChars[index + 1] ?? '')
                    && marks[at].at === marks[at - 1].at + 1) {
                    changed = true;
                    return '';
                }
                return DASH_ONLY.test(char) && at > 0 && gaps[at - 1] ? gaps[at - 1] : char;
            }
            const model = marks[at++]?.char || char;
            if (!caseKnown || own.has(position))
                return char;
            const upper = model !== model.toLowerCase() && model === model.toUpperCase();
            const next = upper ? char.toUpperCase() : char.toLowerCase();
            if ([...next].length !== 1)
                return char;
            if (next !== char)
                changed = true;
            return next;
        }).join('');
        const lastHeld = heldChars.length - 1 - [...heldChars].reverse().findIndex(isMark);
        const heldTail = heldChars.slice(lastHeld + 1).join('').replace(/\s+/gu, '');
        const pageTail = chars.slice(marks[marks.length - 1].at + 1).join('').replace(new RegExp(NOTE_MARK, 'gu'), '').replace(/\s+/gu, '');
        const added = pageTail.startsWith(heldTail) && !/[.!?]/u.test(heldTail) ? pageTail.slice(heldTail.length) : '';
        const footnoted = (mark: string) => (evidence.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind) && pageNumberOf(o) === page)
            .some(o => linesOf(o.text).some(line => line.startsWith(mark) && /^[!?]+\s*\p{L}/u.test(line)));
        if (/^[!?]{1,3}$/u.test(added) && !footnoted(added[0]))
            return `${out}${added}`;
        return changed ? out : null;
    }
    return null;
}
function lettersSlippedInsideWords(title: string, text: string, limit: number): number {
    const read = title.normalize('NFKC').split(/\s+/).map(flatLetters).filter(Boolean);
    const printedWords = text.split(/\s+/).filter(word => !!flatLetters(word));
    const layer = printedWords.map(flatLetters);
    if (read.length !== layer.length)
        return 0;
    let total = 0;
    for (let at = 0; at < read.length; at++) {
        if (read[at] === layer[at])
            continue;
        if (!slipWithinOneScript(read[at], layer[at]))
            return 0;
        const [longer, shorterWord] = read[at].length > layer[at].length ? [read[at], layer[at]] : [layer[at], read[at]];
        if (longer.startsWith(shorterWord) && /^\p{N}+$/u.test(longer.slice(shorterWord.length)))
            return 0;
        if (layer[at].startsWith(read[at]) && [...layer[at]].length === [...read[at]].length + 1
            && /\p{Ll}\p{Lu}[^\p{L}]*$/u.test(printedWords[at]))
            return 0;
        const shorter = Math.min([...read[at]].length, [...layer[at]].length);
        const distance = editDistance(read[at], layer[at]);
        if (shorter < 3 || distance * 2 >= shorter)
            return 0;
        total += distance;
    }
    return total && total <= limit ? total : 0;
}
function spacingAtTheLineBreaks(title: string, block: string[]): string | null {
    const read = title.normalize('NFKC').split(/\s+/).filter(Boolean);
    const layer: Array<{
        word: string;
        breaks: boolean;
    }> = [];
    block.forEach(line => { const words = line.split(' ').filter(Boolean); words.forEach((word, at) => layer.push({ word, breaks: at === words.length - 1 })); });
    const out: string[] = [];
    let joins = 0, j = 0;
    for (let i = 0; i < read.length; i++) {
        const word = flatLetters(read[i]);
        if (j < layer.length && word === flatLetters(layer[j].word)) {
            out.push(read[i]);
            j++;
            continue;
        }
        const next = layer[j + 1];
        if (j < layer.length && next && layer[j].breaks && /[\p{L}\p{N}]$/u.test(layer[j].word) && /^[\p{L}\p{N}]/u.test(next.word)
            && flatLetters(layer[j].word).length >= 2 && flatLetters(next.word).length >= 2
            && word === flatLetters(layer[j].word) + flatLetters(next.word)) {
            out.push(layer[j].word, next.word);
            joins++;
            j += 2;
            continue;
        }
        return null;
    }
    return joins && j === layer.length ? out.join(' ') : null;
}
const BYLINE_LABEL = new RegExp(`(?<![\\p{L}])(?:${alternationOf([...wordsOf(['author'], 'label', { script: ['latin'] }), ...wordsOf(['author'], 'lead').filter(word => word.form === 'by')], 'label')})(?![\\p{L}])\\s*[:：]?`, 'giu');
const NAME_LIST_JOINER = (word: string) => { const bare = word.replace(/[,;]$/, ''); return NAME_JOINERS.particle.test(bare) || /^(?:and|&|und|et|y|e)$/i.test(bare); };
function bylineListAt(layer: string, at: number): {
    role: 'author' | 'editor' | 'translator' | 'contributor';
} | null {
    const before = layer.slice(Math.max(0, at - 300), at);
    let from = -1, labelAt = -1, previousEnd = 0;
    for (const label of before.matchAll(BYLINE_LABEL)) {
        previousEnd = Math.max(from, 0);
        from = label.index! + label[0].length;
        labelAt = label.index!;
    }
    if (from < 0)
        return null;
    const gap = before.slice(from);
    if (!/^[\p{L}\p{M}\s.,;&'’\-‐]*$/u.test(gap) || /\p{L}{2,}\.\s/u.test(gap))
        return null;
    if (!gap.split(/\s+/).every(word => !word || /^\p{Lu}/u.test(word) || NAME_LIST_JOINER(word)))
        return null;
    const segmentStart = Math.max(before.lastIndexOf('\n', labelAt) + 1, previousEnd);
    const separators = [...before.slice(segmentStart, labelAt).matchAll(/[,;，；]|(?<![\p{L}])with(?![\p{L}])/giu)];
    const last = separators[separators.length - 1];
    const leadStart = segmentStart + (last ? last.index! + last[0].length : 0);
    const lead = roleWordAt(`${before.slice(leadStart, from).trim()} ${layer.slice(at, at + 60).split('\n')[0]}`, 'lead', ['editor', 'translator']);
    const role = lead ? bylineRoleOf(lead.word.form) : 'author';
    return { role };
}
function closeSpelling(read: string, printed: string): boolean {
    const x = [...read.toLowerCase()], y = [...printed.toLowerCase()];
    if (x[0] !== y[0])
        return false;
    if (x.length === y.length)
        return sameName(read, printed, 'misreadCorrection', { field: 'person' });
    return nearWord(printed.toLowerCase(), read.toLowerCase());
}
const nonAsciiLetters = (value: string) => [...value].filter(letter => letter.charCodeAt(0) > 0x7f && /\p{L}/u.test(letter)).length;
function readableFrontLayer(evidence: EvidenceBundle | undefined): {
    text: string;
    letters: string;
} | null {
    if (!evidence || documentProfile(evidence).textLayer !== 'readable' || scannedPageSizes(evidence))
        return null;
    const text = (evidence.observations || []).filter(o => o.kind === 'pdfText' && /^page \d+ of /.test(String(o.locator || '')) && pageNumberOf(o) >= 1 && pageNumberOf(o) <= 5)
        .map(o => String(o.text || '')).join('\n').normalize('NFKC');
    return text ? { text, letters: foldedLetters(text) } : null;
}
export { doiStandingsOf, ownDOIsInOrder, type DOIStanding };
function layerPagesFlagged(evidence: EvidenceBundle | undefined): Set<number> {
    return brokenLayerPages(evidence);
}
function readableLayerPages(evidence: EvidenceBundle | undefined): Array<{
    page: number;
    text: string;
    complete: boolean;
}> {
    if (!evidence || documentProfile(evidence).textLayer !== 'readable')
        return [];
    const flagged = layerPagesFlagged(evidence);
    return (evidence.observations || []).filter(o => o.kind === 'pdfText' && /^page \d+/.test(String(o.locator || '')))
        .map(o => ({ page: pageNumberOf(o), text: String(o.text || ''), complete: !o.truncated }))
        .filter(page => page.page >= 1 && page.page <= 5 && !insertedLeaf(evidence, page.page) && !flagged.has(page.page));
}
export function doisOfTheDocument(evidence: EvidenceBundle | undefined, readTitle?: unknown): string[] {
    return ownDOIsInOrder(doiStandingsOf(readableLayerPages(evidence), readTitle));
}
const SICI_DOI = /^10\.\d{4,9}\/(?:\(sici\))?\d{4}-\d{3}[\dx]\(\d{4,8}[^()\s]{0,12}\)\S{0,40}?(?:<[^<>\s]{1,60}::[^<>\s]{1,60}>|\[[^[\]\s]{1,60}:[^[\]\s]{1,60}\])\d{1,2}\.\d{1,2}\.co;\d(?:-[\dx#])?$/i;
function doiAsPrinted(doi: string, evidence: EvidenceBundle | undefined): string {
    const observations = evidence?.observations || [];
    if (!doi || !observations.length)
        return '';
    const escaped = [...doi].map(char => char.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
    const pattern = new RegExp(`(?<![\\p{N}.])${escaped.join('(?:[^\\S\\n]*\\n[^\\S\\n]*)?')}(?![\\p{L}\\p{N}_/-]|\\.[\\p{L}\\p{N}])`, 'iu');
    let flagged: Set<number> | null = null;
    for (const page of [...observations.filter(o => o.kind === 'pdfText'), ...observations.filter(o => o.kind === 'ocrText')]) {
        const found = pattern.exec(String(page.text || '').normalize('NFKC'));
        const form = found ? found[0].replace(/\s+/g, '') : '';
        if (!form || !sameDOI(form, doi))
            continue;
        if (page.kind === 'pdfText' && (flagged ??= layerPagesFlagged(evidence)).has(pageNumberOf(page)))
            continue;
        return form;
    }
    return '';
}
export function doiAsWritten(value: string, evidence: EvidenceBundle | undefined): string {
    const doi = String(value ?? '').trim();
    if (!doi)
        return doi;
    const printed = doiAsPrinted(doi, evidence);
    if (printed)
        return printed;
    if (SICI_DOI.test(doi))
        return doi.toUpperCase();
    if (/\p{Lu}/u.test(doi))
        return doi;
    const cased = sameEditionRecords(evidence).map(link => doiIn(String(link.stated?.DOI?.value ?? '')))
        .find(stated => /\p{Lu}/u.test(stated) && sameDOI(stated, doi));
    return cased || doi;
}
function doiLinkAsWritten(url: string, written: string, evidence: EvidenceBundle | undefined): string {
    const link = /^(\s*https?:\/\/(?:dx\.)?doi\.org\/)(\S+?)(\s*)$/i.exec(String(url ?? ''));
    if (!link)
        return url;
    const form = written && sameDOI(written, link[2]) ? written : doiAsWritten(link[2], evidence);
    return form !== link[2] && form.toLowerCase() === link[2].toLowerCase() ? `${link[1]}${form}${link[3]}` : url;
}
export function identifierPrintedAsTheDocumentsOwn(field: string, value: unknown, evidence: EvidenceBundle | undefined, readTitle?: unknown): boolean {
    if (!evidence || !String(value ?? '').trim() || documentProfile(evidence).textLayer !== 'readable')
        return false;
    if (field === 'DOI')
        return doisOfTheDocument(evidence, readTitle).some(doi => sameDOI(doi, String(value)));
    if (field !== 'ISBN')
        return false;
    const flagged = layerPagesFlagged(evidence);
    const own = new Set(ownISBNs((evidence.observations || []).filter(o => o.kind === 'pdfText' && !flagged.has(pageNumberOf(o))).map(o => String(o.text || ''))));
    return isbnsIn(value).some(isbn => own.has(isbn));
}
export function storedRecordOfThisEdition(stored: MetadataSnapshot | undefined, read: MetadataSnapshot): 'DOI' | 'ISBN' | null {
    if (!stored?.itemType || stored.itemType !== read?.itemType)
        return null;
    const readDOI = doiIn(String(read.fields?.DOI ?? ''));
    if (readDOI && sameDOI(String(stored.fields?.DOI ?? ''), readDOI))
        return 'DOI';
    if (read.itemType !== 'book')
        return null;
    const held = isbnsIn(stored.fields?.ISBN);
    return held.length && isbnsIn(read.fields?.ISBN).some(isbn => held.includes(isbn)) ? 'ISBN' : null;
}
export function storedValueNoSourceContradicts(field: string, value: unknown, read: MetadataSnapshot, context: {
    evidence?: EvidenceBundle;
    notes?: Record<string, string>;
    heldDOI?: unknown;
} = {}): boolean {
    if (context.notes?.[field])
        return false;
    const text = (entry: unknown) => String(entry ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const sameValue = (a: string, b: string) => field === 'DOI' ? sameDOI(a, b)
        : field === 'ISBN' ? isbnsIn(b).some(isbn => isbnsIn(a).includes(isbn))
            : /date$/i.test(field) ? (canonicalDate(a) || a).startsWith(canonicalDate(b) || b) || (canonicalDate(b) || b).startsWith(canonicalDate(a) || a)
                : foldedLetters(a) === foldedLetters(b);
    for (const link of context.evidence?.links || []) {
        if (link?.relation !== 'sameEdition' && link?.relation !== 'sameWork')
            continue;
        const stated = text(link.stated?.[field]?.value);
        if (stated && (field === 'creators' || !sameValue(text(value), stated)))
            return false;
    }
    if (field === 'url') {
        const inside = doiIn(text(value));
        const held = doiIn(text(context.heldDOI));
        const own = doiIn(text(read.fields?.DOI)) || (held && storedValueNoSourceContradicts('DOI', held, read, { ...context, heldDOI: undefined }) ? held : '');
        if (inside && !(own && sameDOI(own, inside)))
            return false;
    }
    if (field === 'DOI') {
        const identity = context.evidence?.identity;
        if (identity?.kind === 'DOI' && sameDOI(identity.value, value) && (identity.scope === 'container' || identity.scope === 'part'))
            return false;
        const printed = doisOfTheDocument(context.evidence, read.fields?.title);
        if (printed.length && !printed.some(doi => sameDOI(doi, value)))
            return false;
    }
    if (field === 'shortTitle') {
        const title = foldedLetters(read.fields?.title);
        if (title && !title.startsWith(foldedLetters(value)))
            return false;
    }
    return true;
}
function nameAsTheTextLayerSpellsIt(person: any, front: () => {
    text: string;
    letters: string;
} | null, linkedPeople: string[] = []): {
    lastName: string;
    role: string;
} | null {
    const last = String(person?.lastName ?? '').trim(), first = String(person?.firstName ?? '').trim();
    if (person?.fieldMode === 1 || !first || !last || /\s/.test(last) || [...last].length < 5)
        return null;
    if (!LATIN_NAME_PART.test(last) || !LATIN_NAME_PART.test(first))
        return null;
    const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ß/g, 'ss')
        .replace(/ł/g, 'l').replace(/đ/g, 'd').replace(/[^\p{L}]+/gu, '');
    if (linkedPeople.some(word => !!fold(word) && fold(word) === fold(last)))
        return null;
    const printed = front();
    if (!printed || printed.letters.includes(foldedLetters(last)))
        return null;
    const layer = printed.text;
    const found = new Map<string, string>();
    const pattern = new RegExp(`(?<![\\p{L}])${escapeForPattern(first)}\\s+(\\p{L}[\\p{L}\\p{M}'’\\-‐]*)`, 'gu');
    for (const match of layer.matchAll(pattern)) {
        const word = match[1];
        if (nonAsciiLetters(word) < nonAsciiLetters(last) || [...word].some(letter => /\p{Lm}/u.test(letter) && !last.includes(letter)))
            continue;
        if (!closeSpelling(last, word))
            continue;
        const list = bylineListAt(layer, match.index!);
        if (list)
            found.set(word, found.has(word) && found.get(word) !== list.role ? '' : list.role);
    }
    if (found.size !== 1)
        return null;
    const [[lastName, role]] = [...found];
    return { lastName, role };
}
function pagesRead(evidence: EvidenceBundle | undefined): Array<{
    page: number;
    kind: string;
    lines: string[];
    readable: boolean;
}> {
    const flagged = layerPagesFlagged(evidence);
    const layer = documentProfile(evidence).textLayer === 'readable';
    return (evidence?.observations || []).filter(o => o.kind === 'pdfText' || o.kind === 'ocrText')
        .map(o => ({ page: pageNumberOf(o), kind: o.kind, lines: linesOf(o.text), readable: o.kind === 'pdfText' && layer && !flagged.has(pageNumberOf(o)) }));
}
const TITLE_NOTE_MARK = /^(?:\d{1,2}|[¹²³⁴⁵⁶⁷⁸⁹]|[*∗†‡§¶]{1,2})$/u;
const TRAILING_MARK = /(?<=\p{L})(\d{1,2}|[¹²³⁴⁵⁶⁷⁸⁹]|[*∗†‡§¶]{1,2})$/u;
const LEADING_MARK = /^(\d{1,2}|[¹²³⁴⁵⁶⁷⁸⁹]|[*∗†‡§¶]{1,2})\s?(?=\p{L})/u;
export function statedOnlyInTheTitleNote(value: unknown, evidence: EvidenceBundle | undefined, title: unknown): {
    mark: string;
    page: number;
} | null {
    const key = foldedLetters(value);
    const titleKey = foldedLetters(title);
    if (key.length < 8 || titleKey.length < 6)
        return null;
    let found: {
        mark: string;
        page: number;
    } | null = null;
    const outside: string[] = [];
    for (const page of pagesRead(evidence).filter(entry => entry.readable && entry.page >= 1 && entry.page <= 5)) {
        const lines = page.lines;
        let mark = '';
        for (const line of lines.slice(0, 15)) {
            if (line.length > 200)
                continue;
            const tail = TRAILING_MARK.exec(line);
            const head = tail ? foldedLetters(line.slice(0, tail.index)) : '';
            if (tail && head.length >= 4 && titleKey.includes(head)) {
                mark = tail[1];
                break;
            }
        }
        const notes: string[] = [];
        const rest: string[] = [];
        let open = false;
        for (const line of lines) {
            const lead = line.length <= 400 ? LEADING_MARK.exec(line) : null;
            if (lead && TITLE_NOTE_MARK.test(lead[1])) {
                open = !!mark && lead[1] === mark;
                if (open) {
                    notes.push(line.slice(lead[0].length));
                    continue;
                }
            }
            else if (open && notes.length && notes.length < 4) {
                notes[notes.length - 1] += /-$/.test(notes[notes.length - 1]) ? line : ` ${line}`;
                continue;
            }
            open = false;
            rest.push(line);
        }
        outside.push(rest.join('\n'));
        const note = notes.map(entry => entry.replace(/-(?=\p{Ll})/gu, '')).join('\n');
        if (mark && !found && foldedLetters(note).includes(key))
            found = { mark, page: page.page };
    }
    if (!found)
        return null;
    return outside.some(text => foldedLetters(text).includes(key)) ? null : found;
}
const entryIsPatent = (link: any) => String(link?.stated?.itemType?.value ?? '') === 'patent' || !!String(link?.stated?.patentNumber?.value ?? '').trim();
function linkedStatementsOf(evidence: EvidenceBundle | undefined, field: string): Array<{
    value: string;
    provider: string;
}> {
    const out: Array<{
        value: string;
        provider: string;
    }> = [];
    for (const link of evidence?.links || []) {
        if (link?.relation !== 'sameEdition' && link?.relation !== 'sameWork')
            continue;
        const value = withoutInlineMarkup(String(link.stated?.[field]?.value ?? '')).trim();
        if (value)
            out.push({ value, provider: String(link.provider || '') });
    }
    for (const entry of evidence?.observations || []) {
        if (entry.kind !== 'externalRecord')
            continue;
        try {
            const value = withoutInlineMarkup(String(JSON.parse(String(entry.text || ''))?.stated?.[field]?.value ?? '')).trim();
            if (value)
                out.push({ value, provider: String(entry.locator || '').split(':')[0] });
        }
        catch { }
    }
    return out;
}
function recordMisread(read: string, form: string): boolean {
    const syllables = (String(read ?? '').normalize('NFC').match(/[가-힣]/g) || []).length;
    if (syllables > 0 && syllables < 3)
        return false;
    return sameName(read, form, 'misreadCorrection', { field: 'house' });
}
const CAPITALISED_WORD = /(?<![\p{L}])\p{Lu}\p{Ll}{3,}(?![\p{L}])/gu;
function corroboratedSpelling(field: string, value: string, evidence: EvidenceBundle | undefined, others: Set<string> = new Set()): {
    form: string;
    source: string;
    readAt: string;
} | null {
    const read = value.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!read || /\d/.test(read))
        return null;
    const person = field === 'creators';
    const hangul = /[가-힣]/.test(read);
    const flat = (text: string) => text.replace(/\s+/g, '');
    const pages = pagesRead(evidence);
    const printedOn = (form: string) => pages.filter(page => page.lines.some(line => flat(line).includes(flat(form))));
    const readPages = printedOn(read);
    if (readPages.some(page => page.readable))
        return null;
    const linked = linkedStatementsOf(evidence, field);
    if (!person && linked.some(stated => stated.value.normalize('NFC').replace(/\s+/g, ' ').trim() === read))
        return null;
    const words: Array<{
        word: string;
        page: {
            page: number;
            kind: string;
        };
    }> = [];
    const seenWords = new Set<string>();
    if (hangul && !person) {
        for (const page of pages)
            for (const line of page.lines)
                for (const word of line.match(CAPITALISED_WORD) || []) {
                    if (!seenWords.has(word)) {
                        seenWords.add(word);
                        words.push({ word, page });
                    }
                }
    }
    if (words.some(({ word }) => [...read].some((_, at) => at >= 1 && fold(romanise(read.slice(0, at + 1))) === fold(word))))
        return null;
    const ocrPage = readPages.find(page => page.kind === 'ocrText');
    const readAt = ocrPage ? `${ocrPage.page}쪽 이미지 판독` : '판독';
    const found = new Map<string, string>();
    const offer = (form: string, source: string) => { if (!others.has(flat(form)) && !found.has(form))
        found.set(form, source); };
    for (const stated of linked) {
        if (!person) {
            if (recordMisread(read, stated.value))
                offer(stated.value, `연결된 기록(${stated.provider})의 「${stated.value}」`);
            continue;
        }
        for (const piece of stated.value.split(/\s*;\s*/)) {
            for (const name of hangulNamesOf(piece))
                if (recordMisread(flat(read), name))
                    offer(name, `연결된 기록(${stated.provider})의 「${name}」`);
        }
    }
    if (found.size) {
        if (found.size !== 1)
            return null;
        const [[form, source]] = [...found];
        return { form, source, readAt };
    }
    const where = (page: {
        page: number;
        kind: string;
    }) => `${page.page}쪽 ${page.kind === 'ocrText' ? '이미지 판독' : '글자층'}`;
    if (hangul && !/\s/.test(read)) {
        for (const page of pages) {
            if (page.kind === 'pdfText' && !page.readable)
                continue;
            for (const line of page.lines) {
                if (line.length > 30)
                    continue;
                for (const token of line.match(/[가-힣]+/g) || []) {
                    if (token === read || token.length !== read.length || !sameName(read, token, 'misreadCorrection', { field: person ? 'person' : 'house' }))
                        continue;
                    if (!page.readable && printedOn(token).length <= readPages.length)
                        continue;
                    offer(token, `${where(page)}의 「${token}」`);
                }
            }
        }
        for (const { word, page } of words) {
            const form = hangulRespelledByRomanisation(read, word, confusableJamo(read));
            if (form)
                offer(form, `${where(page)}의 로마자 표기 「${word}」`);
        }
    }
    else if (!hangul && !person) {
        const size = read.split(' ').length, length = [...read].length;
        const named = (window: string) => window.split(' ').every((word, at) => /^[\p{Lu}\p{N}]/u.test(word) || (at > 0 && (NAME_JOINERS.connective.test(word) || NAME_JOINERS.particle.test(word))));
        for (const page of pages) {
            if (!page.readable)
                continue;
            for (const line of page.lines) {
                const tokens = line.split(' ');
                for (let at = 0; at + size <= tokens.length; at++) {
                    const window = tokens.slice(at, at + size).join(' ');
                    if (Math.abs([...window].length - length) > 2 || !named(window))
                        continue;
                    if (sameName(read, window, 'misreadCorrection', { field: 'house' }))
                        offer(window, `${where(page)}의 「${window}」`);
                }
            }
        }
    }
    if (found.size !== 1)
        return null;
    const [[form, source]] = [...found];
    return { form, source, readAt };
}
function fullerListOnAnotherReading(creators: any[], title: string, evidence: EvidenceBundle | undefined): {
    people: any[];
    page: number;
    line: string;
} | null {
    const latin = (value: unknown) => /^[\p{Script=Latin}\s.'’\-‐]*$/u.test(String(value ?? ''));
    if (!creators.every(person => person?.fieldMode !== 1 && String(person?.lastName ?? '').trim() && latin(person.lastName) && latin(person.firstName)))
        return null;
    const words = (value: string) => value.toLowerCase().split(/[\s.'’\-‐]+/).filter(word => word.length >= 2);
    const complete = (person: any) => words(String(person?.lastName ?? '')).length >= 1 && words(String(person?.firstName ?? '')).length >= 1;
    const read = new Set(creators.flatMap(person => words(`${person.firstName ?? ''} ${person.lastName ?? ''}`)));
    const key = foldedLetters(title);
    if (!read.size || key.length < 6)
        return null;
    const readComplete = creators.filter(complete).length;
    const first = creators[0] || {};
    const uniform = creators.every(person => (person.creatorType ?? '') === (first.creatorType ?? '') && person.creatorTypeID === first.creatorTypeID);
    const roleOf = (person: any) => uniform && first.creatorType ? { creatorType: first.creatorType }
        : uniform && first.creatorTypeID !== undefined ? { creatorTypeID: first.creatorTypeID } : { creatorType: person.creatorType || 'author' };
    const found: Array<{
        people: any[];
        page: number;
        line: string;
    }> = [];
    for (const entry of evidence?.observations || []) {
        if (entry.kind !== 'ocrText')
            continue;
        const lines = linesOf(entry.text);
        if (!lines.some(line => foldedLetters(line) === key))
            continue;
        for (const line of lines) {
            if (line.length > 200 || !/[;,]|\s(?:and|&)\s/.test(line) || foldedLetters(line) === key)
                continue;
            const people = creatorsFromVision(line, 'en');
            if (people.length <= creators.length || !people.every(person => complete(person) && latin(person.lastName) && latin(person.firstName)))
                continue;
            if (people.length <= readComplete)
                continue;
            const listed = new Set(people.flatMap(person => words(`${person.firstName ?? ''} ${person.lastName ?? ''}`)));
            if (![...read].every(word => listed.has(word)))
                continue;
            found.push({ people: people.map(person => ({ lastName: person.lastName, firstName: person.firstName || '', fieldMode: 0, ...roleOf(person) })), page: pageNumberOf(entry), line });
        }
    }
    const distinct = new Set(found.map(entry => entry.people.map(person => `${person.lastName}|${person.firstName}`).join(';')));
    return distinct.size === 1 ? found[0] : null;
}
function judgedReadingOf(record: MetadataSnapshot | undefined): JudgedReading {
    const fields = record?.fields || {};
    return { title: String(fields.title ?? ''), publisher: String(fields.publisher ?? ''),
        persons: ((record?.creators || []) as any[]).map(person => `${person?.lastName ?? ''}${person?.firstName ?? ''}`.replace(/\s+/g, '')).filter(Boolean) };
}
export function yearsOfTheOriginal(record: MetadataSnapshot, evidence?: EvidenceBundle): {
    original: Set<string>;
    edition: string;
    originalSaid: string;
    editionSaid: string;
} | null {
    return yearsOfEditions(statementsOf(evidence), judgedReadingOf(record));
}
export function numberOnly(value: string): string {
    const text = String(value ?? '').trim().normalize('NFKC');
    const match = /^(?:제\s*)?(\d{1,5})\s*(?:권|호|집|卷|號|号)?$/.exec(text) || /^(?:vol(?:ume)?|no|number|issue)\.?\s*(\d{1,5})$/i.exec(text);
    return match ? String(Number(match[1])) : '';
}
function issueNumbersOf(value: string): {
    volume: string;
    issue: string;
    year: string;
    month: string;
} {
    const none = { volume: '', issue: '', year: '', month: '' };
    const text = String(value ?? '').normalize('NFKC');
    const month = monthNamedIssue(text);
    if (month)
        return { ...none, year: month.year, month: month.month };
    const match = ISSUE_NUMBERS.exec(text);
    if (!match)
        return none;
    const cited = /^((?:19|20)\d{2})\b[^;]*;\s*(\d{1,4})\s*\(\s*(\d{1,4})/.exec(match[0]);
    if (cited)
        return { ...none, volume: String(Number(cited[2])), issue: String(Number(cited[3])), year: cited[1] };
    const numbers = match[0].match(/\d{1,4}/g) || [];
    return { ...none, volume: numbers[0] ? String(Number(numbers[0])) : '', issue: numbers[1] ? String(Number(numbers[1])) : '' };
}
const CITED_YEAR = String.raw `(?<year>(?:1[89]|20)\d{2})`;
const CITED_VOLUME = String.raw `(?<volume>\d{1,4})`;
const CITED_BARE_VOLUME = String.raw `(?<volume>(?!(?:1[89]|20)\d{2}(?!\d))\d{1,4})`;
const CITED_ISSUE = String.raw `(?<issue>\d{1,4}(?:\s*[-–/]\s*\d{1,4})?)`;
const CITED_PAGES = String.raw `(?<pages>[A-Za-z]?\d{1,7}(?:\s*[-–—]\s*[A-Za-z]?\d{1,7})?)`;
const CITED_MONTH_WORD = String.raw `(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const CITATION_TAILS: RegExp[] = [
    new RegExp(String.raw `^(?<name>.*?[^\s,])(?:\s*,\s*|\s+)${CITED_YEAR}\s*,\s*${CITED_BARE_VOLUME}(?:\s*\(\s*${CITED_ISSUE}\s*\))?(?:\s*,\s*${CITED_PAGES})?$`, 'u'),
    new RegExp(String.raw `^(?<name>.*?[^\s,])\s+${CITED_BARE_VOLUME}\s*,\s*${CITED_PAGES}\s*\(\s*${CITED_YEAR}\s*\)$`, 'u'),
    new RegExp(String.raw `^(?<name>.*?[^\s,])(?:\s*,\s*|\s+)${CITED_BARE_VOLUME}\s*\(\s*${CITED_YEAR}\s*\)(?:\s*,?\s*${CITED_PAGES})?$`, 'u'),
    new RegExp(String.raw `^(?<name>.*?[^\s,(])\s*\(\s*${CITED_YEAR}\s*\)\s*,?\s*${CITED_BARE_VOLUME}(?:\s*\(\s*${CITED_ISSUE}\s*\))?\s*[,:]\s*${CITED_PAGES}$`, 'u'),
    new RegExp(String.raw `^(?<name>.*?[^\s,])(?:\s*,\s*|\s+)${CITED_YEAR}(?:\s+[A-Za-z]{3,9}\.?(?:\s+\d{1,2})?)?\s*;\s*${CITED_BARE_VOLUME}(?:\s*\(\s*${CITED_ISSUE}\s*\))?(?:\s*:\s*${CITED_PAGES})?$`, 'u'),
    new RegExp(String.raw `^(?<name>.*?[^\s,;:])(?:\s*[,;:]\s*|\s+)vol(?:ume)?\.?\s*${CITED_VOLUME}(?:\s*[,.;:]?\s*(?:no|number|issue|iss)\.?\s*${CITED_ISSUE})?(?:\s*[,.;:]?\s*\(?\s*(?:${CITED_MONTH_WORD}\.?\s+)?${CITED_YEAR}\s*\)?)?(?:\s*[,.;:]?\s*(?:pp?\.?\s*)?${CITED_PAGES})?$`, 'iu'),
    new RegExp(String.raw `^(?<name>.*?[^\s,;:])(?:\s*[,;:]\s*|\s+)vol(?:ume)?\.?\s*${CITED_VOLUME}(?:\s*[,.;:]?\s*(?:no|number|issue|iss)\.?\s*${CITED_ISSUE})?\s*[,.;:]?\s*pp?\.\s*${CITED_PAGES}\s*[,.;:]?\s*\(?\s*(?:${CITED_MONTH_WORD}\.?\s+)?${CITED_YEAR}\s*\)?$`, 'iu'),
    new RegExp(String.raw `^(?<name>.*?[^\s,])[\s,]*(?:제\s*)?${CITED_VOLUME}\s*권(?:\s*[,.]?\s*(?:제\s*)?${CITED_ISSUE}\s*호)?(?:\s*[,.]?\s*\(?\s*${CITED_YEAR}(?:\s*[.년]\s*(?<month>\d{1,2})\s*[.월]?)?\s*\)?)?(?:\s*[,.]?\s*(?:pp?\.?\s*)?${CITED_PAGES}\s*(?:쪽)?)?$`, 'u')
];
const CITED_DOI_STATEMENT = /[\s,;.]*(?:\bdoi\s*[:：]?\s*|https?:\/\/(?:dx\.)?doi\.org\/)10\.\d{4,9}\/\S*$/i;
const CITED_FOLIO = /\s+\d{1,4}\s+of\s+\d{1,4}$/i;
export function citationCoordinatesOf(value: unknown): {
    name: string;
    year: string;
    month: string;
    volume: string;
    issue: string;
    pages: string;
} | null {
    const spaced = String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (spaced.length > 600)
        return null;
    const text = spaced.replace(CITED_DOI_STATEMENT, '').replace(CITED_FOLIO, '').replace(/[\s.;,]+$/, '');
    if (!text || text.length > 300)
        return null;
    for (const shape of CITATION_TAILS) {
        const found = shape.exec(text);
        if (!found?.groups)
            continue;
        const { name = '', year = '', month = '', volume = '', issue = '', pages = '' } = found.groups;
        if ([year, volume, issue, pages].filter(Boolean).length < 2)
            continue;
        const bare = name.replace(/[\s,，;:•·|/–—-]+$/u, '').trim();
        if ((bare.match(/\p{L}/gu) || []).length < 2)
            continue;
        return { name: bare, year, month: month ? month.padStart(2, '0') : '', volume: String(Number(volume)),
            issue: issue ? issue.replace(/\s+/g, '').replace(/^0+(?=\d)/, '') : '', pages: pages.replace(/\s+/g, '') };
    }
    return null;
}
const LEGISLATION_DESIGNATION = new RegExp(String.raw `^\s*[■□◆◇●○▣]?\s*(?<act>[^\[\]<>■]{2,80}?(?:법률|법|시행령|령|시행규칙|규칙|규정|고시|훈령|예규|조례|지침))?\s*`
    + String.raw `\[\s*(?<part>별표|별지)\s*(?<n>(?:제\s*)?\d+(?:\s*의\s*\d+)?)\s*(?<form>호\s*서식)?\s*\]\s*`
    + String.raw `(?:<\s*(?:개정|신설|전문\s*개정|제정)\s*(?:[^>]*,\s*)?(?<date>(?:19|20)\d{2}\s*\.\s*\d{1,2}\s*\.\s*\d{1,2})\s*\.?\s*>)?`
    + String.raw `(?:\s*\(\s*제\s*\d+\s*조[^)]*\))?\s*$`, 'u');
export function legislationDesignation(evidence?: EvidenceBundle): {
    act: string;
    part: string;
    number: string;
    date: string;
    ministry: string;
} | null {
    const first = (evidence?.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind) && /^(?:OCR )?page 1\b/.test(String(o.locator || '')));
    for (const page of first) {
        const text = String(page.text || '').normalize('NFKC');
        for (const line of text.split(/\r?\n/).map(value => value.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 5)) {
            const found = LEGISLATION_DESIGNATION.exec(line)?.groups;
            if (!found)
                continue;
            const number = `${found.part} ${found.n.replace(/\s+/g, '')}${found.form ? '호서식' : ''}`;
            return { act: String(found.act || '').replace(/\s+/g, ' ').trim(), part: found.part, number,
                date: found.date ? canonicalDate(found.date.replace(/\s+/g, '')) || '' : '', ministry: ordinanceMinistry(text) };
        }
    }
    return null;
}
const STANDARD_NUMBER = /\b(?:KS\s*[A-Z](?:\s*(?:ISO|IEC))?\s*\d{3,5}|ISO(?:\/IEC)?(?:\/T[SR])?\s*\d{3,5}|IEC\s*\d{3,5}|ASTM\s*[A-Z]\s*\d{1,5}|EN\s*\d{3,5}|JIS\s*[A-Z]\s*\d{3,5}|GB(?:\/T)?\s*\d{3,5}|ANSI(?:\/[A-Z]+)?\s*[A-Z]?\s*\d{1,5}|IEEE\s+Std\.?\s*\d{2,5}|DIN(?:\s+EN)?(?:\s+ISO)?\s*\d{3,5}|BS(?:\s+EN)?(?:\s+ISO)?\s*\d{3,5}|NFPA\s*\d{1,4}|UL\s*\d{2,5})\b/;
const TYPE_ONLY_FIELDS = new Set(Object.values(FIELDS_BY_TYPE).flat());
const IDENTIFIER_FIELDS = new Set(['DOI', 'ISBN', 'ISSN', 'citationKey']);
function fieldsTheTypeDoesNotHold(fields: Record<string, any>, type: string): string[] {
    const own = new Set(FIELDS_BY_TYPE[type] || []);
    return Object.keys(fields).filter(field => TYPE_ONLY_FIELDS.has(field) && !own.has(field) && !IDENTIFIER_FIELDS.has(field) && has(fields, field));
}
function statedRolesOf(name: string, evidence: EvidenceBundle | undefined): {
    publisher: boolean;
    rights: boolean;
} {
    const roles = statedAs(statementsOf(evidence), name, { explicit: true });
    return { publisher: roles.has('publisherHouse') || roles.has('issuer'), rights: roles.has('rightsHolder') };
}
const LETTER_FORM = /^(?:dear\s+\S|to\s+whom\s+it\s+may\s+concern)|^(?:yours\s+)?sincerely(?![\p{L}])|^yours\s+(?:faithfully|truly)(?![\p{L}])|^(?:best|kind|warm)\s+regards(?![\p{L}])|^respectfully(?![\p{L}])|^拝啓|^수\s*신\s*[:：]/iu;
const PRINT_STAMP = /^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}|^(?:19|20)\d{2}\.\s*\d{1,2}\.\s*\d{1,2}\.\s*(?:오전|오후)\s*\d{1,2}:\d{2}/u;
const browserPrintBand = (line: string) => line.length <= 400
    && ((/https?:\/\//i.test(line) && /(?<!\d)\d{1,3}\s*\/\s*\d{1,3}$/.test(line)) || PRINT_STAMP.test(line));
function reportOfAnIssuingBody(typed: {
    itemType: string;
    itemTypeID: any;
}, record: MetadataSnapshot, fields: Record<string, any>, notes: Record<string, string>, evidence: EvidenceBundle | undefined, articleCoordinates: boolean, drop: (field: string, why: string) => void): void {
    if (typed.itemType !== 'document' || record.typeRead === true || !has(fields, 'publisher') || has(fields, 'institution'))
        return;
    const issuer = String(fields.publisher).replace(/\s+/g, ' ').trim();
    const front = frontPages(evidence);
    const frontTexts = front.map(page => page.text);
    const printsASerialMark = frontTexts.some(text => /(?<![\p{L}])e?-?ISSN(?![\p{L}])/iu.test(text) || !!doiIn(text) || statesAnIssue(text));
    const bookOrSerial = has(fields, 'ISBN') || ownISBNs(frontTexts).length > 0 || has(fields, 'ISSN') || has(fields, 'edition') || articleCoordinates
        || CONTAINER_FIELDS.some(field => has(fields, field)) || printsASerialMark;
    if (bookOrSerial || isPublishingHouse(issuer))
        return;
    const opening = front.filter(page => page.page <= 2);
    if (opening.some(page => linesOf(page.text).some(line => LETTER_FORM.test(line))))
        return;
    if (opening.some(page => { const lines = linesOf(page.text); return [...lines.slice(0, 2), ...lines.slice(-2)].some(browserPrintBand); }))
        return;
    if (/대학원$|graduate\s+school/iu.test(issuer))
        return;
    const people = (record.creators || []).some((person: any) => {
        const whole = `${String(person?.firstName ?? '').trim()} ${String(person?.lastName ?? person?.name ?? '').trim()}`.trim();
        if (!/\p{L}/u.test(whole))
            return false;
        if (person?.fieldMode !== 1)
            return true;
        if (isOrganisationName(whole.replace(/\s+/g, '')) || isOrganisationOnly(whole))
            return false;
        return nameShape(whole).person !== 'no';
    });
    const body = isOrganisationName(issuer.replace(/\s+/g, '')) || isOrganisationOnly(issuer) || issuer.split(' ').some(token => isInstitutionName(token));
    const statedRoles = statedRolesOf(issuer, evidence);
    const stated = statedRoles.rights || statedRoles.publisher;
    if (!(people ? stated : (body || stated)))
        return;
    const moved = movedStatement('institution', issuer, { evidence, itemType: 'report', creators: record.creators, record: { ...record, fields } as MetadataSnapshot });
    if (!moved)
        return;
    setType(typed, 'report');
    fields.institution = moved;
    delete fields.publisher;
    notes.itemType = `유형을 말하지 않은 판독입니다 — 책·연속간행물의 흔적 없이 「${issuer}」${stated ? '(쪽이 권리자·발행처로 찍은 이름)' : ''}가 낸 문서라 보고서로 봅니다.`;
    notes.institution = `「${issuer}」은 이 문서를 낸 기관입니다 — 발행처 칸에서 발행 기관 칸으로 옮겼습니다${moved !== issuer ? `(판권 문구를 뗀 이름 「${moved.slice(0, 60)}」)` : ''}.`;
    for (const field of fieldsTheTypeDoesNotHold(fields, 'report'))
        drop(field, `보고서에는 ${field} 칸이 없습니다.`);
}
const DOCUMENT_CODE_SHAPE = /^(?=\S*\d)[A-Z0-9][A-Za-z0-9._/-]{3,39}$/;
const ORCID_SHAPE = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;
function documentCode(value: string): boolean {
    const token = String(value ?? '').trim().replace(/[.,;:]+$/, '');
    if (!DOCUMENT_CODE_SHAPE.test(token) || ORCID_SHAPE.test(token))
        return false;
    if (!/[A-Za-z]/.test(token) && !(token.replace(/\D/g, '').length >= 6 && /\d[-_./]\d/.test(token)))
        return false;
    if (canonicalDate(token) || /^\d{1,4}[./-]\d{1,2}(?:[./-]\d{1,4})?$/.test(token) || /^0\d{1,2}-\d{3,4}-\d{4}$/.test(token))
        return false;
    return !(validISBN(token) || validISSN(token) || /^10\.\d{4,9}\//.test(token) || /\.(?:com|org|net|edu|gov|de|kr|jp|cn|uk)$/i.test(token));
}
const NUMBER_LABEL = /^(.*?\b(?:number|no\.|nr\.|id|code))\s*[:：#]\s*(\S*)$/i;
const NOT_A_DOCUMENT_LABEL = /\b(?:phone|tel|fax|isbn|issn|doi|patent|page|serial|account|customer|zip|postal|model|lot|batch|cas|ec|mdl|einecs|beilstein|pubchem|product|catalog(?:ue)?|cat|orcid|manuscript|submission|grant|award|contract|funding)\b/i;
const MONTH_YEAR = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?,?\s*(?:19|20)\d{2}\b|(?:19|20)\d{2}\s*[년年]\s*\d{1,2}\s*[월月]/i;
const frontPages = (evidence: EvidenceBundle | undefined) => (evidence?.observations || [])
    .filter(o => ['pdfText', 'ocrText'].includes(o.kind) && pageNumberOf(o) >= 1 && pageNumberOf(o) <= 5)
    .map(o => ({ page: pageNumberOf(o), kind: o.kind, text: String(o.text || '') })).sort((a, b) => a.page - b.page);
function runningRows(evidence: EvidenceBundle | undefined): string[] {
    const structure = pageStructureOf(evidence);
    const rows = new Set(runningTexts(structure, ['runningHead', 'runningFoot', 'masthead', 'documentNumber']));
    for (const code of codesOf(structure))
        if (code.kind === 'documentNumber' && code.pages.length >= 2)
            rows.add(code.value);
    return [...rows];
}
export function documentNumberOnThePages(evidence?: EvidenceBundle, stated?: unknown): string {
    const pages = frontPages(evidence);
    if (!pages.length)
        return '';
    const wanted = String(stated ?? '').trim();
    if (wanted && documentCode(wanted)) {
        const printed = pages.flatMap(page => linesOf(page.text).flatMap(line => line.split(' '))).map(token => token.replace(/[.,;:]+$/, ''))
            .find(token => token.toLowerCase() === wanted.toLowerCase());
        if (printed)
            return printed;
    }
    for (const page of pages) {
        const lines = linesOf(page.text);
        for (let at = 0; at < lines.length; at++) {
            const label = NUMBER_LABEL.exec(lines[at]);
            if (!label || NOT_A_DOCUMENT_LABEL.test(label[1]))
                continue;
            const value = (label[2] || lines[at + 1] || '').replace(/[.,;:]+$/, '');
            if (documentCode(value))
                return value;
        }
    }
    const running = runningRows(evidence).find(documentCode);
    if (running)
        return running.replace(/[.,;:]+$/, '');
    for (const page of pages.filter(entry => entry.page <= 3)) {
        const rows = String(page.text).normalize('NFKC').split(/\r?\n/).map(row => row.trim()).filter(Boolean);
        for (let at = 0; at < rows.length; at++) {
            const parts = rows[at].split(/\s+[/|·•]\s+|\s{2,}/).map(part => part.trim()).filter(Boolean);
            const code = parts.length <= 2 ? parts.find(documentCode) : undefined;
            if (code && MONTH_YEAR.test(rows.slice(Math.max(0, at - 2), at + 3).join(' ')))
                return code.replace(/[.,;:]+$/, '');
        }
    }
    return '';
}
const GENRE_MODIFIER = String.raw `(?:application|app|data|user['’]?s?|installation|install|reference|programming|programmer['’]?s?|technical|product|quick\s+start|getting\s+started|service|operating|operation|owner['’]?s?|design|release|white|safety|maintenance|instruction|hardware|software|configuration|integration|selection)`;
const GENRE_PHRASE = String.raw `(?:(?:${GENRE_MODIFIER}\s+){1,2}(?:notes?|sheets?|manual|guide|brief|paper|handbook|reference)|datasheets?|manual|handbook)`;
const INFORMATION_SHEET = /^(?:product|technical|data)\s+information$/i;
const GENRE_CHAIN = String.raw `${GENRE_PHRASE}(?:\s*(?:&|and|/)\s*${GENRE_PHRASE})*`;
const GENRE_ROW = new RegExp(String.raw `^${GENRE_CHAIN}$`, 'i');
const GENRE_ENDING = new RegExp(String.raw `(?:^|\s)(${GENRE_CHAIN})$`, 'i');
const genreCased = (value: string) => shouting(value) ? value.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase()) : value;
export function namesADocumentKind(value: unknown): boolean {
    const text = String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    return !!text && text.length <= 200 && GENRE_ROW.test(text);
}
function genreOnThePages(evidence: EvidenceBundle | undefined, title: string): string {
    const ending = GENRE_ENDING.exec(title.replace(/\s+/g, ' ').trim());
    if (ending)
        return genreCased(ending[1]);
    for (const page of frontPages(evidence).filter(entry => entry.page <= 3)) {
        const row = linesOf(page.text).find(line => GENRE_ROW.test(line) && !foldedLetters(title).includes(foldedLetters(line)));
        if (row)
            return genreCased(row);
    }
    return '';
}
const PRODUCT_CODE = /(?<![\p{L}\d])(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z][A-Z0-9-]{2,15}(?![\p{L}\d])/u;
const productShaped = (token: string) => PRODUCT_CODE.exec(token)?.[0] === token;
function namedInTheTitle(title: string, name: string): boolean {
    const haystack = title.toLowerCase(), needle = name.toLowerCase();
    if (!needle)
        return false;
    const edge = (char: string | undefined) => !char || !/[\p{L}\d]/u.test(char);
    for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
        if (edge(haystack[at - 1]) && edge(haystack[at + needle.length]))
            return true;
    }
    return false;
}
function ownDocumentNumber(reportNumber: string, evidence: EvidenceBundle | undefined): boolean {
    const key = foldedLetters(reportNumber);
    if (!key || !evidence)
        return false;
    const established = [documentNumberOnThePages(evidence),
        ...codesOf(pageStructureOf(evidence)).filter(code => code.kind === 'documentNumber').map(code => code.value)];
    return established.some(value => !!value && foldedLetters(value) === key);
}
function statedAsTheNumber(token: string, evidence: EvidenceBundle | undefined): boolean {
    const key = foldedLetters(token);
    return !!key && !!evidence && codesOf(pageStructureOf(evidence)).some(code => code.kind === 'documentNumber'
        && (code.from.includes('label') || code.from.includes('imprint')) && foldedLetters(code.value) === key);
}
const NUMBER_SEPARATOR = /^[-–—:|/·•]+$/;
const TOKEN_OPENERS = '([「『"\'“‘', TOKEN_CLOSERS = ')]」』"\'”’.,;:';
function bareToken(word: string): string {
    let start = 0, end = word.length;
    while (start < end && TOKEN_OPENERS.includes(word[start]))
        start++;
    while (end > start && TOKEN_CLOSERS.includes(word[end - 1]))
        end--;
    return word.slice(start, end);
}
function withoutOwnNumber(title: string, evidence: EvidenceBundle | undefined): string {
    const words = title.split(/\s+/).filter(Boolean);
    const own = (word: string | undefined) => {
        const token = bareToken(word ?? '');
        return !!token && (!productShaped(token) || statedAsTheNumber(token, evidence))
            && [token, withoutStatus(token).value].some(value => ownDocumentNumber(value, evidence));
    };
    let from = 0, to = words.length;
    while (to - from > 1 && own(words[from])) {
        from++;
        while (from < to && NUMBER_SEPARATOR.test(words[from]))
            from++;
    }
    while (to - from > 1 && own(words[to - 1])) {
        to--;
        while (to > from && NUMBER_SEPARATOR.test(words[to - 1]))
            to--;
    }
    return (from > 0 || to < words.length) && from < to ? words.slice(from, to).join(' ') : title;
}
function deviceNamesOnThePages(evidence: EvidenceBundle | undefined, reportNumber: unknown): string[] {
    const number = foldedLetters(String(reportNumber ?? ''));
    const names: string[] = [];
    for (const code of codesOf(pageStructureOf(evidence))) {
        if (code.kind !== 'part' || names.includes(code.value))
            continue;
        const spellings = [code.value, withoutStatus(code.value).value];
        const statedNumber = (value: string) => !!number && !productShaped(value) && foldedLetters(value) === number;
        if (spellings.some(value => statedNumber(value) || ownDocumentNumber(value, evidence)))
            continue;
        names.push(code.value);
    }
    return names;
}
function technicalDocument(typed: {
    itemType: string;
    itemTypeID: any;
}, fields: Record<string, any>, notes: Record<string, string>, evidence: EvidenceBundle | undefined, drop: (field: string, why: string) => void): void {
    if (!evidence || !['report', 'book', 'document', 'journalArticle'].includes(typed.itemType))
        return;
    const title = String(fields.title ?? '').trim();
    const genre = genreOnThePages(evidence, title);
    if (!genre)
        return;
    if (typed.itemType === 'journalArticle') {
        const coordinates = ['volume', 'issue', 'pages', 'DOI', 'ISSN'].some(field => has(fields, field));
        const linked = sameEditionRecords(evidence).some(link => CONTAINER_FIELDS.some(field => String(link.stated?.[field]?.value ?? '').trim()));
        if (coordinates || linked || has(fields, 'publicationTitle'))
            return;
        const number = documentNumberOnThePages(evidence, fields.reportNumber || fields.number);
        if (!number)
            return;
        notes.itemType = `학술지의 이름·좌표(권·호·쪽·DOI·ISSN)가 없고 쪽이 기술 문서의 종류 「${genre}」와 문서 번호 「${number}」를 찍어 학술지 논문이 아니라 보고서로 봅니다.`;
        setType(typed, 'report');
        for (const field of fieldsTheTypeDoesNotHold(fields, 'report'))
            drop(field, `보고서에는 ${field} 칸이 없습니다.`);
    }
    const heldNumber = String(fields.reportNumber || '').trim();
    const partOnly = !!heldNumber && productShaped(heldNumber) && !ownDocumentNumber(heldNumber, evidence)
        && codesOf(pageStructureOf(evidence)).some(code => code.kind === 'part' && foldedLetters(code.value) === foldedLetters(heldNumber));
    const number = documentNumberOnThePages(evidence, partOnly ? undefined : fields.reportNumber || fields.number);
    if (partOnly && number && foldedLetters(number) !== foldedLetters(heldNumber) && !productShaped(number)) {
        notes.reportNumber = `「${heldNumber}」은 이 문서가 다루는 소자·모델의 이름입니다 — 보고서 번호는 쪽에 찍힌 문서 번호 「${number}」입니다.`;
        fields.reportNumber = number;
    }
    if (typed.itemType !== 'report') {
        if (has(fields, 'ISBN') || !number)
            return;
        notes.itemType = `ISBN이 없고 쪽이 종류 「${genre}」와 문서 번호 「${number}」를 찍은 기술 문서라 ${typed.itemType === 'book' ? '책' : '문서'}이 아니라 보고서로 봅니다.`;
        setType(typed, 'report');
        if (has(fields, 'publisher') && !has(fields, 'institution')) {
            fields.institution = fields.publisher;
            delete fields.publisher;
        }
        for (const field of fieldsTheTypeDoesNotHold(fields, 'report'))
            drop(field, `보고서에는 ${field} 칸이 없습니다.`);
    }
    if (number && !has(fields, 'reportNumber')) {
        fields.reportNumber = number;
        notes.reportNumber = `쪽에 찍힌 문서 번호 「${number}」.`;
    }
    if (!has(fields, 'reportType')) {
        fields.reportType = genre;
        notes.reportType = `쪽에 찍힌 문서의 종류 「${genre}」.`;
    }
    if (!title)
        return;
    const tell = (why: string) => { notes.title = notes.title ? `${notes.title} ${why}` : why; };
    let written = withoutOwnNumber(title, evidence);
    if (written !== title)
        tell(`제목에 붙은 이 문서의 제 번호를 뗐습니다 — 문서 번호는 보고서 번호 칸의 것입니다(「${title.slice(0, 80)}」).`);
    if (!GENRE_ENDING.test(written)) {
        const bare = written;
        const whole = frontPages(evidence).filter(page => page.page <= 3).flatMap(page => linesOf(page.text))
            .find(line => foldedLetters(line) === foldedLetters(`${bare} ${genre}`));
        if (whole) {
            written = whole;
            tell(`쪽이 제목과 종류를 한 줄로 찍었습니다 — 「${whole}」.`);
        }
    }
    const names = deviceNamesOnThePages(evidence, fields.reportNumber);
    if (names.length === 1 && !namedInTheTitle(written, names[0])) {
        written = `${names[0]} ${written}`;
        tell(`제목에 이 문서가 다루는 제품 이름 「${names[0]}」이 없어 앞에 붙였습니다 — 쪽 머리·꼬리가 되풀이해 찍은 이름입니다(「${written}」).`);
    }
    if (written !== title)
        fields.title = written;
}
const PRODUCT_NUMBER_LABEL = /^(?:product|catalog(?:ue)?|cat\.?)\s*(?:number|no\.?|code|#)\s*[:：#]?\s*/i;
const CODE_PIECE = /^[A-Z0-9][A-Z0-9.,/-]{0,29}$/;
const NOT_A_DOCUMENT_NUMBER_BEFORE = /(?<![\p{L}])(?:CAS|EC|MDL|EINECS|Beilstein|PubChem|[Pp]roduct|PRODUCT|[Cc]atalog(?:ue)?|CATALOG(?:UE)?|[Cc]at\.)(?![\p{L}])[^\n]{0,20}$/u;
export function productNumberOnThePages(evidence: EvidenceBundle | undefined): string {
    for (const page of frontPages(evidence).filter(entry => entry.page <= 2)) {
        const lines = linesOf(page.text).map(line => line.normalize('NFKC').replace(/\s+/g, ' ').trim());
        for (let at = 0; at < lines.length; at++) {
            const label = PRODUCT_NUMBER_LABEL.exec(lines[at]);
            if (!label)
                continue;
            const rest = lines[at].slice(label[0].length).trim() || lines[at + 1] || '';
            const pieces: string[] = [];
            for (const token of rest.split(' ')) {
                if (pieces.length >= 3 || !CODE_PIECE.test(token))
                    break;
                pieces.push(token);
            }
            const value = pieces.join(' ').replace(/[.,;:]+$/, '');
            if (/\d/.test(value) && /[A-Z0-9]/.test(value))
                return value;
        }
    }
    return '';
}
export function sheetNumberOnThePages(evidence: EvidenceBundle | undefined, productNumber = ''): string {
    for (const page of frontPages(evidence)) {
        const lines = linesOf(page.text).slice(-8).filter(line => line.length <= 80)
            .map(line => line.normalize('NFKC').replace(/\s+/g, ' ').replace(/ ?\/ ?/g, '/').trim()).filter(Boolean);
        for (const line of lines) {
            if (line.length > 40)
                continue;
            const tokens = line.split(' ');
            if (tokens.length > 3 || !tokens.every(token => CODE_PIECE.test(token)) || !/\d/.test(line) || !/[/-]/.test(line) || NOT_A_DOCUMENT_LABEL.test(line))
                continue;
            if (!tokens.some(token => (token.match(/[A-Z]/g) || []).length >= 2))
                continue;
            if (productNumber && foldedLetters(line) === foldedLetters(productNumber))
                continue;
            if (canonicalDate(line) || /^\d{2,7}-\d{2}-\d$/.test(line) || validISBN(line) || validISSN(line) || /^10\.\d{4,9}\//.test(line))
                continue;
            return line;
        }
    }
    return '';
}
function productNameAboveTheNumber(evidence: EvidenceBundle | undefined): string {
    for (const page of frontPages(evidence).filter(entry => entry.page <= 2)) {
        const lines = linesOf(page.text).map(line => line.normalize('NFKC').replace(/\s+/g, ' ').trim()).filter(Boolean);
        const at = lines.findIndex(line => PRODUCT_NUMBER_LABEL.test(line));
        if (at < 1)
            continue;
        const name = lines[at - 1];
        const spaced = name.replace(/(?<=\p{Ll})(?=\p{Lu})/gu, ' ');
        if (name.length <= 120 && /\p{L}{2}/u.test(name) && !INFORMATION_SHEET.test(spaced) && !namesADocumentKind(spaced) && !name.split(' ').every(token => CODE_PIECE.test(token)))
            return name;
    }
    return '';
}
function labelledAsAnotherNumber(value: string, evidence: EvidenceBundle | undefined): boolean {
    const key = foldedLetters(value);
    if (!key)
        return false;
    for (const page of frontPages(evidence)) {
        for (const line of linesOf(page.text)) {
            const flat = line.normalize('NFKC');
            const at = flat.indexOf(value.trim());
            if (at > 0 && NOT_A_DOCUMENT_NUMBER_BEFORE.test(flat.slice(0, at)))
                return true;
        }
    }
    return false;
}
function productSheet(typed: {
    itemType: string;
}, fields: Record<string, any>, notes: Record<string, string>, evidence: EvidenceBundle | undefined, drop: (field: string, why: string) => void): void {
    if (typed.itemType !== 'report' || !evidence)
        return;
    const product = productNumberOnThePages(evidence);
    if (!product)
        return;
    const held = String(fields.reportNumber ?? '').trim();
    const anotherNumber = !!held && (foldedLetters(held) === foldedLetters(product) || labelledAsAnotherNumber(held, evidence));
    if (!held || anotherNumber) {
        const sheet = sheetNumberOnThePages(evidence, product);
        if (sheet && foldedLetters(sheet) !== foldedLetters(held)) {
            fields.reportNumber = sheet;
            notes.reportNumber = `${held ? `「${held}」은 쪽이 물질 번호·제품 번호로 찍은 번호입니다 — ` : ''}보고서 번호는 쪽 아래에 홀로 찍힌 이 문서의 번호 「${sheet}」입니다.`;
        }
        else if (anotherNumber)
            drop('reportNumber', `「${held}」은 쪽이 물질 번호·제품 번호로 찍은 번호입니다 — 이 문서의 번호가 아닙니다.`);
    }
    let title = String(fields.title ?? '').replace(/\s+/g, ' ').trim();
    const spaced = title.replace(/(?<=\p{Ll})(?=\p{Lu})/gu, ' ');
    if (title && (INFORMATION_SHEET.test(spaced) || namesADocumentKind(spaced))) {
        const name = productNameAboveTheNumber(evidence);
        if (name) {
            notes.title = `${notes.title ? `${notes.title} ` : ''}「${title.slice(0, 40)}」은 문서의 종류(쪽 머리의 띠)입니다 — 제품 정보서의 제목은 제품 번호 라벨 위에 찍힌 제품명 「${name.slice(0, 60)}」입니다.`;
            if (!has(fields, 'reportType'))
                fields.reportType = genreCased(spaced);
            title = name;
            fields.title = name;
        }
    }
    if (title && !namedInTheTitle(title, product) && !namedInTheTitle(title, product.replace(/\s+/g, ''))
        && !title.split(' ').some(word => productShaped(bareToken(word)))) {
        fields.title = `${product} ${title}`;
        notes.title = `${notes.title ? `${notes.title} ` : ''}쪽이 라벨로 찍은 제품 번호 「${product}」를 제품명 앞에 붙였습니다(제품 번호 + 제품명).`;
    }
}
function koreanPerson(name: string): {
    lastName: string;
    firstName: string;
    fieldMode: number;
} {
    const whole = name.replace(/\s+/g, '');
    const parts = personParts(whole, { bodyLanguage: 'ko' });
    return parts ? { lastName: parts.lastName, firstName: parts.firstName, fieldMode: parts.fieldMode } : { lastName: whole, firstName: '', fieldMode: 1 };
}
const INVENTION_NAME = /^발\s*명\s*(?:\(\s*고\s*안\s*\)\s*)?의\s*(?:(국|한|영)\s*(?:문|글)\s*)?명\s*칭\s*[:：]?\s*(.*)$/;
const APPLICATION_BLOCK = /^(?:출원인|대리인|발명자|심사청구|취지|수수료|첨부서류|특허\s*명세서|명세서|요약서|청구범위)(?:\s|$)/;
const INID_COUNTRY = /\(\s*19\s*\)[^\S\n]*[^\n()]{0,40}\(\s*([A-Z]{2})\s*\)/;
function inidCountryOf(pages: string): string {
    return INID_COUNTRY.exec(String(pages ?? '').normalize('NFKC'))?.[1] || '';
}
interface PatentApplication {
    title: string;
    english: string;
    inventors: string[];
    assignee: string;
    authority: string;
    applicationNumber: string;
    filingDate: string;
}
function patentApplicationOnThePages(evidence: EvidenceBundle | undefined): PatentApplication | null {
    const observations = (evidence?.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind));
    const layer = observations.filter(o => o.kind === 'pdfText');
    const lines = (layer.length ? layer : observations).sort((a, b) => pageNumberOf(a) - pageNumberOf(b)).flatMap(o => linesOf(o.text));
    const text = lines.join('\n');
    if (!/서류명\s*특허\s*출원서|출원구분\s*특허\s*출원|특허청장\s*(?:귀하|에게\s*제출합니다)/.test(text))
        return null;
    let title = '', english = '';
    for (let at = 0; at < lines.length; at++) {
        const label = INVENTION_NAME.exec(lines[at]);
        if (!label)
            continue;
        let value = label[2].trim() || (lines[at + 1] && !APPLICATION_BLOCK.test(lines[at + 1]) ? lines[at + 1] : '');
        for (let next = at + (label[2].trim() ? 1 : 2); next < lines.length && next <= at + 4 && !/[가-힣]/.test(lines[next]) && /^[A-Za-z]/.test(lines[next]) && /[A-Za-z]/.test(value) && !/[가-힣]/.test(value); next++)
            value = `${value} ${lines[next]}`;
        const hangul = value.replace(/\s*[{(（].*$/, '').trim();
        if (label[1] === '영')
            english = english || value.trim();
        else if (/[가-힣]/.test(hangul))
            title = title || hangul;
        else if (value)
            english = english || value.trim();
    }
    if (!title && !english)
        return null;
    const valueAfter = (head: RegExp) => { const at = lines.findIndex(line => head.test(line)); if (at < 0)
        return ''; for (const line of lines.slice(at + 1, at + 4)) {
        const named = /^명\s*칭\s+(.+)$/.exec(line);
        if (named)
            return named[1].trim();
    } return ''; };
    const inventors: string[] = [];
    let inBlock = false;
    for (const line of lines) {
        if (/^발명자(?:\s|$)/.test(line)) {
            inBlock = true;
            continue;
        }
        if (inBlock && APPLICATION_BLOCK.test(line))
            inBlock = false;
        const person = inBlock ? /^성\s*명\s+([가-힣]{2,5})$/.exec(line) : null;
        if (person && !inventors.includes(person[1]))
            inventors.push(person[1]);
    }
    const assignee = valueAfter(/^출원인(?:\s|$)/);
    if (!inventors.length && !assignee)
        return null;
    const filed = /^(?:제출일자|출원일자)\s+(.+)$/m.exec(text)?.[1] || '';
    return { title, english, inventors, assignee, authority: /특허청장/.test(text) ? '특허청' : '',
        applicationNumber: /^출원번호\s+(\d{2}-\d{4}-\d{7})/m.exec(text)?.[1] || '', filingDate: filed ? canonicalDate(filed) || '' : '' };
}
export interface IdentifierOutcome {
    kind?: string;
    value?: string;
    outcome?: string;
    reason?: string;
}
export interface Statement {
    invalid: string;
    as?: string;
    asValue?: string;
    unkept?: boolean;
}
export interface StatementContext {
    evidence?: EvidenceBundle;
    itemType?: string;
    creators?: unknown[];
    lookups?: IdentifierOutcome[];
    record?: MetadataSnapshot;
    fromRecord?: boolean;
    pages?: string;
}
function unresolvedIdentifier(kind: string, value: string, lookups: IdentifierOutcome[] | undefined): boolean {
    const notes = (lookups || []).filter(entry => String(entry?.kind || '') === kind);
    const same = (entry: IdentifierOutcome) => kind === 'DOI' ? sameDOI(String(entry.value || ''), value) : String(entry.value || '').replace(/[^\dXx]/g, '') === value.replace(/[^\dXx]/g, '');
    if (!notes.some(entry => same(entry) && ['noMatch', 'rejected'].includes(String(entry.outcome || ''))))
        return false;
    return (lookups || []).some(entry => entry?.outcome === 'record' && !(String(entry.kind || '') === kind && same(entry)));
}
export function folioOfAnotherPage(value: unknown, evidence: EvidenceBundle | undefined, opening?: number | null): number {
    const text = String(value ?? '').trim();
    if (!/^\d{1,5}$/.test(text) || !evidence?.observations?.length)
        return 0;
    const structure = pageStructureOf(evidence);
    const open = opening ?? structure.opening.page;
    if (!open)
        return 0;
    const folio = Number(text);
    const standalone = new RegExp(`(?<!\\d)0*${folio}(?!\\d)`);
    const read = evidence.observations.filter(entry => entry.kind === 'pdfText' || entry.kind === 'ocrText');
    if (read.some(entry => pageNumberOf(entry) === open && standalone.test(String(entry.text || '').normalize('NFKC'))))
        return 0;
    let found = 0;
    for (const entry of read) {
        const page = pageNumberOf(entry);
        if (!page || page === open || ['insertedLeaf', 'contents', 'references'].includes(roleOf(structure, page)))
            continue;
        if (folioCandidates(String(entry.text || '')).some(candidate => candidate.folio === folio)) {
            found = page;
            break;
        }
    }
    return found;
}
export function folioRunFrom(start: string, evidence: EvidenceBundle | undefined): string | null {
    const documentPages = documentExtent(evidence);
    if (!documentPages)
        return null;
    const pages = new Map<number, {
        page: number;
        text?: string;
        layout?: string;
        pageCount: number;
    }>();
    let readThrough = 0;
    for (const entry of (evidence?.observations || []) as Array<{
        kind?: string;
        text?: string;
        locator?: string;
    }>) {
        if (entry.kind === 'pdfLayout' && entry.locator === 'census') {
            try {
                for (const leaf of JSON.parse(String(entry.text || '{}'))?.pages || [])
                    if (Number.isInteger(Number(leaf?.page)))
                        readThrough = Math.max(readThrough, Number(leaf.page));
            }
            catch { }
            continue;
        }
        const layer = entry.kind === 'pdfText' ? /^page (\d+)\b/.exec(String(entry.locator || '')) : null;
        const laid = entry.kind === 'pdfLayout' ? /^layout page (\d+)\b/.exec(String(entry.locator || '')) : null;
        const page = Number((layer || laid)?.[1]);
        if (!Number.isInteger(page) || page < 1)
            continue;
        readThrough = Math.max(readThrough, page);
        const held = pages.get(page) || { page, pageCount: documentPages };
        if (layer)
            held.text = String(entry.text || '');
        if (laid) {
            try {
                const parsed = JSON.parse(String(entry.text || '{}'));
                if (typeof parsed?.layout === 'string')
                    held.layout = parsed.layout;
            }
            catch { }
        }
        pages.set(page, held);
    }
    if (readThrough < documentPages)
        return null;
    const extent = folioRange([...pages.values()].filter(entry => typeof entry.text === 'string'));
    return extent && extent.start === start && extent.end !== start ? `${extent.start}-${extent.end}` : null;
}
export function bareFolioOfTheOpening(value: unknown, evidence: EvidenceBundle | undefined): number {
    const text = String(value ?? '').trim();
    if (!/^\d{1,5}$/.test(text) || !evidence?.observations?.length)
        return 0;
    const open = pageStructureOf(evidence).opening.page;
    if (!open)
        return 0;
    const folio = Number(text);
    const bare = new RegExp(`^[-–—\\s]*0*${folio}[-–—\\s]*$`);
    const standalone = new RegExp(`(?<![\\d.])0*${folio}(?![\\d])`);
    let printedAsFolio = false;
    for (const entry of evidence.observations) {
        if ((entry.kind !== 'pdfText' && entry.kind !== 'ocrText') || pageNumberOf(entry) !== open)
            continue;
        const page = String(entry.text || '').normalize('NFKC').slice(0, 20000);
        if (page.split(/\r?\n/).some(line => !bare.test(line.trim()) && standalone.test(line)))
            return 0;
        if (folioCandidates(page).some(candidate => candidate.folio === folio && bare.test(candidate.line)))
            printedAsFolio = true;
    }
    return printedAsFolio ? open : 0;
}
export function dayRangeOfADate(value: unknown, evidence: EvidenceBundle | undefined): string {
    const parts = /^(\d{1,2})-(\d{1,2})$/.exec(pagesAsARange(value));
    if (!parts || !evidence || Number(parts[1]) > 31 || Number(parts[2]) > 31)
        return '';
    const printed = new RegExp(String.raw `(?<!\d)0*${parts[1]}[^\S\n]{0,2}[-‐‑‒–—~][^\S\n]{0,2}0*${parts[2]}(?!\d)`, 'g');
    const month = new RegExp(String.raw `(?<![\p{L}])${CITED_MONTH_WORD}\.?,?[^\S\n]{1,3}$`, 'iu');
    let found = '';
    for (const entry of evidence.observations || []) {
        if (entry.kind !== 'pdfText' && entry.kind !== 'ocrText')
            continue;
        const text = String(entry.text || '').normalize('NFKC').slice(0, 100000);
        for (const hit of text.matchAll(printed)) {
            const before = text.slice(Math.max(0, (hit.index ?? 0) - 14), hit.index ?? 0);
            const named = month.exec(before);
            if (!named)
                return '';
            found ||= `${named[0].trim()} ${hit[0].trim()}`;
        }
    }
    return found;
}
export function registryRangeOverAnUnprintedOne(value: unknown, evidence: EvidenceBundle | undefined): {
    range: string;
    provider: string;
} | null {
    const range = pagesAsARange(value);
    const parts = /^(\d{1,6})-(\d{1,6})$/.exec(range);
    if (!parts || !evidence?.links?.length)
        return null;
    const layer = pagesRead(evidence).filter(page => page.readable);
    if (!layer.length)
        return null;
    const printed = new RegExp(`(?<!\\d)0*${parts[1]}[^\\S\\n]{0,3}[-‐‑‒–—−~][^\\S\\n]{0,3}0*${parts[2]}(?!\\d)`);
    if (layer.some(page => printed.test(page.lines.join('\n').normalize('NFKC'))))
        return null;
    const own = doisOfTheDocument(evidence);
    if (!own.length)
        return null;
    for (const link of evidence.links) {
        if (link?.relation !== 'sameEdition' || !/^identifier\b/i.test(String(link.rule || '')))
            continue;
        const doi = String(link.stated?.DOI?.value ?? '');
        if (!doi || !own.some(entry => sameDOI(entry, doi)))
            continue;
        const stated = pagesAsARange(link.stated?.pages?.value);
        if (/^\d{1,6}-\d{1,6}$/.test(stated) && stated !== range)
            return { range: stated, provider: String(link.provider || '') };
    }
    return null;
}
export function unprintedRangeOverRelativePages(value: unknown, evidence: EvidenceBundle | undefined): number {
    const parts = /^(\d{1,6})-(\d{1,6})$/.exec(pagesAsARange(value));
    if (!parts || !evidence)
        return 0;
    const layer = pagesRead(evidence).filter(page => page.readable);
    if (layer.length < 2)
        return 0;
    const printed = new RegExp(`(?<!\\d)0*${parts[1]}[^\\S\\n]{0,3}[-‐‑‒–—−~][^\\S\\n]{0,3}0*${parts[2]}(?!\\d)`);
    if (layer.some(page => printed.test(page.lines.join('\n').normalize('NFKC'))))
        return 0;
    const totals = layer.map(page => page.lines.map(line => /^\s*page\s+\d{1,3}\s+of\s+(\d{1,3})\s*$/i.exec(line.length <= 40 ? line : '')?.[1]).find(Boolean)).filter(Boolean);
    if (totals.length < 2 || new Set(totals).size !== 1)
        return 0;
    const total = Number(totals[0]);
    return Number(parts[1]) === 1 && Number(parts[2]) === total ? 0 : total;
}
function rangeAroundAFolio(folio: number, at: number, evidence: EvidenceBundle | undefined): {
    range: string;
    from: string;
} | null {
    for (const entry of linkedStatementsOf(evidence, 'pages')) {
        const range = /^(\d{1,6})-(\d{1,6})$/.exec(pagesAsARange(entry.value) || '');
        if (range && Number(range[1]) <= folio && folio <= Number(range[2]))
            return { range: `${range[1]}-${range[2]}`, from: `연결된 기록(${entry.provider})` };
    }
    const open = pageStructureOf(evidence).opening.page;
    if (!open || at <= open)
        return null;
    const start = folio - (at - open);
    for (const entry of evidence?.observations || []) {
        if ((entry.kind !== 'pdfText' && entry.kind !== 'ocrText') || pageNumberOf(entry) !== open)
            continue;
        for (const hit of String(entry.text || '').normalize('NFKC').slice(0, 20000).matchAll(/(?<!\d)(\d{1,6})[^\S\n]{0,3}[-‐‑–—±~][^\S\n]{0,3}(\d{1,6})(?!\d)/g)) {
            const range = pagesAsARange(`${hit[1]}-${hit[2]}`);
            const parts = /^(\d{1,6})-(\d{1,6})$/.exec(range);
            if (parts && Number(parts[1]) === start && Number(parts[2]) >= folio)
                return { range, from: `${open}쪽(여는 쪽)이 찍은 범위 「${hit[0].trim()}」` };
        }
    }
    return null;
}
function citedRangeFromAFolio(folio: string, volume: unknown, evidence: EvidenceBundle | undefined): {
    range: string;
    from: string;
} | null {
    const number = numberOnly(String(volume ?? ''));
    if (!evidence || !/^\d{1,6}$/.test(folio) || !number)
        return null;
    const pattern = new RegExp(String.raw `(?<![\p{N}.])0*${number}[^\S\n]*(?:\([^\S\n]*\d{1,6}[^\S\n]*\)[^\S\n]*)?[,:][^\S\n]*(?:pp?\.[^\S\n]*)?0*${folio}[^\S\n]{0,2}[-‐‑–—][^\S\n]{0,2}(\d{1,6})(?!\d)`, 'gu');
    for (const entry of evidence.observations || []) {
        if (entry.kind !== 'pdfText')
            continue;
        const text = String(entry.text || '').normalize('NFKC').slice(0, 100000);
        let cut: Array<[
            number,
            number
        ]> | null = null;
        for (const hit of text.matchAll(pattern)) {
            cut ??= regionSpansIn(text, ['references', 'otherWorks']);
            if (cut.some(([from, to]) => (hit.index ?? 0) >= from && (hit.index ?? 0) < to))
                continue;
            const range = pagesAsARange(`${folio}-${hit[1]}`);
            if (/^\d{1,6}-\d{1,6}$/.test(range))
                return { range, from: `${pageNumberOf(entry)}쪽이 이 글의 권 뒤에 찍은 범위 「${hit[0].trim()}」` };
        }
    }
    return null;
}
export function statementOf(field: string, value: unknown, context: StatementContext = {}): Statement | null {
    if (typeof value !== 'string' && typeof value !== 'number')
        return null;
    const text = repairText(String(value)).trim();
    if (!text)
        return null;
    if (context.fromRecord && EDITION_DESCRIPTION_FIELDS.has(field) && field !== 'edition') {
        const why = recordContradictsTheDocument(context.record?.fields as Record<string, unknown> | undefined, context.evidence);
        if (why)
            return { invalid: `${why} — 그 기록의 ${field}는 이 판의 진술이 아닙니다`, unkept: true };
        const stated = field === 'place' ? placeTheDocumentStatesInsteadOf(text, context.evidence) : '';
        if (stated)
            return { invalid: `기록의 곳 「${text.slice(0, 40)}」은 문서가 이 판의 곳으로 찍은 「${stated.slice(0, 40)}」과 어긋납니다`, unkept: true };
    }
    switch (field) {
        case 'title': {
            if (titleFailsContract(text, context.evidence, context.itemType, context.creators))
                return { invalid: `「${text.slice(0, 60)}」은 계약이 제목으로 받지 않습니다` };
            const inid = context.pages ? inidCodeStating(text, context.pages) : '';
            if (inid && inid !== '54')
                return { invalid: `「${text.slice(0, 60)}」은 공보가 INID (${inid}) 칸으로 찍은 값입니다 — 제목은 (54) 발명의 명칭입니다` };
            if (context.fromRecord && context.pages && !titleSupportedByPDF(text, context.pages))
                return { invalid: `기록의 제목 「${text.slice(0, 60)}」은 쪽에 찍혀 있지 않습니다` };
            return null;
        }
        case 'DOI': {
            const doi = withoutGluedTail(doiIn(text));
            if (!doi)
                return { invalid: `「${text.slice(0, 60)}」은 DOI 모양이 아닙니다` };
            if (templateDOI(doi))
                return { invalid: `「${doi}」은 원고 서식의 자리표시 DOI입니다` };
            if (unresolvedIdentifier('DOI', doi, context.lookups))
                return { invalid: `레지스트리가 「${doi}」로 이 문서의 기록을 주지 않았고, 이 행의 다른 식별자가 이 문서의 기록으로 풀렸습니다`, unkept: true };
            return null;
        }
        case 'ISBN':
        case 'ISSN': {
            const check = field === 'ISBN' ? validISBN : validISSN;
            const tokens = text.split(/[\s,;/]+|(?<=\d)\s*\(|\)/).map(token => token.trim()).filter(Boolean);
            return tokens.some(token => check(token)) ? null : { invalid: `「${text.slice(0, 60)}」에 검사 숫자가 맞는 ${field}가 없습니다` };
        }
        case 'date':
        case 'filingDate':
        case 'issueDate': {
            if (!mastheadDate(text))
                return { invalid: `「${text.slice(0, 60)}」은 날짜로 읽히지 않습니다` };
            if (field === 'date' && !context.fromRecord && context.itemType !== 'thesis') {
                const history = historyDateOfThePages(text, context.evidence);
                if (history)
                    return { invalid: `「${text.slice(0, 40)}」은 쪽이 원고의 이력(「${history.raw.trim().slice(0, 40)}」)으로만 찍은 날짜입니다 — 발행일이 아닙니다` };
            }
            if (field !== 'date' || !context.record)
                return null;
            const year = /^(?:19|20)\d{2}/.exec(canonicalDate(text) || text)?.[0] || '';
            const years = year ? yearsOfTheOriginal(context.record, context.evidence) : null;
            return years && years.original.has(year) && years.edition !== year
                ? { invalid: `「${text}」은 옮긴 책의 원서(다른 판)의 연도입니다(「${years.originalSaid}」)` } : null;
        }
        case 'pages': {
            if (!pagesAsARange(text))
                return { invalid: `「${text.slice(0, 60)}」은 쪽 범위나 쪽 번호가 아닙니다` };
            const at = context.fromRecord ? 0 : folioOfAnotherPage(text, context.evidence) || bareFolioOfTheOpening(text, context.evidence);
            if (at)
                return { invalid: `「${text}」은 ${at}쪽 머리·바닥에 찍힌 그 쪽의 번호입니다 — 저작의 쪽 범위가 아닙니다` };
            const days = context.fromRecord ? '' : dayRangeOfADate(text, context.evidence);
            if (days)
                return { invalid: `「${text}」은 쪽이 날짜 「${days}」로만 찍은 날의 범위입니다 — 저작의 쪽 범위가 아닙니다` };
            const registry = context.fromRecord ? null : registryRangeOverAnUnprintedOne(text, context.evidence);
            return registry ? { invalid: `「${text}」은 읽을 만한 글자층 어디에도 찍히지 않은 범위이고, 쪽에 인쇄된 DOI의 기록(${registry.provider})은 ${registry.range}를 적습니다` } : null;
        }
        case 'volume':
        case 'issue': {
            if (monthNamedIssue(text))
                return null;
            const bare = numberOnly(text) || text;
            if ((!/\d/.test(bare) && !/^[A-Za-zⅠ-Ⅻ]{1,4}$/.test(bare)) || /^0+$/.test(bare))
                return { invalid: `「${text.slice(0, 40)}」은 ${field === 'volume' ? '권' : '호'}이 아닙니다` };
            return null;
        }
        case 'publicationTitle':
        case 'proceedingsTitle':
        case 'bookTitle': {
            if (journalOfIssueStatement(text) === '')
                return { invalid: `「${text.slice(0, 60)}」은 한 호의 표시이지 실린 곳의 이름이 아닙니다` };
            const cited = citationCoordinatesOf(text);
            if (cited && !cited.name.trim())
                return { invalid: `「${text.slice(0, 60)}」은 인용 좌표이지 실린 곳의 이름이 아닙니다` };
            if (fundingStatement(text, context.evidence))
                return { invalid: `「${text.slice(0, 60)}」은 연구비 진술(Funded by·지원기관 …)이지 실린 곳의 이름이 아닙니다` };
            if (field === 'publicationTitle' && serialInsteadOf(text, context.evidence, numberOnly(String(context.record?.fields?.volume ?? ''))))
                return { invalid: `「${text.slice(0, 60)}」은 이 글이 실린 학술지가 아닙니다 — 쪽 머리·꼬리의 한 호의 줄이 다른 학술지 이름을 찍습니다`, as: 'publisher' };
            if (field === 'publicationTitle' && isAnInstitutionNotASerial(text))
                return { invalid: `「${text.slice(0, 60)}」은 기관 이름이지 학술지 이름이 아닙니다`, as: 'publisher' };
            if (!context.fromRecord && CONTAINER_SLOT_TYPES.has(String(context.itemType ?? ''))) {
                const publisher = publisherInTheContainerSlot(text, context.evidence);
                if (publisher)
                    return { invalid: `「${text.slice(0, 60)}」은 펴낸 곳의 이름이지 실린 곳이 아닙니다 — ${publisher.why}`, ...(publisher.linkedSame ? {} : { as: 'publisher' }) };
                const wordmark = wordmarkInTheContainerSlot(text, context.evidence, { volume: context.record?.fields?.volume, pages: context.record?.fields?.pages });
                if (wordmark)
                    return { invalid: `「${text.slice(0, 60)}」은 실린 곳이 아닙니다 — ${wordmark.why}` };
                const body = bodyOfAnInitialism(text, context.evidence, true);
                if (body)
                    return { invalid: `「${text.slice(0, 60)}」은 ${body.said}의 두문자입니다 — 실린 곳의 이름이 아닙니다` };
            }
            if (presentationStatement(text)) {
                const event = String(context.itemType ?? '') === 'conferencePaper' ? eventOfAPresentationStatement(text) : '';
                return { invalid: `「${text.slice(0, 60)}」은 이 글을 발표한 자리를 말한 문장이지 실린 곳의 이름이 아닙니다`, ...(event ? { as: 'conferenceName', asValue: event } : {}) };
            }
            if (field === 'publicationTitle') {
                const note = statedOnlyInTheTitleNote(text, context.evidence, context.record?.fields?.title);
                if (note)
                    return { invalid: `「${text.slice(0, 60)}」은 ${note.page}쪽이 제목의 각주(${note.mark})에만 찍은 진술입니다 — 학술지 이름이 아닙니다` };
            }
            return null;
        }
        case 'language':
            return LANGUAGE_CODE.test(text.toLowerCase()) ? null : { invalid: `「${text.slice(0, 20)}」은 언어 코드가 아닙니다` };
        case 'edition': {
            const printed = context.fromRecord ? editionThePagePrintsInsteadOf(text, context.evidence) : null;
            return printed ? { invalid: `기록의 판 「${text.slice(0, 40)}」은 쪽이 찍은 판(${printed.page}쪽 「${printed.raw.slice(0, 40)}」)이 아닙니다`, unkept: true } : null;
        }
        case 'university':
            return !universityName(text) && UNIT_ONLY.test(text) ? { invalid: `「${text}」은 학교가 아니라 학교 안의 단위입니다` } : null;
        case 'conferenceName':
        case 'meetingName': {
            const why = notANameBecause(text);
            return why ? { invalid: `「${text.slice(0, 60)}」은 모임의 이름이 아닙니다 — ${why}` } : null;
        }
        case 'publisher':
            if (publisherNameIn(imprintName(text), (context.creators || []) as any[], { stated: name => publisherTheDocumentStates(name, context.evidence) }) === null)
                return { invalid: `「${text.slice(0, 60)}」은 펴낸 곳의 이름이 아닙니다` };
            return context.record && attributedToTheOriginal(text, context.evidence, context.record)
                ? { invalid: `「${text.slice(0, 60)}」은 원판(원서)의 펴낸 곳입니다 — 이 판의 펴낸 곳이 아닙니다` } : null;
        case 'institution':
            if (sponsorOnly(text, context.evidence))
                return { invalid: `문서는 「${text.slice(0, 60)}」을 연구비 기관(전담기관·지원기관·Funded by …)으로 찍습니다 — 기관 칸의 후보가 아닙니다` };
            return coverInstitutionInsteadOf(text, context.evidence)?.as === 'addressee'
                ? { invalid: `문서는 「${text.slice(0, 60)}」을 받는 곳(귀하)·과제를 맡긴 곳으로만 찍고, 표지는 기관 「${coverInstitutionOf(context.evidence)}」을 찍습니다 — 기관 칸의 후보가 아닙니다` } : null;
        default: return null;
    }
}
export function movedStatement(field: string, value: unknown, context: StatementContext = {}): string {
    const text = repairText(String(value ?? '')).normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!text)
        return '';
    const name = field === 'publisher'
        ? publisherNameIn(imprintName(text), (context.creators || []) as any[], { stated: candidate => publisherTheDocumentStates(candidate, context.evidence) }) ?? ''
        : NAME_FIELDS.includes(field) ? imprintName(text)
            : text.replace(/^[\s,;:·|/–—-]+|[\s,;:·|/–—-]+$/gu, '');
    return name && !statementOf(field, name, context) ? name : '';
}
const INID_LINE = /^\(\s*(\d{2})\s*\)\s*(\S.{0,200})$/;
function inidCodeStating(value: string, pages: string): string {
    const key = foldedLetters(value);
    if (key.length < 2)
        return '';
    for (const line of linesOf(pages)) {
        const at = INID_LINE.exec(line);
        if (at && foldedLetters(at[2]) === key)
            return at[1];
    }
    return '';
}
function publicationOfACreator(person: any): {
    tail: PublicationTail;
    written: string;
} | null {
    const last = String(person?.lastName ?? person?.name ?? '').trim(), first = String(person?.firstName ?? '').trim();
    const single = person?.fieldMode === 1 || !first;
    for (const written of single ? [last] : [`${first} ${last}`, `${last} ${first}`]) {
        const tail = publicationStatementOf(written);
        if (tail)
            return { tail, written };
    }
    return null;
}
export function personStatement(person: any): boolean {
    const last = nameWithoutNoteMarks(repairText(String(person?.lastName ?? person?.name ?? '').trim()));
    const first = nameWithoutNoteMarks(repairText(String(person?.firstName ?? '').trim()));
    const whole = `${last} ${first}`.trim();
    if (!last || NOT_A_PERSON.test(whole) || NOT_A_PERSON.test(last) || publicationOfACreator(person))
        return false;
    return !/https?:|www\.|@/.test(whole) && whole.length <= 80;
}
export function guessesOfAReading(sources: Record<string, any> | null | undefined, hasCreators: boolean): string[] {
    const formPage = String(sources?.title?.from || '') === 'labelledField';
    const personGuess = (from: string) => from === 'layout' || (formPage && !['label', 'roleLabel'].includes(from));
    const guessed = new Set(Object.entries(sources || {}).filter(([, source]) => /^unlabelled/i.test(String((source as any)?.from || ''))).map(([field]) => field));
    if (hasCreators && personGuess(String(sources?.creators?.from || '')))
        guessed.add('creators');
    return [...guessed];
}
function registryDOIsOf(evidence: EvidenceBundle | undefined, records: ContractContext['registryRecords'], title: unknown): string[] {
    const out: string[] = [];
    for (const stated of linkedStatementsOf(evidence, 'DOI'))
        out.push(stated.value);
    const identity = evidence?.identity;
    if (identity?.kind === 'DOI' && identity.value && identity.corroboration === 'printedInDocument' && identity.scope === 'work')
        out.push(String(identity.value));
    const key = foldedLetters(title);
    if (key.length >= 6)
        for (const record of records || []) {
            const doi = String((record as any)?.identifiers?.DOI || (record as any)?.fields?.DOI || '').trim();
            if (doi && foldedLetters((record as any)?.title) === key)
                out.push(doi);
        }
    return out.filter(Boolean);
}
function setType(record: {
    itemType: string;
    itemTypeID: any;
}, type: string) {
    record.itemType = type;
    try {
        record.itemTypeID = Zotero.ItemTypes.getID(type);
    }
    catch { }
}
function lettersAndGaps(value: string): {
    letters: string;
    gaps: string[];
} {
    let letters = '';
    const gaps: string[] = [];
    let gap = '';
    for (const char of String(value ?? '').normalize('NFKC')) {
        if (/[\p{L}\p{N}]/u.test(char)) {
            const lower = char.toLowerCase();
            gaps.push(gap);
            gap = '';
            letters += lower.length === 1 && char.length === 1 ? lower : char.length === 1 ? char : '�';
        }
        else
            gap += char;
    }
    gaps.push(gap);
    return { letters, gaps };
}
function printedLineSpans(evidence: EvidenceBundle | undefined, readableOnly: boolean): string[] {
    const out: string[] = [];
    for (const page of pagesRead(evidence)) {
        if (readableOnly && !page.readable)
            continue;
        const lines = page.lines.filter(line => line.length <= STRUCTURE_LINE_CHARS).slice(0, 400);
        for (let at = 0; at < lines.length; at++) {
            out.push(lines[at]);
            if (at + 1 < lines.length)
                out.push(`${lines[at]}\n${lines[at + 1]}`);
            if (at + 2 < lines.length)
                out.push(`${lines[at]}\n${lines[at + 1]}\n${lines[at + 2]}`);
        }
    }
    return out;
}
const STRUCTURE_LINE_CHARS = 400;
const SPACING_TRIES = 8;
function printedSpacing(value: unknown, evidence: EvidenceBundle | undefined): string | null {
    const held = String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!held || held.length > 300 || !/[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(held))
        return null;
    const mine = lettersAndGaps(held);
    const size = mine.letters.length;
    if (size < 2)
        return null;
    const flat = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (printedLineSpans(evidence, false).some(line => flat(line).includes(held)))
        return null;
    const spaceGaps = mine.gaps.slice(1, size).filter(gap => /^\s+$/.test(gap)).length;
    const chars = [...held.normalize('NFKC')].filter(char => /[\p{L}\p{N}]/u.test(char));
    const forms = new Set<string>();
    for (const line of printedLineSpans(evidence, true)) {
        const page = lettersAndGaps(line);
        let tries = 0;
        for (let from = page.letters.indexOf(mine.letters); from >= 0 && tries++ < SPACING_TRIES; from = page.letters.indexOf(mine.letters, from + 1)) {
            const end = from + size;
            if (from > 0 && !page.gaps[from])
                continue;
            if (end < page.letters.length && !page.gaps[end])
                continue;
            let kept = 0, fits = true, form = '';
            for (let at = 0; at < size; at++) {
                if (at > 0) {
                    const theirs = page.gaps[from + at], ours = mine.gaps[at];
                    if (/\s/.test(theirs) && !ours) {
                        fits = false;
                        break;
                    }
                    if (/\S/.test(ours))
                        form += ours;
                    else if (theirs) {
                        form += /\s/.test(theirs) ? ' ' : theirs;
                        if (/\s/.test(theirs))
                            kept++;
                    }
                }
                form += chars[at] ?? '';
            }
            if (!fits || (spaceGaps >= 2 && kept === 0))
                continue;
            const whole = `${mine.gaps[0].trim()}${form}${mine.gaps[size].trim()}`.replace(/\s+/g, ' ').trim();
            if (whole !== held)
                forms.add(whole);
        }
    }
    return forms.size === 1 ? [...forms][0] : null;
}
function withoutCatalogueRole(name: string): {
    name: string;
    role: 'author' | 'editor' | 'translator' | 'contributor' | null;
} | null {
    const start = String(name ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    let value = start;
    let role: 'author' | 'editor' | 'translator' | 'contributor' | null = null;
    let found = false;
    const withoutEndMark = (text: string) => /(?:[가-힣\p{Script=Han}]|\p{L}{2})[.,;:]+$/u.test(text) ? text.replace(/[.,;:]+$/u, '').trim() : text.replace(/[,;:]+$/u, '').trim();
    for (let step = 0; step < 3; step++) {
        value = withoutEndMark(value);
        const relator = /,\s*(\p{L}[\p{L}\s.]{1,30})$/u.exec(value);
        const word = relator ? labelWordOf(relator[1]) : null;
        if (relator && word && BYLINE_MEANINGS.includes(word.meaning)) {
            role = role ?? bylineRoleOf(word.form);
            value = value.slice(0, relator.index).trim();
            found = true;
            continue;
        }
        const tail = roleWordAt(value, 'tail', BYLINE_MEANINGS);
        if (tail && tail.rest && tail.word.meaning !== 'others') {
            role = role ?? bylineRoleOf(tail.word.form);
            value = tail.rest.trim();
            found = true;
            continue;
        }
        break;
    }
    return found && value && value !== start ? { name: value, role } : null;
}
const MR_ROMANISATION = /[ŏŭŎŬ]|(?:ch|[ktp])['’ʻ][aeiouwyŏŭ]/iu;
function revisedRomanisationOf(value: string): string {
    let text = String(value ?? '').normalize('NFC').toLowerCase();
    if (MR_ROMANISATION.test(text)) {
        text = text.replace(/ŏ/g, 'eo').replace(/ŭ/g, 'eu')
            .replace(/ch(?!['’ʻ])/g, 'j').replace(/k(?!['’ʻ])/g, 'g').replace(/t(?!['’ʻ])/g, 'd').replace(/p(?!['’ʻ])/g, 'b');
    }
    return text.normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[^a-z]+/g, '');
}
function hangulPrintedFor(value: string, evidence: EvidenceBundle | undefined): string | null {
    const key = revisedRomanisationOf(value);
    if (key.length < 3)
        return null;
    const found = new Set<string>();
    for (const page of pagesRead(evidence)) {
        if (page.kind === 'pdfText' && !page.readable)
            continue;
        for (const line of page.lines) {
            if (line.length > STRUCTURE_LINE_CHARS)
                continue;
            const words = line.split(/\s+/).map(word => word.replace(/[^가-힣]/g, '')).filter(Boolean);
            for (let at = 0; at < words.length; at++) {
                for (let span = 1; span <= 3 && at + span <= words.length; span++) {
                    const phrase = words.slice(at, at + span).join('');
                    if (romanise(phrase) === key)
                        found.add(words.slice(at, at + span).join(' '));
                }
            }
        }
    }
    return found.size === 1 ? [...found][0] : null;
}
function serialOfTheRunningLines(evidence: EvidenceBundle | undefined, volume: string): string {
    if (!evidence)
        return '';
    for (const line of runningTexts(pageStructureOf(evidence), ['masthead', 'runningHead', 'runningFoot'])) {
        const found = serialOfAVolumeLine(line);
        if (found && (!volume || found.volume === volume))
            return found.name;
    }
    return '';
}
const CITATION_LINE_LABEL = /^(?:(?:please[^\S\n]+)?cite[^\S\n]+this(?:[^\S\n]+\p{L}+)?[^\S\n]+as\b[^\S\n]*[:：]?|(?:please[^\S\n]+|to[^\S\n]+|how[^\S\n]+to[^\S\n]+)?cite\b[^:：\n]{0,40}[:：]|(?:recommended[^\S\n]+)?citation[^\S\n]*[:：]|(?:published|appear(?:s|ed)?|to[^\S\n]+appear)[^\S\n]+in[^\S\n]*[:：]|(?:source|in)[^\S\n]*[:：])[^\S\n]*/iu;
function serialOfACitationLine(line: unknown): {
    name: string;
    volume: string;
    first: string;
} | null {
    const text = String(line ?? '').normalize('NFKC');
    if (!text.trim() || text.length > 600)
        return null;
    for (const cell of text.split(/\s{3,}|\s*\|\s*/)) {
        const whole = cell.trim().replace(CITATION_LINE_LABEL, '');
        if (!whole)
            continue;
        for (const candidate of [whole, whole.replace(/^\d{1,5}\s+/, ''), whole.replace(/\s+\d{1,5}$/, '')]) {
            const cited = citationCoordinatesOf(candidate);
            if (!cited || !cited.year || !cited.volume || !cited.pages)
                continue;
            const name = cited.name.trim();
            if (name.length > 80 || /[\d/,]|(?<![\p{L}])et\s+al(?![\p{L}])/iu.test(name) || (name.match(/\p{L}/gu) || []).length < 3)
                continue;
            return { name, volume: cited.volume, first: /\d{1,7}/.exec(cited.pages)?.[0] || '' };
        }
    }
    return null;
}
function serialInsteadOf(held: string, evidence: EvidenceBundle | undefined, volume: string): string {
    const value = held.replace(/\s+/g, ' ').trim();
    if (!value || serialNameShaped(value))
        return '';
    const name = serialOfTheRunningLines(evidence, volume);
    if (!name || foldedLetters(name) === foldedLetters(value))
        return '';
    const running = foldedLetters(runningTexts(pageStructureOf(evidence), ['masthead', 'runningHead', 'runningFoot']).join('\n'));
    return running.includes(foldedLetters(value)) ? '' : name;
}
const LEGAL_FORM_MARK = /(?<![\p{L}\p{N}])(?:Ltd|LTD|Limited|Inc|INC|Incorporated|LLC|PLC|plc|GmbH|GMBH|KGaA|AG|B\.\s?V|BV|N\.\s?V|S\.\s?A|Pty|Corp|Corporation)\.?(?![\p{L}\p{N}])/u;
const LEGAL_FORM_WORD = /(?<![\p{L}\p{N}])(?:ltd|limited|inc|incorporated|llc|plc|b ?v|n ?v|gmbh|ag|kg|kgaa|s ?a|pty|co|corp|corporation)(?![\p{L}\p{N}])/giu;
function nameBodies(value: unknown): string[] {
    const text = String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 200)
        return [];
    const body = (name: string) => foldedLetters(name.replace(/\./g, ' ').replace(/\s+/g, ' ').replace(LEGAL_FORM_WORD, ' '));
    const bracketed = [...text.matchAll(/\(([^()]{1,60})\)/g)].map(match => body(match[1]));
    return [...new Set([body(text.replace(/\([^()]*\)/g, ' ')), ...bracketed])].filter(entry => entry.length >= 2);
}
function sameEditionRecords(evidence: EvidenceBundle | undefined) {
    return (evidence?.links || []).filter(link => link?.relation === 'sameEdition' && !/^google/i.test(String(link.provider || '')));
}
const PUBLISHER_STATED_ROLES = new Set(['rightsHolder', 'publisherHouse', 'issuer']);
function serialsOfTheCitationLines(evidence: EvidenceBundle | undefined): string[] {
    return [...new Set(citationLinesOfTheOpening(evidence).map(entry => entry.name))];
}
function citationLinesOfTheOpening(evidence: EvidenceBundle | undefined): Array<{
    page: number;
    raw: string;
    name: string;
    volume: string;
    first: string;
}> {
    if (!evidence)
        return [];
    const structure = pageStructureOf(evidence);
    const flagged = brokenLayerPages(evidence);
    const out: Array<{
        page: number;
        raw: string;
        name: string;
        volume: string;
        first: string;
    }> = [];
    for (const observation of evidence.observations || []) {
        if (observation.kind !== 'pdfText' || !/^page \d+/.test(String(observation.locator || '')))
            continue;
        const page = pageNumberOf(observation);
        if (page < 1 || page > 2 || flagged.has(page) || ['insertedLeaf', 'contents', 'references'].includes(roleOf(structure, page)))
            continue;
        const text = String(observation.text || '');
        let cut: Array<[
            number,
            number
        ]> | null = null;
        let offset = 0;
        for (const line of text.split('\n')) {
            const start = offset;
            offset += line.length + 1;
            const found = line.length <= 300 ? serialOfACitationLine(line) : null;
            if (!found)
                continue;
            cut ??= regionSpansIn(text, ['references', 'citation', 'otherWorks']);
            if (cut.some(([from, to]) => start < to && start + line.length > from))
                continue;
            out.push({ page, raw: line.trim(), ...found });
        }
    }
    return out;
}
function citedAsTheSerial(name: string, evidence: EvidenceBundle | undefined): boolean {
    const text = name.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!evidence || text.length < 2 || text.length > 80)
        return false;
    const pattern = new RegExp(String.raw `(?<![\p{L}\p{N}])${escapeForPattern(text).replace(/ /g, String.raw `\s+`)}\.?,?[^\S\n]+(?:(?:1[5-9]|20)\d{2}[^\S\n]*[;,][^\S\n]*)?\d{1,4}[^\S\n]*(?:\([^\S\n]*\d{1,4}[^\S\n]*\)[^\S\n]*)?[:,][^\S\n]*[A-Za-z]?\d`, 'giu');
    const structure = pageStructureOf(evidence);
    const flagged = brokenLayerPages(evidence);
    for (const observation of evidence.observations || []) {
        if (observation.kind !== 'pdfText' || !/^page \d+/.test(String(observation.locator || '')))
            continue;
        const page = pageNumberOf(observation);
        if (page < 1 || page > 2 || flagged.has(page) || ['insertedLeaf', 'contents', 'references'].includes(roleOf(structure, page)))
            continue;
        const body = String(observation.text || '').normalize('NFKC');
        let cut: Array<[
            number,
            number
        ]> | null = null;
        for (const match of body.matchAll(pattern)) {
            const at = match.index ?? 0;
            cut ??= regionSpansIn(body, ['references', 'citation', 'otherWorks']);
            if (!cut.some(([from, to]) => at >= from && at < to))
                return true;
        }
    }
    return false;
}
export function publisherInTheContainerSlot(value: unknown, evidence: EvidenceBundle | undefined, publishers: unknown[] = []): {
    why: string;
    linkedSame: boolean;
} | null {
    const text = String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const bodies = nameBodies(text);
    if (!bodies.length || serialNameShaped(text) || isAnInstitutionNotASerial(text))
        return null;
    const same = (other: unknown) => nameBodies(other).some(body => bodies.includes(body));
    const records = sameEditionRecords(evidence);
    if (records.some(link => CONTAINER_FIELDS.some(field => same(link.stated?.[field]?.value))))
        return null;
    if (records.some(link => CONTAINER_FIELDS.some(field => abbreviatesTheSerial(text, link.stated?.[field]?.value))))
        return null;
    const linked = [...records.map(link => link.stated?.publisher?.value), ...publishers].map(name => String(name ?? '').replace(/\s+/g, ' ').trim()).find(name => !!name && same(name)) || '';
    let stated = '';
    if (!linked && evidence) {
        for (const statement of statementsOf(evidence).statements) {
            if (statement.scope === 'originalEdition' || statement.scope === 'otherWork')
                continue;
            if (!statement.because.some(reason => reason.signal === 'label' || reason.signal === 'grammar'))
                continue;
            const name = (statement.names || []).find(entry => !!entry.role && PUBLISHER_STATED_ROLES.has(entry.role) && (same(entry.text) || same(entry.printed)));
            if (name) {
                stated = `${statement.page}쪽이 ${name.role === 'rightsHolder' ? '권리자' : '펴낸 곳'}로 찍은 「${(name.printed || name.text).slice(0, 60)}」`;
                break;
            }
        }
        if (!stated) {
            const page = rightsLineNaming(text, evidence);
            if (page)
                stated = `${page}쪽 권리 줄이 권리자로 찍은 「${text.slice(0, 60)}」`;
        }
    }
    const host = !linked && !stated ? hostOfALinkedRecord(records, same) : '';
    const legal = !linked && !stated && !host && !SERIAL_WORD.test(text) ? LEGAL_FORM_MARK.exec(text)?.[0] || '' : '';
    if (!linked && !stated && !host && !legal)
        return null;
    if (serialsOfTheCitationLines(evidence).some(name => same(name)) || citedAsTheSerial(text, evidence))
        return null;
    return { why: linked ? `이 문서에 연결된 같은 판본 기록이 적은 펴낸 곳 「${linked.slice(0, 60)}」과 같은 이름입니다`
            : stated ? `${stated}과 같은 이름입니다` : host ? `이 문서에 연결된 같은 판본 기록의 자리 「${host}」가 그 이름의 누리집입니다`
                : `회사의 법인 꼴 「${legal}」이 붙은 이름입니다`, linkedSame: !!linked };
}
function hostOfALinkedRecord(records: ReturnType<typeof sameEditionRecords>, same: (other: unknown) => boolean): string {
    if (!records.some(link => CONTAINER_FIELDS.some(field => String(link.stated?.[field]?.value ?? '').trim())))
        return '';
    for (const link of records) {
        for (const address of [link.stated?.url?.value, link.url]) {
            const host = /^https?:\/\/([^/?#\s]{1,200})/i.exec(String(address ?? ''))?.[1]?.toLowerCase() || '';
            const labels = host.split('.').filter(Boolean);
            if (labels.length < 2 || /(?:^|\.)(?:doi\.org|dx\.doi\.org|handle\.net)$/.test(host))
                continue;
            const secondLevel = labels.length >= 3 && /^(?:co|ac|or|go|ne|re|com|org|edu|gov)$/.test(labels[labels.length - 2]) && labels[labels.length - 1].length === 2;
            const name = labels[labels.length - (secondLevel ? 3 : 2)];
            if (name && name.length >= 3 && same(name))
                return host;
        }
    }
    return '';
}
const RIGHTS_HOLDER_END = String.raw `(?=[^\S\n]*(?:\n|$|[.,;:)]|(?:Ltd|Limited|Inc|LLC|PLC|plc|GmbH|KGaA|AG|B\.?\s?V|N\.?\s?V|S\.?\s?A|Pty|Corp|Corporation|Co)\.?(?![\p{L}\p{N}])|all[^\S\n]+rights|(?:1[5-9]|20)\d{2}))`;
const FEE_CODE = String.raw `(?<![\p{L}\p{N}])(\d[\dX‐-]{6,16}[\dX])(?:[^\S\n]*\/[^\S\n]*\d{2,4}(?:[^\S\n]*\/)?)?[^\n$]{0,12}?\$[^\S\n]*\d{1,3}(?:[.,]\d{1,3})?`;
export function feeCodeLineOnThePages(evidence: EvidenceBundle | undefined): {
    page: number;
    kind: 'isbn' | 'issn';
    number: string;
} | null {
    if (!evidence)
        return null;
    const pattern = new RegExp(FEE_CODE, 'gu');
    const structure = pageStructureOf(evidence);
    for (const observation of evidence.observations || []) {
        if (observation.kind !== 'pdfText' || !/^page \d+/.test(String(observation.locator || '')))
            continue;
        const page = pageNumberOf(observation);
        if (page < 1 || page > 2 || ['insertedLeaf', 'references'].includes(roleOf(structure, page)))
            continue;
        const body = String(observation.text || '').normalize('NFKC').slice(0, 100000);
        let cut: Array<[
            number,
            number
        ]> | null = null;
        for (const match of body.matchAll(pattern)) {
            const at = match.index ?? 0;
            cut ??= regionSpansIn(body, ['references', 'citation', 'otherWorks']);
            if (cut.some(([from, to]) => at >= from && at < to))
                continue;
            const digits = match[1].replace(/‐/g, '-');
            for (let length = digits.length; length >= 8; length--) {
                const number = digits.slice(0, length);
                if (!/[\dX]$/.test(number))
                    continue;
                if (validISSN(number) && /^\d{4}-?\d{3}[\dX]$/.test(number))
                    return { page, kind: 'issn', number };
                if (validISBN(number))
                    return { page, kind: 'isbn', number };
            }
        }
    }
    return null;
}
function rightsLineNaming(name: string, evidence: EvidenceBundle | undefined): number {
    if (!evidence || name.length < 2 || name.length > 80)
        return 0;
    const pattern = new RegExp(String.raw `(?:©|ⓒ|\(c\)|(?<![\p{L}])copyright(?![\p{L}])|${FEE_CODE}(?:[^\S\n]*(?:©|ⓒ|\(c\)))?)(?:[^\S\n]*(?:©|\(c\)))?[^\S\n]*(?:(?:1[5-9]|20)\d{2}(?:[^\S\n]*[-–,][^\S\n]*(?:1[5-9]|20)\d{2})*[^\S\n]*,?[^\S\n]*)?(?:by[^\S\n]+)?(?:the[^\S\n]+)?${escapeForPattern(name).replace(/ /g, String.raw `\s+`)}(?![\p{L}\p{N}])${RIGHTS_HOLDER_END}`, 'giu');
    const structure = pageStructureOf(evidence);
    const flagged = brokenLayerPages(evidence);
    for (const observation of evidence.observations || []) {
        if (observation.kind !== 'pdfText' || !/^page \d+/.test(String(observation.locator || '')))
            continue;
        const page = pageNumberOf(observation);
        if (page < 1 || page > 2 || flagged.has(page) || ['insertedLeaf', 'references'].includes(roleOf(structure, page)))
            continue;
        const body = String(observation.text || '').normalize('NFKC');
        let cut: Array<[
            number,
            number
        ]> | null = null;
        for (const match of body.matchAll(pattern)) {
            const at = match.index ?? 0;
            cut ??= regionSpansIn(body, ['references', 'citation', 'otherWorks']);
            if (!cut.some(([from, to]) => at >= from && at < to))
                return page;
        }
    }
    return 0;
}
const JOURNAL_WORD = /(?<![\p{L}])(?:journal|transactions|letters|review|reviews|magazine|bulletin|annals|quarterly|series|forum)(?![\p{L}])/iu;
function containerInsteadOfThePublisher(held: string, evidence: EvidenceBundle | undefined): {
    name: string;
    slot: string;
    from: string;
} | null {
    const publisher = new Set(nameBodies(held));
    const fine = (name: string) => !!name && !nameBodies(name).some(body => publisher.has(body));
    const records = sameEditionRecords(evidence);
    const statedIn = (slot: string, name: string) => records.some(link => foldedLetters(link.stated?.[slot]?.value) === foldedLetters(name));
    for (const link of records) {
        for (const field of CONTAINER_FIELDS) {
            const name = String(link.stated?.[field]?.value ?? '').replace(/\s+/g, ' ').trim();
            if (!fine(name))
                continue;
            const slot = statedIn('proceedingsTitle', name) || (EVENT_WORD.test(name) && !JOURNAL_WORD.test(name)) ? 'proceedingsTitle'
                : statedIn('bookTitle', name) ? 'bookTitle' : 'publicationTitle';
            return { name, slot, from: `연결된 같은 판본 기록(${link.provider})이 적은 실린 곳` };
        }
    }
    const printed = serialsOfTheCitationLines(evidence).find(fine);
    return printed ? { name: printed, slot: 'publicationTitle', from: '쪽의 인용줄이 찍은 실린 곳' } : null;
}
const PRESENTATION_STATEMENT = /^(?:(?:an?|the|this)\s+)?(?:(?:paper|talk|lecture|address|contribution|communication)\s+)?(?:(?:to\s+be|was|is|being|been|as)\s+)?(?:presented|read|delivered|given)\s+(?:at|before|to)\s/iu;
function presentationStatement(value: string): boolean {
    const text = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
    return text.length <= 400 && PRESENTATION_STATEMENT.test(text);
}
const EVENT_DATE_PART = new RegExp(String.raw `^(?:${CITED_MONTH_WORD}\.?\s+\d{1,2}(?:\s*[-–]\s*\d{1,2})?(?:\s*,?\s*(?:1[5-9]|20)\d{2})?|\d{1,2}(?:\s*[-–]\s*\d{1,2})?\s+${CITED_MONTH_WORD}\.?(?:\s+(?:1[5-9]|20)\d{2})?|(?:1[5-9]|20)\d{2})$`, 'iu');
const EVENT_PLACE_PART = /^\p{Lu}[\p{L}'’-]*\.?(?:\s+\p{Lu}[\p{L}'’-]*\.?){0,2}$/u;
function eventOfAPresentationStatement(value: string): string {
    const text = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const head = text.length <= 400 ? PRESENTATION_STATEMENT.exec(text) : null;
    if (!head)
        return '';
    const parts = text.slice(head[0].length).replace(/^the\s+/i, '').replace(/[\s.;:]+$/, '').split(/\s*,\s*/);
    while (parts.length > 1) {
        const last = parts[parts.length - 1];
        if (EVENT_WORD.test(last) || !(EVENT_DATE_PART.test(last) || EVENT_PLACE_PART.test(last)))
            break;
        parts.pop();
    }
    const name = parts.join(', ').trim();
    return EVENT_WORD.test(name) ? name : '';
}
const BODY_WORD = /(?<![\p{L}])(?:institute|institution|society|association|academy|union|council|federation|corporation|company|laborator(?:y|ies)|university|college|agency|organi[sz]ation|foundation|commission|committee|bureau|ministry|department|incorporated|limited|inc|ltd|llc|gmbh|plc)(?![\p{L}])/iu;
const bodyShaped = (name: string) => BODY_WORD.test(name.slice(0, 200).split(/\s+(?:of|for)\s+/i)[0]);
const INITIALISM_CONNECTIVE = /^(?:of|and|&|the|for|in|on|de|des|du|la|le|für|und|et)$/i;
const initialsOf = (name: string) => name.normalize('NFKC').split(/[\s,;:()/-]+/).filter(word => word && !INITIALISM_CONNECTIVE.test(word))
    .map(word => word[0].toUpperCase()).join('');
const SERIAL_HEAD_OF_A_BODY = /^(?:the\s+)?(?:journal|transactions|proceedings|bulletin|annals|record|reports?|review|quarterly|letters|magazine|memoirs)\s+of\s+(?:the\s+)?(\S.{2,190})$/iu;
function initialismLetters(value: string): string {
    const text = value.normalize('NFKC').trim();
    return text.length <= 24 && /^(?:\p{Lu}[.\s]*){2,6}$/u.test(text) ? text.replace(/[^\p{Lu}]/gu, '') : '';
}
function initialismSpelledOnThePages(letters: string, evidence: EvidenceBundle | undefined): {
    name: string;
    said: string;
} | false | null {
    if (!letters || !evidence)
        return null;
    for (const page of frontPages(evidence)) {
        for (const line of linesOf(page.text)) {
            if (line.length > 400)
                continue;
            const words = line.normalize('NFKC').split(/[\s,;:()]+/).filter(Boolean);
            for (let start = 0; start < words.length; start++) {
                const head = words[start];
                if (head[0] !== letters[0])
                    continue;
                if (head.length >= letters.length + 4 && head.startsWith(letters) && /^\p{Lu}\p{Ll}{2}/u.test(head.slice(letters.length))) {
                    const name = head.replace(/[.,;:]+$/, '');
                    return { name, said: `${page.page}쪽이 찍은 단체 「${name.slice(0, 60)}」` };
                }
                let at = 0, end = -1;
                for (let index = start; index < words.length && at < letters.length; index++) {
                    if (index > start && INITIALISM_CONNECTIVE.test(words[index]))
                        continue;
                    if (words[index][0] !== letters[at])
                        break;
                    at++;
                    end = index;
                }
                if (at < letters.length || end <= start)
                    continue;
                const name = words.slice(start, end + 1).join(' ');
                if (serialNameShaped(name) || EVENT_WORD.test(name) || JOURNAL_WORD.test(name))
                    return false;
                if (bodyShaped(name))
                    return { name, said: `${page.page}쪽이 찍은 단체 「${name.slice(0, 60)}」` };
            }
        }
    }
    return null;
}
function bodyOfAnInitialism(value: string, evidence: EvidenceBundle | undefined, coordinates: boolean): {
    name: string;
    said: string;
    glued?: boolean;
} | null {
    const text = value.normalize('NFKC').trim();
    const letters = initialismLetters(text);
    if (!evidence)
        return null;
    if (!letters) {
        const glued = /^(\p{Lu}{2,6})\p{Lu}\p{Ll}{3,}$/u.exec(text);
        const site = glued && !coordinates ? siteOfTheLetters(glued[1], evidence) : null;
        return site ? { ...site, glued: true } : null;
    }
    const own = nameBodies(text);
    let named = '';
    for (const link of sameEditionRecords(evidence)) {
        for (const field of CONTAINER_FIELDS) {
            const stated = String(link.stated?.[field]?.value ?? '').replace(/\s+/g, ' ').trim();
            if (stated && (nameBodies(stated).some(body => own.includes(body)) || initialsOf(stated) === letters))
                return null;
            const body = SERIAL_HEAD_OF_A_BODY.exec(stated)?.[1] || '';
            if (!named && body && initialsOf(body) === letters && bodyShaped(body) && !EVENT_WORD.test(body))
                named = body;
        }
    }
    if (named)
        return { name: named, said: `연결된 같은 판본 기록의 실린 곳이 담은 단체 「${named.slice(0, 60)}」` };
    const spelled = initialismSpelledOnThePages(letters, evidence);
    if (spelled)
        return spelled;
    if (spelled === false || coordinates)
        return null;
    return siteOfTheLetters(letters, evidence);
}
function siteOfTheLetters(letters: string, evidence: EvidenceBundle): {
    name: string;
    said: string;
} | null {
    for (const page of frontPages(evidence)) {
        for (const match of page.text.slice(0, 20000).matchAll(/(?<![\p{L}\p{N}@.\/])(?:https?:\/\/)?www\d{0,2}\.([a-z0-9-]{2,40})\.[a-z]{2,6}(?:\.[a-z]{2})?(?![\p{L}\p{N}])/giu)) {
            if (match[1].toLowerCase() === letters.toLowerCase())
                return { name: match[0], said: `${page.page}쪽이 찍은 누리집 주소 「${match[0]}」` };
        }
    }
    return null;
}
function wordmarkInTheContainerSlot(value: string, evidence: EvidenceBundle | undefined, own: {
    volume?: unknown;
    pages?: unknown;
} = {}): {
    why: string;
    name: string;
    fromPage: boolean;
} | null {
    const text = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!evidence || !text || text.length > 40 || text.split(' ').length > 3 || /\d/.test(text) || !/^[\p{Script=Latin}\s.&'’-]+$/u.test(text)
        || serialNameShaped(text) || SERIAL_WORD.test(text) || EVENT_WORD.test(text) || isAnInstitutionNotASerial(text))
        return null;
    const bodies = nameBodies(text);
    const key = foldedLetters(text);
    if (!bodies.length || key.length < 3)
        return null;
    const lines = citationLinesOfTheOpening(evidence);
    if (!lines.length)
        return null;
    let stated = false;
    for (const link of sameEditionRecords(evidence)) {
        const name = CONTAINER_FIELDS.map(field => String(link.stated?.[field]?.value ?? '').replace(/\s+/g, ' ').trim()).find(Boolean) || '';
        if (name)
            stated = true;
        if (!name || nameBodies(name).some(body => bodies.includes(body)) || foldedLetters(name).includes(key) || abbreviatesTheSerial(text, name))
            continue;
        const volume = numberOnly(String(link.stated?.volume?.value ?? ''));
        const first = /\d{1,7}/.exec(pagesAsARange(link.stated?.pages?.value))?.[0] || '';
        if (!volume || !first)
            continue;
        const line = lines.find(entry => entry.volume === volume && entry.first === first && !foldedLetters(entry.raw).includes(key));
        if (line) {
            return { name, fromPage: false, why: `${line.page}쪽의 인용줄 「${line.raw.slice(0, 60)}」이 찍은 ${volume}권 ${first}쪽은 연결된 같은 판본 기록(${link.provider})의 「${name.slice(0, 60)}」입니다 — 그 줄에 없는 「${text}」은 학술지 머리의 표장입니다` };
        }
    }
    if (stated)
        return null;
    const volume = numberOnly(String(own.volume ?? ''));
    const first = /\d{1,7}/.exec(pagesAsARange(own.pages))?.[0] || '';
    if (!volume || !first)
        return null;
    for (const line of lines) {
        if (line.volume !== volume || line.first !== first || foldedLetters(line.raw).includes(key))
            continue;
        const lineKey = foldedLetters(line.name);
        const readable = serialNameShaped(line.name) || line.name.split(/\s+/).every(word => /^\p{Lu}[\p{L}'’-]*[.:]?$/u.test(word) || INITIALISM_CONNECTIVE.test(word));
        if (!lineKey || !readable || nameBodies(line.name).some(body => bodies.includes(body)) || sharesAWord(text, line.name)
            || editDistance(key, lineKey) <= Math.max(2, Math.floor(Math.min(key.length, lineKey.length) * 0.3))
            || abbreviatesTheSerial(line.name, text) || abbreviatesTheSerial(text, line.name) || abbreviatesWordwise(line.name, text) || abbreviatesWordwise(text, line.name))
            continue;
        return { name: line.name, fromPage: true,
            why: `${line.page}쪽의 인용줄 「${line.raw.slice(0, 60)}」이 이 판독의 ${volume}권 ${first}쪽을 찍은 실린 곳은 「${line.name.slice(0, 60)}」입니다 — 그 줄에 없는 「${text}」은 학술지 머리의 표장입니다` };
    }
    return null;
}
function sharesAWord(a: string, b: string): boolean {
    const split = (value: string) => value.slice(0, 120).normalize('NFKC').split(/[\s.,:;&()/~-]+/).filter(word => word && !INITIALISM_CONNECTIVE.test(word)).map(word => foldedLetters(word));
    const left = split(a).filter(word => word.length >= 3), right = split(b).filter(word => word.length >= 2);
    const within = (short: string, long: string) => { let from = 0; for (const char of short) {
        from = long.indexOf(char, from) + 1;
        if (!from)
            return false;
    } return true; };
    return left.some(word => right.some(token => token[0] === word[0] && (within(token, word) || within(word, token))));
}
function containerOfASameEditionRecord(held: string, evidence: EvidenceBundle | undefined): {
    name: string;
    provider: string;
} | null {
    const own = new Set(nameBodies(held));
    for (const link of sameEditionRecords(evidence)) {
        for (const field of CONTAINER_FIELDS) {
            const name = String(link.stated?.[field]?.value ?? '').replace(/\s+/g, ' ').trim();
            if (!name || nameBodies(name).some(body => own.has(body)) || presentationStatement(name) || initialismSpelledOnThePages(initialismLetters(name), evidence))
                continue;
            return { name, provider: String(link.provider || '') };
        }
    }
    return null;
}
const CONTAINER_DESCRIPTOR_TAIL = /,\s*(?:an?|the)\s+(?:[\p{L}-]{1,30}\s+){0,5}(?:journal|publication|periodical)(?:\s+of\s+[^,]{1,80})?\s*$/iu;
function publisherAfterTheContainer(value: string, evidence: EvidenceBundle | undefined, publisher: unknown): {
    name: string;
    tail: string;
} | null {
    const cut = value.lastIndexOf(',');
    if (cut < 2 || value.length > 200)
        return null;
    const tail = value.slice(cut + 1).trim(), name = value.slice(0, cut).replace(/[\s,;:]+$/, '').trim();
    const bodies = nameBodies(tail);
    if (!bodies.length || name.length < 2 || /\d/.test(tail))
        return null;
    const same = (other: unknown) => nameBodies(other).some(body => bodies.includes(body));
    if ([publisher, ...sameEditionRecords(evidence).map(link => link.stated?.publisher?.value)].some(same))
        return { name, tail };
    if (!evidence)
        return null;
    for (const statement of statementsOf(evidence).statements) {
        if (statement.scope === 'originalEdition' || statement.scope === 'otherWork')
            continue;
        if ((statement.names || []).some(entry => !!entry.role && PUBLISHER_STATED_ROLES.has(entry.role) && (same(entry.text) || same(entry.printed))))
            return { name, tail };
    }
    return null;
}
const CONTAINER_LEADING_ARTICLE = /^(?:the|le|la|les|l['’]|der|die|das|el|il)\s+/iu;
const CONTAINER_TRAILING_DESCRIPTOR = /\s*(?:\(\s*)?(?:proceedings|online|print|electronic)(?:\s*\))?$/iu;
const containerCore = (name: string) => foldedLetters(name.normalize('NFKC').replace(/\s+/g, ' ').trim().replace(CONTAINER_LEADING_ARTICLE, '').replace(CONTAINER_TRAILING_DESCRIPTOR, ''));
function recordFormOfTheContainer(value: string, evidence: EvidenceBundle | undefined): {
    name: string;
    provider: string;
} | null {
    const core = containerCore(value);
    if (core.length < 6)
        return null;
    for (const link of sameEditionRecords(evidence)) {
        for (const field of CONTAINER_FIELDS) {
            const name = String(link.stated?.[field]?.value ?? '').replace(/\s+/g, ' ').trim();
            if (name && foldedLetters(name) !== foldedLetters(value) && containerCore(name) === core)
                return { name, provider: String(link.provider || '') };
        }
    }
    return null;
}
function abbreviatesWordwise(short: string, full: string): boolean {
    const tokens = short.normalize('NFKC').split(/[\s.]+/).filter(Boolean);
    const words = full.normalize('NFKC').split(/[\s,:;()/-]+/).filter(word => word && !INITIALISM_CONNECTIVE.test(word));
    if (tokens.length < 2 || tokens.length !== words.length || tokens.length > 14)
        return false;
    let shortened = false;
    for (let at = 0; at < tokens.length; at++) {
        const token = foldedLetters(tokens[at]), word = foldedLetters(words[at]);
        if (!token || !word || token[0] !== word[0] || token.length > word.length)
            return false;
        let from = 0;
        for (const char of token) {
            from = word.indexOf(char, from) + 1;
            if (!from)
                return false;
        }
        if (token.length < word.length)
            shortened = true;
    }
    return shortened;
}
function fullNameOfAnAbbreviation(value: string, evidence: EvidenceBundle | undefined): {
    name: string;
    from: string;
} | null {
    const text = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!evidence || text.length < 3 || text.length > 120)
        return null;
    const pages = frontPages(evidence).map(page => page.text).join('\n');
    for (const link of sameEditionRecords(evidence)) {
        for (const field of CONTAINER_FIELDS) {
            const name = String(link.stated?.[field]?.value ?? '').replace(/\s+/g, ' ').trim();
            const initialism = /^\p{Lu}{3,6}$/u.test(text) && initialsOf(name) === text;
            if (name && (abbreviatesWordwise(text, name) || initialism))
                return { name: serialNameCased(name, pages), from: `연결된 같은 판본 기록(${link.provider})이 적은` };
        }
    }
    for (const page of readableLayerPages(evidence).filter(entry => entry.page <= 2)) {
        let cut: Array<[
            number,
            number
        ]> | null = null;
        let offset = 0;
        for (const line of page.text.split('\n')) {
            const start = offset;
            offset += line.length + 1;
            const name = line.normalize('NFKC').replace(/\s+/g, ' ').trim();
            if (!name || name.length > 120 || !serialNameShaped(name) || !abbreviatesWordwise(text, name))
                continue;
            cut ??= regionSpansIn(page.text, ['references', 'citation', 'otherWorks']);
            if (cut.some(([from, to]) => start < to && start + line.length > from))
                continue;
            return { name: serialNameCased(name, pages), from: `${page.page}쪽이 찍은` };
        }
    }
    return null;
}
function abbreviationFits(short: string, full: string): boolean {
    const raw = short.normalize('NFKC').split(/[\s.,:;()&/-]+/).filter(token => !!foldedLetters(token));
    const tokens = raw.map(token => foldedLetters(token));
    const words = full.normalize('NFKC').split(/[\s,:;()/-]+/).filter(word => word && !INITIALISM_CONNECTIVE.test(word)).map(word => foldedLetters(word)).filter(Boolean);
    if (!tokens.length || !words.length || tokens.length > 20 || words.length > 30)
        return true;
    if (tokens.length === 1 && initialsOf(full).toLowerCase() === tokens[0])
        return true;
    const within = (token: string, word: string) => { let from = 0; for (const char of token) {
        from = word.indexOf(char, from) + 1;
        if (!from)
            return false;
    } return true; };
    let at = 0, mapped = 0;
    tokens.forEach((token, place) => {
        const initials = /^\p{Lu}{2,6}$/u.test(raw[place]) ? token : '';
        for (let index = at; index < words.length; index++) {
            if (initials && words.slice(index, index + initials.length).map(word => word[0]).join('') === initials) {
                mapped++;
                at = index + initials.length;
                return;
            }
            if (words[index][0] === token[0] && within(token, words[index])) {
                mapped++;
                at = index + 1;
                return;
            }
        }
    });
    return mapped * 3 >= tokens.length * 2;
}
function abbreviationOfAnotherName(value: string, evidence: EvidenceBundle | undefined, own = ''): {
    container: string;
    replacement: string;
} | null {
    const text = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const latin = (name: string) => /\p{Script=Latin}/u.test(name) && !/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}\p{Script=Greek}]/u.test(name);
    if (!evidence || !text || text.length > 120 || !latin(text))
        return null;
    const held = own.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (held && latin(held) && (foldedLetters(held) === foldedLetters(text) || abbreviationFits(text, held)))
        return null;
    for (const link of sameEditionRecords(evidence)) {
        const container = CONTAINER_FIELDS.map(field => String(link.stated?.[field]?.value ?? '').replace(/\s+/g, ' ').trim()).find(Boolean) || '';
        if (!container || !latin(container))
            continue;
        const stated = String(link.stated?.journalAbbreviation?.value ?? '').replace(/\s+/g, ' ').trim();
        if ([container, stated].some(name => !!name && foldedLetters(name) === foldedLetters(text)) || abbreviationFits(text, container))
            return null;
        const sameContainer = !held || foldedLetters(held) === foldedLetters(container);
        return { container, replacement: sameContainer && stated && abbreviationFits(stated, container) ? stated : '' };
    }
    return null;
}
function anotherEditionsNumbers(fields: Record<string, any>, evidence: EvidenceBundle | undefined): {
    fields: Record<string, string>;
    provider: string;
} | null {
    const held = doiIn(String(fields.DOI ?? ''));
    const suffix = held.toLowerCase().replace(/^10\.\d{4,9}\//, '');
    if (!evidence || !held || suffix.length < 3)
        return null;
    const text = (evidence.observations || []).filter(o => o.kind === 'pdfText' || o.kind === 'ocrText').map(o => String(o.text || '')).join('\n')
        .slice(0, 100000).normalize('NFKC').toLowerCase();
    const packed = text.replace(/\s+/g, '');
    if (packed.includes(suffix))
        return null;
    const linked = sameEditionRecords(evidence).filter(link => !!doiIn(String(link.stated?.DOI?.value ?? '')));
    const dois = [...new Set(linked.map(link => doiIn(String(link.stated?.DOI?.value)).toLowerCase()))];
    if (dois.length !== 1 || sameDOI(dois[0], held))
        return null;
    const link = linked[0];
    const recordDOI = doiIn(String(link.stated?.DOI?.value)).toLowerCase().replace(/^10\.\d{4,9}\//, '');
    const first = /\d{1,7}/.exec(pagesAsARange(link.stated?.pages?.value))?.[0] || '';
    const volume = numberOnly(String(link.stated?.volume?.value ?? ''));
    const confirmed = (recordDOI.length >= 3 && packed.includes(recordDOI)) || (!!first && !!bareFolioOfTheOpening(first, evidence))
        || (!!first && !!volume && citationLinesOfTheOpening(evidence).some(entry => entry.volume === volume && entry.first === first));
    if (!confirmed)
        return null;
    const out: Record<string, string> = { DOI: doiIn(String(link.stated?.DOI?.value)) };
    const issn = String(link.stated?.ISSN?.value ?? '').trim();
    const statedISSNs = issn.split(/[\s,;]+/).map(token => validISSN(token)).filter(Boolean);
    const heldTokens = String(fields.ISSN ?? '').split(/[\s,;]+/).filter(token => !!validISSN(token));
    if (statedISSNs.length && heldTokens.length && !heldTokens.some(token => statedISSNs.includes(validISSN(token)))
        && !heldTokens.some(token => packed.includes(token.replace(/-/g, '').toLowerCase()) || packed.includes(token.toLowerCase())))
        out.ISSN = issn;
    for (const field of ['volume', 'issue']) {
        const stated = String(link.stated?.[field]?.value ?? '').trim(), mine = String(fields[field] ?? '').trim();
        if (!stated || !mine || mine.length > 12 || (numberOnly(mine) || mine.toLowerCase()) === (numberOnly(stated) || stated.toLowerCase()))
            continue;
        const printed = new RegExp(String.raw `(?:vol(?:ume)?|no|number|issue|iss)\.?\s*0*${escapeForPattern(mine.toLowerCase())}(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])제?\s*0*${escapeForPattern(mine.toLowerCase())}\s*[권호]`, 'u');
        if (!printed.test(text))
            out[field] = stated;
    }
    return { fields: out, provider: String(link.provider || '') };
}
function recordIssueOverAnUnprintedOne(fields: Record<string, any>, evidence: EvidenceBundle | undefined): {
    issue: string;
    provider: string;
} | null {
    const issue = String(fields.issue ?? '').trim(), volume = numberOnly(String(fields.volume ?? ''));
    const first = /\d{1,7}/.exec(pagesAsARange(fields.pages))?.[0] || '';
    if (!evidence || !issue || issue.length > 12 || !volume || !first)
        return null;
    const lines = citationLinesOfTheOpening(evidence).filter(entry => entry.volume === volume && entry.first === first);
    if (!lines.length || lines.some(entry => !!citationCoordinatesOf(entry.raw)?.issue))
        return null;
    const text = readableLayerPages(evidence).map(page => page.text).join('\n').normalize('NFKC').slice(0, 200000);
    const mark = escapeForPattern(issue);
    const printed = new RegExp(String.raw `(?<![\p{N}])0*${volume}\s*\(\s*0*${mark}\s*\)|(?:no|number|issue|iss|heft)\.?\s*0*${mark}(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])제?\s*0*${mark}\s*호`, 'iu');
    if (!text || printed.test(text))
        return null;
    const own = doisOfTheDocument(evidence, fields.title);
    for (const link of sameEditionRecords(evidence)) {
        const doi = doiIn(String(link.stated?.DOI?.value ?? ''));
        if (!doi || !own.some(entry => sameDOI(entry, doi)))
            continue;
        const stated = String(link.stated?.issue?.value ?? '').trim();
        if (stated && (numberOnly(stated) || stated.toLowerCase()) !== (numberOnly(issue) || issue.toLowerCase()))
            return { issue: stated, provider: String(link.provider || '') };
    }
    return null;
}
const FUNDING_WORDS = new RegExp(String.raw `(?<![\p{L}])(?:${SPONSOR_LEAD_SOURCE})(?![\p{L}])|(?:${SPONSOR_LABEL_SOURCE})`, 'iu');
function fundingStatement(value: string, evidence: EvidenceBundle | undefined): boolean {
    const text = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
    return !!text && text.length <= 200 && (FUNDING_WORDS.test(text) || sponsorOnly(text, evidence));
}
const PLACE_NAME = /^\p{Lu}[\p{L}'’.\-]*(?: \p{Lu}[\p{L}'’.\-]*){0,2}$/u;
const HOUSE_WORD = /(?<![\p{L}])(?:publish(?:ing|ers?)|press|company|corporation|verlag|shoten|society|association|institute|university|inc|ltd|llc|gmbh|corp)(?![\p{L}])/iu;
const PLACE_SEPARATOR = /\s*[•·‧∙|/]\s*/u;
function placesAfterAName(value: string, pages = ''): {
    name: string;
    places: string[];
} | null {
    const text = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
    const cut = text.lastIndexOf(',');
    if (text.length > 300 || cut < 2)
        return null;
    const places = text.slice(cut + 1).trim().split(PLACE_SEPARATOR).map(part => part.trim()).filter(Boolean);
    if (!places.length || !places.every(place => PLACE_NAME.test(place) && !isOrganisationName(place.replace(/\s+/g, '')) && !isOrganisationOnly(place) && !LEGAL_FORM_TAIL.test(place)))
        return null;
    const name = text.slice(0, cut).replace(/[\s,;:]+$/, '').trim();
    if (name.length < 2)
        return null;
    if (places.length === 1) {
        const organisation = isOrganisationName(name.replace(/\s+/g, '')) || isOrganisationOnly(name) || HOUSE_WORD.test(name);
        const flat = foldedLetters(String(pages ?? '').split(text).join(' '));
        if (!organisation || !flat.includes(foldedLetters(places[0])))
            return null;
    }
    return { name, places };
}
function cityOfAnAddress(value: string, pages: string): string {
    const parts = value.normalize('NFKC').split(/\s*,\s*/).map(part => part.trim()).filter(Boolean);
    if (parts.length !== 2 || !parts.every(part => PLACE_NAME.test(part)))
        return '';
    const address = new RegExp(`(?<![\\p{L}\\p{N}])\\d{4,6}\\s+${escapeForPattern(parts[0])}\\s*,\\s*${escapeForPattern(parts[1])}(?![\\p{L}])`, 'iu');
    return linesOf(pages).some(line => line.length <= STRUCTURE_LINE_CHARS && address.test(line.normalize('NFKC'))) ? parts[0] : '';
}
function attributedToTheOriginal(name: string, evidence: EvidenceBundle | undefined, record: MetadataSnapshot): boolean {
    if (!evidence || !name.trim())
        return false;
    const stated = statementsOf(evidence);
    if (statedAs(stated, name).has('originalPublisher'))
        return true;
    return attributionOf(stated, 'publisher', name, judgedReadingOf(record))?.scope === 'originalEdition';
}
export function nameFieldsAsNames(record: MetadataSnapshot): MetadataSnapshot {
    const fields: Record<string, any> = { ...(record.fields || {}) };
    let changed = false;
    for (const field of NAME_FIELDS) {
        const value = String(fields[field] ?? '');
        if (!value.trim())
            continue;
        const name = imprintName(value);
        if (name !== value) {
            fields[field] = name;
            changed = true;
        }
    }
    return changed ? { ...record, fields } : record;
}
function titleOfTheIdentifierRecord(title: string, context: ContractContext, pages: string): string | null {
    const identity = context.evidence?.identity;
    if (!identity || identity.kind !== 'DOI' || identity.corroboration !== 'printedInDocument' || !identity.value)
        return null;
    const record = (context.registryRecords || []).find(entry => {
        const doi = String(entry.identifiers?.DOI ?? entry.fields?.DOI ?? '');
        return !!doi && sameDOI(doi, identity.value);
    });
    const own = withoutInlineMarkup(String(record?.title ?? record?.fields?.title ?? '')).replace(/\s+/g, ' ').trim();
    const key = foldedLetters(own);
    if (key.length < 3 || foldedLetters(title) === key)
        return null;
    for (const cut of title.matchAll(/\s*[:：]\s*|\s+[-–—]\s+/gu)) {
        const at = cut.index ?? -1;
        if (at <= 0 || foldedLetters(title.slice(0, at)) !== key)
            continue;
        const tail = foldedLetters(title.slice(at + cut[0].length));
        if (!tail || linesOf(pages).some(line => foldedLetters(line) === key + tail))
            return null;
        return title.slice(0, at).trim();
    }
    return null;
}
function journalOfThePrintedIdentifier(fields: Record<string, any>, evidence: EvidenceBundle | undefined, pages: string): {
    name: string;
    volume: string;
    issue: string;
} | null {
    const held = String(fields.DOI ?? '').trim();
    if (!held || !evidence)
        return null;
    for (const link of evidence.links || []) {
        if (link?.relation !== 'sameEdition' || !/^identifier\b/i.test(String(link.rule || '')))
            continue;
        const doi = String(link.stated?.DOI?.value ?? '');
        const name = String(link.stated?.publicationTitle?.value ?? '').replace(/\s+/g, ' ').trim();
        const volume = numberOnly(String(link.stated?.volume?.value ?? '')), issue = numberOnly(String(link.stated?.issue?.value ?? ''));
        if (!doi || !sameDOI(doi, held) || !name || (!volume && !issue) || isAnInstitutionNotASerial(name))
            continue;
        const key = foldedLetters(name);
        if (key.length >= 6 && foldedLetters(pages).includes(key))
            return { name, volume, issue };
    }
    return null;
}
let koreanSpellings: Set<string> | null = null;
function koreanSurnameSpelling(word: string): boolean {
    koreanSpellings ??= new Set(Object.values(SURNAME_SPELLINGS).flat());
    return koreanSpellings.has(String(word ?? '').toLowerCase().replace(/[^a-z]/g, ''));
}
function hasASuffix(person: any): boolean {
    return [person?.lastName, person?.firstName].some(part => /(?:^|[\s,])(?:jr|sr|ii|iii|iv)\.?$/i.test(String(part ?? '').trim()));
}
function hasAParticle(person: any): boolean {
    const words = `${String(person?.firstName ?? '')} ${String(person?.lastName ?? '')}`.trim().split(/\s+/);
    return words.some((word, at) => at >= 1 && NAME_JOINERS.particle.test(word));
}
const WELDED_KEY = '(?:[a-z]|\\d{1,2}|[*†‡§¶#])(?:\\s?[,，]\\s?(?:[a-z]|\\d{1,2}|[*†‡§¶#]))*';
function eitherWayRound(words: string[]): boolean {
    return words.length >= 2 && (words.every(word => isPinyinSyllable(word)) || koreanSurnameSpelling(words[0]));
}
function spacedPinyinName(first: string, last: string): boolean {
    const given = first.split(' '), family = last.split(' ');
    return given.length === 1 && family.length === 2 && [...given, ...family].every(word => /^[A-Z][a-zü]+$/.test(word) && isPinyinSyllable(word));
}
function boundaryAsThePagePrints(creators: unknown, evidence: EvidenceBundle | undefined): {
    people: any[];
    changed: string[];
} | null {
    const read = Array.isArray(creators) ? creators as any[] : [];
    if (!read.length || !evidence)
        return null;
    const latin = (value: unknown) => /^[\p{Script=Latin}\s.'’\-‐]+$/u.test(String(value ?? '').trim());
    let text: string | null = null;
    const pageText = () => text ??= (evidence.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind) && pageNumberOf(o) >= 1 && pageNumberOf(o) <= 5)
        .map(o => String(o.text || '').normalize('NFKC').replace(/\s+/g, ' ')).join('\n');
    const printings = (value: string) => [...pageText().matchAll(new RegExp(`(?<![\\p{L}\\p{N}])(${escapeForPattern(value)})(?:${WELDED_KEY})?(?![\\p{L}])`, 'giu'))].map(found => found[1]);
    const printedAs = (value: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeForPattern(value)}(?![\\p{L}])`, 'iu').test(pageText());
    const capitalisedAhead = (printed: string) => { const words = printed.split(' '); return /\p{Ll}/u.test(printed) && words.slice(0, -1).some(word => /^\p{Lu}{2,}$/u.test(word)); };
    const titleCased = (printed: string) => printed.split(' ').every(word => /^\p{Lu}\p{Ll}+$/u.test(word));
    const givenFirstByline = (self: any) => read.some(other => other !== self && other?.fieldMode !== 1 && latin(other?.lastName) && latin(other?.firstName)
        && String(other?.lastName ?? '').trim().split(/\s+/).length === 1 && String(other?.firstName ?? '').trim() !== ''
        && !eitherWayRound(`${String(other.firstName)} ${String(other.lastName)}`.trim().split(/\s+/))
        && printings(`${String(other.firstName).replace(/\s+/g, ' ').trim()} ${String(other.lastName).trim()}`).some(printed => !capitalisedAhead(printed)));
    let everyPage: string | null = null;
    const wholeText = () => everyPage ??= (evidence.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind))
        .map(o => String(o.text || '').normalize('NFKC').replace(/\s+/g, ' ')).join('\n');
    const familyStated = (family: string, given: string) => new RegExp(`(?<![\\p{L}])(?:\\p{Lu}\\.\\s?-?\\s?)+${escapeForPattern(family)}(?:\\s+et\\s+al\\b|\\s?,)`
        + `|(?<![\\p{L}])(?<!${escapeForPattern(given)}\\s)${escapeForPattern(family)},\\s?\\p{Lu}\\.`, 'u').test(wholeText());
    const changed: string[] = [];
    const people = read.map(person => {
        const last = String(person?.lastName ?? '').replace(/\s+/g, ' ').trim(), first = String(person?.firstName ?? '').replace(/\s+/g, ' ').trim();
        if (person?.fieldMode === 1 || !last || !first || !latin(last) || !latin(first) || hasAParticle(person) || hasASuffix(person) || /,/.test(first) || last.length + first.length > 120)
            return person;
        const words = `${first} ${last}`.split(' ');
        if (words.length < 3 || last.split(' ').length < 2)
            return person;
        if (ROMANISED_COMPOUND_SURNAMES.has(last.replace(/\s+/g, '').toLowerCase()))
            return person;
        const printed = printings(`${first} ${last}`).filter(found => !capitalisedAhead(found));
        if (!printed.length || printedAs(`${last}, ${first}`) || familyStated(last, first))
            return person;
        const parts = personParts(`${first} ${last}`);
        if (!parts || parts.fieldMode !== 0)
            return person;
        const familyWords = parts.lastName.split(/\s+/).length;
        const pinyinShaped = words.every(word => isPinyinSyllable(word));
        const lastName = words.slice(words.length - familyWords).join(' '), firstName = words.slice(0, words.length - familyWords).join(' ');
        const orderShown = () => (givenFirstByline(person) || familyStated(lastName, firstName)) && !familyStated(words[0], words.slice(1).join(' '));
        const accepted = pinyinShaped ? spacedPinyinName(first, last) && printed.some(titleCased) && givenFirstByline(person)
            : koreanSurnameSpelling(parts.lastName) && (!eitherWayRound(words) || orderShown());
        if (familyWords !== 1 || !accepted)
            return person;
        if (!firstName || (lastName === last && firstName === first))
            return person;
        changed.push(`「${last}|${first}」→「${lastName}|${firstName}」`);
        return { ...person, lastName, firstName, fieldMode: 0 };
    });
    return changed.length ? { people, changed } : null;
}
function boundaryFromTheLinkedRecord(creators: unknown, context: ContractContext): {
    people: any[];
    provider: string;
    changed: string[];
} | null {
    const read = Array.isArray(creators) ? creators as any[] : [];
    if (!read.length || !context.registryRecords?.length)
        return null;
    const links = (context.evidence?.links || []).filter(link => link?.relation === 'sameEdition' && !/^google/i.test(String(link.provider || '')));
    if (!links.length)
        return null;
    const latin = (value: unknown) => /^[\p{Script=Latin}\s.'’\-‐]+$/u.test(String(value ?? '').trim());
    for (const link of links) {
        const doi = String(link.stated?.DOI?.value ?? ''), title = foldedLetters(link.stated?.title?.value);
        const record = context.registryRecords.find(entry => {
            const own = String(entry.identifiers?.DOI ?? entry.fields?.DOI ?? '');
            return (doi && own && sameDOI(doi, own)) || (title.length >= 6 && foldedLetters(entry.title ?? entry.fields?.title) === title);
        }) as {
            creators?: unknown[];
        } | undefined;
        const stated = (Array.isArray(record?.creators) ? record!.creators : []).filter((person: any) => String(person?.lastName ?? '').trim() && String(person?.firstName ?? '').trim()) as any[];
        if (!stated.length)
            continue;
        const changed: string[] = [];
        const people = read.map(person => {
            if (person?.fieldMode === 1 || !latin(person?.lastName) || !latin(person?.firstName ?? ''))
                return person;
            if (!hasAParticle(person) && !hasASuffix(person))
                return person;
            const same = stated.filter(other => nameRelation(person, other).relation === 'identical');
            if (same.length !== 1)
                return person;
            const other = suffixOnTheGivenSide(same[0]);
            const last = String(other.lastName).trim(), first = String(other.firstName).trim();
            if (foldedLetters(last) === foldedLetters(person.lastName) && foldedLetters(first) === foldedLetters(person.firstName))
                return person;
            changed.push(`「${String(person.lastName)}|${String(person.firstName ?? '')}」→「${last}|${first}」`);
            return { ...person, lastName: last, firstName: first, fieldMode: 0 };
        });
        if (changed.length)
            return { people, provider: String(link.provider || ''), changed };
    }
    return null;
}
function restAfterFoldedLetters(line: string, count: number): string {
    let seen = 0;
    for (let at = 0; at < line.length; at++) {
        if (seen >= count)
            return line.slice(at);
        seen += foldedLetters(line[at]).length;
    }
    return '';
}
function authorOrUnknownRole(person: any): boolean {
    if (person?.creatorType)
        return person.creatorType === 'author';
    if (person?.creatorTypeID === undefined)
        return true;
    try {
        const name = (globalThis as any).Zotero?.CreatorTypes?.getName?.(person.creatorTypeID);
        return !name || name === 'author';
    }
    catch {
        return true;
    }
}
function titleShapedRow(value: string): boolean {
    const text = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (text.length < 2 || text.length > 120 || !/\p{L}{2}/u.test(text))
        return false;
    if (opensWithVolume(text) || isNotATitle(text) || isDateOnly(text) || isOrganisationName(text) || isPublishingHouse(text) || rowIsByline(text, 'strict'))
        return false;
    return !editionIn(text) && !roleWordAt(text, 'tail', BYLINE_MEANINGS) && !roleWordAt(text, 'lead', BYLINE_MEANINGS);
}
export function titleAboveItsVolumeLine(title: unknown, evidence: EvidenceBundle | undefined): {
    title: string;
    page: number;
} | null {
    const held = String(title ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!held || held.length > 300 || !opensWithVolume(held))
        return null;
    const key = foldedLetters(held);
    if (key.length < 4)
        return null;
    const body = documentBodyScript(evidence);
    const inBody = (value: string) => {
        const letters = (value.match(/\p{L}/gu) || []).length;
        if (!body)
            return letters > 0;
        const hangul = (value.match(/[가-힣]/g) || []).length;
        return body === 'hangul' ? hangul * 2 >= letters : hangul === 0;
    };
    for (const page of pagesRead(evidence)) {
        if (page.kind === 'pdfText' && !page.readable)
            continue;
        const lines = page.lines.map(line => line.trim()).filter(Boolean);
        for (let at = 1; at < lines.length; at++) {
            if (lines[at].length > 400 || foldedLetters(lines[at]) !== key)
                continue;
            const above = lines[at - 1].replace(/\s+/g, ' ');
            if (foldedLetters(above) !== key && titleShapedRow(above) && inBody(above))
                return { title: above, page: page.page };
        }
    }
    return null;
}
export function volumeLineBelowTheTitle(title: unknown, evidence: EvidenceBundle | undefined): {
    number: string;
    page: number;
} | null {
    const key = foldedLetters(title);
    if (key.length < 2 || String(title ?? '').length > 300)
        return null;
    const found = new Map<string, number>();
    for (const page of pagesRead(evidence)) {
        if (page.kind === 'pdfText' && !page.readable)
            continue;
        const lines = page.lines.map(line => line.trim()).filter(Boolean);
        for (let at = 0; at + 1 < lines.length; at++) {
            if (lines[at].length > 300 || lines[at + 1].length > 400 || foldedLetters(lines[at]) !== key || !opensWithVolume(lines[at + 1]))
                continue;
            const designator = volumeDesignator(lines[at + 1]);
            if (!designator || designator.script !== 'cjk' || designator.issue || !(Number(designator.number) >= 1))
                continue;
            if (!found.has(designator.number))
                found.set(designator.number, page.page);
        }
    }
    if (found.size !== 1)
        return null;
    const [[number, page]] = [...found];
    return { number, page };
}
function colophonLayerPages(evidence: EvidenceBundle | undefined): Array<{
    page: number;
    lines: string[];
    text: string;
}> {
    if (!evidence)
        return [];
    const seated = new Set(statementsOf(evidence).statements
        .filter(entry => entry.reading === 'layer' && entry.scope === 'thisEdition' && (entry.seat === 'colophon' || entry.seat === 'colophonPage')).map(entry => entry.page));
    if (!seated.size)
        return [];
    return pagesRead(evidence).filter(page => page.kind === 'pdfText' && page.readable && seated.has(page.page))
        .map(page => ({ page: page.page, lines: page.lines.map(line => line.trim()).filter(Boolean), text: page.lines.join('\n') }));
}
const CATALOGUE_PUNCTUATION = /[/:;|—–]|\s-\s|\.\s|\.$|^\.|^[Il|]\s/u;
export function subtitleOnTheColophon(title: unknown, evidence: EvidenceBundle | undefined): {
    subtitle: string;
    title: string;
    page: number;
    line: string;
} | null {
    const held = String(title ?? '').replace(/\s+/g, ' ').trim();
    const key = foldedLetters(held);
    if (key.length < 3 || held.length > 200 || /[:：]/.test(held))
        return null;
    for (const page of colophonLayerPages(evidence)) {
        for (const line of page.lines) {
            if (line.length > 160 || /[©Ⓒ]|\(c\)|copyright/i.test(line))
                continue;
            const folded = foldedLetters(line);
            if (folded.length < key.length + 3 || !folded.startsWith(key))
                continue;
            const tail = restAfterFoldedLetters(line, key.length);
            const rest = tail.trim();
            if (!rest || !/^\s/u.test(tail) || CATALOGUE_PUNCTUATION.test(rest) || roleWordAt(rest, 'lead', BYLINE_MEANINGS) || roleWordAt(rest, 'tail', BYLINE_MEANINGS))
                continue;
            const joined = titleWithStatedSubtitle(held, rest, page.text);
            if (joined === held)
                continue;
            return { subtitle: joined.slice(held.length).replace(/^[\s:：]+/u, '').trim(), title: joined, page: page.page, line };
        }
    }
    return null;
}
export function peopleOnTheColophon(evidence: EvidenceBundle | undefined): Array<{
    lastName: string;
    firstName: string;
    fieldMode: number;
    creatorType: string;
}> {
    if (!evidence || !colophonLayerPages(evidence).length)
        return [];
    const out: Array<{
        lastName: string;
        firstName: string;
        fieldMode: number;
        creatorType: string;
    }> = [];
    const seen = new Set<string>();
    for (const statement of statementsOf(evidence).statements) {
        if (statement.kind !== 'responsibility' || statement.scope !== 'thisEdition' || statement.reading !== 'layer')
            continue;
        if (statement.seat !== 'colophon' && statement.seat !== 'colophonPage')
            continue;
        if (!statement.because.some(reason => reason.signal === 'label') || /^\s*\d{1,3}\s*\.\s/.test(statement.raw))
            continue;
        for (const name of statement.names || []) {
            const role = name.role === 'editor' || name.role === 'translator' ? name.role : name.role === 'author' ? 'author' : '';
            const text = String(name.text || '').replace(/\s+/g, ' ').trim();
            if (!role || !text || name.shape === 'organisation' || isOrganisationName(text) || seen.has(foldedLetters(text)))
                continue;
            seen.add(foldedLetters(text));
            const parts = name.script === 'latin' ? personParts(text) : null;
            out.push(parts ? { lastName: parts.lastName, firstName: parts.firstName, fieldMode: parts.fieldMode, creatorType: role }
                : { lastName: text, firstName: '', fieldMode: 1, creatorType: role });
        }
    }
    return out;
}
const LIST_ENTRY_HEAD = /(?:^|\n)[^\S\n]*\d{1,3}[^\S\n]*\.[^\S\n]*(?=\p{L})/gu;
function listsOfWorksIn(text: string): Array<[
    number,
    number
]> {
    const spans = otherWorksSpansIn(text);
    if (spans.length)
        return spans;
    const heads = text.length <= 100000 ? [...text.matchAll(LIST_ENTRY_HEAD)].length : 0;
    return heads > 3 ? [[0, text.length]] : [];
}
export function rolesInTheListEntryOfThisWork(title: unknown, creators: unknown, evidence: EvidenceBundle | undefined): Array<{
    index: number;
    role: 'editor' | 'translator';
    entry: string;
}> {
    const key = foldedLetters(title);
    const people = Array.isArray(creators) ? creators as any[] : [];
    if (key.length < 12 || !people.length || !evidence)
        return [];
    const out: Array<{
        index: number;
        role: 'editor' | 'translator';
        entry: string;
    }> = [];
    for (const page of pagesRead(evidence)) {
        if (page.kind === 'pdfText' && !page.readable)
            continue;
        const text = page.lines.join('\n');
        for (const [start, end] of listsOfWorksIn(text)) {
            const span = text.slice(start, end);
            const heads = [...span.matchAll(LIST_ENTRY_HEAD)].map(found => ({ at: found.index ?? 0, length: found[0].length }));
            heads.forEach((head, order) => {
                const entry = span.slice(head.at + head.length, order + 1 < heads.length ? heads[order + 1].at : span.length).replace(/\s+/g, ' ').trim();
                if (entry.length > 400 || !foldedLetters(entry).startsWith(key))
                    return;
                const rest = restAfterFoldedLetters(entry, key.length).replace(/^[\s,，;:：.]+/u, '').trim();
                const stated = roleWordAt(rest, 'lead', ['editor', 'translator']);
                if (!stated)
                    return;
                const role = bylineRoleOf(stated.word.form);
                if (role !== 'editor' && role !== 'translator')
                    return;
                const names = stated.rest.split(/\s*(?:[,;，]|\band\b|&)\s*/i).map(name => name.trim()).filter(name => /\p{L}{2}/u.test(name));
                people.forEach((person, index) => {
                    if (!authorOrUnknownRole(person) || out.some(found => found.index === index))
                        return;
                    const same = (name: string) => { const parts = personParts(name); return nameRelation(person, name).relation === 'identical' || (!!parts && nameRelation(person, parts).relation === 'identical'); };
                    if (names.some(same))
                        out.push({ index, role, entry: entry.slice(0, 160) });
                });
            });
        }
    }
    return out;
}
export function printedRangeOverAPDFRelativeOne(value: unknown, evidence: EvidenceBundle | undefined): {
    range: string;
    first: number;
} | null {
    const at = /^(\d{1,5})-(\d{1,5})$/.exec(pagesAsARange(value) || '');
    if (!at || !evidence)
        return null;
    const start = Number(at[1]), end = Number(at[2]);
    if (start !== 1 || end <= start)
        return null;
    const structure = pageStructureOf(evidence);
    const run = structure.folioRun;
    const opening = structure.leadingLeaves + 1;
    if (!run || run.first > opening + 1)
        return null;
    const first = opening + run.offset;
    const extent = documentExtent(evidence);
    const count = extent - structure.leadingLeaves;
    if (first <= 1 || count < 2 || (end !== count && end !== extent))
        return null;
    return { range: `${first}-${first + count - 1}`, first };
}
export const EDITION_DESCRIPTION_FIELDS = new Set(['place', 'series', 'seriesNumber', 'seriesTitle', 'numPages', 'edition']);
export function recordContradictsTheDocument(fields: Record<string, unknown> | undefined, evidence: EvidenceBundle | undefined): string {
    if (!fields || !evidence)
        return '';
    const edition = String(fields.edition ?? '').trim();
    const printed = edition ? editionThePagePrintsInsteadOf(edition, evidence) : null;
    if (printed)
        return `기록의 판 「${edition.slice(0, 40)}」은 쪽이 찍은 판(${printed.page}쪽 「${printed.raw.slice(0, 40)}」)이 아닙니다`;
    const count = Number(/\d[\d,]*/.exec(String(fields.numPages ?? ''))?.[0]?.replace(/,/g, '') || 0);
    const extent = documentExtent(evidence);
    if (count > 0 && extent >= 30 && count * 3 < extent)
        return `기록의 쪽수 「${fields.numPages}」는 ${extent}쪽인 이 파일의 3분의 1에도 못 미칩니다 — 모음 전자책 한 건의 셈입니다`;
    return '';
}
export function placeTheDocumentStatesInsteadOf(place: unknown, evidence: EvidenceBundle | undefined): string {
    const value = foldedLetters(place);
    if (!value || !evidence?.observations?.length)
        return '';
    const stated = String(statementsOf(evidence).thisEdition.place?.place ?? '').trim();
    const key = foldedLetters(stated);
    return key.length >= 3 && !key.includes(value) && !value.includes(key) ? stated : '';
}
const ONE_ARTICLE_AT_MOST = 100;
export function rangeToTheDocumentsEnd(value: unknown, evidence: EvidenceBundle | undefined): {
    range: string;
    first: number;
    last: number;
} | null {
    const held = pagesAsARange(value) || '';
    const at = /^(\d{1,6})(?:-(\d{1,6}))?$/.exec(held);
    if (!at || !evidence)
        return null;
    const structure = pageStructureOf(evidence);
    const run = structure.folioRun;
    const extent = documentExtent(evidence);
    if (!run || !extent || extent - structure.leadingLeaves > ONE_ARTICLE_AT_MOST)
        return null;
    const opening = structure.leadingLeaves + 1;
    if (run.first > opening + 1)
        return null;
    const first = opening + run.offset;
    const lastRead = Math.max(0, ...structure.pages.map(entry => entry.page));
    if (Number(at[1]) !== first || run.last !== lastRead || extent <= run.last)
        return null;
    if (at[2] !== undefined && Number(at[2]) !== run.last + run.offset)
        return null;
    const range = new RegExp(`(?<![\\d.])${first}[^\\S\\n]{0,3}[-‐‑–—]{1,2}[^\\S\\n]{0,3}(\\d{1,6})(?!\\d)`);
    for (const page of pagesRead(evidence).filter(entry => entry.readable && entry.page >= 1 && entry.page <= 5)) {
        for (const line of page.lines) {
            if (line.length > 400)
                continue;
            const printed = Number(range.exec(line)?.[1] || 0);
            if (printed > first && printed <= extent + run.offset + 20)
                return { range: `${first}-${printed}`, first, last: printed };
        }
    }
    const last = extent + run.offset;
    return last > first ? { range: `${first}-${last}`, first, last } : null;
}
export function imprintYearOfTheOpeningFoot(evidence: EvidenceBundle | undefined): string {
    if (!evidence)
        return '';
    const statement = statementsOf(evidence).containment?.statements.find(entry => entry.seat === 'openingFoot' && entry.reading === 'layer');
    if (!statement)
        return '';
    const page = pagesRead(evidence).find(entry => entry.kind === 'pdfText' && entry.readable && entry.page === statement.page);
    if (!page)
        return '';
    const lines = page.lines.map(line => line.trim()).filter(Boolean);
    const head = foldedLetters(statement.raw).slice(0, 40);
    const at = head.length >= 8 ? lines.findIndex(line => line.length <= 400 && foldedLetters(line).includes(head)) : -1;
    if (at < 0)
        return '';
    for (const line of lines.slice(at, at + 3)) {
        if (line.length > 400)
            continue;
        const found = /,[^\S\n]*((?:1[5-9]|20)\d{2})[^\S\n]*\.?$/.exec(line);
        if (found && line.split(',').length >= 3)
            return found[1];
    }
    return '';
}
function pageTextToRead(evidence: EvidenceBundle | undefined, page: number): {
    text: string;
    kind: 'layer' | 'ocr' | '';
} {
    const observations = evidence?.observations || [];
    const layer = observations.find(o => o.kind === 'pdfText' && pageNumberOf(o) === page && /^page \d+/.test(String(o.locator || '')));
    const readable = !!layer && documentProfile(evidence).textLayer === 'readable' && !brokenLayerPages(evidence).has(page)
        && !unreadableTextLayer(String(layer.text || '').normalize('NFKC'), false) && /[\p{L}\p{N}]/u.test(String(layer.text || ''));
    if (readable)
        return { text: withAttachedAccents(String(layer!.text || '')), kind: 'layer' };
    const ocr = observations.find(o => o.kind === 'ocrText' && pageNumberOf(o) === page);
    return ocr ? { text: String(ocr.text || ''), kind: 'ocr' } : { text: '', kind: '' };
}
const NOT_A_COVER_DATE = new Set(['accessDate', 'submissionDate', ...HISTORY_DATE_ROLES]);
const ACADEMIC_YEAR_AFTER = /^\s*(?:學年度|学年度|학년도|年度|년도)/u;
const ACADEMIC_YEAR_BEFORE = /(?:academic\s+year|school\s+year)\s*$/i;
const STAMP_ROW = /https?:\/\/|www\.|\bpage\s+\d+\s+of\s+\d+\b/i;
function coverDateOf(text: string): {
    value: string;
    raw: string;
} | null {
    const rows = String(text || '').normalize('NFKC').split(/\r?\n/).filter(row => !STAMP_ROW.test(row)).join('\n');
    const own = withoutCitations(rows);
    const dates = readDates(own).filter(reading => !NOT_A_COVER_DATE.has(String(reading.role))
        && !ACADEMIC_YEAR_AFTER.test(own.slice(reading.index + reading.raw.length, reading.index + reading.raw.length + 6))
        && !ACADEMIC_YEAR_BEFORE.test(own.slice(Math.max(0, reading.index - 20), reading.index)));
    const degree = dates.find(reading => reading.role === 'degreeDate');
    if (degree)
        return { value: degree.value, raw: degree.raw };
    return dates.length && new Set(dates.map(reading => reading.value)).size === 1 ? { value: dates[0].value, raw: dates[0].raw } : null;
}
export function thesisDateOnTheCover(evidence: EvidenceBundle | undefined): {
    value: string;
    raw: string;
    page: number;
    from: 'cover' | 'spine';
} | null {
    if (!evidence)
        return null;
    const structure = pageStructureOf(evidence);
    const front = structure.pages.filter(entry => entry.role !== 'insertedLeaf' && entry.page <= 6);
    const textOf = (entry: {
        page: number;
        reading: string;
    }) => {
        const kind = entry.reading === 'ocr' ? 'ocrText' : entry.reading === 'layer' ? 'pdfText' : '';
        const found = kind ? (evidence.observations || []).find(o => o.kind === kind && pageNumberOf(o) === entry.page && (kind === 'ocrText' || /^page \d+/.test(String(o.locator || '')))) : undefined;
        return found ? (kind === 'pdfText' ? withAttachedAccents(String(found.text || '')) : String(found.text || '')) : pageTextToRead(evidence, entry.page).text;
    };
    const cover = front.find(entry => entry.form !== 'submission' && entry.form !== 'approval'
        && (entry.role === 'cover' || entry.role === 'titlePage' || !!degreeStatedIn(textOf(entry), false)));
    if (cover) {
        const dated = coverDateOf(textOf(cover));
        if (dated)
            return { ...dated, page: cover.page, from: 'cover' };
    }
    for (const entry of front) {
        const layer = (evidence.observations || []).find(o => o.kind === 'pdfText' && pageNumberOf(o) === entry.page && /^page \d+/.test(String(o.locator || '')));
        if (!layer)
            continue;
        const rows = linesOf(String(layer.text || '').normalize('NFKC')).map(line => line.replace(/\s+/g, ''));
        if (rows.length < 8 || rows.filter(row => row.length <= 2).length * 5 < rows.length * 4)
            continue;
        const joined = rows.join('');
        if (!degreeStatedIn(joined, false) && !isDegreeFormPage(rows.join('\n')))
            continue;
        const years = [...joined.matchAll(/(?<!\d)((?:19|20)\d{2})(?!\d)/g)].map(found => found[1]);
        if (new Set(years).size === 1)
            return { value: years[0], raw: years[0], page: entry.page, from: 'spine' };
    }
    return null;
}
const WIDE_PAGE = 1.2;
const SLIDE_CHARS = 1600;
const EVENT_WORD = /(?<![\p{L}])(?:conference|workshop|symposium|meeting|seminar|colloquium|congress|summit|forum|convention|school|webinar|tutorial|session|학술대회|학술발표회|발표회|세미나|워크숍|워크샵|심포지엄|포럼|콜로키움|講演会|研究会|シンポジウム)(?![\p{L}])/iu;
function yearTaggedName(token: string, next: string | undefined): string {
    const bare = token.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}']+$/u, '');
    if (!bare || bare.length > 30)
        return '';
    const capitals = (value: string) => (value.match(/\p{Lu}/gu) || []).length;
    const glued = /^(\p{L}+)[-']?((?:19|20)\d{2})$/u.exec(bare);
    if (glued && capitals(glued[1]) >= 2)
        return bare;
    const year = String(next ?? '').replace(/[,;:.]+$/, '');
    return /^\p{L}+$/u.test(bare) && capitals(bare) >= 2 && /^(?:(?:19|20)\d{2}|'\d{2})$/.test(year) ? `${bare} ${year}` : '';
}
function yearTaggedNameIn(text: string): string {
    const tokens = text.split(/\s+/).flatMap(token => token.split(/[-–—_/|·•]+(?=\p{L})/u)).filter(Boolean);
    for (let at = 0; at < tokens.length; at++) {
        const found = yearTaggedName(tokens[at], tokens[at + 1]);
        if (found)
            return found;
    }
    return '';
}
function rowsWithCells(evidence: EvidenceBundle | undefined, page: number): string[][] {
    const laid = (evidence?.observations || []).find(o => o.kind === 'pdfLayout' && String(o.locator || '') === `layout page ${page}`);
    let layout = '';
    if (laid) {
        try {
            layout = String(JSON.parse(String(laid.text || '{}'))?.layout || '');
        }
        catch {
            layout = '';
        }
    }
    const source = layout || pageTextToRead(evidence, page).text;
    return source.normalize('NFKC').split(/\r?\n/).map(row => row.trim()).filter(Boolean).slice(0, 400)
        .map(row => (layout ? row.split(/\s{3,}/) : [row]).map(cell => cell.trim()).filter(Boolean));
}
const placeShaped = (value: string) => value.length <= 60 && /^\p{Lu}[\p{L}.'’-]*(?:\s+\p{Lu}[\p{L}.'’-]*){0,3}$/u.test(value) && !EVENT_WORD.test(value);
function talkHeaderOf(cells: string[]): {
    meeting: string;
    place: string;
    date: string;
    raw: string;
} | null {
    const row = cells.join('   ');
    if (row.length > 120)
        return null;
    const dated = readDates(row).find(reading => reading.precision !== 'year' && !NOT_A_COVER_DATE.has(String(reading.role)));
    if (!dated)
        return null;
    const tagged = yearTaggedNameIn(row.split(dated.raw).join(' '));
    if (!tagged && !EVENT_WORD.test(row))
        return null;
    const pieces: string[] = [];
    for (const cell of cells) {
        for (const piece of cell.split(dated.raw).join('\n').split(/[\n,;]/)) {
            const text = piece.replace(/\s+/g, ' ').replace(/^[\s–—-]+/u, '').replace(/[\s–—:-]+$/u, '').trim();
            if (text)
                pieces.push(text);
        }
    }
    let meeting = '';
    const places: string[] = [];
    for (const piece of pieces) {
        if (!meeting && tagged && piece.startsWith(tagged)) {
            meeting = tagged;
            const tail = piece.slice(tagged.length).trim();
            if (tail && placeShaped(tail))
                places.push(tail);
            continue;
        }
        if (!meeting && (EVENT_WORD.test(piece) || (!!tagged && piece.includes(tagged)))) {
            meeting = piece;
            continue;
        }
        if (placeShaped(piece) && places.length < 2)
            places.push(piece);
    }
    return { meeting, place: places.join(', '), date: dated.value, raw: row };
}
export function talkOfASlideDeck(evidence: EvidenceBundle | undefined, creators: unknown = []): {
    meeting: string;
    place: string;
    date: string;
    statement: string;
    because: string;
} | null {
    if (!evidence)
        return null;
    const structure = pageStructureOf(evidence);
    const leaves = new Set(structure.pages.filter(entry => entry.role === 'insertedLeaf').map(entry => entry.page));
    const sized = structureInputOf(evidence).pages.filter(page => !page.inserted && !leaves.has(page.page) && !!page.size && page.size.width > 0 && page.size.height > 0);
    if (sized.length < 2)
        return null;
    const wide = (page: {
        size?: {
            width: number;
            height: number;
        };
    }) => !!page.size && page.size.width >= page.size.height * WIDE_PAGE;
    const opening = structure.pages.find(entry => !leaves.has(entry.page))?.page ?? sized[0].page;
    if (sized.filter(wide).length * 3 < sized.length * 2 || !wide(sized.find(page => page.page === opening) || sized[0]))
        return null;
    const lengths = sized.map(page => pageTextToRead(evidence, page.page).text.replace(/\s+/g, ' ').trim().length).filter(length => length > 0).sort((a, b) => a - b);
    if (!lengths.length || lengths[Math.floor((lengths.length - 1) / 2)] > SLIDE_CHARS)
        return null;
    for (const cells of rowsWithCells(evidence, opening)) {
        const header = talkHeaderOf(cells);
        if (header)
            return { meeting: header.meeting, place: header.place, date: header.date, statement: header.raw, because: `여는 쪽의 강연 머리 「${header.raw.replace(/\s+/g, ' ').slice(0, 80)}」` };
    }
    const surnames = (Array.isArray(creators) ? creators : []).map((person: any) => foldedLetters(person?.lastName ?? person?.name ?? '')).filter(name => name.length >= 3);
    for (const line of structure.running) {
        if (line.pages.length < 2)
            continue;
        const text = line.seen.map(entry => entry.text).find(Boolean) || '';
        if (yearTaggedNameIn(text) && surnames.some(name => foldedLetters(text).includes(name))) {
            return { meeting: '', place: '', date: '', statement: text, because: `쪽마다 되풀이되는 발표자·모임의 꼬리표 「${text.trim().slice(0, 60)}」` };
        }
    }
    return null;
}
const LECTURE_NOTES = /(?<![\p{L}])(?:[Ll]ecture|LECTURE|[Cc]ourse|COURSE|[Cc]lass|CLASS)\s+(?:[Nn]otes|NOTES)(?![\p{L}])|강의\s*(?:노트|록)|講義\s*(?:ノート|録)/u;
const LECTURE_NUMBER = /(?<![\p{L}])(?:[Ll]ecture|LECTURE)\s*(?:[Nn]o\.?\s*)?(?:\d{1,3}|[IVXL]{1,6})(?![\p{L}\d])|제\s*\d{1,3}\s*강(?![가-힣])|第\s*\d{1,3}\s*回\s*講義/u;
const ACADEMIC_TERM = /(?<![\p{L}])(?:Michaelmas|Lent|Easter|Hilary|Trinity|Spring|Summer|Fall|Autumn|Winter|MICHAELMAS|LENT|EASTER|HILARY|TRINITY|SPRING|SUMMER|FALL|AUTUMN|WINTER)\s+(?:Term|Semester|Quarter|TERM|SEMESTER|QUARTER)\s*,?\s*(?:19|20)\d{2}(?!\d)|(?<!\d)(?:19|20)\d{2}\s*,?\s*(?:Spring|Summer|Fall|Autumn|Winter|SPRING|SUMMER|FALL|AUTUMN|WINTER)\s+(?:Term|Semester|Quarter|TERM|SEMESTER|QUARTER)(?![\p{L}])|(?<!\d)(?:19|20)\d{2}\s*(?:학년도|년)\s*(?:[1-2]\s*학기|봄\s*학기|여름\s*학기|가을\s*학기|겨울\s*학기)/u;
export function courseStatementOf(evidence: EvidenceBundle | undefined): {
    statement: string;
    notes: string;
} | null {
    if (!evidence)
        return null;
    const structure = pageStructureOf(evidence);
    const opening = structure.pages.find(entry => entry.role !== 'insertedLeaf')?.page;
    const rows = opening === undefined ? [] : linesOf(pageTextToRead(evidence, opening).text).slice(0, 12);
    for (const line of structure.running)
        if (line.pages.length >= 2)
            rows.push(...line.seen.map(entry => entry.text).filter(Boolean).slice(0, 1));
    for (const raw of rows) {
        const row = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
        if (!row || row.length > 200)
            continue;
        const notes = LECTURE_NOTES.exec(row);
        const series = !!notes && /^\s+(?:in|IN)\s+\p{Lu}/u.test(row.slice(notes.index + notes[0].length));
        if (notes && !series)
            return { statement: row, notes: shouting(notes[0]) ? notes[0].toLowerCase().replace(/^\p{Ll}/u, letter => letter.toUpperCase()) : notes[0] };
        if (LECTURE_NUMBER.test(row) || ACADEMIC_TERM.test(row))
            return { statement: row, notes: '' };
    }
    return null;
}
function talkOrCourseNotes(typed: {
    itemType: string;
    itemTypeID: any;
}, record: MetadataSnapshot, fields: Record<string, any>, notes: Record<string, string>, evidence: EvidenceBundle | undefined, pages: string, drop: (field: string, why: string) => void): MetadataSnapshot {
    if (!evidence)
        return record;
    const type = String(typed.itemType || '');
    const coordinates = has(fields, 'volume') && (has(fields, 'issue') || /\d\s*[-–]\s*\d/.test(String(fields.pages ?? '')));
    const frontTexts = frontPages(evidence).map(page => page.text);
    const printedBook = has(fields, 'ISBN') || ownISBNs(frontTexts).length > 0;
    const traces = coordinates || has(fields, 'ISSN') || printedBook || doisOfTheDocument(evidence, fields.title).length > 0;
    const degree = !!(thesisTypeOf(fields.thesisType) || degreeStatedIn(pages, false));
    if (traces || degree)
        return record;
    let deck: ReturnType<typeof talkOfASlideDeck> | undefined;
    const talkOfTheDeck = () => (deck === undefined ? (deck = type === 'manuscript' ? null : talkOfASlideDeck(evidence, record.creators)) : deck);
    const statedByTheTalk = (field: string) => {
        const name = foldedLetters(String(fields[field] ?? ''));
        if (name.length < 2)
            return false;
        const talk = talkOfTheDeck();
        return !!talk && foldedLetters(talk.statement).includes(name);
    };
    const eligible = ['document', 'report', 'manuscript', 'presentation'].includes(type)
        || (type === 'journalArticle' && (!has(fields, 'publicationTitle') || statedByTheTalk('publicationTitle')))
        || (type === 'book' && !printedBook && (!has(fields, 'publisher') || statedByTheTalk('publisher')))
        || (type === 'thesis' && !degree)
        || (type === 'conferencePaper' && (!has(fields, 'publisher') || statedByTheTalk('publisher')))
        || (type === 'preprint' && !arXivNumberOf(fields, pages));
    if (!eligible)
        return record;
    const talk = talkOfTheDeck();
    if (talk) {
        const container = String(fields.conferenceName || fields.proceedingsTitle || fields.publicationTitle || '').replace(/\s+/g, ' ').trim();
        if (type !== 'presentation') {
            notes.itemType = `발표 자료입니다 — 화면 판(가로 판)의 쪽마다 한 진술, ${talk.because}. ${type === 'document' ? '' : `판독의 유형 ${type} 대신 `}발표(presentation)로 봅니다.`;
            setType(typed, 'presentation');
        }
        const meeting = talk.meeting || (container && foldedLetters(container) !== foldedLetters(talk.place)
            ? movedStatement('meetingName', container, { evidence, itemType: 'presentation', creators: record.creators, record: { ...record, fields } as MetadataSnapshot }) : '');
        if (meeting && !has(fields, 'meetingName')) {
            fields.meetingName = meeting;
            appendTo(notes, 'meetingName', `${talk.meeting ? '여는 쪽의 강연 머리가 찍은' : '판독이 적은'} 모임 「${meeting}」.`);
        }
        if (talk.place && !has(fields, 'place')) {
            fields.place = talk.place;
            appendTo(notes, 'place', `여는 쪽의 강연 머리가 찍은 곳 「${talk.place}」.`);
        }
        const heldDate = has(fields, 'date') ? canonicalDate(String(fields.date)) || '' : '';
        if (talk.date && (!heldDate || (talk.date.startsWith(heldDate) && talk.date.length > heldDate.length))) {
            fields.date = talk.date;
            appendTo(notes, 'date', `여는 쪽의 강연 머리가 찍은 날짜 「${talk.date}」.`);
        }
        for (const field of fieldsTheTypeDoesNotHold(fields, 'presentation'))
            drop(field, `발표 자료에는 ${field} 칸이 없습니다 — 발표자의 소속·모임의 곳은 발행 기관·실린 곳이 아닙니다.`);
        const people = (record.creators || []) as any[];
        if (people.some(person => roleNameOfPerson(person) === 'author')) {
            record = { ...record, creators: people.map(person => { if (roleNameOfPerson(person) !== 'author')
                    return person; const { creatorTypeID, ...rest } = person; return { ...rest, creatorType: 'presenter' }; }) };
            appendTo(notes, 'creators', '발표 자료의 사람은 발표자입니다.');
        }
        return record;
    }
    if (type === 'presentation')
        return record;
    const course = courseStatementOf(evidence);
    if (!course)
        return record;
    if (type !== 'manuscript') {
        notes.itemType = `강의 노트입니다 — 앞쪽이 찍은 강의의 진술 「${course.statement.slice(0, 80)}」. ${type === 'document' ? '' : `판독의 유형 ${type} 대신 `}원고(manuscript)로 봅니다.`;
        setType(typed, 'manuscript');
    }
    if (course.notes && !has(fields, 'manuscriptType'))
        fields.manuscriptType = course.notes;
    for (const field of fieldsTheTypeDoesNotHold(fields, 'manuscript'))
        drop(field, `강의 노트(원고)에는 ${field} 칸이 없습니다.`);
    return record;
}
const appendTo = (notes: Record<string, string>, field: string, why: string) => { notes[field] = notes[field] ? `${notes[field]} ${why}` : why; };
function roleNameOfPerson(person: any): string {
    if (person?.creatorType)
        return String(person.creatorType);
    if (person?.creatorTypeID === undefined || person?.creatorTypeID === null)
        return 'author';
    try {
        return String((globalThis as any).Zotero?.CreatorTypes?.getName?.(person.creatorTypeID) || 'author');
    }
    catch {
        return 'author';
    }
}
const NOT_DECIDED_BY_THE_DOI_RECORD = new Set(['title', 'shortTitle', 'creators', 'abstractNote', 'accessDate', 'libraryCatalog', 'extra', 'rights', 'callNumber',
    'archive', 'archiveLocation', 'itemType']);
const PUBLISHED_PART_TYPES = new Set(['journalArticle', 'magazineArticle', 'newspaperArticle', 'conferencePaper', 'bookSection', 'encyclopediaArticle', 'dictionaryEntry']);
const SERIAL_CONTAINER_OF: Record<string, string> = {
    journalArticle: 'publicationTitle', magazineArticle: 'publicationTitle', newspaperArticle: 'publicationTitle', conferencePaper: 'proceedingsTitle', bookSection: 'bookTitle'
};
const TYPE_OF_THE_CONTAINER_SLOT: Record<string, string> = { publicationTitle: 'journalArticle', proceedingsTitle: 'conferencePaper', bookTitle: 'bookSection' };
export function fromADOIRegistry(link: {
    provider?: unknown;
    url?: unknown;
    stated?: Record<string, {
        value: string;
    } | undefined>;
} | null | undefined): boolean {
    const provider = String(link?.provider ?? '').trim();
    if (/^(?:crossref|datacite)$/i.test(provider) || /^DOI\.org\b/i.test(provider))
        return true;
    return provider === 'catalogue' && !!doiIn(String(link?.stated?.DOI?.value ?? '')) && /^catalogue:10\.\d{4,9}\//i.test(String(link?.url ?? ''));
}
export interface MatchedDOIRecord {
    provider: string;
    DOI: string;
    values: Record<string, string>;
    type: string;
}
export function matchedDOIRecordOf(pageType: string, evidence: EvidenceBundle | undefined, why: string[] = [], read?: MetadataSnapshot, registryBound = false): MatchedDOIRecord | null {
    const tied = (link: any) => /^(?:identifier|citation coordinates)\b/i.test(String(link?.rule || ''));
    let links = (evidence?.links || []).filter(link => link?.relation === 'sameEdition' && fromADOIRegistry(link) && !!doiIn(String(link.stated?.DOI?.value ?? '')))
        .map((link, at) => ({ link, at }))
        .sort((a, b) => Number(!tied(a.link)) - Number(!tied(b.link)) || Number(a.link.provider === 'catalogue') - Number(b.link.provider === 'catalogue') || a.at - b.at)
        .map(entry => entry.link);
    if (!links.length) {
        const reading = identifierReadingOf(read, evidence, registryBound);
        if (reading)
            links = [reading];
    }
    if (!links.length)
        return null;
    const doi = doiIn(String(links[0].stated.DOI!.value))!;
    if (links.some(link => !sameDOI(String(link.stated.DOI!.value), doi))) {
        why.push('같은 판본으로 맺은 DOI 기록이 서로 다른 DOI를 말합니다');
        return null;
    }
    const identity = evidence?.identity;
    if (identity?.kind === 'DOI' && sameDOI(String(identity.value || ''), doi) && (identity.scope === 'container' || identity.scope === 'part')) {
        why.push(`DOI ${doi}는 이 문서를 ${identity.scope === 'container' ? '담은 자료' : '한 부분'}의 번호입니다`);
        return null;
    }
    const own = ownDOIsOfThePages(evidence, read?.fields?.title);
    if (own.length && !own.some(entry => sameDOI(entry, doi))) {
        why.push(`쪽이 이 문서의 DOI로 ${own[0]}을 찍습니다 — 기록의 DOI ${doi}는 다른 판의 번호입니다`);
        return null;
    }
    const values: Record<string, string> = {};
    for (const link of links) {
        for (const [field, entry] of Object.entries(link.stated || {})) {
            const value = repairText(String(entry?.value ?? '')).trim();
            if (!value || NOT_DECIDED_BY_THE_DOI_RECORD.has(field) || field in values)
                continue;
            values[field] = value;
        }
    }
    for (const [field, value] of Object.entries(values)) {
        if (statementOf(field, value, { evidence, itemType: storableTypeName(String(links[0].stated?.itemType?.value ?? '')) || pageType, fromRecord: true,
            record: { itemType: pageType, fields: values } as unknown as MetadataSnapshot }))
            delete values[field];
    }
    const printDate = links.map(link => link.stated?.date).find(entry => entry?.role === 'published-print' && String(entry.value || '').trim());
    if (printDate)
        values.date = repairText(String(printDate.value)).trim();
    if (values.date)
        values.date = canonicalDate(values.date) || values.date;
    const container = CONTAINER_FIELDS.map(field => values[field]).find(Boolean);
    if (values.publisher && container && foldedLetters(values.publisher) === foldedLetters(container))
        delete values.publisher;
    if (values.language) {
        const title = String(read?.fields?.title ?? '');
        const body = documentBodyScript(evidence) || (/[가-힣]/.test(title) ? 'hangul' : /\p{Script=Latin}{3}/u.test(title) && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(title) ? 'latin' : null);
        const code = values.language.toLowerCase();
        if ((body === 'hangul' && !/^ko\b/.test(code)) || (body === 'latin' && /^(?:ko|ja|zh)\b/.test(code)))
            delete values.language;
    }
    const statedType = links.map(link => storableTypeName(String(link.stated?.itemType?.value ?? ''))).find(Boolean) || '';
    const slotType = links.filter(link => link.provider === 'catalogue' || /^DOI\.org\b/i.test(String(link.provider || '')))
        .map(link => Object.keys(TYPE_OF_THE_CONTAINER_SLOT).find(field => String(link.stated?.[field]?.value ?? '').trim()))
        .filter((field): field is string => !!field).map(field => TYPE_OF_THE_CONTAINER_SLOT[field])[0] || '';
    const type = statedType || slotType;
    const kind = type || (Object.keys(TYPE_OF_THE_CONTAINER_SLOT).some(field => field in values) ? 'journalArticle' : '');
    const page = String(pageType || '');
    if (kind && page && page !== 'document' && page !== kind && !(PUBLISHED_PART_TYPES.has(page) && PUBLISHED_PART_TYPES.has(kind))) {
        why.push(`쪽은 ${page}, DOI 기록은 ${type || '실린 곳이 있는 출판된 글'}입니다 — 다른 꼴의 기록입니다`);
        return null;
    }
    if (!links.some(tied) && !own.some(entry => sameDOI(entry, doi)) && evidence) {
        const range = /^(\d{1,6})-(\d{1,6})$/.exec(pagesAsARange(values.pages || '') || '');
        const run = range ? pageStructureOf(evidence).folioRun : null;
        if (range && run) {
            const first = run.first + run.offset, last = run.last + run.offset;
            const pages = Array.from({ length: run.last - run.first + 1 }, (_, at) => run.first + at);
            const ocr = (evidence.observations || []).filter(o => o.kind === 'ocrText' && pages.includes(pageNumberOf(o)))
                .map(o => ({ page: pageNumberOf(o), folios: folioCandidates(String(o.text || '')).map(entry => entry.folio) }));
            if ((first < Number(range[1]) || last > Number(range[2]))
                && !layerFoliosLostLeadingDigits({ start: Number(range[1]), end: Number(range[2]) }, { offset: run.offset, pages }, ocr)) {
                why.push(`쪽마다 찍힌 쪽 번호 ${first}–${last}가 기록의 범위 ${range[1]}-${range[2]} 밖입니다 — 같은 글을 다시 실은 다른 판입니다`);
                return null;
            }
        }
    }
    const contradicted = recordContradictsTheDocument(values, evidence);
    if (contradicted) {
        why.push(contradicted);
        return null;
    }
    const series = seriesNamedAsTheContainer(values, PART_OF_A_VOLUME.has(type || page), read);
    if (series) {
        why.push(series);
        for (const field of CONTAINER_FIELDS)
            delete values[field];
    }
    if (!links.some(tied) && (page === 'book' || kind === 'book') && !values.edition) {
        const edition = editionOnTheFrontPages(evidence)?.number || editionNumberOf(read?.fields?.edition) || 0;
        if (edition >= 2) {
            why.push(`쪽이 ${edition}판을 말하고 DOI 기록은 판을 말하지 않습니다 — 이 판의 기록인지 모릅니다`);
            return null;
        }
    }
    return { provider: String(links[0].provider || ''), DOI: doi, values, type };
}
const PART_OF_A_VOLUME = new Set(['conferencePaper', 'bookSection']);
function seriesNamedAsTheContainer(values: Record<string, string>, partOfAVolume: boolean, read?: MetadataSnapshot): string {
    if (!partOfAVolume)
        return '';
    const stated = CONTAINER_FIELDS.map(field => values[field]).find(Boolean) || '';
    if (!stated)
        return '';
    const fields: Record<string, unknown> = read?.fields || {};
    const readContainer = CONTAINER_FIELDS.map(field => String(fields[field] ?? '').trim()).find(Boolean) || '';
    const readSeries = String(fields.series ?? '').trim();
    const same = (a: string, b: string) => !!foldedLetters(a) && foldedLetters(a) === foldedLetters(b);
    if (readSeries && same(stated, readSeries))
        return `DOI 기록의 실린 곳 「${stated.slice(0, 60)}」은 판독이 총서로 적은 이름입니다 — 논문집·책 이름이 아닙니다`;
    if (readContainer && same(stated, readContainer))
        return '';
    const words = (value: string) => value.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    const head = words(stated), whole = words(readContainer);
    if (head.length && whole.length > head.length && head.every((word, at) => whole[at] === word)) {
        return `DOI 기록의 실린 곳 「${stated.slice(0, 60)}」은 판독의 실린 곳 「${readContainer.slice(0, 60)}」의 머리(총서 이름)입니다`;
    }
    const year = Number(/^(\d{4})/.exec(String(values.date ?? '').trim())?.[1] || 0);
    const namesAVolume = [...stated.matchAll(/(?<!\d)(1[5-9]\d{2}|20\d{2})(?!\d)/g)].some(match => !year || Math.abs(Number(match[1]) - year) <= 1)
        || /(?<![\p{L}\p{N}])\d{1,3}(?:st|nd|rd|th)(?![\p{L}])/iu.test(stated);
    if (values.ISSN && !values.series && !namesAVolume) {
        return `DOI 기록이 ISSN(총서의 번호)을 말하고 총서를 가르지 않았습니다 — 실린 곳 「${stated.slice(0, 60)}」은 그 권의 해·차례를 달지 않은 총서 이름일 수 있습니다`;
    }
    return '';
}
function identifierReadingOf(read: MetadataSnapshot | undefined, evidence: EvidenceBundle | undefined, registryBound: boolean): LinkRecord | null {
    const identity = evidence?.identity;
    if (!read || !registryBound || identity?.kind !== 'DOI' || identity.corroboration !== 'printedInDocument')
        return null;
    const fields: Record<string, unknown> = identity.recordFields || read.fields || {};
    if (!/^DOI\.org\b/i.test(String(fields.libraryCatalog ?? '')) || !sameDOI(String(fields.DOI ?? read.fields?.DOI ?? ''), String(identity.value || '')))
        return null;
    const stated: LinkRecord['stated'] = {};
    for (const [field, value] of Object.entries(fields))
        if (String(value ?? '').trim())
            stated[field] = { value: String(value) };
    const type = storableTypeName(String(identity.itemType || read.itemType || ''));
    if (type && type !== 'document')
        stated.itemType = { value: type };
    return { provider: String(fields.libraryCatalog), url: `identifier:${identity.value}`, retrievedAt: '', live: false, relation: 'sameEdition',
        rule: 'identifier: the record of the DOI printed on the page, accepted as the document\'s at stage 1', evidence: [], stage: '', stated };
}
function ownDOIsOfThePages(evidence: EvidenceBundle | undefined, readTitle?: unknown): string[] {
    if (!evidence)
        return [];
    if (documentProfile(evidence).textLayer === 'readable')
        return doisOfTheDocument(evidence, readTitle);
    const pages = (evidence.observations || []).filter(o => o.kind === 'ocrText').map(o => ({ page: pageNumberOf(o), text: String(o.text || ''), complete: !o.truncated }))
        .filter(page => page.page >= 1 && page.page <= 5 && !insertedLeaf(evidence, page.page));
    return pages.length ? ownDOIsInOrder(doiStandingsOf(pages, readTitle)) : [];
}
function storableTypeName(value: string): string {
    return FIELDS_BY_TYPE[value] ? value : '';
}
function sameAsTheRecordStates(field: string, held: unknown, stated: string): boolean {
    const value = String(held ?? '').trim();
    if (!value)
        return false;
    if (field === 'DOI')
        return sameDOI(value, stated);
    if (field === 'ISSN' || field === 'ISBN') {
        const numbers = (text: string) => field === 'ISBN' ? isbnsIn(text) : [...new Set(text.split(/[\s,;/]+/).map(token => validISSN(token)).filter(Boolean))] as string[];
        const held = numbers(value), own = numbers(stated);
        return own.length > 0 && own.every(number => held.includes(number));
    }
    if (field === 'date' || field === 'issueDate' || field === 'filingDate')
        return !!canonicalDate(stated) && canonicalDate(value) === canonicalDate(stated);
    if (field === 'pages') {
        const held = pagesAsARange(value) || value, own = pagesAsARange(stated) || stated;
        if (held === own)
            return true;
        const range = /^(\d{1,7})-(\d{1,7})$/.exec(held);
        return !!range && /^\d{1,7}$/.test(own) && range[1] === own && Number(range[2]) > Number(range[1]);
    }
    if (field === 'volume' || field === 'issue') {
        const a = numberOnly(value) || romanNumber(value), b = numberOnly(stated) || romanNumber(stated);
        if (a && b)
            return a === b;
    }
    if (field === 'url' || field === 'language')
        return value.toLowerCase() === stated.toLowerCase();
    if (CONTAINER_FIELDS.includes(field) && abbreviatesWordwise(stated, value))
        return true;
    return foldedLetters(value) === foldedLetters(stated);
}
function yearOnlyRecordUnderAFinerDate(field: string, held: unknown, stated: string): boolean {
    if (field !== 'date' && field !== 'issueDate' && field !== 'filingDate')
        return false;
    const year = canonicalDate(String(stated ?? '').trim()) || '';
    const finer = canonicalDate(String(held ?? '').trim()) || '';
    return /^\d{4}$/.test(year) && finer.length > 4 && finer.startsWith(`${year}-`);
}
function romanNumber(value: string): string {
    const text = String(value ?? '').trim().toUpperCase();
    if (!/^M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/.test(text) || !text)
        return '';
    const worth: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    let total = 0;
    for (let at = 0; at < text.length; at++)
        total += worth[text[at]] < (worth[text[at + 1]] || 0) ? -worth[text[at]] : worth[text[at]];
    return String(total);
}
function heldByTheType(field: string, type: string, raw: MetadataSnapshot): boolean {
    if (field === 'publisher')
        return (FIELDS_BY_TYPE[type] || []).includes('publisher') || PUBLISHED_PART_TYPES.has(type);
    if (!TYPE_ONLY_FIELDS.has(field))
        return true;
    if ((FIELDS_BY_TYPE[type] || []).includes(field))
        return true;
    return String(raw.itemType || '') === type && has(raw.fields || {}, field);
}
function withTheDOIRecord(record: MetadataSnapshot, matched: MatchedDOIRecord, plain: MetadataSnapshot): MetadataSnapshot {
    const typed = { itemType: String(record.itemType || 'document'), itemTypeID: record.itemTypeID };
    const settled = matched.type || (PUBLISHED_PART_TYPES.has(String(plain.itemType || '')) ? String(plain.itemType) : '');
    const read: Record<string, any> = record.fields || {};
    const fields: Record<string, any> = { ...read };
    if (settled && settled !== typed.itemType) {
        setType(typed, settled);
        for (const field of fieldsTheTypeDoesNotHold(fields, settled))
            if (!(field in matched.values))
                delete fields[field];
    }
    for (const [field, value] of Object.entries(plain.fields || {})) {
        if (has(read, field) || !String(value ?? '').trim() || field in matched.values || NOT_DECIDED_BY_THE_DOI_RECORD.has(field) || CONTAINER_FIELDS.includes(field))
            continue;
        if (!heldByTheType(field, typed.itemType, plain))
            continue;
        fields[field] = value;
    }
    const slot = SERIAL_CONTAINER_OF[typed.itemType];
    for (const [field, value] of Object.entries(matched.values)) {
        if (CONTAINER_FIELDS.includes(field)) {
            if (!slot)
                continue;
            const held = CONTAINER_FIELDS.map(name => read[name]).find(entry => String(entry ?? '').trim());
            for (const other of CONTAINER_FIELDS)
                if (other !== slot)
                    delete fields[other];
            fields[slot] = held && sameAsTheRecordStates(slot, held, value) ? held : value;
            continue;
        }
        if (!heldByTheType(field, typed.itemType, record))
            continue;
        if (sameAsTheRecordStates(field, read[field], value) && !((field === 'volume' || field === 'issue') && !numberOnly(String(read[field] ?? ''))))
            continue;
        if (yearOnlyRecordUnderAFinerDate(field, read[field], value))
            continue;
        if (yearOnlyRecordUnderAFinerDate(field, plain.fields?.[field], value)) {
            fields[field] = String(plain.fields![field]).trim();
            continue;
        }
        fields[field] = value;
    }
    return { ...record, itemType: typed.itemType, itemTypeID: typed.itemTypeID, fields: fields as MetadataSnapshot['fields'] };
}
function asTheDOIRecordStates(outcome: ContractOutcome, matched: MatchedDOIRecord, raw: MetadataSnapshot, evidence: EvidenceBundle | undefined, plain: ContractOutcome): ContractOutcome {
    const fields: Record<string, any> = { ...(outcome.record.fields || {}) };
    const notes = { ...outcome.notes };
    const typed = { itemType: String(outcome.record.itemType || 'document'), itemTypeID: outcome.record.itemTypeID };
    const source = `이 문서와 같은 판본으로 맞은 DOI 기록(${matched.provider}, ${matched.DOI})`;
    const decision = '제목·저자 밖의 칸은 DOI 기록이 정합니다(2026-10-06 결정)';
    if (matched.type && typed.itemType !== matched.type)
        setType(typed, matched.type);
    const slot = SERIAL_CONTAINER_OF[typed.itemType];
    const decided: Record<string, string> = {};
    for (const [stated, value] of Object.entries(matched.values)) {
        const field = CONTAINER_FIELDS.includes(stated) ? slot : stated;
        if (!field || !heldByTheType(field, typed.itemType, raw))
            continue;
        if (CONTAINER_FIELDS.includes(field))
            for (const other of CONTAINER_FIELDS)
                if (other !== field && has(fields, other))
                    delete fields[other];
        const held = fields[field];
        if (sameAsTheRecordStates(field, held, value)) {
            decided[field] = String(held).trim();
            continue;
        }
        if (yearOnlyRecordUnderAFinerDate(field, held, value))
            continue;
        if (field === 'pages' && has(fields, 'pages') && printedRangeOverAPDFRelativeOne(value, evidence)?.range === pagesAsARange(fields.pages))
            continue;
        fields[field] = value;
        decided[field] = value;
    }
    const same = (field: string) => field === 'itemType' ? typed.itemType === String(plain.record.itemType || '')
        : JSON.stringify(fields[field] ?? '') === JSON.stringify(plain.record.fields?.[field] ?? '');
    for (const field of new Set([...Object.keys(notes), ...Object.keys(plain.notes)])) {
        if (same(field)) {
            if (plain.notes[field])
                notes[field] = plain.notes[field];
            else
                delete notes[field];
        }
    }
    if (!same('itemType'))
        notes.itemType = `${source}의 유형 ${typed.itemType} — ${decision}.`;
    for (const [field, value] of Object.entries(decided)) {
        if (same(field))
            continue;
        const held = String(plain.record.fields?.[field] ?? '').trim();
        notes[field] = held ? `「${noteExcerpt(held)}」 대신 ${source}의 값 「${noteExcerpt(value)}」 — ${decision}.` : `${source}의 값 「${noteExcerpt(value)}」 — ${decision}.`;
    }
    return { ...outcome, record: { ...outcome.record, itemType: typed.itemType, itemTypeID: typed.itemTypeID, fields: fields as MetadataSnapshot['fields'] }, notes,
        doiRecord: { provider: matched.provider, DOI: matched.DOI, fields: decided, ...(matched.type ? { itemType: matched.type } : {}) } };
}
const BODY_SAMPLE = { letters: 300, hangulShare: 0.3, latinShare: 0.9, englishShare: 0.15 };
const ENGLISH_FUNCTION_WORD = /^(?:the|of|and|in|to|a|an|is|are|was|were|be|been|for|that|with|by|on|as|from|this|these|at|or|which|it|its)$/;
const ENGLISH_DEGREE_WORD = /\b(?:thesis|dissertation|degree|doctor|master|philosophy|submitted|fulfil{1,2}ment|requirements)\b/i;
export interface BodyLanguage {
    language: 'en' | 'ko';
    from: 'bodySample' | 'frontMatter';
    because: string;
}
export function languageOfBodyText(text: unknown): 'en' | 'ko' | null {
    const value = String(text ?? '').normalize('NFKC');
    const hangul = (value.match(/[가-힣]/g) || []).length;
    const latin = (value.match(/[A-Za-zÀ-ɏ]/g) || []).length;
    const cjk = (value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
    const letters = hangul + latin + cjk;
    if (letters < BODY_SAMPLE.letters)
        return null;
    if (hangul / letters >= BODY_SAMPLE.hangulShare)
        return 'ko';
    if (latin / letters < BODY_SAMPLE.latinShare)
        return null;
    const words = value.toLowerCase().match(/[a-z]+/g) || [];
    const functional = words.filter(word => ENGLISH_FUNCTION_WORD.test(word)).length;
    return words.length && functional / words.length >= BODY_SAMPLE.englishShare ? 'en' : null;
}
function lineOpeningTheTitle(lines: string[], title: string): number {
    const key = foldedLetters(title);
    if (key.length < 2)
        return -1;
    return lines.findIndex(line => {
        const own = foldedLetters(line);
        return own.length >= Math.min(6, key.length) && (key.startsWith(own) || own.startsWith(key));
    });
}
interface ParallelPair {
    page: number;
    hangul: string;
    latin: string;
    latinFirst: boolean | null;
}
function parallelPairsOf(evidence: EvidenceBundle | undefined): ParallelPair[] {
    return heldAnswer(evidence, 'parallelPairsOf', () => {
        const structure = pageStructureOf(evidence);
        const front = new Set(structure.frontMatter);
        const out: ParallelPair[] = [];
        for (const block of titleBlocksOf(structure)) {
            if (!front.has(block.page) || out.some(pair => pair.page === block.page))
                continue;
            const texts = [block.main.text, ...block.parallel.map(entry => entry.text)].map(text => String(text ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean);
            const hangul = texts.find(text => titleSide(text) === 'hangul');
            const latin = texts.find(text => titleSide(text) === 'latin' && foldedLetters(text).length >= 8 && !isNotATitle(text)
                && !isInstitutionName(text) && !isOrganisationOnly(text));
            if (!hangul || !latin)
                continue;
            const lines = linesOf(pageTextToRead(evidence, block.page).text);
            const h = lineOpeningTheTitle(lines, hangul), l = lineOpeningTheTitle(lines, latin);
            out.push({ page: block.page, hangul, latin, latinFirst: h < 0 || l < 0 || h === l ? null : l < h });
        }
        return out;
    });
}
function englishTitlePagesOf(evidence: EvidenceBundle | undefined): Array<{
    page: number;
    latin: string;
    lines: string[];
}> {
    return heldAnswer(evidence, 'englishTitlePagesOf', () => {
        const latins = [...new Set(parallelPairsOf(evidence).map(pair => pair.latin))];
        if (!latins.length)
            return [];
        const out: Array<{
            page: number;
            latin: string;
            lines: string[];
        }> = [];
        for (const page of pageStructureOf(evidence).frontMatter) {
            const text = pageTextToRead(evidence, page).text.normalize('NFKC');
            if (/[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) || (text.match(/[A-Za-z]/g) || []).length < 20)
                continue;
            if (!isDegreeFormPage(text) || !ENGLISH_DEGREE_WORD.test(text))
                continue;
            const lines = linesOf(text);
            const latin = latins.find(title => lineOpeningTheTitle(lines, title) >= 0);
            if (latin)
                out.push({ page, latin, lines });
        }
        return out;
    });
}
export function bodyLanguageOf(evidence: EvidenceBundle | undefined): BodyLanguage | null {
    return heldAnswer(evidence, 'bodyLanguageOf', () => {
        const sampled = languageOfBodyText(bodySampleText(evidence));
        if (sampled)
            return { language: sampled, from: 'bodySample', because: `본문 쪽 표본이 ${sampled === 'en' ? '영어' : '한국어'}입니다` } as BodyLanguage;
        const read = (evidence?.observations || []).filter(o => ['pdfText', 'ocrText', 'pdfLayout'].includes(o.kind) && String(o.locator || '') !== 'body sample');
        if (!read.some(o => /\p{Script=Hangul}/u.test(String(o.text || ''))))
            return null;
        if (documentBodyScript(evidence) === 'hangul')
            return null;
        const english = englishTitlePagesOf(evidence);
        if (!english.length)
            return null;
        const own = new Set(english.map(entry => entry.page));
        const ordered = parallelPairsOf(evidence).filter(pair => !own.has(pair.page) && pair.latinFirst !== null);
        const latinFirst = ordered.filter(pair => pair.latinFirst).length;
        if (!latinFirst || latinFirst < ordered.length - latinFirst)
            return null;
        return { language: 'en', from: 'frontMatter',
            because: `${english.map(entry => entry.page).join('·')}쪽이 영문 표제면이고 ${ordered.filter(pair => pair.latinFirst).map(pair => pair.page).join('·')}쪽이 영어 제목을 먼저 찍었습니다` } as BodyLanguage;
    });
}
function englishParallelTitleOf(title: string, evidence: EvidenceBundle | undefined): string {
    const pairs = parallelPairsOf(evidence);
    const key = foldedLetters(title);
    const own = pairs.filter(pair => foldedLetters(pair.hangul) === key);
    const keys = new Set(pairs.map(pair => foldedLetters(pair.latin)));
    const chosen = own.length ? own : keys.size === 1 ? pairs : [];
    return (chosen.find(pair => /\p{Ll}/u.test(pair.latin)) || chosen[0])?.latin || '';
}
function romanisedOnTheEnglishTitlePage(person: any, evidence: EvidenceBundle | undefined): {
    lastName: string;
    firstName: string;
} | null {
    const whole = `${person?.lastName ?? ''}${person?.firstName ?? ''}`.replace(/\s+/g, '');
    if (!/^[가-힣]{2,5}$/.test(whole))
        return null;
    const found: Array<{
        lastName: string;
        firstName: string;
    }> = [];
    for (const entry of englishTitlePagesOf(evidence)) {
        for (const line of entry.lines) {
            const text = line.replace(/^by\s+/i, '').trim();
            if (!text || text.length > 60 || !/^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ\s.,'’‐-]*$/.test(text) || isDegreeFormLine(text) || isInstitutionName(text) || isOrganisationOnly(text))
                continue;
            const tokens = text.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
            if (tokens.length < 2 || tokens.length > 4)
                continue;
            const parts = personParts(text);
            const splits = [...(parts && parts.fieldMode === 0 ? [{ lastName: parts.lastName, firstName: parts.firstName }] : []),
                { lastName: tokens[0], firstName: tokens.slice(1).join(' ') }, { lastName: tokens[tokens.length - 1], firstName: tokens.slice(0, -1).join(' ') }];
            const split = splits.find(candidate => sameName(whole, candidate, 'bodyLanguage') && surnameAgrees(whole, candidate));
            if (split)
                found.push(split);
        }
    }
    const distinct = new Set(found.map(entry => foldedLetters(`${entry.lastName} ${entry.firstName}`)));
    return distinct.size === 1 ? found[0] : null;
}
export function underTheFieldContract(record: MetadataSnapshot, context: ContractContext = {}): ContractOutcome {
    const plain = contractOf(record, context);
    const matched = matchedDOIRecordOf(String(plain.record.itemType || ''), context.evidence, [], record, !!context.registryBound);
    if (!matched)
        return plain;
    return asTheDOIRecordStates(contractOf(withTheDOIRecord(record, matched, plain.record), context), matched, record, context.evidence, plain);
}
function contractOf(record: MetadataSnapshot, context: ContractContext = {}): ContractOutcome {
    const fields: Record<string, any> = { ...(record.fields || {}) };
    const notes: Record<string, string> = {};
    const typed = { itemType: record.itemType, itemTypeID: record.itemTypeID };
    const pages = (context.evidence?.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind)).map(o => String(o.text || '')).join('\n');
    const drop = (field: string, why: string) => { if (has(fields, field)) {
        notes[field] = why;
        delete fields[field];
    } };
    const appendNote = (field: string, why: string) => { notes[field] = notes[field] ? `${notes[field]} ${why}` : why; };
    const movedInto = (field: string, value: unknown) => movedStatement(field, value, { evidence: context.evidence, itemType: String(typed.itemType ?? ''), creators: record.creators, record: { ...record, fields } as MetadataSnapshot });
    const movedNote = (held: string, moved: string, said: string) => `「${held.slice(0, 60)}」은 ${said} — 발행처로 둡니다${moved !== held ? `(판권 문구를 뗀 이름 「${moved.slice(0, 60)}」)` : ''}.`;
    let refusedTitle = '';
    for (const [field, value] of Object.entries(fields))
        if (typeof value === 'string')
            fields[field] = repairText(value);
    const markedTitle = typeof fields.title === 'string' && hasInlineMarkup(fields.title) ? String(fields.title) : '';
    for (const field of ['title', 'shortTitle']) {
        if (typeof fields[field] !== 'string' || !hasInlineMarkup(fields[field]))
            continue;
        const plainText = withoutInlineMarkup(fields[field]);
        notes[field] = `「${String(fields[field]).slice(0, 80)}」의 글꼴 표시(꼬리표)를 떼어 보통 글 「${plainText.slice(0, 60)}」로 적었습니다 — 쪽은 보통 글자를 찍습니다.`;
        fields[field] = plainText;
    }
    const identity = context.evidence?.identity;
    const printedDOI = identity?.kind === 'DOI' && identity.corroboration === 'printedInDocument' && identity.scope === 'work' ? String(identity.value || '') : '';
    for (const link of context.evidence?.links || []) {
        if (link?.relation !== 'sameEdition' || /^google/i.test(String(link.provider || '')))
            continue;
        const registry = !!printedDOI && sameDOI(String(link.stated?.DOI?.value ?? ''), printedDOI);
        for (const [field, entry] of Object.entries(link.stated || {})) {
            const stated = typeof entry?.value === 'string' ? withoutInlineMarkup(entry.value) : entry?.value;
            if (stated === undefined || stated === null || stated === '')
                continue;
            if (field === 'creators') {
                const refined = sameStatement('creators', record.creators, stated) as any[] | null;
                if (refined) {
                    record = { ...record, creators: refined };
                    notes.creators = `저자 이름을 같은 판본 기록(${link.provider})의 표기로 적었습니다 — 같은 사람들입니다.`;
                }
                continue;
            }
            if (!REFINED_FIELDS.has(field) || !has(fields, field))
                continue;
            const refined = sameStatement(field, fields[field], stated, { pages, registry, patent: typed.itemType === 'patent' || entryIsPatent(link) });
            const lettersDiffer = typeof refined === 'string' && foldedLetters(refined) !== foldedLetters(fields[field]);
            if (lettersDiffer && NAME_FIELDS.includes(field) && !recordMisread(String(fields[field]), refined))
                continue;
            if (typeof refined === 'string' && refined !== fields[field]) {
                notes[field] = `「${String(fields[field]).slice(0, 60)}」을 같은 판본 기록(${link.provider})의 표기 「${refined.slice(0, 60)}」로 적었습니다 — 같은 진술입니다.`;
                fields[field] = refined;
            }
        }
    }
    {
        const refined = boundaryFromTheLinkedRecord(record.creators, context);
        if (refined) {
            record = { ...record, creators: refined.people };
            appendNote('creators', `성·이름의 경계를 연결된 같은 판본 기록(${refined.provider})의 두 칸으로 적었습니다 — 같은 글자의 같은 사람입니다(${refined.changed.slice(0, 3).join(', ')}).`);
        }
    }
    {
        const page = boundaryAsThePagePrints(record.creators, context.evidence);
        if (page) {
            record = { ...record, creators: page.people };
            appendNote('creators', `성·이름의 경계를 쪽의 by-line이 찍은 이름의 경계로 적었습니다 — 같은 글자의 같은 사람입니다(${page.changed.slice(0, 3).join(', ')}).`);
        }
    }
    for (const field of NAME_FIELDS) {
        const value = String(fields[field] ?? '');
        if (!value.trim())
            continue;
        const first = firstOfTwoMarks(value, pages);
        const name = withoutNoteMarks(imprintName(withoutMarks(first ?? value, pages)));
        if (name !== value.trim()) {
            fields[field] = name;
            notes[field] = first ? `「${value.slice(0, 60)}」은 쪽이 상표 기호로 가른 두 이름입니다 — 앞의 이름 「${name}」만 남겼습니다.`
                : !name && frequencyStatementOf(value) ? `「${value.slice(0, 60)}」은 간행 빈도의 진술입니다(달마다·철마다 펴낸다는 말) — 이름이 아니라 비웠습니다.`
                    : `판권 문구·표시를 떼고 이름만 남겼습니다 — 「${value.slice(0, 60)}」`;
        }
        if (shouting(name)) {
            const words = name.trim().split(/\s+/).length;
            const letters = name.replace(/[^\p{L}]/gu, '');
            const word = letters.length >= 4 && /[AEIOUY]/.test(letters) && /[^AEIOUY]/.test(letters);
            const printed = words >= 2 || word ? printedForm(name, pages) : '';
            if (printed && printed !== name && (words >= 2 || /^\p{Lu}\p{Ll}+$/u.test(printed))) {
                fields[field] = printed;
                notes[field] = `대문자로 읽힌 「${name}」을 쪽에 찍힌 표기 「${printed}」로 적었습니다.`;
            }
        }
        const held = String(fields[field] ?? '');
        const cased = wordmarkCased(held, pages);
        if (cased !== held) {
            fields[field] = cased;
            notes[field] = `로고 글자(소문자)로 읽힌 「${held}」을 이름 표기 「${cased}」로 적었습니다.`;
        }
        const spelled = corroboratedSpelling(field, String(fields[field] ?? ''), context.evidence);
        if (spelled) {
            notes[field] = `${spelled.readAt}의 「${String(fields[field]).slice(0, 60)}」${objectParticle(String(fields[field]))} 「${spelled.form}」로 — 같은 이름의 오독입니다(${spelled.source}).`;
            fields[field] = spelled.form;
        }
        const spaced = printedSpacing(fields[field], context.evidence);
        if (spaced) {
            appendNote(field, `「${String(fields[field]).slice(0, 60)}」${objectParticle(String(fields[field]))} 쪽이 찍은 띄어쓰기 「${spaced.slice(0, 60)}」로 적었습니다 — 글자가 같은 같은 진술입니다.`);
            fields[field] = spaced;
        }
    }
    {
        const value = String(fields.publisher ?? '').trim();
        const split = value ? placesAfterAName(value, pages) : null;
        if (split) {
            fields.publisher = split.name;
            appendNote('publisher', `「${value.slice(0, 80)}」의 꼬리 「${split.places.join(' • ')}」은 판권 줄이 펴낸 곳 뒤에 이어 찍은 곳들입니다 — 펴낸 곳에서 뗐습니다.`);
            if (!has(fields, 'place'))
                fields.place = split.places[0];
        }
    }
    {
        const value = String(fields.place ?? '').trim();
        const city = value ? cityOfAnAddress(value, pages) : '';
        if (city && city !== value) {
            appendNote('place', `「${value}」은 쪽이 주소로 찍은 「우편 번호 도시, 나라」의 꼴입니다 — 곳 칸은 도시 「${city}」입니다.`);
            fields.place = city;
        }
    }
    if (has(fields, 'publisher') && attributedToTheOriginal(String(fields.publisher), context.evidence, record)) {
        const held = String(fields.publisher);
        const linked = linkedStatementsOf(context.evidence, 'publisher').map(entry => entry.value)
            .find(value => foldedLetters(value) !== foldedLetters(held) && !attributedToTheOriginal(value, context.evidence, record));
        if (linked) {
            fields.publisher = linked;
            notes.publisher = `「${held.slice(0, 60)}」은 원판(원서)의 펴낸 곳입니다 — 이 판의 펴낸 곳은 연결된 기록의 「${linked.slice(0, 60)}」입니다.`;
        }
        else
            drop('publisher', `「${held.slice(0, 60)}」은 원판(원서)의 펴낸 곳입니다 — 이 판의 펴낸 곳이 아닙니다.`);
    }
    if (documentBodyScript(context.evidence) === 'hangul') {
        const printedHere = (text: string) => { const key = foldedLetters(text); return key.length >= 2 && foldedLetters(pages).includes(key); };
        for (const field of ['edition', 'place', 'publisher']) {
            const value = String(fields[field] ?? '').trim();
            if (!value || /[가-힣]/.test(value) || !/\p{Script=Latin}/u.test(value))
                continue;
            const bare = value.replace(/\s*\[([^\]]*)\]\s*/g, (whole, inside) => printedHere(inside) ? whole : ' ').replace(/\s+/g, ' ').trim();
            const hangul = bare ? hangulPrintedFor(bare, context.evidence) : null;
            if (hangul) {
                appendNote(field, `「${value.slice(0, 60)}」은 쪽이 찍은 「${hangul}」의 로마자 표기입니다 — 쪽의 한글로 적었습니다.`);
                fields[field] = hangul;
            }
            else if (!bare || (MR_ROMANISATION.test(bare) && !printedHere(bare)))
                drop(field, `「${value.slice(0, 60)}」은 목록이 로마자로 적은 값입니다 — 이 문서 어디에도 찍혀 있지 않습니다.`);
            else if (bare !== value) {
                appendNote(field, `「${value.slice(0, 60)}」에서 목록자가 괄호로 보탠 것을 뗐습니다 — 쪽에 찍혀 있지 않습니다.`);
                fields[field] = bare;
            }
        }
    }
    if (has(fields, 'university')) {
        const school = universityName(fields.university);
        if (school && school !== fields.university)
            fields.university = school;
        else if (!school && UNIT_ONLY.test(String(fields.university).trim()))
            drop('university', `「${fields.university}」은 학교가 아니라 학교 안의 단위입니다.`);
    }
    let monthIssue = false;
    const monthIntoTheDate = (stated: {
        year: string;
        month: string;
    }) => {
        const held = String(fields.date ?? '').trim();
        const year = stated.year || (/^(?:19|20)\d{2}$/.test(held) ? held : '');
        if (year && (!held || held === year)) {
            fields.date = `${year}-${stated.month}`;
            notes.date = `한 호의 표시 「${year}년 ${Number(stated.month)}월호」로 발행 연월을 채웠습니다.`;
        }
    };
    const coordinatesIntoEmptyFields = (cited: NonNullable<ReturnType<typeof citationCoordinatesOf>>): string[] => {
        const filled: string[] = [];
        const fill = (field: string, value: string) => { if (value && !has(fields, field)) {
            fields[field] = value;
            filled.push(field);
        } };
        fill('volume', cited.volume);
        fill('issue', cited.issue);
        fill('pages', cited.pages);
        fill('date', cited.year ? (cited.month ? `${cited.year}-${cited.month}` : cited.year) : '');
        return filled;
    };
    for (const field of CONTAINER_FIELDS) {
        const value = String(fields[field] ?? '').trim();
        if (value && fundingStatement(value, context.evidence))
            drop(field, `「${value.slice(0, 60)}」은 연구비 진술(Funded by·지원기관 …)이지 실린 곳의 이름이 아닙니다.`);
    }
    if (SERIAL_PART_TYPES.has(String(typed.itemType)) && has(fields, 'publicationTitle')) {
        const held = String(fields.publicationTitle);
        const serial = serialInsteadOf(held, context.evidence, numberOnly(String(fields.volume ?? '')));
        if (serial) {
            fields.publicationTitle = serial;
            notes.publicationTitle = `「${held.slice(0, 60)}」은 이 글이 실린 학술지가 아닙니다 — 쪽 머리·꼬리의 한 호의 줄이 「${serial}」${fields.volume ? ` ${fields.volume}권` : ''}을 찍습니다.`;
            const moved = has(fields, 'publisher') ? '' : movedInto('publisher', held);
            if (moved) {
                fields.publisher = moved;
                notes.publisher = movedNote(held, moved, '학술지가 아니라 펴낸 곳입니다');
            }
        }
    }
    let containerWasThePublisher = false;
    if (CONTAINER_SLOT_TYPES.has(String(typed.itemType))) {
        const slot = CONTAINER_OF[String(typed.itemType)];
        const held = String(fields[slot] ?? '').trim();
        const publisher = held ? publisherInTheContainerSlot(held, context.evidence) : null;
        if (publisher) {
            const instead = containerInsteadOfThePublisher(held, context.evidence);
            const why = `「${held.slice(0, 60)}」은 펴낸 곳의 이름이지 실린 곳이 아닙니다 — ${publisher.why}.`;
            delete fields[slot];
            containerWasThePublisher = true;
            if (!instead)
                notes[slot] = `${why} 이 문서에 연결된 기록도 쪽의 인용줄도 실린 곳을 적지 않아 비웁니다.`;
            else {
                const type = typed.itemType === 'journalArticle' && instead.slot !== 'publicationTitle' ? (instead.slot === 'proceedingsTitle' ? 'conferencePaper' : 'bookSection') : String(typed.itemType);
                if (type !== typed.itemType) {
                    const kind = type === 'conferencePaper' ? ['학술대회 논문집', '학술대회 논문'] : ['책', '책의 한 장'];
                    setType(typed, type);
                    notes.itemType = `판독의 학술지 논문은 펴낸 곳 「${held.slice(0, 60)}」을 실린 곳으로 읽은 유형입니다 — ${instead.from} 「${instead.name.slice(0, 60)}」은 ${kind[0]}이라 ${kind[1]}으로 적었습니다.`;
                    for (const field of fieldsTheTypeDoesNotHold(fields, type))
                        drop(field, `${kind[1]}에는 ${field} 칸이 없습니다.`);
                }
                const into = CONTAINER_OF[type];
                fields[into] = instead.name;
                notes[into] = `${why} ${instead.from} 「${instead.name.slice(0, 60)}」로 적었습니다.`;
            }
            const moved = has(fields, 'publisher') || publisher.linkedSame ? '' : movedInto('publisher', held);
            if (moved) {
                fields.publisher = moved;
                notes.publisher = movedNote(held, moved, '실린 곳이 아니라 펴낸 곳입니다');
            }
        }
    }
    if (CONTAINER_SLOT_TYPES.has(String(typed.itemType))) {
        const slot = CONTAINER_OF[String(typed.itemType)];
        const held = String(fields[slot] ?? '').trim();
        const coordinates = ['volume', 'issue', 'pages', 'DOI', 'ISSN'].some(field => has(fields, field));
        const wordmark = held ? wordmarkInTheContainerSlot(held, context.evidence, { volume: fields.volume, pages: fields.pages }) : null;
        const body = held && !wordmark ? bodyOfAnInitialism(held, context.evidence, coordinates) : null;
        const statement = !!held && !wordmark && !body && presentationStatement(held);
        if (wordmark || body || statement) {
            const why = wordmark ? `「${held.slice(0, 60)}」은 실린 곳이 아닙니다 — ${wordmark.why}.`
                : body ? (body.glued ? `「${held.slice(0, 60)}」은 ${body.said}의 이름(두문자를 붙여 쓴 회사 이름)입니다 — 실린 곳의 이름이 아닙니다.` : `「${held.slice(0, 60)}」은 ${body.said}의 두문자입니다 — 실린 곳의 이름이 아닙니다.`)
                    : `「${held.slice(0, 60)}」은 이 글을 발표한 자리를 말한 문장이지 실린 곳의 이름이 아닙니다.`;
            const linked = wordmark ? (wordmark.name ? { name: wordmark.name, provider: '' } : null) : containerOfASameEditionRecord(held, context.evidence);
            delete fields[slot];
            containerWasThePublisher = true;
            if (linked) {
                fields[slot] = linked.name;
                notes[slot] = `${why} ${wordmark?.fromPage ? '쪽이 찍은' : '연결된 같은 판본 기록이 적은'} 실린 곳 「${linked.name.slice(0, 60)}」로 적었습니다.`;
            }
            else
                notes[slot] = `${why} 이 문서에 연결된 기록이 실린 곳을 적지 않아 비웁니다.`;
            const event = statement && typed.itemType === 'conferencePaper' && !has(fields, 'conferenceName') ? movedInto('conferenceName', eventOfAPresentationStatement(held)) : '';
            if (event) {
                fields.conferenceName = event;
                notes.conferenceName = `실린 곳 칸의 진술 「${held.slice(0, 60)}」이 말한 모임 「${event.slice(0, 60)}」.`;
            }
        }
    }
    if (typed.itemType === 'journalArticle' && has(fields, 'publicationTitle') && !['volume', 'issue', 'ISSN'].some(field => has(fields, field))) {
        const name = String(fields.publicationTitle).replace(/\s+/g, ' ').trim();
        const statedAs = (slot: string) => foldedLetters(name).length >= 6
            && sameEditionRecords(context.evidence).some(link => foldedLetters(String(link.stated?.[slot]?.value ?? '')) === foldedLetters(name));
        const slot = statedAs('proceedingsTitle') ? 'proceedingsTitle' : statedAs('bookTitle') ? 'bookTitle' : '';
        if (slot) {
            const type = slot === 'proceedingsTitle' ? 'conferencePaper' : 'bookSection';
            const kind = type === 'conferencePaper' ? ['학술대회 논문집', '학술대회 논문'] : ['책', '책의 한 장'];
            setType(typed, type);
            delete fields.publicationTitle;
            fields[slot] = name;
            notes.itemType = `「${name.slice(0, 60)}」은 이 문서에 연결된 같은 판본 기록이 ${kind[0]}의 이름으로 적은 것입니다 — 학술지 논문이 아니라 ${kind[1]}으로 적었습니다.`;
            for (const field of fieldsTheTypeDoesNotHold(fields, type))
                drop(field, `${kind[1]}에는 ${field} 칸이 없습니다.`);
        }
    }
    for (const field of CONTAINER_FIELDS) {
        const value = String(fields[field] ?? '').trim();
        const name = value ? journalOfIssueStatement(value) : null;
        if (name === null || name === value)
            continue;
        const stated = issueNumbersOf(value);
        if (!name)
            drop(field, `「${value.slice(0, 60)}」은 한 호의 표시이지 실린 곳의 이름이 아닙니다.`);
        else {
            fields[field] = name;
            notes[field] = `실린 곳 이름에 붙은 한 호의 표시를 뗐습니다 — 「${value.slice(0, 60)}」`;
        }
        if (stated.volume && !has(fields, 'volume'))
            fields.volume = stated.volume;
        if (stated.issue && !has(fields, 'issue'))
            fields.issue = stated.issue;
        const cited = citationCoordinatesOf(value);
        if (cited)
            coordinatesIntoEmptyFields(cited);
        if (stated.month) {
            monthIntoTheDate(stated);
            monthIssue = true;
        }
    }
    for (const field of [...CONTAINER_FIELDS, 'seriesTitle']) {
        const value = String(fields[field] ?? '').trim();
        const cited = value ? citationCoordinatesOf(value) : null;
        if (!cited || cited.name === value)
            continue;
        fields[field] = cited.name;
        const filled = field === 'seriesTitle' ? [] : coordinatesIntoEmptyFields(cited);
        notes[field] = `실린 곳 이름에 붙은 인용 좌표(연도·권·호·쪽)를 뗐습니다 — 「${value.slice(0, 60)}」${filled.length ? `; 빈 칸(${filled.join(', ')})을 그 좌표로 채웠습니다` : ''}.`;
    }
    if (documentProfile(context.evidence).textLayer === 'readable') {
        for (const field of CONTAINER_FIELDS) {
            const value = String(fields[field] ?? '').trim();
            if (!value || value.length > 200 || linkedStatementsOf(context.evidence, field).some(stated => foldedLetters(stated.value) === foldedLetters(value)))
                continue;
            const spelled = layerSpellingOfAName(value, context.evidence);
            if (!spelled)
                continue;
            const word = new RegExp(String.raw `(?<![\p{L}\p{N}])${escapeForPattern(spelled.read)}(?![\p{L}\p{N}])`, 'iu');
            const corrected = value.replace(word, held => held === held.toUpperCase() && held !== held.toLowerCase() ? spelled.printed.toUpperCase() : spelled.printed);
            if (corrected === value)
                continue;
            appendNote(field, `판독한 「${value.slice(0, 60)}」의 「${spelled.read}」는 글자층 어디에도 없습니다 — ${spelled.page}쪽 글자층이 같은 이름을 찍은 철자 「${spelled.printed}」로 적었습니다(쪽 이미지 판독이 한두 글자를 헷갈려 읽은 것).`);
            fields[field] = corrected;
        }
    }
    for (const field of CONTAINER_FIELDS) {
        const held = String(fields[field] ?? '').trim();
        if (!held || held.length > 200)
            continue;
        let value = held;
        const cuts: string[] = [];
        for (let round = 0; round < 3; round++) {
            const descriptor = CONTAINER_DESCRIPTOR_TAIL.exec(value);
            if (descriptor && descriptor.index > 1) {
                cuts.push(descriptor[0].replace(/^,\s*/, '').trim());
                value = value.slice(0, descriptor.index).trim();
                continue;
            }
            const publisher = publisherAfterTheContainer(value, context.evidence, fields.publisher);
            if (publisher) {
                cuts.push(publisher.tail);
                value = publisher.name;
                continue;
            }
            break;
        }
        const form = recordFormOfTheContainer(value, context.evidence);
        const full = form ? null : fullNameOfAnAbbreviation(value, context.evidence);
        const named = form?.name || full?.name || value;
        if (named === held)
            continue;
        const said: string[] = [];
        if (cuts.length)
            said.push(`이름 뒤의 「${cuts.join('」「')}」은 펴낸 곳·설명이지 실린 곳의 이름이 아니라 뗐습니다`);
        if (form)
            said.push(`연결된 같은 판본 기록(${form.provider})이 같은 이름을 적은 모양 「${form.name.slice(0, 60)}」로 적었습니다(앞 관사·끝 설명 낱말만 다른 같은 진술)`);
        if (full) {
            said.push(`「${value.slice(0, 60)}」은 줄인 이름입니다 — ${full.from} 온전한 이름 「${full.name.slice(0, 60)}」로 적었습니다`);
            if (field === 'publicationTitle' && !has(fields, 'journalAbbreviation') && (FIELDS_BY_TYPE[String(typed.itemType)] || []).includes('journalAbbreviation')) {
                fields.journalAbbreviation = value;
                appendNote('journalAbbreviation', `쪽이 실린 곳으로 찍은 줄인 이름 「${value.slice(0, 60)}」.`);
            }
        }
        appendNote(field, `「${held.slice(0, 80)}」 — ${said.join('; ')}.`);
        fields[field] = named;
    }
    if (has(fields, 'journalAbbreviation')) {
        const held = String(fields.journalAbbreviation).trim();
        const misfit = abbreviationOfAnotherName(held, context.evidence, String(fields.publicationTitle ?? ''));
        if (misfit?.replacement) {
            fields.journalAbbreviation = misfit.replacement;
            appendNote('journalAbbreviation', `「${held.slice(0, 60)}」은 연결된 같은 판본 기록의 실린 곳 「${misfit.container.slice(0, 60)}」을 줄인 꼴이 아닙니다 — 그 기록이 적은 줄인 이름 「${misfit.replacement.slice(0, 60)}」로 적었습니다.`);
        }
        else if (misfit) {
            drop('journalAbbreviation', `「${held.slice(0, 60)}」은 연결된 같은 판본 기록의 실린 곳 「${misfit.container.slice(0, 60)}」을 줄인 꼴이 아닙니다 — 깨진 글자를 옮긴 값이라 비웁니다.`);
        }
    }
    if (has(fields, 'publisher') && has(fields, 'publicationTitle') && !isAnInstitutionNotASerial(fields.publicationTitle)
        && foldedLetters(fields.publisher) === foldedLetters(fields.publicationTitle) && !statedRolesOf(String(fields.publisher), context.evidence).publisher) {
        drop('publisher', `「${fields.publisher}」은 학술지 이름입니다 — 쪽 어디에도 발행처로 찍혀 있지 않습니다.`);
    }
    if (has(fields, 'title') && !SERIAL_PART_TYPES.has(String(typed.itemType))) {
        const above = titleAboveItsVolumeLine(fields.title, context.evidence);
        if (above) {
            appendNote('title', `「${noteExcerpt(fields.title)}」은 권차 표시로 여는 줄입니다 — 제목이 아니라 여러 권 가운데 한 권의 표시라, ${above.page}쪽이 그 줄 바로 위에 찍은 「${noteExcerpt(above.title)}」을 제목으로 적었습니다.`);
            fields.title = above.title;
        }
    }
    if (has(fields, 'title') && titleSide(String(fields.title)) === 'hangul') {
        const work = bodyLanguageOf(context.evidence);
        const english = work?.language === 'en' ? englishParallelTitleOf(String(fields.title), context.evidence) : '';
        if (english) {
            appendNote('title', `본문이 영어입니다(${work!.because}) — 한국어 병기 제목 「${String(fields.title).slice(0, 60)}」 대신 쪽에 찍힌 영어 제목 「${english.slice(0, 60)}」로 적었습니다.`);
            fields.title = english;
        }
    }
    if (has(fields, 'title')) {
        const raw = String(fields.title);
        const furniture = titleFurniture(raw);
        let title = furniture.title;
        const unmarked = withoutMarks(title, pages);
        if (unmarked !== title) {
            title = unmarked;
            furniture.removed.push('상표 표시');
        }
        const unstated = withoutTrailingContainerStatement(title, fields, pages);
        if (unstated !== title) {
            title = unstated;
            furniture.removed.push('실린 곳의 진술');
        }
        const unsigned = withoutGluedByline(title, record.creators);
        if (unsigned !== title) {
            title = unsigned;
            furniture.removed.push('저자 줄');
        }
        const headless = withoutGluedHead(title, context.evidence);
        if (headless !== title) {
            title = headless;
            furniture.removed.push('머리 줄');
        }
        {
            const cut = /\s*[:：]\s+|\s+[-–—]\s+/u.exec(title);
            if (cut && cut.index > 0) {
                const head = title.slice(0, cut.index).trim(), tail = title.slice(cut.index + cut[0].length).trim();
                const letters = (value: string) => (value.match(/[\p{L}\p{N}]/gu) || []).length;
                if (letters(head) >= 8 && letters(tail) >= 8 && parallelRestatement(head, tail)) {
                    const hangulBody = documentBodyScript(context.evidence) === 'hangul';
                    const kept = hangulBody && /[가-힣]/.test(tail) && !/[가-힣]/.test(head) ? tail : head;
                    title = kept;
                    furniture.removed.push('병기 제목');
                }
                else if (cut[0].trim() && /[:：]/.test(cut[0]) && continuedTitle(head, tail, joined => titleBlocksOf(pageStructureOf(context.evidence))
                    .some(block => block.reading === 'layer' && block.basis === 'layout' && foldedLetters(block.main.text) === foldedLetters(joined)))) {
                    title = `${head} ${tail}`;
                    furniture.removed.push('제목을 가른 부제 표');
                }
            }
        }
        const edition = splitTrailingEdition(title);
        if (edition.edition) {
            title = edition.title;
            if (!has(fields, 'edition'))
                fields.edition = edition.edition;
        }
        if (context.registryBound) {
            const own = titleOfTheIdentifierRecord(title, context, pages);
            if (own) {
                const tail = title.slice(own.length).replace(/^[\s:：\-–—]+/u, '').trim();
                const volume = /^(?:vol(?:ume)?\.?|band|tome)\s*(\d{1,4}|[IVXLC]{1,6})$/i.exec(tail);
                if (volume && !has(fields, 'volume'))
                    fields.volume = volume[1];
                title = own;
                furniture.removed.push('인쇄된 식별자의 기록이 말하지 않은 부제');
            }
        }
        if (title !== raw.trim()) {
            fields.title = title;
            notes.title = `제목에 붙은 가구(${furniture.removed.length ? furniture.removed.join(', ') : '칸 이름·번호·표시'})를 뗐습니다 — 「${raw.slice(0, 60)}」`;
        }
        if (title && isNotATitle(title)) {
            const bare = withoutOwnNumber(title, context.evidence);
            if (bare !== title && !isNotATitle(bare)) {
                title = bare;
                fields.title = bare;
                notes.title = `제목에 붙은 이 문서의 제 번호를 뗐습니다 — 문서 번호는 보고서 번호 칸의 것입니다(「${raw.slice(0, 80)}」).`;
            }
        }
        const serial = title && SERIAL_PART_TYPES.has(String(typed.itemType)) ? serialAsTitle(title, fields, context.evidence, record.creators) : null;
        if (title && isIssueStatement(title))
            drop('title', `「${raw.slice(0, 60)}」은 학술지 한 호의 표시(권·호)이지 제목이 아닙니다.`);
        else if (!title || isNotATitle(title))
            drop('title', `「${raw.slice(0, 60)}」은 제목이 아닙니다.`);
        else if (titleIsBodyAfterASectionHeading(title, context.evidence)) {
            drop('title', `「${raw.slice(0, 60)}」은 제목이 아니라 본문입니다 — 쪽이 이 글을 번호를 단 절 제목 바로 아래 본문 첫 줄로만 찍습니다.`);
            refusedTitle = raw;
        }
        else if (reviewedWorkOfTheTitle(title, context.evidence)) {
            const reviewed = reviewedWorkOfTheTitle(title, context.evidence);
            drop('title', `「${raw.slice(0, 60)}」은 쪽이 다른 저작의 서지(서평한 책·목록의 책)로만 찍은 제목입니다 — 이 문서의 제목이 아닙니다.`);
            refusedTitle = raw;
            const people = (record.creators || []) as any[];
            const kept = people.filter(person => { const surname = foldedLetters(String(person?.lastName ?? '')); return !(surname.length >= 2 && reviewed.includes(surname)); });
            if (kept.length !== people.length) {
                record = { ...record, creators: kept };
                appendNote('creators', `${people.length - kept.length}명은 그 서지가 찍은 그 책의 사람입니다 — 이 문서의 사람이 아니라 뺐습니다.`);
            }
        }
        else if (namesTheSerial(title, context.evidence))
            drop('title', `「${raw.slice(0, 60)}」은 이 글이 실린 학술지의 이름입니다 — 쪽 머리·인용줄에 권·호와 함께 찍힙니다.`);
        else if (serial) {
            drop('title', `「${raw.slice(0, 60)}」은 이 글이 실린 학술지의 이름입니다 — ${serial.why}. 이 글의 제목이 아닙니다.`);
            const slot = CONTAINER_OF[String(typed.itemType)];
            const held = String(fields[slot] ?? '').trim();
            const heldIsASerial = !!held && serialNameShaped(held) && !isAnInstitutionNotASerial(held);
            if (slot === 'publicationTitle' && foldedLetters(held) !== foldedLetters(title) && !heldIsASerial) {
                const moved = held && !has(fields, 'publisher') ? movedInto('publisher', held) : '';
                if (moved) {
                    fields.publisher = moved;
                    notes.publisher = (isAnInstitutionNotASerial(held) ? `「${held}」은 기관 이름이라 학술지명이 아니라 발행처로 둡니다.`
                        : `「${held}」은 학술지가 아니라 그 학술지를 낸 곳입니다 — 쪽이 제호로 찍은 이름은 「${title}」입니다. 발행처로 둡니다.`)
                        + (moved !== held ? ` 판권 문구를 뗀 이름 「${moved.slice(0, 60)}」입니다.` : '');
                }
                fields[slot] = serialNameCased(spacedAsPrinted(title, context.evidence), pages);
                notes[slot] = `제목 자리에 있던 학술지 이름 「${fields[slot]}」을 실린 곳으로 옮겼습니다${held ? ` — 「${held}」 대신` : ''}.`;
            }
            const personNamed = (record.creators || []).some((person: any) => person?.fieldMode !== 1 && /\p{L}/u.test(String(person?.lastName ?? person?.name ?? '')));
            const banner = serial.cover && !personNamed ? bannerDateOf(serial.cover) : '';
            const heldDate = canonicalDate(fields.date) || '';
            if (banner && banner !== heldDate && (!has(fields, 'date') || (heldDate && banner.startsWith(heldDate)))) {
                notes.date = `학술지 표지의 띠가 찍은 날짜 「${banner}」로 ${has(fields, 'date') ? `「${fields.date}」을 채웠습니다` : '발행일을 채웠습니다'}.`;
                fields.date = banner;
            }
        }
        else {
            const form = labelledTitleOverTheFormHeading(title, context.evidence);
            const linkedCase = form ? null : titleCasedAsPrinted(title, context.evidence, typed.itemType === 'patent');
            const registryCase = form || linkedCase || !context.registryBound ? null
                : titleCasedAsTheTitlePagePrintsIt(title, context.evidence, record.creators, fields.publicationTitle, markedTitle);
            const cased = linkedCase || registryCase;
            const printed = form || cased ? null : titleAsTheTextLayerSpellsIt(title, context.evidence);
            if (form) {
                fields.title = form.title;
                notes.title = `「${noteExcerpt(title)}」은 서식의 머리글(문서의 종류)입니다 — ${form.page}쪽의 라벨이 붙은 제목 칸이 이 저작의 제목 「${noteExcerpt(form.title)}」을 찍습니다.`;
                if (typed.itemType === 'report' && !has(fields, 'reportType'))
                    fields.reportType = title;
            }
            else if (cased) {
                fields.title = cased;
                notes.title = registryCase
                    ? `${markedTitle && notes.title ? `${notes.title} ` : ''}「${noteExcerpt(title)}」을 표제 쪽이 찍은 모양 「${noteExcerpt(cased)}」로 적었습니다 — 쪽에 인쇄된 식별자의 기록과 글자가 같고 표기(대소문자·끝의 느낌표·물음표·꼬리표가 넣은 빈칸)만 다릅니다(쪽에 찍힌 대로).`
                    : `「${noteExcerpt(title)}」을 쪽이 찍은 모양 「${noteExcerpt(cased)}」로 적었습니다 — 연결된 기록·대문자 판독은 쪽이 제목을 찍은 모양을 바꾸지 않습니다.`;
            }
            else if (printed) {
                fields.title = printed;
                notes.title = `판독한 제목 「${title}」을 글자층에 인쇄된 철자로 바로잡았습니다.`;
            }
            if (!form && !printed) {
                const base = cased || title;
                const spaced = printedSpacing(base, context.evidence);
                if (spaced) {
                    fields.title = spaced;
                    appendNote('title', `「${base.slice(0, 60)}」${objectParticle(base)} 쪽이 찍은 띄어쓰기 「${spaced.slice(0, 60)}」로 적었습니다 — 글자가 같은 같은 진술입니다.`);
                }
            }
        }
    }
    if (typed.itemType === 'book' && has(fields, 'title')) {
        const colophon = subtitleOnTheColophon(fields.title, context.evidence);
        if (colophon) {
            const main = String(fields.title);
            fields.title = colophon.title;
            if (!has(fields, 'shortTitle'))
                fields.shortTitle = main;
            appendNote('title', `판권면(${colophon.page}쪽)이 다시 적은 제목 줄 「${colophon.line.slice(0, 80)}」의 부제 「${colophon.subtitle.slice(0, 60)}」를 이었습니다 — 판독·연결된 기록이 싣지 않은 부제입니다.`);
        }
    }
    if (has(fields, 'shortTitle')) {
        const spaced = printedSpacing(fields.shortTitle, context.evidence);
        if (spaced) {
            appendNote('shortTitle', `「${String(fields.shortTitle).slice(0, 60)}」${objectParticle(String(fields.shortTitle))} 쪽이 찍은 띄어쓰기 「${spaced.slice(0, 60)}」로 적었습니다.`);
            fields.shortTitle = spaced;
        }
    }
    if (Array.isArray(record.creators) && record.creators.length) {
        const cleaned: string[] = [];
        const people = (record.creators as any[]).map(person => {
            const single = person?.fieldMode === 1 || !String(person?.firstName ?? '').trim();
            const part = single ? 'lastName' : 'firstName';
            const stripped = withoutCatalogueRole(String(person?.[part] ?? person?.name ?? ''));
            let out = person;
            if (stripped) {
                out = { ...person, [part]: stripped.name };
                if (stripped.role && stripped.role !== 'author' && (!person.creatorType || person.creatorType === 'author')) {
                    out.creatorType = stripped.role;
                    delete out.creatorTypeID;
                }
                cleaned.push(`${String(person?.[part] ?? '')}→${stripped.name}`);
            }
            if (single) {
                const spaced = printedSpacing(out.lastName, context.evidence);
                if (spaced && spaced.replace(/\s+/g, '') === String(out.lastName).replace(/\s+/g, '')) {
                    cleaned.push(`${out.lastName}→${spaced}`);
                    out = { ...out, lastName: spaced };
                }
            }
            return out;
        });
        if (cleaned.length) {
            record = { ...record, creators: people };
            appendNote('creators', `목록 기록의 사람 이름에서 역할 표시·띄어쓰기를 쪽의 꼴로 적었습니다 — ${cleaned.slice(0, 4).map(pair => `「${pair.replace('→', '」→「')}」`).join(', ')}.`);
        }
    }
    if (Array.isArray(record.creators) && record.creators.length) {
        const statements: Array<{
            tail: PublicationTail;
            written: string;
        }> = [];
        const people = (record.creators as any[]).filter(person => {
            const said = publicationOfACreator(person);
            if (said)
                statements.push(said);
            return !said;
        });
        if (statements.length) {
            record = { ...record, creators: people };
            const houses = statements.filter(said => said.tail.house).map(said => ({ name: said.tail.house as string, written: said.written }));
            const others = statements.filter(said => !said.tail.house);
            if (houses.length) {
                const slot = typed.itemType === 'report' ? 'institution' : (FIELDS_BY_TYPE[typed.itemType] || []).includes('publisher') ? 'publisher' : '';
                const filled = !!slot && !has(fields, slot);
                if (filled)
                    fields[slot] = houses[0].name;
                appendNote('creators', `${houses.map(house => `「${house.written}」`).join(', ')}은 펴낸 곳의 진술입니다 — 저자가 아닙니다${filled ? `(${slot === 'institution' ? '기관' : '발행처'} 칸을 「${houses[0].name}」로 채웠습니다)` : ''}.`);
                if (filled)
                    notes[slot] = `저자 칸의 「${houses[0].written}」은 펴낸 곳입니다 — 꼬리(펴냄·발행·刊 …)를 떼고 「${houses[0].name}」로 적었습니다.`;
            }
            const frequency = others.filter(said => said.tail.kind === 'frequency'), unnamed = others.filter(said => said.tail.kind !== 'frequency');
            if (frequency.length)
                appendNote('creators', `${frequency.map(said => `「${said.written}」`).join(', ')}은 간행 빈도의 진술입니다(달마다·철마다 펴낸다는 말) — 저자도 펴낸 곳도 아닙니다.`);
            if (unnamed.length)
                appendNote('creators', `${unnamed.map(said => `「${said.written}」`).join(', ')}은 출판의 진술입니다 — 저자가 아니고, 꼬리 앞이 단체 모양이 아니라 펴낸 곳으로도 적지 않았습니다.`);
        }
    }
    if (Array.isArray(record.creators) && record.creators.length) {
        const seen = new Set<string>();
        const kept = (record.creators as any[]).map(person => ({ ...person,
            lastName: nameWithoutNoteMarks(repairText(String(person?.lastName ?? person?.name ?? '').trim())),
            firstName: nameWithoutNoteMarks(repairText(String(person?.firstName ?? '').trim())) }))
            .filter((person, at, all) => {
            const whole = `${person.lastName} ${person.firstName}`.trim();
            if (!person.lastName || NOT_A_PERSON.test(whole) || NOT_A_PERSON.test(person.lastName))
                return false;
            const previous = all[at - 1];
            if (POST_NOMINAL_INITIALS.test(whole) && previous && String(previous.lastName || '').replace(/[^\p{L}]/gu, '').length >= 2 && String(previous.firstName || '').trim())
                return false;
            if (/https?:|www\.|@/.test(whole) || whole.length > 80)
                return false;
            const flatName = whole.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
            if (flatName.length >= 2 && flatName === String(fields.title ?? '').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase())
                return false;
            const key = `${person.lastName}|${person.firstName}|${person.creatorType ?? person.creatorTypeID ?? ''}`.toLowerCase().replace(/\s+/g, '');
            if (seen.has(key))
                return false;
            seen.add(key);
            return true;
        });
        if (kept.length !== record.creators.length)
            notes.creators = '사람이 아닌 저자 칸(et al.·역할 낱말·주소)과 겹친 이름을 뺐습니다.';
        {
            const bodyScript = (bodyLanguageOf(context.evidence)?.language === 'en' ? 'latin' : null)
                || documentBodyScript(context.evidence) || (/^ko\b/.test(String(fields.language || '')) ? 'hangul' : null);
            const roleOf = (person: any) => String(person?.creatorType ?? person?.creatorTypeID ?? 'author');
            const once = oncePerPerson(kept, bodyScript, (a, b) => roleOf(a) === roleOf(b));
            if (once.length !== kept.length) {
                appendNote('creators', `같은 사람을 두 문자 체계로 두 번 적은 칸을 하나로 — ${kept.filter(person => !once.includes(person)).map(person => `「${person.firstName ? `${person.firstName} ${person.lastName}` : person.lastName}」`).join(', ')}을 뺐습니다.`);
                kept.splice(0, kept.length, ...once);
            }
        }
        if (bodyLanguageOf(context.evidence)?.language === 'en') {
            const romanised: string[] = [];
            for (const person of kept) {
                const printed = romanisedOnTheEnglishTitlePage(person, context.evidence);
                if (!printed)
                    continue;
                romanised.push(`「${`${person.lastName}${person.firstName}`.replace(/\s+/g, '')}」→「${printed.lastName}, ${printed.firstName}」`);
                person.lastName = printed.lastName;
                person.firstName = printed.firstName;
                person.fieldMode = 0;
            }
            if (romanised.length)
                appendNote('creators', `본문이 영어라 사람 이름을 영문 표제면이 찍은 로마자 두 칸으로 적었습니다 — ${romanised.slice(0, 4).join(', ')}.`);
        }
        const recased: string[] = [];
        for (const person of kept) {
            if (person.fieldMode === 1 || isOrganisationOnly(`${person.firstName} ${person.lastName}`.trim()) || isOrganisationName(person.lastName.replace(/\s+/g, '')))
                continue;
            if (![person.lastName, person.firstName].every(part => !part || LATIN_NAME_PART.test(part)))
                continue;
            for (const [part, opens] of [['firstName', true], ['lastName', !person.firstName]] as const) {
                const value = String(person[part] || '');
                if (!value.split(/\s+/).some(token => shouting(token) && !initialsWord(token)))
                    continue;
                const written = casedAsPrinted(value, { pages, opens });
                if (written !== value) {
                    recased.push(`${value}→${written}`);
                    person[part] = written;
                }
            }
        }
        if (recased.length)
            notes.creators = `대문자로 찍힌 이름을 이름 표기로 적었습니다 — ${recased.slice(0, 4).map(pair => `「${pair.replace('→', '」→「')}」`).join(', ')}`;
        for (const person of kept) {
            if (person.fieldMode !== 1 || person.firstName)
                continue;
            const cased = wordmarkCased(person.lastName, pages);
            if (cased !== person.lastName) {
                notes.creators = `로고 글자(소문자)로 읽힌 「${person.lastName}」을 이름 표기 「${cased}」로 적었습니다.`;
                person.lastName = cased;
            }
        }
        const respelled: string[] = [];
        let frontLayer: {
            text: string;
            letters: string;
        } | null | undefined;
        const front = () => (frontLayer === undefined ? (frontLayer = readableFrontLayer(context.evidence)) : frontLayer);
        const linkedWords = linkedStatementsOf(context.evidence, 'creators').flatMap(entry => entry.value.split(/[;,\s]+/)).filter(word => word.length >= 3);
        for (const person of kept) {
            const printed = nameAsTheTextLayerSpellsIt(person, front, linkedWords);
            if (!printed)
                continue;
            const spelled = printed.lastName.split(/\s+/).some(token => shouting(token) && !initialsWord(token))
                ? casedAsPrinted(printed.lastName, { pages, opens: !person.firstName }) : printed.lastName;
            respelled.push(`${person.lastName}→${spelled}`);
            person.lastName = spelled;
            if ((printed.role === 'editor' || printed.role === 'translator') && authorOrUnknownRole(person)) {
                person.creatorType = printed.role;
                delete person.creatorTypeID;
            }
        }
        if (respelled.length)
            notes.creators = `판독한 이름을 글자층이 저자 줄에 찍은 철자로 바로잡았습니다 — ${respelled.slice(0, 4).map(pair => `「${pair.replace('→', '」→「')}」`).join(', ')}`;
        const wholeOf = (person: any) => `${person.lastName ?? ''}${person.firstName ?? ''}`.replace(/\s+/g, '');
        const labelSlots = new Map<any, string>();
        for (const person of kept) {
            const whole = wholeOf(person);
            if (!/^[가-힣]{2,5}$/.test(whole))
                continue;
            const spelled = corroboratedSpelling('creators', whole, context.evidence, new Set(kept.filter(other => other !== person).map(wholeOf)));
            if (!spelled)
                continue;
            const label = labelWordOf(spelled.form);
            if (label && label.script === 'ko' && label.seats.includes('label') && BYLINE_MEANINGS.includes(label.meaning)) {
                labelSlots.set(person, label.form);
                appendNote('creators', `${spelled.readAt}의 「${whole}」${topicParticle(whole)} 사람이 아닙니다 — ${spelled.source}${objectParticle(spelled.form)} 헷갈려 읽은 역할 라벨이라 사람에서 뺐습니다.`);
                continue;
            }
            const cut = person.firstName ? String(person.lastName).replace(/\s+/g, '').length : spelled.form.length;
            appendNote('creators', `${spelled.readAt}의 「${whole}」${objectParticle(whole)} 「${spelled.form}」로 — 같은 사람 이름의 오독입니다(${spelled.source}).`);
            person.lastName = spelled.form.slice(0, cut);
            person.firstName = spelled.form.slice(cut);
        }
        if (labelSlots.size) {
            const people: any[] = [];
            kept.forEach((person, at) => {
                const form = labelSlots.get(person);
                if (form === undefined) {
                    people.push(person);
                    return;
                }
                const next = kept[at + 1];
                const role = bylineRoleOf(form);
                if (next && !labelSlots.has(next) && role !== 'author' && authorOrUnknownRole(next)) {
                    next.creatorType = role;
                    delete next.creatorTypeID;
                }
            });
            kept.splice(0, kept.length, ...people);
        }
        record = { ...record, creators: kept };
    }
    {
        const dropped = roleWordSlotName(record.creators as any[] | undefined, context.evidence);
        if (dropped) {
            record = { ...record, creators: (record.creators as any[]).slice(0, -1) };
            appendNote('creators', `「${dropped}」은 한 쪽의 쪽 이미지 판독에만 있는 이름입니다 — 저자 줄 끝(역할어 자리)에 섰고, 글자층·다른 쪽·연결된 기록 어디에도 없어 사람에서 뺐습니다.`);
        }
    }
    if (Array.isArray(record.creators) && record.creators.length) {
        const flat = (value: unknown) => String(value ?? '').replace(/\s+/g, '');
        const spellings = (person: any) => [flat(person?.lastName) + flat(person?.firstName), flat(person?.firstName) + flat(person?.lastName)];
        type Misread = NonNullable<ReturnType<typeof misreadRoleWordLine>>;
        const named = (line: Misread, person: any) => /[가-힣]/.test(spellings(person)[0])
            && spellings(person).some(name => line.names.some(held => name === held || name === held + line.token || name === line.token + held));
        let translated: boolean | undefined;
        const supported = (entry: Misread) => {
            const role = bylineRoleOf(entry.word);
            const stated = linesOf(pages).some(line => {
                const row = readBylineRow(line);
                return (row.kind === 'roleMarked' || row.kind === 'labelled') && row.role === role && row.items.some(item => entry.names.includes(nameOfItem(item).replace(/\s+/g, '')));
            });
            if (stated)
                return true;
            if (role !== 'translator')
                return false;
            if (translated === undefined) {
                const statements = statementsOf(context.evidence), reading = judgedReadingOf(record);
                translated = isTranslatedBook(statements, reading) && !!originalAuthorOf(statements, reading);
            }
            return translated;
        };
        const misread = linesOf(pages).map(line => misreadRoleWordLine(line)).filter((entry): entry is Misread => !!entry)
            .filter(line => (record.creators as any[]).some(person => named(line, person)) && supported(line));
        if (misread.length) {
            const people: any[] = [];
            const fixed: string[] = [];
            for (const person of record.creators as any[]) {
                const [forward, backward] = spellings(person);
                const entry = misread.find(line => forward === line.token || backward === line.token || named(line, person));
                if (!entry || !/[가-힣]/.test(forward)) {
                    people.push(person);
                    continue;
                }
                if (forward === entry.token || backward === entry.token) {
                    fixed.push(`「${entry.token}」${objectParticle(entry.token)} 사람에서 뺐습니다`);
                    continue;
                }
                const role = bylineRoleOf(entry.word);
                const name = entry.names.find(held => [forward, backward].some(value => value === held || value === held + entry.token || value === entry.token + held)) || forward;
                const glued = name !== forward && name !== backward;
                const repaired = { ...(glued ? { ...person, ...koreanPerson(name) } : person), creatorType: role };
                delete repaired.creatorTypeID;
                if (glued)
                    fixed.push(`「${forward}」에서 「${entry.token}」${objectParticle(entry.token)} 뗐습니다`);
                if (glued || person.creatorType !== role)
                    fixed.push(`${name}${topicParticle(name)} ${entry.word === '옮김' ? '옮긴이' : `「${entry.word}」의 사람`}입니다`);
                people.push(repaired);
            }
            if (fixed.length) {
                record = { ...record, creators: people };
                appendNote('creators', `쪽 이미지 판독의 「${misread[0].names.join('·')} ${misread[0].token}」에서 끝 낱말 「${misread[0].token}」${topicParticle(misread[0].token)} 역할어 「${misread[0].word}」${objectParticle(misread[0].word)} 헷갈려 읽은 것입니다 — ${fixed.join(', ')}.`);
            }
        }
    }
    if (Array.isArray(record.creators) && record.creators.length && has(fields, 'title')) {
        const fuller = fullerListOnAnotherReading(record.creators as any[], String(fields.title), context.evidence);
        if (fuller) {
            appendNote('creators', `${fuller.page}쪽 이미지 판독이 같은 제목 아래 사람들을 온전히 적었습니다(「${fuller.line.slice(0, 80)}」) — 판독의 「${(record.creators as any[]).map(person => `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim()).join('; ')}」은 그 이름들의 낱말을 뒤섞은 것이라 그 목록으로 적었습니다.`);
            record = { ...record, creators: fuller.people };
        }
    }
    if (typed.itemType === 'book' && !(record.creators || []).length) {
        const stated = peopleOnTheColophon(context.evidence);
        if (stated.length) {
            record = { ...record, creators: stated };
            appendNote('creators', `판독·연결된 기록이 사람을 적지 않았습니다 — 판권면이 역할 라벨로 찍은 사람(${stated.map(person => person.firstName ? `${person.firstName} ${person.lastName}` : person.lastName).join(', ')})으로 채웠습니다.`);
        }
    }
    if (['book', 'document'].includes(String(typed.itemType)) && has(fields, 'title') && Array.isArray(record.creators) && record.creators.length) {
        const stated = rolesInTheListEntryOfThisWork(fields.title, record.creators, context.evidence);
        if (stated.length) {
            const people = (record.creators as any[]).map((person, index) => {
                const found = stated.find(entry => entry.index === index);
                if (!found)
                    return person;
                const copy = { ...person, creatorType: found.role };
                delete copy.creatorTypeID;
                return copy;
            });
            record = { ...record, creators: people };
            appendNote('creators', `다른 저작 목록 속 이 책의 항목 「${stated[0].entry.slice(0, 100)}」이 역할을 말합니다 — ${stated.map(entry => { const person = people[entry.index]; return `${person.firstName ? `${person.firstName} ${person.lastName}` : person.lastName}${topicParticle(String(person.lastName ?? ''))} ${entry.role === 'editor' ? '편자' : '역자'}`; }).join(', ')}입니다.`);
        }
    }
    if (has(fields, 'date')) {
        const printing = statementsOf(context.evidence).thisEdition.printing;
        const held = canonicalDate(fields.date) || String(fields.date).trim();
        const other = printing && held !== printing.chosen.date.value ? printing.others.find(entry => entry.date.value === held) : undefined;
        if (printing && other) {
            fields.date = printing.chosen.date.value;
            notes.date = `「${held}」은 판권면의 「${other.raw.slice(0, 60)}」의 날짜입니다 — 이 판의 날짜는 첫 쇄 「${printing.chosen.raw.slice(0, 60)}」의 ${printing.chosen.date.value}입니다.`;
        }
    }
    {
        const flat = (value: unknown) => String(value ?? '').replace(/\s+/g, '');
        const stated = statementsOf(context.evidence);
        const reading = judgedReadingOf(record);
        const translatedBook = isTranslatedBook(stated, reading);
        let byLine = originalAuthorOf(stated, reading);
        if (byLine && /[가-힣]/.test(byLine)) {
            const roman = linesOf(pages).map(line => line.trim()).find(line => line.length <= 40 && /^\p{Lu}[\p{L}'’.-]+(?:\s+\p{Lu}[\p{L}'’.-]+){1,2}$/u.test(line)
                && hangulTransliterates(byLine, line));
            if (roman)
                byLine = roman;
        }
        const people = (record.creators || []).map((person: any) => ({ ...person }));
        let changed = false;
        for (const person of people) {
            const name = flat(`${person.lastName ?? ''}${person.firstName ?? ''}`);
            if (!/[가-힣]/.test(name) || name.length < 2)
                continue;
            if (statedAs(stated, name).has('translator') && person.creatorType !== 'translator') {
                person.creatorType = 'translator';
                delete person.creatorTypeID;
                changed = true;
            }
        }
        if (translatedBook && has(fields, 'date')) {
            const year = /^(?:19|20)\d{2}/.exec(canonicalDate(fields.date) || String(fields.date).trim())?.[0] || '';
            const years = year ? yearsOfEditions(stated, reading) : null;
            if (years && years.original.has(year) && years.edition !== year) {
                const held = String(fields.date);
                const linked = years.edition ? '' : linkedStatementsOf(context.evidence, 'date')
                    .map(entry => canonicalDate(entry.value) || '').find(date => /^(?:19|20)\d{2}/.test(date) && !years.original.has(date.slice(0, 4))) || '';
                if (years.edition) {
                    fields.date = years.edition;
                    notes.date = `「${held}」은 원서의 연도입니다(「${years.originalSaid}」) — 이 판의 연도는 쪽이 찍은 「${years.editionSaid}」의 ${years.edition}입니다.`;
                }
                else if (linked) {
                    fields.date = linked;
                    notes.date = `「${held}」은 원서의 연도입니다(「${years.originalSaid}」) — 쪽이 이 판의 연도를 찍지 않아 연결된 기록의 ${linked}로 채웠습니다.`;
                }
                else
                    drop('date', `「${held}」은 원서의 연도입니다(「${years.originalSaid}」) — 쪽이 이 판(번역판)의 연도를 찍지 않아 비웁니다.`);
            }
        }
        if (translatedBook && byLine) {
            const split = personParts(byLine);
            const original = { lastName: split?.lastName ?? byLine, firstName: split?.firstName ?? '', fieldMode: split?.fieldMode ?? 1, creatorType: 'author' };
            const nameOf = (person: any) => flat(`${person.lastName ?? ''}${person.firstName ?? ''}`);
            const sameAsOriginal = (person: any) => nameRelation(person, byLine).relation === 'identical'
                || (!!split && nameRelation(person, original).relation === 'identical')
                || hangulTransliterates(`${person.firstName ?? ''} ${person.lastName ?? ''}`.trim(), byLine);
            const statedOtherwise = (person: any) => { const roles = statedAs(stated, nameOf(person)); return (roles.has('author') || roles.has('editor')) && !roles.has('translator'); };
            const printed = (person: any) => printedPerson(pages, person);
            const translators = people.filter((person: any) => !sameAsOriginal(person) && /[가-힣]/.test(`${person.lastName ?? ''}${person.firstName ?? ''}`)
                && printed(person) && !statedOtherwise(person))
                .map((person: any) => { const copy = { ...person, creatorType: 'translator' }; delete copy.creatorTypeID; return copy; });
            const others = people.filter((person: any) => !sameAsOriginal(person) && !translators.some(t => nameOf(t) === nameOf(person)) && printed(person));
            people.splice(0, people.length, original, ...others, ...translators);
            changed = true;
        }
        if (changed) {
            record = { ...record, creators: people };
            appendNote('creators', '쪽이 옮긴이로 찍은 사람은 역자로, 옮긴 책의 원저자는 쪽이 찍은 이름으로 적었습니다.');
        }
    }
    if (has(fields, 'DOI')) {
        const doi = withoutGluedTail(doiIn(fields.DOI));
        if (!doi)
            drop('DOI', `「${fields.DOI}」은 DOI 모양이 아닙니다.`);
        else if (templateDOI(doi))
            drop('DOI', `「${doi}」은 출판사 원고 서식의 자리표시 DOI입니다 — 이 글의 DOI가 아닙니다.`);
        else if (doi !== fields.DOI)
            fields.DOI = doi;
    }
    if (has(fields, 'DOI') && !context.registryBound) {
        const held = String(fields.DOI);
        const seats = doiStandingsOf(readableLayerPages(context.evidence), fields.title).filter(entry => sameDOI(entry.value, held));
        if (seats.length && seats.every(entry => entry.why === 'cited')) {
            drop('DOI', `DOI 「${held}」는 쪽(${seats[0].page}쪽)이 참고문헌·인용 안에만 찍은 번호입니다 — 이 문서가 인용한 다른 저작의 DOI라 적지 않았습니다.`);
        }
    }
    if (has(fields, 'DOI') && !context.registryBound) {
        const held = String(fields.DOI);
        const standings = doiStandingsOf(readableLayerPages(context.evidence), fields.title);
        const own = ownDOIsInOrder(standings);
        if (own.length && !standings.some(entry => sameDOI(entry.value, held))) {
            const registry = registryDOIsOf(context.evidence, context.registryRecords, fields.title);
            const validated = (_field: string, value: string) => registry.some(doi => sameDOI(doi, value));
            const nearest = own.map(doi => ({ doi, distance: ocrConfusionOf(held, doi) }))
                .filter(entry => entry.distance > 0 && sameStatement('DOI', held, entry.doi, { validated }) !== null)
                .sort((a, b) => a.distance - b.distance)[0];
            if (nearest) {
                notes.DOI = `판독한 DOI 「${held}」는 글자층에 찍혀 있지 않습니다 — 글자층이 찍고 레지스트리가 이 문서의 기록으로 확인한 DOI 「${nearest.doi}」로 적었습니다(쪽 이미지 판독이 한두 글자를 헷갈려 읽거나 빠뜨린 것).`;
                fields.DOI = nearest.doi;
            }
        }
    }
    if (has(fields, 'DOI') && !context.registryBound) {
        const other = anotherEditionsNumbers(fields, context.evidence);
        if (other) {
            const held = String(fields.DOI);
            const moved = Object.keys(other.fields).filter(field => field !== 'DOI');
            for (const [field, value] of Object.entries(other.fields))
                fields[field] = value;
            appendNote('DOI', `DOI 「${held}」는 쪽 어디에도 찍혀 있지 않고 이 문서에 연결된 같은 판본 기록(${other.provider})의 DOI 「${other.fields.DOI}」와 다릅니다 — 같은 글을 실은 다른 판의 번호라 그 기록의 번호로 적었습니다${moved.length ? `(쪽이 찍지 않은 ${moved.join('·')}도 그 기록의 값으로)` : ''}.`);
        }
    }
    if (has(fields, 'DOI'))
        fields.DOI = doiAsWritten(String(fields.DOI), context.evidence);
    if (has(fields, 'url'))
        fields.url = doiLinkAsWritten(String(fields.url), has(fields, 'DOI') ? String(fields.DOI) : '', context.evidence);
    if (has(fields, 'issue') && !context.registryBound) {
        const recorded = recordIssueOverAnUnprintedOne(fields, context.evidence);
        if (recorded) {
            appendNote('issue', `호 「${fields.issue}」는 쪽 어디에도 호로 찍혀 있지 않습니다(쪽의 인용줄은 호 없이 권과 쪽만 찍습니다) — 쪽이 DOI를 찍은 같은 판본 기록(${recorded.provider})의 ${recorded.issue}호로 적었습니다.`);
            fields.issue = recorded.issue;
        }
    }
    for (const [field, check] of [['ISBN', validISBN], ['ISSN', validISSN]] as const) {
        if (!has(fields, field))
            continue;
        const tokens = String(fields[field]).split(/[\s,;/]+|(?<=\d)\s*\(|\)/).map(token => token.trim()).filter(Boolean);
        const valid = tokens.filter(token => check(token));
        if (field === 'ISBN') {
            const held = new Set(valid.map(token => normalizedISBN(token)));
            for (const token of tokens) {
                const digits = token.replace(/[^0-9Xx]/g, '');
                if (digits.length <= 13 || check(token))
                    continue;
                for (const isbn of isbnsIn(digits))
                    if (!held.has(isbn)) {
                        held.add(isbn);
                        valid.push(isbn);
                    }
            }
        }
        const value = field === 'ISSN' ? [...new Set(valid.map(token => check(token)))].join(' ') : [...new Set(valid)].join(' ');
        if (!value)
            drop(field, `「${fields[field]}」에 검사 숫자가 맞는 ${field}가 없습니다.`);
        else if (value !== fields[field])
            fields[field] = value;
    }
    for (const field of ['date', 'filingDate', 'issueDate']) {
        if (!has(fields, field))
            continue;
        const date = mastheadDate(fields[field]);
        if (!date)
            drop(field, `「${fields[field]}」은 날짜로 읽히지 않습니다.`);
        else if (date !== fields[field])
            fields[field] = date;
    }
    if (typed.itemType === 'bookSection') {
        const printedYear = imprintYearOfTheOpeningFoot(context.evidence);
        const heldDate = has(fields, 'date') ? canonicalDate(String(fields.date)) || String(fields.date).trim() : '';
        const heldYear = /^(?:1[5-9]|20)\d{2}/.exec(heldDate)?.[0] || '';
        if (printedYear && (!heldDate || (heldYear && heldYear !== printedYear && Number(printedYear) - Number(heldYear) === 1))) {
            appendNote('date', heldDate ? `「${heldDate}」은 연결된 기록이 적은 해(온라인으로 먼저 낸 해)입니다 — 여는 쪽 발의 출판 진술이 찍은 이 판의 해 ${printedYear}로 적었습니다.`
                : `여는 쪽 발의 출판 진술이 찍은 해 ${printedYear}로 발행일을 채웠습니다.`);
            fields.date = printedYear;
        }
    }
    if (has(fields, 'date') && typed.itemType !== 'thesis' && !context.registryBound
        && !linkedStatementsOf(context.evidence, 'date').some(entry => sameDateValue(entry.value, fields.date))) {
        const history = historyDateOfThePages(fields.date, context.evidence);
        if (history) {
            const held = String(fields.date);
            const linked = publicationDateOfTheLinkedRecord(context.evidence);
            if (linked && !sameDateValue(linked.value, held)) {
                fields.date = linked.value;
                appendNote('date', `「${held}」은 쪽이 원고의 이력(「${history.raw.trim().slice(0, 50)}」)으로만 찍은 날짜입니다 — 연결된 같은 판본 기록(${linked.provider})의 발행일 「${linked.value}」을 씁니다(출판일·발행일이 먼저).`);
            }
            else if (!linked)
                appendNote('date', `「${held}」은 쪽이 원고의 이력(「${history.raw.trim().slice(0, 50)}」)으로만 찍은 날짜입니다 — 더 나은 발행일(연결된 기록)이 없어 그대로 둡니다.`);
        }
    }
    if (has(fields, 'date')) {
        const { workPages, flaggedPages } = workDateTexts(context.evidence);
        const printed = dateAtThePrintedPrecision(String(fields.date), workPages, { flagged: flaggedPages, finerDay: typed.itemType !== 'thesis' });
        if (printed !== fields.date) {
            appendNote('date', printed.length > String(fields.date).length
                ? `쪽은 이 날짜를 「${printed}」로 날까지 찍습니다 — 「${fields.date}」를 쪽의 정밀도로 적었습니다.`
                : `쪽은 이 날짜를 「${printed}」까지만 찍습니다 — 「${fields.date}」의 더 고운 날짜는 쪽에 없어 쪽의 정밀도로 적었습니다.`);
            fields.date = printed;
        }
    }
    if (has(fields, 'pages')) {
        const range = pagesAsARange(fields.pages);
        if (!range)
            drop('pages', `「${fields.pages}」은 쪽 범위나 쪽 번호가 아닙니다.`);
        else if (range !== fields.pages)
            fields.pages = range;
    }
    if (has(fields, 'pages')) {
        const days = dayRangeOfADate(fields.pages, context.evidence);
        if (days && !linkedStatementsOf(context.evidence, 'pages').some(entry => pagesAsARange(entry.value) === pagesAsARange(fields.pages))) {
            const held = String(fields.pages);
            const ranges = [...new Set(sameEditionRecords(context.evidence).map(link => pagesAsARange(String(link.stated?.pages?.value ?? '').trim())).filter(range => /^[A-Za-z]?\d{1,6}(?:-[A-Za-z]?\d{1,6})?$/.test(range)))];
            if (ranges.length === 1) {
                fields.pages = ranges[0];
                notes.pages = `「${held}」은 쪽이 날짜 「${days}」로만 찍은 날의 범위입니다 — 저작의 쪽 범위는 연결된 같은 판본 기록이 적은 ${ranges[0]}입니다.`;
            }
            else
                drop('pages', `「${held}」은 쪽이 날짜 「${days}」로만 찍은 날의 범위입니다 — 저작의 쪽 범위가 아니어서 비웁니다.`);
        }
    }
    if (has(fields, 'pages')) {
        const at = folioOfAnotherPage(fields.pages, context.evidence) || bareFolioOfTheOpening(fields.pages, context.evidence);
        const linkedSays = !!at && linkedStatementsOf(context.evidence, 'pages').some(entry => pagesAsARange(entry.value) === String(fields.pages).trim());
        if (at && !linkedSays) {
            const held = String(fields.pages);
            const run = folioRunFrom(held.trim(), context.evidence);
            const toTheEnd = SERIAL_PART_TYPES.has(String(typed.itemType)) ? rangeToTheDocumentsEnd(held.trim(), context.evidence) : null;
            const around = rangeAroundAFolio(Number(held.trim()), at, context.evidence) || (run ? { range: run, from: '문서의 쪽마다 찍힌 번호' } : null)
                || citedRangeFromAFolio(held.trim(), fields.volume, context.evidence)
                || (toTheEnd ? { range: toTheEnd.range, from: `여는 쪽부터 문서의 끝 쪽(${documentExtent(context.evidence)}쪽)까지 이어지는 쪽 번호` } : null);
            if (around) {
                fields.pages = around.range;
                notes.pages = `「${held}」은 ${at}쪽 머리·바닥에 찍힌 그 쪽의 번호입니다 — 저작의 쪽 범위는 ${around.from}의 ${around.range}입니다.`;
            }
            else
                drop('pages', `「${held}」은 ${at}쪽 머리·바닥에 찍힌 그 쪽의 번호입니다 — 저작의 쪽 범위가 아니어서 비웁니다.`);
        }
    }
    if (has(fields, 'pages')) {
        const registry = registryRangeOverAnUnprintedOne(fields.pages, context.evidence);
        if (registry) {
            appendNote('pages', `「${fields.pages}」은 읽을 만한 글자층 어디에도 찍히지 않은 범위입니다 — 쪽에 인쇄된 DOI의 기록(${registry.provider})이 적은 ${registry.range}로 적었습니다.`);
            fields.pages = registry.range;
        }
    }
    if (has(fields, 'pages')) {
        const total = unprintedRangeOverRelativePages(fields.pages, context.evidence);
        if (total && !linkedStatementsOf(context.evidence, 'pages').some(entry => pagesAsARange(entry.value) === pagesAsARange(fields.pages))) {
            drop('pages', `「${fields.pages}」은 읽을 만한 글자층 어디에도 찍히지 않은 범위입니다 — 이 글은 쪽마다 「Page n of ${total}」로 제 쪽을 매겨 학술지의 쪽 범위가 따로 없어 비웁니다.`);
        }
    }
    if (has(fields, 'pages')) {
        const printed = printedRangeOverAPDFRelativeOne(fields.pages, context.evidence);
        if (printed) {
            appendNote('pages', `「${fields.pages}」은 파일의 쪽 차례(1쪽부터)입니다 — 쪽은 이 저작을 제 쪽 번호 ${printed.first}로 엽니다. 첫 폴리오와 이 저작의 쪽 수로 센 ${printed.range}로 적었습니다.`);
            fields.pages = printed.range;
        }
    }
    if (has(fields, 'pages') && SERIAL_PART_TYPES.has(String(typed.itemType)) && !(context.registryBound && /-/.test(String(fields.pages)))) {
        const held = String(fields.pages);
        const toTheEnd = rangeToTheDocumentsEnd(held, context.evidence);
        const recordRange = linkedStatementsOf(context.evidence, 'pages').map(entry => pagesAsARange(entry.value) || '').find(range => /^\d{1,6}-\d{1,6}$/.test(range));
        if (toTheEnd && !recordRange) {
            appendNote('pages', `「${held}」의 끝은 읽은 쪽이 말하지 않습니다 — 쪽 번호가 여는 쪽 ${toTheEnd.first}부터 끊기지 않고 이어지고 문서는 ${documentExtent(context.evidence)}쪽이라 ${toTheEnd.range}로 적었습니다.`);
            fields.pages = toTheEnd.range;
        }
    }
    if (has(fields, 'pages') && SERIAL_PART_TYPES.has(String(typed.itemType))) {
        const extent = documentExtent(context.evidence);
        const span = rangeLength(String(fields.pages));
        if (extent > 0 && span > Math.max(3 * extent, extent + 20)) {
            drop('pages', `「${fields.pages}」(${span}쪽)은 ${extent}쪽인 이 문서보다 훨씬 깁니다 — 이 글이 아니라 이 글이 실린 호 전체의 쪽 범위(학술지 표지의 띠)입니다.`);
        }
    }
    if (has(fields, 'edition') && /^\s*0+\s*$/.test(String(fields.edition)))
        drop('edition', `「${fields.edition}」은 판이 아닙니다.`);
    const editionOfALink = has(fields, 'edition') && linkedStatementsOf(context.evidence, 'edition').some(entry => foldedLetters(entry.value) === foldedLetters(fields.edition));
    if (typed.itemType === 'book' && editionOfALink) {
        const printed = editionThePagePrintsInsteadOf(fields.edition, context.evidence);
        if (printed) {
            appendNote('edition', `「${fields.edition}」은 이 문서가 찍은 판이 아닙니다 — ${printed.page}쪽이 「${printed.raw}」을 찍고, 그 번호의 판은 쪽 어디에도 없습니다.`);
            fields.edition = String(printed.number);
        }
    }
    {
        const flatPages = foldedLetters(pages.slice(0, 200000));
        for (const link of context.evidence?.links || []) {
            if (link?.relation !== 'sameEdition' && link?.relation !== 'sameWork')
                continue;
            const stated: Record<string, unknown> = Object.fromEntries(Object.entries(link.stated || {}).map(([name, entry]) => [name, entry?.value]));
            const why = recordContradictsTheDocument(stated, context.evidence);
            for (const field of [...EDITION_DESCRIPTION_FIELDS].filter(name => name !== 'edition' && name !== 'numPages')) {
                if (!has(fields, field))
                    continue;
                const own = String(stated[field] ?? '').trim();
                const key = foldedLetters(own);
                if (!key || key !== foldedLetters(fields[field]) || (key.length >= 3 && flatPages.includes(key)))
                    continue;
                const contradicted = why || (field === 'place' && placeTheDocumentStatesInsteadOf(own, context.evidence)
                    ? `문서는 이 판의 곳을 「${placeTheDocumentStatesInsteadOf(own, context.evidence)}」로 찍습니다` : '');
                if (contradicted)
                    drop(field, `「${own.slice(0, 60)}」은 연결된 기록(${link.provider})의 값입니다 — ${contradicted}. 이 판의 진술이 아닙니다.`);
            }
        }
    }
    if (typed.itemType === 'book' && !has(fields, 'edition')) {
        const stated = editionOnTheFrontPages(context.evidence);
        if (stated) {
            fields.edition = String(stated.number);
            notes.edition = `글자층이 찍은 판 표시 「${stated.raw}」(${stated.page}쪽).`;
        }
    }
    if (has(fields, 'numPages')) {
        const count = /\d[\d,]*/.exec(String(fields.numPages))?.[0]?.replace(/,/g, '');
        const extent = documentExtent(context.evidence);
        if (!count || Number(count) === 0)
            drop('numPages', `「${fields.numPages}」은 쪽수가 아닙니다.`);
        else if (typed.itemType === 'book' && extent >= 30 && Number(count) * 3 < extent)
            drop('numPages', `「${fields.numPages}」쪽은 이 파일이 담은 ${extent}쪽에 크게 못 미칩니다 — 이 책의 쪽수가 아닙니다.`);
        else if (count !== fields.numPages)
            fields.numPages = count;
    }
    for (const field of ['volume', 'issue']) {
        if (!has(fields, field))
            continue;
        const month = monthNamedIssue(String(fields[field]));
        if (month) {
            monthIntoTheDate(month);
            monthIssue = true;
            drop(field, `「${fields[field]}」은 달로 이름 붙인 호입니다 — ${field === 'volume' ? '권' : '호'}의 번호가 아니라 발행 연월입니다.`);
            continue;
        }
        const bare = numberOnly(String(fields[field]));
        if (bare && bare !== fields[field])
            fields[field] = bare;
        const value = String(fields[field]).trim();
        if (!/\d/.test(value) && !/^[A-Za-zⅠ-Ⅻ]{1,4}$/.test(value))
            drop(field, `「${value}」은 ${field === 'volume' ? '권' : '호'}이 아닙니다.`);
        else if (/^0+$/.test(value) || /^\(\s*(?:19|20)\d{2}\s*\)$/.test(value))
            drop(field, `「${value}」은 ${field === 'volume' ? '권' : '호'}이 아닙니다.`);
        else if (field === 'volume' && /^(?:19|20)\d{2}$/.test(value) && String(fields.date || '').startsWith(value))
            drop('volume', `「${value}」은 권이 아니라 발행연도입니다.`);
    }
    const body = documentBodyScript(context.evidence);
    if (has(fields, 'language')) {
        const language = String(fields.language).trim().toLowerCase();
        if (!LANGUAGE_CODE.test(language))
            drop('language', `「${fields.language}」은 언어 코드가 아닙니다.`);
        else if (language !== fields.language)
            fields.language = language;
    }
    const englishWork = bodyLanguageOf(context.evidence);
    if (englishWork?.language === 'en') {
        if (fields.language !== 'en') {
            notes.language = `본문이 영어라 언어를 en으로 둡니다(${englishWork.because}${has(fields, 'language') ? ` — 판독: ${fields.language}` : ''}).`;
            fields.language = 'en';
        }
    }
    else if (body === 'hangul' && fields.language !== 'ko' && !String(fields.language || '').startsWith('ko')) {
        if (has(fields, 'language'))
            notes.language = `본문이 한글이라 언어를 ko로 둡니다(판독: ${fields.language}).`;
        fields.language = 'ko';
    }
    else if (body === 'latin' && /^ko\b/.test(String(fields.language || '')))
        drop('language', '본문이 한글이 아닌데 언어가 ko로 읽혔습니다.');
    else if (body === 'latin' && /^(?:ja|zh)\b/.test(String(fields.language || ''))
        && !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(pages.slice(0, 200000))) {
        drop('language', `본문이 라틴 문자인데 언어가 ${fields.language}로 읽혔습니다 — 쪽 글에 가나·한자가 없습니다.`);
    }
    const titleText = String(fields.title || '');
    if (!body && !has(fields, 'language') && (titleText.match(/[가-힣]/g) || []).length * 2 >= Math.max(1, (titleText.match(/[A-Za-z]/g) || []).length)) {
        if (/[가-힣]/.test(titleText))
            fields.language = 'ko';
    }
    const kind = KIND_TO_TYPE[String(typed.itemType || '')];
    if (kind && kind.type !== typed.itemType)
        setType(typed, kind.type);
    if (['report', 'document'].includes(String(typed.itemType)) && !has(fields, 'reportNumber')) {
        const journal = journalOfThePrintedIdentifier(fields, context.evidence, pages);
        if (journal) {
            notes.itemType = `쪽에 찍힌 DOI의 기록이 「${journal.name}」${journal.volume ? ` ${journal.volume}권` : ''}${journal.issue ? ` ${journal.issue}호` : ''}의 글이라 말하고 쪽이 그 학술지 이름을 찍습니다 — ${typed.itemType === 'report' ? '보고서' : '그릇 유형'}가 아니라 학술지 논문입니다.`;
            setType(typed, 'journalArticle');
            if (!has(fields, 'publicationTitle'))
                fields.publicationTitle = journal.name;
            if (journal.volume && !has(fields, 'volume'))
                fields.volume = journal.volume;
            if (journal.issue && !has(fields, 'issue'))
                fields.issue = journal.issue;
            if (has(fields, 'institution') && !has(fields, 'publisher'))
                fields.publisher = fields.institution;
            for (const field of fieldsTheTypeDoesNotHold(fields, 'journalArticle'))
                drop(field, `학술지 논문에는 ${field} 칸이 없습니다.`);
        }
    }
    const namedType = typed.itemType;
    let bodyFromSerial = '';
    let societyOfTheSerial = '';
    if (isAnInstitutionNotASerial(fields.publicationTitle)) {
        bodyFromSerial = String(fields.publicationTitle);
        const society = bodyFromSerial.replace(/\s+/g, '');
        const serial = new RegExp(`${society.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(지|논문지|논문집|회보)`).exec(pages.replace(/\s+/g, ''));
        if (serial) {
            fields.publicationTitle = `${society}${serial[1]}`;
            notes.publicationTitle = `학회 이름 「${bodyFromSerial}」 대신 쪽에 찍힌 학술지 이름 「${fields.publicationTitle}」을 씁니다.`;
            societyOfTheSerial = bodyFromSerial;
            bodyFromSerial = '';
        }
        else
            drop('publicationTitle', `「${bodyFromSerial}」은 기관 이름이지 학술지 이름이 아닙니다.`);
    }
    if (has(fields, 'publicationTitle')) {
        const held = String(fields.publicationTitle);
        const note = statedOnlyInTheTitleNote(held, context.evidence, fields.title);
        if (note) {
            const linked = (context.evidence?.links || []).filter(link => link?.relation === 'sameEdition' && !/^google/i.test(String(link.provider || '')))
                .map(link => String(link.stated?.publicationTitle?.value ?? '').replace(/\s+/g, ' ').trim())
                .find(name => !!name && foldedLetters(name) !== foldedLetters(held) && !statedOnlyInTheTitleNote(name, context.evidence, fields.title));
            const why = `「${held.slice(0, 60)}」은 ${note.page}쪽이 제목의 각주(${note.mark})에만 찍은 진술(논문 번호·총서·기관)입니다 — 학술지 이름이 아닙니다.`;
            if (linked) {
                fields.publicationTitle = linked;
                notes.publicationTitle = `${why} 연결된 같은 판본 기록이 적은 학술지 이름 「${linked.slice(0, 60)}」로 적었습니다.`;
            }
            else
                drop('publicationTitle', why);
        }
    }
    if (typed.itemType === 'journalArticle' && !statesAJournal(fields) && !has(fields, 'volume') && !has(fields, 'issue') && !/\d\s*-\s*\d/.test(String(fields.pages ?? ''))) {
        const arXiv = arXivNumberOf(fields, pages);
        if (arXiv) {
            setType(typed, 'preprint');
            notes.itemType = `학술지 이름·권·호·쪽 범위가 없고 arXiv 번호(${arXiv})가 있어 학술지 논문이 아니라 사전출판본으로 봅니다.`;
            if (!has(fields, 'repository'))
                fields.repository = 'arXiv';
            if (!has(fields, 'archiveID'))
                fields.archiveID = `arXiv:${arXiv}`;
            if (!has(fields, 'DOI'))
                fields.DOI = `10.48550/arXiv.${arXiv}`;
            for (const field of fieldsTheTypeDoesNotHold(fields, 'preprint'))
                drop(field, `사전출판본에는 ${field} 칸이 없습니다.`);
        }
    }
    if (typed.itemType === 'patent' && !context.registryBound && !has(fields, 'patentNumber') && !has(fields, 'applicationNumber')
        && documentProfile(context.evidence).textLayer === 'readable' && !inidStructureOn(context.evidence) && !patentApplicationOnThePages(context.evidence)) {
        setType(typed, 'report');
        notes.itemType = '글자층에 특허 공보의 INID 칸도 출원서의 짜임도 없고 판독이 특허·출원 번호를 적지 않아, 특허가 아니라 특허를 다룬 보고서로 봅니다.';
        const people = (record.creators || []) as any[];
        if (people.some(person => person?.creatorType === 'inventor' || person?.creatorTypeID !== undefined)) {
            record = { ...record, creators: people.map(person => { const { creatorTypeID, ...rest } = person; return { ...rest, creatorType: 'author' }; }) };
        }
        for (const field of fieldsTheTypeDoesNotHold(fields, 'report'))
            drop(field, `보고서에는 ${field} 칸이 없습니다.`);
    }
    const articleCoordinates = (has(fields, 'volume') && (has(fields, 'issue') || /\d-\d/.test(String(fields.pages ?? '')))) || has(fields, 'DOI');
    if (!context.registryBound) {
        const statute = legislationDesignation(context.evidence);
        if (statute) {
            if (typed.itemType !== 'report') {
                notes.itemType = `첫 쪽이 법령의 ${statute.number}를 찍은 문서라 법령 별표(보고서)로 봅니다 — 판독: ${typed.itemType}.`;
                setType(typed, 'report');
            }
            const genre = statute.part === '별지' ? '법령 서식' : '법령 별표';
            if (String(fields.reportType || '') !== genre) {
                if (has(fields, 'reportType'))
                    notes.reportType = `첫 쪽의 「[${statute.number}]」 — ${genre}입니다(판독: ${fields.reportType}).`;
                fields.reportType = genre;
            }
            if (!has(fields, 'reportNumber'))
                fields.reportNumber = statute.number;
            if (statute.act && !has(fields, 'seriesTitle'))
                fields.seriesTitle = statute.act;
            if (statute.date && !has(fields, 'date'))
                fields.date = statute.date;
            if (statute.ministry && !has(fields, 'institution')) {
                fields.institution = stateBody(statute.ministry);
                notes.institution = `첫 쪽에 찍힌 「${statute.ministry}령」의 부처.`;
            }
            for (const field of fieldsTheTypeDoesNotHold(fields, 'report'))
                drop(field, `법령 별표(보고서)에는 ${field} 칸이 없습니다.`);
        }
        else if (typed.itemType === 'standard' && !STANDARD_NUMBER.test(pages)
            && !(has(fields, 'number') && foldedLetters(fields.number).length >= 3 && foldedLetters(pages).includes(foldedLetters(fields.number)))) {
            setType(typed, 'report');
            notes.itemType = '규격 번호(KS·ISO·IEC·ASTM …)가 쪽 어디에도 없어 규격이 아니라 보고서로 봅니다.';
            if (has(fields, 'organization') && !has(fields, 'institution'))
                fields.institution = fields.organization;
            if (has(fields, 'publisher') && !has(fields, 'institution'))
                fields.institution = fields.publisher;
            if (has(fields, 'number') && !has(fields, 'reportNumber'))
                fields.reportNumber = fields.number;
            for (const field of fieldsTheTypeDoesNotHold(fields, 'report'))
                drop(field, `보고서에는 ${field} 칸이 없습니다.`);
        }
        record = talkOrCourseNotes(typed, record, fields, notes, context.evidence, pages, drop);
        if (typed.itemType === 'journalArticle' && !statesAJournal(fields) && !has(fields, 'ISSN')) {
            const fee = feeCodeLineOnThePages(context.evidence);
            if (fee?.kind === 'isbn') {
                notes.itemType = `${fee.page}쪽이 논문집의 ISBN(${fee.number})에 요금을 이은 저작권 줄을 찍었고 학술지 이름·ISSN이 없어, 학술지 논문이 아니라 학술대회 논문으로 봅니다.`;
                setType(typed, 'conferencePaper');
                for (const field of fieldsTheTypeDoesNotHold(fields, 'conferencePaper'))
                    drop(field, `학술대회 논문에는 ${field} 칸이 없습니다.`);
            }
        }
        const bookshop = /(?:^|\/\/)(?:www\.)?(?:yes24\.com|aladin\.co\.kr|kyobobook\.co\.kr|books\.google\.)/i.test(String(fields.url || ''));
        const noCoordinates = !has(fields, 'volume') && !has(fields, 'issue') && !/\d-\d/.test(String(fields.pages ?? ''));
        const issuerIsBody = (() => { const issuer = bodyFromSerial || String(fields.institution || fields.publisher || ''); return !!issuer && (isOrganisationName(issuer.replace(/\s+/g, '')) || isOrganisationOnly(issuer)); })();
        if (typed.itemType === 'journalArticle' && !containerWasThePublisher && !statesAJournal(fields) && !articleCoordinates && (has(fields, 'ISBN') || bookshop || (has(fields, 'publisher') && noCoordinates && !issuerIsBody))) {
            setType(typed, 'book');
            notes.itemType = `학술지 이름이 없고 ${has(fields, 'ISBN') ? 'ISBN이 있어' : bookshop ? '서점의 책 페이지로 연결돼' : '출판사만 있어'} 학술지 논문이 아니라 책으로 봅니다.`;
        }
        if (typed.itemType === 'journalArticle' && !containerWasThePublisher && !statesAJournal(fields) && !articleCoordinates) {
            const issuer = bodyFromSerial || String(fields.institution || fields.publisher || '');
            const moved = has(fields, 'institution') ? '' : issuer ? movedInto('institution', issuer) : '';
            if (issuer && (has(fields, 'institution') || moved) && (isOrganisationName(issuer.replace(/\s+/g, '')) || isOrganisationOnly(issuer))) {
                setType(typed, 'report');
                if (!has(fields, 'institution'))
                    fields.institution = moved;
                if (fields.publisher && (fields.publisher === fields.institution || fields.publisher === issuer))
                    delete fields.publisher;
                const number = numberOfTheIssue(fields, context.evidence);
                if (number && !has(fields, 'reportNumber'))
                    fields.reportNumber = number;
                for (const field of fieldsTheTypeDoesNotHold(fields, 'report'))
                    drop(field, `보고서에는 ${field} 칸이 없습니다${number && ['volume', 'issue'].includes(field) ? ` — 보고서 번호 「${number}」로 남깁니다` : ''}.`);
                notes.itemType = `학술지 이름이 없고 발행 기관(${issuer})만 있어, 학술지 논문이 아니라 기관이 낸 간행물(보고서)로 봅니다.`;
            }
        }
        if (typed.itemType === 'thesis') {
            const stated = thesisTypeOf(fields.thesisType) || degreeStatedIn(pages, false);
            if (!stated) {
                setType(typed, 'report');
                if (fields.university && !fields.institution)
                    fields.institution = fields.university;
                delete fields.university;
                delete fields.thesisType;
                notes.itemType = '이 문서 어디에도 학위 표기(석사·박사학위논문, degree of …)가 없어 학위논문이 아니라 보고서로 봅니다.';
            }
            else
                fields.thesisType = degreeLabel(stated, String(fields.language || '') || (body === 'latin' ? 'en' : ''));
        }
        if (typed.itemType === 'journalArticle' && monthIssue && has(fields, 'publicationTitle')
            && !['volume', 'issue', 'ISSN', 'DOI'].some(field => has(fields, field))) {
            setType(typed, 'magazineArticle');
            notes.itemType = '한 호가 달로만 이름 붙었고(권·호의 번호·ISSN·DOI 없음) 학술지 논문이 아니라 잡지 기사로 봅니다.';
            for (const field of fieldsTheTypeDoesNotHold(fields, 'magazineArticle'))
                drop(field, `잡지 기사에는 ${field} 칸이 없습니다.`);
        }
        const application = typed.itemType === 'patent' && has(fields, 'patentNumber') ? null : patentApplicationOnThePages(context.evidence);
        if (application) {
            if (typed.itemType !== 'patent') {
                notes.itemType = `특허 출원서(「특허청장에게 제출합니다」, 발명의 명칭·발명자 칸)라 특허로 봅니다 — 판독: ${typed.itemType}.`;
                setType(typed, 'patent');
            }
            const invention = body === 'latin' ? application.english || application.title : application.title || application.english;
            if (invention && foldedLetters(fields.title) !== foldedLetters(invention)) {
                notes.title = `출원서의 「발명의 명칭」 칸 「${invention.slice(0, 60)}」${has(fields, 'title') ? ` — 판독 「${String(fields.title).slice(0, 60)}」 대신` : ''}.`;
                fields.title = invention;
            }
            const held = (record.creators || []).filter((person: any) => person?.fieldMode !== 1);
            const names = held.map((person: any) => `${person.lastName ?? ''}${person.firstName ?? ''}`.replace(/\s+/g, ''));
            const continued = application.inventors.length > names.length && names.every((name, at) => name === application.inventors[at]);
            const inventors = continued || (!held.length && application.inventors.length) ? application.inventors.map(koreanPerson) : held;
            if (continued)
                notes.creators = `출원서의 발명자 칸(${application.inventors.length}명, 다음 쪽까지)을 모두 적었습니다.`;
            if (inventors.length)
                record = { ...record, creators: inventors.map((person: any) => { const { creatorTypeID, ...rest } = person; return { ...rest, creatorType: 'inventor' }; }) };
            if (application.assignee && !has(fields, 'assignee'))
                fields.assignee = application.assignee;
            if (!has(fields, 'issuingAuthority') && (application.authority || has(fields, 'publisher')))
                fields.issuingAuthority = application.authority || fields.publisher;
            const country = inidCountryOf(pages) || jurisdictionOf(application.authority)?.country || '';
            if (country && !has(fields, 'country'))
                fields.country = country;
            if (application.applicationNumber && !has(fields, 'applicationNumber'))
                fields.applicationNumber = application.applicationNumber;
            if (application.filingDate && !has(fields, 'filingDate'))
                fields.filingDate = application.filingDate;
            if (!has(fields, 'legalStatus'))
                fields.legalStatus = '출원';
            if (has(fields, 'date') && !has(fields, 'issueDate'))
                drop('date', `「${fields.date}」은 출원서가 찍은 발행일이 아닙니다 — 출원서에는 공고·등록일이 없습니다.`);
            for (const field of fieldsTheTypeDoesNotHold(fields, 'patent'))
                drop(field, `특허에는 ${field} 칸이 없습니다.`);
        }
        let bannerKind = '';
        if (has(fields, 'title') && ['report', 'document'].includes(typed.itemType)) {
            const read = String(fields.title).trim();
            const spaced = read.replace(/(?<=\p{Ll})(?=\p{Lu})/gu, ' ');
            const layer = readableLayerPages(context.evidence).map(page => page.text).join('\n');
            if ((namesADocumentKind(spaced) || INFORMATION_SHEET.test(spaced)) && layer.trim() && !titleSupportedByPDF(read, layer) && !titleSupportedByPDF(spaced, layer)
                && !linesOf(layer).some(line => foldedLetters(line) === foldedLetters(spaced))) {
                const block = titleBlocksOf(pageStructureOf(context.evidence)).find(entry => entry.reading === 'layer' && !!entry.main.text.trim()
                    && !isNotATitle(entry.main.text) && !namesADocumentKind(entry.main.text) && !INFORMATION_SHEET.test(entry.main.text.replace(/\s+/g, ' ').trim()));
                if (block) {
                    fields.title = block.main.text.replace(/\s+/g, ' ').trim();
                    bannerKind = genreCased(spaced);
                    if (!has(fields, 'reportType') && typed.itemType === 'report')
                        fields.reportType = bannerKind;
                    appendNote('title', `판독한 제목 「${noteExcerpt(read)}」은 문서의 종류(쪽 그림의 띠)입니다 — 글자층에 찍히지 않았고, 글자층의 제목 덩이 「${noteExcerpt(fields.title)}」로 적었습니다.`);
                }
            }
        }
        technicalDocument(typed, fields, notes, context.evidence, drop);
        if (typed.itemType === 'report' && has(fields, 'title')) {
            const title = String(fields.title);
            const cut = /\s*[:：]\s+|\s+[-–—]\s+/u.exec(title);
            const tail = cut && cut.index > 0 ? title.slice(cut.index + cut[0].length).trim() : '';
            if (tail && namesADocumentKind(tail) && !/[:：]|\s[-–—]\s/u.test(tail)) {
                fields.title = title.slice(0, cut!.index).trim();
                if (!has(fields, 'reportType'))
                    fields.reportType = genreCased(tail);
                appendNote('title', `제목 끝의 「${tail}」은 문서의 종류입니다 — 부제가 아니라 보고서 종류 칸의 값이라 제목에서 뗐습니다.`);
            }
        }
        if (typed.itemType === 'report' && has(fields, 'title') && has(fields, 'reportType')) {
            const joined = `${String(fields.title).trim()} ${String(fields.reportType).trim()}`;
            const key = foldedLetters(joined);
            const printedWhole = foldedLetters(fields.title) !== key && titleBlocksOf(pageStructureOf(context.evidence))
                .some(block => block.reading === 'layer' && block.basis === 'layout' && foldedLetters(block.main.text) === key);
            if (printedWhole) {
                fields.title = joined;
                appendNote('title', `쪽의 제목 덩이가 「${joined.slice(0, 80)}」을 한 제목으로 찍었습니다 — 문서의 종류 「${fields.reportType}」은 제목의 일부라 이어 적었습니다.`);
            }
        }
        reportOfAnIssuingBody(typed, record, fields, notes, context.evidence, articleCoordinates, drop);
        if (typed.itemType === 'report' && bannerKind && !has(fields, 'reportType'))
            fields.reportType = bannerKind;
        productSheet(typed, fields, notes, context.evidence, drop);
    }
    if (typed.itemType !== 'thesis' && has(fields, 'thesisType'))
        delete fields.thesisType;
    if (bodyFromSerial) {
        if (typed.itemType === 'report') {
            if (!has(fields, 'institution')) {
                const moved = movedInto('institution', bodyFromSerial);
                if (moved)
                    fields.institution = moved;
            }
        }
        else if (!has(fields, 'publisher')) {
            const moved = movedInto('publisher', bodyFromSerial);
            if (moved)
                fields.publisher = moved;
        }
    }
    const societyMoved = societyOfTheSerial && typed.itemType !== 'report' && !has(fields, 'publisher') ? movedInto('publisher', societyOfTheSerial) : '';
    if (societyMoved) {
        fields.publisher = societyMoved;
        notes.publisher = `쪽이 학회의 학술지(「${fields.publicationTitle}」)를 찍고 있어, 학술지명 자리에 있던 「${societyOfTheSerial}」을 발행처로 둡니다.`;
    }
    {
        const held = String(fields.publicationTitle || '').trim();
        if (held && /[가-힣]/.test(held)) {
            const flatPages = pages.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
            const printedOnThePages = (value: string) => { const flat = value.normalize('NFKC').replace(/\s+/g, '').toLowerCase(); return flat.length >= 4 && flatPages.includes(flat); };
            const english = englishHalfOfABilingualName(held, fields)
                || (context.evidence?.links || []).filter(link => link?.relation === 'sameEdition' && !/^google/i.test(String(link.provider || '')))
                    .map(link => String(link.stated?.publicationTitle?.value ?? '').replace(/\s+/g, ' ').trim())
                    .find(name => !!name && !/[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name) && /\p{Script=Latin}{3}/u.test(name) && printedOnThePages(name))
                || englishSerialNameOnThePages(context.evidence, fields, held);
            if (english) {
                notes.publicationTitle = `학술지 이름은 쪽이 찍은 영문 이름 「${english}」으로 적었습니다 — 「${held}」 대신(학술지명에는 영문 사용).`;
                fields.publicationTitle = english;
            }
        }
    }
    if (body === 'hangul') {
        const flatPages = pages.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
        const printedName = (value: string) => { const flat = value.normalize('NFKC').replace(/\s+/g, '').toLowerCase(); return flat.length >= 2 && flatPages.includes(flat); };
        const hangul = (value: string) => /[가-힣]/.test(value);
        const organisation = (value: string) => isOrganisationName(value.replace(/\s+/g, '')) || isOrganisationOnly(value);
        const heldJournal = String(fields.publicationTitle || '').trim();
        if (heldJournal && !hangul(heldJournal) && !printedName(heldJournal)) {
            const printed = serialNameInAnIssueStatement(context.evidence, fields);
            if (printed) {
                notes.publicationTitle = `본문이 한글이라 쪽의 한 호 표시에 찍힌 학술지 이름 「${printed}」을 씁니다 — 「${heldJournal}」는 이 문서에 찍혀 있지 않습니다.`;
                fields.publicationTitle = printed;
            }
        }
        const journal = String(fields.publicationTitle || '').replace(/\s+/g, '');
        const stem = journal && printedName(journal) ? /^(.{2,40}?)(?:지|논문지|논문집|회보)$/.exec(journal)?.[1] || '' : '';
        const local = [societyOfTheSerial, stem].find(name => !!name && hangul(name) && printedName(name) && organisation(name));
        const field = typed.itemType === 'report' ? 'institution' : typed.itemType === 'thesis' ? 'university' : 'publisher';
        const held = String(fields[field] ?? '').trim();
        if (local && held && !hangul(held) && !printedName(held)) {
            notes[field] = `본문이 한글이라 쪽에 찍힌 한글 이름 「${local}」을 씁니다 — 「${held}」는 이 문서에 찍혀 있지 않습니다.`;
            fields[field] = local;
        }
    }
    if (typed.itemType === 'report' && has(fields, 'institution')) {
        const held = String(fields.institution);
        const instead = coverInstitutionInsteadOf(held, context.evidence);
        if (instead) {
            notes.institution = instead.as === 'leadBody'
                ? `표지(발행 자리)가 찍은 기관 「${instead.cover}」 — 「${held.slice(0, 60)}」은 이 문서가 주관(연구)기관으로 찍은 이름입니다(표지 기관과 주관기관이 다르면 표지 기관).`
                : `표지(발행 자리)가 찍은 기관 「${instead.cover}」 — 「${held.slice(0, 60)}」은 이 문서가 받는 곳(귀하)·과제를 맡긴 곳·연구비 기관으로만 찍은 이름입니다.`;
            fields.institution = instead.cover;
        }
    }
    if (typed.itemType === 'report' && has(fields, 'institution')) {
        const held = String(fields.institution);
        const instead = institutionOverARightsHolder(held, context.evidence);
        if (instead) {
            appendNote('institution', `「${held.slice(0, 60)}」은 문서가 권리 줄의 권리자로 찍은 이름입니다 — ${instead.from}가 같은 곳을 「${instead.name.slice(0, 60)}」로 찍어 그것으로 적었습니다.`);
            fields.institution = instead.name;
            const people = (record.creators || []) as any[];
            if (people.length === 1 && people[0]?.fieldMode === 1 && foldedLetters(people[0]?.lastName) === foldedLetters(held))
                record = { ...record, creators: [{ ...people[0], lastName: instead.name }] };
        }
    }
    if (has(fields, 'institution') && sponsorOnly(String(fields.institution), context.evidence)) {
        drop('institution', `문서는 「${String(fields.institution).slice(0, 60)}」을 연구비 기관(전담기관·지원기관·Funded by …)으로 찍습니다 — 기관 칸의 후보가 아닙니다.`);
    }
    if (typed.itemType === 'report') {
        if (!has(fields, 'institution')) {
            const issuer = issuerOnTheCover(context.evidence);
            if (issuer) {
                fields.institution = issuer;
                notes.institution = `표지에 찍힌 발행 기관 「${issuer}」.`;
            }
            else {
                const furniture = issuerInThePageFurniture(context.evidence);
                if (furniture) {
                    fields.institution = furniture;
                    notes.institution = `쪽 머리·꼬리에 찍힌 발행 기관 「${furniture}」.`;
                }
            }
        }
        if (!(record.creators || []).length && has(fields, 'institution')) {
            record = { ...record, creators: [{ lastName: String(fields.institution), firstName: '', fieldMode: 1, creatorType: 'author' }] };
            notes.creators = `사람 저자가 없어 발행 기관 「${fields.institution}」을 저자로 둡니다.`;
        }
    }
    if (['book', 'document'].includes(typed.itemType) && has(fields, 'title')) {
        const stated = statementsOf(context.evidence);
        const seriesNamed = stated.series.some(entry => foldedLetters(entry.of) === foldedLetters(fields.title));
        const volume = stated.volume?.number || (!seriesNamed && volumeLineBelowTheTitle(fields.title, context.evidence)?.number) || '';
        const title = String(fields.title);
        if (volume && !new RegExp(`(?:\\s|제\\s*)${volume}\\s*(?:권)?$`).test(title)) {
            fields.title = `${title} ${volume}`;
            appendNote('title', `표지의 권차 「제${volume}권」을 제목에 붙였습니다.`);
        }
        if (volume && typed.itemType === 'book' && !has(fields, 'volume'))
            fields.volume = volume;
        if (volume) {
            const printed = new Set(ownISBNs((context.evidence?.observations || []).filter(o => ['pdfText', 'ocrText'].includes(o.kind)).map(o => String(o.text || ''))));
            if (has(fields, 'ISBN') && !isbnsIn(fields.ISBN).some(isbn => printed.has(isbn)))
                drop('ISBN', `여러 권 중 제${volume}권 — 목록 기록의 ISBN 「${fields.ISBN}」은 쪽에 찍히지 않아 다른 권의 것일 수 있습니다.`);
            const own = new Set([stated.ownRange?.last, documentExtent(context.evidence) - pageStructureOf(context.evidence).leadingLeaves].filter(count => Number(count) > 0).map(String));
            if (has(fields, 'numPages') && !own.has(String(fields.numPages).trim()))
                drop('numPages', `여러 권 중 제${volume}권 — 목록 기록의 쪽수는 다른 권의 것일 수 있습니다.`);
        }
    }
    if (typed.itemType === 'thesis') {
        const cover = thesisDateOnTheCover(context.evidence);
        const held = has(fields, 'date') ? canonicalDate(String(fields.date)) || '' : '';
        const kept = !!cover && !!held && (held === cover.value || (held.startsWith(cover.value) && held.length > cover.value.length));
        if (cover && !kept) {
            const where = `${cover.page}쪽 ${cover.from === 'spine' ? '표지의 책등' : '앞표지'}가 찍은 「${cover.raw.trim().slice(0, 40)}」`;
            appendNote('date', !held ? `학위논문의 날짜는 표지면의 날짜입니다 — ${where}.`
                : cover.value.startsWith(held) ? `표지면이 찍은 같은 해의 날짜 — ${where}로 적었습니다.`
                    : `학위논문의 날짜는 표지면의 날짜입니다 — ${where}(판독 「${fields.date}」 대신 — 제출면·인준면·목록의 날짜보다 먼저).`);
            fields.date = cover.value;
        }
    }
    if (['thesis', 'report'].includes(typed.itemType) && /^(?:19|20)\d{2}$/.test(String(fields.date || ''))) {
        const year = String(fields.date);
        const own = statementsOf(context.evidence).thisEdition.date;
        const value = own?.date && own.date.precision !== 'year' && own.date.value.startsWith(`${year}-`) ? own.date.value : '';
        const month = value ? Number(value.slice(5, 7)) : 0;
        if (month >= 1 && month <= 12) {
            fields.date = `${year}-${String(month).padStart(2, '0')}`;
            notes.date = `표지에 찍힌 「${own!.raw.trim().slice(0, 40)}」로 발행 연월을 채웠습니다.`;
        }
    }
    const slot = CONTAINER_OF[typed.itemType];
    if (slot && !has(fields, slot)) {
        const from = CONTAINER_FIELDS.find(field => field !== slot && has(fields, field));
        if (from && (slot !== 'university' || universityName(fields[from]))) {
            fields[slot] = fields[from];
            delete fields[from];
        }
    }
    for (const field of CATALOGUE_TITLE_FIELDS) {
        if (!has(fields, field) || typeof fields[field] !== 'string')
            continue;
        const held = String(fields[field]);
        const bare = withoutCatalogueMarks(held, fields.language, pages);
        if (bare && bare !== held) {
            fields[field] = bare;
            appendNote(field, `「${held.slice(0, 60)}」의 띄운 쌍점·끝 구두점은 도서관 목록의 구두점(ISBD)입니다 — 쪽이 찍는 부제 표 「: 」로 「${bare.slice(0, 60)}」라 적었습니다.`);
        }
    }
    const decided = typed.itemType !== namedType;
    if (Array.isArray(record.creators) && record.creators.length)
        record = { ...record, creators: record.creators.map(nameAsStored) };
    return { record: { ...record, itemType: typed.itemType, itemTypeID: typed.itemTypeID, fields, ...(decided ? { typeRead: true } : {}) }, notes,
        ...(refusedTitle && !has(fields, 'title') ? { refusedTitle } : {}) };
}

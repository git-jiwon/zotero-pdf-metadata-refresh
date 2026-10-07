import { isLabelTitle, titleCore, titleSimilarity } from '../metadata/match';
import { journalKey } from '../recognition/folded-letters';
import { layerFoliosLostLeadingDigits, volumeDesignator, volumeNumber } from '../recognition/roles';
import { namesAsContainer, ownISBNs, printsTitleAsALine, titleSupportedByPDF } from '../recognition/pdf-identifiers';
import { isbnsIn, normalizedISBN } from '../metadata/identifier-compare';
import { isInstitutionName, isNotATitle, isOrganisationOnly, withoutGenreTag } from '../recognition/title-guards';
import { rowIsByline } from '../recognition/byline-row';
import { alternationOf, wordsOf } from '../recognition/label-words';
import { EDITION_DESCRIPTION_FIELDS, isAnInstitutionNotASerial, movedStatement, statementOf, placeTheDocumentStatesInsteadOf, publisherInTheContainerSlot, recordContradictsTheDocument, templateDOI, titleFailsContract, titleUnderContract } from '../batch/field-contract';
import { sameStatement } from '../batch/source-merge';
import { observation, type EvidenceBundle } from '../batch/evidence';
import { bylineName, type DocumentClues } from './clues';
import { printedPerson, sameName } from '../metadata/name-equivalence';
import type { ExternalRecord, PublicationStage } from './records';
export type Relation = 'sameEdition' | 'sameWork' | 'unknown' | 'conflict';
export interface LinkDecision {
    relation: Relation;
    evidence: string[];
    conflicts: string[];
    identifierMatch: boolean;
    titleScore: number;
    rule: string;
    notes?: string[];
    fit?: {
        titleLine: boolean;
        missingPeople: number;
        exactYear: boolean;
    };
}
const letters = (value: unknown) => String(value ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export function onePerPerson<T>(creators: T[]): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const person of creators || []) {
        const entry = person as any;
        const key = [letters(entry?.lastName ?? entry?.name), letters(entry?.firstName), String(entry?.creatorType || "")].join("|");
        if (key === "||" || seen.has(key))
            continue;
        seen.add(key);
        out.push(person);
    }
    return out;
}
const surnameIn = (text: string, surname: string) => printedPerson(text, { lastName: surname });
const personLetters = (person: any) => letters(bylineName(person));
const scriptOf = (value: string) => /[가-힣]/.test(value) ? 'hangul' : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value) ? 'cjk' : 'latin';
function bodyIsIn(script: 'hangul' | 'cjk', text: string): boolean {
    if (!text.trim())
        return true;
    const own = (text.match(script === 'hangul' ? /[가-힣]/g : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    return own > latin * 0.2;
}
export function editionKey(value: unknown): string {
    const ORDINAL: Record<string, string> = { first: '1', second: '2', third: '3', fourth: '4', fifth: '5', sixth: '6', seventh: '7', eighth: '8', ninth: '9', tenth: '10' };
    let text = String(value ?? '').normalize('NFKC').toLowerCase().trim();
    for (const [word, digit] of Object.entries(ORDINAL))
        text = text.replace(new RegExp(`\\b${word}\\b`, 'g'), digit);
    text = text.replace(/(\d+)(?:st|nd|rd|th)\b/g, '$1').replace(/\b(?:ed|edn|edition|revised|rev)\b\.?/g, ' ').replace(/제|판/g, ' ');
    return text.replace(/[^\p{L}\p{N}]+/gu, '');
}
export function printedOnPage(value: unknown, text: string, ocr = false, except: unknown[] = []): boolean {
    const needle = letters(value);
    if (needle.length < 4)
        return false;
    let pieces = [letters(text)];
    for (const other of except) {
        const key = letters(other);
        if (key.length >= 4)
            pieces = pieces.flatMap(piece => piece.split(key));
    }
    if (pieces.some(hay => hay.includes(needle)))
        return true;
    if (!ocr || needle.length < 8)
        return false;
    let page = String(text || '');
    for (const other of except) {
        const name = String(other ?? '').trim();
        if (letters(name).length >= 4)
            page = page.split(name).join(' | ');
    }
    return printedPerson(page, String(value ?? ''), { ocr: true });
}
const containerNames = (record: ExternalRecord) => [record.fields?.publicationTitle, record.fields?.journalAbbreviation].filter(name => letters(name).length >= 4);
const PUBLISHER_LABEL = new RegExp(`(?:${alternationOf([...wordsOf(['publisherHouse', 'issuer'], 'label'), ...wordsOf(['publisherHouse'], 'lead')], 'label')})\\s*[:：]?\\s*`, 'giu');
function statedAsPublisher(name: string, text: string): boolean {
    const target = letters(name);
    if (target.length < 4)
        return false;
    const page = String(text || '').normalize('NFKC');
    for (const match of page.matchAll(PUBLISHER_LABEL)) {
        const from = (match.index ?? 0) + match[0].length;
        if (letters(page.slice(from, from + name.length + 40)).startsWith(target))
            return true;
    }
    return false;
}
function publisherPrinted(publisher: string, record: ExternalRecord, text: string, ocr: boolean, titleShape = true): boolean {
    const containers = containerNames(record);
    if (printedOnPage(publisher, text, ocr, containers) || statedAsPublisher(publisher, text))
        return true;
    const key = letters(publisher);
    return titleShape && !containers.some(name => letters(name).includes(key)) && titleSupportedByPDF(publisher, text);
}
export function looksLikeLabel(title: unknown): boolean {
    const text = String(title ?? '').trim();
    return !text || isLabelTitle(text);
}
export function tailAfterLetters(value: string, count: number): string {
    let seen = 0;
    const normalized = value.normalize('NFKC');
    if (count <= 0)
        return normalized.trim();
    for (let index = 0; index < normalized.length; index++) {
        seen += letters(normalized[index]).length;
        if (seen >= count)
            return normalized.slice(index + 1).trim();
    }
    return '';
}
export function readingWrapsTitle(reading: unknown, title: unknown, surnames: unknown[]): {
    head: string;
    tail: string;
} | null {
    const r = letters(reading), t = letters(titleCore(title));
    if (!r || !t || t.length < 12 || r.length <= t.length)
        return null;
    let at = r.indexOf(t);
    let end = at >= 0 ? at + t.length : -1;
    if (at < 0) {
        const words = String(title ?? '').normalize('NFKC').split(/[^\p{L}\p{N}]+/u).map(word => word.toLowerCase()).filter(word => word.length >= 3);
        if (words.length < 3)
            return null;
        let cursor = 0, matched = 0, first = -1, last = -1;
        for (const word of words) {
            const found = r.indexOf(word, cursor);
            if (found < 0)
                continue;
            if (first < 0)
                first = found;
            matched++;
            cursor = found + word.length;
            last = cursor;
        }
        if (first < 0 || matched / words.length < 0.85)
            return null;
        at = first;
        end = last;
    }
    if (at > 8)
        return null;
    const tail = tailAfterLetters(String(reading), end);
    const names = surnames.map(name => letters(name)).filter(name => name.length >= 2);
    const namesInTail = !!tail && (names.some(name => letters(tail).includes(name)) || rowIsByline(tail, 'strict'));
    if (!tail || !namesInTail)
        return null;
    return { head: r.slice(0, at), tail };
}
export function titlesAgree(left: unknown, right: unknown): boolean {
    const a = letters(left), b = letters(right);
    if (!a || !b)
        return false;
    if (a === b)
        return true;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    return short.length >= 6 && long.startsWith(short);
}
export { journalKey };
export function journalNamesAgree(printed: unknown, container: unknown, abbreviation?: unknown): boolean {
    const page = String(printed || '').normalize('NFKC').trim();
    if (!page)
        return false;
    const targets = [container, abbreviation].map(value => String(value || '').normalize('NFKC').trim()).filter(Boolean);
    if (!targets.length)
        return false;
    if (targets.some(target => letters(target) === letters(page)))
        return true;
    const key = journalKey(page);
    if (key.length >= 4 && targets.some(target => journalKey(target) === key))
        return true;
    const words = page.toLowerCase().replace(/\./g, '').split(/[\s,]+/).filter(Boolean);
    for (const target of targets) {
        const full = target.toLowerCase().split(/[\s,]+/).filter(word => !['of', 'the', 'and', 'for', 'in', 'on', 'de', 'la', '&'].includes(word));
        let at = 0;
        let matched = 0;
        for (const word of words) {
            while (at < full.length && !full[at].startsWith(word))
                at++;
            if (at >= full.length)
                break;
            matched++;
            at++;
        }
        if (matched === words.length && words.length >= 2)
            return true;
    }
    return false;
}
export function locatorParts(raw: unknown): string[] {
    return String(raw ?? '').normalize('NFKC').replace(/[–—~−]/g, '-')
        .split('-').map(part => part.trim().replace(/^0+(?=\d)/, '')).filter(Boolean);
}
export function locatorShaped(value: unknown): boolean {
    const text = String(value ?? '').normalize('NFKC').trim();
    return text.length <= 40 && /^[A-Za-z]{0,2}\d{1,8}(?:\s*[-–—−~]\s*[A-Za-z]{0,2}\d{1,8})?$/.test(text);
}
export function sameLocator(left: unknown, right: unknown): boolean {
    const a = locatorParts(left), b = locatorParts(right);
    return a.length > 0 && a.length === b.length && a.every((part, index) => part === b[index]);
}
export function locatorsAgree(field: string, read: unknown, stated: unknown): boolean {
    if (!String(read ?? '').trim() || !String(stated ?? '').trim())
        return true;
    if (sameLocator(read, stated))
        return true;
    if (field !== 'pages')
        return false;
    const opensAt = (range: unknown, page: unknown) => {
        const ends = locatorParts(range);
        const one = String(page ?? '').normalize('NFKC').trim().replace(/^0+(?=\d)/, '');
        return ends.length === 2 && !!one && !one.includes('-') && ends[0] === one;
    };
    return opensAt(read, stated) || opensAt(stated, read);
}
export function agreesOnCoordinates(other: ExternalRecord, target: ExternalRecord): boolean {
    const a = other.fields, b = target.fields;
    if (a.publicationTitle && b.publicationTitle
        && !journalNamesAgree(a.publicationTitle, b.publicationTitle, b.journalAbbreviation)
        && !journalNamesAgree(b.publicationTitle, a.publicationTitle, a.journalAbbreviation)
        && !letters(a.publicationTitle).includes(letters(b.publicationTitle))
        && !letters(b.publicationTitle).includes(letters(a.publicationTitle)))
        return false;
    return (['volume', 'issue', 'pages'] as const).every(field => locatorsAgree(field, a[field], b[field]));
}
function bylineAgreement(record: ExternalRecord, text: string, pageNames: string[] = []): {
    families: string[];
    named: string[];
    across: string[];
    authorsAgree: boolean | null;
} {
    const families = (record.creators || []).map(bylineName).filter(name => name.length >= 2);
    const across: string[] = [];
    const named = families.filter(name => {
        if (surnameIn(text, name))
            return true;
        const printed = pageNames.find(page => sameName({ lastName: page }, { lastName: name }, 'link'));
        if (printed)
            across.push(`${name} = ${printed}`);
        return !!printed;
    });
    return { families, named, across, authorsAgree: families.length ? named.length >= Math.max(1, Math.ceil(families.length / 2)) : null };
}
const nameFold = (value: unknown) => String(value ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
    .replace(/ø/g, 'o').replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/ß/g, 'ss').replace(/ł/g, 'l').replace(/đ/g, 'd').replace(/ı/g, 'i');
const nameLetters = (value: unknown) => nameFold(value).replace(/[^\p{L}\p{N}]+/gu, '');
function initialsOnly(given: unknown): string {
    const parts = String(given ?? '').normalize('NFKC').split(/[\s.\-‐]+/).filter(Boolean);
    return parts.length && parts.length <= 4 && parts.every(part => nameLetters(part).length === 1) ? parts.map(part => nameLetters(part)).join('') : '';
}
function givenInitialsAgree(given: unknown, otherGiven: unknown): boolean {
    const heads = (value: unknown) => String(value ?? '').normalize('NFKC').split(/[\s.\-‐]+/).map(part => nameLetters(part)[0] || '').filter(Boolean).join('');
    const within = (initials: string, names: string) => { let at = 0; for (const letter of names)
        if (letter === initials[at])
            at++; return at === initials.length; };
    const mine = initialsOnly(given), theirs = initialsOnly(otherGiven);
    return (!!mine && within(mine, heads(otherGiven))) || (!!theirs && within(theirs, heads(given)));
}
function listedInRecord(person: any, people: any[], ocr = false): boolean {
    if (people.some(other => sameName(person, other, 'link')))
        return true;
    const last = nameLetters(person?.lastName ?? person?.name), first = nameLetters(person?.firstName);
    const whole = [nameLetters(`${person?.firstName ?? ''}${person?.lastName ?? person?.name ?? ''}`), nameLetters(`${person?.lastName ?? person?.name ?? ''}${person?.firstName ?? ''}`)];
    return people.some(other => {
        const otherLast = nameLetters(other?.lastName ?? other?.name), otherFirst = nameLetters(other?.firstName);
        const otherWhole = [nameLetters(`${other?.firstName ?? ''}${other?.lastName ?? other?.name ?? ''}`), nameLetters(`${other?.lastName ?? other?.name ?? ''}${other?.firstName ?? ''}`)];
        if (whole.some(form => form.length >= 4 && otherWhole.some(held => held.includes(form))))
            return true;
        const sameLast = !!last && (last === otherLast || (ocr && sameName({ lastName: String(person?.lastName ?? person?.name ?? '') }, { lastName: String(other?.lastName ?? other?.name ?? '') }, 'misreadCorrection')));
        return sameLast && (!first || !otherFirst || first[0] === otherFirst[0] || givenInitialsAgree(person?.firstName, other?.firstName));
    });
}
export function readTitleIsContainer(readTitle: unknown, record: ExternalRecord): boolean {
    const key = letters(readTitle);
    return key.length >= 4 && containerNames(record).some(name => letters(name) === key);
}
export function recordYearOf(date: unknown): string {
    const text = String(date ?? '').normalize('NFKC').trim();
    return /^(?:1[0-9]|20)\d{2}(?!\d)/.test(text) ? text.slice(0, 4) : '';
}
const yearsAgree = (page: string[], record: string | undefined) => {
    const recordYear = recordYearOf(record);
    if (!recordYear || !page.length)
        return null;
    const year = Number(recordYear);
    return page.some(stated => Math.abs(Number(stated) - year) <= 1);
};
const TITLE_END_WORD = /(?:^|[\s,.:;(])([^\s,.:;()]+)\)?$/u;
export function volumeAtTitleEnd(title: unknown): string {
    const text = String(title ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (text.length > 300)
        return '';
    const designated = volumeDesignator(text);
    if (designated && /^\d{1,3}$/.test(designated.number) && designated.before && /^[)\s]*$/.test(designated.after))
        return designated.number;
    const last = TITLE_END_WORD.exec(text);
    if (!last || !text.slice(0, last.index).trim())
        return '';
    const number = /^\d{1,3}$/.test(last[1]) ? last[1] : /^\d{1,3}\D{1,2}$/u.test(last[1]) ? volumeNumber(last[1]) : '';
    return /^\d{1,3}$/.test(number) ? String(Number(number)) : '';
}
const volumeDigits = (value: unknown) => { const found = /^\D{0,12}?(\d{1,4})\D{0,4}$/u.exec(String(value ?? '').normalize('NFKC').trim()); return found ? String(Number(found[1])) : ''; };
export const PART_TYPES = new Set(['journalArticle', 'magazineArticle', 'newspaperArticle', 'conferencePaper', 'bookSection', 'encyclopediaArticle', 'dictionaryEntry']);
export const SERIAL_PART_TYPES = new Set(['journalArticle', 'magazineArticle', 'newspaperArticle']);
export function partRange(value: unknown): [
    number,
    number
] | null {
    const range = /^\s*[A-Za-z]?(\d{1,6})[A-Za-z]?\s*[-‐‑‒–—―−~]\s*[A-Za-z]?(\d{1,6})[A-Za-z]?\s*$/.exec(String(value ?? '').normalize('NFKC'));
    if (!range)
        return null;
    const from = range[1];
    const to = range[2].length < from.length ? from.slice(0, from.length - range[2].length) + range[2] : range[2];
    return Number(to) >= Number(from) ? [Number(from), Number(to)] : null;
}
export function partSpan(value: unknown): number {
    const range = partRange(value);
    return range ? range[1] - range[0] + 1 : 0;
}
export const longerThanThePart = (span: number, pages: number) => span > 0 && pages > 0 && pages > Math.max(3 * span, span + 20);
export function accountOfTheWork(record: ExternalRecord, clues: Pick<DocumentClues, 'documentPages' | 'readType'>): string {
    if (clues.readType !== 'book')
        return '';
    const type = String(record.itemType || '');
    if (!PART_TYPES.has(type))
        return '';
    const fields = record.fields || {};
    const span = partSpan(fields.pages);
    const pages = Number(clues.documentPages) > 0 ? Math.floor(Number(clues.documentPages)) : 0;
    const container = String(fields.publicationTitle || fields.bookTitle || fields.proceedingsTitle || '').trim();
    const where = `${container ? ` in “${container.slice(0, 60)}”` : ''}${fields.pages ? ` (pages ${String(fields.pages).slice(0, 20)})` : ''}`;
    if (longerThanThePart(span, pages)) {
        return `the pages are read as a book of ${pages} pages; the record is a ${span}-page ${type}${where} — a piece within or about the book (a chapter, a review, a notice), not the book`;
    }
    if (SERIAL_PART_TYPES.has(type) && !(span > 0 && pages > 0)) {
        return `the pages are read as a book; the record is a ${type}${where} — a piece about the book (a review, a notice), not the book`;
    }
    return '';
}
export function foundFileOnly(record: Pick<ExternalRecord, 'provider' | 'collected' | 'pageType'>): boolean {
    if (String(record.provider || '').toLowerCase() !== 'google')
        return false;
    const routes = record.collected?.routes;
    if (Array.isArray(routes)) {
        const giving = routes.filter(route => route.fields.some(field => field !== 'url'));
        return !!giving.length && giving.every(route => route.route === 'pdf');
    }
    return /;\s*pdf(?:\s+text)?\)\s*$/i.test(String(record.pageType || ''));
}
export function gluedHeadOf(recordTitle: unknown, readTitle: unknown, label: unknown): string {
    const r = letters(recordTitle), t = letters(readTitle), l = letters(label);
    if (t.length < 12 || l.length < 6 || r.length <= t.length || !r.endsWith(t))
        return '';
    const head = r.slice(0, r.length - t.length);
    return head.includes(l) ? head : '';
}
const ARTICLE_NUMBER = /^[^\S\n]{0,8}(?:[IVXLCDM]{1,8}|\d{1,3})\.[^\S\n]{1,4}(?=\p{Lu})/u;
const TRAILING_BYLINE = /[.,;]?[^\S\n]{1,4}(?:B[^\S\n]?y|BY)[^\S\n]{1,4}\p{Lu}[^\n]{0,160}$/u;
export function withoutArticleNumber(title: unknown): string {
    const value = String(title ?? '');
    const cut = value.replace(ARTICLE_NUMBER, '');
    return cut.trim() ? cut : value;
}
export function titleLinesWithoutNumberAndByline(text: unknown): string {
    return String(text ?? '').split('\n').map(line => line.length > 600 ? line : line.replace(ARTICLE_NUMBER, '').replace(TRAILING_BYLINE, '')).join('\n');
}
const ACCEPTED_FOR_A_FUTURE_ISSUE = /accepted\s+for\s+publication\s+in\s+a\s+future\s+issue|not\s+been\s+fully\s+edited[^\n]{0,60}?content\s+may\s+change\s+prior\s+to\s+final\s+publication/i;
export function judgeLink(clues: DocumentClues, record: ExternalRecord): LinkDecision {
    const evidence: string[] = [];
    const conflicts: string[] = [];
    const versionConflicts: string[] = [];
    const pageDOI = clues.identifiers.DOI?.toLowerCase();
    const recordDOI = record.identifiers.DOI?.toLowerCase();
    const printedDOIs = (clues.printedDOIs || []).map(value => value.toLowerCase());
    let identifierMatch = false;
    if (recordDOI && (pageDOI === recordDOI || printedDOIs.includes(recordDOI))) {
        identifierMatch = true;
        evidence.push(`DOI ${recordDOI} is printed in the opening pages`);
    }
    else if (pageDOI && recordDOI)
        conflicts.push(`the page prints DOI ${pageDOI}, the record is ${recordDOI}`);
    const pageISBN = clues.identifiers.ISBN.map(normalizedISBN);
    const recordISBN = record.identifiers.ISBN.map(normalizedISBN);
    const partRecord = PART_TYPES.has(String(record.itemType || ''));
    if (pageISBN.length && recordISBN.length) {
        const shared = recordISBN.find(isbn => pageISBN.includes(isbn));
        if (shared && partRecord)
            evidence.push(`ISBN ${shared} printed in the pages is the book’s — the record is a ${record.itemType} filed under its container’s number, not an identifier of the part`);
        else if (shared) {
            identifierMatch = true;
            evidence.push(`ISBN ${shared} is printed in the pages`);
        }
        else
            conflicts.push(`the page prints ISBN ${pageISBN.join('/')}, the record is ${recordISBN.join('/')}`);
    }
    const carriedDOI = clues.carried?.DOI?.toLowerCase();
    if (!identifierMatch && carriedDOI && recordDOI === carriedDOI)
        evidence.push(`DOI ${recordDOI} is the one another route’s record states (not printed on the pages read)`);
    const carriedISBN = (clues.carried?.ISBN || []).map(normalizedISBN).find(isbn => recordISBN.includes(isbn));
    if (!identifierMatch && carriedISBN)
        evidence.push(`ISBN ${carriedISBN} is the one another route’s record states (not printed on the pages read)`);
    const scope = clues.scopeOf?.({ itemType: record.itemType, ...record.fields, title: record.title, creators: record.creators });
    if (scope === 'container')
        conflicts.push(`the record is the ${record.itemType || 'work'} this document is a part of — the document’s extent and the range its pages state are one part of it`);
    if (scope === 'part')
        conflicts.push(`the record is one part of this document (pages ${record.fields.pages || '?'}) — the document runs on past it`);
    const account = identifierMatch || scope === 'part' || scope === 'container' ? '' : accountOfTheWork(record, clues);
    if (account)
        conflicts.push(account);
    const titleScore = Math.max(0, ...clues.titles.map(title => titleSimilarity(title, record.title)));
    const recordTitle = String(record.title ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const namesABody = !!recordTitle && (isInstitutionName(recordTitle) || isOrganisationOnly(recordTitle)
        || [clues.institution, clues.publisher, ...clues.surnames].some(name => letters(name).length >= 2 && letters(name) === letters(recordTitle)));
    const ownReading = clues.readTitle || '';
    const resemblesTheReading = !ownReading || scriptOf(ownReading) !== scriptOf(recordTitle) || titleScore >= 0.5;
    const titleOnPage = !!record.title && !namesABody && resemblesTheReading && titleSupportedByPDF(record.title, clues.text);
    const gluedHead = gluedHeadOf(record.title, clues.readTitle, clues.sources?.title?.label);
    const titleAsItsTitle = titleOnPage && !gluedHead;
    if (titleOnPage && gluedHead)
        evidence.push(`the record’s title is the page’s title with the head line above it (“${String(clues.sources?.title?.label ?? '').slice(0, 40)}”) glued in front`);
    else if (titleOnPage)
        evidence.push('the record’s title is printed in the opening pages');
    else if (titleScore >= 0.9)
        evidence.push(`the title as read agrees with the record (${Math.round(titleScore * 100)}%)`);
    const own = readTitleIsContainer(clues.readTitle, record) ? '' : clues.readTitle || '';
    const floor = /[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(own) ? 4 : 12;
    const ownTitle = own.length >= floor && titleSupportedByPDF(own, clues.text) ? own : undefined;
    if (!titleOnPage && record.title && ownTitle && titleScore < 0.5 && scriptOf(ownTitle) === scriptOf(String(record.title))
        && !letters(record.title).includes(letters(ownTitle))) {
        conflicts.push(`the page prints its own title “${ownTitle.slice(0, 60)}”, not the record’s “${String(record.title).slice(0, 60)}”`);
    }
    const pageNames = clues.surnames.filter(name => surnameIn(clues.text, name));
    const { families, named, across, authorsAgree } = bylineAgreement(record, clues.text, pageNames);
    if (families.length && authorsAgree)
        evidence.push(`${named.length} of ${families.length} surnames appear in the by-line region${across.length ? ` (${across.slice(0, 3).join(', ')}: the page prints the name in Hanja, the record in Hangul — same surname reading, same number of syllables)` : ''}`);
    if (families.length && !named.length && pageNames.length)
        conflicts.push(`none of the record’s ${families.length} surnames appear on the page, which names ${pageNames.slice(0, 3).join(', ')}`);
    const pagePeople = (clues.people || []).filter(person => printedPerson(clues.text, person));
    const missingPeople = (record.creators || []).length ? pagePeople.filter(person => !listedInRecord(person, record.creators || [], clues.ocr)) : [];
    const cutLines = titleLinesWithoutNumberAndByline(clues.text);
    const titleLine = !gluedHead && ([record.title, titleUnderContract(record.title), withoutGenreTag(record.title)].some(title => !!title
        && (printsTitleAsALine(clues.text, title) || printsTitleAsALine(cutLines, withoutArticleNumber(title))))
        || (!!clues.readTitle && titlesAgree(clues.readTitle, record.title) && printsTitleAsALine(clues.text, clues.readTitle)));
    const year = yearsAgree(clues.years, record.fields.date);
    const recordYear = recordYearOf(record.fields.date);
    const exactYear = !!recordYear && clues.years.includes(recordYear);
    const latestYear = Math.max(0, ...clues.years.map(Number).filter(Number.isFinite));
    const laterIssue = !exactYear && !!recordYear && !clues.citation && record.itemType === 'journalArticle' && record.publicationStage === 'versionOfRecord'
        && ACCEPTED_FOR_A_FUTURE_ISSUE.test(clues.text.slice(0, 200000)) && Number(recordYear) > latestYear && Number(recordYear) - latestYear <= 2;
    if (year === true)
        evidence.push(exactYear ? `the year ${recordYear} is stated on the front pages` : `the year ${recordYear} is within a year of one the front pages state (${clues.years.join(', ')})`);
    if (laterIssue)
        evidence.push(`the pages are an accepted manuscript for a future issue — the record’s year ${recordYear} is that issue’s, after the manuscript’s ${latestYear}`);
    else if (year === false && !clues.citation)
        versionConflicts.push(`the record’s year ${recordYear} is not among the years the front pages state (${clues.years.join(', ')})`);
    const ownVolume = volumeDigits(clues.volume);
    const documentVolume = ownVolume || clues.locators?.volume || '';
    const volumeFromTitle = !record.fields.volume && clues.kind === 'book' && /^(?:book|bookSection)?$/.test(String(record.itemType || '')) && documentVolume
        ? volumeAtTitleEnd(record.title) : '';
    const recordVolume = record.fields.volume || volumeFromTitle;
    const recordVolumeNumber = volumeDigits(recordVolume);
    const otherVolume = !!ownVolume && !!recordVolumeNumber && ownVolume !== recordVolumeNumber;
    if (otherVolume) {
        versionConflicts.push(volumeFromTitle
            ? `volume ${ownVolume} as the pages state it against volume ${volumeFromTitle} at the end of the record’s title “${String(record.title).slice(0, 60)}” — another volume of the set`
            : `volume ${ownVolume} as the pages state it against volume ${recordVolume} in the record${/^(?:book|bookSection)?$/.test(String(record.itemType || '')) ? ' — another volume of the set' : ''}`);
    }
    let coordinates = false;
    if (clues.citation) {
        const c = clues.citation;
        const volumeOK = !c.volume || !record.fields.volume || c.volume === record.fields.volume;
        const recordPages = locatorShaped(record.fields.pages) ? record.fields.pages : '';
        const pagesOK = !c.pages || !recordPages || locatorsAgree('pages', c.pages, recordPages);
        const issueOK = !c.issue || !record.fields.issue || sameLocator(c.issue, record.fields.issue);
        const yearOK = !c.year || !recordYear || c.year === recordYear;
        const journalOK = !c.journal || (!record.fields.publicationTitle && !record.fields.journalAbbreviation)
            || journalNamesAgree(c.journal, record.fields.publicationTitle, record.fields.journalAbbreviation);
        const located = (c.volume || c.pages) && (record.fields.volume || (!c.volume && !!c.pages && !!recordPages && !!c.year && !!recordYear));
        if (volumeOK && pagesOK && issueOK && yearOK && journalOK && located) {
            coordinates = true;
            evidence.push(`the citation line “${c.raw.slice(0, 60)}” agrees with the record’s ${record.fields.volume ? 'volume, ' : ''}pages and year`);
        }
        else {
            if (!volumeOK)
                versionConflicts.push(`volume ${c.volume} on the page against ${record.fields.volume} in the record`);
            if (!pagesOK)
                versionConflicts.push(`pages ${c.pages} on the page against ${record.fields.pages} in the record`);
            if (!issueOK)
                versionConflicts.push(`issue ${c.issue} on the page against ${record.fields.issue} in the record`);
            if (!yearOK)
                versionConflicts.push(`year ${c.year} in the citation line against ${record.fields.date?.slice(0, 4)}`);
            if (!journalOK && c.journal)
                versionConflicts.push(`journal “${c.journal}” on the page against “${record.fields.publicationTitle}”`);
        }
    }
    if (!identifierMatch && !(letters(clues.held?.DOI) && letters(clues.held?.DOI) === letters(recordDOI))) {
        for (const field of ['volume', 'issue', 'pages'] as const) {
            if (field === 'volume' && ownVolume && recordVolumeNumber)
                continue;
            const read = field === 'volume' ? documentVolume : clues.locators?.[field];
            const stated = field === 'volume' ? recordVolume : field === 'pages' && !locatorShaped(record.fields.pages) ? '' : record.fields[field];
            const readNumber = String(/\d{1,5}/.exec(String(read ?? '').normalize('NFKC'))?.[0] ?? '').replace(/^0+(?=\d)/, '');
            const disagrees = field === 'volume' && volumeFromTitle ? !!readNumber && readNumber !== volumeFromTitle : !locatorsAgree(field, read, stated);
            if (read && disagrees) {
                versionConflicts.push(field === 'volume' && volumeFromTitle
                    ? `volume ${read} as the document reads it against volume ${volumeFromTitle} at the end of the record’s title “${String(record.title).slice(0, 60)}” — another volume of the set`
                    : `${field} ${read} as the document reads it against ${stated} in the record`);
            }
        }
        const range = clues.folios ? partRange(record.fields.pages) : null;
        if (clues.folios && range) {
            const printed = clues.folios.pages.map(page => page + clues.folios!.offset);
            const first = Math.min(...printed), last = Math.max(...printed);
            const lostDigits = layerFoliosLostLeadingDigits({ start: range[0], end: range[1] }, clues.folios, clues.folios.ocr || []);
            if (!lostDigits && printed.some(folio => folio < range[0] || folio > range[1]))
                versionConflicts.push(`the pages print their own page numbers ${first}–${last}, outside ${range[0]}-${range[1]} in the record`);
            else if (clues.folios.pages[0] + clues.folios.offset === range[0] || first === range[0])
                evidence.push(`the pages print their own page numbers ${first}–${last}, opening the record’s ${range[0]}-${range[1]}`);
        }
        const held = clues.held;
        const heldJournal = held?.publicationTitle || '', recordJournal = record.fields.publicationTitle || '';
        if (heldJournal && recordJournal && (held?.volume || held?.issue || held?.pages)
            && scriptOf(heldJournal) === scriptOf(recordJournal)
            && !journalNamesAgree(heldJournal, recordJournal, record.fields.journalAbbreviation)
            && !journalNamesAgree(recordJournal, heldJournal, held?.journalAbbreviation)
            && !letters(heldJournal).includes(letters(recordJournal))
            && !letters(recordJournal).includes(letters(heldJournal))) {
            versionConflicts.push(`the row holds container “${heldJournal}”, the record “${recordJournal}”`);
        }
        if (held?.volume && record.fields.volume && !sameLocator(held.volume, record.fields.volume)) {
            versionConflicts.push(`the row holds volume ${held.volume}, the record ${record.fields.volume}`);
        }
    }
    const notes: string[] = [];
    const publisherRead = String(clues.sources?.publisher?.from || '');
    const publisherFirm = !clues.ocr && ['publishedBy', 'imprintStatement', 'titlePageImprint'].includes(publisherRead);
    if (clues.publisher && record.fields.publisher) {
        const recordPublisher = String(record.fields.publisher).split(/\s*;\s*/).pop() || record.fields.publisher;
        if (letters(recordPublisher).includes(letters(clues.publisher)) || letters(clues.publisher).includes(letters(recordPublisher)))
            evidence.push(`publisher ${recordPublisher} is the one the page names`);
        else if (publisherPrinted(recordPublisher, record, clues.text, clues.ocr, false))
            evidence.push(`publisher ${recordPublisher} is printed on the page (the reader had taken “${clues.publisher}”)`);
        else if (publisherFirm)
            conflicts.push(`publisher ${clues.publisher} on the page against ${recordPublisher}`);
        else
            notes.push(`publisher read as “${clues.publisher}” (${publisherRead || 'unlabelled'}${clues.ocr ? ', OCR' : ''}) differs from ${recordPublisher}`);
    }
    if (clues.edition && record.fields.edition && editionKey(clues.edition) !== editionKey(record.fields.edition)) {
        if (clues.ocr)
            notes.push(`edition read as “${clues.edition}” (OCR) differs from ${record.fields.edition}`);
        else
            conflicts.push(`edition ${clues.edition} on the page against ${record.fields.edition}`);
    }
    else if (clues.edition && record.fields.edition)
        evidence.push(`edition ${record.fields.edition} is the one the page states`);
    else if (clues.kind === 'book' && clues.edition && !record.fields.edition && !identifierMatch) {
        const stated = Number(/^\d+/.exec(editionKey(clues.edition))?.[0] || 0);
        if (stated >= 2)
            versionConflicts.push(`the page states edition ${clues.edition}; the record states no edition`);
    }
    const body = record.fields.institution || record.fields.university || (record.itemType === 'report' ? record.fields.publisher : '');
    let bodyAgree = false;
    if (body && clues.institution) {
        bodyAgree = letters(body).includes(letters(clues.institution)) || letters(clues.institution).includes(letters(body));
        if (bodyAgree)
            evidence.push(`issuing body ${body} is the one the page names`);
    }
    if (body && !bodyAgree && printedOnPage(body, clues.text, clues.ocr)) {
        bodyAgree = true;
        evidence.push(`issuing body ${body} is printed on the page`);
    }
    const publishedForm = /^(?:journalArticle|conferencePaper|bookSection|magazineArticle)$/.test(record.itemType);
    if (record.form === 'ebook' && clues.identifiers.ISBN.length && !identifierMatch)
        conflicts.push('the record is an e-book form the page does not print an ISBN for');
    const titleTie = titleOnPage || titleScore >= (clues.ocr ? 0.75 : 0.9);
    const editionTitleTie = titleTie && !gluedHead;
    const sameVersion = !versionConflicts.length;
    let relation: Relation = 'unknown';
    let rule = 'nothing ties the record to the page';
    if (conflicts.length && !identifierMatch) {
        relation = 'conflict';
        rule = conflicts[0];
    }
    else if (identifierMatch && !conflicts.length && sameVersion && (titleTie || authorsAgree || coordinates || clues.kind === 'book')) {
        relation = 'sameEdition';
        rule = 'identifier printed on the page, nothing disagreeing';
    }
    else if (identifierMatch && (conflicts.length || versionConflicts.length)) {
        relation = 'sameWork';
        rule = `identifier printed on the page, but ${(conflicts[0] || versionConflicts[0])}`;
    }
    else if (coordinates && (titleTie || authorsAgree)) {
        relation = 'sameEdition';
        rule = 'citation coordinates on the page, with the title or the by-line';
    }
    else if (clues.kind === 'thesis' && publishedForm && titleTie) {
        relation = 'sameWork';
        rule = `a published version of the thesis work (${record.itemType}), not the thesis itself`;
    }
    else if (sameVersion && clues.kind === 'book' && editionTitleTie && authorsAgree && year === true && (clues.publisher && publisherFirm ? evidence.some(e => e.startsWith('publisher')) : true)) {
        relation = 'sameEdition';
        rule = 'title, by-line, year and publisher agree — no identifier printed';
    }
    else if (sameVersion && clues.kind === 'book' && clues.ocr && editionTitleTie && authorsAgree && year === null && !conflicts.length) {
        relation = 'sameEdition';
        rule = 'title (as OCR read it) and by-line agree; the page states no year — a scanned book';
    }
    else if (sameVersion && clues.kind === 'report' && (titleAsItsTitle || (!gluedHead && titleScore >= 0.97)) && bodyAgree && year !== false) {
        relation = 'sameEdition';
        rule = 'title and issuing body agree — a report';
    }
    else if (sameVersion && clues.kind === 'thesis' && !publishedForm && editionTitleTie && (authorsAgree || bodyAgree) && year !== false) {
        relation = 'sameEdition';
        rule = 'title with the by-line or the awarding institution — a thesis';
    }
    else if (sameVersion && clues.kind !== 'book' && titleAsItsTitle && titleLine && authorsAgree && !missingPeople.length && exactYear && !clues.citation) {
        relation = 'sameEdition';
        rule = 'title printed on the page as its title line, the whole by-line and the year agree; no citation line to check';
    }
    else if (sameVersion && clues.kind !== 'book' && titleAsItsTitle && titleLine && authorsAgree && !missingPeople.length && laterIssue) {
        relation = 'sameEdition';
        rule = 'an accepted manuscript for a future issue: its title line and the whole by-line agree with the journal’s version of record of that issue';
    }
    else if (sameVersion && clues.kind === 'article' && publishedForm && record.publicationStage === 'versionOfRecord' && titleAsItsTitle && authorsAgree && year === null && !clues.citation && !conflicts.length) {
        relation = 'sameEdition';
        rule = 'title printed on the page and by-line agree; the page states no year, and the record is the version of record';
    }
    else if (titleTie && (authorsAgree || year === true || versionConflicts.length)) {
        relation = 'sameWork';
        const short = [
            ...(titleOnPage && gluedHead ? ['the record’s title carries the page’s head line in front of the title'] : titleOnPage && !titleLine ? ['the record’s title is not one of the page’s title lines'] : []),
            ...(missingPeople.length ? [`the page’s by-line names ${missingPeople.slice(0, 3).map(person => [person.firstName, person.lastName].filter(Boolean).join(' ')).join(', ')}, whom the record does not list`] : []),
            ...(year === true && !exactYear ? [`the record’s year ${recordYear} is a year off the front pages’ (${clues.years.join(', ')})`] : [])
        ];
        rule = versionConflicts.length ? `same work, another version: ${versionConflicts[0]}`
            : `title and one of by-line or year agree — the version is not settled${short.length && !clues.citation ? ` (${short.join('; ')})` : ''}`;
    }
    if (relation === 'sameEdition' && foundFileOnly(record)) {
        relation = 'sameWork';
        rule = `a PDF file the search found — its values are a text-only reading of that file’s pages (a copy of this document), not a record’s statement; it is not this edition’s record (${rule})`;
    }
    if (relation === 'sameEdition' && !identifierMatch && readTitleIsContainer(clues.readTitle, record)) {
        relation = 'sameWork';
        rule = `the reading’s title is the journal this record is filed in — the pages read are the journal’s cover, whose printed titles and names may be another paper’s; no identifier ties the record (${rule})`;
    }
    return { relation, evidence, conflicts: [...conflicts, ...versionConflicts], identifierMatch, titleScore, rule, ...(notes.length ? { notes } : {}),
        fit: { titleLine, missingPeople: missingPeople.length, exactYear } };
}
export interface Linked {
    record: ExternalRecord;
    link: LinkDecision;
}
export function chooseCitationTarget(linked: Linked[]): {
    target: Linked | null;
    reason: string;
    alternatives: Linked[];
} {
    const rank = (stage: PublicationStage) => stage === 'versionOfRecord' ? 3 : stage === 'acceptedManuscript' ? 2 : stage === 'unknown' ? 1 : 0;
    const same = linked.filter(entry => entry.link.relation === 'sameEdition');
    const work = linked.filter(entry => entry.link.relation === 'sameWork');
    const registry = (entry: Linked) => Number(!['google'].includes(entry.record.provider));
    const fit = (entry: Linked) => entry.link.fit || { titleLine: false, missingPeople: 0, exactYear: false };
    const candidates = [...same, ...work].sort((a, b) => Number(b.link.relation === 'sameEdition') - Number(a.link.relation === 'sameEdition')
        || rank(b.record.publicationStage) - rank(a.record.publicationStage)
        || Number(b.link.identifierMatch) - Number(a.link.identifierMatch) || registry(b) - registry(a)
        || Number(fit(b).titleLine) - Number(fit(a).titleLine) || fit(a).missingPeople - fit(b).missingPeople || Number(fit(b).exactYear) - Number(fit(a).exactYear)
        || b.link.titleScore - a.link.titleScore || b.link.evidence.length - a.link.evidence.length);
    if (!candidates.length)
        return { target: null, reason: 'no record is tied to the document', alternatives: linked };
    const best = candidates[0];
    if (best.link.relation === 'sameEdition') {
        return { target: best, reason: `${best.record.publicationStage} record, ${best.link.rule}`, alternatives: candidates.slice(1) };
    }
    const points = candidates.find(entry => entry.record.relations.isPreprintOf.length);
    return { target: null,
        reason: points ? `only a ${points.record.publicationStage} matched; it points at ${points.record.relations.isPreprintOf[0]} as the published version — held for confirmation`
            : 'records match the work but not this version — held for a person',
        alternatives: candidates };
}
export interface FieldProvenance {
    value: string | any[];
    source: 'document' | 'external';
    provider?: string;
    url?: string;
    retrievedAt?: string;
    role?: string;
    precision?: string;
    precisionLoss?: {
        document: string;
        external: string;
    };
    live?: boolean;
    detail?: string;
    corrected?: {
        from: any;
        reason: string;
    };
    conflict?: boolean;
    refined?: {
        from: any;
    };
    replacedFurniture?: any;
    coverBanner?: {
        from: any;
    };
    alternatives?: Array<{
        value: string;
        role?: string;
        provider?: string;
        url?: string;
    }>;
}
export interface LocalStanding {
    sources?: Record<string, any>;
    ocr?: boolean;
    vision?: boolean;
    protectedFields?: Set<string>;
    text?: string;
    years?: string[];
    evidence?: EvidenceBundle;
}
function evidenceOf(local: LocalStanding): EvidenceBundle {
    if (local.evidence)
        return local.evidence;
    const pages = String(local.text || '').split('\f').map(page => page.trim()).filter(Boolean);
    return { observations: pages.map((text, index) => observation(local.ocr ? 'ocrText' : 'pdfText', `${local.ocr ? 'OCR ' : ''}page ${index + 1}`, text, { index })) };
}
export interface Correction {
    field: string;
    from: any;
    to: any;
    reason: string;
    provider: string;
    url: string;
}
export interface FieldConflict {
    field: string;
    role: string;
    values: Array<{
        source: 'document' | 'external';
        provider?: string;
        url?: string;
        value: string;
        role?: string;
    }>;
    reason: string;
}
export function dateRoleCategory(role: unknown): 'published' | 'online' | 'accepted' | 'received' | 'record' {
    const text = String(role || '').toLowerCase();
    if (/online|epub|electronic|published_time|e-?pub/.test(text))
        return 'online';
    if (/accept/.test(text))
        return 'accepted';
    if (/receiv|submit|접수|투고/.test(text))
        return 'received';
    if (/creat|deposit|index|access|modif|updat|게시|등록|조회/.test(text))
        return 'record';
    return 'published';
}
export function initialsAbbreviatePage(creators: any[], text: string): string[] {
    const out: string[] = [];
    for (const person of creators) {
        const first = String(person?.firstName || '').trim();
        const last = String(person?.lastName || '').trim();
        if (!last || !/^(?:[A-Z]\.?\s?){1,3}$/.test(first))
            continue;
        const initial = first[0];
        const escaped = last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const printed = [...text.matchAll(new RegExp(`\\b([A-Z][a-z]{2,})(?:\\s+[A-Z]\\.?)?\\s+${escaped}\\b`, 'g'))].map(match => match[1]);
        const same = printed.find(name => name[0] === initial);
        if (same)
            out.push(`${last}, ${first} — the page prints ${same} ${last}: the same person, abbreviated by the record; the fuller name is not filled from the record`);
        else if (printed.length)
            out.push(`${last}, ${first} — the page prints ${printed[0]} ${last}, whose first initial differs: possibly another person; kept as the record states`);
    }
    return out;
}
export function correctionFor(field: string, held: any, value: any, target: Linked, local: LocalStanding): string | null {
    if (local.protectedFields?.has(field))
        return null;
    if (local.vision)
        return null;
    const record = target.record;
    const route = record.collected?.fields?.[field]?.route;
    if (route === 'pageText' && !['ISBN', 'date', 'numPages'].includes(field))
        return null;
    if (route === 'pdf' && field === 'title')
        return null;
    const text = local.text || '';
    const from = String(local.sources?.[field]?.from || '');
    const printed = (candidate: unknown) => printedOnPage(candidate, text, !!local.ocr) || (typeof candidate === 'string' && titleSupportedByPDF(candidate, text));
    const registryBound = target.link.identifierMatch && String(target.record.provider || '').toLowerCase() !== 'google';
    switch (field) {
        case 'title': {
            if (letters(held) === letters(value))
                return null;
            if (!printed(value))
                return null;
            if (looksLikeLabel(held))
                return `the record’s title is printed on the page; the reader’s title “${String(held).slice(0, 40)}” is a label`;
            if (registryBound && isNotATitle(String(held)))
                return `the record’s title is printed on the page; the reader’s “${String(held).slice(0, 40)}” is a running head or other furniture`;
            const heldScript = scriptOf(String(held));
            if (heldScript !== 'latin' && scriptOf(String(value)) === 'latin' && bodyIsIn(heldScript, text))
                return null;
            const h = letters(held), v = letters(value);
            if (v.length > h.length && v.startsWith(h) && h.length >= 6) {
                const rest = tailAfterLetters(String(value), h.length);
                if (registryBound || printed(rest))
                    return `the page prints the record’s full title; the reader’s “${String(held).slice(0, 40)}” stops before it ends`;
            }
            if (v.length > h.length && v.endsWith(h) && h.length >= 6 && !gluedHeadOf(value, held, local.sources?.title?.label))
                return `the page prints the record’s full title; the reader’s “${String(held).slice(0, 40)}” begins after a line of it`;
            if (h.length > v.length && h.endsWith(v) && v.length >= 6 && h.length - v.length <= 6) {
                return `the page prints the record’s title; the reader’s “${String(held).slice(0, 40)}” carries a field label in front of it`;
            }
            if (h.length > v.length && h.startsWith(v) && v.length >= 6) {
                const tail = tailAfterLetters(String(held), v.length);
                const surnames = (target.record.creators || []).map(personLetters).filter(name => name.length >= 2);
                const namesInTail = surnames.some(name => letters(tail).includes(name)) || rowIsByline(tail, 'strict');
                if (namesInTail)
                    return `the page prints the record’s title; the reader’s title runs on into the by-line “${tail.slice(0, 40)}”`;
                return null;
            }
            const wrapped = readingWrapsTitle(held, value, (target.record.creators || []).map(bylineName));
            if (wrapped)
                return `the page prints the record’s title; the reader’s title wraps it in ${wrapped.head ? `a mark “${wrapped.head}” and ` : ''}the by-line “${wrapped.tail.slice(0, 40)}”`;
            if (titlesAgree(held, value))
                return null;
            if (local.ocr)
                return 'the record’s title is printed on the page (OCR tolerance); the reader’s title came from an image';
            if (!printed(held))
                return 'the record’s title is printed on the page; the reader’s title is not';
            if (registryBound && titleSimilarity(held, value) < 0.6)
                return `the record the page’s identifier names states the title, and the page prints it; the reader’s “${String(held).slice(0, 40)}” is another line of the page`;
            return null;
        }
        case 'publisher': {
            const recordPublisher = String(value).split(/\s*;\s*/).pop() || String(value);
            if (registryBound && letters(held).startsWith(letters(recordPublisher)) && letters(held) !== letters(recordPublisher)
                && /^\d{1,4}$/.test(letters(held).slice(letters(recordPublisher).length)))
                return `publisher ${recordPublisher} is stated by the record the page’s identifier names; the reader’s “${held}” runs on into a number`;
            if (letters(recordPublisher).includes(letters(held)) || letters(held).includes(letters(recordPublisher)))
                return null;
            if (!publisherPrinted(recordPublisher, record, text, !!local.ocr))
                return null;
            if (local.ocr)
                return `publisher ${recordPublisher} is printed on the page; the reader’s “${held}” came from an image`;
            if (!['publishedBy', 'imprintStatement', 'titlePageImprint'].includes(from))
                return `publisher ${recordPublisher} is printed on the page; the reader’s “${held}” came from ${from || 'an unlabelled line'}`;
            return null;
        }
        case 'date': {
            const heldYear = String(held).slice(0, 4), year = String(value).slice(0, 4);
            if (heldYear === year)
                return null;
            const stated = (local.years || []).includes(year);
            const printedBeside = !stated && registryBound && /^\d{4}$/.test(year) && new RegExp(`(?<!\\d)${year}(?!\\d)`).test(text);
            if (!stated && !printedBeside)
                return null;
            if (local.ocr || from === 'unlabelledOnFrontMatter')
                return `the record’s year ${year} is ${stated ? 'stated on the front pages' : 'printed on the page that prints the identifier naming the record'}; the reader’s ${held} was an unlabelled date${local.ocr ? ' read from an image' : ''}`;
            return null;
        }
        case 'creators': {
            const recorded = (Array.isArray(value) ? value : []).map(personLetters).filter(Boolean);
            const heldNames = (Array.isArray(held) ? held : []).map(personLetters).filter(Boolean);
            if (!recorded.length || !heldNames.length)
                return null;
            const hangulPerson = (person: any) => /[가-힣]/.test(`${person?.lastName ?? person?.name ?? ''}${person?.firstName ?? ''}`);
            const heldPeople = Array.isArray(held) ? held : [], recordPeople = Array.isArray(value) ? value : [];
            if (heldPeople.length && heldPeople.every(hangulPerson) && !recordPeople.some(hangulPerson) && bodyIsIn('hangul', text))
                return null;
            const personKey = (person: any) => [letters(person?.lastName || person?.name), letters(person?.firstName)].filter(Boolean).sort().join('|');
            const heldKeys = (Array.isArray(held) ? held : []).map(personKey).filter(Boolean).sort();
            const recordKeys = (Array.isArray(value) ? value : []).map(personKey).filter(Boolean).sort();
            if (heldKeys.length === recordKeys.length && heldKeys.every((key, index) => key === recordKeys[index]))
                return null;
            if (registryBound && heldNames.length < recorded.length
                && heldNames.every(name => recorded.some(other => other.includes(name) || name.includes(other)))
                && recorded.every(name => letters(text).includes(name)))
                return `the reader’s by-line stops at ${heldNames.length} of the ${recorded.length} names the record the page’s identifier names lists, all printed on the page`;
            if (heldNames.every(name => recorded.some(other => other.includes(name) || name.includes(other))))
                return null;
            if (local.ocr && recorded.every(name => letters(text).includes(name)))
                return 'the record’s by-line is printed on the page; the reader’s names came from an image';
            if (registryBound && recorded.every(name => letters(text).includes(name)))
                return 'the record the page’s identifier names lists authors printed on the page; the reader’s names include ones the record does not';
            const shared = heldNames.some(name => recorded.some(other => other.includes(name) || name.includes(other)));
            const printedCount = recorded.filter(name => letters(text).includes(name)).length;
            if (registryBound && !shared && printedCount >= 2 && printedCount * 3 >= recorded.length * 2)
                return `the record the page’s identifier names lists authors, ${printedCount} of ${recorded.length} printed on the page; the reader’s “${(Array.isArray(held) ? held : []).map((person: any) => person?.lastName || person?.name).filter(Boolean).join(', ').slice(0, 40)}” shares none of them and is another line of the page`;
            return null;
        }
        case 'ISBN':
        case 'DOI':
        case 'volume':
        case 'issue':
        case 'pages':
        case 'numPages':
        case 'edition':
        case 'publicationTitle':
        case 'institution':
        case 'university': {
            if (letters(held) === letters(value))
                return null;
            if (field === 'edition' && editionKey(held) === editionKey(value))
                return null;
            if (field === 'ISBN' && registryBound) {
                const own = ownISBNs(String(text).split('\f'));
                const stated = isbnsIn(value), read = isbnsIn(held);
                const hit = stated.find(isbn => own.includes(isbn));
                if (hit && !read.some(isbn => own.includes(isbn)))
                    return `the record’s ISBN ${hit} is the one the document prints as its own; the reading’s ${String(held).slice(0, 40)} is not`;
            }
            if (registryBound && ['volume', 'issue', 'pages', 'numPages'].includes(field)) {
                if (locatorsAgree(field, held, value))
                    return null;
                if (locatorParts(value).length < locatorParts(held).length)
                    return null;
                return `the record the page’s identifier names states ${field} ${String(value).slice(0, 40)}; the reader’s “${String(held).slice(0, 40)}” is a number it found on the page`;
            }
            if (local.ocr && printed(value))
                return `${field} ${String(value).slice(0, 40)} is printed on the page; the reader’s “${String(held).slice(0, 40)}” came from an image`;
            if (registryBound && field === 'publicationTitle' && local.ocr)
                return `the record the page’s identifier names states ${field}`;
            return null;
        }
        default: return null;
    }
}
const PRECISION_RANK: Record<string, number> = { year: 1, month: 2, day: 3 };
const precisionOf = (value: string) => value.length >= 10 ? 'day' : value.length >= 7 ? 'month' : 'year';
const REFINED_BY_RECORD = new Set(['title', 'publisher', 'institution', 'university', 'publicationTitle', 'proceedingsTitle', 'bookTitle', 'place', 'series', 'seriesTitle',
    'journalAbbreviation', 'pages', 'date', 'filingDate', 'issueDate', 'creators']);
const NO_REGISTRY_TYPES = new Set(['report', 'document', 'presentation', 'manuscript', 'webpage', 'blogPost', 'standard', 'computerProgram', 'dataset']);
function fillsOnlyWhatThePagePrints(target: Linked, record: ExternalRecord): boolean {
    const registryBound = target.link.identifierMatch && String(target.record.provider || '').toLowerCase() !== 'google';
    return !registryBound && NO_REGISTRY_TYPES.has(String(record.itemType || ''));
}
function readTheCover(documentFields: Record<string, any>, target: Linked, local: LocalStanding): boolean {
    if (local.protectedFields?.has('title'))
        return false;
    const link = target.link;
    if (link.relation !== 'sameEdition' || !link.identifierMatch || /^google/i.test(String(target.record.provider || '')))
        return false;
    if (!readTitleIsContainer(documentFields.title, target.record))
        return false;
    return bylineAgreement(target.record, local.text || '').authorsAgree === true;
}
const COVER_READ_FIELDS = new Set(['title', 'volume', 'issue', 'pages']);
function valuePrintedOnPage(field: string, value: any, text: string, ocr: boolean): boolean {
    if (!text)
        return false;
    if (field === 'creators') {
        const people = (Array.isArray(value) ? value : []) as any[];
        return people.length > 0 && people.every(person => printedOnPage(`${person?.lastName ?? person?.name ?? ''}${person?.firstName ?? ''}`, text, ocr)
            || printedOnPage(`${person?.firstName ?? ''} ${person?.lastName ?? person?.name ?? ''}`, text, ocr));
    }
    if (field === 'date')
        return /\d{4}/.test(String(value)) && text.includes(String(value).slice(0, 4));
    return printedOnPage(value, text, ocr);
}
export function mergeFields(documentFields: Record<string, any>, target: Linked, others: Linked[], options: {
    keep?: Set<string>;
    local?: LocalStanding;
} = {}): {
    fields: Record<string, any>;
    provenance: Record<string, FieldProvenance>;
    notes: string[];
    corrections: Correction[];
    conflicts: FieldConflict[];
} {
    const fields: Record<string, any> = { ...documentFields };
    const provenance: Record<string, FieldProvenance> = {};
    const notes: string[] = [];
    const corrections: Correction[] = [];
    const conflicts: FieldConflict[] = [];
    const conflictOn = (role: string, value: string, record: ExternalRecord) => {
        const held = provenance.date;
        const heldRole = held?.source === 'external' ? held.role : String(local.sources?.date?.from || 'page');
        let entry = conflicts.find(conflict => conflict.field === 'date');
        if (!entry) {
            entry = { field: 'date', role, values: [held?.source === 'external'
                        ? { source: 'external', provider: held.provider, url: held.url, value: String(fields.date), role: heldRole }
                        : { source: 'document', value: String(fields.date), role: heldRole }], reason: '' };
            conflicts.push(entry);
        }
        entry.values.push({ source: 'external', provider: record.provider, url: record.url, value, role: record.date?.role });
        entry.reason = `sources of this edition state the ${role} date differently: ${entry.values.map(item => `${item.provider || 'the page'} ${item.value}`).join(' / ')} — not settled here`;
        provenance.date = { ...(provenance.date || { value: fields.date, source: 'document' }), conflict: true };
        notes.push(`date: ${record.provider} states ${value}${record.date?.role ? ` (${record.date.role})` : ''}, the record holds ${fields.date}: the same role, a different value — the field is a conflict for a person to settle`);
    };
    const local = options.local || {};
    for (const [field, value] of Object.entries(documentFields)) {
        if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length))
            continue;
        provenance[field] = { value, source: 'document' };
    }
    const coverRead = readTheCover(documentFields, target, local);
    const sources = [target, ...others.filter(entry => entry.link.relation === 'sameEdition'
            && agreesOnCoordinates(entry.record, target.record))];
    for (const entry of sources) {
        const record = entry.record;
        const stated: Record<string, any> = { ...record.fields, title: titleUnderContract(record.title) || withoutGenreTag(record.title) };
        if (record.creators.length)
            stated.creators = onePerPerson(record.creators);
        for (const [field, rawValue] of Object.entries(stated)) {
            if (rawValue === undefined || rawValue === null || rawValue === '' || options.keep?.has(field))
                continue;
            const declared = field === 'date' && typeof rawValue === 'string' ? record.date?.precision : undefined;
            const value = field === 'publisher' && typeof rawValue === 'string' && rawValue.includes(';') ? (rawValue.split(/\s*;\s*/).pop() || rawValue).trim()
                : field === 'date' && typeof rawValue === 'string' && declared === 'year' && rawValue.length > 4 ? rawValue.slice(0, 4)
                    : field === 'date' && typeof rawValue === 'string' && declared === 'month' && rawValue.length > 7 ? rawValue.slice(0, 7)
                        : rawValue;
            if (field === 'date' && value !== rawValue)
                notes.push(`date ${rawValue} from ${record.provider} read at ${declared} precision — ${record.date?.defaulted || `the source stated no finer (${record.date?.role || 'date'})`}`);
            const held = fields[field];
            const empty = held === undefined || held === null || held === '' || (Array.isArray(held) && !held.length);
            if (coverRead && entry === target && !empty && COVER_READ_FIELDS.has(field) && !local.protectedFields?.has(field)
                && typeof value === 'string' && value.trim() && letters(held) !== letters(value)) {
                fields[field] = value;
                const collectedHere = record.collected?.fields?.[field];
                provenance[field] = { value, source: 'external', provider: record.provider, url: record.url, retrievedAt: record.retrievedAt, live: record.live,
                    ...(collectedHere?.source ? { detail: `${collectedHere.source}${collectedHere.locator ? ` @ ${collectedHere.locator}` : ''}` } : {}),
                    ...(field === 'title' ? { replacedFurniture: held } : { coverBanner: { from: held } }) };
                notes.push(field === 'title'
                    ? `the reading’s title “${String(held).slice(0, 40)}” is the name of the journal the record is filed in — the reading read the journal’s cover, not this article; the record the page’s identifier names fills the title`
                    : `${field} “${String(held).slice(0, 40)}” was read from the journal cover’s banner, not stated for this article; the record the page’s identifier names states ${String(value).slice(0, 40)}`);
                continue;
            }
            if (field === 'date' && !empty && typeof held === 'string' && typeof value === 'string') {
                const pageRank = PRECISION_RANK[precisionOf(held)], recordRank = PRECISION_RANK[precisionOf(value)];
                const heldRole = provenance.date?.source === 'external' ? provenance.date.role : local.sources?.date?.from;
                const heldCategory = dateRoleCategory(heldRole);
                const category = dateRoleCategory(record.date?.role);
                if (category !== heldCategory && category !== 'published') {
                    provenance.date = { ...(provenance.date || { value: held, source: 'document' }), alternatives: [...(provenance.date?.alternatives || []), { value, role: record.date?.role, provider: record.provider, url: record.url }] };
                    notes.push(`date: ${record.provider} states ${value} as ${record.date?.role || 'another role'} (${category}) — kept beside the ${heldCategory} date ${held}, not merged`);
                    continue;
                }
                if (held.slice(0, 4) !== value.slice(0, 4)) {
                    const reason = entry === target ? correctionFor('date', held, value, target, local) : null;
                    if (reason) {
                        fields.date = value;
                        provenance.date = { value, source: 'external', provider: record.provider, url: record.url, retrievedAt: record.retrievedAt, role: record.date?.role, precision: precisionOf(value), live: record.live, corrected: { from: held, reason } };
                        corrections.push({ field: 'date', from: held, to: value, reason, provider: record.provider, url: record.url });
                        notes.push(`date ${held} on the page replaced by ${value} from ${record.provider}: ${reason}`);
                    }
                    else
                        notes.push(`${record.provider} states ${value}, the page ${held}: kept the page`);
                    continue;
                }
                if (recordRank > pageRank && value.startsWith(held)) {
                    fields.date = value;
                    provenance.date = { value, source: 'external', provider: record.provider, url: record.url, retrievedAt: record.retrievedAt, role: record.date?.role, precision: precisionOf(value), live: record.live };
                    notes.push(`date ${held} on the page refined to ${value} by ${record.provider}`);
                }
                else if (recordRank < pageRank) {
                    provenance.date = { ...provenance.date!, precisionLoss: { document: held, external: value } };
                }
                else if (value !== held && !held.startsWith(value)) {
                    if (local.vision)
                        notes.push(`${record.provider} states ${value}, the page image reading ${held}: kept the reading`);
                    else
                        conflictOn(category, value, record);
                }
                continue;
            }
            if (!empty && entry === target && !local.protectedFields?.has(field)) {
                const refined = REFINED_BY_RECORD.has(field) ? sameStatement(field, held, value, { pages: local.text || '' }) : null;
                const adds = refined !== null && refined !== undefined && letters(JSON.stringify(refined)) !== letters(JSON.stringify(held));
                if (refined !== null && refined !== undefined
                    && !(adds && fillsOnlyWhatThePagePrints(target, record) && !valuePrintedOnPage(field, refined, local.text || '', !!local.ocr))) {
                    fields[field] = refined;
                    provenance[field] = { value: refined as any, source: 'external', provider: record.provider, url: record.url, retrievedAt: record.retrievedAt, live: record.live, refined: { from: held } };
                    notes.push(`${field} “${String(Array.isArray(held) ? held.map((v: any) => `${v?.lastName ?? v?.name ?? ''}${v?.firstName ? `, ${v.firstName}` : ''}`).join('; ') : held).slice(0, 50)}” written in ${record.provider}’s form — the same statement`);
                    continue;
                }
            }
            if (!empty) {
                const reason = entry === target ? correctionFor(field, held, value, target, local) : null;
                if (!reason && field === 'title' && entry === target && !local.protectedFields?.has('title') && typeof held === 'string' && typeof value === 'string') {
                    const pages = evidenceOf(local);
                    const stated = titleUnderContract(value);
                    const text = local.text || '';
                    if (stated && titleFailsContract(held, pages) && !titleFailsContract(stated, pages)
                        && (printedOnPage(stated, text, !!local.ocr) || titleSupportedByPDF(stated, text))) {
                        fields.title = stated;
                        const collectedHere = record.collected?.fields?.title;
                        provenance.title = { value: stated, source: 'external', provider: record.provider, url: record.url, retrievedAt: record.retrievedAt, live: record.live,
                            ...(collectedHere?.source ? { detail: `${collectedHere.source}${collectedHere.locator ? ` @ ${collectedHere.locator}` : ''}` } : {}), replacedFurniture: held };
                        notes.push(`the reading’s title “${held.slice(0, 40)}” is not a title under the field contract; the record’s title, printed on the page, fills the field`);
                        continue;
                    }
                }
                const publisherAsJournal = !reason && field === 'publicationTitle' && entry === target && typeof held === 'string' && typeof value === 'string' && !isAnInstitutionNotASerial(held)
                    ? publisherInTheContainerSlot(held, evidenceOf(local), [record.fields?.publisher]) : null;
                if (!reason && field === 'publicationTitle' && entry === target && !local.protectedFields?.has(field) && typeof held === 'string' && typeof value === 'string'
                    && (isAnInstitutionNotASerial(held) || !!publisherAsJournal) && !isAnInstitutionNotASerial(value)
                    && ((target.link.identifierMatch && !/^google/i.test(String(record.provider || ''))) || printedOnPage(value, local.text || '', !!local.ocr))) {
                    fields.publicationTitle = value;
                    const collectedHere = record.collected?.fields?.publicationTitle;
                    provenance.publicationTitle = { value, source: 'external', provider: record.provider, url: record.url, retrievedAt: record.retrievedAt, live: record.live,
                        ...(collectedHere?.source ? { detail: `${collectedHere.source}${collectedHere.locator ? ` @ ${collectedHere.locator}` : ''}` } : {}), replacedFurniture: held };
                    const moved = (fields.publisher === undefined || fields.publisher === null || fields.publisher === '') && !publisherAsJournal?.linkedSame
                        ? movedStatement('publisher', held, { evidence: evidenceOf(local), creators: Array.isArray(documentFields.creators) ? documentFields.creators : [] }) : '';
                    const publisherEmpty = !!moved;
                    if (publisherEmpty) {
                        fields.publisher = moved;
                        provenance.publisher = { value: moved, source: 'document' };
                    }
                    notes.push(`the reading’s journal “${held.slice(0, 40)}” is ${publisherAsJournal ? 'the publisher’s name' : 'an institution'}, not a journal, under the field contract; the record’s journal fills the field${publisherEmpty ? `, and the ${publisherAsJournal ? 'name' : 'institution'} stands as the publisher` : ''}`);
                    continue;
                }
                if (!reason && field === 'DOI' && entry === target && !local.protectedFields?.has(field) && typeof held === 'string' && typeof value === 'string'
                    && templateDOI(held) && !templateDOI(value) && target.link.identifierMatch && !/^google/i.test(String(record.provider || ''))) {
                    fields.DOI = value;
                    provenance.DOI = { value, source: 'external', provider: record.provider, url: record.url, retrievedAt: record.retrievedAt, live: record.live, replacedFurniture: held };
                    notes.push(`the reading’s DOI “${held.slice(0, 40)}” is a manuscript template’s placeholder under the field contract; the record the page’s identifier names fills the field`);
                    continue;
                }
                if (!reason) {
                    if (entry === target && !['url', 'language', 'abstractNote'].includes(field) && letters(held) !== letters(value) && !(field === 'title' && titlesAgree(held, value)))
                        notes.push(`${record.provider} states ${field} “${String(Array.isArray(value) ? value.map((v: any) => v.lastName).join('; ') : value).slice(0, 60)}”, the page “${String(Array.isArray(held) ? held.map((v: any) => v.lastName).join('; ') : held).slice(0, 60)}”: kept the page`);
                    continue;
                }
                fields[field] = value;
                const collectedHere = record.collected?.fields?.[field];
                provenance[field] = { value, source: 'external', provider: record.provider, url: record.url, retrievedAt: record.retrievedAt, live: record.live,
                    ...(collectedHere?.source ? { detail: `${collectedHere.source}${collectedHere.locator ? ` @ ${collectedHere.locator}` : ''}` } : {}), corrected: { from: held, reason } };
                corrections.push({ field, from: held, to: value, reason, provider: record.provider, url: record.url });
                notes.push(`${field} “${String(Array.isArray(held) ? held.map((v: any) => v.lastName).join('; ') : held).slice(0, 50)}” replaced by ${record.provider}: ${reason}`);
                continue;
            }
            if (fillsOnlyWhatThePagePrints(target, record) && !['url', 'language'].includes(field)
                && !valuePrintedOnPage(field, value, local.text || '', !!local.ocr)) {
                notes.push(`${record.provider} states ${field} “${String(Array.isArray(value) ? value.map((v: any) => v.lastName).join('; ') : value).slice(0, 60)}”, which this document does not print — a searched record for a ${record.itemType} fills only what the page prints`);
                continue;
            }
            if (EDITION_DESCRIPTION_FIELDS.has(field) && typeof value === 'string') {
                const pagesSaid = evidenceOf(local);
                const why = recordContradictsTheDocument(record.fields, pagesSaid)
                    || (field === 'place' && placeTheDocumentStatesInsteadOf(value, pagesSaid) ? `the document states this edition’s place as “${placeTheDocumentStatesInsteadOf(value, pagesSaid)}”` : '');
                if (why) {
                    notes.push(`${record.provider} states ${field} “${value.slice(0, 60)}”, which does not describe this edition — ${why}`);
                    continue;
                }
            }
            fields[field] = value;
            const collected = record.collected?.fields?.[field];
            provenance[field] = { value, source: 'external', provider: record.provider, url: record.url, retrievedAt: record.retrievedAt,
                role: field === 'date' ? record.date?.role : undefined, precision: field === 'date' ? precisionOf(String(value)) : undefined, live: record.live,
                ...(collected?.source ? { detail: `${collected.source}${collected.locator ? ` @ ${collected.locator}` : ''}` } : {}) };
            if (field === 'creators' && Array.isArray(value)) {
                for (const line of initialsAbbreviatePage(value, local.text || ''))
                    notes.push(`creators: ${line}`);
            }
        }
    }
    return { fields, provenance, notes, corrections, conflicts };
}
export interface ScopedRecord {
    itemType?: string;
    fields: Record<string, any>;
    creators?: Array<{
        firstName?: string;
        lastName?: string;
        name?: string;
        creatorType?: string;
        fieldMode?: number;
    }>;
}
export interface ScopedFill {
    itemType: string;
    fields: Record<string, any>;
    creators: any[];
    notes: string[];
}
const WHOLE_TITLE_OF: Record<string, string> = { bookSection: 'bookTitle', conferencePaper: 'proceedingsTitle', encyclopediaArticle: 'encyclopediaTitle', dictionaryEntry: 'dictionaryTitle' };
const WHOLE_FIELDS = ['publisher', 'place', 'date', 'ISBN', 'edition', 'series', 'seriesNumber', 'numberOfVolumes', 'language', 'rights'];
const PART_ONLY_FIELDS = ['pages', 'DOI', 'url', 'abstractNote', 'shortTitle', 'accessDate', 'libraryCatalog', 'extra', 'numPages'];
const filled = (value: unknown) => value !== undefined && value !== null && String(value).trim() !== '';
const personKey = (person: any) => letters(`${person?.lastName ?? person?.name ?? ''}${person?.firstName ?? ''}`);
const rangeShaped = (value: unknown) => /^\s*[A-Za-z]?\d{1,6}\s*[-–—~]\s*[A-Za-z]?\d{1,6}\s*$/.test(String(value ?? '').normalize('NFKC'));
export function asPartOf(reading: ScopedRecord, container: ScopedRecord, ownRange = '', pages?: string[], recordFirst = false): ScopedFill | null {
    if (pages && !containerNamedOnPages(container, pages))
        return null;
    const notes: string[] = [];
    const fields: Record<string, any> = { ...(reading.fields || {}) };
    const creators = [...(reading.creators || [])];
    const whole = container.fields || {};
    const refused = (name: string) => !!statementOf(name, fields[name], { itemType: String(reading.itemType || ''), creators: reading.creators });
    const fillEmpty = (names: string[]) => {
        for (const name of names)
            if ((!filled(fields[name]) || refused(name) || (recordFirst && name !== 'language')) && filled(whole[name]))
                fields[name] = whole[name];
    };
    if (String(container.itemType || '') !== 'book') {
        fillEmpty(['publisher', 'place', 'date', 'language']);
        notes.push(`the ${container.itemType || 'record'} “${String(whole.title || '').slice(0, 60)}” contains this document; ${recordFirst ? 'it states the whole’s fields over the text-layer reading' : 'it fills only what the reading left empty'}`);
        return { itemType: String(reading.itemType || 'document'), fields, creators, notes };
    }
    for (const name of ['publicationTitle', 'journalAbbreviation', 'issue', 'ISSN', 'numPages'])
        delete fields[name];
    if (!filled(fields.bookTitle) || (recordFirst && filled(whole.title)))
        fields.bookTitle = whole.title;
    fillEmpty(WHOLE_FIELDS);
    if (!rangeShaped(fields.pages) && rangeShaped(ownRange))
        fields.pages = String(ownRange).replace(/\s+/g, '');
    const known = new Set(creators.map(personKey).filter(Boolean));
    for (const person of container.creators || []) {
        const key = personKey(person);
        if (!key || known.has(key))
            continue;
        known.add(key);
        creators.push({ ...person, creatorType: person.creatorType === 'editor' || person.creatorType === 'seriesEditor' ? person.creatorType : 'bookAuthor' });
    }
    notes.push(`the page states this document is a part of “${String(whole.title || '').slice(0, 60)}” (${ownRange ? `pp. ${ownRange}` : 'its own range'}); the book fills the book’s fields, the reading keeps the part’s title and people`);
    return { itemType: 'bookSection', fields, creators, notes };
}
export function containerNamedOnPages(container: ScopedRecord, pages: string[]): boolean {
    const title = String(container.fields?.title ?? '').trim();
    const main = title.split(/\s*[:：]\s+|\s+[-–—]\s+/)[0].trim();
    const names = [...new Set([title, main].filter(name => letters(name).length >= 4))];
    return names.some(name => pages.some(page => namesAsContainer(page, name)));
}
export function asWholeOf(part: ScopedRecord, reading?: ScopedRecord): ScopedFill | null {
    const slot = WHOLE_TITLE_OF[String(part.itemType || '')];
    const stated = part.fields || {};
    const wholeTitle = slot ? String(stated[slot] ?? '').trim() : '';
    if (!wholeTitle)
        return null;
    const whole: Record<string, any> = { title: wholeTitle };
    for (const name of WHOLE_FIELDS)
        if (filled(stated[name]))
            whole[name] = stated[name];
    const editors = (part.creators || []).filter(person => person.creatorType === 'editor' || person.creatorType === 'seriesEditor')
        .concat((part.creators || []).filter(person => person.creatorType === 'bookAuthor').map(person => ({ ...person, creatorType: 'author' })));
    const notes = [`“${String(stated.title || '').slice(0, 60)}” (${stated.pages ? `pp. ${stated.pages}` : 'one part'}) is one part of this document; the document is “${wholeTitle.slice(0, 60)}”, which the record names as its container`];
    if (!reading)
        return { itemType: 'book', fields: whole, creators: editors, notes };
    const read = { ...(reading.fields || {}) };
    const readsThePart = !!letters(read.title) && !!letters(stated.title)
        && (letters(read.title).includes(letters(stated.title)) || letters(stated.title).includes(letters(read.title)));
    if (readsThePart) {
        for (const name of ['title', ...PART_ONLY_FIELDS, 'bookTitle', 'publicationTitle', 'proceedingsTitle'])
            delete read[name];
        notes.push(`the reading read the opening of that part (“${String(reading.fields?.title || '').slice(0, 60)}”); its title, people, range and DOI are the part’s`);
        return { itemType: 'book', fields: { ...whole, ...Object.fromEntries(Object.entries(read).filter(([, value]) => filled(value))) }, creators: editors, notes };
    }
    const fields: Record<string, any> = { ...read };
    for (const [name, value] of Object.entries(whole))
        if (!filled(fields[name]))
            fields[name] = value;
    const creators = (reading.creators || []).length ? [...(reading.creators || [])] : editors;
    return { itemType: String(reading.itemType || 'book'), fields, creators, notes };
}

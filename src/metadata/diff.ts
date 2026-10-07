import type { FieldChange, MetadataSnapshot } from "../types";
import { validForTypeID } from '../recognition/item-fields';
import { canonicalDate, DATE_FIELDS, sameDate } from '../recognition/roles';
import { titleSimilarity } from './match';
import { decodeMetadataText, textualFields, tidyAbstract, titleScript } from './text';
import { normalizedISBN, sameDOI, sameDOILink } from './identifier-compare';
import { nameScripts, pairedByLine, samePersonAcrossScripts } from './name-equivalence';
export function damagedReading(value: unknown): boolean {
    const text = String(value ?? '');
    if (/�/u.test(text))
        return true;
    if (!/[A-Za-z][\p{Script=Han}]|[\p{Script=Han}][A-Za-z]/u.test(text))
        return false;
    return !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2}/u.test(text);
}
function tailAfterLetters(value: unknown, count: number): string {
    const text = String(value ?? '').normalize('NFKC');
    let seen = 0;
    for (let index = 0; index < text.length; index++) {
        if (!/[\p{L}\p{N}]/u.test(text[index]))
            continue;
        if (++seen === count)
            return text.slice(index + 1);
    }
    return '';
}
const CONTINUES_THE_PHRASE = /^(?:by|with|for|using|via|from|in|on|of|and|to|through|under|towards?|based|during|between|according)\b/i;
export function cutsStoredTitleShort(stored: unknown, read: unknown): boolean {
    const flat = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const held = flat(stored), offered = flat(read);
    if (!held || !offered || held === offered || !held.startsWith(offered))
        return false;
    if (held.length < offered.length + 2)
        return false;
    const tail = tailAfterLetters(stored, offered.length).trim();
    if (!tail)
        return false;
    if (CONTINUES_THE_PHRASE.test(tail))
        return true;
    return /[가-힣]\s*$/.test(String(read ?? '')) && /^[가-힣]/.test(tail) && tail.replace(/\s+/g, '').length <= 4;
}
export function decoratedRestatement(stored: unknown, read: unknown, context: Record<string, any> = {}): boolean {
    const flat = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const held = flat(stored), offered = flat(read);
    if (!held || !offered || held === offered || !offered.includes(held))
        return false;
    let text = String(read ?? '').normalize('NFKC').trim();
    const strip = (pattern: RegExp) => { const next = text.replace(pattern, '').trim(); if (next && next !== text)
        text = next; };
    strip(/^\[[^\]]{1,20}\]\s*/);
    strip(/^[A-Z]?\d{1,3}\s*[).]\s*/);
    strip(/^\d{1,3}\s+(?=\p{Lu}|[가-힣])/u);
    strip(/^(?:19|20)\d{2}\s+(?=\p{L}|[가-힣])/u);
    for (const around of [context.publicationTitle, context.publisher, context.series, context.bookTitle]) {
        const name = String(around ?? '').trim();
        if (name.length < 3)
            continue;
        strip(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:：,-]?\\s*`, 'i'));
        strip(new RegExp(`\\s*[:：,-]?\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'));
    }
    for (const around of [context.publisher, context.series, context.bookTitle, context.publicationTitle]) {
        const name = String(around ?? '').trim();
        if (name.length < 3)
            continue;
        const words = text.split(/\s+/).filter(Boolean);
        for (let take = 1; take <= 5 && take < words.length; take++) {
            const tail = words.slice(words.length - take).join(' ').replace(/[:：,-]+$/, '');
            if (!samePublisher(tail, name))
                continue;
            const rest = words.slice(0, words.length - take).join(' ').replace(/[\s:：,-]+$/, '').trim();
            if (flat(rest) !== held)
                continue;
            text = rest;
            break;
        }
    }
    strip(/\s*\([^)]*\d{1,4}\s*[/∕]\s*\d{4}[^)]*\)\s*$/);
    return flat(text) === held;
}
export function sameTitleSetDifferently(stored: unknown, read: unknown): boolean {
    const flatten = (value: unknown) => String(value ?? '').normalize('NFKC')
        .replace(/<\/?(?:sub|sup|i|b|em|strong|span)[^>]*>/gi, '')
        .replace(/[‐-―−－]/gu, '-')
        .replace(/[‘’ʼ‛]/gu, "'").replace(/[“”]/gu, '"')
        .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const held = flatten(stored), offered = flatten(read);
    if (!held || !offered || held !== offered)
        return false;
    const damaged = (value: unknown) => /\b(?:fi|fl|ff|ffi|ffl)\s+\p{Ll}/u.test(String(value ?? ''))
        || /[�]/u.test(String(value ?? '')) || scrambledCase(value);
    return !(damaged(stored) && !damaged(read));
}
export const CONTAINER_NAME_FIELDS = new Set(['publicationTitle', 'bookTitle', 'proceedingsTitle',
    'seriesTitle', 'series', 'conferenceName']);
function scrambledCase(value: unknown): boolean {
    return String(value ?? '').normalize('NFKC').split(/[^\p{L}\p{N}]+/u)
        .some(word => word.length >= 6 && /\p{Ll}\p{Lu}$/u.test(word)
        && (word.match(/\p{Ll}\p{Lu}/gu) || []).length >= 2);
}
const NAME_PARTS = ['lastName', 'firstName', 'name'] as const;
const nameLetters = (value: unknown) => String(value ?? '').normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D\u02D7]/gu, '-')
    .replace(/[\u2018\u2019\u02BC\u201B\u0060\u00B4]/gu, "'")
    .replace(/[\u00AD\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase().replace(/[\s.]+/g, '');
const brokenName = (value: unknown) => damagedReading(value) || /[\uFB00-\uFB06]/u.test(String(value ?? ''));
export function sameNameSetDifferently(stored: unknown, offered: unknown): boolean {
    const held = (stored || {}) as Record<string, unknown>, read = (offered || {}) as Record<string, unknown>;
    let differs = false;
    for (const part of NAME_PARTS) {
        const a = String(held[part] ?? ''), b = String(read[part] ?? '');
        if (nameLetters(a) !== nameLetters(b))
            return false;
        if (a !== b)
            differs = true;
    }
    if (!differs)
        return false;
    const text = (entry: Record<string, unknown>) => String(entry.lastName ?? entry.name ?? '') + ' ' + String(entry.firstName ?? '');
    return !(brokenName(text(held)) && !brokenName(text(read)));
}
export const BOOKKEEPING_FIELDS = new Set(['accessDate', 'libraryCatalog']);
export const OWNED_BY_THE_LIBRARY = new Set([...BOOKKEEPING_FIELDS, 'callNumber', 'archive', 'archiveLocation',
    'extra', 'rights', 'url', 'shortTitle', 'language']);
export const RECORD_STATES = new Set(['title', 'publicationTitle', 'journalAbbreviation', 'bookTitle',
    'volume', 'issue', 'pages', 'date', 'numPages', 'DOI', 'ISBN', 'ISSN',
    'conferenceName', 'proceedingsTitle', 'reportNumber', 'reportType', 'thesisType', 'patentNumber']);
const STATED_INCONSISTENTLY = new Set(['publisher', 'place', 'edition', 'series', 'seriesTitle', 'seriesNumber',
    'institution', 'university', 'assignee']);
export function buildDiff(existing: MetadataSnapshot, recognized: MetadataSnapshot, allowTypeChange = false, authoritative = false): FieldChange[] {
    const changes: FieldChange[] = [];
    if (allowTypeChange && recognized.typeRead !== false && existing.itemTypeID !== recognized.itemTypeID) {
        changes.push({ field: "itemType", oldValue: existing.itemType, newValue: recognized.itemType });
    }
    for (const [field, rawValue] of Object.entries(recognized.fields)) {
        const decoded = typeof rawValue === 'string' && textualFields.has(field) ? decodeMetadataText(rawValue) : rawValue;
        const newValue = field === 'abstractNote' && typeof decoded === 'string' ? tidyAbstract(decoded) : decoded;
        if (newValue === "" || newValue === null || newValue === undefined)
            continue;
        if (BOOKKEEPING_FIELDS.has(field))
            continue;
        if (OWNED_BY_THE_LIBRARY.has(field) && String(existing.fields[field] ?? "").trim())
            continue;
        const targetType = allowTypeChange ? recognized.itemTypeID : existing.itemTypeID;
        if (!validForTypeID(field, targetType))
            continue;
        const oldValue = existing.fields[field] ?? "";
        if (field === 'title' && typeof newValue === 'string' && sameTitleSetDifferently(oldValue, newValue))
            continue;
        if (field === 'title' && typeof newValue === 'string' && damagedReading(newValue)
            && titleSimilarity(oldValue, newValue) >= 0.6)
            continue;
        if (field === 'language' && typeof newValue === 'string'
            && String(newValue).toLowerCase().split(/[-_]/)[0] === 'ko'
            && titleScript(String(existing.fields.title ?? '').trim() || String(recognized.fields.title ?? '')) === 'none')
            continue;
        if (field === 'title' && typeof newValue === 'string' && cutsStoredTitleShort(oldValue, newValue))
            continue;
        if (field === 'title' && typeof newValue === 'string' && decoratedRestatement(oldValue, newValue, recognized.fields))
            continue;
        if (DATE_FIELDS.has(field) && sameDate(oldValue, newValue))
            continue;
        if (DATE_FIELDS.has(field) && coarserOrDefaultDate(oldValue, newValue))
            continue;
        if (field === 'publisher' && samePublisher(oldValue, newValue))
            continue;
        if (CONTAINER_NAME_FIELDS.has(field) && typeof newValue === 'string'
            && sameTitleSetDifferently(oldValue, newValue))
            continue;
        if (field === 'DOI' && sameDOI(oldValue, newValue))
            continue;
        if (field === 'url' && sameDOILink(oldValue, newValue))
            continue;
        if (String(oldValue) === String(newValue))
            continue;
        if (IDENTIFIER_LIST_FIELDS.has(field) && typeof newValue === 'string') {
            const merged = mergedIdentifierList(field, oldValue, newValue);
            if (merged !== null) {
                if (merged !== String(oldValue))
                    changes.push({ field, oldValue, newValue: merged });
                continue;
            }
        }
        changes.push({ field, oldValue, newValue });
    }
    const creators = recognized.creators.map((creator: any) => Object.fromEntries(Object.entries(creator).map(([key, value]) => [key,
        ['firstName', 'lastName', 'name'].includes(key) && typeof value === 'string' ? decodeMetadataText(value) : value])));
    const roleName = (creator: any) => {
        let type = creator?.creatorType;
        if (!type && creator?.creatorTypeID !== undefined) {
            try {
                type = Zotero.CreatorTypes.getName(creator.creatorTypeID);
            }
            catch {
                type = String(creator.creatorTypeID);
            }
        }
        return String(type || 'author');
    };
    const creatorKey = (creator: any) => {
        const name = (value: unknown) => String(value || '').normalize('NFKC').replace(/[.\s]+/g, '').toLowerCase();
        return JSON.stringify([name(`${creator?.lastName || creator?.name || ''}${creator?.firstName || ''}`), roleName(creator)]);
    };
    const personKey = (creator: any) => String(`${creator?.lastName ?? creator?.name ?? ''} ${creator?.firstName ?? ''}`)
        .normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
        .split(/[^\p{L}\p{N}]+/u).filter(Boolean).sort().join(' ');
    const reconciled: any[] = [];
    const used = new Set<any>();
    const partner = pairedByLine(existing.creators);
    const flatName = (creator: any) => String(`${creator?.lastName ?? creator?.name ?? ''} ${creator?.firstName ?? ''}`)
        .normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
    const romanOnly = (entry: any) => { const parts = nameScripts(entry); return !parts.hangul && !!parts.latin; };
    const listMate = (entry: any, person: any) => {
        const mate: any = partner.get(entry);
        return mate && romanOnly(mate) && flatName(mate) === flatName(person) ? mate : null;
    };
    for (const person of creators) {
        const at = reconciled.findIndex((kept: any) => samePersonAcrossScripts(kept, person) || !!listMate(kept, person));
        if (at >= 0) {
            const mate = listMate(reconciled[at], person);
            if (mate)
                used.add(mate);
            continue;
        }
        let held = existing.creators.find((stored: any) => !used.has(stored) && samePersonAcrossScripts(stored, person));
        if (!held) {
            const roman = existing.creators.find((stored: any) => !used.has(stored) && romanOnly(stored)
                && !!partner.get(stored) && !used.has(partner.get(stored)) && flatName(stored) === flatName(person));
            if (roman) {
                used.add(roman);
                held = partner.get(roman) as any;
            }
        }
        if (!held) {
            const respelt = existing.creators.find((stored: any) => !used.has(stored) && sameNameSetDifferently(stored, person));
            if (respelt) {
                used.add(respelt);
                const spelling: Record<string, unknown> = {};
                for (const part of [...NAME_PARTS, 'fieldMode'] as const)
                    if (part in (respelt as any))
                        spelling[part] = (respelt as any)[part];
                reconciled.push({ ...person, ...spelling });
                continue;
            }
        }
        if (!held) {
            reconciled.push(person);
            continue;
        }
        used.add(held);
        const mate = partner.get(held);
        if (mate)
            used.add(mate);
        reconciled.push(held);
    }
    if (reconciled.length) {
        const stated = new Set(reconciled.map(roleName));
        const named = new Set(reconciled.map(personKey));
        existing.creators.forEach((stored: any, index: number) => {
            if (used.has(stored) || stated.has(roleName(stored)) || named.has(personKey(stored)))
                return;
            reconciled.splice(Math.min(index, reconciled.length), 0, stored);
            named.add(personKey(stored));
        });
    }
    const sameCreators = existing.creators.length === reconciled.length && existing.creators.every((creator: any, index: number) => creatorKey(creator) === creatorKey(reconciled[index]));
    if (reconciled.length && !sameCreators) {
        changes.push({ field: "creators", oldValue: existing.creators, newValue: reconciled });
    }
    if (authoritative && Object.keys(existing.fields).length) {
        const targetType = allowTypeChange ? recognized.itemTypeID : existing.itemTypeID;
        for (const [field, value] of Object.entries(existing.fields)) {
            if (!value || field in recognized.fields || OWNED_BY_THE_LIBRARY.has(field))
                continue;
            if (!RECORD_STATES.has(field) || STATED_INCONSISTENTLY.has(field))
                continue;
            if (!validForTypeID(field, targetType))
                continue;
            changes.push({ field, oldValue: value, newValue: '' });
        }
    }
    return changes;
}
export function coarserOrDefaultDate(oldValue: unknown, newValue: unknown): boolean {
    const held = String(canonicalDate(String(oldValue ?? '')) || oldValue || '').trim();
    const offered = String(canonicalDate(String(newValue ?? '')) || newValue || '').trim();
    if (!held || !offered)
        return false;
    if (held.length > offered.length && held.startsWith(offered) && /^\d{4}(?:-\d{2})?$/.test(offered))
        return true;
    return /^\d{4}-01-01$/.test(offered) && /^\d{4}-\d{2}/.test(held) && held.slice(0, 4) === offered.slice(0, 4) && held.slice(5, 7) !== '01';
}
const LEGAL_FORM = /\b(?:ltd|limited|inc|incorporated|llc|l\.?l\.?c|plc|bv|b\.?v|nv|n\.?v|gmbh|ag|sa|s\.?a|sas|srl|spa|s\.?p\.?a|ab|as|oy|kk|pty|co|company|corp|corporation|group|holdings?|press|publishers?|publishing|publications?|the)\b/g;
export const publisherLetters = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/\([^)]*\)/g, ' ').replace(/[.,]/g, '').replace(LEGAL_FORM, ' ').replace(/[^\p{L}\p{N}]+/gu, '');
function publisherWords(value: unknown): string[] {
    const words = String(value ?? '').normalize('NFKC').replace(/\([^)]*\)/g, ' ').replace(/[.,]/g, '')
        .split(/[^\p{L}\p{N}]+/u).filter(word => !!word && word.toLowerCase() !== 'and' && publisherLetters(word) !== '');
    if (words.length > 1 && /^[A-Z]{2}$/.test(words[words.length - 1]))
        words.pop();
    return words.map(word => word.toLowerCase());
}
export function samePublisher(a: unknown, b: unknown): boolean {
    const x = publisherLetters(a), y = publisherLetters(b);
    if (!x || !y)
        return false;
    if (x === y)
        return true;
    const first = publisherWords(a), second = publisherWords(b);
    if (!first.length || !second.length)
        return false;
    if (first.join(' ') === second.join(' '))
        return true;
    const [house, other] = first.length === 1 ? [first, second] : second.length === 1 ? [second, first] : [null, null];
    return !!house && !!other && house[0].length >= 4 && house[0] === other[0];
}
export const IDENTIFIER_LIST_FIELDS = new Set(['ISBN', 'ISSN']);
function identifierPieces(value: unknown): string[] {
    return String(value ?? '').normalize('NFKC')
        .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
        .split(/[,;/|]+|\s+/)
        .map(piece => piece.trim().replace(/^[^0-9]+|[^0-9Xx]+$/g, ''))
        .filter(Boolean);
}
function identifierKey(field: string, piece: string): string {
    const digits = piece.toUpperCase().replace(/[^0-9X]/g, '');
    if (field === 'ISBN')
        return digits.length === 10 || digits.length === 13 ? normalizedISBN(digits) : '';
    return digits.length === 8 ? digits : '';
}
function wellFormedIdentifier(field: string, piece: string): boolean {
    if (field === 'ISSN')
        return /^\d{4}-\d{3}[\dX]$/i.test(piece);
    return piece.includes('-') && /^[\d-]+[\dX]$/i.test(piece);
}
export function mergedIdentifierList(field: string, stored: unknown, read: unknown): string | null {
    if (!IDENTIFIER_LIST_FIELDS.has(field))
        return null;
    const storedText = String(stored ?? '').trim(), readText = String(read ?? '').trim();
    if (!storedText || !readText)
        return null;
    const held = identifierPieces(storedText), offered = identifierPieces(readText);
    const keyed = (pieces: string[]) => pieces.map(piece => ({ piece, key: identifierKey(field, piece) }));
    const a = keyed(held), b = keyed(offered);
    if (!a.length || !b.length || a.some(entry => !entry.key) || b.some(entry => !entry.key))
        return null;
    if (!b.some(entry => a.some(other => other.key === entry.key)))
        return null;
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const entry of a) {
        if (seen.has(entry.key))
            continue;
        seen.add(entry.key);
        const better = b.find(other => other.key === entry.key
            && wellFormedIdentifier(field, other.piece) && !wellFormedIdentifier(field, entry.piece));
        merged.push(better ? better.piece : entry.piece);
    }
    for (const entry of b) {
        if (seen.has(entry.key))
            continue;
        seen.add(entry.key);
        merged.push(entry.piece);
    }
    const separator = storedText.includes(',') || (held.length < 2 && readText.includes(',')) ? ', ' : ' ';
    return merged.join(separator);
}
const PAGE_RANGE = /^(\d{1,6})\s*[‐-―−-]\s*(\d{1,6})$/;
const PRINTED_DASH = '[\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015\\u2212\\u2043\\u301c~/eE-]';
const NOT_A_DIGIT_AROUND = '\\d.\\u2010-\\u2015\\u2212-';
export function startPageTheDocumentDoesNotPrint(stored: unknown, read: unknown, firstPageText: unknown, documentExtentPages: number): boolean {
    const held = PAGE_RANGE.exec(String(stored ?? '').normalize('NFKC').trim());
    const offered = PAGE_RANGE.exec(String(read ?? '').normalize('NFKC').trim());
    const page = String(firstPageText ?? '').normalize('NFKC').replace(/\s+/g, ' ');
    if (!held || !offered || !page)
        return false;
    if (held[2] !== offered[2] || held[1] === offered[1])
        return false;
    const span = (from: string, to: string) => Number(to) - Number(from) + 1;
    if (!Number.isInteger(documentExtentPages) || documentExtentPages < 1)
        return false;
    if (documentExtentPages !== span(held[1], held[2]))
        return false;
    if (documentExtentPages === span(offered[1], offered[2]))
        return false;
    const asRange = (from: string, to: string) => new RegExp(`(?<![\\d.])${from}\\s*${PRINTED_DASH}\\s*${to}(?!\\d)`).test(page);
    const alone = (number: string) => new RegExp(`(?<![${NOT_A_DIGIT_AROUND}])${number}(?![${NOT_A_DIGIT_AROUND}])`).test(page);
    return (asRange(held[1], held[2]) || alone(held[1]))
        && !asRange(offered[1], offered[2]) && !alone(offered[1]);
}
export function startPageTheDocumentPrints(read: unknown, firstPageText: unknown, documentExtentPages: number): string | null {
    const offered = PAGE_RANGE.exec(String(read ?? '').normalize('NFKC').trim());
    const page = String(firstPageText ?? '').normalize('NFKC').replace(/\s+/g, ' ');
    if (!offered || !page || !Number.isInteger(documentExtentPages) || documentExtentPages < 1)
        return null;
    const span = (from: string, to: string) => Number(to) - Number(from) + 1;
    if (documentExtentPages === span(offered[1], offered[2]))
        return null;
    const alone = (number: string) => new RegExp(`(?<![${NOT_A_DIGIT_AROUND}])${number}(?![${NOT_A_DIGIT_AROUND}])`).test(page);
    const printed = new RegExp(`(?<![\\d.])(\\d{1,6})\\s*${PRINTED_DASH}\\s*${offered[2]}(?!\\d)`, 'g');
    if (new RegExp(`(?<![\\d.])${offered[1]}\\s*${PRINTED_DASH}\\s*${offered[2]}(?!\\d)`).test(page) || alone(offered[1]))
        return null;
    for (const match of page.matchAll(printed)) {
        if (match[1] !== offered[1] && span(match[1], offered[2]) === documentExtentPages)
            return `${match[1]}-${offered[2]}`;
    }
    return null;
}

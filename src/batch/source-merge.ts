import type { MetadataSnapshot } from '../types';
import { snapshotFrom } from '../recognition/international-catalog';
import { storableType } from '../recognition/item-fields';
import { canonicalDate, readDates } from '../recognition/roles';
import { foldedLetters, linesOf, shouting, withoutNoteMarks } from '../recognition/folded-letters';
import { hangulNamesOf, misreadAgainstRecord, personKey, sameName, samePerson } from '../metadata/name-equivalence';
export { confusableJamo, hangulNamesOf, misreadAgainstRecord, ocrConfusedName, personKey, samePerson } from '../metadata/name-equivalence';
import { sameDOI } from '../metadata/identifier-compare';
import { titleWithStatedSubtitle } from '../ocr/vision-record';
import { sanitizeCreators } from './evaluate';
import { NAME_FIELDS, REFINABLE_DATES, diacriticsIn, movedStatement, pagesAsARange, personStatement, statementOf, type IdentifierOutcome, type StatementContext } from './field-contract';
import type { EvidenceBundle } from './evidence';
export function caseIsLowered(value: unknown): boolean {
    const words = String(value ?? '').normalize('NFKC').split(/\s+/).filter(Boolean);
    let content = 0, capitalised = 0;
    for (let at = 0; at < words.length; at++) {
        const opening = at === 0 || /[:：.?!]$/.test(words[at - 1]) || /^[-–—]$/.test(words[at - 1]);
        const letters = words[at].replace(/[^\p{Script=Latin}]/gu, '');
        if (opening || letters.length < 4)
            continue;
        content++;
        if (/^[^\p{L}]*\p{Lu}/u.test(words[at]))
            capitalised++;
    }
    return content >= 2 && capitalised * 2 < content;
}
function betterSpelling(read: string, stated: string, field = '', patent = false): boolean {
    if (read === stated || !foldedLetters(read) || foldedLetters(read) !== foldedLetters(stated))
        return false;
    if (shouting(stated) && !shouting(read))
        return false;
    if (diacriticsIn(stated) < diacriticsIn(read))
        return false;
    const marked = withoutNoteMarks(read) !== read.trim() && withoutNoteMarks(stated) === stated.trim();
    const recased = shouting(read) && !shouting(stated) && (!patent || NAME_FIELDS.includes(field) || field === 'journalAbbreviation' || !caseIsLowered(stated));
    const subscripted = SUBSCRIPT_LETTERS.test(read) && !SUBSCRIPT_LETTERS.test(stated);
    return recased || diacriticsIn(stated) > diacriticsIn(read) || marked || subscripted;
}
function statedPartsOf(stated: any, last: string, first: string): {
    last: string;
    first: string;
} | null {
    if (stated && typeof stated === 'object') {
        const statedLast = String(stated.lastName ?? stated.name ?? ''), statedFirst = String(stated.firstName ?? '');
        return foldedLetters(statedLast) === foldedLetters(last) && foldedLetters(statedFirst) === foldedLetters(first) ? { last: statedLast, first: statedFirst } : null;
    }
    const tokens = String(stated ?? '').trim().split(/\s+/).filter(Boolean);
    for (let cut = 0; cut <= tokens.length; cut++) {
        const head = tokens.slice(0, cut).join(' '), tail = tokens.slice(cut).join(' ');
        if (foldedLetters(head) === foldedLetters(first) && foldedLetters(tail) === foldedLetters(last))
            return { first: head, last: tail };
        if (foldedLetters(head) === foldedLetters(last) && foldedLetters(tail) === foldedLetters(first))
            return { last: head, first: tail };
    }
    return null;
}
function misreadPartsOf(stated: any, last: string, first: string): {
    last: string;
    first: string;
} | null {
    const latin = (value: string) => /^[\p{Script=Latin}\s.'’\-‐]+$/u.test(value);
    if (!last.trim() || !first.trim() || !latin(`${last} ${first}`))
        return null;
    const options: Array<{
        last: string;
        first: string;
    }> = [];
    if (stated && typeof stated === 'object')
        options.push({ last: String(stated.lastName ?? stated.name ?? '').trim(), first: String(stated.firstName ?? '').trim() });
    else {
        const tokens = String(stated ?? '').trim().split(/\s+/).filter(Boolean);
        if (tokens.length > 8)
            return null;
        for (let cut = 1; cut < tokens.length; cut++) {
            options.push({ first: tokens.slice(0, cut).join(' '), last: tokens.slice(cut).join(' ') });
            options.push({ last: tokens.slice(0, cut).join(' '), first: tokens.slice(cut).join(' ') });
        }
    }
    const found = options.filter(option => option.last && option.first && latin(`${option.last} ${option.first}`)
        && (foldedLetters(option.first) === foldedLetters(first) || foldedLetters(option.last) === foldedLetters(last))
        && sameName({ lastName: last, firstName: first }, { lastName: option.last, firstName: option.first }, 'misreadCorrection', { field: 'person' }));
    return found.length === 1 ? found[0] : null;
}
export interface RefinementContext {
    pages?: string;
    subtitle?: string;
    misreadings?: boolean;
    registry?: boolean;
    patent?: boolean;
}
const SUBSCRIPT_LETTERS = /[ₐ-ₜ]/u;
function titleMisreadAgainstTheRegistry(read: string, stated: string): boolean {
    const a = foldedLetters(read), b = foldedLetters(stated);
    if (a.length < 12 || !b)
        return false;
    const lettersOnly = (value: string) => value.replace(/\p{N}+/gu, '');
    if (lettersOnly(a) !== lettersOnly(b))
        return false;
    if (a === b)
        return SUBSCRIPT_LETTERS.test(read) && !SUBSCRIPT_LETTERS.test(stated);
    return a.length <= 400 && b.length <= 400 && editDistance(a, b) <= 2;
}
const SUBTITLE_BREAK = /\s*[:：]\s*|\s+[-–—]\s+|\.\s+/gu;
function titleWithItsSubtitle(read: string, stated: string, context: RefinementContext): string | null {
    const title = read.replace(/\s+/g, ' ').trim(), whole = stated.replace(/\s+/g, ' ').trim();
    const key = foldedLetters(title);
    if (key.length < 3 || foldedLetters(whole) === key)
        return null;
    for (const cut of whole.matchAll(SUBTITLE_BREAK)) {
        const at = cut.index ?? -1;
        if (at <= 0 || foldedLetters(whole.slice(0, at)) !== key)
            continue;
        const tail = whole.slice(at + cut[0].length).trim();
        const subtitle = foldedLetters(tail);
        if (subtitle.length < 3)
            return null;
        const head = whole.slice(0, at).trim();
        const main = betterSpelling(title, head, 'title', context.patent) ? head : title;
        if (titleWithStatedSubtitle(main, tail, tail) === main)
            return null;
        const named = String(context.subtitle ?? '').replace(/\s+/g, ' ').trim();
        if (named && foldedLetters(named) === subtitle)
            return `${main}: ${named}`;
        const lines = linesOf(context.pages);
        const printed = lines.find(line => foldedLetters(line) === subtitle);
        if (printed)
            return `${main}: ${printed.replace(/^[:：\s–—-]+/u, '')}`;
        return lines.some(line => foldedLetters(line) === key + subtitle) ? `${main}: ${tail}` : null;
    }
    return null;
}
export function refinedForm(field: string, read: unknown, stated: unknown, context: RefinementContext = {}): unknown | null {
    if (field === 'accessDate' || read === null || read === undefined || stated === null || stated === undefined)
        return null;
    if (field === 'title' && typeof read === 'string' && typeof stated === 'string') {
        const fuller = titleWithItsSubtitle(read, stated, context);
        if (fuller)
            return fuller;
        if (context.registry && read.trim() !== stated.trim() && titleMisreadAgainstTheRegistry(read, stated))
            return stated.trim();
    }
    if (field === 'creators') {
        if (!Array.isArray(read) || !read.length)
            return null;
        const people = Array.isArray(stated) ? stated : typeof stated === 'string' ? stated.split(/\s*;\s*/).filter(Boolean) : null;
        if (!people || people.length !== read.length)
            return null;
        let changed = false;
        const refined: any[] = [];
        for (let at = 0; at < read.length; at++) {
            const person = read[at] || {};
            const last = String(person.lastName ?? person.name ?? ''), first = String(person.firstName ?? '');
            const forms = statedPartsOf(people[at], last, first);
            if (!forms) {
                const whole = `${last}${first}`.replace(/\s+/g, '');
                const another = (name: string) => read.some((other, i) => i !== at && hangulNamesOf(other).includes(name));
                const form = /^[가-힣]{2,6}$/.test(whole) && context.misreadings !== false
                    ? hangulNamesOf(people[at]).find(name => misreadAgainstRecord(whole, name) && !another(name)) : undefined;
                const latin = !form && context.misreadings !== false ? misreadPartsOf(people[at], last, first) : null;
                if (latin && !read.some((other, i) => i !== at && personKey(other) === foldedLetters(`${latin.last}${latin.first}`))) {
                    refined.push({ ...person, lastName: latin.last, firstName: latin.first });
                    changed = true;
                    continue;
                }
                if (!form)
                    return null;
                const cut = first ? last.replace(/\s+/g, '').length : form.length;
                refined.push({ ...person, lastName: form.slice(0, cut), firstName: form.slice(cut) });
                changed = true;
                continue;
            }
            const better = (part: string, form: string) => part !== form && !(shouting(form) && !shouting(part)) && diacriticsIn(form) >= diacriticsIn(part)
                && ((shouting(part) && !shouting(form)) || diacriticsIn(form) > diacriticsIn(part));
            const lastName = better(last, forms.last) ? forms.last : last, firstName = better(first, forms.first) ? forms.first : first;
            if (lastName !== last || firstName !== first)
                changed = true;
            refined.push({ ...person, lastName, firstName });
        }
        return changed ? refined : null;
    }
    if (typeof read !== 'string' || typeof stated !== 'string')
        return null;
    if (field === 'pages') {
        const one = pagesAsARange(read), range = /^([A-Za-z]?\d{1,6})-([A-Za-z]?\d{1,6})$/.exec(pagesAsARange(stated));
        const number = (value: string) => Number(value.replace(/\D/g, ''));
        return one && !one.includes('-') && range && range[1] === one && number(range[2]) > number(range[1]) ? `${range[1]}-${range[2]}` : null;
    }
    if (REFINABLE_DATES.has(field)) {
        const held = canonicalDate(read), fuller = canonicalDate(stated);
        if (!held || !fuller || fuller.length <= held.length || !fuller.startsWith(held))
            return null;
        if (context.pages === undefined)
            return fuller;
        const HISTORY = new Set(['accessDate', 'receivedDate', 'acceptedDate', 'submissionDate']);
        const printed = readDates(context.pages).some(reading => !HISTORY.has(String(reading.role)) && reading.value.length > held.length
            && (fuller.startsWith(reading.value) || reading.value.startsWith(fuller)));
        return printed ? fuller : null;
    }
    if (NAME_FIELDS.includes(field) && context.misreadings !== false && misreadAgainstRecord(read, stated))
        return stated.trim();
    return betterSpelling(read.trim(), stated.trim(), field, context.patent) ? stated : null;
}
export function editDistance(a: string, b: string): number {
    const x = [...a], y = [...b];
    let previous = Array.from({ length: y.length + 1 }, (_, at) => at);
    for (let i = 1; i <= x.length; i++) {
        const row = [i];
        for (let j = 1; j <= y.length; j++)
            row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
        previous = row;
    }
    return previous[y.length];
}
export function ocrConfusionOf(read: string, printed: string): number {
    const a = read.toLowerCase(), b = printed.toLowerCase();
    if (a === b || Math.abs(a.length - b.length) > 2)
        return 0;
    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
    if (longer.startsWith(shorter) && /^[._/;:-]/.test(longer.slice(shorter.length)))
        return 0;
    const distance = editDistance(a, b);
    return distance <= 2 ? distance : 0;
}
let sameStatementFields: Set<string> | null = null;
const SAME_STATEMENT_FIELDS = () => sameStatementFields ??= new Set(['title', ...NAME_FIELDS, 'journalAbbreviation', 'pages', ...REFINABLE_DATES, 'creators', 'DOI']);
export interface SameStatementContext extends RefinementContext {
    validated?: (field: string, value: string) => boolean;
}
export function sameStatement(field: string, held: unknown, offered: unknown, context: SameStatementContext = {}): unknown | null {
    if (!SAME_STATEMENT_FIELDS().has(field))
        return null;
    if (field === 'DOI') {
        const read = String(held ?? '').trim(), other = String(offered ?? '').trim();
        if (!read || !other || sameDOI(read, other))
            return null;
        return ocrConfusionOf(read, other) > 0 && !!context.validated?.('DOI', other) && !context.validated?.('DOI', read) ? other : null;
    }
    return refinedForm(field, held, offered, context);
}
export type SourceKind = 'reading' | 'link' | 'layer';
export const SOURCE_RANK: Record<SourceKind, number> = { reading: 1, link: 2, layer: 3 };
export interface MergeSource {
    kind: SourceKind;
    label: string;
    metadata: MetadataSnapshot;
    typeRead?: boolean | 'weak';
    abbreviated?: boolean;
    rolesStated?: string[];
    guessed?: string[];
}
export interface MergeContext {
    evidence?: EvidenceBundle;
    lookups?: IdentifierOutcome[];
    pages?: string;
}
export interface FieldOrigin {
    kind: SourceKind;
    label: string;
    refined?: {
        kind: SourceKind;
        label: string;
        from: unknown;
    };
}
export interface MergeOutcome {
    metadata: MetadataSnapshot;
    origin: Record<string, FieldOrigin>;
    filled: Array<{
        kind: SourceKind;
        label: string;
        fields: string[];
    }>;
    refined: Array<{
        field: string;
        kind: SourceKind;
        label: string;
        from: unknown;
        to: unknown;
    }>;
    refused: Array<{
        field: string;
        label: string;
        why: string;
    }>;
}
const emptyValue = (value: unknown) => value === undefined || value === null || (Array.isArray(value) ? !value.length : String(value).trim() === '');
export function containerSlot(type: string): string {
    return type === 'journalArticle' ? 'publicationTitle' : type === 'thesis' ? 'university'
        : type === 'report' ? 'institution' : type === 'conferencePaper' ? 'proceedingsTitle' : type === 'preprint' ? 'repository' : 'publisher';
}
const NOT_FILLED_BY_AN_UNTITLED_READING = new Set(['title', 'shortTitle', 'abstractNote', 'url', 'accessDate', 'libraryCatalog', 'extra', 'rights', 'callNumber', 'archive', 'archiveLocation']);
export function emptyFieldsFilledBy(base: MetadataSnapshot, reading: MetadataSnapshot): {
    metadata: MetadataSnapshot;
    filled: string[];
} {
    const fields: Record<string, unknown> = { ...(base.fields || {}) };
    const filled: string[] = [];
    for (const [field, value] of Object.entries(reading.fields || {})) {
        if (NOT_FILLED_BY_AN_UNTITLED_READING.has(field) || emptyValue(value) || !emptyValue(fields[field]))
            continue;
        fields[field] = value;
        filled.push(field);
    }
    return filled.length ? { metadata: { ...base, fields: fields as MetadataSnapshot['fields'] }, filled } : { metadata: base, filled };
}
export function creatorsOfRecord(record: MetadataSnapshot): Array<{
    firstName?: string;
    lastName: string;
    creatorType?: string;
}> {
    const types = (globalThis as {
        Zotero?: any;
    }).Zotero?.CreatorTypes;
    const out: Array<{
        firstName?: string;
        lastName: string;
        creatorType?: string;
    }> = [];
    for (const entry of (record.creators || []) as any[]) {
        let creatorType: string | undefined = entry?.creatorType || undefined;
        if (!creatorType && entry?.creatorTypeID !== undefined) {
            try {
                creatorType = types?.getName?.(entry.creatorTypeID) || undefined;
            }
            catch {
                creatorType = undefined;
            }
        }
        const lastName = String(entry?.lastName ?? entry?.name ?? '').trim();
        const firstName = String(entry?.firstName ?? '').trim();
        if (lastName)
            out.push({ ...(firstName && entry?.fieldMode !== 1 ? { firstName } : {}), lastName, creatorType });
    }
    return out;
}
function scriptOfPerson(person: any): 'hangul' | 'han' | 'latin' | '' {
    const whole = `${person?.lastName ?? ''}${person?.firstName ?? ''}`.normalize('NFC');
    const hangul = /[가-힣]/.test(whole), han = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(whole), latin = /\p{Script=Latin}/u.test(whole);
    return hangul && !han && !latin ? 'hangul' : han && !hangul && !latin ? 'han' : latin && !hangul && !han ? 'latin' : '';
}
export function oncePerPerson<T>(people: T[], script: 'hangul' | 'latin' | null, together: (a: T, b: T) => boolean = () => true): T[] {
    const out: T[] = [];
    for (const person of people) {
        const own = scriptOfPerson(person);
        const at = own ? out.findIndex(other => { const theirs = scriptOfPerson(other); return !!theirs && theirs !== own && together(other, person) && samePerson(other, person); }) : -1;
        if (at < 0) {
            out.push(person);
            continue;
        }
        if (script && own === script && scriptOfPerson(out[at]) !== script)
            out[at] = person;
    }
    return out;
}
function statedType(source: MergeSource): string {
    if (source.typeRead === false)
        return '';
    const type = storableType(source.metadata.itemType || 'document');
    return type === 'document' ? '' : type;
}
function fullerList(upper: any[], lower: any[], abbreviated: boolean): boolean {
    if (lower.length <= upper.length)
        return false;
    if (upper.every((person, at) => personKey(person) === personKey(lower[at])))
        return true;
    const surname = (person: any) => String(person?.lastName ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}]+/gu, '');
    return abbreviated && upper.every((person, at) => !!surname(person) && (surname(person) === surname(lower[at]) || personKey(person) === personKey(lower[at])));
}
function validatedByLookup(field: string, value: string, lookups: IdentifierOutcome[] | undefined): boolean {
    if (field !== 'DOI')
        return false;
    return (lookups || []).some(entry => String(entry?.kind || '') === 'DOI' && entry?.outcome === 'record' && sameDOI(String(entry.value || ''), value));
}
export function mergeSources(parent: any, before: MetadataSnapshot, sources: Array<MergeSource | null | undefined>, context: MergeContext = {}): MergeOutcome {
    const order = sources.map((source, at) => ({ source, at })).filter(entry => !!entry.source?.metadata)
        .sort((a, b) => SOURCE_RANK[a.source!.kind] - SOURCE_RANK[b.source!.kind] || a.at - b.at).map(entry => entry.source!);
    const origin: Record<string, FieldOrigin> = {};
    const holders = new Map<string, MergeSource>();
    const hold = (field: string, source: MergeSource, extra: Partial<FieldOrigin> = {}) => { holders.set(field, source); origin[field] = { kind: source.kind, label: source.label, ...extra }; };
    const refined: MergeOutcome['refined'] = [];
    const refused: MergeOutcome['refused'] = [];
    if (!order.length)
        return { metadata: snapshotFrom(parent, before, 'document', {}, []), origin, filled: [], refined, refused };
    const top = order[0];
    let typeFrom: MergeSource | undefined;
    for (const source of order) {
        const type = statedType(source);
        if (!type)
            continue;
        if (!typeFrom) {
            typeFrom = source;
            if (source.typeRead !== 'weak')
                break;
            continue;
        }
        if (type !== statedType(typeFrom))
            typeFrom = source;
        break;
    }
    const type = typeFrom ? statedType(typeFrom) : storableType(top.metadata.itemType || 'document');
    hold('itemType', typeFrom || top);
    const valid = new Map<MergeSource, Map<string, unknown>>();
    const invalid = new Map<MergeSource, Map<string, unknown>>();
    for (const source of order) {
        const own: Record<string, unknown> = { ...(source.metadata.fields || {}) };
        const sourceType = storableType(source.metadata.itemType || 'document');
        if ((!statedType(source) || source.typeRead === 'weak') && sourceType !== type) {
            const from = containerSlot(sourceType), to = containerSlot(type);
            if (from !== to && !emptyValue(own[from]) && emptyValue(own[to])) {
                own[to] = own[from];
                delete own[from];
            }
        }
        const record = { ...source.metadata, fields: { title: top.metadata.fields?.title, publisher: top.metadata.fields?.publisher, ...own } } as MetadataSnapshot;
        const statement: StatementContext = { evidence: context.evidence, itemType: type, creators: source.metadata.creators, lookups: context.lookups, record,
            fromRecord: source.kind === 'link', pages: context.pages };
        const values = new Map<string, unknown>(), rejected = new Map<string, unknown>();
        for (const [field, value] of Object.entries(own)) {
            if (emptyValue(value))
                continue;
            if (source.guessed?.includes(field)) {
                refused.push({ field, label: source.label, why: '판독기가 짐작으로 적은 값입니다' });
                continue;
            }
            if (field === 'abstractNote' && source.kind === 'reading') {
                refused.push({ field, label: source.label, why: 'LM Studio 판독의 초록은 쓰지 않습니다 — 초록은 연결된 기록에서만 채웁니다' });
                continue;
            }
            const judged = statementOf(field, value, statement);
            if (!judged) {
                values.set(field, value);
                continue;
            }
            if (!judged.unkept)
                rejected.set(field, value);
            refused.push({ field, label: source.label, why: judged.invalid });
            if (judged.as && emptyValue(own[judged.as]) && !values.has(judged.as)) {
                const moved = movedStatement(judged.as, judged.asValue ?? value, statement);
                if (moved)
                    values.set(judged.as, moved);
                else
                    refused.push({ field: judged.as, label: source.label, why: `「${String(judged.asValue ?? value).slice(0, 60)}」은 ${judged.as} 칸의 진술이 아닙니다 — ${field} 칸에서 옮기지 않았습니다` });
            }
        }
        valid.set(source, values);
        invalid.set(source, rejected);
    }
    const statementContext: SameStatementContext = {
        pages: context.pages,
        patent: order.some(source => source.metadata?.itemType === 'patent'),
        validated: (field, value) => validatedByLookup(field, value, context.lookups)
    };
    const fields: Record<string, unknown> = {};
    const names = [...new Set(order.flatMap(source => [...valid.get(source)!.keys(), ...invalid.get(source)!.keys()]))];
    for (const field of names) {
        const holder = order.find(source => valid.get(source)!.has(field));
        if (!holder) {
            const kept = order.find(source => invalid.get(source)!.has(field))!;
            fields[field] = invalid.get(kept)!.get(field);
            hold(field, kept);
            continue;
        }
        let value = valid.get(holder)!.get(field);
        hold(field, holder);
        for (const lower of order.slice(order.indexOf(holder) + 1)) {
            if (!valid.get(lower)!.has(field))
                continue;
            const registry = lower.kind === 'link' && validatedByLookup('DOI', String(lower.metadata.fields?.DOI ?? ''), context.lookups);
            const better = sameStatement(field, value, valid.get(lower)!.get(field), { ...statementContext, misreadings: lower.kind !== 'layer', registry });
            if (better === null || better === undefined || JSON.stringify(better) === JSON.stringify(value))
                continue;
            refined.push({ field, kind: lower.kind, label: lower.label, from: value, to: better });
            origin[field] = { ...origin[field], refined: { kind: lower.kind, label: lower.label, from: value } };
            value = better;
            break;
        }
        fields[field] = value;
    }
    const spoken = String(order.map(source => source.metadata.fields?.language).find(value => String(value ?? '').trim()) ?? '').toLowerCase();
    const bodyScript = /^ko\b/.test(spoken) ? 'hangul' : /^(?:ja|zh)\b/.test(spoken) ? null : spoken ? 'latin' : null;
    const peopleOf = (source: MergeSource) => source.guessed?.includes('creators') ? []
        : oncePerPerson(creatorsOfRecord(source.metadata).filter(person => personStatement(person)), bodyScript);
    const lists = order.map(source => ({ source, people: peopleOf(source) }));
    for (const entry of lists)
        if (entry.source.guessed?.includes('creators') && (entry.source.metadata.creators || []).length)
            refused.push({ field: 'creators', label: entry.source.label, why: '판독기가 짐작으로 고른 사람입니다' });
    const base = lists.find(entry => entry.people.length);
    let creators: any[] = [];
    let abbreviated = false;
    if (base) {
        const later = lists.slice(lists.indexOf(base) + 1).filter(entry => entry.people.length);
        const roleStated = (person: any) => base.source.kind !== 'reading' || !base.source.rolesStated || base.source.rolesStated.includes(personKey(person));
        const confirms = (entry: (typeof lists)[number]) => entry.source.kind !== 'layer' && entry.people.length === base.people.length
            && entry.people.every((other, at) => samePerson(base.people[at], other));
        const until = later.findIndex(confirms);
        const fuller = (until < 0 ? later : later.slice(0, until)).find(entry => fullerList(base.people, entry.people, !!base.source.abbreviated));
        if (fuller) {
            creators = fuller.people.map((person, at) => at < base.people.length && roleStated(base.people[at]) && base.people[at].creatorType
                ? { ...person, creatorType: base.people[at].creatorType } : person);
            hold('creators', fuller.source);
        }
        else {
            creators = base.people;
            hold('creators', base.source);
            abbreviated = !!base.source.abbreviated;
            let listRefined = false;
            for (const entry of later) {
                const better = refinedForm('creators', creators, entry.people, { misreadings: entry.source.kind !== 'layer' }) as any[] | null;
                if (!better)
                    continue;
                refined.push({ field: 'creators', kind: entry.source.kind, label: entry.source.label, from: creators, to: better });
                origin.creators = { ...origin.creators, refined: { kind: entry.source.kind, label: entry.source.label, from: creators } };
                creators = better;
                listRefined = true;
                break;
            }
            const readsRoles = base.source.kind === 'reading' && !!base.source.rolesStated;
            const keys = creators.map(personKey);
            creators = creators.map((person, at) => {
                let out = person;
                for (const entry of later) {
                    const same = entry.people.find(other => personKey(other) === personKey(out))
                        || entry.people.find(other => samePerson(out, other) && !keys.some((key, i) => i !== at && key === personKey(other)));
                    if (!same)
                        continue;
                    const better = listRefined ? null : (refinedForm('creators', [out], [same], { misreadings: entry.source.kind !== 'layer' }) as any[] | null)?.[0];
                    if (better && (better.lastName !== out.lastName || better.firstName !== out.firstName)) {
                        refined.push({ field: 'creators', kind: entry.source.kind, label: entry.source.label, from: `${out.lastName}${out.firstName || ''}`, to: `${better.lastName}${better.firstName || ''}` });
                        out = { ...out, lastName: better.lastName, ...(better.firstName ? { firstName: better.firstName } : {}) };
                    }
                    if (readsRoles && !roleStated(base.people[at] || person) && same.creatorType && same.creatorType !== out.creatorType) {
                        refined.push({ field: 'creators', kind: entry.source.kind, label: entry.source.label, from: out.creatorType, to: same.creatorType });
                        out = { ...out, creatorType: same.creatorType };
                    }
                    break;
                }
                return out;
            });
        }
    }
    else if (order.some(source => (source.metadata.creators || []).length)) {
        const kept = order.find(source => !source.guessed?.includes('creators') && (source.metadata.creators || []).length);
        if (kept) {
            creators = creatorsOfRecord(kept.metadata);
            hold('creators', kept);
        }
    }
    const snapshot = snapshotFrom(parent, before, type, fields, creators as any);
    const typeRead = typeFrom ? true : top.typeRead === false ? false : top.metadata.typeRead;
    if (typeRead !== undefined)
        snapshot.typeRead = typeRead;
    if (abbreviated)
        snapshot.creatorsAbbreviated = true;
    const language = String(snapshot.fields.language || '').toLowerCase();
    const metadata = sanitizeCreators(snapshot, /^ko\b/.test(language) ? 'hangul' : /^en\b/.test(language) ? 'latin' : null);
    const filled: MergeOutcome['filled'] = [];
    const note = (source: MergeSource, field: string) => {
        let entry = filled.find(item => item.label === source.label && item.kind === source.kind);
        if (!entry)
            filled.push(entry = { kind: source.kind, label: source.label, fields: [] });
        entry.fields.push(field);
    };
    const sourceOf = (field: string) => holders.get(field);
    if (typeFrom && typeFrom !== top && type !== storableType(top.metadata.itemType || 'document'))
        note(typeFrom, 'itemType');
    for (const field of Object.keys(fields)) {
        const from = sourceOf(field);
        if (from && from !== top && !emptyValue(metadata.fields[field]))
            note(from, field);
    }
    const creatorsFrom = sourceOf('creators');
    if (creatorsFrom && creatorsFrom !== top && (metadata.creators || []).length)
        note(creatorsFrom, 'creators');
    return { metadata, origin, filled, refined, refused };
}

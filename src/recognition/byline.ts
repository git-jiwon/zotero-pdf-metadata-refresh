import { BYLINE_READING_SHAPES, compact, authorRegion, issueHeadStatement, splitColumns, type BylineRole } from './roles';
import { PERSON_ROW_KINDS, joinWrappedRows, nameOfItem, pageKeysOf, personsOnly, readBylineRow, rowIsByline, withoutLeadingConnective } from './byline-row';
import { nameShape, personParts } from '../metadata/person-name';
import { initialsWord, nameRelation } from '../metadata/name-equivalence';
import { foldedLetters } from './folded-letters';
import type { AgentMention } from './agents';
import type { PageObservation } from './candidate';
import { tableRowsIn, type PageStructure } from './page-structure';
import { isKoreanSurname, isOrganisationName } from './title-guards';
import { PERSON_MEANINGS, alternationOf, readLabelCells, wordAlternationOf, wordsOf, type Meaning } from './label-words';
const COLOPHON_PEOPLE: ReadonlySet<Meaning> = new Set<Meaning>(['author', 'editor', 'translator', 'translatorEditor']);
type NameTest = (line: string) => boolean;
export function namesOfPersonRows(text: unknown): string[] {
    const out = new Set<string>();
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        const row = raw.trim();
        if (!row || row.length > 400)
            continue;
        const read = readBylineRow(row);
        if (!PERSON_ROW_KINDS.has(read.kind))
            continue;
        for (const item of read.items) {
            if (item.organisation || item.shape.person === 'no')
                continue;
            out.add(nameOfItem(item));
            for (const alternate of item.alternates)
                out.add(/^[가-힣\s]+$/.test(alternate) ? alternate.replace(/\s+/g, '') : alternate);
        }
    }
    return [...out];
}
export function namesInLines(lines: string[], _isName?: NameTest): string[] {
    const { NFKC, CJK_LETTER } = BYLINE_READING_SHAPES;
    const names: string[] = [];
    const scriptOfLine = (items: Array<{
        text: string;
    }>) => items.every(item => CJK_LETTER.test(item.text)) ? 'cjk' : items.every(item => !CJK_LETTER.test(item.text)) ? 'latin' : 'mixed';
    let previous: Array<{
        text: string;
    }> | null = null;
    for (const line of lines) {
        const people = readBylineRow(withoutLeadingConnective(NFKC(line)), { seated: true }).items.filter(item => item.shape.person !== 'no');
        if (!people.length)
            continue;
        const twice: boolean = !!previous && previous.length === people.length && scriptOfLine(previous) !== 'mixed' && scriptOfLine(people) !== 'mixed' && scriptOfLine(previous) !== scriptOfLine(people);
        previous = twice ? null : people;
        if (!twice)
            for (const item of people)
                names.push(nameOfItem(item));
    }
    return [...new Set(names)];
}
export function runningHeadNames(heads: Set<string> | undefined, _isName?: NameTest, title?: unknown): string[] {
    const own = compact(title);
    for (const head of heads || []) {
        const statement = issueHeadStatement(head);
        if (!statement || /\d|#/.test(statement) || (own && compact(statement) === own))
            continue;
        const row = readBylineRow(statement, { seated: true });
        if (row.shortened)
            continue;
        const people = personsOnly(statement, { seated: true });
        if (people)
            return people.map(nameOfItem);
    }
    return [];
}
const initialledParts = (parts: ReturnType<typeof personParts>) => { const given = String(parts?.firstName || '').trim(); return !!given && given.split(/[\s\-‐]+/).filter(Boolean).every(initialsWord); };
const surnameKeyOf = (parts: ReturnType<typeof personParts>) => foldedLetters(String(parts?.lastName ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().normalize('NFKD').replace(/\p{M}+/gu, ''));
interface ReadIndex {
    parts: Array<ReturnType<typeof personParts>>;
    bySurname: Map<string, number[]>;
}
function rememberRead(index: ReadIndex, name: string): void {
    const parts = personParts(name);
    index.parts.push(parts);
    if (!parts || initialledParts(parts))
        return;
    const key = surnameKeyOf(parts);
    if (!key)
        return;
    const held = index.bySurname.get(key);
    if (held)
        held.push(index.parts.length - 1);
    else
        index.bySurname.set(key, [index.parts.length - 1]);
}
function echoOfRead(row: string[], read: ReadIndex, from: number): number | null {
    if (!row.length || !read.parts.length)
        return null;
    let at = from;
    for (const name of row) {
        const parts = personParts(name);
        if (!parts || !initialledParts(parts))
            return null;
        let found = -1;
        for (const index of read.bySurname.get(surnameKeyOf(parts)) || []) {
            if (index >= at && nameRelation(parts, read.parts[index]).relation === 'initials') {
                found = index;
                break;
            }
        }
        if (found < 0)
            return null;
        at = found + 1;
    }
    return at;
}
export function bylineBlock(text: unknown, _isName: (line: string) => boolean, options: {
    after?: string[];
    limit?: number;
    fromRow?: number;
} = {}): {
    names: string[];
    affiliations: string[];
    emails: string[];
    others: Array<{
        name: string;
        role: 'editor' | 'translator' | 'contributor' | 'author';
    }>;
    complete: boolean;
    ambiguousMarks: boolean;
    source: 'byline' | 'none';
} {
    const { afterTitle, byAuthorLine, BY_LINE, DATE_ONLY, CODE_LINE, EDITION_LINE, documentLabel, HANGUL, LATIN_WORD, RESPONSIBILITY_LINE, AFFILIATION_LINE, EMAIL_LINE, ORCID_LINE, CJK_LETTER } = BYLINE_READING_SHAPES;
    const rows = rowsOutsideTables(text);
    const fromRow = typeof options.fromRow === 'number' && options.fromRow >= 0 ? Math.min(options.fromRow, rows.length) : null;
    const after = fromRow !== null ? [] : (options.after || []).map(line => compact(line)).filter(Boolean);
    let start = fromRow ?? 0;
    if (after.length) {
        const joined = after.join('');
        let seen = false;
        for (const [index, row] of rows.slice(0, 30).entries()) {
            const value = compact(row);
            if (!value)
                continue;
            if (value.length >= 4 && joined.includes(value)) {
                seen = true;
                start = index + 1;
                continue;
            }
            if (seen)
                break;
        }
    }
    const keys = pageKeysOf(rows);
    let lastFilled = rows.length - 1;
    while (lastFilled > 0 && !rows[lastFilled].trim())
        lastFilled--;
    const names: string[] = [], affiliations: string[] = [], emails: string[] = [];
    const readIndex: ReadIndex = { parts: [], bySurname: new Map() };
    const pushName = (name: string) => { names.push(name); rememberRead(readIndex, name); };
    const trimmedRows = rows.map(line => line.trim());
    const others: Array<{
        name: string;
        role: 'editor' | 'translator' | 'contributor' | 'author';
    }> = [];
    const lastTitleRow = fromRow !== null ? [...rows.slice(0, fromRow)].reverse().find(row => row.trim()) || '' : '';
    const koreanTitle = fromRow !== null ? HANGUL.test(lastTitleRow) : after.some(line => HANGUL.test(line));
    let complete = true;
    let ambiguousMarks = false;
    const weldedAt: number[] = [];
    let previousRow: ReturnType<typeof readBylineRow>['items'] | null = null;
    let weldingShown = false, unkeyed = 0, keyedParts = 0, weldedLong = 0;
    const runWelded: Array<{
        at: number;
        name: string;
    }> = [];
    let keysApart = 0;
    let affiliationOpen = false;
    let seen = 0;
    let echoFrom = 0;
    let closedList = false;
    const keyedItem = (item: {
        keys: string[];
        marks: string[];
        alternates: string[];
    }) => item.keys.length > 0 || item.marks.length > 0 || item.alternates.length > 0;
    for (let at = start; at < rows.length; at++) {
        const row = rows[at];
        if (!row.trim())
            continue;
        const value = row.trim();
        const closedBefore = closedList;
        closedList = false;
        if (!names.length && !seen && BY_LINE.test(row))
            continue;
        if (DATE_ONLY.test(value) && !names.length)
            continue;
        if ((afterTitle(value) && !byAuthorLine(value)) || DATE_ONLY.test(value) || CODE_LINE.test(value))
            break;
        if (EDITION_LINE.test(value) || documentLabel(value))
            break;
        if (koreanTitle && !HANGUL.test(row) && LATIN_WORD.test(row)) {
            if (names.length)
                break;
            continue;
        }
        if (affiliationOpen && affiliations.length && splitColumns(row).length === 1) {
            affiliations[affiliations.length - 1] += ` ${value}`;
            affiliationOpen = /[,;–—-]$/.test(value);
            seen++;
            continue;
        }
        const columns = splitColumns(row);
        const wrapped = columns.length === 1 ? joinWrappedRows(trimmedRows, at, { pageKeys: keys, seated: true }) : null;
        let read = 0, affiliationColumns = 0, stop = false;
        for (const column of wrapped ? [null] : columns) {
            const reading = wrapped ? wrapped.row : readBylineRow(column as string, { pageKeys: keys, seated: true });
            const cell = wrapped ? value : String(column);
            if ((reading.kind === 'roleMarked' || reading.kind === 'labelled') && reading.role && reading.role !== 'author') {
                for (const item of reading.items)
                    if (item.shape.person !== 'no')
                        others.push({ name: nameOfItem(item), role: reading.role });
                read++;
                continue;
            }
            const foot = names.length > 0 && at === lastFilled && at > 0 && !rows[at - 1].trim() && (reading.kind === 'single' || reading.kind === 'pair') && !reading.items.some(item => item.shape.person === 'sure');
            const afterClosedList = closedBefore && reading.kind === 'single' && reading.items.every(item => item.shape.person !== 'sure' && !keyedItem(item));
            const people = PERSON_ROW_KINDS.has(reading.kind) && !foot && !afterClosedList ? reading.items.filter(item => item.shape.person !== 'no') : [];
            if (people.length && people.length === reading.items.length) {
                const scriptOfRow = (items: typeof people) => items.every(item => CJK_LETTER.test(item.text)) ? 'cjk' : items.every(item => !CJK_LETTER.test(item.text)) ? 'latin' : 'mixed';
                if (previousRow && previousRow.length === people.length && scriptOfRow(previousRow) !== 'mixed' && scriptOfRow(people) !== 'mixed' && scriptOfRow(previousRow) !== scriptOfRow(people)) {
                    previousRow = null;
                    read++;
                    continue;
                }
                const echo = echoOfRead(people.map(item => nameOfItem(item)), readIndex, echoFrom);
                if (echo !== null) {
                    echoFrom = echo;
                    read++;
                    continue;
                }
                previousRow = people;
                for (const item of people) {
                    const name = nameOfItem(item);
                    const tail = name.split(/\s+/).pop() || '';
                    const runKeys = item.run || [];
                    const keyedHere = item.keys.length > runKeys.length || item.marks.length > 0 || item.alternates.length > 0;
                    const endsOnAKey = !keyedHere && !CJK_LETTER.test(name) && tail.length >= 3 && keys.has(tail.slice(-1).toLowerCase());
                    const tailLetter = tail.slice(-1).toLowerCase();
                    const runLetters = runKeys.join('').replace(/[^a-z]/gi, '').toLowerCase();
                    const ascends = [...runLetters].every(letter => letter > tailLetter);
                    const keyRun = endsOnAKey && runKeys.length > 0 && runKeys.every(key => keys.has(key.toLowerCase()) || /^[*⁎∗†‡§¶∥‖⊥∇Ψ✉#⇑]+$/.test(key));
                    if (keyRun && !ascends) {
                        keyedParts++;
                        pushName(name);
                        continue;
                    }
                    const run = keyRun && ascends;
                    if (!endsOnAKey && !keyedHere && !CJK_LETTER.test(name) && runLetters && [...runLetters].every(letter => keys.has(letter)))
                        keysApart++;
                    if (item.keyAfterMark || item.keys.some(key => /^[*⁎∗†‡§¶∥‖⊥∇Ψ✉#⇑]*[a-z]{1,4}$/.test(key) && [...key.replace(/[^a-z]/g, '')].every(letter => keys.has(letter))))
                        weldingShown = true;
                    if (run) {
                        runWelded.push({ at: names.length, name });
                        pushName(name.slice(0, -1).trim());
                        keyedParts++;
                        continue;
                    }
                    if (endsOnAKey)
                        weldedAt.push(names.length);
                    if (endsOnAKey && tail.length >= 4)
                        weldedLong++;
                    else if (!endsOnAKey && keyedHere)
                        keyedParts++;
                    else if (!endsOnAKey)
                        unkeyed++;
                    pushName(name);
                }
                const lastRow = wrapped ? String(rows[wrapped.end] || '').trim() : cell.trim();
                if (people.length >= 2 && !/(?:[,;，、·&]|\band)$/iu.test(lastRow))
                    closedList = true;
                affiliations.push(...reading.affiliations);
                emails.push(...reading.contacts.filter(contact => EMAIL_LINE.test(contact)));
                read++;
                continue;
            }
            if (EMAIL_LINE.test(cell) && (reading.kind === 'contact' || reading.kind === 'none')) {
                emails.push(...reading.contacts.filter(contact => EMAIL_LINE.test(contact)), ...(!reading.contacts.length ? [cell] : []));
                read++;
                continue;
            }
            if (ORCID_LINE.test(cell)) {
                read++;
                continue;
            }
            if (reading.kind === 'affiliation' || isOrganisationName(cell) || AFFILIATION_LINE.test(cell) || RESPONSIBILITY_LINE.test(cell)) {
                affiliations.push(cell);
                read++;
                affiliationColumns++;
                continue;
            }
        }
        if (stop)
            break;
        seen++;
        if (wrapped)
            at = wrapped.end;
        affiliationOpen = read > 0 && affiliationColumns === (wrapped ? 1 : columns.length) && /[,;–—-]$/.test(affiliations[affiliations.length - 1] || '');
        if (!read && !names.length && /^\p{Ll}/u.test(value) && !affiliations.length) {
            seen--;
            continue;
        }
        if (!read) {
            complete = !names.length;
            break;
        }
    }
    if (keysApart)
        for (const entry of runWelded)
            names[entry.at] = entry.name;
    const keysWelded = !keysApart && (weldingShown || runWelded.length > 0);
    if (weldedAt.length) {
        if (keysWelded && !unkeyed && names.length >= 2 && keyedParts + weldedAt.length === names.length) {
            for (const at of weldedAt)
                names[at] = names[at].slice(0, -1).trim();
        }
        else if (weldedLong)
            ambiguousMarks = true;
    }
    if (!names.length || !seen)
        return { names: [], affiliations, emails, others, complete, ambiguousMarks, source: 'none' };
    return { names: [...new Set(names)], affiliations, emails, others, complete, ambiguousMarks, source: 'byline' };
}
const FORM_PERSON_LABEL = /(?:연\s*구\s*책\s*임\s*자|과\s*제\s*책\s*임\s*자|총\s*괄\s*책\s*임\s*자|성\s*명)(?![가-힣])\s*[:：]?\s*/g;
export function formPeople(text: string): string[] {
    const found: string[] = [];
    for (const match of text.matchAll(FORM_PERSON_LABEL)) {
        const tokens = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 40).split(/\s+/).filter(Boolean);
        let name = '';
        if (tokens[0] && /^[가-힣]{2,4}$/.test(tokens[0]))
            name = tokens[0];
        else {
            const singles: string[] = [];
            for (const token of tokens) {
                if (!/^[가-힣]$/.test(token) || (token === '인' && singles.length >= 2))
                    break;
                singles.push(token);
                if (singles.length === 4)
                    break;
            }
            if (singles.length >= 2)
                name = singles.join('');
        }
        if (name && isKoreanSurname(name[0]) && !found.includes(name))
            found.push(name);
    }
    return found;
}
const FORM_PERSON_CELL = /(?:^|\s)(?:연\s*구\s*책\s*임\s*자|과\s*제\s*책\s*임\s*자|총\s*괄\s*책\s*임\s*자|성\s*명|대\s*표\s*자|발\s*명\s*자|작\s*성\s*자|담\s*당\s*자|책\s*임\s*자)(?=\s*[:：]|[^\S\n]*$|[^\S\n]{2,})/m;
const SPACED_FORM_LABEL = /^[^\S\n]*[가-힣](?:[^\S\n][가-힣]){2,5}(?=[^\S\n]|$)/gm;
export function formStatesItsPersons(text: unknown): boolean {
    const { NFKC } = BYLINE_READING_SHAPES;
    const page = NFKC(text);
    return FORM_PERSON_CELL.test(page) && (page.match(SPACED_FORM_LABEL) || []).length >= 2;
}
function formRowLabel(row: string): string {
    const head = /^([가-힣]{2,10})(?=\s|$)/.exec(row.trim());
    return head ? head[1] : '';
}
export function formPeopleAcrossPages(texts: unknown[]): string[] {
    const { NFKC } = BYLINE_READING_SHAPES;
    const first = NFKC(texts[0] ?? '');
    const names = formPeople(first);
    if (!names.length)
        return names;
    const labels = new Set(first.split('\n').map(formRowLabel).filter(Boolean));
    for (const next of texts.slice(1)) {
        const rows = NFKC(next).split('\n').map(row => row.trim()).filter(Boolean);
        const region: string[] = [];
        let at = 0;
        while (at < rows.length && /^[-–—([]?\s*\d{1,4}\s*[-–—)\]]?$/.test(rows[at]))
            at++;
        for (; at < rows.length; at++) {
            const label = formRowLabel(rows[at]);
            if (!label || !labels.has(label))
                break;
            region.push(rows[at]);
        }
        if (region.length < 2)
            break;
        for (const name of formPeople(region.join('\n')))
            if (!names.includes(name))
                names.push(name);
        if (at < rows.length)
            break;
    }
    return names;
}
function rowsOutsideTables(text: unknown): string[] {
    const { NFKC } = BYLINE_READING_SHAPES;
    const tables = tableRowsIn(text);
    return NFKC(text).split('\n').map((row, at) => tables.has(at) ? '' : row);
}
const ADVISOR_LABEL = new RegExp(`^(?:${wordAlternationOf(['advisor'])})`, 'iu');
const ADVISOR_LABEL_WITH_GAP = new RegExp(`^(?:${wordAlternationOf(['advisor'])})\\s*[:：]?\\s*`, 'iu');
const COMMITTEE_LABEL = new RegExp(`^(?:${wordAlternationOf(['committee'])})`, 'iu');
const COMMITTEE_LABEL_WITH_GAP = new RegExp(`^(?:${wordAlternationOf(['committee'])})\\s*[:：]?\\s*`, 'iu');
export function responsibilityLines(text: unknown, _isName: (line: string) => boolean, options: {
    skipLines?: string[];
} = {}): {
    authors: string[];
    advisors: string[];
    committee: string[];
    editors: string[];
    translators: string[];
    source: 'label' | 'layout' | 'none';
} {
    const { NFKC, DATE_ONLY, AFFILIATION_LINE, EMAIL_LINE, ORCID_LINE, CORRESPONDING_MARK, TRAILING_MARKS, CJK_LETTER } = BYLINE_READING_SHAPES;
    const labelled = authorRegion(text);
    if (labelled) {
        const names = readBylineRow(NFKC(labelled.text).trim(), { seated: true }).items.map(nameOfItem)
            .map(part => part.trim().replace(TRAILING_MARKS, '').trim())
            .filter(part => part.length >= 2 && /[\p{L}]/u.test(part));
        if (names.length)
            return { authors: names, advisors: [], committee: [], editors: [], translators: [], source: 'label' };
    }
    const skip = new Set((options.skipLines || []).map(line => compact(line)));
    const lines = rowsOutsideTables(text).map(row => splitColumns(row))
        .flatMap(columns => columns.length >= 2 && !personsOnly(columns[columns.length - 1]) && columns.slice(0, -1).every(column => column.length <= 12) ? [] : columns)
        .filter(Boolean);
    const authors: string[] = [], advisors: string[] = [], committee: string[] = [], editors: string[] = [], translators: string[] = [];
    const responsible = formPeople(NFKC(text));
    if (responsible.length)
        return { authors: responsible, advisors, committee, editors, translators, source: 'label' };
    if (formStatesItsPersons(text))
        return { authors, advisors, committee, editors, translators, source: 'none' };
    const lastLine = [...lines].reverse().find(line => line.trim());
    let expecting: 'advisor' | 'committee' | null = null;
    const skipAll = [...skip].filter(Boolean);
    const compacted = lines.map(line => compact(line));
    const titlePiece = (at: number) => !!compacted[at] && skipAll.some(title => (at > 0 && !!compacted[at - 1] && title.includes(compacted[at - 1] + compacted[at]))
        || (at + 1 < compacted.length && !!compacted[at + 1] && title.includes(compacted[at] + compacted[at + 1])));
    const peopleOf = (value: string): {
        names: string[];
        role?: BylineRole;
    } | null => {
        const row = readBylineRow(value);
        const items = PERSON_ROW_KINDS.has(row.kind) && !row.organisations?.length ? row.items : [];
        if (!items.length || !items.every(item => item.shape.person !== 'no'))
            return null;
        if (row.kind !== 'roleMarked' && !items.every(item => CJK_LETTER.test(item.text)))
            return null;
        return { names: items.map(nameOfItem), ...(row.role ? { role: row.role } : {}) };
    };
    for (const [at, raw] of lines.entries()) {
        if (EMAIL_LINE.test(raw) || ORCID_LINE.test(raw) || AFFILIATION_LINE.test(raw)) {
            expecting = null;
            continue;
        }
        const line = raw.replace(CORRESPONDING_MARK, '').trim();
        if (!line)
            continue;
        if (skip.has(compact(line)) || titlePiece(at))
            continue;
        if (ADVISOR_LABEL.test(line)) {
            const inline = peopleOf(line.replace(ADVISOR_LABEL_WITH_GAP, '').trim());
            if (inline)
                advisors.push(...inline.names);
            else
                expecting = 'advisor';
            continue;
        }
        if (COMMITTEE_LABEL.test(line)) {
            const inline = peopleOf(line.replace(COMMITTEE_LABEL_WITH_GAP, '').trim());
            if (inline)
                committee.push(...inline.names);
            else
                expecting = 'committee';
            continue;
        }
        if (DATE_ONLY.test(line)) {
            if (authors.length)
                break;
            continue;
        }
        if (line === lastLine && /^[\p{Script=Han}가-힣]{2,6}(?:사|社|書房|書店|書院|出版|出版社)$/u.test(line.trim())) {
            expecting = null;
            continue;
        }
        const read = peopleOf(line);
        if (!read) {
            expecting = null;
            continue;
        }
        if (expecting === 'advisor') {
            advisors.push(...read.names);
            expecting = null;
            continue;
        }
        if (expecting === 'committee') {
            committee.push(...read.names);
            expecting = null;
            continue;
        }
        if (read.role === 'translator') {
            translators.push(...read.names);
            continue;
        }
        if (read.role === 'editor') {
            editors.push(...read.names);
            continue;
        }
        authors.push(...read.names);
    }
    return { authors, advisors, committee, editors, translators, source: authors.length ? 'layout' : 'none' };
}
const compactName = (value: unknown) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
let nameLabelBefore: RegExp | null = null;
const NAME_LABEL_BEFORE = () => nameLabelBefore || (nameLabelBefore = new RegExp(`(?:${alternationOf([...wordsOf(PERSON_MEANINGS, 'label').filter(word => !word.needsName),
    ...wordsOf(['position'], 'label', { script: ['ko'] }), ...wordsOf(['author'], 'lead').filter(word => !word.form.includes(' '))], 'label')})\\s*[:：]?$`, 'iu'));
export interface DocumentPeopleInput {
    title: unknown;
    source: Record<string, any> | undefined;
    readable: PageObservation[];
    pageStructure: PageStructure;
    runningHeads: Set<string>;
    evidenceText: string;
    roleAt: (entry: {
        page?: number;
    }) => string;
}
export function documentPeople(input: DocumentPeopleInput): {
    people: AgentMention[];
    affiliations: string[];
    emails: string[];
    confirmedByHead: boolean;
} {
    const { source, readable, pageStructure, runningHeads, evidenceText, roleAt } = input;
    const title = String(input.title ?? '');
    const isName: NameTest = () => false;
    const titleLines = source?.from === 'titleBlock' ? [title] : [];
    const titlePage = readable.find(entry => entry.page === source?.page);
    const pageText = titlePage ? (titlePage.layout || titlePage.text) : '';
    const blockLines = source?.blockLines?.length ? source.blockLines : titleLines;
    const parallelTitle = ((): {
        start: number;
        end: number;
    } | null => {
        const index = source?.block?.index, structure = source?.structure;
        if (!pageText || typeof index !== 'number' || !Array.isArray(structure))
            return null;
        const after = structure[index + 1];
        if (!after || after.kind !== 'text' || after.lines > 3)
            return null;
        const rows = pageText.normalize('NFKC').split('\n').slice(after.start, after.end + 1).map((row: string) => row.trim()).filter(Boolean).join(' ');
        const hangulRows = /[가-힣]/.test(rows);
        if (!rows || hangulRows === /[가-힣]/.test(title))
            return null;
        if (rowIsByline(rows, 'strict') || /[,;*†‡§¶]|\p{L}\d/u.test(rows))
            return null;
        if (hangulRows && rows.split(/\s*[·,、]\s*|\s+/).every(part => nameShape(part).person !== 'no'))
            return null;
        return { start: after.start, end: after.end };
    })();
    const bylineText = parallelTitle
        ? pageText.normalize('NFKC').split('\n').map((row: string, at: number) => at >= parallelTitle.start && at <= parallelTitle.end ? '' : row).join('\n')
        : pageText;
    const titleEnd = parallelTitle ? parallelTitle.end : (typeof source?.block?.end === 'number' ? source.block.end : null);
    const byline: any = pageText
        ? bylineBlock(bylineText, isName, titleEnd !== null ? { fromRow: titleEnd + 1 } : { after: blockLines })
        : { names: [], affiliations: [], emails: [], others: [], complete: true, ambiguousMarks: false, source: 'none' };
    const near: Array<{
        lines: string[];
        role?: string;
        position: string;
        start?: number;
        end?: number;
    }> = source?.bylines || [];
    const people: AgentMention[] = [];
    const editorial = new Set<string>();
    const pageRows = pageText ? pageText.normalize('NFKC').split('\n') : [];
    const linesOfEntry = (entry: typeof near[number]): Array<{
        text: string;
        role?: string;
    }> => {
        const aligned = typeof entry.start === 'number' && typeof entry.end === 'number' && entry.end - entry.start + 1 === entry.lines.length;
        return entry.lines.map((line, at) => {
            const row = aligned ? String(pageRows[Number(entry.start) + at] ?? '').trim() : '';
            const text = row && compact(line) && compact(row).startsWith(compact(line)) ? row : line;
            const own = readBylineRow(withoutLeadingConnective(text), { seated: true }).role;
            return { text, role: own || entry.role };
        });
    };
    const nonAuthor = (role?: string): role is 'editor' | 'translator' | 'contributor' => role === 'editor' || role === 'translator' || role === 'contributor';
    const authorLinesOf = (entry: typeof near[number]) => linesOfEntry(entry).filter(line => !nonAuthor(line.role)).map(line => line.text);
    for (const entry of near) {
        const lines = linesOfEntry(entry);
        for (let at = 0; at < lines.length;) {
            const role = lines[at].role;
            let end = at + 1;
            while (end < lines.length && lines[end].role === role)
                end++;
            if (nonAuthor(role)) {
                for (const name of namesInLines(lines.slice(at, end).map(line => line.text), isName)) {
                    people.push({ name, role, method: 'roleWord', page: source?.page });
                    editorial.add(compactName(name));
                }
            }
            at = end;
        }
    }
    for (const other of (byline.others || []) as Array<{
        name: string;
        role: string;
    }>) {
        if (other.role === 'author' || editorial.has(compactName(other.name)))
            continue;
        people.push({ name: other.name, role: other.role as AgentMention['role'], method: 'roleWord', page: source?.page });
        editorial.add(compactName(other.name));
    }
    if (editorial.size)
        byline.names = byline.names.filter((name: string) => !editorial.has(compactName(name)));
    if (!byline.names.length) {
        const above = near.find(entry => entry.position === 'above' && authorLinesOf(entry).length > 0);
        if (above) {
            byline.names = namesInLines(authorLinesOf(above), isName);
            byline.source = 'aboveTitle';
        }
    }
    if (!byline.names.length) {
        const below = near.find(entry => entry.position === 'below' && authorLinesOf(entry).length > 0);
        if (below) {
            byline.names = namesInLines(authorLinesOf(below), isName);
            byline.source = 'byline';
        }
    }
    if (!byline.names.length && source?.from === 'colophon' && titlePage && Array.isArray(source.rows) && source.rows.length) {
        const rows = String(titlePage.text || '').split('\n').slice(Math.min(...source.rows));
        for (const cell of readLabelCells(rows, { meanings: COLOPHON_PEOPLE, scripts: ['ko', 'ja', 'zh', 'latin'] })) {
            const names = cell.value.split(/\s*[·,、]\s*/).map(name => name.trim()).filter(name => name && name.length <= 20 && /\p{L}/u.test(name) && !/\d/.test(name) && !isOrganisationName(name));
            const role = cell.word.meaning === 'author' ? 'author' : cell.word.meaning === 'editor' ? 'editor' : 'translator';
            if (role === 'author') {
                if (!byline.names.length) {
                    byline.names = names;
                    byline.source = 'label';
                }
                continue;
            }
            for (const name of names) {
                people.push({ name, role, method: 'roleLabel', page: source?.page });
                editorial.add(compactName(name));
            }
        }
    }
    if (!byline.names.length && source?.byline && !editorial.has(compactName(source.byline))) {
        byline.names = [source.byline];
        byline.source = 'aboveTitle';
    }
    const headNames = runningHeadNames(runningHeads, isName, title);
    const confirmedByHead = headNames.length > 0 && byline.names.length === headNames.length
        && byline.names.every((name: string) => headNames.some(head => compactName(head) === compactName(name)));
    if (headNames.length && !editorial.size && (!byline.names.length || byline.ambiguousMarks)) {
        byline.names = headNames;
        byline.ambiguousMarks = false;
        byline.source = 'runningHead';
    }
    const usable = byline.names.length && !byline.ambiguousMarks;
    const responsibility: any = usable
        ? { authors: byline.names, advisors: [], committee: [], source: byline.source === 'aboveTitle' || byline.source === 'runningHead' ? byline.source : 'byline' }
        : responsibilityLines(pageText || evidenceText, isName, { skipLines: titleLines });
    if (responsibility.source === 'label' && titlePage) {
        const following: PageObservation[] = [];
        for (const entry of [...readable].sort((a, b) => (a.page ?? 0) - (b.page ?? 0))) {
            if ((entry.page ?? 0) === (titlePage.page ?? 0) + following.length + 1)
                following.push(entry);
        }
        const leading: PageObservation[] = [];
        for (let page = Number(titlePage.page) - 1; page >= 1; page--) {
            const entry = pageStructure.pages.find(held => held.page === page);
            const observed = readable.find(held => held.page === page);
            if (!entry || !observed || entry.role !== 'formPage' || entry.form !== 'labelled')
                break;
            leading.unshift(observed);
        }
        const across = formPeopleAcrossPages([...leading.map(entry => entry.text), titlePage.text, ...following.map(entry => entry.text)]);
        if (across.length > responsibility.authors.length && responsibility.authors.every((name: string) => across.includes(name))) {
            responsibility.authors = across;
        }
    }
    if (!responsibility.authors.length && pageText && source?.from !== 'labelledField') {
        const sweepable = readable.filter(entry => roleAt(entry) !== 'submission' && roleAt(entry) !== 'approval');
        const NAME_LABEL = NAME_LABEL_BEFORE();
        const sweepText = sweepable.map(entry => {
            const rows = entry.text.split('\n');
            return rows.filter((row, at) => {
                if (!/^[가-힣]{2,4}$/.test(row.trim()))
                    return true;
                const above = rows.slice(0, at).reverse().find(line => line.trim());
                return !!above && NAME_LABEL.test(above.trim());
            }).join('\n');
        }).join('\n\f\n');
        Object.assign(responsibility, responsibilityLines(sweepText, isName, { skipLines: titleLines }));
    }
    for (const name of responsibility.authors as string[]) {
        if (!editorial.has(compactName(name)))
            people.push({ name, role: 'author', method: responsibility.source, page: source?.page });
    }
    for (const name of responsibility.advisors as string[])
        people.push({ name, role: 'advisor', method: 'roleLabel' });
    const personByRoleWord = (name: string) => /[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(name) || nameShape(name).person !== 'no';
    for (const name of (responsibility.editors || []) as string[])
        if (personByRoleWord(name))
            people.push({ name, role: 'editor', method: 'roleWord', page: source?.page });
    for (const name of (responsibility.translators || []) as string[])
        if (personByRoleWord(name))
            people.push({ name, role: 'translator', method: 'roleWord', page: source?.page });
    const kept = responsibility.authors.length || people.length;
    return { people, affiliations: kept ? (byline.affiliations || []) : [], emails: kept ? (byline.emails || []) : [], confirmedByHead };
}
function namesOfByline(row: ReturnType<typeof readBylineRow>, script: 'hangul' | 'latin'): string[] | null {
    if (!PERSON_ROW_KINDS.has(row.kind) || row.organisations?.length || row.items.length < 2)
        return null;
    const inScript = (text: string) => script === 'hangul' ? /^[가-힣]+$/.test(text) : /^[\p{Script=Latin}\s.'’\-‐]+$/u.test(text) && /\p{Script=Latin}/u.test(text);
    if (!row.items.every(item => item.shape.person !== 'no' && inScript(nameOfItem(item))))
        return null;
    return row.items.map(item => script === 'hangul' ? nameOfItem(item) : item.text.replace(/\s+/g, ' '));
}
function bylineBlocks(lines: string[], script: 'hangul' | 'latin'): string[][] {
    const out: string[][] = [];
    const rows = lines.map(line => String(line || '').normalize('NFKC').trim());
    for (let at = 0; at < rows.length; at++) {
        if (!rows[at] || rows[at].length > 400)
            continue;
        const joined = joinWrappedRows(rows, at);
        const names = namesOfByline(joined.row, script);
        if (!names)
            continue;
        out.push(names);
        at = joined.end;
    }
    return out;
}
export function bylinesPrintedTwice(pages: Array<{
    text?: string;
}>): Array<{
    hangul: string[];
    latin: string[];
}> {
    const pairs: Array<{
        hangul: string[];
        latin: string[];
    }> = [];
    for (const page of pages) {
        const lines = String(page.text || '').split(/\r?\n/);
        const hangulLines = bylineBlocks(lines, 'hangul');
        if (!hangulLines.length)
            continue;
        const latinLines = bylineBlocks(lines, 'latin');
        for (const hangul of hangulLines) {
            for (const latin of latinLines) {
                if (hangul.length !== latin.length)
                    continue;
                const crossed = hangul.some((name, i) => latin.some((roman, j) => i !== j && nameRelation(name, roman).relation === 'romanised'));
                if (!crossed)
                    pairs.push({ hangul, latin });
            }
        }
    }
    return pairs;
}

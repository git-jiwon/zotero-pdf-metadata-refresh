import { STRUCTURE, bodyPages, footerIssuerOf, readPageStructure, readingsOf, rowsOf, structureFromPageObservations, titleOrder, type PageRole, type PageStructure, type RegionKind, type StructureRow } from './page-structure';
import { DATE_ROLE_MEANING, type PageObservation } from './candidate';
import { compact, readDates, responsibilityOfLine, tidyOrganisation, volumeDesignator } from './roles';
import { isDateOnly, isInstitutionName, isOrganisationName, isOrganisationOnly, isPublishingHouse } from './title-guards';
import { ARRANGEMENT, EDITION_LEADS, EDITION_ORDINAL, IMPRINT_MARKS, STATEMENT_LABELS, TRANSLATION_RIGHTS, firstPrintingIn, imprintMark, nameInImprint, printedDateIn, type PrintingStatement } from './imprint-marks';
import { fold, hangulRespelledByRomanisation, romanise } from '../metadata/korean-names';
import { sameName as samePersonByName } from '../metadata/name-equivalence';
import { NAME_JOINERS, scriptOfName } from '../metadata/person-name';
import { isDegreeStatement } from './degree';
import { NAME_AFTER_SCHOOL_WORD } from './agents';
import { misreadRoleWordLine, personShape, publicationStatementOf, publisherStatementsIn } from './byline-row';
const latinPerson = (value: string) => scriptOfName(value) === 'latin' && personShape(value).person !== 'no';
import { FUNDER_LABEL_KO_SOURCE, LEADING_ROLE_SOURCE, LEAD_BODY_LABEL_SOURCE, SPONSOR_LABEL_SOURCE, SPONSOR_LEAD_SOURCE, bylineRoleOf } from './label-words';
export type StatementKind = 'publication' | 'rights' | 'edition' | 'originalEdition' | 'arrangement' | 'translation' | 'volume' | 'series' | 'containment' | 'responsibility' | 'address' | 'date' | 'commissioning';
export type Scope = 'thisEdition' | 'thisWork' | 'originalEdition' | 'series' | 'container' | 'otherWork' | 'undetermined';
export type Seat = 'titleBlock' | 'nearTitle' | 'byline' | 'coverHead' | 'coverImprint' | 'colophon' | 'colophonPage' | 'formLabel' | 'running' | 'addressBlock' | 'selfCitation' | 'openingFoot' | 'fundingNote';
export type NameShape = 'person' | 'organisation' | 'unknown';
export type StatedRole = 'author' | 'editor' | 'translator' | 'contributor' | 'publisherHouse' | 'publisherPerson' | 'issuer' | 'commissioning' | 'contractor' | 'leadBody' | 'sponsor' | 'printer' | 'rightsHolder' | 'licensor' | 'agency' | 'degreeGranting';
export interface StatedName {
    text: string;
    printed?: string;
    shape: NameShape;
    script: 'hangul' | 'han' | 'kana' | 'latin' | 'mixed';
    role?: StatedRole;
}
export type StatementSignal = 'label' | 'grammar' | 'seat' | 'editionSequence' | 'translationStated' | 'parallelTitle' | 'otherPersons' | 'otherPublisher' | 'scriptDiffers' | 'sameAsThisEdition' | 'besideTitle' | 'afterName' | 'withIssue' | 'namedContainer' | 'ownFolioRun' | 'corroborated' | 'translationRights' | 'editionRights' | 'firstPublished' | 'reprint';
export interface Statement {
    kind: StatementKind;
    scope: Scope;
    page: number;
    role: PageRole | '';
    seat: Seat;
    reading: 'layer' | 'ocr';
    rows: [
        number,
        number
    ];
    raw: string;
    label?: string;
    names?: StatedName[];
    place?: string;
    years?: string[];
    date?: {
        value: string;
        precision: 'year' | 'month' | 'day';
    };
    edition?: string;
    number?: string;
    of?: string;
    range?: [
        number,
        number
    ];
    parent?: string;
    because: Array<{
        signal: StatementSignal;
        detail?: string;
    }>;
}
export interface Refusal {
    page: number;
    where: Seat | RegionKind | PageRole | 'body' | 'affiliation';
    kind: StatementKind;
    raw: string;
    why: string;
}
export interface FrontStatements {
    statements: Statement[];
    thisEdition: {
        publisher?: Statement;
        issuer?: Statement;
        date?: Statement;
        place?: Statement;
        edition?: Statement;
        persons: StatedName[];
        rights: Statement[];
        printing?: {
            chosen: PrintingStatement;
            others: PrintingStatement[];
        };
    };
    translation: Statement | null;
    original: {
        author?: StatedName;
        publisher?: string;
        place?: string;
        years: string[];
        statements: Statement[];
    } | null;
    volume: Statement | null;
    series: Statement[];
    containment: {
        title?: string;
        editors: string[];
        range?: [
            number,
            number
        ];
        statements: Statement[];
    } | null;
    ownRange: {
        first: number;
        last: number;
        unfoliated: number;
    } | null;
    partHeading: {
        page: number;
        raw: string;
    } | null;
    refused: Refusal[];
}
const NFKC = (value: unknown) => String(value ?? '').replace(/ㆍ/g, '·').normalize('NFKC');
const oneLine = (value: unknown) => NFKC(value).replace(/\s+/g, ' ').trim();
const YEAR = String.raw `(?:1[4-9]|20)\d{2}`;
const YEAR_ALONE = /(?<!\d)(?:1[4-9]|20)\d{2}(?!\d)/g;
const yearsIn = (value: string) => [...new Set(value.match(YEAR_ALONE) || [])];
const RUNS_ON = /(?:[,，&]|\b(?:in|by|with|of|and|through|from|for|to|under|at|the|an|a))[^\S\n]*$/i;
const LEGAL_FORM = /(?<![\p{L}'’-])(?:Inc|Ltd|LLC|GmbH|Corp|PLC|S\.A|B\.V|K\.K|AG|Co)\.?(?![\p{L}])|\(주\)|㈜|주식회사|株式会社|有限公司/u;
const HOST_IN = /(?:https?:\/\/|\bwww\.)[\w.-]+|(?<![@\w.-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|edu|gov|int|co|kr|jp|de|uk|eu|us)\b/i;
function scriptOf(value: string): StatedName['script'] {
    const hangul = (value.match(/[가-힣]/g) || []).length, han = (value.match(/\p{Script=Han}/gu) || []).length;
    const kana = (value.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length, latin = (value.match(/\p{Script=Latin}/gu) || []).length;
    const scripts = [hangul, han, kana, latin].filter(count => count > 0).length;
    if (scripts > 1)
        return hangul && !kana && !latin ? 'hangul' : 'mixed';
    return hangul ? 'hangul' : han ? 'han' : kana ? 'kana' : 'latin';
}
function organisationShaped(value: string): boolean {
    const name = oneLine(value).replace(/\s+(?=[.,])/g, '');
    if (!name || name.length > 90)
        return false;
    return isOrganisationName(name.replace(/\s+/g, '')) || isOrganisationOnly(name) || isPublishingHouse(name) || isInstitutionName(name) || LEGAL_FORM.test(name);
}
const THE_AUTHORS = /^the\s+authors?\s*(?:\(s\))?\.?$/i;
const INITIALLED = /^(?:\p{Lu}\.[\s-]?){1,3}\p{Lu}[\p{Ll}'’-]+$/u;
function personShaped(value: string): boolean {
    const line = oneLine(value);
    if (line.length > 80)
        return false;
    const name = line.replace(/[*†‡§¶]+$/, '').trim();
    if (THE_AUTHORS.test(name))
        return true;
    if (!name || name.length > 40 || organisationShaped(name))
        return false;
    return personShape(name).person !== 'no' || INITIALLED.test(name);
}
function statedName(text: string, role?: StatedRole, asPrinted?: string): StatedName {
    const value = oneLine(text), printed = oneLine(asPrinted || text);
    const shape: NameShape = organisationShaped(printed) || organisationShaped(value) ? 'organisation' : personShaped(value) ? 'person' : 'unknown';
    return { text: value, ...(printed !== value && printed.startsWith(value) ? { printed } : {}), shape, script: scriptOf(value), ...(role ? { role } : {}) };
}
function nameLike(value: string): boolean {
    const name = oneLine(value);
    if (name.length < 2 || name.length > 90)
        return false;
    if (/^(?:by|of|and|the|with|from|in|at)$/i.test(name))
        return false;
    return /\p{L}{2}/u.test(name) && !isDateOnly(name);
}
interface Fragment {
    kind: StatementKind;
    raw: string;
    index: number;
    label?: string;
    names?: StatedName[];
    place?: string;
    years?: string[];
    date?: Statement['date'];
    edition?: string;
    number?: string;
    of?: string;
    range?: [
        number,
        number
    ];
    hint?: 'original' | 'thisEdition' | 'editionRights' | 'firstPublished' | 'reprint' | 'copyrightYear';
    parent?: string;
    method?: 'copyright' | 'publishedBy' | 'imprintStatement' | 'recipient' | 'contractorLabel' | 'leadBodyLabel' | 'sponsorLabel' | 'addressBlock' | 'houseLabel' | 'personLabel' | 'houseTail';
    signal: 'label' | 'grammar';
}
const RIGHTS_MARK_AT = /(?<![\p{L}])copyright(?![\p{L}])|©|ⓒ|\(c\)/giu;
const TRANSLATION_HEAD = /(?:(?<![\p{L}])(?:\p{Lu}\p{Ll}+(?:[- ]language)?\s+)?(?:translation|edition)\s+(?:copyright\s*)?|(?:한국어|번역)\s?판\s*(?:저작권\s*)?)$/iu;
const RIGHTS_DATED = new RegExp(String.raw `^[^\n]{0,4}?(${YEAR}(?:\s*[–—-]\s*${YEAR})?(?:\s*,\s*${YEAR}(?:\s*[–—-]\s*${YEAR})?)*)[^\p{L}\n]{0,3}([^\n]{2,80})?`, 'u');
const RIGHTS_NAMED = new RegExp(String.raw `^[^\p{L}\n]{0,4}(\p{L}[^\n\d]{1,60}?)\s*(${YEAR}(?:\s*[,–—-]\s*${YEAR})*)`, 'u');
const RIGHTS_LOST_GLYPH = new RegExp(String.raw `(${YEAR})[^\S\n]+([^\n]{2,60}?)[.,]?[^\S\n]+All\s+rights\s+reserved`, 'giu');
function holderOf(raw: string | undefined): string {
    if (!raw)
        return '';
    const name = tidyOrganisation(raw.split(/\s+(?:doi\s*:|https?:|www\.)/i)[0]);
    return nameLike(name) && name.length <= 70 ? name : '';
}
const printedHolderOf = (raw: string | undefined) => oneLine(String(raw ?? '').replace(/^[\s,:]*by\s+(?=\p{L})/iu, '').split(/[.,;]?\s*(?:all\s+rights\s+reserved|this\s+(?:work|publication|document|manual|book))/i)[0]);
function rightsIn(row: string): Fragment[] {
    const out: Fragment[] = [];
    let consumed = -1;
    for (const mark of row.matchAll(RIGHTS_MARK_AT)) {
        const at = mark.index ?? 0;
        if (at < consumed)
            continue;
        let end = at + mark[0].length;
        const second = /^\s*(?:©|ⓒ|\(c\))/iu.exec(row.slice(end));
        if (second)
            end += second[0].length;
        const rest = row.slice(end);
        const head = TRANSLATION_HEAD.exec(row.slice(0, at));
        const start = head ? head.index : at;
        const hint = !head ? undefined : /translation|한국어|번역/iu.test(head[0]) ? 'thisEdition' as const : 'editionRights' as const;
        const dated = RIGHTS_DATED.exec(rest);
        if (dated) {
            const years = yearsIn(dated[1]);
            const holder = holderOf(dated[2]);
            const raw = row.slice(start, end + dated[0].length);
            out.push({ kind: 'rights', raw, index: start, label: mark[0], years, ...(holder ? { names: [statedName(holder, 'rightsHolder', printedHolderOf(dated[2]))] } : {}),
                ...(hint ? { hint } : {}), method: 'copyright', signal: 'grammar' });
            consumed = end + dated[0].length;
            continue;
        }
        const named = RIGHTS_NAMED.exec(rest);
        if (named) {
            const holder = holderOf(named[1]);
            const raw = row.slice(start, end + named[0].length);
            if (holder) {
                out.push({ kind: 'rights', raw, index: start, label: mark[0], years: yearsIn(named[2]), names: [statedName(holder, 'rightsHolder', printedHolderOf(named[1]))],
                    ...(hint ? { hint } : {}), method: 'copyright', signal: 'grammar' });
                consumed = end + named[0].length;
            }
        }
    }
    if (!out.length) {
        for (const match of row.matchAll(RIGHTS_LOST_GLYPH)) {
            const holder = holderOf(match[2]);
            if (holder)
                out.push({ kind: 'rights', raw: match[0], index: match.index ?? 0, label: 'All rights reserved', years: [match[1]], names: [statedName(holder, 'rightsHolder', match[2])], method: 'copyright', signal: 'grammar' });
        }
    }
    return out;
}
function publishedValue(value: string): string {
    return value.split(/\s+(?:copyright|©|ⓒ|\(c\)|all\s+rights)\b/i)[0]
        .split(/\s+(?:doi\s*:|https?:|www\.)/i)[0]
        .replace(/(?:\.\s+\p{Lu}\p{Ll}*)?\s+(?:are|is|was|were|has|have|had|will|may|can|shall|must)\s.*$/u, '')
        .replace(/\s*(?:1[4-9]|20)\d{2}\b.*$/, '')
        .replace(/\s+\d{1,3}\s*$/, '')
        .replace(/\s+(?:\p{Lu}{2,}[^\S\n]+)?\S*\p{L}\.[^\S\n]*,.*$/u, '')
        .replace(/^the\s+(?=\p{L})/u, '');
}
const PUBLISHED_BY = /(?:published\s+by|발행\s*처|펴낸\s*곳|발간\s*처)\s*[:：]?\s*([^\n]{2,90})/giu;
const IMPRINT_OF = /(?:^|[.;])[^\S\n]*([\p{L}][\p{L}.&'’ -]{1,40}?)[^\S\n]+is[^\S\n]+an[^\S\n]+imprint[^\S\n]+of[^\S\n]+(?:the[^\S\n]+)?([\p{L}][\p{L}.&'’-]*(?:[^\S\n]+(?:&|[\p{L}][\p{L}.&'’-]*)){0,4})/giu;
const RECIPIENT = /([가-힣A-Za-z][^\n]{1,29}?)\s*(?:귀하|귀중)/g;
const COMMISSIONING_LABEL = new RegExp(String.raw `(?:${FUNDER_LABEL_KO_SOURCE})\s*(?:명)?\s*[:：]?\s*([^\n]{2,40}?)(?:\s{2,}|$)`, 'g');
const LEAD_BODY_LABEL = new RegExp(String.raw `(?:${LEAD_BODY_LABEL_SOURCE})\s*(?:명)?\s*[:：]?\s*([^\n]{2,40}?)(?:\s{2,}|$)`, 'g');
const SPONSOR_LABEL = new RegExp(String.raw `(?:${SPONSOR_LABEL_SOURCE})(?:\s*명)?(?![가-힣])\s*[:：]?\s*([^\n]{2,40}?)(?:\s{2,}|$)`, 'g');
const SPONSOR_LEAD = new RegExp(String.raw `(?<![\p{L}])(?:${SPONSOR_LEAD_SOURCE})[^\S\n]+(?:the[^\S\n]+)?`, 'giu');
function sponsorNameOf(value: string): {
    name: string;
    ends: boolean;
} {
    const cut = /[,;()[\]]/.exec(value);
    const words = (cut ? value.slice(0, cut.index) : value).trim().split(/\s+/).filter(Boolean);
    const name: string[] = [];
    let ends = !!cut;
    for (const word of words) {
        if (/^\p{Lu}/u.test(word)) {
            const sentenceEnd = /(?<=\p{L}{2})\.$/u.test(word);
            name.push(sentenceEnd ? word.slice(0, -1) : word);
            if (sentenceEnd) {
                ends = true;
                break;
            }
            continue;
        }
        if (name.length && NAME_JOINERS.connective.test(word)) {
            name.push(word);
            continue;
        }
        ends = true;
        break;
    }
    while (name.length && NAME_JOINERS.connective.test(name[name.length - 1]))
        name.pop();
    const text = name.join(' ').replace(/[:：·]+$/, '');
    const accepted = name.length >= 2 || /^\p{Lu}{2,}$/u.test(text);
    return { name: accepted && text.length <= 70 ? text : '', ends };
}
const CONTRACTOR_LABEL = /(?<!주[^\S\n]{0,2}관[^\S\n]{0,3})(?:연구\s*기관|수행\s*기관)\s*(?:명)?\s*[:：]?\s*([^\n]{2,40}?)(?:\s{2,}|$)/g;
const OFFICE_TITLE = /(?:장관|총장|이사장|위원장)\s*$/;
const OFFICE_SUFFIX = /(?<=[원청처실소부과])장\s*$/;
function publicationIn(row: string, imprint = false): Fragment[] {
    const out: Fragment[] = [];
    for (const match of row.matchAll(PUBLISHED_BY)) {
        const at = match.index ?? 0;
        const lead = row.slice(Math.max(0, at - 28), at);
        if (/^published/i.test(match[0]) && clauseOfSentence(row, at))
            continue;
        const statement = beforeAddress(publishedValue(match[1]));
        const name = tidyOrganisation(statement || match[1]);
        const label = /^published/i.test(match[0]) ? 'published by' : match[0].replace(/[\s:：]+$/, '').replace(/\s+/g, '');
        if (EDITION_LEADS.earlier.test(lead)) {
            out.push({ kind: 'originalEdition', raw: row.slice(Math.max(0, at - 28)).trim(), index: at, label: `${lead.trim()} ${label}`.trim(),
                names: nameLike(name) ? [statedName(name, 'publisherHouse')] : [], years: yearsIn(row.slice(at)), hint: 'original', signal: 'grammar' });
            continue;
        }
        if (ARRANGEMENT.opens.test(match[1])) {
            out.push(arrangementOf(row.slice(at), at));
            continue;
        }
        if (name.length < 2 || name.length > 70)
            continue;
        out.push({ kind: 'publication', raw: match[0], index: at, label, names: [statedName(name, 'publisherHouse')], method: 'publishedBy', signal: /^published/i.test(match[0]) ? 'grammar' : 'label' });
    }
    for (const match of row.matchAll(IMPRINT_OF)) {
        const imprint = tidyOrganisation(match[1]), parent = /^(?:the|an?)$/i.test(match[2].trim()) ? '' : tidyOrganisation(match[2]);
        if (imprint.length < 2 || imprint.length > 60)
            continue;
        out.push({ kind: 'publication', raw: match[0], index: match.index ?? 0, label: 'is an imprint of', names: [statedName(imprint, 'publisherHouse')], parent,
            method: 'imprintStatement', signal: 'grammar' });
    }
    for (const match of row.matchAll(STATEMENT_LABELS.house)) {
        if (/^(?:발\s*행\s*처|펴\s*낸\s*곳|발\s*간\s*처)/u.test(match[0]))
            continue;
        if (/^[a-z]/i.test(match[0]) && clauseOfSentence(row, match.index ?? 0))
            continue;
        const value = labelValue(row, (match.index ?? 0) + match[0].length);
        const name = tidyOrganisation(value);
        if (!nameLike(name) || name.length > 70)
            continue;
        out.push({ kind: 'publication', raw: match[0] + value, index: match.index ?? 0, label: match[0].replace(/[\s:：]+$/, '').replace(/\s+/g, ' '),
            names: [statedName(name, /issued/i.test(match[0]) || /기\s*관/.test(match[0]) ? 'issuer' : 'publisherHouse')], method: 'houseLabel', signal: 'label' });
    }
    if (row.length <= STRUCTURE.lineChars && !out.some(fragment => fragment.method === 'houseLabel' || fragment.method === 'publishedBy')) {
        const stated = publisherStatementsIn(row, { imprint });
        for (const name of stated?.publishers || []) {
            if (!nameLike(name) || name.length > 70 || out.some(fragment => (fragment.names || []).some(held => sameName(held.text, name))))
                continue;
            out.push({ kind: 'publication', raw: row, index: Math.max(0, row.indexOf(name)), label: '펴냄', names: [statedName(name, 'publisherHouse')], method: 'houseTail', signal: 'label' });
        }
    }
    return out;
}
function clauseOfSentence(row: string, at: number): boolean {
    const sentence = row.slice(Math.max(0, at - 240), at).split(/[.!?;:](?:\s|$)/).pop() || '';
    return (sentence.match(/\p{L}+/gu) || []).length > 6;
}
function beforeAddress(value: string): string {
    const address = ADDRESS_TOKEN.exec(value);
    if (!address || address.index === 0)
        return value;
    const head = value.slice(0, address.index);
    return /,\s*$/.test(head) ? head.replace(/[,\s]+$/, '') : value;
}
function labelValue(row: string, from: number): string {
    const rest = row.slice(from);
    let end = rest.length;
    for (const pattern of [STATEMENT_LABELS.house, STATEMENT_LABELS.person, STATEMENT_LABELS.printer, STATEMENT_LABELS.date]) {
        for (const match of rest.matchAll(pattern)) {
            if ((match.index ?? 0) > 0) {
                end = Math.min(end, match.index ?? 0);
                break;
            }
        }
    }
    return rest.slice(0, end).replace(/\s*(?:[|｜❙│┃]|\s[Iㅣl]\s|(?<![\p{L}])(?:ISSN|ISBN|e-?ISSN|주\s*소|전\s*화|TEL|FAX|팩\s*스|홈\s*페\s*이\s*지|E-?mail|등록\s*번호)(?![\p{L}])|https?:|www\.).*$/iu, '').trim();
}
function arrangementOf(text: string, index: number): Fragment {
    const statement = ARRANGEMENT.statement.exec(text) || ARRANGEMENT.opens.exec(text);
    const rest = statement ? text.slice((statement.index ?? 0) + statement[0].length).replace(/^\s*(?:with|of|from)\s+/i, '') : text;
    const [licensor, agency] = rest.split(ARRANGEMENT.through);
    const names: StatedName[] = [];
    const clean = (value: string | undefined) => tidyOrganisation(String(value ?? '').replace(/[.。]\s*$/, ''));
    if (nameLike(clean(licensor)))
        names.push(statedName(clean(licensor), 'licensor'));
    if (nameLike(clean(agency)))
        names.push(statedName(clean(agency), 'agency'));
    return { kind: 'arrangement', raw: text.trim(), index, label: 'arrangement with', names, signal: 'grammar' };
}
function commissioningIn(row: string): Fragment[] {
    const out: Fragment[] = [];
    const add = (method: 'recipient' | 'contractorLabel' | 'leadBodyLabel' | 'sponsorLabel', role: StatedRole, value: string, raw: string, index: number) => {
        const name = tidyOrganisation(value);
        if (name.length < 2 || name.length > 70)
            return;
        out.push({ kind: 'commissioning', raw, index, label: method === 'recipient' ? '귀하' : raw.slice(0, 6), names: [statedName(name, role)], method, signal: 'label' });
    };
    for (const match of row.matchAll(RECIPIENT))
        add('recipient', 'commissioning', match[1].replace(OFFICE_TITLE, '').replace(OFFICE_SUFFIX, ''), match[0], match.index ?? 0);
    for (const match of row.matchAll(COMMISSIONING_LABEL))
        add('recipient', 'commissioning', match[1], match[0], match.index ?? 0);
    for (const match of row.matchAll(LEAD_BODY_LABEL))
        add('leadBodyLabel', 'leadBody', match[1], match[0], match.index ?? 0);
    for (const match of row.matchAll(SPONSOR_LABEL))
        add('sponsorLabel', 'sponsor', match[1], match[0], match.index ?? 0);
    out.push(...englishSponsorsIn(row, true));
    for (const match of row.matchAll(CONTRACTOR_LABEL))
        add('contractorLabel', 'contractor', match[1], match[0], match.index ?? 0);
    return out;
}
function englishSponsorsIn(row: string, open: boolean): Fragment[] {
    const out: Fragment[] = [];
    for (const match of row.matchAll(SPONSOR_LEAD)) {
        const at = (match.index ?? 0) + match[0].length;
        const value = row.slice(at, at + 90).split('\n')[0];
        const { name, ends } = sponsorNameOf(value);
        if (!name || (!ends && !open))
            continue;
        out.push({ kind: 'commissioning', raw: row.slice(match.index ?? 0, at + value.indexOf(name) + name.length), index: match.index ?? 0, label: match[0].trim(),
            names: [statedName(name, 'sponsor')], method: 'sponsorLabel', signal: 'label' });
    }
    return out;
}
function personLabelsIn(row: string): Fragment[] {
    const out: Fragment[] = [];
    for (const [pattern, role] of [[STATEMENT_LABELS.person, 'publisherPerson'], [STATEMENT_LABELS.printer, 'printer']] as const) {
        for (const match of row.matchAll(pattern)) {
            const value = labelValue(row, (match.index ?? 0) + match[0].length);
            const name = nameInImprint(tidyOrganisation(value));
            if (!nameLike(name) || name.length > 70)
                continue;
            out.push({ kind: 'responsibility', raw: match[0] + value, index: match.index ?? 0, label: match[0].replace(/[\s:：]+$/, '').replace(/\s+/g, ''),
                names: [statedName(name, role)], method: 'personLabel', signal: 'label' });
        }
    }
    return out;
}
const FIRST_PUBLISHED = new RegExp(String.raw `first\s+published[^\n]{0,70}?(${YEAR})`, 'giu');
const THIS_EDITION = new RegExp(String.raw `\b(e[-\s]?edition|(?:${EDITION_ORDINAL}|revised)\s+edition)[^\n]{0,70}?(${YEAR})`, 'giu');
const REPRINTED = new RegExp(String.raw `\breprinted[^\n]{0,70}?(${YEAR})`, 'giu');
const COPYRIGHT_YEAR = new RegExp(String.raw `copyright\s*\S{0,3}\s*(${YEAR})`, 'giu');
const KOREAN_ISSUE_DATE = new RegExp(String.raw `(${YEAR})\s*년[^\n]{0,30}?(?:발행|펴냄|펴낸\s?날)|(?:발행|펴냄|펴낸\s?날)[^\d\n]{0,12}(${YEAR})`, 'u');
const EDITION_LABEL = new RegExp(String.raw `(?<![\p{L}])(${EDITION_ORDINAL}(?:[^\S\n]+(?!(?:of|the|this|that|in|on|for|to|a|an|is|was|from|by|with|at|century|anniversary)\b)[A-Za-z-]{2,}){0,3}?[^\S\n]+edition|e-edition|revised[^\S\n]+edition|개정판|초판|제[^\S\n]*\d+[^\S\n]*판)(?![\p{L}])`, 'iu');
function editionsIn(row: string): Fragment[] {
    const out: Fragment[] = [];
    const label = EDITION_LABEL.exec(row);
    if (label)
        out.push({ kind: 'edition', raw: label[0], index: label.index, label: label[1], edition: label[1].trim(), hint: 'thisEdition', signal: 'grammar' });
    for (const match of row.matchAll(FIRST_PUBLISHED))
        out.push({ kind: 'edition', raw: match[0], index: match.index ?? 0, label: 'first published', years: [match[1]], hint: 'firstPublished', signal: 'grammar' });
    for (const match of row.matchAll(THIS_EDITION))
        out.push({ kind: 'edition', raw: match[0], index: match.index ?? 0, label: match[1].trim(), edition: match[1].trim(), years: [match[2]], hint: 'thisEdition', signal: 'grammar' });
    for (const match of row.matchAll(REPRINTED))
        out.push({ kind: 'edition', raw: match[0], index: match.index ?? 0, label: 'reprinted', years: [match[1]], hint: 'reprint', signal: 'grammar' });
    for (const match of row.matchAll(COPYRIGHT_YEAR))
        out.push({ kind: 'edition', raw: match[0], index: match.index ?? 0, label: 'copyright', years: [match[1]], hint: 'copyrightYear', signal: 'grammar' });
    if (row.length <= 60 && !EDITION_LEADS.original.test(row) && !/original/i.test(row)) {
        const issued = KOREAN_ISSUE_DATE.exec(row);
        const labelled = [...row.matchAll(STATEMENT_LABELS.date)][0];
        const year = issued?.[1] || issued?.[2] || (labelled ? yearsIn(row.slice((labelled.index ?? 0) + labelled[0].length))[0] : '');
        if (year) {
            const read = readDates(row).find(entry => entry.value.startsWith(year));
            const printed = printedDateIn(row);
            const rank = { year: 1, month: 2, day: 3 } as const;
            const reading = printed && printed.value.startsWith(year) && (!read || rank[printed.precision] > rank[read.precision]) ? printed : read;
            out.push({ kind: 'date', raw: row, index: issued?.index ?? labelled?.index ?? 0, label: labelled ? labelled[0].replace(/[\s:：]+$/, '') : '발행', years: [year],
                date: reading ? { value: reading.value, precision: reading.precision } : { value: year, precision: 'year' }, signal: 'label' });
        }
    }
    return out;
}
function originalHeadsIn(row: string): Fragment[] {
    const out: Fragment[] = [];
    const head = EDITION_LEADS.published.exec(row);
    if (head && !/^first$/i.test(head[1])) {
        const rest = row.slice(head.index + head[0].length);
        const by = /\bby\s+([^\n]{2,90}?)(?=\s+in\s+(?:1[4-9]|20)\d{2}|\s*(?:1[4-9]|20)\d{2}|$)/i.exec(rest);
        const name = by ? tidyOrganisation(by[1]) : '';
        out.push({ kind: 'originalEdition', raw: row.slice(head.index), index: head.index, label: head[0], hint: 'original',
            names: nameLike(name) ? [statedName(name, 'publisherHouse')] : [], years: yearsIn(rest), signal: 'grammar' });
    }
    if (head && /^first$/i.test(head[1]) && /^\s+in\s+\p{L}/iu.test(row.slice(head.index + head[0].length))) {
        const rest = row.slice(head.index + head[0].length);
        const by = /\bby\s+([^\n]{2,90}?)(?=,?\s*(?:1[4-9]|20)\d{2}|$)/i.exec(rest);
        const name = by ? tidyOrganisation(by[1]) : '';
        out.push({ kind: 'originalEdition', raw: row.slice(head.index), index: head.index, label: head[0], hint: 'firstPublished',
            names: nameLike(name) ? [statedName(name, 'publisherHouse')] : [], years: yearsIn(rest), signal: 'grammar' });
    }
    const labelled = EDITION_LEADS.original.exec(row);
    if (labelled) {
        const rest = row.slice(labelled.index + labelled[0].length);
        out.push({ kind: 'originalEdition', raw: row.slice(labelled.index), index: labelled.index, label: labelled[0], hint: 'original', names: [], years: yearsIn(rest), signal: 'label' });
    }
    return out;
}
const TRANSLATED = /(?<![\p{L}])translated\s+(from|by)\s+([^\n]{2,120})/iu;
function translationIn(row: string): Fragment[] {
    const out: Fragment[] = [];
    const translated = TRANSLATED.exec(row);
    if (translated) {
        const by = /(?:^|\s)by\s+([^\n,;]{2,60})/i.exec(translated[1].toLowerCase() === 'by' ? `by ${translated[2]}` : translated[2]);
        const name = by ? oneLine(by[1]).replace(/[.。]$/, '') : '';
        out.push({ kind: 'translation', raw: translated[0], index: translated.index, label: `translated ${translated[1].toLowerCase()}`,
            names: name && personShaped(name) ? [statedName(name, 'translator')] : [], ...(translated[1].toLowerCase() === 'from' ? { of: oneLine(translated[2]).slice(0, 60) } : {}), signal: 'grammar' });
    }
    return out;
}
const EDITED_INLINE = /(?:^|\/\s*|,\s*)edited\s+by\s+([^;.\n]{3,60})/i;
function responsibilityIn(line: string): Fragment[] {
    const cut = line.length <= STRUCTURE.lineChars ? publisherStatementsIn(line) : null;
    const row = cut ? cut.rest : line;
    if (!row)
        return [];
    const stated = responsibilityOfLine(row);
    if (!stated) {
        const inline = EDITED_INLINE.exec(row);
        if (!inline || /^\s*\(?\d{1,3}\s*[.)]\s/.test(row))
            return [];
        const editors = inline[1].split(/\s*(?:,|;|&|\band\b)\s*/).map(part => part.trim()).filter(part => part.length >= 3 && personShaped(part));
        return editors.length ? [{ kind: 'responsibility', raw: row, index: inline.index, label: 'edited by', names: editors.map(name => statedName(name, 'editor')), signal: 'grammar' }] : [];
    }
    const who = stated.who.replace(/\s*(?:[;,]\s*)?with\s+.*$/i, '');
    const parts = who.split(/\s*(?:,|;|·|•|&|\band\b|、)\s*/u).map(part => part.replace(/\s*[(（][^()（）\n]{0,40}[)）]\s*$/u, '').trim()).filter(Boolean);
    const names = parts.filter(part => personShaped(part) || (/^[가-힣]{2,8}$/.test(part.replace(/\s+/g, '')) && !organisationShaped(part)))
        .map(part => statedName(part, stated.role === 'contributor' ? 'contributor' : stated.role));
    if (!names.length)
        return [];
    const kind: StatementKind = stated.role === 'translator' ? 'translation' : 'responsibility';
    return [{ kind, raw: row, index: 0, label: stated.word, names, signal: 'label' }];
}
const TRAILING_BY_NAME = /\bby\s+([A-Z][a-z]+(?:[-\s][A-Z][a-z]+){1,2})\s*$/;
function authorByLineIn(row: string): Fragment[] {
    if (/\b(?:published|printed|distributed|arrangement|edition|copyright)\b/i.test(row) || /[©ⓒ]/.test(row))
        return [];
    const found = TRAILING_BY_NAME.exec(row);
    if (!found || isOrganisationOnly(found[1]) || isOrganisationName(found[1].replace(/\s+/g, '')))
        return [];
    return [{ kind: 'responsibility', raw: row, index: found.index, label: 'by', names: [statedName(found[1], 'author')], signal: 'grammar' }];
}
const CONTAINER_LABEL = /^\s*(?:in|published\s+in|appears?\s+in|part\s+of|수록|게재)\s*[:：]\s*(\S[^\n]{1,200})$/iu;
const CONTAINER_EDITED = /^\s*In\s+([^\n]{3,160}?),\s*(?:[Ee]d(?:s|ited)?\.?(?:\s+by)?|[Ee]ditors?)(?![\p{L}])\s*([^\n]*)$/u;
const EDITOR_LABEL = /^\s*(?:editors?|eds?\.|edited\s+by)\s*[:：]?\s*([^\n]{2,120})$/iu;
const CONTAINER_EDITED_FOOT = /^\s*(\S[^\n]{2,160}?),\s*edited\s+by\s+(\S[^\n]{1,120}?),\s*(?:pp?\.\s*)?(\d{1,5})(?:\s*[-–—]\s*(\d{1,5}))?\s*\.?\s*$/iu;
const LABELLED_RANGE = /(?:\bpp?\.?|\bpages?\b|\bS\.)[^\S\n]*(\d{1,6})[^\S\n]*[-–—~][^\S\n]*(\d{1,6})\b|(\d{1,6})[^\S\n]*[-–—~][^\S\n]*(\d{1,6})[^\S\n]*(?:쪽|면)/iu;
function containmentIn(row: string): Fragment[] {
    const out: Fragment[] = [];
    const range = LABELLED_RANGE.exec(row);
    const pages = range ? [Number(range[1] ?? range[3]), Number(range[2] ?? range[4])] as [
        number,
        number
    ] : undefined;
    const labelled = CONTAINER_LABEL.exec(row);
    if (labelled) {
        out.push({ kind: 'containment', raw: row, index: 0, label: row.split(/[:：]/)[0].trim(), of: oneLine(labelled[1]).replace(/[,;]\s*$/, ''), ...(pages && pages[1] >= pages[0] ? { range: pages } : {}), signal: 'label' });
        return out;
    }
    const foot = /^\s*In\s/.test(row) ? null : CONTAINER_EDITED_FOOT.exec(row);
    if (foot) {
        const editors = foot[2].split(/\s*(?:,|;|&|\band\b)\s*/).map(part => part.trim()).filter(part => personShaped(part));
        const first = Number(foot[3]), last = foot[4] ? Number(foot[4]) : undefined;
        out.push({ kind: 'containment', raw: row, index: 0, label: '…, edited by …, N', of: oneLine(foot[1]), names: editors.map(name => statedName(name, 'editor')),
            ...(last !== undefined && last >= first ? { range: [first, last] as [
                    number,
                    number
                ] } : {}), signal: 'grammar' });
        return out;
    }
    const edited = CONTAINER_EDITED.exec(row);
    if (edited) {
        const editors = edited[2].split(/\s*(?:,|;|&|\band\b)\s*/).map(part => part.trim()).filter(part => personShaped(part));
        out.push({ kind: 'containment', raw: row, index: 0, label: 'In … ed.', of: oneLine(edited[1]), names: editors.map(name => statedName(name, 'editor')),
            ...(pages && pages[1] >= pages[0] ? { range: pages } : {}), signal: 'grammar' });
        return out;
    }
    const editor = EDITOR_LABEL.exec(row);
    if (editor) {
        const value = editor[1].replace(LABELLED_RANGE, ' ').replace(/[,;]\s*$/, '');
        const editors = value.split(/\s*(?:,|;|&|\band\b)\s*/).map(part => part.trim()).filter(part => personShaped(part));
        if (editors.length || pages)
            out.push({ kind: 'containment', raw: row, index: 0, label: 'editor', names: editors.map(name => statedName(name, 'editor')),
                ...(pages && pages[1] >= pages[0] ? { range: pages } : {}), signal: 'label' });
    }
    return out;
}
const SERIES_STATEMENT = /\(\s*([^();\n]{2,60}?)\s*[;；]\s*(\d{1,4})\s*\)/u;
function volumesIn(row: string): Fragment[] {
    const out: Fragment[] = [];
    const series = SERIES_STATEMENT.exec(row);
    if (series && /\p{L}{2}/u.test(series[1])) {
        out.push({ kind: 'series', raw: series[0], index: series.index, label: '( ; )', number: String(Number(series[2])), of: oneLine(series[1]), signal: 'grammar' });
        return out;
    }
    const volume = volumeDesignator(row);
    if (volume)
        out.push({ kind: 'volume', raw: row, index: volume.at, label: NFKC(row).slice(volume.at, volume.end), number: volume.number, of: volume.before, signal: 'grammar' });
    return out;
}
const IMPRINT_SEATS: ReadonlySet<Seat> = new Set<Seat>(['colophon', 'colophonPage']);
function fragmentsOf(row: string, imprint = false): Fragment[] {
    if (!row.trim())
        return [];
    return [...rightsIn(row), ...publicationIn(row, imprint), ...commissioningIn(row), ...personLabelsIn(row), ...editionsIn(row), ...originalHeadsIn(row),
        ...translationIn(row), ...responsibilityIn(row), ...authorByLineIn(row), ...containmentIn(row), ...volumesIn(row)];
}
const STATEMENT_HEAD = /(?<![\p{L}])(?:(?:\p{L}+\s+)?(?:translation|edition)\s+copyright|copyright|originally\s+published|previously\s+published|first\s+published|published\s+by)(?![\p{L}])|©|ⓒ|\(c\)(?=\s*(?:1[4-9]|20)\d{2})|原著|原書|原作|원서|원저|한국어\s?판|번역\s?판|발행처|펴낸곳/giu;
function piecesOf(row: string): string[] {
    if (row.length <= STRUCTURE.lineChars)
        return [row];
    const starts: number[] = [];
    let previousEnd = -Infinity;
    for (const match of row.matchAll(STATEMENT_HEAD)) {
        const at = match.index ?? 0;
        if (at - previousEnd > 4)
            starts.push(at);
        previousEnd = at + match[0].length;
    }
    if (!starts.length)
        return [];
    return starts.map((start, index) => row.slice(start, Math.min(start + STRUCTURE.lineChars, starts[index + 1] ?? row.length)));
}
export type ImprintRoleOfText = 'publisher' | 'issuingBody' | 'commissioningBody' | 'contractor' | 'copyrightHolder';
export interface ImprintStatementOfText {
    role: ImprintRoleOfText;
    name: string;
    method: 'copyright' | 'publishedBy' | 'imprintStatement' | 'recipient' | 'contractorLabel' | 'leadBodyLabel' | 'footer' | 'addressBlock';
    parent?: string;
    raw: string;
    index: number;
}
export function imprintStatementsOfText(text: unknown): ImprintStatementOfText[] {
    const page = NFKC(text);
    const found: ImprintStatementOfText[] = [];
    const add = (role: ImprintRoleOfText, method: ImprintStatementOfText['method'], name: string, raw: string, index: number, parent?: string) => {
        if (name.length < 2 || name.length > 70)
            return;
        const repeat = found.some(entry => entry.role === role && entry.name === name && index < entry.index + entry.raw.length && entry.index < index + raw.length);
        if (repeat)
            return;
        found.push({ role, name, method, raw, index, ...(parent !== undefined ? { parent } : {}) });
    };
    const rows = page.split('\n');
    let offset = 0;
    const holders: string[] = [];
    const rowStarts: number[] = [];
    for (const row of rows) {
        rowStarts.push(offset);
        offset += row.length + 1;
    }
    rows.forEach((row, at) => {
        for (const piece of piecesOf(row)) {
            const base = rowStarts[at] + Math.max(0, row.indexOf(piece));
            for (const fragment of fragmentsOf(piece)) {
                const name = fragment.names?.[0]?.text || '';
                const index = base + fragment.index;
                if (fragment.kind === 'rights' && name) {
                    add('copyrightHolder', 'copyright', name, fragment.raw, index);
                    holders.push(name);
                }
                else if (fragment.kind === 'publication' && fragment.method === 'imprintStatement')
                    add('publisher', 'imprintStatement', name, fragment.raw, index, fragment.parent);
                else if (fragment.kind === 'publication' && fragment.method === 'publishedBy')
                    add('publisher', 'publishedBy', name, fragment.raw, index);
                else if (fragment.kind === 'commissioning' && fragment.method === 'leadBodyLabel')
                    add('issuingBody', 'leadBodyLabel', name, fragment.raw, index);
                else if (fragment.kind === 'commissioning' && fragment.method === 'sponsorLabel')
                    continue;
                else if (fragment.kind === 'commissioning')
                    add(fragment.method === 'contractorLabel' ? 'contractor' : 'commissioningBody', fragment.method === 'contractorLabel' ? 'contractorLabel' : 'recipient', name, fragment.raw, index);
            }
        }
    });
    for (const block of addressBlocksIn(rows, holders, { corroboratedOnly: true }))
        add('issuingBody', 'addressBlock', block.name, block.raw, rowStarts[block.row] ?? 0);
    return found.sort((a, b) => a.index - b.index);
}
export function organisationStatementsOfText(text: unknown): Array<{
    role: 'issuingBody' | 'publisher' | 'copyrightHolder';
    raw: string;
    index: number;
}> {
    const page = NFKC(text);
    const out: Array<{
        role: 'issuingBody' | 'publisher' | 'copyrightHolder';
        raw: string;
        index: number;
    }> = [];
    let offset = 0;
    for (const row of page.split('\n')) {
        for (const piece of piecesOf(row)) {
            const base = offset + Math.max(0, row.indexOf(piece));
            for (const fragment of [...publicationIn(piece), ...rightsIn(piece)]) {
                const name = fragment.names?.[0]?.text || '';
                if (!name)
                    continue;
                const index = base + fragment.index;
                if (fragment.kind === 'rights')
                    out.push({ role: 'copyrightHolder', raw: name, index });
                else if (fragment.kind !== 'publication')
                    continue;
                else if (fragment.method === 'imprintStatement' || (fragment.method === 'houseLabel' && /publisher|출\s*판\s*사/iu.test(fragment.label || '')))
                    out.push({ role: 'publisher', raw: name, index });
                else
                    out.push({ role: 'issuingBody', raw: name, index });
            }
        }
        offset += row.length + 1;
    }
    return out;
}
export type EditionScopeOfText = 'firstPublished' | 'thisEdition' | 'reprint' | 'copyright';
export function editionStatementsOfText(text: unknown): Array<{
    scope: EditionScopeOfText;
    year: string;
    edition: string | null;
    raw: string;
    index: number;
}> {
    const page = NFKC(text);
    const out: Array<{
        scope: EditionScopeOfText;
        year: string;
        edition: string | null;
        raw: string;
        index: number;
    }> = [];
    let offset = 0;
    for (const row of page.split('\n')) {
        for (const piece of piecesOf(row)) {
            const base = offset + Math.max(0, row.indexOf(piece));
            for (const fragment of editionsIn(piece)) {
                if (fragment.kind !== 'edition' || !fragment.years?.length)
                    continue;
                const year = Number(fragment.years[0]);
                if (year < 1400 || year > 2100)
                    continue;
                const scope: EditionScopeOfText = fragment.hint === 'firstPublished' ? 'firstPublished' : fragment.hint === 'thisEdition' ? 'thisEdition' : fragment.hint === 'reprint' ? 'reprint' : 'copyright';
                out.push({ scope, year: fragment.years[0], edition: fragment.edition ?? null, raw: fragment.raw, index: base + fragment.index });
            }
        }
        offset += row.length + 1;
    }
    return out.sort((a, b) => a.index - b.index);
}
const LABEL_AT_START = new RegExp(`^\\s*(?:${[STATEMENT_LABELS.house, STATEMENT_LABELS.person, STATEMENT_LABELS.printer].map(label => label.source).join('|')}|published\\s+by(?:\\s*[:：]\\s*|\\s+))`, 'iu');
const ADDRESS_TOKEN = /(?<![\p{L}\d])(?!(?:1[5-9]|20)\d{2}(?!\d))\d{1,6}[^\S\n]+(?:[NSEW]\.?[^\S\n]+)?\p{Lu}\p{Ll}+|(?<![\p{L}\d])(?!(?:Table|Figure|Chapter|Section|Page|Volume|Part|Appendix|Scheme|Equation|Article|Issue|Number|Step|Unit|Lesson|Exercise)[^\S\n])\p{Lu}\p{Ll}{3,}[^\S\n]+(?!(?:1[5-9]|20)\d{2}(?!\d))\d{1,5}(?![\d\p{L}]|\.\d)|(?<!\d)\d{5}(?:-\d{4})?(?!\d)|(?<![\p{L}])(?:[Tt]el|TEL|[Pp]hone|PHONE|[Ff]ax|FAX|[Ee]-?[Mm]ail|E-?MAIL|[Pp]\.?[^\S\n]?[Oo]\.?[^\S\n]*(?:[Bb]ox|BOX)|Postfach|전\s*화|팩\s*스|주\s*소|사\s*서\s*함)(?![\p{L}])\.?\s*[:：]?/u;
function addressRow(row: string): boolean {
    const value = oneLine(row);
    if (!value || value.length > 160 || /[.!?]$/.test(value) && value.split(' ').length > 8 || /^[\d\s,.–-]+$/.test(value))
        return false;
    const found = ADDRESS_TOKEN.exec(value);
    return !!found && found.index <= 2;
}
function addressBlocksIn(rows: string[], stated: string[], options: {
    corroboratedOnly?: boolean;
} = {}): Array<{
    name: string;
    row: number;
    raw: string;
}> {
    const out: Array<{
        name: string;
        row: number;
        raw: string;
    }> = [];
    const known = stated.map(name => oneLine(name)).filter(name => name.length >= 3);
    if (options.corroboratedOnly && !known.length)
        return out;
    const lowered = known.map(name => name.toLowerCase());
    const nameOf = (head: string): string => {
        const value = nameInImprint(oneLine(head).replace(LABEL_AT_START, '').replace(/[,;:]\s*$/, ''));
        if (!value || value.length > 90 || !/^\p{Lu}|^[가-힣]/u.test(value))
            return '';
        const corroborated = known.filter(name => value.toLowerCase().startsWith(name.toLowerCase())).sort((a, b) => b.length - a.length)[0];
        if (corroborated)
            return THE_AUTHORS.test(corroborated) ? '' : corroborated;
        if (options.corroboratedOnly)
            return '';
        return organisationShaped(value) && !personShaped(value) && !sentenceShaped(value) && value.split(/\s+/).length <= 8 ? tidyOrganisation(value) : '';
    };
    rows.forEach((row, at) => {
        const value = oneLine(row);
        if (!value || value.length > 200)
            return;
        if (options.corroboratedOnly && !lowered.some(name => value.toLowerCase().includes(name)))
            return;
        const token = ADDRESS_TOKEN.exec(value);
        if (token && token.index > 2) {
            const name = nameOf(value.slice(0, token.index));
            if (name)
                out.push({ name, row: at, raw: value });
            return;
        }
        if (token)
            return;
        let after = at + 1;
        while (after < rows.length && !rows[after].trim())
            after++;
        const next = rows[after];
        const numbered = next !== undefined && (() => {
            const opens = /^(\d{1,4})\s/.exec(oneLine(next)), own = /(?:^(\d{1,4})\s|\s(\d{1,4})$)/.exec(value);
            return !!opens && !!own && Number(opens[1]) === Number(own[1] ?? own[2]) + 1;
        })();
        if (next !== undefined && !numbered && addressRow(next)) {
            const name = nameOf(value);
            if (name)
                out.push({ name, row: at, raw: `${value} / ${oneLine(next)}` });
        }
    });
    return out;
}
const NOT_A_SEAT: RegionKind[] = ['references', 'citation', 'otherWorks', 'contentsList', 'acknowledgements', 'table', 'stamp'];
const FUNDING_BLIND: RegionKind[] = NOT_A_SEAT.filter(kind => kind !== 'acknowledgements');
const SEAT_READS: Record<Seat, StatementKind[]> = {
    titleBlock: ['volume', 'series', 'edition'],
    nearTitle: ['volume', 'series', 'edition', 'containment', 'translation', 'responsibility', 'rights', 'publication'],
    byline: ['responsibility', 'translation'],
    coverHead: ['volume', 'series', 'containment', 'rights', 'publication', 'commissioning'],
    coverImprint: ['publication', 'rights', 'edition', 'date', 'translation', 'responsibility', 'commissioning', 'containment', 'originalEdition'],
    colophon: ['publication', 'rights', 'edition', 'date', 'originalEdition', 'arrangement', 'translation', 'responsibility', 'commissioning', 'series', 'volume', 'containment'],
    colophonPage: ['publication', 'rights', 'edition', 'date', 'originalEdition', 'arrangement', 'translation', 'responsibility', 'commissioning', 'series', 'containment'],
    formLabel: ['publication', 'rights', 'date', 'responsibility', 'translation', 'commissioning'],
    running: ['rights', 'publication'],
    addressBlock: ['address'],
    selfCitation: ['containment', 'publication'],
    openingFoot: ['publication', 'rights', 'containment', 'commissioning'],
    fundingNote: ['commissioning']
};
interface SeatedLine {
    page: number;
    role: PageRole | '';
    reading: 'layer' | 'ocr';
    seat: Seat;
    rows: [
        number,
        number
    ];
    text: string;
    marked: boolean;
}
interface SeatedRow {
    page: number;
    role: PageRole | '';
    reading: 'layer' | 'ocr';
    row: StructureRow;
    seat: Seat | null;
    where: Refusal['where'];
}
const FIELD_ROW = /^[\p{L}][\p{L}\p{N}’'.-]*(?:[^\S\n][\p{L}\p{N}’'.-]+){0,3}[^\S\n]*[:：](?:[^\S\n]|$)/u;
function seatedRowsOf(s: PageStructure): SeatedRow[] {
    const out: SeatedRow[] = [];
    const opening = s.opening.page;
    const front = new Set(s.frontMatter);
    const lastRead = s.pages.length ? s.pages[s.pages.length - 1].page : 0;
    for (const entry of s.pages) {
        const page = entry.page, role = entry.role;
        if (role === 'insertedLeaf')
            continue;
        const order = titleOrder(s, page);
        const frontPage = order !== null || role === 'colophon' || front.has(page);
        const readings = frontPage ? readingsOf(s, page) : readingsOf(s, page).slice(0, 1);
        for (const reading of readings) {
            const rows = rowsOf(s, page, reading);
            if (!rows.length)
                continue;
            const filled = rows.filter(row => row.text.trim());
            const prose = rows.some(row => row.prose);
            const claimRows = filled.filter(row => row.claim), bylineRows = filled.filter(row => row.byline);
            const claimFirst = claimRows.length ? claimRows[0].row : -1, claimLast = claimRows.length ? claimRows[claimRows.length - 1].row : -1;
            const bylineFirst = bylineRows.length ? bylineRows[0].row : -1, bylineLast = bylineRows.length ? bylineRows[bylineRows.length - 1].row : -1;
            const lastProse = rows.reduce((last, row) => row.prose ? row.row : last, -1);
            const blockAbove = claimFirst >= 0 ? rows.slice(0, claimFirst).filter(row => row.text.trim()).map(row => row.block).pop() : undefined;
            const titled = order === 0 || (role === 'formPage' && entry.form === 'degree');
            const afterOpening = opening !== null && page > opening && front.has(page);
            const imprintHead = new Set<number>();
            if (order === null && role !== 'references' && role !== 'contents') {
                const first = rows.findIndex(row => row.region === 'imprint');
                const run: number[] = [];
                for (let at = first - 1; at >= 0; at--) {
                    const row = rows[at];
                    if (!row.text.trim())
                        continue;
                    if (row.prose || row.running || row.region)
                        break;
                    run.push(row.row);
                }
                if (run.some(at => LABEL_AT_START.test(oneLine(rows.find(row => row.row === at)?.text))))
                    for (const at of run)
                        imprintHead.add(at);
            }
            for (const row of rows) {
                if (!row.text.trim())
                    continue;
                let seat: Seat | null = null;
                let where: Refusal['where'] = role || 'body';
                if (row.region && NOT_A_SEAT.includes(row.region))
                    where = row.region;
                else if (row.region === 'selfCitation')
                    seat = 'selfCitation';
                else if (row.running)
                    seat = 'running';
                else if ((row.region === 'imprint' || imprintHead.has(row.row)) && role !== 'references' && role !== 'contents')
                    seat = 'colophon';
                else if (titled) {
                    const at = row.row;
                    if (row.claim)
                        seat = 'titleBlock';
                    else if (row.byline)
                        seat = 'byline';
                    else if (row.region === 'masthead')
                        seat = page === opening && claimFirst >= 0 && at < claimFirst ? 'coverHead' : null;
                    else if (claimLast >= 0 && at > claimLast && bylineFirst >= 0 && at < bylineFirst)
                        seat = 'nearTitle';
                    else if (claimFirst >= 0 && at < claimFirst)
                        seat = row.block === blockAbove ? 'nearTitle' : prose ? null : 'coverHead';
                    else if (FIELD_ROW.test(oneLine(row.text)) && !row.prose && (!prose || LABEL_AT_START.test(oneLine(row.text))))
                        seat = 'formLabel';
                    else if (!prose)
                        seat = 'coverImprint';
                    else if (page === opening && at > lastProse && lastProse >= 0 && !row.prose)
                        seat = 'openingFoot';
                    else if (bylineLast >= 0 && at > bylineLast && !row.prose && at < (lastProse >= 0 ? lastProse : Infinity)) {
                        seat = null;
                        where = 'affiliation';
                    }
                    else if (page === opening && row.prose)
                        seat = 'openingFoot';
                    if (seat === null && where === (role || 'body') && row.prose)
                        where = 'body';
                }
                else if (role === 'formPage')
                    seat = FIELD_ROW.test(oneLine(row.text)) ? 'formLabel' : 'colophonPage';
                else if (role === 'colophon' || (afterOpening && role !== 'body' && role !== 'contents' && role !== 'references'))
                    seat = row.prose ? null : 'colophonPage';
                else if (opening !== null && page > opening && page <= opening + 3 && role === 'body' && !row.prose && !row.region && labelledResponsibilityRow(oneLine(row.text)))
                    seat = 'formLabel';
                else
                    where = row.prose ? 'body' : role || 'body';
                if (!seat && page === lastRead && !row.prose && !(row.region && NOT_A_SEAT.includes(row.region)) && page !== opening)
                    where = 'body';
                out.push({ page, role, reading, row, seat, where });
            }
        }
    }
    return out;
}
const LEADING_ROLE_ROW = new RegExp(`^\\s*(?:${LEADING_ROLE_SOURCE})(?![\\p{L}])`, 'iu');
function labelledResponsibilityRow(text: string): boolean {
    return text.length <= 80 && LEADING_ROLE_ROW.test(text) && !!responsibilityOfLine(text);
}
const ENDS_WITH_LEGAL_FORM = /(?<![\p{L}'’-])(?:Inc|Ltd|LLC|GmbH|Corp|PLC|S\.A|B\.V|K\.K|AG|KGaA|Limited|Corporation)\.?\s*$/u;
const STATEMENT_OPENING = new RegExp(String.raw `^.{0,20}?(?:(?<![\p{L}])(?:e[-\s]?edition|${EDITION_ORDINAL}\s+edition|revised\s+edition|published\s+by|copyright|reprinted|originally\s+published|first\s+published)(?![\p{L}])|©|ⓒ)`, 'iu');
function linesOfSeats(rows: SeatedRow[]): SeatedLine[] {
    const out: SeatedLine[] = [];
    let open: SeatedLine | null = null;
    const joins = (seat: Seat) => seat === 'colophon' || seat === 'colophonPage' || seat === 'coverImprint' || seat === 'openingFoot' || seat === 'selfCitation';
    for (const entry of rows) {
        if (!entry.seat) {
            open = null;
            continue;
        }
        const text = oneLine(entry.row.text);
        const opensStatement = () => STATEMENT_OPENING.test(text);
        if (open && open.page === entry.page && open.reading === entry.reading && open.seat === entry.seat && entry.row.row === open.rows[1] + 1
            && joins(entry.seat) && (RUNS_ON.test(open.text) || (/^\p{Ll}/u.test(text) && !opensStatement() && !ENDS_WITH_LEGAL_FORM.test(open.text)))
            && !CONTAINER_EDITED_FOOT.test(text)
            && open.text.length + text.length < STRUCTURE.lineChars
            && !addressRow(text) && !/^(?:doi\s*:|https?:|www\.)/i.test(text)) {
            open.text = `${open.text} ${text}`;
            open.rows[1] = entry.row.row;
            continue;
        }
        open = { page: entry.page, role: entry.role, reading: entry.reading, seat: entry.seat, rows: [entry.row.row, entry.row.row], text, marked: entry.row.marked };
        out.push(open);
    }
    return out;
}
const cache = new WeakMap<PageStructure, FrontStatements>();
export function readStatements(s: PageStructure): FrontStatements {
    const held = cache.get(s);
    if (held)
        return held;
    const answer = computeStatements(s);
    cache.set(s, answer);
    return answer;
}
const textCache = new Map<string, PageStructure>();
function structureOfText(text: unknown): PageStructure {
    const value = String(text ?? '');
    const held = textCache.get(value);
    if (held)
        return held;
    const structure = readPageStructure({ pages: value.split('\f').map((page, index) => ({ page: index + 1, layer: { text: page } })) });
    textCache.set(value, structure);
    if (textCache.size > 32)
        textCache.delete(textCache.keys().next().value as string);
    return structure;
}
export function statementsInText(text: string): FrontStatements {
    return readStatements(structureOfText(text));
}
export function issuingBodyOf(s: PageStructure): string {
    const stated = readStatements(s).thisEdition.issuer?.names?.[0];
    if (stated)
        return stated.printed || stated.text;
    for (const entry of s.pages) {
        const footer = footerIssuerOf(s, entry.page);
        if (footer)
            return footer;
    }
    return '';
}
export function issuingBodyInText(text: string): string {
    return issuingBodyOf(structureOfText(text));
}
export function statementsOfObservations(pages: PageObservation[], documentPages?: number): FrontStatements {
    return readStatements(structureFromPageObservations(pages, documentPages));
}
const sameName = (a: string, b: string) => { const x = compact(a), y = compact(b); return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)))); };
function romanisedHouse(house: string, latin: string): boolean {
    const flat = house.replace(/\s+/g, '');
    if (!/^[가-힣]{2,}/.test(flat))
        return false;
    const words = latin.match(/\p{Script=Latin}{3,}/gu) || [];
    const romanised = new Set([...flat].map((_, at) => at >= 1 && /^[가-힣]+$/.test(flat.slice(0, at + 1)) ? fold(romanise(flat.slice(0, at + 1))) : '').filter(Boolean));
    return words.some(word => romanised.has(fold(word)) || !!hangulRespelledByRomanisation(flat, word));
}
function samePerson(a: string, b: string): boolean {
    return sameName(a, b) || samePersonByName(a, b, 'bylineMerge');
}
function bodyScript(s: PageStructure, without: number): 'hangul' | 'han' | 'kana' | 'latin' | null {
    let hangul = 0, han = 0, kana = 0, latin = 0;
    for (const page of bodyPages(s)) {
        if (page === without)
            continue;
        const text = rowsOf(s, page).map(row => row.text).join('\n');
        hangul += (text.match(/[가-힣]/g) || []).length * 2.5;
        han += (text.match(/\p{Script=Han}/gu) || []).length;
        kana += (text.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
        latin += (text.match(/\p{Script=Latin}/gu) || []).length;
    }
    const total = hangul + han + kana + latin;
    if (total < 8)
        return null;
    const best = Math.max(hangul, han, kana, latin);
    return best === hangul ? 'hangul' : best === kana ? 'kana' : best === han ? 'han' : 'latin';
}
function computeStatements(s: PageStructure): FrontStatements {
    const statements: Statement[] = [];
    const refused: Refusal[] = [];
    const seated = seatedRowsOf(s);
    const lines = linesOfSeats(seated);
    const roleOfPage = (page: number) => s.pages.find(entry => entry.page === page)?.role || '';
    for (const line of lines) {
        if (line.seat === 'openingFoot' && !FOOT_TRIGGER.test(line.text))
            continue;
        for (const piece of piecesOf(line.text)) {
            for (const fragment of fragmentsOf(piece, IMPRINT_SEATS.has(line.seat))) {
                const accepted = SEAT_READS[line.seat].includes(fragment.kind) || (line.seat === 'byline' && fragment.kind === 'publication'
                    && (fragment.method === 'houseTail' || ((fragment.method === 'publishedBy' || fragment.method === 'houseLabel') && fragment.index > 0)));
                if (!accepted || (fragment.kind === 'edition' && fragment.hint === 'copyrightYear'))
                    continue;
                statements.push(statementOf(fragment, line));
            }
        }
    }
    for (const entry of seated) {
        if (entry.seat && SEAT_READS[entry.seat].includes('commissioning'))
            continue;
        if (FUNDING_BLIND.includes(entry.where as RegionKind))
            continue;
        const text = oneLine(entry.row.text);
        if (!text || text.length > STRUCTURE.lineChars)
            continue;
        const line: SeatedLine = { page: entry.page, role: entry.role, reading: entry.reading, seat: 'fundingNote', rows: [entry.row.row, entry.row.row], text, marked: entry.row.marked };
        for (const fragment of englishSponsorsIn(text, !entry.row.prose))
            statements.push(statementOf(fragment, line));
    }
    seated.forEach((entry, index) => {
        if (entry.seat || entry.row.prose || entry.row.text.length > STRUCTURE.lineChars)
            return;
        const text = oneLine(entry.row.text);
        if (!text)
            return;
        if (imprintMark(text)) {
            const found = [...rightsIn(text), ...publicationIn(text), ...originalHeadsIn(text)].filter(fragment => ['rights', 'publication', 'originalEdition', 'translation', 'arrangement'].includes(fragment.kind));
            for (const fragment of found.slice(0, 2))
                refused.push({ page: entry.page, where: entry.where, kind: fragment.kind, raw: fragment.raw.slice(0, 120), why: `outside a seat (${entry.where})` });
        }
        const previous = seated[index - 1];
        if (previous && previous.page === entry.page && !previous.seat && text.length <= 80 && /^\p{Lu}/u.test(text)
            && TWO_NAME_WORDS.test(oneLine(previous.row.text)) && isPublishingHouse(text) && latinPerson(oneLine(previous.row.text))) {
            refused.push({ page: entry.page, where: entry.where, kind: 'originalEdition', raw: `${oneLine(previous.row.text)} / ${text}`.slice(0, 120), why: `a person and a publisher outside a seat (${entry.where})` });
        }
    });
    for (const line of lines) {
        if (!DATE_SEATS.includes(line.seat) || !line.marked || titleOrder(s, line.page) === null || titleOrder(s, line.page) === 2)
            continue;
        const reading = dateRowOf(line.text);
        if (!reading || statements.some(entry => entry.kind === 'date' && entry.page === line.page && entry.rows[0] === line.rows[0]))
            continue;
        statements.push({ kind: 'date', scope: 'thisEdition', page: line.page, role: line.role, seat: line.seat, reading: line.reading, rows: [...line.rows], raw: reading.raw,
            years: [reading.value.slice(0, 4)], date: { value: reading.value, precision: reading.precision }, because: [{ signal: 'seat', detail: `${line.seat} date row` }] });
    }
    const coverRows = lines.filter(line => line.marked && (line.seat === 'coverImprint'
        || (line.seat === 'byline' && titleOrder(s, line.page) === 0 && line.text.length <= 60 && isPublishingHouse(line.text) && !personShaped(line.text))));
    const lineIndex = new Map(lines.map((line, at) => [line, at] as const));
    const neighbours = (line: SeatedLine, step: -1 | 1) => { const next = lines[(lineIndex.get(line) ?? -2) + step]; return next && next.page === line.page && next.reading === line.reading ? next : undefined; };
    const personRow = (text: string) => { const value = oneLine(text); return value.length <= 120 && personShaped(value.replace(/\s*\(\s*[*†‡§¶]+\s*\)\s*$/u, '').replace(/[\s,]*\d{1,2}(?:\s*,\s*\d{1,2})*$/u, '')); };
    const contactRow = (text: string) => /(?<![\p{L}])(?:e-?mail|tel|phone|fax)(?![\p{L}])\s*[:：.]|(?<![\w.+-])[\w.+-]+@[\w-]+\.[\w.]+/iu.test(text)
        || /^\d[\d,.]*[^\S\n]+\p{Lu}{3,}(?:[^\S\n]+\d[\d,.]*[^\S\n]+\p{Lu}{3,})*$/u.test(oneLine(text));
    const affiliationPairs = new Map<string, number>();
    for (const line of coverRows) {
        const above = neighbours(line, -1);
        if (above && personRow(above.text) && organisationShaped(line.text.split(/\s*[,，]\s*/)[0]))
            affiliationPairs.set(`${line.page}:${line.reading}`, (affiliationPairs.get(`${line.page}:${line.reading}`) || 0) + 1);
    }
    const affiliation = (line: SeatedLine) => {
        const above = neighbours(line, -1), below = neighbours(line, 1);
        return (!!above && personRow(above.text) && (affiliationPairs.get(`${line.page}:${line.reading}`) || 0) >= 2) || (!!below && contactRow(below.text));
    };
    coverRows.forEach((line, index) => {
        const text = line.text;
        if (!text || text.length > 80 || dateRowOf(text) || imprintMark(text) || HOST_IN.test(text))
            return;
        if (fragmentsOf(text, IMPRINT_SEATS.has(line.seat)).some(fragment => fragment.kind !== 'volume' && fragment.kind !== 'date'))
            return;
        if (publicationStatementOf(text, { imprint: IMPRINT_SEATS.has(line.seat) }))
            return;
        const parts = text.split(/\s*[,，]\s*/);
        const legalTail = parts.length >= 2 && /^(?:Inc|INC|Ltd|LTD|LLC|GmbH|GMBH|AG|Corp|CORP|Corporation|S\.A|B\.V|PLC|K\.K|Co\.?,?\s*Ltd)\.?$/.test(parts[parts.length - 1].trim());
        let name = (legalTail ? text.replace(/\s+(?=[.,])/g, '') : parts[0].trim()).replace(/^(?:1[5-9]|20)\d{2}\s+(?=\p{L})/u, '');
        if (!/^[\p{L}]/u.test(name) || affiliation(line))
            return;
        if (!organisationShaped(name) || personShaped(name) || sentenceShaped(name))
            return;
        const above = coverRows[index - 1];
        if (above && above.page === line.page && above.reading === line.reading && above.text.length <= 30 && /^[\p{L}][\p{L}\s.'’-]*$/u.test(above.text)
            && !/[.,;:!?]$/.test(above.text) && !personShaped(above.text) && !organisationShaped(above.text) && !isPublishingHouse(above.text) && !dateRowOf(above.text)
            && /^\p{Lu}/u.test(above.text) && above.text === above.text.toUpperCase() && name === name.toUpperCase())
            name = `${above.text} ${name}`;
        const place = !legalTail && parts.length === 2 && /^\p{Lu}\p{Ll}+(?:\s\p{Lu}\p{Ll}+)?$/u.test(parts[1].trim()) ? parts[1].trim() : undefined;
        statements.push({ kind: 'publication', scope: 'thisEdition', page: line.page, role: line.role, seat: 'coverImprint', reading: line.reading, rows: [...line.rows], raw: text,
            names: [statedName(tidyOrganisation(name), isPublishingHouse(name) ? 'publisherHouse' : 'issuer', name)], ...(place ? { place } : {}), because: [{ signal: 'seat', detail: 'coverImprint' }] });
    });
    const claimStart = new Map<string, number>();
    for (const entry of seated)
        if (entry.row.claim) {
            const key = `${entry.page}:${entry.reading}`;
            claimStart.set(key, Math.min(claimStart.get(key) ?? Infinity, entry.row.row));
        }
    for (const entry of seated) {
        const above = entry.row.row < (claimStart.get(`${entry.page}:${entry.reading}`) ?? -1);
        if (!(entry.seat === 'coverHead' || (entry.seat === 'nearTitle' && above && titleOrder(s, entry.page) === 0)) || !entry.row.marked || entry.row.region || entry.row.prose)
            continue;
        const text = oneLine(entry.row.text);
        if (!text || text.length > 60 || !/^[\p{L}]/u.test(text) || dateRowOf(text) || imprintMark(text) || HOST_IN.test(text))
            continue;
        if (fragmentsOf(text).length || publicationStatementOf(text) || !organisationShaped(text) || personShaped(text) || sentenceShaped(text))
            continue;
        statements.push({ kind: 'publication', scope: 'thisEdition', page: entry.page, role: entry.role, seat: 'coverHead', reading: entry.reading, rows: [entry.row.row, entry.row.row], raw: text,
            names: [statedName(tidyOrganisation(text), 'issuer', text)], because: [{ signal: 'seat', detail: 'coverHead' }] });
    }
    {
        const body = new Set(bodyPages(s));
        const thesis = s.pages.some(entry => entry.role !== 'insertedLeaf' && (entry.role === 'formPage' ? ['degree', 'submission', 'approval'].includes(String(entry.form)) : !body.has(entry.page)))
            || seated.some(entry => !entry.row.prose && entry.row.text.length <= 80 && (entry.seat === 'titleBlock' || entry.seat === 'nearTitle' || entry.seat === 'coverHead')
                && isDegreeStatement(entry.row.text));
        {
            const seen = new Set<string>();
            const front = new Set(s.frontMatter);
            for (const line of lines) {
                const order = titleOrder(s, line.page);
                if ((order !== 0 && order !== 1 && !(thesis && front.has(line.page)))
                    || !(line.seat === 'coverImprint' || (thesis && ['nearTitle', 'coverHead', 'formLabel', 'colophonPage', 'byline', 'running'].includes(line.seat))))
                    continue;
                const text = line.text;
                if (text.length > 80 || !SCHOOL_HEAD.test(text) || IMPRINT_MARKS.rights.test(text) || seen.has(compact(text)))
                    continue;
                if (!thesis && line.seat === 'coverImprint' && affiliation(line))
                    continue;
                seen.add(compact(text));
                statements.push({ kind: 'publication', scope: 'thisEdition', page: line.page, role: line.role, seat: line.seat, reading: line.reading, rows: [...line.rows], raw: text,
                    names: [statedName(text, 'degreeGranting')], because: [{ signal: 'seat', detail: `${line.seat} of a thesis` }] });
            }
        }
    }
    {
        const holders = statements.filter(entry => entry.kind === 'rights').flatMap(entry => (entry.names || []).map(name => name.text));
        const lastRead = s.pages.length ? s.pages[s.pages.length - 1].page : 0;
        const pages = new Set([...s.frontMatter, lastRead]);
        const addressSeat = (entry: SeatedRow) => entry.seat === 'coverImprint' || entry.seat === 'colophon' || entry.seat === 'colophonPage' || entry.seat === 'formLabel'
            || (entry.page === lastRead && entry.page !== s.opening.page && entry.where !== 'affiliation' && entry.seat !== 'running' && !entry.row.running);
        const push = (page: number, rows: SeatedRow[], corroboratedOnly: boolean) => {
            for (const block of addressBlocksIn(rows.map(entry => entry.row.text), holders, { corroboratedOnly })) {
                const first = rows[block.row];
                if (statements.some(entry => entry.kind === 'address' && entry.page === page && entry.rows[0] === first.row.row))
                    continue;
                statements.push({ kind: 'address', scope: 'thisEdition', page, role: roleOfPage(page), seat: 'addressBlock', reading: first.reading, rows: [first.row.row, first.row.row], raw: block.raw,
                    names: [statedName(block.name, 'issuer')], because: [{ signal: 'seat', detail: 'addressBlock' }, ...(holders.some(name => sameName(name, block.name)) ? [{ signal: 'corroborated' as const, detail: 'rights line' }] : [])] });
            }
        };
        for (const page of pages) {
            const reading = readingsOf(s, page)[0];
            const usable = (entry: SeatedRow) => entry.page === page && entry.reading === reading && !(entry.row.region && NOT_A_SEAT.includes(entry.row.region));
            const rows = seated.filter(entry => usable(entry) && !entry.row.prose && addressSeat(entry));
            if (rows.length)
                push(page, rows, false);
            const foot = seated.filter(entry => usable(entry) && entry.seat === 'openingFoot');
            if (foot.length)
                push(page, foot, true);
        }
    }
    const persons: StatedName[] = [];
    const addPerson = (name: StatedName) => { if (!persons.some(held => sameName(held.text, name.text)))
        persons.push(name); };
    for (const entry of seated) {
        if (entry.seat !== 'byline')
            continue;
        const line = oneLine(entry.row.text);
        const cut = line.length <= STRUCTURE.lineChars ? publisherStatementsIn(line) : null;
        const text = cut ? cut.rest : line;
        if (!text)
            continue;
        const stated = responsibilityIn(text)[0];
        if (stated?.names?.length) {
            for (const name of stated.names)
                addPerson(name);
            continue;
        }
        const misread = misreadRoleWordLine(text);
        if (misread) {
            for (const name of misread.names)
                addPerson(statedName(name, bylineRoleOf(misread.word) === 'translator' ? 'translator' : 'author'));
            continue;
        }
        for (const part of text.split(/\s*(?:,|;|·|•|&|\band\b|、)\s*/u)) {
            const name = part.length > 80 ? '' : part.replace(/[*†‡§¶\d]+$/, '').trim();
            if (name && personShaped(name))
                addPerson(statedName(name));
        }
    }
    for (const statement of statements) {
        if (statement.kind === 'responsibility' && statement.label !== 'by')
            for (const name of statement.names || [])
                if (name.role && ['author', 'editor', 'contributor'].includes(name.role))
                    addPerson(name);
        if (statement.kind === 'translation')
            for (const name of statement.names || [])
                addPerson(name);
    }
    const houses = statements.filter(entry => entry.kind === 'publication');
    const thisHouse = pickPublisher(houses);
    const blocks = originalBlocks(s, seated, persons, thisHouse);
    statements.push(...blocks);
    const translationRights = statements.filter(entry => entry.kind === 'rights' && entry.because.some(reason => reason.signal === 'translationRights'));
    const translationStatements = statements.filter(entry => entry.kind === 'translation');
    const originalLabels = statements.filter(entry => entry.kind === 'originalEdition' && entry.label && EDITION_LEADS.original.test(entry.label) && (entry.seat === 'colophon' || entry.seat === 'colophonPage'));
    const decidedBlocks = blocks.filter(block => block.scope === 'originalEdition');
    const foreignOriginal = statements.find(entry => entry.kind === 'originalEdition' && entry.scope === 'originalEdition' && entry.label !== 'original block'
        && (entry.seat === 'colophon' || entry.seat === 'colophonPage')
        && (entry.names || []).some(name => name.role === 'publisherHouse' && !(thisHouse && (sameName(thisHouse, name.text) || romanisedHouse(thisHouse, name.text))))
        && (() => { const script = bodyScript(s, entry.page), own = scriptOf(entry.raw); return !!script && own !== 'mixed' && own !== script; })());
    if (foreignOriginal)
        foreignOriginal.because.push({ signal: 'scriptDiffers' }, { signal: 'otherPublisher' });
    const translation = translationStatements[0] || translationRights[0] || decidedBlocks[0] || originalLabels[0] || foreignOriginal || null;
    const translated = !!translation;
    const editionRights = statements.filter(entry => entry.kind === 'rights' && entry.because.some(reason => reason.signal === 'editionRights'));
    if (translated)
        for (const entry of editionRights)
            entry.because.push({ signal: 'translationRights' });
    for (const statement of statements) {
        if (statement.kind !== 'rights' || statement.because.some(reason => reason.signal === 'translationRights'))
            continue;
        const holder = statement.names?.[0];
        if (translated && holder && holder.shape === 'person' && !(thisHouse && sameName(thisHouse, holder.text))) {
            statement.scope = 'originalEdition';
            statement.because.push({ signal: 'otherPersons', detail: holder.text });
        }
    }
    const otherEdition = translationRights.length > 0 || editionRights.length > 0
        || statements.some(entry => entry.kind === 'edition' && entry.because.some(reason => reason.signal === 'editionSequence'))
        || statements.some(entry => entry.kind === 'date' && entry.seat === 'colophon');
    for (const statement of statements) {
        const first = statement.because.some(reason => reason.signal === 'firstPublished');
        if (!first)
            continue;
        statement.scope = otherEdition ? 'originalEdition' : 'thisEdition';
    }
    const volumes = attributeVolumes(s, seated, statements);
    const containment = containmentOf(s, statements);
    const originalStatements = statements.filter(entry => entry.scope === 'originalEdition');
    let original: FrontStatements['original'] = null;
    if (translated || originalStatements.length) {
        const years = [...new Set(originalStatements.flatMap(entry => entry.years || []))];
        const byLine = translated ? statements.find(entry => entry.kind === 'responsibility' && entry.label === 'by' && (entry.seat === 'colophonPage' || entry.seat === 'colophon')
            && (entry.names || []).some(name => name.shape === 'person' && !persons.some(held => samePerson(held.text, name.text)))) : undefined;
        const blockAuthor = decidedBlocks[0]?.names?.find(name => name.role === 'author');
        const rightsAuthor = originalStatements.find(entry => entry.kind === 'rights')?.names?.[0];
        const author = byLine?.names?.[0] || blockAuthor || (translated ? rightsAuthor : undefined);
        const house = originalStatements.flatMap(entry => (entry.names || []).filter(name => name.role === 'publisherHouse'))[0];
        original = { ...(author ? { author: { ...author, role: 'author' } } : {}), ...(house ? { publisher: house.text } : {}),
            ...(decidedBlocks[0]?.place ? { place: decidedBlocks[0].place } : {}), years, statements: originalStatements };
        if (!translated && !original.author && !years.length)
            original = null;
    }
    {
        const hosts = new Set<string>();
        for (const entry of seated) {
            if (!entry.seat || entry.row.prose)
                continue;
            const host = HOST_IN.exec(entry.row.text);
            if (!host)
                continue;
            const bare = host[0].replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split(/[./]/)[0];
            if (bare)
                hosts.add(compact(bare));
        }
        for (const statement of statements) {
            if (statement.kind !== 'rights' || statement.scope !== 'thisEdition')
                continue;
            const holder = statement.names?.[0];
            if (!holder || holder.shape !== 'organisation')
                continue;
            const elsewhere = statements.some(other => other !== statement && other.kind !== 'rights' && (other.names || []).some(name => sameName(name.text, holder.text)));
            const head = compact(holder.text.split(/\s+/)[0] || '');
            if (elsewhere || (head.length >= 3 && hosts.has(head)))
                statement.because.push({ signal: 'corroborated', detail: elsewhere ? 'another statement' : 'its own domain' });
        }
    }
    const thisEditionStatements = statements.filter(entry => entry.scope === 'thisEdition');
    const publisher = pickPublisherStatement(thisEditionStatements.filter(entry => entry.kind === 'publication'));
    const issuer = pickIssuer(statements);
    const printing = printingOf(statements);
    const date = pickDate(statements, s.opening.page, printing);
    const edition = statements.find(entry => entry.kind === 'edition' && entry.edition && entry.scope === 'thisEdition');
    const place = thisEditionStatements.find(entry => entry.kind === 'publication' && entry.place);
    const rights = statements.filter(entry => entry.kind === 'rights' && entry.scope === 'thisEdition');
    const answer: FrontStatements = {
        statements, refused,
        thisEdition: { ...(publisher ? { publisher } : {}), ...(issuer ? { issuer } : {}), ...(date ? { date } : {}), ...(place ? { place } : {}), ...(edition ? { edition } : {}), persons, rights,
            ...(printing ? { printing: { chosen: printing.chosen, others: printing.others } } : {}) },
        translation,
        original,
        volume: volumes.volume,
        series: volumes.series,
        containment,
        ownRange: ownRangeOf(s),
        partHeading: partHeadingOf(s, seated),
    };
    for (const entry of volumes.refused)
        refused.push(entry);
    return answer;
}
const PART_OPENER = /^[^\S\n]*(?:(?:chapter|chap\.?|section|part|appendix)[^\S\n]+(?:[\dIVXLivxl]+|[A-Z])\b|제?[^\S\n]*\d+[^\S\n]*(?:장|절|부)(?![가-힣]))/iu;
function partHeadingOf(s: PageStructure, seated: SeatedRow[]): FrontStatements['partHeading'] {
    const opening = s.opening.page;
    if (opening === null)
        return null;
    const found = seated.find(entry => entry.page === opening && (entry.seat === 'titleBlock' || entry.seat === 'nearTitle' || entry.seat === 'coverHead')
        && PART_OPENER.test(oneLine(entry.row.text)));
    return found ? { page: found.page, raw: oneLine(found.row.text).slice(0, 80) } : null;
}
const TWO_NAME_WORDS = /^\p{Lu}[\p{L}.'’-]*(?:\s+\p{Lu}[\p{L}.'’-]*){1,3}$/u;
const FOOT_TRIGGER = new RegExp(String.raw `©|ⓒ|\(c\)|copyright|all\s+rights|published|imprint|발행|펴낸|발간|출판|\bin\s*[:：]|수록|게재|edited|귀하|귀중|의뢰|발주|주관|${SPONSOR_LEAD_SOURCE}`, 'iu');
const SCHOOL_HEAD = new RegExp(String.raw `대학교|大學校|大学校|과학기술원|科學技術院|대학원|大學院|university|institute\s+of\s+technology|(?<![\p{L}])(?:${NAME_AFTER_SCHOOL_WORD})(?![\p{L}])`, 'iu');
function sentenceShaped(value: string): boolean {
    const words = oneLine(value).split(/\s+/);
    return words.filter(word => /^\p{Ll}{4,}/u.test(word) && !/^(?:and|for|the|und|des|der|pour|with)$/i.test(word)).length >= 2;
}
const DATE_SEATS: Seat[] = ['coverHead', 'nearTitle', 'coverImprint', 'formLabel', 'colophon', 'colophonPage'];
const thisEditionsDate = (role: unknown) => !role || DATE_ROLE_MEANING[String(role)] === 'published';
function dateRowOf(text: string): {
    value: string;
    precision: 'year' | 'month' | 'day';
    raw: string;
} | null {
    const value = oneLine(text);
    if (!value || value.length > 40)
        return null;
    const readings = readDates(value).filter(entry => entry.precision !== 'year' && thisEditionsDate(entry.role));
    if (!readings.length)
        return null;
    const reading = readings.sort((a, b) => ({ year: 1, month: 2, day: 3 }[b.precision] - ({ year: 1, month: 2, day: 3 }[a.precision])))[0];
    const rest = (value.slice(0, reading.index) + ' ' + value.slice(reading.index + reading.raw.length)).replace(/^\s*[\p{L}\s.]{1,20}[:：]/u, ' ');
    return (rest.match(/\p{L}/gu) || []).length <= 1 ? { value: reading.value, precision: reading.precision, raw: reading.raw } : null;
}
function statementOf(fragment: Fragment, line: SeatedLine): Statement {
    const because: Statement['because'] = [{ signal: fragment.signal }, { signal: 'seat', detail: line.seat }];
    let scope: Scope = 'thisEdition';
    if (fragment.kind === 'originalEdition') {
        if (fragment.hint === 'firstPublished')
            because.push({ signal: 'firstPublished' });
        else
            scope = 'originalEdition';
    }
    if (fragment.kind === 'edition') {
        if (fragment.hint === 'firstPublished')
            because.push({ signal: 'firstPublished' });
        if (fragment.hint === 'thisEdition')
            because.push({ signal: 'editionSequence', detail: fragment.edition });
        if (fragment.hint === 'reprint')
            because.push({ signal: 'reprint' });
    }
    if (fragment.kind === 'rights' && fragment.hint === 'thisEdition')
        because.push({ signal: 'translationRights' });
    if (fragment.kind === 'rights' && fragment.hint === 'editionRights')
        because.push({ signal: 'editionRights' });
    if (fragment.kind === 'arrangement')
        scope = 'originalEdition';
    if (fragment.kind === 'containment')
        scope = 'container';
    if (fragment.kind === 'series')
        scope = 'series';
    if (fragment.kind === 'volume')
        scope = 'undetermined';
    const names = fragment.names;
    return {
        kind: fragment.kind, scope, page: line.page, role: line.role, seat: line.seat, reading: line.reading, rows: [...line.rows], raw: fragment.raw,
        ...(fragment.label ? { label: fragment.label } : {}), ...(names ? { names } : {}), ...(fragment.place ? { place: fragment.place } : {}),
        ...(fragment.years ? { years: fragment.years } : {}), ...(fragment.date ? { date: fragment.date } : {}), ...(fragment.edition ? { edition: fragment.edition } : {}),
        ...(fragment.number ? { number: fragment.number } : {}), ...(fragment.of !== undefined ? { of: fragment.of } : {}), ...(fragment.range ? { range: fragment.range } : {}),
        ...(fragment.parent ? { parent: fragment.parent } : {}),
        because
    } as Statement;
}
const PUBLISHER_ORDER: Array<(entry: Statement) => boolean> = [
    entry => entry.seat === 'coverImprint' && entry.because.some(reason => reason.signal === 'seat'),
    entry => entry.label !== 'published by' && entry.label !== 'is an imprint of' && entry.because.some(reason => reason.signal === 'label'),
    entry => entry.label === 'is an imprint of',
    entry => entry.label === 'published by'
];
function pickPublisherStatement(entries: Statement[]): Statement | undefined {
    const houses = entries.filter(entry => (entry.names || []).some(name => name.role === 'publisherHouse'));
    for (const test of PUBLISHER_ORDER) {
        const found = houses.find(test);
        if (found)
            return found;
    }
    return undefined;
}
function pickPublisher(entries: Statement[]): string {
    return pickPublisherStatement(entries.filter(entry => entry.scope === 'thisEdition'))?.names?.[0]?.text || '';
}
export function issuerLabelOf(statements: readonly Statement[]): Statement | undefined {
    return statements.find(entry => entry.scope === 'thisEdition' && entry.kind === 'publication' && entry.because.some(reason => reason.signal === 'label')
        && !!entry.names?.[0] && entry.names[0].shape !== 'person');
}
export function statedIssuerOf(statements: readonly Statement[]): Statement | undefined {
    const labelled = issuerLabelOf(statements);
    if (labelled)
        return labelled;
    const sponsors = statements.filter(entry => entry.kind === 'commissioning' && entry.names?.[0]?.role === 'sponsor').map(entry => entry.names![0].text);
    return statements.filter(entry => entry.scope === 'thisEdition' && entry.kind === 'publication' && !entry.label
        && (entry.seat === 'coverImprint' || entry.seat === 'colophon' || entry.seat === 'colophonPage') && entry.because.some(reason => reason.signal === 'seat')
        && !!entry.names?.[0] && entry.names[0].shape !== 'person' && entry.names[0].role !== 'degreeGranting'
        && !sponsors.some(name => sameName(name, entry.names![0].text)))
        .sort((a, b) => a.page - b.page || a.rows[0] - b.rows[0])[0];
}
export function leadBodyOf(statements: readonly Statement[]): Statement | undefined {
    const lead = statements.find(entry => entry.scope === 'thisEdition' && entry.kind === 'commissioning' && entry.names?.[0]?.role === 'leadBody');
    const name = lead?.names?.[0]?.text || '';
    if (!lead || !compact(name))
        return undefined;
    const issuer = statedIssuerOf(statements);
    return issuer && !sameName(issuer.names![0].text, name) ? undefined : lead;
}
function pickIssuer(statements: Statement[]): Statement | undefined {
    const lead = leadBodyOf(statements);
    if (lead)
        return lead;
    if (statements.some(entry => entry.scope === 'thisEdition' && entry.kind === 'commissioning' && entry.names?.[0]?.role === 'leadBody')) {
        const issuer = statedIssuerOf(statements);
        if (issuer)
            return issuer;
    }
    const named = (entry: Statement) => (entry.names || [])[0];
    const order: Array<(entry: Statement) => boolean> = [
        entry => entry.kind === 'commissioning' && named(entry)?.role === 'commissioning',
        entry => entry.kind === 'publication' && entry.because.some(reason => reason.signal === 'label') && named(entry)?.shape !== 'person',
        entry => entry.kind === 'publication' && entry.seat === 'coverImprint' && entry.because.some(reason => reason.signal === 'seat'),
        entry => entry.kind === 'address' && !THE_AUTHORS.test(named(entry)?.text || ''),
        entry => entry.kind === 'publication' && entry.seat === 'coverHead' && entry.because.some(reason => reason.signal === 'seat' && reason.detail === 'coverHead'),
        entry => entry.kind === 'responsibility' && named(entry)?.role === 'publisherPerson' && named(entry)?.shape === 'organisation',
        entry => entry.kind === 'rights' && entry.because.some(reason => reason.signal === 'corroborated') && !THE_AUTHORS.test(named(entry)?.text || '')
    ];
    for (const test of order) {
        const found = statements.find(entry => entry.scope === 'thisEdition' && test(entry));
        if (found)
            return found;
    }
    return undefined;
}
interface PrintingOfStatements {
    chosen: PrintingStatement;
    others: PrintingStatement[];
    statement: Statement;
}
function printingOf(statements: Statement[]): PrintingOfStatements | null {
    const dated = statements.filter(entry => entry.scope === 'thisEdition' && entry.kind === 'date' && entry.label)
        .sort((a, b) => a.page - b.page || a.rows[0] - b.rows[0]);
    if (dated.length < 2)
        return null;
    const found = firstPrintingIn(dated.map(entry => oneLine(entry.raw)).join('\n'));
    if (!found)
        return null;
    const held = dated[found.chosen.row];
    if (!held)
        return null;
    const year = found.chosen.date.value.slice(0, 4);
    const statement: Statement = held.date?.value === found.chosen.date.value ? held
        : { ...held, raw: found.chosen.raw, years: [year], date: { ...found.chosen.date } };
    return { chosen: found.chosen, others: found.others, statement };
}
function pickDate(statements: Statement[], opening: number | null, printing: PrintingOfStatements | null = null): Statement | undefined {
    const own = statements.filter(entry => entry.scope === 'thisEdition');
    if (printing)
        return printing.statement;
    const labelled = own.filter(entry => entry.kind === 'date' && entry.label).sort((a, b) => String(a.years?.[0]).localeCompare(String(b.years?.[0])))[0];
    if (labelled)
        return labelled;
    const translationRights = own.find(entry => entry.kind === 'rights' && entry.because.some(reason => reason.signal === 'translationRights') && entry.years?.length);
    if (translationRights)
        return translationRights;
    const edition = own.find(entry => entry.kind === 'edition' && entry.because.some(reason => reason.signal === 'editionSequence') && entry.years?.length);
    if (edition)
        return edition;
    const rows = own.filter(entry => entry.kind === 'date' && !entry.label).sort((a, b) => Number(b.page === opening) - Number(a.page === opening) || a.page - b.page || a.rows[0] - b.rows[0]);
    if (rows.length)
        return rows[0];
    const first = own.find(entry => entry.because.some(reason => reason.signal === 'firstPublished') && entry.years?.length);
    if (first)
        return first;
    return own.filter(entry => entry.kind === 'rights' && entry.years?.length).pop();
}
function originalBlocks(s: PageStructure, seated: SeatedRow[], persons: StatedName[], thisHouse: string): Statement[] {
    const out: Statement[] = [];
    const pages = [...new Set(seated.filter(entry => entry.seat === 'colophonPage' || entry.seat === 'colophon').map(entry => `${entry.page}\u0000${entry.reading}`))];
    for (const key of pages) {
        const [pageText, reading] = key.split('\u0000');
        const page = Number(pageText);
        const rows = seated.filter(entry => entry.page === page && entry.reading === reading);
        const usable = rows.filter(entry => (entry.seat === 'colophonPage' || entry.seat === 'colophon') && entry.row.marked);
        if (usable.length < 3)
            continue;
        const texts = usable.map(entry => oneLine(entry.row.text));
        const script = bodyScript(s, page);
        for (let at = 1; at < texts.length; at++) {
            const house = texts[at];
            if (house.length > 80 || /[가-힣\p{Script=Han}]/u.test(house) || !/^\p{Lu}/u.test(house) || /(?<![\p{L}])by(?![\p{L}])/iu.test(house) || IMPRINT_MARKS.rights.test(house)
                || !isPublishingHouse(house))
                continue;
            const personText = texts[at - 1].replace(/^by\s+/i, '').trim();
            if (usable[at - 1].row.row === rows.find(entry => entry.row.text.trim())?.row.row)
                continue;
            if (!latinPerson(personText) || isPublishingHouse(personText) || isOrganisationName(personText) || isOrganisationOnly(personText))
                continue;
            const blockScript = scriptOf(`${personText} ${house}`);
            if (!script || blockScript === script || blockScript === 'mixed')
                continue;
            const edition = (value: string) => TRANSLATION_RIGHTS.inLine.test(value) || (!!thisHouse && (sameName(thisHouse, value) || romanisedHouse(thisHouse, value)));
            const years = new Set<string>();
            const shown = [house];
            for (let next = at; next < Math.min(texts.length, at + 4); next++) {
                if (next > at && edition(texts[next]))
                    break;
                const printed = yearsIn(texts[next]);
                for (const year of printed)
                    years.add(year);
                if (next > at && printed.length && shown.length < 2)
                    shown.push(texts[next]);
            }
            const parts = house.split(/\s*,\s*/);
            const place = parts.length >= 2 && /^\p{Lu}\p{Ll}+$/u.test(parts[parts.length - 1]) ? parts[parts.length - 1] : undefined;
            const houseName = place ? parts.slice(0, -1).join(', ') : house;
            const personKnown = persons.length > 0, houseKnown = !!thisHouse;
            const otherPerson = personKnown && !persons.some(held => samePerson(held.text, personText));
            const otherHouse = houseKnown && !sameName(thisHouse, house) && !romanisedHouse(thisHouse, house);
            if ((personKnown && !otherPerson) || (houseKnown && !otherHouse))
                continue;
            const decided = personKnown && houseKnown;
            out.push({
                kind: 'originalEdition', scope: decided ? 'originalEdition' : 'undetermined', page, role: rows[0]?.role || '', seat: usable[at].seat as Seat, reading: reading as 'layer' | 'ocr',
                rows: [usable[at - 1].row.row, usable[Math.min(usable.length - 1, at + 1)].row.row], raw: [personText, ...shown].join(' / ').slice(0, 90), label: 'original block',
                names: [statedName(personText, 'author'), statedName(houseName, 'publisherHouse')], ...(place ? { place } : {}), years: [...years],
                because: [{ signal: 'seat' }, ...(otherPerson ? [{ signal: 'otherPersons' as const, detail: personText }] : []), ...(otherHouse ? [{ signal: 'otherPublisher' as const, detail: houseName }] : []),
                    { signal: 'scriptDiffers', detail: `${blockScript}≠${script}` }]
            });
        }
    }
    const authors = new Set(out.map(entry => compact(entry.names?.[0]?.text || '')));
    return authors.size === 1 ? out.slice(0, 1) : [];
}
function attributeVolumes(s: PageStructure, seated: SeatedRow[], statements: Statement[]): {
    volume: Statement | null;
    series: Statement[];
    refused: Refusal[];
} {
    const refused: Refusal[] = [];
    const series: Statement[] = statements.filter(entry => entry.kind === 'series');
    let volume: Statement | null = null;
    for (const statement of statements.filter(entry => entry.kind === 'volume')) {
        const rows = seated.filter(entry => entry.page === statement.page && entry.reading === statement.reading);
        const claim = rows.filter(entry => entry.row.claim).map(entry => oneLine(entry.row.text)).join(' ');
        const at = rows.findIndex(entry => entry.row.row === statement.rows[0]);
        const before = oneLine(statement.of || '');
        const raw = statement.raw;
        const designator = volumeDesignator(raw);
        if (designator?.issue) {
            statement.scope = 'otherWork';
            statement.because.push({ signal: 'withIssue' });
            continue;
        }
        const refuse = (why: string) => { statement.scope = 'undetermined'; refused.push({ page: statement.page, where: statement.seat, kind: 'volume', raw: raw.slice(0, 80), why }); };
        if (!claim) {
            refuse('no title claim on the page');
            continue;
        }
        if (!['titleBlock', 'nearTitle', 'coverHead', 'colophon'].includes(statement.seat)) {
            refuse(`outside a title seat (${statement.seat})`);
            continue;
        }
        const claimKey = compact(claim);
        const beforeKey = compact(before);
        if (beforeKey.length >= 2) {
            if (claimKey.includes(beforeKey) && claimKey.startsWith(beforeKey)) {
                statement.scope = 'thisWork';
                statement.because.push({ signal: 'besideTitle', detail: before });
            }
            else if (claimKey.startsWith(beforeKey) || compact(claim.split(' ')[0] || '') === beforeKey) {
                statement.scope = 'thisWork';
                statement.because.push({ signal: 'besideTitle', detail: before });
            }
            else {
                statement.kind = 'series';
                statement.scope = 'series';
                statement.because.push({ signal: 'afterName', detail: before });
                series.push(statement);
                continue;
            }
        }
        else if (designator?.script === 'latin') {
            refuse('a Latin designator with no name beside it');
            continue;
        }
        else {
            const above = at > 0 ? rows.slice(0, at).filter(entry => entry.row.text.trim()).pop() : undefined;
            const aboveClaim = !!above?.row.claim;
            const insideTitle = statement.seat === 'titleBlock' || statement.seat === 'nearTitle';
            const claimLast = rows.reduce((last, entry) => entry.row.claim ? Math.max(last, entry.row.row) : last, -1);
            const bylineFirst = rows.find(entry => entry.row.byline)?.row.row ?? Infinity;
            const betweenTitleAndByline = claimLast >= 0 && statement.rows[0] > claimLast && statement.rows[0] < bylineFirst;
            const titleShaped = (entry: SeatedRow) => {
                const text = oneLine(entry.row.text);
                return text.length <= 120 && /\p{L}{2}/u.test(text) && !entry.row.byline && !personShaped(text) && !organisationShaped(text) && !isPublishingHouse(text)
                    && !dateRowOf(text) && !imprintMark(text) && !fragmentsOf(text).length;
            };
            const firstFilled = rows.find(entry => entry.row.text.trim());
            const onlyTitleAbove = !!above && above === firstFilled && !above.row.claim && titleOrder(s, statement.page) === 0
                && (statement.seat === 'titleBlock' || statement.seat === 'nearTitle' || statement.seat === 'coverHead')
                && titleShaped(above) && !rows.slice(at + 1).some(entry => entry.row.text.trim() && titleShaped(entry));
            if (insideTitle && (aboveClaim || betweenTitleAndByline)) {
                statement.scope = 'thisWork';
                statement.because.push({ signal: 'besideTitle', detail: above ? oneLine(above.row.text).slice(0, 40) : '' });
            }
            else if (onlyTitleAbove) {
                statement.scope = 'thisWork';
                statement.because.push({ signal: 'besideTitle', detail: `the only title on the page: ${oneLine(above!.row.text).slice(0, 40)}` });
            }
            else if (above && !above.row.claim && /\p{L}{2}/u.test(above.row.text)) {
                statement.kind = 'series';
                statement.scope = 'series';
                statement.of = oneLine(above.row.text);
                statement.because.push({ signal: 'afterName', detail: oneLine(above.row.text) });
                series.push(statement);
                continue;
            }
            else if (!above && insideTitle && rows.slice(at + 1).find(entry => entry.row.text.trim())?.row.claim) {
                statement.scope = 'thisWork';
                statement.because.push({ signal: 'besideTitle', detail: 'above the title' });
            }
            else {
                refuse('no name beside the designator');
                continue;
            }
        }
        if (statement.scope === 'thisWork' && !volume)
            volume = statement;
    }
    return { volume, series: [...new Set(series)], refused };
}
function containmentOf(s: PageStructure, statements: Statement[]): FrontStatements['containment'] {
    const found = statements.filter(entry => entry.kind === 'containment' && (entry.seat === 'selfCitation' || entry.page === s.opening.page || entry.seat === 'colophon'));
    if (!found.length)
        return null;
    const title = found.find(entry => entry.of)?.of;
    const editors = [...new Set(found.flatMap(entry => (entry.names || []).filter(name => name.role === 'editor').map(name => name.text)))];
    const range = found.find(entry => entry.range)?.range;
    return { ...(title ? { title } : {}), editors, ...(range ? { range } : {}), statements: found };
}
function ownRangeOf(s: PageStructure): FrontStatements['ownRange'] {
    const run = s.folioRun;
    if (!run)
        return null;
    const unfoliated = s.pages.filter(entry => entry.page < run.first || entry.page > run.last).length;
    return { first: run.first + run.offset, last: run.last + run.offset, unfoliated };
}
export function statedAs(st: FrontStatements, name: string, options: {
    explicit?: boolean;
} = {}): Set<StatedRole | 'originalPublisher' | 'seriesName'> {
    const out = new Set<StatedRole | 'originalPublisher' | 'seriesName'>();
    if (!compact(name))
        return out;
    for (const statement of st.statements) {
        if (options.explicit && !statement.because.some(reason => reason.signal === 'label' || reason.signal === 'grammar'))
            continue;
        for (const stated of statement.names || []) {
            if (!sameName(stated.text, name))
                continue;
            if (statement.scope === 'originalEdition' && stated.role === 'publisherHouse')
                out.add('originalPublisher');
            else if (stated.role)
                out.add(stated.role);
        }
        if (statement.kind === 'series' && statement.of && sameName(statement.of, name))
            out.add('seriesName');
    }
    return out;
}
export const INSTITUTION_STATED_ROLES: readonly StatedRole[] = ['issuer', 'commissioning', 'leadBody', 'degreeGranting', 'publisherHouse'];
export function statedOnlyAsSponsor(st: FrontStatements, name: string): boolean {
    const roles = statedAs(st, name);
    return roles.has('sponsor') && !roles.has('rightsHolder') && !INSTITUTION_STATED_ROLES.some(role => roles.has(role));
}
export function statesContainment(st: FrontStatements, title?: unknown): boolean {
    const wanted = compact(title);
    if (st.containment) {
        const named = compact(st.containment.title);
        if (!wanted || !named)
            return true;
        return named.includes(wanted) || (named.length >= 8 && wanted.includes(named));
    }
    return !!st.partHeading && !!st.ownRange && st.ownRange.first > 1;
}
export interface JudgedReading {
    title?: string;
    publisher?: string;
    persons?: string[];
}
function resolvedBlocks(st: FrontStatements, reading?: JudgedReading): Statement[] {
    const decided = st.statements.filter(entry => entry.label === 'original block' && entry.scope === 'originalEdition');
    if (decided.length || !reading)
        return decided;
    const house = oneLine(reading.publisher || '');
    const people = (reading.persons || []).map(oneLine).filter(Boolean);
    if (!/[가-힣]/.test(String(reading.title ?? '')) || !/^[가-힣]{2,}/.test(house.replace(/\s+/g, '')))
        return [];
    return st.statements.filter(entry => entry.label === 'original block' && entry.scope === 'undetermined').filter(entry => {
        const person = entry.names?.[0]?.text || '', publisher = entry.names?.[1]?.text || '';
        if (people.some(name => samePerson(name, person)))
            return false;
        return !sameName(house, publisher) && !romanisedHouse(house, publisher) && !romanisedHouse(house, entry.raw);
    });
}
export function isTranslatedBook(st: FrontStatements, reading?: JudgedReading): boolean {
    return !!st.translation || resolvedBlocks(st, reading).length > 0;
}
export function originalAuthorOf(st: FrontStatements, reading?: JudgedReading): string {
    if (!isTranslatedBook(st, reading))
        return '';
    if (st.original?.author?.text)
        return st.original.author.text;
    const blocked = resolvedBlocks(st, reading)[0]?.names?.find(name => name.role === 'author')?.text || '';
    if (blocked)
        return blocked;
    const translators = new Set((st.translation?.names || []).map(name => name.text.replace(/\s+/g, '')));
    for (const entry of st.statements) {
        if (entry.kind !== 'responsibility' || !LEADING_ROLE_ROW.test(entry.raw))
            continue;
        const author = (entry.names || []).find(name => name.role === 'author' && !translators.has(name.text.replace(/\s+/g, '')));
        if (author)
            return author.text;
    }
    return '';
}
export function yearsOfEditions(st: FrontStatements, reading?: JudgedReading): {
    original: Set<string>;
    edition: string;
    originalSaid: string;
    editionSaid: string;
} | null {
    const blocks = resolvedBlocks(st, reading);
    const translated = !!st.translation || blocks.length > 0;
    if (!translated)
        return null;
    const original = new Set<string>();
    let originalSaid = '';
    const originals = [...st.statements.filter(entry => entry.scope === 'originalEdition' && entry.label !== 'original block' && entry.kind !== 'arrangement'), ...blocks];
    for (const entry of originals.sort((a, b) => a.page - b.page || a.rows[0] - b.rows[0])) {
        const years = entry.kind === 'rights' ? yearsIn(entry.raw.split(/\bby\b/i)[0]) : entry.years || [];
        if (!years.length)
            continue;
        for (const year of years)
            original.add(year);
        if (!originalSaid)
            originalSaid = entry.label === 'original block' ? entry.raw : entry.raw.replace(/\s+/g, ' ').slice(0, 90);
    }
    const rights = st.statements.find(entry => entry.kind === 'rights' && entry.because.some(reason => reason.signal === 'translationRights') && entry.years?.length)
        || st.statements.find(entry => entry.kind === 'rights' && entry.because.some(reason => reason.signal === 'editionRights') && entry.years?.length);
    let edition = '', editionSaid = '';
    if (rights) {
        edition = rights.years![0];
        editionSaid = rights.raw.slice(0, rights.raw.indexOf(edition) + 4).replace(/\s+/g, ' ').trim();
    }
    else {
        const colophon = st.statements.filter(entry => entry.kind === 'date' && entry.years?.length && !original.has(entry.years[0])).map(entry => entry.years![0]).sort()[0];
        if (colophon) {
            edition = colophon;
            editionSaid = `${colophon}년 … 발행`;
        }
    }
    return { original, edition, originalSaid, editionSaid };
}
export function attributionOf(st: FrontStatements, field: 'publisher' | 'institution' | 'place' | 'date' | 'volume' | 'creators', value: string, reading?: JudgedReading): {
    scope: Scope;
    statement: Statement;
} | null {
    const wanted = oneLine(value);
    if (!wanted)
        return null;
    if (field === 'date') {
        const year = /^(?:1[4-9]|20)\d{2}/.exec(wanted)?.[0];
        if (!year)
            return null;
        const years = yearsOfEditions(st, reading);
        if (years && years.original.has(year) && years.edition !== year) {
            const statement = [...st.statements.filter(entry => entry.scope === 'originalEdition'), ...resolvedBlocks(st, reading)].find(entry => (entry.years || []).includes(year));
            if (statement)
                return { scope: 'originalEdition', statement };
        }
        const own = st.thisEdition.date;
        return own && (own.years || []).includes(year) ? { scope: 'thisEdition', statement: own } : null;
    }
    if (field === 'volume') {
        if (st.volume && st.volume.number === wanted.replace(/\D/g, ''))
            return { scope: 'thisWork', statement: st.volume };
        const series = st.series.find(entry => entry.number === wanted.replace(/\D/g, ''));
        return series ? { scope: 'series', statement: series } : null;
    }
    for (const statement of st.statements) {
        for (const name of statement.names || []) {
            if (!sameName(name.text, wanted))
                continue;
            if (statement.kind === 'arrangement')
                return { scope: 'originalEdition', statement };
            if (statement.scope === 'originalEdition' || statement.scope === 'series' || statement.scope === 'otherWork' || statement.scope === 'container')
                return { scope: statement.scope, statement };
        }
    }
    return null;
}
export interface AgentMentionOfStatements {
    name: string;
    role: string;
    method: string;
    raw?: string;
    page?: number;
}
export function agentMentionsOf(st: FrontStatements): AgentMentionOfStatements[] {
    const out: AgentMentionOfStatements[] = [];
    const lead = leadBodyOf(st.statements);
    if (!lead && st.statements.some(entry => entry.scope === 'thisEdition' && entry.kind === 'commissioning' && entry.names?.[0]?.role === 'leadBody')) {
        const issuer = statedIssuerOf(st.statements);
        const named = issuer?.names?.[0];
        if (issuer && named)
            out.push({ name: named.text, role: 'issuingBody', method: 'statedIssuer', raw: issuer.raw.slice(0, 120), page: issuer.page });
    }
    const statementOfResponsibility = st.statements.find(entry => entry.kind === 'responsibility' && entry.scope === 'thisEdition' && entry.label === 'edited by'
        || (entry.kind === 'responsibility' && entry.scope === 'thisEdition' && /^(?:edited\s*by|editors?|eds?\.?|엮은이|편자|편저자?|엮음|편저)$/i.test(entry.label || '')));
    for (const statement of st.statements) {
        if (statement.scope !== 'thisEdition')
            continue;
        const name = statement.names?.[0];
        if (!name)
            continue;
        const raw = statement.raw.slice(0, 120);
        if (statement.kind === 'rights')
            out.push({ name: name.text, role: 'copyrightHolder', method: 'copyrightLine', raw, page: statement.page });
        else if (statement.kind === 'publication') {
            if (name.role === 'degreeGranting') {
                out.push({ name: name.text.slice(0, 80), role: 'degreeGranting', method: 'coverLayout', raw: raw.slice(0, 60), page: statement.page });
                continue;
            }
            const seatOnly = (statement.seat === 'coverImprint' || statement.seat === 'coverHead') && statement.because.some(reason => reason.signal === 'seat') && !statement.label;
            if (seatOnly) {
                out.push({ name: name.text, role: name.role === 'publisherHouse' ? 'publisher' : 'issuingBody', method: name.role === 'publisherHouse' ? 'titlePageImprint' : 'coverLayout', raw, page: statement.page });
                continue;
            }
            const label = String(statement.label || '');
            if (label === 'is an imprint of') {
                out.push({ name: name.text, role: 'publisher', method: 'imprintStatement', raw, page: statement.page });
                if (statement.parent)
                    out.push({ name: statement.parent, role: 'imprintParent', method: 'imprintStatement', page: statement.page });
            }
            else if (label === 'published by' || /^(?:발행처|펴낸곳|발간처|펴냄)$/.test(label.replace(/\s+/g, ''))) {
                out.push({ name: name.text, role: 'issuingBody', method: 'roleLabel', raw, page: statement.page });
                out.push({ name: name.text, role: 'publisher', method: 'publishedBy', raw, page: statement.page });
            }
            else
                out.push({ name: name.text, role: name.role === 'issuer' ? 'issuingBody' : 'publisher', method: 'roleLabel', raw, page: statement.page });
        }
        else if (statement.kind === 'commissioning' && name.role === 'leadBody') {
            out.push(statement === lead ? { name: name.text, role: 'leadBody', method: 'leadBodyLabel', raw, page: statement.page }
                : { name: name.text, role: 'contractor', method: 'leadBodyLabel', raw, page: statement.page });
        }
        else if (statement.kind === 'commissioning' && name.role === 'sponsor')
            continue;
        else if (statement.kind === 'commissioning')
            out.push({ name: name.text, role: name.role === 'contractor' ? 'contractor' : 'commissioningBody', method: name.role === 'contractor' ? 'contractorLabel' : 'commissioningBody', raw, page: statement.page });
        else if (statement.kind === 'address' && !THE_AUTHORS.test(name.text))
            out.push({ name: name.text, role: 'issuingBody', method: 'addressBlock', raw, page: statement.page });
    }
    if (statementOfResponsibility)
        for (const editor of (statementOfResponsibility.names || []).filter(name => name.role === 'editor').slice(0, 6)) {
            out.push({ name: editor.text, role: 'editor', method: 'statementOfResponsibility', raw: statementOfResponsibility.raw.slice(0, 100), page: statementOfResponsibility.page });
        }
    return out;
}

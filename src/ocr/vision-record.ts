import type { MetadataSnapshot } from '../types';
import { degreeStatedIn } from '../recognition/degree';
import { validISSN as validISSNOf } from '../metadata/identifier-compare';
import { buildCandidate, type PageObservation } from '../recognition/candidate';
import { citationRegions, isReferenceListHeading, titleSupportedByPDF } from '../recognition/pdf-identifiers';
import { anotherWorkTitled, otherWorksSpansIn, structureFromPageObservations } from '../recognition/page-structure';
import { parallelOf, parallelRestatement, titleBlocksOf } from '../recognition/title-block';
import { titleEnding } from '../recognition/title-grammar';
import { isNotATitle, isOrganisationName, isOrganisationOnly, isPersonalName, isSerialName, journalOfIssueStatement, monthNamedIssue, peopleRow, serialNameShaped } from '../recognition/title-guards';
import { editionIn, snapshotFrom } from '../recognition/international-catalog';
import { storableType } from '../recognition/item-fields';
import { isValidISBN } from '../recognition/web-metadata';
import { universityName } from '../recognition/agents';
import { canonicalDate, feeCodeISSN, folioCandidates, journalHeadStatement, opensWithVolume, parseDateValue } from '../recognition/roles';
import { wordAlternation } from '../recognition/label-words';
import { fieldIsShortened, peopleOfField, personShape, publishersOfField } from '../recognition/byline-row';
import { withoutPublisherTail } from '../recognition/imprint-marks';
import { sameName } from '../metadata/name-equivalence';
import { shouting } from '../recognition/folded-letters';
import { personParts, scriptOfName } from '../metadata/person-name';
import { sanitizeCreators } from '../batch/evaluate';
import { guessesOfAReading, namesADocumentKind } from '../batch/field-contract';
import { containerSlot, mergeSources, personKey, type MergeSource } from '../batch/source-merge';
function dominantScript(value: string): 'ko' | 'en' | 'cjk' | null {
    const ko = (value.match(/[가-힣]/g) || []).length;
    const en = (value.match(/[A-Za-z]/g) || []).length;
    const cjk = (value.match(/[぀-ヿ㐀-鿿]/g) || []).length;
    const top = Math.max(ko, en, cjk);
    if (!top)
        return null;
    return top === ko ? 'ko' : top === en ? 'en' : 'cjk';
}
function scriptScore(value: string, script: 'ko' | 'en'): number {
    if (script === 'ko')
        return (value.match(/[가-힣]/g) || []).length;
    return (value.match(/[A-Za-z]/g) || []).length;
}
const compactText = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export function languageFitsTheScript(code: string, text: string): boolean {
    const sample = String(text ?? '');
    if (!/[\p{L}]/u.test(sample))
        return true;
    if (/^ko\b/i.test(code))
        return /[가-힣]/.test(sample);
    if (/^ja\b/i.test(code))
        return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(sample);
    if (/^zh\b/i.test(code))
        return /\p{Script=Han}/u.test(sample);
    return true;
}
function wholeTitle(part: string): boolean {
    const script = dominantScript(part);
    if (script === 'ko')
        return scriptScore(part, 'ko') >= 4;
    if (script === 'en')
        return part.split(/\s+/).filter(word => /[A-Za-z]/.test(word)).length >= 3 || scriptScore(part, 'en') >= 12;
    if (script === 'cjk')
        return (part.match(/[぀-ヿ㐀-鿿]/g) || []).length >= 4;
    return false;
}
function bilingualParts(title: string): string[] {
    const pieces: string[] = [];
    for (const piece of title.split(/\s*\n\s*|\s+[\/｜|]\s+|\s*[｜|]\s*/)) {
        const trailing = /^(.*\S)\s*[（(]([^（）()]+)[）)]\s*$/.exec(piece.trim());
        if (trailing && dominantScript(trailing[1]) !== dominantScript(trailing[2])
            && wholeTitle(trailing[1]) && wholeTitle(trailing[2]))
            pieces.push(trailing[1].trim(), trailing[2].trim());
        else
            pieces.push(piece.trim());
    }
    const parts = pieces.filter(Boolean);
    if (parts.length < 2)
        return [];
    const scripts = new Set(parts.map(dominantScript).filter(Boolean));
    if (scripts.size < 2)
        return [];
    return parts.every(wholeTitle) ? parts : [];
}
function startsAPrintedLine(fragment: string, printed: string): boolean {
    const wanted = compactText(fragment);
    if (wanted.length < 4)
        return false;
    return printed.split(/\r?\n/).map(compactText)
        .some(line => line.length >= 4 && (line.startsWith(wanted) || wanted.startsWith(line)));
}
export function cleanVisionTitle(value: string, language: string, printed: string): string {
    let title = value.replace(/\r\n?/g, '\n').trim();
    title = title.replace(/^\s*(?:제목|title|article\s*title)\s*[:：]\s*/i, '');
    title = title.replace(/^\s*(?:발명의\s*명칭|고안의\s*명칭|発明の名称|考案の名称)\s*[:：]?\s*/, '');
    title = title.replace(/^\s*(?:\(\d{2}\)|\d+[.)](?!\d))\s*/, '');
    title = title.replace(/\s+(?=(?:부제|subtitle|저자|언어|유형|학위|출판|발행일|페이지|식별자)\s*[:：])/gi, '\n');
    const lines = title.split(/\n+/).map(line => line.trim()).filter(Boolean);
    if (lines.length > 1) {
        const candidates = lines.filter(line => !/^(?:부제|subtitle|저자|언어|유형|학위|출판|발행일|페이지|식별자)\s*[:：]/i.test(line));
        if (candidates.length)
            title = candidates.join('\n');
    }
    const script = /^ko\b/i.test(language) ? 'ko' : /^en\b/i.test(language) ? 'en' : null;
    if (script) {
        const parts = bilingualParts(title);
        if (parts.length > 1) {
            const ranked = parts.filter(part => titleSupportedByPDF(part, printed) || scriptScore(part, script) > 0)
                .sort((a, b) => scriptScore(b, script) - scriptScore(a, script));
            if (ranked[0])
                title = ranked[0];
        }
        if (script === 'ko' && /[가-힣]/.test(title)) {
            const lead = /^([^가-힣]*?[A-Za-z][^가-힣]*)(?=[가-힣])/.exec(title);
            const words = lead ? lead[1].trim().split(/\s+/).filter(word => /[A-Za-z]/.test(word)) : [];
            if (lead && words.length >= 3 && /[\s:：|/\-–—]$/.test(lead[1])) {
                const rest = title.slice(lead[1].length).trim();
                if (scriptScore(rest, 'ko') >= 4 && startsAPrintedLine(rest, printed))
                    title = rest;
            }
        }
    }
    return title.replace(/^\s*(?:제목|title)\s*[:：]\s*/i, '').replace(/\s+/g, ' ').trim();
}
const PAGE_LABEL = /^\s*(?:pp?\.?|pages?|쪽|면)\s*[:：]?\s*/i;
export function pagesAsWritten(value: unknown, statedIn: unknown = ''): string {
    const raw = String(value ?? '').trim();
    const labelled = PAGE_LABEL.test(raw) && /\p{L}/u.test(raw.replace(/\d+/g, ''));
    const bare = raw.replace(PAGE_LABEL, '').replace(/[\s]+/g, '')
        .replace(/[‐‑‒–—―~〜]/g, '-').replace(/[.,;]+$/, '');
    if (/^\d{1,6}-\d{1,6}$/.test(bare))
        return bare;
    if (!/^\d{1,7}$/.test(bare))
        return '';
    if (labelled)
        return bare;
    const citation = String(statedIn ?? '').normalize('NFKC');
    const number = String(Number(bare));
    const said = new RegExp(`(?<![\\d.\\-–—/])0*${number}(?![\\d\\-–—/])`).exec(citation);
    if (!said)
        return '';
    const after = citation.slice((said.index ?? 0) + said[0].length);
    return /^\s*\(\s*(?:1[5-9]|20)\d{2}\s*\)/.test(after) || /^(?:1[5-9]|20)\d{2}$/.test(number) ? '' : bare;
}
export function degreeAsWritten(value: unknown): string {
    return degreeStatedIn(value, true);
}
function validISSN(value: string): string {
    return validISSNOf(value);
}
export function containerParts(value: unknown): {
    name: string;
    volume?: string;
    issue?: string;
    pages?: string;
    year?: string;
    issn?: string;
} {
    const text = String(value ?? '').normalize('NFKC').trim();
    if (!text)
        return { name: '' };
    const volume = /(?:제\s*)?(\d{1,4})\s*[권巻卷]|\bvol(?:ume)?\.?\s*(\d{1,4})/i.exec(text);
    const issue = /(?:제\s*)?(\d{1,4})\s*[호号號]|\bno\.?\s*(\d{1,4})/i.exec(text);
    const issnMatch = /ISSN\s*[:：]?\s*(\d{4}\s*[-‐–]?\s*\d{3}[\dXx])/i.exec(text);
    let pages: string | undefined;
    for (const match of text.matchAll(/(\bpp?\.\s*|쪽\s*[:：]?\s*)?(\d{1,6})\s*[-–—~]\s*(\d{1,6})(?![\dXx])/gi)) {
        const at = match.index ?? 0;
        if (/ISSN\s*[:：]?\s*$/i.test(text.slice(Math.max(0, at - 8), at)))
            continue;
        const labelled = !!match[1];
        const yearMonth = /^(?:19|20)\d{2}$/.test(match[2]) && Number(match[3]) >= 1 && Number(match[3]) <= 12 && match[3].length <= 2;
        const issnShape = match[2].length === 4 && /^\d{3}[\dXx]$/.test(match[3]);
        if (!labelled && (yearMonth || issnShape || /^(?:19|20)\d{2}$/.test(match[2])))
            continue;
        pages = pagesAsWritten(`${match[2]}-${match[3]}`) || undefined;
        if (pages)
            break;
    }
    const year = /(19|20)\d{2}/.exec(text.replace(/ISSN\s*[:：]?\s*\d{4}\s*[-‐–]?\s*\d{3}[\dXx]/gi, ''));
    const stated = journalOfIssueStatement(text);
    const name = stated || text.split(/(?:제\s*\d|\bvol\.?\s*\d|\bno\.?\s*\d|,\s*(?:19|20)\d{2}|[,(（\s]*\bISSN\b)/i)[0]
        .replace(/[,\s]+$/, '').trim();
    return {
        name: name || text,
        volume: volume ? (volume[1] || volume[2]) : undefined,
        issue: issue ? (issue[1] || issue[2]) : undefined,
        pages,
        year: year ? year[0] : undefined,
        issn: issnMatch ? validISSN(issnMatch[1]) || undefined : undefined,
    };
}
function volumeAndIssue(value: unknown): {
    volume?: string;
    issue?: string;
    bare?: string;
    month?: {
        year: string;
        month: string;
        literal: string;
    };
} {
    const text = String(value ?? '').normalize('NFKC').trim();
    if (!text)
        return {};
    const out: {
        volume?: string;
        issue?: string;
        bare?: string;
        month?: {
            year: string;
            month: string;
            literal: string;
        };
    } = {};
    const volume = /(?:제|第)?\s*(\d{1,4})\s*[권巻卷]|\bvol(?:ume)?\.?\s*[:：]?\s*(\d{1,4})/i.exec(text);
    if (volume)
        out.volume = volume[1] || volume[2];
    const issue = /(?:제|第)?\s*(\d{1,4})\s*[호号號]|\b(?:no|number|issue|iss)\.?\s*[:：]?\s*(\d{1,4})/i.exec(text);
    if (issue)
        out.issue = issue[1] || issue[2];
    const bracketed = /^(\d{1,4})\s*\(\s*(\d{1,4})\s*\)$/.exec(text);
    if (bracketed && !out.volume) {
        out.volume = bracketed[1];
        if (!/^(?:1[4-9]|20)\d{2}$/.test(bracketed[2]))
            out.issue = bracketed[2];
    }
    const monthly = /((?:19|20)\d{2})\s*[年년]\s*(\d{1,2})\s*[月월]\s*[号號호]/.exec(text);
    if (monthly && Number(monthly[2]) >= 1 && Number(monthly[2]) <= 12) {
        out.month = { year: monthly[1], month: monthly[2].padStart(2, '0'), literal: monthly[0].replace(/\s+/g, '') };
    }
    if (/^\d{1,4}$/.test(text))
        out.bare = text;
    return out;
}
const ARXIV_ID = /\barXiv\s*[:：]?\s*(\d{4}\.\d{4,5}|[a-z][a-z-]*(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?(?![\d])/i;
const DOCUMENT_NUMBER = /^(?=[^\s]*\d)(?=[^\s]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9_./-]{3,39}$/;
const LOCATOR_TOKEN = /^(?:vol(?:ume)?|no|nr|rev|page|pp?|tel|fax|ext)\.?\d/i;
const NUMBER_LABEL = /^(?:[\p{L}.]+\s+){0,3}(?:number|no\.?|nr\.?|id|code|번호)\s*[:：#]?\s*/iu;
function documentNumberIn(text: string, spans: string[]): string {
    let rest = text;
    for (const span of spans)
        if (span)
            rest = rest.split(span).join(' ');
    rest = rest.replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ').replace(/\b(?:e-?|p-?)?(?:isbn|issn)(?:[-\s]?1[03])?\s*[:：]?\s*[\dXx][\dXx\s‐‑–-]*/gi, ' ')
        .replace(/\b(?:doi|isbn(?:-1[03])?|issn|e-?issn|p-?issn|arxiv)\s*[:：]?/gi, ' ')
        .replace(/[|｜;；,，]/g, ' ').trim().replace(NUMBER_LABEL, '').trim();
    if (!rest || /\s/.test(rest) || !DOCUMENT_NUMBER.test(rest) || LOCATOR_TOKEN.test(rest))
        return '';
    if (/@/.test(rest) || /^(?:[a-z0-9-]+\.)+[a-z]{2,6}$/i.test(rest) || canonicalDate(rest))
        return '';
    return rest;
}
export function identifiersIn(value: unknown): {
    DOI?: string;
    ISBN?: string;
    ISSN?: string;
    arXiv?: string;
    number?: string;
} {
    const text = String(value ?? '').normalize('NFKC');
    const out: {
        DOI?: string;
        ISBN?: string;
        ISSN?: string;
        arXiv?: string;
        number?: string;
    } = {};
    const spans: string[] = [];
    const arXiv = ARXIV_ID.exec(text);
    if (arXiv) {
        out.arXiv = arXiv[1];
        spans.push(arXiv[0]);
    }
    const doi = /10\.\d{4,9}\/[^\s<>]+/i.exec(text);
    if (doi) {
        out.DOI = doi[0].replace(/[.,;]+$/, '');
        spans.push(doi[0]);
    }
    const readISBN = (window: string): {
        value: string;
        raw: string;
    } | null => {
        const token = /^[\dXx][\dXx-]{8,16}[\dXx](?![\dXx-])/.exec(window);
        if (token && isValidISBN(token[0]))
            return { value: token[0].replace(/-+$/, ''), raw: token[0] };
        const spaced = /^(?:97[89][-\s]?)?(?:\d[-\s]?){9}[\dXx](?![\dXx])/.exec(window);
        if (spaced) {
            const digits = isValidISBN(spaced[0]);
            if (digits)
                return { value: /\s/.test(spaced[0]) ? digits : spaced[0], raw: spaced[0] };
        }
        return null;
    };
    for (const label of text.matchAll(/ISBN(?:[-\s]?1[03])?\s*[:：]?\s*/gi)) {
        const found = readISBN(text.slice((label.index ?? 0) + label[0].length));
        if (found) {
            out.ISBN = found.value;
            spans.push(found.raw);
            break;
        }
    }
    if (!out.ISBN) {
        for (const bare of text.matchAll(/(?<![\dXx-])97[89][-\s]?(?:\d[-\s]?){9}\d(?![\dXx])/g)) {
            const found = readISBN(bare[0]);
            if (found) {
                out.ISBN = found.value;
                spans.push(found.raw);
                break;
            }
        }
    }
    if (!out.ISBN) {
        for (const bare of text.matchAll(/(?<![\dXx-])\d{1,5}-\d{1,7}-\d{1,7}-[\dXx](?![\dXx-])/g)) {
            if (bare[0].replace(/-/g, '').length !== 10 || !isValidISBN(bare[0]))
                continue;
            out.ISBN = bare[0];
            spans.push(bare[0]);
            break;
        }
    }
    const issn = /ISSN\s*[:：]?\s*(\d{4}\s*[-‐–]?\s*\d{3}[\dXx])/i.exec(text);
    if (issn) {
        spans.push(issn[0]);
        const valid = validISSN(issn[1]);
        if (valid)
            out.ISSN = valid;
    }
    if (!out.ISSN) {
        const feeLine = text.split(/\r?\n/).find(line => feeCodeISSN(line));
        if (feeLine) {
            out.ISSN = feeCodeISSN(feeLine) as string;
            spans.push(feeLine);
        }
    }
    const number = documentNumberIn(text, spans);
    if (number)
        out.number = number;
    return out;
}
type CreatorRole = 'author' | 'editor' | 'translator' | 'contributor';
const KOREAN_TITLE = new RegExp(`^(?:${wordAlternation(['position'], 'tail', { script: ['ko'] })}|위원장)$`, 'u');
const HANGUL = /[가-힣]/;
const HAN_OR_KANA = /[぀-ヿ㐀-鿿々]/u;
const LATIN = /[A-Za-zÀ-ɏ]/;
interface Name {
    text: string;
}
interface Person {
    hangul?: Name;
    han?: Name;
    latin?: Name;
    role?: CreatorRole;
    organisation?: string;
}
function pairedScripts(people: Person[]): Person[] {
    const kind = (person: Person) => person.organisation ? 'other'
        : (person.hangul || person.han) && !person.latin ? 'native' : person.latin && !person.hangul && !person.han ? 'latin' : 'other';
    const kinds = people.map(kind);
    if (kinds.includes('other') || people.length < 2 || people.length % 2)
        return people;
    const half = people.length / 2;
    const merge = (native: Person, latin: Person): Person => ({ ...native, latin: latin.latin, role: native.role || latin.role });
    const fits = (native: Person, latin: Person) => !!latin.latin && sameName((native.hangul || native.han)?.text || '', latin.latin.text, 'bylineMerge', { positional: true });
    const runs = (first: string) => kinds.slice(0, half).every(k => k === first) && kinds.slice(half).every(k => k !== first);
    if (runs('native') || runs('latin')) {
        const natives = kinds[0] === 'native' ? people.slice(0, half) : people.slice(half);
        const latins = kinds[0] === 'native' ? people.slice(half) : people.slice(0, half);
        if (natives.every((person, index) => fits(person, latins[index])))
            return natives.map((person, index) => merge(person, latins[index]));
        return people;
    }
    const alternating = kinds.every((k, index) => index % 2 ? k !== kinds[0] : k === kinds[0]);
    if (alternating) {
        const pairs: Person[] = [];
        for (let index = 0; index < people.length; index += 2) {
            const [a, b] = [people[index], people[index + 1]];
            const [native, latin] = kinds[index] === 'native' ? [a, b] : [b, a];
            if (!fits(native, latin))
                return people;
            pairs.push(merge(native, latin));
        }
        return pairs;
    }
    return people;
}
function peopleOf(value: unknown): Person[] {
    const people: Person[] = [];
    for (const entry of peopleOfField(value)) {
        if (entry.organisation) {
            people.push({ organisation: entry.text, ...(entry.role ? { role: entry.role } : {}) });
            continue;
        }
        const person: Person = entry.role ? { role: entry.role } : {};
        const place = (form: string) => {
            const clean = String(form ?? '').replace(/^[\s,;]+|[\s,;]+$/g, '').trim();
            if (!clean)
                return;
            if (HANGUL.test(clean) && !LATIN.test(clean)) {
                if (!person.hangul)
                    person.hangul = { text: clean };
            }
            else if (HAN_OR_KANA.test(clean) && !LATIN.test(clean)) {
                if (!person.han)
                    person.han = { text: clean };
            }
            else if (LATIN.test(clean) && !person.latin)
                person.latin = { text: clean };
        };
        place(entry.text);
        for (const alternate of entry.alternates)
            place(alternate);
        if (person.hangul || person.han || person.latin)
            people.push(person);
    }
    return pairedScripts(people);
}
function creatorOf(person: Person, language: string): {
    firstName?: string;
    lastName: string;
    creatorType: string;
} | null {
    const creatorType = person.role || 'author';
    if (person.organisation)
        return { lastName: person.organisation, creatorType };
    const lang = language.slice(0, 2);
    const order: Array<'hangul' | 'han' | 'latin'> = lang === 'ko' ? ['hangul', 'latin', 'han']
        : lang === 'ja' || lang === 'zh' ? ['latin', 'han', 'hangul']
            : lang ? ['latin', 'hangul', 'han'] : ['hangul', 'latin', 'han'];
    const chosen = order.find(form => person[form]);
    const name = chosen ? person[chosen] : undefined;
    if (!chosen || !name)
        return null;
    const shaped = (text: string) => {
        const parts = personParts(text, { bodyLanguage: lang });
        if (!parts)
            return null;
        return parts.fieldMode === 1 ? { lastName: parts.lastName, creatorType } : { lastName: parts.lastName, firstName: parts.firstName, creatorType };
    };
    if (chosen === 'latin') {
        const text = name.text.replace(/([A-Z]\.)(?=[A-Z][a-zà-ɏ])/g, '$1 ').replace(/\s+/g, ' ').trim();
        if (text.split(' ').filter(Boolean).length < 2)
            return { lastName: text, creatorType };
        return shaped(text);
    }
    if (chosen === 'hangul') {
        const tokens = name.text.split(/\s+/).filter(token => token && !KOREAN_TITLE.test(token)
            && !(/[가-힣]{3,}/.test(token) && isOrganisationName(token)) && !/(?:대학교|대학원|학과|학부|연구소|연구원|센터|㈜)$/.test(token));
        if (!tokens.length)
            return null;
        return shaped(tokens.join(' '));
    }
    return shaped(name.text.split(/\s+/).filter(Boolean).join(' '));
}
export function creatorsFromVision(value: unknown, language: string, rolesStated?: boolean[]): Array<{
    firstName?: string;
    lastName: string;
    creatorType: string;
}> {
    const people = peopleOf(value);
    const persons = people.filter(person => !person.organisation);
    const out: Array<{
        firstName?: string;
        lastName: string;
        creatorType: string;
    }> = [];
    for (const person of persons.length ? persons : people) {
        const creator = creatorOf(person, language);
        if (!creator || !creator.lastName)
            continue;
        out.push(creator);
        rolesStated?.push(!!person.role);
    }
    return out;
}
const VISION_TYPES = ['journalArticle', 'book', 'bookSection', 'thesis', 'report', 'conferencePaper', 'patent'];
function numberSlot(type: string): string {
    return type === 'report' ? 'reportNumber' : type === 'standard' ? 'number' : '';
}
function withoutMarkSigns(named: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(named || {})) {
        let text = String(value ?? '');
        if (/[™℠®]/u.test(text)) {
            if (name === '출판')
                text = text.replace(/\s*[™℠®]\s+(?=\S)/gu, ', ');
            text = text.replace(/\s*[™℠®]/gu, '');
        }
        out[name] = text;
    }
    return out;
}
function withPublisherOfTheByline(answer: Record<string, string>): Record<string, string> {
    let named = answer;
    const stated = String(named['출판'] || '').trim();
    if (stated) {
        const bare = withoutPublisherTail(stated);
        if (bare)
            return bare === stated ? named : { ...named, 출판: bare };
        named = { ...named, 출판: '' };
    }
    if (/^(?:journalArticle|magazineArticle|newspaperArticle|conferencePaper)$/i.test(String(named['유형'] || '').trim()))
        return named;
    const house = named['저자'] ? publishersOfField(named['저자'])[0] : '';
    return house ? { ...named, 출판: house } : named;
}
function printedLines(text: unknown): string[] {
    return String(text ?? '').split(/\r?\n/).map(line => line.trim()).filter(line => line && !/^-{2,}\s*page\s+\d+\s*-{2,}$/i.test(line));
}
function titleStartIn(line: string, title: string): number {
    const head = compactText(title).slice(0, 12);
    if (head.length < 6)
        return -1;
    for (let at = 0; at < line.length; at++) {
        if (!/[\p{L}\p{N}]/u.test(line[at]) || (at > 0 && /[\p{L}\p{N}]/u.test(line[at - 1])))
            continue;
        const rest = compactText(line.slice(at));
        if (rest.startsWith(head) || (rest.length >= 6 && head.startsWith(rest)))
            return at;
    }
    return -1;
}
function siblingLabels(a: string[], b: string[]): boolean {
    if (a.length !== b.length)
        return false;
    let differ = -1;
    for (let index = 0; index < a.length; index++)
        if (a[index] !== b[index]) {
            if (differ >= 0)
                return false;
            differ = index;
        }
    if (differ < 0)
        return false;
    const [x, y] = [a[differ], b[differ]];
    let head = 0;
    while (head < Math.min(x.length, y.length) && x[head] === y[head])
        head++;
    let tail = 0;
    while (tail < Math.min(x.length, y.length) - head && x[x.length - 1 - tail] === y[y.length - 1 - tail])
        tail++;
    return head + tail >= 1 && x.length - head - tail <= 3 && y.length - head - tail <= 3;
}
function hangulParallels(stated: string, subtitle: string, pages: PageObservation[]): string[] {
    const hangul = (value: string) => !!value && dominantScript(value) === 'ko' && wholeTitle(value);
    const out: string[] = [];
    if (hangul(subtitle.trim()))
        out.push(subtitle.trim());
    for (const page of pages) {
        const lines = printedLines(page.text);
        lines.forEach((line, index) => {
            const at = titleStartIn(line, stated);
            if (at < 0)
                return;
            const before = line.slice(0, at).trim();
            const bracketed = /^(.*\S)\s*[{(\[（【〔]$/u.exec(before);
            if (bracketed && hangul(bracketed[1].trim())) {
                out.push(bracketed[1].trim());
                return;
            }
            if (!before || before.length > 24 || dominantScript(before) !== 'ko')
                return;
            const label = before.split(/\s+/);
            const order = [index - 1, index + 1, ...lines.map((_, other) => other)].filter(other => other >= 0 && other < lines.length && other !== index);
            for (const other of new Set(order)) {
                const tokens = lines[other].split(/\s+/);
                if (tokens.length <= label.length || !siblingLabels(label, tokens.slice(0, label.length)))
                    continue;
                const value = tokens.slice(label.length).join(' ');
                if (hangul(value)) {
                    out.push(value);
                    break;
                }
            }
        });
    }
    return [...new Set(out)];
}
function sameSlotParallels(stated: string, own: PageObservation[], others: PageObservation[]): string[] {
    const key = compactText(stated);
    if (key.length < 3 || !others.length)
        return [];
    const below = new Set<string>();
    for (const page of own) {
        const lines = printedLines(page.text);
        lines.forEach((line, index) => { if (compactText(line) === key && index + 1 < lines.length && compactText(lines[index + 1]).length > 6)
            below.add(compactText(lines[index + 1])); });
    }
    if (!below.size)
        return [];
    const ownPages = new Set(own.map(page => page.page));
    const out: string[] = [];
    for (const page of others) {
        if (ownPages.has(page.page))
            continue;
        const lines = printedLines(page.text);
        for (let index = 1; index < lines.length; index++) {
            if (!below.has(compactText(lines[index])))
                continue;
            const above = lines[index - 1].replace(/\s+/g, ' ').trim();
            if (compactText(above) !== key && dominantScript(above) === 'ko' && wholeTitle(above))
                out.push(above);
        }
    }
    return [...new Set(out)];
}
function spacedPattern(value: string, gap = '\\s*'): RegExp {
    return new RegExp(Array.from(value).map(character => character.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join(gap), 'gi');
}
function citedOnly(value: string, layer: string, regions: Array<[
    number,
    number
]>, gap?: string): boolean {
    if (!value || !layer.trim())
        return false;
    const hits = [...layer.matchAll(spacedPattern(value, gap))];
    return hits.length > 0 && hits.every(hit => regions.some(([start, end]) => (hit.index ?? 0) >= start && (hit.index ?? 0) < end));
}
export function ownSerialOfLayer(layer: unknown): string {
    for (const page of String(layer ?? '').split('\f')) {
        if (!page.trim())
            continue;
        const journal = journalHeadStatement(page)?.journal;
        if (journal)
            return journal;
    }
    return '';
}
function citationsOutsideReferenceLists(layer: string, cited: Array<[
    number,
    number
]>): Array<[
    number,
    number
]> {
    return cited.filter(([start]) => {
        const lineEnd = layer.indexOf('\n', start);
        return !isReferenceListHeading(layer.slice(start, lineEnd >= 0 ? lineEnd : layer.length));
    });
}
function sectionsByPage(text: unknown): Map<number, string> {
    const sections = new Map<number, string>();
    const parts = String(text ?? '').replace(/\r\n?/g, '\n').split(/^--- PAGE (\d+) ---[^\S\n]*\n?/m);
    if (parts.length === 1) {
        if (parts[0].trim())
            sections.set(1, parts[0]);
        return sections;
    }
    for (let at = 1; at + 1 < parts.length; at += 2)
        sections.set(Number(parts[at]), String(parts[at + 1] || '').replace(/\f/g, ''));
    return sections;
}
export function folioRunOfPageAnswers(pageFields: Record<string, Record<string, string>> | null | undefined, read: number[] | null | undefined, documentPages: number | null | undefined, text: unknown = '', layerText?: (page: number) => string): {
    range: string;
    start: string;
    end: string;
    firstPage: number;
} | null {
    const pages = (Array.isArray(read) && read.length ? [...read] : Object.keys(pageFields || {}).map(Number))
        .filter(page => Number.isInteger(page) && page > 0).sort((a, b) => a - b);
    const total = Number(documentPages);
    if (pages.length < 2 || !Number.isInteger(total) || total < pages[pages.length - 1] || total - pages[pages.length - 1] > 1)
        return null;
    if (pages.some((page, index) => index > 0 && page !== pages[index - 1] + 1))
        return null;
    const sections = sectionsByPage(text);
    const folios: number[] = [];
    for (const page of pages) {
        const value = String(pageFields?.[String(page)]?.['페이지'] ?? '').trim();
        if (!/^\d{1,5}$/.test(value))
            return null;
        const folio = Number(value);
        if (folios.length && folio - page !== folios[0] - pages[0])
            return null;
        let layer = '';
        try {
            layer = String(layerText?.(page) ?? '');
        }
        catch {
            layer = '';
        }
        if (![sections.get(page) || '', layer].some(printed => folioCandidates(printed, 8).some(entry => entry.folio === folio)))
            return null;
        folios.push(folio);
    }
    if (folios[0] === pages[0])
        return null;
    const [start, end] = [String(folios[0]), String(folios[folios.length - 1])];
    return { range: `${start}-${end}`, start, end, firstPage: pages[0] };
}
const SUBTITLE_YEAR = /(?<!\d)(?:1[5-9]|20)\d{2}(?!\d)/;
const SUBTITLE_NUMBERING = /^(?:vol(?:ume)?|part|band|teil|tome|book|no|issue|chapter|section)\.?\s*[\dIVXLC]+\b|^(?:제\s*)?\d{1,3}\s*(?:권|부|편|장|호)/i;
const SUBTITLE_IDENTIFIER = /\b(?:ISBN|ISSN|DOI)\b|https?:|www\./i;
const SUBTITLE_IMPRINT = /\b(?:GmbH|KGaA|Verlag|Inc|Ltd|LLC|Press|Publishers?|Publishing)(?![\p{L}])|출판사|펴냄|펴낸/u;
export function titleWithStatedSubtitle(title: string, subtitle: unknown, printed: string, elsewhere: (value: string) => boolean = () => false, kindInTheTitleBlock: (joined: string) => boolean = () => false): string {
    const value = String(subtitle ?? '').replace(/<\/?su[pb]>/gi, '').normalize('NFKC')
        .replace(/^[\s\-–—―~〜:]+|[\s\-–—―~〜]+$/gu, '').replace(/\s+/g, ' ').trim();
    const key = compactText(value);
    if (!title || key.length < 3 || value.length > 200 || compactText(title).includes(key) || key.includes(compactText(title)))
        return title;
    if (dominantScript(value) !== dominantScript(title) || parallelRestatement(title, value))
        return title;
    const lettered = shouting(value) && !/\p{N}/u.test(value) ? value.charAt(0) + value.slice(1).toLowerCase() : value;
    if (editionIn(value) || serialNameShaped(value) || (isNotATitle(value) && isNotATitle(lettered)))
        return title;
    if (namesADocumentKind(value))
        return kindInTheTitleBlock(`${title.trim()} ${value}`) ? `${title.trim()} ${value}` : title;
    if (isPersonalName(value) || (scriptOfName(value) === 'latin' && personShape(value).person !== 'no' && value.split(/\s+/).length <= 3) || peopleRow(value)
        || isOrganisationName(value) || isOrganisationOnly(value) || elsewhere(value))
        return title;
    if (SUBTITLE_YEAR.test(value) || SUBTITLE_NUMBERING.test(value) || SUBTITLE_IDENTIFIER.test(value) || SUBTITLE_IMPRINT.test(value) || degreeAsWritten(value))
        return title;
    if (!titleSupportedByPDF(value, printed) && !compactText(printed).includes(key))
        return title;
    if (continuedTitle(title, value, kindInTheTitleBlock))
        return `${title.trim()} ${value}`;
    return /[:：?？!！]$/.test(title.trim()) ? `${title.trim()} ${value}` : `${title.trim()}: ${value}`;
}
export function continuedTitle(title: string, rest: string, inOneBlock: (joined: string) => boolean = () => false): boolean {
    const ending = titleEnding(String(title ?? '').trim());
    return ending === 'open' || (ending === 'maybe' && inOneBlock(`${String(title ?? '').trim()} ${String(rest ?? '').trim()}`));
}
export interface VisionPageReading {
    reading: MergeSource;
    page: MergeSource | null;
}
export function readVisionPage(parent: any, before: MetadataSnapshot, answered: Record<string, string>, pages: PageObservation[], context: {
    layer?: string;
    transcribed?: PageObservation[];
} = {}): VisionPageReading {
    const named = withPublisherOfTheByline(withoutMarkSigns(answered));
    const reading = buildCandidate(pages);
    const printed = pages.map(page => page.text).join('\n').replace(/\s*[™℠®]/gu, '');
    const imaged = pages.filter(page => page.kind !== 'pdfText').map(page => page.text).join('\n');
    const layer = context.layer !== undefined ? String(context.layer ?? '')
        : pages.filter(page => page.kind === 'pdfText').map(page => page.text).join('\f');
    const statedLanguage = String(named['언어'] || '').trim().toLowerCase();
    const language = statedLanguage || String(reading?.fields.language || '').trim().toLowerCase();
    const statedTitle = cleanVisionTitle(String(named['제목'] || ''), language, printed);
    const readTitle = cleanVisionTitle(String(reading?.fields.title || ''), language, printed);
    const declaredKind = String(named['유형'] || '').trim();
    const articleRead = !declaredKind || /^(?:journalArticle|magazineArticle|newspaperArticle)$/.test(declaredKind);
    const statedNumbers = [named['권호'], named['페이지']].filter(Boolean).join(' ');
    const onThePage = [imaged, named['식별자']].filter(value => String(value || '').trim()).join('\n');
    const ownSerial = ownSerialOfLayer(layer);
    const namesTheSerial = (title: string) => articleRead
        && isSerialName(title, { containers: declaredKind ? [named['출판']] : [], numbering: statedNumbers, printed: onThePage, layer, byline: named['저자'], ownSerial });
    const valuesOf = (value: unknown) => String(value ?? '').split(/\s*[;；\n]\s*/).map(compactText).filter(Boolean);
    const titled = new Set([...valuesOf(named['제목']), ...valuesOf(named['부제'])]);
    const labelledElsewhere = (title: string) => {
        const key = compactText(title);
        return !!key && !titled.has(key) && ['저자', '출판', '권호', '페이지', '발행일', '식별자', '학위'].some(name => valuesOf(named[name]).includes(key));
    };
    const listed = layer.trim() ? otherWorksSpansIn(layer) : [];
    const inAnotherWork = (value: string) => !!listed.length && !!anotherWorkTitled(value, layer);
    const usable = (title: string) => !!title && !/^(?:제목|부제)\s*[:：]/.test(title)
        && !isNotATitle(title) && titleSupportedByPDF(title, printed) && !namesTheSerial(title) && !labelledElsewhere(title) && !inAnotherWork(title);
    const layerLines = new Set(printedLines(layer.replace(/\f/g, '\n')).map(compactText).filter(key => key.length >= 6));
    const layerRead = /[\p{L}\p{N}]/u.test(layer);
    const wordRun = (value: string) => ` ${value.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ')} `;
    const imagedWords = wordRun(imaged.replace(/[™℠®]/gu, ' '));
    const uncontradicted = (title: string) => !layerRead && !!wordRun(title).trim() && imagedWords.includes(wordRun(title));
    const statedUsable = (title: string) => usable(title) || (!!title && !/^(?:제목|부제)\s*[:：]/.test(title) && !isNotATitle(title)
        && (layerLines.has(compactText(title)) || uncontradicted(title)) && !namesTheSerial(title) && !labelledElsewhere(title) && !inAnotherWork(title));
    const slotted = /^ko\b/.test(language) && !!statedTitle && !/[가-힣]/.test(statedTitle) ? sameSlotParallels(statedTitle, pages, context.transcribed || []) : [];
    const slotUsable = (title: string) => slotted.includes(title) && !/^(?:제목|부제)\s*[:：]/.test(title) && !isNotATitle(title) && !namesTheSerial(title)
        && !labelledElsewhere(title) && !inAnotherWork(title);
    const swapped = /^ko\b/.test(language) && !!statedTitle && !/[가-힣]/.test(statedTitle)
        ? slotted.find(slotUsable) || [...hangulParallels(statedTitle, String(named['부제'] || ''), pages).filter(value => !(slotted.length && opensWithVolume(value)))
                .map(value => cleanVisionTitle(value, language, printed)),
            ...(/[가-힣]/.test(readTitle) && parallelOf(structureFromPageObservations(pages), readTitle, statedTitle) ? [readTitle] : [])].find(usable) || ''
        : '';
    const subtitle = String(named['부제'] || '').trim();
    const joined = statedTitle && subtitle && !usable(statedTitle)
        ? printedLines(printed).find(line => compactText(line) === compactText(`${statedTitle} ${subtitle}`)) || '' : '';
    const chosen = swapped || (statedUsable(statedTitle) ? statedTitle : joined && usable(joined) ? joined : '');
    const pageTitle = usable(readTitle) ? readTitle : '';
    const statedElsewhere = (value: string) => ['저자', '출판', '권호', '페이지', '발행일', '식별자', '학위'].some(name => valuesOf(named[name]).includes(compactText(value)));
    const lead = subtitle.replace(/<\/?su[pb]>/gi, '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const leadIn = !swapped && !!chosen && chosen === statedTitle && compactText(lead).length >= 3 && lead.length <= 120
        && titleEnding(lead) === 'open' && titleEnding(chosen) !== 'open' && !compactText(chosen).includes(compactText(lead));
    const layerTitleBlock = (joined: string) => {
        const key = compactText(joined);
        if (!key || !pages.some(page => page.kind === 'pdfText'))
            return false;
        return titleBlocksOf(structureFromPageObservations(pages)).some(block => block.reading === 'layer' && block.basis === 'layout' && compactText(block.main.text) === key);
    };
    const title = !chosen ? '' : leadIn ? `${lead} ${chosen}` : !swapped && chosen === statedTitle ? titleWithStatedSubtitle(chosen, named['부제'], printed, statedElsewhere, layerTitleBlock) : chosen;
    const fields: Record<string, unknown> = title ? { title } : {};
    const statedEdition = lead && !leadIn ? editionIn(lead) : null;
    if (statedEdition && statedEdition.number > 0 && !statedEdition.atLeast)
        fields.edition = String(statedEdition.number);
    if (/^[a-z]{2}(?:-[a-z0-9]{2,8})?$/.test(statedLanguage) && languageFitsTheScript(statedLanguage, `${imaged}\n${layer}`))
        fields.language = statedLanguage;
    if (named['발행일']) {
        const date = canonicalDate(named['발행일']) || parseDateValue(named['발행일'])?.value || '';
        if (date)
            fields.date = date;
    }
    const pageRange = pagesAsWritten(named['페이지'], named['출판']);
    if (pageRange)
        fields.pages = pageRange;
    const cited = layer.trim() ? citationRegions(layer) : [];
    const ownTitle = compactText(title || pageTitle);
    const otherWorks = () => layer.trim() ? [...listed, ...citationsOutsideReferenceLists(layer, cited)]
        .filter(([start, end]) => ownTitle.length < 8 || !compactText(layer.slice(start, end)).includes(ownTitle)) : [];
    const statedContainer = named['출판'] ? containerParts(named['출판']) : null;
    const containerOfAnotherWork = !!statedContainer && citedOnly(statedContainer.name.replace(/\s+/g, ''), layer, otherWorks());
    const container = containerOfAnotherWork ? null : statedContainer;
    const numbering = volumeAndIssue(named['권호']);
    const identifiers = identifiersIn(named['식별자']);
    const statedDegree = degreeAsWritten(named['학위']);
    const declared = VISION_TYPES.includes(named['유형']) ? named['유형'] : '';
    const journalShown = !!(pageRange || container?.volume || container?.issue || container?.pages || container?.issn
        || numbering.volume || numbering.issue || identifiers.ISSN)
        || (!!container?.name && !isOrganisationName(container.name));
    let declaredType = declared;
    let weakType = false;
    if (declared === 'journalArticle' && !journalShown) {
        if (container?.name && isOrganisationName(container.name))
            declaredType = 'report';
        weakType = true;
    }
    if (!declaredType && statedDegree)
        declaredType = 'thesis';
    if (!declaredType && identifiers.arXiv)
        declaredType = 'preprint';
    if (declaredType === 'journalArticle' && weakType && identifiers.arXiv)
        declaredType = 'preprint';
    const serialShown = !!(pageRange || container?.volume || container?.issue || container?.pages || container?.issn || numbering.volume || numbering.issue || identifiers.ISSN);
    if (!declaredType && fields.edition && !serialShown && !statedDegree) {
        declaredType = 'book';
        weakType = true;
    }
    const type = storableType(declaredType || 'document');
    if (container) {
        const slot = containerSlot(type);
        fields[slot] = slot === 'university' ? (universityName(named['출판']) || container.name) : container.name;
        if (container.volume && !fields.volume)
            fields.volume = container.volume;
        if (container.issue && !fields.issue)
            fields.issue = container.issue;
        if (container.pages && !fields.pages)
            fields.pages = container.pages;
        if (container.issn && !fields.ISSN)
            fields.ISSN = container.issn;
    }
    if (numbering.volume)
        fields.volume = numbering.volume;
    if (numbering.issue)
        fields.issue = numbering.issue;
    if (numbering.bare && !numbering.volume && ['book', 'bookSection'].includes(type))
        fields.volume = numbering.bare;
    if (numbering.month) {
        if (!numbering.issue)
            fields.issue = numbering.month.literal;
        const date = String(fields.date || '');
        if (!date || date === numbering.month.year)
            fields.date = `${numbering.month.year}-${numbering.month.month}`;
    }
    const monthlyContainer = !numbering.month && named['출판'] ? monthNamedIssue(named['출판']) : null;
    if (monthlyContainer?.year) {
        const date = String(fields.date || '');
        if (!date || date === monthlyContainer.year)
            fields.date = `${monthlyContainer.year}-${monthlyContainer.month}`;
    }
    if (type === 'thesis') {
        const degree = statedDegree || degreeStatedIn(imaged, false);
        if (degree)
            fields.thesisType = degree;
    }
    const citedDOI = !!identifiers.DOI && citedOnly(identifiers.DOI, layer, cited);
    if (citedDOI)
        delete identifiers.DOI;
    const isbnCited = (isbn: string) => citedOnly(isbn.replace(/[^\dXx]/g, ''), layer, [...cited, ...listed], '[\\s\\-‐‑–]*');
    if (identifiers.ISBN && isbnCited(identifiers.ISBN))
        delete identifiers.ISBN;
    if (identifiers.DOI)
        fields.DOI = identifiers.DOI;
    if (identifiers.ISBN)
        fields.ISBN = identifiers.ISBN;
    if (identifiers.ISSN)
        fields.ISSN = identifiers.ISSN;
    const numberField = numberSlot(type);
    if (identifiers.number && numberField && !String(fields[numberField] ?? '').trim()
        && compactText(printed).includes(compactText(identifiers.number)))
        fields[numberField] = identifiers.number;
    if (identifiers.arXiv && type === 'preprint') {
        fields.archiveID = `arXiv:${identifiers.arXiv}`;
        if (!fields.repository)
            fields.repository = 'arXiv';
        if (!identifiers.DOI)
            fields.DOI = `10.48550/arXiv.${identifiers.arXiv}`;
    }
    const roles: boolean[] = [];
    const reviewed = statedTitle && listed.length ? anotherWorkTitled(statedTitle, layer) : '';
    const statedPeople = named['저자'] ? creatorsFromVision(named['저자'], language, []) : [];
    const ofTheReviewedWork = !!reviewed && statedPeople.length > 0 && statedPeople.every((person: any) => {
        const surname = compactText(String(person?.lastName ?? ''));
        return surname.length >= 2 && reviewed.includes(surname);
    });
    const stated = named['저자'] && !ofTheReviewedWork ? creatorsFromVision(named['저자'], language, roles) : [];
    const script = /^ko\b/.test(language) ? 'hangul' : /^en\b/.test(language) ? 'latin' : null;
    const record = snapshotFrom(parent, before, type, fields, stated as any);
    record.typeRead = !!declaredType;
    const abbreviated = stated.length > 0 && fieldIsShortened(named['저자']);
    if (abbreviated)
        record.creatorsAbbreviated = true;
    const lm: MergeSource = { kind: 'reading', label: 'LM Studio 판독', metadata: sanitizeCreators(record, script),
        typeRead: weakType ? 'weak' : !!declaredType, abbreviated,
        rolesStated: stated.filter((_, at) => roles[at]).map(personKey) };
    if (!reading)
        return { reading: lm, page: null };
    const read: Record<string, unknown> = { ...(reading.fields || {}) };
    const people = ((stated.length && !abbreviated ? [] : read.creators || []) as any[])
        .filter((person: any) => !reviewed || !reviewed.includes(compactText(String(person?.lastName ?? '')) || '\u0000'));
    delete read.creators;
    delete read.itemType;
    if (pageTitle)
        read.title = pageTitle;
    else
        delete read.title;
    if (read.DOI && citedOnly(String(read.DOI), layer, cited))
        delete read.DOI;
    if (read.ISBN && isbnCited(String(read.ISBN)))
        delete read.ISBN;
    const pageType = reading.itemType ? storableType(reading.itemType) : 'document';
    const pageRecord = sanitizeCreators({ ...before, itemType: pageType, fields: read as MetadataSnapshot['fields'], creators: people,
        typeRead: !!reading.itemType }, script);
    const page: MergeSource = { kind: 'layer', label: '쪽 판독기', metadata: pageRecord, typeRead: !!reading.itemType,
        guessed: guessesOfAReading(reading.sources, people.length > 0) };
    return { reading: lm, page };
}
export function recordFromVision(parent: any, before: MetadataSnapshot, answered: Record<string, string>, pages: PageObservation[], context: {
    layer?: string;
} = {}): MetadataSnapshot | null {
    const read = readVisionPage(parent, before, answered, pages, context);
    const merged = mergeSources(parent, before, [read.reading, read.page]).metadata;
    return String(merged.fields?.title || '').trim() ? merged : null;
}
export function filledFromDocumentReading(parent: any, before: MetadataSnapshot, vision: MetadataSnapshot, reading: MetadataSnapshot | null | undefined, readingTypeRead = true): {
    metadata: MetadataSnapshot;
    filled: string[];
} {
    if (!reading)
        return { metadata: vision, filled: [] };
    const outcome = mergeSources(parent, before, [
        { kind: 'reading', label: '비전 판독', metadata: vision, typeRead: vision.typeRead, abbreviated: !!vision.creatorsAbbreviated },
        { kind: 'layer', label: '다른 판독', metadata: reading, typeRead: readingTypeRead }
    ]);
    const filled = outcome.filled.flatMap(entry => entry.fields);
    if (!filled.length && !outcome.refined.length)
        return { metadata: vision, filled: [] };
    return { metadata: outcome.metadata, filled };
}

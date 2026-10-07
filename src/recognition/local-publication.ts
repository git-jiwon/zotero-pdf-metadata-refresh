import { buildDiff } from '../metadata/diff';
import type { MetadataSnapshot, RecognitionResult } from '../types';
import { readPDFFrontMatter } from './pdf-text';
import { storableType } from './item-fields';
import { personCreator, universityName, schoolInHangul } from './agents';
import { classifyDocument, documentEvidence, leadingType, type DocumentEvidence, type DocumentType } from './classify';
import { codesOf, mostlyRegion, readPageStructure, structureOfText, type PageStructure } from './page-structure';
import { documentTitle } from './title-block';
import { issuingBodyInText, statedIssuerOf, statementsInText } from './statements';
import { ordinanceMinistry, rightsMark, stateBody } from './imprint-marks';
import { scanIdentifiers } from './pdf-identifiers';
import { isNotATitle, isPersonalName, looksTruncatedTitle, stripTitleNoise, DEGREE_LABEL_SOURCE, DEGREE_LABEL_LATIN, isOrganisationName } from './title-guards';
export { looksTruncatedTitle } from './title-guards';
import { titleEnding } from './title-grammar';
import { BYLINE_MEANINGS, readLabelCells, type Meaning } from './label-words';
import { nameCells, nameOfItem, readBylineRow } from './byline-row';
export interface LocalPublicationData {
    itemType: 'report' | 'thesis' | 'book' | 'journalArticle';
    title: string;
    date?: string;
    institution?: string;
    publisher?: string;
    reportType?: string;
    reportNumber?: string;
    thesisType?: string;
    publicationTitle?: string;
    volume?: string;
    issue?: string;
    pages?: string;
    ISSN?: string;
    ISBN?: string;
    language: string;
    creators: string[];
    editors?: string[];
    translators?: string[];
    numPages?: string;
    confidence?: number;
    documentType?: DocumentType;
    evidence?: string[];
}
const clean = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
function creatorValues(values: string[]): string[] {
    const output: string[] = [];
    for (const raw of values) {
        for (const part of nameCells(String(raw || '').normalize('NFKC')).map(clean).filter(Boolean)) {
            if (isOrganisationName(part)) {
                output.push(part);
                continue;
            }
            const words = part.split(/\s+/).filter(Boolean);
            const row = words.length > 1 && words.every(word => /^[가-힣]{2,4}$/.test(word)) ? readBylineRow(part, { field: true }) : null;
            const names = row && row.items.length > 1 && !row.organisations?.length ? row.items.map(nameOfItem) : [];
            output.push(...(names.length ? names : [part]));
        }
    }
    return [...new Set(output)];
}
const compact = (value: string) => clean(value).replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
const linesOf = (text: string) => text.replace(/\r\n?/g, '\n').split(/[\n\f]/).map(clean).filter(Boolean);
const validName = (value: string) => /^[\p{Script=Han}가-힣·]{2,8}$/u.test(value)
    && !/(?:대학교|대학원|연구원|학위논문|기초편|주식회사)$/.test(value)
    && !/(?:논문|論文)/.test(value);
const RIGHTS_NOTICE = { test: (line: string) => rightsMark(line) };
const REPORT_NOISE = /(?:국가연구개발\s*보고서원문|성과물\s*전담기관|상업적\s*및\s*기타|목\s*차|주의내용|연구내용|연구개발성과|키워드|요약문|제\s*출\s*문|귀하|copyright|all rights reserved|table of contents|\d{4}년\s*제\s*\d+호)/i;
function joinHangulSpacing(value: string): string {
    return clean(value).replace(/(?<=[가-힣])\s+(?=[가-힣](?:\s|$))/g, '');
}
function joinEastAsianGlyphSpacing(value: string): string {
    return clean(value).replace(/(?<=[가-힣\p{Script=Han}])\s+(?=[가-힣\p{Script=Han}](?:\s|$))/gu, '');
}
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'];
const RESEARCH_PERIOD = /(?:(?:연구|과제|사업|수행|용역)\s*기간|(?:project|research|contract)\s+period)\s*[:：]?\s*(?:(?:19|20)\d{2}\s*[.\-/년]\s*\d{1,2}(?:\s*[.\-/월]\s*\d{1,2})?\s*[.일]?\s*)?(?:[-–~∼]\s*(?:(?:19|20)\d{2}\s*[.\-/년]\s*)?\d{1,2}(?:\s*[.\-/월]\s*\d{1,2})?\s*[.일]?)?/gi;
export function dateFromText(text: string): string | undefined {
    const source = String(text || '').normalize('NFKC').replace(/[\u00a0\t]+/g, ' ').replace(/\s+/g, ' ')
        .replace(RESEARCH_PERIOD, ' ');
    const validMonth = (value: string) => Number(value) >= 1 && Number(value) <= 12;
    const validDay = (value: string) => Number(value) >= 1 && Number(value) <= 31;
    const pad = (value: string) => value.padStart(2, '0');
    const labelled = source.match(/(?:발행|발간|작성|개정|출간)\s*일(?:자)?\s*[:：]?\s*((?:19|20)\d{2}\s*(?:년|[.\-/])\s*\d{1,2}\s*(?:월|[.\-/])\s*\d{1,2}\s*일?|(?:19|20)\d{2}\s*(?:년|[.\-/])\s*\d{1,2}\s*(?:월|[.\-/])?|(?:19|20)\d{2})?/i)?.[1];
    const input = labelled || source;
    for (const match of input.matchAll(/\b((?:19|20)\d{2})\s*[.\-/년]\s*(\d{1,2})(?!\d)\s*[.\-/월]\s*(\d{1,2})(?!\d)\s*일?/g)) {
        if (validMonth(match[2]) && validDay(match[3]))
            return `${match[1]}-${pad(match[2])}-${pad(match[3])}`;
    }
    for (const match of input.matchAll(/\b((?:19|20)\d{2})\s*[.\-/년]\s*(\d{1,2})(?!\d)\s*월?/g)) {
        if (validMonth(match[2]))
            return `${match[1]}-${pad(match[2])}`;
    }
    const compact = input.match(/\b((?:19|20)\d{2})(\d{2})(\d{2})\b/);
    if (compact && validMonth(compact[2]) && validDay(compact[3]))
        return `${compact[1]}-${compact[2]}-${compact[3]}`;
    const named = input.match(new RegExp(`\\b(${MONTH_NAMES.join('|')})\\s+((?:19|20)\\d{2})\\b`, 'i'));
    if (named)
        return `${named[2]}-${pad(String(MONTH_NAMES.indexOf(named[1].toLowerCase()) + 1))}`;
    return undefined;
}
function valueAfterLabel(lines: string[], label: RegExp, maxFollowing = 2): string | undefined {
    for (let i = 0; i < lines.length; i++) {
        if (!label.test(lines[i]))
            continue;
        const inline = clean(lines[i].replace(label, '')).replace(/^[:：·\-\s]+/, '');
        if (inline && !REPORT_NOISE.test(inline))
            return inline;
        const parts: string[] = [];
        for (const line of lines.slice(i + 1, i + 1 + maxFollowing)) {
            if (REPORT_NOISE.test(line) || /^(?:영문|중심단어|연구책임자|책임자|주관연구|연구기간|구분|대분야)(?:\s|$)/.test(line))
                break;
            if (line.length >= 3 && line.length <= 180)
                parts.push(line);
        }
        if (parts.length)
            return clean(parts.join(' '));
    }
}
function occurrenceCount(text: string, value: string): number {
    const haystack = compact(text), needle = compact(value);
    if (needle.length < 6)
        return 0;
    let count = 0, offset = 0;
    while ((offset = haystack.indexOf(needle, offset)) >= 0) {
        count++;
        offset += needle.length;
    }
    return count;
}
function plausibleTitle(line: string): boolean {
    const letters = line.match(/[\p{L}]/gu)?.length || 0;
    return letters >= 6 && line.length >= 6 && line.length <= 220
        && !REPORT_NOISE.test(line)
        && !isNotATitle(line)
        && !isOrganisationName(line)
        && !/(?:,[^,]+){3,}/.test(line)
        && !/^(?:20\d{2}|Vol\.?\s*\d+|[ivx\d-]+|연구기관|연구책임자|주관연구기관|작성자|소속|작성년월일|서론|개요|Introduction)\b/i.test(line)
        && !/(?:대학교|대학원|연구원|연구소|산학협력단|주식회사|INC\.?|Institute|University)$/i.test(line);
}
const dropSpaceClasses = (source: string) => source.split('\\s*').join('');
const DEGREE_MARKER_COMPACT = new RegExp(dropSpaceClasses(DEGREE_LABEL_SOURCE) + '|' + dropSpaceClasses(DEGREE_LABEL_LATIN), 'i');
const DEGREE_COVER = new RegExp("(?:^|\\n)\\s*(?:" + DEGREE_LABEL_SOURCE + "|" + DEGREE_LABEL_LATIN + ")\\s*(?:\\n|$)"
    + "|이\\s*(?:논문|論文)을.{0,60}(?:학위|學位)\\s*(?:논문|論文)으로"
    + "|[가-힣\\s]{2,12}의\\s*(?:" + DEGREE_LABEL_SOURCE + ")을", "im");
const APPROVED_THESIS_AUTHOR = new RegExp('^((?:[\\p{Script=Han}가-힣·]\\s*){2,8})의\\s*.{0,20}?(?:' + DEGREE_LABEL_SOURCE + ')', 'u');
function mostFrequentYear(text: string): string | undefined {
    const counts = new Map<string, number>();
    for (const match of text.matchAll(/\b((?:19|20)\d{2})\s*년?/g))
        counts.set(match[1], (counts.get(match[1]) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || Number(b[0]) - Number(a[0]))[0]?.[0];
}
function thesisTitle(structure: PageStructure, body?: 'ko' | 'en'): string {
    return documentTitle(structure, { bodyScript: body === 'en' ? 'latin' : body === 'ko' ? 'ko' : null, restatements: true })?.title || '';
}
function thesisInstitution(line: string): string | undefined {
    const joined = joinEastAsianGlyphSpacing(line);
    const named = universityName(joined);
    if (named)
        return clean(named);
    const latin = joined.match(/((?:[A-Z][A-Za-z'.-]*\s+){0,4}(?:UNIVERSITY|University|INSTITUTE|Institute)(?:\s+of\s+[A-Z][A-Za-z'.-]*(?:\s+(?:(?:and|AND|&)\s+)?[A-Z][A-Za-z'.-]*){0,4})?)/);
    if (latin)
        return clean(latin[1]);
    return clean(schoolInHangul(joined)) || undefined;
}
const YEAR_MONTH = /((?:19|20)\d{2})\s*[년年.\-/]\s*(\d{1,2})(?!\d)\s*[월月]/g;
function thesisDate(text: string): string | undefined {
    const pages = text.split('\f').slice(0, 5);
    const validMonth = (value: string) => Number(value) >= 1 && Number(value) <= 12;
    const cover = pages.find(page => linesOf(page).some(line => DEGREE_MARKER_COMPACT.test(compact(line))
        || /(?:대학교|大學校|大学校).*(?:대학원|大學院|大学院)|과학기술원|科學技術院/.test(compact(line))));
    const stated = cover ? [...cover.matchAll(YEAR_MONTH)].find(match => validMonth(match[2])) : undefined;
    if (stated)
        return `${stated[1]}-${stated[2].padStart(2, '0')}`;
    const front = pages.join('\n');
    const year = mostFrequentYear(front);
    if (!year)
        return undefined;
    const month = [...front.matchAll(YEAR_MONTH)]
        .find(match => match[1] === year && validMonth(match[2]))?.[2];
    return month ? `${year}-${month.padStart(2, '0')}` : year;
}
const DEGREE_STATED = new RegExp('(?:' + DEGREE_LABEL_SOURCE + '|' + DEGREE_LABEL_LATIN
    + '|이\\s*(?:논문|論文)을.{0,40}?(?:석사|박사|碩士|博士)|degree\\s+of\\s+(?:master|doctor)'
    + '|(?:master|doctor)\\s+of\\s+(?:science|philosophy|engineering|arts))', 'i');
const DEGREE_STATED_COMPACT = new RegExp('(?:' + dropSpaceClasses(DEGREE_LABEL_SOURCE) + '|' + dropSpaceClasses(DEGREE_LABEL_LATIN)
    + '|이(?:논문|論文)을.{0,40}?(?:석사|박사|碩士|博士)|degreeof(?:master|doctor))', 'i');
function statedDegree(lines: string[]): boolean {
    for (const line of lines) {
        const stated = line.match(DEGREE_STATED)?.[0] || compact(line).match(DEGREE_STATED_COMPACT)?.[0];
        if (stated)
            return /박사|博士|doctor/i.test(stated);
    }
    return lines.filter(line => !/(?:위원|심사|지도|교수|敎授|教授|advis|supervis|committee|ph\.?\s*d|박사\s*과정|감사)/i.test(line))
        .some(line => /(?:박사|博士|doctoral)/i.test(line));
}
function bodyScript(text: string): 'ko' | 'en' | undefined {
    let hangul = 0, latin = 0;
    for (const page of text.split('\f').slice(1, 24)) {
        if (DEGREE_MARKER_COMPACT.test(compact(page)) || /인준|심사\s*위원|approv|committee|지도\s*교수|advisor|저작자\s*표시|creative\s*commons|이용\s*허락/i.test(page))
            continue;
        if (/^\s*(?:abstract|국문\s*초록|초\s*록|국문\s*요약|요\s*약)\s*$/im.test(page))
            continue;
        hangul += page.match(/[가-힣]/g)?.length || 0;
        latin += page.match(/[A-Za-z]/g)?.length || 0;
    }
    if (hangul + latin < 400)
        return undefined;
    if (latin > hangul * 4)
        return 'en';
    if (hangul * 2 >= latin)
        return 'ko';
    return undefined;
}
export function depositCitation(text: string): {
    title: string;
    author?: string;
    institution?: string;
} | null {
    const front = text.split('\f').slice(0, 3).join('\n');
    const block = front.match(/To cite this version\s*[:：]?\s*([\s\S]{20,600}?)(?:\n\s*\n|[⟨\p{Noncharacter_Code_Point}]|$)/iu)?.[1];
    if (!block)
        return null;
    const flat = clean(block);
    const parts = flat.split(/\.\s+/);
    if (parts.length < 2)
        return null;
    const author = clean(parts[0]);
    const title = clean(parts[1]);
    if (title.length < 12 || title.length > 300 || isNotATitle(title))
        return null;
    const named = /^[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+){0,3}$/u.test(author) ? author : undefined;
    const venue = parts.slice(2).map(clean).find(part => /\b(?:Universit|Institut|École|Ecole|College|School)\b/i.test(part));
    const institution = venue ? clean(venue.replace(/,\s*(?:19|20)\d{2}.*$/, '')) : undefined;
    return { title, author: named, institution };
}
function parseThesis(text: string, numPages?: string, structure: PageStructure = structureOfText(text)): LocalPublicationData | null {
    const front = text.split('\f').slice(0, 24).join('\n');
    if (!DEGREE_COVER.test(front))
        return null;
    const deposit = depositCitation(text);
    const body = bodyScript(text);
    const title = deposit?.title || thesisTitle(structure, body);
    if (!title)
        return null;
    const lines = linesOf(text.split('\f').slice(0, 24).join('\n'));
    const doctoral = statedDegree(lines);
    const koreanRecord = /[가-힣]/.test(title);
    const koreanDegree = /[가-힣]/.test(text);
    const thesisType = koreanDegree
        ? (doctoral ? '박사학위논문' : '석사학위논문')
        : (doctoral ? 'Doctoral Thesis' : "Master's Thesis");
    const institutionLine = lines.find(line => /(?:대학교.*대학원|大學校.*大學院)/.test(compact(line))
        || (/(?:과학기술원|科學技術院)/.test(compact(line)) && compact(line).length <= 40))
        || lines.find(line => /(?:University|Institute).*(?:Graduate School)?|Graduate School.*(?:University|Institute)/i.test(compact(line)));
    const institution = deposit?.institution || (institutionLine ? thesisInstitution(institutionLine) : undefined);
    let author = [text.match(/이\s*(?:논문|論文)을\s*((?:[\p{Script=Han}가-힣·]\s*){2,8}?)\s*의\s*.{0,24}?(?:학위|學位|学位)/u)?.[1]]
        .map(name => name?.replace(/[\s·]+/g, ''))
        .find((name): name is string => !!name && validName(name) && !/(?:교수|위원|선생|박사|학생)$/.test(name));
    if (!author)
        author = lines.map(joinEastAsianGlyphSpacing)
            .map(line => line.replace(/^이\s*(?:논문|論文)을\s*/u, '').match(APPROVED_THESIS_AUTHOR)?.[1])
            .map(name => name && compact(name))
            .find((name): name is string => !!name && validName(name));
    if (!author)
        author = lines.map(joinEastAsianGlyphSpacing)
            .map(line => line.match(/^([가-힣]{2,8})\s*\([\p{Script=Han}\s]{2,12}(?:[A-Z][A-Za-z.'-]+(?:\s*,?\s*[A-Z][A-Za-z.'-]+)*)?\)/u)?.[1])
            .find(Boolean);
    if (!author)
        author = text.match(/^\s*(?:By|Author)\s*[:：]?\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s*$/im)?.[1];
    if (!author) {
        const department = lines.findIndex(line => /(?:학과|학부|전공|工學科|物理學部|科|部)(?:\([^)]*\))?$/.test(compact(line)));
        author = lines.slice(Math.max(0, department + 1), department + 5)
            .map(joinEastAsianGlyphSpacing)
            .find(line => validName(line) && isPersonalName(line));
    }
    return { itemType: 'thesis', title, date: thesisDate(text), institution, thesisType, language: body || (koreanRecord ? 'ko' : 'en'), creators: author ? [author] : deposit?.author ? [deposit.author] : [], numPages };
}
function labelled(text: string, label: RegExp): string | undefined {
    return linesOf(text).map(line => clean(line.replace(label, ''))).find((line, index) => label.test(linesOf(text)[index]) && line)?.replace(/^[:：-]\s*/, '');
}
function repeatedFrontTitle(text: string, limit = 70): string | undefined {
    const lines = linesOf(text.split('\f').slice(0, 3).join('\n')).slice(0, limit);
    const options: Array<{
        title: string;
        score: number;
    }> = [];
    for (let start = 0; start < lines.length; start++)
        for (let size = 1; size <= 4; size++) {
            const parts = lines.slice(start, start + size);
            if (parts.length !== size || parts.some(part => !plausibleTitle(part)))
                continue;
            const title = clean(parts.join(' '));
            const count = occurrenceCount(text, title);
            if (count < 2)
                continue;
            const wordScore = title.split(/\s+/).length;
            const eastAsian = title.match(/[가-힣\p{Script=Han}]/gu)?.length || 0;
            options.push({ title, score: Math.min(count, 3) * 220 + Math.min(title.length, 140) + wordScore * 4
                    + size * 120 + Math.max(0, 500 - start * 14) + (eastAsian >= 5 ? 80 : 0)
                    - (looksTruncatedTitle(title) ? 700 : 0) });
        }
    for (const option of options) {
        const key = compact(option.title);
        if (options.some(other => other !== option && compact(other.title).startsWith(key) && compact(other.title).length >= key.length + 4))
            option.score -= 500;
    }
    const best = options.sort((a, b) => b.score - a.score)[0]?.title;
    if (!best)
        return undefined;
    const stripped = stripTitleNoise(best);
    return stripped.length >= 8 && !isNotATitle(stripped) ? stripped : best;
}
function primaryResearcher(text: string): string | undefined {
    for (const line of linesOf(text).slice(0, 180)) {
        const match = line.match(/(?:주관\s*)?연구\s*(?:책임자|책임자명|대표)\s*[:：]?\s*((?:[가-힣]\s*){2,5})(?=\s*(?:인\b|과학기술인|직급|전공|$))/);
        if (match) {
            const name = match[1].replace(/\s+/g, '').replace(/인$/, '');
            if (validName(name))
                return name;
        }
    }
}
const ISSUER_MEANINGS: ReadonlySet<Meaning> = new Set<Meaning>(['issuer', 'publisherHouse']);
function parseStructuredResearchReport(text: string, numPages?: string): LocalPublicationData | null {
    const front = text.split('\f').slice(0, 12).join('\n');
    const lines = linesOf(front);
    const markers = [
        /국가연구개발\s*보고서원문/, /(?:최종결과|최종)보고서/, /기관주요사업\s*연구보고서/,
        /사업계획요약/,
        /발\s*간\s*등\s*록\s*번\s*호|발간등록번호/, /(?:과\s*제\s*명|연구과제명)/,
        /주관\s*연구\s*기관/, /본\s*보고서를.+보고서로\s*제출/
    ].filter(pattern => pattern.test(front)).length;
    if (markers < 2)
        return null;
    let title = valueAfterLabel(lines, /^(?:과\s*제\s*명|연구과제명)(?:\s*[(（]?\s*(?:국문|한\s*글)\s*[)）]?)?\s*[:：]?/i, 3)
        || front.match(/본\s*보고서를\s*[“"]([^”"\n]{8,220})[”"]/i)?.[1]
        || repeatedFrontTitle(front);
    title = clean(String(title || '')).replace(/^[(（]?\s*(?:국문|한\s*글)\s*[)）]?\s*[:：]?\s*/, '').replace(/\s+(?:영문|중심단어|주관연구기관|연구책임자|책임자)(?:\s|$).*$/, '');
    if (!plausibleTitle(title))
        return null;
    const labelledIssuer = readLabelCells(lines, { meanings: ISSUER_MEANINGS }).map(cell => clean(cell.value)).find(value => value.length >= 2 && isOrganisationName(value.replace(/\s+/g, ''))) || '';
    const seatedIssuer = labelledIssuer ? '' : clean(statedIssuerOf(statementsInText(text).statements)?.names?.[0]?.text || '');
    let institution = labelledIssuer || (seatedIssuer.length >= 2 && isOrganisationName(seatedIssuer.replace(/\s+/g, '')) ? seatedIssuer : '')
        || valueAfterLabel(lines, /^(?:주관\s*연구\s*기관(?:명)?|연구기관(?:명)?|수행기관)\s*[:：]?/i, 1) || '';
    institution = joinHangulSpacing(institution).replace(/\s+(?:주관\s*)?연구\s*책임자.*$/, '').trim();
    if (!institution)
        institution = lines.slice(0, 70).find(line => /(?:국립환경과학원|한국생산기술연구원|한국과학기술연구원|산학협력단)$/.test(joinHangulSpacing(line))) || '';
    const reportNumber = front.match(/(?:발\s*간\s*등\s*록\s*번\s*호|발간등록번호)\s*[:：]?\s*(\d{2}\s*-\s*\d{7}\s*-\s*\d{6}\s*-\s*\d{2})/i)?.[1]?.replace(/\s+/g, '')
        || front.match(/(?:발\s*간\s*등\s*록\s*번\s*호|발간등록번호)\s*[:：]?\s*([A-Z0-9][A-Z0-9.-]{7,35})/i)?.[1]?.replace(/[.,;]+$/, '')
        || codesOf(structureOfText(text)).find(code => code.kind === 'documentNumber' && !code.from.includes('folioRow'))?.value || '';
    const creator = primaryResearcher(front);
    const reportType = /사업계획(?:요약|서)/.test(front) ? '사업계획서'
        : /학술연구용역사업\s*최종결과보고서/.test(front) ? '학술연구용역 최종결과보고서'
            : /기관주요사업\s*연구보고서/.test(front) ? '기관주요사업 연구보고서'
                : /최종(?:결과)?보고서/.test(front) ? '최종보고서' : '연구보고서';
    const period = lines.slice(0, 140).join(' ').match(RESEARCH_PERIOD)?.[0];
    const periodEnd = period?.match(/(?:19|20)\d{2}/g)?.pop();
    return {
        itemType: 'report', title, date: dateFromText(lines.slice(0, 140).join('\n')) || periodEnd,
        institution: institution || undefined, reportType, reportNumber: reportNumber || undefined,
        language: /[가-힣]/.test(title) ? 'ko' : 'en', creators: creator ? [creator] : [], numPages
    };
}
export { isOrganisationName } from './title-guards';
const DOCUMENT_KIND = /(?:(?:안내|설명|지침|보고|계획|제안|해설|백|사례|교재|지도)서|자료집?|지침|편람|안내|보고|동향|가이드(?:북)?|매뉴얼|핸드북|총람|요람|연감|연보|통계|사례집)$/;
function institutionalCreator(lines: string[]): string | undefined {
    return lines.slice(0, 40)
        .map(joinEastAsianGlyphSpacing)
        .find(line => isOrganisationName(line) && !/(?:대학원|대학교)$/.test(line));
}
function parseLocalTechnicalPublication(text: string, numPages?: string): LocalPublicationData | null {
    const front = text.split('\f').slice(0, 6).join('\n');
    const lines = linesOf(front);
    const statedIssuer = () => issuingBodyInText(text.split('\f').slice(0, 6).join('\f')) || undefined;
    const bulletinIndex = lines.slice(0, 5).findIndex(line => /^(?:19|20)\d{2}-\d+호\s*\(/.test(line));
    const bulletin = bulletinIndex >= 0 ? lines[bulletinIndex].match(/^((?:19|20)\d{2})-(\d+)호\s*\(((?:19|20)\d{2})[.]\s*(\d{1,2})[.]\s*(\d{1,2})[.]?\)$/) : null;
    if (bulletin) {
        const title = lines.slice(bulletinIndex + 1, bulletinIndex + 4).find(plausibleTitle);
        const byline = lines.find(line => /\|\s*[가-힣]{2,4}\s*(?:박사|교수|연구원)/.test(line));
        const author = byline?.match(/\|\s*([가-힣]{2,4})/)?.[1];
        const institution = byline?.split('|')[0]?.trim();
        if (title)
            return { itemType: 'report', title, reportType: '기관 간행물', reportNumber: `${bulletin[1]}-${bulletin[2]}호`, date: `${bulletin[3]}-${bulletin[4].padStart(2, '0')}-${bulletin[5].padStart(2, '0')}`, institution, language: 'ko', creators: author ? [author] : [], numPages };
    }
    if (/\bVol\.?\s*\d+/i.test(lines.slice(0, 5).join(' ')) && /발행처.+ISSN/i.test(lines.slice(0, 8).join(' '))) {
        const running = front.match(/(?:Research Brief|Bulletin|Magazine)\s+([가-힣][가-힣\s]{4,50})\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i)?.[1];
        const title = clean(running || lines.slice(0, 15).reverse().find(line => /연구동향|연보|소식지|저널|학회지/.test(line)) || '');
        const imprint = lines.slice(0, 8).join(' ');
        const institution = imprint.match(/발행처\s*(.*?)(?=\s+[I|]\s+발행인|\s+발행인|\s+[I|]\s+ISSN|$)/)?.[1]?.trim();
        const reportNumber = imprint.match(/\bVol\.?\s*(\d+)/i)?.[1];
        const issn = imprint.match(/\bISSN\s*(\d{4}-\d{3}[\dX])\b/i)?.[1];
        if (title)
            return { itemType: 'report', title, reportType: '정기간행물', reportNumber: reportNumber ? `Vol. ${reportNumber}` : undefined, date: dateFromText(imprint), institution, ISSN: issn, language: 'ko', creators: [], numPages };
    }
    if (/ReSEAT\s*프로그램/i.test(front) && /첨단기술정보분석/.test(front)) {
        const marker = lines.findIndex(line => /ReSEAT\s*프로그램/i.test(line));
        const title = lines.slice(marker + 1, marker + 5).find(plausibleTitle);
        const expert = lines.find(line => /전문연구위원/.test(line));
        const author = expert?.match(/전문연구위원\s*([가-힣](?:\s*[가-힣]){1,4})/)?.[1]?.replace(/\s+/g, '');
        if (title)
            return { itemType: 'report', title, reportType: '첨단기술정보분석', institution: '한국과학기술정보연구원', language: 'ko', creators: author && validName(author) ? [author] : [], numPages };
    }
    if (/\bTECHNICAL\s+MANUAL\b/i.test(front)) {
        const marker = lines.findIndex(line => /\bTECHNICAL\s+MANUAL\b/i.test(line));
        const title = lines.slice(marker + 1, marker + 5).find(plausibleTitle) || repeatedFrontTitle(front);
        const institution = statedIssuer();
        if (title)
            return {
                itemType: 'report', title: title.replace(/\s+Table of Contacts\b.*$/i, ''),
                reportType: 'Technical Manual', reportNumber: front.match(/\b[A-Z]{2,8}\d{3,8}[A-Z0-9-]*\b/)?.[0],
                institution, date: dateFromText(front), language: /[가-힣]/.test(title) ? 'ko' : 'en', creators: [], numPages
            };
    }
    const authorLine = lines.find(line => /^작성자(?:\s|[:：])/.test(line));
    const authoredDate = lines.find(line => /^작성년월일(?:\s|[:：])/.test(line));
    if (authorLine && authoredDate) {
        const title = lines.slice(Math.max(lines.indexOf(authoredDate) + 1, 0), lines.indexOf(authoredDate) + 5)
            .filter(line => (line.match(/[가-힣]/g)?.length || 0) >= 3 && !REPORT_NOISE.test(line) && !/^\d{2}\s/.test(line) && !isOrganisationName(line)).join(' ')
            || repeatedFrontTitle(front);
        const author = joinHangulSpacing(authorLine.replace(/^작성자\s*[:：]?\s*/, ''))
            .split(/[\s,·]+/).find(word => validName(word) && isPersonalName(word)) || '';
        const institution = statedIssuer();
        if (title)
            return { itemType: 'report', title, reportType: '기술자료', institution, date: dateFromText(authoredDate), language: /[가-힣]/.test(title) ? 'ko' : 'en', creators: validName(author) ? [author] : [], numPages };
    }
    const title = repeatedFrontTitle(front);
    if (!title)
        return null;
    if (!/[가-힣]/.test(title))
        return null;
    const frontPages = text.split('\f');
    const contentsStructure = readPageStructure({ pages: frontPages.map((page, index) => ({ page: index + 1, layer: { text: page } })) });
    const outsideContents = frontPages.filter((_page, index) => !mostlyRegion(contentsStructure, index + 1, 'contentsList'));
    if (!outsideContents.some(page => compact(page).includes(compact(title))))
        return null;
    const institutionLine = lines.slice(0, 30).some(line => /(?:대학교|연구원|연구소|기술원|센터|협회|학회|INC\.?|CORP\.?|LTD\.?)$/i.test(line) && !RIGHTS_NOTICE.test(line));
    const institution = statedIssuer();
    const titleIndex = lines.findIndex(line => compact(line) === compact(title));
    const labelled = valueAfterLabel(lines, /^(?:작성자|집필자|저자|연구자|연구책임자)\s*[:：]?/, 1);
    const author = (labelled && joinHangulSpacing(labelled).split(/[\s,·]+/).find(word => isPersonalName(word) && !DOCUMENT_KIND.test(word)))
        || lines.slice(titleIndex + 1, titleIndex + 6).map(joinHangulSpacing).find(line => isPersonalName(line) && !DOCUMENT_KIND.test(line));
    const issuer = author ? undefined : institutionalCreator(lines);
    if (!institutionLine && !author && !issuer && !/(?:^|\n)(?:개요|서론|목차|1[.]\s*서론)(?:\n|$)/m.test(front))
        return null;
    return { itemType: 'report', title, reportType: '기관 기술자료', institution: institution || issuer, date: dateFromText(text.split('\f')[0] || ''), language: /[가-힣]/.test(title) ? 'ko' : 'en', creators: author ? [author] : issuer ? [issuer] : [], numPages };
}
function parseKoreanJournalArticle(text: string): LocalPublicationData | null {
    const first = linesOf(text.split('\f')[0] || '').slice(0, 40);
    const citationIndex = first.findIndex(line => /(?:20\d{2}).*Vol\.?\s*\d+.*(?:No\.?\s*\d+)?.*pp?\.?\s*\d+\s*[-–]\s*\d+/i.test(line));
    if (citationIndex < 0)
        return null;
    const citation = first[citationIndex];
    const parsed = citation.match(/^(.*?)\s+(20\d{2}),?\s*Vol\.?\s*(\d+)(?:,?\s*No\.?\s*(\d+))?.*?pp?\.?\s*(\d+\s*[-–]\s*\d+)/i);
    if (!parsed)
        return null;
    const titleParts: string[] = [];
    for (const line of first.slice(citationIndex + 1, citationIndex + 6)) {
        if (/^[가-힣]{2,4}\([\p{Script=Han}]{1,6}\)[*]*/u.test(line))
            break;
        if (plausibleTitle(line))
            titleParts.push(line);
    }
    const title = titleParts.join(' ');
    if (!title)
        return null;
    const authorBlock = first.slice(citationIndex + 1, citationIndex + 10)
        .filter(line => /[가-힣]{2,4}\([\p{Script=Han}]{1,6}\)[*]*/u.test(line)).join(' ');
    const creators = [...authorBlock.matchAll(/(?<![가-힣])([가-힣]{2,4})(?:\([\p{Script=Han}\s]{1,8}\)[*†‡]*|[*†‡]+)/gu)]
        .filter(match => validName(match[1]) && (match[0].includes('(') || isPersonalName(match[1])))
        .map(match => match[1]);
    return { itemType: 'journalArticle', title, publicationTitle: parsed[1], date: parsed[2], volume: parsed[3], issue: parsed[4], pages: parsed[5].replace(/\s+/g, ''), language: 'ko', creators };
}
function ministryOf(text: string): string {
    const ministry = ordinanceMinistry(text.split('\f')[0] || '');
    return ministry ? stateBody(ministry) : '';
}
function wrappedTitle(lines: string[], start: number): {
    title: string;
    end: number;
} {
    let title = lines[start] || '', end = start;
    for (let next = start + 1; next < Math.min(lines.length, start + 3) && titleEnding(title) !== 'closed'; next++) {
        const line = lines[next];
        if (!/[가-힣]/.test(line) || line.length > 80 || REPORT_NOISE.test(line)
            || /^(?:[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]|[IVX]+\.|\d+[.)]|목\s*차|차\s*례|요약|R&D\s+Brief|BRIC\s+View)/i.test(line))
            break;
        if (titleEnding(title) === 'maybe' && (isPersonalName(joinEastAsianGlyphSpacing(line)) || isOrganisationName(line)))
            break;
        title = clean(`${title} ${line}`);
        end = next;
    }
    return { title, end };
}
function parseReport(text: string, numPages?: string): LocalPublicationData | null {
    const structured = parseStructuredResearchReport(text, numPages);
    if (structured)
        return structured;
    const lines = linesOf(text);
    const first = lines.slice(0, 80);
    let title = '', reportType = '', reportNumber = '', institution = '', date = '', creators: string[] = [];
    const bric = first.findIndex(line => /BRIC\s+View\s+\d{4}-[A-Z]\d+/i.test(line));
    if (bric >= 0) {
        reportNumber = first[bric].match(/BRIC\s+View\s+\d{4}-[A-Z]\d+/i)?.[0] || '';
        title = first.slice(bric + 1, bric + 5).find(line => /[가-힣]/.test(line) && !/^(?:이?문근|요약문)$/.test(line)) || first[0];
        const wrapped = first.indexOf(title) >= 0 ? wrappedTitle(first, first.indexOf(title)) : { title, end: -1 };
        title = wrapped.title;
        const titleIndex = wrapped.end;
        const author = first.slice(titleIndex + 1, titleIndex + 4).find(line => validName(line) && isPersonalName(line));
        const org = first.slice(titleIndex + 1, titleIndex + 6).find(line => /(?:연구원|기술원|대학교|센터)$/.test(line));
        if (author)
            creators = [author];
        if (org)
            institution = org;
        reportType = '동향리포트';
        date = reportNumber.match(/\d{4}/)?.[0] || '';
    }
    const brief = first.findIndex(line => /R&D\s+Brief\s+\d{4}-\d+/i.test(line));
    if (!title && brief >= 0) {
        reportNumber = first[brief].match(/R&D\s+Brief\s+\d{4}-\d+/i)?.[0] || '';
        const titleAt = first.slice(0, brief).findIndex(line => /[가-힣]/.test(line) && line.length >= 8);
        title = titleAt >= 0 ? wrappedTitle(first.slice(0, brief), titleAt).title : '';
        creators = (first[brief + 1] || '').split(/[,·]/).map(clean).filter(validName);
        institution = /BUSAN INSTITUTE OF SCIENCE & TECHNOLOGY EVALUATION AND PLANNING/i.test(text) ? '부산과학기술기획평가원' : '';
        reportType = 'R&D Brief';
        date = reportNumber.match(/\d{4}/)?.[0] || '';
    }
    const market = first.findIndex(line => /기술시장정보서/.test(line));
    if (!title && market >= 0) {
        title = first.slice(market + 1, market + 4).find(line => !/색인어|작성기관|작성자/.test(line)) || '';
        institution = labelled(text, /작성기관\s*[:：]?/) || '';
        date = text.match(/작\s*성\s*일\s*[:：]?\s*((?:19|20)\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/)?.slice(1).map((part, index) => index ? part.padStart(2, '0') : part).join('-') || '';
        const creatorBlock = text.match(/작\s*성\s*자\s*[:：]?\s*([\s\S]{0,160}?)(?=작\s*성\s*일|본 자료)/)?.[1] || '';
        creators = [...creatorBlock.matchAll(/[가-힣](?:\s*[가-힣]){1,3}/g)].map(match => match[0].replace(/\s+/g, '')).filter(validName).slice(0, 4);
        reportType = '기술시장정보서';
    }
    if (!title && /기술이전을 위한 상세 설명자료/.test(text)) {
        title = labelled(text, /특허\s*기술명\s*\(한글\)\s*[:：]?/) || '기술이전을 위한 상세 설명자료';
        reportNumber = text.match(/특허\s*등록\s*번호\s*(10-\d{6,})/)?.[1] || '';
        institution = text.match(/소속\s*[:：]\s*([^\n]{2,30})/)?.[1]?.split(/\s+직급\s*[:：]/)[0]?.trim() || '';
        creators = [...text.matchAll(/성명\s*[:：]\s*([가-힣·]{2,8})/g)].map(match => match[1]).slice(0, 8);
        reportType = '기술이전 설명자료';
    }
    if (!title) {
        const regulation = first[0]?.match(/^■?\s*(.+?규칙)\s*\[별표\s*\d+\]\s*<개정\s*((?:19|20)\d{2})[.\s]+(\d{1,2})[.\s]+(\d{1,2})/);
        if (regulation) {
            const heading = first[1]?.match(/^(.{4,100}?)(?:\(제\d+조(?:\s*제\d+항)?\s*관련\))?$/)?.[1];
            title = heading && !/^\d/.test(heading) ? heading : regulation[1];
            reportType = '법령 별표';
            institution = ministryOf(text);
            date = `${regulation[2]}-${regulation[3].padStart(2, '0')}-${regulation[4].padStart(2, '0')}`;
        }
        else {
            const appendix = first[0]?.match(/^\[별표\s*\d+\]\s*<개정\s*((?:19|20)\d{2})[.\s]+(\d{1,2})[.\s]+(\d{1,2})/);
            const appendixTitle = first[1]?.match(/^(.{4,100}?)(?:\(제\d+조\s*관련\))?$/)?.[1];
            if (appendix && appendixTitle) {
                title = appendixTitle;
                reportType = '법령 별표';
                institution = ministryOf(text);
                date = `${appendix[1]}-${appendix[2].padStart(2, '0')}-${appendix[3].padStart(2, '0')}`;
            }
        }
    }
    const annualCover = text.split('\f').slice(0, 2).flatMap(page => linesOf(page).slice(0, 15))
        .map(line => ({ line, name: line.replace(/\s*[[(]?(?:19|20)\d{2}[\])]?(?:\s*년\s*도?)?\s*/g, ' ').trim() }))
        .find(({ line, name }) => line.length <= 30 && /[가-힣]{2,}(?:연보|연감)$/.test(name) && !/따르면|인용|참고|의하면/.test(line));
    if (!title && annualCover) {
        title = annualCover.name;
        reportType = /(연보|연감)$/.exec(annualCover.name)?.[1] || '';
        institution = issuingBodyInText(text.split('\f').slice(0, 5).join('\f'));
        date = /(?:19|20)\d{2}/.exec(annualCover.line)?.[0] || dateFromText(text.split('\f')[0] || '') || '';
    }
    if (!title) {
        const handbook = first.filter(line => /핸드북(?:\s*\([^)]+\))?/.test(line) && line.length <= 100)
            .sort((a, b) => (b.match(/\s/g)?.length || 0) - (a.match(/\s/g)?.length || 0))[0];
        const publisher = first.find(line => /(?:주식회사|Corporation|Company)$/.test(line) || /히오키코리아|한국NSK/.test(line));
        if (handbook && publisher) {
            title = handbook.replace(/^\s*\d+\s*/, '');
            reportType = '핸드북';
            institution = publisher.replace(/^\d{4}[.\-/]\s*\d{1,2}[.\-/]?\s*/, '').replace(/\s+[A-Z]_[A-Z0-9_]+.*$/, '');
            reportNumber = first.join(' ').match(/\b[A-Z]_[A-Z0-9_]{6,}\b/)?.[0] || '';
            date = dateFromText(text) || '';
        }
    }
    if (!title || !reportType)
        return null;
    return { itemType: 'report', title: clean(title), date: date || undefined, institution: institution || undefined, reportType, reportNumber: reportNumber || undefined, language: /[가-힣]/.test(title) ? 'ko' : 'en', creators: [...new Set(creators)], numPages };
}
export function looksLikeJournalArticle(text: string): boolean {
    const front = text.split('\f').slice(0, 2).join('\n');
    const volume = /제\s*\d+\s*권|\bVol\.?\s*\d+\b/i.test(front);
    const issue = /제\s*\d+\s*호|\bNo\.?\s*\d+\b/i.test(front);
    const pages = /\bpp?\.?\s*\d+\s*[-–~]\s*\d+|(?<!\d)\d+\s*[-–~]\s*\d+\s*(?:쪽|면)/i.test(front);
    const issn = /\b[pe]?ISSN\s*[:：]?\s*\d{4}\s*-\s*\d{3}[\dX]\b/i.test(front);
    const citation = /\b\d{1,3}\s*\(\s*\d{1,3}\s*\)\s*[;:,]\s*\d{1,4}\s*[-–~]\s*\d{1,4}/.test(front);
    const venue = /(?:학회지|학회논문지|논문집|학술지|회지|저널|Journal\b|Transactions\b|Proceedings\b)/i.test(front);
    return [volume && (issue || pages), issn, citation, venue && (volume || pages || citation)].filter(Boolean).length >= 2;
}
export function parseLocalPublicationText(text: string, pageCount?: string): LocalPublicationData | null {
    const numPages = pageCount && Number(pageCount) > text.split('\f').length ? pageCount : undefined;
    const evidence = documentEvidence(text, numPages);
    const normalized = evidence.text;
    const ranked = classifyDocument(evidence);
    const leading = leadingType(ranked);
    const scoreOf = (type: DocumentType) => ranked.find(entry => entry.type === type)?.score || 0;
    const decide = (data: LocalPublicationData | null, type: DocumentType): LocalPublicationData | null => data && { ...data, confidence: Math.max(scoreOf(type), 0.5), documentType: type, evidence: ranked.find(entry => entry.type === type)?.evidence || [] };
    const degreeCover = /이\s*(?:논문|論文)을.{0,60}(?:학위|學位)\s*(?:논문|論文)/.test(normalized)
        || (/대학원|大學院|graduate\s+school/i.test(normalized) && /지도\s*(?:교수|敎授)|指導\s*(?:教|敎)?授|\badvisor\b|\bsupervisor\b/i.test(normalized));
    const thesis = looksLikeJournalArticle(normalized) && !degreeCover
        ? null : decide(parseThesis(normalized, numPages), 'thesis');
    if (thesis)
        return thesis;
    const article = decide(parseKoreanJournalArticle(normalized), 'journalArticle');
    if (article)
        return article;
    if (looksLikeJournalArticle(normalized))
        return null;
    if (leading.type === 'book') {
        const book = decide(parseLocalBook(evidence), 'book');
        if (book)
            return book;
    }
    if (leading.type === 'datasheet' || leading.type === 'manual') {
        const product = decide(parseProductDocument(evidence, leading.type), leading.type);
        if (product)
            return product;
    }
    const report = parseReport(normalized, numPages);
    const reportType: DocumentType = ['governmentReport', 'standard', 'technicalReport'].includes(leading.type) ? leading.type : 'technicalReport';
    if (report)
        return decide(report, reportType);
    if (['book', 'datasheet', 'manual'].includes(leading.type))
        return null;
    return decide(parseLocalTechnicalPublication(normalized, numPages), 'technicalReport');
}
function colophonTitle(lines: string[]): string | undefined {
    for (const line of lines) {
        const owned = line.match(/^(.{4,120}?)\s+[©Cc]\s+\S.{0,60},\s*(?:19|20)\d{2}\s*$/);
        if (owned && plausibleTitle(owned[1]))
            return owned[1];
    }
    const labelRows = new Set(readLabelCells(lines, { meanings: COLOPHON_MEANINGS, strict: true, scripts: ['ko', 'ja', 'zh'], leads: false }).map(cell => cell.row));
    const anchor = lines.findIndex((line, at) => labelRows.has(at) || /^초판(?:\s|[:：]|$)/.test(line));
    if (anchor < 0)
        return imprintTitle(lines);
    for (let i = anchor - 1; i >= Math.max(0, anchor - 4); i--) {
        if (!labelRows.has(i) && plausibleTitle(lines[i]))
            return lines[i];
    }
}
const COLOPHON_MEANINGS: ReadonlySet<Meaning> = new Set<Meaning>([...BYLINE_MEANINGS, 'publisherHouse', 'publisherPerson', 'printer', 'date']);
function imprintTitle(lines: string[]): string | undefined {
    const imprint = /^\s*(?:©|\(c\)|Copyright)(?:\s|$)/i;
    const seen = new Map<string, number>();
    for (const line of lines)
        seen.set(compact(line), (seen.get(compact(line)) || 0) + 1);
    for (let i = 0; i < lines.length - 1; i++) {
        if (!imprint.test(lines[i]))
            continue;
        const candidate = lines[i + 1];
        if (!plausibleTitle(candidate) || looksTruncatedTitle(candidate) || isNotATitle(candidate))
            continue;
        if ((seen.get(compact(candidate)) || 0) >= 2)
            return clean(candidate);
    }
}
function parseLocalBook(evidence: DocumentEvidence): LocalPublicationData | null {
    const { front, lines, numPages } = evidence;
    const isbn = scanIdentifiers({ text: front.replace(/\([^)]*ISBN[^)]*\)/gi, ' '), complete: true }).observations
        .find(entry => entry.kind === 'ISBN' && entry.confidence === 'exact')?.value || undefined;
    const imprintMarked = !!valueAfterLabel(lines, /^(?:발행처|펴낸곳|출판사|발행인|펴낸이)\s*[:：]?/)
        || lines.some(line => /(?:출판사|출판|프레스|Press|Publishers?|Publishing|Books?)$/i.test(line) && line.length <= 60);
    const stated = statementsInText(evidence.pages.slice(0, 5).map(page => page.join('\n')).join('\f')).thisEdition.publisher?.names?.[0]?.text;
    const publisher = stated || undefined;
    if (!isbn && !imprintMarked)
        return null;
    const title = colophonTitle(lines);
    if (!title || looksTruncatedTitle(title) || isNotATitle(title))
        return null;
    if (publisher && compact(title) === compact(publisher))
        return null;
    const peopleOf = (meanings: readonly Meaning[]) => {
        const cell = readLabelCells(lines, { meanings: new Set(meanings) })[0];
        return cell ? cell.value.split(/\s*[·,]\s*/).map(joinHangulSpacing).filter(validName).slice(0, 6) : [];
    };
    const creators = peopleOf(['author']);
    const editors = peopleOf(['editor']);
    const translators = peopleOf(['translator', 'translatorEditor']);
    return {
        itemType: 'book', title: clean(title), publisher: publisher ? clean(publisher) : undefined,
        date: dateFromText(front), ISBN: isbn,
        language: /[가-힣]/.test(title) ? 'ko' : 'en', creators, ...(editors.length ? { editors } : {}), ...(translators.length ? { translators } : {}), numPages
    };
}
function companyMarked(lines: string[], front: string): boolean {
    return lines.some(line => /(?:주식회사|㈜|\(주\)|(?<![\p{L}])(?:Inc|INC|Corp|CORP|Corporation|CORPORATION|Company|COMPANY|Co\.,?\s*Ltd|CO\.,?\s*LTD|Ltd|LTD|LLC|GmbH|GMBH|AG|S\.A|B\.V)\.?)$/u.test(line) && line.length <= 70 && !RIGHTS_NOTICE.test(line))
        || /(?:©|\(c\)|Copyright)\s*(?:\d{4}(?:\s*[-–]\s*\d{4})?)?\s*,?\s*((?!All\b)[A-Z][\w&.'-]*(?:\s+(?!All\b|Rights\b)[A-Z][\w&.'-]*){0,4})/.test(front)
        || /\bwww\.([a-z0-9-]{2,30})\.(?:com|co\.kr|kr|net|de|jp)\b/i.test(front);
}
const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[]\]/g, (match) => "\\" + match);
function parseProductDocument(evidence: DocumentEvidence, type: 'datasheet' | 'manual'): LocalPublicationData | null {
    const { front, lines, numPages } = evidence;
    if (looksLikeJournalArticle(front) || /\b10\.\d{4,9}\/\S+/.test(front))
        return null;
    if (!companyMarked(lines, front))
        return null;
    const institution = issuingBodyInText(evidence.pages.slice(0, 5).map(page => page.join('\n')).join('\f'));
    const MODEL = /\b[A-Z][A-Z0-9]{1,6}[-_]?\d{2,6}[A-Z0-9-]{0,8}\b/;
    const model = lines.slice(0, 25).filter(line => line.length <= 60 && !/[.!?]\s/.test(line))
        .map(line => line.match(MODEL)?.[0]).find(Boolean);
    const reportType = type === 'datasheet'
        ? (/데이터\s*시트|규격서|사양서/.test(front) ? '데이터시트' : 'Data Sheet')
        : front.match(/\b(?:user|owner'?s|operating|operation|instruction|installation|service|maintenance)\s+(?:manual|guide|handbook)\b/i)?.[0]
            || (/사용\s*설명서|취급\s*설명서|사용자\s*설명서/.test(front) ? '사용설명서' : 'Manual');
    const productLine = lines.slice(0, 25).find(line => plausibleTitle(line)
        && (!!model && line.includes(model))
        && !/^(?:https?:|www\.|Rev\b|Page\b)/i.test(line));
    const typedLine = lines.slice(0, 25).find(line => plausibleTitle(line)
        && line.length > reportType.length + 2
        && new RegExp(escapeForRegExp(reportType), 'i').test(line)
        && !/^(?:https?:|www\.|Rev\b|Page\b|©|Copyright)/i.test(line));
    const namedLine = lines.slice(0, 25).find(line => plausibleTitle(line) && line.length >= 10
        && (!institution || !new RegExp(institution.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(line))
        && !/^(?:https?:|www\.|Rev\b|Page\b|©|Copyright)/i.test(line));
    let title = clean(productLine || typedLine || namedLine || '');
    if (!title && model)
        title = `${model} ${reportType}`;
    if (!title || title.length < 8 || isNotATitle(title))
        return null;
    return {
        itemType: 'report', title: clean(title), reportType, reportNumber: model || undefined,
        institution, date: dateFromText(front),
        language: /[가-힣]/.test(title) ? 'ko' : 'en', creators: [], numPages
    };
}
export interface LocalRecognitionResult extends RecognitionResult {
    confidence: number;
    documentType: DocumentType;
    evidence: string[];
}
export async function recognizeLocalPublication(parent: any, attachment: any, before: MetadataSnapshot): Promise<LocalRecognitionResult | null> {
    const data = await Zotero.PDFWorker.getRecognizerData(attachment.id, true);
    const total = Number((data as any)?.totalPages);
    const pageCount = Number.isInteger(total) && total > 0 ? String(total) : undefined;
    const parsed = parseLocalPublicationText(await readPDFFrontMatter(attachment, data, 12, 160000), pageCount);
    if (!parsed)
        return null;
    return localPublicationResult(parent, before, parsed);
}
export function recognizeLocalPublicationText(parent: any, before: MetadataSnapshot, text: string, pageCount?: string): LocalRecognitionResult | null {
    const parsed = parseLocalPublicationText(text, pageCount);
    return parsed ? localPublicationResult(parent, before, parsed) : null;
}
function localPublicationResult(parent: any, before: MetadataSnapshot, parsed: LocalPublicationData): LocalRecognitionResult {
    const itemType = storableType(parsed.itemType);
    const candidate = new Zotero.Item(itemType);
    candidate.libraryID = parent.libraryID;
    const fields: Record<string, string | undefined> = {
        title: parsed.title, date: parsed.date, institution: parsed.institution, publisher: parsed.publisher,
        reportType: parsed.reportType, reportNumber: parsed.reportNumber, university: parsed.institution,
        thesisType: parsed.thesisType, language: parsed.language,
        pages: parsed.pages, numPages: parsed.numPages,
        publicationTitle: parsed.publicationTitle, volume: parsed.volume, issue: parsed.issue,
        ISSN: parsed.ISSN, ISBN: parsed.ISBN
    };
    for (const [field, value] of Object.entries(fields)) {
        const id = Zotero.ItemFields.getID(field);
        if (value && id && Zotero.ItemFields.isValidForType(id, candidate.itemTypeID))
            candidate.setField(id, value);
    }
    candidate.setCreators([
        ...creatorValues(parsed.creators).map(name => personCreator(name, 'author')),
        ...creatorValues(parsed.editors || []).map(name => personCreator(name, 'editor')),
        ...creatorValues(parsed.translators || []).map(name => personCreator(name, 'translator'))
    ].filter(Boolean));
    const metadataFields: Record<string, string> = {};
    for (const id of Zotero.ItemFields.getItemTypeFields(candidate.itemTypeID)) {
        const value = candidate.getField(id);
        if (value)
            metadataFields[Zotero.ItemFields.getName(id)] = value;
    }
    const metadata: MetadataSnapshot = { ...before, itemTypeID: candidate.itemTypeID, itemType, fields: metadataFields, creators: candidate.getCreators() };
    return { source: null, metadata, changes: buildDiff(before, metadata, true), confidence: parsed.confidence ?? 0.5, documentType: parsed.documentType || 'unknown', evidence: parsed.evidence || [] };
}

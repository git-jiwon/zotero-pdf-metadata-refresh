import { isDegreeFormLine, isDegreeStatement } from './degree';
import { CODE_TOKEN_SHAPE } from './title-grammar';
import { KEYWORD_LABEL_SOURCE } from './label-words';
import { KOREAN_COMMON_SURNAMES, KOREAN_COMPOUND_SURNAMES, isKoreanSurname } from '../metadata/person-name';
import { nameOfItem, personShape, personsOnly, rowIsByline, rowIsNameList } from './byline-row';
const clean = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
export const KOREAN_SURNAMES = KOREAN_COMMON_SURNAMES;
export const TWO_SYLLABLE_SURNAMES: readonly string[] = KOREAN_COMPOUND_SURNAMES;
export { isKoreanSurname };
const GENRE_LABEL = /^(?:(?:research|original|review|full|short|regular|rapid|technical|progress|invited|feature|open\s+access|hot)\s+)?(?:articles?|papers?|communications?|letters?|reviews?|reports?|notes?|protocols?|editorials?|perspectives?|commentar(?:y|ies)|correspondence|brief(?:ing)?s?|contributions?|highlights?|news\s*(?:&|and)\s*views|letters?\s+to\s+the\s+editor|matters\s+arising|comment|research)(?:\s*[•·|–-]?\s*(?:open\s+access|hot\s+paper|special\s+issue))?$|^part\s+(?:[ivxlc]+|\d+)\b/i;
export function looksLikeSectionLabel(line: unknown, next?: unknown): boolean {
    const value = clean(String(line ?? ''));
    if (!value)
        return false;
    if (GENRE_LABEL.test(value))
        return true;
    const words = value.split(/\s+/);
    if (/^\d+(?:\.\d+)+\.?\s+\p{Lu}/u.test(value) && words.length <= 8)
        return true;
    if (/^\d+\.?\s+\p{Lu}/u.test(value) && words.length <= 3)
        return true;
    if (words.length > 5 || /\d/.test(value))
        return false;
    if (words.length <= 4 && /\b(?:hot\s+paper|communications?|articles?|papers?|reviews?|letters?|highlights?|perspectives?)$/i.test(value) && /^\p{Lu}/u.test(value) && !/^(?:a|an|the)\s/i.test(value))
        return true;
    const following = clean(String(next ?? ''));
    const phrase = /\b(?:THE|A|AN)\b/.test(value) && words.length >= 3;
    if (/^[A-Z][A-Z&\s-]{2,}$/.test(value) && ((!following && !phrase) || (following && /\p{Ll}/u.test(following) && !latinPersonName(following))))
        return true;
    return /&/.test(value) && words.every(word => /^[\p{Lu}&]/u.test(word));
}
let rubricLinePattern: RegExp | null = null;
let squeezedGenrePattern: RegExp | null = null;
let rubricWithSectionPattern: RegExp | null = null;
const ACCEPTED_BANNER = String.raw `(?:authors?['’]?s?\s+)?accepted\s+(?:authors?['’]?s?\s+)?manuscripts?|authors?['’]?s?\s+manuscripts?|accepted\s+articles?|uncorrected\s+proofs?`;
const ARTICLE_RUBRIC_LINE = new RegExp(String.raw `^(?:(?:research|review|original|full|short|regular|rapid|topical|mini)[\s-]+(?:articles?|papers?|communications?|letters?|notes?|reviews?)|journal\s+pre-?proofs?|article\s+in\s+press|${ACCEPTED_BANNER}|preprint[\s,:–—-]*not\s+peer[\s-]*reviewed)(?:\s*[-–—·•:|]\s*[\p{Lu}\s&]{1,40})?$`, 'iu');
const ARTICLE_RUBRIC = { test: (value: string) => {
        if (ARTICLE_RUBRIC_LINE.test(value))
            return true;
        const space = value.indexOf(' ');
        if (space > 0 && CODE_TOKEN_SHAPE.test(value.slice(0, space)) && ARTICLE_RUBRIC_LINE.test(value.slice(space + 1)))
            return true;
        const beside = besideAFolio(value);
        return !!beside && ARTICLE_RUBRIC_LINE.test(beside);
    } };
function besideAFolio(value: string): string {
    const tokens = value.split(' ').filter(Boolean);
    if (tokens.length < 2)
        return '';
    const folio = (token: string) => /^\d{1,4}$/.test(token);
    if (folio(tokens[0]))
        return tokens.slice(1).join(' ');
    if (folio(tokens[tokens.length - 1]))
        return tokens.slice(0, -1).join(' ');
    return '';
}
export function isRubricLineWithCode(line: unknown): boolean {
    const value = clean(String(line ?? ''));
    const space = value.indexOf(' ');
    return space > 0 && CODE_TOKEN_SHAPE.test(value.slice(0, space)) && isRubricLine(value.slice(space + 1));
}
export function isRubricLine(line: unknown): boolean {
    const value = clean(String(line ?? ''));
    if (!value)
        return false;
    rubricLinePattern = rubricLinePattern || new RegExp(`^(?:${RUBRIC_WORDS})$`, 'iu');
    squeezedGenrePattern = squeezedGenrePattern || new RegExp(GENRE_LABEL.source.split('\\s+').join('\\s*'), 'i');
    const inside = value.replace(/^[《〈<＜\[［【〔「『(（]\s*/u, '').replace(/\s*[》〉>＞\]］】〕」』)）]$/u, '').trim();
    if (GENRE_LABEL.test(value) || GENRE_LABEL.test(inside) || rubricLinePattern.test(inside))
        return true;
    const beside = besideAFolio(value);
    if (beside && (GENRE_LABEL.test(beside) || rubricLinePattern.test(beside)))
        return true;
    rubricWithSectionPattern = rubricWithSectionPattern || new RegExp(`^(?:${RUBRIC_WORDS})\\s*[-–—·•:|]\\s*[\\p{Lu}\\s&]{1,40}$`, 'iu');
    if (rubricWithSectionPattern.test(value))
        return true;
    if (!/\s/.test(inside) && inside.length <= 40 && squeezedGenrePattern.test(inside))
        return true;
    const words = value.split(/\s+/);
    if (/^\d+(?:\.\d+)+\.?\s+\p{Lu}/u.test(value) && words.length <= 8)
        return true;
    if (/^\d+\.?\s+\p{Lu}/u.test(value) && words.length <= 3)
        return true;
    if (words.length > 5 || /\d/.test(value))
        return false;
    return words.length <= 4 && /\b(?:hot\s+paper|communications?|articles?|papers?|reviews?|letters?|highlights?|perspectives?)$/i.test(value) && /^\p{Lu}/u.test(value) && !/^(?:a|an|the)\s/i.test(value);
}
export function isHardFurniture(line: string): boolean {
    const value = clean(line);
    if (!value)
        return true;
    if (WEB_BANNER.test(value) || /https?:\/\/|\bwww\.[a-z0-9-]+\.|©|\bhomepage\b/i.test(value))
        return true;
    if (COPYRIGHT_NOTICE.test(value) || SELF_CITATION.test(value))
        return true;
    if (CITATION_LINE.some(pattern => pattern.test(value)))
        return true;
    if (POSTAL_ADDRESS.test(value) || AFFILIATION_LINE.test(value) || DOCUMENT_CODE.test(value))
        return true;
    if (RUNNING_HEADER.some(pattern => pattern.test(value)))
        return true;
    return peopleRow(value);
}
export function peopleRow(value: string): boolean {
    if (rowIsNameList(value) || isCitationAuthorList(value))
        return true;
    return keyedNameTokens(value) >= 2 && /\b(?:and|&)\b|,/.test(value) && value.split(/\s+/).length <= 10;
}
function keyedNameTokens(text: string): number {
    let count = 0;
    for (const token of text.split(/\s+/)) {
        const chars = Array.from(token);
        let digitsFrom = chars.length;
        while (digitsFrom > 0 && /[\d,]/.test(chars[digitsFrom - 1]))
            digitsFrom--;
        if (digitsFrom === chars.length || !/\d/.test(chars[digitsFrom]))
            continue;
        let runFrom = digitsFrom;
        while (runFrom > 0 && /[\p{L}'’.-]/u.test(chars[runFrom - 1]))
            runFrom--;
        const opensAt = (at: number) => at > runFrom || runFrom === 0 || !/\d/.test(chars[runFrom - 1]);
        let streak = 0;
        for (let at = runFrom; at < digitsFrom; at++) {
            streak = /\p{L}/u.test(chars[at]) ? streak + 1 : 0;
            if (streak >= 4 && opensAt(at - streak + 1)) {
                count++;
                break;
            }
        }
    }
    return count;
}
export function isCitationAuthorList(line: unknown): boolean {
    const whole = clean(String(line ?? ''));
    return /^(?:[\p{Lu}]\.\s*;\s*(?:[\p{Lu}][\p{L}'’-]+,\s*(?:[-‐‑–]?[\p{Lu}]\.\s*){1,3}[;.]?\s*)+|(?:[\p{Lu}][\p{L}'’-]+,\s*(?:[-‐‑–]?[\p{Lu}]\.\s*){1,3}[;.]?\s*){2,})/u.test(whole);
}
export const DOCUMENT_PART_NAMES: ReadonlySet<string> = new Set(['제출문', '목차', '차례', '초록', '요약', '요약문', '서론', '결론',
    '본문', '부록', '별표', '색인', '표지', '개요', '머리말', '맺음말', '감사의글', '참고문헌',
    '인사말', '서문', '발간사', '추천사', '편집후기', '일러두기', '배경', '방법', '고찰', '제언', '전망',
    '명세서', '청구범위', '청구의범위', '요약서', '도면', '대표도',
    'introduction', 'contents', 'references', 'acknowledgements', 'acknowledgments', 'acknowledgement', 'acknowledgment', 'chapter']);
export const isDocumentPartName = (value: unknown): boolean => DOCUMENT_PART_NAMES.has(String(value ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase());
const TITLE_NOUNS = ['연구', '한국', '서울', '정보', '정책', '전략', '설계', '성능', '구조', '안전', '조건', '방안', '기반', '기초', '원리'];
const DOCUMENT_PART = new Set([...DOCUMENT_PART_NAMES, ...TITLE_NOUNS]);
const NOT_A_NAME_ENDING = /(?:사|론|법|술)$/;
const FIELD_OF_STUDY = /^[가-힣]학$|[리치류고의공역과어질계물육회]학$/;
const opensWithTwoSyllableSurname = (name: string) => TWO_SYLLABLE_SURNAMES.includes(name.slice(0, 2));
export function notAKoreanName(value: unknown): boolean {
    const name = clean(String(value ?? '')).replace(/\s+/g, '');
    return /^[가-힣]다$/.test(name) || DOCUMENT_PART.has(name) || NOT_A_NAME_ENDING.test(name) || FIELD_OF_STUDY.test(name);
}
export function isPersonalName(value: string): boolean {
    const name = clean(value).replace(/[·]/g, '');
    if (/^[\p{Script=Han}][\p{Script=Han}가-힣]{1,3}$/u.test(name))
        return true;
    if (/^[가-힣]다$/.test(name))
        return false;
    if (DOCUMENT_PART.has(name))
        return false;
    if (!/^[가-힣]{2,4}$/.test(name))
        return false;
    if (NOT_A_NAME_ENDING.test(name) || FIELD_OF_STUDY.test(name))
        return false;
    if (name.length === 4)
        return opensWithTwoSyllableSurname(name);
    return KOREAN_SURNAMES.includes(name[0]) || opensWithTwoSyllableSurname(name);
}
const latinPersonName = (value: string) => /\p{Script=Latin}/u.test(value) && !/[가-힣\p{Script=Han}]/u.test(value) && personShape(clean(value)).person !== 'no';
export const isWesternPersonName = (value: string): boolean => latinPersonName(value);
export const looksLikeCreatorList = (line: string): boolean => peopleRow(clean(String(line ?? '')));
export function personNamesInList(value: unknown): string[] | null {
    const text = clean(String(value ?? ''));
    if (!text || text.length > 400 || !rowIsByline(text, 'strict'))
        return null;
    const items = personsOnly(text);
    return items && items.length >= 2 ? items.map(nameOfItem) : null;
}
export const isPersonNameList = (value: unknown): boolean => personNamesInList(value) !== null;
function looksLikePersonName(line: string): boolean {
    const value = clean(line);
    if (!/[A-Z]\.\s/.test(value) && !/,\s*[A-Z]/.test(value))
        return false;
    return /^(?:[A-Z][\p{L}'’-]+|(?:[A-Z]\.){1,3})(?:[,]?\s+(?:[A-Z][\p{L}'’-]+|(?:[A-Z]\.){1,3})){1,4}$/u.test(value);
}
const SERIES_OR_IMPRINT = [
    /\b(?:Notes|Texts|Series|Briefs|Studies|Monographs|Lectures)\s+in\b[^\d]{0,60}(?:\bVol(?:ume)?\.?\s*)?\d{1,4}\s*$/i,
    /\b(?:Notes|Texts|Series|Briefs|Monographs|Lectures)\s+in\s+(?!the\b|a\b|an\b|this\b|our\b|its\b|my\b)[\p{L}]+(?:\s+(?:and|of|for|[\p{L}]+)){0,4}$/iu,
    /\bis\s+an\s+imprint\s+of\b/i,
    /\bPublisher(?:s)?$/i
];
const SERIES_SET = /^(?!.*\b(?:[Tt]he|[Aa]n?)\s)(?!.*\b(?:Independent|Dominating|Hitting|Feedback|Vertex|Edge|Convex|Compact|Closed|Open|Cantor|Julia|Mandelbrot|Level|Power|Fuzzy|Rough|Maximal|Minimal|Maximum|Minimum|Feasible|Invariant|Reachable|Training|Test|Data)\s+Set$)(?=.*(?<!\w)(?:\w+\s+){3}Set$)/;
export const KOREAN_ORGANISATION_ENDING = '(?:부|청|처|공단|공사|진흥원|연구원|연구소|과학원|기술원|개발원|평가원|정책원|학회|협회|협의회|재단|위원회|센터|본부|대학원|대학교|대학|학교|조합|은행|병원|정부|의회|법원|박물관|도서관|미술관|방송|신문|그룹|주식회사|㈜|남도|북도|경기도|강원도|제주도|특별시|광역시|자치시|자치도|군청|구청|시청|도청)';
const ORGANISATION_SUFFIX = new RegExp(`${KOREAN_ORGANISATION_ENDING}$`);
const PUBLISHER_HOUSE_KO = /^[가-힣]{2,4}사$/;
const joinedHangulGlyphs = (line: string) => clean(line).replace(/(?<=[가-힣\p{Script=Han}])\s+(?=[가-힣\p{Script=Han}](?:\s|$))/gu, '');
export function isPublisherHouseName(line: string): boolean {
    return PUBLISHER_HOUSE_KO.test(joinedHangulGlyphs(line));
}
export function isInstitutionName(line: string): boolean {
    const value = joinedHangulGlyphs(line);
    if (/^[가-힣]{3,20}$/.test(value) && ORGANISATION_SUFFIX.test(value))
        return true;
    return /^[\p{Script=Han}]{2,12}(?:社|株式會社|株式会社|出版|出版社|書店|書院|書房|文庫|學會|学会|協會|協会|研究所|大學|大学|敎育|教育)$/u.test(value);
}
export function isOrganisationName(line: string): boolean {
    return isInstitutionName(line) || isPublisherHouseName(line);
}
const PUBLISHING_WORD = /(?<![\p{L}])(?:press|publish(?:ers?|ing)|publications?|verlag|[ée]ditions?|books)(?![\p{L}])/iu;
const PUBLISHING_KO = /(?:출판(?:사|부)?|프레스)$|^도서\s*출판/u;
const PUBLISHING_HAN = /\p{Script=Han}(?:出版社?|書店|書院|書房|文庫|書局)$|(?<=\p{Script=Han})(?<![会會])社$/u;
export const EDITION_STATEMENT = /^(?:\p{L}+|\d{1,2}(?:st|nd|rd|th)?)\s+[ée]ditions?$/iu;
export function isPublishingHouse(name: unknown): boolean {
    const value = clean(String(name ?? '')).replace(/[.,;:\s]+$/, '');
    if (!value || EDITION_STATEMENT.test(value))
        return false;
    const joined = joinedHangulGlyphs(value);
    return isPublisherHouseName(value) || PUBLISHING_WORD.test(value) || PUBLISHING_KO.test(joined.replace(/\s+/g, '')) || PUBLISHING_HAN.test(joined.replace(/\s+/g, ''));
}
const ORGANISATION_HEAD = /(?<![\p{L}'’])(?:Societ(?:y|ies)|Association|Corporation|Institutes?|Institutions?|Foundation|Laborator(?:y|ies)|Universit(?:y|ies)|College|Academy|Council|Committee|Ministry|Agency|Bureau|Administration|Press|Publishers?|Publications?|Publishing|Consortium|Federation|Organi[sz]ation|Archives?|Librar(?:y|ies))(?:\s+(?:of|for)\s+[A-Z][\p{L}-]+)?\.?$|(?<![\p{L}'’-])(?:Inc|Ltd|LLC|GmbH|Corp|Co|PLC|AG|BV|SA)\.?$/iu;
const TITLE_CASE_PHRASE = /^[A-Z][\p{L}\d'’.&-]*(?:\s+(?:of|and|for|the|in|&|[A-Z][\p{L}\d'’.&-]*)){1,4}$/u;
const SECTION_BANNER = /^[A-Z][A-Z\d.-]*(?:\s+[A-Z][A-Z\d.-]*)?\s*[&/]\s*[A-Z][A-Z\d.-]*(?:\s+[A-Z][A-Z\d.-]*)?$/;
export function isOrganisationOnly(value: string): boolean {
    const name = String(value ?? '').replace(/,\s*(?=(?:Inc|Ltd|LLC|GmbH|Corp|Co|PLC|AG|BV|SA)\.?$)/i, ' ');
    return TITLE_CASE_PHRASE.test(name) && ORGANISATION_HEAD.test(name);
}
const FRONT_MATTER_BOILERPLATE = [
    /\bintentionally\s+left\s+blank\b/i,
    /^(?:[A-Za-z]+\s+)?EDITION$/i,
    /^(?:ABSTRACT|CONTENTS|PREFACE|INDEX|FOREWORD|APPENDIX|GLOSSARY|BIBLIOGRAPHY|ACKNOWLEDG(?:E)?MENTS?|NOTES?|DEDICATION|COLOPHON)$/i,
    /^(?:초록|목차|차례|서문|머리말|감사의\s*글|판권|색인)$/,
    /^(?:명\s*세\s*서|청구\s*범위|요\s*약\s*서|요\s*약|도\s*면|도면의\s*간단한\s*설명|발명의\s*설명|개\s*요|부\s*록|본\s*문|표\s*지)$/,
    /^\s*(?:©|\(c\))/i,
    /\ball\s+rights\s+reserved\b/i,
    /\bopen[-\s]access\s+article\s+distributed\s+under\b|\bdistributed\s+under\s+the\s+terms\s+of\s+the\s+creative\s+commons\b|\bcreative\s+commons\s+attribution\b/i,
    /^Edited\s+by\b/i,
    /^(?:series\s+|associate\s+|managing\s+|founding\s+)?(?:editors?|editors?-in-chief|editorial\s+board|advisory\s+board)\s*[:：]?$/i,
    /\bcataloging[-\s]in[-\s]publication\b|^library\s+of\s+congress\s+(?:cataloging|control\s+number)\b/i,
    /^(?:By|Translated\s+by)\s+[A-Z]/,
    /^(?:First|Originally)\s+published\b/i,
    /\bcopyright\s*(?:©|\(c\)|\d{4})/i,
    /^(?:a\s+)?(?:thesis|dissertation)\s+(?:for|submitted)\b.{0,80}$/i,
    /^(?:\S+\s+)?published\s+by\b/i,
    /^(?:Chapter|Part|Section|Unit|Lesson|Lecture)\s+\d+[A-Za-z]?$/i
];
const RUNNING_HEADER = [
    /\(\s*(?:19|20)\d{2}\s*\)\s*\d+\s*[:,]/,
    /\b\d{1,4}\s*\(\s*(?:19|20)\d{2}\s*\)\s*\d{4,}/,
    /\bdoi\s*[:：]\s*10\.\d{4,9}\//i,
    /https?:\/\//i,
    /\b[a-z0-9-]{3,}\.(?:com|org|net|edu|gov)\b/i,
    /(?:19|20)\d{2}\s*년\s*제\s*\d+\s*호/,
    /제\s*\d+\s*호\s*$/,
    /^\s*(?:Vol\.?|Volume)\s*\d+/i,
    /^\p{Lu}\p{L}+(?:\s+\p{Lu}{1,3}\.?)?,?\s+et\s+al\.?\s*[•·|—–-]/u,
    /^\p{Lu}\p{L}+(?:\s+\p{Lu}{1,3}\.?)?,?\s+et\s+al\.?\s*$/u,
    /\bcontents\s+lists\s+available\s+at\b/i,
    /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\s*,\s*(?:1[5-9]|20)\d{2}\.?$/i,
    /^(?:1[5-9]|20)\d{2}\s*[.년]\s*\d{1,2}\s*[.월]\s*\d{1,2}\s*[.일]?$/,
    /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+(?:1[5-9]|20)\d{2}\s*[-–—|·]/i
];
const OPENING_MARKS: Array<[
    string,
    string
]> = [['(', ')'], ['[', ']'], ['“', '”'], ['‘', '’'], ['"', '"'], ["'", "'"], ['”', '“'], ['’', '‘']];
function opensWithoutClosing(line: string): boolean {
    const value = String(line ?? '').trim();
    const mark = OPENING_MARKS.find(([open]) => value.startsWith(open));
    return !!mark && !value.slice(1).includes(mark[1]);
}
const IN_TEXT_CITATION = /(?:[\p{L}\p{N})]|\b(?:al|Refs?|refs?)\.)\s?\[\d{1,2}(?:\s*[,，–-]\s*\d{1,2})*\](?=\s|[,.;:)]|$|[가-힣])/u;
export function hasInTextCitation(line: unknown): boolean {
    return IN_TEXT_CITATION.test(clean(String(line ?? '')));
}
const KEYWORD_LABEL = new RegExp(`^(?:${KEYWORD_LABEL_SOURCE})(?:\\s*[:：.—–-]\\s*|\\s+)(?=\\S)`, 'iu');
function isKeywordList(value: string): boolean {
    const label = KEYWORD_LABEL.exec(value);
    if (!label)
        return false;
    return (value.slice(label[0].length).match(/[,;，；]/g) || []).length >= 2;
}
const CONTINUED_LIST = /^[(（][^()（）]{1,40}[)）]\s*[,;，；]\s*\S/u;
const BODY_PROSE = [
    /^\s*\(?\d+[).]\s*\d*[).]?\s*(?:서\s*론|결\s*론|본\s*론|서\s*언|개\s*요)/,
    /^\s*(?:서\s*론|결\s*론|본\s*론|초\s*록|요\s*약|고\s*찰|실\s*험)\b/,
    /^\s*(?:\(?\d+[).](?!\d)|제\s*\d+\s*[장절])\s*\S/,
    /^\s*[IVXivx]{1,4}\.\s*\S+(?:\s+\S+){0,4}\s*$/,
    /(?:한다|하였다|이다|있다|없다|된다|였다|린다|진다)(?:[.,)]|$)/,
    /\([^)]*$/,
    IN_TEXT_CITATION
];
const PERMISSION_NOTICE = [
    /\b(?:is|are)\s+(?:hereby\s+)?(?:granted|permitted|prohibited|licen[sc]ed|authori[sz]ed)\b/i,
    /\bmay\s+(?:not\s+)?be\s+(?:reproduced|copied|distributed|transmitted|stored|resold)\b/i,
    /\bno\s+part\s+of\s+this\b/i,
    /\bnot\s+for\s+resale\b/i,
    /\b(?:should|must|may|can)\s+be\s+(?:sent|addressed|directed|submitted|forwarded|mailed)\s+to\b/i
];
export function looksLikeBodyProse(line: string): boolean {
    const value = clean(line);
    if (PERMISSION_NOTICE.some(pattern => pattern.test(value)))
        return true;
    return BODY_PROSE.some(pattern => pattern.test(value));
}
const POSTAL_ADDRESS = /(?:시|도|군|구)\s+\S{1,20}(?:로|길|동|읍|면|리)\s*\d|\b\d{1,4}동\s*\d{1,5}호\b|\b(?:Suite|P\.?O\.?\s*Box)\b|\b\d{1,3}(?:st|nd|rd|th)?\s+Floor\b|\bFloor\s+\d{1,3}\b|\bc\/o\b/i;
const AFFILIATION_LINE = /\b\d{3,6}(?:-\d{3,4})?,\s*\p{Lu}\p{L}+\b|(?=[^]*\b(?:Institute|University|Universität|Agency|Laborator(?:y|ies)|Department|Faculty|Ministry|Academy|Cent(?:er|re)|College|School|Hospital|Corporation|Foundation|연구원|연구소|대학교|대학|학과|재단|공사|청|원)\b)\([A-Z]{2,6}\)[^()]*,[^()]*\([A-Z]{2,6}\)/u;
const DOCUMENT_CODE = /(?<![A-Za-z0-9])[A-Za-z0-9]+_[A-Za-z0-9]+_[A-Za-z0-9_]+|_(?:preliminary|draft|final|rev\d*)\b/i;
function looksGlyphSpaced(line: string): boolean {
    const tokens = clean(line).split(' ').filter(Boolean);
    const latin = tokens.filter(token => /^[A-Za-z.,'’-]+$/.test(token));
    if (latin.length >= 3 && latin.filter(token => /^[A-Za-z]{1,2}$|^[.,'’-]+$/.test(token)).length / latin.length >= 0.6)
        return true;
    const opening = tokens[0] || '', second = tokens[1] || '';
    if (/^[A-Za-z]{1,2}$/.test(opening) && opening !== opening.toUpperCase()
        && (/^[a-z]/.test(opening) || /^[A-Za-z]{1,2}$/.test(second))
        && !/^(?:a|i|an|at|be|by|do|go|he|if|in|is|it|me|my|no|of|on|or|so|to|up|us|we|oh|ok|vs|el|la|le|de|du|un|la|il|di|da|al|en|et|ex|re|se|si|un|um|ab|ad|ob|ut|eu|ja|ye|yo|ah)$/i.test(opening))
        return true;
    if (tokens.length < 4)
        return false;
    const single = tokens.filter(token => /^[가-힣\p{Script=Han}]$/u.test(token)).length;
    return single / tokens.length >= 0.5;
}
const WEB_BANNER = /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+){1,3}(?:\/\S*)?$/i;
const COPYRIGHT_NOTICE = /(?:©|ⓒ)\s*(?:\d{4}|\p{Lu})|\bcopyright\b\s*(?:©|ⓒ|\d{4})/iu;
const SELF_CITATION = /^\s*cite\s+this\s*[:：]/i;
const CITATION_LINE = [
    /^[\p{L}][\p{L}.\s&-]{2,60},\s*(?:1[5-9]|20)\d{2}\s*,\s*\d{1,4}\s*,\s*\d{1,7}/u,
    /^[\p{Lu}][\p{L}&.\s-]{3,60},?\s+VOL\.?\s*\d{1,4}\b/iu,
    /^[\p{Lu}][\p{L}&.\s-]{3,60},\s+(?:[A-Z][a-z]{2,8}\s+)?(?:1[5-9]|20)\d{2},\s+Vol\.?\s*\d{1,4}\b/iu,
    /^(?:download\s+details|view\s+(?:article\s+online|journal|issue)|home\s+search\s+collections)\b/i,
    /\bthis\s+content\s+(?:was|has\s+been)\s+downloaded\b/i,
    /\bterms\s+and\s+conditions\s+apply\b/i,
    /^[\p{Lu}][\p{Lu}\s]{4,40}\s+\d{1,4},\s*\d{4,7}\s*\D{0,2}(?:1[5-9]|20)\d{2}/u,
    /\b(?:1[5-9]|20)\d{2}\s+[A-Z][a-z]{2,8}\s*;\s*\d{1,4}\s*\(\s*\d{1,4}\s*\)\s*:\s*\d{1,6}\s*[-–—]\s*\d{1,6}/,
    /\b\d{1,4}\s*\(\s*(?:1[5-9]|20)\d{2}\s*\)\s*\d{1,7}\b/,
    /\b\d{1,4}\s*:\s*\d{1,4}\s*,\s*\d{1,6}\s*[-–—]\s*\d{1,6}\b/
];
const LISTED_INITIALS = /^((?:[\p{Lu}l]\p{L}?\.){1,3})(.*)$/u;
const LISTED_PARTICLE = /^(?:van|von|der|den|de|del|della|di|da|du|la|le)$/;
const LISTED_SURNAME = /^\p{Lu}[\p{L}'’-]+$/u;
const LISTED_EDITOR = /^\(eds?\.\)$/;
function listedAuthors(head: string): boolean {
    const tokens = head.split(/\s+/).filter(Boolean);
    let at = 0, authors = 0, trailing = false;
    while (at < tokens.length) {
        if (authors && tokens[at] === 'and')
            at++;
        let initials = 0, surname = '';
        while (at < tokens.length) {
            const found = LISTED_INITIALS.exec(tokens[at]);
            if (!found)
                break;
            initials += (found[1].match(/\./g) || []).length;
            if (initials > 3)
                return false;
            at++;
            if (found[2]) {
                surname = found[2];
                break;
            }
        }
        if (!initials)
            return false;
        if (!surname) {
            while (at < tokens.length && LISTED_PARTICLE.test(tokens[at]))
                at++;
            if (at >= tokens.length)
                return false;
            surname = tokens[at++];
        }
        let separated = surname.endsWith(',');
        if (separated)
            surname = surname.slice(0, -1);
        const glued = /^(.+?)\((eds?\.)\)$/.exec(surname);
        if (glued)
            surname = glued[1];
        if (!LISTED_SURNAME.test(surname))
            return false;
        if (!separated && !glued && at < tokens.length) {
            const editor = tokens[at].replace(/,$/, '');
            if (LISTED_EDITOR.test(editor)) {
                separated = tokens[at].endsWith(',');
                at++;
            }
        }
        authors++;
        trailing = separated;
    }
    return authors > 0 && !trailing;
}
export const LISTED_BOOK = {
    test(line: unknown): boolean {
        const value = String(line ?? '');
        const colon = value.indexOf(':');
        if (colon <= 0 || /^\s/.test(value) || !/^:\s+\p{Lu}/u.test(value.slice(colon, colon + 80)))
            return false;
        return listedAuthors(value.slice(0, colon).trimEnd());
    }
};
const PUBLISHER_BOILERPLATE: Array<{
    test(value: string): boolean;
}> = [
    /^(?:the\s+)?(?:international\s+|european\s+|japanese\s+|korean\s+|american\s+|british\s+)?journal\s+(?:of|for)\b/i,
    /^(?:ieee\s+)?transactions\s+on\b/i,
    /^full\s+terms\s*&\s*conditions\b/i,
    /^(?:received|accepted|revised|published(?:\s+online)?)\b\s*[:：]?\s*\p{L}*\s*\d/iu,
    /^please\s+do\s+not\s+adjust\s+margins/i,
    /^fig(?:ure|s?\.)\s*\d/i,
    /^corresponding\s+authors?\s*[:：]?$/i,
    /^(?:[Pp]rinted|PRINTED)\s+(?:(?:and|AND)\s+(?:bound|BOUND)\s+)?(?:in|IN)\s+(?:(?:the|THE)\s+)?\p{Lu}[\p{L}.'’-]*(?:\s+\p{Lu}[\p{L}.'’-]*){0,3}\s*\.?$/u,
    /^[\p{L}\s&:.,'’-]{3,80}\s\d{1,4}\s*[:,]\s*\d{1,5}\s*[–-]\s*\d{1,5}\b/u,
    /^[\p{L}\s&:.'’-]{3,80}\s(?:19|20)\d{2},\s*\d{1,4},\s*\d{1,6}$/u,
    /^[\p{L}\s&:.'’-]{3,80}\svolume\s+\d+,\s*number\s+\d+/iu,
    /^[\p{L}-]+\s+et\s+al\.,\s.*\d{4}/u,
    /^(?:vol\.?|volume)\s*\d/i,
    /^in\s*:\s+\p{Lu}/iu,
    /^\d{1,2}(?:Department|School|College|Institute|Laboratory|Faculty|Cent(?:er|re)|Division)\b/,
    /^\d{1,2}\s+[\p{Lu}][^,]{3,70}\b(?:Department|School|College|Institute|University|Laboratory|Cent(?:er|re)|Faculty|Technology|Engineering|Agency)\b[^,]*,\s*\p{Lu}/u,
    /^[%*†‡§¶#]\s*(?:Dept\.?|Department|School|Institute|College|Laboratory|Faculty)\b/i,
    /^check\s+for\s+updates$/i,
    /^information\s+(?:from|courtesy\s+of)\b/i,
    /^(?:abbreviations|funding\s+information|author\s+contributions|conflicts?\s+of\s+interest|data\s+availability)\s*[:：]?$/i,
    /^ed(?:s|ited)?\.?\s+by\b/i,
    LISTED_BOOK,
    /\brights\s+reserved\b/i,
    /\bcopyright\b\s*(?:©|\(c\)|\d{4})/i,
    /,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/,
    /^#/,
    /^[\p{Lu}][\p{L}.\s-]{1,30},\s*(?:(?:the\s+)?(?:People['’]?s\s+)?Republic\s+of\s+|P\.?\s?R\.?\s+)?(?:Korea|China|Japan|Germany|USA|U\.S\.A\.|UK|United\s+Kingdom|United\s+States|India|France|Italy|Spain|Taiwan|Singapore|Australia|Canada|Netherlands|Switzerland|Sweden|Israel|Iran|Vietnam)\.?$/u
];
export function publicationSentenceOpen(line: unknown): boolean {
    const value = clean(String(line || ''));
    if (!value)
        return false;
    if (!PUBLISHER_BOILERPLATE.some(pattern => pattern.test(value)) && !COPYRIGHT_NOTICE.test(value))
        return false;
    return /[,;]$/.test(value) || /\b(?:by|with|from|through|of|and|in|to|for|at|&|und|par|por)$/i.test(value);
}
const STRONG_WELD = /[A-Za-z]\d[a-z]|\p{L}[%@#$^*~†‡]\p{L}/u;
const WEAK_WELD = /^\d[a-z]/;
const numberish = (token: string) => /^\d{1,4}(?:st|nd|rd|th)$/i.test(token) || /^\d+(?:[.,]\d+)*$/.test(token);
export function glyphNoise(line: string): boolean {
    const tokens = clean(line).split(/\s+/).filter(Boolean);
    if (!tokens.length)
        return false;
    const strong = tokens.filter(token => !numberish(token) && STRONG_WELD.test(token)).length;
    const weak = tokens.filter(token => !numberish(token) && !STRONG_WELD.test(token) && WEAK_WELD.test(token)).length;
    if (strong >= 1 && tokens.length >= 4 && (strong + weak >= 3 || (strong + weak) / tokens.length >= 0.2))
        return true;
    const weld = /[A-Za-z][\p{Script=Han}]|[\p{Script=Han}][A-Za-z]|[A-Za-z][“『』「」]|[“『』「」][A-Za-z]/u;
    const damaged = tokens.filter(token => weld.test(token)).length;
    if (!damaged)
        return false;
    return tokens.length <= 4 || damaged >= 2 || damaged / tokens.length >= 0.4;
}
const BODY_LINE = /^(?:the\s+)?(?:office|chair|department|division|faculty|school|college|institute|laborator(?:y|ies)|centre|center|bureau|agency|directorate|commission|secretariat|programme|program|project)\s+(?:of|for|on)\s+\p{L}/iu;
const BODY_WITH_ACRONYM = /\b(?:agency|foundation|council|ministry|administration|institute|university|laborator(?:y|ies)|department|academy|cent(?:er|re)|corporation)\b[^\n()]{0,40}\([A-Z]{2,8}\)\s*[,;]?\s*$|^\s*(?:grant|award|contract|project)\s*(?:no\.?|number|#)/i;
export function namesABodyNotAWork(line: unknown): boolean {
    const value = clean(String(line ?? ''));
    if (!value)
        return false;
    const words = value.split(/\s+/).filter(Boolean).length;
    if (words > 12)
        return false;
    if (BODY_WITH_ACRONYM.test(value))
        return true;
    return words <= 8 && BODY_LINE.test(value);
}
export const RUBRIC_WORDS = [
    '(?:연구|학술|원저|기획|특집|초청|초대|특별|일반|심사|투고|기술|리뷰|종설|총설)\\s*논문', '학위\\s*논문', '학술지\\s*논문', '논문',
    '연구\\s*(?:노트|자료|보고서?|동향|논단|단신)', '기술\\s*(?:자료|보고서?|노트|해설|리포트)', '원저', '종설', '총설', '총론', '논단',
    '특집(?:\\s*기획)?', '기획(?:\\s*특집)?', '(?:특별|초청)?\\s*기고', '사례\\s*(?:보고|연구)', '단신', '리뷰', '논평', '서평', '해설', '강좌', '권두언', '칼럼',
    '(?:학술|연구)\\s*기사', '보고서', '특허', '기사', '단행본', '도서', '저널',
    'journal\\s*article', 'thesis', 'dissertation', 'patent', 'book', 'preprint', 'minireview',
    '(?:(?:research|original|review|full|short|regular|rapid|technical|progress|invited|feature|brief|case|mini|special|open\\s+access|hot|topical)\\s+)?'
        + '(?:articles?|papers?|communications?|letters?|reviews?|reports?|notes?|protocols?|editorials?|perspectives?|commentar(?:y|ies)|correspondence'
        + '|brief(?:ing)?s?|contributions?|highlights?|news\\s*(?:&|and)\\s*views|letters?\\s+to\\s+the\\s+editor|matters\\s+arising|comment|research)',
    'journal\\s+pre-?proofs?', 'article\\s+in\\s+press', ACCEPTED_BANNER,
    'preprint[\\s,:–—-]*not\\s+peer[\\s-]*reviewed',
    '(?:原著|研究|技術|速報|報文)?\\s*論文', '総説', '短報', '速報', '解説', '研究報告', '技術報告', '研究(?:论文|報告|报告)', '综述', '论文', '研究简报', '简报'
].join('|');
export const DOCUMENT_KIND = /^(?:(?:[가-힣]{1,4}학\s*)?(?:석사|박사)\s*학위\s*(?:청구\s*)?논문|학위논문|연구보고서|최종\s*보고서|보고서|(?:master['’]?s|doctoral|ph\.?\s*d\.?)\s+(?:thesis|dissertation)|data\s*sheet|datasheet|user\s*manual|manual|installation\s*guide|white\s*paper|technical\s*note|application\s*note|preprint|original\s*(?:article|paper)|research\s*article|review(?:\s*article)?|seminar(?:\s*(?:paper|report))?|term\s*paper|lecture\s*notes?)$/i;
const RUBRIC_BRACKETS: Array<[
    string,
    string
]> = [['《', '》'], ['〈', '〉'], ['<', '>'], ['＜', '＞'], ['[', ']'], ['［', '］'], ['【', '】'], ['〔', '〕'],
    ['「', '」'], ['『', '』'], ['(', ')'], ['（', '）']];
const escapeForPattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LEADING_RUBRIC = new RegExp(`^\\s*(?:${RUBRIC_BRACKETS.map(([open, close]) => `${escapeForPattern(open)}\\s*(?:${RUBRIC_WORDS})\\s*${escapeForPattern(close)}`).join('|')})\\s*[:：·\\-–—]?\\s*`, 'iu');
const CATALOGUE_FORM = /\s*\[(?:전자\s*자료|전자\s*책|전자\s*저널|electronic resource|전자\s*형태|비도서\s*자료|마이크로\s*형태\s*자료|녹음\s*자료|영상\s*자료|지도\s*자료|점자\s*자료)\](?:\s*([:/;=])\s*(.*))?$/i;
export function withoutGenreTag(title: unknown): string {
    const value = String(title ?? '');
    let opened = value;
    for (let round = 0; round < 3; round++) {
        const next = opened.replace(LEADING_RUBRIC, '');
        if (next === opened)
            break;
        opened = next;
    }
    const bare = opened.replace(CATALOGUE_FORM, (_whole, mark: string | undefined, tail: string | undefined) => {
        const rest = String(tail || '').replace(/\s*\/\s.*$/, '').trim();
        if (mark === ':' && rest && !isOrganisationOnly(rest) && !isInstitutionName(rest))
            return `: ${rest}`;
        return '';
    }).trim();
    return bare.length >= 4 ? bare : value;
}
export function startsMidWord(value: unknown): boolean {
    const text = clean(String(value ?? ''));
    if (!text)
        return false;
    let depth = 0;
    for (const ch of text) {
        if (ch === '(' || ch === '[' || ch === '（' || ch === '［')
            depth++;
        else if (ch === ')' || ch === ']' || ch === '）' || ch === '］') {
            if (depth === 0)
                return true;
            depth--;
        }
    }
    return false;
}
const WRAPPED_IN_MARKS = /^\s*([=~*\-—–_]{1,3})\s*(.+?)\s*\1\s*$/;
export function wrappedInPageMarks(value: unknown): boolean {
    const match = WRAPPED_IN_MARKS.exec(clean(String(value ?? '')));
    return !!match && match[2].trim().length > 0;
}
export function twoTitlesWelded(value: unknown): boolean {
    const text = clean(String(value ?? ''));
    const seam = /^(.{8,})\s+[:：]\s*(.{8,})$/.exec(text) || /^(.{8,}[^\s:：])[:：](\S.{8,})$/.exec(text);
    if (!seam)
        return false;
    const hangul = (side: string) => /[가-힣]/.test(side);
    const latin = (side: string) => /[A-Za-z]{4}/.test(side);
    return (hangul(seam[1]) && !hangul(seam[2]) && latin(seam[2]))
        || (!hangul(seam[1]) && latin(seam[1]) && hangul(seam[2]));
}
const CORRECTION_NOTICE = /^\s*(?:corrigendum|erratum|corrections?|addendum|retraction|withdrawal|publisher'?s?\s+note|editorial\s+expression\s+of\s+concern|정오표|정정)\b/i;
const LATIN_MONTH = String.raw `(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const CJK_MONTH_ISSUE = String.raw `(?:((?:19|20)\d{2})\s*[年년]\s*)?(?<!\d)(0?[1-9]|1[0-2])\s*[月월]\s*(?:号|號|호)`;
const LATIN_MONTH_ISSUE = String.raw `\b(${LATIN_MONTH})\.?\s+((?:19|20)\d{2})\s+issue\b`;
export const ISSUE_NUMBERS = new RegExp([
    String.raw `(?:(?:제|第)\s*)?\d{1,4}\s*(?:권|卷|巻)\s*[,，•·‧∙|/]?\s*(?:(?:제|第)\s*)?\d{1,4}\s*(?:호|號|号)`,
    String.raw `\bvol(?:ume)?\.?\s*\d{1,4}\s*[,.;:•·‧∙|/–—-]?\s*(?:\(\s*\d{1,4}\s*\)|(?:no|number|issue|iss)\.?\s*\d{1,4})`,
    String.raw `(?:19|20)\d{2}\s*(?:[A-Z][a-z]{2,8}\.?\s*)?(?:\d{1,2}\s*)?;\s*\d{1,4}\s*\(\s*[\d-]{1,7}\s*\)`,
    CJK_MONTH_ISSUE,
    LATIN_MONTH_ISSUE
].join('|'), 'iu');
const ISSUE_HEAD = new RegExp(String.raw `^\s*(?:[《〈<＜\[［【〔「『(（]\s*)?(?:(?:논문|국문|영문)\s*(?:요약|초록)|요\s*약|초\s*록|abstract|summary|${RUBRIC_WORDS})(?:\s*[》〉>＞\]］】〕」』)）])?\s*`, 'iu');
const DATE_OR_PAGES = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?|\b(?:spring|summer|fall|autumn|winter)\b|pp?\.|쪽|페이지|[년월일年月日]|e?\d+/gi;
const ISSUE_TAIL = /^[\s,.:;()[\]/\-–—~·•‧∙|]*$/u;
const NAME_TRAILER = /[\s,，.;:•·‧∙|/–—]+$/u;
const MONTH_ISSUE = new RegExp(`${CJK_MONTH_ISSUE}|${LATIN_MONTH_ISSUE}`, 'iu');
const MONTH_ORDER = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function monthNamedIssue(value: unknown): {
    year: string;
    month: string;
    raw: string;
} | null {
    const match = MONTH_ISSUE.exec(clean(String(value ?? '')));
    if (!match)
        return null;
    if (match[2])
        return { year: match[1] || '', month: match[2].padStart(2, '0'), raw: match[0] };
    const month = MONTH_ORDER.indexOf(String(match[3]).slice(0, 3).toLowerCase()) + 1;
    return month ? { year: match[4], month: String(month).padStart(2, '0'), raw: match[0] } : null;
}
export function isIssueStatement(value: string): boolean {
    return journalOfIssueStatement(value) !== null;
}
export function journalOfIssueStatement(value: unknown): string | null {
    const text = clean(String(value ?? '')).replace(/^\d{1,4}\s+(?=[^\d年년])/, '').replace(ISSUE_HEAD, '');
    const issue = ISSUE_NUMBERS.exec(text);
    if (!issue)
        return null;
    const tail = text.slice(issue.index + issue[0].length).replace(DATE_OR_PAGES, '');
    if (!ISSUE_TAIL.test(tail))
        return null;
    const name = text.slice(0, issue.index).replace(NAME_TRAILER, '').replace(/[\s,，]*(?:19|20)\d{2}\s*[년.]?$/, '').replace(NAME_TRAILER, '').trim();
    return name.split(/\s+/).filter(Boolean).length > 10 ? null : name;
}
const serialLetters = (value: unknown) => String(value ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const SERIAL_SCOPE = '(?:international|american|european|asian|british|chinese|japanese|korean|canadian|australian|indian|african|nordic|scandinavian|german|french|italian|russian|polish)';
const SERIAL_HEAD = new RegExp(`^(?:the )?(?:${SERIAL_SCOPE} )?(?:journal(?: (?:of|for|on|in))?|transactions (?:of|on|in)|annals of|annales|proceedings of|bulletin (?:of|de)|archives (?:of|de|for)|acta|zeitschrift f(?:ü|ue)r|revue|revista|rivista)(?: |$)`, 'i');
const GLUED_SERIAL_HEAD = /^((?:the\s+)?(?:\p{L}+\s+)?(?:journal|transactions|annals|proceedings|bulletin|archives))(of|for|on|in)(?=\s|$)/iu;
const SERIAL_TAIL = new Set(['journal', 'letters', 'review', 'reviews', 'transactions', 'proceedings', 'bulletin', 'magazine', 'quarterly', 'annals',
    'gazette', 'chronicle', 'newsletter', 'communications', 'reports', 'advances']);
const SERIAL_SECTION = /^(?:[A-Z]|[IVX]{1,4})$/;
const SERIAL_CONNECTIVE = /^(?:of|and|&|in|on|for|the|de|der|des|du|la|le|und|für|fur|di|del|y|et)$/i;
const CJK_SERIAL_TAIL = /(?:학회지|학술지|논문지|논문집|학보|회지|회보|저널|紀要|学报|學報|学報|誌|ジャーナル)$/u;
export function serialNameShaped(value: unknown): boolean {
    let text = clean(String(value ?? '')).replace(/[.,;]+$/, '');
    if (!text || text.length > 160 || /[.?!]\s+\p{Lu}/u.test(text))
        return false;
    const compact = text.replace(/\s+/g, '');
    if (/[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(compact)) {
        return compact.length >= 3 && compact.length <= 30 && CJK_SERIAL_TAIL.test(compact) && !/[.?!:：]/.test(compact);
    }
    text = text.replace(GLUED_SERIAL_HEAD, '$1 $2');
    const words = text.split(' ').filter(Boolean);
    if (!words.length || words.length > 14)
        return false;
    const bare = /^[A-Z]{2,6}$/.test(words[0]) && words.length > 1 ? words.slice(1).join(' ') : words.join(' ');
    if (SERIAL_HEAD.test(bare))
        return true;
    if (words.length > 6 || /[:：]/.test(text) || /^(?:a|an)$/i.test(words[0]))
        return false;
    const last = SERIAL_SECTION.test(words[words.length - 1]) && words.length > 1 ? words.length - 2 : words.length - 1;
    const tail = words[last];
    if (!SERIAL_TAIL.has(tail.toLowerCase()) || !/^\p{Lu}/u.test(tail))
        return false;
    if (last > 0 && /^(?:a|an|the)$/i.test(words[last - 1]))
        return false;
    return words.slice(0, last + 1).every(word => SERIAL_CONNECTIVE.test(word) || /^[\p{Lu}\d]/u.test(word));
}
export function statesAnIssue(text: unknown): boolean {
    const value = clean(String(text ?? '').replace(/\r?\n/g, ' '));
    if (!value)
        return false;
    return ISSUE_NUMBERS.test(value) || /\bpages\s*[:：]?\s*\d{1,5}\s*[-–—~]\s*\d{1,5}/i.test(value);
}
function containerNameOf(value: unknown): string {
    const text = clean(String(value ?? ''));
    const stated = journalOfIssueStatement(text);
    if (stated)
        return stated;
    return text.split(/(?:제\s*\d|第\s*\d|\bvol(?:ume)?\.?\s*\d|\bno\.?\s*\d|,\s*(?:19|20)\d{2}|[,(（]\s*ISSN\b|,)/i)[0].trim() || text;
}
function withoutDoubledTail(token: string): string {
    if (!token.includes('..'))
        return token;
    const runs = token.match(/(.)\1*/gsu) || [];
    let from = runs.length;
    while (from > 0 && runs[from - 1].length % 2 === 0)
        from--;
    const tail = runs.slice(from);
    if (tail.length < 3 || !tail.some(run => run.startsWith('.')))
        return token;
    return runs.slice(0, from).join('') + tail.map(run => run.slice(0, run.length / 2)).join('');
}
function addressParts(text: string): string[] {
    const parts: string[] = [];
    for (const token of text.normalize('NFKC').split(/\s+/).filter(Boolean).map(withoutDoubledTail)) {
        for (const match of token.matchAll(/(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,6})(?![a-z0-9-])((?:\/[a-z0-9_-]+)*)/giu)) {
            parts.push(...match[1].split('.').slice(0, -1).filter(label => !/^www\d*$/i.test(label)), ...String(match[2] || '').split('/').filter(Boolean));
        }
    }
    return parts;
}
const SKIPPABLE_HEAD = new RegExp(`^(?:journal|transactions|annals|annales|proceedings|bulletin|archives|acta|revue|revista|zeitschrift|${SERIAL_SCOPE})$`, 'i');
function abbreviates(label: string, title: unknown): boolean {
    const key = serialLetters(label.replace(/-?journal$/i, ''));
    const words = clean(String(title ?? '')).split(' ').filter(word => word && !SERIAL_CONNECTIVE.test(word));
    const content = words.map(serialLetters);
    if (key.length < 3 || !content.length || content.some(word => !word))
        return false;
    const memo = new Map<string, boolean>();
    const go = (at: number, word: number, started: boolean): boolean => {
        const id = `${at},${word},${started}`;
        if (memo.has(id))
            return memo.get(id) as boolean;
        let found = false;
        if (at === key.length)
            found = started && word === content.length;
        else if (word < content.length) {
            for (let take = Math.min(content[word].length, key.length - at); take >= 1 && !found; take--) {
                if (key.startsWith(content[word].slice(0, take), at))
                    found = go(at + take, word + 1, true);
            }
            if (!found && !started && (SKIPPABLE_HEAD.test(words[word]) || /^[A-Z]{2,6}$/.test(words[word])))
                found = go(at, word + 1, false);
        }
        memo.set(id, found);
        return found;
    };
    return go(0, 0, false);
}
export function abbreviatesTheSerial(name: unknown, serial: unknown): boolean {
    const label = String(name ?? '').trim();
    return label.length >= 3 && label.length <= 40 && String(serial ?? '').length <= 200 && abbreviates(label, serial);
}
export function addressAbbreviates(title: unknown, text: unknown): boolean {
    const words = clean(String(title ?? '')).split(' ').filter(Boolean);
    if (!words.length || words.length > 8 || serialLetters(title).length < 4)
        return false;
    return addressParts(String(text ?? '')).some(part => abbreviates(part, title));
}
function drawnHeading(title: unknown, layer: unknown, printed: unknown): boolean {
    const key = serialLetters(title);
    const layerText = String(layer ?? '');
    const layerLetters = serialLetters(layerText);
    if (clean(String(title ?? '')).split(' ').filter(Boolean).length > 8 || !statesAnIssue(layerText))
        return false;
    const lines = layerText.split(/\r?\n/).filter(line => line.trim()).length;
    if (lines > 6 || layerLetters.length > 160 || layerLetters.includes(key))
        return false;
    let top = '';
    for (const line of String(printed ?? '').split(/\r?\n/)) {
        if (!line.trim() || /^-{2,}\s*page\s+\d+\s*-{2,}$/i.test(line.trim()))
            continue;
        top += serialLetters(line);
        if (top.length >= key.length)
            break;
    }
    return top === key;
}
function namesSomeone(value: unknown): boolean {
    if (Array.isArray(value))
        return value.some(namesSomeone);
    if (value && typeof value === 'object') {
        const person = value as Record<string, unknown>;
        return ['lastName', 'firstName', 'name'].some(field => /\p{L}/u.test(String(person[field] ?? '')));
    }
    return /\p{L}/u.test(String(value ?? ''));
}
export function isSerialName(title: unknown, context: {
    containers?: unknown[];
    numbering?: unknown;
    printed?: unknown;
    layer?: unknown;
    byline?: unknown;
    ownSerial?: unknown;
} = {}): boolean {
    const key = serialLetters(title);
    if (key.length < 4)
        return false;
    if ((context.containers || []).some(name => { const whole = serialLetters(name); return whole.length >= 4 && (whole === key || serialLetters(containerNameOf(name)) === key); }))
        return true;
    const own = serialLetters(containerNameOf(context.ownSerial ?? ''));
    if (own.length >= 4) {
        if (own === key)
            return true;
        const related = own.includes(key) || key.includes(own) || abbreviates(String(context.ownSerial ?? ''), title) || abbreviates(String(title ?? ''), context.ownSerial);
        if (!related)
            return false;
    }
    const banner = /\d/.test(String(context.numbering ?? '')) || statesAnIssue(context.printed) || statesAnIssue(context.layer);
    if (!banner)
        return false;
    if (serialNameShaped(title))
        return true;
    if (namesSomeone(context.byline))
        return false;
    return addressAbbreviates(title, `${String(context.printed ?? '')}\n${String(context.layer ?? '')}`)
        || drawnHeading(title, context.layer, context.printed);
}
const YEAR = String.raw `(?:1[5-9]|20)\d{2}`;
const DAY = String.raw `(?:0?[1-9]|[12]\d|3[01])`;
const MONTH_NUMBER = String.raw `(?:0?[1-9]|1[0-2])`;
const DATE_GAP = String.raw `[\s,.•·‧∙|/–—-]+`;
const MONTH_SPAN = String.raw `${LATIN_MONTH}\.?(?:\s*[-–—/]\s*${LATIN_MONTH}\.?)?`;
const DATE_ONLY: RegExp[] = [
    new RegExp(String.raw `^(?:${MONTH_SPAN}(?:${DATE_GAP}${DAY}(?:st|nd|rd|th)?)?|spring|summer|autumn|fall|winter)${DATE_GAP}${YEAR}\.?$`, 'i'),
    new RegExp(String.raw `^${DAY}(?:st|nd|rd|th)?${DATE_GAP}${MONTH_SPAN}${DATE_GAP}${YEAR}\.?$`, 'i'),
    new RegExp(String.raw `^${YEAR}\s*[./-]\s*${MONTH_NUMBER}(?:\s*[./-]\s*${DAY})?\s*\.?$`),
    new RegExp(String.raw `^${MONTH_NUMBER}\s*[./-]\s*${YEAR}$`),
    new RegExp(String.raw `^${YEAR}\s*[年년]\s*${MONTH_NUMBER}\s*[月월](?:\s*(?:${DAY}\s*)?[日일])?$`)
];
export function isDateOnly(value: unknown): boolean {
    const text = clean(String(value ?? ''));
    if (!text || text.length > 40)
        return false;
    return DATE_ONLY.some(pattern => pattern.test(text));
}
export function lineIsNotATitle(line: string, options: {
    printedAsTitle?: boolean;
} = {}): boolean {
    const value = clean(line);
    if (!value)
        return true;
    if (!options.printedAsTitle && (ARTICLE_RUBRIC.test(value) || SERIES_SET.test(value)))
        return true;
    return hardlyATitle(value);
}
export function isNotATitle(line: string): boolean {
    return lineIsNotATitle(line);
}
function hardlyATitle(value: string): boolean {
    const correctionNotice = CORRECTION_NOTICE.test(value) && (/[“"«‘][^”"»’]{6,}[”"»’]/.test(value) || /\[[^\]]{0,80}(?:1[5-9]|20)\d{2}[^\]]{0,40}\]/.test(value));
    if (!correctionNotice && isIssueStatement(value))
        return true;
    if (isDateOnly(value))
        return true;
    if (PUBLISHER_BOILERPLATE.some(pattern => pattern.test(value)))
        return true;
    if (isDegreeStatement(value) || isDegreeFormLine(value))
        return true;
    const withoutFolio = value.replace(/^\d{1,4}\s+/, '');
    if (withoutFolio !== value && peopleRow(withoutFolio))
        return true;
    if (glyphNoise(value) || namesABodyNotAWork(value))
        return true;
    if (WEB_BANNER.test(value.replace(/^(?:full\s+paper|communication|review|article)\s+/i, '')))
        return true;
    if (COPYRIGHT_NOTICE.test(value) || (!correctionNotice && SELF_CITATION.test(value)))
        return true;
    if (!correctionNotice && CITATION_LINE.some(pattern => pattern.test(value)))
        return true;
    if (peopleRow(value) || looksLikePersonName(value))
        return true;
    if (isKeywordList(value) || CONTINUED_LIST.test(value))
        return true;
    if (opensWithoutClosing(value) || looksLikeBodyProse(value))
        return true;
    if (POSTAL_ADDRESS.test(value) || AFFILIATION_LINE.test(value) || DOCUMENT_CODE.test(value) || looksGlyphSpaced(value))
        return true;
    if (startsMidWord(value) || wrappedInPageMarks(value) || (!correctionNotice && twoTitlesWelded(value)))
        return true;
    if (/\b(?:Prof|Dr|Mr|Mrs|Ms)\.\s+\p{Lu}/u.test(value))
        return true;
    if (isOrganisationOnly(value) || isInstitutionName(value) || SECTION_BANNER.test(value))
        return true;
    return [...SERIES_OR_IMPRINT, ...FRONT_MATTER_BOILERPLATE, ...(correctionNotice ? [] : RUNNING_HEADER)].some(pattern => pattern.test(value));
}
export { endsOnADanglingModifier, looksCutOff, looksTruncatedTitle } from './title-grammar';
export function stripTitleNoise(title: string): string {
    let value = clean(title);
    value = value.replace(/^(?:A\s+)?(?:THESIS|DISSERTATION)\s+(?:FOR|SUBMITTED\s+(?:TO|FOR|IN))\b.{0,80}?\b(?:PHILOSOPHY|SCIENCE|ENGINEERING|ARTS|EDUCATION|MEDICINE|LAWS?)\b\s*(?=\p{L})/iu, '');
    value = value.replace(/^(?:Master['’]?s|Doctoral|Ph\.?\s?D\.?|Bachelor['’]?s|Honou?rs)\s+(?:Thesis|Dissertation)\s+(?=\p{L})/iu, '');
    value = value.replace(/^(?:[가-힣]{1,4}학\s*)?(?:석사|박사)\s*학위\s*(?:청구\s*)?논문\s+(?=\S)/u, '');
    value = value.replace(/^(?:[\p{Script=Han}]{1,4}[學学]\s*)?(?:碩士|博士|硕士)\s*(?:學位|学位)\s*(?:(?:請求|请求)\s*)?(?:論文|论文)\s+(?=\S)/u, '');
    value = value.replace(/(?<=\p{Ll})(?:TM|®|™)\b/gu, '');
    value = value.replace(/(?<=\p{Ll})\((?:R|TM)\)/gu, '');
    value = value.replace(/^.{0,120}?\(\s*Ed(?:s|itors)?\.?\s*\)\s*/i, '');
    const editors = /^(.{0,160}?)\bEditors\b\s*(?=\S)/.exec(value);
    if (editors) {
        const people = editors[1].trim().split(/\s*[•·,;&]\s*|\s+and\s+/i).filter(Boolean);
        if (people.length && people.every(name => latinPersonName(name)))
            value = value.slice(editors[0].length);
    }
    value = value.replace(/\s*\bEdited\s+by\b.*$/i, '');
    value = value.replace(/\s+(?:FIRST|SECOND|THIRD|FOURTH|FIFTH|\d+(?:ST|ND|RD|TH))\s+EDITION\s*$/i, '');
    value = value.replace(/(?<![†‡*])[†‡*]+\s*$/, '');
    return clean(value);
}
export const DEGREE_LABEL_SOURCE = '(?:[가-힣]{1,4}학\\s*)?(?:석사|박사)\\s*학위\\s*(?:청구\\s*)?논문'
    + '|(?:碩士|博士)\\s*(?:學位|学位)\\s*(?:(?:請求|请求)\\s*)?(?:論文|论文)';
export const DEGREE_LABEL_LATIN = "master['’]?s\\s*thesis|doctoral\\s*(?:thesis|dissertation)";
export const DEGREE_LABEL = new RegExp(DEGREE_LABEL_SOURCE);
export function thesisTypeOf(label: unknown): string {
    const text = clean(String(label ?? ''));
    if (/박사|博士|doctor|doktor|doutor|dottor|ph\.?\s?d/i.test(text))
        return '박사학위논문';
    if (/석사|碩士|硕士|修士|m[aá]ster|maestr[ií]a|mestrado|magist(?:er|ra|rale)|ma[iî]trise/i.test(text))
        return '석사학위논문';
    return '';
}
const BODY_HEAD = '(?:Office|Chair|Chaire|Bureau|Department|D[ée]partement|Division|Directorate|Faculty|Facult[ée]|School|College|Institute|Institut|Laborator(?:y|ies)|Laboratoire|Cent(?:er|re)|Academy|Acad[ée]mie|Ministry|Minist[èe]re|Agency|Board|Commission|Committee|Council|Secretariat|Administration|Observator(?:y|ies)|Museum|Mus[ée]e|Librar(?:y|ies)|Archives?|Universit(?:y|ies)|Universit[äa]t|Universit[ée]|Universidad)';
const BODY_CONNECTIVE = '(?:of|for|on|and|the|in|des|de|du|der|den|dei|delle|della|di|el|la|le|les|et|y|e|van|von|zu|f[üu]r|und)';
const BODY_NAME_MIXED = new RegExp('^(?:The|Le|La|Das|Der)?\\s*' + BODY_HEAD + '\\b(?:\\s+(?:' + BODY_CONNECTIVE + ')|\\s+\\p{Lu}[\\p{L}’\'-]*)+$', 'u');
const BODY_NAME_CAPS = new RegExp('^(?:THE\\s+)?' + BODY_HEAD.toUpperCase() + '\\b(?:\\s+(?:' + BODY_CONNECTIVE.toUpperCase() + ')|\\s+\\p{Lu}[\\p{Lu}\\d’\'-]*)+$', 'u');
const DEGREE_NAKED = /^(?:a\s+|the\s+)?(?:doctorate|doctoral\s+degree|doctor|master(?:['’]s)?|magister|bachelor(?:['’]s)?|licentiate|philosophiae\s+doctor)\s+(?:of|in)\s+(?!(?:the|a|an|his|her|its|our|my|this|that)\b)[\p{L}\s]{2,60}$/iu;
const DEGREE_OF_LINE = /^(?:the\s+)?degree\s+of\b/i;
const FUNDING_ACK = /^(?:this\s+(?:work|research|study|project|paper|material)\s+)?(?:(?:was|is|has\s+been)\s+)?(?:partially\s+|partly\s+|financially\s+|jointly\s+)?(?:supported|funded|sponsored|financed)\s+(?:by|through|under)\b|\bunder\s+(?:grant|contract|award|agreement)\s+(?:no\.?|number|#|[A-Z0-9][\w-]{3,})|\b(?:grant|contract|award)\s+(?:no\.?|number|#)\s*[\w-]/i;
const AFFILIATION_KEY_MARK = /^\d{1,2}(?=\p{Lu}[\p{L}]{2,})/u;
const AFFILIATION_ORG_WORD = /\b(?:Universit|Institut|Department|Laborator|Cent(?:er|re)|Academy|Agency|Ministry|Corporation|Foundation|Project|Program|Faculty|School|College|Division|Research)/i;
const TRAIL_SEPARATOR = /\s{2,}|\s*[|›»>·•▪◦‣-]\s*|\s*\p{Co}+\s*/u;
export function looksLikeBreadcrumb(raw: unknown): boolean {
    const parts = String(raw ?? '').split(TRAIL_SEPARATOR).map(part => part.trim()).filter(Boolean);
    return parts.length >= 3 && parts.every(part => /^[\p{Lu}][\p{L}\d'’&.-]*(?:\s+[\p{L}\d'’&.-]+){0,3}$/u.test(part) && !/[.:;,?!]$/.test(part));
}
const journalOfCitation = (line: string): string => ((/^(\p{Lu}[\p{L}&.\s:-]{5,60}?)\s+\d{1,4}\s*\(\s*(?:19|20)\d{2}\s*\)/u.exec(line.trim())
    || /^(\p{Lu}[\p{L}&.\s:-]{5,60}?)\s*,\s*(?:19|20)\d{2}\s*,/u.exec(line.trim()) || [])[1] || '').trim();
const bareLetters = (value: unknown) => String(value ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export function isOwnJournalName(candidate: string, pageText: string): boolean {
    const name = clean(candidate), folded = bareLetters(name);
    for (const line of String(pageText || '').split('\n')) {
        const printed = journalOfCitation(line), journal = bareLetters(printed);
        if (!journal || journal.length < 8 || !folded.startsWith(journal))
            continue;
        if (folded === journal)
            return true;
        return /^[:\-–—,]?\s*\p{Lu}[\p{L}]*(?:\s+(?:and|&)\s+\p{Lu}[\p{L}]*)?$/u.test(name.slice(printed.length).trim());
    }
    return false;
}
export function isBodyNameOnly(line: unknown): boolean {
    const value = clean(String(line ?? ''));
    if (!value)
        return false;
    if (namesABodyNotAWork(value))
        return true;
    const words = value.split(/\s+/).length;
    if (words > 8)
        return false;
    return BODY_NAME_MIXED.test(value) || (BODY_NAME_CAPS.test(value) && words <= 6);
}
export function isNotAFinishedTitle(line: string): boolean {
    if (isNotATitle(line))
        return true;
    const value = clean(line);
    if (!value)
        return false;
    const words = value.split(/\s+/).length;
    if (BODY_NAME_MIXED.test(value) || (BODY_NAME_CAPS.test(value) && words <= 6))
        return true;
    if (DEGREE_NAKED.test(value))
        return true;
    if (DEGREE_OF_LINE.test(value) && words <= 8)
        return true;
    if (FUNDING_ACK.test(value))
        return true;
    if (AFFILIATION_KEY_MARK.test(value) && AFFILIATION_ORG_WORD.test(value))
        return true;
    return looksLikeBreadcrumb(line) || looksLikeBreadcrumb(value);
}

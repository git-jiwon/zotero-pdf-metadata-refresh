import { buildDiff } from '../metadata/diff';
import type { MetadataSnapshot, RecognitionResult } from '../types';
import { debug } from '../utils/log';
import { personCreator } from './agents';
import { notAKoreanName } from './title-guards';
import { nameCells } from './byline-row';
import { nameShape } from '../metadata/person-name';
export interface KoreanPatentData {
    title: string;
    patentNumber: string;
    applicationNumber?: string;
    filingDate?: string;
    issueDate?: string;
    abstractNote?: string;
    assignee?: string;
    inventors: string[];
    legalStatus: '공개' | '등록';
    classifications: string[];
}
export function linesFromRecognizerData(data: any): string[] {
    const page = data?.pages?.[0];
    if (!Array.isArray(page))
        return [];
    const tokens: {
        text: string;
        x: number;
        y: number;
    }[] = [];
    const walk = (value: any) => {
        if (!Array.isArray(value))
            return;
        if (value.length >= 5 && value.slice(0, 4).every((x: any) => typeof x === 'number') && typeof value[value.length - 1] === 'string') {
            const text = value[value.length - 1].replace(/\s+/g, ' ').trim();
            if (text)
                tokens.push({ text, x: value[0], y: value[1] });
            return;
        }
        value.forEach(walk);
    };
    walk(page[2]);
    tokens.sort((a, b) => a.y - b.y || a.x - b.x);
    const rows: {
        y: number;
        tokens: typeof tokens;
    }[] = [];
    for (const token of tokens) {
        let row = rows.find(candidate => Math.abs(candidate.y - token.y) <= 3);
        if (!row) {
            row = { y: token.y, tokens: [] };
            rows.push(row);
        }
        row.tokens.push(token);
    }
    return rows.sort((a, b) => a.y - b.y).map(row => row.tokens.sort((a, b) => a.x - b.x).map(token => token.text).join(' ').replace(/\s+/g, ' ').trim());
}
function isoDate(value: string | undefined): string | undefined {
    const match = value?.match(/((?:19|20)\d{2})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})/);
    return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : undefined;
}
const STARTS_AN_ADDRESS = /^(?:(?:미국|일본국?|중국|영국|독일|프랑스|스위스|네덜란드|캐나다|대만|싱가포르|스웨덴|이탈리아|핀란드|덴마크|벨기에|오스트리아|스페인|호주|이스라엘|인도|대한민국|주소)|(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)(?:특별시|광역시|특별자치시|특별자치도|남도|북도|도)?)(?:\s|,|$)|^\d/;
const NEXT_FIELD = /^\s*\((?:74|54|57)\)|^\s*전체\s*청구항/;
const CLASSIFICATION = /\b[A-H]\d{2}[A-Z]\s*\d+\s*\/\s*\d+(?:\s*\(\d{4}\.\d{2}\))?/g;
function nameBeforeAddress(line: string): string {
    const words = line.split(' ');
    for (let i = 1; i < words.length; i++) {
        if (STARTS_AN_ADDRESS.test(words.slice(i).join(' ')))
            return words.slice(0, i).join(' ');
    }
    return line;
}
function sectionPeople(lines: string[], start: RegExp, stop: RegExp, organization: boolean): string[] {
    const begin = lines.findIndex(line => start.test(line));
    if (begin < 0)
        return [];
    const values: string[] = [];
    for (let i = begin; i < Math.min(lines.length, begin + 12); i++) {
        let line = lines[i];
        if (i > begin && (stop.test(line) || NEXT_FIELD.test(line)))
            break;
        if (i === begin)
            line = line.replace(start, ' ');
        if (organization) {
            const whole = line.replace(/^.*\(\d{2}\)\s*[가-힣 ]+(?:\([^)]*\))?/, ' ').replace(CLASSIFICATION, ' ')
                .replace(/\s+/g, ' ').replace(/[,\s]+$/, '').trim();
            if (whole.length >= 2 && whole.length <= 60 && !STARTS_AN_ADDRESS.test(whole)
                && !/(?:특허청|공보|분류|일자|번호|청구항|대리인)$/.test(whole)
                && !/(?:특별시|광역시|[가-힣]+[시군구]\s|번길|로\s*\d|길\s*\d)/.test(whole)) {
                values.push(whole);
                break;
            }
            continue;
        }
        const tail = line.match(/([가-힣·]{2,24})\s*$/)?.[1]?.trim();
        if (!tail || /(?:특허청|공보|분류|일자|번호|청구항|대리인)$/.test(tail))
            continue;
        if (/(?:특별시|광역시|[가-힣]+[시군구]\s|번길|아파트|로\s*\d|길\s*\d)/.test(line))
            continue;
        if (!organization && /(?:아파트|대학교|연구원|협력단|주식회사|회사|재단|법인)$/.test(tail))
            continue;
        if (/\d|(?:특별시|광역시|도|시|군|구|로|길|동)\s/.test(tail))
            continue;
        if (!values.includes(tail))
            values.push(tail);
        if (organization && values.length)
            break;
    }
    return values;
}
function parseKoreanPatentLines(lines: string[]): KoreanPatentData | null {
    const text = lines.join('\n').normalize('NFC');
    if (!/\(19\)\s*대한민국특허청\s*\(KR\)/i.test(text) || !/\(12\)\s*(?:공개|등록)특허공보/.test(text))
        return null;
    const number = text.match(/\(11\)\s*(?:공개|등록)번호[\s\S]{0,120}?\b(10-(?:\d{4}-\d{6,7}|\d{7}))\b/)?.[1];
    const title = text.match(/\(54\)\s*(?:발명의\s*명칭\s*)?([^\n]+(?:\n(?!\s*(?:\(57\)\s*)?요\s*약)[^\n]+)?)/)?.[1]?.replace(/\s+/g, ' ').trim();
    if (!number || !title || title.length < 2 || /대한민국특허청|특허공보/.test(title))
        return null;
    const legalStatus: '공개' | '등록' = /\(12\)\s*등록특허공보/.test(text) ? '등록' : '공개';
    const applicationNumber = text.match(/\(21\)\s*출원번호\s*(10-\d{4}-\d{6,7})/)?.[1];
    const filingDate = isoDate(text.match(/\(22\)\s*출원일자\s*([^\n]+)/)?.[1]);
    const issuePattern = legalStatus === '등록'
        ? /\(45\)\s*(?:공고|등록)일자[\s\S]{0,140}?((?:19|20)\d{2}\s*[년.\-/]\s*\d{1,2}\s*[월.\-/]\s*\d{1,2})/
        : /\(43\)\s*공개일자[\s\S]{0,140}?((?:19|20)\d{2}\s*[년.\-/]\s*\d{1,2}\s*[월.\-/]\s*\d{1,2})/;
    const issueDate = isoDate(text.match(issuePattern)?.[1]);
    const abstractNote = text.match(/(?:\(57\)\s*)?요\s*약\s*\n([\s\S]+?)(?=\n\s*(?:대\s*표\s*도|대표도|색인어|전체\s*청구항|청구범위|-\s*1\s*-))/)?.[1]?.replace(/\s+/g, ' ').trim();
    const assigneeBlock = text.match(/\((?:71|73)\)\s*(?:출원인|특허권자)\s*([\s\S]+?)(?=\n?\s*\((?:72|74)\))/)?.[1] || '';
    const assigneeLines = assigneeBlock.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const firstLine = assigneeLines[0] ? nameBeforeAddress(assigneeLines[0]).replace(/[,\s]+$/, '') : '';
    const nameLine = firstLine && !STARTS_AN_ADDRESS.test(firstLine)
        && (assigneeLines.length === 1 || STARTS_AN_ADDRESS.test(assigneeLines[1]))
        && !/(?:특별시|광역시|번길|로\s*\d|길\s*\d)/.test(firstLine)
        ? firstLine : undefined;
    const named = (value: string | undefined) => value && !/^[A-H]\d{2}[A-Z](?:\s|$)/.test(value) ? value : undefined;
    const assignee = named(nameLine && nameLine.length >= 2 && nameLine.length <= 60 ? nameLine : undefined)
        || named(assigneeBlock.match(/^\s*([가-힣A-Za-z0-9·().㈜\s]{2,60}?)(?=\s+(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|전라|경상|제주|주소|\d))/)?.[1]?.replace(/\s+/g, ' ').trim())
        || sectionPeople(lines, /\((?:71|73)\)\s*(?:출원인|특허권자)/, /\((?:72|74)\)/, true)[0];
    const inventorBlock = text.match(/\(72\)\s*발명자\s*([\s\S]+?)(?=\n\s*\((?:54|57)\)|\n\s*전체\s*청구항|\s*\(74\))/)?.[1] || '';
    const inventorLines = inventorBlock.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const isAddress = (line: string) => /\d|(?:미국|대한민국|한국|일본|중국|영국|독일|프랑스|서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|전라|경상|제주|특별시|광역시|아파트|도로|로\b|길\b|우편|더블유|로드|스트리트|빌딩|타워)/i.test(line);
    const readLines = inventorLines.flatMap((line): Array<{
        name: string;
        sure: boolean;
    }> => {
        const attachedKorean = line.match(/^([가-힣·]{2,12})(?=\s+(?:미국|대한민국|한국|일본|중국|서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|전라|경상|제주|특별시|광역시))/)?.[1];
        if (attachedKorean)
            return [{ name: attachedKorean, sure: true }];
        if (isAddress(line))
            return [];
        const commaName = line.match(/^([가-힣A-Za-z][가-힣A-Za-z'’.-]{0,30})\s*,\s*([가-힣A-Za-z][가-힣A-Za-z'’ .-]{0,30})$/);
        if (commaName)
            return [{ name: `${commaName[1]}, ${commaName[2].trim()}`, sure: true }];
        const korean = line.match(/^([가-힣·]{2,12})(?=\s|$)/)?.[1];
        if (!korean || /(?:특별시|광역시|대학교|연구원|아파트)$/.test(korean))
            return [];
        const shape = nameShape(korean);
        return [{ name: korean, sure: line === korean && shape.person !== 'no' && shape.kind === 'korean' && !notAKoreanName(korean) }];
    });
    const inventors = [...new Set(readLines.map(entry => entry.name))];
    const namedWithComma = inventors.filter(name => name.includes(','));
    const readInventors = namedWithComma.length
        ? [...new Set(readLines.filter(entry => entry.sure).map(entry => entry.name))]
        : inventors;
    if (!readInventors.length)
        readInventors.push(...sectionPeople(lines, /\(72\)\s*발명자/, NEXT_FIELD, false).filter(name => /^[가-힣·]{2,12}$/.test(name)));
    const classifications = [...new Set(text.match(/\b[A-H]\d{2}[A-Z]\s*\d+\s*\/\s*\d+\b/g) || [])].map(value => value.replace(/\s+/g, ' ')).slice(0, 8);
    return { title, patentNumber: number, applicationNumber, filingDate, issueDate, abstractNote, assignee, inventors: readInventors, legalStatus, classifications };
}
function patentCreatorNames(values: string[]): string[] {
    return [...new Set(values.flatMap(value => nameCells(String(value || '').normalize('NFKC'), { comma: false })).map(name => name.replace(/\s+/g, ' ').trim()).filter(Boolean))];
}
export function parseKoreanPatent(data: any): KoreanPatentData | null {
    return parseKoreanPatentLines(linesFromRecognizerData(data));
}
export function parseKoreanPatentText(content: string): KoreanPatentData | null {
    const firstPage = content.replace(/\r\n?/g, '\n').split('\f', 1)[0].slice(0, 30000);
    return parseKoreanPatentLines(firstPage.split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean));
}
export function shouldTryKoreanPatent(_before: MetadataSnapshot, attachment: any, documentText = ''): boolean {
    const hint = `${String(attachment?.getField?.('title') || '')} ${String(attachment?.attachmentFilename || '')} ${String(documentText || '').slice(0, 20000)}`;
    return /대한민국특허청|(?:공개|등록)특허공보/.test(hint);
}
export async function recognizeKoreanPatent(parent: any, attachment: any, before: MetadataSnapshot): Promise<RecognitionResult | null> {
    let patent: KoreanPatentData | null = null;
    try {
        const cacheFile = Zotero.Fulltext?.getItemCacheFile?.(attachment);
        if (cacheFile?.path && await IOUtils.exists(cacheFile.path)) {
            patent = parseKoreanPatentText(await Zotero.File.getContentsAsync(cacheFile, 'utf-8', 30000));
            if (patent)
                debug(`item=${parent.key} pdf=${attachment.key} KIPO markers read from Zotero PDF fulltext cache`);
        }
    }
    catch (cause) {
        debug(`item=${parent.key} pdf=${attachment.key} fulltext cache unavailable: ${String(cause)}`);
    }
    if (!patent)
        patent = parseKoreanPatent(await Zotero.PDFWorker.getRecognizerData(attachment.id, true));
    if (!patent)
        return null;
    return koreanPatentResult(parent, before, patent, attachment.key);
}
export function recognizeKoreanPatentText(parent: any, before: MetadataSnapshot, text: string): RecognitionResult | null {
    const patent = parseKoreanPatentText(text);
    return patent ? koreanPatentResult(parent, before, patent, 'OCR') : null;
}
function koreanPatentResult(parent: any, before: MetadataSnapshot, patent: KoreanPatentData, attachmentKey: string): RecognitionResult {
    const candidate = new Zotero.Item('patent');
    candidate.libraryID = parent.libraryID;
    const fields: Record<string, string> = { title: patent.title, patentNumber: patent.patentNumber, country: 'KR', issuingAuthority: '대한민국특허청', legalStatus: patent.legalStatus, language: 'ko' };
    if (patent.applicationNumber)
        fields.applicationNumber = patent.applicationNumber;
    if (patent.filingDate)
        fields.filingDate = patent.filingDate;
    if (patent.issueDate)
        fields.issueDate = patent.issueDate;
    if (patent.abstractNote)
        fields.abstractNote = patent.abstractNote;
    if (patent.assignee)
        fields.assignee = patent.assignee;
    if (patent.classifications.length) {
        const classification = `IPC/CPC: ${patent.classifications.join('; ')}`;
        fields.extra = classification;
    }
    for (const [field, value] of Object.entries(fields)) {
        const id = Zotero.ItemFields.getID(field);
        if (id && Zotero.ItemFields.isValidForType(id, candidate.itemTypeID))
            candidate.setField(id, value);
    }
    candidate.setCreators(patentCreatorNames(patent.inventors)
        .map(name => {
        const comma = /^([^,]{1,30}?)\s*,\s*(.{1,30})$/.exec(name);
        if (comma) {
            return { lastName: comma[1].trim(), firstName: comma[2].trim(), creatorType: 'inventor' };
        }
        const words = name.split(/\s+/).filter(Boolean);
        if (words.length > 1 && words.every(word => /^[가-힣]+$/.test(word))) {
            return { lastName: words[0], firstName: words.slice(1).join(' '), creatorType: 'inventor' };
        }
        return personCreator(name, 'inventor');
    })
        .filter(Boolean));
    const metadataFields: Record<string, string> = {};
    for (const id of Zotero.ItemFields.getItemTypeFields(candidate.itemTypeID)) {
        const value = candidate.getField(id);
        if (value)
            metadataFields[Zotero.ItemFields.getName(id)] = value;
    }
    const metadata: MetadataSnapshot = { ...before, itemTypeID: candidate.itemTypeID, itemType: 'patent', fields: metadataFields, creators: candidate.getCreators() };
    const changes = buildDiff(before, metadata, true);
    debug(`item=${parent.key} pdf=${attachmentKey} Korean patent recognized; publication=${patent.patentNumber}; title=${patent.title}`);
    return { source: null, metadata, changes };
}

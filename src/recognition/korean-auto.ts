import { isFileLikeTitle, titleSimilarity } from '../metadata/match';
import { isNotATitle, isOrganisationName, isOrganisationOnly, withoutGenreTag } from './title-guards';
import { rowIsByline } from './byline-row';
import { pdfFrontMatterText, providerFor, translateKoreanPage } from './korean';
import { getZotSeekFrontMatter } from './zotseek-text';
import type { MetadataSnapshot } from '../types';
import { getPublicPage } from '../utils/http';
import { sameKoreanPersonAcrossScripts } from '../metadata/korean-names';
export interface TitleCandidate {
    title: string;
    font: number;
    y: number;
}
export type RISSMaterial = 'article' | 'thesis';
export interface SearchCandidate {
    title: string;
    url: string;
    score: number;
    material?: RISSMaterial;
}
export interface FilenameTitleCandidate {
    title: string;
    year?: string;
    author?: string;
}
const compact = (text: string) => text.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
const rissMaterialType: Record<RISSMaterial, string> = { article: '1a0202e37d52c72d', thesis: 'be54d9b8bc7cdb09' };
export const STORED_TITLE_CONFIRMATION = 0.85;
export function storedTitleConfirmedByText(stored: unknown, candidates: string[]): string | null {
    const title = String(stored || '').normalize('NFKC').trim();
    if (title.length < 8 || isFileLikeTitle(title) || isNotATitle(title))
        return null;
    return candidates.some(candidate => titleSimilarity(title, candidate) >= STORED_TITLE_CONFIRMATION) ? title : null;
}
export function withConfirmedStoredTitle(stored: unknown, titles: string[]): string[] {
    const confirmed = storedTitleConfirmedByText(stored, titles);
    return confirmed ? [...new Set([confirmed, ...titles])] : titles;
}
export function materialFromPDFText(text: string): RISSMaterial {
    return /(학위\s*논문|석사\s*학위|박사\s*학위|doctoral\s+(?:dissertation|thesis)|master'?s\s+(?:dissertation|thesis)|\ba\s+thesis\b|graduate\s+school)/i.test(text)
        ? 'thesis' : 'article';
}
export interface ReaderRoles {
    people: string[];
    others: string[];
}
const NON_TITLE_FIELDS = ['출판', '학위', '권호', '페이지', '발행일', '식별자'];
const tidyValue = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
export function readerRoles(fields: Record<string, unknown> | null | undefined): ReaderRoles {
    const byline = String(fields?.['저자'] ?? '').normalize('NFKC');
    const people = [...new Set([...byline.split(/\s*(?:[;\n·•]|\band\b|&)\s*/i), byline].map(tidyValue).filter(Boolean))];
    return { people, others: NON_TITLE_FIELDS.map(name => tidyValue(fields?.[name])).filter(Boolean) };
}
export function namedByTheReader(line: string, roles?: ReaderRoles | null): boolean {
    if (!roles)
        return false;
    const key = compact(line);
    if (key.length < 2)
        return false;
    const lower = (value: string) => tidyValue(value).toLowerCase();
    const joined = (head: string, whole: string) => whole.startsWith(head) && /^\s*[,;:•·(|/–—-]/u.test(whole.slice(head.length));
    const text = lower(line);
    return [...roles.people, ...roles.others].some(value => {
        const role = compact(value);
        if (role.length < (/[가-힣\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(role) ? 2 : 4))
            return false;
        if (key === role)
            return true;
        const stated = lower(value);
        return joined(stated, text) || joined(text, stated);
    });
}
const ORGANISATION_UNIT = /^[가-힣]{1,15}(?:과|실|팀|국|센터|본부|사업단|연구단|학과|학부|전공|분원|지소|연구부)$/;
export function namesABodyOrPeople(line: string, roles?: ReaderRoles | null): boolean {
    const value = line.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!value)
        return true;
    if (namedByTheReader(value, roles))
        return true;
    const tokens = value.split(' ');
    if (tokens.every(token => isOrganisationName(token)) || isOrganisationOnly(value) || isNotATitle(value))
        return true;
    if (tokens.length >= 2 && isOrganisationName(tokens[0]) && tokens.slice(1).every(token => isOrganisationName(token) || ORGANISATION_UNIT.test(token)))
        return true;
    return rowIsByline(value, 'strict');
}
export function extractTitlesFromPlainText(text: string, allowLatin = false, roles?: ReaderRoles | null): string[] {
    const lines = text.split(/[\r\n]+/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const plausible = (line: string) => ((line.match(/[가-힣]/g)?.length || 0) >= 5
        || (allowLatin && (line.match(/[A-Za-z]/g)?.length || 0) >= 12 && line.split(/\s+/).length >= 3))
        && line.length >= 8 && line.length <= 220
        && !/(@|https?:|ISSN|E-MAIL|Copyright|접수일|게재확정|주제어|^초록|^요약|^서론|^참고문헌|A THESIS|Submitted to|fulfillment|degree of|Department of|UNIVERSITY|저작자표시|이용자는|이 저작물을|다음과 같은 조건|이용허락|Legal Code|Disclaimer|저작권법에 따른|\*{3})/i.test(line)
        && !namesABodyOrPeople(line, roles);
    const candidates: string[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (!plausible(lines[i]))
            continue;
        if (plausible(lines[i + 1] || '') && (lines[i] + ' ' + lines[i + 1]).length <= 220)
            candidates.push(`${lines[i]} ${lines[i + 1]}`);
        candidates.push(lines[i]);
    }
    return candidates.filter((value, index, all) => all.findIndex(other => compact(other) === compact(value)) === index).slice(0, 4);
}
export function isWebViewerBoilerplate(text: string): boolean {
    const value = String(text || '').normalize('NFKC');
    if (!value.trim())
        return true;
    if (/(?:ezpdfwebviewer|viewer\.(?:js|jsp))/i.test(value) && !/[가-힣]/.test(value))
        return true;
    const licenceMarkers = value.match(/저작자\s*표시|비영리|변경\s*금지|creative\s+commons|legal\s+code|disclaimer/gi)?.length || 0;
    const documentMarkers = /(?:석사|박사|碩士|博士)\s*(?:학위|學位|学位)|master'?s\s+thesis|doctoral\s+(?:thesis|dissertation)|graduate\s+school|대학교|大學校|university|(?:final\s+)?report|보고서|application\s+note|data\s*sheet|patent|특허|doi\s*[:：]|issn\s*[:：]/i;
    if (licenceMarkers >= 2 && !documentMarkers.test(value))
        return true;
    const replacementCharacters = value.match(/�/g)?.length || 0;
    if (replacementCharacters >= 20 && /legal\s+code/i.test(value) && /disclaimer/i.test(value)
        && !documentMarkers.test(value.replace(/�/g, ' ')))
        return true;
    const withoutHeaders = value
        .replace(/https?:\/\/\S+/gi, ' ').replace(/Page\s+\d+\s+of\s+\d+/gi, ' ')
        .replace(/<(?=[0-9A-F]{20,}>)[0-9A-F]+>/gi, ' ').replace(/\b(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, ' ');
    return compact(withoutHeaders).length < 20;
}
export function titleFromPDFFilename(path: string): FilenameTitleCandidate | null {
    const filename = String(path || '').split(/[\\/]/).pop()?.replace(/\.(?:pdf|djvu)$/i, '').normalize('NFKC').trim() || '';
    const match = filename.match(/^(.{1,60}?)[_-]((?:19|20)\d{2})[_-](.+)$/);
    if (!match)
        return null;
    const title = match[3].replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (title.length < 8 || title.length > 220 || (title.match(/[가-힣]/g)?.length || 0) < 5
        || /^(?:document|download|scan|viewer|untitled)\b/i.test(title))
        return null;
    return { title, year: match[2], author: match[1].replace(/^_+|_+$/g, '').trim() || undefined };
}
export async function frontMatterNeedsOCR(parent: any, attachment: any): Promise<boolean> {
    const data = await Zotero.PDFWorker.getRecognizerData(attachment.id, true);
    if (!isWebViewerBoilerplate(pdfFrontMatterText(data, 5)))
        return false;
    const cached = await getZotSeekFrontMatter(parent);
    if (cached?.text && !isWebViewerBoilerplate(cached.text))
        return false;
    const path = await attachment.getFilePath();
    return !path || !titleFromPDFFilename(path);
}
export function extractKoreanTitles(data: any, pageLimit = 1, allowLatin = false): TitleCandidate[] {
    const pages = (data?.pages || []).slice(0, pageLimit);
    if (!pages.length)
        return [];
    const tokens: {
        text: string;
        x: number;
        y: number;
        font: number;
        page: number;
    }[] = [];
    pages.forEach((page: any, pageIndex: number) => {
        if (!Array.isArray(page))
            return;
        const pageHeight = page[1];
        const pageWalk = (value: any) => {
            if (!Array.isArray(value))
                return;
            if (value.length >= 5 && value.slice(0, 4).every((x: any) => typeof x === 'number') && typeof value[value.length - 1] === 'string') {
                const text = value[value.length - 1].trim(), font = Math.abs(value[3] - value[1]);
                if (text && font > 0 && value[1] >= 0 && value[1] < pageHeight * 0.58)
                    tokens.push({ text, x: value[0], y: value[1], font, page: pageIndex });
                return;
            }
            value.forEach(pageWalk);
        };
        pageWalk(page[2]);
    });
    tokens.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
    const lines: {
        tokens: typeof tokens;
        y: number;
        font: number;
        page: number;
    }[] = [];
    for (const token of tokens) {
        let line = lines.find(x => x.page === token.page && Math.abs(x.y - token.y) <= 3);
        if (!line) {
            line = { tokens: [], y: token.y, font: token.font, page: token.page };
            lines.push(line);
        }
        line.tokens.push(token);
        line.font = Math.max(line.font, token.font);
    }
    const clean = (s: string) => s.replace(/\b([A-Z])\s+(?=[a-z]{2,})/g, '$1').replace(/\s+/g, ' ').trim();
    const raw = lines.map(line => ({ title: clean(line.tokens.sort((a, b) => a.x - b.x).map(t => t.text).join(' ')), font: line.font, y: line.y, page: line.page }));
    const plausible = (s: string) => ((s.match(/[가-힣]/g)?.length || 0) >= 5 || (allowLatin && (s.match(/[A-Za-z]/g)?.length || 0) >= 12 && s.split(/\s+/).length >= 3))
        && s.length >= 8 && s.length <= 220
        && !/(@|https?:|ISSN|E-MAIL|Copyright|접수일|게재확정|주제어|^초록|^요약|^서론|^참고문헌|A THESIS|Submitted to|fulfillment|degree of|Department of|UNIVERSITY|저작자표시|이용자는|\*{3})/i.test(s)
        && !namesABodyOrPeople(s);
    const options: TitleCandidate[] = [];
    for (let i = 0; i < raw.length; i++) {
        const line = raw[i];
        if (!plausible(line.title))
            continue;
        const next = raw[i + 1];
        if (next && next.page === line.page && plausible(next.title) && Math.abs(line.font - next.font) < 2 && next.y - line.y < line.font * 2.5 && (line.title + next.title).length <= 220)
            options.push({ ...line, title: line.title + ' ' + next.title });
        options.push(line);
    }
    return options.sort((a, b) => b.font - a.font || a.y - b.y).filter((v, i, a) => a.findIndex(x => compact(x.title) === compact(v.title)) === i).slice(0, allowLatin ? 4 : 2);
}
export function searchURL(query: string, provider = 'RISS', material: RISSMaterial = 'article'): string {
    if (provider === 'KCI')
        return 'https://www.kci.go.kr/kciportal/po/search/poArtiSearList.kci?poSearchBean.conditionList=ALL&poSearchBean.keywordList=' + encodeURIComponent(query);
    if (provider === 'DBpia')
        return 'https://www.dbpia.co.kr/search/topSearch?searchOption=all&query=' + encodeURIComponent(query);
    void material;
    return 'https://www.riss.kr/search/Search.do?isDetailSearch=N&searchGubun=true&viewYn=OP&query=' + encodeURIComponent(query);
}
export function titleFromReading(recordTitle: unknown, readings: string[], pageTexts: string[] = []): 'same' | 'extended' | null {
    const bare = compact(withoutGenreTag(String(recordTitle ?? '')).split(/\s+=\s+/)[0]);
    if (!bare)
        return null;
    const lines = new Set(pageTexts.flatMap(page => String(page || '').split(/[\r\n]+/)).map(compact).filter(line => line.length >= 2));
    let found: 'same' | 'extended' | null = null;
    for (const reading of readings) {
        const head = compact(reading);
        if (head.length < 6)
            continue;
        if (bare === head)
            return 'same';
        if (bare.startsWith(head) && lines.has(bare.slice(head.length)))
            found = 'extended';
    }
    return found;
}
export function catalogueQueries(reading: string[], extracted: string[], hangulFirst: boolean): string[] {
    const seen = new Set<string>();
    const once = (list: string[]) => list.map(title => String(title || '').replace(/\s+/g, ' ').trim()).filter(title => {
        const key = compact(title);
        if (key.length < 2 || seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
    const read = once(reading);
    const hangul = (title: string) => /[가-힣]/.test(title);
    const ordered = hangulFirst ? [...read.filter(hangul), ...read.filter(title => !hangul(title))] : read;
    return [...ordered, ...once(extracted)].slice(0, 4);
}
export function titlesOfTheWorksPages(gathered: Record<string, unknown> | null | undefined, pageFields: Record<string, Record<string, unknown>> | null | undefined): string[] {
    const people = (value: unknown) => String(value ?? '').normalize('NFKC').split(/\s*(?:[;\n·•]|\band\b|&)\s*/i).map(compact).filter(name => name.length >= 2);
    const own = new Set(people(gathered?.['저자']));
    const house = compact(String(gathered?.['출판'] ?? '').split(/\s*[,，]\s*/)[0]);
    const titleKey = compact(String(gathered?.['제목'] ?? ''));
    const out: string[] = [];
    for (const page of Object.keys(pageFields || {}).sort((a, b) => Number(a) - Number(b))) {
        const answer = pageFields![page] || {};
        const title = String(answer['제목'] ?? '').replace(/\s+/g, ' ').trim();
        if (!title || compact(title) === titleKey || isNotATitle(title))
            continue;
        const samePeople = people(answer['저자']).some(name => own.has(name));
        const sameHouse = house.length >= 2 && compact(String(answer['출판'] ?? '').split(/\s*[,，]\s*/)[0]) === house;
        if ((samePeople || sameHouse) && !out.some(seen => compact(seen) === compact(title)))
            out.push(title);
    }
    return out;
}
function catalogueKey(href: string): string {
    try {
        const provider = providerFor(href).file;
        const url = new URL(href);
        const id = provider === 'RISS' ? url.searchParams.get('control_no') : provider === 'KCI' ? url.searchParams.get('sereArticleSearchBean.artiId') : url.searchParams.get('nodeId');
        return id ? `${provider}:${id}` : '';
    }
    catch {
        return '';
    }
}
const CATALOGUE_ORDER = ['RISS', 'KCI', 'DBpia'];
function candidateOrder(a: SearchCandidate, b: SearchCandidate): number {
    const ka = catalogueKey(a.url), kb = catalogueKey(b.url);
    const pa = CATALOGUE_ORDER.indexOf(ka.split(':')[0]), pb = CATALOGUE_ORDER.indexOf(kb.split(':')[0]);
    return b.score - a.score || pa - pb || (ka < kb ? -1 : ka > kb ? 1 : 0);
}
const EXTENDED_BONUS = 0.0005;
export function rankSearchLinks(links: {
    title: string;
    url: string;
}[], titles: string[], material: RISSMaterial = 'article', pageTexts: string[] = []): SearchCandidate[] {
    const unique = new Map<string, SearchCandidate>();
    for (const link of links) {
        try {
            providerFor(link.url);
        }
        catch {
            continue;
        }
        const url = new URL(link.url);
        const provider = providerFor(link.url).file;
        const key = catalogueKey(link.url);
        if (!key)
            continue;
        const kindBonus = provider === 'RISS' && url.searchParams.get('p_mat_type') === rissMaterialType[material] ? 0.001 : 0;
        const reading = titleFromReading(link.title, titles, pageTexts);
        const score = (reading ? 1 + (reading === 'extended' ? EXTENDED_BONUS : 0) : Math.max(...titles.map(t => titleSimilarity(t, link.title)))) + kindBonus;
        if (score >= 0.6 && (!unique.has(key) || unique.get(key)!.score < score))
            unique.set(key, { ...link, score, material });
    }
    return [...unique.values()].sort(candidateOrder).slice(0, 3);
}
function setTitleOf(title: string): string {
    const main = withoutGenreTag(String(title || '')).split(/\s+=\s+/)[0];
    return compact(main.split(/\s+[.:]\s+/)[0].replace(/\s*\d{1,3}\s*$/, ''));
}
export function anotherVolumeOfTheSameSet(other: string, best: string, pageTexts: string[] = []): boolean {
    if (String(other || '').length > 400 || String(best || '').length > 400)
        return false;
    const set = setTitleOf(best);
    if (set.length < 2 || setTitleOf(other) !== set)
        return false;
    const lines = new Set(pageTexts.flatMap(page => String(page || '').split(/[\r\n]+/)).map(compact).filter(line => line.length >= 2));
    const tail = (title: string) => compact(withoutGenreTag(String(title || '')).split(/\s+=\s+/)[0]).slice(set.length);
    const bestTail = tail(best), otherTail = tail(other);
    return bestTail.length >= 2 && lines.has(bestTail) && bestTail !== otherTail && !lines.has(otherTail);
}
let nextRequest = 0;
const blocked = new Set<string>();
async function search(query: string, cancelled: () => boolean, provider: string, material: RISSMaterial): Promise<{
    title: string;
    url: string;
}[]> {
    if (blocked.has(provider))
        throw new Error(`${provider} 접근 제한 — 세션 검색 중단`);
    const delay = nextRequest - Date.now();
    if (delay > 0)
        await Zotero.Promise.delay(delay);
    if (cancelled())
        throw new Error('Cancelled');
    nextRequest = Date.now() + 1500;
    let response;
    try {
        response = await getPublicPage(searchURL(query, provider, material));
    }
    catch (e: any) {
        if ([403, 429].includes(e.status))
            blocked.add(provider);
        throw e;
    }
    const Parser = Zotero.getMainWindow().DOMParser;
    const doc = new Parser().parseFromString(response.responseText, 'text/html');
    if (/captcha|접근이 제한|비정상적인 접근/i.test(doc.title || '')) {
        blocked.add(provider);
        throw new Error(`${provider} 접근 제한`);
    }
    return [...doc.querySelectorAll('a[href], a[onclick]')].flatMap((a: any) => {
        const article = (a.getAttribute('onclick') || '').match(/fnArtiDetail\(['"](ART\d+)['"]\)/);
        const href = article ? 'https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=' + article[1] : a.getAttribute('href');
        if (!href)
            return [];
        try {
            const url = new URL(href, searchURL(query, provider, material)).href;
            providerFor(url);
            return [{ title: a.textContent.trim(), url }];
        }
        catch {
            return [];
        }
    });
}
export async function autoKorean(parent: any, attachment: any, before: MetadataSnapshot, cancelled: () => boolean, ocr?: (pages: number) => Promise<{
    text: string;
    provider?: string;
}>, options?: {
    fromImages?: boolean;
    frontText?: string;
    readingTitles?: string[];
    pageTexts?: string[];
    material?: RISSMaterial;
}): Promise<KoreanAutoOutcome> {
    const data = options?.frontText ? null : await Zotero.PDFWorker.getRecognizerData(attachment.id, true);
    let text = options?.fromImages ? '' : options?.frontText || pdfFrontMatterText(data, 5), cached = null, filenameCandidate: FilenameTitleCandidate | null = null;
    let readFromImages = false;
    let ocrNote = '';
    if (isWebViewerBoilerplate(text)) {
        cached = await getZotSeekFrontMatter(parent);
        if (cached?.text && !isWebViewerBoilerplate(cached.text))
            text = cached.text;
        else {
            const path = await attachment.getFilePath();
            filenameCandidate = path ? titleFromPDFFilename(path) : null;
            text = filenameCandidate ? [filenameCandidate.author, filenameCandidate.year, filenameCandidate.title].filter(Boolean).join(' ') : '';
        }
    }
    if (!text.trim() && ocr && !cancelled()) {
        try {
            const read = await ocr(5);
            if (read?.text?.trim()) {
                text = read.text;
                readFromImages = true;
                ocrNote = `쪽 이미지 판독: ${read.text.trim().length}자`;
            }
            else
                ocrNote = '쪽 이미지 판독이 빈 결과를 돌려주었습니다.';
        }
        catch (cause) {
            ocrNote = `쪽 이미지 판독 실패: ${String(cause).slice(0, 160)}`;
        }
    }
    if (!text.trim())
        return { candidates: [] as SearchCandidate[], reason: `PDF와 ZotSeek에 사용 가능한 앞부분 본문 없음${ocrNote ? ` — ${ocrNote}` : ' — 쪽 이미지 판독을 시도하지 않았습니다'}`, textless: true };
    if (readFromImages) {
        const titlesRead = extractTitlesFromPlainText(text, !/[가-힣]/.test(text));
        if (!titlesRead.length)
            return { candidates: [] as SearchCandidate[], reason: 'OCR로 읽은 앞부분에서 제목을 찾지 못함', textless: true };
        return await searchKoreanCatalog(parent, before, text, titlesRead, materialFromPDFText(text), cancelled, { minimumScore: 0.88, evidence: 'PDF 쪽 이미지를 OCR로 읽은 앞부분 제목 사용' });
    }
    const material = options?.material || materialFromPDFText(text);
    const koreanVenue = /[가-힣]/.test(text) || /\bkorea(?:n|\.kr)?\b|\.kr\b|한국|대한민국/i.test(text);
    if (material === 'article' && !koreanVenue)
        return {
            candidates: [] as SearchCandidate[],
            notApplicable: true,
            reason: 'Zotero Native 인식 결과 없음 · PDF 앞부분에 국내 학술지·기관 근거가 없어 RISS·KCI·DBpia 검색은 수행하지 않음'
        };
    const latinTitles = material === 'thesis' || !/[가-힣]/.test(text);
    const readable = text.split('\f').filter(page => !isWebViewerBoilerplate(page)).join('\n\f\n') || text;
    const extracted = filenameCandidate ? [filenameCandidate.title] : cached
        ? extractTitlesFromPlainText(readable, latinTitles)
        : data ? extractKoreanTitles(data, material === 'thesis' ? 5 : 1, latinTitles).map(t => t.title)
            : extractTitlesFromPlainText(readable, latinTitles);
    const reading = (options?.readingTitles || []).map(title => String(title || '').trim()).filter(title => title.length >= 4 && !isNotATitle(title));
    const titles = [...new Set([...reading, ...extracted])].slice(0, 4);
    if (!titles.length)
        return { candidates: [] as SearchCandidate[], reason: 'PDF 제목 자동 추출 불확실 — 검토 필요' };
    return await searchKoreanCatalog(parent, before, text, titles, material, cancelled, {
        pageTexts: options?.pageTexts?.length ? options.pageTexts : readable.split('\f'),
        minimumScore: filenameCandidate ? 0.94 : 0.88,
        evidence: filenameCandidate ? 'PDF 텍스트층이 웹뷰어 머리말뿐이어서 PDF 파일명의 저자·연도·제목 사용' : cached?.reason || 'PDF 앞부분 제목 사용',
        routes: filenameCandidate
            ? [{ material: 'thesis', providers: ['RISS'] }, { material: 'article', providers: ['RISS', 'KCI', 'DBpia'] }]
            : undefined
    });
}
export interface KoreanAutoOutcome extends KoreanCatalogOutcome {
    textless?: boolean;
    notApplicable?: boolean;
}
export interface KoreanCatalogOptions {
    minimumScore: number;
    evidence: string;
    routes?: Array<{
        material: RISSMaterial;
        providers: string[];
    }>;
    pageTexts?: string[];
}
export interface KoreanCatalogOutcome {
    candidates: SearchCandidate[];
    result?: Awaited<ReturnType<typeof translateKoreanPage>>;
    verified?: boolean;
    reason: string;
    failed?: boolean;
}
const HANJA_NAME_LINE = /^(?:(?:저\s*자|성\s*명|姓\s*名|著\s*者|作\s*者)\s*[:：]?\s*)?(\p{Script=Han}(?:[ 　]?\p{Script=Han}){1,3})\s*[\d*†‡]*$/u;
export function hanjaBylineNames(text: string): string[] {
    const names = new Set<string>();
    for (const raw of String(text || '').normalize('NFKC').split(/[\r\n\f]+/)) {
        const line = raw.trim();
        if (!line || line.length > 24)
            continue;
        const found = HANJA_NAME_LINE.exec(line);
        if (found)
            names.add(found[1].replace(/[ 　]/g, ''));
    }
    return [...names];
}
export async function searchKoreanCatalog(parent: any, before: MetadataSnapshot, text: string, titles: string[], material: RISSMaterial, cancelled: () => boolean, options: KoreanCatalogOptions): Promise<KoreanCatalogOutcome> {
    const errors: string[] = [];
    const routes = options.routes || (material === 'thesis'
        ? [{ material: 'thesis' as RISSMaterial, providers: ['RISS'] }, { material: 'article' as RISSMaterial, providers: ['DBpia', 'KCI'] }]
        : [{ material: 'article' as RISSMaterial, providers: ['RISS', 'KCI', 'DBpia'] }]);
    let candidates: SearchCandidate[] = [];
    for (const route of routes) {
        if (cancelled() || candidates.some(candidate => candidate.score >= options.minimumScore))
            break;
        const routeLinks: {
            title: string;
            url: string;
        }[] = [];
        queries: for (const title of titles) {
            for (const provider of route.providers) {
                if (cancelled())
                    break queries;
                try {
                    routeLinks.push(...await search(title, cancelled, provider, route.material));
                }
                catch (e) {
                    errors.push(`${provider}: ${String(e)}`);
                }
                if (rankSearchLinks(routeLinks, titles, route.material, options.pageTexts).some(candidate => candidate.score >= options.minimumScore))
                    break queries;
            }
        }
        candidates.push(...rankSearchLinks(routeLinks, titles, route.material, options.pageTexts));
    }
    candidates = candidates.sort(candidateOrder).filter((candidate, index, all) => all.findIndex(other => other.url === candidate.url) === index).slice(0, 3);
    const route = [...new Set(routes.flatMap(entry => entry.providers))].join('·');
    if (cancelled() || !candidates.length)
        return { candidates, reason: cancelled() ? '취소됨' : errors.length ? errors.join('\n') : `${route} ${material === 'thesis' ? '학위논문' : '논문'} 검색 일치 후보 없음`, failed: errors.length > 0 };
    const best = candidates[0];
    const distinct = candidates.find(c => c !== best && titleSimilarity(c.title, best.title) < 0.97 && best.score - c.score < 0.1
        && !anotherVolumeOfTheSameSet(c.title, best.title, options.pageTexts || text.split('\f')));
    if (best.score < options.minimumScore || distinct)
        return { candidates, reason: '후보 일치도 부족 또는 복수 후보 — 자동 채택 안 함' };
    const verifiedCandidates = candidates
        .filter(c => c.score >= options.minimumScore)
        .sort((a, b) => Number(providerFor(a.url).file !== 'RISS') - Number(providerFor(b.url).file !== 'RISS') || b.score - a.score);
    for (const candidate of verifiedCandidates) {
        if (cancelled())
            break;
        try {
            const result = await translateKoreanPage(parent, candidate.url, before);
            const titleScore = titleFromReading(result.title, titles, options.pageTexts) ? 1 : Math.max(...titles.map(t => titleSimilarity(t, result.title)));
            const creators = result.metadata.creators as any[];
            const normalizedText = compact(text);
            const hanjaNames = hanjaBylineNames(text);
            const authorHit = creators.some(c => [(c.lastName || c.name || '') + (c.firstName || ''), (c.firstName || '') + (c.lastName || c.name || '')]
                .map(compact).some(name => name.length >= 2 && normalizedText.includes(name))
                || hanjaNames.some(name => sameKoreanPersonAcrossScripts({ lastName: name }, { lastName: c.lastName || c.name || '', firstName: c.firstName || '' })));
            if (titleScore < options.minimumScore) {
                errors.push('상세 페이지 제목과 PDF 제목 불일치');
                continue;
            }
            const verified = titleScore >= 0.97 && authorHit;
            return { candidates, result, verified, reason: `${options.evidence} · ${providerFor(candidate.url).file}: 제목 ${Math.round(titleScore * 100)}% / 저자 ${authorHit ? '근거에서 확인' : '확인 부족'} — ${verified ? 'PDF 근거와 일치' : '수동 검토 필요'}\n${result.notes.join('\n')}` };
        }
        catch (e) {
            errors.push(`${candidate.url}: ${String(e)}`);
        }
    }
    return { candidates, failed: true, reason: errors.join('\n') || '상세 추출 실패 또는 취소됨' };
}

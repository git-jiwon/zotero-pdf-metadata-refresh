import { buildDiff } from '../metadata/diff';
import { assertIdentityUnchanged, captureIdentity } from '../metadata/snapshot';
import type { MetadataSnapshot } from '../types';
import { enrichKoreanFields, withKoreanTranslatorLayout } from '../metadata/korean-fields';
import { getPublicPage } from '../utils/http';
import { canonicalDate } from './roles';
export const revision = '2af7ae45aa96421fc43e0cd22d5f633469464ead';
const providers: Record<string, {
    file: string;
    id: string;
}> = {
    'www.kci.go.kr': { file: 'KCI', id: '179714c7-b3a1-4dcd-8a5a-d9dc69121ff7' },
    'www.dbpia.co.kr': { file: 'DBpia', id: '0c31f371-e012-4b1c-b793-f89ab1ae2610' },
    'www.riss.kr': { file: 'RISS', id: 'e05a0077-b156-4235-8d2c-fbcb7ae164e3' },
    'm.riss.kr': { file: 'RISS', id: 'e05a0077-b156-4235-8d2c-fbcb7ae164e3' }
};
export function providerFor(url: string) {
    const parsed = new URL(url);
    const provider = providers[parsed.hostname];
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !provider)
        throw new Error('KCI·DBpia·RISS의 HTTPS 논문 상세 URL만 사용할 수 있습니다.');
    const pathOK = provider.file === 'KCI' ? parsed.pathname === '/kciportal/ci/sereArticleSearch/ciSereArtiView.kci'
        : provider.file === 'DBpia' ? parsed.pathname === '/journal/articleDetail'
            : parsed.pathname.startsWith('/search/detail/DetailView') || (parsed.pathname === '/link' && parsed.searchParams.has('id'));
    if (!pathOK)
        throw new Error('검색 목록이 아닌 논문 상세 페이지 URL을 입력하세요.');
    return provider;
}
export function pdfFirstPageText(data: any): string {
    const strings: string[] = [];
    const visit = (value: any) => {
        if (typeof value === 'string')
            strings.push(value);
        else if (Array.isArray(value))
            value.forEach(visit);
    };
    visit(data?.pages?.[0]?.[2]);
    return strings.join(' ').slice(0, 16000);
}
export function pdfFrontMatterText(data: any, pageLimit = 5): string {
    const strings: string[] = [];
    const visit = (value: any) => {
        if (typeof value === 'string')
            strings.push(value);
        else if (Array.isArray(value))
            value.forEach(visit);
    };
    for (const page of (data?.pages || []).slice(0, pageLimit))
        visit(page?.[2]);
    return strings.join(' ').slice(0, 50000);
}
export function queryFromPDF(query: string, evidence: string): string {
    const normalize = (s: string) => s.normalize('NFC').replace(/\s+/g, '');
    if (query.length < 5 || query.length > 200 || !/[가-힣]/.test(query)
        || !normalize(evidence).includes(normalize(query)))
        throw new Error('PDF 첫 페이지에 있는 한국어 제목 구절을 입력하세요. 기존 parent 제목은 검색에 사용하지 않습니다.');
    return query.trim();
}
async function ensureTranslator(provider: {
    file: string;
    id: string;
}) {
    await Zotero.Translators.init();
    let translator = Zotero.Translators.get(provider.id);
    if (translator)
        return translator;
    const response = await Zotero.HTTP.request('GET', `https://raw.githubusercontent.com/go00ood/zotero-translators-kr/${revision}/${provider.file}.js`);
    const source = response.responseText;
    const end = source.indexOf('\n}');
    if (end < 0)
        throw new Error('Invalid translator metadata');
    const metadata = JSON.parse(source.slice(0, end + 2));
    if (metadata.translatorID !== provider.id || metadata.translatorType !== 4)
        throw new Error('Unexpected translator identity');
    metadata.label = `PDF Metadata Refresh KR ${provider.file}`;
    const path = Zotero.Translators.getSavePath(metadata);
    if (await IOUtils.exists(path))
        throw new Error('Translator destination already exists; refusing overwrite');
    await Zotero.Translators.save(metadata, source.slice(end + 2));
    await Zotero.Translators.reinit();
    translator = Zotero.Translators.get(provider.id);
    if (!translator)
        throw new Error('Translator installation failed');
    return translator;
}
export async function translateKoreanPage(parent: any, url: string, before: MetadataSnapshot) {
    const provider = providerFor(url);
    const translator = await ensureTranslator(provider);
    {
        const response = await getPublicPage(url);
        const finalURL = response.responseURL || url;
        providerFor(finalURL);
        const Parser = Zotero.getMainWindow().DOMParser;
        const parsed = new Parser().parseFromString(response.responseText, 'text/html');
        const doc = Zotero.Translate.DOMWrapper.wrap(parsed, {
            documentURI: finalURL, URL: finalURL,
            location: new Zotero.HTTP.Location(Services.io.newURI(finalURL)),
            cookie: ''
        });
        const translate = new Zotero.Translate.Web();
        translate.setDocument(doc);
        translate.setTranslator(translator);
        const items = await translate.translate({ libraryID: false, saveAttachments: false });
        if (items.length !== 1 || !items[0].title)
            throw new Error('서지정보를 추출하지 못했습니다. 접근 제한 또는 페이지 변경 가능성이 있습니다.');
        const json = items[0];
        const moved = withKoreanTranslatorLayout(json);
        const notes = enrichKoreanFields(json, doc, provider.file);
        if (moved.publisher)
            notes.unshift(`번역기의 학회 칸(publicationTitle)을 발행처로, 학술지 칸(seriesTitle)을 학술지명으로 기록: ${json.publisher} / ${json.publicationTitle}`);
        for (const field of ['date', 'filingDate', 'issueDate']) {
            if (typeof json[field] === 'string') {
                const canonical = canonicalDate(json[field]);
                if (canonical)
                    json[field] = canonical;
            }
        }
        const candidate = new Zotero.Item(json.itemType);
        candidate.libraryID = parent.libraryID;
        const publisherID = Zotero.ItemFields.getID('publisher');
        if (json.publisher && !Zotero.ItemFields.isValidForType(publisherID, candidate.itemTypeID)) {
            const universityID = Zotero.ItemFields.getID('university');
            if (universityID && Zotero.ItemFields.isValidForType(universityID, candidate.itemTypeID)) {
                json.university = json.publisher;
                notes.push('발행기관을 이 항목 유형의 university 필드로 기록');
            }
            else {
                json.extra = `Publisher: ${json.publisher}`;
                notes.push('이 항목 유형은 publisher 필드를 지원하지 않아 Extra에 발행기관 보존');
            }
        }
        for (const [field, value] of Object.entries(json)) {
            const id = Zotero.ItemFields.getID(field);
            if (id && Zotero.ItemFields.isValidForType(id, candidate.itemTypeID) && typeof value === 'string' && value)
                candidate.setField(id, value);
        }
        candidate.setCreators(json.creators || []);
        const fields: Record<string, string> = {};
        for (const id of Zotero.ItemFields.getItemTypeFields(candidate.itemTypeID)) {
            const value = candidate.getField(id);
            if (value)
                fields[Zotero.ItemFields.getName(id)] = value;
        }
        assertIdentityUnchanged(before.identity, await captureIdentity(parent));
        const metadata = { ...before, fields, creators: candidate.getCreators(), itemTypeID: candidate.itemTypeID, itemType: json.itemType };
        return { changes: buildDiff(before, metadata), title: json.title, metadata, notes };
    }
}

import { personCreator } from '../recognition/agents';
import { isKoreanSurname, isOrganisationName, isOrganisationOnly, isPersonalName } from '../recognition/title-guards';
import { romanise, sameKoreanPerson, splitHangulName } from './korean-names';
import { personParts } from './person-name';
const initials = ['gk', 'gk', 'n', 'dt', 'dt', 'rl', 'm', 'bp', 'bp', 's', 's', 'aeiouwy', 'j', 'j', 'c', 'k', 't', 'p', 'h'];
function surnameReads(hangul: string, family: string): boolean {
    const split = splitHangulName(hangul);
    return !!split?.given && sameKoreanPerson(hangul, family.trim(), romanise(split.given));
}
export function pairedAuthors(names: string[]): {
    names: string[];
    paired: boolean;
} {
    const unique = [...new Set(names.map(n => n.trim()).filter(Boolean))];
    const korean = unique.filter(n => /^[가-힣]{2,5}$/.test(n));
    const latin = unique.filter(n => /^[A-Za-z]+(?:[-'][A-Za-z]+)?,\s*(?:[A-Za-z]\.-?\s*){1,4}$/.test(n));
    if (!korean.length || korean.length !== latin.length || korean.length + latin.length !== unique.length)
        return { names: unique, paired: false };
    const paired = korean.every((name, i) => {
        const split = splitHangulName(name);
        if (!split?.given)
            return false;
        const [family, given] = latin[i].split(',');
        const letters = given.replace(/[^A-Za-z]/g, '').toLowerCase();
        return letters.length === split.given.length
            && [...split.given].every((s, j) => initials[Math.floor((s.charCodeAt(0) - 0xac00) / 588)].includes(letters[j]))
            && surnameReads(name, family);
    });
    return { names: paired ? korean : unique, paired };
}
export function koreanRecordPerson(value: unknown, creatorType = 'author'): {
    lastName: string;
    firstName: string;
    creatorType: string;
    fieldMode?: number;
} | null {
    const printed = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const inside = ((printed.match(/[（(]([^()（）]*)[)）]/) || [])[1] || '').trim();
    const outside = printed.replace(/\s*[（(][^()（）]*[)）]\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const name = /[가-힣]/.test(inside) && !/[가-힣]/.test(outside) ? inside : (outside || inside);
    if (!name)
        return null;
    if (!(/^[가-힣]+$/.test(name) && isPersonalName(name)) && (isOrganisationName(name) || isOrganisationOnly(name))) {
        return { lastName: name, firstName: '', fieldMode: 1, creatorType };
    }
    const tokens = name.split(' ');
    if (/^[가-힣]+(?: [가-힣]+)+$/.test(name) && !(isKoreanSurname(tokens[0]) && isPersonalName(tokens.join('')))) {
        const parts = personParts(name);
        if (parts && parts.fieldMode === 0)
            return { lastName: parts.lastName, firstName: parts.firstName, creatorType };
    }
    const person = personCreator(name, creatorType);
    return person ? { lastName: String(person.lastName || ''), firstName: String(person.firstName || ''), creatorType,
        ...(person.fieldMode === 1 ? { fieldMode: 1 } : {}) } : null;
}
export const KOREAN_TRANSLATOR_LABEL = /^PDF Metadata Refresh KR\b/;
const nameLetters = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export function withKoreanTranslatorLayout(json: any): {
    publicationTitle?: 'seriesTitle';
    publisher?: 'publicationTitle';
} {
    const moved: {
        publicationTitle?: 'seriesTitle';
        publisher?: 'publicationTitle';
    } = {};
    if (!json || (json.itemType && json.itemType !== 'journalArticle'))
        return moved;
    const series = String(json.seriesTitle ?? '').trim();
    if (!series)
        return moved;
    const society = String(json.publicationTitle ?? '').trim();
    json.publicationTitle = series;
    delete json.seriesTitle;
    moved.publicationTitle = 'seriesTitle';
    if (society && nameLetters(society) !== nameLetters(series) && !String(json.publisher ?? '').trim()) {
        json.publisher = society;
        moved.publisher = 'publicationTitle';
    }
    return moved;
}
export function enrichKoreanFields(json: any, doc: any, provider: string): string[] {
    const notes: string[] = [];
    const meta = (name: string) => doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim();
    if (provider === 'RISS') {
        const names = [...doc.querySelectorAll('a[href*="queryText=znCreator,"]')].map((a: any) => a.textContent.trim());
        if (names.length) {
            const result = pairedAuthors(names);
            json.creators = result.names.map(name => koreanRecordPerson(name, 'author')).filter(Boolean);
            if (result.paired)
                notes.push('한글·영문 저자의 순서·성·이니셜 대응 확인: 한글 이름만 적용');
            else if (names.some((n: string) => /[A-Za-z]/.test(n)) && names.some((n: string) => /[가-힣]/.test(n)))
                notes.push('한글·영문 저자 대응 불확실: 개별 저자로 유지, 검토 필요');
        }
    }
    if (provider === 'KCI') {
        const title = doc.querySelector('#artiTitle')?.textContent?.replace(/\s+/g, ' ').trim();
        if (title && /[가-힣]/.test(title))
            json.title = title;
        const authorRaw = doc.querySelector('#hdnAuthor')?.getAttribute('value') || '';
        const parts: string[] = authorRaw.split(/[,;；、](?![^()（）]*[)）])/).map((part: string) => part.trim()).filter(Boolean);
        const hangulOf = (part: string) => (part.match(/[가-힣]+(?:\s+[가-힣]+)*/) || [''])[0].replace(/\s+/g, '');
        const hangul = parts.map(hangulOf).filter(Boolean);
        const people = parts.filter(part => hangulOf(part) || !hangul.some(name => sameKoreanPerson(name, part)));
        const creators = people.map(part => koreanRecordPerson(part, 'author')).filter(Boolean);
        if (hangul.length && creators.length) {
            json.creators = creators;
            notes.push('KCI 국문 제목·저자 필드 우선 적용');
        }
    }
    if (provider === 'RISS' && !/[가-힣]/.test(String(json.title || ''))) {
        const candidates = [...doc.querySelectorAll('#artiTitle, #articleTitle, .articleTitle, .article-title, h1.title, h2.title')]
            .map((node: any) => node.textContent?.replace(/\s+/g, ' ').trim() || '')
            .filter((value: string) => value.length >= 6 && value.length <= 240 && /[가-힣]/.test(value))
            .filter((value: string) => !/^(?:RISS|검색|통합검색|목록|초록|참고문헌|키워드)/.test(value));
        if (candidates.length) {
            json.title = candidates.sort((a, b) => b.length - a.length)[0];
            notes.push('RISS 화면의 국문 제목 우선 적용');
        }
    }
    const fillable = (held: unknown, stated: string) => !String(held ?? '').trim() || (/[가-힣]/.test(stated) && !/[가-힣]/.test(String(held)));
    const publisher = meta('citation_publisher') || meta('DC.Publisher');
    if (publisher && fillable(json.publisher, publisher))
        json.publisher = publisher;
    const journal = meta('citation_journal_title');
    if (journal && fillable(json.publicationTitle, journal))
        json.publicationTitle = journal;
    let doi = meta('citation_doi') || meta('DC.Identifier.DOI');
    if (!doi) {
        for (const li of doc.querySelectorAll('li')) {
            if (!/^DOI\s*식별코드$/i.test(li.querySelector('span.strong')?.textContent.trim() || ''))
                continue;
            doi = li.querySelector('a[href*="doi.org/"]')?.getAttribute('href');
            if (doi)
                break;
        }
    }
    if (doi) {
        const cleaned = doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').trim();
        if (/^10\.\d{4,9}\/\S+$/i.test(cleaned))
            json.DOI = cleaned;
    }
    return notes;
}

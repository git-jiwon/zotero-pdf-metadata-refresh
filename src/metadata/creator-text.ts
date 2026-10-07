import { KOREAN_ORGANISATION_ENDING } from '../recognition/title-guards';
import { NAME_JOINERS, isKoreanSurname, personParts, suffixOnTheGivenSide } from './person-name';
export interface CreatorLike {
    firstName?: unknown;
    lastName?: unknown;
    name?: unknown;
    fieldMode?: unknown;
    creatorType?: unknown;
}
const text = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
export function creatorRole(person: CreatorLike): string {
    const named = text(person?.creatorType);
    if (named)
        return named;
    const id = (person as any)?.creatorTypeID;
    if (id === undefined || id === null || id === '')
        return '';
    try {
        return text((globalThis as any).Zotero?.CreatorTypes?.getName?.(id));
    }
    catch {
        return '';
    }
}
export function creatorDisplayName(person: CreatorLike): string {
    const last = text(person.lastName) || text(person.name);
    const first = text(person.firstName);
    if (person.fieldMode === 1 || !first)
        return last;
    return `${last}, ${first}`;
}
export function creatorsToText(creators: unknown): string {
    if (!Array.isArray(creators))
        return '';
    return creators.map(creator => {
        const person = (creator || {}) as CreatorLike;
        return creatorDisplayName(person);
    }).filter(Boolean).join('\n');
}
function commaBetweenPeople(line: string): number {
    let depth = 0;
    for (let at = 0; at < line.length; at++) {
        const mark = line[at];
        if (mark === '(' || mark === '（')
            depth++;
        else if (mark === ')' || mark === '）')
            depth = Math.max(0, depth - 1);
        else if (mark === ',' && depth === 0)
            return at;
    }
    return -1;
}
export function creatorsFromText(value: unknown, template: unknown): Array<Record<string, unknown>> {
    const source = (Array.isArray(template) ? template : []) as CreatorLike[];
    const lastType = creatorRole(source[source.length - 1]) || 'author';
    const used = new Set<number>();
    return String(value ?? '').split(/\r?\n/).map(line => text(line)).filter(Boolean).map((line, index) => {
        let at = source.findIndex((person, spot) => !used.has(spot) && creatorDisplayName(person) === line);
        if (at < 0 && index < source.length && !used.has(index))
            at = index;
        if (at >= 0)
            used.add(at);
        const original = at >= 0 ? source[at] : undefined;
        const creatorType = creatorRole(original as CreatorLike) || lastType;
        const comma = LATIN_BODY_NAME.test(line) || KOREAN_BODY_NAME.test(line.replace(/\s+/g, '')) ? -1 : commaBetweenPeople(line);
        if (comma < 0)
            return { firstName: '', lastName: line, fieldMode: 1, creatorType };
        const lastName = text(line.slice(0, comma)), firstName = text(line.slice(comma + 1));
        if (!lastName)
            return { firstName: '', lastName: firstName, fieldMode: 1, creatorType };
        if (!firstName)
            return { firstName: '', lastName, fieldMode: 1, creatorType };
        return { firstName, lastName, creatorType };
    }).filter(creator => !!creator.lastName);
}
export function isKnownItemType(value: unknown): boolean {
    const candidate = text(value);
    if (!/^[a-zA-Z]+$/.test(candidate))
        return false;
    const host = (globalThis as any).Zotero;
    if (!host?.ItemTypes?.getID)
        return true;
    try {
        return !!host.ItemTypes.getID(candidate);
    }
    catch {
        return false;
    }
}
const KOREAN_BODY_NAME = new RegExp(`${KOREAN_ORGANISATION_ENDING}$`);
const LATIN_BODY_NAME = /\b(?:Universit\w*|Institut\w*|Agency|Ministr\w*|Department|Dept|Council|Association|Society|Committee|Commission|Cent(?:er|re)|Foundation|Organi[sz]ation|Office|Bureau|Laborator\w*|Corporation|Corp|Inc|Ltd|LLC|GmbH|Company|Group|Board|Authority|Administration|Service|Survey|Program\w*|Project|Consortium|Network|Federation|Union|Academy|College|School|Hospital|Bank|Panel|Secretariat|Division|Press|Publish\w*|Publications?|Archive|Library|Museum|Government|Republic|Kingdom|Nations|Parliament|Congress|Court|Team|Working)\b/i;
export function looksLikeABody(value: unknown): boolean {
    const spaced = String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const joined = spaced.replace(/\s+/g, '');
    if (/[가-힣]/.test(joined))
        return KOREAN_BODY_NAME.test(joined) && !(joined.length <= 3 && /[부청처]$/.test(joined));
    return LATIN_BODY_NAME.test(spaced) && spaced.split(' ').length >= 3;
}
const NAME_PARTICLE = NAME_JOINERS.particle;
export function nameAsItIsWritten(creator: any): any {
    if (!creator)
        return creator;
    const last = String(creator.lastName ?? '').trim();
    const first = String(creator.firstName ?? '').trim();
    if (last && first && creator.fieldMode !== 1)
        return suffixOnTheGivenSide(creator);
    const whole = (last || first).replace(/\s+/g, ' ').trim();
    if (!whole)
        return creator;
    const two = (family: string, given: string) => {
        const f = family.trim(), g = given.trim();
        if (!f || !g)
            return creator;
        return { ...creator, lastName: f, firstName: g, fieldMode: 0 };
    };
    if (KOREAN_BODY_NAME.test(whole.replace(/\s+/g, '')) || LATIN_BODY_NAME.test(whole))
        return creator;
    const parted = (value: string) => { const parts = personParts(value); return parts && parts.fieldMode === 0 ? two(parts.lastName, parts.firstName) : creator; };
    if (/^[가-힣]+$/.test(whole)) {
        if (whole.length < 2 || whole.length > 5)
            return creator;
        return parted(whole);
    }
    if (/^[가-힣][가-힣\s·ㆍ‐‑–-]*$/.test(whole) && whole.includes(' '))
        return parted(whole);
    if (/^[\p{Script=Latin}\s.,'’‐‑–-]+$/u.test(whole)) {
        const comma = whole.indexOf(',');
        if (comma > 0)
            return parted(whole);
        const words = whole.split(' ');
        const particled = words.slice(1, -1).some(word => NAME_PARTICLE.test(word));
        if (words.length < 2 || words.length > (particled ? 5 : 4))
            return creator;
        return parted(whole);
    }
    const cjk = /^([぀-ヿ㐀-鿿々]+)\s+([぀-ヿ㐀-鿿々]+)$/u.exec(whole);
    if (cjk)
        return two(cjk[1], cjk[2]);
    return creator;
}
const GLUED_INITIALS = /(?<![\p{L}])(?:\p{Lu}\.){2,}(?![\p{L}])/gu;
function initialsSpaced(person: any): any {
    const first = String(person?.firstName ?? '');
    if (!first || person?.fieldMode === 1)
        return person;
    const spaced = initialsSpacedText(first);
    return spaced === first ? person : { ...person, firstName: spaced };
}
export function initialsSpacedText(value: unknown): string {
    return String(value ?? '').replace(GLUED_INITIALS, run => run.replace(/\.(?=\p{Lu})/gu, '. '));
}
export function nameAsStored(creator: any): any {
    if (!creator || creator.fieldMode === 1)
        return creator;
    const shaped = nameAsItIsWritten(creator);
    if (!shaped || shaped.fieldMode === 1)
        return shaped;
    const last = String(shaped.lastName ?? '').trim(), first = String(shaped.firstName ?? '').trim();
    const whole = `${last}${first}`;
    if (!whole || !/^[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々\s·ㆍᆞ‐‑–-]+$/u.test(`${last} ${first}`.trim()))
        return initialsSpaced(shaped);
    const hangul = /[가-힣]/.test(whole);
    const korean = !hangul || (!/\s/.test(`${last}${first}`) && [...last].length <= 2 && [...first].length <= 3 && isKoreanSurname(last));
    const name = korean ? `${last}${first}` : [first, last].filter(Boolean).join(' ');
    const { firstName: _given, ...rest } = shaped;
    return { ...rest, lastName: name, firstName: '', fieldMode: 1 };
}

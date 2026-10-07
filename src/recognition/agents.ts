import type { SemanticRole } from './roles';
import { isPersonalName, isKoreanSurname, isPublishingHouse, TWO_SYLLABLE_SURNAMES } from './title-guards';
import { NAME_SUFFIX, hangulSurnameLength, koreanSurnameOfHanja, personParts } from '../metadata/person-name';
import { withoutTrailingBracketGroup } from '../metadata/text';
import { casedAsPrinted } from '../metadata/name-equivalence';
export type AgentRole = 'author' | 'editor' | 'translator' | 'contributor' | 'advisor' | 'committee' | 'copyrightHolder' | 'publisher' | 'imprintParent' | 'issuingBody' | 'commissioningBody' | 'contractor' | 'leadBody' | 'degreeGranting' | 'affiliation';
export interface AgentMention {
    name: string;
    role: AgentRole;
    method: string;
    page?: number | null;
    raw?: string;
}
export interface Placement {
    fields: {
        creators?: Array<Record<string, any>>;
        publisher?: string;
        institution?: string;
        university?: string;
    };
    sources: Record<string, any>;
    aside: Record<string, any>;
    refused: Array<{
        field: string;
        name: string;
        role: AgentRole;
        reason: string;
    }>;
}
const NFKC = (value: unknown) => String(value || '').normalize('NFKC');
const tidy = (value: unknown) => NFKC(value).replace(/\s+/g, ' ').trim();
const key = (value: unknown) => tidy(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const KOREAN = /[가-힯]/;
const HAN = /^[\u3400-\u9fff]+$/u;
const CJK_KEYED_NAME = /^([가-힣]{2,4}|[㐀-鿿][㐀-鿿가-힣]{1,5})(?:\d{1,2}[a-z]?|[a-z]\d{0,2})\)?(?:\s*[,;]\s*(?:\d{1,2}[a-z]?|[a-z]\d{0,2})\)?)*$/u;
export function personCreator(name: unknown, creatorType = 'author', context: {
    bodyLanguage?: string | null;
} = {}): Record<string, any> | null {
    const unmarked = tidy(name).replace(/^(?:by|edited\s+by|written\s+by)\s+/i, '').replace(/(?<![*†‡§¶\d])[*†‡§¶\d]+$/, '').trim();
    const value = CJK_KEYED_NAME.exec(unmarked)?.[1] ?? unmarked;
    if (!value)
        return null;
    if (KOREAN.test(value)) {
        const bare = value.replace(/\s+/g, '');
        if (bare.length < 2)
            return null;
        const spaced = value.split(/\s+/).filter(Boolean);
        if (spaced.length > 1 && spaced.every(part => /^[가-힣·‐-]+$/.test(part))) {
            const rest = spaced.slice(1).join('');
            if (isKoreanSurname(spaced[0]) && /^[가-힣]{1,3}$/.test(rest))
                return { lastName: spaced[0], firstName: rest, creatorType };
            return { lastName: spaced.join(' '), firstName: '', fieldMode: 1, creatorType };
        }
        if (!isPersonalName(bare) && !TWO_SYLLABLE_SURNAMES.includes(bare.slice(0, 2))) {
            return { lastName: bare, firstName: '', fieldMode: 1, creatorType };
        }
        const surname = hangulSurnameLength(bare);
        return { lastName: bare.slice(0, surname), firstName: bare.slice(surname), creatorType };
    }
    if (HAN.test(value.replace(/\s+/g, '')) || /[぀-ヿ]/u.test(value)) {
        const parts = personParts(value.trim(), { bodyLanguage: context.bodyLanguage });
        if (!parts)
            return null;
        return parts.fieldMode === 1 ? { lastName: parts.lastName, firstName: '', fieldMode: 1, creatorType } : { lastName: parts.lastName, firstName: parts.firstName, creatorType };
    }
    if (value.includes(',')) {
        const pieces = value.split(',').map(part => part.trim());
        if (pieces.length >= 2 && NAME_SUFFIX.test(pieces[pieces.length - 1])) {
            const parts = personParts(value);
            if (parts && parts.fieldMode === 0)
                return { lastName: parts.lastName, firstName: parts.firstName, creatorType };
        }
        const [last, first] = pieces;
        return { lastName: last, firstName: first || '', creatorType };
    }
    if (value.split(' ').length === 1)
        return { lastName: value, firstName: '', fieldMode: 1, creatorType };
    const parts = personParts(value);
    if (!parts || parts.fieldMode === 1)
        return { lastName: value, firstName: '', fieldMode: 1, creatorType };
    return { lastName: parts.lastName, firstName: parts.firstName, creatorType };
}
export const NAME_AFTER_SCHOOL_WORD = String.raw `Universi(?:dade|dad|t(?:ät|é|à|eit|atea|et))|Uniwersytet|Univerzita`;
const SCHOOL_WORD = String.raw `(?:University|${NAME_AFTER_SCHOOL_WORD}|Institute\s+of\s+Technology|Polytechnic)`;
const NAME_FOLLOWS_THE_WORD = new RegExp(String.raw `(?:${NAME_AFTER_SCHOOL_WORD})$`, 'u');
const SCHOOL_WORD_ONLY = new RegExp(String.raw `^${SCHOOL_WORD}$`, 'u');
const SCHOOL_LINE = new RegExp(String.raw `((?:(?:[A-Z][\p{L}'’&.–-]*|de|la|für|des)\s+){0,4}${SCHOOL_WORD}(?![\p{L}\p{N}])(?:\s+(?:of|de|für|di)\s+(?:the\s+)?[A-Z][\p{L}'’.–-]+(?:\s+[A-Z][\p{L}'’.–-]+){0,2})?)`, 'u');
const UNIT_OF_A_SCHOOL = /^(?:[가-힣]{0,8}(?:대학원|대학|학부|학과|전공|연구실|캠퍼스)|大學院|Graduate|School|Schools|College|Department|Faculty|Facult[ée]|Fakultät|Division|Campus|École|Ecole|Escuela|Institut|Instituto|Press|Library|Hospital|Cent(?:er|re))(?![\p{L}\p{N}])/u;
const PARTICLE = 'de|del|della|delle|degli|dei|di|du|des|da|das|do|dos|van|von|der|den|la|le|el|los|las';
const NAME_WORD = new RegExp(`^(?:[\\p{Lu}][\\p{L}\\p{N}'’.–-]*|[IVXLC]{1,5}|${PARTICLE})$`, 'u');
const TRAILING_PARTICLE = new RegExp(`\\s+(?:${PARTICLE})$`, 'u');
function withApposedName(head: string, rest: string): string {
    if (!NAME_FOLLOWS_THE_WORD.test(head))
        return head;
    let out = head;
    for (const word of (rest.match(/^[^,;:(\[\]\/·|]*/) || [''])[0].trim().split(/\s+/)) {
        if (!word || UNIT_OF_A_SCHOOL.test(word) || !NAME_WORD.test(word))
            break;
        out += ` ${word}`;
        if (word.endsWith('.') || out.split(/\s+/).length >= 6)
            break;
    }
    return out.replace(TRAILING_PARTICLE, '');
}
export const HANJA_IN_SCHOOL_NAMES: Record<string, string> = {
    大: '대', 學: '학', 学: '학', 校: '교', 院: '원', 科: '과', 技: '기', 術: '술', 硏: '연', 研: '연', 究: '구',
    國: '국', 立: '립', 私: '사', 中: '중', 央: '앙', 東: '동', 西: '서', 南: '남', 北: '북', 京: '경',
    慶: '경', 高: '고', 麗: '려', 延: '연', 世: '세', 成: '성', 均: '균', 館: '관', 漢: '한', 陽: '양',
    建: '건', 弘: '홍', 益: '익', 全: '전', 忠: '충', 淸: '청', 釜: '부', 山: '산', 仁: '인', 荷: '하',
    檀: '단', 明: '명', 知: '지', 嶺: '영', 啓: '계', 朝: '조', 鮮: '선', 圓: '원', 光: '광', 江: '강',
    原: '원', 濟: '제', 州: '주', 群: '군', 木: '목', 浦: '포', 順: '순', 天: '천', 韓: '한', 畿: '기',
    水: '수', 女: '여', 子: '자', 師: '사', 範: '범', 敎: '교', 教: '교', 育: '육', 農: '농', 工: '공',
    業: '업', 商: '상', 經: '경', 法: '법', 醫: '의', 藥: '약', 齒: '치', 川: '천', 宗: '종',
    嘉: '가', 泉: '천', 亞: '아', 細: '세', 尙: '상', 尚: '상', 湖: '호', 新: '신', 培: '배', 才: '재',
    熙: '희', 民: '민', 崇: '숭', 實: '실', 邱: '구', 淑: '숙', 城: '성', 昌: '창', 蔚: '울', 德: '덕',
    誠: '성', 聖: '성', 公: '공', 梨: '리', 花: '화', 羅: '라', 安: '안', 晉: '진', 陵: '릉', 田: '전',
    義: '의', 海: '해', 洋: '양', 外: '외', 語: '어', 放: '방', 送: '송', 航: '항', 空: '공', 同: '동',
    祥: '상', 牧: '목', 園: '원', 材: '재', 云: '운', 又: '우', 石: '석', 春: '춘', 平: '평', 澤: '택',
    首: '수', 都: '도', 進: '진', 永: '영', 英: '영', 理: '리', 部: '부',
    一: '일', 般: '반', 專: '전', 専: '전', 門: '문', 特: '특', 殊: '수', 保: '보', 健: '건', 情: '정', 報: '보',
    産: '산', 產: '산', 行: '행', 政: '정', 通: '통', 信: '신', 環: '환', 境: '경', 築: '축', 設: '설',
    營: '영', 社: '사', 會: '회', 福: '복', 祉: '지', 文: '문', 化: '화', 言: '언', 論: '론', 藝: '예',
    體: '체', 神: '신', 看: '간', 護: '호', 生: '생', 命: '명', 資: '자', 源: '원', 電: '전', 際: '제',
    融: '융', 合: '합', 共: '공', 策: '책', 攻: '공',
};
export { HANJA_SURNAMES, koreanSurnameOfHanja } from '../metadata/person-name';
function atTheStartOfAWord(syllable: string): string {
    const code = syllable.charCodeAt(0) - 0xac00;
    if (syllable.length !== 1 || code < 0 || code > 11171)
        return syllable;
    const lead = Math.floor(code / 588), vowel = Math.floor((code % 588) / 28), tail = code % 28;
    const iotated = [2, 3, 6, 7, 12, 17, 20].includes(vowel);
    const to = lead === 5 ? (iotated ? 11 : 2) : lead === 2 && iotated ? 11 : lead;
    return to === lead ? syllable : String.fromCharCode(0xac00 + (to * 21 + vowel) * 28 + tail);
}
const startsAWord = (name: string, at: number) => at === 0 || /[\s·,;()\[\]/]/.test(name[at - 1])
    || /(?:國立|公立|私立|道立|市立|府立|국립|공립|사립|도립|시립)$/.test(name.slice(0, at));
export function schoolInHangul(name: string): string {
    const hanja = name.match(/[㐀-鿿]/g);
    if (!hanja)
        return name;
    if (hanja.some(character => !HANJA_IN_SCHOOL_NAMES[character]))
        return name;
    return name.replace(/[㐀-鿿]/g, (character: string, at: number) => {
        const reading = HANJA_IN_SCHOOL_NAMES[character];
        return startsAWord(name, at) ? atTheStartOfAWord(reading) : reading;
    });
}
export function universityName(line: unknown): string | null {
    return schoolIn(line)?.name ?? null;
}
function schoolIn(line: unknown): {
    name: string;
    printed: string;
} | null {
    const value = withoutTrailingBracketGroup(tidy(line));
    if (!value)
        return null;
    const korean = value.match(/([가-힣A-Za-z·㐀-鿿]{2,20}?(?:대학교|大學校|大学校|과학기술원|科學技術院))(?:\s*([가-힣]{0,8}대학원|[㐀-鿿]{0,8}大學院|[㐀-鿿]{0,8}大学院))?/u);
    if (korean)
        return { name: schoolInHangul(korean[2] ? `${korean[1]} ${korean[2]}` : korean[1]), printed: korean[0].trim() };
    if (KOREAN.test(value))
        return null;
    if (/\p{Lu}/u.test(value) && !/\p{Ll}/u.test(value)) {
        const cased = casedAsPrinted(value);
        const found = cased.length === value.length ? schoolIn(cased) : null;
        const at = found ? cased.indexOf(found.name) : -1;
        if (!found || at < 0)
            return null;
        const printed = value.slice(at, at + found.name.length);
        return { name: printed, printed };
    }
    if (isPublishingHouse(value))
        return null;
    const latin = value.match(SCHOOL_LINE);
    if (!latin)
        return null;
    const named = withApposedName(latin[1], value.slice((latin.index || 0) + latin[1].length));
    const name = named.replace(/^(?:The|Graduate\s+School\s+of|School\s+of)\s+/i, '').replace(/[,;.]+$/, '').trim();
    if (SCHOOL_WORD_ONLY.test(name))
        return null;
    return name ? { name, printed: name } : null;
}
export function publisherName(value: unknown): string {
    return tidy(value).replace(/^(?:the\s+)?(?:registered\s+company|company|publisher|publishing\s+house|imprint)\s+(?=\p{Lu})/iu, '').trim();
}
export const FIELD_FOR_ROLE: Partial<Record<AgentRole, 'publisher' | 'institution' | 'university'>> = {
    publisher: 'publisher',
    issuingBody: 'institution',
    commissioningBody: 'institution',
    leadBody: 'institution',
    degreeGranting: 'university'
};
const METHOD_ORDER: Record<string, string[]> = {
    publisher: ['titlePageImprint', 'imprintStatement', 'publishedBy', 'roleLabel'],
    institution: ['statedIssuer', 'leadBodyLabel', 'commissioningBody', 'roleLabel', 'coverFooter', 'addressBlock', 'coverLayout'],
    university: ['roleLabel', 'coverLayout']
};
export function placeAgents(mentions: AgentMention[]): Placement {
    const placement: Placement = { fields: {}, sources: {}, aside: {}, refused: [] };
    const RIGHTS = (mention: AgentMention) => mention.role === 'copyrightHolder' || mention.method === 'copyrightLine';
    const statementsOf = new Map<string, AgentMention[]>();
    for (const mention of mentions) {
        const id = key(mention.name);
        if (!id)
            continue;
        if (!statementsOf.has(id))
            statementsOf.set(id, []);
        statementsOf.get(id)!.push(mention);
    }
    const onlyRights = (name: string) => {
        const statements = statementsOf.get(key(name)) || [];
        return statements.length > 0 && statements.every(RIGHTS);
    };
    const ranked = (field: 'publisher' | 'institution' | 'university') => {
        const order = METHOD_ORDER[field];
        return mentions
            .filter(mention => FIELD_FOR_ROLE[mention.role] === field)
            .map((mention, index) => ({ mention, index, rank: order.indexOf(mention.method) < 0 ? order.length : order.indexOf(mention.method) }))
            .sort((a, b) => a.rank - b.rank || a.index - b.index)
            .map(entry => entry.mention);
    };
    for (const mention of ranked('publisher')) {
        const name = publisherName(mention.name);
        if (!name)
            continue;
        if (RIGHTS(mention)) {
            placement.refused.push({ field: 'publisher', name, role: mention.role, reason: 'a rights notice, not a publishing statement' });
            continue;
        }
        if (onlyRights(name)) {
            placement.refused.push({ field: 'publisher', name, role: mention.role, reason: 'known only from a rights notice' });
            continue;
        }
        placement.fields.publisher = name;
        placement.sources.publisher = { from: mention.method, ...(mention.page ? { page: mention.page } : {}) };
        break;
    }
    const parent = mentions.find(mention => mention.role === 'imprintParent');
    if (parent && placement.fields.publisher)
        placement.sources.publisher.parent = parent.name;
    const otherPublishers = mentions.filter(mention => mention.role === 'publisher' || mention.role === 'imprintParent')
        .map(mention => publisherName(mention.name)).filter(name => name && name !== placement.fields.publisher);
    if (otherPublishers.length)
        placement.aside.publisher = [...new Set(otherPublishers)].slice(0, 3);
    for (const mention of ranked('institution')) {
        const name = tidy(mention.name);
        if (!name)
            continue;
        if (RIGHTS(mention)) {
            placement.refused.push({ field: 'institution', name, role: mention.role, reason: 'a rights notice, not a statement of who issued it' });
            continue;
        }
        if (onlyRights(name)) {
            placement.refused.push({ field: 'institution', name, role: mention.role, reason: 'known only from a rights notice' });
            continue;
        }
        placement.fields.institution = name;
        placement.sources.institution = { from: mention.method === 'roleLabel' ? 'roleLabel' : mention.method,
            ...(mention.method === 'roleLabel' ? { label: mention.role } : {}) };
        break;
    }
    const otherInstitutions = ranked('institution').map(mention => tidy(mention.name))
        .filter(name => name && name !== placement.fields.institution && !onlyRights(name));
    if (otherInstitutions.length)
        placement.aside.institution = [...new Set(otherInstitutions)].slice(0, 3);
    const contractors = mentions.filter(mention => mention.role === 'contractor').map(mention => tidy(mention.name)).filter(Boolean);
    if (contractors.length)
        placement.aside.contractor = [...new Set(contractors)].slice(0, 2);
    for (const mention of ranked('university')) {
        const name = universityName(mention.name);
        if (!name) {
            placement.refused.push({ field: 'university', name: tidy(mention.name), role: mention.role, reason: 'names a unit, not a school' });
            continue;
        }
        placement.fields.university = name;
        placement.sources.university = { from: mention.method, ...(mention.method === 'roleLabel' ? { label: 'degreeGranting' } : {}), line: tidy(mention.name).slice(0, 60) };
        break;
    }
    const named = (role: AgentRole) => [...new Set(mentions.filter(mention => mention.role === role).map(mention => tidy(mention.name)).filter(Boolean))];
    const authors = named('author');
    if (authors.length) {
        const creators = authors.map(name => personCreator(name)).filter(Boolean) as Array<Record<string, any>>;
        if (creators.length) {
            placement.fields.creators = creators;
            const first = mentions.find(mention => mention.role === 'author');
            placement.sources.creators = { from: first?.method || 'byline' };
        }
    }
    const editors = named('editor');
    if (editors.length)
        placement.aside.editors = editors.slice(0, 8);
    const translators = named('translator');
    if (translators.length)
        placement.aside.translators = translators.slice(0, 4);
    const contributors = named('contributor');
    if (contributors.length)
        placement.aside.contributors = contributors.slice(0, 4);
    const advisors = named('advisor');
    if (advisors.length)
        placement.aside.advisors = advisors.slice(0, 4);
    const holders = named('copyrightHolder');
    if (holders.length)
        placement.aside.copyrightHolder = holders.slice(0, 3);
    const affiliations = named('affiliation');
    if (affiliations.length)
        placement.aside.affiliations = affiliations.slice(0, 4);
    return placement;
}
const ACADEMIC_UNIT = /^(?:[가-힣]{0,8}(?:대학원|대학|학부|학과|전공|연구실|캠퍼스)|[㐀-鿿]{0,8}(?:大學院|大学院|大學|大学|學部|学部|學科|学科|專攻|専攻|硏究室|研究室|系)|Graduate|School|College|Department|Faculty|Division|Campus|of|the)$/iu;
export function losesOnlyAUnit(stored: string, school: string): boolean {
    const at = stored.indexOf(school);
    if (at < 0)
        return false;
    const rest = `${stored.slice(0, at)} ${stored.slice(at + school.length)}`.trim();
    return !rest || rest.split(/[\s,;()（）\[\]/·]+/).filter(Boolean).every(word => ACADEMIC_UNIT.test(word));
}
export function thesisDegree(value: unknown): string {
    const text = tidy(value);
    if (!text || /석\s*[·ㆍ,/]\s*박사|碩\s*[·ㆍ,/]\s*博士/.test(text))
        return '';
    const doctor = /박사|博士|doctor|doctoral|ph\.?\s*d\b|d\.?\s*phil\b/i.test(text);
    const master = /석사|碩士|硕士|master|magister|\bm\.?\s?(?:sc|s|a|eng|phil)\b\.?/i.test(text);
    if (doctor === master)
        return '';
    return doctor ? '박사학위논문' : '석사학위논문';
}
export function normaliseAgents<T extends {
    fields: Record<string, any>;
    creators?: any[];
}>(recognized: T): T {
    let out: T = recognized;
    const university = recognized.fields?.university;
    if (typeof university === 'string' && university) {
        const school = schoolIn(university);
        if (school && school.name !== university && losesOnlyAUnit(tidy(university), school.printed)) {
            out = { ...out, fields: { ...out.fields, university: school.name } };
        }
    }
    const thesisType = recognized.fields?.thesisType;
    if (typeof thesisType === 'string' && thesisType) {
        const degree = thesisDegree(thesisType);
        if (degree && degree !== thesisType)
            out = { ...out, fields: { ...out.fields, thesisType: degree } };
    }
    const creators = Array.isArray(recognized.creators) ? recognized.creators : [];
    let changed = false;
    const split = creators.map(creator => {
        const last = tidy(creator?.lastName || creator?.name);
        const first = tidy(creator?.firstName);
        const bare = last.replace(/\s+/g, '');
        const hangul = /^[가-힣]{2,4}$/.test(bare);
        const hanjaSurname = /^[㐀-鿿]{1,2}[가-힣]{1,3}$/u.test(bare);
        const spacedHan = /^[㐀-鿿々]{1,3}\s[㐀-鿿々]{1,4}$/u.test(last);
        if (first && /^[가-힣]{1,3}$/.test(first.replace(/\s+/g, ''))) {
            const surname = koreanSurnameOfHanja(last);
            if (!surname)
                return creator;
            changed = true;
            const { fieldMode, name, ...rest } = creator;
            void fieldMode;
            void name;
            return { ...rest, lastName: surname, firstName: first.replace(/\s+/g, ''), fieldMode: 0 };
        }
        if (first || !(hangul || hanjaSurname || spacedHan))
            return creator;
        const person = personCreator(last, creator?.creatorType || 'author');
        if (!person || !person.firstName)
            return creator;
        changed = true;
        const { fieldMode, name, ...rest } = creator;
        void fieldMode;
        void name;
        const readSurname = /^[가-힣]+$/.test(person.firstName) ? koreanSurnameOfHanja(person.lastName) : null;
        return { ...rest, lastName: readSurname || person.lastName, firstName: person.firstName, fieldMode: 0 };
    });
    if (changed)
        out = { ...out, creators: split };
    return out;
}
export function agentRoleOf(role: SemanticRole | null): AgentRole | null {
    switch (role) {
        case 'author': return 'author';
        case 'editor': return 'editor';
        case 'translator': return 'translator';
        case 'advisor': return 'advisor';
        case 'committee': return 'committee';
        case 'publisher': return 'publisher';
        case 'issuingBody': return 'issuingBody';
        case 'fundingBody': return 'commissioningBody';
        case 'degreeGranting': return 'degreeGranting';
        case 'affiliation': return 'affiliation';
        case 'copyrightHolder': return 'copyrightHolder';
        default: return null;
    }
}

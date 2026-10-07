export const KOREAN_COMMON_SURNAMES = '김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허남심노하곽성차주우구원탁국어은편표명기반라왕금옥육인맹제모길연위선설마도소석함변염추공방천지엄채여진유';
export const KOREAN_SURNAMES_ALL = KOREAN_COMMON_SURNAMES
    + '가간갈감견경계곡교군궁궉근나낭내뇌누단담당대돈동두등랑려로뢰리림만망매목묘무묵미민번범보복봉부비빈빙사삼상섭소수순승시아애야엽영예온옹완요용운음자점종좌준즙증창초탄태판팽평포풍피필학해현형호화환후흥';
export const KOREAN_COMPOUND_SURNAMES: readonly string[] = ['남궁', '선우', '제갈', '독고', '황보', '사공', '서문', '동방', '어금', '망절', '소봉', '등정'];
export const HANJA_SURNAMES: Readonly<Record<string, string>> = {
    金: '김', 李: '이', 朴: '박', 崔: '최', 鄭: '정', 姜: '강', 趙: '조', 尹: '윤', 張: '장', 林: '임', 韓: '한', 吳: '오', 徐: '서',
    申: '신', 權: '권', 黃: '황', 安: '안', 宋: '송', 柳: '유', 全: '전', 洪: '홍', 高: '고', 文: '문', 梁: '양', 孫: '손', 裵: '배',
    裴: '배', 白: '백', 許: '허', 劉: '유', 南: '남', 沈: '심', 盧: '노', 丁: '정', 河: '하', 郭: '곽', 成: '성', 車: '차', 朱: '주',
    禹: '우', 具: '구', 辛: '신', 任: '임', 田: '전', 閔: '민', 兪: '유', 俞: '유', 羅: '나', 陳: '진', 池: '지', 嚴: '엄', 蔡: '채',
    元: '원', 千: '천', 方: '방', 孔: '공', 康: '강', 玄: '현', 咸: '함', 卞: '변', 邊: '변', 廉: '염', 楊: '양', 呂: '여', 秋: '추',
    魯: '노', 都: '도', 蘇: '소', 愼: '신', 慎: '신', 石: '석', 宣: '선', 薛: '설', 馬: '마', 吉: '길', 周: '주', 延: '연', 房: '방',
    魏: '위', 表: '표', 明: '명', 奇: '기', 潘: '반', 王: '왕', 琴: '금', 玉: '옥', 陸: '육', 印: '인', 孟: '맹', 諸: '제', 卓: '탁',
    秦: '진', 慶: '경', 曺: '조', 曹: '조', 殷: '은', 片: '편', 龍: '용', 余: '여', 睦: '목', 桂: '계', 杜: '두', 皮: '피', 智: '지',
    甘: '감', 董: '동', 太: '태', 景: '경', 夫: '부', 奉: '봉', 丘: '구', 邢: '형', 章: '장', 鞠: '국', 國: '국', 牟: '모', 程: '정',
    葉: '엽', 賓: '빈', 陰: '음', 晉: '진', 晋: '진', 韋: '위', 昔: '석', 芮: '예', 庾: '유', 鍾: '종', 鐘: '종', 夏: '하', 天: '천',
    馮: '풍', 弓: '궁', 彭: '팽', 承: '승', 胡: '호', 扈: '호', 萬: '만', 班: '반', 賈: '가', 蔣: '장', 魚: '어', 陶: '도', 尙: '상',
    尚: '상', 史: '사', 錢: '전', 溫: '온', 邵: '소', 桓: '환', 于: '우', 公: '공',
    南宮: '남궁', 皇甫: '황보', 諸葛: '제갈', 鮮于: '선우', 司空: '사공', 獨孤: '독고', 西門: '서문', 東方: '동방'
};
export const INITIAL_SOUND_PAIRS: Readonly<Record<string, string>> = { 이: '리', 유: '류', 임: '림', 나: '라', 노: '로', 양: '량', 여: '려', 염: '렴', 육: '륙', 용: '룡', 연: '련' };
export const CHINESE_COMPOUND_SURNAMES: readonly string[] = ['欧阳', '歐陽', '司马', '司馬', '诸葛', '諸葛', '上官', '司徒', '东方', '東方', '夏侯', '皇甫', '尉迟', '尉遲', '公孙', '公孫',
    '慕容', '长孙', '長孫', '宇文', '令狐', '南宮', '鮮于', '独孤', '獨孤'];
export const NAME_PARTICLES: readonly string[] = ['van', 'von', 'der', 'den', 'de', 'del', 'della', 'delle', 'degli', 'dei', 'di', 'da', 'das', 'do', 'dos',
    'du', 'des', 'la', 'le', 'las', 'los', 'bin', 'ibn', 'al', 'el', 'ter', 'ten', 'zu', 'st.'];
export const NAME_CONNECTIVES: readonly string[] = ['of', 'for', 'on', 'in', 'and', 'the', '&', 'und', 'für', 'fur', 'et', 'y', 'e'];
const particleSource = NAME_PARTICLES.map(word => word.replace(/\./g, '\\.')).join('|');
export const NAME_JOINERS: {
    particle: RegExp;
    connective: RegExp;
} = {
    particle: new RegExp(`^(?:${particleSource})$`, 'i'),
    connective: new RegExp(`^(?:${NAME_CONNECTIVES.join('|')})$`, 'i')
};
const LOWER_PARTICLE = new RegExp(`^(?:${particleSource})$`);
export const NAME_SUFFIX = /^(?:[Jj][Rr]|[Ss][Rr])\.?$|^(?:II|III|IV)$/;
const ENGLISH_ENDINGS = {
    derived: ['ing', 'tion', 'sion', 'ment', 'ness', 'ity', 'ties', 'ance', 'ence', 'ology', 'ics', 'ical', 'ous', 'ive', 'able', 'ible', 'ward', 'down', 'ship', 'ure'],
    adjective: ['ed', 'ic', 'al', 'less', 'ful'],
    inflection: ['ies', 'es', 's', 'ed', 'ing', 'ly', 'er']
} as const;
const endingOf = (words: readonly string[], flags: string) => new RegExp(`(?:${words.join('|')})$`, flags);
export const DERIVED_ENDING = endingOf(ENGLISH_ENDINGS.derived, 'i');
export const INFLECTIONAL_ENDING = endingOf(ENGLISH_ENDINGS.inflection, '');
const ORCID_MARK = /^(?:iD|ID)$/;
export function withoutOrcidMark(value: string): string {
    const text = String(value ?? '');
    if (text.length > 400)
        return text;
    const words = [...text.matchAll(/\S+/g)];
    if (words.length < 3 || !ORCID_MARK.test(words[words.length - 1][0]))
        return text;
    let end = words.length - 1;
    while (end > 0 && !/\p{L}/u.test(words[end - 1][0]))
        end--;
    if (end < 2)
        return text;
    if (words[words.length - 1][0] === 'ID' && !words.slice(0, end).some(word => /\p{Ll}/u.test(word[0])))
        return text;
    const last = words[end - 1];
    return text.slice(0, (last.index ?? 0) + last[0].length);
}
export const ROMANISED_SYLLABLES = /^(?:(?:ch|sh|ts|zh|ng|kk|tt|pp|ss|jj|[bcdfghjklmnpqrstvwxz])?[yw]?[aeiouy]+(?:ng|rk|[nmlrkptbgdh])?)+$/;
const ROMANISED_SYLLABLE = /^(?:ch|sh|ts|zh|ng|kk|tt|pp|ss|jj|[bcdfghjklmnpqrstvwxz])?[yw]?[aeiouy]+(?:ng|rk|[nmlrkptbgdh])?$/;
const PINYIN_FINALS: Readonly<Record<string, string>> = {
    '': 'a o e ai ei ao ou an en ang eng er',
    b: 'a o ai ei ao an en ang eng i ie iao ian in ing u',
    p: 'a o ai ei ao ou an en ang eng i ie iao ian in ing u',
    m: 'a o e ai ei ao ou an en ang eng i ie iao iu ian in ing u',
    f: 'a o ei ou an en ang eng u',
    d: 'a e ai ei ao ou an en ang eng ong i ia ie iao iu ian ing u uo ui uan un',
    t: 'a e ai ao ou an ang eng ong i ie iao ian ing u uo ui uan un',
    n: 'a e ai ei ao ou an en ang eng ong i ie iao iu ian in iang ing u uo uan v ve',
    l: 'a o e ai ei ao ou an ang eng ong i ia ie iao iu ian in iang ing u uo uan un v ve',
    g: 'a e ai ei ao ou an en ang eng ong u ua uo uai ui uan un uang',
    k: 'a e ai ei ao ou an en ang eng ong u ua uo uai ui uan un uang',
    h: 'a e ai ei ao ou an en ang eng ong u ua uo uai ui uan un uang',
    zh: 'a e ai ei ao ou an en ang eng ong i u ua uo uai ui uan un uang',
    ch: 'a e ai ao ou an en ang eng ong i u ua uo uai ui uan un uang',
    sh: 'a e ai ei ao ou an en ang eng i u ua uo uai ui uan un uang',
    r: 'e ao ou an en ang eng ong i u uo ui uan un',
    z: 'a e ai ei ao ou an en ang eng ong i u uo ui uan un',
    c: 'a e ai ao ou an en ang eng ong i u uo ui uan un',
    s: 'a e ai ao ou an en ang eng ong i u uo ui uan un',
    j: 'i ia ie iao iu ian in iang ing iong u ue uan un',
    q: 'i ia ie iao iu ian in iang ing iong u ue uan un',
    x: 'i ia ie iao iu ian in iang ing iong u ue uan un',
    y: 'a e ao ou an ang i in ing ong u ue uan un',
    w: 'a o ai ei an en ang eng u'
};
export const PINYIN_SYLLABLE = new RegExp(`^(?:${Object.entries(PINYIN_FINALS)
    .map(([initial, finals]) => `${initial}(?:${finals.split(' ').sort((a, b) => b.length - a.length).join('|')})`).join('|')})$`);
export function isPinyinSyllable(word: unknown): boolean {
    const text = String(word ?? '').trim();
    return /^[A-Za-zÜü]{1,6}$/.test(text) && PINYIN_SYLLABLE.test(text.toLowerCase().replace(/ü/g, 'v'));
}
export const ROMANISED_COMPOUND_SURNAMES: ReadonlySet<string> = new Set(['ouyang', 'sima', 'zhuge', 'shangguan', 'situ', 'dongfang', 'xiahou', 'huangfu', 'yuchi',
    'gongsun', 'murong', 'zhangsun', 'yuwen', 'linghu', 'nangong', 'xianyu', 'dugu',
    'namgung', 'namkoong', 'seonu', 'sunwoo', 'jegal', 'dokgo', 'hwangbo', 'sagong', 'seomun', 'dongbang']);
const ADJECTIVE_ENDING = endingOf(ENGLISH_ENDINGS.adjective, 'i');
const SCRIPT_GROUPS: Array<[
    string,
    RegExp
]> = [
    ['latin', /\p{Script=Latin}/u], ['greek', /\p{Script=Greek}/u], ['cyrillic', /\p{Script=Cyrillic}/u], ['armenian', /\p{Script=Armenian}/u],
    ['georgian', /\p{Script=Georgian}/u], ['hebrew', /\p{Script=Hebrew}/u], ['arabic', /\p{Script=Arabic}/u], ['devanagari', /\p{Script=Devanagari}/u],
    ['thai', /\p{Script=Thai}/u], ['hangul', /\p{Script=Hangul}/u], ['cjk', /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u]
];
export const letterScript = (char: string): string => /\p{N}/u.test(char) ? '' : SCRIPT_GROUPS.find(([, pattern]) => pattern.test(char))?.[0] ?? '';
export const crossesScripts = (a: string, b: string) => { const x = letterScript(a), y = letterScript(b); return !!x && !!y && x !== y; };
export type NameScript = 'hangul' | 'hanjaKorean' | 'han' | 'kana' | 'latin' | 'mixed' | 'none';
const HANGUL = /[가-힣]/;
const HAN = /\p{Script=Han}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}ー]/u;
const LATIN = /\p{Script=Latin}/u;
export function scriptOfName(value: unknown): NameScript {
    const text = personText(value);
    const hangul = HANGUL.test(text), han = HAN.test(text), kana = KANA.test(text), latin = LATIN.test(text);
    if (!hangul && !han && !kana && !latin)
        return 'none';
    if (kana && !latin && !hangul)
        return 'kana';
    if (hangul && han && !latin && !kana && /^\p{Script=Han}{1,2}[가-힣]/u.test(text.replace(/\s+/g, '')))
        return 'hanjaKorean';
    const count = [hangul, han || kana, latin].filter(Boolean).length;
    if (count > 1)
        return 'mixed';
    return hangul ? 'hangul' : han ? 'han' : 'latin';
}
function personText(value: unknown): string {
    if (value && typeof value === 'object') {
        const person = value as {
            lastName?: unknown;
            firstName?: unknown;
            name?: unknown;
        };
        return `${String(person.lastName ?? person.name ?? '')} ${String(person.firstName ?? '')}`.normalize('NFKC').replace(/\s+/g, ' ').trim();
    }
    return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}
export function isKoreanSurname(value: unknown): boolean {
    const name = String(value ?? '').normalize('NFKC').replace(/\s+/g, '').trim();
    if (/^[가-힣]$/.test(name))
        return KOREAN_SURNAMES_ALL.includes(name);
    return KOREAN_COMPOUND_SURNAMES.includes(name);
}
export function hangulSurnameLength(name: unknown): 1 | 2 {
    const bare = String(name ?? '').normalize('NFKC').replace(/\s+/g, '');
    return [...bare].length >= 3 && KOREAN_COMPOUND_SURNAMES.includes(bare.slice(0, 2)) ? 2 : 1;
}
export interface KoreanName {
    surname: string;
    given: string;
}
export function splitHangulName(value: unknown): KoreanName | null {
    const name = String(value || '').normalize('NFKC').replace(/\s+/g, '');
    if (!/^[가-힣]+$/.test(name) || name.length < 2 || name.length > 6)
        return null;
    const surname = name.slice(0, hangulSurnameLength(name));
    return { surname, given: name.slice(surname.length) };
}
export function koreanSurnameOfHanja(surname: unknown): string | null {
    const value = String(surname ?? '').normalize('NFKC').replace(/\s+/g, '').trim();
    return /^[㐀-鿿]{1,2}$/u.test(value) ? HANJA_SURNAMES[value] ?? null : null;
}
export interface NameShape {
    text: string;
    script: NameScript;
    person: 'sure' | 'shape' | 'no';
    kind?: 'korean' | 'transliterated' | 'chinese' | 'japanese' | 'western';
    family?: string;
    given?: string;
    why: string[];
}
const FUNCTION_WORD = /^(?:their|his|its|our|your|this|that|these|those)$/i;
const PAGE_WORD = /^(?:Online|Recommendations?|Articles?|Metrics|Supporting|Supplementary|Information|Abstract|Keywords?|Contents|Downloads?|Downloaded|Citations?|Figures?|References|Access)$/;
export function nameShape(item: string, context: {
    marked?: boolean;
    roleStated?: boolean;
    listed?: boolean;
    bodyScript?: 'hangul' | 'latin' | 'cjk' | null;
} = {}): NameShape {
    const text = String(item ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const script = scriptOfName(text);
    const no = (why: string): NameShape => ({ text, script, person: 'no', why: [why] });
    if (!text || text.length > 40 || /[@\d]/.test(text))
        return no('empty, long, or holds digits');
    const sure = (base: Omit<NameShape, 'person' | 'why'>, why: string[], strong: boolean): NameShape => ({ ...base, person: strong || context.marked ? 'sure' : 'shape', why });
    if (script === 'hangul') {
        if (!/^[가-힣\s]+$/.test(text))
            return no('punctuation inside a Hangul name');
        const joined = text.replace(/\s+/g, '');
        const tokens = text.split(' ');
        const supported = !!(context.listed || context.marked || context.roleStated);
        if ((tokens.length === 1 || (supported && tokens.every(token => token.length === 1))) && /^[가-힣]{2,4}$/.test(joined)) {
            if (/다$/.test(joined))
                return no('a verb ending in 다');
            const compound = KOREAN_COMPOUND_SURNAMES.includes(joined.slice(0, 2)) && joined.length >= 3;
            const surname = compound ? joined.slice(0, 2) : joined.slice(0, 1);
            const known = context.marked || context.roleStated || joined.length >= 3 ? isKoreanSurname(surname) : compound || KOREAN_COMMON_SURNAMES.includes(surname);
            if (!known)
                return no('does not open with a Korean surname');
            const given = joined.slice(surname.length);
            if (!given || given.length > 2)
                return no('given name of no syllable or more than two');
            return sure({ text: joined, script, kind: 'korean', family: surname, given }, ['Korean surname and given name'], joined.length === 3 || compound);
        }
        if ((context.listed || context.marked || context.roleStated) && tokens.length === 2 && isKoreanSurname(tokens[0]) && !/다$/.test(tokens[1]) && /^[가-힣]{1,2}$/.test(tokens[1]) && (tokens[0].length === 1 || KOREAN_COMPOUND_SURNAMES.includes(tokens[0]))) {
            if (/^[가-힣]다$/.test(joined))
                return no('a two-syllable verb ending');
            return sure({ text: joined, script, kind: 'korean', family: tokens[0], given: tokens[1] }, ['Korean surname and given name, spaced'], joined.length === 3 || tokens[0].length === 2);
        }
        if (tokens.length >= 2 && tokens.length <= 3 && tokens.every(token => /^[가-힣]{1,6}$/.test(token))) {
            const shape = { text, script, kind: 'transliterated' as const, family: tokens[tokens.length - 1], given: tokens.slice(0, -1).join(' ') };
            return context.roleStated ? { ...shape, person: 'sure', why: ['a transliterated name the page gives a role'] } : { ...shape, person: 'shape', why: ['transliterated chunks'] };
        }
        return no('not a Hangul name shape');
    }
    if (script === 'hanjaKorean') {
        if (/\s/.test(text) && !(context.listed || context.marked || context.roleStated))
            return no('spaced characters outside a list');
        const joined = text.replace(/\s+/g, '');
        const han = /^\p{Script=Han}{1,2}/u.exec(joined)?.[0] ?? '';
        const surname = koreanSurnameOfHanja(han) ? han : koreanSurnameOfHanja(han.slice(0, 1)) ? han.slice(0, 1) : '';
        if (!surname)
            return no('the Han surname is not a Korean surname');
        const given = joined.slice(surname.length);
        return /^[가-힣]{1,3}$/.test(given) ? sure({ text: joined, script, kind: 'korean', family: surname, given }, ['Hanja surname and Hangul given name'], true) : no('given name is not Hangul');
    }
    if (script === 'han' || script === 'kana') {
        const tokens = text.split(' ');
        const perCharacter = tokens.length >= 2 && tokens.length <= 4 && tokens.every(token => [...token].length === 1);
        if (tokens.length >= 2 && !(context.listed || context.marked || context.roleStated))
            return no('spaced characters outside a list');
        if (!perCharacter && tokens.length === 2 && tokens.every(token => /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]+$/u.test(token))
            && [...tokens[0]].length <= 2 && [...tokens[1]].length <= 3 && [...tokens.join('')].length <= 5) {
            return sure({ text, script, kind: script === 'kana' || context.bodyScript === 'cjk' ? 'japanese' : 'chinese', family: tokens[0], given: tokens[1] }, ['two spaced chunks: surname and given name'], false);
        }
        if (tokens.length >= 2 && !perCharacter)
            return no('not a Han or kana name shape');
        const joined = text.replace(/\s+/g, '');
        if (script === 'han' && /^\p{Script=Han}{2,3}$/u.test(joined)) {
            const compound = CHINESE_COMPOUND_SURNAMES.includes(joined.slice(0, 2)) && joined.length >= 3;
            const surname = koreanSurnameOfHanja(joined.slice(0, 2)) && joined.length >= 3 ? joined.slice(0, 2) : compound ? joined.slice(0, 2) : joined.slice(0, 1);
            return sure({ text: joined, script, kind: koreanSurnameOfHanja(surname) ? 'korean' : 'chinese', family: surname, given: joined.slice(surname.length) }, ['two or three Han characters'], false);
        }
        if (/^[\p{Script=Han}々]{2,4}$/u.test(joined) || /^[\p{Script=Katakana}ー]{2,8}$/u.test(joined)) {
            return { text: joined, script, person: 'shape', kind: 'japanese', why: ['run-together name, boundary unknown'] };
        }
        return no('not a Han or kana name shape');
    }
    if (script === 'latin') {
        const comma = /^([\p{Lu}][\p{L}'’-]+),\s*([\p{Lu}][\p{L}.'’-]*(?:[\s-][\p{Lu}][\p{L}.'’-]*){0,2})(,\s*(?:(?:[Jj][Rr]|[Ss][Rr])\.?|II|III|IV))?$/u.exec(text);
        if (comma)
            return { text, script, person: 'sure', kind: 'western', family: comma[1], given: `${comma[2]}${comma[3] ? `, ${comma[3].replace(/^,\s*/, '')}` : ''}`, why: ['surname, given name'] };
        const words = text.replace(/(?<=\p{Lu}\.)(?=\p{Lu}\p{Ll})/gu, ' ').split(' ').filter(word => !NAME_SUFFIX.test(word.replace(/,$/, '')));
        if (words.length === 1 && (context.listed || context.marked) && /^\p{Lu}[\p{L}'’-]*\p{Ll}\p{Lu}[\p{L}'’-]*\p{Ll}$/u.test(words[0])) {
            return { text: text.replace(/(?<=\p{Ll})(?=\p{Lu})/gu, ' '), script, person: 'shape', kind: 'western', why: ['a name whose space was lost'] };
        }
        if (words.length < 2 || words.length > 5)
            return no('not two to five words');
        const article = /^the$/i.test(words[0]) || (/^(?:a|an)$/i.test(words[0]) && !(context.listed || context.marked));
        if (article || words.some(word => FUNCTION_WORD.test(word) || PAGE_WORD.test(word)))
            return no('a function word or a page word');
        const capital = (word: string) => /^\p{Lu}\.?$/u.test(word) || /^(?:\p{Lu}\.){2,3}$/u.test(word) || /^\p{Lu}\.-\p{Lu}\.?$/u.test(word)
            || /^\p{Lu}[\p{L}'’.-]*$/u.test(word);
        if (!words.every(word => capital(word) || NAME_JOINERS.particle.test(word)))
            return no('a word that is neither capitalised, an initial, nor a particle');
        if (/^\p{Lu}\.?$/u.test(words[words.length - 1]))
            return no('ends on an initial');
        const abbreviated = words.filter(word => /^\p{Lu}\p{Ll}+\.$/u.test(word));
        if (/\p{L}{2,}\.$/u.test(words[words.length - 1]) || abbreviated.length > 1)
            return no('abbreviated words, a journal name');
        const initialsThenCapitals = !!context.marked && words.slice(0, -1).every(word => /^(?:\p{Lu}\.)+(?:-\p{Lu}\.)?$/u.test(word)) && /^\p{Lu}{2,}(?:['’-]\p{Lu}{2,})*$/u.test(words[words.length - 1]);
        const markedCapitals = !!context.marked && words.length <= 4 && words.filter(word => /^\p{Lu}[\p{Lu}'’-]+$/u.test(word)).length >= 2
            && words.every(word => /^\p{Lu}[\p{Lu}'’-]+$/u.test(word) || /^(?:\p{Lu}\.)+(?:-\p{Lu}\.)?$/u.test(word));
        if (!/\p{Ll}/u.test(text) && !initialsThenCapitals && !markedCapitals)
            return no('set in capitals');
        const shouted = (word: string) => /^\p{Lu}{2,}(?:['’-]\p{Lu}{2,})*$/u.test(word) && (/[AEIOUYÀ-ÖØ-Ý]/u.test(word) || word === 'NG');
        const syllabic = (word: string) => ROMANISED_SYLLABLES.test(word.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/['’-]/g, ''));
        const shoutedSurname = (words.length === 2 && words.filter(word => shouted(word) && syllabic(word)).length === 1 && words.some(word => /\p{Ll}/u.test(word)))
            || (words.length === 3 && /^\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?$/u.test(words[0]) && words.slice(1).every(shouted) && NAME_JOINERS.particle.test(words[1]));
        const articleBeforeCompound = words.length === 2 && words[0] === 'A'
            && (words[1].includes('-') || (words[1].length >= 6 && (DERIVED_ENDING.test(words[1]) || ADJECTIVE_ENDING.test(words[1]))));
        const initial = words.some(word => /^\p{Lu}\.(?:-?\p{Lu}\.)*$/u.test(word) || /^(?:\p{Lu}\.){2,3}$/u.test(word) || (/^\p{Lu}$/u.test(word) && !articleBeforeCompound));
        const compoundOfATitle = (word: string) => word.includes('-') && word.split('-').some(part => part.length >= 6 && DERIVED_ENDING.test(part));
        if (words.some(compoundOfATitle))
            return no('a hyphenated compound of a title');
        const oneSyllable = (part: string) => ROMANISED_SYLLABLE.test(part.toLowerCase());
        const hyphenated = words.some(word => {
            const parts = word.split('-');
            return /^\p{Lu}\p{Ll}+-\p{L}+$/u.test(word) && parts.length === 2 && !parts.some(part => part.length >= 6 && ADJECTIVE_ENDING.test(part))
                && ROMANISED_SYLLABLES.test(parts[0].toLowerCase()) && parts[0].length <= 6 && oneSyllable(parts[1]);
        });
        const particle = words.some(word => LOWER_PARTICLE.test(word));
        const why: string[] = [];
        if (initial)
            why.push('an initial');
        if (hyphenated)
            why.push('a hyphenated given name');
        if (shoutedSurname)
            why.push('a surname set in capitals');
        if (particle)
            why.push('a surname particle');
        return { text, script, person: why.length || context.marked ? 'sure' : 'shape', kind: 'western', why: why.length ? why : ['capitalised words'] };
    }
    return no('mixed scripts');
}
export interface PersonParts {
    lastName: string;
    firstName: string;
    fieldMode: 0 | 1;
}
export function personParts(name: string | NameShape, context: {
    familyEvidence?: ReadonlySet<string>;
    printed?: {
        lastName: string;
        firstName: string;
    };
    bodyLanguage?: string | null;
} = {}): PersonParts | null {
    const text = (typeof name === 'string' ? name : name.text).normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!text)
        return null;
    const one = (value: string): PersonParts => ({ lastName: value, firstName: '', fieldMode: 1 });
    const two = (family: string, given: string): PersonParts => family.trim() && given.trim() ? { lastName: family.trim(), firstName: given.trim(), fieldMode: 0 } : one(`${given} ${family}`.trim());
    if (context.printed?.lastName && context.printed?.firstName) {
        const letters = (value: string) => value.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
        const whole = letters(text), a = letters(`${context.printed.firstName}${context.printed.lastName}`), b = letters(`${context.printed.lastName}${context.printed.firstName}`);
        if (whole === a || whole === b)
            return suffixOnTheGivenSide(two(context.printed.lastName, context.printed.firstName));
    }
    const language = String(context.bodyLanguage ?? '').slice(0, 2);
    const script = scriptOfName(text);
    if (script === 'hangul' || script === 'hanjaKorean') {
        const comma = text.split(/\s*,\s*/);
        if (comma.length === 2 && comma.every(part => /^[가-힣]+$/.test(part)))
            return two(comma[0], comma[1]);
        const tokens = text.split(' ');
        const joined = tokens.join('');
        if (tokens.length === 1 || (tokens.length <= 5 && tokens.every(token => [...token].length === 1))) {
            if (script === 'hanjaKorean') {
                const han = /^\p{Script=Han}{1,2}/u.exec(joined)?.[0] ?? '';
                return han ? two(han, joined.slice(han.length)) : one(joined);
            }
            if (joined.length < 2)
                return null;
            const surname = hangulSurnameLength(joined) === 2 ? joined.slice(0, 2) : joined.slice(0, 1);
            return isKoreanSurname(surname) && joined.length <= 5 && !(joined.length === 5 && surname.length === 1) ? two(surname, joined.slice(surname.length)) : one(joined);
        }
        if (isKoreanSurname(tokens[0]) && /^[가-힣]{1,3}$/.test(tokens.slice(1).join('')))
            return two(tokens[0], tokens.slice(1).join(''));
        return two(tokens[tokens.length - 1], tokens.slice(0, -1).join(' '));
    }
    if (script === 'mixed' && /^[가-힣]+(?: (?:[가-힣]+|\p{Lu}\.))* [가-힣]+$/u.test(text)) {
        const tokens = text.split(' ');
        return two(tokens[tokens.length - 1], tokens.slice(0, -1).join(' '));
    }
    if (script === 'han' || script === 'kana') {
        const tokens = text.split(' ');
        if (tokens.length === 2 && !(tokens[0].length === 1 && tokens[1].length === 1))
            return two(tokens[0], tokens[1]);
        const joined = tokens.join('');
        if (script === 'kana' || language === 'ja')
            return one(joined);
        const compound = (koreanSurnameOfHanja(joined.slice(0, 2)) || CHINESE_COMPOUND_SURNAMES.includes(joined.slice(0, 2))) && joined.length >= 3;
        if (joined.length < 2 || joined.length > (compound ? 4 : 3))
            return one(joined);
        const surname = compound ? 2 : 1;
        return two(joined.slice(0, surname), joined.slice(surname));
    }
    if (script !== 'latin')
        return one(text);
    const unmarked = withoutOrcidMark(text);
    if (unmarked !== text)
        return personParts(unmarked, context);
    const comma = text.indexOf(',');
    if (comma > 0) {
        const family = text.slice(0, comma).trim(), given = text.slice(comma + 1).trim();
        if (!NAME_SUFFIX.test(given))
            return suffixOnTheGivenSide(two(family, given));
    }
    let words = text.replace(/,/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
    let suffix = '';
    if (words.length >= 2 && NAME_SUFFIX.test(words[words.length - 1])) {
        suffix = words[words.length - 1];
        words = words.slice(0, -1);
    }
    if (words.length < 2)
        return one(text);
    const attach = (family: string, given: string) => suffix ? two(family, `${given}, ${suffix}`) : two(family, given);
    if (context.familyEvidence?.size) {
        const key = (value: string) => value.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
        for (let at = 1; at < words.length; at++) {
            if (context.familyEvidence.has(key(words.slice(at).join(' '))))
                return attach(words.slice(at).join(' '), words.slice(0, at).join(' '));
        }
    }
    const at = surnameStartOf(words);
    if (at === 0)
        return attach(words[0], words.slice(1).join(' '));
    return attach(words.slice(at).join(' '), words.slice(0, at).join(' '));
}
function surnameStartOf(words: string[]): number {
    const shouted = (word: string) => /^\p{Lu}{2,}(?:['’-]\p{Lu}{2,})*$/u.test(word);
    const cased = words.some(word => /\p{Ll}/u.test(word));
    if (shouted(words[0]) && words.slice(1).some(word => /\p{Ll}/u.test(word)))
        return 0;
    let at = words.length - 1;
    if (cased && shouted(words[at])) {
        while (at > 1 && shouted(words[at - 1]))
            at--;
        return at;
    }
    const lower = words.findIndex((word, index) => index >= 1 && index < at && LOWER_PARTICLE.test(word));
    if (lower >= 1) {
        let next = lower;
        while (next < words.length - 1 && NAME_JOINERS.particle.test(words[next]))
            next++;
        return next;
    }
    return at;
}
const TRAILING_SUFFIX = /^(\S(?:.*[^\s,])?)(\s*,\s*|\s+)((?:[Jj][Rr]|[Ss][Rr])\.?|II|III|IV)$/;
export function givenAndSuffix(firstName: unknown): {
    given: string;
    suffix: string;
} {
    const first = String(firstName ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const found = first.length <= 200 ? TRAILING_SUFFIX.exec(first) : null;
    return found ? { given: found[1], suffix: found[3] } : { given: first, suffix: '' };
}
export function registryPerson(given: unknown, family: unknown, suffix?: unknown): {
    lastName: string;
    firstName: string;
} | null {
    const clean = (value: unknown) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const last = clean(family);
    if (!last)
        return null;
    return suffixOnTheGivenSide({ lastName: last, firstName: [clean(given), clean(suffix)].filter(Boolean).join(', ') });
}
export function printedName(person: {
    lastName?: unknown;
    firstName?: unknown;
    name?: unknown;
} | null | undefined): string {
    const last = String(person?.lastName ?? person?.name ?? '').trim();
    const { given, suffix } = givenAndSuffix(person?.firstName);
    return `${given} ${last}${suffix ? ` ${suffix}` : ''}`.replace(/\s+/g, ' ').trim();
}
export function suffixOnTheGivenSide<T>(person: T): T {
    const entry = person as unknown as {
        lastName?: unknown;
        firstName?: unknown;
        fieldMode?: unknown;
    };
    if (!entry || typeof entry !== 'object' || entry.fieldMode === 1)
        return person;
    const last = String(entry.lastName ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const first = String(entry.firstName ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!last || !first || last.length > 200 || first.length > 200 || scriptOfName(`${first} ${last}`) !== 'latin')
        return person;
    if (NAME_SUFFIX.test(last)) {
        const parts = personParts(`${first} ${last}`);
        return parts && parts.fieldMode === 0 ? { ...(person as any), lastName: parts.lastName, firstName: parts.firstName } as T : person;
    }
    if (NAME_SUFFIX.test(first))
        return person;
    const family = TRAILING_SUFFIX.exec(last);
    const given = TRAILING_SUFFIX.exec(first);
    if (family)
        return { ...(person as any), lastName: family[1], firstName: `${given ? given[1] : first}, ${family[3]}` } as T;
    if (given && !given[2].includes(','))
        return { ...(person as any), firstName: `${given[1]}, ${given[3]}` } as T;
    return person;
}

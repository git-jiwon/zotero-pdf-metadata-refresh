export type Meaning = 'author' | 'editor' | 'translator' | 'translatorEditor' | 'reviewer' | 'illustrator' | 'responsible' | 'formPerson' | 'inventor' | 'advisor' | 'committee' | 'issueEditor' | 'contact' | 'publisherHouse' | 'publisherPerson' | 'printer' | 'issuer' | 'funder' | 'sponsor' | 'leadBody' | 'degreeGranting' | 'affiliation' | 'title' | 'number' | 'identifier' | 'date' | 'section' | 'position' | 'others';
export type WordSeat = 'label' | 'lead' | 'tail' | 'alone';
export interface LabelWord {
    form: string;
    meaning: Meaning;
    seats: readonly WordSeat[];
    colon?: 'required' | 'optional';
    spaced?: boolean;
    needsName?: boolean;
    script: 'ko' | 'ja' | 'zh' | 'latin';
    dateRole?: string;
    common?: boolean;
    list?: boolean;
    spacedTail?: boolean;
}
const ko = (form: string, meaning: Meaning, seats: readonly WordSeat[], extra: Partial<LabelWord> = {}): LabelWord => ({ form, meaning, seats, colon: 'optional', spaced: seats.includes('label'), script: 'ko', ...extra });
const la = (form: string, meaning: Meaning, seats: readonly WordSeat[], extra: Partial<LabelWord> = {}): LabelWord => ({ form, meaning, seats, colon: 'required', script: 'latin', ...extra });
const cjk = (form: string, meaning: Meaning, seats: readonly WordSeat[], script: 'ja' | 'zh', extra: Partial<LabelWord> = {}): LabelWord => ({ form, meaning, seats, colon: 'optional', script, ...extra });
export const LABEL_WORDS: readonly LabelWord[] = [
    ko('지은이', 'author', ['label', 'alone'], { spaced: false }), ko('저자', 'author', ['label', 'alone']), ko('글쓴이', 'author', ['label'], { spaced: false }),
    ko('지음', 'author', ['tail', 'alone']), ko('공저', 'author', ['tail']), ko('저', 'author', ['tail', 'label'], { needsName: true, spaced: false }),
    ko('글', 'author', ['tail', 'label', 'lead'], { needsName: true, spaced: false }),
    cjk('著', 'author', ['tail'], 'zh', { needsName: true }), cjk('著者', 'author', ['label'], 'ja'),
    la('author', 'author', ['label', 'alone']), la('authors', 'author', ['label', 'alone']), la('author(s)', 'author', ['label', 'alone']),
    la('by', 'author', ['lead']), la('written by', 'author', ['lead']), la('revised by', 'author', ['lead']),
    ko('연구책임자', 'responsible', ['label']), ko('과제책임자', 'responsible', ['label']), ko('총괄책임자', 'responsible', ['label']),
    la('principal investigator', 'responsible', ['label'], { colon: 'optional' }),
    ko('성명', 'formPerson', ['label'], { common: true }), ko('작성자', 'formPerson', ['label']), ko('집필자', 'formPerson', ['label']), ko('담당자', 'formPerson', ['label'], { common: true }),
    ko('책임자', 'formPerson', ['label'], { common: true }), ko('대표자', 'formPerson', ['label'], { common: true }), ko('연구자', 'formPerson', ['label'], { common: true }),
    ko('제출자', 'formPerson', ['label'], { common: true }), ko('이름', 'formPerson', ['label'], { common: true }),
    ko('발명자', 'inventor', ['label']),
    ko('엮은이', 'editor', ['label', 'alone'], { spaced: false }), ko('편자', 'editor', ['label']), ko('편저자', 'editor', ['label', 'alone']),
    ko('편저', 'editor', ['label', 'tail', 'alone']), ko('편집', 'editor', ['label'], { common: true }), ko('엮음', 'editor', ['tail', 'alone']),
    ko('편', 'editor', ['tail'], { needsName: true, spaced: false }), cjk('編', 'editor', ['tail'], 'zh', { needsName: true }), cjk('編著', 'editor', ['tail'], 'zh'),
    la('editor', 'editor', ['label', 'tail', 'alone']), la('editors', 'editor', ['label', 'tail', 'alone']), la('eds.', 'editor', ['tail', 'alone']),
    la('ed.', 'editor', ['tail', 'alone']), la('edited by', 'editor', ['lead', 'alone']), la('compiled by', 'editor', ['lead']),
    ko('옮긴이', 'translator', ['label', 'alone'], { spaced: false }), ko('역자', 'translator', ['label', 'alone']), ko('번역', 'translator', ['label'], { common: true }),
    ko('옮김', 'translator', ['tail', 'alone']), ko('공역', 'translator', ['tail']), ko('역', 'translator', ['tail'], { needsName: true, spaced: false }),
    cjk('譯', 'translator', ['tail'], 'zh', { needsName: true }), cjk('訳', 'translator', ['tail'], 'ja', { needsName: true }),
    la('translator', 'translator', ['label', 'tail']), la('translators', 'translator', ['label', 'tail']), la('trans.', 'translator', ['tail'], { needsName: true }),
    la('translated by', 'translator', ['lead']),
    ko('편역', 'translatorEditor', ['tail']),
    ko('감수', 'reviewer', ['label', 'tail'], { common: true }), cjk('監修', 'reviewer', ['label', 'tail'], 'ja'),
    ko('그림', 'illustrator', ['label', 'tail'], { spaced: false, needsName: true }), ko('사진', 'illustrator', ['label', 'tail'], { spaced: false, needsName: true }),
    la('illustrated by', 'illustrator', ['lead']), la('illustrator', 'illustrator', ['label']), la('illustrators', 'illustrator', ['label']),
    ko('지도교수', 'advisor', ['label']), ko('지도위원', 'advisor', ['label']), cjk('指導敎授', 'advisor', ['label'], 'zh'), cjk('指導教授', 'advisor', ['label'], 'zh'),
    la('advisor', 'advisor', ['label']), la('advisors', 'advisor', ['label']), la('adviser', 'advisor', ['label']), la('advisers', 'advisor', ['label']),
    la('supervisor', 'advisor', ['label']), la('supervisors', 'advisor', ['label']), la('supervised by', 'advisor', ['lead', 'label'], { colon: 'optional' }),
    ko('심사위원', 'committee', ['label']), ko('심사위원장', 'committee', ['label']), ko('위원장', 'committee', ['label'], { common: true }),
    la('committee', 'committee', ['label']), la('committee member', 'committee', ['label']), la('committee members', 'committee', ['label']), la('committee chair', 'committee', ['label']),
    la('academic editor', 'issueEditor', ['label']), la('academic editors', 'issueEditor', ['label']), la('handling editor', 'issueEditor', ['label']), la('guest editor', 'issueEditor', ['label']),
    ko('교신저자', 'contact', ['label']), ko('교신', 'contact', ['label']), ko('책임저자', 'contact', ['label']), ko('공동저자', 'contact', ['label']), ko('주저자', 'contact', ['label']),
    ...['1', '2', '3'].map(order => ko(`제${order}저자`, 'contact', ['label'])), la('corresponding', 'contact', ['label']), la('corresponding author', 'contact', ['label']), la('e-mail', 'contact', ['label']), la('email', 'contact', ['label']), la('tel', 'contact', ['label']),
    ko('발행처', 'publisherHouse', ['label']), ko('펴낸곳', 'publisherHouse', ['label']), ko('발간처', 'publisherHouse', ['label']), ko('출판사', 'publisherHouse', ['label'], { colon: 'required' }),
    la('publisher', 'publisherHouse', ['label']), la('published by', 'publisherHouse', ['lead']), cjk('発行所', 'publisherHouse', ['label'], 'ja'),
    ...['펴냄', '펴낸'].map(form => ko(form, 'publisherHouse', ['tail'], { spacedTail: true })),
    ...['발행', '간행', '출판'].map(form => ko(form, 'publisherHouse', ['tail'], { spacedTail: true, common: true })),
    cjk('刊', 'publisherHouse', ['tail'], 'zh'), cjk('刊行', 'publisherHouse', ['tail'], 'ja', { common: true }), cjk('發行', 'publisherHouse', ['tail'], 'zh', { common: true }),
    cjk('発行', 'publisherHouse', ['tail'], 'ja', { common: true }), cjk('出版', 'publisherHouse', ['tail'], 'zh', { common: true }),
    ko('발행인', 'publisherPerson', ['label']), ko('펴낸이', 'publisherPerson', ['label'], { spaced: false }), ko('편집인', 'publisherPerson', ['label']), cjk('発行者', 'publisherPerson', ['label'], 'ja'),
    ko('인쇄인', 'printer', ['label']), ko('인쇄처', 'printer', ['label']), ko('인쇄소', 'printer', ['label']), la('printed by', 'printer', ['lead']),
    ko('발행기관', 'issuer', ['label']), ko('발간기관', 'issuer', ['label']), la('issued by', 'issuer', ['lead']),
    ko('발주기관', 'funder', ['label']), ko('발주처', 'funder', ['label']), ko('발주사', 'funder', ['label']), ko('의뢰기관', 'funder', ['label']),
    la('prepared for', 'funder', ['lead']),
    ko('주관기관', 'leadBody', ['label']), ko('주관연구기관', 'leadBody', ['label']),
    ko('전담기관', 'sponsor', ['label']), ko('지원기관', 'sponsor', ['label']),
    la('funded by', 'sponsor', ['lead']), la('supported by', 'sponsor', ['lead']), la('sponsored by', 'sponsor', ['lead']), la('financed by', 'sponsor', ['lead']),
    la('grant from', 'sponsor', ['lead']), la('grants from', 'sponsor', ['lead']), la('funding from', 'sponsor', ['lead']),
    ko('학위수여기관', 'degreeGranting', ['label']), ko('수여기관', 'degreeGranting', ['label']),
    la('degree-granting institution', 'degreeGranting', ['label'], { colon: 'optional' }), la('degree granting institution', 'degreeGranting', ['label'], { colon: 'optional' }),
    la('awarded by', 'degreeGranting', ['lead']),
    ko('소속', 'affiliation', ['label'], { common: true }), la('affiliation', 'affiliation', ['label']),
    ko('제목', 'title', ['label']), ko('과제명', 'title', ['label']), ko('연구과제명', 'title', ['label']), ko('보고서명', 'title', ['label']), ko('기술명', 'title', ['label']),
    ko('특허기술명', 'title', ['label']), ko('논문명', 'title', ['label']), ko('논문제목', 'title', ['label']), ko('발명의명칭', 'title', ['label']), ko('고안의명칭', 'title', ['label']),
    la('title', 'title', ['label']), la('article title', 'title', ['label']),
    ...['', '행정', '정부'].flatMap(head => ['', '간행물'].flatMap(kind => ['', '발간'].map(issue => ko(`${head}${kind}${issue}등록번호`, 'number', ['label'])))),
    ko('과제번호', 'number', ['label']), ko('보고서번호', 'number', ['label']), ko('문서번호', 'number', ['label']), ko('관리번호', 'number', ['label']),
    ko('계약번호', 'number', ['label']),
    la('report no.', 'number', ['label'], { colon: 'optional' }), la('report number', 'number', ['label'], { colon: 'optional' }), la('document no.', 'number', ['label'], { colon: 'optional' }),
    la('document number', 'number', ['label'], { colon: 'optional' }), la('contract no.', 'number', ['label'], { colon: 'optional' }), la('contract number', 'number', ['label'], { colon: 'optional' }),
    la('part no.', 'number', ['label'], { colon: 'optional' }), la('part number', 'number', ['label'], { colon: 'optional' }), la('publication order number', 'number', ['label'], { colon: 'optional' }),
    la('ISBN', 'identifier', ['label'], { colon: 'optional' }), la('ISSN', 'identifier', ['label'], { colon: 'optional' }), la('DOI', 'identifier', ['label'], { colon: 'optional' }),
    ko('발행일', 'date', ['label'], { dateRole: 'publicationDate' }), ko('펴낸날', 'date', ['label'], { dateRole: 'publicationDate' }), ko('발간일', 'date', ['label'], { dateRole: 'publicationDate' }),
    ko('접수', 'date', ['label'], { dateRole: 'receivedDate' }), ko('게재확정', 'date', ['label'], { dateRole: 'acceptedDate' }),
    la('received', 'date', ['label'], { dateRole: 'receivedDate' }), la('accepted', 'date', ['label'], { dateRole: 'acceptedDate' }), la('published', 'date', ['label'], { dateRole: 'publicationDate' }),
    la('published online', 'date', ['label'], { dateRole: 'onlineDate' }),
    ko('초록', 'section', ['label', 'alone']), ko('요약', 'section', ['label', 'alone']), ko('요약문', 'section', ['label', 'alone']), ko('주제어', 'section', ['label'], { list: true }),
    ko('핵심어', 'section', ['label'], { list: true }), ko('검색어', 'section', ['label'], { list: true }), ko('키워드', 'section', ['label'], { list: true }),
    la('abstract', 'section', ['label', 'alone']), ...['keywords', 'keyword', 'key words', 'key word', 'key-words', 'key-word', 'index terms', 'subject terms'].map(form => la(form, 'section', ['label'], { list: true })), la('highlights', 'section', ['label', 'alone']), la('article info', 'section', ['label', 'alone']),
    la('summary', 'section', ['label', 'alone']), la('pacs', 'section', ['label']), la('pacs number', 'section', ['label']), la('pacs numbers', 'section', ['label']),
    la('citation', 'section', ['label']), la('cite this', 'section', ['label']),
    ...['교수', '부교수', '조교수', '명예교수', '연구교수', '초빙교수', '강사', '조교', '박사', '박사과정', '석사과정', '박사후연구원', '연구원', '선임연구원', '책임연구원',
        '수석연구원', '연구위원', '전문연구위원', '선임연구위원', '연구관', '연구사', '이사', '대표', '대표이사', '회장', '원장', '소장', '센터장', '부장', '차장', '과장', '팀장',
        '실장', '위원', '학생', '님', '관리자', '운영자', '최고관리자', '사이트관리자'].map(form => ko(form, 'position', /연구(?:위)?원$/.test(form) ? ['tail', 'label'] : ['tail'], { spaced: false })),
    ...['敎授', '教授', '博士', '碩士'].map(form => cjk(form, 'position', ['tail'], 'zh')),
    ...['professor', 'lecturer', 'student', 'candidate', 'engineer', 'manager', 'director', 'scientist', 'researcher', 'architect', 'specialist', 'analyst',
        'consultant', 'officer', 'president', 'technologist', 'designer', 'developer', 'evangelist', 'strategist', 'administrator', 'coordinator', 'executive',
        'chairman', 'chairwoman', 'chairperson', 'ceo', 'cto', 'cfo', 'coo', 'cio', 'vp', 'admin', 'webmaster'].map(form => la(form, 'position', ['tail'])),
    ...['dr', 'prof'].map(form => la(form, 'position', ['tail'])),
    ko('외', 'others', ['tail'], { spaced: false }), ko('등', 'others', ['tail'], { spaced: false, needsName: true }), la('et al.', 'others', ['tail']), la('et al', 'others', ['tail']), cjk('外', 'others', ['tail'], 'zh'),
    cjk('他', 'others', ['tail'], 'ja'), cjk('ほか', 'others', ['tail'], 'ja')
];
export const PERSON_MEANINGS: ReadonlySet<Meaning> = new Set<Meaning>(['author', 'editor', 'translator', 'translatorEditor', 'reviewer', 'illustrator', 'responsible', 'formPerson', 'inventor']);
export const BYLINE_MEANINGS: readonly Meaning[] = ['author', 'editor', 'translator', 'translatorEditor', 'reviewer', 'illustrator'];
export function bylineRoleOf(word: unknown): 'author' | 'editor' | 'translator' | 'contributor' {
    const found = labelWordOf(word);
    const type = found ? creatorTypeOf(found.meaning) : null;
    return type === 'editor' || type === 'translator' || type === 'contributor' ? type : 'author';
}
export function roleOfBylineWord(word: unknown): 'author' | 'editor' | 'translator' | 'contributor' | null {
    const found = labelWordOf(word);
    return found && BYLINE_MEANINGS.includes(found.meaning) ? bylineRoleOf(found.form) : null;
}
export function creatorTypeOf(meaning: Meaning): 'author' | 'editor' | 'translator' | 'contributor' | 'inventor' | null {
    switch (meaning) {
        case 'author':
        case 'responsible':
        case 'formPerson': return 'author';
        case 'editor': return 'editor';
        case 'translator':
        case 'translatorEditor': return 'translator';
        case 'reviewer':
        case 'illustrator': return 'contributor';
        case 'inventor': return 'inventor';
        default: return null;
    }
}
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HANGUL_SYLLABLE = /[가-힣]/;
export function wordSource(word: LabelWord, seat: WordSeat): string {
    if (word.script === 'latin')
        return word.form.split(' ').map(escape).join('\\s+');
    if (seat === 'label' && word.spaced && [...word.form].length >= 2 && [...word.form].every(char => HANGUL_SYLLABLE.test(char))) {
        const longer = LONGER_FORMS.get(word.form) || [];
        const guard = longer.length ? `(?![^\\S\\n]*(?:${longer.map(rest => [...rest].map(escape).join('[^\\S\\n]*')).join('|')}))` : '';
        return [...word.form].map(escape).join('[^\\S\\n]*') + guard;
    }
    if (seat === 'tail' && word.spacedTail && [...word.form].length >= 2)
        return [...word.form].map(escape).join('[^\\S\\n]*');
    return escape(word.form);
}
const LONGER_FORMS = new Map<string, string[]>();
for (const word of LABEL_WORDS) {
    if (word.script !== 'ko')
        continue;
    const rests = LABEL_WORDS.filter(other => other.script === 'ko' && other.form !== word.form && other.form.startsWith(word.form)).map(other => other.form.slice(word.form.length));
    if (rests.length)
        LONGER_FORMS.set(word.form, [...new Set(rests)].sort((a, b) => b.length - a.length));
}
export function wordsOf(meanings: readonly Meaning[] | ReadonlySet<Meaning> | null, seat: WordSeat, options: {
    script?: ReadonlyArray<LabelWord['script']>;
    needsName?: boolean;
} = {}): LabelWord[] {
    const wanted = meanings ? new Set(meanings) : null;
    return LABEL_WORDS.filter(word => word.seats.includes(seat) && (!wanted || wanted.has(word.meaning))
        && (!options.script || options.script.includes(word.script))
        && (options.needsName === undefined || !!word.needsName === options.needsName))
        .sort((a, b) => b.form.length - a.form.length);
}
export function wordAlternation(meanings: readonly Meaning[] | ReadonlySet<Meaning> | null, seat: WordSeat, options: {
    script?: ReadonlyArray<LabelWord['script']>;
    needsName?: boolean;
} = {}): string {
    return alternationOf(wordsOf(meanings, seat, options), seat);
}
export function alternationOf(words: readonly LabelWord[], seat: WordSeat): string {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const word of [...words].sort((a, b) => b.form.length - a.form.length)) {
        const source = wordSource(word, seat);
        if (seen.has(source))
            continue;
        seen.add(source);
        out.push(source);
    }
    return out.join('|');
}
export const TAIL_ROLE_SOURCE = alternationOf(wordsOf(BYLINE_MEANINGS.filter(meaning => meaning !== 'illustrator'), 'tail', { script: ['ko', 'latin'] })
    .filter(word => word.script === 'ko' || !word.needsName), 'tail');
export const MARKED_ROLE_FORMS: readonly string[] = wordsOf(BYLINE_MEANINGS, 'tail', { script: ['ko'], needsName: false }).filter(word => [...word.form].length === 2).map(word => word.form);
export const KOREAN_ROLE_FORMS: ReadonlySet<string> = new Set(LABEL_WORDS.filter(word => word.script === 'ko' && BYLINE_MEANINGS.includes(word.meaning)).map(word => word.form));
export const STATEMENT_MEANINGS: readonly Meaning[] = ['author', 'editor', 'translator', 'responsible', 'formPerson', 'advisor', 'committee'];
export const STATEMENT_LABEL_KO = alternationOf(wordsOf(STATEMENT_MEANINGS, 'label', { script: ['ko'] }).filter(word => !word.common && !word.needsName), 'label');
export const STATEMENT_LABEL_LATIN = alternationOf([...wordsOf(STATEMENT_MEANINGS, 'label', { script: ['latin'] }),
    ...wordsOf(STATEMENT_MEANINGS, 'lead', { script: ['latin'] }).filter(word => word.form.includes(' '))], 'label');
export const LEADING_ROLE_SOURCE = alternationOf([...wordsOf(['author', 'editor', 'translator', 'reviewer'], 'label', { script: ['ko', 'latin'] }).filter(word => !word.needsName),
    ...wordsOf(['author', 'editor', 'translator', 'reviewer'], 'lead', { script: ['latin'] }).filter(word => word.form.includes(' '))], 'label');
export const NUMBER_LABEL_SOURCE = wordAlternation(['number', 'identifier'], 'label', { script: ['ko', 'latin'] });
export const FUNDER_LABEL_SOURCE = alternationOf([...wordsOf(['funder'], 'label'), ...wordsOf(['funder'], 'lead')], 'label');
export const FUNDER_LABEL_KO_SOURCE = wordAlternation(['funder'], 'label', { script: ['ko'] });
export const SPONSOR_LABEL_SOURCE = wordAlternation(['sponsor'], 'label', { script: ['ko'] });
export const SPONSOR_LEAD_SOURCE = wordAlternation(['sponsor'], 'lead', { script: ['latin'] });
export const PUBLISHER_TAIL_SOURCE = wordAlternation(['publisherHouse'], 'tail');
const FREQUENCY_WORDS = ['격주간', '격월간', '반월간', '반년간', '격일간', '부정기', '일간', '주간', '순간', '월간', '계간', '연간', '년간',
    '매분기', '분기별', '반기별', '매일', '매주', '격주', '매월', '매달', '격월', '매년', '매해', '격년', '날마다', '주마다', '달마다', '해마다', '월별', '연별',
    '隔月刊', '隔週刊', '半年刊', '日刊', '週刊', '旬刊', '月刊', '季刊', '年刊', '毎日', '毎週', '毎月', '毎年', '每日', '每週', '每周', '每月', '每年', '每季', '隔月', '隔週', '不定期'];
const FREQUENCY_COUNT = '(?:매월|매년|매주|매달|매해|일년|1년|한[^\\S\\n]?해|분기|반기|학기|毎月|每月|毎年|每年|주|월|연|년|해|年|月|週)[^\\S\\n]{0,2}'
    + '(?:\\d{1,2}|한|두|세|네|다섯|여섯|열두|[一二三四六十]{1,2})[^\\S\\n]{0,2}(?:회|번|차례|권|호|回|次|期|号|號)';
const FREQUENCY_AFTER = '\\d{1,2}[^\\S\\n]{0,2}(?:회|번|차례|권|호|일|월|回|次|期|号|號|日|月)';
const FREQUENCY_SEPARATOR = '[^\\S\\n]{0,3}(?:[·,，、/~～(（)）–-][^\\S\\n]{0,3})?';
const FREQUENCY_WORD_SOURCE = FREQUENCY_WORDS.map(escape).join('|');
const FREQUENCY_PHRASE = new RegExp(`^[(（]?(?:${FREQUENCY_WORD_SOURCE}|${FREQUENCY_COUNT})(?:${FREQUENCY_SEPARATOR}(?:${FREQUENCY_WORD_SOURCE}|${FREQUENCY_COUNT}|${FREQUENCY_AFTER})){0,4}[^\\S\\n]{0,3}[)）]?$`, 'u');
const LATIN_FREQUENCY = new RegExp('^(?:published|issued|appears|appearing|printed|released)[^\\S\\n]+(?:daily|weekly|bi-?weekly|fortnightly|semi-?monthly|monthly|bi-?monthly'
    + '|quarterly|semi-?annually|bi-?annually|tri-?annually|annually|yearly|irregularly'
    + '|(?:once|twice|thrice|(?:two|three|four|five|six|ten|twelve|\\d{1,2})[^\\S\\n]+times)[^\\S\\n]+(?:a|per|each|every)[^\\S\\n]+(?:year|month|week)'
    + '|every[^\\S\\n]+(?:other[^\\S\\n]+)?(?:day|week|month|year)|every[^\\S\\n]+(?:two|three|four|six|\\d{1,2})[^\\S\\n]+(?:weeks|months|years))\\.?$', 'iu');
export function frequencyStatementOf(text: unknown): string | null {
    const value = String(text ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!value || value.length > 60)
        return null;
    if (LATIN_FREQUENCY.test(value.replace(/^[(（]\s*|\s*[)）]$/gu, '')))
        return value;
    const tail = roleWordAt(value, 'tail', ['publisherHouse']);
    const phrase = (tail ? tail.rest : value).replace(/[\s,;:·/]+$/u, '').trim();
    return phrase && phrase.length <= 40 && FREQUENCY_PHRASE.test(phrase) ? phrase : null;
}
export const COLOPHON_LABEL_SOURCE = alternationOf([...wordsOf(['publisherHouse', 'publisherPerson', 'printer'], 'label'), ...wordsOf(['publisherHouse', 'publisherPerson', 'printer'], 'lead')], 'label');
export const LEAD_BODY_LABEL_SOURCE = wordAlternation(['leadBody'], 'label', { script: ['ko'] });
export function wordAlternationOf(meanings: readonly Meaning[]): string {
    return alternationOf(wordsOf(meanings, 'label').filter(word => !word.common && !word.needsName), 'label');
}
export const KEYWORD_LABEL_SOURCE = alternationOf(LABEL_WORDS.filter(word => word.list), 'label');
export const LABELLED_READING_SOURCE = alternationOf([...wordsOf(['section', 'issueEditor'], 'label'), ...wordsOf(['editor'], 'label', { script: ['latin'] }),
    ...wordsOf(['date'], 'label', { script: ['latin'] })], 'label');
export const AUTHOR_LABEL_SOURCE = wordAlternationOf(['author']);
const ROLE_LABELS_KO = wordsOf(['author', 'editor', 'translator'], 'label', { script: ['ko'] }).filter(word => !word.common && !word.needsName);
export const ROLE_ONLY_SOURCE = alternationOf([...wordsOf(BYLINE_MEANINGS, 'alone'), ...wordsOf(BYLINE_MEANINGS, 'lead', { script: ['latin'] }),
    ...wordsOf(BYLINE_MEANINGS, 'tail', { script: ['ko'], needsName: false }), ...ROLE_LABELS_KO], 'label');
export const LABELLED_BYLINE_SOURCE = alternationOf([...wordsOf(BYLINE_MEANINGS, 'lead', { script: ['latin'] }), ...ROLE_LABELS_KO,
    ...wordsOf(['author', 'editor', 'translator'], 'label', { script: ['latin'] })], 'label');
export const BYLINE_MARKER_SOURCE = alternationOf([...wordsOf(BYLINE_MEANINGS, 'lead').filter(word => word.script !== 'latin' || word.form.includes(' ')),
    ...wordsOf(BYLINE_MEANINGS, 'tail', { script: ['ko'], needsName: false })], 'lead');
export const KOREAN_TAIL_SOURCE = wordAlternation(BYLINE_MEANINGS, 'tail', { script: ['ko'] });
export const NOT_A_PERSON_SOURCE = alternationOf([...wordsOf(['others'], 'tail'), ...wordsOf(BYLINE_MEANINGS, 'tail', { script: ['ko'] }).filter(word => word.meaning !== 'illustrator'),
    ...wordsOf(['publisherHouse'], 'tail'),
    ...wordsOf(['author', 'editor', 'translator'], 'label', { script: ['latin'] }).filter(word => !word.form.includes(' ') && !word.form.includes('(')),
    ...wordsOf(['contact'], 'label').filter(word => !/e-?mail|tel/.test(word.form))], 'label');
export function labelPattern(meanings: readonly Meaning[] | ReadonlySet<Meaning> | null, seat: WordSeat, options: {
    anchor?: 'whole' | 'start' | 'end' | 'none';
    flags?: string;
    capture?: boolean;
} = {}): RegExp {
    const words = wordAlternation(meanings, seat);
    const group = options.capture ? `(${words})` : `(?:${words})`;
    const flags = options.flags ?? 'iu';
    switch (options.anchor ?? 'none') {
        case 'whole': return new RegExp(`^\\s*[(（]?\\s*${group}\\s*[)）]?\\s*$`, flags);
        case 'start': return new RegExp(`^\\s*${group}(?![\\p{L}\\p{N}])`, flags);
        case 'end': return new RegExp(`(?<![\\p{L}\\p{N}])${group}\\s*$`, flags);
        default: return new RegExp(group, flags);
    }
}
const WORD_INDEX = new Map<string, LabelWord>();
for (const word of LABEL_WORDS) {
    const key = word.form.toLowerCase().replace(/[\s.:：()（）]+/g, '');
    if (!WORD_INDEX.has(key))
        WORD_INDEX.set(key, word);
}
export function labelWordOf(token: unknown): LabelWord | null {
    const key = String(token ?? '').normalize('NFKC').toLowerCase().replace(/[\s.:：()（）]+/g, '');
    return key ? WORD_INDEX.get(key) ?? null : null;
}
export function roleWordAt(row: unknown, seat: WordSeat, meanings: readonly Meaning[] | ReadonlySet<Meaning> | null = null): {
    word: LabelWord;
    text: string;
    rest: string;
} | null {
    const value = String(row ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!value || value.length > 400)
        return null;
    const pattern = SEAT_PATTERNS.get(`${seat}|${meanings ? [...meanings].sort().join(',') : '*'}`) ?? seatPattern(seat, meanings);
    const found = pattern.exec(value);
    if (!found)
        return null;
    if (seat === 'alone')
        return { word: labelWordOf(found[1]) as LabelWord, text: found[1], rest: '' };
    if (seat === 'tail') {
        const text = found[2] || found[3] || found[4];
        const rest = found[1].replace(/[,，]\s*$/, '').trim();
        const word = matchWord(text, seat);
        if (!word)
            return null;
        if (word.needsName && /(?:^|\s)[가-힣]$/.test(rest))
            return null;
        return rest ? { word, text, rest } : null;
    }
    const text = found[1];
    const word = matchWord(text, seat);
    return word ? { word, text, rest: found[2].trim() } : null;
}
function matchWord(text: string, seat: WordSeat): LabelWord | null {
    const key = text.normalize('NFKC').toLowerCase().replace(/[\s.:：()（）]+/g, '');
    return LABEL_WORDS.find(word => word.seats.includes(seat) && word.form.toLowerCase().replace(/[\s.:：()（）]+/g, '') === key) ?? null;
}
const SEAT_PATTERNS = new Map<string, RegExp>();
function seatPattern(seat: WordSeat, meanings: readonly Meaning[] | ReadonlySet<Meaning> | null): RegExp {
    const words = wordAlternation(meanings, seat);
    let pattern: RegExp;
    if (seat === 'alone')
        pattern = new RegExp(`^[(（]?\\s*(${words})\\s*[)）]?$`, 'iu');
    else if (seat === 'tail')
        pattern = new RegExp(`^(.*?\\S)(?:\\s*[(（]\\s*(${words})\\s*[)）]|\\s+(${words})|\\s*,\\s*(${wordAlternation(meanings, 'tail', { script: ['latin'] }) || '(?!)'}))\\s*$`, 'iu');
    else
        pattern = new RegExp(`^(${words})(?:\\s*[:：•·]\\s*|\\s+)(\\S.*)$`, 'iu');
    SEAT_PATTERNS.set(`${seat}|${meanings ? [...meanings].sort().join(',') : '*'}`, pattern);
    return pattern;
}
export interface LabelCell {
    word: LabelWord;
    label: string;
    variant?: string;
    value: string;
    row: number;
    valueRow: number;
    column?: number;
    form: 'inline' | 'nextRow' | 'grid';
}
const VARIANT = /^\s*[(（]\s*(국\s*문|한\s*글|영\s*문|English|Korean)\s*[)）]/iu;
const CELL_PATTERNS = new Map<string, RegExp>();
interface CellOptions {
    meanings?: ReadonlySet<Meaning>;
    strict?: boolean;
    scripts?: ReadonlyArray<LabelWord['script']>;
    leads?: boolean;
}
function cellPattern(options: CellOptions): RegExp {
    const { meanings, scripts, leads: withLeads = true } = options;
    const key = `${meanings ? [...meanings].sort().join(',') : '*'}|${scripts ? scripts.join(',') : '*'}|${withLeads}`;
    const held = CELL_PATTERNS.get(key);
    if (held)
        return held;
    const leads = withLeads ? wordsOf(meanings ?? null, 'lead', { script: scripts }).filter(word => word.form.includes(' ')).map(word => wordSource(word, 'lead')) : [];
    const words = [wordAlternation(meanings ?? null, 'label', { script: scripts }), ...leads].filter(Boolean).join('|');
    const pattern = new RegExp(`^(${words})(?![\\p{L}\\p{N}])`, 'iu');
    CELL_PATTERNS.set(key, pattern);
    return pattern;
}
function labelAtHead(text: string, options: CellOptions): {
    word: LabelWord;
    label: string;
    variant?: string;
    rest: string;
    colon: boolean;
} | null {
    const { meanings, strict = false } = options;
    const value = text.trim();
    const head = cellPattern(options).exec(value);
    if (!head)
        return null;
    const word = matchWord(head[1], 'label') ?? matchWord(head[1], 'lead');
    if (!word || (meanings && !meanings.has(word.meaning)))
        return null;
    const lead = !word.seats.includes('label');
    let rest = value.slice(head[0].length);
    const variant = VARIANT.exec(rest);
    if (variant)
        rest = rest.slice(variant[0].length);
    const colon = /^\s*[:：]/.test(rest);
    if (word.colon === 'required' && !lead && !colon && rest.trim())
        return null;
    if (!colon && (word.needsName || (strict && word.common)))
        return null;
    if (!colon && rest && !/^\s/.test(rest))
        return null;
    return { word, label: head[1], ...(variant ? { variant: variant[1].replace(/\s+/g, '') } : {}), rest: rest.replace(/^\s*[:：]?\s*/, ''), colon };
}
const columnsOf = (row: string) => { const body = row.trim(); if (!body)
    return []; const parts = body.split(/ {3,}|\t+/).map(part => part.trim()).filter(Boolean); return parts; };
export function readLabelCells(rows: readonly string[], options: CellOptions & {
    columns?: boolean;
} = {}): LabelCell[] {
    const cells: LabelCell[] = [];
    const lines = rows.map(row => String(row ?? '').normalize('NFKC'));
    for (let at = 0; at < lines.length; at++) {
        const raw = lines[at];
        if (!raw.trim() || raw.length > 400)
            continue;
        const columns = options.columns ? columnsOf(raw) : [];
        if (columns.length >= 2) {
            let read = 0;
            for (let column = 0; column < columns.length; column++) {
                const head = labelAtHead(columns[column], options);
                if (!head)
                    continue;
                if (head.rest) {
                    cells.push({ word: head.word, label: head.label, ...(head.variant ? { variant: head.variant } : {}), value: head.rest, row: at, valueRow: at, column, form: 'grid' });
                    read++;
                    continue;
                }
                const next = columns[column + 1];
                if (next && !labelAtHead(next, options)) {
                    cells.push({ word: head.word, label: head.label, ...(head.variant ? { variant: head.variant } : {}), value: next, row: at, valueRow: at, column, form: 'grid' });
                    column++;
                    read++;
                }
            }
            if (read)
                continue;
        }
        const head = labelAtHead(raw.replace(/\s+/g, ' '), options);
        if (!head)
            continue;
        if (head.rest) {
            cells.push({ word: head.word, label: head.label, ...(head.variant ? { variant: head.variant } : {}), value: head.rest, row: at, valueRow: at, form: 'inline' });
            continue;
        }
        let next = at + 1;
        while (next < lines.length && !lines[next].trim())
            next++;
        if (next >= lines.length || next > at + 2)
            continue;
        const following = lines[next].replace(/\s+/g, ' ').trim();
        if (!following || following.length > 200 || labelAtHead(following, options) || labelAtHead(following, {}))
            continue;
        cells.push({ word: head.word, label: head.label, ...(head.variant ? { variant: head.variant } : {}), value: following, row: at, valueRow: next, form: 'nextRow' });
    }
    return cells;
}
export function formGrid(rows: readonly string[]): boolean {
    const lines = rows.map(row => String(row ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim()).filter(Boolean);
    const spaced = lines.filter(line => /^[가-힣](?: [가-힣]){1,5}(?= |$)/.test(line)).length;
    if (spaced >= 3)
        return true;
    const heads = new Map<string, number>();
    for (const line of lines) {
        const head = /^([가-힣]{2,8}) \S/.exec(line)?.[1];
        if (head)
            heads.set(head, (heads.get(head) || 0) + 1);
    }
    if ([...heads.values()].filter(count => count >= 3).length >= 2)
        return true;
    return readLabelCells(lines, { meanings: FORM_CELL_MEANINGS, strict: true }).length >= 3;
}
const FORM_CELL_MEANINGS: ReadonlySet<Meaning> = new Set<Meaning>(['title', 'number', 'responsible', 'formPerson', 'inventor', 'leadBody', 'funder', 'sponsor', 'issuer',
    'affiliation', 'degreeGranting', 'advisor', 'committee']);
export const MEMBERSHIP_GRADE = /^(?:life\s*)?(?:honorary\s*|graduate\s*|student\s*|senior\s*|associate\s*|distinguished\s*)*(?:member|fellow)$/i;
export const SOCIETY_ACRONYM = /^\p{Lu}[\p{Lu}\d&]{1,5}$/u;

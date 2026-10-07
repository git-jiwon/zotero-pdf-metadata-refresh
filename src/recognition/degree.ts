const MASTER_WORD = /석사|碩士|硕士|修士|m[aá]ster|maestr[ií]a|mestrado|magist(?:er|ra|rale)|ma[iî]trise/i;
const DOCTOR_WORD = /박사|博士|doctor|doktor|doutor|dottor|ph\.?\s*d/i;
export const DEGREE_STATEMENT = new RegExp([
    String.raw `(석사|박사|碩士|博士|硕士|修士)\s*(?:學位|学位|학위)?\s*(?:청구\s*|請求\s*|请求\s*)?(?:논문|論文|论文)`,
    String.raw `\b(master)(?:'s|’s|s)?\s+(?:of\s+[a-z]+\s+)?(?:thesis|dissertation)\b`,
    String.raw `\b(doctor)(?:al|ate)\s+(?:thesis|dissertation)\b`,
    String.raw `\bdegree\s+of\s+(master|doctor)\b`,
    String.raw `\b(ph\.?\s*d)\.?\s+(?:thesis|dissertation)\b`,
    String.raw `\b(master|doctor)\s+of\s+(?:science|arts|engineering|philosophy|education|business|laws?|fine\s+arts|public|medicine|pharmacy)\b`,
    String.raw `\btrabajo\s+(?:de\s+)?fin\s+de\s+m[aá]ster\b`,
    String.raw `\btesis\s+(?:doctoral|de\s+doctorado|de\s+maestr[ií]a|de\s+m[aá]ster)\b`,
    String.raw `\bdisserta[çc][aã]o\s+de\s+(?:mestrado|doutorado)\b|\btese\s+de\s+(?:doutorado|doutoramento|mestrado)\b`,
    String.raw `\bm[ée]moire\s+de\s+(?:master|ma[iî]trise)\b|\bth[èe]se\s+de\s+doctorat\b`,
    String.raw `\b(?:master|magister|doktor)-?arbeit\b|\bdoktorgrad(?:es)?\b`,
    String.raw `\btesi\s+di\s+(?:laurea\s+magistrale|dottorato)\b`
].join('|'), 'i');
const DEGREE_WORD = /석사|박사|碩士|博士|硕士|修士|m[aá]ster|maestr[ií]a|mestrado|doctor|doktor|doutor|dottor|ph\.?\s*d/i;
const DEGREE_TOKEN = /^(?:석사|박사|학사|碩士|博士|學士|硕士|修士|학위|學位|学位|논문|論文|论文|청구논문|請求論文|thesis|dissertation)$/i;
export function isDegreeToken(token: unknown): boolean {
    const value = String(token ?? '').normalize('NFKC').trim();
    return DEGREE_TOKEN.test(value) || (!/\s/.test(value) && isDegreeStatement(value));
}
const PERSON_DEGREE_LINE = /위\s*원|심\s*사|지\s*도|교\s*수|과\s*정|수\s*료|委\s*員|審\s*[査查]|指\s*[導导]|[敎教]\s*授|課\s*程|修\s*了|advis|supervis|committee|chair|examin|candidate|student|director|directeur|tutor|promot|betreuer|gutacht|orientador|relator|[(（]\s*(?:인|印)\s*[)）]/i;
function degreeKindOf(statement: string): string {
    if (MASTER_WORD.test(statement))
        return '석사학위논문';
    if (DOCTOR_WORD.test(statement))
        return '박사학위논문';
    return '';
}
export function degreeStatedIn(text: unknown, bareWord: boolean): string {
    const lines = String(text ?? '').normalize('NFKC').split(/\r?\n/);
    for (const pattern of bareWord ? [DEGREE_STATEMENT, DEGREE_WORD] : [DEGREE_STATEMENT]) {
        for (const line of lines) {
            if (PERSON_DEGREE_LINE.test(line))
                continue;
            const match = pattern.exec(line);
            const kind = match ? degreeKindOf(match[0]) : '';
            if (kind)
                return kind;
        }
    }
    return '';
}
const FIELD_PREFIX = String.raw `(?:[가-힣]{1,4}학|[\p{Script=Han}]{1,4}[學学])`;
const CJK_DEGREE_LINE = new RegExp(String.raw `^${FIELD_PREFIX}?\s*(?:(?:석사|박사|학사|碩士|博士|學士|硕士|学士|修士)\s*(?:학위|學位|学位)?|학위|學位|学位)\s*(?:(?:청구|請求|请求)\s*)?(?:논문|論文|论文)$|^(?:卒業|卒业)\s*(?:論文|论文)$`, 'u');
const LATIN_DEGREE_LINE = new RegExp('^(?:an?\\s+)?(?:' + [
    String.raw `(?:master|bachelor)(?:['’]?s)?(?:\s+of\s+[a-z]+)?\s+(?:degree\s+)?(?:thesis|dissertation)`,
    String.raw `(?:m|b)\.?\s?(?:sc|a|eng|phil|s)\.?\s+(?:thesis|dissertation)`,
    String.raw `ph\.?\s?d\.?\s+(?:thesis|dissertation)`,
    String.raw `doctor(?:al|ate)\s+(?:thesis|dissertation)`,
    String.raw `(?:diploma|honou?rs|undergraduate|graduation|senior|final[-\s]year)\s+(?:thesis|dissertation)`,
    String.raw `thesis|dissertation`,
    String.raw `trabajo\s+(?:de\s+)?fin\s+de\s+(?:m[aá]ster|grado|carrera)(?:\s*\(\s*tf[mg]\s*\))?`,
    String.raw `tesis(?:\s+(?:doctoral|de\s+(?:doctorado|maestr[ií]a|m[aá]ster|licenciatura|grado)))?|tesina`,
    String.raw `memoria\s+de\s+(?:tesis|m[aá]ster|grado)`,
    String.raw `disserta[çc][aã]o(?:\s+de\s+(?:mestrado|doutorado))?|tese(?:\s+de\s+(?:doutorado|doutoramento|mestrado))?`,
    String.raw `trabalho\s+de\s+conclus[aã]o\s+de\s+curso`,
    String.raw `m[ée]moire\s+de\s+(?:master|ma[iî]trise|licence|fin\s+d['’][ée]tudes)|th[èe]se(?:\s+de\s+doctorat)?`,
    String.raw `(?:master|bachelor|diplom|magister|doktor)-?arbeit|(?:master|bachelor)-?thesis`,
    String.raw `tesi(?:\s+di\s+(?:laurea(?:\s+(?:magistrale|specialistica|triennale))?|dottorato))?`
].join('|') + ')\\s*[.:]?$', 'i');
export function isDegreeStatement(line: unknown): boolean {
    const value = String(line ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!value || value.length > 80)
        return false;
    return CJK_DEGREE_LINE.test(value) || LATIN_DEGREE_LINE.test(value);
}
const THESIS_OPENING = /^(?:a\s+|the\s+)?(?:thesis|dissertation)\b/i;
const THESIS_STATED = /^(?:a\s+|the\s+)?(?:thesis|dissertation)(?:\s+(?:submitted|presented|for|by|to|in)\b.*)?$/i;
const LATIN_FORM_STATEMENT: RegExp[] = [
    /^(?:submitted\s+)?in\s+(?:partial\s+)?fulfil?l?ment\b/i,
    /\bin\s+(?:partial\s+)?fulfil?l?ment\s+of\s+the\s+requirements\b/i,
    /^(?:submitted\s+)?(?:for|in\s+candidacy\s+for)\s+the\s+degree\b/i,
    /^for\s+the\s+degree\s+of\b/i,
    /^(?:submitted\s+)?to\s+the\s+(?:graduate\s+)?(?:school|faculty|college)\b/i,
    /\bsubmitted\s+to\s+the\s+(?:graduate\s+)?(?:school|faculty|college|department|university|board)\b/i,
    /^in\s+partial\s+satisfaction\b/i,
    /^(?:doctorate|doctor|master|bachelor|licentiate)\s+of\s+(?!(?:the|a|an|his|her|its|our|my|this|that)\b)[\p{L}\s]{2,40}$/iu,
    /\bpara\s+(?:optar|obtener|la\s+obtenci[óo]n\s+del?)\s+(?:al?\s+|el\s+)?(?:grado|t[ií]tulo)\b/i,
    /\bpara\s+(?:a\s+)?obten[çc][ãa]o\s+do\s+(?:grau|t[ií]tulo)\b/i,
    /\b(?:pour\s+(?:obtenir\s+(?:le\s+)?|l['’]obtention\s+du\s+)|en\s+vue\s+de\s+l['’]obtention\s+du\s+)(?:grade|dipl[ôo]me|titre)\b/i,
    /\bzur\s+erlangung\s+des\b/i,
    /\bper\s+il\s+conseguimento\s+del\s+titolo\b/i,
    /^(?:thesis\s+|dissertation\s+|research\s+)?(?:co-?)?(?:supervisors?|advis[oe]rs?|directors?|tutors?|promot[eo]rs?)(?:\s*\(s\))?\s*[:：]/i,
    /^(?:thesis|dissertation)\s+(?:supervisors?|advis[oe]rs?|directors?|committee)\b|^supervised\s+by\b/i,
    /^(?:co-?)?(?:director(?:a|es|as)?|tutor(?:a|es|as)?)\s+de(?:l|\s+la)?\s+(?:tesis|trabajo|tfm|tfg)\b/i,
    /^(?:co-?)?(?:directeur|directrice)s?\s+de\s+(?:th[èe]se|recherche|m[ée]moire)\b/i,
    /^(?:erst|zweit)?(?:betreuer(?:in)?|gutachter(?:in)?)\s*[:：]|^orientador(?:a|es)?\s*[:：]|^(?:co)?relatore\s*[:：]/i
];
const APPROVAL_VERB = '(?:인준|제출|인정|승인|판정|심사|提出|認准|認準|認定|承認|判定|審査|審查)';
const APPROVAL_ENDING = '(?:함|합니다|하였음|하였습니다|하옵니다|하였다)';
const APPROVAL_SENTENCE = new RegExp(`(?:논문|학위|論文|學位)[^\\n]{0,24}?${APPROVAL_VERB}\\s*${APPROVAL_ENDING}\\s*\\.?$`);
const APPROVAL_FRAGMENT = new RegExp([
    String.raw `^[가-힣]{2,5}의\s+[^\n]{0,24}?(?:석사|박사)\s*학위(?:\s*논문)?$`,
    String.raw `^(?:학위\s*)?논문을\s*(?:인준|제출)`,
    String.raw `^(?:이\s*)?(?:논문|論文)을\s[^\n]{0,40}(?:논문|論文)(?:으로|로)$`,
    `^${APPROVAL_VERB}\\s*${APPROVAL_ENDING}\\s*\\.?$`
].join('|'));
const DEGREE_SENTENCE_PERSON = /^([가-힣](?: ?[가-힣]){1,4}) ?의 [^\n]{0,24}?(?:학위|논문|論文)/;
export function personOfDegreeSentence(line: unknown): string {
    const value = String(line ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!value || value.length > 80)
        return '';
    const name = DEGREE_SENTENCE_PERSON.exec(value)?.[1]?.replace(/\s+/g, '') || '';
    return /^[가-힣]{2,5}$/.test(name) ? name : '';
}
const CJK_SUPERVISOR_LINE = /^(?:지도|指導|指导)\s*(?:교수|敎授|教授|教員|教师|教師)(?:\s*[:：]\s*|\s+)(?:[\p{Script=Han}가-힣]\s?){2,4}(?:\s*[(（]\s*(?:인|印)\s*[)）])?$/u;
const SEAL_LINE = /[(（]\s*(?:인|印)\s*[)）]\s*$/;
export function isDegreeFormLine(line: unknown): boolean {
    const value = String(line ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!value)
        return false;
    if (THESIS_OPENING.test(value) || LATIN_FORM_STATEMENT.some(pattern => pattern.test(value)))
        return true;
    return APPROVAL_SENTENCE.test(value) || APPROVAL_FRAGMENT.test(value) || CJK_SUPERVISOR_LINE.test(value) || SEAL_LINE.test(value);
}
const CJK_LABEL_UNSPACED = /(?:석사|박사|학사|碩士|博士|學士|硕士|学士)(?:학위|學位|学位)(?:청구|請求|请求)?(?:논문|論文|论文)/;
const formRow = (line: string) => isDegreeStatement(line) || THESIS_STATED.test(line) || LATIN_FORM_STATEMENT.some(pattern => pattern.test(line))
    || APPROVAL_SENTENCE.test(line) || APPROVAL_FRAGMENT.test(line) || CJK_SUPERVISOR_LINE.test(line) || SEAL_LINE.test(line);
export function isDegreeFormPage(text: unknown): boolean {
    const page = String(text ?? '').normalize('NFKC');
    if (!page.trim())
        return false;
    const lines = page.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (lines.some(formRow))
        return true;
    for (let at = 0; at + 1 < lines.length; at++) {
        const joined = `${lines[at]} ${lines[at + 1]}`;
        if (joined.length <= 80 && (APPROVAL_SENTENCE.test(joined) || isDegreeStatement(joined)))
            return true;
    }
    let run = '';
    for (const line of [...lines, '']) {
        const bare = line.replace(/\s+/g, '');
        if (bare && bare.length <= 2) {
            run += bare;
            continue;
        }
        if (run && CJK_LABEL_UNSPACED.test(run))
            return true;
        run = '';
    }
    return false;
}

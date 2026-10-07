export type IdentifierAgreement = 'exact' | 'differs' | 'ambiguous' | 'missing';
const RESOLVER = /^https?:\/\/(?:dx\.)?doi\.org\//i;
export function rawDOI(value: unknown): string {
    return String(value ?? '').trim().replace(RESOLVER, '');
}
export function normalizedDOI(value: unknown): string {
    return rawDOI(value).toLowerCase();
}
const OPEN_BOUNDARY = /[.,;:]$/;
export function doiBoundaryAmbiguous(value: unknown): boolean {
    const raw = rawDOI(value);
    if (!raw)
        return false;
    if (OPEN_BOUNDARY.test(raw))
        return true;
    const opens = (raw.match(/\(/g) || []).length, closes = (raw.match(/\)/g) || []).length;
    return opens !== closes;
}
export function compareDOI(onPage: unknown, inRecord: unknown): IdentifierAgreement {
    const page = normalizedDOI(onPage), record = normalizedDOI(inRecord);
    if (!page || !record)
        return 'missing';
    if (page === record)
        return 'exact';
    if (doiBoundaryAmbiguous(onPage) || doiBoundaryAmbiguous(inRecord))
        return 'ambiguous';
    return 'differs';
}
export interface IdentifierComparison {
    stringAgreement: IdentifierAgreement;
    identityVerified: boolean;
    reason: string;
}
export function compareIdentifiers(onPage: unknown, inRecord: unknown, identityVerified = false): IdentifierComparison {
    const stringAgreement = compareDOI(onPage, inRecord);
    const reason = stringAgreement === 'exact' && !identityVerified
        ? 'strings match; nothing has established that this identifier names this document'
        : stringAgreement;
    return { stringAgreement, identityVerified, reason };
}
export function normalizedISBN(value: unknown): string {
    const digits = String(value ?? '').toUpperCase().replace(/[^0-9X]/g, '');
    if (digits.length === 13)
        return digits;
    if (digits.length !== 10)
        return digits;
    const body = `978${digits.slice(0, 9)}`;
    let sum = 0;
    for (let index = 0; index < 12; index++)
        sum += Number(body[index]) * (index % 2 ? 3 : 1);
    return `${body}${(10 - (sum % 10)) % 10}`;
}
export function compareISBN(onPage: unknown, inRecord: unknown): IdentifierAgreement {
    const page = normalizedISBN(onPage), record = normalizedISBN(inRecord);
    if (!page || !record)
        return 'missing';
    return page === record ? 'exact' : 'differs';
}
export function sameDOI(a: unknown, b: unknown): boolean {
    const x = normalizedDOI(a), y = normalizedDOI(b);
    return !!x && x === y;
}
export function sameDOILink(a: unknown, b: unknown): boolean {
    return RESOLVER.test(String(a ?? '').trim()) && RESOLVER.test(String(b ?? '').trim()) && sameDOI(a, b);
}
export function containerDOIOf(own: unknown, printed: unknown): string | null {
    const part = normalizedDOI(own), whole = normalizedDOI(printed);
    if (!part || !whole || part === whole || !part.startsWith(whole + '_'))
        return null;
    return /^_[\w.-]{1,12}$/.test(part.slice(whole.length)) ? whole : null;
}
export function validISBN(value: unknown): string {
    const digits = String(value ?? '').replace(/[\s-]/g, '').toUpperCase();
    if (/^\d{9}[\dX]$/.test(digits)) {
        const sum = [...digits].reduce((total, char, index) => total + (char === 'X' ? 10 : Number(char)) * (10 - index), 0);
        return sum % 11 === 0 ? digits : '';
    }
    if (/^97[89]\d{10}$/.test(digits)) {
        const sum = [...digits].reduce((total, char, index) => total + Number(char) * (index % 2 ? 3 : 1), 0);
        return sum % 10 === 0 ? digits : '';
    }
    return '';
}
export function isbnsIn(value: unknown): string[] {
    const out: string[] = [];
    const add = (digits: string) => {
        const valid = validISBN(digits);
        if (!valid)
            return false;
        const key = normalizedISBN(valid);
        if (!out.includes(key))
            out.push(key);
        return true;
    };
    const chop = (digits: string) => {
        let rest = digits;
        while (rest.length >= 10) {
            if (rest.length >= 13 && add(rest.slice(0, 13)))
                rest = rest.slice(13);
            else if (add(rest.slice(0, 10)))
                rest = rest.slice(10);
            else
                return rest;
        }
        return rest;
    };
    let pending: string[] = [];
    for (const token of String(value ?? '').toUpperCase().split(/[\s,;/|]+/)) {
        const digits = token.replace(/[^0-9X]/g, '');
        if (!digits)
            continue;
        if ((digits.length === 10 || digits.length === 13) && add(digits)) {
            pending = [];
            continue;
        }
        if (digits.length > 13) {
            pending = [];
            chop(digits);
            continue;
        }
        pending.push(digits);
        while (pending.join('').length > 13)
            pending.shift();
        for (let from = 0; from < pending.length; from++) {
            const joined = pending.slice(from).join('');
            if ((joined.length === 10 || joined.length === 13) && add(joined)) {
                pending = [];
                break;
            }
        }
    }
    return out;
}
export function validISSN(value: unknown): string {
    const digits = String(value ?? '').replace(/[^\dXx]/g, '').toUpperCase();
    if (!/^\d{7}[\dX]$/.test(digits))
        return '';
    const sum = [...digits.slice(0, 7)].reduce((total, char, index) => total + Number(char) * (8 - index), 0);
    const check = (11 - (sum % 11)) % 11;
    return (check === 10 ? 'X' : String(check)) === digits[7] ? `${digits.slice(0, 4)}-${digits.slice(4)}` : '';
}
export function validORCID(value: unknown): string {
    const text = String(value ?? '').trim().toUpperCase();
    if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(text))
        return '';
    const digits = text.replace(/-/g, '');
    let total = 0;
    for (const char of digits.slice(0, 15))
        total = (total + Number(char)) * 2;
    const result = (12 - (total % 11)) % 11;
    return (result === 10 ? 'X' : String(result)) === digits[15] ? text : '';
}
export function registeredNumberWord(word: unknown): boolean {
    const token = String(word ?? '').trim().replace(/[‐‑]/g, '-');
    if (/^10\.\d{4,9}\/\S+$/.test(token))
        return true;
    if (!/^[\dXx-]+$/.test(token) || !/^\d/.test(token))
        return false;
    if (validORCID(token))
        return true;
    const span = /^(\d{4})-(\d{3}[\dXx])$/.exec(token);
    if (span) {
        const [from, to] = [Number(span[1]), Number(span[2])];
        if (/^\d{4}$/.test(span[2]) && from >= 1000 && from <= 2999 && to >= from && to - from <= 100)
            return false;
        return !!validISSN(token);
    }
    const digits = token.replace(/-/g, '');
    return (digits.length === 10 || digits.length === 13) && !!validISBN(digits);
}
export const SICI_TAIL = /^<\d{1,6}::aid-[a-z0-9-]{1,40}>\d{1,2}\.\d{1,2}\.co;\d-[\dx]/i;
export function doiIn(value: unknown): string {
    const raw = rawDOI(value);
    const match = /\b10\.\d{4,9}\/[^\s"<>]+/.exec(raw);
    if (!match)
        return '';
    const sici = SICI_TAIL.exec(raw.slice((match.index ?? 0) + match[0].length));
    return sici ? `${match[0]}${sici[0]}` : match[0].replace(/[.,;:)\]}>'"]+$/, '');
}

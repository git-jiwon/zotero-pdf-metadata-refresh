export const PUBLIC_URL_ERROR = '외부 조회는 로그인 정보가 없는 공개 HTTP/HTTPS 주소만 허용합니다. 로컬·사설 주소는 사용할 수 없습니다.';
function privateIPv4(host: string): boolean {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(host))
        return false;
    const [a, b, c] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 198 && (b === 18 || b === 19))
        || (a === 192 && b === 0 && c === 2)
        || (a === 198 && b === 51 && c === 100)
        || (a === 203 && b === 0 && c === 113);
}
function privateIPv6(host: string): boolean {
    const value = host.slice(1, -1);
    const halves = value.split('::');
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const parts = halves.length === 2 ? [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail] : head;
    if (parts.length !== 8)
        return true;
    const words = parts.map(part => parseInt(part, 16));
    if (words.every(word => word === 0) || (words.slice(0, 7).every(word => word === 0) && words[7] === 1))
        return true;
    if ((words[0] & 0xfe00) === 0xfc00 || (words[0] & 0xffc0) === 0xfe80
        || (words[0] & 0xffc0) === 0xfec0 || (words[0] & 0xff00) === 0xff00)
        return true;
    if (words.slice(0, 5).every(word => word === 0) && (words[5] === 0xffff || words[5] === 0)) {
        return privateIPv4(`${words[6] >>> 8}.${words[6] & 255}.${words[7] >>> 8}.${words[7] & 255}`);
    }
    return false;
}
export function safePublicURL(raw: unknown): string | null {
    if (typeof raw !== 'string' || /[\u0000-\u001f\u007f]/.test(raw))
        return null;
    try {
        const url = new URL(raw.trim());
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
            return null;
        const host = url.hostname.toLowerCase().replace(/\.$/, '');
        if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
            || host === 'home.arpa' || host.endsWith('.home.arpa') || privateIPv4(host)
            || (host.startsWith('[') && privateIPv6(host)))
            return null;
        return url.href;
    }
    catch {
        return null;
    }
}
export function assertPublicURL(raw: unknown): string {
    const safe = safePublicURL(raw);
    if (!safe)
        throw new Error(PUBLIC_URL_ERROR);
    return safe;
}

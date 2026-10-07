export function safeExternalURL(raw: string): string | null {
    if (!raw || /[\u0000-\u001f\u007f]/.test(raw))
        return null;
    try {
        const url = new URL(raw.trim());
        if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password)
            return null;
        return url.href;
    }
    catch {
        return null;
    }
}

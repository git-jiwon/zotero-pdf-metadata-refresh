const PREFIX = "[PDF Metadata Refresh]";
export function debug(message: string, data?: unknown): void {
    Zotero.debug(`${PREFIX} ${message}`);
    if (data !== undefined)
        Zotero.debug(data);
}

declare const __ADDON_VERSION__: string | undefined;
export const ADDON_VERSION = typeof __ADDON_VERSION__ === 'string' ? __ADDON_VERSION__ : 'dev';

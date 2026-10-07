/**
 * 진짜 openBatchWindow를 작은 가짜 DOM에 그리는 창 시험의 바탕. 쓰기는 메모리로만 간다(IOUtils는 Map, 조테로는 policy-harness의
 * 가짜 호스트).
 *
 * 창과 세션은 한 묶음(window-entry.mjs)에서 온다 — 시험은 준비한 세션을 BatchSession.loadLatest로 바꿔 끼워 「지난 작업 이어보기」로
 * 창에 싣는다(loadSession).
 */
import { moduleAt } from '../helpers/load-module.mjs';
import { installHost } from './policy-harness.mjs';

const classListOf = node => ({
  add: name => { if (!node.className.split(/\s+/).includes(name)) node.className = `${node.className} ${name}`.trim(); },
  remove: name => { node.className = node.className.split(/\s+/).filter(part => part && part !== name).join(' '); },
  toggle: (name, force) => {
    const has = node.className.split(/\s+/).includes(name), want = force === undefined ? !has : !!force;
    if (want && !has) classListOf(node).add(name); if (!want && has) classListOf(node).remove(name);
    return want;
  },
  contains: name => node.className.split(/\s+/).includes(name)
});
export class FakeNode {
  constructor(tag) { this.tagName = tag; this.children = []; this.parentNode = null; this._text = ''; this.className = ''; this.title = ''; this.style = { setProperty() {}, cssText: '', display: '' }; this.classList = classListOf(this); this.rebuilds = 0; }
  appendChild(child) { child.parentNode?.removeChild(child); child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parentNode = null; }
  insertBefore(child, ref) { child.parentNode?.removeChild(child); child.parentNode = this; const at = ref ? this.children.indexOf(ref) : -1; if (at < 0) this.children.push(child); else this.children.splice(at, 0, child); return child; }
  replaceChildren(...nodes) { this.rebuilds++; for (const child of this.children) child.parentNode = null; this.children = []; nodes.forEach(node => this.appendChild(node)); }
  remove() { this.parentNode?.removeChild(this); }
  setAttribute(name, value) { this.attributes ??= {}; this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes?.[name] ?? null; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  querySelectorAll(tag) { const out = []; const walk = node => { for (const child of node.children) { if (child.tagName === tag) out.push(child); walk(child); } }; walk(this); return out; }
  querySelector(tag) { return this.querySelectorAll(tag)[0] ?? null; }
  contains(node) { for (let parent = node; parent; parent = parent.parentNode) if (parent === this) return true; return false; }
  getBoundingClientRect() { return { width: 10, left: 0, right: 1000, top: 0 }; }
  get clientWidth() { return 1200; }
  focus() {}
}
export const find = (node, match) => { if (match(node)) return node; for (const child of node.children) { const hit = find(child, match); if (hit) return hit; } return null; };
export const findAll = (node, match, out = []) => { if (match(node)) out.push(node); for (const child of node.children) findAll(child, match, out); return out; };
export const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(resolve => setImmediate(resolve)); };

/**
 * 창을 연다. count: 그만큼의 가짜 항목으로 새 세션(대기 행)을 연다. confirm: 확인창의 답(기본 「예」) — 물은 말은 confirms에 쌓인다.
 */
export async function openWindow({ count = 0, confirm = () => true, locale = 'ko-KR' } = {}) {
  installHost();
  const root = new FakeNode('div');
  const frames = [];
  const documentListeners = new Map();
  const doc = { createElementNS: (_ns, tag) => new FakeNode(tag), createTextNode: text => { const node = new FakeNode('#text'); node._text = String(text); return node; },
    getElementById: () => root, documentElement: new FakeNode('html'), body: new FakeNode('body'), readyState: 'complete',
    addEventListener(type, listener) { const listeners = documentListeners.get(type) ?? []; listeners.push(listener); documentListeners.set(type, listeners); },
    removeEventListener(type, listener) { documentListeners.set(type, (documentListeners.get(type) ?? []).filter(fn => fn !== listener)); } };
  const win = { document: doc, closed: false, addEventListener() {}, removeEventListener() {}, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; }, navigator: {}, close() { this.closed = true; } };
  const errors = [], files = new Map(), confirms = [];
  globalThis.Services = { locale: { appLocaleAsBCP47: locale }, prompt: { confirm: (_win, title, text) => { confirms.push({ title, text }); return confirm(title, text); }, alert() {} } };
  globalThis.PathUtils = { join: (...parts) => parts.join('/'), filename: value => value.split('/').pop() };
  globalThis.IOUtils = { makeDirectory: async () => {}, exists: async file => files.has(file), getChildren: async () => [], readJSON: async file => structuredClone(files.get(file)),
    writeJSON: async (file, value) => { files.set(file, structuredClone(value)); }, stat: async () => ({ size: 1, lastModified: 1 }) };
  Object.assign(globalThis.Zotero, { locale, logError: error => errors.push(error), launchURL() {}, getMainWindow: () => ({ openDialog: () => win }),
    DataDirectory: { dir: '/memory' }, Prefs: { get: () => undefined, set() {} } });
  const mod = await moduleAt('test/support/window-entry.mjs');
  const items = Array.from({ length: count }, (_, at) => ({ id: at + 1, key: `K${at + 1}`, libraryID: 1, getField: () => `제목 ${at + 1}` }));
  mod.openBatchWindow(items, () => {});
  if (errors.length) throw errors[0];
  const flushFrames = () => { while (frames.length) frames.shift()(); };
  const buttonsIn = node => node.children.filter(child => child.tagName === 'button').map(child => child._text);
  const button = label => find(root, node => node.tagName === 'button' && (node._text === label || node.getAttribute('aria-label') === label));
  const rowNodes = () => findAll(root, node => node.tagName === 'tr' && node.className.startsWith('result'));
  const view = {
    mod, root, win, files, errors, confirms, frames, flushFrames, buttonsIn, button,
    dispatchDocument: (type, event) => { for (const listener of documentListeners.get(type) ?? []) listener(event); },
    tbody: () => find(root, node => node.tagName === 'tbody'),
    detail: () => find(root, node => node.className === 'detail'),
    message: () => find(root, node => node.className.split(' ').includes('message')).textContent,
    strip: () => find(root, node => node.className.startsWith('apply-result')),
    dashboard: () => find(root, node => node.className.startsWith('card dashboard')),
    chips: () => findAll(find(root, node => node.className === 'status-summary'), node => node.tagName === 'button').map(node => node.textContent),
    /** 목록에서 제목 칸에 text가 든 행. */
    rowNode: text => rowNodes().find(node => node.children[3]?.textContent.includes(text)),
    /** 준비한 세션을 「지난 작업 이어보기」로 싣는다. */
    loadSession: async session => {
      mod.BatchSession.loadLatest = async () => session;
      button(locale.toLowerCase().replaceAll('_', '-').split('-')[0] === 'ko' ? '지난 작업 이어보기' : 'Load previous job').onclick();
      await settle(); flushFrames();
    }
  };
  return view;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { moduleAt } from './helpers/load-module.mjs';
import { find, findAll, openWindow, settle } from './support/fake-window.mjs';

const { uiLocale, uiText, uiTemplate } = await moduleAt('src/ui/i18n.ts');
const { EN_TEXT, EN_DIAGNOSTIC_ARGUMENTS } = await moduleAt('src/ui/i18n-en.ts');
const { EN_DIAGNOSTICS_SECURITY } = await moduleAt('src/ui/i18n-en-diagnostics-security.ts');
const englishCopy = { ...EN_TEXT, ...EN_DIAGNOSTICS_SECURITY };
const applied = await moduleAt('src/batch/applied-record.ts');
const { exportSelectedItems } = await moduleAt('src/ui/selected-export.ts');
const korean = /[가-힣]/;
const englishHost = () => { globalThis.Zotero = { locale: 'en-US' }; globalThis.Services = { locale: { appLocaleAsBCP47: 'ko-KR' } }; };

test('UI locale follows the Zotero UI language, including regional Korean locales', () => {
  for (const locale of ['ko', 'ko-KR', 'KO-kr', 'ko-KP', 'ko_KR']) {
    globalThis.Zotero = { locale }; assert.equal(uiLocale(), 'ko'); assert.equal(uiText('제목'), '제목');
  }
  for (const locale of ['en-US', 'en-GB', 'de-DE', 'ja-JP', 'unknown', '']) {
    globalThis.Zotero = { locale }; globalThis.Services = {}; assert.equal(uiLocale(), 'en');
  }
  globalThis.Zotero = {}; globalThis.Services = { locale: { appLocaleAsBCP47: 'ko-KR' } };
  assert.equal(uiLocale(), 'ko');
  englishHost(); assert.equal(uiLocale(), 'en');
});

test('display templates preserve Korean titles, field values, model names and paths verbatim', () => {
  englishHost();
  const title = '제목 · 승인됨 {0} 「PDF 정보 찾기」';
  const path = String.raw`D:\문서\제목.pdf`;
  assert.equal(uiTemplate`제안: ${title}`, `Proposed: ${title}`);
  assert.equal(uiTemplate`작업·복구 파일: ${path}`, `Job and recovery files: ${path}`);
  assert.equal(uiTemplate`사용 중 · ${'한국어 모델 / Qwen-VL'}`, 'Enabled · 한국어 모델 / Qwen-VL');
  assert.equal(uiTemplate`선택한 ${12}개 항목의 PDF를 살펴볼까요?`, 'Ready to review PDFs for 12 selected items?');
  globalThis.Zotero.locale = 'ko-KR';
  assert.equal(uiTemplate`제안: ${title}`, `제안: ${title}`);
});

test('policy copy translates its sentence while keeping protected values and rule identifiers intact', () => {
  englishHost();
  const protectedValue = '제목 (승인됨)';
  assert.equal(uiText(`이 필드에는 확인된 값(${protectedValue})이 기록돼 있고 이 후보는 그와 다릅니다 — 보호를 해제하면 쓸 수 있습니다`),
    `The confirmed value (${protectedValue}) is protected and differs from this candidate. Release protection to allow writing.`);
  assert.equal(uiText('문서 본문과 대조해 확인됨 (title/stated)'), 'Verified against the PDF text (title/stated)');
  assert.equal(uiText('10월 7일 12:34'), '10/7 12:34');
  assert.equal(uiText('이전에 알 수 없는 문서 응답'), '이전에 알 수 없는 문서 응답');
});

test('completed diagnostic sentences preserve document values and translate only reviewed nested copy', () => {
  englishHost();
  const raw = '제목 · 승인됨 「검색」 (2026-10-06 결정)';
  assert.equal(uiText(`판독한 제목 「${raw}」은 제목이 아닙니다 — 이 문서가 주는 제목 「${raw}」(쪽에 찍혀 있음)으로 채웠습니다.`),
    `The read value "${raw}" is not a title. Replaced it with the document's printed title, "${raw}".`);
  assert.equal(uiText(`「${raw}」은 권이 아닙니다.`), `"${raw}" is not Volume.`);
  assert.equal(uiText('PDF 문서 판독 · No evidence linking an external record Review needed'),
    'PDF document reading · No evidence linking an external record Review needed');
  const error = 'Demo: a temporary network error. This is a fictional document. Error · retry';
  assert.equal(uiText('오류: ' + error), 'Error: ' + error);
  assert.equal(uiText(`오류: 알 수 없는 응답 「${raw}」`), `Error: 알 수 없는 응답 「${raw}」`);
  const model = '한국어 모델, 「검색」 / Qwen-VL';
  assert.equal(uiText(`LM Studio 비전 OCR (${model}, 1280px, 1·2쪽 읽음, 프롬프트 120토큰/요청, 서지 없음)`),
    `LM Studio vision OCR (${model}, 1280px, read pages 1·2, prompt: 120 tokens per request, no printed bibliography)`);
  const decision = '제목·저자 밖의 칸은 DOI 기록이 정합니다(2026-10-06 결정)';
  const nested = `이 문서와 같은 판본으로 맞은 DOI 기록(Crossref, 10.1000/example)의 값 「${raw}」 — ${decision}.`;
  assert.equal(uiText(nested), `Value "${raw}" from DOI record matched to this document’s edition (Crossref, 10.1000/example) — Fields other than title and creators follow the DOI record.`);
  globalThis.Zotero.locale = 'ko-KR';
  assert.equal(uiText(nested), nested.replace(' — ' + decision + '.', ' — 제목·저자 밖의 칸은 DOI 기록이 정합니다.'));
  assert.equal(uiTemplate`제안: ${raw}`, '제안: ' + raw);
});

test('every completed program diagnostic template matches without changing numbered values', () => {
  englishHost();
  const keys = new Set([...Object.keys(EN_DIAGNOSTIC_ARGUMENTS), ...Object.keys(EN_DIAGNOSTICS_SECURITY)]);
  const failures = [];
  for (const source of keys) {
    if (!/\{\d+\}/.test(source)) continue;
    const sample = source.replace(/\{\d+\}/g, '12');
    const expected = englishCopy[source].replace(/\{\d+\}/g, '12');
    const actual = uiText(sample);
    if (actual !== expected) failures.push({ source, expected, actual });
  }
  assert.deepEqual(failures, []);
});

test('composed apply and restore summaries translate counts and policy clauses without changing core results', () => {
  englishHost();
  const run = { id: 1, kind: 'apply', startedAt: new Date(2026, 9, 7, 12, 34).getTime(), endedAt: 0, asked: 4,
    done: [1], fieldCounts: { title: { changed: 1, added: 0, cleared: 0, typeLoss: 0 } },
    skipped: [{ id: 2, code: 'alreadyApplied' }, { id: 3, code: 'noFieldTicked' }], failed: [{ id: 4, key: 'K4', reason: 'raw' }], conflicts: [], stopped: false };
  const before = structuredClone(run);
  assert.doesNotMatch(uiText(applied.applyRunLine(run)), korean);
  assert.doesNotMatch(uiText(applied.applyBlockMessage(2, ['alreadyApplied', 'noFieldTicked'], { lastApply: { rows: 1 } })), korean);
  assert.doesNotMatch(uiText(applied.applyBlockMessage(0, [], { lastApply: { rows: 1, at: run.startedAt } })), korean);
  assert.deepEqual(run, before);
  run.kind = 'undo'; run.conflicts = [{ id: 5, key: 'K5' }];
  assert.doesNotMatch(uiText(applied.applyRunLine(run)), korean);
});

test('all explicit static UI copy and tagged UI templates have an English catalogue entry', () => {
  const missing = [], sourceFiles = ['src/ui/batch-window.ts', 'src/ui/list-presentation.ts', 'src/ui/context-menu.ts', 'src/index.ts'];
  for (const file of sourceFiles) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const check = (node, key) => { if (korean.test(key) && !Object.hasOwn(EN_TEXT, key)) missing.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${key}`); };
    const visit = node => {
      // Inventory every Korean literal, including labels selected through maps and arrays before their display boundary.
      if (ts.isStringLiteralLike(node)) check(node, node.text);
      if (ts.isTemplateExpression(node)) {
        let key = node.head.text;
        node.templateSpans.forEach((span, index) => { key += `{${index}}` + span.literal.text; });
        check(node, key);
      }
      if (ts.isTaggedTemplateExpression(node) && node.tag.getText(source) === 'uiTemplate') {
        let key = node.template.head?.text ?? node.template.text;
        node.template.templateSpans?.forEach((span, index) => { key += `{${index}}` + span.literal.text; });
        check(node, key);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(missing, []);
  for (const [source, translated] of Object.entries(englishCopy)) {
    assert.doesNotMatch(translated, korean, `English copy: ${source}`);
    assert.deepEqual([...source.matchAll(/\{(\d+)\}/g)].map(match => match[1]).sort(), [...translated.matchAll(/\{(\d+)\}/g)].map(match => match[1]).sort(), `Template parameters: ${source}`);
  }
});

test('English window renders controls and guides in English while preserving Korean document titles', async () => {
  const view = await openWindow({ locale: 'en-US', count: 2 });
  assert.equal(view.button('Find PDF metadata')?._text, 'Find PDF metadata');
  assert.match(view.root.textContent, /Ready to review PDFs for 2 selected items/);
  assert.match(view.root.textContent, /제목 1/);
  for (const node of findAll(view.root, node => ['button', 'summary', 'th'].includes(node.tagName))) {
    assert.doesNotMatch(node._text, korean, `Control ${node.tagName}: ${node._text}`);
    assert.doesNotMatch(node.title, korean, `Tooltip ${node.title}`);
  }
  const session = new view.mod.BatchSession([], '/memory/한국어-path');
  session.rows = [{ id: 1, key: 'K1', libraryID: 1, title: '문서 원문 제목', status: 'review', checked: false,
    changes: [{ field: 'title', oldValue: '문서 원문 제목', newValue: '새 제목' }],
    recognized: { itemType: 'book', fields: { title: '새 제목' }, creators: [] } }];
  await view.loadSession(session);
  const row = view.rowNode('문서 원문 제목'); assert.ok(row);
  assert.ok(row.children.some(cell => cell.textContent === '문서 원문 제목'));
  row.onclick(); view.flushFrames();
  const heading = find(view.detail(), node => node.className === 'detail-item-heading');
  assert.equal(heading.textContent, '문서 원문 제목');
  const value = find(view.detail(), node => node.className === 'value-edit');
  assert.equal(value.value, '새 제목');
  assert.doesNotMatch(find(view.detail(), node => node.className === 'reason').textContent, korean);
});

test('selected export preserves document data and Korean paths in both UI languages', async () => {
  const jobPath = String.raw`D:\자료\「검색」-「적용됨」`;
  for (const locale of ['ko-KR', 'en-US']) {
    const view = await openWindow({ locale, count: 1 });
    const session = new view.mod.BatchSession([], jobPath);
    session.rows = [
      { id: 1, key: 'K1', libraryID: 1, title: '원문 「검색」 제목', status: 'pending', checked: true, reportFlag: false, changes: [],
        recognized: { itemType: 'book', fields: { title: '새 원문 · 승인됨', url: 'https://example.org/자료' }, creators: [] } },
      { id: 2, key: 'K2', libraryID: 1, title: 'PDF 없는 선택 문서', status: 'noPDF', checked: true, reportFlag: true, changes: [] },
      { id: 3, key: 'K3', libraryID: 1, title: '이전 표시만 한 문서', status: 'pending', checked: false, reportFlag: true, changes: [] },
    ];
    await view.loadSession(session);
    const before = structuredClone(session.rows);
    const search = find(view.root, node => node.tagName === 'input' && node.type === 'search');
    search.value = '이전 표시만 한 문서'; search.oninput();
    view.flushFrames();
    assert.equal(view.tbody().children.length, 1);
    assert.match(view.tbody().textContent, /이전 표시만 한 문서/);
    const button = view.button(locale === 'ko-KR' ? '선택한 항목 파일로 내보내기' : 'Export selected items…');
    assert.ok(button); assert.equal(button.disabled, false);
    if (locale === 'en-US') assert.match(button.title, /Selected: 2, including 2 hidden in other views/);
    button.onclick();
    await settle(); view.flushFrames();
    const reports = [...view.files].filter(([file]) => file.startsWith(jobPath + '/reports/report-') && file.endsWith('.json'));
    assert.equal(reports.length, 1);
    const [path, report] = reports[0];
    assert.deepEqual(report.rows, before.filter(row => row.checked));
    assert.deepEqual(session.rows, before);
    assert.equal(report.job, jobPath);
    assert.ok(view.message().endsWith(path), view.message());
    if (locale === 'en-US') assert.doesNotMatch(report.note, korean);
  }
});

test('selected export explains an empty selection in the host UI language', async () => {
  englishHost();
  await assert.rejects(exportSelectedItems([], '/memory/원문'), { message: 'Select items to export.' });
  globalThis.Zotero.locale = 'ko-KR';
  await assert.rejects(exportSelectedItems([], '/memory/원문'), { message: '파일로 내보낼 항목을 선택하세요.' });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleAt } from './helpers/load-module.mjs';
import { find, findAll, openWindow, settle } from './support/fake-window.mjs';
import { snapshotOf, spyItem, attachment } from './support/policy-harness.mjs';

const presentation = await moduleAt('src/ui/list-presentation.ts');
const { EVIDENCE } = await moduleAt('src/batch/row.ts');
const row = (id, title, properties = {}) => ({ id, key: `K${id}`, libraryID: 1, title, status: 'review', checked: false,
  changes: [], recognized: { itemType: 'book', fields: { title }, creators: [] }, ...properties });
const fixtureRows = () => [
  row(1, '문서 A', { recognitionSource: '문서 판독' }),
  row(2, '식별자 A', { identifierPDF: true, authoritative: true }),
  row(3, '오류 A', { status: 'failed' }),
  row(4, '문서 B', { recognitionSource: '문서 판독' }),
  row(5, '카탈로그 A', { recognitionSource: 'Zotero native PDF recognizer' }),
  row(6, '식별자 B', { identifierPDF: true, authoritative: true }),
  row(7, '제외 A', { status: 'excluded' })
];
const mountFixture = async () => {
  const view = await openWindow();
  const session = new view.mod.BatchSession([], '/memory/release-ui'); session.rows = fixtureRows();
  await view.loadSession(session);
  return { view, session };
};
const titles = view => view.tbody().children.filter(node => node.className.startsWith('result')).map(node => node.children[3].textContent);

test('release UI — all evidence kinds have one stable display rank; title search folds spaces and Unicode forms', () => {
  const kinds = presentation.EVIDENCE_FILTER_GROUPS.flatMap(group => group.kinds);
  assert.deepEqual([...kinds].sort(), Object.keys(EVIDENCE).sort(), 'each evidence tag is reachable from a filter group');
  assert.equal(new Set(kinds).size, 15);
  const ordered = [...kinds].sort((a, b) => presentation.evidenceSortRank(a) - presentation.evidenceSortRank(b));
  assert.deepEqual(ordered, ['pending', 'stopped', 'excluded', 'unread', 'missingFile', 'failed',
    'documentRead', 'none', 'preprintKept', 'noPDF', 'multiplePDFs', 'catalogue', 'webPage', 'identifier', 'applied']);
  assert.deepEqual(ordered.map(presentation.evidenceSortRank), Array.from({ length: 15 }, (_, index) => index));
  assert.deepEqual(ordered.map(presentation.evidenceTone), ['muted', 'muted', 'muted', 'danger', 'danger', 'danger',
    'attention', 'attention', 'attention', 'attention', 'attention', 'warning', 'warning', 'success', 'success']);
  assert.equal(presentation.matchesListQuery('  MODEL  Ａ  ', ['Model A', '서지정보']), true);
  assert.equal(presentation.matchesListQuery('문서 B', ['문서', '제목 B']), true);
  assert.equal(presentation.matchesListQuery('문서 C', ['문서 B']), false);
});

test('release UI — 근거 header groups identical tags stably, reverses group order, and restores job order', async () => {
  const { view, session } = await mountFixture();
  const before = structuredClone(session.rows);
  const head = find(view.root, node => node.tagName === 'th' && node.className.startsWith('col-evidence'));
  assert.equal(head.tabIndex, 0);
  assert.equal(head.getAttribute('aria-sort'), 'none');
  head.onclick({ target: head });
  assert.deepEqual(titles(view), ['제외 A', '오류 A', '문서 A', '문서 B', '카탈로그 A', '식별자 A', '식별자 B']);
  assert.equal(head.getAttribute('aria-sort'), 'ascending');
  let prevented = false;
  head.onkeydown({ target: head, key: 'Enter', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(titles(view), ['식별자 A', '식별자 B', '카탈로그 A', '문서 A', '문서 B', '오류 A', '제외 A']);
  assert.equal(head.getAttribute('aria-sort'), 'descending');
  head.onclick({ target: head });
  assert.deepEqual(titles(view), before.map(row => row.title));
  assert.equal(head.getAttribute('aria-sort'), 'none');
  assert.deepEqual(session.rows, before, 'sorting is a view operation; recognition and choices are unchanged');
});

test('release UI — group filters stay in display order; title search combines with the group and preserves choices', async () => {
  const { view, session } = await mountFixture();
  const summary = find(view.root, node => node.className === 'status-summary');
  const captions = findAll(summary, node => node.className === 'filter-caption').map(node => node.textContent);
  assert.deepEqual(captions, ['인식 근거', '처리 상태']);
  assert.deepEqual(view.chips(), ['전체 7', 'PDF에서 읽음 2', '도서·논문 목록 1', '식별번호로 찾음 2', '찾기에서 제외 1', '처리 오류 1']);
  const firstRow = view.rowNode('문서 A');
  firstRow.children[0].children[0].checked = true; firstRow.children[0].children[0].onchange();
  const choicesBefore = structuredClone(session.rows);
  view.button('식별번호로 찾음 2').onclick();
  assert.deepEqual(titles(view), ['식별자 A', '식별자 B']);
  assert.equal(view.button('식별번호로 찾음 2').getAttribute('aria-pressed'), 'true');
  assert.match(find(view.root, node => node.className === 'selection-count').textContent, /다른 보기에 1개 포함/);
  const search = find(view.root, node => node.tagName === 'input' && node.type === 'search');
  search.value = 'B'; search.oninput();
  assert.deepEqual(titles(view), ['식별자 B']);
  search.value = '없음'; search.oninput();
  assert.deepEqual(titles(view), []);
  assert.match(view.tbody().textContent, /조건에 맞는 항목이 없습니다/);
  assert.equal(view.tbody().children[0].children[0].colSpan, 5);
  view.button('보기 초기화').onclick();
  assert.deepEqual(titles(view), fixtureRows().map(row => row.title));
  assert.equal(search.value, '');
  assert.equal(view.button('보기 초기화').disabled, true);
  assert.deepEqual(session.rows, choicesBefore, 'filters never clear a hidden selection or alter a recognition');
});

test('release UI — six color meanings match row badges, survive activation and order each detail group', async () => {
  const view = await openWindow();
  const session = new view.mod.BatchSession([], '/memory/color-ui'); session.rows = fixtureRows();
  session.rows[0].rescannedAt = 1;
  session.rows[0].storedDifference = { fields: ['title'], details: { title: { before: '기존 제목', after: '찾은 제목' } } };
  session.rows[1].status = 'updated';
  session.rows[1].applied = { source: 'recorded', at: 1, run: 1, fields: [], notWritten: [] };
  session.lastApply = { id: 1, kind: 'apply', startedAt: 1, endedAt: 1, asked: 2, done: [2], fieldCounts: {},
    skipped: [{ id: 1, key: 'K1', code: 'noFieldTicked' }], failed: [], conflicts: [], stopped: false };
  await view.loadSession(session);
  const before = structuredClone(session.rows);
  const tone = node => node.className.split(/\s+/).find(name => name.startsWith('tone-'));
  const legend = find(view.root, node => node.className === 'tone-legend');
  assert.deepEqual(legend.children.map(tone), ['tone-muted', 'tone-danger', 'tone-attention', 'tone-warning', 'tone-info', 'tone-success']);
  assert.match(legend.title, /정확도나 적용 승인을 뜻하지 않/);
  const groups = findAll(view.root, node => node.className === 'filter-group');
  assert.deepEqual(groups.map(group => group.children[1].children.map(tone)), [
    ['tone-attention', 'tone-warning', 'tone-success'], ['tone-muted', 'tone-danger', 'tone-success'],
    ['tone-attention', 'tone-attention', 'tone-info', 'tone-success']
  ]);
  const evidenceChips = findAll(view.root, node => node.tagName === 'button' && /\bevidence-/.test(node.className));
  for (const chip of evidenceChips) {
    const evidenceClass = chip.className.split(/\s+/).find(name => name.startsWith('evidence-'));
    const badge = find(view.root, node => node.tagName === 'span' && node.className.split(/\s+/).includes(evidenceClass));
    assert.ok(badge, evidenceClass); assert.equal(tone(chip), tone(badge), 'the filter and the row use the same meaning');
    const label = chip.textContent; view.button(label).onclick();
    const active = view.button(label); assert.equal(active.getAttribute('aria-pressed'), 'true');
    assert.equal(tone(active), tone(chip), 'selection retains the meaning color');
    view.button(label).onclick();
  }
  assert.deepEqual(session.rows, before, 'color and filter actions never alter metadata or approval choices');
});

test('release UI — recognition methods occupy three cards and keep the existing switches; no model still offers 사용 안 함', async () => {
  const { view, session } = await mountFixture();
  const cards = findAll(view.root, node => node.className === 'method-card');
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map(card => findAll(card, node => node.tagName === 'input' && node.type === 'checkbox').length), [2, 1, 0]);
  const before = structuredClone(session.rows);
  const native = find(cards[0], node => node.tagName === 'input'); native.checked = false; native.onchange();
  assert.deepEqual(session.methods, { native: false, identifiers: true, searchRestore: true });
  assert.deepEqual(session.rows, before);
  assert.match(find(view.root, node => node.className.startsWith('method-model')).textContent, /사용 안 함/);
  const lmPanel = find(view.root, node => node.className === 'lm-panel');
  assert.ok(find(lmPanel, node => node.tagName === 'label' && node.textContent === '사용 안 함'));
  const version = find(view.root, node => node.className === 'version-note');
  assert.equal(version.textContent, '버전 test');
  assert.match(version.title, /인식 파이프라인/);
});

test('release UI — a result row opens detail with the keyboard while checkbox keys do not open the row', async () => {
  const { view } = await mountFixture();
  let result = view.rowNode('문서 A');
  result.onkeydown({ target: result.children[0].children[0], key: ' ', preventDefault() {} });
  assert.equal(view.button('변경 내용 확인').getAttribute('aria-expanded'), 'false');
  result.onkeydown({ target: result, key: 'Enter', preventDefault() {} });
  assert.equal(view.button('변경 내용 닫기').getAttribute('aria-expanded'), 'true');
  result = view.rowNode('문서 A');
  assert.equal(result.getAttribute('aria-selected'), 'true');
  assert.equal(result.children[0].children[0].getAttribute('aria-label'), '문서 A 선택');
});

test('release UI — untrusted candidate URLs remain visible as text and only ordinary web links can launch', async () => {
  const { view, session } = await mountFixture();
  const credential = new URL('https://example.org/'); credential.username = 'user'; credential.password = 'password';
  const unsafe = ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///C:/private', credential.href, 'https://example.org/\nunsafe'];
  session.rows[0].candidates = [...unsafe, 'https://example.org/article'].map((url, index) => ({ url, title: `후보 ${index}`, score: 0.5 }));
  view.rowNode('문서 A').onclick();
  const candidates = findAll(view.detail(), node => node.className === 'candidate');
  assert.equal(candidates.length, 6);
  for (const candidate of candidates.slice(0, -1)) assert.equal(find(candidate, node => node.tagName === 'a'), null);
  const link = find(candidates.at(-1), node => node.tagName === 'a');
  assert.equal(link.href, 'https://example.org/article');
  const launched = []; globalThis.Zotero.launchURL = url => launched.push(url);
  link.onclick({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(launched, ['https://example.org/article']);
});

test('compact UI — compare opens a displayed row in sort order without selecting or approving it', async () => {
  const { view, session } = await mountFixture();
  const before = structuredClone(session.rows);
  const head = find(view.root, node => node.tagName === 'th' && node.className.startsWith('col-evidence'));
  head.onclick({ target: head });
  view.button('변경 내용 확인').onclick();
  assert.equal(view.rowNode('제외 A').getAttribute('aria-selected'), 'true');
  assert.equal(view.button('변경 내용 닫기').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(session.rows, before, 'opening comparison does not check the item or its fields');
  view.button('변경 내용 닫기').onclick();
  view.button('변경 내용 확인').onclick();
  assert.equal(view.rowNode('제외 A').getAttribute('aria-selected'), 'true', 'reopening keeps the visible item');
});

test('compact UI — hiding the compared row returns space to the list and empty filters cannot open a blank pane', async () => {
  const { view, session } = await mountFixture();
  const before = structuredClone(session.rows);
  view.rowNode('문서 A').onclick();
  view.button('식별번호로 찾음 2').onclick();
  assert.equal(view.button('변경 내용 확인').getAttribute('aria-expanded'), 'false');
  view.button('변경 내용 확인').onclick();
  assert.equal(view.rowNode('식별자 A').getAttribute('aria-selected'), 'true');
  const search = find(view.root, node => node.tagName === 'input' && node.type === 'search');
  search.value = '없음'; search.oninput();
  assert.equal(view.button('변경 내용 확인').disabled, true);
  assert.equal(view.button('변경 내용 확인').getAttribute('aria-expanded'), 'false');
  view.button('보기 초기화').onclick();
  assert.equal(view.button('변경 내용 확인').disabled, false);
  assert.equal(view.button('변경 내용 확인').getAttribute('aria-expanded'), 'false');
  assert.deepEqual(session.rows, before);
});

test('compact UI — settings and help are exclusive and can close with Escape or an outside click', async () => {
  const { view, session } = await mountFixture();
  const before = structuredClone(session.rows);
  const settings = find(view.root, node => node.className === 'fields settings');
  const help = find(view.root, node => node.className === 'guidance');
  settings.open = true; settings.ontoggle();
  help.open = true; help.ontoggle();
  assert.equal(settings.open, false);
  settings.open = true; settings.ontoggle();
  assert.equal(help.open, false);
  view.dispatchDocument('click', { target: settings.children[0] });
  assert.equal(settings.open, true, 'clicking inside the settings does not dismiss it');
  let prevented = false;
  view.dispatchDocument('keydown', { key: 'Escape', preventDefault() { prevented = true; } });
  assert.equal(settings.open, false);
  assert.equal(prevented, true);
  settings.open = true; settings.ontoggle();
  view.dispatchDocument('click', { target: view.rowNode('문서 A') });
  assert.equal(settings.open, false);
  assert.deepEqual(session.rows, before, 'disclosing settings never changes item or field choices');
  assert.equal(view.files.size, 0);
});

test('release UI — shutdown during initialization waits, cancels, and never starts recognition afterwards', async () => {
  const view = await openWindow({ count: 1 });
  const proto = view.mod.BatchSession.prototype;
  const originals = { initialize: proto.initialize, preview: proto.preview };
  let release, captured, previews = 0;
  const gate = new Promise(resolve => { release = resolve; });
  proto.initialize = async function () { captured = this; await gate; };
  proto.preview = async () => { previews++; };
  try {
    view.button('PDF 정보 찾기').onclick();
    const closing = view.win.pdfMetadataRefreshShutdown();
    assert.equal(view.win.pdfMetadataRefreshShutdown(), closing, 'shutdown is idempotent');
    assert.equal(captured.cancel, true);
    assert.equal(view.win.closed, false, 'initialization is still using the add-on');
    view.button('PDF 정보 찾기').onclick();
    release(); await closing; await settle();
    assert.equal(previews, 0);
    assert.equal(view.win.closed, true);
  } finally { Object.assign(proto, originals); }
});

test('release UI — shutdown lets an active operation finish its save before closing, and suppresses later renders', async () => {
  const { view, session } = await mountFixture();
  let release, saved = false;
  const gate = new Promise(resolve => { release = resolve; });
  session.preview = async () => { session.busy = true; await gate; saved = true; session.busy = false; };
  view.button('PDF 정보 찾기').onclick();
  const before = view.tbody().rebuilds;
  const closing = view.win.pdfMetadataRefreshShutdown();
  assert.equal(session.cancel, true);
  assert.equal(view.win.closed, false);
  release(); await closing; view.flushFrames();
  assert.equal(saved, true);
  assert.equal(view.win.closed, true);
  assert.equal(view.tbody().rebuilds, before);
});

test('release UI — shutdown also waits for a confirmation mark being saved outside a batch run', async () => {
  const { view, session } = await mountFixture();
  let release, saved = false;
  const gate = new Promise(resolve => { release = resolve; });
  session.save = async () => { await gate; saved = true; };
  const flag = view.rowNode('문서 A').children[1].children[0];
  flag.checked = true; flag.onchange();
  const closing = view.win.pdfMetadataRefreshShutdown();
  assert.equal(view.win.closed, false);
  release(); await closing;
  assert.equal(saved, true);
  assert.equal(view.win.closed, true);
});

test('beginner UI — the first screen explains the selected job and exposes one main action without changing choices', async () => {
  const view = await openWindow({ count: 3 });
  const guidance = find(view.root, node => node.className === 'guidance');
  assert.match(guidance.textContent, /선택한 3개 항목/);
  assert.match(guidance.textContent, /목록 전체/);
  assert.match(guidance.textContent, /Zotero의 정보가 바뀌지는 않아요/);
  assert.equal(view.button('PDF 정보 찾기').disabled, false);
  assert.equal(view.button('PDF 정보 찾기').classList.contains('primary'), true);
  assert.equal(view.button('선택한 정보 적용').hidden, true);
  assert.equal(view.button('작업 멈추기').hidden, true);
  assert.equal(view.button('적용 되돌리기').hidden, true);
  assert.equal(view.dashboard().hidden, true, 'an unstarted job has no empty progress panel');
  for (const cls of ['guidance', 'selection-tools', 'classification-details', 'progress-details', 'fields settings']) {
    assert.equal(!!find(view.root, node => node.className === cls).open, false, `${cls} starts closed`);
  }
  assert.match(find(view.root, node => node.className === 'policy-note').textContent, /삭제 제안/);
  assert.equal(view.files.size, 0, 'opening the UI never writes a library value or a job');
  assert.ok(findAll(view.tbody(), node => node.tagName === 'input').every(box => !box.checked));
});

test('beginner UI — finding targets the job even after checking one row and never invokes apply', async () => {
  const view = await openWindow({ count: 3 });
  const proto = view.mod.BatchSession.prototype, originals = { initialize: proto.initialize, preview: proto.preview, apply: proto.apply };
  let found, applied = 0;
  proto.initialize = async () => {};
  proto.preview = async function (reuse, rows) { found = { reuse, rows, count: this.rows.length }; for (const row of this.rows) row.status = 'noChanges'; };
  proto.apply = async () => { applied++; };
  try {
    const first = view.rowNode('제목 1').children[0].children[0]; first.checked = true; first.onchange();
    view.button('PDF 정보 찾기').onclick(); await settle(); view.flushFrames();
    assert.deepEqual(found, { reuse: true, rows: undefined, count: 3 });
    assert.equal(applied, 0);
    assert.match(find(view.root, node => node.className === 'guidance').textContent, /지금 적용할 변경안이 없습니다/);
    assert.equal(view.button('선택한 정보 적용').disabled, true);
    assert.doesNotMatch(find(view.root, node => node.className === 'guidance').textContent, /적용할 항목을 선택하고/);
  } finally { Object.assign(proto, originals); }
});

const reviewFixture = async () => {
  const view = await openWindow();
  const session = new view.mod.BatchSession([], '/memory/beginner-ui');
  const spies = new Map();
  session.rows = [1, 2].map(id => {
    const key = `K${id}`, before = { ...snapshotOf('journalArticle', { title: `기존 ${id}`, date: '2001' }), itemID: id, key,
      identity: { ...snapshotOf('journalArticle', {}).identity, key } };
    const spy = spyItem(before); Object.assign(spy.item, { id, key }); spies.set(id, spy);
    return { id, key, libraryID: 1, title: `기존 ${id}`, status: 'review', checked: false, before,
      recognizedWith: view.mod.RECOGNITION_PIPELINE_VERSION,
      changes: [{ field: 'title', oldValue: `기존 ${id}`, newValue: `새 제목 ${id}` }, { field: 'date', oldValue: '2001', newValue: '2002' }],
      fieldChoice: { title: id === 1, date: false } };
  });
  const get = id => id === attachment.id ? attachment : spies.get(id)?.item;
  Zotero.Items.get = id => Array.isArray(id) ? id.map(get) : get(id);
  await view.loadSession(session);
  return { view, session, spies };
};

test('beginner UI — a check is a selection; actual writable plans control apply and blocked checks explain why', async () => {
  const { view, session } = await reviewFixture();
  assert.equal(view.button('PDF 정보 찾기').classList.contains('primary'), false, 'the follow-up finding action has lower emphasis');
  assert.equal(view.button('선택한 정보 적용').disabled, true);
  const checked = view.rowNode('기존 2').children[0].children[0]; checked.checked = true; checked.onchange();
  assert.equal(session.rows[1].checked, true);
  assert.equal(view.button('선택한 정보 적용').disabled, true, 'selectable does not mean writable');
  assert.match(find(view.root, node => node.className === 'selection-count').textContent, /선택 1개 · 적용할 변경 0개/);
  assert.match(find(view.root, node => node.className === 'action-note').textContent, /1개를 선택했지만/);
  const blockers = find(view.root, node => node.className === 'action-blockers');
  assert.equal(blockers.hidden, false);
  assert.match(blockers.textContent, /체크한 필드 없음 1/);
  assert.deepEqual(session.rows[1].fieldChoice, { title: false, date: false }, 'explaining a refusal does not choose fields');
});

test('beginner UI — review marks do not approve or select; a hidden writable selection remains included in apply', async () => {
  const { view, session, spies } = await reviewFixture();
  const first = view.rowNode('기존 1').children[0].children[0]; first.checked = true; first.onchange();
  const fieldChoices = structuredClone(session.rows.map(row => row.fieldChoice));
  const mark = view.rowNode('기존 2').children[1].children[0]; mark.checked = true; mark.onchange();
  assert.equal(session.rows[1].reportFlag, true);
  assert.equal(session.rows[1].checked, false);
  assert.deepEqual(session.rows.map(row => row.fieldChoice), fieldChoices);
  assert.match(mark.title, /적용할 항목을 선택하는 체크와는 별개/);
  view.button('나중에 볼 항목 1').onclick();
  assert.deepEqual(titles(view), ['기존 2']);
  assert.match(find(view.root, node => node.className === 'selection-count').textContent, /선택 1개 · 적용할 변경 1개 · 다른 보기에 1개 포함/);
  assert.equal(view.button('선택한 정보 적용').disabled, false);
  view.button('선택한 정보 적용').onclick(); await settle(); view.flushFrames();
  assert.match(view.confirms.at(-1).text, /1개 항목/);
  assert.equal(spies.get(1).currentFields.title, '새 제목 1', session.rows[0].error || view.message());
  assert.equal(spies.get(2).currentFields.title, '기존 2');
  assert.equal(session.rows[1].checked, false);
  assert.equal(session.rows[1].reportFlag, true);
});

test('beginner UI — detail names fields plainly and keeps candidate and technical explanations closed', async () => {
  const { view } = await reviewFixture();
  view.rowNode('기존 1').onclick();
  const names = findAll(view.detail(), node => node.className === 'field-name').map(node => node.textContent);
  assert.ok(names.includes('발행일'));
  assert.ok(!names.includes('발행일 (date)'));
  const technical = findAll(view.detail(), node => node.tagName === 'details');
  assert.ok(technical.length >= 2);
  assert.ok(technical.every(node => !node.open));
});

test('beginner UI — all-neutral and applied guidance avoids claiming a human reviewed checked rows; core destinations stay reachable', () => {
  const base = { items: 3, pending: 0, changes: 0, applied: 0, busy: false, operation: '' };
  assert.equal(presentation.beginnerGuide(base).heading, '지금 적용할 변경안이 없습니다');
  assert.match(presentation.beginnerGuide({ ...base, applied: 1 }).heading, /적용한 내용을 확인/);
  assert.equal(presentation.beginnerGuide({ ...base, changes: 1 }).step, 2);
  const mapped = presentation.friendlyActionCopy('아래 「마지막 적용」 줄과 「이번 적용 2」 칩, 「적용됨」·「이번 적용」 칩, 「설정과 도구」와 「선택 재검색」');
  assert.match(mapped, /펼친 「최근 적용 결과」의 내역/);
  assert.match(mapped, /상세 분류의 「이번 적용 2」/);
  assert.match(mapped, /「적용한 항목」/);
  assert.match(mapped, /「찾기 방법 및 설정」/);
  assert.doesNotMatch(mapped, /「적용됨」|「설정과 도구」|「선택 재검색」| 칩/);
});

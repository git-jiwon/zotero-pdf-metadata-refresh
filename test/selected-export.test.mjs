import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { moduleAt } from './helpers/load-module.mjs';

const { exportSelectedItems } = await moduleAt('src/ui/selected-export.ts');
const { RECOGNITION_PIPELINE_VERSION } = await moduleAt('src/batch/cache.ts');
const clone = value => JSON.parse(JSON.stringify(value));
const row = (id, values = {}) => ({ id, key: `SYNTHETIC-${id}`, libraryID: 1, title: `Fictional item ${id}`, status: 'ready', checked: false, changes: [], ...values });
const deepFreeze = value => {
  if (value && typeof value === 'object') { Object.freeze(value); for (const inner of Object.values(value)) deepFreeze(inner); }
  return value;
};
async function storage(locale = 'ko-KR') {
  const jobPath = path.join(await fs.mkdtemp(path.join(tmpdir(), 'zpmr-selected-report-')), 'new-job');
  const writes = [], directories = [];
  globalThis.Zotero = { locale };
  globalThis.PathUtils = { join: (...parts) => path.join(...parts) };
  globalThis.IOUtils = {
    makeDirectory: async (folder, options) => { directories.push({ folder, options }); await fs.mkdir(folder, { recursive: true }); },
    writeJSON: async (file, value, options) => {
      writes.push({ file, value: clone(value), options });
      await fs.writeFile(options.tmpPath, JSON.stringify(value)); await fs.rename(options.tmpPath, file);
    },
  };
  return { jobPath, writes, directories };
}

test('selected export saves the established report schema with every checked row, including hidden and unavailable PDFs', async () => {
  const io = await storage();
  const rows = [row(1, { checked: true, reportFlag: false }), row(2, { checked: true, status: 'noPDF' }),
    row(3, { checked: true, status: 'missingFile' }), row(4, { checked: true, status: 'multiplePDFs' }),
    row(5, { checked: true, status: 'failed' }), row(6, { checked: false, reportFlag: true }), row(7, { checked: 'true' })];
  // Only the first item is visible in this fictional view. Export receives the whole job.
  const visible = rows.slice(0, 1); assert.equal(visible.length, 1);
  const original = clone(rows); deepFreeze(rows);
  const result = await exportSelectedItems(rows, io.jobPath), report = JSON.parse(await fs.readFile(result.path, 'utf8'));
  assert.equal(result.rows, 5); assert.deepEqual(report.rows, original.slice(0, 5));
  assert.deepEqual(Object.keys(report).sort(), ['exportedAt', 'job', 'note', 'pipeline', 'rows', 'version']);
  assert.equal(report.version, 1); assert.equal(report.pipeline, RECOGNITION_PIPELINE_VERSION); assert.equal(report.job, io.jobPath);
  assert.ok(Number.isFinite(Date.parse(report.exportedAt))); assert.match(report.note, /^각 행의 evidence/);
  assert.equal(path.dirname(result.path), path.join(io.jobPath, 'reports')); assert.match(path.basename(result.path), /^report-\d+\.json$/);
  assert.deepEqual(io.directories, [{ folder: path.join(io.jobPath, 'reports'), options: { ignoreExisting: true, createAncestors: true } }]);
  assert.deepEqual(io.writes[0].options, { tmpPath: result.path + '.tmp' }); assert.equal(io.writes.length, 1);
  assert.deepEqual(await fs.readdir(io.jobPath), ['reports']); assert.deepEqual(rows, original);
});

test('export snapshots preserve choices, protections, approvals and legacy marks even while an asynchronous write waits', async () => {
  const io = await storage();
  const rows = [row(1, { checked: true, reportFlag: false, replaceMetadata: true,
    fieldChoice: { title: true, date: false }, fieldEdit: { title: '개인 원문 예시' },
    protections: { title: { value: '보호한 원문', rule: 'synthetic-rule' } },
    approvals: { date: { value: '2026', reason: 'synthetic-approval' } } })];
  const original = clone(rows); let continueDirectory;
  const makeDirectory = globalThis.IOUtils.makeDirectory;
  globalThis.IOUtils.makeDirectory = async (...args) => { await new Promise(resolve => { continueDirectory = resolve; }); await makeDirectory(...args); };
  const pending = exportSelectedItems(rows, io.jobPath);
  assert.deepEqual(rows, original);
  rows[0].checked = false; rows[0].reportFlag = true; rows[0].fieldEdit.title = '다음 편집';
  continueDirectory(); const result = await pending;
  assert.deepEqual(io.writes[0].value.rows, original); assert.equal(result.rows, 1);
  assert.equal(rows[0].checked, false); assert.equal(rows[0].reportFlag, true); assert.equal(rows[0].fieldEdit.title, '다음 편집');
});

test('English export translates generated guidance while raw titles, values and full layout JSON remain unchanged', async () => {
  const io = await storage('en-US');
  const title = '제목 · 승인됨 {0} 「PDF 정보 찾기」', text = '문'.repeat(20013), layout = JSON.stringify({ words: ['글'.repeat(25000)] });
  const rows = [row(1, { checked: true, title, before: { itemType: 'book', fields: { title, date: '발행일' }, creators: [] },
    evidence: { observations: [{ kind: 'pdfText', text }, { kind: 'pdfLayout', text: layout, extra: text }], note: text },
    coverProposal: { original: text, nested: [text] } })];
  const original = clone(rows); deepFreeze(rows);
  const result = await exportSelectedItems(rows, io.jobPath), report = JSON.parse(await fs.readFile(result.path, 'utf8'));
  assert.match(report.note, /^Each item/); assert.equal(report.rows[0].title, title); assert.equal(report.rows[0].before.fields.date, '발행일');
  const shortened = '문'.repeat(20000) + '…[13 characters omitted]';
  assert.equal(report.rows[0].evidence.observations[0].text, shortened);
  assert.equal(report.rows[0].evidence.observations[1].text, layout); assert.deepEqual(JSON.parse(report.rows[0].evidence.observations[1].text), JSON.parse(layout));
  assert.equal(report.rows[0].evidence.observations[1].extra, shortened);
  assert.equal(report.rows[0].coverProposal.original, shortened); assert.equal(report.rows[0].coverProposal.nested[0], shortened);
  assert.deepEqual(rows, original);
});

test('Korean export keeps the original generated omission marker and all uncut document text', async () => {
  const io = await storage('ko-KR'), prefix = '문'.repeat(20000), originalText = prefix + '원문';
  const rows = deepFreeze([row(1, { checked: true, evidence: { text: originalText }, title: 'characters omitted · 자 생략' })]);
  const result = await exportSelectedItems(rows, io.jobPath), report = JSON.parse(await fs.readFile(result.path, 'utf8'));
  assert.equal(report.rows[0].evidence.text, prefix + '…[2자 생략]');
  assert.equal(report.rows[0].title, 'characters omitted · 자 생략'); assert.match(report.note, /^각 행의 evidence/);
  assert.equal(rows[0].evidence.text, originalText);
});

test('empty selection fails before creating or saving anything, independently of legacy report flags', async () => {
  const io = await storage();
  const rows = deepFreeze([row(1, { reportFlag: true }), row(2, { status: 'noPDF' })]);
  await assert.rejects(exportSelectedItems(rows, io.jobPath), /파일로 내보낼 항목을 선택하세요/);
  assert.equal(io.writes.length, 0); assert.equal(io.directories.length, 0);
  await assert.rejects(fs.stat(io.jobPath), { code: 'ENOENT' });
});

test('a report write failure does not edit or save any job row or policy choice', async () => {
  const io = await storage();
  const rows = [row(1, { checked: true, reportFlag: false, fieldChoice: { title: false },
    protections: { title: { value: '보호한 제목' } }, approvals: { date: { reason: 'synthetic-approval' } } })];
  const original = clone(rows); deepFreeze(rows);
  globalThis.IOUtils.writeJSON = async () => { throw new Error('Synthetic report write failed'); };
  await assert.rejects(exportSelectedItems(rows, io.jobPath), /Synthetic report write failed/);
  assert.deepEqual(rows, original); assert.deepEqual(await fs.readdir(io.jobPath), ['reports']);
  assert.deepEqual(await fs.readdir(path.join(io.jobPath, 'reports')), []);
});

/**
 * One harness, shared by the synthetic policy tests.
 *
 * It runs a case the whole way down — page text, identifier scan, candidate,
 * judgement, write plan, and the write itself against an item that records what
 * was set — so that a test can say "this value reached the library" or "it did
 * not" rather than asserting on an intermediate verdict.
 *
 * The pages and candidates the tests hand it are written by hand. That makes
 * these POLICY tests: they show that the decision path works and that the
 * refusals fire. They are not a sample of anybody's library and they measure
 * neither PDF extraction nor candidate generation, so no accuracy figure may be
 * taken from them.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const scratch = mkdtempSync(path.join(tmpdir(), 'zpmr-harness-'));
export const moduleAt = async entry => {
  const file = path.join(scratch, `${path.basename(entry, '.ts')}-${Math.random().toString(36).slice(2, 8)}.mjs`);
  await build({ entryPoints: [entry], outfile: file, bundle: true, format: 'esm', platform: 'neutral',
    define: { __ADDON_VERSION__: '"test"' }, loader: { '.ps1': 'text' } });
  return import(pathToFileURL(file).href);
};

// ---------------------------------------------------------------- the host
export const FIELDS = ['title', 'abstractNote', 'publicationTitle', 'date', 'publisher', 'volume', 'issue',
  'pages', 'DOI', 'ISBN', 'language', 'university', 'thesisType', 'institution', 'reportNumber',
  'reportType', 'numPages', 'edition', 'place', 'url', 'accessDate', 'extra', 'libraryCatalog',
  'versionNumber', 'seriesNumber', 'archiveLocation', 'shortTitle'];
export const FIELD_ID = Object.fromEntries(FIELDS.map((name, index) => [name, index + 1]));
export const TYPE_ID = { document: 1, journalArticle: 2, thesis: 3, report: 4, book: 5, bookSection: 6, attachment: 14 };
export const TYPE_FIELDS = {
  document: ['title', 'shortTitle', 'abstractNote', 'date', 'publisher', 'language', 'url', 'accessDate', 'extra', 'libraryCatalog'],
  journalArticle: ['title', 'shortTitle', 'abstractNote', 'publicationTitle', 'date', 'volume', 'issue', 'pages', 'DOI', 'language', 'url', 'accessDate', 'extra', 'libraryCatalog'],
  thesis: ['title', 'shortTitle', 'abstractNote', 'date', 'university', 'thesisType', 'numPages', 'place', 'language', 'url', 'accessDate', 'extra', 'libraryCatalog'],
  report: ['title', 'shortTitle', 'abstractNote', 'date', 'institution', 'reportNumber', 'reportType', 'seriesNumber', 'versionNumber', 'place', 'language', 'url', 'accessDate', 'extra', 'libraryCatalog'],
  book: ['title', 'shortTitle', 'abstractNote', 'date', 'publisher', 'ISBN', 'numPages', 'edition', 'place', 'language', 'url', 'accessDate', 'extra', 'libraryCatalog'],
  bookSection: ['title', 'shortTitle', 'abstractNote', 'date', 'publisher', 'ISBN', 'pages', 'edition', 'place', 'language', 'url', 'accessDate', 'extra', 'libraryCatalog']
};
const NAME_FOR_TYPE = Object.fromEntries(Object.entries(TYPE_ID).map(([name, id]) => [id, name]));
const NAME_FOR_FIELD = Object.fromEntries(Object.entries(FIELD_ID).map(([name, id]) => [id, name]));

export const stat = { size: 12345, lastModified: 1700000000000 };

export function installHost() {
  globalThis.Zotero = {
    debug: () => {}, logError: () => {},
    ItemFields: {
      getID: name => FIELD_ID[name] || 0,
      getName: id => NAME_FOR_FIELD[id] || '',
      isValidForType: (fieldID, typeID) => (TYPE_FIELDS[NAME_FOR_TYPE[typeID]] || []).includes(NAME_FOR_FIELD[fieldID]),
      getItemTypeFields: typeID => (TYPE_FIELDS[NAME_FOR_TYPE[typeID]] || []).map(name => FIELD_ID[name])
    },
    ItemTypes: { getID: name => TYPE_ID[name] || 0, getName: id => NAME_FOR_TYPE[id] || 'document' },
    CreatorTypes: { getID: () => 1, isValidForItemType: () => true, getPrimaryIDForType: () => 1 },
    DB: { executeTransaction: async fn => fn() },
    Items: { get: () => null }
  };
  globalThis.IOUtils = { exists: async () => true, stat: async () => stat };
}

/** An item that records what was written to it, and nothing more. */
export function spyItem(snapshot) {
  const fields = { ...snapshot.fields };
  let typeID = TYPE_ID[snapshot.itemType];
  let creators = JSON.parse(JSON.stringify(snapshot.creators));
  const written = { fields: {}, creators: null, itemType: null, saves: 0 };
  const item = {
    id: 1, key: 'TARGET', libraryID: 1,
    get itemTypeID() { return typeID; },
    loadAllData: async () => {},
    getAttachments: () => [11],
    getNotes: () => [],
    getCollections: () => [],
    getTags: () => [],
    getRelations: () => ({}),
    getField: id => fields[NAME_FOR_FIELD[id]] ?? '',
    getCreators: () => JSON.parse(JSON.stringify(creators)),
    setType: id => { typeID = id; written.itemType = NAME_FOR_TYPE[id]; },
    setField: (id, value) => { const name = NAME_FOR_FIELD[id]; fields[name] = value; written.fields[name] = value; },
    setCreators: value => { creators = value; written.creators = value; },
    save: async () => { written.saves++; },
    isRegularItem: () => true
  };
  return { item, written, currentFields: fields };
}

export const attachment = { id: 11, key: 'ATT1', libraryID: 1, parentItemID: 1,
  getFilePath: async () => 'C:/store/ATT1/paper.pdf',
  loadAllData: async () => {}, getNotes: () => [], isFileAttachment: () => true, getAnnotations: () => [] };

export function snapshotOf(itemType, fields, creators = []) {
  return {
    itemID: 1, key: 'TARGET', itemTypeID: TYPE_ID[itemType], itemType,
    fields: { ...fields }, creators: JSON.parse(JSON.stringify(creators)),
    identity: { key: 'TARGET', libraryID: 1, collections: [], tags: [], relations: {},
      attachmentIDs: [11], attachmentKeys: ['ATT1'], attachmentPaths: ['C:/store/ATT1/paper.pdf'],
      noteIDs: [], annotationIDs: [] }
  };
}

/**
 * Build the runner once the modules are loaded.
 *
 * `pages` is a list of {text, role} — the page-level observations a real reader
 * would produce. A bare string is accepted and read as one unlabelled page, the
 * way the previous version worked.
 */
export function makeRunner(modules) {
  const { scanIdentifiers, evaluateRecognition, applyEvaluation, observation, pageObservations,
    recordApproval, buildWritePlan, writePlannedChanges, approvalScopeFor, POLICY } = modules;

  return async function run({ pages, page, candidate, before, identity, approve = [], selected, route = {} }) {
    const sheets = pages || [{ text: page, role: 'unknown' }];
    const joined = sheets.map(sheet => sheet.text).join('\n\f\n');
    const scan = scanIdentifiers({ text: joined, complete: false });
    const observations = pageObservations
      ? pageObservations('ATT1', sheets, { truncated: true })
      : [observation('pdfText', 'attachment:ATT1#pages1-3', joined, { truncated: true })];
    const evidence = { observations, identity };
    const row = {
      id: 1, key: 'TARGET', libraryID: 1, title: String(before.fields.title || ''),
      status: 'review', checked: true, changes: [], before,
      attachmentKey: 'ATT1',
      pdfFingerprint: JSON.stringify({ pipeline: POLICY, attachmentKey: 'ATT1', path: 'C:/store/ATT1/paper.pdf', size: stat.size, modified: stat.lastModified }),
      evidence,
      standalonePDF: before.itemType === 'attachment',
      technicalPDF: !!route.technicalPDF,
      authoritative: !!identity && identity.corroboration === 'printedInDocument'
    };
    const evaluation = evaluateRecognition({
      before, recognized: candidate,
      route: { verifiedPDF: false, patentPDF: false, technicalPDF: false,
        identifierPDF: !!identity, authoritative: row.authoritative,
        standalonePDF: row.standalonePDF, koreanAttempted: false, manualReview: false,
        recognitionSource: identity ? `PDF에 인쇄된 ${identity.kind} → Zotero 식별자 검색` : 'PDF 로컬 간행물 직접 분석',
        ...route },
      evidence, pdfFingerprint: row.pdfFingerprint, policyVersion: POLICY
    });
    applyEvaluation(row, evaluation, POLICY);

    const typeChange = row.changes.find(entry => entry.field === 'itemType');
    const targetType = typeChange ? String(typeChange.newValue) : before.itemType;
    for (const field of approve) {
      const proposal = row.changes.find(entry => entry.field === field);
      assert.ok(proposal, `nothing proposed for ${field}, so it cannot be approved`);
      recordApproval(row, proposal, approvalScopeFor(row, targetType, POLICY), 'accepted');
    }

    const fields = new Set(selected || row.changes.map(entry => entry.field));
    const plan = buildWritePlan(row, fields, POLICY, (_, entry) => entry);
    const spy = spyItem(before);
    globalThis.Zotero.Items = { get: id => (Array.isArray(id) ? [attachment] : id === 11 ? attachment : spy.item) };

    let error = null;
    if (plan.changes.length) {
      try { await writePlannedChanges(spy.item, row, plan, POLICY, async () => {}); }
      catch (cause) { error = String(cause); }
    }
    const levels = Object.fromEntries(Object.entries(row.verification).map(([field, record]) => [field, record.level]));
    const codes = Object.fromEntries(plan.refused.map(entry => [entry.field, entry.code]));
    const notes = Object.fromEntries(Object.entries(row.verification).map(([field, record]) => [field, record.note]));
    return { row, scan, plan, levels, codes, notes, written: spy.written, error, evaluation };
  };
}

/** Load everything the runner needs, with the host installed first. */
export async function loadPolicy() {
  installHost();
  const identifiers = await moduleAt('src/recognition/pdf-identifiers.ts');
  const evaluate = await moduleAt('src/batch/evaluate.ts');
  const evidence = await moduleAt('src/batch/evidence.ts');
  const approval = await moduleAt('src/batch/approval.ts');
  const service = await moduleAt('src/metadata/write-service.ts');
  const cache = await moduleAt('src/batch/cache.ts');
  return {
    ...identifiers, ...evaluate, ...evidence, ...approval, ...service,
    POLICY: cache.RECOGNITION_PIPELINE_VERSION
  };
}

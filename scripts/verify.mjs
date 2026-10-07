/**
 * Library audit, read-only.
 *
 * Every number names the set it was taken over. The same question asked of "the
 * library" has several different denominators — the rows this add-on cached, the
 * PDF attachments Zotero holds, the ones whose text could actually be read — and
 * mixing them is how a report ends up describing a library nobody has. Exclusive
 * sets are checked against their total before anything is printed; if they do
 * not add up, this exits non-zero rather than publishing a number.
 *
 *   npm run verify -- --data-dir "C:/Users/you/Zotero"
 *   npm run verify -- --json --output audit.json      # machine-readable, unmixed
 *   npm run verify -- --require-consistent            # fail unless the input froze
 *
 * Nothing here writes to the Zotero directory. The database is copied and the
 * copy window is checked for interference; see scripts/snapshot.mjs.
 */
import { build } from 'esbuild';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { acquireSnapshot } from './snapshot.mjs';

const args = process.argv.slice(2);
const flag = name => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const asJSON = args.includes('--json');
// A release comparison needs an input nobody could have written to. The marker
// check is evidence, not that guarantee, so this asks for a declared stopped copy.
const requireConsistent = args.includes('--require-consistent');
const outputPath = flag('output');
const dataDir = (flag('data-dir') || process.env.ZOTERO_DATA_DIR || '').replace(/\\/g, '/');

if (!dataDir) {
  console.error('Zotero data directory not given. Set ZOTERO_DATA_DIR or pass --data-dir <path>.');
  process.exit(2);
}
for (const required of ['zotero.sqlite', 'storage']) {
  if (!existsSync(path.join(dataDir, required))) {
    console.error(`Not a Zotero data directory (missing ${required}): ${dataDir}`);
    process.exit(2);
  }
}

const scratch = mkdtempSync(path.join(tmpdir(), 'zpmr-verify-'));
let db;
try {
  const moduleAt = async entry => {
    const file = path.join(scratch, `${path.basename(entry, '.ts')}.mjs`);
    await build({ entryPoints: [entry], outfile: file, bundle: true, format: 'esm', platform: 'neutral',
      define: { __ADDON_VERSION__: '"verify"' }, loader: { '.ps1': 'text' } });
    return import(pathToFileURL(file).href);
  };
  // Field validity is permissive here: this process has no Zotero schema, and the
  // only place it matters is a row whose item type is changing. Every count that
  // depends on it says so.
  globalThis.Zotero = {
    debug: () => {}, logError: () => {},
    ItemFields: { getID: name => (name ? 1 : 0), getName: () => '', isValidForType: () => true, getItemTypeFields: () => [] },
    ItemTypes: { getID: name => (name ? 1 : 0), getName: () => 'document' },
    CreatorTypes: { getID: () => 1, isValidForItemType: () => true, getPrimaryIDForType: () => 1 }
  };
  const { scanIdentifiers, titleSupportedByPDF } = await moduleAt('src/recognition/pdf-identifiers.ts');
  const { compareDOI, rawDOI } = await moduleAt('src/metadata/identifier-compare.ts');
  const { eligibility } = await moduleAt('src/batch/session.ts');

  // ------------------------------------------------------------- the snapshot
  const snapshot = acquireSnapshot(dataDir, scratch, { frozenInput: args.includes('--frozen-input') });
  if (!snapshot.usable) {
    console.error(snapshot.note);
    for (const entry of snapshot.attempts) console.error(`  attempt ${entry.attempt}: ${entry.outcome}${entry.detail ? ' — ' + entry.detail : ''}`);
    process.exit(3);
  }
  db = new DatabaseSync(snapshot.path, { readOnly: true });

  // -------------------------------------------------------------- populations
  //
  // "Attachment with a parent" is not the same as "a PDF this add-on can read".
  // Link-mode attachments point elsewhere, some rows carry no content type at
  // all, and a stored file can be missing from disk. Each of those is its own
  // state, because calling any of them "no text layer" would be a different
  // claim from the one the data supports.
  const attachmentRows = db.prepare(`
    SELECT att.key AS attachmentKey, att.libraryID AS libraryID, a.parentItemID AS parentItemID,
           a.contentType AS contentType, a.linkMode AS linkMode, a.path AS storedPath,
           (SELECT 1 FROM deletedItems WHERE itemID = att.itemID) AS deleted,
           (SELECT v.value FROM itemData d JOIN itemDataValues v ON v.valueID = d.valueID
              WHERE d.itemID = a.parentItemID AND d.fieldID = (SELECT fieldID FROM fields WHERE fieldName = 'title')) AS parentTitle,
           (SELECT v.value FROM itemData d JOIN itemDataValues v ON v.valueID = d.valueID
              WHERE d.itemID = a.parentItemID AND d.fieldID = (SELECT fieldID FROM fields WHERE fieldName = 'DOI')) AS parentDOI
      FROM itemAttachments a JOIN items att ON att.itemID = a.itemID`).all();

  const storage = path.join(dataDir, 'storage');
  const globalKey = row => `${row.libraryID}:${row.attachmentKey}`;

  const attachments = new Map();
  const attachmentStates = { pdfStored: 0, pdfLinked: 0, notPDF: 0, contentTypeUnknown: 0, deleted: 0, noParent: 0 };
  for (const row of attachmentRows) {
    if (row.deleted) { attachmentStates.deleted++; continue; }
    if (!row.parentItemID) { attachmentStates.noParent++; continue; }
    if (!row.contentType) { attachmentStates.contentTypeUnknown++; continue; }
    if (row.contentType !== 'application/pdf') { attachmentStates.notPDF++; continue; }
    // linkMode 2 and 3 are linked files/URLs in Zotero's schema; only a stored
    // file has a storage folder this audit can read.
    const stored = typeof row.storedPath === 'string' && row.storedPath.startsWith('storage:');
    if (!stored) { attachmentStates.pdfLinked++; continue; }
    attachmentStates.pdfStored++;
    attachments.set(globalKey(row), row);
  }

  // --------------------------------------------------------------- text cache
  //
  // Reading the cache can fail for reasons that are not the same fact. A missing
  // file, an empty one and an unreadable one were all being folded into "" and
  // then reported as "no text layer", which is a claim about the PDF rather than
  // about this add-on's ability to read a cache beside it.
  //
  // These files are read after the database snapshot was taken, so they belong to
  // a slightly later moment than the rows they are joined to. Nothing here can
  // freeze them together; the limit is reported rather than papered over.
  const textStates = { present: 0, missingCache: 0, emptyCache: 0, unreadableCache: 0 };
  const cacheTextFor = new Map();
  const textReadStartedAt = new Date().toISOString();
  for (const [key, row] of attachments) {
    const file = path.join(storage, row.attachmentKey, '.zotero-ft-cache');
    if (!existsSync(file)) { textStates.missingCache++; cacheTextFor.set(key, { state: 'missingCache', text: '' }); continue; }
    let text;
    try { text = readFileSync(file, 'utf8'); }
    catch { textStates.unreadableCache++; cacheTextFor.set(key, { state: 'unreadableCache', text: '' }); continue; }
    if (!text.trim()) { textStates.emptyCache++; cacheTextFor.set(key, { state: 'emptyCache', text: '' }); continue; }
    textStates.present++;
    cacheTextFor.set(key, { state: 'present', text });
  }
  const textReadEndedAt = new Date().toISOString();

  // ------------------------------------------------------------- cached rows
  const cacheDir = path.join(dataDir, 'pdf-metadata-refresh-cache');
  const cacheStates = { files: 0, parsed: 0, corrupt: 0, missingAttachmentKey: 0, duplicateAttachment: 0 };
  const corruptFiles = [];
  const rowsByAttachment = new Map();
  const orphanRows = [];
  if (existsSync(cacheDir)) {
    for (const name of readdirSync(cacheDir).filter(n => n.endsWith('.json'))) {
      cacheStates.files++;
      let row;
      try { row = JSON.parse(readFileSync(path.join(cacheDir, name), 'utf8')); }
      catch (cause) { cacheStates.corrupt++; corruptFiles.push({ file: name, reason: String(cause).slice(0, 80) }); continue; }
      cacheStates.parsed++;
      let attachmentKey = row.attachmentKey;
      if (!attachmentKey) {
        try { attachmentKey = JSON.parse(row.pdfFingerprint || '{}').attachmentKey; } catch { attachmentKey = undefined; }
      }
      if (!attachmentKey) { cacheStates.missingAttachmentKey++; orphanRows.push({ file: name }); continue; }
      const key = `${row.libraryID ?? 1}:${attachmentKey}`;
      if (rowsByAttachment.has(key)) {
        // Two entries for one attachment: keep the later save, count the other.
        cacheStates.duplicateAttachment++;
        const kept = rowsByAttachment.get(key);
        if ((row.savedAt || 0) <= (kept.savedAt || 0)) continue;
      }
      rowsByAttachment.set(key, { ...row, attachmentKey, globalKey: key, file: name });
    }
  }
  const cachedRows = [...rowsByAttachment.values()];

  // ------------------------------------------------------------------ report
  const report = {
    snapshot: {
      dataDir,
      startedAt: snapshot.startedAt, endedAt: snapshot.endedAt,
      walPresent: snapshot.walPresent,
      walBytesFolded: snapshot.walBytesFolded,
      checkpoint: snapshot.checkpoint,
      markerStable: snapshot.markerStable,
      acquisition: snapshot.acquisition,
      // bestEffort: the copy window looked quiet, which is evidence and not a
      // proof. frozenInput: the caller said the directory is a stopped copy.
      confidence: snapshot.confidence,
      integrity: snapshot.integrity,
      invariantFailures: snapshot.invariantFailures,
      attempts: snapshot.attempts.length,
      // Only a declared stopped input is approved as a release before/after
      // comparison. A best-effort read is for triage.
      usableAsComparisonInput: snapshot.confidence === 'frozenInput',
      note: snapshot.note,
      textCache: {
        startedAt: textReadStartedAt, endedAt: textReadEndedAt,
        note: 'The text caches and the add-on cache are files beside the database, read after it. They cannot be frozen with it, so a row whose PDF changed between the two reads is joined across two moments.'
      },
      pipelineVersion: readFileSync('src/batch/cache.ts', 'utf8').match(/RECOGNITION_PIPELINE_VERSION = '([^']+)'/)?.[1] ?? null
    },
    attachments: { totalRows: attachmentRows.length, ...attachmentStates, audited: attachments.size },
    text: textStates,
    cache: { ...cacheStates, unique: cachedRows.length, corruptFiles },
    decidedBy: {},
    identifiers: { doiOnly: 0, isbnOnly: 0, both: 0, neither: 0, noTextToRead: 0, multipleDOI: 0,
      observedTotal: 0, listTruncated: 0, heldAmbiguous: 0, repaired: 0 },
    identifierByDecider: {},
    identifierPrintedByDecider: {},
    titleSupport: { checked: 0, supported: 0, unsupported: 0, skippedNoText: 0, skippedNoTitle: 0, samples: [] },
    // Every row that prints anything DOI-shaped and whose parent holds a DOI.
    // Frozen: each one gets exactly one outcome and the outcomes sum to it.
    doi: { baseline: 0, resolved: 0, recovered: 0, heldAmbiguous: 0, boundaryAmbiguous: 0, differs: 0,
      printedButNoRecordDOI: 0, repairKinds: {}, transitions: [] },
    operations: null,
    rowStatus: {},
    consistency: []
  };

  const bump = (bucket, name) => { bucket[name] = (bucket[name] || 0) + 1; };

  for (const row of cachedRows) {
    // The display name is truncated; the bucket key is not, or two different
    // sources would merge into one line and the totals would stop adding up.
    const decider = row.recognitionSource || '(none)';
    bump(report.decidedBy, decider);

    const cached = cacheTextFor.get(row.globalKey);
    // The first 3,000 characters of Zotero's text cache. That is not "page one":
    // the cache is a linear extraction with no page boundaries in it, and its end
    // is this line's choice rather than the document's — which is why the scan is
    // told the text is incomplete.
    const head = cached?.text ? cached.text.slice(0, 3000) : '';
    if (!cached || cached.state !== 'present') report.identifiers.noTextToRead++;

    const scan = scanIdentifiers({ text: head, complete: false });
    report.identifiers.observedTotal += scan.observed;
    if (scan.listTruncated) report.identifiers.listTruncated++;
    const dois = scan.observations.filter(entry => entry.kind === 'DOI');
    const isbns = scan.observations.filter(entry => entry.kind === 'ISBN');
    const usableDOIs = dois.filter(entry => entry.confidence !== 'ambiguous');
    if (dois.some(entry => entry.confidence === 'ambiguous')) report.identifiers.heldAmbiguous++;
    if (dois.some(entry => entry.confidence === 'repaired')) report.identifiers.repaired++;
    if (dois.length > 1) report.identifiers.multipleDOI++;
    if (dois.length && isbns.length) report.identifiers.both++;
    else if (dois.length) report.identifiers.doiOnly++;
    else if (isbns.length) report.identifiers.isbnOnly++;
    else { report.identifiers.neither++; bump(report.identifierByDecider, decider); }
    if (dois.length || isbns.length) bump(report.identifierPrintedByDecider, decider);

    const attachment = attachments.get(row.globalKey);
    if (!dois.length) continue;
    if (!attachment?.parentDOI) { report.doi.printedButNoRecordDOI++; continue; }

    // ------------------------------------------------------ one row, one outcome
    report.doi.baseline++;
    const record = rawDOI(attachment.parentDOI);
    const verdicts = usableDOIs.map(entry => ({ entry, agreement: compareDOI(entry.value, record) }));
    const agreeing = verdicts.filter(item => item.agreement === 'exact');
    let outcome;
    if (!usableDOIs.length) outcome = 'heldAmbiguous';
    else if (agreeing.length) {
      // Trimming a sentence's full stop is tokenisation, not repair: every
      // version of this reader has done it and nothing about it was in dispute.
      // Recovery means the agreement exists ONLY because something was
      // reconstructed — a typeset en dash turned back into a hyphen, a wrapped
      // DOI rejoined, a DOI built from a running head. Counting the first as the
      // second lets a routine strip read as a fix.
      outcome = agreeing.every(item => item.entry.repairs.some(repair => repair.kind !== 'trailingPunctuation'))
        ? 'recovered' : 'resolved';
      for (const item of agreeing) {
        for (const repair of item.entry.repairs) bump(report.doi.repairKinds, repair.kind);
      }
    }
    else if (verdicts.some(item => item.agreement === 'ambiguous')) outcome = 'boundaryAmbiguous';
    else outcome = 'differs';
    report.doi[outcome]++;

    if (outcome !== 'resolved' && report.doi.transitions.length < 80) {
      report.doi.transitions.push({
        attachmentKey: row.attachmentKey, libraryID: attachment.libraryID, outcome, decider,
        inRecord: record,
        candidates: dois.map(entry => ({
          raw: entry.raw, value: entry.value, confidence: entry.confidence,
          boundary: entry.boundary, reason: entry.reason,
          repairs: entry.repairs.map(repair => repair.kind),
          agreement: entry.confidence === 'ambiguous' ? 'notCompared' : compareDOI(entry.value, record)
        }))
      });
    }

    bump(report.rowStatus, row.status || '(no status recorded)');
  }
  // rowStatus has to cover every cached row, not only the ones that reached the
  // DOI comparison; the `continue` above would have skipped the rest.
  report.rowStatus = {};
  for (const row of cachedRows) bump(report.rowStatus, row.status || '(no status recorded)');

  for (const [key, attachment] of attachments) {
    if (!attachment.parentTitle) { report.titleSupport.skippedNoTitle++; continue; }
    const cached = cacheTextFor.get(key);
    if (!cached || cached.state !== 'present') { report.titleSupport.skippedNoText++; continue; }
    report.titleSupport.checked++;
    // The first 20,000 characters of the cache, not the whole document.
    if (titleSupportedByPDF(attachment.parentTitle, cached.text.slice(0, 20000))) report.titleSupport.supported++;
    else {
      report.titleSupport.unsupported++;
      if (report.titleSupport.samples.length < 20) {
        report.titleSupport.samples.push({ attachmentKey: attachment.attachmentKey, libraryID: attachment.libraryID, title: String(attachment.parentTitle).slice(0, 70) });
      }
    }
  }

  // ------------------------------------------------------- operational metrics
  //
  // Not bibliographic accuracy: there is no answer key, so nothing here says how
  // often the add-on is right. What it does say is how much of the library is in
  // a state where a write is permitted, and why the rest is not — which is
  // measurable today and is what the policy change was about.
  const jobsDir = path.join(dataDir, 'pdf-metadata-refresh-jobs');
  if (existsSync(jobsDir)) {
    const jobs = readdirSync(jobsDir).filter(name => /^\d+$/.test(name)).sort();
    const latest = jobs[jobs.length - 1];
    if (latest) {
      const jobPath = path.join(jobsDir, latest);
      const operations = {
        job: latest, rows: 0, withProposals: 0,
        proposedFields: 0, verifiedFields: 0, approvedFields: 0, protectedFields: 0,
        // As the rows stand, and again with every field selected. The first is
        // what would happen on an apply right now; the second isolates the policy
        // from the selection, so "nothing is writable" can be read as either
        // "nobody has chosen anything yet" or "the evidence does not support it".
        writableFields: 0, writableRecords: 0,
        writableIfAllSelected: 0, writableRecordsIfAllSelected: 0,
        legacyVerificationRecords: 0,
        heldBy: {}, byStatus: {},
        note: 'Field validity is not checked here (no Zotero schema in this process), so a row whose item type is changing may be counted more permissively than the add-on would.'
      };
      for (const name of readdirSync(jobPath).filter(n => /^\d+\.json$/.test(n))) {
        let row;
        try { row = JSON.parse(readFileSync(path.join(jobPath, name), 'utf8')); }
        catch { continue; }
        operations.rows++;
        bump(operations.byStatus, row.status || '(none)');
        const changes = Array.isArray(row.changes) ? row.changes : [];
        if (!changes.length) continue;
        operations.withProposals++;
        operations.proposedFields += changes.length;
        for (const [, record] of Object.entries(row.verification || {})) {
          if (typeof record === 'string') { operations.legacyVerificationRecords++; continue; }
          if (record?.level === 'verified') operations.verifiedFields++;
        }
        operations.approvedFields += Object.keys(row.approvals || {}).length;
        operations.protectedFields += Object.keys(row.protections || {}).length;
        // The real policy, asked the real question, with every field selected.
        const fields = new Set(changes.map(change => change.field));
        const verdicts = eligibility(row, fields);
        const writable = verdicts.filter(entry => entry.eligible);
        operations.writableFields += writable.length;
        if (writable.length) operations.writableRecords++;
        for (const entry of verdicts.filter(entry => !entry.eligible)) bump(operations.heldBy, entry.code);

        const everything = eligibility({ ...row, fieldChoice: undefined }, fields).filter(entry => entry.eligible);
        operations.writableIfAllSelected += everything.length;
        if (everything.length) operations.writableRecordsIfAllSelected++;
      }
      report.operations = operations;
    }
  }

  // ------------------------------------------------------- consistency checks
  //
  // A total that does not add up is a bug in the audit, and an audit that
  // publishes one is worse than no audit.
  const check = (label, parts, total) => {
    const sum = parts.reduce((a, b) => a + b, 0);
    if (sum !== total) report.consistency.push({ label, sum, total, difference: sum - total });
  };
  check('attachment states vs rows',
    [attachmentStates.pdfStored, attachmentStates.pdfLinked, attachmentStates.notPDF,
      attachmentStates.contentTypeUnknown, attachmentStates.deleted, attachmentStates.noParent], attachmentRows.length);
  check('text states vs audited attachments',
    [textStates.present, textStates.missingCache, textStates.emptyCache, textStates.unreadableCache], attachments.size);
  check('identifier sets vs cached rows',
    [report.identifiers.doiOnly, report.identifiers.isbnOnly, report.identifiers.both, report.identifiers.neither], cachedRows.length);
  check('decidedBy vs cached rows', Object.values(report.decidedBy), cachedRows.length);
  check('printed + not printed vs cached rows',
    [Object.values(report.identifierPrintedByDecider).reduce((a, b) => a + b, 0),
      Object.values(report.identifierByDecider).reduce((a, b) => a + b, 0)], cachedRows.length);
  check('title support vs audited attachments',
    [report.titleSupport.supported, report.titleSupport.unsupported,
      report.titleSupport.skippedNoText, report.titleSupport.skippedNoTitle], attachments.size);
  // The frozen set: every baseline row lands in exactly one outcome, so a bug
  // that quietly drops rows cannot read as an improvement.
  check('doi outcomes vs baseline',
    [report.doi.resolved, report.doi.recovered, report.doi.heldAmbiguous,
      report.doi.boundaryAmbiguous, report.doi.differs], report.doi.baseline);
  check('rows printing a DOI vs baseline plus rows whose record has none',
    [report.doi.baseline, report.doi.printedButNoRecordDOI],
    report.identifiers.doiOnly + report.identifiers.both);

  if (asJSON || outputPath) {
    const text = JSON.stringify(report, null, 1);
    if (outputPath) { writeFileSync(outputPath, text, 'utf8'); console.error(`written: ${outputPath}`); }
    else console.log(text);
    if (report.consistency.length) process.exitCode = 1;
    if (requireConsistent && !(snapshot.confidence === 'frozenInput')) process.exitCode = 1;
  } else {
    const pct = (part, whole) => whole ? `${(part / whole * 100).toFixed(1)}%` : '—';
    const top = (object, limit = 8) => {
      const entries = Object.entries(object).sort((a, b) => b[1] - a[1]);
      const shown = entries.slice(0, limit);
      const rest = entries.slice(limit).reduce((sum, [, count]) => sum + count, 0);
      return rest ? [...shown, [`(other, ${entries.length - limit} sources)`, rest]] : shown;
    };

    console.log(`snapshot ${snapshot.startedAt} → ${snapshot.endedAt} · WAL ${snapshot.walPresent ? `${snapshot.walBytesFolded} bytes folded in` : 'absent'}`);
    console.log(`  acquisition ${snapshot.acquisition} after ${snapshot.attempts.length} attempt(s) · confidence ${snapshot.confidence} · integrity ${snapshot.integrity} · invariants ${snapshot.invariantFailures.length ? 'FAILED' : 'ok (selected relations only)'}`);
    console.log(`  approved as a release before/after comparison input: ${report.snapshot.usableAsComparisonInput ? 'yes (declared stopped input)' : 'NO — best-effort read; pass --frozen-input over a copy taken with Zotero closed'}`);
    for (const failure of snapshot.invariantFailures) console.log(`    invariant: ${failure.name} — ${failure.detail}`);
    console.log(`pipeline ${report.snapshot.pipelineVersion}`);
    console.log('\n[attachments]  set: every attachment row in the database');
    console.log(`  ${String(attachmentRows.length).padStart(5)}  rows · audited ${attachments.size} stored PDFs with a parent`);
    console.log(`         linked PDFs ${attachmentStates.pdfLinked} · not PDF ${attachmentStates.notPDF} · content type unknown ${attachmentStates.contentTypeUnknown} · deleted ${attachmentStates.deleted} · no parent ${attachmentStates.noParent}`);
    console.log('\n[text cache]  set: audited stored PDFs');
    console.log(`  ${String(textStates.present).padStart(5)}  readable · missing ${textStates.missingCache} · empty ${textStates.emptyCache} · unreadable ${textStates.unreadableCache}`);
    console.log('         (a missing or empty cache is not the same claim as "the PDF has no text layer")');
    console.log('\n[add-on cache]  set: files in pdf-metadata-refresh-cache');
    console.log(`  ${String(cacheStates.files).padStart(5)}  files · parsed ${cacheStates.parsed} · corrupt ${cacheStates.corrupt} · no attachment key ${cacheStates.missingAttachmentKey} · duplicate attachment ${cacheStates.duplicateAttachment} · unique rows ${cachedRows.length}`);
    for (const entry of corruptFiles.slice(0, 5)) console.log(`         corrupt: ${entry.file} — ${entry.reason}`);

    console.log('\n[decided by]  set: unique cached rows');
    for (const [name, count] of top(report.decidedBy)) console.log(`  ${String(count).padStart(5)}  ${pct(count, cachedRows.length).padStart(6)}  ${name.slice(0, 60)}`);

    console.log('\n[identifiers read from the first 3,000 characters of the text cache]  set: unique cached rows');
    console.log(`  ${String(report.identifiers.doiOnly).padStart(5)}  DOI only · ISBN only ${report.identifiers.isbnOnly} · both ${report.identifiers.both} · neither ${report.identifiers.neither}`);
    console.log(`         more than one DOI printed: ${report.identifiers.multipleDOI} · no readable text: ${report.identifiers.noTextToRead}`);
    console.log(`         readings observed in total: ${report.identifiers.observedTotal} · rows whose reading list hit the cap: ${report.identifiers.listTruncated}`);
    console.log(`         rows holding an uncertain reading: ${report.identifiers.heldAmbiguous} · rows with a repaired reading: ${report.identifiers.repaired}`);

    console.log('\n[prints an identifier, by who decides it today]  set: rows with an identifier');
    for (const [name, count] of top(report.identifierPrintedByDecider, 10)) console.log(`  ${String(count).padStart(5)}  ${name.slice(0, 62)}`);
    console.log('         (who would decide it after the reordering is an ESTIMATE from the recorded source; no lookup was made)');

    console.log('\n[stored title found in the first 20,000 characters of the cache]  set: audited stored PDFs');
    console.log(`  ${String(report.titleSupport.supported).padStart(5)}  ${pct(report.titleSupport.supported, report.titleSupport.checked).padStart(6)}  of ${report.titleSupport.checked} checked · not found ${report.titleSupport.unsupported} · skipped ${report.titleSupport.skippedNoText + report.titleSupport.skippedNoTitle}`);
    console.log('         (a title string appearing in the text; it says nothing about authors, volume, edition)');

    console.log('\n[printed DOI vs stored DOI]  frozen set: rows printing anything DOI-shaped whose parent holds a DOI');
    console.log(`  ${String(report.doi.baseline).padStart(5)}  baseline`);
    console.log(`         resolved ${report.doi.resolved} (sentence punctuation trimmed where needed) · recovered by reconstruction ${report.doi.recovered} · held as uncertain ${report.doi.heldAmbiguous} · boundary ambiguous ${report.doi.boundaryAmbiguous} · differs ${report.doi.differs}`);
    console.log(`         (rows printing a DOI whose parent holds none, outside the baseline: ${report.doi.printedButNoRecordDOI})`);
    const repairs = Object.entries(report.doi.repairKinds).map(([kind, count]) => `${kind} ${count}`).join(' · ');
    console.log(`         repairs applied to the readings that agreed: ${repairs || 'none'}`);
    for (const entry of report.doi.transitions) {
      console.log(`        ${entry.libraryID}:${entry.attachmentKey}  ${entry.outcome}  record ${entry.inRecord}`);
      for (const candidate of entry.candidates) {
        console.log(`            raw "${candidate.raw}" → ${candidate.value} · ${candidate.confidence}/${candidate.boundary}${candidate.repairs.length ? ` [${candidate.repairs.join(',')}]` : ''} · ${candidate.agreement}`);
      }
    }
    console.log('         string agreement only — that an identifier names THIS document is not established here');

    if (report.operations) {
      const ops = report.operations;
      console.log(`\n[what the write policy permits right now]  set: saved job ${ops.job}, ${ops.rows} rows`);
      console.log(`  ${String(ops.writableFields).padStart(5)}  fields writable as the rows stand, across ${ops.writableRecords} records · of ${ops.proposedFields} proposed on ${ops.withProposals} records`);
      console.log(`         with every field selected: ${ops.writableIfAllSelected} fields across ${ops.writableRecordsIfAllSelected} records — the policy's answer, with the selection taken out of it`);
      console.log(`         verified ${ops.verifiedFields} · approved ${ops.approvedFields} · protected ${ops.protectedFields} · legacy verification records demoted ${ops.legacyVerificationRecords}`);
      for (const [code, count] of top(ops.heldBy, 10)) console.log(`         held — ${code}: ${count}`);
      console.log(`         ${ops.note}`);
      console.log('         this is not bibliographic accuracy: there is no answer key here');
    }
    else console.log('\n[what the write policy permits right now]  NOT MEASURED — no saved job directory in this data directory');

    console.log('\n[row status as recorded in the cache]  set: unique cached rows');
    for (const [name, count] of top(report.rowStatus)) console.log(`  ${String(count).padStart(5)}  ${name}`);

    if (report.consistency.length) {
      console.log('\n[CONSISTENCY FAILURES]');
      for (const entry of report.consistency) console.log(`  ${entry.label}: parts sum to ${entry.sum}, total is ${entry.total} (difference ${entry.difference})`);
      process.exitCode = 1;
    } else {
      console.log('\nconsistency: every exclusive set adds up to its total');
    }
    if (requireConsistent && !(snapshot.confidence === 'frozenInput')) {
      console.log('\n--require-consistent was given and the input did not freeze.');
      process.exitCode = 1;
    }
  }
}
finally {
  try { db?.close(); } catch { /* already closed */ }
  try { rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ }
}

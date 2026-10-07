import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readSync, rmSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Reading a database somebody else may be writing, and saying honestly how good
 * the reading is.
 *
 * WHAT THIS DOES. It copies zotero.sqlite and its WAL, reads a few header
 * fields before and after the copy, and folds the WAL into the copy so the audit
 * reads one file. Nothing here opens the source database: opening a WAL database
 * read-only can require rebuilding its shared-memory index, and that would be a
 * write to the Zotero directory.
 *
 * WHAT THIS IS NOT. The before/after comparison is a heuristic. It reads the
 * database header's change counter, the WAL's salt and the WAL's last frame
 * bytes, and those moving is strong evidence that something happened — but them
 * not moving is not a proof that nothing did. SQLite's own guarantees come from
 * a consistent read inside a transaction or from the backup API, neither of
 * which is available without opening the source. An earlier version of this file
 * said the check "proves" the window was quiet. It does not, and the wording is
 * corrected here: an acquisition made this way is `bestEffort`, and only an
 * input the caller declares stopped is `frozenInput`.
 *
 * The failure handling matters as much as the check. A checkpoint that fails or
 * finds the copy busy leaves data in the WAL; deleting the WAL afterwards and
 * reading the main file would turn that loss into a clean-looking result. So a
 * failed attempt is a failed attempt: its directory is abandoned, the next
 * attempt copies into a fresh one, and if none succeeds the caller is handed
 * `usable: false` rather than a database.
 *
 * https://www.sqlite.org/wal.html · https://www.sqlite.org/backup.html
 */

function readAt(file, offset, length) {
  const handle = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const read = readSync(handle, buffer, 0, length, offset);
    return buffer.subarray(0, read);
  }
  finally { closeSync(handle); }
}

/**
 * The header fields that move when anything happens to the database.
 *
 * `changeCounter` (offset 24) increments on every write transaction — but only
 * when the main file is written, which in WAL mode means at a checkpoint. The
 * WAL salts (offset 16) change whenever a checkpoint resets the WAL, and the
 * WAL's last frame changes on every commit, including one that rewrites a frame
 * in place without the file growing. All three are read because each misses a
 * different case on its own.
 */
export function readMarkers(dataDir) {
  const dbPath = path.join(dataDir, 'zotero.sqlite');
  const header = readAt(dbPath, 0, 100);
  const walPath = `${dbPath}-wal`;
  const walPresent = existsSync(walPath);
  let walSalt = null, walSize = 0, walMtimeMs = 0, walTail = null;
  if (walPresent) {
    const walStat = statSync(walPath);
    walSize = walStat.size;
    walMtimeMs = walStat.mtimeMs;
    if (walSize >= 32) walSalt = readAt(walPath, 16, 8).toString('hex');
    if (walSize >= 56) walTail = readAt(walPath, walSize - 24, 24).toString('hex');
  }
  const dbStat = statSync(dbPath);
  return {
    changeCounter: header.readUInt32BE(24),
    pageCount: header.readUInt32BE(28),
    versionValidFor: header.readUInt32BE(92),
    dbSize: dbStat.size,
    dbMtimeMs: dbStat.mtimeMs,
    walPresent, walSalt, walSize, walMtimeMs, walTail
  };
}

export function markersMatch(before, after) {
  return before.changeCounter === after.changeCounter
    && before.versionValidFor === after.versionValidFor
    && before.pageCount === after.pageCount
    && before.dbSize === after.dbSize
    && before.dbMtimeMs === after.dbMtimeMs
    && before.walPresent === after.walPresent
    && before.walSalt === after.walSalt
    && before.walSize === after.walSize
    && before.walMtimeMs === after.walMtimeMs
    && before.walTail === after.walTail;
}

/**
 * Relations the schema guarantees and a torn copy would break.
 *
 * `PRAGMA quick_check` verifies that the file is a well-formed database, which a
 * half-copied one can still be: pages that are individually valid can describe
 * rows whose partners were never copied. These are application-level statements,
 * which is the level a torn read actually shows up at. They are a SELECTED set,
 * not a complete one — passing them is evidence, not a guarantee.
 */
export const INVARIANTS = [
  { name: 'every attachment row has an item', sql: 'SELECT COUNT(*) AS n FROM itemAttachments a LEFT JOIN items i ON i.itemID = a.itemID WHERE i.itemID IS NULL' },
  { name: 'every attachment parent exists', sql: 'SELECT COUNT(*) AS n FROM itemAttachments a WHERE a.parentItemID IS NOT NULL AND NOT EXISTS (SELECT 1 FROM items i WHERE i.itemID = a.parentItemID)' },
  { name: 'every field value row has an item', sql: 'SELECT COUNT(*) AS n FROM itemData d LEFT JOIN items i ON i.itemID = d.itemID WHERE i.itemID IS NULL' },
  { name: 'every field value resolves', sql: 'SELECT COUNT(*) AS n FROM itemData d LEFT JOIN itemDataValues v ON v.valueID = d.valueID WHERE v.valueID IS NULL' },
  { name: 'every creator row has an item', sql: 'SELECT COUNT(*) AS n FROM itemCreators c LEFT JOIN items i ON i.itemID = c.itemID WHERE i.itemID IS NULL' },
  { name: 'every deleted marker has an item', sql: 'SELECT COUNT(*) AS n FROM deletedItems d LEFT JOIN items i ON i.itemID = d.itemID WHERE i.itemID IS NULL' }
];

export function checkInvariants(db) {
  const failures = [];
  let integrity = 'not run';
  try { integrity = String(db.prepare('PRAGMA quick_check').get()?.quick_check ?? 'unknown'); }
  catch (cause) { integrity = `failed: ${String(cause).slice(0, 80)}`; }
  if (integrity !== 'ok') failures.push({ name: 'quick_check', detail: integrity });
  for (const invariant of INVARIANTS) {
    try {
      const orphans = Number(db.prepare(invariant.sql).get()?.n ?? 0);
      if (orphans) failures.push({ name: invariant.name, detail: `${orphans} orphan row(s)` });
    }
    catch (cause) { failures.push({ name: invariant.name, detail: `query failed: ${String(cause).slice(0, 80)}` }); }
  }
  return { integrity, failures };
}

/**
 * Fold the copied WAL into the copied database.
 *
 * On the copy, never on the original. The shared-memory index is removed first
 * because a stale one describes a WAL this copy may no longer have; it holds no
 * data and SQLite rebuilds it. Every way this can fail returns a reason, and a
 * reason means the attempt is abandoned rather than cleaned up into a success.
 */
function foldWAL(target) {
  const shm = `${target}-shm`;
  if (existsSync(shm)) unlinkSync(shm);
  const wal = `${target}-wal`;
  if (!existsSync(wal)) return { checkpoint: 'notNeeded', walBytesFolded: 0, error: null };
  const walBytesFolded = statSync(wal).size;
  let writable;
  try {
    writable = new DatabaseSync(target);
    const result = writable.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    if (Number(result?.busy ?? 0) !== 0) {
      return { checkpoint: 'busy', walBytesFolded, error: 'the copy was busy, so the WAL was not fully folded in' };
    }
    // Out of WAL mode as well, so the audit reads one file rather than a file
    // plus a journal a later reader would have to interpret.
    const mode = writable.prepare('PRAGMA journal_mode=DELETE').get();
    const journal = String(mode?.journal_mode ?? '').toLowerCase();
    if (journal !== 'delete') {
      return { checkpoint: 'journalModeRefused', walBytesFolded, error: `journal mode stayed ${journal || 'unknown'}` };
    }
    return { checkpoint: 'folded', walBytesFolded, error: null };
  }
  catch (cause) {
    return { checkpoint: 'failed', walBytesFolded, error: String(cause).slice(0, 120) };
  }
  finally { try { writable?.close(); } catch { /* already closed */ } }
}

/**
 * @param copy        seam for the test that has to commit inside the copy window.
 * @param frozenInput the caller asserts the directory is a stopped copy, so the
 *                    marker heuristic is not what the confidence rests on.
 */
export function acquireSnapshot(dataDir, scratch, { attempts = 4, label = 'zotero.sqlite', copy = copyFileSync, frozenInput = false } = {}) {
  const source = path.join(dataDir, 'zotero.sqlite');
  const tried = [];

  for (let attempt = 1; attempt <= attempts; attempt++) {
    // A fresh directory per attempt: a leftover WAL from a failed attempt must
    // never be able to pair itself with a later database copy.
    const home = path.join(scratch, `acquire-${attempt}`);
    rmSync(home, { recursive: true, force: true });
    mkdirSync(home, { recursive: true });
    const target = path.join(home, label);

    const before = readMarkers(dataDir);
    const startedAt = new Date().toISOString();
    copy(source, target);
    if (before.walPresent && existsSync(`${source}-wal`)) copy(`${source}-wal`, `${target}-wal`);
    if (existsSync(`${source}-shm`)) copy(`${source}-shm`, `${target}-shm`);
    const endedAt = new Date().toISOString();
    const after = readMarkers(dataDir);
    const markerStable = markersMatch(before, after);

    const record = { attempt, startedAt, endedAt, markerStable, outcome: 'markerDisturbed', detail: null };
    if (!markerStable) { tried.push(record); continue; }

    const folded = foldWAL(target);
    if (folded.error) {
      record.outcome = 'checkpointFailed';
      record.detail = `${folded.checkpoint}: ${folded.error}`;
      tried.push(record);
      continue;
    }

    let integrity = 'not run', failures = [];
    let db;
    try {
      db = new DatabaseSync(target, { readOnly: true });
      ({ integrity, failures } = checkInvariants(db));
    }
    catch (cause) {
      record.outcome = 'unreadable';
      record.detail = String(cause).slice(0, 120);
      tried.push(record);
      continue;
    }
    finally { try { db?.close(); } catch { /* already closed */ } }

    if (failures.length) {
      record.outcome = 'invariantsFailed';
      record.detail = failures.map(entry => entry.name).join(', ');
      tried.push(record);
      continue;
    }

    record.outcome = 'acquired';
    tried.push(record);
    return {
      usable: true,
      path: target,
      confidence: frozenInput ? 'frozenInput' : 'bestEffort',
      acquisition: 'markerStable',
      markerStable: true,
      integrity,
      invariantFailures: [],
      attempts: tried,
      walPresent: before.walPresent,
      walBytesFolded: folded.walBytesFolded,
      checkpoint: folded.checkpoint,
      startedAt, endedAt,
      note: frozenInput
        ? 'The caller declared this directory a stopped copy, so nothing could have written to it during the read.'
        : 'The database header, the WAL salt and the WAL tail were unchanged across the copy. That is evidence no commit or checkpoint intervened, not a proof: SQLite guarantees a consistent read only inside a transaction or through the backup API, neither of which is reachable without opening the live database. Treat this as a best-effort acquisition.'
    };
  }

  const reasons = [...new Set(tried.map(entry => entry.outcome))].join(', ');
  return {
    usable: false,
    path: null,
    confidence: 'none',
    acquisition: tried[tried.length - 1]?.outcome ?? 'markerDisturbed',
    markerStable: false,
    integrity: 'not run',
    invariantFailures: [],
    attempts: tried,
    walPresent: false,
    walBytesFolded: 0,
    checkpoint: 'notAttempted',
    startedAt: tried[0]?.startedAt ?? null,
    endedAt: tried[tried.length - 1]?.endedAt ?? null,
    note: `No attempt produced a usable copy after ${attempts} tries (${reasons}). This is not a best-effort reading — nothing is returned. Close Zotero and point --data-dir at the directory for a frozen input.`
  };
}

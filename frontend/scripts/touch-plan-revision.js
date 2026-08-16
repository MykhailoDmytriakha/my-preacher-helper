/**
 * ADVANCE `rev.plan` ON SERMONS THE PLAN-TEXT MIGRATION ALREADY MOVED.
 *
 * WHY THIS EXISTS. `migrate-plan-text.js` copied every sermon's plan text into
 * `planText.<nodeId>` and touched nothing else — no `rev`, no `updatedAt`. It changed stored
 * content while leaving the version evidence exactly as it was, which is the one thing
 * `conflictSafeUpdate` says no writer may ever do (see `revisionBump`'s comment: a counter
 * that does not move makes a later stale save look current).
 *
 * WHAT IT BREAKS. `serverCopyIsNewer` cannot prove the migrated server copy beats a cache
 * snapshotted before the move, so the stale copy keeps winning. The screen still LOOKS right,
 * because `readPlanText` merges the legacy cells on read. Only the write layer notices: the
 * baseline is taken from the raw `planText`, finds nothing there, and the guard then refuses a
 * perfectly legitimate save against text that really is on the server — for ever, with no way
 * out but evicting the cache. Locked in by
 * `__tests__/utils/readFreshness.test.ts` → "keeps the cached copy when a storage migration
 * adds a field without advancing evidence".
 *
 * WHY ONLY `rev.plan`, AND NOT `updatedAt`. Once both sides carry `rev`, the comparison is
 * decided by the counters alone, so the counter is enough. `updatedAt` is what the lists sort
 * by, and rewriting it on 54 sermons at once would tell the owner that everything he has ever
 * written was edited today. Changing the least that fixes it.
 *
 * IDEMPOTENT BY CONSEQUENCE, NOT BY CHECK. Running it twice advances the counter twice, which
 * is harmless — the counter only ever needs to be HIGHER than any copy predating the move.
 *
 * USAGE
 *   node scripts/touch-plan-revision.js            # dry run: report only, writes nothing
 *   node scripts/touch-plan-revision.js --apply    # perform the writes
 */

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const file = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split('\n').forEach((line) => {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  });
}

async function main() {
  loadEnv();
  const apply = process.argv.includes('--apply');

  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({
      credential: cert(
        JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString())
      ),
    });
  }
  const db = getFirestore();

  const snapshot = await db.collection('sermons').get();
  const targets = [];
  snapshot.forEach((doc) => {
    const sermon = doc.data();
    // Only sermons the migration actually moved: a document with no `planText` was never
    // given content without evidence, so there is nothing to correct.
    if (Object.keys(sermon.planText || {}).length === 0) return;
    targets.push({ id: doc.id, before: (sermon.rev || {}).plan || 0 });
  });

  console.log(`sermons: ${snapshot.size}, carrying planText: ${targets.length}`);
  if (!apply) {
    targets.slice(0, 5).forEach((t) => console.log(`  would advance ${t.id}: rev.plan ${t.before} -> ${t.before + 1}`));
    if (targets.length > 5) console.log(`  ... and ${targets.length - 5} more`);
    console.log('\nDRY RUN — nothing written. Re-run with --apply to perform it.');
    return;
  }

  // Batched, because a per-document round trip over ~50 documents is slow enough to look
  // like a hang, and a half-finished run is indistinguishable from a broken one.
  for (let i = 0; i < targets.length; i += 200) {
    const batch = db.batch();
    targets.slice(i, i + 200).forEach(({ id }) => {
      batch.update(db.collection('sermons').doc(id), { 'rev.plan': FieldValue.increment(1) });
    });
    await batch.commit();
  }

  // READ BACK. "The write returned without throwing" is not the same claim as "the counter
  // moved", and only the second one is what this script is for.
  const after = await db.collection('sermons').get();
  const expected = new Map(targets.map((t) => [t.id, t.before + 1]));
  let advanced = 0;
  const wrong = [];
  after.forEach((doc) => {
    if (!expected.has(doc.id)) return;
    const now = (doc.data().rev || {}).plan || 0;
    if (now === expected.get(doc.id)) advanced += 1;
    else wrong.push(`${doc.id}: expected ${expected.get(doc.id)}, found ${now}`);
  });

  console.log(`advanced: ${advanced}/${targets.length}`);
  if (wrong.length > 0) {
    console.log('NOT ADVANCED:');
    wrong.forEach((line) => console.log(`  ${line}`));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

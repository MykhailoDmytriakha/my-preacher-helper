#!/usr/bin/env node
/**
 * MIGRATE THE PLAN'S TEXT INTO `planText`, KEYED BY NODE ID.
 *
 * Before: the text of each node sat in `plan.<section>.outlinePoints[nodeId]`, next to an
 * assembled copy of the whole section in `plan.<section>.outline`. Saving one card rewrote
 * the entire section, so it overwrote every other card in it.
 *
 * After: `sermon.planText[nodeId]` — one flat map, written one key at a time. This script
 * moves the text; the app already reads BOTH shapes, so nothing breaks while it runs.
 *
 * THREE RULES THIS SCRIPT OBEYS
 *
 *   1. It never deletes the old fields. They stay as a read-only backup, which is what makes
 *      the migration reversible: undoing it is deleting `planText`, nothing more.
 *   2. It refuses to lose text. Every cell that existed must exist afterwards with the SAME
 *      content, and that is verified per sermon before the write is attempted.
 *   3. It is idempotent. A sermon already carrying `planText` is skipped unless the old
 *      fields hold text that is missing from it, in which case only the missing keys are added.
 *
 * USAGE
 *   node scripts/migrate-plan-text.js            # dry run: reports, writes nothing
 *   node scripts/migrate-plan-text.js --apply    # writes, after saving a backup file
 */

const fs = require('fs');
const path = require('path');

// Minimal .env.local reader — no new dependency for a one-off script.
(() => {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) return;
    const value = match[2].trim().replace(/^["']|["']$/g, '');
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  });
})();

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const SECTIONS = ['introduction', 'main', 'conclusion'];

function adminDb() {
  if (getApps().length === 0) {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT is missing — run from frontend/ with .env.local present');
    }
    const serviceAccount = JSON.parse(
      Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString()
    );
    initializeApp({ credential: cert(serviceAccount) });
  }
  return getFirestore();
}

/** Every node id the structure holds — the definition of "text that still belongs somewhere". */
function liveNodeIds(outline) {
  const ids = new Set();
  SECTIONS.forEach((section) => {
    (outline?.[section] ?? []).forEach((point) => {
      ids.add(point.id);
      (point.subPoints ?? []).forEach((subPoint) => ids.add(subPoint.id));
    });
  });
  return ids;
}

/** The old shape, flattened: every cell of every section, keyed by node id. */
function collectLegacyText(sermon) {
  const stored = sermon.plan ?? sermon.draft;
  const collected = {};
  if (!stored) return collected;

  SECTIONS.forEach((section) => {
    const cells = stored[section]?.outlinePoints ?? {};
    Object.entries(cells).forEach(([nodeId, text]) => {
      if (typeof text === 'string') collected[nodeId] = text;
    });
  });
  return collected;
}

/**
 * SPLITTING AN OLD ASSEMBLED SECTION BACK ONTO ITS POINTS.
 *
 * Sermons written before per-node cells store the whole section as one string — but not an
 * unstructured one: it was ASSEMBLED from the points, so it still carries `## N. Title` for
 * each of them, and the NUMBER says which point the block belongs to. That number is the
 * evidence; the title is only used to report whether it still matches.
 *
 * Dropping the whole section into the first point (the first attempt here) kept every byte
 * and lied about all of them: one card held the entire sermon, the rest looked empty, and
 * the heading printed twice. Splitting restores what the text always meant.
 *
 * Rules, and each refuses to guess:
 *   - a block headed `## N.` goes to the Nth point; out-of-range numbers are left alone
 *   - text before the first heading goes to the FIRST point (that is where it was)
 *   - a section with NO headings goes to the first point whole — nothing to split on
 *   - the heading line itself is dropped: assembly prints it again from the structure
 *   - a point that already has a cell is never overwritten
 */
function splitAssembledSection(assembled, points) {
  const result = {};
  const unmatched = [];
  const matchedBy = { title: 0, number: 0, fallback: 0 };
  if (!assembled.trim() || points.length === 0) return { result, unmatched, matchedBy };

  const norm = (s) => String(s || '')
    .toLowerCase()
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

  const lines = assembled.split('\n');
  const blocks = [];
  let current = { number: null, title: null, body: [] };
  let insideFence = false;

  lines.forEach((line) => {
    const trimmed = line.trim();

    // A fenced block is verbatim text. `## something` inside it is CONTENT, not a heading —
    // treating it as one both deleted the line and moved everything after it elsewhere.
    if (/^(```|~~~)/.test(trimmed)) {
      insideFence = !insideFence;
      current.body.push(line);
      return;
    }

    const heading = !insideFence && /^##\s+(?!#)(?:(\d+)\.\s*)?(.+)$/.exec(trimmed);
    if (heading) {
      blocks.push(current);
      current = { number: heading[1] ? Number(heading[1]) : null, title: heading[2].trim(), body: [] };
      return;
    }
    current.body.push(line);
  });
  blocks.push(current);

  const taken = new Set();

  blocks.forEach((block) => {
    const body = block.body.join('\n').trim();
    if (!body) return;

    /**
     * TITLE FIRST, NUMBER SECOND — because the title is what assembly actually prints.
     *
     * `buildSectionOutlineMarkdown` writes `## <point text>` with NO number, so a plan
     * assembled by the current code has nothing to count. And where numbers DO exist, they
     * were written when the plan was assembled: reorder the points afterwards and the
     * numbers now name the wrong ones, which silently swaps two points' text.
     *
     * The title is evidence about WHICH point this is; the number is only evidence about
     * where it once stood.
     */
    let index = -1;
    let claims = true;

    if (block.title === null) {
      /**
       * Text before any heading sat with the first point — but it does not CLAIM it.
       *
       * Marking it taken was a regression with a wide blast radius: the section's own
       * `## First` could then no longer match point one, fell through to the last point,
       * and every following block piled in after it. A preamble shares the first card with
       * that card's own text; it does not evict it.
       */
      index = 0;
      claims = false;
      matchedBy.fallback += 1;
    } else {
      const sameTitle = points
        .map((point, i) => ({ i, point }))
        .filter(({ point }) => norm(point.text) === norm(block.title));

      if (sameTitle.length > 1 && block.number !== null && points[block.number - 1]) {
        /**
         * TWO POINTS MAY LEGITIMATELY SHARE A TITLE — the app supports that on purpose.
         *
         * With the title alone ambiguous, the number is the only thing that tells them
         * apart. Taking "the first free one with this title" instead copied a block onto a
         * point that already had its own text elsewhere, leaving the same words twice.
         */
        index = block.number - 1;
        matchedBy.number += 1;
      } else {
        const free = sameTitle.find(({ i }) => !taken.has(i));
        if (free) {
          index = free.i;
          matchedBy.title += 1;
        } else if (block.number !== null && points[block.number - 1] && !taken.has(block.number - 1)) {
          index = block.number - 1;
          matchedBy.number += 1;
        }
      }
    }

    if (index === -1) {
      // A heading naming nothing we have. Keep the words with the last point rather than
      // dropping them, and say so — misplaced is recoverable, deleted is not.
      index = points.length - 1;
      unmatched.push(block.title || '(no heading)');
    }

    const point = points[index];
    if (!point) return;
    if (claims) taken.add(index);

    result[point.id] = result[point.id] ? `${result[point.id]}\n\n${body}` : body;
  });

  return { result, unmatched, matchedBy };
}

function assembledOnlyRescue(sermon, legacy) {
  const stored = sermon.plan ?? sermon.draft;
  const rescued = {};
  const unrescuable = [];
  const notes = [];
  if (!stored) return { rescued, unrescuable, notes };

  SECTIONS.forEach((section) => {
    const assembled = (stored[section]?.outline ?? '').trim();
    if (!assembled) return;

    /**
     * A PARTLY FILLED SECTION STILL NEEDS RESCUING.
     *
     * Skipping any section that had even one cell was wrong in a way that hides text: the
     * one cell is enough to switch the read-time fallback off for the WHOLE section, so
     * whatever only existed inside the assembled string stopped being shown anywhere.
     * Blocks whose point already holds text are skipped below; the rest fill the gaps.
     */

    const points = sermon.outline?.[section] ?? [];
    if (points.length === 0) { unrescuable.push(section); return; }

    const { result, unmatched } = splitAssembledSection(stored[section].outline, points);

    Object.entries(result).forEach(([nodeId, body]) => {
      if (legacy[nodeId] !== undefined) return;
      if ((sermon.planText ?? {})[nodeId] !== undefined) return;
      rescued[nodeId] = body;
    });

    const placed = Object.keys(result).length;
    notes.push(`${section}: ${placed}/${points.length} point(s) filled` +
      (unmatched.length ? `, ${unmatched.length} block(s) with no matching point` : ''));
  });

  return { rescued, unrescuable, notes };
}

function classify(sermon) {
  const legacy = collectLegacyText(sermon);
  const current = sermon.planText ?? {};
  const live = liveNodeIds(sermon.outline);

  const { rescued, unrescuable, notes } = assembledOnlyRescue(sermon, legacy);

  const missing = {};
  Object.entries({ ...legacy, ...rescued }).forEach(([nodeId, text]) => {
    if (current[nodeId] === undefined) missing[nodeId] = text;
  });

  // Cells whose node is gone. They are inert already (assembly walks the structure), so they
  // are carried over rather than dropped — deleting data is not this script's job.
  const orphanKeys = Object.keys(legacy).filter((nodeId) => !live.has(nodeId));

  // Text that exists on BOTH sides with different content. The app prefers `planText`, so
  // this sermon has already been edited under the new shape; the old copy is stale by
  // definition and must not be written back over it.
  const divergent = Object.keys(legacy).filter(
    (nodeId) => current[nodeId] !== undefined && current[nodeId] !== legacy[nodeId]
  );

  const stored = sermon.plan ?? sermon.draft;
  const assembledOnly = SECTIONS.filter((section) => {
    const hasAssembled = (stored?.[section]?.outline ?? '').trim() !== '';
    const hasCells = Object.keys(stored?.[section]?.outlinePoints ?? {}).length > 0;
    return hasAssembled && !hasCells;
  });

  let status;
  if (Object.keys(legacy).length === 0 && Object.keys(rescued).length === 0) status = 'nothing-to-move';
  else if (Object.keys(missing).length === 0) status = 'already-migrated';
  else status = 'to-migrate';

  return { legacy, current, missing, orphanKeys, divergent, assembledOnly, rescued, unrescuable, notes, status };
}

async function main() {
  const db = adminDb();
  const snapshot = await db.collection('sermons').get();

  const report = {
    total: snapshot.size,
    toMigrate: [], alreadyMigrated: [], nothingToMove: [],
    withOrphanKeys: [], withDivergentText: [], withAssembledOnlySections: [],
  };
  const backup = {};
  const writes = [];

  snapshot.forEach((doc) => {
    const sermon = { id: doc.id, ...doc.data() };
    const info = classify(sermon);
    const label = `${doc.id} · ${String(sermon.title ?? '(untitled)').slice(0, 40)}`;

    if (info.status === 'to-migrate') {
      report.toMigrate.push(`${label} — moving ${Object.keys(info.missing).length} cell(s)`);
      backup[doc.id] = { plan: sermon.plan ?? null, draft: sermon.draft ?? null, planText: sermon.planText ?? null };
      writes.push({ id: doc.id, missing: info.missing });
    } else if (info.status === 'already-migrated') {
      report.alreadyMigrated.push(label);
    } else {
      report.nothingToMove.push(label);
    }

    if (info.orphanKeys.length) {
      report.withOrphanKeys.push(`${label} — ${info.orphanKeys.length} cell(s) whose node is gone`);
    }
    if (info.divergent.length) {
      report.withDivergentText.push(`${label} — ${info.divergent.length} key(s) differ; NEW text kept, old left untouched`);
    }
    if (Object.keys(info.rescued ?? {}).length) {
      report.rescuedAssembled = report.rescuedAssembled ?? [];
      report.rescuedAssembled.push(`${label} — ${(info.notes ?? []).join(' · ')}`);
    }
    if (info.unrescuable?.length) {
      report.unrescuable = report.unrescuable ?? [];
      report.unrescuable.push(`${label} — ${info.unrescuable.join(', ')}: assembled text but NO points; left as is`);
    }
    if (info.assembledOnly.length) {
      report.withAssembledOnlySections.push(`${label} — section(s) with only assembled text: ${info.assembledOnly.join(', ')}`);
    }
  });

  console.log(`\n${APPLY ? 'APPLY' : 'DRY RUN'} — ${report.total} sermon(s) scanned\n`);
  const show = (title, rows) => {
    console.log(`${title}: ${rows.length}`);
    rows.forEach((row) => console.log(`   ${row}`));
  };
  show('TO MIGRATE', report.toMigrate);
  show('ALREADY MIGRATED', report.alreadyMigrated);
  show('NOTHING TO MOVE', report.nothingToMove);
  console.log('');
  show('⚠ cells whose node no longer exists (carried over, harmless)', report.withOrphanKeys);
  show('⚠ text differing between shapes (new kept)', report.withDivergentText);
  show('⚠ sections holding only assembled text (stay readable via fallback)', report.withAssembledOnlySections);
  show('→ assembled-only sections split back onto their points', report.rescuedAssembled ?? []);
  show('⚠ assembled text with NO points to hold it (untouched, needs a human)', report.unrescuable ?? []);

  if (!APPLY) {
    console.log('\nNothing was written. Re-run with --apply to migrate.\n');
    return;
  }

  if (writes.length === 0) {
    console.log('\nNothing to write.\n');
    return;
  }

  /**
   * OUTSIDE THE REPOSITORY, deliberately.
   *
   * This file holds the real text of real sermons. Written next to the script, it sat in
   * `git status` as untracked-and-not-ignored — one `git add .` from being committed and
   * pushed. A rollback file must not be one careless command away from becoming public.
   */
  const backupDir = path.join(require('os').homedir(), '.mph-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `plan-text-backup-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`\nBackup of the affected sermons written to:\n   ${backupPath}\n`);

  let migrated = 0;
  for (const write of writes) {
    // Leaf paths, exactly like the app writes them: keys already present are left alone,
    // so a sermon edited under the new shape mid-migration keeps its newer text.
    const patch = {};
    Object.entries(write.missing).forEach(([nodeId, text]) => {
      patch[`planText.${nodeId}`] = text;
    });

    /**
     * A MIGRATION IS A WRITER, AND IT OWES THE COUNTER.
     *
     * This was missed the first time and cost a real defect. Changing stored content while
     * leaving `rev` alone means a copy cached BEFORE the move can never be proven older
     * (`utils/readFreshness.ts`), so it keeps winning; the screen still renders, because the
     * legacy cells are merged on read, but the write baseline is taken from the raw `planText`
     * — finds nothing — and the guard then refuses a legitimate save against text that really
     * is there. The rule is stated in `services/conflictSafeUpdate.client.ts` at `revisionBump`
     * and applies to scripts exactly as it does to the app.
     *
     * Retrofitting the documents already moved without it: `scripts/touch-plan-revision.js`.
     */
    patch['rev.plan'] = FieldValue.increment(1);

    await db.collection('sermons').doc(write.id).update(patch);

    // Verify by reading back: every cell that was supposed to move must be there, verbatim.
    const after = (await db.collection('sermons').doc(write.id).get()).data();
    const stillMissing = Object.entries(write.missing)
      .filter(([nodeId, text]) => (after?.planText ?? {})[nodeId] !== text)
      .map(([nodeId]) => nodeId);

    if (stillMissing.length) {
      console.error(`   ✗ ${write.id} — ${stillMissing.length} cell(s) did not land: ${stillMissing.join(', ')}`);
    } else {
      migrated += 1;
      console.log(`   ✓ ${write.id} — ${Object.keys(write.missing).length} cell(s) moved and verified`);
    }
  }

  console.log(`\nMigrated ${migrated}/${writes.length} sermon(s). Old fields left untouched as a backup.\n`);
}

main().then(() => process.exit(0)).catch((error) => {
  console.error('\nMigration failed:', error);
  process.exit(1);
});

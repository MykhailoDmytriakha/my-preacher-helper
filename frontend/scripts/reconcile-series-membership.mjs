#!/usr/bin/env node
/**
 * Ф0 — one-time reconciliation/backfill for the "playlist" series-membership model.
 *
 * ⚠️ DEV-ONLY. DO NOT run against production/real data without an explicit human
 * gate (Gawande + Popper). It defaults to a DRY RUN (prints a report, writes
 * nothing). Writing requires BOTH --apply AND --i-understand-this-writes-prod.
 * Always spike on a COPY of the data first.
 *
 * The playlist model makes `series.items[]` the sole source of truth for
 * membership+order; `sermon.seriesId` / `group.seriesId` become deprecated
 * back-refs. Existing data may have drifted, so this script reconciles one user's
 * data with these rules:
 *
 *   1. BACK-REF WINS where set: if sermon/group X has seriesId = S, X must live in
 *      S.items (and be removed from any OTHER series' items — one-to-one). This
 *      preserves the currently-VISIBLE truth (the old UI rendered off the back-ref).
 *   2. RE-ADD ORPHANS: seriesId = S set but X is in NO series' items -> add to S.items.
 *   3. DEDUP multi-membership: if X sits in several series' items and has NO
 *      back-ref, keep it in the lowest-series-id (deterministic) and drop the rest.
 *   4. items-only (no back-ref, single membership) -> leave as-is.
 *
 * Usage (dry run):
 *   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/reconcile-series-membership.mjs --user=<uid>
 * Usage (WRITE — gated):
 *   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/reconcile-series-membership.mjs \
 *     --user=<uid> --apply --i-understand-this-writes-prod
 */

import admin from 'firebase-admin';

// ---- args ----
const args = new Map(
  process.argv.slice(2).map((raw) => {
    const [key, value] = raw.replace(/^--/, '').split('=');
    return [key, value ?? true];
  })
);
const userId = args.get('user');
const apply = args.get('apply') === true;
const confirmed = args.get('i-understand-this-writes-prod') === true;

if (!userId || typeof userId !== 'string') {
  console.error('Missing required --user=<uid>. Aborting.');
  process.exit(1);
}
if (apply && !confirmed) {
  console.error('Refusing to write without --i-understand-this-writes-prod. Aborting.');
  process.exit(1);
}

// ---- item helpers (mirror app/utils/seriesItems.ts) ----
const buildItemId = (type, refId) => `${type}-${refId}`;
const withSequentialPositions = (items) => items.map((item, index) => ({ ...item, position: index + 1 }));

function normalizeItems(items = [], legacySermonIds = []) {
  const source =
    items && items.length > 0
      ? items
      : legacySermonIds.map((sermonId, index) => ({
          id: buildItemId('sermon', sermonId),
          type: 'sermon',
          refId: sermonId,
          position: index + 1,
        }));
  return withSequentialPositions(
    source
      .filter((item) => item && item.refId)
      .map((item) => ({
        id: item.id || buildItemId(item.type || 'sermon', item.refId),
        type: item.type === 'group' ? 'group' : 'sermon',
        refId: item.refId,
        position: Number.isFinite(item.position) ? item.position : Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => a.position - b.position)
  );
}

const deriveSermonIds = (items) => items.filter((i) => i.type === 'sermon').map((i) => i.refId);
const inferSeriesKind = (items) => {
  const hasSermon = items.some((i) => i.type === 'sermon');
  const hasGroup = items.some((i) => i.type === 'group');
  if (hasSermon && hasGroup) return 'mixed';
  if (hasGroup) return 'group';
  return 'sermon';
};
const upsert = (items, type, refId) => {
  const kept = items.filter((i) => !(i.type === type && i.refId === refId));
  kept.push({ id: buildItemId(type, refId), type, refId, position: kept.length + 1 });
  return withSequentialPositions(kept);
};
const removeRef = (items, type, refId) =>
  withSequentialPositions(items.filter((i) => !(i.type === type && i.refId === refId)));

async function main() {
  if (admin.apps.length === 0) admin.initializeApp();
  const db = admin.firestore();

  const [seriesSnap, sermonSnap, groupSnap] = await Promise.all([
    db.collection('series').where('userId', '==', userId).get(),
    db.collection('sermons').where('userId', '==', userId).get(),
    db.collection('groups').where('userId', '==', userId).get(),
  ]);

  // Working, normalized items per series id.
  const seriesItems = new Map();
  for (const doc of seriesSnap.docs) {
    const data = doc.data();
    seriesItems.set(doc.id, normalizeItems(data.items, data.sermonIds || []));
  }
  const seriesIds = [...seriesItems.keys()].sort((a, b) => a.localeCompare(b));

  const report = { backfilledOrphans: 0, relocatedToBackRef: 0, dedupedMultiMembership: 0, unchanged: 0 };

  const membershipOf = (type, refId) =>
    seriesIds.filter((sid) => seriesItems.get(sid).some((i) => i.type === type && i.refId === refId));

  const reconcileRef = (type, refId, backRefSeriesId) => {
    const inSeries = membershipOf(type, refId);
    if (backRefSeriesId && seriesItems.has(backRefSeriesId)) {
      // Rule 1/2: back-ref wins. Ensure ref is ONLY in backRefSeriesId.
      const wasOrphan = inSeries.length === 0;
      const wasElsewhere = inSeries.some((sid) => sid !== backRefSeriesId);
      for (const sid of inSeries) {
        if (sid !== backRefSeriesId) seriesItems.set(sid, removeRef(seriesItems.get(sid), type, refId));
      }
      if (!inSeries.includes(backRefSeriesId)) {
        seriesItems.set(backRefSeriesId, upsert(seriesItems.get(backRefSeriesId), type, refId));
      }
      if (wasOrphan) report.backfilledOrphans += 1;
      else if (wasElsewhere) report.relocatedToBackRef += 1;
      else report.unchanged += 1;
      return;
    }
    // Rule 3: no usable back-ref. Dedup multi-membership -> keep lowest series id.
    if (inSeries.length > 1) {
      // seriesIds already sorted ascending -> keep the first (lowest id), drop the rest.
      const [, ...drop] = inSeries;
      for (const sid of drop) seriesItems.set(sid, removeRef(seriesItems.get(sid), type, refId));
      report.dedupedMultiMembership += 1;
      return;
    }
    report.unchanged += 1;
  };

  for (const doc of sermonSnap.docs) reconcileRef('sermon', doc.id, doc.data().seriesId || null);
  for (const doc of groupSnap.docs) reconcileRef('group', doc.id, doc.data().seriesId || null);

  // Determine which series docs actually changed.
  const changes = [];
  for (const doc of seriesSnap.docs) {
    const before = normalizeItems(doc.data().items, doc.data().sermonIds || []);
    const after = seriesItems.get(doc.id);
    if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ id: doc.id, items: after });
  }

  console.log(`\nReconcile report for user ${userId}:`);
  console.log(`  series: ${seriesSnap.size} · sermons: ${sermonSnap.size} · groups: ${groupSnap.size}`);
  console.log(`  backfilled orphans:        ${report.backfilledOrphans}`);
  console.log(`  relocated to back-ref:     ${report.relocatedToBackRef}`);
  console.log(`  deduped multi-membership:  ${report.dedupedMultiMembership}`);
  console.log(`  unchanged refs:            ${report.unchanged}`);
  console.log(`  series docs to rewrite:    ${changes.length}`);

  if (!apply) {
    console.log('\nDRY RUN — no writes performed. Re-run with --apply --i-understand-this-writes-prod to write.');
    return;
  }

  const batch = db.batch();
  for (const change of changes) {
    batch.update(db.collection('series').doc(change.id), {
      items: change.items,
      sermonIds: deriveSermonIds(change.items),
      seriesKind: inferSeriesKind(change.items),
      updatedAt: new Date().toISOString(),
    });
  }
  await batch.commit();
  console.log(`\nAPPLIED: rewrote ${changes.length} series docs. Re-run WITHOUT --apply to verify counts are stable.`);
}

main().catch((error) => {
  console.error('Reconcile failed:', error);
  process.exit(1);
});

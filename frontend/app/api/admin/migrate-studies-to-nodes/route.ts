import { NextResponse } from 'next/server';

import { adminDb } from '@/config/firebaseAdminConfig';
import { nodeTreeToMarkdown } from '@/utils/nodeTreeAdapter';
import { markdownToNodeTree } from '@/utils/nodeTreeMigration';

import type { StudyNote } from '@/models/models';

const NOTES_COLLECTION = 'studyNotes';
const ADMIN_SECRET_HEADER = 'x-admin-secret';

/**
 * Server-side gate. Mirrors the telemetry admin pattern: requires
 * `ADMIN_SECRET` env var to match an `x-admin-secret` header. Refuses
 * in production unless `ALLOW_ADMIN_MIGRATION_IN_PRODUCTION=true` is set,
 * so an accidental hit on a deployed environment cannot rewrite live data
 * unless we explicitly opt in.
 */
function checkMigrationAdminAuth(request: Request): NextResponse | null {
  const allowProduction = process.env.ALLOW_ADMIN_MIGRATION_IN_PRODUCTION === 'true';
  if (process.env.NODE_ENV === 'production' && !allowProduction) {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'ADMIN_SECRET is not configured' }, { status: 503 });
  }
  if (request.headers.get(ADMIN_SECRET_HEADER) !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

interface MigrationRequestBody {
  dryRun?: boolean;
  /** Max notes to actually migrate in this call (newlyMigrated cap). */
  limit?: number;
  userId?: string;
  /** Doc id to resume after — pass `nextCursor` from the previous response. */
  cursor?: string;
}

interface MigrationReport {
  dryRun: boolean;
  totalScanned: number;
  alreadyMigrated: number;
  newlyMigrated: number;
  skippedEmpty: number;
  failed: Array<{ id: string; error: string }>;
  /** Last scanned doc id; pass back as `cursor` to continue. `null` when exhausted. */
  nextCursor: string | null;
}

const SCAN_BATCH_SIZE = 100;

/**
 * Batch-migrate legacy `content: string` study notes into the node-tree
 * model. Default is dryRun=true — the report shows what *would* change
 * without mutating Firestore. Pass `{ dryRun: false }` to commit.
 *
 * Idempotent: notes that already have `rootNode` are counted but skipped.
 * `legacyContent` snapshot of the original markdown is preserved on each
 * migrated doc so the conversion can be audited (or rolled back) later.
 */
export async function POST(request: Request) {
  const authFail = checkMigrationAdminAuth(request);
  if (authFail) return authFail;

  let body: MigrationRequestBody = {};
  try {
    body = (await request.json()) as MigrationRequestBody;
  } catch {
    body = {};
  }

  const dryRun = body.dryRun !== false; // safety: default ON
  const newlyMigratedCap = Math.min(Math.max(body.limit ?? 50, 1), 500);
  const userId = body.userId;
  const startCursor = body.cursor;

  // Scan in ordered batches starting after `cursor`. Without this, every
  // call would re-read the same first N docs — once those are migrated
  // they stay in the page and later docs are never reached.
  const baseQuery = userId
    ? adminDb.collection(NOTES_COLLECTION).where('userId', '==', userId)
    : adminDb.collection(NOTES_COLLECTION);
  const orderedQuery = baseQuery.orderBy('__name__');

  const report: MigrationReport = {
    dryRun,
    totalScanned: 0,
    alreadyMigrated: 0,
    newlyMigrated: 0,
    skippedEmpty: 0,
    failed: [],
    nextCursor: null,
  };

  let cursor: string | undefined = startCursor;
  let lastSeenId: string | null = cursor ?? null;
  let scannedDocsInLastBatch = 0;
  let hitCap = false;
  let exhausted = false;

  while (report.newlyMigrated < newlyMigratedCap) {
    const pagedQuery = cursor
      ? orderedQuery.startAfter(cursor).limit(SCAN_BATCH_SIZE)
      : orderedQuery.limit(SCAN_BATCH_SIZE);
    const snapshot = await pagedQuery.get();
    scannedDocsInLastBatch = snapshot.size;
    if (snapshot.empty) {
      exhausted = true;
      break;
    }

    let processedAllInThisBatch = true;
    for (const doc of snapshot.docs) {
      report.totalScanned += 1;
      lastSeenId = doc.id;
      try {
        const data = doc.data() as StudyNote;
        if (data.rootNode) {
          report.alreadyMigrated += 1;
          continue;
        }
        const content = data.content ?? '';
        if (!content.trim()) {
          report.skippedEmpty += 1;
          continue;
        }

        const rootNode = markdownToNodeTree(content);
        const derivedContent = nodeTreeToMarkdown(rootNode);

        if (!dryRun) {
          await doc.ref.update({
            rootNode,
            content: derivedContent,
            legacyContent: content,
            updatedAt: new Date().toISOString(),
          });
        }
        report.newlyMigrated += 1;
        if (report.newlyMigrated >= newlyMigratedCap) {
          hitCap = true;
          processedAllInThisBatch = false;
          break;
        }
      } catch (err) {
        report.failed.push({ id: doc.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    cursor = lastSeenId ?? cursor;
    if (hitCap) break;
    // Only treat as exhausted when we got fewer docs than the batch size AND
    // we processed every doc in the batch. Hitting the cap mid-batch leaves
    // unscanned docs behind even when the page itself was short.
    if (processedAllInThisBatch && scannedDocsInLastBatch < SCAN_BATCH_SIZE) {
      exhausted = true;
      break;
    }
  }

  // Surface a cursor whenever the caller might need to resume:
  // - hit the cap → more docs remain
  // - last batch was full → there may be more after lastSeenId
  // Only null when we definitively reached the end of the collection.
  report.nextCursor = exhausted ? null : lastSeenId;

  return NextResponse.json(report);
}

import fs from 'fs';
import path from 'path';

/**
 * ONE DOOR FOR WRITING A DOCUMENT, AND IT IS NOT `updateDoc`.
 *
 * The bug this exists to stop has been fixed by hand five times in five places: a laptop
 * holding yesterday's copy writes over what a phone stored a minute ago, and the paragraph
 * is gone with nothing reported anywhere. Every fix was correct and none of them generalised,
 * because the next writer was written the same way as the last — by copying a neighbour.
 *
 * So the rule is structural rather than remembered:
 *
 *   `conflictSafeUpdate(...)` — compares what the caller started from, writes or REFUSES,
 *                              queues the intent when there is no connection.
 *   `revisionedUpdate(...)`   — deliberately unguarded, still advances the counter. For
 *                              writes where a refusal would be wrong (cleanup, for instance).
 *
 * A bare `updateDoc`/`setDoc` is neither, so it silently opts out of both. This test cannot
 * migrate the writers that predate the rule, and pretending otherwise would either fail from
 * day one or be deleted by the first person it inconvenienced. It does the one thing that
 * actually holds: it FREEZES the debt. Every remaining direct write is counted here, and the
 * numbers may only go down.
 *
 * Out of scope on purpose: `addDoc` and `deleteDoc`, which create and remove whole documents
 * rather than replacing fields inside one, and `app/api/**`, which is the server side running
 * the Admin SDK — a different module with a different concurrency story.
 *
 * ⚠️ WHAT THIS CANNOT SEE, and it matters that the limit is written down rather than assumed.
 * The check is textual, so a writer reached through an alias (`import { updateDoc as write }`)
 * or built at runtime slips past it. `writeBatch` and `runTransaction` are counted below for
 * exactly that reason — adversarial review found `seriesMembership.client.ts` writing through a
 * batch while this test stayed green, which is the failure mode of a guard nobody re-checks.
 */

const APP_ROOT = path.join(__dirname, '..', '..', 'app');

/**
 * Direct writes that predate the rule, by file. Lower a number when you migrate one; the
 * test tells you when a number is too high. Never raise one — a new direct write means the
 * writer has no answer to "what happens when the other device saved first".
 */
const FROZEN_DIRECT_WRITES: Record<string, number> = {
  // The interface itself: `revisionedUpdate` and the guarded transaction live here.
  'services/conflictSafeUpdate.client.ts': 3,
  'services/sermons.client.ts': 10,
  'services/groups.service.ts': 3,
  'services/userSettings.service.ts': 3,
  'services/atomicUpdate.client.ts': 3,
  'services/planTemplates.client.ts': 2,
  'services/prayerRequests.client.ts': 2,
  'services/series.service.ts': 2,
  // A cross-series move, deliberately all-or-nothing — and invisible to this test until
  // `writeBatch` was added to what it looks for.
  'services/seriesMembership.client.ts': 4,
  'services/studies.service.ts': 2,
  'services/lastSeen.client.ts': 1,
  'services/tag.service.ts': 1,
  // Server-side counters, on documents no editor competes for.
  'services/rateLimit.server.ts': 2,
  'services/usageLimits.server.ts': 2,
  // A page writing Firestore straight from the browser — the furthest thing from the rule,
  // and worth naming here so it stays visible instead of blending into the services.
  '(pages)/(private)/settings/page.tsx': 1,
};

/**
 * Counting `writeBatch(` and `runTransaction(` alone counts DOORS, not writes: adding one more
 * `batch.update(...)` inside a batch that already exists leaves the number unchanged and the
 * gate green, which is how a new last-write-wins writer would walk straight past it. The
 * mutations inside are counted too, so the budget moves whenever the number of document writes
 * moves — which is the thing the rule is actually about.
 */
const DIRECT_WRITE =
  /\b(?:updateDoc|setDoc|writeBatch|runTransaction)\s*\(|\b(?:batch|tx|transaction)\.(?:update|set)\s*\(/g;

/**
 * THE REPOSITORY, NOT THE WORKING COPY — learned from a failed production build.
 *
 * `app/dev/` is gitignored (`.gitignore:67`), so its scratch pages exist on the machine that
 * wrote them and nowhere else. Counting them froze a budget for files the build machine has
 * never seen: every check passed locally and the honesty test failed in CI, blocking a deploy
 * over a difference that was never about the codebase at all.
 *
 * A guard that measures whatever happens to be on one disk is measuring the wrong thing.
 */
const NOT_IN_THE_REPOSITORY = new Set(['__tests__', 'node_modules', 'dev']);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return NOT_IN_THE_REPOSITORY.has(entry.name) ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function countDirectWrites(): Record<string, number> {
  const counts: Record<string, number> = {};
  sourceFiles(APP_ROOT).forEach((file) => {
    const relative = path.relative(APP_ROOT, file);
    if (relative.startsWith('api' + path.sep)) return;
    const found = (fs.readFileSync(file, 'utf8').match(DIRECT_WRITE) ?? []).length;
    if (found > 0) counts[relative] = found;
  });
  return counts;
}

describe('every document write goes through the conflict-safe interface', () => {
  const counts = countDirectWrites();

  it('adds no new file that writes Firestore directly', () => {
    const newcomers = Object.keys(counts).filter((file) => !(file in FROZEN_DIRECT_WRITES));
    expect({
      newcomers,
      how: 'Write through conflictSafeUpdate (guarded) or revisionedUpdate (deliberately not), both in services/conflictSafeUpdate.client.ts.',
    }).toEqual({ newcomers: [], how: expect.any(String) });
  });

  it('adds no new direct write to a file that already has some', () => {
    const grown = Object.entries(counts)
      .filter(([file, found]) => file in FROZEN_DIRECT_WRITES && found > FROZEN_DIRECT_WRITES[file])
      .map(([file, found]) => `${file}: ${FROZEN_DIRECT_WRITES[file]} allowed, ${found} found`);
    expect(grown).toEqual([]);
  });

  /**
   * The budget has to shrink as writers migrate, or it stops meaning anything: a number left
   * standing above the truth is room for a new direct write that nobody would notice.
   */
  it('keeps the frozen numbers honest as writers migrate', () => {
    const stale = Object.entries(FROZEN_DIRECT_WRITES)
      .filter(([file, allowed]) => (counts[file] ?? 0) < allowed)
      .map(([file, allowed]) => `${file}: lower to ${counts[file] ?? 0} (was ${allowed})`);
    expect(stale).toEqual([]);
  });
});

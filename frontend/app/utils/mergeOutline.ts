import type { OutlinePoint, SermonOutline, SubPoint } from '@/models/models';

/**
 * Three-way merge of a sermon plan by point id.
 *
 * WHY MERGE INSTEAD OF REFUSING. The plan is written as ONE whole field, so the
 * laptop's save replaces every point with the laptop's snapshot. Edit a point on
 * the phone in the morning, save the plan from a laptop that has been open since
 * last night, and the morning point is gone with no warning — the exact loss this
 * work exists to stop. Refusing that save would stop the loss but hand the person
 * a conflict for changes that do not actually collide: they added a point HERE and
 * a different point THERE. The ideal system just keeps both, and only asks when
 * the SAME point was written in two places.
 *
 * The three sides:
 *   `base`   — the plan the editor opened with (what both sides started from),
 *   `mine`   — what this editor now wants to store,
 *   `theirs` — what the server actually holds right now.
 *
 * Rules, per section, addressed by point id:
 *   - a point only in `theirs` (added elsewhere since `base`) is KEPT,
 *   - a point in `base` and gone from `mine` was DELETED here → stays deleted,
 *   - a point in `base` and gone from `theirs` was DELETED elsewhere → and if this
 *     editor did not touch it, it stays deleted; if this editor CHANGED it, the
 *     edit wins (text a person wrote beats an absence),
 *   - a point changed on both sides is a real collision: reported, never guessed.
 *
 * Order: `mine` decides the order of the points it knows, and points that exist
 * only on the server are appended after the point they followed there, so a
 * reordering here does not scramble their additions.
 */
export interface OutlineMergeResult {
  outline: SermonOutline;
  /** Ids written on BOTH sides since `base` — the only case a person must settle. */
  collisions: string[];
}

type Section = keyof SermonOutline;
const SECTIONS: Section[] = ['introduction', 'main', 'conclusion'];

const byId = (points: OutlinePoint[] | undefined): Map<string, OutlinePoint> =>
  new Map((points ?? []).map((p) => [p.id, p]));

/** Same content? Compared on the fields a person can actually change. */
function samePoint(a: OutlinePoint | undefined, b: OutlinePoint | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.text === b.text &&
    (a.note ?? '') === (b.note ?? '') &&
    Boolean(a.isReviewed) === Boolean(b.isReviewed) &&
    sameSubPoints(a.subPoints, b.subPoints)
  );
}

function sameSubPoints(a: SubPoint[] | undefined, b: SubPoint[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  return left.every((sub, i) => {
    const other = right[i];
    return (
      sub.id === other.id &&
      sub.text === other.text &&
      (sub.note ?? '') === (other.note ?? '') &&
      sub.position === other.position
    );
  });
}

/** Which section a point id sits in, or undefined when it is absent. */
function sectionOf(outline: SermonOutline | null | undefined, id: string): Section | undefined {
  return SECTIONS.find((section) => (outline?.[section] ?? []).some((point) => point.id === id));
}

export function mergeOutline(
  base: SermonOutline | null | undefined,
  mine: SermonOutline,
  theirs: SermonOutline | null | undefined
): OutlineMergeResult {
  // No server version to reconcile with (a brand-new document): nothing to merge.
  if (!theirs) return { outline: mine, collisions: [] };

  const merged: SermonOutline = { introduction: [], main: [], conclusion: [] };
  const collisions: string[] = [];

  /**
   * MOVED IN BOTH PLACES, TO DIFFERENT SECTIONS.
   *
   * Sections are merged independently below, which is right for text but blind to a
   * point that CHANGED SECTION: the laptop moved it to Main, the phone to the
   * Conclusion, and each section saw a plain "added elsewhere" — so the point
   * appeared TWICE and nobody was asked. Ownership of an id is global, so it has to
   * be decided before the per-section pass.
   */
  /**
   * OWNERSHIP OF AN ID IS GLOBAL — AND SO IS ITS CONTENT.
   *
   * Sections used to be merged independently, which is right for order and blind to
   * everything else about a point that CHANGED SECTION. Two live-verified holes came
   * from that blindness:
   *   • laptop moves p1 to Main, phone rewrites p1's TEXT where it still sits — the
   *     per-section pass saw "gone from this section" on one side and "not in that
   *     section" on the other, kept the moved copy with the OLD text, and the phone's
   *     paragraph vanished without a word;
   *   • the mirror case produced TWO copies of one id.
   * So placement and content are decided ONCE per id, before any section is built.
   */
  const placement = new Map<string, Section>();
  const content = new Map<string, OutlinePoint>();
  const allIds = new Set<string>();
  SECTIONS.forEach((section) => {
    (mine[section] ?? []).forEach((p) => allIds.add(p.id));
    (theirs[section] ?? []).forEach((p) => allIds.add(p.id));
  });

  allIds.forEach((id) => {
    const startedIn = sectionOf(base, id);
    const hereSection = sectionOf(mine, id);
    const thereSection = sectionOf(theirs, id);
    const start = startedIn ? byId(base?.[startedIn]).get(id) : undefined;
    const here = hereSection ? byId(mine[hereSection]).get(id) : undefined;
    const there = thereSection ? byId(theirs[thereSection]).get(id) : undefined;

    // --- DELETIONS. An absence only counts as a deletion if the point EXISTED to
    // begin with; otherwise it is simply an addition on the other side.
    if (!here) {
      if (!there) return;
      if (startedIn) {
        // DELETED HERE — but only honour that if the other device left the point
        // ALONE. If they rewrote it while this screen was deleting it, dropping it
        // destroys words someone typed, and nobody is asked. An absence must never
        // outrank a written change: keep their version and raise the question.
        if (start && samePoint(start, there)) return;
        collisions.push(id);
        placement.set(id, thereSection as Section);
        content.set(id, there);
        return;
      }
      placement.set(id, thereSection as Section);
      content.set(id, there);
      return;
    }
    if (!there) {
      // Deleted elsewhere. Keep it only if this editor wrote into it since opening;
      // written words beat an absence.
      if (start && samePoint(start, here)) return;
      placement.set(id, hereSection as Section);
      content.set(id, here);
      return;
    }

    // --- PLACEMENT: whoever moved it decides; both moving differently is a question.
    const movedHere = Boolean(startedIn) && hereSection !== startedIn;
    const movedThere = Boolean(startedIn) && thereSection !== startedIn;
    if (movedHere && movedThere && hereSection !== thereSection) {
      collisions.push(id);
      placement.set(id, hereSection as Section);
    } else if (movedThere && !movedHere) {
      placement.set(id, thereSection as Section);
    } else {
      placement.set(id, hereSection as Section);
    }

    // --- CONTENT, decided independently of where the point now sits.
    const changedHere = !start || !samePoint(start, here);
    const changedThere = !start || !samePoint(start, there);
    if (changedHere && changedThere && !samePoint(here, there)) {
      if (!collisions.includes(id)) collisions.push(id);
      content.set(id, here);
    } else {
      content.set(id, changedThere ? there : here);
    }
  });

  SECTIONS.forEach((section) => {
    const result: OutlinePoint[] = [];

    // This editor's order first, for the points that end up in THIS section.
    (mine[section] ?? []).forEach((point) => {
      if (placement.get(point.id) !== section) return;
      const decided = content.get(point.id);
      if (decided) result.push(decided);
    });

    // Then whatever the server placed here that this editor does not list — an
    // addition made there, or a point they moved into this section. Each lands after
    // the neighbour it followed on the server, so their placement is respected
    // instead of everything piling up at the end.
    (theirs[section] ?? []).forEach((server, index) => {
      if (placement.get(server.id) !== section) return;
      if (result.some((p) => p.id === server.id)) return;
      const decided = content.get(server.id);
      if (!decided) return;
      const previous = (theirs[section] ?? [])[index - 1];
      const anchor = previous ? result.findIndex((p) => p.id === previous.id) : -1;
      if (anchor >= 0) result.splice(anchor + 1, 0, decided);
      else result.push(decided);
    });

    merged[section] = result;
  });

  return { outline: merged, collisions };
}

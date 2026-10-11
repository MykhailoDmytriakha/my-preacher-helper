import { mergeValues } from '@/data-engine/react.client';

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

function uniquePointsById(points: OutlinePoint[] | undefined): OutlinePoint[] {
  const seen = new Set<string>();
  return (points ?? []).filter((point) => {
    if (seen.has(point.id)) return false;
    seen.add(point.id);
    return true;
  });
}

function withoutDuplicateIds(outline: SermonOutline): SermonOutline {
  const seen = new Set<string>();
  let changed = false;
  const result: SermonOutline = { introduction: [], main: [], conclusion: [] };

  SECTIONS.forEach((section) => {
    const indexInSection = new Map<string, number>();
    (outline[section] ?? []).forEach((point) => {
      if (!seen.has(point.id)) {
        seen.add(point.id);
        indexInSection.set(point.id, result[section].length);
        result[section].push(point);
        return;
      }

      changed = true;
      const existingIndex = indexInSection.get(point.id);
      // Earlier versions could persist the same id more than once. Its first
      // position keeps the sermon shape, while the last copy in that same section
      // keeps the newest words instead of silently restoring an older duplicate.
      if (existingIndex !== undefined) result[section][existingIndex] = point;
    });
  });

  return changed ? result : outline;
}

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

/**
 * Whose ORDER should this section follow?
 *
 * The order of the points IS the shape of the sermon, so a reordering is work, not
 * formatting — and it used to be lost in silence: this editor's order was always
 * taken, so a phone that moved the conclusion ahead had its decision undone by the
 * next save from a laptop that merely reworded something.
 *
 * Decided exactly like content: whoever MOVED decides, and this editor wins when
 * both did. Deliberately NOT a collision — a refusal over ordering would train the
 * person to dismiss the question, and the next real one goes with it.
 *
 * Compared over the ids all three sides hold in this section, so an addition or a
 * deletion on either side is not mistaken for a move.
 */
function sectionFollowsTheirOrder(
  base: SermonOutline | null | undefined,
  mine: SermonOutline,
  theirs: SermonOutline,
  section: Section
): boolean {
  if (!base) return false;
  const shared = (id: string) =>
    (base[section] ?? []).some((p) => p.id === id) &&
    (mine[section] ?? []).some((p) => p.id === id) &&
    (theirs[section] ?? []).some((p) => p.id === id);
  const orderOf = (outline: SermonOutline) =>
    uniquePointsById(outline[section]).map((p) => p.id).filter(shared);

  const started = orderOf(base);
  const movedHere = orderOf(mine).some((id, index) => id !== started[index]);
  const movedThere = orderOf(theirs).some((id, index) => id !== started[index]);
  return !movedHere && movedThere;
}

export function mergeOutline(
  base: SermonOutline | null | undefined,
  mine: SermonOutline,
  theirs: SermonOutline | null | undefined,
  /**
   * Let the LOCAL decision win where nobody can be asked.
   *
   * The default keeps their version on a collision and reports it, which is right
   * for the plan editor: it stores the refusal and offers a choice. Views without
   * that surface pass `true` — otherwise a deletion made here comes back on the next
   * save, which is worse than the whole-field overwrite they used to do.
   *
   * The collision is still REPORTED either way; this only changes who wins.
   */
  preferMineOnCollision = false
): OutlineMergeResult {
  // No server version to reconcile with (a brand-new document): nothing to merge.
  if (!theirs) return { outline: withoutDuplicateIds(mine), collisions: [] };

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
        // Reported either way; who WINS depends on whether the caller can ask.
        // Placing nothing here is what makes the deletion stick.
        if (preferMineOnCollision) return;
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

    reconcileExistingPoint({ id, startedIn, hereSection, thereSection, start, here, there }, placement, content, collisions);
  });

  const emitted = new Set<string>();

  SECTIONS.forEach((section) => {
    const result: OutlinePoint[] = [];

    // Whoever reordered leads; this editor leads when nobody did, or when both did.
    const theirOrder = sectionFollowsTheirOrder(base, mine, theirs, section);
    const leading = uniquePointsById(theirOrder ? theirs[section] : mine[section]);
    const trailing = uniquePointsById(theirOrder ? mine[section] : theirs[section]);

    // The leading order first, for the points that end up in THIS section.
    leading.forEach((point) => {
      if (placement.get(point.id) !== section) return;
      if (emitted.has(point.id)) return;
      const decided = content.get(point.id);
      if (decided) {
        result.push(decided);
        emitted.add(point.id);
      }
    });

    // Then whatever the OTHER side places here and the leader does not list — an
    // addition made over there, or a point moved into this section. Each lands after
    // the neighbour it followed on its own side, so its placement is respected
    // instead of everything piling up at the end.
    trailing.forEach((point, index) => {
      if (placement.get(point.id) !== section) return;
      if (emitted.has(point.id)) return;
      const decided = content.get(point.id);
      if (!decided) return;
      /**
       * Land it after the nearest point that preceded it ON ITS OWN SIDE and is
       * already placed here. Only the IMMEDIATE predecessor used to be consulted, so
       * a point inserted at the FRONT — or moved into this section ahead of
       * everything — had no anchor and was appended to the very end instead. The
       * order of the points is the shape of the sermon, and silently moving one from
       * first to last changes what gets preached when.
       */
      let anchor = -1;
      for (let back = index - 1; back >= 0 && anchor < 0; back -= 1) {
        anchor = result.findIndex((p) => p.id === trailing[back].id);
      }
      if (anchor >= 0) result.splice(anchor + 1, 0, decided);
      // If every predecessor was removed by the merge, this is the first surviving
      // point from that side; appending it would turn an opening thought into a close.
      else result.unshift(decided);
      emitted.add(point.id);
    });

    merged[section] = result;
  });

  // One id lives in one place. A candidate that holds an id in two places — two devices moved a
  // sub-point to different points (HEAD did this too) — is a plan the document refuses, so those
  // points become a question instead of a silent hand-over. It only adds questions, never content.
  const owners = new Map<string, Map<string, string>>();
  const own = (itemId: unknown, place: string, pointId: string) => {
    if (typeof itemId !== 'string' || !itemId) return;
    owners.set(itemId, (owners.get(itemId) ?? new Map()).set(place, pointId));
  };
  SECTIONS.forEach((section) => merged[section].forEach((point) => {
    // A place says what holds the id — the plan itself or a point — never by encoding it into the id.
    own(point.id, JSON.stringify(['plan']), point.id);
    (point.subPoints ?? []).forEach((sub) => own(sub.id, JSON.stringify(['point', point.id]), point.id));
  }));
  owners.forEach((places) => {
    if (places.size < 2) return;
    places.forEach((pointId) => { if (!collisions.includes(pointId)) collisions.push(pointId); });
  });

  return { outline: merged, collisions };
}

function reconcileExistingPoint(
  { id, startedIn, hereSection, thereSection, start, here, there }: {
    id: string;
    startedIn: Section | undefined;
    hereSection: Section | undefined;
    thereSection: Section | undefined;
    start: OutlinePoint | undefined;
    here: OutlinePoint;
    there: OutlinePoint;
  },
  placement: Map<string, Section>,
  content: Map<string, OutlinePoint>,
  collisions: string[]
): void {
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
    // Both sides changed this point. When neither touched its skeleton — the same sub-points in the
    // same order and places — only words changed, and they merge field by field with the engine's
    // rule (BUG-20261011-outline-point-merge-loses-subpoint-edit): the phone's sub-point and this
    // device's sub-point both stay. The same words written differently, or any change to the skeleton
    // (a sub-point added, removed, moved, reordered), stays a question as before.
    const parts = start && sameSkeleton(start, here) && sameSkeleton(start, there)
      ? mergeValues(asField(start), asField(here), asField(there))
      : null;
    if (parts && parts.conflicts.length === 0 && parts.value.exists) {
      content.set(id, parts.value.value as unknown as OutlinePoint);
      return;
    }
    if (!collisions.includes(id)) collisions.push(id);
    content.set(id, here);
  } else {
    content.set(id, changedThere ? there : here);
  }
}

/**
 * A point as the engine merges it: plain data, without `undefined` fields, and with a list of
 * sub-points even where none was written yet — so first sub-points added on both devices merge
 * by id instead of colliding over a missing field.
 */
function asField(point: OutlinePoint) {
  // Absent and empty mean the same here as in `samePoint`: an empty note or a false "reviewed"
  // is not something either side wrote.
  const plain = <T extends { note?: string; isReviewed?: boolean }>(item: T): T => {
    const { note, isReviewed, ...rest } = item;
    return { ...rest, ...(note ? { note } : {}), ...(isReviewed ? { isReviewed } : {}) } as T;
  };
  const value = { ...plain(point), subPoints: (point.subPoints ?? []).map(plain) };
  return { exists: true as const, value: JSON.parse(JSON.stringify(value)) };
}

/**
 * The same sub-points, in the same order, at the same places: only their words may differ. Sub-points
 * without an id, or with one id twice, are not a skeleton the merge can trust.
 */
function sameSkeleton(a: OutlinePoint, b: OutlinePoint): boolean {
  const left = a.subPoints ?? [];
  const right = b.subPoints ?? [];
  const ids = left.map((sub) => sub.id);
  return ids.every((subId) => typeof subId === 'string' && subId.length > 0)
    && new Set(ids).size === ids.length
    && left.length === right.length
    && left.every((sub, index) => sub.id === right[index].id && sub.position === right[index].position);
}

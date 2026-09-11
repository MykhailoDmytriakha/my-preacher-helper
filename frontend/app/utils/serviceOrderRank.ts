import type { ServiceOrder } from '@/models/models';

/**
 * WHERE EACH ORDER OF SERVICE SITS IN THE PASTOR'S OWN LIST.
 *
 * A rank is a number, and moving an order writes only that order's rank: the midpoint between
 * its new neighbours. The alternative — storing 1, 2, 3 and renumbering — rewrites every row
 * the moved one passed, and on a phone with no signal some of those writes arrive and some do
 * not, which is how a list ends up in an order nobody chose.
 *
 * Three things this file owes the caller, because a half-answer here is worse than none:
 *
 * 1. TWO ORDERS CAN SHARE A RANK. Two devices, both offline, can drop different rites into the
 *    same gap and compute the same midpoint. That is a normal outcome, not an edge case, so
 *    the comparison never stops at the rank: the document id breaks the tie, and both devices
 *    then agree on the same sequence without talking to each other.
 *
 * 2. A GAP CAN COLLAPSE. Repeatedly moving into the same narrow space halves the distance each
 *    time, and a double runs out of room after about fifty of those. `needsRenumber` says when
 *    that has happened and `renumber` hands back a clean spread — a repair done deliberately
 *    and online, never as a silent side effect of a move.
 *
 * 3. RANKS ARRIVE MISSING OR BROKEN. A document written before this field existed, a partial
 *    write, a hand-edited console value: anything that is not a finite number is treated as
 *    "no opinion" and sorted to the end by creation time rather than throwing.
 */

/** The step between freshly seeded orders — wide enough for many moves before any renumber. */
export const RANK_STEP = 1000;
/** Below this, two neighbouring ranks are too close to put anything between them. */
const MIN_GAP = 1e-6;

const isRank = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** The rank a document sorts by; anything unusable sorts after everything that has one. */
const rankOf = (order: Pick<ServiceOrder, 'rank'>): number =>
  isRank(order.rank) ? order.rank : Number.MAX_SAFE_INTEGER;

/**
 * The pastor's order, and the SAME order on every device: rank first, then document id — never
 * `createdAt`, which is a clock reading from whichever phone happened to write the row.
 */
export function sortByRank<T extends Pick<ServiceOrder, 'id' | 'rank'>>(orders: T[]): T[] {
  return [...orders].sort((a, b) => {
    const difference = rankOf(a) - rankOf(b);
    if (difference !== 0) return difference;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** The rank for a new order added at the end of the list. */
export function rankForAppend(orders: Pick<ServiceOrder, 'id' | 'rank'>[]): number {
  const ranked = sortByRank(orders).filter((order) => isRank(order.rank));
  const last = ranked[ranked.length - 1];
  return last ? rankOf(last) + RANK_STEP : RANK_STEP;
}

/**
 * The rank that places an order between two neighbours. `null` on either side means the edge
 * of the list. Returns `null` when the gap has collapsed — the caller must renumber instead of
 * writing a rank that cannot hold.
 */
export function rankBetween(before: number | null, after: number | null): number | null {
  if (before === null && after === null) return RANK_STEP;
  if (before === null) return (after as number) - RANK_STEP;
  if (after === null) return before + RANK_STEP;
  if (after - before < MIN_GAP) return null;
  return before + (after - before) / 2;
}

/** True when the list can no longer be reordered by midpoints and needs a clean spread. */
export function needsRenumber(orders: Pick<ServiceOrder, 'id' | 'rank'>[]): boolean {
  const sorted = sortByRank(orders);
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (!isRank(previous.rank) || !isRank(current.rank)) return true;
    if (current.rank - previous.rank < MIN_GAP) return true;
  }
  return false;
}

/** A clean spread over the list as it currently reads. One write per document, done online. */
export function renumber<T extends Pick<ServiceOrder, 'id' | 'rank'>>(
  orders: T[]
): { id: string; rank: number }[] {
  return sortByRank(orders).map((order, index) => ({
    id: order.id,
    rank: (index + 1) * RANK_STEP,
  }));
}

/**
 * The rank an order needs to land at `toIndex` of the list as the person now sees it. The
 * neighbours are taken from the list WITHOUT the moved order, which is what makes "drop it
 * where I am pointing" mean the same thing whether it travelled up or down.
 */
export function rankForMove<T extends Pick<ServiceOrder, 'id' | 'rank'>>(
  orders: T[],
  movedId: string,
  toIndex: number
): number | null {
  const sorted = sortByRank(orders);
  const without = sorted.filter((order) => order.id !== movedId);
  const target = Math.max(0, Math.min(toIndex, without.length));
  const before = target > 0 ? rankOf(without[target - 1]) : null;
  const after = target < without.length ? rankOf(without[target]) : null;
  return rankBetween(before, after);
}

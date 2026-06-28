import {
  pointerWithin,
  rectIntersection,
  type ClientRect,
  type CollisionDetection,
  type UniqueIdentifier,
} from "@dnd-kit/core";

// Structural drop zones on the board. Everything that is NOT one of these is a
// draggable thought card (its id is the raw thought id, with no prefix).
const SECTION_IDS = ["introduction", "main", "conclusion", "ambiguous"];
const ZONE_PREFIXES = ["outline-point-", "outline-gap-", "sub-point-", "unassigned-"];
const SPECIAL_ZONE_IDS = ["dummy-drop-zone", "ambiguous-additional-drop"];

/** True when a droppable id belongs to a thought card (not a structural zone). */
export const isThoughtItemId = (id: string | number): boolean => {
  if (typeof id !== "string") return true; // numeric ids only occur on item droppables
  if (SECTION_IDS.includes(id)) return false;
  if (SPECIAL_ZONE_IDS.includes(id)) return false;
  return !ZONE_PREFIXES.some((prefix) => id.startsWith(prefix));
};

/**
 * Fraction of `target` covered by `dragged` (intersection area / target area, 0..1).
 * This is the "how much of the other card have I covered" measure — matching both the
 * user's "more than half overlaps" intent and SortableJS's swapThreshold (default 0.5).
 */
export const overlapFractionOfTarget = (dragged: ClientRect, target: ClientRect): number => {
  const top = Math.max(dragged.top, target.top);
  const left = Math.max(dragged.left, target.left);
  const right = Math.min(dragged.left + dragged.width, target.left + target.width);
  const bottom = Math.min(dragged.top + dragged.height, target.top + target.height);
  const w = right - left;
  const h = bottom - top;
  if (w <= 0 || h <= 0) return 0;
  const targetArea = target.width * target.height;
  return targetArea > 0 ? (w * h) / targetArea : 0;
};

// Engage a card as the target when the dragged card covers more than half of it
// (SortableJS swapThreshold default = 0.5; matches "more than half overlaps").
const ENGAGE_THRESHOLD = 0.5;
// Hysteresis BAND: once engaged, hold the target until coverage falls below this lower
// bound. Releasing at the same 0.5 would flip-flop at the boundary (one card 0.45, the
// other 0.55) — the documented "swap glitching". Releasing below 0.35 also lets the drop
// move on to zones/gaps/other sections. (The 2-card "collapse onto self" revert is handled
// downstream in handleDragEnd by committing the live preview.)
const HOLD_THRESHOLD = 0.35;
// A competitor must beat the held target by this margin to take over (anti-jitter).
const SWITCH_MARGIN = 0.15;

/**
 * Custom collision detection for the structure board.
 *
 * The default `pointerWithin` resolved the target by the cursor, so reordering depended
 * on the grab point. We instead target the card the dragged card OVERLAPS most, and only
 * once it covers >50% of that card — which matches both the user's intent and the
 * SortableJS swapThreshold standard. A sticky target (hysteresis) prevents the documented
 * "swap glitching" feedback loop: without it, each preview reorder shifts the rects and
 * the pick flip-flops, so a neighbour visibly jitters.
 */
export const createStructureCollisionDetection = () => {
  let activeKey: UniqueIdentifier | null = null;
  let stickyOverId: UniqueIdentifier | null = null;
  let lastLoggedId: UniqueIdentifier | null = null;

  const detect: CollisionDetection = (args) => {
    const { active, droppableContainers, droppableRects, collisionRect } = args;

    if (active.id !== activeKey) {
      activeKey = active.id; // new drag → reset hysteresis
      stickyOverId = null;
      lastLoggedId = null;
    }

    const pointerCollisions = pointerWithin(args);
    const baseCollisions =
      pointerCollisions.length > 0 ? pointerCollisions : rectIntersection(args);

    // Coverage of every card by the dragged card, sorted high → low.
    const coverage = droppableContainers
      .filter((c) => c.id !== active.id && isThoughtItemId(c.id))
      .map((c) => {
        const rect = droppableRects.get(c.id);
        return { id: c.id, frac: rect ? overlapFractionOfTarget(collisionRect, rect) : 0 };
      })
      .filter((c) => c.frac > 0)
      .sort((a, b) => b.frac - a.frac);

    let chosenId: UniqueIdentifier | null = null;

    if (coverage.length > 0) {
      const best = coverage[0];
      const sticky = stickyOverId != null ? coverage.find((o) => o.id === stickyOverId) : undefined;
      // Hold the current target across the hysteresis band, unless another card is covered
      // clearly more — prevents "swap glitching" at the boundary between two cards.
      if (sticky && sticky.frac >= HOLD_THRESHOLD && best.frac - sticky.frac < SWITCH_MARGIN) {
        chosenId = sticky.id;
      } else if (best.frac >= ENGAGE_THRESHOLD) {
        chosenId = best.id;
      } else if (sticky && sticky.frac >= HOLD_THRESHOLD) {
        chosenId = sticky.id;
      }
    }

    // Debug probe (gated on window.__DND_DEBUG): emit the resolved target whenever it
    // changes — a rapid flip-flop in this log IS the "swap glitching" jitter, made visible.
    const dbg = typeof window !== "undefined" && (window as unknown as { __DND_DEBUG?: boolean }).__DND_DEBUG;
    if (dbg && chosenId !== lastLoggedId) {
      const f = coverage[0]?.frac;
      // eslint-disable-next-line no-console
      console.log(`[DND] over → ${chosenId ?? "(zone)"}${typeof f === "number" ? ` cover=${f.toFixed(2)}` : ""}`);
      lastLoggedId = chosenId;
    }

    if (chosenId != null) {
      stickyOverId = chosenId;
      return [{ id: chosenId }];
    }

    // No card engaged → resolve to a structural ZONE only. Returning raw pointer/rect
    // collisions here would let a card become `over` with a tiny overlap (pointer inside it),
    // reintroducing grab-point-dependent reordering and feeding a wrong preview. (Codex P1.)
    stickyOverId = null;
    return baseCollisions.filter((c) => !isThoughtItemId(c.id));
  };

  // Reset hysteresis explicitly at the start of every drag — active.id alone misses the
  // case of dragging the SAME card twice in a row (stale sticky could hold an old target
  // below the engage threshold). (Codex P2.)
  const reset = () => {
    activeKey = null;
    stickyOverId = null;
    lastLoggedId = null;
  };

  return { detect, reset };
};

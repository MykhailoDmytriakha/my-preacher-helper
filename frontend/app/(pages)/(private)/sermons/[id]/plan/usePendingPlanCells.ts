"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { OUTBOX_CHANGED_EVENT } from "@/components/OutboxDrain";
import { pendingPlanTextNodeIds } from "@/services/sermons.client";

import type { Sermon } from "@/models/models";

/**
 * WHICH PLAN CELLS ARE WRITTEN BUT UNSEEN BY ANY SERVER.
 *
 * The legacy queue still protects its original opening and displayed text:
 *
 *   - the baseline must NOT adopt a queued value as "what the server holds" — otherwise the
 *     screen vouches for words no server saw, and a later refusal becomes inescapable;
 *   - the screen SHOWS the queued text, so nobody rewrites their own paragraph blind.
 *
 * Read from the queue rather than tracked as a flag: the queue is the fact. A flag would need
 * releasing correctly on drain, on refusal and on reload, and one missed release holds a cell
 * for ever — the failure mode is silent and permanent, which is the worst kind.
 */
export interface PendingPlanCells {
  nodeIds: Set<string>;
  /** Always current, for predicates that must not re-run an effect to stay fresh. */
  ref: React.MutableRefObject<Set<string>>;
  /**
   * Re-read the queue and RETURN what it says. Call after any write attempt and whenever the
   * sermon changes.
   *
   * It returns the set rather than only storing it because the caller usually needs the answer
   * in the same breath — the seeding effect refreshes and then immediately decides which cells
   * the baseline may adopt. Reading the ref there gets the PREVIOUS value, since a state update
   * has not rendered yet, and the hold silently fails to engage on the one pass that matters.
   */
  refresh: () => Set<string>;
}

const EMPTY: Set<string> = new Set();

export function usePendingPlanCells(sermon: Sermon | null | undefined): PendingPlanCells {
  const [nodeIds, setNodeIds] = useState<Set<string>>(EMPTY);
  const ref = useRef(nodeIds);
  useEffect(() => {
    ref.current = nodeIds;
  }, [nodeIds]);

  const sermonRef = useRef(sermon);
  sermonRef.current = sermon;

  /**
   * Reuse the previous set when the queued cells are unchanged.
   */
  const refresh = useCallback((): Set<string> => {
    const current = sermonRef.current;
    const next = pendingPlanTextNodeIds(current?.userId, current?.id);
    const unchanged = next.size === ref.current.size && [...next].every((id) => ref.current.has(id));
    const answer = unchanged ? ref.current : next;
    // The ref moves NOW, not after a render: callers ask again within the same effect.
    ref.current = answer;
    if (!unchanged) setNodeIds(answer);
    return answer;
  }, []);

  /**
   * THE QUEUE CHANGES WITHOUT THIS SCREEN DOING ANYTHING — listen for it.
   *
   * Draining on reconnect, and "keep mine" / "take theirs" in the conflict banner, all remove
   * entries. Nothing here would notice: the set would keep calling a cell queued, so the
   * baseline would refuse to adopt text the server had already confirmed, the durable draft
   * would keep covering confirmed text after every reload, and the next save would be refused for a
   * reason that no longer existed.
   */
  useEffect(() => {
    const onChanged = () => refresh();
    window.addEventListener(OUTBOX_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(OUTBOX_CHANGED_EVENT, onChanged);
  }, [refresh]);

  /**
   * ONE OBJECT PER STATE, not one per render. Both screens list this among an effect's
   * dependencies, and a fresh literal each render makes that effect run on every render — it
   * sets state, which renders, which runs it again. The same trap already killed the baseline
   * hook once, with the page dying of an exhausted heap before anything reached storage.
   */
  return useMemo(() => ({ nodeIds, ref, refresh }), [nodeIds, refresh]);
}

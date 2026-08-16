"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { isOfflineQueuedError } from "@/services/conflictSafeUpdate.client";
import { updateSermonOutline } from "@/services/outline.service";
import {
  planTextConflictValues,
  savePlanModeViaClient,
  savePlanTextViaClient,
} from "@/services/sermons.client";
import { updateThought } from "@/services/thought.service";
import { newClientId } from "@/utils/clientId";
import { debugLog } from "@/utils/debugMode";
import { readPlanText } from "@/utils/planText";
import { normalizeCapitalizedTitle } from "@/utils/textNormalization";
import { writeFailureTranslationKey } from "@/utils/writeRecovery";

import { usePlanTextBaseline } from "../planTextBaseline";
import { usePendingPlanCells } from "../usePendingPlanCells";

import type { SermonSectionKey } from "../types";
import type { Sermon, SermonOutline, SermonPoint } from "@/models/models";

/**
 * EVERY WRITE THE HAND-WRITTEN PLAN MAKES — and there are only two kinds now.
 *
 *   TEXT     → `planText.<nodeId>`, one key per node, through the client SDK
 *   SKELETON → `sermon.outline`, through `updateSermonOutline`, merged by point id
 *
 * This hook used to carry a serialized write queue, a carry-forward of the last written
 * section, an assembly pass against a chosen skeleton, and a compensating rollback. All of
 * it existed to stop one save from overwriting another and to keep a STORED assembled
 * document in step with the data. Neither problem exists any more: a leaf-path write cannot
 * touch a neighbouring key, and the document is assembled at read time (`utils/planText.ts`).
 *
 * What is left is what the work actually is: put text under a node, add a node, remove a
 * node. The ordering rules below are the only subtlety, and each says why it is that way.
 */

interface UseManualConspectusParams {
  sermon: Sermon | null;
  setSermon: (updater: (previous: Sermon | null) => Sermon | null) => unknown;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export interface ManualConspectus {
  contentByNodeId: Record<string, string>;
  savedNodeIds: Record<string, boolean>;
  modifiedNodeIds: Record<string, boolean>;
  /** Cells whose write is queued offline — unconfirmed however clean the screen looks. */
  pendingNodeIds: Set<string>;
  setNodeContent: (nodeId: string, text: string) => void;
  /** Put recovered cells back into the editor, marked unsaved so they will be written. */
  restoreCells: (cells: Record<string, string>) => void;
  savePoint: (pointId: string, section: SermonSectionKey, nodeIds: string[]) => Promise<void>;
  addPoint: (section: SermonSectionKey, title: string) => void;
  addSubPoint: (pointId: string, title: string) => void;
  /** Rename a point or sub-point where its text is written — empty names are refused. */
  renamePoint: (pointId: string, title: string) => void;
  renameSubPoint: (pointId: string, subPointId: string, title: string) => void;
  deletePoint: (pointId: string) => Promise<void>;
  deleteSubPoint: (pointId: string, subPointId: string) => Promise<void>;
  /** Persists every cell still holding unsaved text. False means something refused. */
  saveModified: () => Promise<boolean>;
}

const emptyOutline = (): SermonOutline => ({ introduction: [], main: [], conclusion: [] });

export function useManualConspectus({
  sermon,
  setSermon,
  t,
}: UseManualConspectusParams): ManualConspectus {
  const [contentByNodeId, setContentByNodeId] = useState<Record<string, string>>({});
  const [savedNodeIds, setSavedNodeIds] = useState<Record<string, boolean>>({});
  const [modifiedNodeIds, setModifiedNodeIds] = useState<Record<string, boolean>>({});

  /** What the server held for each cell when this screen took it — see `planTextBaseline.ts`. */
  const baseline = usePlanTextBaseline(sermon?.id);

  /** Cells whose write sits in the offline queue — see `usePendingPlanCells`. */
  const { nodeIds: pendingNodeIds, ref: pendingRef, refresh: refreshPending } =
    usePendingPlanCells(sermon);

  const sermonRef = useRef<Sermon | null>(sermon);
  useEffect(() => {
    sermonRef.current = sermon;
  }, [sermon]);

  /**
   * The cells as they are RIGHT NOW. A save takes a moment and people keep typing while it
   * flies; marking a node "saved" on the answer alone declared text that was never sent,
   * and the next departure then left without it.
   */
  const contentRef = useRef(contentByNodeId);
  useEffect(() => {
    contentRef.current = contentByNodeId;
  }, [contentByNodeId]);

  /**
   * WRITES FOR THE SAME NODE GO IN ORDER, AND EACH READS THE TEXT AT ITS TURN.
   *
   * Pressing Save twice does not queue two requests politely: the answers can come back in
   * either order, and the older one landing last rewrote `planText.<id>` with the earlier
   * text — while the newer edit had already been marked clean, so nothing looked wrong.
   *
   * This is NOT the section-wide queue that was removed: leaf writes to DIFFERENT nodes
   * still proceed freely. Only the ordering of writes is fixed, and the payload is taken
   * when the turn comes, so the last write always carries the latest text.
   */
  const writeChainRef = useRef<Promise<unknown>>(Promise.resolve());

  /** Which cells hold unsaved edits — read by the seeding effect without re-running it. */
  const modifiedRef = useRef(modifiedNodeIds);
  useEffect(() => {
    modifiedRef.current = modifiedNodeIds;
  }, [modifiedNodeIds]);

  /**
   * The skeleton this screen OPENED with. `updateSermonOutline` merges against it by point
   * id, which is what lets a point added on a phone survive a save from a laptop that never
   * saw it. Only an answered save may advance it.
   */
  const confirmedOutlineRef = useRef<SermonOutline | null | undefined>(undefined);
  useEffect(() => {
    confirmedOutlineRef.current = undefined;
  }, [sermon?.id]);

  /**
   * Seed the cells from storage — understanding BOTH shapes, because production and local
   * share one database and a sermon stays in the old shape until its first save. Local
   * edits win over the seed: a refresh must not wipe what is being typed.
   */
  useEffect(() => {
    // The baseline follows storage even when there is nothing to seed: an empty map is still
    // the answer to "what did the server have", and a cell first written elsewhere must not
    // be silently overwritten just because this screen opened before it existed.
    //
    // A cell is skipped when it is being TYPED INTO or when its write is still QUEUED. The
    // second is easy to miss and costly: the queued text is mirrored into the sermon so the
    // screen keeps showing it, and adopting that mirror would make this screen vouch for words
    // no server has seen.
    const queued = refreshPending();
    baseline.adopt(
      sermonRef.current,
      (nodeId) => Boolean(modifiedRef.current[nodeId]) || queued.has(nodeId)
    );

    const stored = readPlanText(sermonRef.current);
    if (Object.keys(stored).length === 0) return;

    /**
     * STORAGE WINS EXCEPT WHERE SOMETHING IS BEING TYPED.
     *
     * Laying the screen over storage unconditionally meant a save made on the phone could
     * never arrive: it landed in the sermon and was immediately covered by this screen's
     * older copy, even for cards nobody had touched. Only a cell with unsaved edits may
     * outrank what storage holds.
     */
    setContentByNodeId((previous) => {
      const next = { ...previous, ...stored };
      Object.keys(previous).forEach((nodeId) => {
        /**
         * QUEUED COUNTS THE SAME AS BEING TYPED INTO.
         *
         * Only "modified" used to survive here, so an offline save — which settles its cells —
         * lost its protection the moment anything refreshed the sermon: storage handed back the
         * older paragraph, the person rewrote it not knowing what they already had, and the
         * replay then buried the first version. The baseline already knew about queued cells;
         * the text on screen has to know it too, or the two disagree about the same cell.
         */
        if (modifiedRef.current[nodeId] || queued.has(nodeId)) next[nodeId] = previous[nodeId];
      });
      return next;
    });
    setSavedNodeIds((previous) => ({
      ...Object.fromEntries(Object.keys(stored).map((id) => [id, true])),
      ...previous,
    }));
  }, [baseline, refreshPending, sermon?.planText, sermon?.plan]);

  /**
   * WHAT THE SERVER TURNED OUT TO HOLD, kept until the person decides what to do about it.
   *
   * Deliberately NOT adopted on arrival. Adopting immediately made "press Save again means mine
   * wins" true in a way nobody agreed to: two quick presses are both already queued, so the
   * second one ran with the freshly adopted baseline and overwrote the other device before the
   * warning had even been read. Consent has to be an act taken AFTER the message, which is what
   * the button below is.
   */
  const contestedRef = useRef<Record<string, string | null>>({});

  /** Is this a conflict rather than an ordinary failure? Remembers what the server holds. */
  const isConflict = useCallback((error: unknown): boolean => {
    const theirs = planTextConflictValues(error);
    if (!theirs) return false;
    contestedRef.current = { ...contestedRef.current, ...theirs };
    debugLog("Manual plan save refused: another device holds newer text", { nodes: Object.keys(theirs) });
    return true;
  }, []);

  /** `saveModified` re-entered from the message below, without a circular dependency. */
  const saveModifiedRef = useRef<(() => Promise<boolean>) | null>(null);

  const announceRefusal = useCallback(() => {
    toast.error(t("plan.saveRefusedByOtherDevice"), {
      // A conflict is not a passing notice: it stays until answered, and one at a time.
      id: "plan-save-refused",
      duration: Infinity,
      action: {
        label: t("plan.saveRefusedKeepMine"),
        onClick: () => {
          // NOW the baseline moves — because the person read the message and chose. The next
          // write states what the server really holds, so it is accepted and theirs is replaced.
          baseline.observe(contestedRef.current);
          contestedRef.current = {};
          void saveModifiedRef.current?.();
        },
      },
    });
  }, [baseline, t]);

  const setNodeContent = useCallback((nodeId: string, text: string) => {
    setContentByNodeId((previous) => ({ ...previous, [nodeId]: text }));
    setModifiedNodeIds((previous) => ({ ...previous, [nodeId]: true }));
  }, []);

  /**
   * Writes the given nodes' text, each under its own key, and mirrors it into the sermon in
   * memory. Separate keys cannot collide, so no ordering is needed BETWEEN nodes — but the
   * same node saved from two devices still races, which is what the stated baseline settles.
   */
  const writeText = useCallback(async (
    changedText: Record<string, string>,
    removedNodeIds: string[] = []
  ) => {
    const currentSermon = sermonRef.current;
    if (!currentSermon) return;

    /**
     * THE MIRROR HOLDS WHAT STORAGE HOLDS — the stored map plus what was just written, and
     * NOT the merged read. Folding the legacy cells in made every one of them look written
     * the moment anything was saved, and `renderPlanWithFallback` reads exactly that to
     * decide whether a section is still being served from its old assembled string: one save
     * anywhere turned the fallback off everywhere, and untouched old sections went blank.
     */
    const mirror = () => setSermon((previous) => {
      if (!previous) return previous;
      const nextText = { ...(previous.planText ?? {}), ...changedText };
      removedNodeIds.forEach((nodeId) => { delete nextText[nodeId]; });
      return { ...previous, planText: nextText };
    });

    /**
     * A QUEUED WRITE IS MIRRORED TOO — and the baseline is what keeps that honest.
     *
     * Not mirroring it was tried, and it cost text: after closing and reopening offline the
     * screen showed the OLD paragraph, so the person rewrote it blind, and the replay then
     * buried the version written on the train without a word to anyone. Mirroring alone was
     * also wrong — `adopt` reads this map to decide what the SERVER holds, so the screen began
     * vouching for words no server had seen, and a later refusal became inescapable.
     *
     * Both are answered by holding the baseline for cells whose write is still queued
     * (`pendingPlanTextNodeIds`): the screen shows what was written, and the guard keeps
     * judging by the last thing the server actually confirmed.
     */
    try {
      await savePlanTextViaClient(currentSermon.id, changedText, removedNodeIds, {
        userId: currentSermon.userId,
        baselineByNodeId: baseline.forNodes(Object.keys(changedText)),
      });
    } catch (error) {
      if (isOfflineQueuedError(error)) {
        refreshPending();
        await mirror();
      }
      throw error;
    }

    /**
     * THE FIRST SAVE FROM THIS EDITOR RECORDS THAT THE PLAN LIVES HERE.
     *
     * Otherwise the toggle is the only way to say it, and nobody discovers a toggle they have
     * no reason to look for: every shortcut kept opening the paired screen, where this plan's
     * sub-point text is not shown at all. Only when NOTHING is recorded — an explicit choice is
     * never overruled by merely typing.
     */
    if (!currentSermon.planMode) {
      savePlanModeViaClient(currentSermon.id, 'manual')
        .then(() => setSermon((previous) => (previous ? { ...previous, planMode: 'manual' } : previous)))
        .catch((error) => debugLog("Recording the plan editor failed — harmless", { error }));
    }

    baseline.confirm(changedText);
    baseline.forget(removedNodeIds);
    /**
     * A CELL THAT JUST SAVED IS NO LONGER CONTESTED, and forgetting to say so costs a false
     * conflict later: a batch refused because of ONE card reports the server's values for ALL of
     * them, the retry then saves the innocent ones, and "keep mine" would roll their baseline
     * back to a value that is two saves old — refusing this screen's own next edit.
     */
    Object.keys(changedText).forEach((nodeId) => { delete contestedRef.current[nodeId]; });
    refreshPending();
    await mirror();
  }, [baseline, refreshPending, setSermon]);

  /**
   * Marks as saved only the nodes whose text still matches what was actually sent, and
   * RETURNS the ones that did not — someone kept typing while the write was in flight.
   *
   * The count cannot be read back from state here: `setModifiedNodeIds` has not rendered
   * yet, so a ref would still hold the pre-save value and report everything as unsaved.
   */
  const settle = useCallback((sent: Record<string, string>): string[] => {
    const settled = Object.keys(sent).filter((id) => (contentRef.current[id] ?? "") === sent[id]);
    setSavedNodeIds((previous) => ({
      ...previous,
      ...Object.fromEntries(settled.map((id) => [id, true])),
    }));
    setModifiedNodeIds((previous) => ({
      ...previous,
      ...Object.fromEntries(settled.map((id) => [id, false])),
    }));

    return Object.keys(sent).filter((id) => !settled.includes(id));
  }, []);

  const savePoint = useCallback(async (
    pointId: string,
    _section: SermonSectionKey,
    nodeIds: string[]
  ) => {
    // Declared out here so the offline branch below can settle exactly what was sent.
    let sent: Record<string, string> = {};
    try {
      /**
       * ONLY THE CELLS THIS SCREEN ACTUALLY CHANGED.
       *
       * Sending every cell of the point looked harmless — they are separate keys — but a key
       * sent is a key overwritten. A sub-point edited on the phone was destroyed by pressing
       * Save on the laptop for its parent, because the untouched, stale sub-point text rode
       * along. Leaf paths protect neighbours only if neighbours are not in the payload.
       *
       * A cell that was never modified here has nothing to contribute; if nothing was
       * modified at all, the point's own cell is sent so pressing Save still means something.
       */
      const changed = nodeIds.filter((id) => modifiedNodeIds[id]);
      const toSend = changed.length > 0 ? changed : [pointId];

      // The payload is built when the turn comes, not when the button was pressed: a second
      // press while the first is in flight then writes the CURRENT text, not a stale copy.
      const run = async () => {
        sent = Object.fromEntries(toSend.map((id) => [id, contentRef.current[id] ?? ""]));
        await writeText(sent);
        settle(sent);
      };

      const queued = writeChainRef.current.then(run, run);
      writeChainRef.current = queued.catch(() => undefined);
      await queued;

      toast.success(t("plan.pointSaved"));
    } catch (error) {
      /**
       * QUEUED IS NOT REFUSED. Offline the guard cannot compare anything, so it stores the
       * intent in the durable outbox and says so by throwing. The text is owned by something
       * that survives a closed tab and will be replayed through the same guard on reconnect —
       * so the cells stop counting as unsaved, and nobody is told their work failed. It is
       * also not announced as saved: the server has never seen it.
       */
      if (isOfflineQueuedError(error)) {
        settle(sent);
        toast.info(t("connection.offlineBanner"));
        return;
      }
      /**
       * A REFUSAL IS AN ANSWER, NOT A WALL — but the way out is a button in the message, not
       * the next press. The cells stay unsaved with the text on screen; nothing is overwritten
       * until the person reads what happened and says "keep mine".
       */
      if (isConflict(error)) {
        announceRefusal();
        return;
      }
      debugLog("Manual plan save failed", { pointId, error });
      toast.error(t(writeFailureTranslationKey(error, "errors.failedToSavePoint")));
    }
  }, [announceRefusal, contentByNodeId, isConflict, modifiedNodeIds, settle, t, writeText]);

  const saveModified = useCallback(async (): Promise<boolean> => {
    const dirty = Object.entries(modifiedNodeIds).filter(([, isDirty]) => isDirty).map(([id]) => id);
    if (dirty.length === 0) return true;

    /**
     * ONE WRITE FIRST, AND CELL BY CELL ONLY IF THAT ONE IS REFUSED.
     *
     * Both extremes were tried and both were wrong. Sending everything in one transaction made
     * a single conflicting card refuse ALL of them, so paragraphs nobody else had touched
     * failed to save on the way out. Sending each cell separately fixed that and bought it with
     * a round trip per cell — thirty unsaved cards became thirty transactions, which on a phone
     * is a navigation that hangs for half a minute.
     *
     * The two only conflict while the write is assumed to fail. It almost never does: the happy
     * path is one write, and the expensive per-cell pass runs exactly when it earns its cost —
     * after a refusal, to find WHICH card is actually in conflict and save the rest.
     */
    const outcome = { saved: true, refused: false, queued: false, failed: undefined as unknown };

    const attempt = async (nodeIds: string[]): Promise<'ok' | 'refused' | 'queued' | 'failed'> => {
      let sent: Record<string, string> = {};
      try {
        // Same ordering guarantee as savePoint — and the same "read the text at your turn".
        const run = async () => {
          sent = Object.fromEntries(nodeIds.map((id) => [id, contentRef.current[id] ?? ""]));
          await writeText(sent);
        };
        const queued = writeChainRef.current.then(run, run);
        writeChainRef.current = queued.catch(() => undefined);
        await queued;

        /**
         * "SAVED" MEANS NOTHING IS LEFT UNSAVED — not "the request succeeded".
         *
         * A departure calls this and travels on `true`. If someone kept typing while the write
         * was in flight, that newer text was never sent — and answering `true` walked away
         * from it. Reporting the real state keeps the caller here, where pressing again saves
         * what is now on screen.
         */
        if (settle(sent).length > 0) outcome.saved = false;
        return 'ok';
      } catch (error) {
        // Offline the outbox has the text and will replay it — leaving is safe.
        if (isOfflineQueuedError(error)) {
          outcome.queued = true;
          if (settle(sent).length > 0) outcome.saved = false;
          return 'queued';
        }
        if (isConflict(error)) {
          outcome.refused = true;
          outcome.saved = false;
          return 'refused';
        }
        outcome.failed = error;
        outcome.saved = false;
        return 'failed';
      }
    };

    const together = await attempt(dirty);
    if (together === 'refused' && dirty.length > 1) {
      // The batch named no culprit, so ask each cell in turn: the ones nobody else touched
      // still save, and only the genuinely conflicting card is left unsaved and reported.
      outcome.refused = false;
      for (const nodeId of dirty) {
        if (await attempt([nodeId]) === 'failed') break;
      }
    }

    if (outcome.failed !== undefined) {
      debugLog("Saving before leaving failed", { error: outcome.failed });
      toast.error(t(writeFailureTranslationKey(outcome.failed, "errors.failedToSavePoint")));
      return false;
    }
    // One message for the whole departure, not one per cell.
    if (outcome.queued) toast.info(t("connection.offlineBanner"));
    if (outcome.refused) announceRefusal();
    return outcome.saved;
  }, [announceRefusal, contentByNodeId, isConflict, modifiedNodeIds, settle, t, writeText]);

  // Wired after definition so the refusal message can re-enter it without a circular hook.
  saveModifiedRef.current = saveModified;

  /** Returns whether the skeleton actually reached storage — deletions need the answer. */
  const persistOutline = useCallback(async (nextOutline: SermonOutline): Promise<boolean> => {
    const currentSermon = sermonRef.current;
    if (!currentSermon) return false;

    if (confirmedOutlineRef.current === undefined) {
      confirmedOutlineRef.current = currentSermon.outline ?? null;
    }
    const baseOutline = confirmedOutlineRef.current;
    const previousOutline = currentSermon.outline;

    await setSermon((previous) => (previous ? { ...previous, outline: nextOutline } : previous));

    try {
      const saved = await updateSermonOutline(currentSermon.id, nextOutline, baseOutline, "preferMine");
      if (saved) {
        confirmedOutlineRef.current = saved;
        await setSermon((previous) => (previous ? { ...previous, outline: saved } : previous));
      }
      return true;
    } catch (error) {
      debugLog("Manual plan outline write failed", { sermonId: currentSermon.id, error });
      await setSermon((previous) => (previous ? { ...previous, outline: previousOutline } : previous));
      toast.error(t(writeFailureTranslationKey(error, "errors.failedToSaveOutline")));
      return false;
    }
  }, [setSermon, t]);

  /**
   * A DELETED NODE MUST NOT KEEP THOUGHTS ATTACHED TO IT — the structure editor detaches
   * them, and this screen deletes the same nodes. Left attached, a thought points at
   * something that no longer exists: invisible everywhere, and reported as an orphan
   * nobody can go and find.
   */
  const detachThoughtsFrom = useCallback((
    matches: (thought: Sermon["thoughts"][number]) => boolean,
    clear: "point" | "subPoint"
  ) => {
    const currentSermon = sermonRef.current;
    if (!currentSermon) return;

    const affected = (currentSermon.thoughts ?? []).filter(matches);
    if (affected.length === 0) return;

    const detach = (thought: Sermon["thoughts"][number]) => (clear === "point"
      ? { ...thought, outlinePointId: null, subPointId: null }
      : { ...thought, subPointId: null });

    void setSermon((previous) => (previous
      ? { ...previous, thoughts: previous.thoughts.map((thought) => (matches(thought) ? detach(thought) : thought)) }
      : previous));

    affected.forEach((thought) => {
      updateThought(currentSermon.id, detach(thought) as typeof thought, thought)
        .catch((error) => debugLog("Detaching a thought from a deleted node failed", { id: thought.id, error }));
    });
  }, [setSermon]);

  const sectionOfPoint = useCallback((pointId: string): SermonSectionKey | null => {
    const outline = sermonRef.current?.outline;
    if (!outline) return null;
    const sections: SermonSectionKey[] = ["introduction", "main", "conclusion"];
    return sections.find((section) =>
      (outline[section] ?? []).some((point) => point.id === pointId)
    ) ?? null;
  }, []);

  const mapPoints = (
    outline: SermonOutline,
    change: (points: SermonPoint[]) => SermonPoint[]
  ): SermonOutline => ({
    introduction: change(outline.introduction ?? []),
    main: change(outline.main ?? []),
    conclusion: change(outline.conclusion ?? []),
  });

  const addPoint = useCallback((section: SermonSectionKey, title: string) => {
    const text = normalizeCapitalizedTitle(title);
    if (!text) return;

    // Never build the next skeleton from one that is not loaded: against a merge that reads
    // "in the baseline, absent from mine" as a deletion, an empty fallback is an instruction
    // to delete every point.
    const currentSermon = sermonRef.current;
    if (!currentSermon) return;

    const outline = currentSermon.outline ?? emptyOutline();
    // Only the skeleton is written. The document is assembled at read time, so the new point
    // shows up everywhere at once — no second write to keep a stored copy in step.
    void persistOutline({
      ...emptyOutline(),
      ...outline,
      [section]: [...(outline[section] ?? []), { id: newClientId(), text }],
    });
  }, [persistOutline]);

  /**
   * RENAMING BELONGS WHERE THE TEXT IS WRITTEN.
   *
   * A point's wording is refined while filling it in — that is when you discover what it is
   * actually about. Without this the only way to change a heading was to leave for the
   * structure editor and come back, which is why plans here carried headings their author had
   * already outgrown.
   *
   * An empty name is refused rather than stored: a nameless point is unreachable in every
   * list, and "I cleared the field" is never a request for that.
   */
  const renamePoint = useCallback((pointId: string, title: string) => {
    const text = normalizeCapitalizedTitle(title);
    const outline = sermonRef.current?.outline;
    if (!text || !outline) return;
    void persistOutline(mapPoints(outline, (points) => points.map((point) => (
      point.id === pointId ? { ...point, text } : point
    ))));
  }, [persistOutline]);

  const renameSubPoint = useCallback((pointId: string, subPointId: string, title: string) => {
    const text = normalizeCapitalizedTitle(title);
    const outline = sermonRef.current?.outline;
    if (!text || !outline) return;
    void persistOutline(mapPoints(outline, (points) => points.map((point) => (
      point.id === pointId
        ? {
            ...point,
            subPoints: (point.subPoints ?? []).map((sub) => (
              sub.id === subPointId ? { ...sub, text } : sub
            )),
          }
        : point
    ))));
  }, [persistOutline]);

  const addSubPoint = useCallback((pointId: string, title: string) => {
    const text = normalizeCapitalizedTitle(title);
    if (!text) return;

    const outline = sermonRef.current?.outline;
    if (!outline) return;

    // Positions spaced by 1000 so a later drag can land between neighbours without
    // renumbering the rest — the same spacing the structure editor uses.
    void persistOutline(mapPoints(outline, (points) => points.map((point) => {
      if (point.id !== pointId) return point;
      const existing = point.subPoints ?? [];
      const maxPosition = existing.length > 0 ? Math.max(...existing.map((sub) => sub.position)) : 0;
      return {
        ...point,
        subPoints: [...existing, { id: newClientId(), text, position: maxPosition + 1000 }],
      };
    })));
  }, [persistOutline]);

  /**
   * TEXT FIRST HERE, because this deletion RESCUES text into the point above. Were the
   * skeleton written first, a failure on the text write would take the sub-point away and
   * the rescued words with it. This order's worst case is survivable: the sub-point stays,
   * now empty, and its words are already safe in the parent.
   */
  const deleteSubPoint = useCallback(async (pointId: string, subPointId: string) => {
    const outline = sermonRef.current?.outline;
    if (!outline) return;

    const rescued = (contentByNodeId[subPointId] ?? "").trim();
    const mergedParent = [contentByNodeId[pointId] ?? "", rescued]
      .map((part) => part.trim())
      .filter(Boolean)
      .join("\n\n");

    /**
     * ONE WRITE, NOT TWO — the rescue and the emptying travel together.
     *
     * Splitting them created a window with the words in BOTH places: the parent already held
     * the rescued paragraph while the sub-point still held its copy, so a failure in between
     * — or a retry — duplicated the text. Offline it was worse: the guarded half was queued
     * and the cleanup half never ran at all, and the replay later added the paragraph to a
     * parent whose sub-point was still standing.
     *
     * The sub-point's cell is BLANKED rather than deleted here, and that is what makes one
     * write possible: `deleteField()` is a sentinel object that cannot survive the outbox's
     * JSON, while an empty string survives anything. The now-empty key is swept up below, and
     * that sweep is free to fail — the meaningful part already happened.
     */
    /**
     * NOTHING TO RESCUE MEANS NOTHING TO WRITE — and that is not a micro-optimisation.
     *
     * Writing `planText.<parent> = ""` marks the section as MAINTAINED IN THE NEW SHAPE
     * (`planText.ts` → `sectionWasWritten`), which switches off the fallback that still serves
     * an old sermon its stored assembled section. Deleting an empty sub-point from a sermon
     * that has never had per-node text would therefore make the whole introduction vanish from
     * reading, preaching and export — while it sat untouched in Firestore.
     *
     * So an empty sub-point is pure cleanup: remove its key, touch nothing else. Only a real
     * rescue writes, and then the flag flipping is correct, because the parent really does hold
     * text now.
     */
    const rescuing = rescued !== "" && mergedParent !== (contentByNodeId[pointId] ?? "");
    try {
      if (rescuing) await writeText({ [pointId]: mergedParent, [subPointId]: "" });
    } catch (error) {
      if (!isOfflineQueuedError(error)) {
        debugLog("Sub-point delete: text rescue failed, skeleton left intact", { subPointId, error });
        toast.error(t(writeFailureTranslationKey(error, "errors.failedToSavePoint")));
        return;
      }
      /**
       * QUEUED IS OWNED. Treating it as a failure returned before the structure was touched, so
       * the replay later merged the rescued words into a parent whose sub-point was still
       * standing — a deletion the person asked for, left half done until they did it again.
       */
      debugLog("Sub-point delete: rescue queued offline, continuing with the structure", { subPointId });
    }

    setContentByNodeId((previous) => {
      const next = { ...previous, [pointId]: mergedParent };
      delete next[subPointId];
      return next;
    });

    const removed = await persistOutline(mapPoints(outline, (points) => points.map((point) => (
      point.id === pointId
        ? { ...point, subPoints: (point.subPoints ?? []).filter((sub) => sub.id !== subPointId) }
        : point
    ))));
    if (removed) {
      detachThoughtsFrom((thought) => thought.subPointId === subPointId, "subPoint");
      // Sweeping the emptied key is tidiness, not correctness — it already holds nothing, and
      // nothing reads the text of a node that is gone from the structure.
      await writeText({}, [subPointId]).catch((error) =>
        debugLog("Sub-point delete: sweeping the emptied key failed — harmless", { subPointId, error }));
    }
  }, [contentByNodeId, detachThoughtsFrom, persistOutline, t, writeText]);

  /**
   * SKELETON FIRST HERE, the opposite of a sub-point deletion, because this one DROPS text
   * instead of rescuing it. Clearing the text first and failing on the skeleton left the
   * point standing and its writing gone for good.
   *
   * A failure on the SECOND write is now harmless, and that is the whole gain of the new
   * shape: text whose node is gone is never read — assembly walks the structure — so the
   * worst case is an unused key. No compensating rollback is needed, and the one that used
   * to live here was itself dangerous: it re-sent an outline built before the server's
   * answer, which a three-way merge could read as deleting a point added elsewhere.
   */
  const deletePoint = useCallback(async (pointId: string) => {
    const outline = sermonRef.current?.outline;
    const section = sectionOfPoint(pointId);
    if (!outline || !section) return;

    const point = (outline[section] ?? []).find((candidate) => candidate.id === pointId);
    const removedNodeIds = [pointId, ...((point?.subPoints ?? []).map((sub) => sub.id))];

    const removed = await persistOutline(
      mapPoints(outline, (points) => points.filter((candidate) => candidate.id !== pointId))
    );
    if (!removed) return;

    detachThoughtsFrom((thought) => thought.outlinePointId === pointId, "point");

    setContentByNodeId((previous) => {
      const next = { ...previous };
      removedNodeIds.forEach((nodeId) => { delete next[nodeId]; });
      return next;
    });

    try {
      await writeText({}, removedNodeIds);
    } catch (error) {
      debugLog("Point delete: node gone, clearing its text failed — harmless", { pointId, error });
    }
  }, [detachThoughtsFrom, persistOutline, sectionOfPoint, writeText]);

  /**
   * Recovered cells come back marked UNSAVED, which is the whole point: they were never
   * confirmed, so the screen must keep saying so until a save actually succeeds.
   */
  const restoreCells = useCallback((cells: Record<string, string>) => {
    setContentByNodeId((previous) => ({ ...previous, ...cells }));
    setModifiedNodeIds((previous) => ({
      ...previous,
      ...Object.fromEntries(Object.keys(cells).map((nodeId) => [nodeId, true])),
    }));
  }, []);

  return {
    contentByNodeId,
    savedNodeIds,
    modifiedNodeIds,
    pendingNodeIds,
    setNodeContent,
    restoreCells,
    savePoint,
    addPoint,
    addSubPoint,
    renamePoint,
    renameSubPoint,
    deletePoint,
    deleteSubPoint,
    saveModified,
  };
}

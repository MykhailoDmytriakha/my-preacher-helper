import { useCallback, useRef } from "react";
import { toast } from "sonner";

import { PlanStyle } from "@/api/clients/openAI.client";
import { Sermon } from "@/models/models";
import { isOfflineQueuedError } from "@/services/conflictSafeUpdate.client";
import {
  planTextConflictValues,
  savePlanModeViaClient,
  savePlanTextViaClient,
} from "@/services/sermons.client";
import { isUsageCapReachedError } from "@/services/usageLimits";
import { debugLog } from "@/utils/debugMode";
import { getVisualOrderedThoughtsForOutlinePoint } from "@/utils/sermonVisualOrder";
import { writeFailureTranslationKey } from "@/utils/writeRecovery";

import { generatePlanPointContent } from "./planApi";
import { getPointFromLookup, getPointSectionFromLookup } from "./planOutlineLookup";

import type { PlanOutlineLookup } from "./planOutlineLookup";
import type { PlanTextBaseline } from "./planTextBaseline";
import type { SermonSectionKey } from "./types";

interface UsePlanActionsParams {
  sermon: Sermon | null;
  planStyle: PlanStyle;
  outlineLookup: PlanOutlineLookup;
  generatedContent: Record<string, string>;
  t: (key: string, options?: Record<string, unknown>) => string;
  setGeneratingIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onGenerated: (params: {
    outlinePointId: string;
    content: string;
    section: SermonSectionKey;
  }) => void;
  onSaved: (params: {
    outlinePointId: string;
    /** Every cell this save wrote, so the screen can clear "modified" on all of them. */
    savedNodeIds: string[];
    section: SermonSectionKey;
    /** Exactly what this save wrote, so the screen can tell mid-flight edits apart. */
    sentText?: Record<string, string>;
  }) => Promise<void> | void;
  onAiSuccess?: () => Promise<void> | void;
  aiBlocked?: boolean;
  /**
   * What the server held for each cell when this screen took it. Without it the write goes
   * through unguarded — which is what this screen used to do, and how a paragraph saved on a
   * phone was replaced by the laptop's older copy with nothing reported anywhere.
   */
  planTextBaseline?: PlanTextBaseline;
}

export default function usePlanActions({
  sermon,
  planStyle,
  outlineLookup,
  generatedContent,
  t,
  setGeneratingIds,
  onGenerated,
  onSaved,
  onAiSuccess,
  aiBlocked = false,
  planTextBaseline,
}: UsePlanActionsParams) {
  /** Saves run one after another, so each states the baseline its predecessor confirmed. */
  const writeChainRef = useRef<Promise<unknown>>(Promise.resolve());
  /** The cells as they are RIGHT NOW, for actions taken long after a save was attempted. */
  const generatedContentRef = useRef(generatedContent);
  generatedContentRef.current = generatedContent;
  /** Re-entry for the "keep mine" button, without a circular hook dependency. */
  const saveSermonPointRef = useRef<
    ((id: string, cells: Record<string, string>, section: SermonSectionKey) => Promise<void>) | null
  >(null);

  const generateSermonPointContent = useCallback(async (outlinePointId: string) => {
    if (aiBlocked || !sermon) return;

    setGeneratingIds((prev) => ({
      ...prev,
      [outlinePointId]: true,
    }));

    try {
      const outlinePoint = getPointFromLookup(outlineLookup, outlinePointId);
      const section = getPointSectionFromLookup(outlineLookup, outlinePointId);

      if (!outlinePoint || !section) {
        toast.error(t("errors.outlinePointNotFound"));
        return;
      }

      /**
       * NOTHING TO GENERATE FROM IS NOT A FAILURE.
       *
       * The server answers a point with no thoughts with a 400, which arrived here as
       * the generic "generation failed" — and that reads as a broken feature on exactly
       * the screen where a plan gets written by hand. Answered before the request goes
       * out: no AI call spent, and the message names the reason and the way forward.
       */
      if (getVisualOrderedThoughtsForOutlinePoint(sermon, outlinePointId).length === 0) {
        toast.info(t("plan.noThoughtsToGenerate"));
        return;
      }

      const { content } = await generatePlanPointContent({
        sermonId: sermon.id,
        outlinePointId,
        style: planStyle,
      });

      onGenerated({
        outlinePointId: outlinePoint.id,
        content,
        section,
      });
      await onAiSuccess?.();

      toast.success(t("plan.contentGenerated"));
    } catch (error) {
      debugLog("Plan generate failed", { sermonId: sermon.id, outlinePointId, error });
      if (isUsageCapReachedError(error)) return;
      toast.error(t("errors.failedToGenerateContent"));
    } finally {
      setGeneratingIds((prev) => {
        const { [outlinePointId]: _finishedPoint, ...next } = prev;
        return next;
      });
    }
  }, [aiBlocked, onAiSuccess, onGenerated, outlineLookup, planStyle, sermon, setGeneratingIds, t]);

  /**
   * Saves one outline point — meaning ALL of its cells at once (`planNodes.ts`).
   *
   * `contentByNodeId` is keyed by the point's own id and by each sub-point's id. Sending a
   * single string here, as this once did, stored the point's own text and silently dropped
   * everything written under its sub-points.
   *
   * The write is now one key per node, straight through the client SDK. What it replaced
   * rebuilt the WHOLE section — its markdown and every other point's text — and handed that
   * to the server, so saving one point overwrote the rest of the section with this screen's
   * copy of it. Nothing is assembled here any more either: the document is built when it is
   * read (`utils/planText.ts`).
   */
  const saveSermonPoint = useCallback(async (
    outlinePointId: string,
    contentByNodeId: Record<string, string>,
    section: SermonSectionKey
  ) => {
    if (!sermon) return;

    try {
      /**
       * SAVES OF THE SAME POINT GO IN ORDER, like the hand-written screen's.
       *
       * Nothing disables the button while a save is in flight, so pressing it twice sent two
       * writes built from the SAME baseline. Whichever answered last used to win; now the
       * second is refused as stale against the first — and the newer text, which is the one
       * the person can see, is the one that loses. Chaining makes each save state the baseline
       * its predecessor confirmed.
       */
      const run = async () => {
        await savePlanTextViaClient(sermon.id, contentByNodeId, [], {
          userId: sermon.userId,
          baselineByNodeId: planTextBaseline?.forNodes(Object.keys(contentByNodeId)),
        });
        planTextBaseline?.confirm(contentByNodeId);
      };
      const queued = writeChainRef.current.then(run, run);
      writeChainRef.current = queued.catch(() => undefined);
      await queued;

      // The first save from this editor records that the plan lives here — see the same note
      // in `useManualConspectus`. Only when nothing is recorded; a deliberate choice stands.
      if (!sermon.planMode) {
        savePlanModeViaClient(sermon.id, 'ai')
          .catch((error) => debugLog("Recording the plan editor failed — harmless", { error }));
      }

      await onSaved({
        outlinePointId,
        savedNodeIds: Object.keys(contentByNodeId),
        section,
        sentText: contentByNodeId,
      });

      toast.success(t("plan.pointSaved"));
    } catch (error) {
      /**
       * QUEUED IS NOT REFUSED — the durable outbox holds the text and replays it through the
       * same guard on reconnect. The cells are settled so nothing keeps claiming to be
       * unsaved, and no success is announced: the server has never seen it.
       */
      if (isOfflineQueuedError(error)) {
        await onSaved({
          outlinePointId,
          savedNodeIds: Object.keys(contentByNodeId),
          section,
          sentText: contentByNodeId,
        });
        toast.info(t("connection.offlineBanner"));
        return;
      }
      /**
       * A REFUSAL IS AN ANSWER, NOT A WALL — and the way out is a button in the message, not
       * the next press.
       *
       * Adopting the server's values on arrival made "press Save again means mine wins" true in
       * a way nobody agreed to: two quick presses are both already queued, so the second ran
       * with the freshly adopted baseline and replaced the other device before the warning had
       * been read. Consent has to be an act taken AFTER the message.
       */
      const theirs = planTextConflictValues(error);
      if (theirs) {
        toast.error(t("plan.saveRefusedByOtherDevice"), {
          id: "plan-save-refused",
          duration: Infinity,
          action: {
            label: t("plan.saveRefusedKeepMine"),
            onClick: () => {
              planTextBaseline?.observe(theirs);
              /**
               * THE TEXT AS IT IS NOW, not as it was when the refusal arrived.
               *
               * The closure held the snapshot this attempt had sent. People keep writing while a
               * conflict message sits on screen, so pressing "keep mine" re-sent the OLDER
               * version — announced as saved, while everything typed since stayed unsaved. The
               * hand-written screen reads its cells at write time for the same reason.
               */
              const now = Object.fromEntries(
                Object.keys(contentByNodeId).map((nodeId) => [
                  nodeId,
                  generatedContentRef.current[nodeId] ?? contentByNodeId[nodeId],
                ])
              );
              void saveSermonPointRef.current?.(outlinePointId, now, section);
            },
          },
        });
        return;
      }
      debugLog("Plan save failed", { sermonId: sermon.id, outlinePointId, section, error });
      toast.error(t(writeFailureTranslationKey(error, "errors.failedToSavePoint")));
    }
  }, [onSaved, planTextBaseline, sermon, t]);

  // Wired after definition so the refusal message can re-enter it.
  saveSermonPointRef.current = saveSermonPoint;

  return {
    generateSermonPointContent,
    saveSermonPoint,
  };
}

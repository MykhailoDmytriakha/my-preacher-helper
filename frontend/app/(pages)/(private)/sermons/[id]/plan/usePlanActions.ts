import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { PlanStyle } from "@/api/clients/openAI.client";
import { Sermon } from "@/models/models";
import { isOfflineQueuedError, isStaleWriteError } from "@/services/conflictSafeUpdate.client";
import { planTextConflictValues } from "@/services/sermons.client";
import { isUsageCapReachedError } from "@/services/usageLimits";
import { AI_RESULT_CONFLICT, AI_RESULT_NOT_STARTED, AI_RESULT_UNAVAILABLE } from '@/utils/aiResultOperation';
import { ranOutOfTime } from "@/utils/aiTimeFailure";
import { serializeContent } from '@/utils/contentFingerprint';
import { debugLog } from "@/utils/debugMode";
import { failureCode } from "@/utils/failureCode";
import { notePlanContextKey } from '@/utils/notePlan';
import { getVisualOrderedThoughtsForOutlinePoint } from "@/utils/sermonVisualOrder";
import { writeFailureTranslationKey } from "@/utils/writeRecovery";

import { generatePlanPointContent } from "./planApi";
import { getPointFromLookup, getPointSectionFromLookup } from "./planOutlineLookup";
import { beginPlanPointResult, bindPlanPointOpening, dismissPlanPointResult, isPlanPointResultStored, listPlanPointResults, planPointResultKey, readPlanPointResult, retainPlanPointResult, watchPlanPointResults, type PlanPointResult } from './planPointResult.client';
import { planResultDigest } from './planResultInbox.client';
import { usePlanWriter } from './planWriter';
import { useConfirmedPlanResultClosure } from './useConfirmedPlanResultClosure';
import { usePlanResultInbox } from './usePlanResultInbox';
import { useRecoveredPlanPointResults } from './useRecoveredPlanPointResults';

import type { PlanOutlineLookup } from "./planOutlineLookup";
import type { PlanTextBaseline } from "./planTextBaseline";
import type { PlanWriter } from "./planWriter";
import type { SermonSectionKey } from "./types";

const DRAFT_STORAGE_ERROR = 'draftStorage.title';
const POINT_CHANGED = 'plan.generationTextChanged';

function stagePointResult(writer: PlanWriter, key: string, id: string, result: Extract<PlanPointResult, { kind: 'ready' }>,
  opening: string, stillOffered = () => isPlanPointResultStored(key, result)): Promise<void> {
  if (!writer.stagePlanText) return Promise.reject(new Error('Plan draft storage is unavailable'));
  return writer.stagePlanText({ [id]: result.content }, { [id]: opening },
    (nodeId, text) => nodeId === id && text === result.content && stillOffered());
}

interface UsePlanActionsParams {
  sermon: Sermon | null;
  planStyle: PlanStyle;
  outlineLookup: PlanOutlineLookup;
  generatedContent: Record<string, string>;
  confirmedPlanText?: Record<string, string>;
  cellAuthoringVersion?: (nodeId: string) => number;
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
  confirmedPlanText,
  cellAuthoringVersion,
  t,
  setGeneratingIds,
  onGenerated,
  onSaved,
  onAiSuccess,
  aiBlocked = false,
  planTextBaseline,
}: UsePlanActionsParams) {
  const planWriter = usePlanWriter();
  /** Saves run one after another, so each states the baseline its predecessor confirmed. */
  const writeChainRef = useRef<Promise<unknown>>(Promise.resolve());
  /** The cells as they are RIGHT NOW, for actions taken long after a save was attempted. */
  const generatedContentRef = useRef(generatedContent);
  generatedContentRef.current = generatedContent;
  const scope = useMemo(() => Symbol(JSON.stringify([sermon?.userId, sermon?.id])), [sermon?.userId, sermon?.id]);
  const currentGeneration = useRef({ scope, sermon, outlineLookup, cellAuthoringVersion, onGenerated });
  currentGeneration.current = { scope, sermon, outlineLookup, cellAuthoringVersion, onGenerated };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const requests = useRef(new Map<string, symbol>());
  const previousScope = useRef(scope);
  const [results, setResults] = useState<{ scope: symbol; points: Record<string, PlanPointResult> }>();
  const ownerId = sermon?.userId;
  const sermonId = sermon?.id;
  const inbox = usePlanResultInbox(ownerId, sermonId, 'thoughts', () => ownerId && sermonId
    ? Object.values(listPlanPointResults(ownerId, sermonId)).filter(result => result.openingKey).map(result => result.id)
    : []);
  const { close: closeInbox, closed: closedInbox, waitForLookup } = inbox;
  const closedItems = useRef(closedInbox);
  closedItems.current = closedInbox;
  useEffect(() => {
    if (!ownerId || !sermonId || !closedInbox?.size) return;
    for (const [pointId, result] of Object.entries(listPlanPointResults(ownerId, sermonId))) {
      if (closedInbox.has(result.id)) dismissPlanPointResult(planPointResultKey(ownerId, sermonId, pointId), result);
    }
  }, [ownerId, sermonId, closedInbox]);
  const inboxItems = useRef(inbox.items);
  inboxItems.current = inbox.items;
  const stagedOffers = useRef(new Map<string, { id: string; content: string; scope: symbol }>());
  const closeAfterConfirmation = useConfirmedPlanResultClosure(ownerId, sermonId, 'thoughts', confirmedPlanText, closeInbox);
  useEffect(() => {
    if (!ownerId || !sermonId) return;
    const refresh = () => setResults({ scope, points: listPlanPointResults(ownerId, sermonId) });
    refresh();
    return watchPlanPointResults(ownerId, sermonId, refresh);
  }, [ownerId, scope, sermonId]);
  useEffect(() => {
    if (previousScope.current === scope) return;
    previousScope.current = scope;
    // Requests from the old sermon cannot hold a button on the new one.
    requests.current.clear();
    stagedOffers.current.clear();
    setGeneratingIds({});
  }, [scope, setGeneratingIds]);
  /** Re-entry for the "keep mine" button, without a circular hook dependency. */
  const saveSermonPointRef = useRef<
    ((id: string, cells: Record<string, string>, section: SermonSectionKey) => Promise<void>) | null
  >(null);

  const generateSermonPointContent = useCallback(async (outlinePointId: string) => {
    if (aiBlocked || !sermon || requests.current.get(outlinePointId) === scope) return;

    const key = planPointResultKey(sermon.userId, sermon.id, outlinePointId);
    const priorOffer = (items = inboxItems.current) => items?.some(item => item.value.pointId === outlinePointId
      && (item.state === 'pending' || item.value.mode === 'thoughts' && item.value.content !== generatedContentRef.current[outlinePointId]));
    if (readPlanPointResult(key) || priorOffer()) return;
    requests.current.set(outlinePointId, scope);
    setGeneratingIds((prev) => ({
      ...prev,
      [outlinePointId]: true,
    }));

    let attempt: PlanPointResult | undefined;
    try {
      const lookup = waitForLookup();
      if (lookup && (priorOffer(await lookup) || !mounted.current || currentGeneration.current.scope !== scope)) return;
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

      const openingText = generatedContentRef.current[outlinePointId] ?? "";
      const openingAuthoring = cellAuthoringVersion?.(outlinePointId);
      attempt = beginPlanPointResult(key, planStyle);
      if (!attempt) {
        toast.error(t(DRAFT_STORAGE_ERROR));
        return;
      }
      // Persist the identity before hashing so navigation cannot lose a click.
      if (globalThis.crypto?.subtle) {
        const [openingKey, contextKey] = await Promise.all([
          planResultDigest(serializeContent({ [outlinePointId]: openingText })),
          planResultDigest(notePlanContextKey(sermon, outlinePointId)),
        ]);
        if (openingKey) {
          const bound = bindPlanPointOpening(key, attempt, { openingKey, contextKey });
          if (bound) attempt = bound;
        }
      }
      const openingKey = attempt.openingKey;
      const { content } = await generatePlanPointContent({
        sermonId: sermon.id,
        outlinePointId,
        style: planStyle,
      }, { ownerId: sermon.userId, operationId: attempt.id, ...(openingKey && { openingKey }) });
      const result = { ...attempt, kind: 'ready' as const, content };
      const retainedAttempt = readPlanPointResult(key);
      if (retainedAttempt?.id !== attempt.id || retainedAttempt.kind === 'ready') return;
      // A completed generation is available offline even before the editor accepts it.
      retainPlanPointResult(key, result, attempt);
      if (retainedAttempt.kind === 'failed') return;

      const current = currentGeneration.current;
      const currentSection = getPointSectionFromLookup(current.outlineLookup, outlinePointId);
      if (!mounted.current || current.scope !== scope || !currentSection || (generatedContentRef.current[outlinePointId] ?? "") !== openingText
        || current.cellAuthoringVersion?.(outlinePointId) !== openingAuthoring) {
        if (!mounted.current || current.scope !== scope) return;
        toast.info(t(POINT_CHANGED));
        await onAiSuccess?.();
        return;
      }
      try {
        await stagePointResult(planWriter, key, outlinePointId, result, openingText);
      } catch (error) {
        if (mounted.current && currentGeneration.current.scope === scope) toast.info(t(
          failureCode(error) === 'decision-changed' ? POINT_CHANGED : DRAFT_STORAGE_ERROR));
        return;
      }
      if (mounted.current && currentGeneration.current.scope === scope
        && currentGeneration.current.cellAuthoringVersion?.(outlinePointId) === openingAuthoring) {
        currentGeneration.current.onGenerated({ outlinePointId, content, section: currentSection });
      }
      if (openingKey && currentGeneration.current.scope === scope) {
        stagedOffers.current.set(outlinePointId, { id: result.id, content, scope });
      }
      dismissPlanPointResult(key, result);
      await onAiSuccess?.();

      if (mounted.current && currentGeneration.current.scope === scope) toast.success(t("plan.contentGenerated"));
    } catch (error) {
      debugLog("Plan generate failed", { sermonId: sermon.id, outlinePointId, error });
      if (attempt && definitiveGenerationFailure(error)) {
        retainPlanPointResult(key, { ...attempt, kind: 'failed', message: 'errors.failedToGenerateContent' }, attempt);
      }
      if (!mounted.current || currentGeneration.current.scope !== scope || isUsageCapReachedError(error)) return;
      // Out of time is not "failed": the 60 s ceiling cut it, and another try may fit.
      toast.error(t(ranOutOfTime(error) ? "errors.aiOutOfTime" : "errors.failedToGenerateContent"));
    } finally {
      if (mounted.current && currentGeneration.current.scope === scope) {
        requests.current.delete(outlinePointId);
        setGeneratingIds((prev) => {
          const { [outlinePointId]: _finishedPoint, ...next } = prev;
          return next;
        });
      }
    }
  }, [aiBlocked, cellAuthoringVersion, onAiSuccess, outlineLookup, planStyle, planWriter, scope, sermon, setGeneratingIds, t, waitForLookup]);

  const localResults = results?.scope === scope ? Object.fromEntries(
    Object.entries(results.points).filter(([, item]) => !closedInbox?.has(item.id))) : {};
  const { inboxResults, recoveredResults } = useRecoveredPlanPointResults(inbox.items, localResults, sermon, generatedContent);
  const recoverPointResult = async (pointId: string, resume = false) => {
    if (!ownerId || !sermonId || requests.current.get(pointId) === scope) return;
    const key = planPointResultKey(ownerId, sermonId, pointId);
    const local = readPlanPointResult(key);
    if (!local && inboxResults[pointId]?.kind === 'pending' && !resume) {
      requests.current.set(pointId, scope);
      setGeneratingIds(previous => ({ ...previous, [pointId]: true }));
      try {
        await inbox.check(inboxResults[pointId].id);
      } catch {
        // Until settlement or expiry, the original operation remains available to check.
      } finally {
        if (mounted.current && currentGeneration.current.scope === scope) {
          requests.current.delete(pointId);
          setGeneratingIds(previous => {
            const { [pointId]: _finished, ...remaining } = previous;
            return remaining;
          });
        }
      }
      return;
    }
    const attempt = local;
    if (attempt?.kind !== 'pending' || resume && !attempt.receiptMissing) return;
    requests.current.set(pointId, scope);
    setGeneratingIds(previous => ({ ...previous, [pointId]: true }));
    try {
      const { content } = await generatePlanPointContent({
        sermonId, outlinePointId: pointId, style: attempt.style,
      }, {
        ownerId, operationId: attempt.id, recoverOnly: !resume,
        ...(resume && attempt.openingKey && { openingKey: attempt.openingKey }),
      });
      retainPlanPointResult(key, { ...attempt, kind: 'ready', content }, attempt);
      if (mounted.current && currentGeneration.current.scope === scope) await onAiSuccess?.();
    } catch (error) {
      if ((error as { code?: string } | null)?.code === AI_RESULT_NOT_STARTED) {
        retainPlanPointResult(key, { ...attempt, receiptMissing: true }, attempt);
      } else if (definitiveGenerationFailure(error)) {
        retainPlanPointResult(key, { ...attempt, kind: 'failed', message: 'errors.failedToGenerateContent' }, attempt);
      }
    } finally {
      if (mounted.current && currentGeneration.current.scope === scope) {
        requests.current.delete(pointId);
        setGeneratingIds(previous => {
          const { [pointId]: _finished, ...remaining } = previous;
          return remaining;
        });
      }
    }
  };
  const applyPointResult = async (pointId: string, result: PlanPointResult) => {
    if (!ownerId || !sermonId || result.kind !== 'ready' || result.basisCheck || requests.current.get(pointId) === scope) return;
    const section = getPointSectionFromLookup(currentGeneration.current.outlineLookup, pointId);
    if (!section) return;
    const key = planPointResultKey(ownerId, sermonId, pointId);
    const origin = result.inboxOrigin;
    if (closedItems.current?.has(result.id)) return;
    const local = readPlanPointResult(key);
    if (!origin && local?.id !== result.id) return;
    const opening = generatedContentRef.current[pointId] ?? '';
    const current = currentGeneration.current;
    const context = current.sermon && notePlanContextKey(current.sermon, pointId);
    const stillOffered = () => mounted.current && currentGeneration.current.scope === scope && !closedItems.current?.has(result.id)
      && (origin ? inboxItems.current?.some(item => item.id === result.id && item.state === 'ready'
        && item.value.mode === 'thoughts' && item.value.content === result.content) === true : isPlanPointResultStored(key, result));
    const openingStillCurrent = () => {
      const latest = currentGeneration.current;
      return (generatedContentRef.current[pointId] ?? '') === opening
        && latest.sermon && notePlanContextKey(latest.sermon, pointId) === context;
    };
    const boundOpening = origin?.openingKey ?? result.openingKey;
    const boundContext = origin?.contextKey ?? result.contextKey;
    if (boundOpening) {
      const [openingKey, contextKey] = await Promise.all([
        planResultDigest(serializeContent({ [pointId]: opening })),
        context && planResultDigest(context),
      ]);
      if (openingKey !== boundOpening || boundContext && contextKey !== boundContext || !openingStillCurrent() || !stillOffered()) {
        if (mounted.current && currentGeneration.current.scope === scope) toast.info(t(POINT_CHANGED));
        return;
      }
    }
    const authoring = currentGeneration.current.cellAuthoringVersion?.(pointId);
    try {
      await stagePointResult(planWriter, key, pointId, result, opening, boundOpening ? () => Boolean(stillOffered()) : undefined);
    } catch (error) {
      if (mounted.current && currentGeneration.current.scope === scope) toast.info(t(
        failureCode(error) === 'decision-changed' ? POINT_CHANGED : DRAFT_STORAGE_ERROR));
      return;
    }
    if (mounted.current && currentGeneration.current.scope === scope
      && currentGeneration.current.cellAuthoringVersion?.(pointId) === authoring) {
      currentGeneration.current.onGenerated({ outlinePointId: pointId, content: result.content, section });
    }
    if ((origin || result.openingKey) && currentGeneration.current.scope === scope) {
      stagedOffers.current.set(pointId, { id: result.id, content: result.content, scope });
    }
    if (local?.id === result.id) dismissPlanPointResult(key, result);
  };
  const discardPointResult = (pointId: string, result: PlanPointResult) => {
    if (ownerId && sermonId && result.kind !== 'pending' && requests.current.get(pointId) !== scope) {
      if (result.inboxOrigin || result.openingKey && result.kind === 'ready') {
        void inbox.close(result.id).then(() => {
          dismissPlanPointResult(planPointResultKey(ownerId, sermonId, pointId), result);
        }, error => {
          if (error.status === 404 && !result.inboxOrigin) dismissPlanPointResult(planPointResultKey(ownerId, sermonId, pointId), result);
          else if (mounted.current && currentGeneration.current.scope === scope) toast.error(t(DRAFT_STORAGE_ERROR));
        });
      } else dismissPlanPointResult(planPointResultKey(ownerId, sermonId, pointId), result);
    }
  };

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
    const text = contentByNodeId[outlinePointId];
    const staged = stagedOffers.current.get(outlinePointId);
    const found = inboxItems.current?.find(item => item.state === 'ready' && item.value.mode === 'thoughts'
      && item.value.pointId === outlinePointId && item.value.content === text);
    const proposalId = found?.id ?? (staged?.scope === scope && staged.content === text ? staged.id : undefined);

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
        await planWriter.savePlanText(sermon.id, contentByNodeId, [], {
          userId: sermon.userId,
          baselineByNodeId: planTextBaseline?.forNodes(Object.keys(contentByNodeId)),
          revisionsByNodeId: planTextBaseline?.revisionsForNodes(Object.keys(contentByNodeId)),
        });
        planTextBaseline?.confirm(contentByNodeId);
        if (proposalId && text !== undefined) closeAfterConfirmation(proposalId, { [outlinePointId]: text });
      };
      const queued = writeChainRef.current.then(run, run);
      writeChainRef.current = queued.catch(() => undefined);
      await queued;

      // The first save from this editor records that the plan lives here — see the same note
      // in `useManualConspectus`. Only when nothing is recorded; a deliberate choice stands.
      if (!sermon.planMode) {
        planWriter.initializePlanMode(sermon.id, 'ai')
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
              const revision = isStaleWriteError(error) ? error.engineRevision ?? null : null;
              planTextBaseline?.observe(theirs, Object.fromEntries(Object.keys(theirs).map(id => [id, revision])));
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
      if (failureCode(error) === 'resolve-version-first') return;
      debugLog("Plan save failed", { sermonId: sermon.id, outlinePointId, section, error });
      toast.error(t(writeFailureTranslationKey(error, "errors.failedToSavePoint")));
    }
  }, [closeAfterConfirmation, onSaved, planTextBaseline, planWriter, scope, sermon, t]);

  // Wired after definition so the refusal message can re-enter it.
  saveSermonPointRef.current = saveSermonPoint;

  return {
    generateSermonPointContent,
    recoveredResults,
    recoverPointResult,
    applyPointResult,
    discardPointResult,
    saveSermonPoint,
  };
}

function definitiveGenerationFailure(error: unknown): boolean {
  const outcome = error as { status?: number; code?: string; operationEnded?: boolean } | null | undefined;
  return isUsageCapReachedError(error) || outcome?.operationEnded === true
    || outcome?.code === AI_RESULT_UNAVAILABLE || outcome?.code === AI_RESULT_CONFLICT
    || [400, 403, 404, 409, 422].includes(outcome?.status ?? 0);
}

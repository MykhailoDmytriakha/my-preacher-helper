"use client";

import { FileText, Pencil, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { DataFreshnessBanner } from "@/components/DataFreshnessBanner";
import MarkdownDisplay from "@/components/MarkdownDisplay";
import { useDocumentFreshness } from "@/hooks/useDocumentFreshness";
import { useFreshnessUid } from "@/hooks/useFreshnessUid";
import { useRouteId } from "@/hooks/useRouteId";
import useSermon from "@/hooks/useSermon";
import { liveNodeIds, renderPlanWithFallback } from "@/utils/planText";
import {
  planFreshnessProjection,
  type PlanFreshnessProjection,
} from "@/utils/sermonFreshnessProjection";
import { RichMarkdownEditor } from "@components/ui/RichMarkdownEditor";

import { SECTION_TONE_CLASSES } from "../constants";
import { copyFormattedFromElement } from "../copyFormattedFromElement";
import { PlanDraftRecoveryBar } from "../PlanDraftRecoveryBar";
import PlanImmersiveView from "../PlanImmersiveView";
import { PlanModeSwitch } from "../PlanModeSwitch";
import { planNodesForPoint } from "../planNodes";
import PlanOverlayPortal from "../PlanOverlayPortal";
import PlanPreachingView from "../PlanPreachingView";
import PlanViewActions from "../PlanViewActions";
import useCopyFormattedContent from "../useCopyFormattedContent";
import usePlanTextDraft from "../usePlanTextDraft";
import usePlanViewMode from "../usePlanViewMode";

import { AddNodeButton, DeleteNodeButton } from "./NodeControls";
import { useManualConspectus, type ManualConspectus } from "./useManualConspectus";

import type { SermonSectionKey } from "../types";
import type { SermonPoint } from "@/models/models";

/**
 * THE HAND-WRITTEN CONSPECTUS — a screen of its own, not a mode of the other one.
 *
 * The two editors answer different questions. The paired screen shows what a point was
 * BUILT FROM (its thoughts) beside the text generated from them. This one is a FORM: the
 * outline is the skeleton and the work is filling it in, cell by cell, with no thoughts
 * to show and nothing to generate.
 *
 * They were one file with flags for a while, and every change had to be reasoned about
 * twice. What they genuinely share is only what the owner drew: the storage (text keyed
 * by node id), the assembly into markdown, and the read-only view — not the editor.
 */

const SECTIONS: SermonSectionKey[] = ["introduction", "main", "conclusion"];

interface ManualPointCardProps {
  point: SermonPoint;
  index: number;
  section: SermonSectionKey;
  conspectus: ManualConspectus;
}

/**
 * A HEADING THAT CAN BE REWRITTEN IN PLACE.
 *
 * The wording of a point is refined while its text is being written — that is when you find
 * out what it is really about. Until now the only way to change it was to leave for the
 * structure editor and come back, so plans here carried headings their author had outgrown.
 *
 * Enter and leaving the field commit; Escape restores what was there. An empty name is never
 * committed: a nameless point is unreachable in every list, and clearing the field is never a
 * request for that.
 */
const EditableTitle = ({
  value,
  onRename,
  className,
  ariaLabel,
}: {
  value: string;
  onRename: (next: string) => void;
  className?: string;
  ariaLabel: string;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === value) {
      setDraft(value);
      return;
    }
    onRename(next);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(value); setEditing(true); }}
        aria-label={ariaLabel}
        className={`min-w-0 truncate rounded px-1 text-left hover:bg-black/5 dark:hover:bg-white/10 ${className ?? ""}`}
      >
        {value}
      </button>
    );
  }

  return (
    <input
      autoFocus
      value={draft}
      aria-label={ariaLabel}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); commit(); }
        if (event.key === "Escape") { setDraft(value); setEditing(false); }
      }}
      className={`min-w-0 flex-1 rounded border border-gray-300 bg-white px-1 py-0.5 text-inherit dark:border-gray-600 dark:bg-gray-900 ${className ?? ""}`}
    />
  );
};

const ManualPointCard = ({ point, index, section, conspectus }: ManualPointCardProps) => {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const tone = SECTION_TONE_CLASSES[section];

  const nodes = planNodesForPoint(point, index);
  const nodeIds = nodes.map((node) => node.id);

  // "Nothing changed" is what disables saving — NOT "nothing is written". Emptying the
  // last cell is a legitimate edit, and gating on content left the old server text
  // impossible to remove.
  const isModified = nodeIds.some((id) => conspectus.modifiedNodeIds[id]);

  return (
    <div className="h-full rounded-lg border bg-white p-4 shadow-sm dark:bg-gray-800">
      <h3 className={`mb-2 flex items-center justify-between gap-2 text-lg font-semibold ${tone.text}`}>
        <span className="flex min-w-0 flex-1 items-baseline gap-1">
          <span className="shrink-0 opacity-60">{index + 1}.</span>
          <EditableTitle
            value={point.text}
            ariaLabel={t("plan.renamePoint")}
            onRename={(next) => conspectus.renamePoint(point.id, next)}
          />
        </span>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => void conspectus.savePoint(point.id, section, nodeIds)}
            disabled={!isModified}
            /**
             * THE SAME SIGNAL AS THE PAIRED SCREEN: the button lights up in the section's
             * colour while something is unsaved. Two screens over one plan teaching different
             * things about "is my work stored" is how a card gets left behind.
             */
            className={`inline-flex h-8 items-center rounded-md px-2 py-1 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              isModified
                ? `${tone.saveButton} text-white`
                : "bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            }`}
            title={t("plan.save")}
            aria-label={t("plan.save")}
          >
            <Save className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setIsEditing((previous) => !previous)}
            className="inline-flex h-8 items-center rounded-md bg-gray-200 px-2 py-1 text-sm font-medium text-gray-800 transition-colors hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
            title={isEditing ? t("plan.viewMode") : t("plan.editMode")}
            aria-label={isEditing ? t("plan.viewMode") : t("plan.editMode")}
          >
            {isEditing ? <FileText className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
          </button>
          <DeleteNodeButton
            title={t("plan.deletePoint")}
            armedTitle={t("plan.deletePointConfirm")}
            armedLabel={t("plan.deleteConfirm")}
            onDelete={() => void conspectus.deletePoint(point.id)}
          />
        </div>
      </h3>

      <div className="space-y-3">
        {nodes.map((node) => (
          <div
            key={node.id}
            className={node.kind === "subPoint" ? `ml-3 border-l-2 pl-4 ${tone.border}` : ""}
          >
            {node.kind === "subPoint" && (
              <h4 className={`mb-1 flex items-baseline gap-2 text-base font-semibold ${tone.text}`}>
                <span className="shrink-0 opacity-60">{node.label}</span>
                <EditableTitle
                  value={node.heading}
                  ariaLabel={t("plan.renameSubPoint")}
                  onRename={(next) => conspectus.renameSubPoint(point.id, node.id, next)}
                />
                <DeleteNodeButton
                  compact
                  title={t("plan.deleteSubPoint")}
                  armedTitle={t("plan.deleteSubPointConfirm")}
                  armedLabel={t("plan.deleteConfirm")}
                  onDelete={() => void conspectus.deleteSubPoint(point.id, node.id)}
                />
              </h4>
            )}
            {isEditing ? (
              <RichMarkdownEditor
                value={conspectus.contentByNodeId[node.id] ?? ""}
                placeholder={t("plan.noContent")}
                minHeight={node.kind === "subPoint" ? "90px" : "120px"}
                onChange={(text) => conspectus.setNodeContent(node.id, text)}
              />
            ) : (
              <div className="rounded-md border border-gray-200 bg-gray-50/70 p-4 dark:border-gray-700/70 dark:bg-gray-900/20">
                <MarkdownDisplay content={conspectus.contentByNodeId[node.id] || t("plan.noContent")} />
              </div>
            )}
          </div>
        ))}

        <AddNodeButton
          className="ml-3"
          label={t("plan.addSubPoint")}
          placeholder={t("plan.addSubPointPlaceholder")}
          confirmLabel={t("plan.addConfirm")}
          cancelLabel={t("plan.addCancel")}
          onAdd={(text) => conspectus.addSubPoint(point.id, text)}
        />
      </div>
    </div>
  );
};

export default function ManualConspectusPage() {
  const { t } = useTranslation();
  const sermonId = useRouteId();
  const router = useRouter();
  const { sermon, setSermon, loading, error, refreshSermon } = useSermon(sermonId);
  const conspectus = useManualConspectus({ sermon, setSermon, t });
  /** Nodes the outline still has — a recovered draft for anything else has nowhere to show. */
  const livePlanNodes = useMemo(() => liveNodeIds(sermon?.outline), [sermon?.outline]);
  const hasUnsavedCells = Object.values(conspectus.modifiedNodeIds).some(Boolean);

  /**
   * Text that never reached the server survives a closed tab — the precondition the write
   * guard states about itself. Without it, refusing a stale save would merely move the loss
   * from "someone else's paragraph" to "your own".
   */
  const draft = usePlanTextDraft({
    uid: sermon?.userId,
    sermonId: sermon?.id,
    contentByNodeId: conspectus.contentByNodeId,
    modifiedNodeIds: conspectus.modifiedNodeIds,
    pendingNodeIds: conspectus.pendingNodeIds,
    liveNodeIds: livePlanNodes,
  });

  /**
   * DOES THE SERVER HOLD A NEWER PLAN?
   *
   * This screen had none of this while its twin did, and that gap was the dangerous half:
   * here the text is typed BY HAND, so there is nothing to regenerate if it is lost. Someone
   * could write on a phone in the morning and keep this tab open from the night before, and
   * the only sign would be their morning paragraph quietly disappearing on the next save.
   *
   * The same projection as the paired screen, deliberately: one rule for "did this change",
   * compared through the plan the application READS rather than the field that stores it, so
   * a sermon moving between storage shapes is not announced as a foreign edit.
   */
  const freshnessUid = useFreshnessUid(sermon?.userId);
  const knownPlan = useMemo<PlanFreshnessProjection | null>(
    () => (sermon ? planFreshnessProjection(sermon as unknown as Record<string, unknown>) : null),
    [sermon]
  );
  const planFreshness = useDocumentFreshness<PlanFreshnessProjection>({
    collection: "sermons",
    docId: sermonId || null,
    uid: freshnessUid,
    enabled: Boolean(sermon),
    known: knownPlan,
    select: (data) => planFreshnessProjection(data),
  });
  const [freshnessDismissed, setFreshnessDismissed] = useState(false);
  useEffect(() => {
    if (planFreshness.state === "stale" || planFreshness.state === "unknown") {
      setFreshnessDismissed(false);
    }
  }, [planFreshness.remote, planFreshness.state]);

  /**
   * Taking the newer version is SAFE HERE even mid-edit, and that is not an accident: the
   * seeding effect lays storage over every cell except the ones being typed into. So a
   * refresh brings in the paragraph written elsewhere and leaves the unsaved one alone —
   * which is why the button is offered rather than withheld.
   */
  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refreshSermon();
      toast.success(t("freshness.refreshedToast"));
    } catch {
      toast.error(t("freshness.refreshFailedToast"));
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, refreshSermon, t]);

  /**
   * Reading and preaching from the conspectus belong to BOTH editors — see
   * `PlanViewActions`. The assembled text comes from what was stored, so this screen
   * shows exactly the document the pulpit view will show.
   */
  const {
    openOverlay,
    openImmersive,
    openPreaching,
    close: closePlanView,
    isOverlay,
    isImmersive,
    isPreaching,
  } = usePlanViewMode();
  /**
   * WHAT IS ON SCREEN IS WHAT GETS READ, PREACHED AND EXPORTED.
   *
   * The stored text is the baseline; whatever is being typed right now is laid over it, so
   * a paragraph written a moment ago is already in the pulpit view and in every export
   * instead of appearing only after a save.
   */
  const combinedPlan = useMemo(
    () => renderPlanWithFallback(sermon, conspectus.contentByNodeId),
    [sermon?.outline, conspectus.contentByNodeId]
  );
  const noContentText = t("plan.noContent");

  /**
   * Copying belongs to the document, not to the editor that produced it. This screen used
   * to be handed a no-op: the button rendered enabled, copied nothing and reported nothing.
   */
  const overlayContentRef = useRef<HTMLDivElement | null>(null);
  const immersiveContentRef = useRef<HTMLDivElement | null>(null);
  const { status: overlayCopyStatus, runCopy: runOverlayCopy } = useCopyFormattedContent({ t });
  const { status: immersiveCopyStatus, runCopy: runImmersiveCopy } = useCopyFormattedContent({ t });

  /**
   * THE BROWSER'S OWN WAYS OUT — reload, Back, closing the tab.
   *
   * The two links below save before they travel, but they are only two doors. A reload or a
   * tab close bypasses them entirely, and that is how an unsaved paragraph actually dies in
   * practice. The browser will not let a page save asynchronously on the way out, so the
   * honest move is the one it does allow: ask, and let the person decide.
   */
  React.useEffect(() => {
    const warnIfUnsaved = (event: BeforeUnloadEvent) => {
      if (!Object.values(conspectus.modifiedNodeIds).some(Boolean)) return;
      event.preventDefault();
      // Browsers show their own wording; a non-empty value is what arms the prompt.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnIfUnsaved);
    return () => window.removeEventListener("beforeunload", warnIfUnsaved);
  }, [conspectus.modifiedNodeIds]);

  /**
   * Leaving must not cost the paragraph someone just typed. The links out are plain
   * navigation, so they save first and travel second — and stay put if the save refuses.
   */
  const guardUnsavedNavigation = (event: React.MouseEvent<HTMLAnchorElement>) => {
    const hasUnsaved = Object.values(conspectus.modifiedNodeIds).some(Boolean);
    if (!hasUnsaved) return;

    event.preventDefault();
    const href = event.currentTarget.getAttribute("href");
    void conspectus.saveModified().then((saved) => {
      if (saved && href) router.push(href);
    });
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">{t("common.loading", { defaultValue: "…" })}</div>;
  }

  /**
   * A REFUSAL IS NOT A SLOW LOAD.
   *
   * `loading || !sermon` folded both into one spinner, so a 403, a 404 or a network error
   * that had already given up left the page saying "Loading…" for as long as someone was
   * willing to wait. Nothing is coming; say so, and offer the way back.
   */
  if (error || !sermon) {
    return (
      <div className="p-8 text-center">
        <p className="mb-4 text-gray-700 dark:text-gray-200">{t("errors.failedToLoadSermon")}</p>
        <Link href={`/sermons/${sermonId}`} className="text-blue-600 hover:underline dark:text-blue-400">
          {t("actions.backToSermon")}
        </Link>
      </div>
    );
  }

  if (isImmersive) {
    return (
      <PlanImmersiveView
        sermon={sermon}
        combinedPlan={combinedPlan}
        t={t}
        timerState={null}
        isPreachingMode={isPreaching}
        noContentText={noContentText}
        copyStatus={immersiveCopyStatus}
        immersiveContentRef={immersiveContentRef}
        onCopy={() => runImmersiveCopy(() => copyFormattedFromElement(immersiveContentRef.current))}
        onOpenPlanOverlay={openOverlay}
        onClosePlanView={closePlanView}
      />
    );
  }

  if (isPreaching) {
    return (
      <PlanPreachingView
        sermon={sermon}
        combinedPlan={combinedPlan}
        t={t}
        timerState={null}
        isPlanPreaching
        planViewMode="preaching"
        noContentText={noContentText}
        preachingDuration={null}
        onTimerStateChange={() => undefined}
        onTimerFinished={() => undefined}
        onSetDuration={() => undefined}
      />
    );
  }

  return (
    <div className="space-y-6 p-4">
      <PlanOverlayPortal
        isPlanOverlay={isOverlay}
        sermon={sermon}
        combinedPlan={combinedPlan}
        t={t}
        timerState={null}
        isPreachingMode={false}
        noContentText={noContentText}
        copyStatus={overlayCopyStatus}
        planOverlayContentRef={overlayContentRef}
        onCopy={() => runOverlayCopy(() => copyFormattedFromElement(overlayContentRef.current))}
        onOpenPlanImmersive={openImmersive}
        onClosePlanView={closePlanView}
      />

      {draft.recovered && (
        <PlanDraftRecoveryBar
          count={Object.keys(draft.recovered).length}
          onRestore={() => {
            conspectus.restoreCells(draft.recovered ?? {});
            draft.accept();
          }}
          onDiscard={draft.discard}
        />
      )}

      {/* Like the paired screen: never in the preaching or immersive views, which return
          above — someone standing in front of a congregation must not be handed a decision. */}
      {(planFreshness.state === "stale" || planFreshness.state === "unknown") &&
        !freshnessDismissed && (
          <DataFreshnessBanner
            entityKey="entitySermon"
            dirty={hasUnsavedCells}
            deleted={planFreshness.remotelyDeleted}
            unknown={planFreshness.state === "unknown"}
            onRefresh={handleRefresh}
            refreshing={isRefreshing}
            onDismiss={() => setFreshnessDismissed(true)}
          />
        )}

      <div className="flex items-center justify-between gap-4">
        <Link
          href={`/sermons/${sermonId}`}
          onClick={guardUnsavedNavigation}
          className="text-blue-600 hover:underline dark:text-blue-400"
        >
          {t("actions.backToSermon")}
        </Link>
        <Link
          href={`/sermons/${sermonId}/plan`}
          onClick={guardUnsavedNavigation}
          className="text-sm text-gray-500 hover:underline dark:text-gray-400"
        >
          {t("plan.backToAssembled")}
        </Link>
      </div>

      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{sermon.title}</h1>
          <p className="text-gray-500 dark:text-gray-400">{t("plan.manualSubtitle")}</p>
        </div>

        <PlanModeSwitch
          sermon={sermon}
          current="manual"
          onSwitched={(planMode) => setSermon((previous) => (previous ? { ...previous, planMode } : previous))}
        />

        <PlanViewActions
          sermon={sermon}
          sermonId={sermonId}
          combinedPlan={combinedPlan}
          t={t}
          onRequestPlanOverlay={openOverlay}
          onRequestPreachingMode={openPreaching}
          onStartPreachingMode={openPreaching}
        />
      </div>

      {SECTIONS.map((section) => {
        const points = sermon.outline?.[section] ?? [];
        const tone = SECTION_TONE_CLASSES[section];

        return (
          <section key={section} className={`rounded-lg border p-3 ${tone.surface}`}>
            <h2 className={`mb-3 text-xl font-semibold ${tone.text}`}>{t(`sections.${section}`)}</h2>

            <div className="space-y-4">
              {points.map((point, index) => (
                <ManualPointCard
                  key={point.id}
                  point={point}
                  index={index}
                  section={section}
                  conspectus={conspectus}
                />
              ))}
            </div>

            <AddNodeButton
              className="mt-3"
              label={t("plan.addPoint")}
              placeholder={t("plan.addPointPlaceholder")}
              confirmLabel={t("plan.addConfirm")}
              cancelLabel={t("plan.addCancel")}
              onAdd={(text) => conspectus.addPoint(section, text)}
            />
          </section>
        );
      })}
    </div>
  );
}

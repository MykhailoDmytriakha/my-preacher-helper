"use client";

import Link from "next/link";
import React, { useRef, useState } from "react";

import ExportButtons from "@/components/ExportButtons";
import ViewPlanMenu from "@/components/plan/ViewPlanMenu";
import { normalizePlanArrows } from "@/utils/markdownUtils";
import { planMarkdownToPlainText } from "@/utils/planHierarchy";
import { hasPlan } from "@/utils/sermonPlanAccess";

import { PlanModeSwitch } from "./PlanModeSwitch";

import type { CombinedPlan } from "./types";
import type { Sermon } from "@/models/models";

/**
 * THE TOOLS ABOVE THE PLAN — one header, whichever editor is open.
 *
 * Going back, reading the plan whole, walking out to preach, exporting, switching editor:
 * every one of these belongs to the DOCUMENT, not to the mode it is being typed in. They
 * were built twice, once per route, and drifted — the mode switch ended up 1221px apart
 * horizontally and every document button 157px apart vertically, so switching editor moved
 * the button out from under the preacher's finger.
 *
 * So the header is a COMPONENT, not a convention: both routes mount it in one line and
 * neither can lay it out its own way. What genuinely differs is passed in, and there are
 * exactly three such things — which line names the mode, what to do when the person walks
 * away with unsaved text, and how this screen builds its export.
 *
 * Everything specific to a mode goes BELOW this block, in the route's own file. That is the
 * rule that keeps this from growing flags: if it is not on all three screens, it is not here.
 */

/** Which line names the mode. Kept here so the three screens cannot disagree about it. */
const SUBTITLE_KEY: Record<PlanEditorMode, string> = {
  ai: "plan.fromThoughtsSubtitle",
  manual: "plan.manualSubtitle",
  note: "plan.fromNote.subtitle",
};

export type PlanEditorMode = "manual" | "ai" | "note";

/**
 * How a screen builds what export and copying hand over. The paired screen's own builder
 * answers `type: "thoughts"` as well, which is why this is a type and not a fixed function.
 */
export type PlanExportContentBuilder = (
  format: "plain" | "markdown",
  options?: { includeTags?: boolean; type?: "thoughts" | "plan" }
) => Promise<string>;

/** The conspectus as one markdown document — the default an editor gets if it brings nothing. */
export function planAsMarkdown(
  sermon: Sermon,
  combinedPlan: CombinedPlan,
  t: (key: string, options?: Record<string, unknown>) => string,
  noContentText: string
): string {
  const title = `# ${sermon.title}\n\n`;
  const verse = sermon.verse ? `> ${sermon.verse}\n\n` : "";
  const section = (key: keyof CombinedPlan) =>
    `## ${t(`sections.${key}`)}\n\n${combinedPlan[key] || noContentText}\n\n`;

  return normalizePlanArrows(
    `${title}${verse}${section("introduction")}${section("main")}${section("conclusion")}`
  );
}

export interface PlanPageHeaderProps {
  sermon: Sermon;
  sermonId: string;
  /** Which editor is rendering this — decides the subtitle and the pressed switch. */
  mode: PlanEditorMode;
  combinedPlan: CombinedPlan;
  t: (key: string, options?: Record<string, unknown>) => string;
  /** Guard for leaving with unsaved cells — the hand-written editor has some, the paired one does not. */
  onLeave?: React.MouseEventHandler<HTMLAnchorElement>;
  onSwitched?: (mode: PlanEditorMode) => void;
  beforeSwitch?: () => Promise<boolean>;
  onRequestPlanOverlay: () => void;
  onRequestPreachingMode: () => void;
  onStartPreachingMode: () => void;
  /**
   * The paired screen's builder does MORE than assemble the plan: asked for `type:
   * "thoughts"` it exports the thoughts instead. Sharing the header must not quietly take
   * that away, so a screen may bring its own builder and the default only assembles the plan.
   */
  getExportContent?: PlanExportContentBuilder;
  getPdfContent?: () => Promise<React.ReactNode>;
}

export default function PlanPageHeader({
  sermon,
  sermonId,
  mode,
  combinedPlan,
  t,
  onLeave,
  onSwitched,
  beforeSwitch,
  onRequestPlanOverlay,
  onRequestPreachingMode,
  onStartPreachingMode,
  getExportContent,
  getPdfContent,
}: PlanPageHeaderProps) {
  const sectionMenuRef = useRef<HTMLDivElement>(null);
  const [showSectionMenu, setShowSectionMenu] = useState(false);

  const noContentText = t("plan.noContent");

  const buildExportContent: PlanExportContentBuilder =
    getExportContent ??
    (async (format) => {
      const markdown = planAsMarkdown(sermon, combinedPlan, t, noContentText);
      if (format === "markdown") return markdown;

      return planMarkdownToPlainText(markdown);
    });

  return (
    <div className="space-y-4" data-testid="plan-page-header">
      <Link
        href={`/sermons/${sermonId}`}
        onClick={onLeave}
        data-testid="plan-header-back"
        className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
        {t("actions.backToSermon")}
      </Link>

      <div className="space-y-2">
        <h1
          data-testid="plan-header-title"
          className="text-2xl font-bold text-gray-900 dark:text-white lg:text-3xl"
        >
          {sermon.title}
        </h1>

        {sermon.verse && (
          <div
            data-testid="plan-header-verse"
            className="border-l-4 border-blue-500 pl-4 dark:border-blue-400"
          >
            <p className="whitespace-pre-line text-lg italic text-gray-700 dark:text-gray-300">
              {sermon.verse}
            </p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t("common.scripture")}</p>
          </div>
        )}

        <p
          data-testid="plan-header-subtitle"
          className="text-gray-500 dark:text-gray-400"
        >
          {t(SUBTITLE_KEY[mode])}
        </p>
      </div>

      <div data-testid="plan-header-mode-switch">
        <PlanModeSwitch
          sermon={sermon}
          current={mode}
          beforeSwitch={beforeSwitch}
          onSwitched={onSwitched}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ViewPlanMenu
          sermonId={sermonId}
          combinedPlan={combinedPlan}
          sectionMenuRef={sectionMenuRef}
          showSectionMenu={showSectionMenu}
          setShowSectionMenu={setShowSectionMenu}
          onRequestPlanOverlay={onRequestPlanOverlay}
          onRequestPreachingMode={onRequestPreachingMode}
          onStartPreachingMode={onStartPreachingMode}
        />

        <ExportButtons
          sermonId={sermonId}
          getExportContent={buildExportContent}
          getPdfContent={getPdfContent}
          title={sermon.title || "Sermon Plan"}
          className="w-full sm:ml-auto sm:w-auto"
          disabledFormats={["pdf"]}
          planData={
            hasPlan(sermon)
              ? { ...combinedPlan, sermonTitle: sermon.title, sermonVerse: sermon.verse }
              : undefined
          }
          sermonTitle={sermon.title}
        />
      </div>
    </div>
  );
}

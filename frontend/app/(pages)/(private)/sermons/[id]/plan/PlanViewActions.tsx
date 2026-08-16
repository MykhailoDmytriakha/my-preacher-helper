"use client";

import React, { useRef, useState } from "react";

import ExportButtons from "@/components/ExportButtons";
import ViewPlanMenu from "@/components/plan/ViewPlanMenu";
import { normalizePlanArrows } from "@/utils/markdownUtils";
import { renderPlanFromSermon } from "@/utils/planText";
import { hasPlan } from "@/utils/sermonPlanAccess";

import type { CombinedPlan } from "./types";
import type { Sermon } from "@/models/models";

/**
 * READING AND CARRYING THE CONSPECTUS — the same on both editors.
 *
 * Two screens write a sermon plan: the paired one, where AI fills the points from the
 * thoughts under them, and the hand-written one, where a preacher fills the skeleton
 * himself. What they produce is the SAME document, and what a person does with it —
 * read it whole, walk out to the pulpit with it, export it — must not depend on which
 * screen it was typed on.
 *
 * The hand-written screen shipped without these and the loss was noticed immediately:
 * "the buttons from the header are gone". They were never mode-specific.
 */

interface PlanViewActionsProps {
  sermon: Sermon;
  sermonId: string;
  /** The assembled text per section, already stored by whichever editor wrote it. */
  combinedPlan: CombinedPlan;
  t: (key: string, options?: Record<string, unknown>) => string;
  onRequestPlanOverlay: () => void;
  onRequestPreachingMode: () => void;
  onStartPreachingMode: () => void;
}

/**
 * The document, ASSEMBLED — never read from a stored copy.
 *
 * It used to return `plan.<section>.outline`, the string written at save time. That string
 * was the copy that went stale: it kept headings of deleted points and missed points added
 * since. Building it from structure plus text means the reader and the editor cannot
 * disagree, because there is only one thing to disagree with.
 */
export function combinedPlanFromSermon(sermon: Sermon | null | undefined): CombinedPlan {
  return renderPlanFromSermon(sermon);
}

/** The conspectus as one markdown document — what export and copying hand over. */
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

export default function PlanViewActions({
  sermon,
  sermonId,
  combinedPlan,
  t,
  onRequestPlanOverlay,
  onRequestPreachingMode,
  onStartPreachingMode,
}: PlanViewActionsProps) {
  const sectionMenuRef = useRef<HTMLDivElement>(null);
  const [showSectionMenu, setShowSectionMenu] = useState(false);

  const noContentText = t("plan.noContent");

  const getExportContent = async (format: "plain" | "markdown") => {
    const markdown = planAsMarkdown(sermon, combinedPlan, t, noContentText);
    if (format === "markdown") return markdown;

    // A very simple markdown-to-plain conversion, matching what the paired screen does.
    return markdown
      .replace(/#{1,6}\s(.*)/g, "$1\n")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)")
      .replace(/\n>/g, "\n")
      .replace(/>/g, "")
      .replace(/\n\n+/g, "\n\n");
  };

  return (
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
        getExportContent={getExportContent}
        title={sermon.title || "Sermon Plan"}
        className="w-full sm:w-auto sm:ml-auto"
        disabledFormats={["pdf"]}
        planData={hasPlan(sermon)
          ? { ...combinedPlan, sermonTitle: sermon.title, sermonVerse: sermon.verse }
          : undefined}
        sermonTitle={sermon.title}
      />
    </div>
  );
}

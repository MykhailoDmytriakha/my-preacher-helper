"use client";

import React from "react";
import { useTranslation } from "react-i18next";

import { OutlinePoint } from "@/models/models";
import { SERMON_SECTION_COLORS } from "@/utils/themeColors";

/**
 * HOW MUCH OF THE PLAN IS STILL EMPTY, AT A GLANCE.
 *
 * One marker per outline point, grouped by section and coloured like it. The strip answers a
 * question that otherwise costs a full scroll of the page, which is why it belongs on EVERY
 * plan editor and not just the one it was first written into.
 *
 * WHAT COUNTS AS FILLED IS THE CALLER'S CALL, on purpose. The paired screen knows a point by
 * the text saved for it; the hand-written one stores text per NODE, so a point is filled when
 * its own cell or any of its sub-point cells holds something (`pointHasContent`). Baking
 * either notion in here would quietly make the strip lie on the other screen.
 */
interface ProgressSidebarProps {
  outline: {
    introduction: OutlinePoint[];
    main: OutlinePoint[];
    conclusion: OutlinePoint[];
  };
  /** Point id → does this point already hold plan text. See the note above. */
  filledPointIds: Record<string, boolean>;
}

export const ProgressSidebar: React.FC<ProgressSidebarProps> = ({
  outline,
  filledPointIds,
}) => {
  const { t } = useTranslation();

  const sections = [
    { name: "introduction", points: outline.introduction, color: SERMON_SECTION_COLORS.introduction.light },
    { name: "main", points: outline.main, color: SERMON_SECTION_COLORS.mainPart.light },
    { name: "conclusion", points: outline.conclusion, color: SERMON_SECTION_COLORS.conclusion.light },
  ].filter((section) => section.points.length > 0);

  if (sections.length === 0) return null;

  return (
    <div
      className="fixed left-4 top-1/2 z-50 flex flex-col gap-4 transform -translate-y-1/2"
      data-testid="plan-progress-map"
    >
      {sections.map((section) => (
        <div key={section.name} className="flex flex-col gap-0.5">
          {section.points.map((point) => {
            const filled = Boolean(filledPointIds[point.id]);

            return (
              <div
                key={point.id}
                data-testid="plan-progress-point"
                className={`w-3 h-3 rounded-sm border transition-all duration-300 ${
                  filled
                    ? "border-transparent shadow-sm"
                    : "border-gray-300 bg-gray-200 dark:border-gray-600 dark:bg-gray-700"
                }`}
                // The section colour is a theme value, not a utility class: Tailwind cannot
                // generate a class from it, so the filled state paints itself inline.
                style={filled ? { backgroundColor: section.color } : undefined}
                title={`${point.text} — ${t(filled ? "plan.progressMap.filled" : "plan.progressMap.empty")}`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
};

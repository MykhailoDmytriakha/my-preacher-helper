"use client";

import React from "react";
import { useTranslation } from "react-i18next";

import CardContent from "@/components/CardContent";
import { buildColumnItemIndex } from "@/components/column/columnItemModel";
import { TRANSLATION_STRUCTURE_UNASSIGNED_THOUGHTS } from "@/components/column/constants";
import { getPlaceholderColors, getSectionBorderColor, getSectionHeaderBgStyle } from "@/components/column/utils";
import PointNote from "@/components/PointNote";
import { getCardClassName } from "@/components/SortableItem";
import { buildSubPointRenderableEntries } from "@/utils/subPoints";
import { UI_COLORS } from "@/utils/themeColors";

import { boardLayoutClass } from "../utils/sectionLayout";

import type { Item, SermonPoint } from "@/models/models";

type SectionId = "introduction" | "main" | "conclusion";

const noop = () => undefined;

/** The board's own thought card, minus everything that edits, moves or locks it. */
function ThoughtCard({ item }: { item: Item }) {
  return (
    <div
      data-testid="structure-read-thought"
      className={getCardClassName({
        isHighlighted: false,
        highlightType: "moved",
        hoverShadowClass: "",
        isDeleting: false,
        isDragDisabled: false,
        cursorClass: "cursor-default",
        isOverlay: false,
        isLocked: Boolean(item.isLocked),
      })}
    >
      <CardContent item={item} />
    </div>
  );
}

function PointCard({ point, items, sectionId, headerColor }: {
  point: SermonPoint; items: Item[]; sectionId: SectionId; headerColor?: string;
}) {
  const colors = getPlaceholderColors(sectionId, headerColor);
  const entries = buildSubPointRenderableEntries(items, point.subPoints ?? []);
  return (
    <div className={`${colors.border} ${colors.bg} rounded-lg shadow-sm`} style={headerColor ? { borderColor: headerColor } : {}}>
      <div
        className={`rounded-t-lg border-b border-opacity-20 px-4 py-2 dark:border-opacity-30 ${headerColor ? "" : colors.header}`}
        style={headerColor ? { backgroundColor: `${headerColor}20` } : {}}
      >
        <h4 className={`text-sm font-medium ${headerColor ? "text-gray-800 dark:text-gray-200" : colors.headerText}`}>{point.text}</h4>
        <PointNote note={point.note} onChange={noop} isReadOnly />
      </div>
      <div className="space-y-4 p-4">
        {entries.map((entry) => entry.type === "item" ? (
          <ThoughtCard key={entry.item.id} item={entry.item} />
        ) : (
          <div key={entry.subPoint.id} className="ml-3 rounded-2xl border border-slate-200/90 bg-slate-50/90 px-3 py-3 dark:border-slate-700/70 dark:bg-slate-900/30">
            <p className="pl-1 text-xs font-semibold text-slate-600 dark:text-slate-300">{entry.subPoint.text}</p>
            <div className="pl-1"><PointNote note={entry.subPoint.note} onChange={noop} isReadOnly /></div>
            {entry.items.length > 0 && <div className="mt-3 space-y-4 pl-1">
              {entry.items.map((item) => <ThoughtCard key={item.id} item={item} />)}
            </div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionColumn({ id, title, items, points, headerColor }: {
  id: SectionId; title: string; items: Item[]; points: SermonPoint[]; headerColor?: string;
}) {
  const { t } = useTranslation();
  const index = buildColumnItemIndex(items);
  // Without points every thought is listed; with them, the ones outside any point follow — including
  // thoughts still linked to a point removed elsewhere, so reading never loses a thought.
  const loose = points.length === 0 ? items : [
    ...[...index.byPoint.entries()].filter(([pointId]) => !points.some((point) => point.id === pointId)).flatMap(([, group]) => group.items),
    ...index.unassigned,
  ];
  return (
    <section className="flex flex-col" aria-label={title}>
      <div className="mb-2 rounded-t-md p-3" style={getSectionHeaderBgStyle(id, headerColor)}>
        <h2 className="text-lg font-bold text-white">{title}</h2>
      </div>
      <div
        className={`min-h-[300px] space-y-6 rounded-b-md border-2 p-4 shadow-lg ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg} ${getSectionBorderColor(id, headerColor)} dark:${UI_COLORS.neutral.darkBorder}`}
        style={headerColor ? { borderColor: headerColor } : {}}
      >
        {points.map((point) => (
          <PointCard key={point.id} point={point} items={index.byPoint.get(point.id)?.items ?? []} sectionId={id} headerColor={headerColor} />
        ))}
        {loose.length > 0 && points.length > 0 && (
          <div className={`border-t ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} pt-6`}>
            <h3 className={`mb-4 text-sm font-medium ${UI_COLORS.muted.text} dark:${UI_COLORS.muted.darkText}`}>
              {t(TRANSLATION_STRUCTURE_UNASSIGNED_THOUGHTS)} ({loose.length})
            </h3>
          </div>
        )}
        {loose.map((item) => <ThoughtCard key={item.id} item={item} />)}
        {items.length === 0 && points.length === 0 && (
          <p className={`p-4 text-center ${UI_COLORS.muted.text} dark:${UI_COLORS.muted.darkText}`}>{t("structure.noEntries")}</p>
        )}
      </div>
    </section>
  );
}

/**
 * THE STRUCTURE BOARD ON A COPY FOR READING (device storage silent).
 *
 * The editing board is one piece of drag, AI sorting, dictation and inline editing; switching
 * each of those off one by one leaves any missed one offering a change the copy cannot keep
 * (the same reasoning as the group page, `GroupReadOnlyContent`). This draws the same columns,
 * points, sub-points and thought cards — grouped by the board's own rules and painted in its
 * section colours — and has no control at all. Why it is read-only is said once, for the whole
 * app, by DeviceStorageNotice.
 */
export function StructureReadOnlyBoard({ containers, outlinePoints, sections, titles, headerColors, isVerticalLayout }: {
  containers: Record<string, Item[]>;
  outlinePoints: Record<SectionId, SermonPoint[]>;
  sections: SectionId[];
  titles: Record<string, string>;
  headerColors: Record<string, string | undefined>;
  isVerticalLayout: boolean;
}) {
  const ambiguous = containers.ambiguous ?? [];
  return (
    <div data-testid="structure-read-only-board">
      {ambiguous.length > 0 && (
        <section className="mt-8 rounded-md border border-red-500 bg-white shadow dark:bg-gray-800" aria-label={titles.ambiguous}>
          <h2 className="p-4 text-xl font-semibold dark:text-white">
            {titles.ambiguous} <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-sm text-gray-800 dark:bg-gray-700 dark:text-gray-200">{ambiguous.length}</span>
          </h2>
          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3">
            {ambiguous.map((item) => <ThoughtCard key={item.id} item={item} />)}
          </div>
        </section>
      )}
      <div className={`${boardLayoutClass(sections.length, isVerticalLayout)} mt-8 w-full`}>
        {sections.map((id) => (
          <SectionColumn key={id} id={id} title={titles[id]} items={containers[id] ?? []} points={outlinePoints[id] ?? []} headerColor={headerColors[id]} />
        ))}
      </div>
    </div>
  );
}

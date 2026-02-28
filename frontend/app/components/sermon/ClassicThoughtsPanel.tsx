"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Rows3 } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";

import BrainstormModule from "@/components/sermon/BrainstormModule";
import ThoughtFilterControls from "@/components/sermon/ThoughtFilterControls";
import ThoughtList from "@/components/sermon/ThoughtList";
import { getSectionLabel } from "@/lib/sections";
import { getContrastColor } from "@utils/color";
import { normalizeStructureTag } from "@utils/tagUtils";

import type { BrainstormSuggestion, SermonOutline, Thought } from "@/models/models";
import type { SortOrder, StructureFilter, ViewFilter } from "@hooks/useThoughtFiltering";
import type { Dispatch, Ref, RefObject, SetStateAction } from "react";

interface ClassicThoughtsPanelProps {
  withBrainstorm?: boolean;
  portalRef?: Ref<HTMLDivElement>;
  isClassicMode: boolean;
  activeCount: number;
  totalThoughts: number;
  isFilterOpen: boolean;
  setIsFilterOpen: Dispatch<SetStateAction<boolean>>;
  viewFilter: ViewFilter;
  setViewFilter: Dispatch<SetStateAction<ViewFilter>>;
  structureFilter: StructureFilter;
  setStructureFilter: Dispatch<SetStateAction<StructureFilter>>;
  tagFilters: string[];
  toggleTagFilter: (tag: string) => void;
  resetFilters: () => void;
  sortOrder: SortOrder;
  setSortOrder: Dispatch<SetStateAction<SortOrder>>;
  allowedTags: { name: string; color: string }[];
  hasStructureTags: boolean;
  filterButtonRef: RefObject<HTMLButtonElement | null>;
  isBrainstormOpen: boolean;
  setIsBrainstormOpen: Dispatch<SetStateAction<boolean>>;
  sermonId?: string;
  brainstormSuggestion: BrainstormSuggestion | null;
  setBrainstormSuggestion: Dispatch<SetStateAction<BrainstormSuggestion | null>>;
  filteredThoughts: Thought[];
  sermonOutline: SermonOutline | null | undefined;
  onDelete: (thoughtId: string) => void;
  onEditStart: (thought: Thought, index: number) => void;
  onThoughtUpdate: (updatedThought: Thought) => void;
  isReadOnly: boolean;
}

const StructureFilterBadge = ({ structureFilter }: { structureFilter: string }) => {
  const { t } = useTranslation();
  if (structureFilter === "all") return null;

  const canonical = normalizeStructureTag(structureFilter);
  const label = canonical === "intro"
    ? getSectionLabel(t, "introduction")
    : canonical === "main"
      ? getSectionLabel(t, "main")
      : canonical === "conclusion"
        ? getSectionLabel(t, "conclusion")
        : structureFilter;

  return (
    <span className="px-2 py-1 text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 rounded-full">
      {label}
    </span>
  );
};

const ActiveFilters = ({
  viewFilter,
  structureFilter,
  sortOrder,
  tagFilters,
  allowedTags,
  resetFilters,
}: {
  viewFilter: ViewFilter;
  structureFilter: StructureFilter;
  sortOrder: SortOrder;
  tagFilters: string[];
  allowedTags: { name: string; color: string }[];
  resetFilters: () => void;
}) => {
  const { t } = useTranslation();

  return (
    <motion.div
      key="active-filters"
      className="flex flex-wrap items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/30 rounded-md"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.15, ease: "easeInOut" }}
      layout={false}
    >
      <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
        {t("filters.activeFilters")}:
      </span>

      {viewFilter === "missingTags" && (
        <span className="px-2 py-1 text-xs bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 rounded-full">
          {t("filters.missingTags")}
        </span>
      )}

      <StructureFilterBadge structureFilter={structureFilter} />

      {sortOrder === "structure" && (
        <span className="px-2 py-1 text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded-full">
          {t("filters.sortByStructure") || "Sorted by ThoughtsBySection"}
        </span>
      )}

      {tagFilters.map((tag) => {
        const tagInfo = allowedTags.find((tagItem) => tagItem.name === tag);
        return (
          <span
            key={tag}
            className="px-2 py-1 text-xs rounded-full"
            style={{
              backgroundColor: tagInfo ? tagInfo.color : "#e0e0e0",
              color: tagInfo ? getContrastColor(tagInfo.color) : "#000000",
            }}
          >
            {tag}
          </span>
        );
      })}

      <button
        onClick={resetFilters}
        className="ml-auto mt-2 sm:mt-0 px-3 py-1 text-xs text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 rounded-md transition-colors"
      >
        {t("filters.clear")}
      </button>
    </motion.div>
  );
};

export default function ClassicThoughtsPanel({
  withBrainstorm = true,
  portalRef,
  isClassicMode,
  activeCount,
  totalThoughts,
  isFilterOpen,
  setIsFilterOpen,
  viewFilter,
  setViewFilter,
  structureFilter,
  setStructureFilter,
  tagFilters,
  toggleTagFilter,
  resetFilters,
  sortOrder,
  setSortOrder,
  allowedTags,
  hasStructureTags,
  filterButtonRef,
  isBrainstormOpen,
  setIsBrainstormOpen,
  sermonId,
  brainstormSuggestion,
  setBrainstormSuggestion,
  filteredThoughts,
  sermonOutline,
  onDelete,
  onEditStart,
  onThoughtUpdate,
  isReadOnly,
}: ClassicThoughtsPanelProps) {
  const { t } = useTranslation();
  const hasAnyActiveFilter = viewFilter !== "all" || structureFilter !== "all" || tagFilters.length > 0 || sortOrder !== "date";

  return (
    <motion.div layout={false} className="space-y-4 sm:space-y-6">
      <div ref={portalRef} className="w-full empty:hidden [&>div]:h-full" />

      <section>
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{t("sermon.allThoughts")}</h2>
            <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              {activeCount} / {totalThoughts}
            </span>

            <AnimatePresence initial={false}>
              {isClassicMode && (
                <motion.div
                  key="filter"
                  className="relative ml-0 sm:ml-3 z-50"
                  initial={{ opacity: 0, y: -6, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, y: -6, height: 0 }}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                  style={{ overflow: "visible" }}
                >
                  <div className="inline-flex items-stretch">
                    <div className="relative group flex items-stretch">
                      <button
                        onClick={() => setSortOrder(sortOrder === "structure" ? "date" : "structure")}
                        disabled={!hasStructureTags}
                        className={[
                          "flex items-center justify-center w-9 border border-r-0 rounded-l-md transition-colors",
                          hasStructureTags
                            ? sortOrder === "structure"
                              ? "bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border-blue-500 dark:border-blue-500"
                              : "bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700"
                            : "bg-white dark:bg-gray-800 text-gray-300 dark:text-gray-600 border-gray-300 dark:border-gray-600 cursor-not-allowed opacity-50",
                        ].join(" ")}
                      >
                        <Rows3 className="w-4 h-4" />
                      </button>
                      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded px-2 py-1 text-xs text-white bg-gray-800 dark:bg-gray-700 opacity-0 transition-opacity duration-150 delay-0 group-hover:opacity-100 group-hover:delay-1000 z-50">
                        {t("filters.sortByStructureShort")}
                      </span>
                    </div>
                    <button
                      ref={filterButtonRef}
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsFilterOpen(!isFilterOpen);
                      }}
                      className="inline-flex items-center px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-r-md text-sm font-medium bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
                      data-testid="thought-filter-button"
                    >
                      {t("filters.filter")}
                      <span className={`ml-1 w-2 h-2 bg-blue-600 rounded-full flex-shrink-0 ${hasAnyActiveFilter ? "visible" : "invisible"}`}></span>
                      <svg className="ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>

                  <ThoughtFilterControls
                    isOpen={isFilterOpen}
                    setIsOpen={setIsFilterOpen}
                    viewFilter={viewFilter}
                    setViewFilter={setViewFilter}
                    structureFilter={structureFilter}
                    setStructureFilter={setStructureFilter}
                    tagFilters={tagFilters}
                    toggleTagFilter={toggleTagFilter}
                    resetFilters={resetFilters}
                    sortOrder={sortOrder}
                    setSortOrder={setSortOrder}
                    allowedTags={allowedTags}
                    hasStructureTags={hasStructureTags}
                    buttonRef={filterButtonRef}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {isClassicMode && withBrainstorm && (
                <motion.button
                  key="brainstorm-trigger"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setIsBrainstormOpen(!isBrainstormOpen)}
                  className="inline-flex items-center gap-2 px-3 py-2 border border-amber-300 dark:border-amber-700 rounded-md text-sm font-medium bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 text-amber-700 dark:text-amber-300 hover:from-amber-100 hover:to-yellow-100 dark:hover:from-amber-900/30 dark:hover:to-yellow-900/30 transition-all shadow-sm hover:shadow"
                  aria-label={t("brainstorm.title")}
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z" />
                  </svg>
                  <span className="hidden sm:inline">{t("brainstorm.title")}</span>
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {isClassicMode && isBrainstormOpen && withBrainstorm && (
            <motion.div
              key="brainstorm-panel"
              initial={{ opacity: 0, y: -10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -10, height: 0 }}
              transition={{ duration: 0.25, ease: "easeInOut" }}
              style={{ overflow: "hidden" }}
              className="mb-4"
            >
              <BrainstormModule
                sermonId={sermonId!}
                currentSuggestion={brainstormSuggestion}
                onSuggestionChange={setBrainstormSuggestion}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {isClassicMode && hasAnyActiveFilter && (
            <ActiveFilters
              viewFilter={viewFilter}
              structureFilter={structureFilter}
              sortOrder={sortOrder}
              tagFilters={tagFilters}
              allowedTags={allowedTags}
              resetFilters={resetFilters}
            />
          )}
        </AnimatePresence>

        <motion.div layout={false}>
          <ThoughtList
            filteredThoughts={filteredThoughts}
            totalThoughtsCount={totalThoughts}
            allowedTags={allowedTags}
            sermonOutline={sermonOutline}
            sermonId={sermonId}
            onDelete={onDelete}
            onEditStart={onEditStart}
            onThoughtUpdate={onThoughtUpdate}
            resetFilters={resetFilters}
            isReadOnly={isReadOnly}
          />
        </motion.div>
      </section>
    </motion.div>
  );
}

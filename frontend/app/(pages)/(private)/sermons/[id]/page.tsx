"use client";

import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { BookOpen, Sparkles } from "lucide-react";
import dynamicImport from "next/dynamic";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"; // Import useCallback
import { useTranslation } from "react-i18next";
import "@locales/i18n";

import PreachDateList from "@/components/calendar/PreachDateList";
import BrainstormModule from '@/components/sermon/BrainstormModule';
import KnowledgeSection from "@/components/sermon/KnowledgeSection";
import ExegeticalPlanStepContent from '@/components/sermon/prep/ExegeticalPlanStepContent';
import GoalsStepContent, { GoalType } from '@/components/sermon/prep/GoalsStepContent';
import HomileticPlanStepContent from '@/components/sermon/prep/HomileticPlanStepContent';
import { getActiveStepId } from '@/components/sermon/prep/logic';
import MainIdeaStepContent from '@/components/sermon/prep/MainIdeaStepContent';
import PrepStepCard from '@/components/sermon/prep/PrepStepCard';
import SpiritualStepContent from '@/components/sermon/prep/SpiritualStepContent';
import TextContextStepContent from '@/components/sermon/prep/TextContextStepContent';
import ThesisStepContent from '@/components/sermon/prep/ThesisStepContent';
import SermonHeader from "@/components/sermon/SermonHeader"; // Import the SermonHeader
import SermonOutline from "@/components/sermon/SermonOutline";
import StructurePreview from "@/components/sermon/StructurePreview";
import StructureStats from "@/components/sermon/StructureStats";
import ThoughtFilterControls from '@/components/sermon/ThoughtFilterControls';
import ThoughtList from '@/components/sermon/ThoughtList'; // Import the new list component
import { SermonDetailSkeleton } from "@/components/skeletons/SermonDetailSkeleton";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useSeries } from "@/hooks/useSeries";
import useSermon from "@/hooks/useSermon";
import { useTags } from "@/hooks/useTags";
import { getSectionLabel } from '@/lib/sections';
import { useAuth } from "@/providers/AuthProvider";
import { updateSermonPreparation, updateSermon } from '@/services/sermon.service';
import { updateStructure } from "@/services/structure.service";
import AddThoughtManual from "@components/AddThoughtManual";
import EditThoughtModal from "@components/EditThoughtModal";
import { useThoughtFiltering } from '@hooks/useThoughtFiltering';
import { STRUCTURE_TAGS } from '@lib/constants';
import "@locales/i18n";
import { createAudioThought, deleteThought, updateThought } from "@services/thought.service";
import { getContrastColor } from "@utils/color";
import { getCanonicalTagForSection, normalizeStructureTag } from '@utils/tagUtils';
import { UI_COLORS } from "@utils/themeColors";
import { findThoughtSectionInStructure, insertThoughtIdInStructure, resolveSectionForNewThought, resolveSectionFromOutline } from "@utils/thoughtOrdering";

import type { Sermon, Thought, SermonOutline as SermonOutlineType, Preparation, BrainstormSuggestion } from "@/models/models";
import type { ReactNode } from "react";
export const dynamic = "force-dynamic";

// Smoothly animates its height to match children (prevents jumps when content changes size)
function AutoHeight({ children, duration = 0.25, delay = 0, className = '' }: { children: ReactNode; duration?: number; delay?: number; className?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!containerRef.current || typeof window === 'undefined') return;
    const ResizeObserverCtor = window.ResizeObserver;
    const observer = new ResizeObserverCtor((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr && typeof cr.height === 'number') setHeight(cr.height);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      className={className}
      initial={false}
      animate={height !== undefined ? { height } : undefined}
      transition={{ duration, ease: 'easeInOut', delay }}
      style={{ overflow: 'hidden' }}
    >
      <div ref={containerRef}>{children}</div>
    </motion.div>
  );
}

const AudioRecorder = dynamicImport(
  () => import("@components/AudioRecorder").then((mod) => mod.AudioRecorder),
  {
    ssr: false,
    loading: () => <p>Loading recorder...</p>,
  }
);

export default function SermonPage() {
  // Formats standalone verse numbers (at start or surrounded by spaces) as superscript
  const formatSuperscriptVerses = useCallback((text: string): string => {
    if (!text) return text;
    // Superscript number at the very start if followed by a space
    let result = text.replace(/^(\d{1,3})(?=\s)/, '<sup class="text-gray-300 dark:text-gray-600">$1</sup>');
    // Superscript numbers that are surrounded by spaces
    result = result.replace(/(\s)(\d{1,3})(?=\s)/g, '$1<sup class="text-gray-300 dark:text-gray-600">$2</sup>');
    return result;
  }, []);

  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { series } = useSeries(user?.uid || null);
  const isOnline = useOnlineStatus();
  const isReadOnly = !isOnline;


  // UI mode synced with query param (?mode=prep)
  const searchParams = useSearchParams();
  const modeParam = searchParams?.get('mode');
  const [uiMode, setUiMode] = useState<'classic' | 'prep'>(() => {
    // Initialize from URL param first, then localStorage as fallback
    if (modeParam === 'prep') return 'prep';
    if (typeof window !== 'undefined') {
      const savedMode = localStorage.getItem(`sermon-${id}-mode`);
      if (savedMode === 'prep' || savedMode === 'classic') {
        return savedMode as 'classic' | 'prep';
      }
    }
    return 'classic';
  });

  // Sync UI mode with URL params
  useEffect(() => {
    const mode = (modeParam === 'prep') ? 'prep' : 'classic';
    setUiMode(mode);

    // Save to localStorage for persistence
    if (typeof window !== 'undefined') {
      localStorage.setItem(`sermon-${id}-mode`, mode);
    }
  }, [modeParam, id]);

  const { sermon, setSermon, loading, error } = useSermon(id);
  const [savingPrep, setSavingPrep] = useState(false);
  const [prepDraft, setPrepDraft] = useState<Preparation>({});


  useEffect(() => {
    if (sermon?.preparation) setPrepDraft(sermon.preparation);
  }, [sermon?.preparation]);

  const savePreparation = useCallback(async (partial: Preparation) => {
    if (!sermon) return;
    setSavingPrep(true);
    const next: Preparation = { ...(sermon.preparation ?? {}), ...partial };
    const updated = await updateSermonPreparation(sermon.id, next);
    if (updated) setSermon(prev => (prev ? { ...prev, preparation: updated } : prev));
    setSavingPrep(false);
  }, [sermon, setSermon]);
  const { allTags } = useTags(sermon?.userId);
  const allowedTags = useMemo(
    () => allTags.map((tag) => ({ name: tag.name, color: tag.color })),
    [allTags]
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [storedAudioBlob, setStoredAudioBlob] = useState<Blob | null>(null);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [editingModalData, setEditingModalData] = useState<{ thought: Thought; index: number } | null>(null);
  const { t } = useTranslation();
  const [isFilterOpen, setIsFilterOpen] = useState(false); // Keep this state for dropdown visibility
  // Prep steps expand/collapse management
  const [manuallyExpanded, setManuallyExpanded] = useState<Set<string>>(new Set());
  const stepRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Close filter dropdown when switching to prep mode to avoid floating UI
  useEffect(() => {
    if (uiMode === 'prep' && isFilterOpen) setIsFilterOpen(false);
  }, [uiMode, isFilterOpen]);

  const [isBrainstormOpen, setIsBrainstormOpen] = useState(false);
  const [brainstormSuggestion, setBrainstormSuggestion] = useState<BrainstormSuggestion | null>(null);

  // Reusable renderer for classic content (brainstorm, filters, thoughts)
  const renderClassicContent = (options?: { withBrainstorm?: boolean }) => (
    // Disable layout animations to avoid vertical stretch on filter changes
    <motion.div layout={false} className="space-y-4 sm:space-y-6">
      <section>
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{t('sermon.allThoughts')}</h2>
            <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              {activeCount} / {totalThoughts}
            </span>
            <AnimatePresence initial={false}>
              {uiMode === 'classic' && (
                <motion.div
                  key="filter"
                  className="relative ml-0 sm:ml-3 z-50"
                  initial={{ opacity: 0, y: -6, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -6, height: 0 }}
                  transition={{ duration: 0.2, ease: 'easeInOut' }}
                  style={{ overflow: 'visible' }}
                >
                  <button
                    ref={filterButtonRef}
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsFilterOpen(!isFilterOpen);
                    }}
                    className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
                    data-testid="thought-filter-button"
                  >
                    {t('filters.filter')}
                    {(viewFilter !== 'all' || structureFilter !== 'all' || tagFilters.length > 0 || sortOrder !== 'date') && (
                      <span className="ml-1 w-2 h-2 bg-blue-600 rounded-full"></span>
                    )}
                    <svg className="ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
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
          </div>
          <div className="flex items-center gap-2">
            <AnimatePresence initial={false}>
              {uiMode === 'classic' && (options?.withBrainstorm !== false) && (
                <motion.button
                  key="brainstorm-trigger"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => setIsBrainstormOpen(!isBrainstormOpen)}
                  className="inline-flex items-center gap-2 px-3 py-2 border border-amber-300 dark:border-amber-700 rounded-md text-sm font-medium bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/20 dark:to-yellow-900/20 text-amber-700 dark:text-amber-300 hover:from-amber-100 hover:to-yellow-100 dark:hover:from-amber-900/30 dark:hover:to-yellow-900/30 transition-all shadow-sm hover:shadow"
                  aria-label={t('brainstorm.title')}
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z" />
                  </svg>
                  <span className="hidden sm:inline">{t('brainstorm.title')}</span>
                </motion.button>
              )}
            </AnimatePresence>
            <AddThoughtManual
              sermonId={sermon!.id}
              onNewThought={handleNewManualThought}
              allowedTags={allowedTags}
              sermonOutline={sermon!.outline}
              disabled={isReadOnly}
            />
          </div>
        </div>
        <AnimatePresence initial={false}>
          {uiMode === 'classic' && isBrainstormOpen && (options?.withBrainstorm !== false) && (
            <motion.div
              key="brainstorm-panel"
              initial={{ opacity: 0, y: -10, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -10, height: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              style={{ overflow: 'hidden' }}
              className="mb-4"
            >
              <BrainstormModule
                sermonId={sermon!.id}
                currentSuggestion={brainstormSuggestion}
                onSuggestionChange={setBrainstormSuggestion}
              />
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {uiMode === 'classic' && (viewFilter !== 'all' || structureFilter !== 'all' || tagFilters.length > 0 || sortOrder !== 'date') && (
            <motion.div
              key="active-filters"
              className="flex flex-wrap items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/30 rounded-md"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15, ease: 'easeInOut' }}
              layout={false}
            >
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                {t('filters.activeFilters')}:
              </span>
              {viewFilter === 'missingTags' && (
                <span className="px-2 py-1 text-xs bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 rounded-full">
                  {t('filters.missingTags')}
                </span>
              )}
              {structureFilter !== 'all' && (
                (() => {
                  const canonical = normalizeStructureTag(structureFilter);
                  const label = canonical === 'intro'
                    ? getSectionLabel(t, 'introduction')
                    : canonical === 'main'
                      ? getSectionLabel(t, 'main')
                      : canonical === 'conclusion'
                        ? getSectionLabel(t, 'conclusion')
                        : structureFilter;
                  return (
                    <span className="px-2 py-1 text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 rounded-full">
                      {label}
                    </span>
                  );
                })()
              )}
              {sortOrder === 'structure' && (
                <span className="px-2 py-1 text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded-full">
                  {t('filters.sortByStructure') || 'Sorted by ThoughtsBySection'}
                </span>
              )}
              {tagFilters.map((tag: string) => {
                const tagInfo = allowedTags.find(t => t.name === tag);
                return (
                  <span
                    key={tag}
                    className="px-2 py-1 text-xs rounded-full"
                    style={{
                      backgroundColor: tagInfo ? tagInfo.color : '#e0e0e0',
                      color: tagInfo ? getContrastColor(tagInfo.color) : '#000000'
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
                {t('filters.clear')}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        {/* Do not animate the thoughts column when toggling filter */}
        <motion.div layout={false}>
          <ThoughtList
            filteredThoughts={filteredThoughts}
            totalThoughtsCount={totalThoughts}
            allowedTags={allowedTags}
            sermonOutline={sermon?.outline}
            sermonId={sermon?.id}
            onDelete={handleDeleteThought}
            onEditStart={handleEditThoughtStart}
            onThoughtUpdate={handleThoughtUpdate}
            resetFilters={resetFilters}
            isReadOnly={isReadOnly}
          />
        </motion.div>
      </section>
    </motion.div>
  );

  // Reusable renderer for preparation flow (all prep step cards)
  const renderPrepContent = () => (
    <div className="space-y-4 sm:space-y-6">
      <PrepStepCard
        stepId="spiritual"
        stepNumber={1}
        title={t('wizard.steps.spiritual.title') as string}
        icon={<Sparkles className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />}
        isActive={activeStepId === 'spiritual'}
        isExpanded={isStepExpanded('spiritual')}
        onToggle={() => toggleStep('spiritual')}
        stepRef={(el) => { stepRefs.current['spiritual'] = el; }}
        done={isSpiritualDone}
      >
        <SpiritualStepContent
          prepDraft={prepDraft}
          setPrepDraft={setPrepDraft}
          savePreparation={savePreparation}
          savingPrep={savingPrep}
          formatSuperscriptVerses={formatSuperscriptVerses}
        />
      </PrepStepCard>

      <PrepStepCard
        stepId="textContext"
        stepNumber={2}
        title={t('wizard.steps.textContext.title') as string}
        icon={<BookOpen className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />}
        isActive={activeStepId === 'textContext'}
        isExpanded={isStepExpanded('textContext')}
        onToggle={() => toggleStep('textContext')}
        stepRef={(el) => { stepRefs.current['textContext'] = el; }}
        done={isTextContextDone}
      >
        <TextContextStepContent
          initialVerse={sermon!.verse}
          onSaveVerse={async (nextVerse: string) => {
            setSermon(prev => prev ? { ...prev, verse: nextVerse } : prev);
            const updated = await updateSermon({ ...sermon!, verse: nextVerse });
            if (updated) setSermon(updated);
          }}
          readWholeBookOnceConfirmed={Boolean(prepDraft?.textContext?.readWholeBookOnceConfirmed)}
          onToggleReadWholeBookOnce={async (checked: boolean) => {
            const next: Preparation = {
              ...prepDraft,
              textContext: { ...(prepDraft.textContext ?? {}), readWholeBookOnceConfirmed: checked },
            };
            setPrepDraft(next);
            await savePreparation(next);
          }}
          initialPassageSummary={prepDraft?.textContext?.passageSummary || ''}
          onSavePassageSummary={async (summary: string) => {
            const next: Preparation = {
              ...prepDraft,
              textContext: { ...(prepDraft.textContext ?? {}), passageSummary: summary },
            };
            setPrepDraft(next);
            await savePreparation(next);
          }}
          initialContextNotes={prepDraft?.textContext?.contextNotes || ''}
          onSaveContextNotes={async (notes: string) => {
            const next: Preparation = {
              ...prepDraft,
              textContext: { ...(prepDraft.textContext ?? {}), contextNotes: notes },
            };
            setPrepDraft(next);
            await savePreparation(next);
          }}
          initialRepeatedWords={prepDraft?.textContext?.repeatedWords || []}
          onSaveRepeatedWords={async (words: string[]) => {
            const next: Preparation = {
              ...prepDraft,
              textContext: { ...(prepDraft.textContext ?? {}), repeatedWords: words },
            };
            setPrepDraft(next);
            await savePreparation(next);
          }}
        />
      </PrepStepCard>

      <PrepStepCard
        stepId="exegeticalPlan"
        stepNumber={3}
        title={t('wizard.steps.exegeticalPlan.title') as string}
        icon={<BookOpen className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />}
        isActive={activeStepId === 'exegeticalPlan'}
        isExpanded={isStepExpanded('exegeticalPlan')}
        onToggle={() => toggleStep('exegeticalPlan')}
        stepRef={(el) => { stepRefs.current['exegeticalPlan'] = el; }}
        done={isExegeticalPlanDone}
      >
        <ExegeticalPlanStepContent
          value={prepDraft?.exegeticalPlan || []}
          onChange={(nodes) => {
            setPrepDraft(prev => ({ ...(prev || {}), exegeticalPlan: nodes }));
          }}
          onSave={async (nodes) => {
            const next = { ...(prepDraft || {}), exegeticalPlan: nodes } as Preparation;
            setPrepDraft(next);
            await savePreparation(next);
          }}
          saving={savingPrep}
          authorIntent={prepDraft?.authorIntent || ''}
          onSaveAuthorIntent={async (text: string) => {
            const next: Preparation = { ...(prepDraft || {}), authorIntent: text };
            setPrepDraft(next);
            await savePreparation(next);
          }}
        />
      </PrepStepCard>

      <PrepStepCard
        stepId="mainIdea"
        stepNumber={4}
        title={t('wizard.steps.mainIdea.title') as string}
        icon={<BookOpen className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />}
        isActive={activeStepId === 'mainIdea'}
        isExpanded={isStepExpanded('mainIdea')}
        onToggle={() => toggleStep('mainIdea')}
        stepRef={(el) => { stepRefs.current['mainIdea'] = el; }}
        done={isMainIdeaDone}
      >
        <MainIdeaStepContent
          initialContextIdea={prepDraft?.mainIdea?.contextIdea || ''}
          onSaveContextIdea={async (text: string) => {
            const next: Preparation = { ...prepDraft, mainIdea: { ...(prepDraft?.mainIdea || {}), contextIdea: text } };
            setPrepDraft(next);
            await savePreparation(next);
          }}
          initialTextIdea={prepDraft?.mainIdea?.textIdea || ''}
          onSaveTextIdea={async (text: string) => {
            const next: Preparation = { ...prepDraft, mainIdea: { ...(prepDraft?.mainIdea || {}), textIdea: text } };
            setPrepDraft(next);
            await savePreparation(next);
          }}
          initialArgumentation={prepDraft?.mainIdea?.argumentation || ''}
          onSaveArgumentation={async (text: string) => {
            const next: Preparation = { ...prepDraft, mainIdea: { ...(prepDraft?.mainIdea || {}), argumentation: text } };
            setPrepDraft(next);
            await savePreparation(next);
          }}
        />
      </PrepStepCard>

      <PrepStepCard
        stepId="goals"
        stepNumber={5}
        title={t('wizard.steps.goals.title') as string}
        icon={<BookOpen className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />}
        isActive={activeStepId === 'goals'}
        isExpanded={isStepExpanded('goals')}
        onToggle={() => toggleStep('goals')}
        stepRef={(el) => { stepRefs.current['goals'] = el; }}
        done={isGoalsDone}
      >
        <GoalsStepContent
          initialTimelessTruth={prepDraft?.timelessTruth || ''}
          onSaveTimelessTruth={async (text: string) => {
            const next: Preparation = { ...prepDraft, timelessTruth: text };
            setPrepDraft(next);
            await savePreparation(next);
          }}
          initialChristConnection={prepDraft?.christConnection || ''}
          onSaveChristConnection={async (text: string) => {
            const next: Preparation = { ...prepDraft, christConnection: text };
            setPrepDraft(next);
            await savePreparation(next);
          }}
          initialGoalStatement={prepDraft?.preachingGoal?.statement || ''}
          onSaveGoalStatement={async (text: string) => {
            const next: Preparation = {
              ...prepDraft,
              preachingGoal: { ...(prepDraft?.preachingGoal || {}), statement: text },
            };
            setPrepDraft(next);
            await savePreparation(next);
          }}
          initialGoalType={(prepDraft?.preachingGoal?.type as GoalType) || ''}
          onSaveGoalType={async (type) => {
            const next: Preparation = {
              ...prepDraft,
              preachingGoal: { ...(prepDraft?.preachingGoal || {}), type },
            };
            setPrepDraft(next);
            await savePreparation(next);
          }}
        />
      </PrepStepCard>

      <PrepStepCard
        stepId="thesis"
        stepNumber={6}
        title={t('wizard.steps.thesis.title') as string}
        icon={<BookOpen className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />}
        isActive={activeStepId === 'thesis'}
        isExpanded={isStepExpanded('thesis')}
        onToggle={() => toggleStep('thesis')}
        stepRef={(el) => { stepRefs.current['thesis'] = el; }}
        done={isThesisDone}
      >
        <ThesisStepContent
          exegetical={prepDraft?.thesis?.exegetical || ''}
          onSaveExegetical={async (text: string) => {
            const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), exegetical: text } };
            setPrepDraft(next);
            await savePreparation(next);
          }}
          homiletical={prepDraft?.thesis?.homiletical || ''}
          onSaveHomiletical={async (text: string) => {
            const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), homiletical: text } };
            setPrepDraft(next);
            await savePreparation(next);
          }}
          pluralKey={prepDraft?.thesis?.pluralKey || ''}
          onSavePluralKey={async (text: string) => {
            const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), pluralKey: text } };
            setPrepDraft(next);
            await savePreparation(next);
          }}
          transitionSentence={prepDraft?.thesis?.transitionSentence || ''}
          onSaveTransitionSentence={async (text: string) => {
            const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), transitionSentence: text } };
            setPrepDraft(next);
            await savePreparation(next);
          }}
          oneSentence={prepDraft?.thesis?.oneSentence || ''}
          onSaveOneSentence={async (text: string) => {
            const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), oneSentence: text } };
            setPrepDraft(next);
            await savePreparation(next);
          }}
          sermonInOneSentence={prepDraft?.thesis?.sermonInOneSentence || ''}
          onSaveSermonInOneSentence={async (text: string) => {
            const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), sermonInOneSentence: text } };
            setPrepDraft(next);
            await savePreparation(next);
          }}
        />
      </PrepStepCard>

      <PrepStepCard
        stepId="homileticPlan"
        stepNumber={7}
        title={t('wizard.steps.homileticPlan.title') as string}
        icon={<BookOpen className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />}
        isActive={activeStepId === 'homileticPlan'}
        isExpanded={isStepExpanded('homileticPlan')}
        onToggle={() => toggleStep('homileticPlan')}
        stepRef={(el) => { stepRefs.current['homileticPlan'] = el; }}
        done={isHomileticPlanDone}
      >
        <HomileticPlanStepContent
          initialModernTranslation={prepDraft?.homileticPlan?.modernTranslation || ''}
          onSaveModernTranslation={async (text: string) => {
            const next: Preparation = { ...prepDraft, homileticPlan: { ...(prepDraft?.homileticPlan || {}), modernTranslation: text } };
            setPrepDraft(next);
            await savePreparation(next);
          }}
          initialUpdatedPlan={prepDraft?.homileticPlan?.updatedPlan || []}
          onSaveUpdatedPlan={async (items) => {
            const next: Preparation = { ...prepDraft, homileticPlan: { ...(prepDraft?.homileticPlan || {}), updatedPlan: items } };
            setPrepDraft(next);
            await savePreparation(next);
          }}
          initialSermonPlan={prepDraft?.homileticPlan?.sermonPlan || []}
          onSaveSermonPlan={async (items) => {
            const next: Preparation = { ...prepDraft, homileticPlan: { ...(prepDraft?.homileticPlan || {}), sermonPlan: items } };
            setPrepDraft(next);
            await savePreparation(next);
          }}
        />
      </PrepStepCard>
    </div>
  );

  // Determine active step based on data completeness
  const activeStepId: 'spiritual' | 'textContext' | 'exegeticalPlan' | 'mainIdea' | 'goals' | 'thesis' | 'homileticPlan' = getActiveStepId(prepDraft);

  const isStepExpanded = useCallback((id: 'spiritual' | 'textContext' | 'exegeticalPlan' | 'mainIdea' | 'goals' | 'thesis' | 'homileticPlan') => {
    return id === activeStepId || manuallyExpanded.has(id);
  }, [activeStepId, manuallyExpanded]);

  const toggleStep = useCallback((id: 'spiritual' | 'textContext' | 'exegeticalPlan' | 'mainIdea' | 'goals' | 'thesis' | 'homileticPlan') => {
    if (id === activeStepId) return; // active step stays open
    setManuallyExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, [activeStepId]);

  // Optional deep link handling (?prepStep=spiritual|textContext|exegeticalPlan|mainIdea|goals|thesis|homileticPlan)
  const prepStepParam = searchParams?.get('prepStep');
  useEffect(() => {
    const target = prepStepParam;
    if (target === 'spiritual' || target === 'textContext' || target === 'exegeticalPlan' || target === 'mainIdea' || target === 'goals' || target === 'thesis' || target === 'homileticPlan') {
      if (target !== activeStepId && !manuallyExpanded.has(target)) {
        setManuallyExpanded(prev => new Set(prev).add(target));
      }
      // Scroll into view after paint; clear any pending timer on dependency change
      const timer = setTimeout(() => {
        const el = stepRefs.current[target!];
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 50);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepStepParam, activeStepId]);

  // Use the custom hook for filtering logic
  const {
    filteredThoughts,
    activeCount,
    viewFilter,
    setViewFilter,
    structureFilter,
    setStructureFilter,
    tagFilters,
    toggleTagFilter,
    resetFilters,
    sortOrder,
    setSortOrder,
    hasStructureTags
  } = useThoughtFiltering({
    initialThoughts: sermon?.thoughts ?? [],
    sermonStructure: sermon?.structure, // Pass structure to hook
    sermonOutline: sermon?.outline // Also pass outline to refine ordering
  });

  // Ref for the filter toggle button (passed to controls)
  const filterButtonRef = useRef<HTMLButtonElement>(null);

  // Calculate the number of thoughts for each outline point
  const calculateThoughtsPerSermonPoint = () => {
    if (!sermon || !sermon.thoughts || !sermon.outline) return {};

    const counts: Record<string, number> = {};

    // Count thoughts for each outline point ID
    sermon.thoughts.forEach(thought => {
      if (thought.outlinePointId) {
        counts[thought.outlinePointId] = (counts[thought.outlinePointId] || 0) + 1;
      }
    });

    return counts;
  };

  const thoughtsPerSermonPoint = calculateThoughtsPerSermonPoint();



  // Completion status helpers
  const isTextContextDone = Boolean(
    prepDraft?.textContext?.readWholeBookOnceConfirmed &&
    (prepDraft?.textContext?.contextNotes || '').trim().length > 0 &&
    (prepDraft?.textContext?.repeatedWords && prepDraft.textContext.repeatedWords.length > 0)
  );
  const isSpiritualDone = Boolean(prepDraft?.spiritual?.readAndPrayedConfirmed);
  const isExegeticalPlanDone = Boolean(
    prepDraft?.exegeticalPlan &&
    prepDraft.exegeticalPlan.length > 0 &&
    prepDraft.exegeticalPlan.some(node =>
      (node.title || '').trim().length > 0 ||
      (node.children && node.children.some(child => (child.title || '').trim().length > 0))
    ) &&
    prepDraft?.authorIntent &&
    prepDraft.authorIntent.trim().length > 0
  );
  const isMainIdeaDone = Boolean(
    prepDraft?.mainIdea?.contextIdea &&
    prepDraft.mainIdea.contextIdea.trim().length > 0 &&
    prepDraft?.mainIdea?.textIdea &&
    prepDraft.mainIdea.textIdea.trim().length > 0 &&
    prepDraft?.mainIdea?.argumentation &&
    prepDraft.mainIdea.argumentation.trim().length > 0
  );

  const isGoalsDone = Boolean(
    (prepDraft?.timelessTruth || '').trim().length > 0 &&
    (prepDraft?.preachingGoal?.statement || '').trim().length > 0
  );

  const isThesisDone = Boolean(
    (prepDraft?.thesis?.exegetical || '').trim().length > 0 &&
    (prepDraft?.thesis?.homiletical || '').trim().length > 0 &&
    (prepDraft?.thesis?.oneSentence || '').trim().length > 0
  );

  const isHomileticPlanDone = Boolean(
    (prepDraft?.homileticPlan?.modernTranslation || '').trim().length > 0 &&
    ((prepDraft?.homileticPlan?.sermonPlan || []).filter(p => (p.title || '').trim().length > 0).length >= 2)
  );


  // Check for inconsistencies between tags and assigned plan points
  const checkForInconsistentThoughts = (): boolean => {
    if (!sermon || !sermon.thoughts || !sermon.outline) return false;

    // Check each thought
    return sermon.thoughts.some(thought => {
      // 1. Check for multiple required tags on one thought
      const usedRequiredTags = thought.tags
        .map((tag) => normalizeStructureTag(tag))
        .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));
      if (usedRequiredTags.length > 1) {
        return true; // Inconsistency: multiple required tags
      }

      // 2. Check for inconsistency between tag and assigned plan point
      if (!thought.outlinePointId) return false; // If no assigned plan point, no issue

      // Determine the section of the plan point
      let outlinePointSection: string | undefined;

      if (sermon.outline!.introduction.some(p => p.id === thought.outlinePointId)) {
        outlinePointSection = 'introduction';
      } else if (sermon.outline!.main.some(p => p.id === thought.outlinePointId)) {
        outlinePointSection = 'main';
      } else if (sermon.outline!.conclusion.some(p => p.id === thought.outlinePointId)) {
        outlinePointSection = 'conclusion';
      }

      if (!outlinePointSection) return false; // If section not found, consider it consistent

      // Get the expected tag for the current section
      const expectedTag = getCanonicalTagForSection(outlinePointSection as 'introduction' | 'main' | 'conclusion');

      // Check if the thought has the expected tag for the current section
      const hasExpectedTag = thought.tags.some(tag => normalizeStructureTag(tag) === expectedTag);

      // Check if the thought has tags from other sections
      const hasOtherSectionTags = ['intro', 'main', 'conclusion']
        .filter(tag => tag !== expectedTag)
        .some(tag => thought.tags.some(t => normalizeStructureTag(t) === tag));

      // Inconsistency if no expected tag or other section tags present
      return !(!hasOtherSectionTags || hasExpectedTag);
    });
  };

  // Check for inconsistencies
  const hasInconsistentThoughts = checkForInconsistentThoughts();

  // Function to update only the outline part of the sermon state
  const handleOutlineUpdate = (updatedOutline: SermonOutlineType) => {
    setSermon(prevSermon => {
      if (!prevSermon) return null;
      return {
        ...prevSermon,
        outline: updatedOutline,
      };
    });
  };

  // Callback function to update sermon state after title edit
  const handleSermonUpdate = useCallback((updatedSermon: Sermon) => {
    setSermon(updatedSermon);
  }, [setSermon]);

  const handleThoughtUpdate = useCallback((updatedThought: Thought) => {
    setSermon((prevSermon) => {
      if (!prevSermon) return null;
      return {
        ...prevSermon,
        thoughts: prevSermon.thoughts.map(t =>
          t.id === updatedThought.id ? updatedThought : t
        ),
      };
    });
  }, [setSermon]);

  const appendNewThoughtWithStructure = useCallback(async (newThought: Thought) => {
    if (!sermon) return;

    const targetSection = resolveSectionForNewThought({
      sermon,
      outlinePointId: newThought.outlinePointId ?? null,
      tags: newThought.tags,
    });

    const thoughtsById = new Map(
      [...(sermon.thoughts ?? []), newThought].map((thought) => [thought.id, thought])
    );
    const updatedStructure = insertThoughtIdInStructure({
      structure: sermon.structure,
      section: targetSection,
      thoughtId: newThought.id,
      outlinePointId: newThought.outlinePointId,
      thoughtsById,
      thoughts: [...(sermon.thoughts ?? []), newThought],
      outline: sermon.outline,
    });

    setSermon((prevSermon) =>
      prevSermon
        ? { ...prevSermon, thoughts: [newThought, ...(prevSermon.thoughts ?? [])], structure: updatedStructure, thoughtsBySection: updatedStructure }
        : prevSermon
    );

    try {
      await updateStructure(sermon.id, updatedStructure);
    } catch (error) {
      console.error("Failed to update structure after adding thought", error);
      alert(t('errors.failedToSaveStructure') || 'Failed to save structure.');
    }
  }, [sermon, setSermon, t]);

  // Show skeleton while loading OR if we have no data and no error yet (initial fetch)
  if (loading || (!sermon && !error)) {
    return <SermonDetailSkeleton />;
  }

  // If we have an error or still no sermon (checked above, so this implies done loading + no data), show Not Found
  if (!sermon) {
    return (
      <div className="py-8">
        <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 text-center">
          <h2 className="text-xl font-semibold mb-2">{t('sermon.notFound')}</h2>
          <Link href="/dashboard" className="text-blue-600 dark:text-blue-400 hover:underline">
            {t('sermon.backToList')}
          </Link>
        </div>
      </div>
    );
  }

  if (!sermon.thoughts) {
    sermon.thoughts = [];
  }
  const totalThoughts = sermon.thoughts.length;
  const countByCanonical = (canonical: string) => sermon.thoughts.reduce(
    (count, thought) => count + (thought.tags.some(tag => normalizeStructureTag(tag) === canonical) ? 1 : 0),
    0
  );
  const tagCounts = {
    [STRUCTURE_TAGS.INTRODUCTION]: countByCanonical('intro'),
    [STRUCTURE_TAGS.MAIN_BODY]: countByCanonical('main'),
    [STRUCTURE_TAGS.CONCLUSION]: countByCanonical('conclusion'),
  };

  const handleNewRecording = async (audioBlob: Blob) => {
    setIsProcessing(true);
    setStoredAudioBlob(audioBlob);
    setTranscriptionError(null);
    setRetryCount(0);

    try {
      const thoughtResponse = await createAudioThought(audioBlob, sermon.id, 0, 3);
      const newThought: Thought = { ...thoughtResponse };
      await appendNewThoughtWithStructure(newThought);

      // Clear stored audio on success
      setStoredAudioBlob(null);
      setTranscriptionError(null);
    } catch (error) {
      console.error("handleNewRecording: Recording error:", error);
      setTranscriptionError(error instanceof Error ? error.message : 'Unknown error occurred');

      // Don't show alert here - let the AudioRecorder component handle the UI
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRetryTranscription = async () => {
    if (!storedAudioBlob) return;

    setIsProcessing(true);
    const newRetryCount = retryCount + 1;
    setRetryCount(newRetryCount);
    setTranscriptionError(null);

    try {
      const thoughtResponse = await createAudioThought(storedAudioBlob, sermon.id, newRetryCount, 3);
      const newThought: Thought = { ...thoughtResponse };
      await appendNewThoughtWithStructure(newThought);

      // Clear stored audio on success
      setStoredAudioBlob(null);
      setTranscriptionError(null);
      setRetryCount(0);
    } catch (error) {
      console.error("handleRetryTranscription: Recording error:", error);
      setTranscriptionError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClearError = () => {
    setTranscriptionError(null);
    setStoredAudioBlob(null);
    setRetryCount(0);
  };

  const handleDeleteThought = async (thoughtId: string) => {
    const thoughtToDelete = sermon.thoughts.find(t => t.id === thoughtId);
    if (!thoughtToDelete) {
      console.error("Could not find thought with ID:", thoughtId);
      alert(t('errors.thoughtDeleteError'));
      return;
    }

    const confirmed = window.confirm(t('sermon.deleteThoughtConfirm', { text: thoughtToDelete.text }));
    if (!confirmed) return;
    try {
      await deleteThought(sermon.id, thoughtToDelete);
      setSermon((prevSermon) => prevSermon ? {
        ...prevSermon,
        thoughts: prevSermon.thoughts.filter(t => t.id !== thoughtId),
      } : null);
    } catch (error) {
      console.error("Failed to delete thought", error);
      alert(t('errors.thoughtDeleteError'));
    }
  };

  const handleSaveEditedThought = async (updatedText: string, updatedTags: string[], outlinePointId?: string) => {
    if (!editingModalData) return;
    const originalThoughtId = editingModalData.thought.id;

    const thoughtIndex = sermon.thoughts.findIndex(t => t.id === originalThoughtId);
    if (thoughtIndex === -1) {
      console.error("Could not find thought with ID:", originalThoughtId);
      alert(t('errors.thoughtUpdateError'));
      setEditingModalData(null);
      return;
    }

    const thoughtToUpdate = sermon.thoughts[thoughtIndex];
    const updatedThoughtData = {
      ...thoughtToUpdate,
      text: updatedText.trim(),
      tags: updatedTags,
      outlinePointId
    };

    try {
      await updateThought(sermon.id, updatedThoughtData);
      const outlineSection = resolveSectionFromOutline(sermon, outlinePointId ?? null);
      const currentSection = findThoughtSectionInStructure(sermon.structure, thoughtToUpdate.id);
      let updatedStructure = sermon.structure;
      let structureChanged = false;

      if (outlinePointId && outlineSection && outlineSection !== currentSection) {
        const thoughtsById = new Map(
          [...sermon.thoughts.filter((t) => t.id !== thoughtToUpdate.id), updatedThoughtData].map((thought) => [thought.id, thought])
        );
        updatedStructure = insertThoughtIdInStructure({
          structure: sermon.structure,
          section: outlineSection,
          thoughtId: thoughtToUpdate.id,
          outlinePointId,
          thoughtsById,
          thoughts: [...sermon.thoughts.filter((t) => t.id !== thoughtToUpdate.id), updatedThoughtData],
          outline: sermon.outline,
        });
        structureChanged = true;
      }

      setSermon((prevSermon) => {
        if (!prevSermon) return null;
        const newThoughts = [...prevSermon.thoughts];
        newThoughts[thoughtIndex] = updatedThoughtData;
        return {
          ...prevSermon,
          thoughts: newThoughts,
          structure: updatedStructure ?? prevSermon.structure,
          thoughtsBySection: updatedStructure ?? prevSermon.thoughtsBySection,
        };
      });
      if (structureChanged && updatedStructure) {
        try {
          await updateStructure(sermon.id, updatedStructure);
        } catch (error) {
          console.error("Failed to update structure after outline change", error);
          alert(t('errors.failedToSaveStructure') || 'Failed to save structure.');
        }
      }
      setEditingModalData(null);
    } catch (error) {
      console.error("Failed to update thought", error);
      alert(t('errors.thoughtUpdateError'));
    }
  };

  const handleNewManualThought = (newThought: Thought) => {
    void appendNewThoughtWithStructure(newThought);
  };

  const handleEditThoughtStart = (thought: Thought, index: number) => {
    setEditingModalData({ thought, index });
  };

  return (
    <div className="space-y-4 sm:space-y-6 py-4 sm:py-8">
      <SermonHeader sermon={sermon} series={series} onUpdate={handleSermonUpdate} />
      {/* Mobile-first placement of ThoughtsBySection section between header and audio */}
      <div className="lg:hidden">
        <StructureStats
          sermon={sermon!}
          tagCounts={tagCounts}
          totalThoughts={totalThoughts}
          hasInconsistentThoughts={hasInconsistentThoughts}
        />
      </div>

      {/* Single persistent recorder with smooth height transition */}
      <AutoHeight>
        <AudioRecorder
          onRecordingComplete={handleNewRecording}
          isProcessing={isProcessing}
          onRetry={handleRetryTranscription}
          retryCount={retryCount}
          maxRetries={3}
          transcriptionError={transcriptionError}
          onClearError={handleClearError}
          hideKeyboardShortcuts={uiMode === 'prep'}
        />
      </AutoHeight>

      {false && (
        <motion.div
          className={`grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8 ${uiMode === 'prep' ? 'prep-mode' : ''}`}
        >
          <motion.div
            className="lg:col-span-2 space-y-4 sm:space-y-6"
          >
            <MotionConfig reducedMotion="user">
              <AnimatePresence initial={false}>
                {uiMode === 'classic' && (
                  <motion.div
                    key="classicColumn"
                    initial={{ opacity: 0, x: -40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -40 }}
                    transition={{ duration: 0.3, ease: 'easeInOut' }}
                    className="space-y-4 sm:space-y-6"
                  >
                    <section>
                      <AudioRecorder
                        onRecordingComplete={handleNewRecording}
                        isProcessing={isProcessing}
                        onRetry={handleRetryTranscription}
                        retryCount={retryCount}
                        maxRetries={3}
                        transcriptionError={transcriptionError}
                        onClearError={handleClearError}
                      />
                    </section>
                    <section>
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-xl font-semibold">{t('sermon.allThoughts')}</h2>
                          <span className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-sm font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                            {activeCount} / {totalThoughts}
                          </span>
                          <div className="relative ml-0 sm:ml-3">
                            <button
                              ref={filterButtonRef}
                              onClick={(e) => {
                                e.stopPropagation();
                                setIsFilterOpen(!isFilterOpen);
                              }}
                              className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm font-medium bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700"
                              data-testid="thought-filter-button"
                            >
                              {t('filters.filter')}
                              {(viewFilter !== 'all' || structureFilter !== 'all' || tagFilters.length > 0 || sortOrder !== 'date') && (
                                <span className="ml-1 w-2 h-2 bg-blue-600 rounded-full"></span>
                              )}
                              <svg className="ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
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
                          </div>
                        </div>
                        <AddThoughtManual
                          sermonId={sermon!.id}
                          onNewThought={handleNewManualThought}
                          allowedTags={allowedTags}
                          sermonOutline={sermon!.outline}
                          disabled={isReadOnly}
                        />
                      </div>
                      <div className="space-y-5">
                        {(viewFilter !== 'all' || structureFilter !== 'all' || tagFilters.length > 0 || sortOrder !== 'date') && (
                          <div className="flex flex-wrap items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/30 rounded-md">
                            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                              {t('filters.activeFilters')}:
                            </span>
                            {viewFilter === 'missingTags' && (
                              <span className="px-2 py-1 text-xs bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 rounded-full">
                                {t('filters.missingTags')}
                              </span>
                            )}
                            {structureFilter !== 'all' && (
                              <span className="px-2 py-1 text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 rounded-full">
                                {t(`tags.${structureFilter.toLowerCase().replace(/\s+/g, '_')}`)}
                              </span>
                            )}
                            {sortOrder === 'structure' && (
                              <span className="px-2 py-1 text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded-full">
                                {t('filters.sortByStructure') || 'Sorted by ThoughtsBySection'}
                              </span>
                            )}
                            {tagFilters.map((tag: string) => {
                              const tagInfo = allowedTags.find(t => t.name === tag);
                              return (
                                <span
                                  key={tag}
                                  className="px-2 py-1 text-xs rounded-full"
                                  style={{
                                    backgroundColor: tagInfo ? tagInfo.color : '#e0e0e0',
                                    color: tagInfo ? getContrastColor(tagInfo.color) : '#000000'
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
                              {t('filters.clear')}
                            </button>
                          </div>
                        )}
                        <ThoughtList
                          filteredThoughts={filteredThoughts}
                          totalThoughtsCount={totalThoughts}
                          allowedTags={allowedTags}
                          sermonOutline={sermon?.outline}
                          sermonId={sermon?.id}
                          onDelete={handleDeleteThought}
                          onEditStart={handleEditThoughtStart}
                          onThoughtUpdate={handleThoughtUpdate}
                          resetFilters={resetFilters}
                          isReadOnly={isReadOnly}
                        />
                      </div>
                    </section>
                  </motion.div>
                )}
              </AnimatePresence>
            </MotionConfig>
            <AnimatePresence initial={false}>
              {uiMode === 'prep' ? (
                <motion.div
                  key="prepColumn"
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 40 }}
                  transition={{ duration: 0.3, ease: 'easeInOut' }}
                  className="space-y-4 sm:space-y-6"
                >
                  <PrepStepCard
                    stepId="spiritual"
                    stepNumber={1}
                    title={t('wizard.steps.spiritual.title') as string}
                    icon={<Sparkles className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />}
                    isActive={activeStepId === 'spiritual'}
                    isExpanded={isStepExpanded('spiritual')}
                    onToggle={() => toggleStep('spiritual')}
                    stepRef={(el) => { stepRefs.current['spiritual'] = el; }}
                    done={isSpiritualDone}
                  >
                    <SpiritualStepContent
                      prepDraft={prepDraft}
                      setPrepDraft={setPrepDraft}
                      savePreparation={savePreparation}
                      savingPrep={savingPrep}
                      formatSuperscriptVerses={formatSuperscriptVerses}
                    />
                  </PrepStepCard>

                  <PrepStepCard
                    stepId="textContext"
                    stepNumber={2}
                    title={t('wizard.steps.textContext.title') as string}
                    icon={<BookOpen className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />}
                    isActive={activeStepId === 'textContext'}
                    isExpanded={isStepExpanded('textContext')}
                    onToggle={() => toggleStep('textContext')}
                    stepRef={(el) => { stepRefs.current['textContext'] = el; }}
                    done={isTextContextDone}
                  >
                    <TextContextStepContent
                      initialVerse={sermon!.verse}
                      onSaveVerse={async (nextVerse: string) => {
                        // optimistic update
                        setSermon(prev => prev ? { ...prev, verse: nextVerse } : prev);
                        const updated = await updateSermon({ ...sermon!, verse: nextVerse });
                        if (updated) setSermon(updated);
                      }}
                      readWholeBookOnceConfirmed={Boolean(prepDraft?.textContext?.readWholeBookOnceConfirmed)}
                      onToggleReadWholeBookOnce={async (checked: boolean) => {
                        const next: Preparation = {
                          ...prepDraft,
                          textContext: { ...(prepDraft.textContext ?? {}), readWholeBookOnceConfirmed: checked },
                        };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                      initialPassageSummary={prepDraft?.textContext?.passageSummary || ''}
                      onSavePassageSummary={async (summary: string) => {
                        const next: Preparation = {
                          ...prepDraft,
                          textContext: { ...(prepDraft.textContext ?? {}), passageSummary: summary },
                        };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                      initialContextNotes={prepDraft?.textContext?.contextNotes || ''}
                      onSaveContextNotes={async (notes: string) => {
                        const next: Preparation = {
                          ...prepDraft,
                          textContext: { ...(prepDraft.textContext ?? {}), contextNotes: notes },
                        };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                      initialRepeatedWords={prepDraft?.textContext?.repeatedWords || []}
                      onSaveRepeatedWords={async (words: string[]) => {
                        const next: Preparation = {
                          ...prepDraft,
                          textContext: { ...(prepDraft.textContext ?? {}), repeatedWords: words },
                        };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                    />
                  </PrepStepCard>

                  <PrepStepCard
                    stepId="exegeticalPlan"
                    stepNumber={3}
                    title={t('wizard.steps.exegeticalPlan.title') as string}
                    icon={<BookOpen className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />}
                    isActive={activeStepId === 'exegeticalPlan'}
                    isExpanded={isStepExpanded('exegeticalPlan')}
                    onToggle={() => toggleStep('exegeticalPlan')}
                    stepRef={(el) => { stepRefs.current['exegeticalPlan'] = el; }}
                    done={isExegeticalPlanDone}
                  >
                    <ExegeticalPlanStepContent
                      value={prepDraft?.exegeticalPlan || []}
                      onChange={(nodes) => {
                        setPrepDraft(prev => ({ ...(prev || {}), exegeticalPlan: nodes }));
                      }}
                      onSave={async (nodes) => {
                        const next = { ...(prepDraft || {}), exegeticalPlan: nodes } as Preparation;
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                      saving={savingPrep}
                      authorIntent={prepDraft?.authorIntent || ''}
                      onSaveAuthorIntent={async (text: string) => {
                        const next: Preparation = { ...(prepDraft || {}), authorIntent: text };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                    />
                  </PrepStepCard>

                  <PrepStepCard
                    stepId="mainIdea"
                    stepNumber={4}
                    title={t('wizard.steps.mainIdea.title') as string}
                    icon={<Sparkles className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />}
                    isActive={false}
                    isExpanded={isStepExpanded('mainIdea')}
                    onToggle={() => toggleStep('mainIdea')}
                    stepRef={(el) => { stepRefs.current['mainIdea'] = el; }}
                    done={isMainIdeaDone}
                  >
                    <MainIdeaStepContent
                      initialContextIdea={prepDraft?.mainIdea?.contextIdea || ''}
                      onSaveContextIdea={async (text: string) => {
                        const next: Preparation = {
                          ...prepDraft,
                          mainIdea: { ...(prepDraft.mainIdea ?? {}), contextIdea: text },
                        };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                      initialTextIdea={prepDraft?.mainIdea?.textIdea || ''}
                      onSaveTextIdea={async (text: string) => {
                        const next: Preparation = {
                          ...prepDraft,
                          mainIdea: { ...(prepDraft.mainIdea ?? {}), textIdea: text },
                        };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                      initialArgumentation={prepDraft?.mainIdea?.argumentation || ''}
                      onSaveArgumentation={async (text: string) => {
                        const next: Preparation = {
                          ...prepDraft,
                          mainIdea: { ...(prepDraft.mainIdea ?? {}), argumentation: text },
                        };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                    />
                  </PrepStepCard>
                  <PrepStepCard
                    stepId="goals"
                    stepNumber={5}
                    title={t('wizard.steps.goals.title') as string}
                    icon={<Sparkles className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />}
                    isActive={activeStepId === 'goals'}
                    isExpanded={isStepExpanded('goals')}
                    onToggle={() => toggleStep('goals')}
                    stepRef={(el) => { stepRefs.current['goals'] = el; }}
                    done={isGoalsDone}
                  >
                    <GoalsStepContent
                      initialTimelessTruth={prepDraft?.timelessTruth || ''}
                      onSaveTimelessTruth={async (text: string) => {
                        const next: Preparation = { ...prepDraft, timelessTruth: text };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                      initialChristConnection={prepDraft?.christConnection || ''}
                      onSaveChristConnection={async (text: string) => {
                        const next: Preparation = { ...prepDraft, christConnection: text };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                      initialGoalStatement={prepDraft?.preachingGoal?.statement || ''}
                      onSaveGoalStatement={async (text: string) => {
                        const next: Preparation = {
                          ...prepDraft,
                          preachingGoal: { ...(prepDraft?.preachingGoal || {}), statement: text },
                        };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                      initialGoalType={(prepDraft?.preachingGoal?.type as GoalType) || ''}
                      onSaveGoalType={async (type) => {
                        const next: Preparation = {
                          ...prepDraft,
                          preachingGoal: { ...(prepDraft?.preachingGoal || {}), type },
                        };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                    />
                  </PrepStepCard>
                  <PrepStepCard
                    stepId="thesis"
                    stepNumber={6}
                    title={t('wizard.steps.thesis.title') as string}
                    icon={<BookOpen className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />}
                    isActive={activeStepId === 'thesis'}
                    isExpanded={isStepExpanded('thesis')}
                    onToggle={() => toggleStep('thesis')}
                    stepRef={(el) => { stepRefs.current['thesis'] = el; }}
                    done={isThesisDone}
                  >
                    <ThesisStepContent
                      exegetical={prepDraft?.thesis?.exegetical || ''}
                      onSaveExegetical={async (text: string) => {
                        const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), exegetical: text } };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                      whyPreach={prepDraft?.thesis?.homileticalAnswers?.whyPreach || ''}
                      onSaveWhyPreach={async (text: string) => {
                        const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), homileticalAnswers: { ...(prepDraft?.thesis?.homileticalAnswers || {}), whyPreach: text } } };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                      impactOnChurch={prepDraft?.thesis?.homileticalAnswers?.impactOnChurch || ''}
                      onSaveImpactOnChurch={async (text: string) => {
                        const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), homileticalAnswers: { ...(prepDraft?.thesis?.homileticalAnswers || {}), impactOnChurch: text } } };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                      practicalQuestions={prepDraft?.thesis?.homileticalAnswers?.practicalQuestions || ''}
                      onSavePracticalQuestions={async (text: string) => {
                        const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), homileticalAnswers: { ...(prepDraft?.thesis?.homileticalAnswers || {}), practicalQuestions: text } } };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                      homiletical={prepDraft?.thesis?.homiletical || ''}
                      onSaveHomiletical={async (text: string) => {
                        const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), homiletical: text } };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                      questionWord={prepDraft?.thesis?.questionWord || ''}
                      onSaveQuestionWord={async (text: string) => {
                        const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), questionWord: text } };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                      pluralKey={prepDraft?.thesis?.pluralKey || ''}
                      onSavePluralKey={async (text: string) => {
                        const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), pluralKey: text } };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                      transitionSentence={prepDraft?.thesis?.transitionSentence || ''}
                      onSaveTransitionSentence={async (text: string) => {
                        const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), transitionSentence: text } };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                      oneSentence={prepDraft?.thesis?.oneSentence || ''}
                      onSaveOneSentence={async (text: string) => {
                        const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), oneSentence: text } };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                      sermonInOneSentence={prepDraft?.thesis?.sermonInOneSentence || ''}
                      onSaveSermonInOneSentence={async (text: string) => {
                        const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), sermonInOneSentence: text } };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                    />
                  </PrepStepCard>
                  <PrepStepCard
                    stepId="homileticPlan"
                    stepNumber={7}
                    title={t('wizard.steps.homileticPlan.title') as string}
                    icon={<BookOpen className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />}
                    isActive={activeStepId === 'homileticPlan'}
                    isExpanded={isStepExpanded('homileticPlan')}
                    onToggle={() => toggleStep('homileticPlan')}
                    stepRef={(el) => { stepRefs.current['homileticPlan'] = el; }}
                    done={isHomileticPlanDone}
                  >
                    <HomileticPlanStepContent
                      initialModernTranslation={prepDraft?.homileticPlan?.modernTranslation || ''}
                      onSaveModernTranslation={async (text: string) => {
                        const next: Preparation = { ...prepDraft, homileticPlan: { ...(prepDraft?.homileticPlan || {}), modernTranslation: text } };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                      initialUpdatedPlan={prepDraft?.homileticPlan?.updatedPlan || []}
                      onSaveUpdatedPlan={async (items) => {
                        const next: Preparation = { ...prepDraft, homileticPlan: { ...(prepDraft?.homileticPlan || {}), updatedPlan: items } };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                      initialSermonPlan={prepDraft?.homileticPlan?.sermonPlan || []}
                      onSaveSermonPlan={async (items) => {
                        const next: Preparation = { ...prepDraft, homileticPlan: { ...(prepDraft?.homileticPlan || {}), sermonPlan: items } };
                        setPrepDraft(next);
                        await savePreparation(next);
                      }}
                    />
                  </PrepStepCard>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </motion.div>

          <MotionConfig reducedMotion="user">
            <AnimatePresence initial={false} mode="wait">
              {uiMode === 'classic' ? (
                <motion.div
                  key="rightPanel"
                  className="space-y-6"
                  initial={{ opacity: 0, x: 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 40 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 28, mass: 0.9 }}
                >
                  {/* Hide duplicate ThoughtsBySection section on mobile, show on lg+ */}
                  <div className="hidden lg:block">
                    <StructureStats
                      sermon={sermon!}
                      tagCounts={tagCounts}
                      totalThoughts={totalThoughts}
                      hasInconsistentThoughts={hasInconsistentThoughts}
                    />
                  </div>
                  <PreachDateList sermonId={sermon!.id} />
                  <KnowledgeSection sermon={sermon!} updateSermon={handleSermonUpdate} />
                  <SermonOutline
                    sermon={sermon!}
                    thoughtsPerSermonPoint={thoughtsPerSermonPoint}
                    onOutlineUpdate={handleOutlineUpdate}
                    isReadOnly={isReadOnly}
                  />
                  {sermon!.structure && <StructurePreview sermon={sermon!} />}
                </motion.div>
              ) : (
                <motion.div
                  key="thoughtsColumn"
                  className="space-y-6"
                  initial={{ opacity: 0, x: -40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -40 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 28, mass: 0.9 }}
                >
                  {renderClassicContent()}
                </motion.div>
              )}
            </AnimatePresence>
          </MotionConfig>
        </motion.div>
      )}

      {/* Slider container that moves viewport left/right */}
      <div className="relative overflow-hidden">
        <motion.div
          className="flex"
          initial={false}
          animate={{ x: uiMode === 'prep' ? '0%' : 'calc(-50% - 1px)' }}
          transition={{ type: 'spring', stiffness: 220, damping: 26, mass: 0.9 }}
          style={{ width: '200%', willChange: 'transform' }}
        >
          {/* Slide 1: Preparation layout (left) */}
          <div className="basis-1/2 shrink-0">
            <div className={`grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8`}>
              <div className="lg:col-span-2">
                {renderPrepContent()}
              </div>
              <div className="space-y-6">
                {renderClassicContent({ withBrainstorm: false })}
              </div>
            </div>
          </div>

          {/* Slide 2: Classic layout (right) */}
          <div className="basis-1/2 shrink-0">
            <div className={`grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8 pl-px`}>
              <div className="lg:col-span-2">
                {renderClassicContent()}
              </div>
              <div className="space-y-6">
                <div className="hidden lg:block">
                  <StructureStats
                    sermon={sermon!}
                    tagCounts={tagCounts}
                    totalThoughts={totalThoughts}
                    hasInconsistentThoughts={hasInconsistentThoughts}
                  />
                </div>
                <KnowledgeSection sermon={sermon!} updateSermon={handleSermonUpdate} />
                <SermonOutline
                  sermon={sermon!}
                  thoughtsPerSermonPoint={thoughtsPerSermonPoint}
                  onOutlineUpdate={handleOutlineUpdate}
                  isReadOnly={isReadOnly}
                />
                {sermon!.structure && <StructurePreview sermon={sermon!} />}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
      {editingModalData && (
        <EditThoughtModal
          initialText={editingModalData.thought.text}
          initialTags={editingModalData.thought.tags}
          initialSermonPointId={editingModalData.thought.outlinePointId || undefined}
          allowedTags={allowedTags}
          sermonOutline={sermon.outline}
          onSave={handleSaveEditedThought}
          onClose={() => setEditingModalData(null)}
        />
      )}
    </div>
  );
}

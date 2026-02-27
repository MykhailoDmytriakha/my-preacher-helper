"use client";

import { motion } from "framer-motion";
import { BookOpen, Sparkles } from "lucide-react";
import dynamicImport from "next/dynamic";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "@locales/i18n";

import AudioRecorderPortalBridge from '@/components/sermon/AudioRecorderPortalBridge';
import ClassicThoughtsPanel from '@/components/sermon/ClassicThoughtsPanel';
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
import { SermonDetailSkeleton } from "@/components/skeletons/SermonDetailSkeleton";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useSeries } from "@/hooks/useSeries";
import useSermon from "@/hooks/useSermon";
import { useTags } from "@/hooks/useTags";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useAuth } from "@/providers/AuthProvider";
import { updateSermonPreparation, updateSermon } from '@/services/sermon.service';
import { updateStructure } from "@/services/structure.service";
import CreateThoughtModal from "@components/CreateThoughtModal";
import EditThoughtModal from "@components/EditThoughtModal";
import { useThoughtFiltering } from '@hooks/useThoughtFiltering';
import { STRUCTURE_TAGS } from '@lib/constants';
import "@locales/i18n";
import { createAudioThought, deleteThought, updateThought } from "@services/thought.service";
import { getCanonicalTagForSection, normalizeStructureTag } from '@utils/tagUtils';
import { UI_COLORS } from "@utils/themeColors";
import { findThoughtSectionInStructure, insertThoughtIdInStructure, resolveSectionForNewThought } from "@utils/thoughtOrdering";

import type { Sermon, Thought, SermonOutline as SermonOutlineType, Preparation, BrainstormSuggestion } from "@/models/models";
import type { ReactNode } from "react";
export const dynamic = "force-dynamic";

const AudioRecorder = dynamicImport(
  () => import("@components/AudioRecorder").then((mod) => mod.AudioRecorder),
  {
    ssr: false,
    loading: () => <p>Loading recorder...</p>,
  }
);

// Formats standalone verse numbers (at start or surrounded by spaces) as superscript
const formatSuperscriptVerses = (text: string): string => {
  if (!text) return text;
  // Superscript number at the very start if followed by a space
  let result = text.replace(/^(\d{1,3})(?=\s)/, '<sup class="text-gray-300 dark:text-gray-600">$1</sup>');
  // Superscript numbers that are surrounded by spaces
  result = result.replace(/(\s)(\d{1,3})(?=\s)/g, '$1<sup class="text-gray-300 dark:text-gray-600">$2</sup>');
  return result;
};

const getInitialUiMode = (modeParam: string | null, id: string): 'classic' | 'prep' => {
  if (modeParam === 'prep') return 'prep';
  if (typeof window !== 'undefined') {
    const savedMode = localStorage.getItem(`sermon-${id}-mode`);
    if (savedMode === 'prep' || savedMode === 'classic') {
      return savedMode as 'classic' | 'prep';
    }
  }
  return 'classic';
};

type PrepStepId =
  | 'spiritual'
  | 'textContext'
  | 'exegeticalPlan'
  | 'mainIdea'
  | 'goals'
  | 'thesis'
  | 'homileticPlan';

const PREP_STEP_IDS: PrepStepId[] = [
  'spiritual',
  'textContext',
  'exegeticalPlan',
  'mainIdea',
  'goals',
  'thesis',
  'homileticPlan',
];

// Calculate the number of thoughts for each outline point
const calculateThoughtsPerSermonPoint = (sermon: Sermon | null) => {
  if (!sermon || !sermon.thoughts || !sermon.outline) return {};
  const counts: Record<string, number> = {};
  sermon.thoughts.forEach(thought => {
    if (thought.outlinePointId) {
      counts[thought.outlinePointId] = (counts[thought.outlinePointId] || 0) + 1;
    }
  });
  return counts;
};

const getPrepCompleteness = (prepDraft: Preparation | undefined) => {
  const isTextContextDone = Boolean(
    prepDraft?.textContext?.readWholeBookOnceConfirmed &&
    (prepDraft?.textContext?.contextNotes || '').trim().length > 0 &&
    (prepDraft?.textContext?.repeatedWords && prepDraft.textContext.repeatedWords.length > 0)
  );

  const isSpiritualDone = Boolean(prepDraft?.spiritual?.readAndPrayedConfirmed);

  const isExegeticalPlanDone = Boolean(
    prepDraft?.exegeticalPlan && prepDraft.exegeticalPlan.length > 0 &&
    prepDraft.exegeticalPlan.some(node =>
      (node.title || '').trim().length > 0 ||
      (node.children && node.children.some(child => (child.title || '').trim().length > 0))
    ) &&
    prepDraft?.authorIntent && prepDraft.authorIntent.trim().length > 0
  );

  const isMainIdeaDone = Boolean(
    prepDraft?.mainIdea?.contextIdea && prepDraft.mainIdea.contextIdea.trim().length > 0 &&
    prepDraft?.mainIdea?.textIdea && prepDraft.mainIdea.textIdea.trim().length > 0 &&
    prepDraft?.mainIdea?.argumentation && prepDraft.mainIdea.argumentation.trim().length > 0
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

  return {
    isSpiritualDone,
    isTextContextDone,
    isExegeticalPlanDone,
    isMainIdeaDone,
    isGoalsDone,
    isThesisDone,
    isHomileticPlanDone
  };
};

// Check for inconsistencies between tags and assigned plan points
const checkForInconsistentThoughtsHelper = (sermon: Sermon | null): boolean => {
  if (!sermon || !sermon.thoughts || !sermon.outline) return false;

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

export default function SermonPage() {

  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { series } = useSeries(user?.uid || null);
  const { settings: userSettings } = useUserSettings(user?.uid);
  const isOnline = useOnlineStatus();
  const isReadOnly = !isOnline;


  // UI mode synced with query param (?mode=prep)
  const searchParams = useSearchParams();
  const modeParam = searchParams?.get('mode');
  const [uiMode, setUiMode] = useState<'classic' | 'prep'>(() => getInitialUiMode(modeParam, id as string));

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
  const [classicPortal, setClassicPortal] = useState<HTMLDivElement | null>(null);
  const [prepPortal, setPrepPortal] = useState<HTMLDivElement | null>(null);

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

  const applyPrepDraftUpdate = useCallback(async (next: Preparation) => {
    setPrepDraft(next);
    await savePreparation(next);
  }, [savePreparation]);

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
  const [manuallyExpanded, setManuallyExpanded] = useState<Set<PrepStepId>>(new Set());
  const stepRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Close filter dropdown when switching to prep mode to avoid floating UI
  useEffect(() => {
    if (uiMode === 'prep' && isFilterOpen) setIsFilterOpen(false);
  }, [uiMode, isFilterOpen]);

  const [isBrainstormOpen, setIsBrainstormOpen] = useState(false);
  const [brainstormSuggestion, setBrainstormSuggestion] = useState<BrainstormSuggestion | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Reusable renderer for classic content (brainstorm, filters, thoughts)
  const renderClassicContent = (options?: { withBrainstorm?: boolean, portalRef?: React.Ref<HTMLDivElement> }) => (
    <ClassicThoughtsPanel
      withBrainstorm={options?.withBrainstorm}
      portalRef={options?.portalRef}
      isClassicMode={uiMode === 'classic'}
      activeCount={activeCount}
      totalThoughts={totalThoughts}
      isFilterOpen={isFilterOpen}
      setIsFilterOpen={setIsFilterOpen}
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
      filterButtonRef={filterButtonRef}
      isBrainstormOpen={isBrainstormOpen}
      setIsBrainstormOpen={setIsBrainstormOpen}
      sermonId={sermon?.id}
      brainstormSuggestion={brainstormSuggestion}
      setBrainstormSuggestion={setBrainstormSuggestion}
      filteredThoughts={filteredThoughts}
      sermonOutline={sermon?.outline}
      onDelete={handleDeleteThought}
      onEditStart={handleEditThoughtStart}
      onThoughtUpdate={handleThoughtUpdate}
      isReadOnly={isReadOnly}
    />
  );

  // Reusable renderer for preparation flow (all prep step cards)
  const renderPrepContent = () => {
    const prepStepConfigs: Array<{
      id: PrepStepId;
      stepNumber: number;
      title: string;
      icon: ReactNode;
      done: boolean;
    }> = [
      {
        id: 'spiritual',
        stepNumber: 1,
        title: t('wizard.steps.spiritual.title') as string,
        icon: <Sparkles className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />,
        done: isSpiritualDone,
      },
      {
        id: 'textContext',
        stepNumber: 2,
        title: t('wizard.steps.textContext.title') as string,
        icon: <BookOpen className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />,
        done: isTextContextDone,
      },
      {
        id: 'exegeticalPlan',
        stepNumber: 3,
        title: t('wizard.steps.exegeticalPlan.title') as string,
        icon: <BookOpen className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />,
        done: isExegeticalPlanDone,
      },
      {
        id: 'mainIdea',
        stepNumber: 4,
        title: t('wizard.steps.mainIdea.title') as string,
        icon: <BookOpen className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />,
        done: isMainIdeaDone,
      },
      {
        id: 'goals',
        stepNumber: 5,
        title: t('wizard.steps.goals.title') as string,
        icon: <BookOpen className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />,
        done: isGoalsDone,
      },
      {
        id: 'thesis',
        stepNumber: 6,
        title: t('wizard.steps.thesis.title') as string,
        icon: <BookOpen className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />,
        done: isThesisDone,
      },
      {
        id: 'homileticPlan',
        stepNumber: 7,
        title: t('wizard.steps.homileticPlan.title') as string,
        icon: <BookOpen className={`${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} w-4 h-4`} />,
        done: isHomileticPlanDone,
      },
    ];

    const prepStepContentById: Record<PrepStepId, ReactNode> = {
      spiritual: (
        <SpiritualStepContent
          prepDraft={prepDraft}
          setPrepDraft={setPrepDraft}
          savePreparation={savePreparation}
          savingPrep={savingPrep}
          formatSuperscriptVerses={formatSuperscriptVerses}
        />
      ),
      textContext: (
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
            await applyPrepDraftUpdate(next);
          }}
          initialPassageSummary={prepDraft?.textContext?.passageSummary || ''}
          onSavePassageSummary={async (summary: string) => {
            const next: Preparation = {
              ...prepDraft,
              textContext: { ...(prepDraft.textContext ?? {}), passageSummary: summary },
            };
            await applyPrepDraftUpdate(next);
          }}
          initialContextNotes={prepDraft?.textContext?.contextNotes || ''}
          onSaveContextNotes={async (notes: string) => {
            const next: Preparation = {
              ...prepDraft,
              textContext: { ...(prepDraft.textContext ?? {}), contextNotes: notes },
            };
            await applyPrepDraftUpdate(next);
          }}
          initialRepeatedWords={prepDraft?.textContext?.repeatedWords || []}
          onSaveRepeatedWords={async (words: string[]) => {
            const next: Preparation = {
              ...prepDraft,
              textContext: { ...(prepDraft.textContext ?? {}), repeatedWords: words },
            };
            await applyPrepDraftUpdate(next);
          }}
        />
      ),
      exegeticalPlan: (
        <ExegeticalPlanStepContent
          value={prepDraft?.exegeticalPlan || []}
          onChange={(nodes) => {
            setPrepDraft(prev => ({ ...(prev || {}), exegeticalPlan: nodes }));
          }}
          onSave={async (nodes) => {
            const next = { ...(prepDraft || {}), exegeticalPlan: nodes } as Preparation;
            await applyPrepDraftUpdate(next);
          }}
          saving={savingPrep}
          authorIntent={prepDraft?.authorIntent || ''}
          onSaveAuthorIntent={async (text: string) => {
            const next: Preparation = { ...(prepDraft || {}), authorIntent: text };
            await applyPrepDraftUpdate(next);
          }}
        />
      ),
      mainIdea: (
        <MainIdeaStepContent
          initialContextIdea={prepDraft?.mainIdea?.contextIdea || ''}
          onSaveContextIdea={async (text: string) => {
            const next: Preparation = { ...prepDraft, mainIdea: { ...(prepDraft?.mainIdea || {}), contextIdea: text } };
            await applyPrepDraftUpdate(next);
          }}
          initialTextIdea={prepDraft?.mainIdea?.textIdea || ''}
          onSaveTextIdea={async (text: string) => {
            const next: Preparation = { ...prepDraft, mainIdea: { ...(prepDraft?.mainIdea || {}), textIdea: text } };
            await applyPrepDraftUpdate(next);
          }}
          initialArgumentation={prepDraft?.mainIdea?.argumentation || ''}
          onSaveArgumentation={async (text: string) => {
            const next: Preparation = { ...prepDraft, mainIdea: { ...(prepDraft?.mainIdea || {}), argumentation: text } };
            await applyPrepDraftUpdate(next);
          }}
        />
      ),
      goals: (
        <GoalsStepContent
          initialTimelessTruth={prepDraft?.timelessTruth || ''}
          onSaveTimelessTruth={async (text: string) => {
            const next: Preparation = { ...prepDraft, timelessTruth: text };
            await applyPrepDraftUpdate(next);
          }}
          initialChristConnection={prepDraft?.christConnection || ''}
          onSaveChristConnection={async (text: string) => {
            const next: Preparation = { ...prepDraft, christConnection: text };
            await applyPrepDraftUpdate(next);
          }}
          initialGoalStatement={prepDraft?.preachingGoal?.statement || ''}
          onSaveGoalStatement={async (text: string) => {
            const next: Preparation = {
              ...prepDraft,
              preachingGoal: { ...(prepDraft?.preachingGoal || {}), statement: text },
            };
            await applyPrepDraftUpdate(next);
          }}
          initialGoalType={(prepDraft?.preachingGoal?.type as GoalType) || ''}
          onSaveGoalType={async (type) => {
            const next: Preparation = {
              ...prepDraft,
              preachingGoal: { ...(prepDraft?.preachingGoal || {}), type },
            };
            await applyPrepDraftUpdate(next);
          }}
        />
      ),
      thesis: (
        <ThesisStepContent
          exegetical={prepDraft?.thesis?.exegetical || ''}
          onSaveExegetical={async (text: string) => {
            const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), exegetical: text } };
            await applyPrepDraftUpdate(next);
          }}
          homiletical={prepDraft?.thesis?.homiletical || ''}
          onSaveHomiletical={async (text: string) => {
            const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), homiletical: text } };
            await applyPrepDraftUpdate(next);
          }}
          pluralKey={prepDraft?.thesis?.pluralKey || ''}
          onSavePluralKey={async (text: string) => {
            const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), pluralKey: text } };
            await applyPrepDraftUpdate(next);
          }}
          transitionSentence={prepDraft?.thesis?.transitionSentence || ''}
          onSaveTransitionSentence={async (text: string) => {
            const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), transitionSentence: text } };
            await applyPrepDraftUpdate(next);
          }}
          oneSentence={prepDraft?.thesis?.oneSentence || ''}
          onSaveOneSentence={async (text: string) => {
            const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), oneSentence: text } };
            await applyPrepDraftUpdate(next);
          }}
          sermonInOneSentence={prepDraft?.thesis?.sermonInOneSentence || ''}
          onSaveSermonInOneSentence={async (text: string) => {
            const next: Preparation = { ...prepDraft, thesis: { ...(prepDraft?.thesis || {}), sermonInOneSentence: text } };
            await applyPrepDraftUpdate(next);
          }}
        />
      ),
      homileticPlan: (
        <HomileticPlanStepContent
          initialModernTranslation={prepDraft?.homileticPlan?.modernTranslation || ''}
          onSaveModernTranslation={async (text: string) => {
            const next: Preparation = { ...prepDraft, homileticPlan: { ...(prepDraft?.homileticPlan || {}), modernTranslation: text } };
            await applyPrepDraftUpdate(next);
          }}
          initialUpdatedPlan={prepDraft?.homileticPlan?.updatedPlan || []}
          onSaveUpdatedPlan={async (items) => {
            const next: Preparation = { ...prepDraft, homileticPlan: { ...(prepDraft?.homileticPlan || {}), updatedPlan: items } };
            await applyPrepDraftUpdate(next);
          }}
          initialSermonPlan={prepDraft?.homileticPlan?.sermonPlan || []}
          onSaveSermonPlan={async (items) => {
            const next: Preparation = { ...prepDraft, homileticPlan: { ...(prepDraft?.homileticPlan || {}), sermonPlan: items } };
            await applyPrepDraftUpdate(next);
          }}
        />
      ),
    };

    return (
      <div className="space-y-4 sm:space-y-6">
        {prepStepConfigs.map((step) => (
          <PrepStepCard
            key={step.id}
            stepId={step.id}
            stepNumber={step.stepNumber}
            title={step.title}
            icon={step.icon}
            isActive={activeStepId === step.id}
            isExpanded={isStepExpanded(step.id)}
            onToggle={() => toggleStep(step.id)}
            stepRef={(el) => { stepRefs.current[step.id] = el; }}
            done={step.done}
          >
            {prepStepContentById[step.id]}
          </PrepStepCard>
        ))}
      </div>
    );
  };

  // Determine active step based on data completeness
  const activeStepId = getActiveStepId(prepDraft) as PrepStepId;

  const isStepExpanded = useCallback((id: PrepStepId) => {
    return id === activeStepId || manuallyExpanded.has(id);
  }, [activeStepId, manuallyExpanded]);

  const toggleStep = useCallback((id: PrepStepId) => {
    if (id === activeStepId) return; // active step stays open
    setManuallyExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, [activeStepId]);

  const prepStepParam = searchParams?.get('prepStep');
  useEffect(() => {
    const target = prepStepParam as PrepStepId | null;
    if (target && PREP_STEP_IDS.includes(target)) {
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

  const thoughtsPerSermonPoint = calculateThoughtsPerSermonPoint(sermon);



  const {
    isTextContextDone,
    isSpiritualDone,
    isExegeticalPlanDone,
    isMainIdeaDone,
    isGoalsDone,
    isThesisDone,
    isHomileticPlanDone
  } = getPrepCompleteness(prepDraft);

  // Check for inconsistencies
  const hasInconsistentThoughts = checkForInconsistentThoughtsHelper(sermon);

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
      return;
    }

    try {
      await deleteThought(sermon.id, thoughtToDelete);
      setSermon((prevSermon) => prevSermon ? {
        ...prevSermon,
        thoughts: prevSermon.thoughts.filter(t => t.id !== thoughtId),
      } : null);
    } catch (error) {
      console.error("Failed to delete thought", error);
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
      const currentSection = findThoughtSectionInStructure(sermon.structure, thoughtToUpdate.id);
      const newSection = resolveSectionForNewThought({
        sermon,
        outlinePointId,
        tags: updatedTags,
      });
      let updatedStructure = sermon.structure;
      let structureChanged = false;

      if (newSection !== currentSection) {
        const thoughtsById = new Map(
          [...sermon.thoughts.filter((t) => t.id !== thoughtToUpdate.id), updatedThoughtData].map((thought) => [thought.id, thought])
        );
        updatedStructure = insertThoughtIdInStructure({
          structure: sermon.structure,
          section: newSection,
          thoughtId: thoughtToUpdate.id,
          outlinePointId: outlinePointId ?? null,
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

      {/* Single persistent recorder with smooth height transition teleported via portal to the correct active slide */}
      <AudioRecorderPortalBridge
        RecorderComponent={AudioRecorder}
        portalTarget={uiMode === 'prep' ? prepPortal : classicPortal}
        onRecordingComplete={handleNewRecording}
        isProcessing={isProcessing}
        onRetry={handleRetryTranscription}
        retryCount={retryCount}
        maxRetries={3}
        transcriptionError={transcriptionError}
        onClearError={handleClearError}
        hideKeyboardShortcuts={uiMode === 'prep'}
        isReadOnly={isReadOnly}
        onOpenCreateModal={() => setIsCreateModalOpen(true)}
        manualThoughtTitle={t('manualThought.addManual')}
      />

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
              <div className="order-2 lg:order-1 lg:col-span-2">
                {renderPrepContent()}
              </div>
              <div className="order-1 lg:order-2 space-y-6">
                {renderClassicContent({ withBrainstorm: false, portalRef: setPrepPortal })}
              </div>
            </div>
          </div>

          {/* Slide 2: Classic layout (right) */}
          <div className="basis-1/2 shrink-0">
            <div className={`grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8 pl-px`}>
              <div className="order-2 lg:order-1 lg:col-span-2">
                {renderClassicContent({ portalRef: setClassicPortal })}
              </div>
              <div className="order-1 lg:order-2 space-y-6">
                <div className="hidden lg:block">
                  <StructureStats
                    sermon={sermon!}
                    tagCounts={tagCounts}
                    totalThoughts={totalThoughts}
                    hasInconsistentThoughts={hasInconsistentThoughts}
                  />
                </div>
                <SermonOutline
                  sermon={sermon!}
                  thoughtsPerSermonPoint={thoughtsPerSermonPoint}
                  onOutlineUpdate={handleOutlineUpdate}
                  isReadOnly={isReadOnly}
                />
                <KnowledgeSection sermon={sermon!} updateSermon={handleSermonUpdate} />
                {sermon!.structure && userSettings?.enableStructurePreview && <StructurePreview sermon={sermon!} />}
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
      <CreateThoughtModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        sermonId={sermon.id}
        onNewThought={handleNewManualThought}
        allowedTags={allowedTags}
        sermonOutline={sermon.outline}
        disabled={isReadOnly}
      />
    </div>
  );
}

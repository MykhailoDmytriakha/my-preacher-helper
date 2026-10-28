"use client";



import { motion } from "framer-motion";
import { BookOpen, Sparkles } from "lucide-react";
import dynamicImport from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from 'sonner';
import "@locales/i18n";

import RecordingDraftBanner from '@/components/audio-recorder/RecordingDraftBanner';
import { ScriptureLinksInWindow } from '@/components/bible/VerseWindow';
import PlanEditorModal from "@/components/plan-editor/PlanEditorModal";
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
import SermonHeader from "@/components/sermon/SermonHeader";
import SermonOutline from "@/components/sermon/SermonOutline";
import StructurePreview from "@/components/sermon/StructurePreview";
import StructureStats from "@/components/sermon/StructureStats";
import { SermonDetailSkeleton } from "@/components/skeletons/SermonDetailSkeleton";
import { EngineThoughtModal } from '@/components/thought/EngineThoughtModal';
import { DataDocumentProvider } from '@/data-engine/react.client';
import { useAiUsage } from '@/hooks/useAiUsage';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useRouteId } from "@/hooks/useRouteId";
import { useSeries } from "@/hooks/useSeries";
import { sermonIsMissing } from "@/hooks/useSermonRead";
import { useTags } from "@/hooks/useTags";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useWayInOnce } from "@/hooks/useWayInOnce";
import { useAuth } from "@/providers/AuthProvider";
import { logFailureOnce, type FailureWords } from '@/utils/actionFailureMessage';
import { ranOutOfTime } from "@/utils/aiTimeFailure";
import { newClientId } from "@/utils/clientId";
import { sermonLanguage } from "@/utils/documentLanguage";
import { deleteRecordingDraft, saveRecordingDraft } from '@/utils/recordingDraftStore';
import { transcriptionFailureWords } from '@/utils/transcriptionRetryClient';
import { useThoughtFiltering } from '@hooks/useThoughtFiltering';
import { STRUCTURE_TAGS } from '@lib/constants';
import { createAudioThought } from "@services/thought.service";
import { UI_COLORS } from "@utils/themeColors";
import {
  canonicalizeStructure,
} from "@utils/thoughtOrdering";
import { sermonHasInconsistentThoughts } from "@utils/thoughtStructureConsistency";

import { EngineScratchWorkspace } from './components/EngineScratchWorkspace';
import { EngineStructureWriterProvider } from './components/EngineStructureWriterProvider';
import { useSermonCoreDataDocument } from './hooks/useSermonCoreDataDocument';
import { useSermonThoughtsDataDocument } from './hooks/useSermonThoughtsDataDocument';

import type { Sermon, Thought, Preparation, BrainstormSuggestion } from "@/models/models";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

type SermonUiMode = 'classic' | 'prep' | 'raw';
// The editor seeds state on mount, so every opening needs a distinct identity.
type EditingModalData = { thought: Thought; index: number; session: number };

const AudioRecorder = dynamicImport(
  () => import("@components/AudioRecorder").then((mod) => mod.AudioRecorder),
  {
    ssr: false,
    loading: () => <p>Loading recorder...</p>,
  }
);

const formatSuperscriptVerses = (text: string): string => {
  if (!text) return text;
  let result = text.replace(/^(\d{1,3})(?=\s)/, '<sup class="text-gray-300 dark:text-gray-600">$1</sup>');
  result = result.replace(/(\s)(\d{1,3})(?=\s)/g, '$1<sup class="text-gray-300 dark:text-gray-600">$2</sup>');
  return result;
};

const parseUiMode = (value: string | null | undefined): SermonUiMode | null => {
  if (value === 'classic' || value === 'prep' || value === 'raw') return value;
  return null;
};

const getSavedUiMode = (id: string): SermonUiMode | null => {
  if (typeof window !== 'undefined') {
    const savedMode = localStorage.getItem(`sermon-${id}-mode`);
    return parseUiMode(savedMode);
  }
  return null;
};

const getInitialUiMode = (modeParam: string | null, id: string): SermonUiMode => {
  const parsedMode = parseUiMode(modeParam);
  if (parsedMode) return parsedMode;
  const savedMode = getSavedUiMode(id);
  if (savedMode) return savedMode;
  return 'classic';
};

const PANE_TRANSLATE_X_BY_MODE: Record<SermonUiMode, string> = {
  prep: '0%',
  classic: '-33.333333%',
  raw: '-66.666667%',
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

export default function SermonPage() {
  const id = useRouteId();
  return (
    <DataDocumentProvider resource={{ collection: 'sermons', id }} options={{ slot: 'sermon', readOnlyCopy: true }}>
      {/* One door for outline writes on this page (the page outline and the structure editor alike). */}
      <EngineStructureWriterProvider sermonId={id}>
        <SermonPageContent id={id} />
      </EngineStructureWriterProvider>
    </DataDocumentProvider>
  );
}

function SermonPageContent({ id }: { id: string }) {
  const core = useSermonCoreDataDocument(id);
  const engineThoughts = useSermonThoughtsDataDocument(id);
  const isOnline = useOnlineStatus();
  const sermon = useMemo(() => core.data ? ({ ...core.data, id, thoughts: core.data.thoughts ?? [] } as unknown as Sermon) : null, [core.data, id]);
  const loading = core.loading;
  const awaitingFirstAnswer = core.loading;
  const { user } = useAuth();
  const { series } = useSeries(user?.uid || null);
  const { settings: userSettings } = useUserSettings(user?.uid);
  /**
   * THE ONE RECORDER THAT ASKED NOTHING AT ALL.
   *
   * Every other microphone in the app at least asked about the transcription allowance; this
   * one — the "new recording" button on the sermon screen, the most used control there is —
   * had no gate whatsoever. Past the limit it stayed bright, took the dictation, and handed
   * back a refusal for a rule the screen never showed.
   */
  const { blocked: usageBlocked, blockedLabelKey: usageBlockedLabelKey } = useAiUsage();
  const dictationBlocked = usageBlocked('dictation');
  const dictationBlockedKey = usageBlockedLabelKey('dictation');
  const isReadOnly = core.isReadOnly;

  const searchParams = useSearchParams();
  const modeParam = searchParams?.get('mode');
  const [uiMode, setUiMode] = useState<SermonUiMode>(() => getInitialUiMode(modeParam, id as string));

  const { t } = useTranslation();
  const sermonRef = useRef<Sermon | null>(sermon);
  const prepDraft = core.preparation;
  const savingPrep = Boolean(core.status && core.status.phase !== 'saved');
  const [classicPortal, setClassicPortal] = useState<HTMLDivElement | null>(null);
  const [prepPortal, setPrepPortal] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    sermonRef.current = sermon;
  }, [sermon]);

  useEffect(() => {
    const mode = parseUiMode(modeParam) ?? getSavedUiMode(id as string) ?? 'classic';
    setUiMode(mode);

    if (typeof window !== 'undefined') {
      localStorage.setItem(`sermon-${id}-mode`, mode);
    }
  }, [modeParam, id]);

  const savePrepField = useCallback(async (field: keyof Preparation, value: unknown, child?: string) => {
    await core.patchPreparation({ [field]: child ? { [child]: value } : value } as Partial<Preparation>);
  }, [core]);
  // One answer of the homiletical thesis, keeping the other answers (BUG-20261011-thesis-answers-save-nowhere).
  const saveHomileticalAnswer = useCallback((answer: 'whyPreach' | 'impactOnChurch' | 'practicalQuestions', text: string) =>
    savePrepField('thesis', { ...prepDraft?.thesis?.homileticalAnswers, [answer]: text }, 'homileticalAnswers'), [prepDraft, savePrepField]);

  const { allTags } = useTags(sermon?.userId);
  const allowedTags = useMemo(
    () => allTags.map((tag) => ({ name: tag.name, color: tag.color })),
    [allTags]
  );

  const [isProcessing, setIsProcessing] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  // Kept as words: the recorder says them in the language on screen.
  const [transcriptionError, setTranscriptionError] = useState<FailureWords | null>(null);
  const [editingModalData, setEditingModalData] = useState<EditingModalData | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [manuallyExpanded, setManuallyExpanded] = useState<Set<PrepStepId>>(new Set());
  const stepRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (uiMode === 'prep' && isFilterOpen) setIsFilterOpen(false);
  }, [uiMode, isFilterOpen]);

  const [isBrainstormOpen, setIsBrainstormOpen] = useState(false);
  const [brainstormSuggestion, setBrainstormSuggestion] = useState<BrainstormSuggestion | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isPlanEditorOpen, setIsPlanEditorOpen] = useState(false);
  // One structure editor in both modes; on the engine it writes through the page's engine writer.
  const openPlanEditor = isReadOnly ? undefined : () => setIsPlanEditorOpen(true);
  // Bumped when the plan editor changes the outline, to force SermonOutline to
  // re-read the freshly saved outline (its fetch effect keys on sermon.id only).
  const [outlineRefreshKey, setOutlineRefreshKey] = useState(0);

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
  } = useThoughtFiltering({
    initialThoughts: sermon?.thoughts ?? [],
    sermonStructure: sermon?.structure,
    sermonThoughtsBySection: sermon?.thoughtsBySection,
    sermonOutline: sermon?.outline
  });

  const filterButtonRef = useRef<HTMLButtonElement>(null);

  const editSessionRef = useRef(0);
  const nextEditSession = useCallback(() => {
    editSessionRef.current += 1;
    return editSessionRef.current;
  }, []);

  const closeEditingModal = useCallback(() => {
    setEditingModalData(null);
  }, []);

  const handleEditThoughtStart = (thought: Thought, index: number) => {
    setEditingModalData({ thought, index, session: nextEditSession() });
  };

  const activeStepId = getActiveStepId(prepDraft) as PrepStepId;

  const isStepExpanded = useCallback((id: PrepStepId) => {
    return id === activeStepId || manuallyExpanded.has(id);
  }, [activeStepId, manuallyExpanded]);

  const toggleStep = useCallback((id: PrepStepId) => {
    if (id === activeStepId) return;
    setManuallyExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, [activeStepId]);

  const prepStepParam = searchParams?.get('prepStep');
  // The address's way in, taken once: a step finished, the sermon saved, never sends the person back to the step the
  // address named, nor opens it again after it was closed (BUG-20261027-plan-scrolls-back-to-section).
  const prepWayIn = useWayInOnce();
  useEffect(() => {
    const target = prepStepParam as PrepStepId | null;
    const wayInKey = target && PREP_STEP_IDS.includes(target) ? `${id}:${target}` : null;
    if (prepWayIn.arriving(wayInKey) && target && wayInKey) {
      if (target !== activeStepId && !manuallyExpanded.has(target)) {
        setManuallyExpanded(prev => new Set(prev).add(target));
      }
      const timer = setTimeout(() => {
        const el = stepRefs.current[target!];
        if (el && typeof el.scrollIntoView === 'function') {
          prepWayIn.take(wayInKey);
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 50);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepStepParam, activeStepId]);

  /**
   * The server stores a transcribed thought itself, so a result paid for survives the person
   * leaving mid-transcription. On an engine document it lands with its place in the structure
   * in the same command (api/thoughts/route.ts); the open page only reads the document again.
   */
  const placeAudioThought = async () => {
    await core.retry().catch(() => undefined);
  };

  /**
   * A DICTATED THOUGHT OUTLIVES THE PAGE (BUG-20260813-late-refusal-silent-after-navigation).
   *
   * The recording lived only in this page's state, so an answer that came back as a failure
   * after the person had moved on — the request keeps running, the page does not — took the
   * spoken words with it. A failed recording is parked in the same durable store the study
   * notes use; the code after `await` still runs once the page is gone, so it is parked even
   * then, and the banner below offers it the next time this sermon is opened.
   *
   * The parked copy goes when the recording has become a thought, when the person deletes it
   * ("Delete recording" here, "Delete" in the banner), or when the store's seven-day limit
   * expires it (`recordingDraftStore`, shared with study notes). Not on "clear the error": the
   * recorder calls that itself before every retry and every new recording, and letting the copy
   * go there threw it away before the retry's answer was known. The recording carries the sermon it was spoken for and its
   * draft id from the moment it exists — this page can be reused for another sermon, and the
   * id fixed up front keeps IndexedDB's own ordering between parking and letting go.
   */
  const heldRecordingRef = useRef<{ blob: Blob; sermonId: string; draftId: string } | null>(null);
  const parkRecording = async (held: { blob: Blob; sermonId: string; draftId: string }) => {
    try {
      await saveRecordingDraft({ id: held.draftId, blob: held.blob, mimeType: held.blob.type || 'audio/webm', context: 'sermon', contextId: held.sermonId });
    } catch {
      // IndexedDB unavailable — the in-session retry panel still holds the recording.
    }
  };
  const releaseRecording = (held: { draftId: string }) => {
    void deleteRecordingDraft(held.draftId);
    if (heldRecordingRef.current === held) heldRecordingRef.current = null;
  };
  /** Transcribe a held recording into the sermon it was spoken for; true once it is a thought. */
  const transcribeHeld = async (held: { blob: Blob; sermonId: string; draftId: string }, attempt: number): Promise<boolean> => {
    try {
      await createAudioThought(held.blob, held.sermonId, attempt, 3);
      // Placing re-reads THIS page's sermon; a recording for another one was stored by the server.
      if (sermonRef.current?.id === held.sermonId) await placeAudioThought();
      releaseRecording(held);
      toast.success(t('manualThought.addedSuccess'));
      return true;
    } catch (error) {
      logFailureOnce(error, "transcribeHeld: Recording error:");
      setTranscriptionError(ranOutOfTime(error) ? { key: 'errors.aiOutOfTimeAudio' } : transcriptionFailureWords(error, 'errors.audioProcessing'));
      await parkRecording(held);
      return false;
    }
  };

  const handleNewRecording = async (audioBlob: Blob) => {
    if (!sermon) return;
    const held = { blob: audioBlob, sermonId: sermon.id, draftId: newClientId() };
    heldRecordingRef.current = held;
    setIsProcessing(true);
    setTranscriptionError(null);
    setRetryCount(0);
    try {
      await transcribeHeld(held, 0);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRetryTranscription = async () => {
    const held = heldRecordingRef.current;
    if (!held) return;
    setIsProcessing(true);
    const newRetryCount = retryCount + 1;
    setRetryCount(newRetryCount);
    setTranscriptionError(null);
    try {
      if (await transcribeHeld(held, newRetryCount)) setRetryCount(0);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClearError = () => {
    setTranscriptionError(null);
    setRetryCount(0);
  };

  /** "Delete recording" in the recorder: the one in-session act that lets the parked copy go too. */
  const handleDiscardRecording = () => {
    if (heldRecordingRef.current) releaseRecording(heldRecordingRef.current);
  };

  /** A recording parked by an earlier visit, sent again from the banner; true once it is a thought. */
  const resendParkedRecording = async (audioBlob: Blob): Promise<boolean> => {
    if (!sermon) return false;
    setIsProcessing(true);
    try {
      await createAudioThought(audioBlob, sermon.id, 0, 3);
      await placeAudioThought();
      toast.success(t('manualThought.addedSuccess'));
      return true;
    } catch (error) {
      console.error("resendParkedRecording: Recording error:", error);
      toast.error(t('audio.transcribeError.unknown', { defaultValue: 'Transcription failed. Please try again.' }));
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  // Reusable renderers moved after all hooks
  const renderClassicContent = (options?: { withBrainstorm?: boolean, portalRef?: React.Ref<HTMLDivElement> }) => (
    <ClassicThoughtsPanel
      withBrainstorm={options?.withBrainstorm}
      portalRef={options?.portalRef}
      isClassicMode={uiMode === 'classic'}
      activeCount={activeCount}
      totalThoughts={sermon?.thoughts?.length ?? 0}
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
      filterButtonRef={filterButtonRef}
      isBrainstormOpen={isBrainstormOpen}
      setIsBrainstormOpen={setIsBrainstormOpen}
      sermonId={sermon?.id}
      brainstormSuggestion={brainstormSuggestion}
      setBrainstormSuggestion={setBrainstormSuggestion}
      filteredThoughts={filteredThoughts}
      sermonOutline={sermon?.outline}
      onDelete={id => { void engineThoughts.deleteThought(id).catch(() => undefined); }}
      onEditStart={handleEditThoughtStart}
      onThoughtOutlinePointChange={async (thought, outlinePointId, subPointId) => {
        await engineThoughts.patchThought(thought.id, { outlinePointId, subPointId: subPointId ?? null }).catch(() => undefined);
      }}
      isReadOnly={isReadOnly}
      sermon={sermon}
      scratchNotes={sermon?.scratch}
      onOpenScratch={() => setUiMode('raw')}
    />
  );

  const renderRawContent = () => <EngineScratchWorkspace sermonId={sermon!.id} isReadOnly={isReadOnly} />;

  const renderPrepContent = () => {
    const {
      isSpiritualDone,
      isTextContextDone,
      isExegeticalPlanDone,
      isMainIdeaDone,
      isGoalsDone,
      isThesisDone,
      isHomileticPlanDone
    } = getPrepCompleteness(prepDraft);

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
          setPrepDraft={() => undefined}
          savePreparation={next => savePrepField('spiritual', next.spiritual?.readAndPrayedConfirmed, 'readAndPrayedConfirmed')}
          formatSuperscriptVerses={formatSuperscriptVerses}
        />
      ),
      textContext: (
        <TextContextStepContent
          initialVerse={sermon?.verse || ''}
          onSaveVerse={async (nextVerse: string) => { await core.patchCore({ verse: nextVerse }); }}
          readWholeBookOnceConfirmed={Boolean(prepDraft?.textContext?.readWholeBookOnceConfirmed)}
          onToggleReadWholeBookOnce={(checked) => savePrepField('textContext', checked, 'readWholeBookOnceConfirmed')}
          initialPassageSummary={prepDraft?.textContext?.passageSummary || ''}
          onSavePassageSummary={(summary) => savePrepField('textContext', summary, 'passageSummary')}
          initialContextNotes={prepDraft?.textContext?.contextNotes || ''}
          onSaveContextNotes={(notes) => savePrepField('textContext', notes, 'contextNotes')}
          initialRepeatedWords={prepDraft?.textContext?.repeatedWords || []}
          onSaveRepeatedWords={(words) => savePrepField('textContext', words, 'repeatedWords')}
        />
      ),
      exegeticalPlan: (
        <ExegeticalPlanStepContent
          value={prepDraft?.exegeticalPlan || []}
          // Each plan edit goes straight into the document, which saves and merges it.
          onEdit={(edit) => core.editPreparation(prep => ({ ...prep, exegeticalPlan: edit(prep.exegeticalPlan ?? []) }))}
          saving={savingPrep}
          authorIntent={prepDraft?.authorIntent || ''}
          onSaveAuthorIntent={(text) => savePrepField('authorIntent', text)}
        />
      ),
      mainIdea: (
        <MainIdeaStepContent
          initialContextIdea={prepDraft?.mainIdea?.contextIdea || ''}
          onSaveContextIdea={(text) => savePrepField('mainIdea', text, 'contextIdea')}
          initialTextIdea={prepDraft?.mainIdea?.textIdea || ''}
          onSaveTextIdea={(text) => savePrepField('mainIdea', text, 'textIdea')}
          initialArgumentation={prepDraft?.mainIdea?.argumentation || ''}
          onSaveArgumentation={(text) => savePrepField('mainIdea', text, 'argumentation')}
        />
      ),
      goals: (
        <GoalsStepContent
          initialTimelessTruth={prepDraft?.timelessTruth || ''}
          onSaveTimelessTruth={(text) => savePrepField('timelessTruth', text)}
          initialChristConnection={prepDraft?.christConnection || ''}
          onSaveChristConnection={(text) => savePrepField('christConnection', text)}
          initialGoalStatement={prepDraft?.preachingGoal?.statement || ''}
          onSaveGoalStatement={(text) => savePrepField('preachingGoal', text, 'statement')}
          initialGoalType={(prepDraft?.preachingGoal?.type as GoalType) || ''}
          onSaveGoalType={(type) => savePrepField('preachingGoal', type, 'type')}
        />
      ),
      thesis: (
        <ThesisStepContent
          exegetical={prepDraft?.thesis?.exegetical || ''}
          onSaveExegetical={(text) => savePrepField('thesis', text, 'exegetical')}
          homiletical={prepDraft?.thesis?.homiletical || ''}
          onSaveHomiletical={(text) => savePrepField('thesis', text, 'homiletical')}
          pluralKey={prepDraft?.thesis?.pluralKey || ''}
          onSavePluralKey={(text) => savePrepField('thesis', text, 'pluralKey')}
          transitionSentence={prepDraft?.thesis?.transitionSentence || ''}
          onSaveTransitionSentence={(text) => savePrepField('thesis', text, 'transitionSentence')}
          oneSentence={prepDraft?.thesis?.oneSentence || ''}
          onSaveOneSentence={(text) => savePrepField('thesis', text, 'oneSentence')}
          sermonInOneSentence={prepDraft?.thesis?.sermonInOneSentence || ''}
          onSaveSermonInOneSentence={(text) => savePrepField('thesis', text, 'sermonInOneSentence')}
          questionWord={prepDraft?.thesis?.questionWord || ''}
          onSaveQuestionWord={(text) => savePrepField('thesis', text, 'questionWord')}
          whyPreach={prepDraft?.thesis?.homileticalAnswers?.whyPreach || ''}
          onSaveWhyPreach={(text) => saveHomileticalAnswer('whyPreach', text)}
          impactOnChurch={prepDraft?.thesis?.homileticalAnswers?.impactOnChurch || ''}
          onSaveImpactOnChurch={(text) => saveHomileticalAnswer('impactOnChurch', text)}
          practicalQuestions={prepDraft?.thesis?.homileticalAnswers?.practicalQuestions || ''}
          onSavePracticalQuestions={(text) => saveHomileticalAnswer('practicalQuestions', text)}
        />
      ),
      homileticPlan: (
        <HomileticPlanStepContent
          initialModernTranslation={prepDraft?.homileticPlan?.modernTranslation || ''}
          onSaveModernTranslation={(text) => savePrepField('homileticPlan', text, 'modernTranslation')}
          initialUpdatedPlan={prepDraft?.homileticPlan?.updatedPlan || []}
          onSaveUpdatedPlan={(items) => savePrepField('homileticPlan', items, 'updatedPlan')}
          initialSermonPlan={prepDraft?.homileticPlan?.sermonPlan || []}
          onSaveSermonPlan={(items) => savePrepField('homileticPlan', items, 'sermonPlan')}
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
            <fieldset className="min-w-0" disabled={isReadOnly}>{prepStepContentById[step.id]}</fieldset>
          </PrepStepCard>
        ))}
      </div>
    );
  };

  // Wait only while an answer can still arrive on its own — see awaitingFirstAnswer.
  // The old test (`!sermon && !error`) also covered a PAUSED and a DISABLED query,
  // neither of which ever settles, which is how this page kept showing placeholders
  // forever and made the branch below it unreachable.
  if (loading || awaitingFirstAnswer) {
    return <SermonDetailSkeleton />;
  }

  // Same rule the app nav reads to hide the sermon mode switcher — see `sermonIsMissing`.
  if (sermonIsMissing(sermon, { loading, awaitingFirstAnswer })) {
    return (
      <div className="py-8">
        <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 text-center">
          <h2 className="text-xl font-semibold mb-2">
            {isOnline ? t('sermon.notFound') : t('sermon.unavailableOffline')}
          </h2>
          {/* The label says "back to the list", so it has to lead to the list of sermons
              — it pointed at the dashboard, which is a different screen entirely. */}
          <Link href="/sermons" className="text-blue-600 dark:text-blue-400 hover:underline">
            {t('sermon.backToList')}
          </Link>
        </div>
      </div>
    );
  }

  const thoughtsPerSermonPoint = calculateThoughtsPerSermonPoint(sermon);
  const canonicalStructure = sermon ? canonicalizeStructure(sermon) : { introduction: [], main: [], conclusion: [], ambiguous: [] };
  const tagCounts = {
    [STRUCTURE_TAGS.INTRODUCTION]: canonicalStructure.introduction.length,
    [STRUCTURE_TAGS.MAIN_BODY]: canonicalStructure.main.length,
    [STRUCTURE_TAGS.CONCLUSION]: canonicalStructure.conclusion.length,
  };
  const hasInconsistentThoughts = sermonHasInconsistentThoughts(sermon);

  return (
    // A reference in a thought, or the sermon's verse, opens over the page; the Bible is one press away from the window.
    <ScriptureLinksInWindow writtenIn={sermonLanguage(sermon)}>
    <div className="space-y-4 sm:space-y-6 pb-4 sm:pb-8">
      {/* No top padding: the page frame under the breadcrumbs already gives it. */}
      <SermonHeader sermon={sermon} series={series} editor={{
        subject: core.recoveryIdentity, values: core.coreValues, isReadOnly: core.isReadOnly, status: core.status, error: core.error,
        titleForm: core.titleBinding, verseForm: core.verseBinding,
        keepLocal: core.keepLocal, acceptRemote: core.acceptRemote, retry: core.retry,
      }} />
      <div className="lg:hidden">
        <StructureStats
          sermon={sermon!}
          tagCounts={tagCounts}
          totalThoughts={sermon?.thoughts?.length ?? 0}
          hasInconsistentThoughts={hasInconsistentThoughts}
          onOpenPlanEditor={openPlanEditor}
        />
      </div>

      {uiMode !== 'raw' && sermon && (
        <RecordingDraftBanner
          context="sermon"
          contextId={sermon.id}
          onResend={resendParkedRecording}
          isProcessing={isProcessing}
          className="mb-2"
        />
      )}
      {uiMode !== 'raw' && (
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
          onDiscardRecording={handleDiscardRecording}
          hideKeyboardShortcuts={uiMode === 'prep'}
          isReadOnly={isReadOnly}
          isRecorderDisabled={dictationBlocked}
          recorderTitle={dictationBlocked && dictationBlockedKey ? t(dictationBlockedKey) : undefined}
          onOpenCreateModal={() => setIsCreateModalOpen(true)}
          manualThoughtTitle={t('manualThought.addManual')}
        />
      )}

      <div className="relative -mx-2 px-2 py-1 sm:-mx-3 sm:px-3">
        <div className="overflow-hidden">
          <motion.div
            className="flex"
            initial={false}
            animate={{ x: PANE_TRANSLATE_X_BY_MODE[uiMode] }}
            transition={{ type: 'spring', stiffness: 220, damping: 26, mass: 0.9 }}
            style={{ width: '300%', willChange: 'transform' }}
          >
          {/* Clip each pane horizontally so offscreen card shadows cannot bleed into its neighbor. */}
          <div className="basis-1/3 shrink-0 overflow-x-clip">
            <div className={`grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8`}>
              <div className="order-2 lg:order-1 lg:col-span-2">
                {renderPrepContent()}
              </div>
              <div className="order-1 lg:order-2 space-y-6">
                {renderClassicContent({ withBrainstorm: false, portalRef: setPrepPortal })}
              </div>
            </div>
          </div>

          <div className="basis-1/3 shrink-0 overflow-x-clip">
            <div className={`grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8`}>
              <div className="order-2 lg:order-1 lg:col-span-2">
                {renderClassicContent({ portalRef: setClassicPortal })}
              </div>
              <div className="order-1 lg:order-2 space-y-6">
                <div className="hidden lg:block">
                  <StructureStats
                    sermon={sermon!}
                    tagCounts={tagCounts}
                    totalThoughts={sermon?.thoughts?.length ?? 0}
                    hasInconsistentThoughts={hasInconsistentThoughts}
                    onOpenPlanEditor={openPlanEditor}
                  />
                </div>
                <SermonOutline
                  key={outlineRefreshKey}
                  sermon={sermon!}
                  thoughtsPerSermonPoint={thoughtsPerSermonPoint}
                  isReadOnly={isReadOnly}
                />
                {/* On an engine document the insights route stores the result itself; the page reads it back. */}
                {sermon && !isReadOnly && <KnowledgeSection sermon={sermon} updateSermon={() => { void core.retry().catch(() => undefined); }} />}
                {sermon?.structure && userSettings?.enableStructurePreview && <StructurePreview sermon={sermon} />}
              </div>
            </div>
          </div>

          <div className="basis-1/3 shrink-0 overflow-x-clip">
            {renderRawContent()}
          </div>
          </motion.div>
        </div>
      </div>
      {(editingModalData || isCreateModalOpen) && <EngineThoughtModal
        key={editingModalData?.session ?? 'create'} sermonId={id} thoughtId={editingModalData?.thought.id}
        allowedTags={allowedTags} onClose={() => { closeEditingModal(); setIsCreateModalOpen(false); }} />}
      {sermon && (
        <PlanEditorModal
          isOpen={isPlanEditorOpen}
          onClose={() => {
            setIsPlanEditorOpen(false);
            setOutlineRefreshKey((k) => k + 1);
          }}
          sermon={sermon}
          isReadOnly={isReadOnly}
        />
      )}
    </div>
    </ScriptureLinksInWindow>
  );
}

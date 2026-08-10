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

import { DataFreshnessBanner } from '@/components/DataFreshnessBanner';
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
import ScratchPanel from "@/components/sermon/ScratchPanel";
import SermonHeader from "@/components/sermon/SermonHeader";
import SermonOutline from "@/components/sermon/SermonOutline";
import StructurePreview from "@/components/sermon/StructurePreview";
import StructureStats from "@/components/sermon/StructureStats";
import { SermonDetailSkeleton } from "@/components/skeletons/SermonDetailSkeleton";
import { useDocumentFreshness } from '@/hooks/useDocumentFreshness';
import { useFreshnessUid } from '@/hooks/useFreshnessUid';
import { useRouteId } from "@/hooks/useRouteId";
import { useSeries } from "@/hooks/useSeries";
import useSermon from "@/hooks/useSermon";
import { useTags } from "@/hooks/useTags";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useAuth } from "@/providers/AuthProvider";
import { useConnection } from "@/providers/ConnectionProvider";
import { updateSermonOutline } from "@/services/outline.service";
import { updateSermonPreparation, updateSermon } from '@/services/sermon.service';
import { updateStructure } from "@/services/structure.service";
import { newClientId } from "@/utils/clientId";
import { clearDraftIfMatches, draftKey, readDraft, saveDraft } from '@/utils/durableDraft';
import {
  sermonFreshnessProjection,
  type SermonFreshnessProjection,
} from '@/utils/sermonFreshnessProjection';
import CreateThoughtModal from "@components/CreateThoughtModal";
import EditThoughtModal from "@components/EditThoughtModal";
import { useThoughtFiltering } from '@hooks/useThoughtFiltering';
import { STRUCTURE_TAGS } from '@lib/constants';
import { createAudioThought, createManualThought, deleteThought, updateThought } from "@services/thought.service";
import { getCanonicalTagForSection, normalizeStructureTag } from '@utils/tagUtils';
import { UI_COLORS } from "@utils/themeColors";
import {
  canonicalizeStructure,
  findThoughtSectionInStructure,
  insertThoughtIdInStructure,
  removeThoughtIdFromStructure,
  replaceThoughtIdInStructure,
  resolveSectionForNewThought,
} from "@utils/thoughtOrdering";

import { useScratchNotes } from "./hooks/useScratchNotes";

import type { Sermon, Thought, SermonOutline as SermonOutlineType, Preparation, BrainstormSuggestion } from "@/models/models";
import type { StructureSectionId } from '@utils/tagUtils';
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

// Defensive structure-hygiene backstop: thought ids are now minted real up front
// (newClientId), so no "local-" placeholder ever reaches the structure. We still
// strip any such id before persisting structure, to keep the structure-overwrite
// bug class (#13) impossible even if a legacy/stray local id slips through.
const THOUGHT_LOCAL_ID_PREFIX = "local-thought-";
const STRUCTURE_SAVE_ERROR_KEY = "errors.failedToSaveStructure";

type ThoughtPatch = Pick<Thought, "text" | "tags" | "outlinePointId" | "subPointId">;
type SermonUiMode = 'classic' | 'prep' | 'raw';

interface ThoughtPatchOptions {
  outlineOverride?: SermonOutlineType;
}

const sanitizeThoughtStructure = (structure: Sermon["structure"] | undefined) => {
  if (!structure) return structure;

  return {
    introduction: (structure.introduction ?? []).filter((id) => !id.startsWith(THOUGHT_LOCAL_ID_PREFIX)),
    main: (structure.main ?? []).filter((id) => !id.startsWith(THOUGHT_LOCAL_ID_PREFIX)),
    conclusion: (structure.conclusion ?? []).filter((id) => !id.startsWith(THOUGHT_LOCAL_ID_PREFIX)),
    ambiguous: (structure.ambiguous ?? []).filter((id) => !id.startsWith(THOUGHT_LOCAL_ID_PREFIX)),
  };
};

const withStructureTagForSection = (tags: string[], section: StructureSectionId): string[] => [
  ...tags.filter((tag) => !normalizeStructureTag(tag)),
  getCanonicalTagForSection(section),
];

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

/** Preparation is its own aggregate in the durable store, as it is on the server. */
const PREPARATION_DRAFT_AGGREGATE = 'preparation';

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

const checkForInconsistentThoughtsHelper = (sermon: Sermon | null): boolean => {
  if (!sermon || !sermon.thoughts || !sermon.outline) return false;

  return sermon.thoughts.some(thought => {
    const usedStructureTags = thought.tags
      .map((tag) => normalizeStructureTag(tag))
      .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));
    if (usedStructureTags.length > 1) {
      return true;
    }

    if (usedStructureTags.length === 0) {
      return false;
    }

    if (!thought.outlinePointId) return true;

    let outlinePointSection: StructureSectionId | undefined;

    if (sermon.outline!.introduction.some(p => p.id === thought.outlinePointId)) {
      outlinePointSection = 'introduction';
    } else if (sermon.outline!.main.some(p => p.id === thought.outlinePointId)) {
      outlinePointSection = 'main';
    } else if (sermon.outline!.conclusion.some(p => p.id === thought.outlinePointId)) {
      outlinePointSection = 'conclusion';
    }

    if (!outlinePointSection) return true;

    return usedStructureTags[0] !== getCanonicalTagForSection(outlinePointSection);
  });
};

export default function SermonPage() {
  const id = useRouteId();
  const { user } = useAuth();
  const { series } = useSeries(user?.uid || null);
  const { settings: userSettings } = useUserSettings(user?.uid);
  const { isMagicAvailable } = useConnection();
  const isReadOnly = false; // Support Indifferent Sync: edit always possible locally

  const searchParams = useSearchParams();
  const modeParam = searchParams?.get('mode');
  const [uiMode, setUiMode] = useState<SermonUiMode>(() => getInitialUiMode(modeParam, id as string));

  const { t } = useTranslation();
  const { sermon, setSermon, loading, isOnline, awaitingFirstAnswer, refreshSermon } = useSermon(id);

  // Does the server hold a newer version of THIS sermon? Shared layer with the
  // note and series pages: observe only, never swap what is on screen.
  // Fingerprints, not counts: editing a thought, reordering the outline or
  // rewriting the plan leaves every length identical, and the stale screen used
  // to call itself fresh. The listener already carries the whole document, so
  // this costs no extra reads.
  // ONE function for both sides of the comparison. This and the `select` below used
  // to hold two copies of the same rule; drifting apart, they would themselves look
  // exactly like a foreign edit.
  const knownSermon = useMemo<SermonFreshnessProjection | null>(
    () => (sermon ? sermonFreshnessProjection(sermon as unknown as Record<string, unknown>) : null),
    [sermon]
  );
  const freshnessUid = useFreshnessUid(sermon?.userId);
  const sermonFreshness = useDocumentFreshness<SermonFreshnessProjection>({
    collection: 'sermons',
    docId: id || null,
    // The CURRENT signed-in owner, not the owner stored on the cached document.
    // A listener keyed by the document's own userId survives a logout: the cached
    // entity keeps the old owner, the prop never changes, so the effect never
    // cleans up. Requiring the two to match also refuses to listen to a foreign
    // document left in the cache.
    uid: freshnessUid,
    enabled: Boolean(sermon),
    known: knownSermon,
    select: (data) => sermonFreshnessProjection(data),
  });
  const [sermonFreshnessDismissed, setSermonFreshnessDismissed] = useState(false);

  /**
   * PULL THE NEWER VERSION IN PLACE — no page reload.
   *
   * The banner used to have no action at all here, because the only refresh anyone
   * had written was `window.location.reload()`, and that threw away whatever was
   * being typed. So the screen asked "load the newer version?" and offered no way to
   * say yes; the answer was to go to the browser and reload by hand.
   *
   * Refetching the query replaces the sermon data and leaves component state alone:
   * an open thought modal keeps its text, the title being edited keeps its draft.
   * The banner then disappears on its own — once the screen holds what the server
   * holds, the freshness comparison stops finding a difference.
   */
  const [isRefreshingSermon, setIsRefreshingSermon] = useState(false);
  const handleRefreshSermon = useCallback(async () => {
    if (isRefreshingSermon) return;
    setIsRefreshingSermon(true);
    try {
      await refreshSermon();
      toast.success(t('freshness.refreshedToast'));
    } catch {
      // Staying on the older version is not a disaster; silently pretending it
      // worked would be. The banner remains, so the offer stays available.
      toast.error(t('freshness.refreshFailedToast'));
    } finally {
      setIsRefreshingSermon(false);
    }
  }, [isRefreshingSermon, refreshSermon, t]);
  useEffect(() => {
    if (sermonFreshness.state === 'stale' || sermonFreshness.state === 'unknown') setSermonFreshnessDismissed(false);
  }, [sermonFreshness.remote, sermonFreshness.state]);

  // Normalize thoughts if they are null (happens in some test scenarios/legacy data)
  if (sermon && sermon.thoughts === null) {
    sermon.thoughts = [];
  }

  const sermonRef = useRef<Sermon | null>(sermon);
  const structurePersistVersionRef = useRef(0);
  const scratchOutlinePersistVersionRef = useRef(0);
  const [savingPrep, setSavingPrep] = useState(false);
  const [prepDraft, setPrepDraft] = useState<Preparation>({});
  /**
   * Preparation text that was never confirmed saved — a failed write, a closed tab.
   * OFFERED, never applied by itself: a leftover copy silently merged over the
   * server's preparation is how work done on another device disappeared.
   */
  const [prepRecovery, setPrepRecovery] = useState<Preparation | null>(null);
  const prepRecoveryCheckedRef = useRef<string | null>(null);
  const [classicPortal, setClassicPortal] = useState<HTMLDivElement | null>(null);
  const [prepPortal, setPrepPortal] = useState<HTMLDivElement | null>(null);
  const invalidateScratchOutlinePersistence = useCallback(() => {
    scratchOutlinePersistVersionRef.current += 1;
  }, []);
  const scratchNotes = useScratchNotes({
    sermon,
    sermonRef,
    setSermon,
    onOutlineWriteQueued: invalidateScratchOutlinePersistence,
  });

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

/**
 * THE SERVER'S PREPARATION IS WHAT THE EDITOR SHOWS.
 *
 * This used to merge a leftover `prep-draft-backup-<sermonId>` over it — "local wins
 * over stale remote" — so a backup left behind by a failed save weeks earlier silently
 * replaced work done on another device since, and the next save pushed it to the
 * server. Unconfirmed text is OFFERED now, never applied by itself, and it lives in
 * the uid-scoped durable store (the old key had no uid, so on a shared computer the
 * next account could read the previous one's text).
 */
useEffect(() => {
  if (sermon?.preparation) setPrepDraft(sermon.preparation);
}, [sermon?.preparation, sermon?.id]);

/**
 * Look for unconfirmed preparation text ONCE per sermon, and only OFFER it.
 *
 * Text left by an older build under the uid-less `prep-draft-backup-<sermonId>` key is
 * carried into the uid-scoped store first, so nothing anybody typed is destroyed — it
 * simply stops being applied by itself. (That old key had no uid at all, so on a shared
 * computer the next account could read the previous one's text; it is retired here.)
 */
useEffect(() => {
  const uid = user?.uid;
  if (!uid || !sermon?.id) return;
  const key = draftKey(uid, sermon.id, PREPARATION_DRAFT_AGGREGATE);
  if (prepRecoveryCheckedRef.current === key) return;
  prepRecoveryCheckedRef.current = key;

  try {
    const legacy = localStorage.getItem(`prep-draft-backup-${sermon.id}`);
    if (legacy) {
      const parsed = JSON.parse(legacy) as Preparation;
      if (!readDraft<Preparation>(key)) saveDraft(key, parsed);
      localStorage.removeItem(`prep-draft-backup-${sermon.id}`);
    }
  } catch { }

  const stored = readDraft<Preparation>(key);
  if (!stored) return;
  // Nothing to offer when it says exactly what the server already holds.
  const server = sermonRef.current?.preparation ?? {};
  const differs = (Object.keys(stored.value) as (keyof Preparation)[]).some(
    (field) => JSON.stringify(stored.value[field]) !== JSON.stringify(server[field])
  );
  if (differs) setPrepRecovery(stored.value);
}, [user?.uid, sermon?.id]);
  const savePreparation = useCallback(async (partial: Preparation) => {
    if (!sermon) return;
    setSavingPrep(true);
    const next: Preparation = { ...(sermon.preparation ?? {}), ...partial };
    
    // A durable copy BEFORE the write is attempted — uid-scoped, and retired only
    // once the server has accepted exactly this value.
    if (user?.uid) saveDraft(draftKey(user.uid, sermon.id, PREPARATION_DRAFT_AGGREGATE), next);

    // Only the steps that actually differ from what the server holds. Writing
    // `next` wholesale would push back every OTHER step from this page's snapshot,
    // silently reverting work done on another device.
    const server = (sermon.preparation ?? {}) as Preparation;
    // Union of both sides: a step the user REMOVED is absent from `next`, so
    // iterating `next` alone would never notice it and the removal would never
    // reach the server (it looked saved, then came back after a reload).
    const allKeys = Array.from(
      new Set([...Object.keys(next), ...Object.keys(server)])
    ) as (keyof Preparation)[];
    const changedKeys = allKeys.filter(
      (key) => JSON.stringify(next[key]) !== JSON.stringify(server[key])
    );
    if (changedKeys.length === 0) {
      setSavingPrep(false);
      return;
    }

    const updated = await updateSermonPreparation(sermon.id, next, changedKeys);
    if (updated) {
      setSermon(prev => (prev ? { ...prev, preparation: updated } : prev));
      // Retire OUR copy only — compare first, so a copy another tab stored since
      // survives (it is that tab's only unconfirmed text).
      if (user?.uid) {
        clearDraftIfMatches(draftKey(user.uid, sermon.id, PREPARATION_DRAFT_AGGREGATE), next);
      }
    } else {
      // If update failed (offline), we keep the backup and show a toast
      toast.error('Changes saved locally. They will sync when you are back online.', { id: 'prep-sync-error' });
    }
    setSavingPrep(false);
  }, [sermon, setSermon, user?.uid]);

  const applyPrepDraftUpdate = useCallback(async (next: Preparation) => {
    setPrepDraft(next);
    await savePreparation(next);
  }, [savePreparation]);

  const { allTags } = useTags(sermon?.userId);
  const allowedTags = useMemo(
    () => allTags.map((tag) => ({ name: tag.name, color: tag.color })),
    [allTags]
  );

  const persistStructureForThoughts = useCallback(async (nextStructure: Sermon["structure"]) => {
    const currentSermon = sermonRef.current;
    const sanitizedStructure = sanitizeThoughtStructure(nextStructure);
    if (!currentSermon || !sanitizedStructure) return;

    try {
      // State the arrangement this screen holds as stored, so a thought moved only on
      // the other device is not pulled back here.
      await updateStructure(currentSermon.id, sanitizedStructure, currentSermon.structure);
    } catch (structureError) {
      console.error("Failed to update structure after thought sync", structureError);
      throw structureError;
    }
  }, []);

  const buildStructureWithThought = useCallback((params: {
    baseSermon: Sermon;
    thought: Thought;
    targetSection: ReturnType<typeof resolveSectionForNewThought>;
  }) => {
    const { baseSermon, thought, targetSection } = params;
    const projectedThoughts = [
      thought,
      ...baseSermon.thoughts.filter((item) => item.id !== thought.id),
    ];
    const thoughtsById = new Map(projectedThoughts.map((item) => [item.id, item]));

    return insertThoughtIdInStructure({
      structure: baseSermon.structure,
      section: targetSection,
      thoughtId: thought.id,
      outlinePointId: thought.outlinePointId ?? null,
      thoughtsById,
      thoughts: projectedThoughts,
      outline: baseSermon.outline,
    });
  }, []);

  const [isProcessing, setIsProcessing] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [storedAudioBlob, setStoredAudioBlob] = useState<Blob | null>(null);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [editingModalData, setEditingModalData] = useState<{ thought: Thought; index: number } | null>(null);
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
    hasStructureTags
  } = useThoughtFiltering({
    initialThoughts: sermon?.thoughts ?? [],
    sermonStructure: sermon?.structure,
    sermonOutline: sermon?.outline
  });

  const filterButtonRef = useRef<HTMLButtonElement>(null);

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
      await updateStructure(sermon.id, updatedStructure, sermon.structure);
    } catch (error) {
      console.error("Failed to update structure after adding thought", error);
    }
  }, [sermon, setSermon]);

  const handleSaveThoughtPatch = useCallback(async (
    thoughtToUpdate: Thought,
    patch: ThoughtPatch,
    options: ThoughtPatchOptions = {}
  ) => {
    const currentSermon = sermonRef.current ?? sermon;
    if (!currentSermon) return;

    const baseSermon: Sermon = options.outlineOverride
      ? { ...currentSermon, outline: options.outlineOverride }
      : currentSermon;
    const previousStructure = baseSermon.structure;
    const optimisticThought: Thought = {
      ...thoughtToUpdate,
      ...patch,
    };
    const currentSection = findThoughtSectionInStructure(baseSermon.structure, thoughtToUpdate.id);
    const nextSection = resolveSectionForNewThought({
      sermon: baseSermon,
      outlinePointId: optimisticThought.outlinePointId ?? null,
      tags: optimisticThought.tags,
    });
    const outlinePointWillChange = (thoughtToUpdate.outlinePointId ?? null) !== (optimisticThought.outlinePointId ?? null);
    const structureWillChange = nextSection !== currentSection || outlinePointWillChange;
    const optimisticStructure = structureWillChange
      ? buildStructureWithThought({
          baseSermon,
          thought: optimisticThought,
          targetSection: nextSection,
        })
      : baseSermon.structure;
    const optimisticThoughts = baseSermon.thoughts.map((thought) =>
      thought.id === optimisticThought.id ? optimisticThought : thought
    );
    const optimisticSermon: Sermon = {
      ...baseSermon,
      thoughts: optimisticThoughts,
      structure: optimisticStructure ?? baseSermon.structure,
      thoughtsBySection: optimisticStructure ?? baseSermon.thoughtsBySection,
    };
    const structurePersistVersion = structureWillChange ? ++structurePersistVersionRef.current : null;

    sermonRef.current = optimisticSermon;

    // Optimistic (React Query cache via setSermon): patch the thought + structure
    // so the edit shows instantly. The client-SDK write (updateThought) lands in
    // the native Firestore offline queue; on a real failure we roll the cache back
    // and surface a toast (replaces the old per-card sync badge + retry button).
    setSermon((prevSermon) =>
      prevSermon
        ? {
            ...prevSermon,
            outline: optimisticSermon.outline,
            thoughts: optimisticSermon.thoughts,
            structure: optimisticSermon.structure,
            thoughtsBySection: optimisticSermon.thoughtsBySection,
          }
        : prevSermon
    );

    // Fire-and-forget the persistence so the caller (edit modal / outline select)
    // never blocks on the network. Offline the write parks in the native queue.
    void (async () => {
      try {
        // `thoughtToUpdate` is the thought AS THE EDITOR OPENED IT and `patch` is
        // what the person changed, so the write states only the changed fields —
        // dragging a thought no longer re-sends this screen's hours-old copy of its
        // text over a rewrite made on another device.
        const savedThought = await updateThought(baseSermon.id, optimisticThought, thoughtToUpdate);
        // Reconcile with the server's returned thought; fall back to the optimistic
        // one if the service resolves empty (offline path / void return) so we never
        // dereference undefined and never skip the structure persist below.
        const reconciledThought = savedThought ?? optimisticThought;
        sermonRef.current = sermonRef.current
          ? {
              ...sermonRef.current,
              thoughts: sermonRef.current.thoughts.map((thought) =>
                thought.id === reconciledThought.id ? reconciledThought : thought
              ),
            }
          : sermonRef.current;
        setSermon((prevSermon) =>
          prevSermon
            ? {
                ...prevSermon,
                thoughts: prevSermon.thoughts.map((thought) =>
                  thought.id === reconciledThought.id ? reconciledThought : thought
                ),
              }
            : prevSermon
        );

        // Structure persist is best-effort: a failure here must NOT roll back the
        // thought edit, which already succeeded server-side.
        if (
          structureWillChange &&
          optimisticStructure &&
          structurePersistVersion === structurePersistVersionRef.current
        ) {
          try {
            await persistStructureForThoughts(optimisticStructure);
          } catch (structureError) {
            console.error("Failed to persist structure after thought update", structureError);
            toast.error(t(STRUCTURE_SAVE_ERROR_KEY));
          }
        }
      } catch (updateError) {
        console.error("Failed to update thought", updateError);
        const shouldRollbackStructure =
          structureWillChange && structurePersistVersion === structurePersistVersionRef.current;
        sermonRef.current = sermonRef.current
          ? {
              ...sermonRef.current,
              thoughts: sermonRef.current.thoughts.map((thought) =>
                thought.id === thoughtToUpdate.id ? thoughtToUpdate : thought
              ),
              ...(shouldRollbackStructure
                ? { structure: previousStructure, thoughtsBySection: previousStructure }
                : {}),
            }
          : sermonRef.current;
        // Surgical rollback: restore only THIS thought (+ its structure move), so a
        // concurrent batch (outline-point delete patching N thoughts) is not
        // clobbered by restoring a whole stale sermon snapshot.
        setSermon((prevSermon) =>
          prevSermon
            ? {
                ...prevSermon,
                thoughts: prevSermon.thoughts.map((thought) =>
                  thought.id === thoughtToUpdate.id ? thoughtToUpdate : thought
                ),
                ...(shouldRollbackStructure
                  ? { structure: previousStructure, thoughtsBySection: previousStructure }
                  : {}),
              }
            : prevSermon
        );
        toast.error(t("errors.thoughtUpdateError"));
      }
    })();
  }, [buildStructureWithThought, sermon, persistStructureForThoughts, setSermon, t]);

  const handleCreateManualThought = useCallback(async (draftThought: Omit<Thought, "id">) => {
    if (!sermon) return;

    const previousSermon = sermonRef.current;
    // Mint the real id up front (no "local-" placeholder): the optimistic row, the
    // client-SDK write and the stored doc all share one stable id, so a buffered
    // write that ever replays is idempotent and the structure never needs a
    // temp->real id swap. Mirrors the useGroups/usePrayerRequests create idiom.
    const newThought: Thought = {
      ...draftThought,
      id: newClientId(),
    };
    const targetSection = resolveSectionForNewThought({
      sermon: sermon,
      outlinePointId: newThought.outlinePointId ?? null,
      tags: newThought.tags,
    });
    const optimisticStructure = buildStructureWithThought({
      baseSermon: sermon,
      thought: newThought,
      targetSection,
    });

    setSermon((prevSermon) =>
      prevSermon
        ? {
            ...prevSermon,
            thoughts: [newThought, ...prevSermon.thoughts.filter((thought) => thought.id !== newThought.id)],
            structure: optimisticStructure ?? prevSermon.structure,
            thoughtsBySection: optimisticStructure ?? prevSermon.thoughtsBySection,
          }
        : prevSermon
    );

    // Fire-and-forget so the create modal closes immediately; offline the write
    // parks in the native Firestore queue and replays on reconnect.
    void (async () => {
      try {
        const savedThought = await createManualThought(sermon.id, newThought);
        const idChanged = savedThought.id !== newThought.id;
        // Client SDK echoes the same id (idChanged=false, no-op). A server fallback
        // that mints its own id is reconciled here: swap temp->real everywhere.
        const reconciledStructure = idChanged
          ? replaceThoughtIdInStructure({
              structure: optimisticStructure,
              fromThoughtId: newThought.id,
              toThoughtId: savedThought.id,
            })
          : optimisticStructure;

        setSermon((prevSermon) => {
          if (!prevSermon) return prevSermon;
          const nextStructure = idChanged
            ? replaceThoughtIdInStructure({
                structure: prevSermon.structure,
                fromThoughtId: newThought.id,
                toThoughtId: savedThought.id,
              })
            : prevSermon.structure;
          return {
            ...prevSermon,
            thoughts: prevSermon.thoughts.map((thought) =>
              thought.id === newThought.id ? savedThought : thought
            ),
            structure: nextStructure,
            thoughtsBySection: nextStructure,
          };
        });

        // Structure persist is best-effort: a failure must not undo the created thought.
        if (reconciledStructure) {
          try {
            await persistStructureForThoughts(reconciledStructure);
          } catch (structureError) {
            console.error("Failed to persist structure after thought create", structureError);
            toast.error(t(STRUCTURE_SAVE_ERROR_KEY));
          }
        }
      } catch (createError) {
        console.error("Failed to create thought", createError);
        setSermon(() => previousSermon);
        toast.error(t("errors.addThoughtError"));
      }
    })();
  }, [buildStructureWithThought, sermon, persistStructureForThoughts, setSermon, t]);

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

  const handleThoughtOutlinePointChange = useCallback(async (thought: Thought, outlinePointId?: string | null, subPointId?: string | null) => {
    const outlineChanged = outlinePointId !== (thought.outlinePointId ?? null);
    await handleSaveThoughtPatch(thought, {
      text: thought.text,
      tags: thought.tags,
      outlinePointId,
      subPointId: subPointId !== undefined ? subPointId : (outlineChanged ? null : thought.subPointId ?? null),
    });
  }, [handleSaveThoughtPatch]);

  const handleDeleteThought = useCallback(async (thoughtId: string) => {
    if (!sermon) return;

    const thoughtToDelete = sermon.thoughts.find((thought) => thought.id === thoughtId);
    if (!thoughtToDelete) {
      console.error("Could not find thought with ID:", thoughtId);
      return;
    }

    const previousSermon = sermonRef.current;
    const nextStructure = removeThoughtIdFromStructure(
      sermonRef.current?.structure ?? sermon.structure,
      thoughtId
    );

    // Optimistic delete: drop the thought + its structure id from the cache now.
    setSermon((prevSermon) => {
      if (!prevSermon) return prevSermon;
      const localStructure = removeThoughtIdFromStructure(prevSermon.structure, thoughtId);
      return {
        ...prevSermon,
        thoughts: prevSermon.thoughts.filter((thought) => thought.id !== thoughtId),
        structure: localStructure,
        thoughtsBySection: localStructure,
      };
    });

    // Fire-and-forget: the card disappears immediately; offline the delete parks
    // in the native Firestore queue.
    void (async () => {
      try {
        await deleteThought(sermon.id, thoughtToDelete);
        try {
          await persistStructureForThoughts(nextStructure);
        } catch (structureError) {
          console.error("Failed to persist structure after thought delete", structureError);
          toast.error(t("errors.failedToSaveStructure"));
        }
      } catch (deleteError) {
        console.error("Failed to delete thought", deleteError);
        setSermon(() => previousSermon);
        toast.error(t("errors.deletingError"));
      }
    })();
  }, [sermon, persistStructureForThoughts, setSermon, t]);

  const handleSaveEditedThought = async (updatedText: string, updatedTags: string[], outlinePointId?: string | null, subPointId?: string | null) => {
    if (!editingModalData) return;
    const currentSermon = sermon;
    if (!currentSermon) {
      setEditingModalData(null);
      return;
    }
    const originalThoughtId = editingModalData.thought.id;

    const thoughtToUpdate = currentSermon.thoughts.find((thought) => thought.id === originalThoughtId);
    if (!thoughtToUpdate) {
      console.error("Could not find thought with ID:", originalThoughtId);
      setEditingModalData(null);
      return;
    }

    const outlineChanged = outlinePointId !== (thoughtToUpdate.outlinePointId ?? null);
    await handleSaveThoughtPatch(thoughtToUpdate, {
      text: updatedText.trim(),
      tags: updatedTags,
      outlinePointId,
      subPointId: subPointId !== undefined ? subPointId : (outlineChanged ? null : thoughtToUpdate.subPointId ?? null),
    });
    setEditingModalData(null);
  };

  const handleEditThoughtStart = (thought: Thought, index: number) => {
    setEditingModalData({ thought, index });
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
  useEffect(() => {
    const target = prepStepParam as PrepStepId | null;
    if (target && PREP_STEP_IDS.includes(target)) {
      if (target !== activeStepId && !manuallyExpanded.has(target)) {
        setManuallyExpanded(prev => new Set(prev).add(target));
      }
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

  const handleOutlineUpdate = useCallback((updatedOutline: SermonOutlineType) => {
    sermonRef.current = sermonRef.current
      ? {
          ...sermonRef.current,
          outline: updatedOutline,
        }
      : sermonRef.current;
    setSermon(prevSermon => {
      if (!prevSermon) return null;
      return {
        ...prevSermon,
        outline: updatedOutline,
      };
    });
  }, [setSermon]);

  const handleScratchOutlineChange = useCallback(
    async (outline: SermonOutlineType) => {
      const currentSermon = sermonRef.current ?? sermon;
      if (!currentSermon) return;

      const persistVersion = scratchOutlinePersistVersionRef.current + 1;
      scratchOutlinePersistVersionRef.current = persistVersion;
      handleOutlineUpdate(outline);
      setOutlineRefreshKey((key) => key + 1);

      try {
        const savedOutline = await updateSermonOutline(currentSermon.id, outline);
        if (persistVersion !== scratchOutlinePersistVersionRef.current) return;
        if (!savedOutline) {
          throw new Error(t('scratch.board.applyError'));
        }

        handleOutlineUpdate(savedOutline);
        setOutlineRefreshKey((key) => key + 1);
      } catch (error) {
        if (persistVersion === scratchOutlinePersistVersionRef.current) {
          throw error;
        }
      }
    },
    [handleOutlineUpdate, sermon, t]
  );

  const handleApplyScratchOutline = useCallback(
    (outline: SermonOutlineType, consumedNoteIds: string[]) => {
      const applyResult = scratchNotes.applyOutlineAndConsume(outline, consumedNoteIds);
      setOutlineRefreshKey((key) => key + 1);
      return applyResult;
    },
    [scratchNotes.applyOutlineAndConsume]
  );

  const handleOutlinePointDeleted = useCallback((outlinePointId: string) => {
    const currentSermon = sermon;
    if (!currentSermon) return;

    currentSermon.thoughts
      .filter((thought) => thought.outlinePointId === outlinePointId)
      .forEach((thought) => {
        void handleSaveThoughtPatch(thought, {
          text: thought.text,
          tags: thought.tags,
          outlinePointId: null,
          subPointId: null,
        });
      });
  }, [handleSaveThoughtPatch, sermon]);

  const handleOutlinePointMoved = useCallback((
    outlinePointId: string,
    destinationSection: StructureSectionId,
    updatedOutline: SermonOutlineType
  ) => {
    const currentSermon = sermonRef.current ?? sermon;
    if (!currentSermon) return;

    sermonRef.current = {
      ...currentSermon,
      outline: updatedOutline,
    };
    setSermon((prevSermon) =>
      prevSermon ? { ...prevSermon, outline: updatedOutline } : prevSermon
    );

    currentSermon.thoughts
      .filter((thought) => thought.outlinePointId === outlinePointId)
      .forEach((thought) => {
        void handleSaveThoughtPatch(thought, {
          text: thought.text,
          tags: withStructureTagForSection(thought.tags, destinationSection),
          outlinePointId: thought.outlinePointId ?? null,
          subPointId: thought.subPointId ?? null,
        }, { outlineOverride: updatedOutline });
      });
  }, [handleSaveThoughtPatch, sermon, setSermon]);

  const handleSubPointMoved = useCallback((
    subPointId: string,
    _sourcePointId: string,
    destinationPointId: string,
    destinationSection: StructureSectionId,
    updatedOutline: SermonOutlineType
  ) => {
    const currentSermon = sermonRef.current ?? sermon;
    if (!currentSermon) return;

    sermonRef.current = {
      ...currentSermon,
      outline: updatedOutline,
    };
    setSermon((prevSermon) =>
      prevSermon ? { ...prevSermon, outline: updatedOutline } : prevSermon
    );

    currentSermon.thoughts
      .filter((thought) => thought.subPointId === subPointId)
      .forEach((thought) => {
        void handleSaveThoughtPatch(thought, {
          text: thought.text,
          tags: withStructureTagForSection(thought.tags, destinationSection),
          outlinePointId: destinationPointId,
          subPointId: thought.subPointId ?? subPointId,
        }, { outlineOverride: updatedOutline });
      });
  }, [handleSaveThoughtPatch, sermon, setSermon]);

  const handleSubPointDeleted = useCallback((outlinePointId: string, subPointId: string) => {
    const currentSermon = sermon;
    if (!currentSermon) return;

    currentSermon.thoughts
      .filter((thought) => thought.outlinePointId === outlinePointId && thought.subPointId === subPointId)
      .forEach((thought) => {
        void handleSaveThoughtPatch(thought, {
          text: thought.text,
          tags: thought.tags,
          outlinePointId: thought.outlinePointId ?? null,
          subPointId: null,
        });
      });
  }, [handleSaveThoughtPatch, sermon]);

  const handleSermonUpdate = useCallback((updatedSermon: Sermon) => {
    setSermon(updatedSermon);
  }, [setSermon]);

  const handleNewRecording = async (audioBlob: Blob) => {
    if (!sermon) return;
    setIsProcessing(true);
    setStoredAudioBlob(audioBlob);
    setTranscriptionError(null);
    setRetryCount(0);

    try {
      const thoughtResponse = await createAudioThought(audioBlob, sermon.id, 0, 3);
      const newThought: Thought = { ...thoughtResponse };
      await appendNewThoughtWithStructure(newThought);
      setStoredAudioBlob(null);
      setTranscriptionError(null);
    } catch (error) {
      console.error("handleNewRecording: Recording error:", error);
      setTranscriptionError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRetryTranscription = async () => {
    if (!storedAudioBlob || !sermon) return;

    setIsProcessing(true);
    const newRetryCount = retryCount + 1;
    setRetryCount(newRetryCount);
    setTranscriptionError(null);

    try {
      const thoughtResponse = await createAudioThought(storedAudioBlob, sermon.id, newRetryCount, 3);
      const newThought: Thought = { ...thoughtResponse };
      await appendNewThoughtWithStructure(newThought);
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
      onThoughtOutlinePointChange={handleThoughtOutlinePointChange}
      isReadOnly={isReadOnly}
    />
  );

  const renderRawContent = () => (
    <ScratchPanel
      sermonId={sermon!.id}
      notes={scratchNotes.notes}
      outline={sermon?.outline}
      addScratchNote={scratchNotes.addScratchNote}
      restoreScratchNote={scratchNotes.restoreScratchNote}
      updateScratchNote={scratchNotes.updateScratchNote}
      deleteScratchNote={scratchNotes.deleteScratchNote}
      setScratchNoteSection={scratchNotes.setScratchNoteSection}
      isScratchWritePending={scratchNotes.isWritePending}
      scratchRevision={scratchNotes.scratchRevision}
      onApplyOutline={handleApplyScratchOutline}
      onOutlineChange={handleScratchOutlineChange}
      isReadOnly={isReadOnly}
    />
  );

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
          setPrepDraft={setPrepDraft}
          savePreparation={savePreparation}
          savingPrep={savingPrep}
          formatSuperscriptVerses={formatSuperscriptVerses}
        />
      ),
      textContext: (
        <TextContextStepContent
          initialVerse={sermon?.verse || ''}
          onSaveVerse={async (nextVerse: string) => {
            if (!sermon) return;
            setSermon(prev => prev ? { ...prev, verse: nextVerse } : prev);
            const updated = await updateSermon({ ...sermon, verse: nextVerse }, { verse: nextVerse });
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
        {/* Unconfirmed preparation text found in the durable store. It is shown, not
            applied: applying it by itself replaced newer work from another device. */}
        {prepRecovery && (
          <div className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium text-amber-900 dark:text-amber-200">{t('unsavedDraft.title')}</p>
              <p className="mt-0.5 text-amber-800/80 dark:text-amber-200/70">{t('unsavedDraft.description')}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                data-testid="restore-prep-draft"
                onClick={() => {
                  setPrepDraft((prev) => ({ ...(prev || {}), ...prepRecovery }));
                  // KEEP the stored copy: it is still unconfirmed until a save lands.
                  setPrepRecovery(null);
                }}
                className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-amber-700"
              >
                {t('unsavedDraft.restore')}
              </button>
              <button
                type="button"
                data-testid="discard-prep-draft"
                onClick={() => {
                  const rejected = prepRecovery;
                  setPrepRecovery(null);
                  if (user?.uid && sermon?.id && rejected) {
                    clearDraftIfMatches(
                      draftKey(user.uid, sermon.id, PREPARATION_DRAFT_AGGREGATE),
                      rejected
                    );
                  }
                }}
                className="rounded-lg border border-amber-400 px-3 py-1.5 font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-500/20"
              >
                {t('unsavedDraft.discard')}
              </button>
            </div>
          </div>
        )}
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

  // Wait only while an answer can still arrive on its own — see awaitingFirstAnswer.
  // The old test (`!sermon && !error`) also covered a PAUSED and a DISABLED query,
  // neither of which ever settles, which is how this page kept showing placeholders
  // forever and made the branch below it unreachable.
  if (loading || awaitingFirstAnswer) {
    return <SermonDetailSkeleton />;
  }

  if (!sermon) {
    return (
      <div className="py-8">
        <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 text-center">
          <h2 className="text-xl font-semibold mb-2">
            {isOnline ? t('sermon.notFound') : t('sermon.unavailableOffline')}
          </h2>
          <Link href="/dashboard" className="text-blue-600 dark:text-blue-400 hover:underline">
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
  const hasInconsistentThoughts = checkForInconsistentThoughtsHelper(sermon);

  return (
    <div className="space-y-4 sm:space-y-6 py-4 sm:py-8">
      {/* This SERMON changed elsewhere — distinct from the app-update toast. */}
      {(sermonFreshness.state === 'stale' || sermonFreshness.state === 'unknown') && !sermonFreshnessDismissed && (
        <DataFreshnessBanner
          entityKey="entitySermon"
          dirty={false}
          deleted={sermonFreshness.remotelyDeleted}
          unknown={sermonFreshness.state === 'unknown'}
          onRefresh={handleRefreshSermon}
          refreshing={isRefreshingSermon}
          onDismiss={() => setSermonFreshnessDismissed(true)}
        />
      )}
      <SermonHeader sermon={sermon} series={series} onUpdate={handleSermonUpdate} />
      <div className="lg:hidden">
        <StructureStats
          sermon={sermon!}
          tagCounts={tagCounts}
          totalThoughts={sermon?.thoughts?.length ?? 0}
          hasInconsistentThoughts={hasInconsistentThoughts}
          onOpenPlanEditor={!isReadOnly ? () => setIsPlanEditorOpen(true) : undefined}
        />
      </div>

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
          hideKeyboardShortcuts={uiMode === 'prep'}
          isReadOnly={!isMagicAvailable}
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
          <div className="basis-1/3 shrink-0">
            <div className={`grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8`}>
              <div className="order-2 lg:order-1 lg:col-span-2">
                {renderPrepContent()}
              </div>
              <div className="order-1 lg:order-2 space-y-6">
                {renderClassicContent({ withBrainstorm: false, portalRef: setPrepPortal })}
              </div>
            </div>
          </div>

          <div className="basis-1/3 shrink-0">
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
                    onOpenPlanEditor={!isReadOnly ? () => setIsPlanEditorOpen(true) : undefined}
                  />
                </div>
                <SermonOutline
                  key={outlineRefreshKey}
                  sermon={sermon!}
                  thoughtsPerSermonPoint={thoughtsPerSermonPoint}
                  onOutlineUpdate={handleOutlineUpdate}
                  onOutlinePointDeleted={handleOutlinePointDeleted}
                  onSubPointDeleted={handleSubPointDeleted}
                  isReadOnly={isReadOnly}
                />
                <KnowledgeSection sermon={sermon} updateSermon={handleSermonUpdate} />
                {sermon?.structure && userSettings?.enableStructurePreview && <StructurePreview sermon={sermon} />}
              </div>
            </div>
          </div>

          <div className="basis-1/3 shrink-0">
            {renderRawContent()}
          </div>
          </motion.div>
        </div>
      </div>
      {editingModalData && (
        <EditThoughtModal
          initialText={editingModalData.thought.text}
          initialTags={editingModalData.thought.tags}
          initialSermonPointId={editingModalData.thought.outlinePointId || undefined}
          initialSubPointId={editingModalData.thought.subPointId ?? undefined}
          allowedTags={allowedTags}
          sermonOutline={sermon?.outline}
          onSave={handleSaveEditedThought}
          onClose={() => setEditingModalData(null)}
          allowOffline={true}
        />
      )}
      <CreateThoughtModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreateThought={handleCreateManualThought}
        allowedTags={allowedTags}
        sermonOutline={sermon?.outline}
        disabled={isReadOnly}
      />
      {sermon && (
        <PlanEditorModal
          isOpen={isPlanEditorOpen}
          onClose={() => {
            setIsPlanEditorOpen(false);
            setOutlineRefreshKey((k) => k + 1);
          }}
          sermon={sermon}
          onOutlineUpdate={handleOutlineUpdate}
          onOutlinePointDeleted={handleOutlinePointDeleted}
          onSubPointDeleted={handleSubPointDeleted}
          onOutlinePointMoved={handleOutlinePointMoved}
          onSubPointMoved={handleSubPointMoved}
          isReadOnly={isReadOnly}
        />
      )}
    </div>
  );
}

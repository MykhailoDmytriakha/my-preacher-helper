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
import SermonHeader from "@/components/sermon/SermonHeader";
import SermonOutline from "@/components/sermon/SermonOutline";
import StructurePreview from "@/components/sermon/StructurePreview";
import StructureStats from "@/components/sermon/StructureStats";
import { SermonDetailSkeleton } from "@/components/skeletons/SermonDetailSkeleton";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useOptimisticEntitySync } from "@/hooks/useOptimisticEntitySync";
import { useSeries } from "@/hooks/useSeries";
import useSermon from "@/hooks/useSermon";
import { useTags } from "@/hooks/useTags";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useAuth } from "@/providers/AuthProvider";
import { updateSermonPreparation, updateSermon } from '@/services/sermon.service';
import { updateStructure } from "@/services/structure.service";
import { projectOptimisticEntities } from "@/utils/optimisticEntityProjection";
import CreateThoughtModal from "@components/CreateThoughtModal";
import EditThoughtModal from "@components/EditThoughtModal";
import { useThoughtFiltering } from '@hooks/useThoughtFiltering';
import { STRUCTURE_TAGS } from '@lib/constants';
import { createAudioThought, createManualThought, deleteThought, updateThought } from "@services/thought.service";
import { getCanonicalTagForSection, normalizeStructureTag } from '@utils/tagUtils';
import { UI_COLORS } from "@utils/themeColors";
import {
  findThoughtSectionInStructure,
  insertThoughtIdInStructure,
  removeThoughtIdFromStructure,
  replaceThoughtIdInStructure,
  resolveSectionForNewThought,
} from "@utils/thoughtOrdering";

import type { Sermon, Thought, SermonOutline as SermonOutlineType, Preparation, BrainstormSuggestion } from "@/models/models";
import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

const THOUGHT_SYNC_SUCCESS_MS = 3500;
const THOUGHT_LOCAL_ID_PREFIX = "local-thought-";

const sanitizeThoughtStructure = (structure: Sermon["structure"] | undefined) => {
  if (!structure) return structure;

  return {
    introduction: (structure.introduction ?? []).filter((id) => !id.startsWith(THOUGHT_LOCAL_ID_PREFIX)),
    main: (structure.main ?? []).filter((id) => !id.startsWith(THOUGHT_LOCAL_ID_PREFIX)),
    conclusion: (structure.conclusion ?? []).filter((id) => !id.startsWith(THOUGHT_LOCAL_ID_PREFIX)),
    ambiguous: (structure.ambiguous ?? []).filter((id) => !id.startsWith(THOUGHT_LOCAL_ID_PREFIX)),
  };
};

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

const checkForInconsistentThoughtsHelper = (sermon: Sermon | null): boolean => {
  if (!sermon || !sermon.thoughts || !sermon.outline) return false;

  return sermon.thoughts.some(thought => {
    const usedRequiredTags = thought.tags
      .map((tag) => normalizeStructureTag(tag))
      .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));
    if (usedRequiredTags.length > 1) {
      return true;
    }

    if (!thought.outlinePointId) return false;

    let outlinePointSection: string | undefined;

    if (sermon.outline!.introduction.some(p => p.id === thought.outlinePointId)) {
      outlinePointSection = 'introduction';
    } else if (sermon.outline!.main.some(p => p.id === thought.outlinePointId)) {
      outlinePointSection = 'main';
    } else if (sermon.outline!.conclusion.some(p => p.id === thought.outlinePointId)) {
      outlinePointSection = 'conclusion';
    }

    if (!outlinePointSection) return false;

    const expectedTag = getCanonicalTagForSection(outlinePointSection as 'introduction' | 'main' | 'conclusion');

    const hasExpectedTag = thought.tags.some(tag => normalizeStructureTag(tag) === expectedTag);

    const hasOtherSectionTags = ['intro', 'main', 'conclusion']
      .filter(tag => tag !== expectedTag)
      .some(tag => thought.tags.some(t => normalizeStructureTag(t) === tag));

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

  const searchParams = useSearchParams();
  const modeParam = searchParams?.get('mode');
  const [uiMode, setUiMode] = useState<'classic' | 'prep'>(() => getInitialUiMode(modeParam, id as string));

  const { t } = useTranslation();
  const { sermon, setSermon, loading, error } = useSermon(id);

  // Normalize thoughts if they are null (happens in some test scenarios/legacy data)
  if (sermon && sermon.thoughts === null) {
    sermon.thoughts = [];
  }

  const thoughtSync = useOptimisticEntitySync<Thought>({
    entityType: "thought",
    scopeId: sermon?.id ?? null,
    localIdPrefix: THOUGHT_LOCAL_ID_PREFIX,
  });
  const sermonRef = useRef<Sermon | null>(sermon);
  const retryThoughtActionsRef = useRef<Record<string, () => Promise<void>>>({});
  const thoughtSyncCleanupTimersRef = useRef<Record<string, number>>({});
  const [savingPrep, setSavingPrep] = useState(false);
  const [prepDraft, setPrepDraft] = useState<Preparation>({});
  const [classicPortal, setClassicPortal] = useState<HTMLDivElement | null>(null);
  const [prepPortal, setPrepPortal] = useState<HTMLDivElement | null>(null);

  const displayThoughts = useMemo(
    () =>
      projectOptimisticEntities<Thought>(sermon?.thoughts ?? [], thoughtSync.records, {
        createPlacement: "start",
      }),
    [sermon?.thoughts, thoughtSync.records]
  );

  const displaySermon = useMemo(
    () => (sermon ? { ...sermon, thoughts: displayThoughts } : null),
    [displayThoughts, sermon]
  );

  useEffect(() => {
    sermonRef.current = sermon;
  }, [sermon]);

  useEffect(() => {
    const mode = (modeParam === 'prep') ? 'prep' : 'classic';
    setUiMode(mode);

    if (typeof window !== 'undefined') {
      localStorage.setItem(`sermon-${id}-mode`, mode);
    }
  }, [modeParam, id]);

  useEffect(() => {
    return () => {
      Object.values(thoughtSyncCleanupTimersRef.current).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      thoughtSyncCleanupTimersRef.current = {};
      retryThoughtActionsRef.current = {};
    };
  }, []);

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

  const scheduleThoughtSyncCleanup = useCallback((localId: string, delayMs: number = THOUGHT_SYNC_SUCCESS_MS) => {
    const existingTimer = thoughtSyncCleanupTimersRef.current[localId];
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }

    thoughtSyncCleanupTimersRef.current[localId] = window.setTimeout(() => {
      thoughtSync.removeRecord(localId);
      delete thoughtSyncCleanupTimersRef.current[localId];
    }, delayMs);
  }, [thoughtSync]);

  const persistStructureForThoughts = useCallback(async (nextStructure: Sermon["structure"]) => {
    const currentSermon = sermonRef.current;
    const sanitizedStructure = sanitizeThoughtStructure(nextStructure);
    if (!currentSermon || !sanitizedStructure) return;

    try {
      await updateStructure(currentSermon.id, sanitizedStructure);
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
      ...(displaySermon?.thoughts ?? baseSermon.thoughts).filter((item) => item.id !== thought.id),
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
  }, [displaySermon?.thoughts]);

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
    initialThoughts: displaySermon?.thoughts ?? [],
    sermonStructure: displaySermon?.structure,
    sermonOutline: displaySermon?.outline
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
      await updateStructure(sermon.id, updatedStructure);
    } catch (error) {
      console.error("Failed to update structure after adding thought", error);
    }
  }, [sermon, setSermon]);

  const handleRetryThoughtSync = useCallback(async (thoughtId: string) => {
    const retryAction = retryThoughtActionsRef.current[thoughtId];
    if (!retryAction) return;
    await retryAction();
  }, []);

  const handleSaveThoughtPatch = useCallback(async (
    thoughtToUpdate: Thought,
    patch: Pick<Thought, "text" | "tags" | "outlinePointId">
  ) => {
    if (!sermon) return;

    const pendingCreateRecord = thoughtSync.records.find(
      (record) => record.operation === "create" && record.entityId === thoughtToUpdate.id
    );
    const optimisticThought: Thought = {
      ...thoughtToUpdate,
      ...patch,
    };
    const currentSection = findThoughtSectionInStructure(sermon.structure, thoughtToUpdate.id);
    const nextSection = resolveSectionForNewThought({
      sermon: displaySermon ?? sermon,
      outlinePointId: optimisticThought.outlinePointId ?? null,
      tags: optimisticThought.tags,
    });
    const structureWillChange = nextSection !== currentSection;
    const optimisticStructure = structureWillChange
      ? buildStructureWithThought({
          baseSermon: sermon,
          thought: optimisticThought,
          targetSection: nextSection,
        })
      : sermon.structure;

    if (pendingCreateRecord) {
      thoughtSync.replaceRecordEntity(pendingCreateRecord.localId, optimisticThought);
      thoughtSync.markRecordStatus(pendingCreateRecord.localId, "pending", {
        resetExpiry: true,
      });

      if (optimisticStructure) {
        setSermon((prevSermon) =>
          prevSermon
            ? {
                ...prevSermon,
                structure: optimisticStructure,
                thoughtsBySection: optimisticStructure,
              }
            : prevSermon
        );
      }

      const retryPendingCreate = retryThoughtActionsRef.current[thoughtToUpdate.id];
      if (retryPendingCreate) {
        void retryPendingCreate();
      }
      return;
    }

    const record = thoughtSync.createRecord({
      entityId: thoughtToUpdate.id,
      operation: "update",
      entity: optimisticThought,
      snapshot: thoughtToUpdate,
    });

    if (!record) return;

    if (optimisticStructure) {
      setSermon((prevSermon) =>
        prevSermon
          ? {
              ...prevSermon,
              structure: optimisticStructure,
              thoughtsBySection: optimisticStructure,
            }
          : prevSermon
      );
    }

    const executeUpdate = async () => {
      thoughtSync.markRecordStatus(record.localId, "sending", { resetExpiry: true });

      try {
        const savedThought = await updateThought(sermon.id, optimisticThought);
        const successAt = new Date().toISOString();

        thoughtSync.replaceRecordEntity(record.localId, savedThought);
        thoughtSync.markRecordStatus(record.localId, "success", { successAt });

        setSermon((prevSermon) => {
          if (!prevSermon) return prevSermon;
          return {
            ...prevSermon,
            thoughts: prevSermon.thoughts.map((thought) =>
              thought.id === savedThought.id ? savedThought : thought
            ),
            structure: prevSermon.structure,
            thoughtsBySection: prevSermon.thoughtsBySection,
          };
        });

        if (structureWillChange && sermonRef.current?.structure) {
          await persistStructureForThoughts(sermonRef.current.structure);
        }

        delete retryThoughtActionsRef.current[thoughtToUpdate.id];
        scheduleThoughtSyncCleanup(record.localId);
      } catch (updateError) {
        console.error("Failed to update thought", updateError);
        thoughtSync.markRecordStatus(record.localId, "error", {
          error: t("errors.thoughtUpdateError"),
        });
      }
    };

    retryThoughtActionsRef.current[thoughtToUpdate.id] = executeUpdate;
    void executeUpdate();
  }, [buildStructureWithThought, displaySermon, persistStructureForThoughts, scheduleThoughtSyncCleanup, sermon, setSermon, t, thoughtSync]);

  const handleCreateManualThought = useCallback(async (draftThought: Omit<Thought, "id">) => {
    if (!sermon) return;

    const tempThoughtId = thoughtSync.buildLocalId();
    const optimisticThought: Thought = {
      ...draftThought,
      id: tempThoughtId,
    };
    const targetSection = resolveSectionForNewThought({
      sermon: displaySermon ?? sermon,
      outlinePointId: optimisticThought.outlinePointId ?? null,
      tags: optimisticThought.tags,
    });
    const optimisticStructure = buildStructureWithThought({
      baseSermon: sermon,
      thought: optimisticThought,
      targetSection,
    });

    const record = thoughtSync.createRecord({
      entityId: tempThoughtId,
      operation: "create",
      entity: optimisticThought,
    });

    if (!record) return;

    setSermon((prevSermon) =>
      prevSermon
        ? {
            ...prevSermon,
            structure: optimisticStructure,
            thoughtsBySection: optimisticStructure,
          }
        : prevSermon
    );

    const executeCreate = async () => {
      thoughtSync.markRecordStatus(record.localId, "sending", { resetExpiry: true });

      try {
        const latestRecord = thoughtSync.getRecordByLocalId(record.localId);
        const latestThought = latestRecord?.entity ?? optimisticThought;
        const savedThought = await createManualThought(sermon.id, {
          ...latestThought,
          id: tempThoughtId,
        });
        const successAt = new Date().toISOString();
        const latestStructure = replaceThoughtIdInStructure({
          structure: sermonRef.current?.structure ?? optimisticStructure,
          fromThoughtId: tempThoughtId,
          toThoughtId: savedThought.id,
        });

        thoughtSync.replaceRecordEntity(record.localId, savedThought, {
          entityId: savedThought.id,
        });
        thoughtSync.markRecordStatus(record.localId, "success", { successAt });

        setSermon((prevSermon) => {
          if (!prevSermon) return prevSermon;
          const nextStructure = replaceThoughtIdInStructure({
            structure: prevSermon.structure,
            fromThoughtId: tempThoughtId,
            toThoughtId: savedThought.id,
          });

          return {
            ...prevSermon,
            thoughts: [savedThought, ...prevSermon.thoughts.filter((thought) => thought.id !== savedThought.id)],
            structure: nextStructure,
            thoughtsBySection: nextStructure,
          };
        });

        await persistStructureForThoughts(latestStructure);

        delete retryThoughtActionsRef.current[tempThoughtId];
        scheduleThoughtSyncCleanup(record.localId);
      } catch (createError) {
        console.error("Failed to create thought", createError);
        thoughtSync.markRecordStatus(record.localId, "error", {
          error: t("errors.addThoughtError"),
        });
      }
    };

    retryThoughtActionsRef.current[tempThoughtId] = executeCreate;
    void executeCreate();
  }, [buildStructureWithThought, displaySermon, persistStructureForThoughts, scheduleThoughtSyncCleanup, sermon, setSermon, t, thoughtSync]);

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

  const handleThoughtOutlinePointChange = useCallback(async (thought: Thought, outlinePointId?: string) => {
    await handleSaveThoughtPatch(thought, {
      text: thought.text,
      tags: thought.tags,
      outlinePointId,
    });
  }, [handleSaveThoughtPatch]);

  const handleDeleteThought = useCallback(async (thoughtId: string) => {
    if (!sermon) return;

    const pendingCreateRecord = thoughtSync.records.find(
      (record) => record.operation === "create" && record.entityId === thoughtId
    );
    if (pendingCreateRecord) {
      thoughtSync.removeRecord(pendingCreateRecord.localId);
      delete retryThoughtActionsRef.current[thoughtId];
      setSermon((prevSermon) => {
        if (!prevSermon) return prevSermon;
        const nextStructure = removeThoughtIdFromStructure(prevSermon.structure, thoughtId);
        return {
          ...prevSermon,
          structure: nextStructure,
          thoughtsBySection: nextStructure,
        };
      });
      return;
    }

    const thoughtToDelete = (displaySermon ?? sermon).thoughts.find((thought) => thought.id === thoughtId);
    if (!thoughtToDelete) {
      console.error("Could not find thought with ID:", thoughtId);
      return;
    }

    const record = thoughtSync.createRecord({
      entityId: thoughtId,
      operation: "delete",
      entity: thoughtToDelete,
      snapshot: thoughtToDelete,
    });

    if (!record) return;

    const executeDelete = async () => {
      thoughtSync.markRecordStatus(record.localId, "sending", { resetExpiry: true });

      try {
        await deleteThought(sermon.id, thoughtToDelete);
        const nextStructure = removeThoughtIdFromStructure(
          sermonRef.current?.structure ?? sermon.structure,
          thoughtId
        );

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

        await persistStructureForThoughts(nextStructure);

        thoughtSync.removeRecord(record.localId);
        delete retryThoughtActionsRef.current[thoughtId];
      } catch (deleteError) {
        console.error("Failed to delete thought", deleteError);
        thoughtSync.markRecordStatus(record.localId, "error", {
          error: t("errors.deletingError"),
        });
      }
    };

    retryThoughtActionsRef.current[thoughtId] = executeDelete;
    void executeDelete();
  }, [displaySermon, persistStructureForThoughts, sermon, setSermon, t, thoughtSync]);

  const handleSaveEditedThought = async (updatedText: string, updatedTags: string[], outlinePointId?: string) => {
    if (!editingModalData) return;
    const currentSermon = displaySermon ?? sermon;
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

    await handleSaveThoughtPatch(thoughtToUpdate, {
      text: updatedText.trim(),
      tags: updatedTags,
      outlinePointId,
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

  const handleOutlineUpdate = (updatedOutline: SermonOutlineType) => {
    setSermon(prevSermon => {
      if (!prevSermon) return null;
      return {
        ...prevSermon,
        outline: updatedOutline,
      };
    });
  };

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
      totalThoughts={displaySermon?.thoughts?.length ?? 0}
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
      sermonOutline={displaySermon?.outline}
      onDelete={handleDeleteThought}
      onEditStart={handleEditThoughtStart}
      onThoughtUpdate={handleThoughtUpdate}
      onThoughtOutlinePointChange={handleThoughtOutlinePointChange}
      syncStatesById={thoughtSync.syncStateById}
      onRetrySync={handleRetryThoughtSync}
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
            const updated = await updateSermon({ ...sermon, verse: nextVerse });
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

  if (loading || (!sermon && !error)) {
    return <SermonDetailSkeleton />;
  }

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

  const thoughtsPerSermonPoint = calculateThoughtsPerSermonPoint(displaySermon);
  const tagCounts = {
    [STRUCTURE_TAGS.INTRODUCTION]: (displaySermon?.thoughts ?? []).reduce((c, t) => c + (t.tags.some(tag => normalizeStructureTag(tag) === 'intro') ? 1 : 0), 0),
    [STRUCTURE_TAGS.MAIN_BODY]: (displaySermon?.thoughts ?? []).reduce((c, t) => c + (t.tags.some(tag => normalizeStructureTag(tag) === 'main') ? 1 : 0), 0),
    [STRUCTURE_TAGS.CONCLUSION]: (displaySermon?.thoughts ?? []).reduce((c, t) => c + (t.tags.some(tag => normalizeStructureTag(tag) === 'conclusion') ? 1 : 0), 0),
  };
  const hasInconsistentThoughts = checkForInconsistentThoughtsHelper(displaySermon);

  return (
    <div className="space-y-4 sm:space-y-6 py-4 sm:py-8">
      <SermonHeader sermon={sermon} series={series} onUpdate={handleSermonUpdate} />
      <div className="lg:hidden">
        <StructureStats
          sermon={displaySermon!}
          tagCounts={tagCounts}
          totalThoughts={displaySermon?.thoughts?.length ?? 0}
          hasInconsistentThoughts={hasInconsistentThoughts}
        />
      </div>

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

      <div className="relative overflow-hidden">
        <motion.div
          className="flex"
          initial={false}
          animate={{ x: uiMode === 'prep' ? '0%' : 'calc(-50% - 1px)' }}
          transition={{ type: 'spring', stiffness: 220, damping: 26, mass: 0.9 }}
          style={{ width: '200%', willChange: 'transform' }}
        >
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

          <div className="basis-1/2 shrink-0">
            <div className={`grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-8 pl-px`}>
              <div className="order-2 lg:order-1 lg:col-span-2">
                {renderClassicContent({ portalRef: setClassicPortal })}
              </div>
              <div className="order-1 lg:order-2 space-y-6">
                <div className="hidden lg:block">
                  <StructureStats
                    sermon={displaySermon!}
                    tagCounts={tagCounts}
                    totalThoughts={displaySermon?.thoughts?.length ?? 0}
                    hasInconsistentThoughts={hasInconsistentThoughts}
                  />
                </div>
                <SermonOutline
                  sermon={displaySermon!}
                  thoughtsPerSermonPoint={thoughtsPerSermonPoint}
                  onOutlineUpdate={handleOutlineUpdate}
                  isReadOnly={isReadOnly}
                />
                <KnowledgeSection sermon={sermon} updateSermon={handleSermonUpdate} />
                {displaySermon?.structure && userSettings?.enableStructurePreview && <StructurePreview sermon={displaySermon} />}
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
          sermonOutline={displaySermon?.outline}
          onSave={handleSaveEditedThought}
          onClose={() => setEditingModalData(null)}
        />
      )}
      <CreateThoughtModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreateThought={handleCreateManualThought}
        allowedTags={allowedTags}
        sermonOutline={displaySermon?.outline}
        disabled={isReadOnly}
      />
    </div>
  );
}

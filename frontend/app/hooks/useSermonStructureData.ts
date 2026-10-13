import { useQueryClient } from '@tanstack/react-query';
import { TFunction } from 'i18next'; // Import TFunction from i18next
import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';

import { Item, Sermon, SermonPoint, Tag, Thought, ThoughtsBySection } from '@/models/models';
import { getTags } from '@/services/tag.service';
import { getConnectivityStatus } from '@/utils/connectivity';
// ONE definition of "has the server proved its copy is newer" for the whole app: this
// hook used to carry a byte-identical private copy, and two copies of a rule that
// decides whether someone's unsaved words may be discarded is one copy too many.
import { readWithDeadline } from '@/utils/readWithDeadline';
import { normalizeStructureTag } from '@/utils/tagUtils';
import { canonicalizeStructure } from '@/utils/thoughtOrdering';
import { getSectionBaseColor } from '@lib/sections';


// Helper: Fetch and process tags
async function fetchTagsData(
  fetchedSermon: Sermon,
  queryClient: ReturnType<typeof useQueryClient>,
  t: TFunction
): Promise<{
  requiredTags: Tag[];
  customTags: Tag[];
  allTags: Record<string, { name: string; color?: string }>;
}> {
  let tagsData: { requiredTags: Tag[]; customTags: Tag[] };
  const tagsQueryKey = ['tags', fetchedSermon.userId];

  try {
    const cachedTags = queryClient.getQueryData<{ requiredTags: Tag[]; customTags: Tag[] }>(tagsQueryKey);
    if (cachedTags) {
      tagsData = cachedTags;
    } else if (getConnectivityStatus()) {
      tagsData = await readWithDeadline(getTags(fetchedSermon.userId), 3000);
      queryClient.setQueryData(tagsQueryKey, tagsData);
    } else {
      tagsData = { requiredTags: [], customTags: [] };
    }
  } catch (tagError) {
    console.error("Error fetching tags:", tagError);
    tagsData = { requiredTags: [], customTags: [] };
    toast.error(t('errors.fetchTagsError'));
  }

  const allTags: Record<string, { name: string; color?: string }> = {};
  (tagsData.requiredTags || []).forEach((tag: Tag) => {
    const normalizedName = tag.name.trim().toLowerCase();
    allTags[normalizedName] = { name: tag.name, color: tag.color };
  });
  (tagsData.customTags || []).forEach((tag: Tag) => {
    const normalizedName = tag.name.trim().toLowerCase();
    if (!allTags[normalizedName]) {
      allTags[normalizedName] = { name: tag.name, color: tag.color };
    }
  });

  return { ...tagsData, allTags };
}

// Helper: Process thoughts into items
function processThoughtsIntoItems(
  fetchedSermon: Sermon,
  allTags: Record<string, { name: string; color?: string }>
): Record<string, Item> {
  const allThoughtItems: Record<string, Item> = {};

  (fetchedSermon.thoughts || []).forEach((thought: Thought) => {
    const stableId = thought.id;
    const rawTags = Array.isArray(thought.tags) ? thought.tags.filter(Boolean) : [];

    const customTagNames = rawTags.filter((tag: string) => normalizeStructureTag(tag) === null);

    const enrichedCustomTags = customTagNames.map((tagName: string) => {
      const normalizedName = tagName.trim().toLowerCase();
      const tagInfo = allTags[normalizedName];
      const color = tagInfo?.color || "#4c51bf";
      return {
        name: tagInfo?.name || tagName,
        color: color,
      };
    });

    const uniqueRequiredTags: string[] = [];

    let outlinePointData;
    if (thought.outlinePointId && fetchedSermon.outline) {
      const outlineSections = ['introduction', 'main', 'conclusion'] as const;
      for (const section of outlineSections) {
        const point = fetchedSermon.outline[section]?.find((p: SermonPoint) => p.id === thought.outlinePointId);
        if (point) {
          outlinePointData = {
            text: point.text,
            section: ''
          };
          break;
        }
      }
    }

    const item: Item = {
      id: stableId,
      content: thought.text,
      customTagNames: enrichedCustomTags,
      requiredTags: uniqueRequiredTags,
      outlinePoint: outlinePointData,
      outlinePointId: thought.outlinePointId,
      subPointId: thought.subPointId,
      position: (thought as { position?: number }).position,
      isLocked: Boolean(thought.isLocked),
    };

    allThoughtItems[stableId] = item;
  });

  return allThoughtItems;
}

// Helper: Build containers from canonical structure order
function buildContainersFromCanonicalStructure(
  canonicalStructure: ThoughtsBySection,
  allThoughtItems: Record<string, Item>
): {
  intro: Item[];
  main: Item[];
  concl: Item[];
  ambiguous: Item[];
} {
  const buildSectionItems = (ids: string[]): Item[] => {
    const items = ids
      .map((id) => allThoughtItems[id])
      .filter(Boolean) as Item[];

    return items.map((item) => ({
      ...item,
      requiredTags: [],
    }));
  };

  return {
    intro: buildSectionItems(canonicalStructure.introduction),
    main: buildSectionItems(canonicalStructure.main),
    concl: buildSectionItems(canonicalStructure.conclusion),
    ambiguous: buildSectionItems(canonicalStructure.ambiguous ?? []),
  };
}

// Helper: Seed positions for items
function seedPositions(items: Item[]): Item[] {
  const anyPos = items.some(i => typeof i.position === 'number');
  if (!anyPos) {
    const base = 1000;
    return items.map((it, idx) => ({ ...it, position: base * (idx + 1) }));
  }
  let cursor = 1000;
  return items.map((it) => {
    if (typeof it.position === 'number') return it;
    cursor += 1000;
    return { ...it, position: cursor };
  });
}


/**
 * The engine's copy of the sermon, for a structure screen rendered on the engine. The board is
 * rebuilt from it on every change, so another device's move appears without a reload; while
 * the person is dragging or reviewing an AI proposal the rebuild waits (`isHolding`) and runs
 * when `syncFromEngine` is called, because repainting the board would pull cards from under them.
 */
export interface StructureEngineSource {
  sermon: Sermon | null;
  loading: boolean;
  error: string | null;
  isHolding: () => boolean;
  /** Asks the document again — the error screen's retry. */
  retry: () => void;
}

function buildBoard(sermon: Sermon, allTags: Record<string, { name: string; color?: string }>) {
  const allThoughtItems = processThoughtsIntoItems(sermon, allTags);
  const canonicalStructure = canonicalizeStructure({
    thoughts: sermon.thoughts ?? [],
    structure: sermon.structure ?? sermon.thoughtsBySection,
    outline: sermon.outline,
  });
  const { intro, main, concl, ambiguous } = buildContainersFromCanonicalStructure(canonicalStructure, allThoughtItems);
  return {
    containers: { introduction: seedPositions(intro), main: seedPositions(main), conclusion: seedPositions(concl), ambiguous: seedPositions(ambiguous) },
    outlinePoints: { introduction: sermon.outline?.introduction || [], main: sermon.outline?.main || [], conclusion: sermon.outline?.conclusion || [] },
    allowedTags: Object.values(allTags).filter(tag => normalizeStructureTag(tag.name) === null)
      .map(tag => ({ name: tag.name, color: tag.color || "#808080" })),
    hasAmbiguous: ambiguous.length > 0,
  };
}

export function useSermonStructureData(t: TFunction, engine: StructureEngineSource) {
  const queryClient = useQueryClient();
  const [sermon, setSermonState] = useState<Sermon | null>(null);
  const [containers, setContainers] = useState<Record<string, Item[]>>({
    introduction: [],
    main: [],
    conclusion: [],
    ambiguous: [],
  });
  const [outlinePoints, setSermonPoints] = useState<{
    introduction: SermonPoint[];
    main: SermonPoint[];
    conclusion: SermonPoint[];
  }>({
    introduction: [],
    main: [],
    conclusion: [],
  });
  const [loading, setLoading] = useState(true);
  const [requiredTagColors, setRequiredTagColors] = useState<{
    introduction?: string;
    main?: string;
    conclusion?: string;
  }>({});
  const [allowedTags, setAllowedTags] = useState<{ name: string; color: string }[]>([]);
  const [isAmbiguousVisible, setIsAmbiguousVisible] = useState(true);

  // The document is the only store; this copy is the screen's projection of it.
  const setSermon = useCallback(async (updater: React.SetStateAction<Sermon | null>) => {
    setSermonState(updater);
  }, []);

  const engineSermon = engine.sermon;
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const engineTagsRef = useRef<{ owner: string; tags: Record<string, { name: string; color?: string }> } | null>(null);
  const engineBoardPendingRef = useRef(false);
  const engineBuiltRef = useRef(false);
  const applyEngineSermon = useCallback((next: Sermon, allTags: Record<string, { name: string; color?: string }>) => {
    const board = buildBoard(next, allTags);
    setSermonState(next);
    setSermonPoints(board.outlinePoints);
    setContainers(board.containers);
    setAllowedTags(board.allowedTags);
    setRequiredTagColors({
      introduction: getSectionBaseColor('introduction'),
      main: getSectionBaseColor('main'),
      conclusion: getSectionBaseColor('conclusion'),
    });
    if (!engineBuiltRef.current) setIsAmbiguousVisible(board.hasAmbiguous);
    engineBuiltRef.current = true;
    engineBoardPendingRef.current = false;
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!engineSermon) {
      setLoading(Boolean(engineRef.current.loading));
      return;
    }
    let active = true;
    const cached = engineTagsRef.current?.owner === engineSermon.userId ? engineTagsRef.current.tags : null;
    const build = (tags: Record<string, { name: string; color?: string }>) => {
      if (!active) return;
      if (engineRef.current.isHolding()) { engineBoardPendingRef.current = true; return; }
      applyEngineSermon(engineSermon, tags);
    };
    if (cached) build(cached);
    else void fetchTagsData(engineSermon, queryClient, t).then(({ allTags }) => {
      engineTagsRef.current = { owner: engineSermon.userId, tags: allTags };
      build(allTags);
    });
    return () => { active = false; };
  }, [engineSermon, applyEngineSermon, queryClient, t]);

  /** Runs a rebuild that waited for a drag or an AI review to end. */
  const syncFromEngine = useCallback(() => {
    const current = engineRef.current.sermon;
    const tags = engineTagsRef.current;
    if (!engineBoardPendingRef.current || !current || !tags || engineRef.current.isHolding()) return;
    applyEngineSermon(current, tags.tags);
  }, [applyEngineSermon]);

  // Sync outlinePoints state with sermon.outline when it changes
  useEffect(() => {
    const outlineData = sermon?.outline;
    if (outlineData) {
      setSermonPoints({
        introduction: outlineData.introduction || [],
        main: outlineData.main || [],
        conclusion: outlineData.conclusion || [],
      });
    }
  }, [sermon?.outline]);

  return {
    sermon,
    setSermon,
    containers,
    setContainers,
    outlinePoints,
    requiredTagColors,
    allowedTags,
    loading,
    // Read live from the document hook, which says it in the language on screen.
    error: engineSermon ? null : engine.error,
    retry: engine.retry,
    setLoading,
    isAmbiguousVisible,
    setIsAmbiguousVisible,
    syncFromEngine,
  };
}

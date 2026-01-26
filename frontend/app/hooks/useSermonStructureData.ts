import { useQueryClient } from '@tanstack/react-query';
import { TFunction } from 'i18next'; // Import TFunction from i18next
import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { Item, Sermon, SermonOutline, SermonPoint, Tag, Thought, ThoughtsBySection } from '@/models/models';
import { getSermonOutline } from '@/services/outline.service';
import { getSermonById } from '@/services/sermon.service';
import { getTags } from '@/services/tag.service';
import { CANONICAL_TO_SECTION, getCanonicalTagForSection, normalizeStructureTag } from '@/utils/tagUtils';
import { getSectionBaseColor } from '@lib/sections';

// Helper: Fetch sermon data
async function fetchSermonData(
  sermonId: string,
  queryClient: ReturnType<typeof useQueryClient>,
  isOnlineResolved: boolean
): Promise<Sermon | null> {
  if (isOnlineResolved) {
    const fetched = await getSermonById(sermonId);
    queryClient.setQueryData(["sermon", sermonId], fetched ?? undefined);
    return fetched ?? null;
  }

  const cachedSermon = queryClient.getQueryData<Sermon>(["sermon", sermonId]);
  return cachedSermon ?? null;
}

// Helper: Fetch and process tags
async function fetchTagsData(
  fetchedSermon: Sermon,
  queryClient: ReturnType<typeof useQueryClient>,
  isOnlineResolved: boolean,
  t: TFunction
): Promise<{
  requiredTags: Tag[];
  customTags: Tag[];
  allTags: Record<string, { name: string; color?: string }>;
}> {
  let tagsData: { requiredTags: Tag[]; customTags: Tag[] };
  const tagsQueryKey = ['tags', fetchedSermon.userId];

  try {
    if (!isOnlineResolved) {
      tagsData = queryClient.getQueryData(tagsQueryKey) ?? { requiredTags: [], customTags: [] };
    } else {
      tagsData = await getTags(fetchedSermon.userId);
      queryClient.setQueryData(tagsQueryKey, tagsData);
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

    const relevantTags = rawTags
      .map((tag) => normalizeStructureTag(tag))
      .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));
    const uniqueRequiredTags = Array.from(new Set(relevantTags));

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
      position: (thought as { position?: number }).position
    };

    allThoughtItems[stableId] = item;
  });

  return allThoughtItems;
}

// Helper: Distribute items to sections
function distributeItemsToSections(
  allThoughtItems: Record<string, Item>,
  structure: ThoughtsBySection | string | undefined
): {
  intro: Item[];
  main: Item[];
  concl: Item[];
  ambiguous: Item[];
} {
  const intro: Item[] = [];
  const main: Item[] = [];
  const concl: Item[] = [];
  const ambiguous: Item[] = [];
  const usedIds = new Set<string>();

  // Step 1: Process structure if it exists
  if (structure) {
    const structureObj = typeof structure === "string"
      ? JSON.parse(structure)
      : structure;

    if (structureObj && typeof structureObj === 'object') {
      ["introduction", "main", "conclusion"].forEach((section) => {
        if (Array.isArray(structureObj[section])) {
          const target = section === "introduction" ? intro : section === "main" ? main : concl;
          const sectionTag = getCanonicalTagForSection(section as 'introduction' | 'main' | 'conclusion');
          const seen = new Set<string>();
          const orderedUniqueIds = structureObj[section].filter((id: string) => {
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          });

          const itemsForSection = orderedUniqueIds
            .map((thoughtId: string) => allThoughtItems[thoughtId])
            .filter(Boolean) as Item[];

          const withSectionTag = itemsForSection.map((it) => ({
            ...it,
            requiredTags: it.requiredTags?.includes(sectionTag)
              ? it.requiredTags
              : [...(it.requiredTags || []), sectionTag]
          }));

          for (const item of withSectionTag) {
            target.push(item);
            usedIds.add(item.id);
          }
        }
      });
    }
  }

  // Step 2: Add remaining thoughts
  Object.values(allThoughtItems).forEach(item => {
    if (!usedIds.has(item.id)) {
      const itemRequiredTags = item.requiredTags || [];
      let placed = false;
      if (itemRequiredTags.length === 1) {
        const canonical = normalizeStructureTag(itemRequiredTags[0]);
        if (canonical) {
          const section = CANONICAL_TO_SECTION[canonical];
          if (section === 'introduction') {
            intro.push(item);
            placed = true;
          } else if (section === 'main') {
            main.push(item);
            placed = true;
          } else if (section === 'conclusion') {
            concl.push(item);
            placed = true;
          }
        }
      }

      if (!placed) {
        item.requiredTags = [];
        ambiguous.push(item);
      }
    }
  });

  return { intro, main, concl, ambiguous };
}

// Helper: Fetch outline data
async function fetchOutlineData(
  sermonId: string,
  fetchedSermon: Sermon,
  queryClient: ReturnType<typeof useQueryClient>,
  isOnlineResolved: boolean,
  t: TFunction
): Promise<SermonOutline | undefined> {
  let outlineData: SermonOutline | undefined;

  if (isOnlineResolved) {
    try {
      outlineData = await getSermonOutline(sermonId);
      queryClient.setQueryData(["sermon-outline", sermonId], outlineData ?? undefined);
    } catch (outlineError) {
      console.error("Error fetching sermon outline:", outlineError);
      toast.error(t('errors.fetchOutlineError'));
      outlineData = undefined;
    }
  } else {
    outlineData = queryClient.getQueryData<SermonOutline>(["sermon-outline", sermonId]);
  }

  return outlineData ?? fetchedSermon.outline;
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


export function useSermonStructureData(sermonId: string | null | undefined, t: TFunction) {
  const isOnline = useOnlineStatus();
  const isOnlineResolved = typeof isOnline === 'boolean' ? isOnline : true;
  const queryClient = useQueryClient();
  const [sermon, setSermonState] = useState<Sermon | null>(null);
  const lastSermonIdRef = useRef<string | null>(null);
  const hasLoadedRef = useRef(false);
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
  const [error, setError] = useState<string | null>(null);
  const [requiredTagColors, setRequiredTagColors] = useState<{
    introduction?: string;
    main?: string;
    conclusion?: string;
  }>({});
  const [allowedTags, setAllowedTags] = useState<{ name: string; color: string }[]>([]);
  const [isAmbiguousVisible, setIsAmbiguousVisible] = useState(true); // Added state from component

  const setSermon = useCallback((updater: React.SetStateAction<Sermon | null>) => {
    setSermonState((prev) => {
      const next = updater instanceof Function ? updater(prev) : updater;
      if (sermonId) {
        // Update in-memory cache for immediate UI feedback
        queryClient.setQueryData(["sermon", sermonId], next ?? undefined);
        // Invalidate to ensure persisted cache syncs with fresh server data
        queryClient.invalidateQueries({ queryKey: ["sermon", sermonId] });
      }
      return next;
    });
  }, [queryClient, sermonId]);

  useEffect(() => {
    async function initializeSermon() {
      if (!sermonId) {
        setLoading(false);
        setError(null);
        setSermon(null);
        setContainers({ introduction: [], main: [], conclusion: [], ambiguous: [] });
        return;
      }

      const isNewSermon = lastSermonIdRef.current !== sermonId;
      const isInitialLoad = !hasLoadedRef.current || isNewSermon;
      if (isInitialLoad) {
        setLoading(true);
      }
      setError(null);

      try {
        // Fetch sermon
        const fetchedSermon = await fetchSermonData(sermonId, queryClient, isOnlineResolved);
        if (!fetchedSermon) {
          setSermon(null);
          setContainers({ introduction: [], main: [], conclusion: [], ambiguous: [] });
          setSermonPoints({ introduction: [], main: [], conclusion: [] });
          setAllowedTags([]);
          setRequiredTagColors({});
          setLoading(false);
          return;
        }
        setSermon(fetchedSermon);

        // Fetch and process tags
        const { allTags, requiredTags: _requiredTags, customTags: _customTags } = await fetchTagsData(
          fetchedSermon,
          queryClient,
          isOnlineResolved,
          t
        );

        setRequiredTagColors({
          introduction: getSectionBaseColor('introduction'),
          main: getSectionBaseColor('main'),
          conclusion: getSectionBaseColor('conclusion'),
        });

        const filteredAllowedTags = Object.values(allTags)
          .filter(
            (tag) =>
              normalizeStructureTag(tag.name) === null
          )
          .map(tag => ({
            name: tag.name,
            color: tag.color || "#808080"
          }));
        setAllowedTags(filteredAllowedTags);

        // Process thoughts into items
        const allThoughtItems = processThoughtsIntoItems(fetchedSermon, allTags);

        // Distribute items to sections
        const { intro, main, concl, ambiguous } = distributeItemsToSections(
          allThoughtItems,
          fetchedSermon.structure
        );

        // Fetch outline
        const outlineData = await fetchOutlineData(
          sermonId,
          fetchedSermon,
          queryClient,
          isOnlineResolved,
          t
        );

        if (outlineData) {
          setSermonPoints({
            introduction: outlineData.introduction || [],
            main: outlineData.main || [],
            conclusion: outlineData.conclusion || [],
          });
        } else {
          setSermonPoints({ introduction: [], main: [], conclusion: [] });
        }

        const finalContainers = {
          introduction: seedPositions(intro),
          main: seedPositions(main),
          conclusion: seedPositions(concl),
          ambiguous: seedPositions(ambiguous),
        };

        setContainers(finalContainers);
        setIsAmbiguousVisible(ambiguous.length > 0);
        hasLoadedRef.current = true;
        lastSermonIdRef.current = sermonId;

      } catch (err) {
        console.error("Error initializing sermon data:", err);
        const errorMessage = err instanceof Error ? err.message : t('errors.fetchSermonStructureError');
        setError(errorMessage);
        toast.error(errorMessage);
        // Reset state on error
        setSermon(null);
        setContainers({ introduction: [], main: [], conclusion: [], ambiguous: [] });
        setSermonPoints({ introduction: [], main: [], conclusion: [] });
        setAllowedTags([]);
        setRequiredTagColors({});
      } finally {
        setLoading(false);
      }
    }

    initializeSermon();
  }, [sermonId, t, isOnlineResolved, queryClient, setSermon]);

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
    error,
    setLoading,
    isAmbiguousVisible,
    setIsAmbiguousVisible
  };
} 

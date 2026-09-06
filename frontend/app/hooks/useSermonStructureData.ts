import { useQueryClient } from '@tanstack/react-query';
import { TFunction } from 'i18next'; // Import TFunction from i18next
import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { Item, Sermon, SermonPoint, Tag, Thought, ThoughtsBySection } from '@/models/models';
import { getSermonById } from '@/services/sermon.service';
import { getTags } from '@/services/tag.service';
import { recordDiagnostic } from '@/utils/appDiagnostics';
import { resolveOwnerUid, sermonDetailKey } from '@/utils/queryKeys';
// ONE definition of "has the server proved its copy is newer" for the whole app: this
// hook used to carry a byte-identical private copy, and two copies of a rule that
// decides whether someone's unsaved words may be discarded is one copy too many.
import { selectReadableCopy, serverCopyIsNewer } from '@/utils/readFreshness';
import { readWithDeadline } from '@/utils/readWithDeadline';
import { normalizeStructureTag } from '@/utils/tagUtils';
import { canonicalizeStructure } from '@/utils/thoughtOrdering';
import { getSectionBaseColor } from '@lib/sections';


const STRUCTURE_LOAD_EVENT = 'structure-load';

/**
 * Fetch the sermon, and decide which copy the screen should show.
 *
 * Reading the stored copy and returning it was the whole of this function, so the
 * server was never consulted at all: a full page reload still rendered whatever
 * this browser happened to hold, for up to a week. Observed live on production
 * 2026-08-11 — a plan point deleted a day earlier was still on screen after a
 * reload, while the document had not held it since.
 */
async function fetchSermonData(
  sermonId: string,
  queryClient: ReturnType<typeof useQueryClient>,
  isOnlineResolved: boolean
): Promise<{ sermon: Sermon | null }> {
  /**
   * The owner is fixed HERE, when the work starts, and not read again when it
   * finishes. Sign-out and sign-in can happen while a fetch is in flight, and
   * resolving the uid at completion time would file the FIRST account's sermon
   * under the SECOND account's cache key — putting one person's sermon inside
   * another person's cache, which is the leak this key exists to prevent.
   */
  const startedAsUid = resolveOwnerUid();
  const key = sermonDetailKey(startedAsUid, sermonId);
  const stored = queryClient.getQueryData<Sermon>(key) ?? null;

  // Without a connection the stored copy is not a stale second-best, it is the only
  // thing there is — and it is why this sermon opens at all on a phone in a hall.
  if (!isOnlineResolved) return { sermon: stored };

  let fetched: Sermon | null;
  try {
    fetched = (await readWithDeadline(getSermonById(sermonId), stored ? 4000 : 13000)) ?? null;
  } catch (error) {
    // A refused or dropped request must never blank a sermon the preacher can
    // already see. Losing the screen is worse than showing a copy a few minutes old.
    if (resolveOwnerUid() !== startedAsUid) return { sermon: null };
    const currentStored = queryClient.getQueryData<Sermon>(key) ?? stored;
    if (currentStored) return { sermon: currentStored };
    throw error;
  }

  // The account may have changed while this was in flight. Returning the sermon
  // anyway is not enough: the caller feeds it straight into `setSermon`, which
  // pins the owner AGAIN — now the new one — and files the first account's sermon
  // under the second account's key, then builds the visible columns from it. A
  // late answer for a signed-out account is dropped entirely.
  if (resolveOwnerUid() !== startedAsUid) return { sermon: null };

  const currentStored = queryClient.getQueryData<Sermon>(key) ?? stored;
  if (!fetched) return { sermon: currentStored };
  if (currentStored && !serverCopyIsNewer(fetched, currentStored)) {
    return { sermon: currentStored };
  }

  queryClient.setQueryData(key, fetched);
  return { sermon: fetched };
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
    const cachedTags = queryClient.getQueryData<{ requiredTags: Tag[]; customTags: Tag[] }>(tagsQueryKey);
    if (cachedTags) {
      tagsData = cachedTags;
    } else if (isOnlineResolved) {
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


export function useSermonStructureData(sermonId: string | null | undefined, t: TFunction) {
  const isOnline = useOnlineStatus();
  const isOnlineResolved = typeof isOnline === 'boolean' ? isOnline : true;
  const queryClient = useQueryClient();
  const [sermon, setSermonState] = useState<Sermon | null>(null);
  const lastSermonIdRef = useRef<string | null>(null);
  const hasLoadedRef = useRef(false);
  const loadGenerationRef = useRef(0);
  const [retryCount, setRetryCount] = useState(0);
  const retry = useCallback(() => setRetryCount(count => count + 1), []);
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

  const setSermon = useCallback(async (updater: React.SetStateAction<Sermon | null>) => {
    if (!sermonId) return;

    // Owner pinned before the await, for the same reason as in fetchSermonData:
    // an account switch mid-flight must not redirect this write to the new owner.
    const startedAsUid = resolveOwnerUid();
    const generation = loadGenerationRef.current;
    const key = sermonDetailKey(startedAsUid, sermonId);
    await queryClient.cancelQueries({ queryKey: key });
    if (resolveOwnerUid() !== startedAsUid || generation !== loadGenerationRef.current) return;

    let nextSermon: Sermon | null = null;
    queryClient.setQueryData(key, (prev: Sermon | undefined) => {
      const next = updater instanceof Function ? updater(prev || null) : updater;
      nextSermon = next;
      return next ?? undefined;
    });

    // Sync local state
    setSermonState(nextSermon);

    // NOTE: do NOT invalidateQueries here. setQueryData already updates the cache
    // AND triggers the IndexedDB persister. Marking the sermon key stale used to make
    // the detail page (useSermon is cache-first with refetchOnMount) refetch on return
    // from structure mode — and that background refetch could clobber the just-edited
    // structure with server data that hadn't caught up with the debounced save yet,
    // so the right-side structure panel "loaded as if the cache wasn't applied".
    // The cache is authoritative for the local edits; let the detail page trust it.
  }, [queryClient, sermonId]);

  useEffect(() => {
    const generation = ++loadGenerationRef.current;
    const owner = resolveOwnerUid();
    const isCurrent = () => generation === loadGenerationRef.current && resolveOwnerUid() === owner;
    async function initializeSermon() {
      if (!sermonId) {
        setLoading(false);
        setError(null);
        setSermonState(null);
        setContainers({ introduction: [], main: [], conclusion: [], ambiguous: [] });
        return;
      }

      const isNewSermon = lastSermonIdRef.current !== sermonId;
      const isInitialLoad = !hasLoadedRef.current || isNewSermon;
      // Connectivity changes must not rebuild an editor underneath pending work.
      // The page's freshness observer independently offers server verification.
      if (!isInitialLoad) return;
      setLoading(true);
      setSermonState(null);
      setError(null);

      recordDiagnostic(STRUCTURE_LOAD_EVENT, { result: 'started' });
      try {
        // Fetch sermon
        let { sermon: fetchedSermon } = await fetchSermonData(
          sermonId,
          queryClient,
          isOnlineResolved
        );
        if (!isCurrent()) return;
        if (!fetchedSermon) {
          setSermon(null);
          setContainers({ introduction: [], main: [], conclusion: [], ambiguous: [] });
          setSermonPoints({ introduction: [], main: [], conclusion: [] });
          setAllowedTags([]);
          setRequiredTagColors({});
          setLoading(false);
          return;
        }
        const { allTags } = await fetchTagsData(fetchedSermon, queryClient, isOnlineResolved, t);
        if (!isCurrent()) return;
        fetchedSermon = selectReadableCopy(fetchedSermon,
          queryClient.getQueryData<Sermon>(sermonDetailKey(owner, sermonId))) ?? fetchedSermon;
        // The outline belongs to this exact sermon copy. A second SDK read could
        // resurrect deleted points from its cache after HTTP recovered the document.
        const outlineData = fetchedSermon.outline;
        await setSermon(fetchedSermon);
        if (!isCurrent()) return;

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

        if (outlineData) {
          setSermonPoints({
            introduction: outlineData.introduction || [],
            main: outlineData.main || [],
            conclusion: outlineData.conclusion || [],
          });
        } else {
          setSermonPoints({ introduction: [], main: [], conclusion: [] });
        }

        // Canonicalize structure order (outline blocks -> unassigned tail)
        const canonicalStructure = canonicalizeStructure({
          thoughts: fetchedSermon.thoughts ?? [],
          structure: fetchedSermon.structure ?? fetchedSermon.thoughtsBySection,
          outline: outlineData ?? fetchedSermon.outline,
        });

        const { intro, main, concl, ambiguous } = buildContainersFromCanonicalStructure(
          canonicalStructure,
          allThoughtItems
        );

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
        if (!isCurrent()) return;
        recordDiagnostic(STRUCTURE_LOAD_EVENT, { result: 'failed' });
        console.error("Error initializing sermon data:", err);
        const errorMessage = t('errors.fetchSermonStructureError');
        setError(errorMessage);
        toast.error(errorMessage);
        // Reset state on error
        setSermon(null);
        setContainers({ introduction: [], main: [], conclusion: [], ambiguous: [] });
        setSermonPoints({ introduction: [], main: [], conclusion: [] });
        setAllowedTags([]);
        setRequiredTagColors({});
      } finally {
        if (isCurrent()) {
          setLoading(false);
          recordDiagnostic(STRUCTURE_LOAD_EVENT, { result: 'settled' });
        }
      }
    }

    void initializeSermon();
    return () => { loadGenerationRef.current += 1; };
  }, [sermonId, t, isOnlineResolved, queryClient, setSermon, retryCount]);

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
    retry,
    setLoading,
    isAmbiguousVisible,
    setIsAmbiguousVisible
  };
} 

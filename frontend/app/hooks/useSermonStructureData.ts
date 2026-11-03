import { TFunction } from 'i18next'; // Import TFunction from i18next
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';

import { useTags } from '@/hooks/useTags';
import { Item, Sermon, SermonPoint, Tag, Thought, ThoughtsBySection } from '@/models/models';
import { normalizeStructureTag } from '@/utils/tagUtils';
import { canonicalizeStructure } from '@/utils/thoughtOrdering';
import { getSectionBaseColor } from '@lib/sections';


type TagCatalogue = Record<string, { name: string; color?: string }>;

/** Presentation of the canonical catalogue; this hook owns no tag IO or persisted copy. */
function buildTagCatalogue(tags: readonly Tag[]): TagCatalogue {
  const catalogue: TagCatalogue = Object.create(null);
  for (const tag of tags) {
    const key = tag.name.trim().toLowerCase();
    if (!catalogue[key]) catalogue[key] = { name: tag.name, color: tag.color };
  }
  return catalogue;
}

function projectCustomTag(name: string, catalogue: TagCatalogue) {
  const tag = catalogue[name.trim().toLowerCase()];
  return { name: tag?.name || name, color: tag?.color || '#4c51bf' };
}

function customTagOptions(catalogue: TagCatalogue) {
  return Object.values(catalogue).filter(tag => normalizeStructureTag(tag.name) === null)
    .map(tag => ({ name: tag.name, color: tag.color || '#808080' }));
}

/** A catalogue change repaints the current board, preserving local text, order and positions. */
function repaintTagPresentation(containers: Record<string, Item[]>, catalogue: TagCatalogue): Record<string, Item[]> {
  let changed = false;
  const next = Object.fromEntries(Object.entries(containers).map(([section, items]) => [section, items.map(item => {
    if (!item.customTagNames?.length) return item;
    const tags = item.customTagNames.map(tag => ({ ...tag, ...projectCustomTag(tag.name, catalogue) }));
    if (tags.every((tag, index) => tag.name === item.customTagNames![index].name && tag.color === item.customTagNames![index].color)) return item;
    changed = true;
    return { ...item, customTagNames: tags };
  })]));
  return changed ? next : containers;
}

// Helper: Process thoughts into items
function processThoughtsIntoItems(
  fetchedSermon: Sermon,
  allTags: TagCatalogue
): Record<string, Item> {
  const allThoughtItems: Record<string, Item> = {};

  (fetchedSermon.thoughts || []).forEach((thought: Thought) => {
    const stableId = thought.id;
    const rawTags = Array.isArray(thought.tags) ? thought.tags.filter(Boolean) : [];

    const customTagNames = rawTags.filter((tag: string) => normalizeStructureTag(tag) === null);

    const enrichedCustomTags = customTagNames.map(name => projectCustomTag(name, allTags));

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

function buildBoard(sermon: Sermon, allTags: TagCatalogue) {
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
    allowedTags: customTagOptions(allTags),
    hasAmbiguous: ambiguous.length > 0,
  };
}

export function useSermonStructureData(t: TFunction, engine: StructureEngineSource) {
  const canonicalTags = useTags(engine.sermon?.userId);
  const allTags = useMemo(() => buildTagCatalogue(canonicalTags.allTags), [canonicalTags.allTags]);
  const catalogueRef = useRef(allTags);
  catalogueRef.current = allTags;
  const tagError = canonicalTags.error?.message;
  useEffect(() => {
    if (tagError) toast.error(t('errors.fetchTagsError'));
  }, [tagError, t]);
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
  const appliedEngineSermonRef = useRef<Sermon | null>(null);
  const engineBoardPendingRef = useRef(false);
  const engineBuiltRef = useRef(false);
  const applyEngineSermon = useCallback((next: Sermon, allTags: TagCatalogue) => {
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
    appliedEngineSermonRef.current = next;
    engineBoardPendingRef.current = false;
    setLoading(false);
  }, []);

  const applyCatalogue = useCallback((catalogue: TagCatalogue) => {
    setAllowedTags(customTagOptions(catalogue));
    setContainers(current => repaintTagPresentation(current, catalogue));
    engineBoardPendingRef.current = false;
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!engineSermon) {
      setLoading(Boolean(engineRef.current.loading));
      return;
    }
    if (engineRef.current.isHolding()) { engineBoardPendingRef.current = true; return; }
    if (appliedEngineSermonRef.current !== engineSermon) applyEngineSermon(engineSermon, allTags);
    else applyCatalogue(allTags);
  }, [engineSermon, allTags, applyEngineSermon, applyCatalogue]);

  /** Apply the latest source after a drag/review, retaining local edits for tag-only changes. */
  const syncFromEngine = useCallback(() => {
    const current = engineRef.current.sermon;
    if (!engineBoardPendingRef.current || !current || engineRef.current.isHolding()) return;
    if (appliedEngineSermonRef.current !== current) applyEngineSermon(current, catalogueRef.current);
    else applyCatalogue(catalogueRef.current);
  }, [applyEngineSermon, applyCatalogue]);

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

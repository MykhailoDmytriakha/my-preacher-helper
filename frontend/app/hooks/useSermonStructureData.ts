import { useState, useEffect } from 'react';
import { Item, Sermon, OutlinePoint, Outline, Tag, Thought } from '@/models/models';
import { getSermonById } from '@/services/sermon.service';
import { getTags } from '@/services/tag.service';
import { getSermonOutline } from '@/services/outline.service';
import { updateStructure } from '@/services/structure.service';
import { SERMON_SECTION_COLORS } from '@/utils/themeColors';
import { getSectionBaseColor } from '@lib/sections';
import { TFunction } from 'i18next'; // Import TFunction from i18next
import { toast } from 'sonner';

// Helper function to check if structure changed (consider moving to utils)
const isStructureChanged = (
  structurePrev: string | Record<string, any>,
  structureNew: string | Record<string, any>
): boolean => {
  const parse = (v: string | object) =>
    typeof v === 'string' ? JSON.parse(v) : v;
  const prev = parse(structurePrev);
  const current = parse(structureNew);

  // Compare keys and array lengths first for quick check
  const prevKeys = Object.keys(prev);
  const currentKeys = Object.keys(current);
  if (prevKeys.length !== currentKeys.length) return true;
  if (!prevKeys.every(key => currentKeys.includes(key))) return true;

  // Compare array contents (order matters)
  for (const key of prevKeys) {
    if (!Array.isArray(prev[key]) || !Array.isArray(current[key])) return true; // Should be arrays
    if (prev[key].length !== current[key].length) return true;
    if (prev[key].some((id, index) => id !== current[key][index])) return true;
  }

  return false;
};


export function useSermonStructureData(sermonId: string | null | undefined, t: TFunction) {
  const [sermon, setSermon] = useState<Sermon | null>(null);
  const [containers, setContainers] = useState<Record<string, Item[]>>({
    introduction: [],
    main: [],
    conclusion: [],
    ambiguous: [],
  });
  const [outlinePoints, setOutlinePoints] = useState<{
    introduction: OutlinePoint[];
    main: OutlinePoint[];
    conclusion: OutlinePoint[];
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

  const columnTitles: Record<string, string> = {
    introduction: t('structure.introduction'),
    main: t('structure.mainPart'),
    conclusion: t('structure.conclusion'),
    ambiguous: t('structure.underConsideration'),
  };


  useEffect(() => {
    async function initializeSermon() {
      if (!sermonId) {
        setLoading(false);
        setError(null); // Ensure error is cleared
        setSermon(null); // Clear sermon data
        setContainers({ introduction: [], main: [], conclusion: [], ambiguous: [] }); // Clear containers
        return;
      }

      setLoading(true);
      setError(null); // Clear previous errors

      try {
        const fetchedSermon = await getSermonById(sermonId);
        if (!fetchedSermon) {
          throw new Error("Failed to fetch sermon");
        }
        setSermon(fetchedSermon);

        // Fetch tags (handle potential errors during tag fetching)
        let tagsData;
        try {
            tagsData = await getTags(fetchedSermon.userId);
        } catch (tagError) {
            console.error("Error fetching tags:", tagError);
            tagsData = { requiredTags: [], customTags: [] }; // Default to empty if fetch fails
            toast.error(t('errors.fetchTagsError'));
        }


        const allTags: Record<string, { name: string; color?: string }> = {};
        (tagsData.requiredTags || []).forEach((tag: Tag) => { // Added type safety and default array
          const normalizedName = tag.name.trim().toLowerCase();
          allTags[normalizedName] = { name: tag.name, color: tag.color };
        });
        (tagsData.customTags || []).forEach((tag: Tag) => { // Added type safety and default array
          const normalizedName = tag.name.trim().toLowerCase();
          // Avoid overwriting required tags if names clash (though unlikely)
          if (!allTags[normalizedName]) {
             allTags[normalizedName] = { name: tag.name, color: tag.color };
          }
        });

        setRequiredTagColors({
          introduction: getSectionBaseColor('introduction'),
          main: getSectionBaseColor('main'),
          conclusion: getSectionBaseColor('conclusion'),
        });

        const filteredAllowedTags = Object.values(allTags)
          .filter(
            (tag) =>
              !["вступление", "основная часть", "заключение"].includes(tag.name.toLowerCase()) &&
              !["introduction", "main part", "conclusion"].includes(tag.name.toLowerCase()) // Also check English defaults
          )
          .map(tag => ({
            name: tag.name, // Ensure name is included
            color: tag.color || "#808080"
          }));
        setAllowedTags(filteredAllowedTags);

        const allThoughtItems: Record<string, Item> = {};
        (fetchedSermon.thoughts || []).forEach((thought: Thought) => { // Added default array
            const stableId = thought.id;
            // Ensure tags is an array before mapping
            const normalizedTags = Array.isArray(thought.tags)
              ? thought.tags.map((tag: string) => tag.trim().toLowerCase())
              : [];

            const customTagNames = normalizedTags.filter(
                (tag: string) =>
                    !["вступление", "основная часть", "заключение"].includes(tag) &&
                    !["introduction", "main part", "conclusion"].includes(tag) // Also check English defaults
            );
            const enrichedCustomTags = customTagNames.map((tagName: string) => {
              const tagInfo = allTags[tagName];
              const color = tagInfo?.color || "#4c51bf"; // Default color if tag not found
              return {
                name: tagInfo?.name || tagName,
                color: color,
              };
            });

            const relevantTags = normalizedTags.filter((tag: string) =>
                ["вступление", "основная часть", "заключение"].includes(tag) ||
                ["introduction", "main part", "conclusion"].includes(tag) // Also check English defaults
            );

            let outlinePointData;
            if (thought.outlinePointId && fetchedSermon.outline) {
                const outlineSections = ['introduction', 'main', 'conclusion'] as const;
                for (const section of outlineSections) {
                    const point = fetchedSermon.outline[section]?.find((p: OutlinePoint) => p.id === thought.outlinePointId);
                    if (point) {
                        outlinePointData = {
                            text: point.text,
                            section: '' // Don't show section in structure page
                        };
                        break;
                    }
                }
            }

            const item: Item = {
              id: stableId,
              content: thought.text,
              customTagNames: enrichedCustomTags,
              // Map relevant tag names back to display names using allTags
              requiredTags: relevantTags.map((tag: string) => allTags[tag]?.name || tag),
              outlinePoint: outlinePointData,
              outlinePointId: thought.outlinePointId,
              position: (thought as any).position
            };
            allThoughtItems[stableId] = item;
        });


        let intro: Item[] = [];
        let main: Item[] = [];
        let concl: Item[] = [];
        let ambiguous: Item[] = [];
        const usedIds = new Set<string>();

        // Step 1: Process structure if it exists (respect positions where available)
        if (fetchedSermon.structure) {
            let structureObj = typeof fetchedSermon.structure === "string"
                ? JSON.parse(fetchedSermon.structure)
                : fetchedSermon.structure;

            if (structureObj && typeof structureObj === 'object') {
                ["introduction", "main", "conclusion"].forEach((section) => {
                    if (Array.isArray(structureObj[section])) {
                        const target = section === "introduction" ? intro : section === "main" ? main : concl;
                        const sectionTagName = columnTitles[section]; // Get translated name for tagging
                        const seen = new Set<string>();
                        const orderedUniqueIds = structureObj[section].filter((id: string) => {
                          if (seen.has(id)) return false;
                          seen.add(id);
                          return true;
                        });
                        // If positions exist, use them to sort within the section; otherwise keep order from structure
                        const itemsForSection = orderedUniqueIds
                          .map((thoughtId: string) => allThoughtItems[thoughtId])
                          .filter(Boolean) as Item[];
                        const withSectionTag = itemsForSection.map((it) => ({ ...it, requiredTags: [sectionTagName] }));
                        const anyPos = withSectionTag.some(i => typeof i.position === 'number');
                        const sorted = anyPos
                          ? [...withSectionTag].sort((a, b) => (a.position ?? Number.POSITIVE_INFINITY) - (b.position ?? Number.POSITIVE_INFINITY))
                          : withSectionTag;
                        for (const item of sorted) {
                          target.push(item);
                          usedIds.add(item.id);
                        }
                    }
                });
            }
        }

        // Step 2: Add remaining thoughts, trying to sort by tag first
         Object.values(allThoughtItems).forEach(item => {
           if (!usedIds.has(item.id)) {
             // Check the item's *own* required tags (derived from thought tags)
             const itemRequiredTags = item.requiredTags || [];
             let placed = false;
             if (itemRequiredTags.length === 1) {
                 const tagName = itemRequiredTags[0];
                 // Use columnTitles which holds the translated names used for tagging
                 if (tagName === columnTitles.introduction) {
                     intro.push(item);
                     placed = true;
                 } else if (tagName === columnTitles.main) {
                     main.push(item);
                     placed = true;
                 } else if (tagName === columnTitles.conclusion) {
                     concl.push(item);
                     placed = true;
                 }
             }

             // If not placed by tag, put it in ambiguous
             if (!placed) {
                 // Clear potentially incorrect requiredTags before adding to ambiguous
                 item.requiredTags = [];
                 ambiguous.push(item);
             }
           }
         });

        // Step 3: Fetch and set outline points
        try {
            const outlineData = await getSermonOutline(sermonId);
            if (outlineData) {
                setOutlinePoints({
                  introduction: outlineData.introduction || [],
                  main: outlineData.main || [],
                  conclusion: outlineData.conclusion || [],
                });
            } else {
                 setOutlinePoints({ introduction: [], main: [], conclusion: [] });
            }
        } catch (outlineError) {
            console.error("Error fetching sermon outline:", outlineError);
             setOutlinePoints({ introduction: [], main: [], conclusion: [] }); // Default on error
            toast.error(t('errors.fetchOutlineError'));
        }

        // Ensure items have positions for stable ordering
        const seedPositions = (items: Item[]) => {
          // If none have position, seed sequentially
          const anyPos = items.some(i => typeof i.position === 'number');
          if (!anyPos) {
            let base = 1000;
            return items.map((it, idx) => ({ ...it, position: base * (idx + 1) }));
          }
          // If some have, fill gaps preserving current order
          let cursor = 1000;
          return items.map((it) => {
            if (typeof it.position === 'number') return it;
            cursor += 1000;
            return { ...it, position: cursor };
          });
        };

        // Sort by position if present
        const sortByPosition = (items: Item[]) => {
          const anyPos = items.some(i => typeof i.position === 'number');
          if (!anyPos) return items;
          return [...items].sort((a, b) => (a.position ?? Number.POSITIVE_INFINITY) - (b.position ?? Number.POSITIVE_INFINITY));
        };

        // Step 4: Set final container state (sorted by position when available)
        setContainers({
          introduction: sortByPosition(seedPositions(intro)),
          main: sortByPosition(seedPositions(main)),
          conclusion: sortByPosition(seedPositions(concl)),
          ambiguous: sortByPosition(seedPositions(ambiguous)),
        });
        setIsAmbiguousVisible(ambiguous.length > 0); // Update visibility based on final ambiguous content


        // Step 5: Update structure in backend if necessary (optional, based on original logic)
        // This might be better handled explicitly by the component after user actions like drag/drop
        /*
        const newStructure = {
          introduction: intro.map((item) => item.id),
          main: main.map((item) => item.id),
          conclusion: concl.map((item) => item.id),
          // Ambiguous items might not need to be saved in the 'structure' document
          // unless specifically intended. Check original requirements.
          ambiguous: ambiguous.map((item) => item.id),
        };
        if (isStructureChanged(fetchedSermon.structure || {}, newStructure)) {
           console.log("Structure changed on initial load, potentially updating backend.");
           // await updateStructure(sermonId, newStructure); // Consider if auto-update on load is desired
        }
        */

      } catch (err) {
        console.error("Error initializing sermon data:", err);
        const errorMessage = err instanceof Error ? err.message : t('errors.fetchSermonStructureError');
        setError(errorMessage);
        toast.error(errorMessage);
        // Reset state on error
        setSermon(null);
        setContainers({ introduction: [], main: [], conclusion: [], ambiguous: [] });
        setOutlinePoints({ introduction: [], main: [], conclusion: [] });
        setAllowedTags([]);
        setRequiredTagColors({});
      } finally {
        setLoading(false);
      }
    }

    initializeSermon();
    // Ensure dependencies are correct. 't' is included as columnTitles depends on it.
  }, [sermonId, t]);

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
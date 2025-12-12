import { useMemo } from "react";

import { normalizeStructureTag } from "@/utils/tagUtils";

import type { Sermon } from "@/models/models";

/**
 * Hook to validate if a sermon's thoughts are properly structured
 * as required by the application's business rules
 */
export function useSermonValidator(sermon: Sermon | null) {
  // Check if all thoughts in the main sections are linked to outline points
  const isPlanAccessible = useMemo(() => {
    if (!sermon) return false;
    
    // Filter thoughts that have at least one structure tag
    const structuralThoughts = sermon.thoughts.filter(thought => 
      thought.tags.some(tag => normalizeStructureTag(tag) !== null)
    );
    
    // If there are no structural thoughts, plan should not be accessible
    if (structuralThoughts.length === 0) return false;
    
    // Check if all structural thoughts have a valid outlinePointId
    const allThoughtsHaveSermonPoints = structuralThoughts.every(thought => {
      // Check if the thought has a non-empty outlinePointId
      if (!thought.outlinePointId) return false;
      
      // Determine which section this thought belongs to based on normalized tags
      const normalized = thought.tags.map(normalizeStructureTag).find(Boolean);
      const outlineSection = normalized === 'intro' ? 'introduction' : normalized === 'main' ? 'main' : normalized === 'conclusion' ? 'conclusion' : null;
      
      if (!outlineSection || !sermon.outline) return false;
      
      // Check if the outlinePointId exists in the correct section of the outline
      return sermon.outline[outlineSection].some(point => point.id === thought.outlinePointId);
    });
    
    return allThoughtsHaveSermonPoints;
  }, [sermon]);
  
  return { isPlanAccessible };
}

export default useSermonValidator; 
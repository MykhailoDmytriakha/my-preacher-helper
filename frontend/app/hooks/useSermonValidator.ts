import { useMemo } from "react";
import type { Sermon } from "@/models/models";

/**
 * Hook to validate if a sermon's thoughts are properly structured
 * as required by the application's business rules
 */
export function useSermonValidator(sermon: Sermon | null) {
  // Check if all thoughts in the main sections are linked to outline points
  const isPlanAccessible = useMemo(() => {
    if (!sermon) return false;
    
    // Get all thoughts with structural tags (Вступление, Основная часть, Заключение)
    const structuralTags = ["Вступление", "Основная часть", "Заключение"];
    
    // Filter thoughts that have at least one of the structural tags
    const structuralThoughts = sermon.thoughts.filter(thought => 
      thought.tags.some(tag => structuralTags.includes(tag))
    );
    
    // If there are no structural thoughts, plan should not be accessible
    if (structuralThoughts.length === 0) return false;
    
    // Check if all structural thoughts have a valid outlinePointId
    const allThoughtsHaveOutlinePoints = structuralThoughts.every(thought => {
      // Check if the thought has a non-empty outlinePointId
      if (!thought.outlinePointId) return false;
      
      // Determine which section this thought belongs to based on its tags
      const section = thought.tags.find(tag => structuralTags.includes(tag));
      if (!section) return false;
      
      // Map the tag to the corresponding section in the outline
      const outlineSection = 
        section === "Вступление" ? "introduction" :
        section === "Основная часть" ? "main" :
        section === "Заключение" ? "conclusion" : null;
      
      if (!outlineSection || !sermon.outline) return false;
      
      // Check if the outlinePointId exists in the correct section of the outline
      return sermon.outline[outlineSection].some(point => point.id === thought.outlinePointId);
    });
    
    return allThoughtsHaveOutlinePoints;
  }, [sermon]);
  
  return { isPlanAccessible };
}

export default useSermonValidator; 
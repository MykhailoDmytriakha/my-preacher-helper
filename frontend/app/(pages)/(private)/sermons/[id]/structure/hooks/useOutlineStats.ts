import { useMemo } from "react";
import { Item, Sermon } from "@/models/models";

interface UseOutlineStatsProps {
  sermon: Sermon | null;
  containers: Record<string, Item[]>;
}

export const useOutlineStats = ({ sermon, containers }: UseOutlineStatsProps) => {
  // Calculate counts of thoughts per outline point
  const thoughtsPerSermonPoint = useMemo(() => {
    if (!sermon || !sermon.outline) return {};
    
    const result: Record<string, number> = {};
    
    // Initialize with zero counts only for sections that have outline points
    for (const section of ['introduction', 'main', 'conclusion']) {
      const points = sermon.outline[section as keyof typeof sermon.outline] || [];
      if (points.length > 0) {
        for (const point of points) {
          result[point.id] = 0;
        }
      }
    }
    
    // Count thoughts per outline point
    for (const section of ['introduction', 'main', 'conclusion']) {
      const sectionItems = containers[section] || [];
      for (const item of sectionItems) {
        if (item.outlinePointId && result.hasOwnProperty(item.outlinePointId)) {
          result[item.outlinePointId]++;
        }
      }
    }
    
    return result;
  }, [sermon?.outline, containers.introduction, containers.main, containers.conclusion]);

  return { thoughtsPerSermonPoint };
};

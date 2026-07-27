import { ThoughtsBySection } from '@/models/models';
import { updateStructureViaClient } from '@/services/sermons.client';

export const updateStructure = async (
  sermonId: string,
  structure: unknown,
  /** The arrangement AS THE SCREEN OPENED IT — see `mergeSections`. */
  baseStructure?: unknown
): Promise<unknown> => {
  return updateStructureViaClient(
    sermonId,
    structure as ThoughtsBySection,
    (baseStructure ?? null) as ThoughtsBySection | null
  );
}; 

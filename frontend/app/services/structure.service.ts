import { ThoughtsBySection } from '@/models/models';
import { updateStructureViaClient } from '@/services/sermons.client';

export const updateStructure = async (sermonId: string, structure: unknown): Promise<unknown> => {
  return updateStructureViaClient(sermonId, structure as ThoughtsBySection);
}; 

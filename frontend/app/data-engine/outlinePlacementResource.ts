import { replaceSermonOutline } from '@/utils/sermonThoughtEdits';

import type { DocumentData } from './types';
import type { Sermon, SermonOutline } from '@/models/models';

export const TEMPLATE_POINT_PLACEMENT_REVIEW = 'template-point-placement-needs-review';

export function outlinePlacementField(collection: string): 'outline' | 'structure' | undefined {
  if (collection === 'sermons') return 'outline';
  if (collection === 'planTemplates') return 'structure';
}

/** Templates have no sermon thoughts or mirrored thought placements to update. */
export function replaceResourceOutline(collection: string, value: DocumentData, outline: SermonOutline): DocumentData {
  if (collection === 'sermons') return replaceSermonOutline(value as unknown as Sermon, outline) as unknown as DocumentData;
  if (collection === 'planTemplates') return { ...value, structure: outline as unknown as DocumentData };
  return value;
}

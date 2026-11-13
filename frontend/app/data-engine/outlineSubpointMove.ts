import { outlineSubpointGap } from '@/utils/outlineDnd';

import { equalValues } from './fieldValues';
import { templateOutline } from './templateOutlineMerge';

import type { ActionTime } from './actionClock';
import type { OutlineSubpointMove } from './types';
import type { SermonOutline } from '@/models/models';

export const MAX_OUTLINE_SUBPOINT_MOVES = 32;
export const OUTLINE_SUBPOINT_REVIEW = 'outline-subpoint-review';

export type OutlineSubpointInput = { outlineSubpoint: { subPointId: string; time: ActionTime | null } };

export function captureOutlineSubpointMove(before: unknown, after: unknown, subPointId: string,
  observedRevision: number, time: ActionTime | null): OutlineSubpointMove | undefined {
  const original = templateOutline(before) as unknown as SermonOutline | undefined;
  const proposed = templateOutline(after) as unknown as SermonOutline | undefined;
  const opening = original && outlineSubpointGap(original, subPointId);
  const destination = proposed && outlineSubpointGap(proposed, subPointId);
  if (opening && destination && !equalValues(opening, destination)) return { subPointId, opening, destination, observedRevision, time };
}

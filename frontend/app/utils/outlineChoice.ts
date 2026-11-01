import { mergeValues } from '@/data-engine/react.client';
import { chooseOutlineChanges } from '@/utils/outlineChoiceCore';

import type { SermonOutline } from '@/models/models';

export { OutlineChoiceReviewRequiredError } from '@/utils/outlineChoiceCore';

/** The UI uses the same pure outline-choice rule as other consumers, through its public merge port. */
export function chooseOutlineLocalChanges(base: SermonOutline | null | undefined, mine: SermonOutline,
  theirs: SermonOutline | null | undefined): SermonOutline {
  return chooseOutlineChanges(base, mine, theirs, mergeValues);
}

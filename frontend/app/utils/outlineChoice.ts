import { mergeValues } from '@/data-engine/react.client';
import { chooseOutlineChanges } from '@/utils/outlineChoiceCore';
import { sermonNoteConflictText, withOutlineNoteText } from '@/utils/sermonNoteText';

import type { DocumentData, FieldValue, Json } from '@/data-engine/types';
import type { SermonOutline } from '@/models/models';

export { OutlineChoiceReviewRequiredError } from '@/utils/outlineChoiceCore';

export function readOutlineNoteChoice(base: SermonOutline | null | undefined, mine: SermonOutline, stored: SermonOutline | null) {
  if (!base || !stored) return undefined;
  const document = (outline: SermonOutline): DocumentData => ({ outline: outline as unknown as Json });
  const side = (outline: SermonOutline): FieldValue => ({ exists: true, value: document(outline) });
  const { conflicts } = mergeValues(side(base), side(mine), side(stored));
  if (conflicts.length !== 1) return undefined;
  const choice = sermonNoteConflictText(conflicts[0].path, document(mine), document(stored));
  if (!choice || choice.target.kind === 'scratch') return undefined;
  const corrected = withOutlineNoteText(mine, choice.target, choice.stored);
  if (!corrected) return undefined;
  return { mine: choice.mine, stored: choice.stored,
    acceptStored: () => chooseOutlineLocalChanges(base, corrected, stored) };
}

/** The UI uses the same pure outline-choice rule as other consumers, through its public merge port. */
export function chooseOutlineLocalChanges(base: SermonOutline | null | undefined, mine: SermonOutline,
  theirs: SermonOutline | null | undefined): SermonOutline {
  return chooseOutlineChanges(base, mine, theirs, mergeValues);
}

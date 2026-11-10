import { mergeValues } from '@/data-engine/react.client';
import { serializeContent } from '@/utils/contentFingerprint';
import { chooseOutlineChanges } from '@/utils/outlineChoiceCore';
import { outlineTitleConflictTarget, readOutlineNoteText, readOutlineTitleText, sermonNoteConflictText, withOutlineNoteText, withOutlineTitleText } from '@/utils/sermonNoteText';

import type { DocumentData, FieldValue, Json } from '@/data-engine/types';
import type { SermonOutline } from '@/models/models';

export { OutlineChoiceReviewRequiredError } from '@/utils/outlineChoiceCore';

export function readOutlineTextChoice(base: SermonOutline | null | undefined, mine: SermonOutline, stored: SermonOutline | null) {
  if (!base || !stored) return undefined;
  const document = (outline: SermonOutline): DocumentData => ({ outline: outline as unknown as Json });
  const side = (outline: SermonOutline): FieldValue => ({ exists: true, value: document(outline) });
  const { value, conflicts } = mergeValues(side(base), side(mine), side(stored));
  if (conflicts.length !== 1 || !value.exists || !value.value) return undefined;
  const merged = (value.value as DocumentData).outline as unknown as SermonOutline;
  const { path } = conflicts[0];
  const title = outlineTitleConflictTarget(path);
  if (title) {
    const local = readOutlineTitleText(mine, title), saved = readOutlineTitleText(stored, title);
    if (local === undefined || saved === undefined || local === saved || readOutlineTitleText(merged, title) !== local) return undefined;
    const titleOnly = withOutlineTitleText(base, title, local);
    // A compound proposal may also move or delete rows. Keep its existing structure choice.
    if (!titleOnly || serializeContent(titleOnly) !== serializeContent(mine)) return undefined;
    const corrected = withOutlineTitleText(merged, title, saved);
    if (!corrected) return undefined;
    return { kind: 'title' as const, opening: { target: title, text: saved }, mine: local, stored: saved, acceptLocal: () => merged, acceptStored: () => corrected };
  }
  const choice = sermonNoteConflictText(path, document(mine), document(stored));
  if (!choice || choice.target.kind === 'scratch') return undefined;
  if (readOutlineNoteText(merged, choice.target)?.text !== (choice.mine ?? null)) return undefined;
  const corrected = withOutlineNoteText(merged, choice.target, choice.stored);
  if (!corrected) return undefined;
  return { kind: 'note' as const, mine: choice.mine, stored: choice.stored, acceptLocal: () => merged, acceptStored: () => corrected };
}

/** The UI uses the same pure outline-choice rule as other consumers, through its public merge port. */
export function chooseOutlineLocalChanges(base: SermonOutline | null | undefined, mine: SermonOutline,
  theirs: SermonOutline | null | undefined): SermonOutline {
  return chooseOutlineChanges(base, mine, theirs, mergeValues);
}

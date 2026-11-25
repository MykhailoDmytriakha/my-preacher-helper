import { isPreparationTextField } from '@/utils/preparationFieldValues';

import { hasTimedAncestor } from './commits';
import { canRebaseRefusedPointTail, recoverablePointTitlesAfterRefusal } from './exegeticalPointCapture';
import { equalValues } from './fieldValues';
import { recoverableSermonChurchAfterRefusal } from './sermonChurchRecovery';
import { recoverableSermonTextAfterRefusal } from './sermonTextRecovery';

import type { CommitRequest } from './commits';
import type { SessionCheckpoint } from './session';
import type { DocumentData } from './types';

const pointActionKey = (nodeId: string, kind: string) => JSON.stringify([nodeId, kind]);

/** Detach independently captured fields only when the rest of the queue belongs to the point being reviewed. */
export function separateRefusedSermonTail(source: SessionCheckpoint, projected: SessionCheckpoint, chain: readonly CommitRequest[]) {
  const before = source.pending[chain[0]?.id]?.value;
  if (!before || !source.draft || !projected.draft
    || source.confirmed.metadata?.generation !== projected.confirmed.metadata?.generation) return;

  const titles = recoverablePointTitlesAfterRefusal(source, projected, chain);
  const texts = recoverableSermonTextAfterRefusal(source, projected, chain);
  const church = recoverableSermonChurchAfterRefusal(source, projected, chain);
  const copies = [
    ...(church ? [{ key: 'church', recoveryKind: 'sermon-church' as const, ...church }] : []),
    ...titles.map(({ id, ...copy }) => ({ key: 'point:' + id, recoveryKind: undefined, ...copy })),
    ...texts.map(({ field, ...copy }) => isPreparationTextField(field)
      ? { key: 'preparation:' + field, recoveryKind: undefined, ...copy }
      : { key: field, recoveryKind: 'sermon-header' as const, ...copy }),
  ];
  const restoreStoredFields = (document: DocumentData) => copies.reduce<DocumentData | undefined>(
    (value, copy) => value && copy.restoreStored(value), document);
  const draft = restoreStoredFields(projected.draft);
  const neutralBefore = restoreStoredFields(before);
  const neutralDraft = restoreStoredFields(source.draft);
  if (!draft || !neutralBefore || !neutralDraft) return;
  const checkpoint = { ...projected, draft };
  if (!canRebaseRefusedPointTail(neutralBefore, neutralDraft, checkpoint)) return;

  const pointActions = new Set([
    ...(source.unreadableExegeticalProofs ?? []).map(({ nodeId, kind }) => pointActionKey(nodeId, kind)),
    ...titles.map(({ id }) => pointActionKey(id, 'title')),
  ]);
  const textFields = new Set<string>(texts.map(({ field }) => field));
  // A command may contain another timed action even when its final words equal the opening.
  const hasOtherCapturedWork = chain.slice(1).some(request => {
    const textActions = Object.entries(request.sermonPreparationTextActions ?? {}).filter(([field]) => !textFields.has(field));
    return request.sermonNoteText || (request.sermonChurchFill && !equalValues(request.sermonChurchFill, church?.fill)) || hasTimedAncestor({ ...request,
      exegeticalPlanActions: request.exegeticalPlanActions?.filter(action => !pointActions.has(pointActionKey(action.nodeId, action.kind))),
      sermonPreparationTextActions: textActions.length ? Object.fromEntries(textActions) : undefined,
      sermonChurchAction: church ? undefined : request.sermonChurchAction,
      sermonTitleAction: textFields.has('title') ? undefined : request.sermonTitleAction,
      sermonVerseAction: textFields.has('verse') ? undefined : request.sermonVerseAction,
    });
  });
  if (hasOtherCapturedWork || source.exegeticalPointDrafts?.some(action => !pointActions.has(pointActionKey(action.nodeId, action.kind)))) return;
  return { checkpoint, copies };
}

import { groupNamed, readTheme } from '@/utils/hardQuestions';
import { rankForAppend } from '@/utils/listRank';

import { ACTION_SLOT, editorIdentity } from './editorIdentity';
import { appendHardQuestionGroup, hardQuestionGroupById, type HardQuestionGroupIntent } from './hardQuestionGroupCreation';
import { isValidIdentifier } from './protocol';
import { pinSavedDocument } from './savedDocumentPin';
import { DataSession } from './session';

import type { AtomicCapture, CommitRequest } from './commits';
import type { DocumentData, ResourceRef, ResourceSnapshot } from './types';

const refuse = (code: string): never => { throw Object.assign(new Error(code), { code }); };

/** Capture one question and only its selected group against the theme's saved chain. */
export function captureHardQuestionGroup(owner: string, actionId: string, question: ResourceRef, value: DocumentData,
  theme: ResourceSnapshot, proposal: HardQuestionGroupIntent | undefined, requests: readonly CommitRequest[]): AtomicCapture[] {
  const groupId = value.groupId;
  if (question.collection !== 'hardQuestions' || theme.resource.collection !== 'hardQuestionThemes'
    || value.userId !== owner || value.themeId !== theme.resource.id || !isValidIdentifier(groupId)
    || (proposal && (groupId !== proposal.group.id || !proposal.group.title.trim()))) return refuse('invalid-argument');
  if (theme.metadata?.deleted) return refuse('referenced-document-deleted');
  const pinned = pinSavedDocument(owner, theme, requests);
  if (pinned.conflicts.length) return refuse('resolve-version-first');
  if (!pinned.draft) return refuse('referenced-document-deleted');
  if (pinned.draft.userId !== owner) return refuse('permission-denied');
  const selected = proposal ? undefined : hardQuestionGroupById(pinned.draft, groupId);
  let intent: HardQuestionGroupIntent | undefined = proposal ?? (selected && { group: selected, existing: true });
  if (!intent) return refuse('decision-changed');
  // The list can lag behind a just-captured Save. Resolve a typed name against durable
  // local intent before claiming a second identity. An explicitly selected ID stays pinned.
  const known = !intent.existing && groupNamed(readTheme(pinned.draft, theme.resource.id).groups, intent.group.title);
  if (known && known.id !== intent.group.id) {
    intent = { group: { id: known.id, title: known.title }, existing: true };
    const ranks = requests.flatMap(request => request.owner === owner && request.baseline.resource.collection === 'hardQuestions'
      && !['cancelled', 'refused', 'conflict'].includes(request.state) && request.value?.themeId === theme.resource.id
      && request.value.groupId === known.id && typeof request.value.rank === 'number'
      ? [{ id: request.baseline.resource.id, rank: request.value.rank }] : []);
    value = { ...value, groupId: known.id, rank: rankForAppend(ranks) };
  }
  const proposed = appendHardQuestionGroup(pinned.draft, intent.group, intent.existing);
  if (!proposed) return refuse('decision-changed');
  const predecessorId = Object.entries(pinned.pending).sort((a, b) => b[1].generation - a[1].generation)[0]?.[0] ?? null;
  const questionEditor = new DataSession({ resource: question, value: null, metadata: null });
  questionEditor.edit(value);
  const themeEditor = new DataSession(pinned.confirmed);
  themeEditor.edit(proposed);
  return [
    { editorId: editorIdentity(actionId, question, ACTION_SLOT, actionId), captured: questionEditor.checkpoint(), predecessorId: null },
    { editorId: editorIdentity(actionId, theme.resource, ACTION_SLOT, actionId), captured: themeEditor.checkpoint(), predecessorId,
      hardQuestionGroupIntent: intent },
  ];
}

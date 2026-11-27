import { object } from './fieldValues';

import type { DocumentData } from './types';

export type HardQuestionGroupProposal = { id: string; title: string };
export type HardQuestionGroupIntent = { group: HardQuestionGroupProposal; existing?: true };
export const HARD_QUESTION_GROUP_CREATE = 'hard-question-group-create';

export function readHardQuestionGroup(value: unknown): HardQuestionGroupProposal | undefined {
  if (!object(value) || typeof value.id !== 'string' || !value.id
    || typeof value.title !== 'string' || !value.title.trim()) return;
  return { id: value.id, title: value.title };
}

export function hardQuestionGroupById(theme: DocumentData, id: string) {
  const rows = Array.isArray(theme.groups) ? theme.groups : [];
  return readHardQuestionGroup(rows.find(row => object(row) && row.id === id));
}

export function appendHardQuestionGroup(theme: DocumentData, proposal: HardQuestionGroupProposal, existing = false): DocumentData | undefined {
  const found = hardQuestionGroupById(theme, proposal.id);
  if (found) return existing || found.title === proposal.title ? theme : undefined;
  if (existing || (theme.groups !== undefined && !Array.isArray(theme.groups))) return;
  if (Array.isArray(theme.groups) && theme.groups.some(row => object(row) && row.id === proposal.id)) return;
  return { ...theme, groups: [...(Array.isArray(theme.groups) ? theme.groups : []), proposal] };
}

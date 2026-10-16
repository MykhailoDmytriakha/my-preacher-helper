import { equalValues } from './protocol';

import type { DocumentData, Json } from './types';

/**
 * The copy that lands in the next council, addressed by the operation rather than by chance.
 * A lost acknowledgement makes the client send the same immutable command again; a random id
 * would then add a second copy of the same section beside the first.
 */
export function carriedCopy(topic: DocumentData, operationId: string): DocumentData {
  const derive = (suffix: string) => `${operationId}-${suffix}`;
  const list = (value: unknown, kind: string): DocumentData[] => Array.isArray(value)
    ? value.map((entry, index) => ({ ...(entry as DocumentData), id: derive(`${kind}-${index}`) })) : [];
  return {
    id: derive('topic'),
    ...(topic.kind !== undefined ? { kind: topic.kind } : {}),
    title: topic.title,
    ...(topic.summary !== undefined ? { summary: topic.summary } : {}),
    questions: list(topic.questions, 'q') as unknown as Json[],
    options: list(topic.options, 'o') as unknown as Json[],
    ...(topic.forAssembly ? { forAssembly: true } : {}),
  };
}

/** New destinations contain exactly the selected words, fresh child IDs and no past outcome. */
export function validNewCouncilCarry(before: DocumentData[], after: DocumentData[], destinationId: string, copies: DocumentData[]): boolean {
  const moved = after.filter(topic => topic.carriedToCouncilId === destinationId
    && before.find(old => old.id === topic.id)?.carriedToCouncilId !== destinationId);
  if (moved.length !== 1 || copies.length !== 1 || before.find(topic => topic.id === moved[0].id)?.carriedToCouncilId) return false;
  const copied = copies[0];
  const normalize = (entries: unknown, kind: string) => Array.isArray(entries)
    ? entries.map((entry, index) => ({ ...(entry as DocumentData), id: `check-${kind}-${index}` })) : entries;
  return equalValues(carriedCopy(moved[0], 'check'), { ...copied, id: 'check-topic',
    questions: normalize(copied.questions, 'q'), options: normalize(copied.options, 'o') });
}

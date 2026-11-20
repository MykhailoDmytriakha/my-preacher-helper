import { object } from './fieldValues';
import { boundedRowId, existingRowField, replaceExistingRowField } from './rowFieldAction';

import type { RowDetailPolicy } from './rowDetailAction';
import type { RowFieldTarget } from './rowFieldAction';
import type { DocumentData, Json } from './types';

export type CouncilTopicTextField = 'question' | 'answer' | 'option';

const fields = {
  question: { list: 'questions', leaf: 'question' },
  answer: { list: 'questions', leaf: 'answer' },
  option: { list: 'options', leaf: 'text' },
} as const;

export const COUNCIL_TOPIC_TEXT_SETTLED = 'council-topic-text-settled';
export const COUNCIL_TOPIC_TEXT_QUEUED = 'council-topic-text-queued';

export function councilTopicTextId(topicId: string, itemId: string, field: CouncilTopicTextField): string {
  return JSON.stringify([topicId, itemId, field]);
}

function readIdentity(id: string): { topicId: string; itemId: string; field: CouncilTopicTextField } | undefined {
  // JSON-escaped IDs can use six characters per input unit. Keep the original ID bounds.
  if (id.length > 1600) return undefined;
  let parts: unknown;
  try { parts = JSON.parse(id); } catch { return undefined; }
  if (!Array.isArray(parts) || parts.length !== 3) return undefined;
  const [topicId, itemId, field] = parts;
  if (!boundedRowId(topicId) || !boundedRowId(itemId) || (field !== 'question' && field !== 'answer' && field !== 'option')
    || councilTopicTextId(topicId, itemId, field) !== id) return undefined;
  return { topicId, itemId, field };
}

function acceptsId(value: unknown): value is string {
  return typeof value === 'string' && readIdentity(value) !== undefined;
}

export function councilTopicTextConflict(path: readonly string[]) {
  const [root, topic, list, item, leaf] = path;
  if (path.length !== 5 || root !== 'topics' || !topic.startsWith('id:') || !item.startsWith('id:')) return undefined;
  const field = list === 'questions' && (leaf === 'question' || leaf === 'answer') ? leaf
    : list === 'options' && leaf === 'text' ? 'option' : undefined;
  const topicId = topic.slice(3), itemId = item.slice(3);
  if (!field || !boundedRowId(topicId) || !boundedRowId(itemId)) return undefined;
  return { topicId, itemId, field, id: councilTopicTextId(topicId, itemId, field) } as const;
}

function councilTopicTextPath(id: string): string[] | undefined {
  const address = readIdentity(id);
  if (!address) return undefined;
  const { topicId, itemId, field } = address;
  const { list, leaf } = fields[field];
  return ['topics', 'id:' + topicId, list, 'id:' + itemId, leaf];
}

/** An ambiguous legacy ID cannot identify an editable row, even when only one copy has words. */
function uniqueRows(value: unknown): DocumentData[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, DocumentData | undefined>();
  for (const row of value) {
    if (object(row) && boundedRowId(row.id)) byId.set(row.id, byId.has(row.id) ? undefined : row);
  }
  return [...byId.values()].filter((row): row is DocumentData => row !== undefined);
}

function councilTopicTextRows(value: unknown): DocumentData[] {
  return uniqueRows(value).flatMap(topic =>
    (['question', 'answer', 'option'] as const).flatMap(field => {
      const { list, leaf } = fields[field];
      return uniqueRows(topic[list]).flatMap<DocumentData>(item => {
        const text = item[leaf];
        const id = councilTopicTextId(String(topic.id), String(item.id), field);
        return typeof text === 'string' ? [{ id, text }]
          : field === 'answer' && text === undefined ? [{ id, text: null }] : [];
      });
    }));
}

function replaceTopicText(rows: Json | undefined, id: string, text: string | null): Json | undefined {
  const address = readIdentity(id);
  if (!address || !Array.isArray(rows) || (text === null && address.field !== 'answer')) return rows;
  const { topicId, itemId, field } = address;
  const { list, leaf } = fields[field];
  return rows.map(topic => {
    if (!object(topic) || topic.id !== topicId || !Array.isArray(topic[list])) return topic;
    return { ...topic, [list]: topic[list].map(item => {
      if (!object(item) || item.id !== itemId) return item;
      if (text !== null) return { ...item, [leaf]: text };
      const answer = { ...item };
      delete answer[leaf];
      return answer;
    }) };
  });
}

export function councilTopicMissing(rows: unknown, topicId: string): boolean {
  return Array.isArray(rows) && !rows.some(topic => object(topic) && topic.id === topicId);
}

export function councilTopicTextItemMissing(rows: unknown, id: string): boolean {
  const address = readIdentity(id);
  if (!address) return false;
  const topic = uniqueRows(rows).find(candidate => candidate.id === address.topicId);
  const items = topic?.[fields[address.field].list];
  return Array.isArray(items) && !items.some(item => object(item) && item.id === address.itemId);
}

export function withoutCouncilTopicTextItem(rows: Json | undefined, id: string): Json | undefined {
  const address = readIdentity(id);
  if (!address || !Array.isArray(rows)) return undefined;
  const { topicId, itemId, field } = address;
  const list = fields[field].list;
  return rows.map(topic => {
    if (!object(topic) || topic.id !== topicId || !Array.isArray(topic[list])) return topic;
    return { ...topic, [list]: topic[list].filter(item => !object(item) || item.id !== itemId) };
  });
}

export const COUNCIL_TOPIC_TEXT: RowFieldTarget<string | null> = {
  field: 'topics', leaf: 'text', storeNull: true, missing: null, accepts: (value): value is string | null => value === null || typeof value === 'string',
  container: { rows: councilTopicTextRows, replace: replaceTopicText },
  conflictPath: councilTopicTextPath, conflictRowId: path => councilTopicTextConflict(path)?.id,
};

export function replaceCouncilTopicText(topics: Json | undefined, rowId: string, value: string): Json | undefined {
  if (existingRowField(topics, rowId, COUNCIL_TOPIC_TEXT) === undefined) return;
  return replaceExistingRowField(topics, rowId, value, COUNCIL_TOPIC_TEXT);
}

export const COUNCIL_TOPIC_TEXT_POLICY: RowDetailPolicy<'text', string | null> = {
  collection: 'councils', fields: ['text'], repeatedFields: ['text'], target: () => COUNCIL_TOPIC_TEXT,
  birth: { field: 'topics', leaf: 'id', accepts: acceptsId, container: { rows: councilTopicTextRows, replace: rows => rows } },
  acceptsRowId: acceptsId, proofs: 'councilTopicTextProofs', actions: 'councilTopicTextActions', history: '_topicTextHistory',
  allowUnclocked: true, atomicChoice: true, rememberOpenings: true, rememberReaffirmations: true,
  allowUnchanged: () => true, seedOpeningFromStoredValue: true,
};

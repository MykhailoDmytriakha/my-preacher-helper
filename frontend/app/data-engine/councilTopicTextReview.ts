import { hasRecordedCouncilTopicOutcome } from '@/utils/councilTopicOutcome';

import { COUNCIL_ASSEMBLY, councilAssemblyRow } from './councilAssemblyAction';
import { councilLifecycleValue, withCouncilLifecycle } from './councilFieldAction';
import { COUNCIL_OUTCOME, COUNCIL_OUTCOME_FIELDS, councilOutcomeRow } from './councilOutcomeAction';
import { councilOutcomeOptionAvailable, readCouncilOutcomeVersions } from './councilPrivateFields';
import { COUNCIL_TOPIC_KIND, councilTopicKindRow } from './councilTopicKindAction';
import { COUNCIL_TOPIC_TEXT, COUNCIL_TOPIC_TEXT_POLICY, COUNCIL_TOPIC_TEXT_QUEUED, COUNCIL_TOPIC_TEXT_SETTLED, councilTopicMissing, councilTopicTextConflict, councilTopicTextItemMissing, withoutCouncilTopicTextItem } from './councilTopicTextAction';
import { COUNCIL_TOPIC_ID, COUNCIL_TOPIC_SUMMARY_POLICY, COUNCIL_TOPIC_TITLE, councilTopicTitleRow } from './councilTopicTitleAction';
import { equalValues, object, readField, writeField } from './fieldValues';
import { mergeDocumentFields } from './protocol';
import { existingRowField, existingRowFields, replaceExistingRowField, rowConflictPath, rowConflictValue } from './rowFieldAction';
import { withQueuedRowFieldProofs } from './rowFieldAutosave';

import type { ActionTime } from './actionClock';
import type { CommitRequest } from './commits';
import type { GroupTextDecision } from './groupTextReview';
import type { RowFieldTarget } from './rowFieldAction';
import type { SessionCheckpoint } from './session';
import type { DocumentData, EditorCommitAction, ResourceSnapshot } from './types';

interface Address {
  field: 'question' | 'answer' | 'option' | 'summary' | 'topic-title';
  id: string;
  topicId: string;
  target: RowFieldTarget<string | null>;
  birthTarget: RowFieldTarget<string>;
}

function address(path: readonly string[]): Address | undefined {
  const nested = councilTopicTextConflict(path);
  if (nested) return { ...nested, target: COUNCIL_TOPIC_TEXT, birthTarget: COUNCIL_TOPIC_TEXT_POLICY.birth };
  const title = councilTopicTitleRow(path);
  if (title) return { field: 'topic-title', id: title, topicId: title, target: COUNCIL_TOPIC_TITLE, birthTarget: COUNCIL_TOPIC_ID };
  if (path.length !== 3 || path[0] !== 'topics' || !path[1].startsWith('id:') || path[2] !== 'summary') return undefined;
  const id = path[1].slice(3);
  return { field: 'summary', id, topicId: id, target: COUNCIL_TOPIC_SUMMARY_POLICY.target('summary'), birthTarget: COUNCIL_TOPIC_ID };
}

const scalars = { title: 'council-title', date: 'council-date', heldAt: 'council-lifecycle' } as const;

function councilDocumentTextVersions(path: string[], opening: DocumentData, draft: DocumentData, accepted: DocumentData) {
  const key = path[0] as keyof typeof scalars;
  if (path.length !== 1 || !Object.hasOwn(scalars, key)) return undefined;
  const read = (value: DocumentData) => {
    const selected = key === 'heldAt' ? councilLifecycleValue(value) : readField(value, path);
    return !selected ? undefined : !selected.exists ? null : typeof selected.value === 'string' ? selected.value : undefined;
  };
  const mine = read(draft), stored = read(accepted);
  if (mine === undefined || stored === undefined || read(opening) === undefined) return undefined;
  return { scope: 'document' as const, field: scalars[key], path, birth: null, mine, stored, removed: false as const };
}

function councilDetailVersions<T extends boolean | 'info' | 'decision'>(id: string, target: RowFieldTarget<T>,
  opening: DocumentData, draft: DocumentData, accepted: DocumentData) {
  const birth = existingRowField(opening.topics, id, COUNCIL_TOPIC_ID);
  if (!birth || existingRowField(draft.topics, id, COUNCIL_TOPIC_ID) !== birth
    || existingRowField(accepted.topics, id, COUNCIL_TOPIC_ID) !== birth || existingRowField(opening.topics, id, target) === undefined) return;
  const mine = existingRowField(draft.topics, id, target), stored = existingRowField(accepted.topics, id, target);
  return mine !== undefined && stored !== undefined ? { mine, stored, birth } : undefined;
}

export function councilTopicTextVersions(path: string[], opening: DocumentData, draft: DocumentData, accepted: DocumentData) {
  if (path.length === 1) return councilDocumentTextVersions(path, opening, draft, accepted);
  const assembly = councilAssemblyRow(path);
  if (assembly) {
    const versions = councilDetailVersions(assembly, COUNCIL_ASSEMBLY, opening, draft, accepted);
    return versions && { ...versions, scope: 'assembly' as const, field: 'assembly' as const, path, removed: false as const };
  }
  const kind = councilTopicKindRow(path);
  if (kind) {
    const openTopic = (value: DocumentData) => Array.isArray(value.topics) && value.topics.some(topic =>
      object(topic) && topic.id === kind && !hasRecordedCouncilTopicOutcome(topic));
    if (![opening, draft, accepted].every(openTopic)) return undefined;
    const versions = councilDetailVersions(kind, COUNCIL_TOPIC_KIND, opening, draft, accepted);
    return versions && { ...versions, scope: 'kind' as const, field: 'kind' as const, path, removed: false as const };
  }
  const outcome = councilOutcomeRow(path);
  if (outcome) {
    const versions = readCouncilOutcomeVersions(outcome, opening, draft, accepted);
    return versions && { scope: 'outcome' as const, field: 'outcome' as const, path, birth: outcome, removed: false as const, ...versions };
  }
  const field = address(path);
  if (!field) return undefined;
  const { id, target, birthTarget } = field;
  const birth = existingRowField(opening.topics, id, birthTarget);
  const read = (value: DocumentData) => existingRowField(value.topics, id, target);
  const mine = read(draft), stored = read(accepted);
  if (!birth || existingRowField(draft.topics, id, birthTarget) !== birth || mine === undefined) return undefined;
  const removedTopic = stored === undefined && councilTopicMissing(accepted.topics, field.topicId);
  const removed = removedTopic || (stored === undefined && councilTopicTextItemMissing(accepted.topics, id));
  if (!removed && (existingRowField(accepted.topics, id, birthTarget) !== birth || stored === undefined)) return undefined;
  return { ...field, scope: 'row' as const, path, birth, before: read(opening), mine, stored: stored ?? null,
    ...(removed && { removed: true as const }), ...(removedTopic && { removedTopic: true as const }) };
}

type ComparedField = NonNullable<ReturnType<typeof councilTopicTextVersions>>;

export function projectCouncilTopicText(value: DocumentData, field: ComparedField, side: 'mine' | 'stored'): DocumentData | undefined {
  if (field.scope === 'document') {
    const words = rowConflictValue(field[side]);
    return field.path[0] === 'heldAt' ? withCouncilLifecycle(value, words) : writeField(value, field.path, words);
  }
  if (field.scope === 'assembly' || field.scope === 'kind') {
    const topics = field.scope === 'assembly'
      ? replaceExistingRowField(value.topics, field.birth, field[side], COUNCIL_ASSEMBLY)
      : replaceExistingRowField(value.topics, field.birth, field[side], COUNCIL_TOPIC_KIND);
    return topics === undefined ? undefined : { ...value, topics };
  }
  if (field.scope === 'outcome') {
    const selected = field[side];
    if (side === 'mine' && !councilOutcomeOptionAvailable(value.topics, field.birth, selected)) return undefined;
    const topics = replaceExistingRowField(value.topics, field.birth, selected, COUNCIL_OUTCOME);
    return topics === undefined ? undefined : { ...value, topics };
  }
  if (field.removed) {
    if (side !== 'stored') return undefined;
    const rows = value.topics;
    const topics = field.removedTopic && Array.isArray(rows) ? rows.filter(topic => !object(topic) || topic.id !== field.topicId)
      : withoutCouncilTopicTextItem(rows, field.id);
    return topics === undefined ? undefined : { ...value, topics };
  }
  if (existingRowField(value.topics, field.id, field.birthTarget) !== field.birth
    || existingRowField(value.topics, field.id, field.target) === undefined) return undefined;
  const topics = replaceExistingRowField(value.topics, field.id, field[side], field.target);
  return topics === undefined ? undefined : { ...value, topics };
}

export function councilTopicTextDecision(field: ComparedField, side: GroupTextDecision['side'], time?: ActionTime | null): GroupTextDecision {
  const { path, birth, mine, stored } = field;
  return { path, birth, mine, stored, side, ...(time !== undefined && { time }), ...(field.removed && { removedBy: 'remote' }) };
}

function isNestedItemPath(path: readonly string[]): boolean {
  return path.length === 4 && path[0] === 'topics' && (path[2] === 'questions' || path[2] === 'options');
}

export function readCouncilTopicTextReview(checkpoint: SessionCheckpoint) {
  const { confirmed, remoteCandidate, conflicts, pending, groupTextReview } = checkpoint;
  const requests = Object.entries(pending).sort(([, first], [, second]) => first.generation - second.generation);
  const [requestId, first] = requests[0] ?? [];
  // The response belongs to the first submitted Save. Later work remains in the editor or in its own queue.
  const draft = first?.value;
  const opening = confirmed.value, stored = remoteCandidate?.value;
  if (confirmed.resource.collection !== 'councils' || !opening || !draft || !stored
    || !confirmed.metadata || confirmed.metadata.generation !== remoteCandidate?.metadata?.generation
    || !requestId || groupTextReview?.separateDraft || (groupTextReview && requestId !== groupTextReview.requestId)
    || !conflicts.some(({ path, code }) => councilTopicTextConflict(path) || councilTopicTitleRow(path) || isNestedItemPath(path)
      || code === COUNCIL_TOPIC_TEXT_SETTLED || code === COUNCIL_TOPIC_TEXT_QUEUED)) return undefined;

  const settled = new Map<string, { field: ComparedField; side: 'mine' | 'stored' }>();
  let proposed = writeField(writeField(draft, ['rev'], readField(opening, ['rev'])), ['updatedAt'], readField(opening, ['updatedAt']));
  for (const conflict of conflicts) {
    const side = conflict.code === COUNCIL_TOPIC_TEXT_SETTLED ? 'stored' : conflict.code === COUNCIL_TOPIC_TEXT_QUEUED ? 'mine' : undefined;
    if (!side) continue;
    const field = councilTopicTextVersions(conflict.path, opening, draft, stored);
    const header = field?.scope === 'row' && (field.field === 'summary' || field.field === 'topic-title');
    if (!field || field.removed || !equalValues(conflict.mine, rowConflictValue(field.mine))
      || (!header && !equalValues(conflict.theirs, rowConflictValue(field.stored)))) continue;
    settled.set(JSON.stringify(conflict.path), { field, side });
    if (side === 'stored') {
      const selected = projectCouncilTopicText(proposed, field, side);
      if (!selected) return undefined;
      proposed = selected;
    }
  }
  const merged = mergeDocumentFields(opening, proposed, stored);
  const paths = new Map([...conflicts, ...merged.conflicts].flatMap(({ path }) => {
    if (path.length === 2 && path[0] === 'topics' && path[1].startsWith('id:')
      && councilTopicMissing(stored.topics, path[1].slice(3))) {
      const oldWords = existingRowFields(opening.topics, COUNCIL_TOPIC_TEXT);
      const removed = [...existingRowFields(draft.topics, COUNCIL_TOPIC_TEXT)].flatMap(([id, words]) => {
        const nested = rowConflictPath(id, COUNCIL_TOPIC_TEXT);
        return nested[1] === path[1] && oldWords.has(id) && oldWords.get(id) !== words ? [nested] : [];
      });
      if (removed.length) return removed.map(nested => [JSON.stringify(nested), nested] as const);
    }
    if (isNestedItemPath(path)) {
      const fields = path[2] === 'questions' ? ['question', 'answer'] : ['text'];
      const removed = fields.flatMap(leaf => {
        const nested = [...path, leaf];
        const versions = councilTopicTextVersions(nested, opening, draft, stored);
        return versions?.removed && versions.mine !== existingRowField(opening.topics, versions.id, versions.target) ? [nested] : [];
      });
      if (removed.length) return removed.map(nested => [JSON.stringify(nested), nested] as const);
    }
    let normalized = path.length === 1 && path[0] === 'status' ? ['heldAt'] : path;
    if (path.length === 3 && path[0] === 'topics' && COUNCIL_OUTCOME_FIELDS.some(field => path[2] === field)) {
      normalized = [...path.slice(0, 2), 'outcome'];
    }
    return [[JSON.stringify(normalized), normalized] as const];
  }));
  const compared = [...paths].filter(([key]) => !settled.has(key)).map(([, path]) => councilTopicTextVersions(path, opening, draft, stored));
  if (compared.some(field => !field)) return undefined;
  const fields = compared.filter((field): field is ComparedField => field !== undefined && (field.removed === true || !equalValues(field.mine, field.stored)));
  const decisions = (groupTextReview?.decisions ?? []).filter(decision => fields.some(field =>
    equalValues(decision, councilTopicTextDecision(field, decision.side, decision.time))));
  const remaining = fields.filter(field => !decisions.some(decision => equalValues(decision.path, field.path)));
  return { requestId, fields, decisions, remaining, merged, settled: [...settled.values()] };
}

export function projectCouncilTopicTextDecisions(review: NonNullable<ReturnType<typeof readCouncilTopicTextReview>>,
  decisions: readonly GroupTextDecision[]): DocumentData | undefined {
  if (!review.merged.value.exists) return undefined;
  let value = review.merged.value.value as DocumentData | undefined;
  for (const { field, side } of review.settled) {
    if (!value) return undefined;
    value = projectCouncilTopicText(value, field, side);
  }
  for (const field of review.fields) {
    const decision = decisions.find(item => equalValues(item.path, field.path));
    if (!value || !decision) return undefined;
    value = projectCouncilTopicText(value, field, decision.side === 'local' ? 'mine' : 'stored');
  }
  return value;
}

export function readCouncilTopicTextComparison(checkpoint: SessionCheckpoint) {
  const review = readCouncilTopicTextReview(checkpoint);
  if (!review) return undefined;
  const field = review.remaining[0];
  const identity = JSON.stringify([checkpoint.editGeneration, checkpoint.remoteCandidate?.metadata, checkpoint.groupTextReview, field?.path, field?.mine, field?.stored]);
  if (!field) return { complete: true as const, identity };
  const topics = review.merged.value.exists && object(review.merged.value.value) && review.merged.value.value.topics;
  const localAvailable = field.scope !== 'outcome' || councilOutcomeOptionAvailable(topics, field.birth, field.mine);
  return { ...field, identity, localAvailable };
}

/** A confirmed deletion leaves the held words available without creating the topic again. */
export function retainedCouncilTopicWords(source: SessionCheckpoint, review: NonNullable<ReturnType<typeof readCouncilTopicTextReview>>) {
  const removed = new Set(review.fields.flatMap(field => field.scope === 'row' && field.removedTopic ? [field.topicId] : []));
  const opening = source.confirmed.value;
  const authored = source.pending[review.requestId]?.value;
  if (!removed.size || !opening || !Array.isArray(opening.topics) || !Array.isArray(authored?.topics)) return;
  const localTopics = new Map(authored.topics.flatMap(row => object(row) && typeof row.id === 'string' && removed.has(row.id)
    ? [[row.id, row] as const] : []));
  const topics = opening.topics.map(row => object(row) && typeof row.id === 'string' ? localTopics.get(row.id) ?? row : row);
  return { base: opening, value: { ...opening, topics } };
}

export function reviewedCouncilDetailAction(review: NonNullable<ReturnType<typeof readCouncilTopicTextReview>>,
  decisions: readonly GroupTextDecision[], confirmed: ResourceSnapshot, draft: DocumentData | null,
  request?: CommitRequest): EditorCommitAction | undefined {
  const metadata = confirmed.metadata;
  if (!metadata) return;
  const choices = review.fields.flatMap(field => {
    if (field.scope !== 'assembly' && field.scope !== 'kind') return [];
    const decision = decisions.find(item => item.side === 'local' && equalValues(item.path, field.path));
    return decision ? [{ field, decision }] : [];
  });
  if (choices.length > 1) throw Object.assign(new Error('Review the captured actions separately'), { code: 'decision-changed' });
  const chosen = choices[0];
  if (!chosen) {
    const flag = request?.councilAssemblyActions?.forAssembly;
    const topicKind = request?.councilTopicKindActions?.kind;
    const carries = <T extends boolean | 'info' | 'decision'>(captured: { rowId: string; rowCreatedAt: string; after: T }, target: RowFieldTarget<T>) =>
      existingRowField(draft?.topics, captured.rowId, COUNCIL_TOPIC_ID) === captured.rowCreatedAt
        && existingRowField(confirmed.value?.topics, captured.rowId, COUNCIL_TOPIC_ID) === captured.rowCreatedAt
        && existingRowField(draft?.topics, captured.rowId, target) === captured.after
        && existingRowField(confirmed.value?.topics, captured.rowId, target) !== captured.after;
    if (request?.baseline.metadata?.generation !== metadata.generation) return;
    if (flag && carries(flag, COUNCIL_ASSEMBLY)) return { kind: 'council-assembly', flag: { ...flag, generation: metadata.generation } };
    if (topicKind && carries(topicKind, COUNCIL_TOPIC_KIND)) return { kind: 'council-topic-kind', topicKind: { ...topicKind, generation: metadata.generation } };
    return;
  }
  const { field, decision } = chosen;
  const opening = { generation: metadata.generation, observedRevision: metadata.revision, rowId: field.birth, time: decision.time ?? null };
  return field.scope === 'assembly' ? { kind: 'council-assembly', flag: { ...opening, before: field.stored, after: field.mine } }
    : { kind: 'council-topic-kind', topicKind: { ...opening, before: field.stored, after: field.mine } };
}

/** A known incoming winner keeps its original proof when a different field held its packet. */
export function withQueuedCouncilTopicTextProofs(source: SessionCheckpoint, review: NonNullable<ReturnType<typeof readCouncilTopicTextReview>>): SessionCheckpoint {
  const queued = review.settled.flatMap(({ field, side }) => side === 'mine' && field.scope === 'row'
    ? [{ path: field.path, birth: field.birth, before: field.field === 'summary' || field.field === 'topic-title' ? field.before : undefined,
      mine: field.mine }] : []);
  return withQueuedRowFieldProofs(source, queued);
}

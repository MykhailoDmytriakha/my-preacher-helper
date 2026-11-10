import { SECTION_KEYS } from '@/utils/outlineDnd';

import type { DocumentData, Json, ResourceSnapshot } from '@/data-engine/types';
import type { SermonOutline } from '@/models/models';

const object = (value: unknown): value is DocumentData => value !== null && typeof value === 'object' && !Array.isArray(value);

export type OutlineNoteTarget = { kind: 'point' | 'subpoint'; id: string };
export type SermonNoteTarget = { kind: 'scratch'; id: string; createdAt: string } | OutlineNoteTarget;
export type OutlineNoteOpening = { target: OutlineNoteTarget; text: string | undefined };
export type OutlineTitleVersion = { generation: string; observedRevision: number };
export type OutlineTitleOpening = { target: OutlineNoteTarget; text: string; version?: OutlineTitleVersion };
export type SaveSermonNoteText = (text: string | undefined) => void | Promise<void>;
export type CaptureOutlineNote = (target: OutlineNoteTarget, text: string | undefined) => SaveSermonNoteText;

export type SermonNoteOpening = {
  sermonId: string;
  generation: string | null;
  legacyBirth?: string;
  pending: string[];
  target: SermonNoteTarget;
  text: string | null;
};

type RowText = { path: string[]; text: string | null };
type TextRow = { row: DocumentData; index: number; path: string[] };

function textRow(sermon: DocumentData, target: SermonNoteTarget): TextRow | undefined {
  const matches: TextRow[] = [];
  const add = (rows: Json | undefined, path: string[]) => {
    if (Array.isArray(rows)) rows.forEach((row, index) => {
      if (object(row) && row.id === target.id) matches.push({ row, index, path });
    });
  };
  if (target.kind === 'scratch') {
    add(sermon.scratch, ['scratch']);
  } else if (object(sermon.outline)) {
    for (const section of SECTION_KEYS) {
      const points = sermon.outline[section];
      add(points, ['outline', section]);
      if (Array.isArray(points)) points.forEach((point, index) => {
        if (object(point)) add(point.subPoints, ['outline', section, String(index), 'subPoints']);
      });
    }
  }
  const [match] = matches;
  return matches.length === 1 && (target.kind !== 'scratch' || match.row.createdAt === target.createdAt) ? match : undefined;
}

function readSermonRowText(sermon: DocumentData | null, target: SermonNoteTarget, leaf: 'text' | 'note'): RowText | undefined {
  const row = sermon && textRow(sermon, target);
  if (!row) return undefined;
  const text = row.row[leaf];
  if (text === undefined && leaf === 'note') return { path: [...row.path, String(row.index), leaf], text: null };
  return typeof text === 'string' ? { path: [...row.path, String(row.index), leaf], text } : undefined;
}

export function readSermonNoteText(sermon: DocumentData | null, target: SermonNoteTarget): RowText | undefined {
  return readSermonRowText(sermon, target, target.kind === 'scratch' ? 'text' : 'note');
}

/** Replace only the exact text field in the current row tree. */
function withSermonRowText(sermon: DocumentData | null, target: SermonNoteTarget, leaf: 'text' | 'note', text: string | null): DocumentData | undefined {
  const field = readSermonRowText(sermon, target, leaf);
  if (!sermon || !field || (leaf === 'text' && text === null)) return undefined;
  if (field.text === text) return sermon;
  const write = (value: Json, [key, ...rest]: string[]): Json => {
    if (Array.isArray(value)) return value.map((row, index) => index === Number(key) ? write(row, rest) : row);
    const copy = { ...(value as DocumentData) };
    if (rest.length) copy[key] = write(copy[key], rest);
    else if (text === null) delete copy[key];
    else copy[key] = text;
    return copy;
  };
  return write(sermon, field.path) as DocumentData;
}

export function withSermonNoteText(sermon: DocumentData | null, target: SermonNoteTarget, text: string | null): DocumentData | undefined {
  return withSermonRowText(sermon, target, target.kind === 'scratch' ? 'text' : 'note', text);
}

export function readOutlineTitleText(outline: SermonOutline | null, target: OutlineNoteTarget): string | undefined {
  if (!outline) return undefined;
  return readSermonRowText({ outline: outline as unknown as Json }, target, 'text')?.text ?? undefined;
}

export function outlineTitleField(outline: SermonOutline | null, target: OutlineNoteTarget, root: 'outline' | 'structure') {
  if (!outline) return undefined;
  const row = textRow({ outline: outline as unknown as Json }, target);
  if (!row || typeof row.row.text !== 'string') return undefined;
  const section = row.path[1] as keyof SermonOutline;
  const id = 'id:' + target.id;
  const path = row.path.length === 2 ? [root, section, id, 'text']
    : [root, section, 'id:' + outline[section][Number(row.path[2])].id, 'subPoints', id, 'text'];
  return { path, text: row.row.text };
}

export function withOutlineTitleText(outline: SermonOutline, target: OutlineNoteTarget, title: string): SermonOutline | undefined {
  const value = withSermonRowText({ outline: outline as unknown as Json }, target, 'text', title);
  return value?.outline as unknown as SermonOutline | undefined;
}

export function readOutlineNoteText(outline: SermonOutline | null, target: OutlineNoteTarget) {
  return outline ? readSermonNoteText({ outline: outline as unknown as Json }, target) : undefined;
}

export function withOutlineNoteText(outline: SermonOutline, target: OutlineNoteTarget, text: string | undefined): SermonOutline | undefined {
  const value = withSermonNoteText({ outline: outline as unknown as Json }, target, text ?? null);
  return value?.outline as unknown as SermonOutline | undefined;
}

const conflictRowId = (segment?: string) => segment?.startsWith('id:') ? segment.slice(3) : undefined;

function outlineTextConflictTarget(path: readonly string[], field: 'note' | 'text'): OutlineNoteTarget | undefined {
  const [root, section, point, children, subpoint, leaf] = path;
  const parentId = conflictRowId(point);
  if ((root !== 'outline' && (field !== 'text' || root !== 'structure')) || !SECTION_KEYS.some(key => key === section) || !parentId) return undefined;
  if (path.length === 4 && children === field) return { kind: 'point', id: parentId };
  const id = conflictRowId(subpoint);
  if (path.length === 6 && children === 'subPoints' && leaf === field && id) return { kind: 'subpoint', id };
}

export function outlineTitleConflictTarget(path: readonly string[]) {
  return outlineTextConflictTarget(path, 'text');
}

export function sermonNoteConflictTarget(path: readonly string[]): { kind: 'scratch'; id: string } | OutlineNoteTarget | undefined {
  const [root, row, field] = path;
  if (root === 'scratch' && path.length === 3 && field === 'text') {
    const id = conflictRowId(row);
    return id ? { kind: 'scratch', id } : undefined;
  }
  return outlineTextConflictTarget(path, 'note');
}

/** Return a scoped choice only for the same live note on both sides. */
export function sermonNoteConflictText(path: readonly string[], mine: DocumentData, stored: DocumentData) {
  const field = sermonNoteConflictTarget(path);
  if (!field) return undefined;
  const row = field.kind === 'scratch' && Array.isArray(stored.scratch)
    ? stored.scratch.find(value => object(value) && value.id === field.id) : undefined;
  const birth = object(row) && typeof row.createdAt === 'string' ? row.createdAt : undefined;
  let target: SermonNoteTarget;
  if (field.kind === 'scratch') {
    if (birth === undefined) return undefined;
    target = { ...field, createdAt: birth };
  } else {
    target = field;
  }
  const local = readSermonNoteText(mine, target), remote = readSermonNoteText(stored, target);
  if (!local || !remote || local.text === remote.text) return undefined;
  return { target, mine: local.text ?? undefined, stored: remote.text ?? undefined };
}

export function matchesSermonNoteOpening(snapshot: ResourceSnapshot, opening: SermonNoteOpening): boolean {
  const generation = snapshot.metadata?.generation ?? null;
  const firstShownWrite = opening.generation === null && generation !== null
    && (opening.pending.includes(generation) || (opening.legacyBirth !== undefined && snapshot.value?.createdAt === opening.legacyBirth));
  return snapshot.resource.collection === 'sermons' && snapshot.resource.id === opening.sermonId && !snapshot.metadata?.deleted
    && (generation === opening.generation || firstShownWrite);
}

export function sermonNoteChanged() {
  return Object.assign(new Error('The note opened for editing is no longer available'), { code: 'decision-changed' });
}

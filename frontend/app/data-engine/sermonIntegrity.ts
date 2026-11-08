import { serializeContent } from '@/utils/contentFingerprint';

import { PREACH_DATE_TARGET } from './datedRowAction';
import { PREACH_STATUS_TARGET } from './preachStatusAction';
import { existingRowFields, rowConflictPath, rowConflictValue } from './rowFieldAction';

import type { ConflictDetail, DocumentData, FieldChange, Json } from './types';

const sections = ['introduction', 'main', 'conclusion', 'ambiguous'] as const;
const object = (value: Json | undefined): value is DocumentData => value !== null && typeof value === 'object' && !Array.isArray(value);
const rows = (value: Json | undefined): DocumentData[] => Array.isArray(value) ? value.filter(object) : [];
const key = (...parts: unknown[]) => JSON.stringify(parts);

/** Compare structural defects, so untouched legacy inconsistencies stay repairable. */
function brokenLinks(value: DocumentData): Set<string> {
  const defects = new Set<string>();
  const outline = object(value.outline) ? value.outline : {};
  const points = new Map(sections.flatMap(section => rows(outline[section])).map(point => [point.id, point]));
  const thoughts = rows(value.thoughts);
  const thoughtIds = new Set(thoughts.map(thought => thought.id));
  for (const thought of thoughts) {
    const point = points.get(thought.outlinePointId ?? '');
    if (thought.outlinePointId && !point) defects.add(key('point', thought.id, thought.outlinePointId));
    if (thought.subPointId && !rows(point?.subPoints).some(sub => sub.id === thought.subPointId)) {
      defects.add(key('subpoint', thought.id, thought.outlinePointId, thought.subPointId));
    }
  }
  addPlacementDefects(value, thoughtIds, defects);
  return defects;
}

function addPlacementDefects(value: DocumentData, thoughtIds: Set<Json>, defects: Set<string>): void {
  for (const field of ['structure', 'thoughtsBySection']) {
    const placement = object(value[field]) ? value[field] : {};
    const seen = new Map<Json, number>();
    for (const section of sections) {
      const ids = Array.isArray(placement[section]) ? placement[section] : [];
      for (const id of ids) {
        if (!thoughtIds.has(id)) defects.add(key('missing-thought', field, section, id));
        const count = (seen.get(id) ?? 0) + 1;
        if (count > 1) defects.add(key('duplicate-placement', field, id, count));
        seen.set(id, count);
      }
    }
  }
}

/** Runs on the merged document, inside the same command transaction as its write. */
export function preservesSermonLinks(previous: DocumentData | null, candidate: DocumentData): boolean {
  const existing = previous ? brokenLinks(previous) : new Set<string>();
  return [...brokenLinks(candidate)].every(defect => existing.has(defect));
}

/** Moving scratch content into an outline consumes the exact source, not merely its ID. */
export function scratchConsumptionConflicts(changes: FieldChange[], current: DocumentData): ConflictDetail[] {
  if (!changes.some(change => change.path[0] === 'outline')) return [];
  const scratch = changes.find(change => change.path[0] === 'scratch');
  if (!scratch) return [];
  const retained = new Set(rows(scratch.after.value).map(note => note.id));
  const live = rows(current.scratch);
  return rows(scratch.before.value).filter(note => !retained.has(note.id)).flatMap(note => {
    const found = live.find(item => item.id === note.id);
    if (found && serializeContent(found) === serializeContent(note)) return [];
    return [{ path: ['scratch', String(note.id)], base: { exists: true, value: note }, mine: { exists: false },
      theirs: found ? { exists: true, value: found } : { exists: false } }];
  });
}


/** Two individually valid saves cannot combine an empty day with an already recorded preaching. */
export function recordedPreachDayConflicts(change: FieldChange, candidate: DocumentData, previous: DocumentData): ConflictDetail[] {
  const days = existingRowFields(candidate.preachDates, PREACH_DATE_TARGET);
  const statuses = existingRowFields(candidate.preachDates, PREACH_STATUS_TARGET);
  const ours = existingRowFields(change.after.value, PREACH_DATE_TARGET);
  const ourStatuses = existingRowFields(change.after.value, PREACH_STATUS_TARGET);
  const stored = existingRowFields(previous.preachDates, PREACH_DATE_TARGET);
  const observed = existingRowFields(change.before.value, PREACH_DATE_TARGET);
  return [...days].flatMap(([id, day]) => {
    const mine = ours.get(id), theirs = stored.get(id);
    if (day !== '' || statuses.get(id) !== 'preached' || mine === undefined || theirs === undefined || mine === theirs
      || (mine === '' && ourStatuses.get(id) === 'preached')) return [];
    return [{ path: rowConflictPath(id, PREACH_DATE_TARGET), base: rowConflictValue(observed.get(id) ?? null),
      mine: rowConflictValue(mine), theirs: rowConflictValue(theirs) }];
  });
}

import type { DocumentData, Json } from './types';

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

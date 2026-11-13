import { isBibleId } from '@/utils/bibles';
import { serializeContent } from '@/utils/contentFingerprint';
import { sameAuthoredScriptureReference } from '@/utils/scriptureReferenceNumbering';

import type { ScriptureRefShape } from '@/utils/scriptureReference';

type ReferenceRow = { id: string };

function authoredPlace(value: ReferenceRow): ScriptureRefShape | undefined {
  if (!('book' in value) || typeof value.book !== 'string' || !('bible' in value) || !isBibleId(value.bible)) return undefined;
  return value as ReferenceRow & ScriptureRefShape;
}

function samePlace(left: ReferenceRow, right: ReferenceRow): boolean {
  const a = authoredPlace(left), b = authoredPlace(right);
  return Boolean(a && b && sameAuthoredScriptureReference(a, b));
}

/** A reviewed move into an already saved place keeps that place's identity and slot.
 * Only an unambiguous move into an unchanged neighbor is projected this way.
 */
export function projectStudyNoteReferenceChoice<Row extends ReferenceRow>(mine: Row[], stored: Row[], accepted: Row[]) {
  const local = new Map(mine.map(row => [row.id, row]));
  const saved = new Map(stored.map(row => [row.id, row]));
  const confirmed = new Map(accepted.map(row => [row.id, row]));
  const collapsed = new Map<string, Row>();
  if (local.size !== mine.length || saved.size !== stored.length || confirmed.size !== accepted.length) return { references: mine, collapsed };
  const moves = mine.flatMap(row => {
    const opening = saved.get(row.id);
    if (!opening || !authoredPlace(opening) || samePlace(row, opening)) return [];
    const neighbors = stored.filter(other => other.id !== row.id && samePlace(row, other));
    if (neighbors.length !== 1) return [];
    const neighbor = neighbors[0];
    const expected = serializeContent(neighbor);
    if (serializeContent(local.get(neighbor.id)) !== expected || serializeContent(confirmed.get(neighbor.id)) !== expected) return [];
    return [{ source: row, target: neighbor }];
  });
  const replaced = new Map<string, Row>();
  const removed = new Set<string>();
  for (const { source, target } of moves) {
    if (moves.some(move => move.target === target && move.source !== source)) continue;
    replaced.set(target.id, { ...source, id: target.id });
    removed.add(source.id);
    if (serializeContent({ ...source, id: target.id }) === serializeContent(target)) collapsed.set(source.id, source);
  }
  const references = removed.size ? mine.flatMap(row => removed.has(row.id) ? [] : replaced.get(row.id) ?? row) : mine;
  return { references, collapsed };
}

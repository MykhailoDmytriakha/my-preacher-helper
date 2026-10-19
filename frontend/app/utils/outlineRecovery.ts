import { getSectionLabel } from '@lib/sections';

import { flattenPoints } from './outlineFlatten';

import type { SermonOutline } from '@/models/models';

const SECTIONS = ['introduction', 'main', 'conclusion'] as const;
const POINT_FIELDS = new Set(['id', 'text', 'note', 'isReviewed', 'subPoints']);
const SUBPOINT_FIELDS = new Set(['id', 'text', 'note', 'position']);
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Read the whole known shape or leave it whole; unknown authored evidence must never vanish. */
function isCompleteOutline(value: unknown): value is SermonOutline {
  if (!isRecord(value) || Object.keys(value).some(key => !SECTIONS.some(section => section === key))) return false;
  const ids = new Set<string>();
  const point = (node: unknown, subpoint: boolean): boolean => {
    if (!isRecord(node) || typeof node.id !== 'string' || !node.id || ids.has(node.id)
      || typeof node.text !== 'string' || (node.note !== undefined && typeof node.note !== 'string')
      || Object.keys(node).some(key => !(subpoint ? SUBPOINT_FIELDS : POINT_FIELDS).has(key))) return false;
    ids.add(node.id);
    if (subpoint) return typeof node.position === 'number' && Number.isFinite(node.position);
    return (node.isReviewed === undefined || typeof node.isReviewed === 'boolean')
      && (node.subPoints === undefined || (Array.isArray(node.subPoints) && node.subPoints.every(child => point(child, true))));
  };
  return SECTIONS.every(section => Array.isArray(value[section]) && value[section].every(node => point(node, false)));
}

/** A display lens only: canonical section names and point order, without storage identities. */
export function outlineRecoveryValue(t: (key: string) => string, value: unknown): unknown {
  if (!isCompleteOutline(value)) return value;
  return SECTIONS.map(section => {
    const lines = flattenPoints(value[section]).flatMap(row => {
      const indent = '  '.repeat(row.depth);
      const words = [`${indent}- ${row.text.replaceAll('\n', `\n${indent}  `)}`];
      if (row.note !== undefined) words.push(`${indent}  ${row.note.replaceAll('\n', `\n${indent}  `)}`);
      if (row.isReviewed !== undefined) words.push(`${indent}  ${t(row.isReviewed ? 'structure.markedAsReviewed' : 'structure.markedAsUnreviewed')}`);
      return words;
    });
    return [getSectionLabel(t, section), ...lines].join('\n');
  }).join('\n\n');
}

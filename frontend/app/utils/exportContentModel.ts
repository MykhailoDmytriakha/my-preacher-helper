import {
  getVisualOrderedThoughtsBySection,
  getVisualSectionOutlinePoints,
  normalizeVisualSectionKey,
  VISUAL_SECTION_ORDER,
} from '@/utils/sermonVisualOrder';
import { isStructureTag, normalizeStructureTag } from '@/utils/structureTags';

import type { Sermon, SubPoint, Thought, ThoughtsBySection } from '@/models/models';
import type { VisualSectionKey } from '@/utils/sermonVisualOrder';

type OutlineBlock = { type: 'outline'; title: string; subPoints: SubPoint[]; thoughts: Thought[] };
type LooseBlock = { type: 'loose'; label: 'multipleTagsThoughts' | 'unassignedThoughts' | null; thoughts: Thought[] };
export type ExportBlock = OutlineBlock | LooseBlock;
export interface ExportSection { key: VisualSectionKey; blocks: ExportBlock[] }

const byDate = (a: Thought, b: Thought) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime();
const TAG_ORDER = { intro: 0, main: 1, conclusion: 2 };

/** Loose legacy thoughts retain structure order, then tag/date fallback. */
function orderLooseThoughts(thoughts: Thought[], structure: ThoughtsBySection | undefined, section: VisualSectionKey): Thought[] {
  const ids = section === 'ambiguous' ? undefined : structure?.[section];
  if (ids?.length) {
    const byId = new Map(thoughts.map(thought => [thought.id, thought]));
    const ordered = ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
    const used = new Set(ordered.map(thought => thought.id));
    return [...ordered, ...thoughts.filter(thought => !used.has(thought.id)).sort(byDate)];
  }
  return [...thoughts].sort((a, b) => {
    const tagA = a.tags?.map(normalizeStructureTag).find(tag => tag !== null);
    const tagB = b.tags?.map(normalizeStructureTag).find(tag => tag !== null);
    if (tagA && tagB && tagA !== tagB) return TAG_ORDER[tagA] - TAG_ORDER[tagB];
    if (tagA && !tagB) return -1;
    if (!tagA && tagB) return 1;
    return byDate(a, b);
  });
}

function buildSection(sermon: Sermon, key: VisualSectionKey): ExportSection {
  const thoughts = getVisualOrderedThoughtsBySection(sermon, key);
  const blocks: ExportBlock[] = [];
  const multipleTags: Thought[] = [];
  const remaining: Thought[] = [];
  for (const thought of thoughts) {
    ((thought.tags?.filter(isStructureTag).length ?? 0) > 1 ? multipleTags : remaining).push(thought);
  }
  if (multipleTags.length) blocks.push({ type: 'loose', label: 'multipleTagsThoughts', thoughts: multipleTags.sort(byDate) });

  const points = new Map(getVisualSectionOutlinePoints(sermon, key).map(point => [point.id, point]));
  if (!points.size) {
    if (remaining.length) blocks.push({ type: 'loose', label: null, thoughts: orderLooseThoughts(remaining, sermon.structure, key) });
    return { key, blocks };
  }

  const assigned = new Map<string, Thought[]>();
  const loose: Thought[] = [];
  for (const thought of remaining) {
    if (thought.outlinePointId && points.has(thought.outlinePointId)) {
      const group = assigned.get(thought.outlinePointId) ?? [];
      group.push(thought);
      assigned.set(thought.outlinePointId, group);
    } else loose.push(thought);
  }
  for (const point of points.values()) {
    const pointThoughts = assigned.get(point.id);
    // The canonical visual-order owner already ordered these distinct thoughts.
    // Sorting again by their index in the same array cannot change that order.
    if (pointThoughts?.length) blocks.push({ type: 'outline', title: point.text, subPoints: point.subPoints ?? [], thoughts: pointThoughts });
  }
  if (loose.length) blocks.push({ type: 'loose', label: 'unassignedThoughts', thoughts: orderLooseThoughts(loose, sermon.structure, key) });
  return { key, blocks };
}

/** Content organization is independent of language and output format, and never mutates the sermon. */
export function buildExportSections(sermon: Sermon, focusedSection?: string): ExportSection[] {
  if (!sermon.title.trim()) return [];
  const focus = normalizeVisualSectionKey(focusedSection);
  const keys = focusedSection ? (focus ? [focus] : []) : VISUAL_SECTION_ORDER;
  return keys.map(key => buildSection(sermon, key)).filter(section => section.blocks.length > 0);
}

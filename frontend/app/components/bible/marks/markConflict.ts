import { mergeVerseLayer, readVerseLayerSpans, type VerseMarkLayer } from '@/utils/bibleMarkLayers';

import { markLocation, markName } from './markPresentation';

import type { ConflictDetail } from '@/data-engine/types';
import type { BookText } from '@/utils/bibleText';
import type { TFunction } from 'i18next';

const isVerse = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function layersOf({ path, base, mine, theirs }: ConflictDetail): { layer: VerseMarkLayer; values: unknown[] }[] | null {
  if (path[0] !== 'verses' || !/^v[0-9]+_[0-9]+$/.test(path[1] ?? '')) return null;
  const values = [base, mine, theirs].map(side => side.exists ? side.value : undefined);
  if (path.length === 3 && (path[2] === 'm' || path[2] === 'p')) return [{ layer: path[2], values }];
  if (path.length !== 2 || !values.every(value => value === undefined || isVerse(value))) return null;
  return (['m', 'p'] as const).map(layer => ({ layer, values: values.map(value => isVerse(value) ? value[layer] : undefined) }));
}

/** Show the differences between the actual alternatives, using the same layer reader as the merge. */
export function describeMarkConflict(conflicts: readonly ConflictDetail[], text: BookText | null, t: TFunction) {
  const mine: string[] = [], stored: string[] = [];
  for (const conflict of conflicts) {
    const layers = layersOf(conflict);
    if (!layers) return null;
    for (const { layer, values } of layers) {
      const [base, local, saved] = values;
      // Keeping local marks still merges an independent saved mark when the layer has no overlap.
      const merged = mergeVerseLayer(layer, base, local, saved);
      const spans = readVerseLayerSpans(layer, [merged ? merged.value : local, saved]);
      if (!spans) return null;
      const tool = layer === 'm' ? 'bible.marks.marker' : 'bible.marks.pencil';
      for (const { first, last, colours: [localColour, storedColour] } of spans) {
        if (localColour === storedColour) continue;
        const { verse, words } = markLocation(conflict.path[1], first, last, text);
        const location = verse + ' · ' + (words || t('bible.marks.words', { first: first + 1, last: last + 1 }));
        mine.push(location + ' · ' + t(tool, { meaning: markName(t, localColour ?? null) }));
        stored.push(location + ' · ' + t(tool, { meaning: markName(t, storedColour ?? null) }));
      }
    }
  }
  return mine.length ? { mine: mine.join('\n'), stored: stored.join('\n') } : null;
}

import { normalizeWord } from '@/utils/bibleSearch/words';

import index from './wordForOccasionIndex.json';

import type { ScriptureRefShape } from '@/utils/scriptureReference';

/**
 * WORD FOR THE OCCASION — the Scripture places for a person's situation: afraid, sick, bereaved,
 * lonely. A section of the pastor's plane (`/care/word`).
 *
 * WHERE THE PLACES COME FROM. The Gideons print an index at the front of their Bibles — a life
 * situation and the places to read in it. Ten such indexes of five countries (`OCCASION_SOURCES`)
 * were merged into one: every situation once, every place any index names for it once. A heading
 * merged with another only where no index keeps the two apart ("Anxiety" and "Worried" stay two,
 * as the Gideons print them); a place printed at different lengths (John 11:25, 11:25-26,
 * 11:25-27) is one place. The work, the sources and the checks — case 2026-11-10-slovo-na-sluchai,
 * `research/merge.ts`, exported by `research/export-app.py`.
 *
 * THREE KINDS, ALL OF THEM. Besides life situations the Gideons print virtues ("Patience",
 * "Humility") and points of doctrine ("Christ's birth", "Heaven"). The owner wants every one of
 * them (2026-11-10): asked "where is it written?", the pastor opens the topic and has the places
 * gathered. The kind only groups the index; it changes nothing else.
 *
 * NO WORDS BUT SCRIPTURE. The app gives the situation's name and the places, never a comment, a
 * prayer or a formula: the owner's rule for the plane is a skeleton, not ready-made theology.
 *
 * THE NUMBERS ARE THE KING JAMES'S, as the indexes print them (`bible: 'kjv'`). A screen shows a
 * place in the reader's Bible through `utils/scriptureReferenceNumbering` and never renumbers it
 * here: the Gideons' "Psalm 23" is the Synodal "Пс 22".
 */

export type OccasionPlace = ScriptureRefShape & {
  bible: 'kjv';
  chapter: number;
  /** How many of the indexes name this place: 1 to 10. */
  sources: number;
};

/** Which kind of the Gideons' index a topic comes from: a life situation, a virtue, a point of doctrine. */
export type OccasionKind = 'situation' | 'virtue' | 'teaching';

/** The order the kinds stand on the screen: the situations a visit meets first. */
export const OCCASION_KINDS: readonly OccasionKind[] = ['situation', 'virtue', 'teaching'];

export type Occasion = { id: string; kind: OccasionKind; places: readonly OccasionPlace[] };

export type OccasionSource = { id: string; country: string; title: string; url: string };

export const OCCASIONS: readonly Occasion[] = index.occasions.map((occasion) => ({
  id: occasion.id,
  kind: occasion.kind as OccasionKind,
  places: occasion.places.map((place) => ({ ...place, bible: 'kjv' as const })),
}));

export const OCCASION_SOURCES: readonly OccasionSource[] = index.sources;

const BY_ID = new Map(OCCASIONS.map((occasion) => [occasion.id, occasion]));

export const occasionById = (id: string): Occasion | undefined => BY_ID.get(id);

/** The locale key of a topic's name: `careWord.topics.<id>` in all three languages. */
export const occasionNameKey = (id: string): string => `careWord.topics.${id}`;

/**
 * Does a situation's name answer what a person typed: any word of the name starts with the
 * typed text, or the name contains it — letters folded as the Bible search folds them (case, ё).
 */
export function occasionNameMatches(name: string, typed: string): boolean {
  const query = normalizeWord(typed.trim());
  if (!query) return true;
  return normalizeWord(name).includes(query);
}

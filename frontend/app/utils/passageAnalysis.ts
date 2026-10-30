import { verseWords, type BookText } from '@/utils/bibleText';

/**
 * A PASSAGE'S ANALYSIS — a block diagram (case 2026-10-12-block-diagram, 3.4; the owner's choice on the canvas «Разбор
 * структуры», 2026-10-29). The passage's words are cut into parts, one part a line; a part hangs on one word of another
 * part and stands one step deeper than that part. The indent alone says «I belong to the line above me»; an arrow is
 * drawn only where it does not. Every rule of the editor is here, so the screen and the tests read one rule.
 *
 * A part is named by the word it starts at. The first part starts at word 0 and is never a cut.
 */

/** One word of the passage, as the reader has it, with the verse it stands in and its place there (`at`, from 0). */
export type AnalysisWord = { text: string; chapter: number; verse: number; startsVerse: boolean; at: number };

/** Which way a link of meaning points: 'fwd' — from its earlier word to the later, 'back' — the other way, or both, or none. */
export type RelationDir = 'fwd' | 'back' | 'both' | 'none';
export const RELATION_DIRS: readonly RelationDir[] = ['fwd', 'back', 'both', 'none'];
/** Each link of meaning its own colour (the owner, 2026-10-30): the next one free is given, the menu changes it. */
export const RELATION_COLORS = ['amber', 'teal', 'pink', 'sky', 'lime', 'violet'] as const;
export type RelationColor = (typeof RELATION_COLORS)[number];
/**
 * A link of meaning between two words of the passage (the owner, 2026-10-30: «есть связь первого слова, а есть связь
 * между словами»): unlike a tie it sets no step — it says that two words belong together. `a` stands before `b`.
 */
export type Relation = { a: number; b: number; dir: RelationDir; color: RelationColor };

/**
 * The parts and what they hang on: `cuts` — the words parts start at (sorted, never 0); `links` — part → word;
 * `relations` — the links of meaning, by their words, in the passage's order.
 */
export type AnalysisState = { cuts: number[]; links: Record<number, number>; relations: Relation[] };

/** A passage of one book: from `chapter:fromVerse` to `toChapter:toVerse`. */
export type AnalysisPassage = { chapter: number; fromVerse: number; toChapter: number; toVerse: number };

export const EMPTY_ANALYSIS: AnalysisState = { cuts: [], links: {}, relations: [] };

/** The words of a passage in the Bible being read, in order. */
export function passageWords(text: BookText, passage: AnalysisPassage): AnalysisWord[] {
  const words: AnalysisWord[] = [];
  for (let chapter = passage.chapter; chapter <= passage.toChapter; chapter += 1) {
    const verses = text.chapters[chapter - 1] ?? [];
    const first = chapter === passage.chapter ? passage.fromVerse : 1;
    const last = chapter === passage.toChapter ? passage.toVerse : verses.length;
    for (let verse = first; verse <= last; verse += 1) {
      const raw = verses[verse - 1];
      if (raw === undefined) continue;
      verseWords(raw).split(/\s+/).filter(Boolean).forEach((word, k) => words.push({ text: word, chapter, verse, startsVerse: k === 0, at: k }));
    }
  }
  return words;
}

/** The words parts start at, the first part included. */
export function partStarts(state: AnalysisState): number[] {
  return [0, ...state.cuts];
}

/** The part a word stands in. */
export function partOf(state: AnalysisState, word: number): number {
  let at = 0;
  for (const start of partStarts(state)) if (start <= word) at = start;
  return at;
}

/** The word after a part's last word. */
export function partEnd(state: AnalysisState, start: number, total: number): number {
  const next = state.cuts.find((cut) => cut > start);
  return next ?? total;
}

/** The part a part hangs on, or null — it hangs on nothing. */
export function holderOf(state: AnalysisState, start: number): number | null {
  const word = state.links[start];
  return word === undefined ? null : partOf(state, word);
}

/** The parts above a part, nearest first, up to one that hangs on nothing. A loop stops the walk. */
export function holdersOf(state: AnalysisState, start: number): number[] {
  const out: number[] = [];
  let holder = holderOf(state, start);
  while (holder !== null && holder !== start && !out.includes(holder)) {
    out.push(holder);
    holder = holderOf(state, holder);
  }
  return out;
}

/** Whether part `a` hangs, directly or through others, on part `b`. */
export function hangsOn(state: AnalysisState, a: number, b: number): boolean {
  return holdersOf(state, a).includes(b);
}

/** The parts that hang directly on a part, in the passage's order. */
export function partsOn(state: AnalysisState, start: number): number[] {
  return partStarts(state).filter((part) => holderOf(state, part) === start);
}

/** How many steps right a part stands. */
export function depthOf(state: AnalysisState, start: number): number {
  return holdersOf(state, start).length;
}

/**
 * The state with every link that no longer means anything taken out: from a word that no longer starts a part, to a
 * word of its own part, or around a loop; a link of meaning past the passage's end or the second on the same two words.
 * A cut removed or a word count changed can leave such links behind.
 */
export function settled(state: AnalysisState, total: number): AnalysisState {
  const cuts = [...new Set(state.cuts)].filter((cut) => cut > 0 && cut < total).sort((a, b) => a - b);
  const base: AnalysisState = { cuts, links: {}, relations: settledRelations(state.relations, total) };
  const starts = new Set(partStarts(base));
  Object.entries(state.links).forEach(([key, word]) => {
    const start = Number(key);
    if (starts.has(start) && word >= 0 && word < total && partOf(base, word) !== start) base.links[start] = word;
  });
  Object.keys(base.links).forEach((key) => {
    const start = Number(key);
    let holder = holderOf(base, start);
    const seen = new Set<number>();
    while (holder !== null && !seen.has(holder)) {
      if (holder === start) { delete base.links[start]; break; }
      seen.add(holder);
      holder = holderOf(base, holder);
    }
  });
  return base;
}

/** The step of a new line, as the two marks over a word say it: ↵ — the same as the line it is cut from; ↳ — under it. */
export type CutLevel = 'same' | 'under';

/**
 * A part begun at `word`. `level` is the mark pressed (the owner, 2026-10-29): 'under' — the new part hangs on the first
 * word of the part it was cut from, one step under it; 'same', or no mark (dividing at commas) — it keeps that part's
 * holder. Null — nothing to cut there.
 */
export function cutAt(state: AnalysisState, word: number, total: number, level: CutLevel = 'same'): AnalysisState | null {
  const part = partOf(state, word);
  if (word <= 0 || word >= total || word === part) return null;
  const links = { ...state.links };
  if (level === 'under') links[word] = part;
  else if (state.links[part] !== undefined) links[word] = state.links[part];
  return settled({ ...state, cuts: [...state.cuts, word], links }, total);
}

/** The part begun at `start` glued back to the part before it. */
export function glueAt(state: AnalysisState, start: number, total: number): AnalysisState {
  return settled({ ...state, cuts: state.cuts.filter((cut) => cut !== start) }, total);
}


/** Why a part cannot be tied where it was dropped: on a word of its own. */
export type TieRefusal = 'own';

/**
 * Part `start` tied to `word`: it now hangs on that word's part. A word of its own part is refused. A word of a part that
 * hangs on it turns the tie round (the owner, 2026-10-29: «а всякий дух» dropped on «который не исповедует», which stood
 * under it — «он должен был выровняться»): that part takes `start`'s place, hanging where `start` hung, and `start`
 * hangs on its word; what hung on either stays with it.
 */
export function tieTo(state: AnalysisState, start: number, word: number, total: number): AnalysisState | TieRefusal {
  const target = partOf(state, word);
  if (target === start) return 'own';
  const links = { ...state.links, [start]: word };
  if (hangsOn(state, target, start)) {
    if (state.links[start] === undefined) delete links[target];
    else links[target] = state.links[start];
  }
  return settled({ ...state, links }, total);
}

/** Whether tying part `start` to `word` turns the tie round: that word's part hangs on `start` now. */
export function tieTurns(state: AnalysisState, start: number, word: number): boolean {
  const target = partOf(state, word);
  return target !== start && hangsOn(state, target, start);
}


/**
 * Part `start` one step up, by the arrow at its number (the owner, 2026-10-29): it hangs on what its holder hangs on —
 * 2.2 becomes 3. Only that part moves: what hangs on it goes along, its neighbours stay where they hang. Null — it
 * already hangs on nothing.
 */
export function stepUp(state: AnalysisState, start: number, total: number): AnalysisState | null {
  const holder = holderOf(state, start);
  if (holder === null) return null;
  const links = { ...state.links };
  if (state.links[holder] === undefined) delete links[start];
  else links[start] = state.links[holder];
  return settled({ ...state, links }, total);
}

/** Part `start` one step down: it hangs on the nearest part above it that stands as deep — 2 becomes 1.1. Null — none. */
export function stepDown(state: AnalysisState, start: number, total: number): AnalysisState | null {
  const depth = depthOf(state, start);
  const above = partStarts(state).filter((part) => part < start);
  for (let n = above.length - 1; n >= 0; n -= 1) {
    const there = depthOf(state, above[n]);
    if (there === depth) return settled({ ...state, links: { ...state.links, [start]: above[n] } }, total);
    if (there < depth) return null;
  }
  return null;
}

/** The part the indent alone points to: the nearest part above that stands less deep. */
export function impliedHolder(state: AnalysisState, start: number): number | null {
  const depth = depthOf(state, start);
  const above = partStarts(state).filter((part) => part < start);
  for (let n = above.length - 1; n >= 0; n -= 1) if (depthOf(state, above[n]) < depth) return above[n];
  return null;
}

/**
 * Part `start`'s arrow taken away, by the × at its middle (the owner, 2026-10-29): the part stops pointing at that word and
 * hangs where its indent points — on the nearest part above that stands less deep. So it keeps its place where it can
 * (a part tied past a neighbour now hangs on the neighbour) and nothing else moves; with no such part it hangs on nothing.
 */
export function dropTie(state: AnalysisState, start: number, total: number): AnalysisState {
  const depth = depthOf(state, start);
  const above = partStarts(state).filter((part) => part < start);
  const links = { ...state.links };
  delete links[start];
  for (let n = above.length - 1; n >= 0; n -= 1) {
    if (depthOf(state, above[n]) < depth && !hangsOn(state, above[n], start)) { links[start] = above[n]; break; }
  }
  return settled({ ...state, links }, total);
}

/**
 * The words `a`…`b` of an analysis as an analysis of their own: the cuts, ties and links of meaning that stay inside,
 * counted from `a`.
 */
export function sliceAnalysis(state: AnalysisState, a: number, b: number): AnalysisState {
  const cuts = state.cuts.filter((cut) => cut > a && cut < b).map((cut) => cut - a);
  const links: Record<number, number> = {};
  Object.entries(state.links).forEach(([key, word]) => {
    const part = Number(key);
    if (part >= a && part < b && word >= a && word < b) links[part - a] = word - a;
  });
  const relations = state.relations.filter((relation) => relation.a >= a && relation.b < b).map((relation) => ({ ...relation, a: relation.a - a, b: relation.b - a }));
  return settled({ cuts, links, relations }, b - a);
}

/** Whether an analysis holds the person's work: a cut, a tie or a link of meaning. */
export function hasWork(state: AnalysisState): boolean {
  return state.cuts.length > 0 || Object.keys(state.links).length > 0 || state.relations.length > 0;
}

/** Analyses of two passages that touch, as one: the second's parts after the first's, its first word starting a part. */
export function joinAnalyses(first: AnalysisState, firstTotal: number, second: AnalysisState, secondTotal: number): AnalysisState {
  const links: Record<number, number> = { ...first.links };
  Object.entries(second.links).forEach(([key, word]) => { links[Number(key) + firstTotal] = word + firstTotal; });
  const relations = [...first.relations, ...second.relations.map((relation) => ({ ...relation, a: relation.a + firstTotal, b: relation.b + firstTotal }))];
  return settled({ cuts: [...first.cuts, firstTotal, ...second.cuts.map((cut) => cut + firstTotal)], links, relations }, firstTotal + secondTotal);
}

/** The links of meaning that still mean something: inside the passage, on two words, one per pair, in order. */
function settledRelations(relations: readonly Relation[] | undefined, total: number): Relation[] {
  const seen = new Set<string>();
  return (relations ?? [])
    .filter((relation) => Number.isInteger(relation.a) && Number.isInteger(relation.b) && relation.a >= 0 && relation.a < relation.b && relation.b < total
      && RELATION_DIRS.includes(relation.dir) && (RELATION_COLORS as readonly string[]).includes(relation.color))
    .filter((relation) => { const key = `${relation.a}-${relation.b}`; if (seen.has(key)) return false; seen.add(key); return true; })
    .sort((x, y) => x.a - y.a || x.b - y.b);
}

/** The link of meaning on these two words, either way round, or undefined. */
export function relationOn(state: AnalysisState, first: number, second: number): Relation | undefined {
  const [a, b] = first < second ? [first, second] : [second, first];
  return state.relations.find((relation) => relation.a === a && relation.b === b);
}

/** Why no link of meaning is made: the word was dropped on itself, or these two words are linked already. */
export type RelationRefusal = 'same' | 'has';

/**
 * A word dragged onto another word (the owner, 2026-10-30: «навести на слово и потянуть к нужному слову — и связь сама
 * создаётся»): a link of meaning from `from` to `to`, pointing at the word it was dropped on, in the first colour no
 * other link wears (all worn — they go round again).
 */
export function relateWords(state: AnalysisState, from: number, to: number, total: number): AnalysisState | RelationRefusal {
  if (from === to) return 'same';
  if (relationOn(state, from, to)) return 'has';
  const relation: Relation = { a: Math.min(from, to), b: Math.max(from, to), dir: from < to ? 'fwd' : 'back', color: nextRelationColor(state) };
  return settled({ ...state, relations: [...state.relations, relation] }, total);
}

/** The colour the next link of meaning gets: the first no link wears; all worn — they go round again. */
export function nextRelationColor(state: AnalysisState): RelationColor {
  const worn = new Set(state.relations.map((relation) => relation.color));
  return RELATION_COLORS.find((name) => !worn.has(name)) ?? RELATION_COLORS[state.relations.length % RELATION_COLORS.length];
}

/** The link of meaning on `a` and `b` with its way or its colour changed. */
export function changeRelation(state: AnalysisState, a: number, b: number, change: Partial<Pick<Relation, 'dir' | 'color'>>, total: number): AnalysisState {
  return settled({ ...state, relations: state.relations.map((relation) => (relation.a === a && relation.b === b ? { ...relation, ...change } : relation)) }, total);
}

/** The link of meaning on `a` and `b` taken away. */
export function dropRelation(state: AnalysisState, a: number, b: number, total: number): AnalysisState {
  return settled({ ...state, relations: state.relations.filter((relation) => relation.a !== a || relation.b !== b) }, total);
}

/** How a link of meaning reads at one of its words: '→' — it goes out to the other word, '←' — it comes in, '↔', '—'. */
export function relationSign(relation: Relation, here: 'a' | 'b'): '→' | '←' | '↔' | '—' {
  if (relation.dir === 'both') return '↔';
  if (relation.dir === 'none') return '—';
  return (relation.dir === 'fwd') === (here === 'a') ? '→' : '←';
}

/** Where a link of meaning shows its arrowheads: at `b` when it points there, at `a` when it points back, both, none. */
export function relationHeads(relation: Relation): { atA: boolean; atB: boolean } {
  return { atA: relation.dir === 'back' || relation.dir === 'both', atB: relation.dir === 'fwd' || relation.dir === 'both' };
}

/** An analysis after its passage changed ends, and the work in the words taken off at each end, if any. */
export type Reshaped = { state: AnalysisState; front: AnalysisState | null; back: AnalysisState | null };

/**
 * An analysis whose passage changes its ends (the owner, 2026-10-29: «нужно иметь возможность редактировать объём»):
 * `front` and `back` words taken off (> 0) or put on (< 0) at each end. What stays keeps its parts; a tie into words taken
 * off goes as by its ×; words put on stand as one part at their end; the words taken off come back as an analysis of
 * their own when they hold work, null when untouched. Null when nothing would stay.
 */
export function reshapeAnalysis(state: AnalysisState, total: number, front: number, back: number): Reshaped | null {
  const a = Math.max(front, 0);
  const b = total - Math.max(back, 0);
  if (a >= b) return null;
  let kept = state;
  partStarts(state).filter((part) => part >= a && part < b).forEach((part) => {
    const out = (word: number | undefined) => word !== undefined && (word < a || word >= b);
    if (!out(kept.links[part])) return;
    kept = dropTie(kept, part, total);
    if (!out(kept.links[part])) return;
    const links = { ...kept.links };
    delete links[part];
    kept = settled({ ...kept, links }, total);
  });
  let next = sliceAnalysis(kept, a, b);
  let length = b - a;
  if (front < 0) { next = joinAnalyses(EMPTY_ANALYSIS, -front, next, length); length -= front; }
  if (back < 0) next = joinAnalyses(next, length, EMPTY_ANALYSIS, -back);
  const taken = (from: number, to: number) => {
    if (from >= to) return null;
    const piece = sliceAnalysis(state, from, to);
    return hasWork(piece) ? piece : null;
  };
  return { state: next, front: taken(0, a), back: taken(b, total) };
}

/** Whether the indent does not already say what the part hangs on — only then is an arrow drawn. */
export function needsArrow(state: AnalysisState, start: number): boolean {
  return state.links[start] !== undefined && impliedHolder(state, start) !== holderOf(state, start);
}

/** Each part's number by its steps: 1, 2, 2.1, 2.1.1 … — parts that hang on nothing first, then the parts on each. */
export function partNumbers(state: AnalysisState): Map<number, string> {
  const numbers = new Map<number, string>();
  const name = (start: number, label: string) => {
    numbers.set(start, label);
    partsOn(state, start).forEach((part, n) => { if (!numbers.has(part)) name(part, `${label}.${n + 1}`); });
  };
  partStarts(state).filter((part) => holderOf(state, part) === null).forEach((part, n) => name(part, String(n + 1)));
  return numbers;
}

/** The parts' words, one part a line. */
export function partText(words: readonly AnalysisWord[], state: AnalysisState, start: number): string {
  return words.slice(start, partEnd(state, start, words.length)).map((word) => word.text).join(' ');
}

/**
 * The analysis as text for every place that shows a note's words (a list row, a shared link): a part a line, each
 * step two spaces deeper, as a Markdown list.
 */
export function analysisMarkdown(words: readonly AnalysisWord[], state: AnalysisState): string {
  return partStarts(state).map((start) => `${'  '.repeat(depthOf(state, start))}- ${partText(words, state, start)}`).join('\n');
}

/** A step of an analysis read from its text: the part's words and how deep it stands. */
export type OutlineLine = { depth: number; text: string };

/** `analysisMarkdown` read back, for places that draw an analysis small without its passage at hand: a part a line. */
export function analysisOutline(text: string): OutlineLine[] {
  return text.split('\n').flatMap((line) => {
    const found = /^( *)- (.*)$/.exec(line);
    return found ? [{ depth: Math.floor(found[1].length / 2), text: found[2] }] : [];
  });
}

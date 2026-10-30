import {
  analysisMarkdown, analysisOutline, cutAt, joinAnalyses, reshapeAnalysis, depthOf, EMPTY_ANALYSIS, glueAt, holderOf, needsArrow, partNumbers, partStarts, partText,
  passageWords, settled, stepDown, stepUp, tieTo, tieTurns, dropTie, relateWords, relationOn, changeRelation, dropRelation,
  relationSign, sliceAnalysis, type AnalysisState,
} from '@/utils/passageAnalysis';

import type { BookText } from '@/utils/bibleText';

// Ephesians 1:1–2 in the Synodal text, as the app stores it (a leading ¶ opens a paragraph, <i> marks added words).
const EPHESIANS: BookText = {
  id: 'Ephesians',
  chapters: [[
    '¶Павел, волею Божиею Апостол Иисуса Христа, находящимся в Ефесе святым и верным во Христе Иисусе:',
    'благодать вам и мир от Бога Отца нашего и Господа Иисуса Христа.',
  ]],
};
const words = passageWords(EPHESIANS, { chapter: 1, fromVerse: 1, toChapter: 1, toVerse: 2 });
const total = words.length;
const at = (text: string) => words.findIndex((word) => word.text === text);

/** The owner's example of 2026-10-29: «Павел, / волею Божиею / Апостол / Иисуса Христа,» and then the rest. */
function ownersExample(): AnalysisState {
  let state = cutAt(EMPTY_ANALYSIS, at('находящимся'), total)!;
  state = cutAt(state, at('благодать'), total)!;
  state = cutAt(state, at('волею'), total, 'under')!; // ↳: «волею…» goes under «Павел,»
  state = cutAt(state, at('Апостол'), total, 'same')!; // ↵ inside that piece: a sibling under «Павел,»
  return cutAt(state, at('Иисуса'), total, 'under')!; // ↳: «Иисуса Христа,» under «Апостол»
}

describe('passageAnalysis — the rules of a block diagram', () => {
  it('reads the passage word by word, knowing where each verse starts, without the stored marks', () => {
    expect(words[0]).toEqual({ text: 'Павел,', chapter: 1, verse: 1, startsVerse: true, at: 0 });
    expect(words[at('благодать')]).toEqual({ text: 'благодать', chapter: 1, verse: 2, startsVerse: true, at: 0 });
    expect(words[at('волею')]).toMatchObject({ verse: 1, at: 1 });
    expect(words.filter((word) => word.startsVerse)).toHaveLength(2);
    expect(total).toBe(27);
  });

  it('cuts the passage into top parts that hang on nothing', () => {
    const state = cutAt(cutAt(EMPTY_ANALYSIS, at('находящимся'), total)!, at('благодать'), total)!;
    expect(partStarts(state)).toEqual([0, at('находящимся'), at('благодать')]);
    expect(state.links).toEqual({});
    expect(partNumbers(state)).toEqual(new Map([[0, '1'], [at('находящимся'), '2'], [at('благодать'), '3']]));
  });

  it('refuses a cut at a part\'s first word and at the very start', () => {
    const state = cutAt(EMPTY_ANALYSIS, at('находящимся'), total)!;
    expect(cutAt(state, 0, total)).toBeNull();
    expect(cutAt(state, at('находящимся'), total)).toBeNull();
  });

  it('puts what ↳ cuts one step under its line, and what ↵ cuts inside such a piece beside it', () => {
    const state = ownersExample();
    expect(partText(words, state, at('волею'))).toBe('волею Божиею');
    expect(holderOf(state, at('волею'))).toBe(0);
    expect(holderOf(state, at('Апостол'))).toBe(0);
    expect(holderOf(state, at('Иисуса'))).toBe(at('Апостол'));
    expect([0, at('волею'), at('Апостол'), at('Иисуса')].map((part) => depthOf(state, part))).toEqual([0, 1, 1, 2]);
    // The owner's screen: 1 · 1.1 · 1.2 · 1.2.1, and no arrow — every piece belongs to the line above it.
    expect(partNumbers(state).get(at('Иисуса'))).toBe('1.2.1');
    expect(partStarts(state).filter((part) => needsArrow(state, part))).toEqual([]);
  });

  it('takes the level of a new line from the mark: the same step as the line it is cut from, or one step under it', () => {
    // The owner, 2026-10-29: ↳ at «волею», ↵ at «Апостол», ↳ at «Иисуса».
    const state = ownersExample();
    expect([0, at('волею'), at('Апостол'), at('Иисуса')].map((part) => partNumbers(state).get(part))).toEqual(['1', '1.1', '1.2', '1.2.1']);
    expect(partStarts(state).filter((part) => needsArrow(state, part))).toEqual([]);
    // ↵ on a top line makes a neighbour, and so does a cut with no mark (dividing at commas).
    expect(depthOf(cutAt(EMPTY_ANALYSIS, at('волею'), total, 'same')!, at('волею'))).toBe(0);
    expect(depthOf(cutAt(EMPTY_ANALYSIS, at('волею'), total)!, at('волею'))).toBe(0);
  });

  it('moves a part one step up or down by the arrows at its number, and only that part', () => {
    const state = ownersExample(); // 1 · 1.1 «волею Божиею» · 1.2 «Апостол» · 1.2.1 «Иисуса Христа,»
    // ‹ on 1.2.1: it hangs on what «Апостол» hangs on — «Павел,» — and becomes 1.3.
    const up = stepUp(state, at('Иисуса'), total)!;
    expect(holderOf(up, at('Иисуса'))).toBe(0);
    expect(partNumbers(up).get(at('Иисуса'))).toBe('1.3');
    // ‹ on 1.1: «Павел,» hangs on nothing, so «волею Божиею» becomes a top part, 2.
    expect(partNumbers(stepUp(state, at('волею'), total)!).get(at('волею'))).toBe('2');
    // › on 1.2: under the nearest line above on its step, «волею Божиею»; what hangs on it goes along.
    const down = stepDown(state, at('Апостол'), total)!;
    expect([at('волею'), at('Апостол'), at('Иисуса')].map((part) => partNumbers(down).get(part))).toEqual(['1.1', '1.1.1', '1.1.1.1']);
    expect(partStarts(down).filter((part) => needsArrow(down, part))).toEqual([]);
    // Nowhere to go: «Павел,» hangs on nothing and has no line above; «волею Божиею» has no line above on its step.
    expect(stepUp(state, 0, total)).toBeNull();
    expect(stepDown(state, 0, total)).toBeNull();
    expect(stepDown(state, at('волею'), total)).toBeNull();
  });

  it('leaves a neighbour where it hangs when the part above it steps up, and the arrow says so', () => {
    // 1 «Павел,» · 1.1 «волею Божиею» · 1.2 «Апостол Иисуса Христа,» · 1.3 «находящимся…»
    let state = cutAt(EMPTY_ANALYSIS, at('волею'), total, 'under')!;
    state = cutAt(state, at('Апостол'), total, 'same')!;
    state = cutAt(state, at('находящимся'), total, 'same')!;
    const up = stepUp(state, at('Апостол'), total)!;
    expect(partNumbers(up).get(at('Апостол'))).toBe('2');
    expect(holderOf(up, at('находящимся'))).toBe(0);
    expect(partStarts(up).filter((part) => needsArrow(up, part))).toEqual([at('находящимся')]);
  });

  it('ties «волею Божиею» to «Апостол» below it: it stands a step right of «Апостол», and only that tie needs an arrow', () => {
    const tied = tieTo(ownersExample(), at('волею'), at('Апостол'), total) as AnalysisState;
    expect([0, at('волею'), at('Апостол'), at('Иисуса')].map((part) => depthOf(tied, part))).toEqual([0, 2, 1, 2]);
    expect(partStarts(tied).filter((part) => needsArrow(tied, part))).toEqual([at('волею')]);
    expect([0, at('волею'), at('Апостол'), at('Иисуса')].map((part) => partNumbers(tied).get(part))).toEqual(['1', '1.1.1', '1.1', '1.1.2']);
  });

  it('takes an arrow away by its ×: the part hangs where its indent points, keeping its place where it can', () => {
    // «волею Божиею», tied to «Апостол» below it, stands two steps in; without the arrow the indent points to «Павел,».
    const tied = tieTo(ownersExample(), at('волею'), at('Апостол'), total) as AnalysisState;
    const dropped = dropTie(tied, at('волею'), total);
    expect(holderOf(dropped, at('волею'))).toBe(0);
    expect(partStarts(dropped).filter((part) => needsArrow(dropped, part))).toEqual([]);
    expect([at('Апостол'), at('Иисуса')].map((part) => holderOf(dropped, part))).toEqual([0, at('Апостол')]);
    // A part tied past its neighbour keeps its step: «Иисуса Христа,» tied to «Божиею» past «Апостол» hangs on «Апостол».
    const past = tieTo(ownersExample(), at('Иисуса'), at('Божиею'), total) as AnalysisState;
    expect([depthOf(past, at('Иисуса')), needsArrow(past, at('Иисуса'))]).toEqual([2, true]);
    const kept = dropTie(past, at('Иисуса'), total);
    expect([depthOf(kept, at('Иисуса')), holderOf(kept, at('Иисуса')), needsArrow(kept, at('Иисуса'))]).toEqual([2, at('Апостол'), false]);
    // With nothing above standing less deep, it hangs on nothing.
    expect(holderOf(dropTie(tieTo(cutAt(EMPTY_ANALYSIS, at('Апостол'), total)!, 0, at('Апостол'), total) as AnalysisState, 0, total), 0)).toBeNull();
  });

  it('refuses a tie to the part\'s own words', () => {
    expect(tieTo(ownersExample(), at('Апостол'), at('Апостол'), total)).toBe('own');
    expect(tieTurns(ownersExample(), at('Апостол'), at('Апостол'))).toBe(false);
  });

  it('turns a tie round when dropped on a part that hangs on it: that part takes its place', () => {
    // «Иисуса Христа,» hangs on «Апостол»; «Апостол» dropped on «Христа,» — as «а всякий дух» on «который не исповедует».
    const state = ownersExample();
    expect(tieTurns(state, at('Апостол'), at('Христа,'))).toBe(true);
    const turned = tieTo(state, at('Апостол'), at('Христа,'), total) as AnalysisState;
    expect(holderOf(turned, at('Иисуса'))).toBe(0);
    expect(holderOf(turned, at('Апостол'))).toBe(at('Иисуса'));
    expect([0, at('волею'), at('Апостол'), at('Иисуса')].map((part) => depthOf(turned, part))).toEqual([0, 1, 2, 1]);
    expect(partStarts(turned).filter((part) => needsArrow(turned, part))).toEqual([at('Апостол')]);
    // A part deeper under it comes out from there: «Павел,», at the top, dropped on «Христа,» two steps under it.
    const deep = tieTo(state, 0, at('Христа,'), total) as AnalysisState;
    expect(holderOf(deep, at('Иисуса'))).toBeNull();
    expect(holderOf(deep, 0)).toBe(at('Иисуса'));
    expect([at('волею'), at('Апостол')].map((part) => holderOf(deep, part))).toEqual([0, 0]);
    // A tie that turns nothing round is not one.
    expect(tieTurns(state, at('Иисуса'), at('волею'))).toBe(false);
  });

  it('glues a part back: what hung on its words now hangs on the part it joined, and its own tie is gone', () => {
    const glued = glueAt(ownersExample(), at('Апостол'), total);
    expect(partText(words, glued, at('волею'))).toBe('волею Божиею Апостол');
    expect(holderOf(glued, at('Иисуса'))).toBe(at('волею'));
    expect(glued.links[at('Апостол')]).toBeUndefined();
  });

  it('settles a stored state: stale cuts, ties from words that start no part, ties into their own part and loops go', () => {
    const messy = { cuts: [0, 5, 5, 99, 3], links: { 3: 1, 4: 0, 5: 6, 9: 2 }, relations: [] };
    expect(settled(messy, total)).toEqual({ cuts: [3, 5], links: { 3: 1 }, relations: [] });
    const loop = { cuts: [3, 5], links: { 3: 5, 5: 3 }, relations: [] };
    expect(Object.keys(settled(loop, total).links)).toHaveLength(1);
  });


  it('reads its text back as the parts and their steps, for a list that draws it small', () => {
    const state = ownersExample();
    expect(analysisOutline(analysisMarkdown(words, state))).toEqual([
      { depth: 0, text: 'Павел,' }, { depth: 1, text: 'волею Божиею' }, { depth: 1, text: 'Апостол' },
      { depth: 2, text: 'Иисуса Христа,' }, { depth: 0, text: 'находящимся в Ефесе святым и верным во Христе Иисусе:' },
      { depth: 0, text: 'благодать вам и мир от Бога Отца нашего и Господа Иисуса Христа.' },
    ]);
    expect(analysisOutline('')).toEqual([]);
  });

  it('changes the passage\'s ends: what stays keeps its parts, untouched words taken off just go', () => {
    const state = ownersExample(); // … «находящимся…» · «благодать…» (verse 2, untouched)
    const v2 = at('благодать');
    const shrunk = reshapeAnalysis(state, total, 0, total - v2)!;
    expect(partStarts(shrunk.state)).toEqual([0, at('волею'), at('Апостол'), at('Иисуса'), at('находящимся')]);
    expect(holderOf(shrunk.state, at('Иисуса'))).toBe(at('Апостол'));
    expect(shrunk.back).toBeNull();
    // Taken off at the front: verse 2 alone stays, one part; the work in verse 1 comes back as its own analysis.
    const fromTwo = reshapeAnalysis(state, total, v2, 0)!;
    expect(fromTwo.state).toEqual(EMPTY_ANALYSIS);
    expect(partStarts(fromTwo.front!)).toEqual([0, at('волею'), at('Апостол'), at('Иисуса'), at('находящимся')]);
    // Nothing would stay.
    expect(reshapeAnalysis(state, total, v2, total - v2)).toBeNull();
  });

  it('keeps the work in words taken off, and lets a tie into them go as by its ×', () => {
    const v2 = at('благодать');
    let state = cutAt(ownersExample(), at('мир'), total)!; // a cut inside verse 2: work there
    state = tieTo(state, at('Апостол'), at('Бога'), total) as AnalysisState; // «Апостол…» tied into verse 2
    const shrunk = reshapeAnalysis(state, total, 0, total - v2)!;
    expect(shrunk.back).toEqual({ cuts: [at('мир') - v2], links: {}, relations: [] });
    expect(Object.values(shrunk.state.links).every((word) => word < v2)).toBe(true);
    expect(holderOf(shrunk.state, at('Апостол'))).toBe(0);
  });

  it('puts words added at an end on as one part there, the rest moving with them', () => {
    const state = ownersExample();
    const longer = reshapeAnalysis(state, total, 0, -4)!;
    expect(partStarts(longer.state).slice(-2)).toEqual([at('благодать'), total]);
    expect(holderOf(longer.state, total)).toBeNull();
    const earlier = reshapeAnalysis(state, total, -3, 0)!;
    expect(partStarts(earlier.state).slice(0, 3)).toEqual([0, 3, at('волею') + 3]);
    expect(holderOf(earlier.state, at('Иисуса') + 3)).toBe(at('Апостол') + 3);
    // Two analyses of touching passages become one, the second's first word starting a part.
    expect(joinAnalyses(state, total, { cuts: [2], links: { 2: 0 }, relations: [] }, 5)).toEqual({ cuts: [...state.cuts].sort((x, y) => x - y).concat([total, total + 2]), links: { ...state.links, [total + 2]: total }, relations: [] });
  });

  it('links two words by meaning: dragged onto a word it points there, in the first colour no other link wears', () => {
    const state = ownersExample();
    const one = relateWords(state, at('Апостол'), at('благодать'), total) as AnalysisState;
    expect(one.relations).toEqual([{ a: at('Апостол'), b: at('благодать'), dir: 'fwd', color: 'amber' }]);
    // Dragged from the later word onto the earlier one: it points back; the next colour.
    const two = relateWords(one, at('мир'), at('Павел,'), total) as AnalysisState;
    expect(relationOn(two, at('Павел,'), at('мир'))).toEqual({ a: 0, b: at('мир'), dir: 'back', color: 'teal' });
    expect(two.relations.map((relation) => relation.a)).toEqual([0, at('Апостол')]);
    // A word on itself, or two words linked already, make nothing.
    expect(relateWords(two, at('мир'), at('мир'), total)).toBe('same');
    expect(relateWords(two, at('благодать'), at('Апостол'), total)).toBe('has');
    // Cuts and ties do not touch the links of meaning; a colour taken off is free again.
    expect(glueAt(cutAt(two, at('Христа,'), total)!, at('Христа,'), total).relations).toEqual(two.relations);
    const freed = dropRelation(two, at('Апостол'), at('благодать'), total);
    expect((relateWords(freed, at('вам'), at('Бога'), total) as AnalysisState).relations.map((relation) => relation.color)).toEqual(['teal', 'amber']);
  });

  it('changes a link\'s way and colour, and reads it at each of its words', () => {
    const state = relateWords(EMPTY_ANALYSIS, at('волею'), at('Апостол'), total) as AnalysisState;
    const turned = changeRelation(state, at('волею'), at('Апостол'), { dir: 'both', color: 'violet' }, total);
    expect(turned.relations[0]).toMatchObject({ dir: 'both', color: 'violet' });
    expect(relationSign(state.relations[0], 'a')).toBe('→');
    expect(relationSign(state.relations[0], 'b')).toBe('←');
    expect(relationSign({ ...state.relations[0], dir: 'back' }, 'a')).toBe('←');
    expect(relationSign({ ...state.relations[0], dir: 'none' }, 'b')).toBe('—');
  });

  it('keeps the links of meaning of the words that stay when the passage changes ends, and in a joined analysis', () => {
    const v2 = at('благодать');
    let state = relateWords(ownersExample(), at('Апостол'), at('святым'), total) as AnalysisState; // inside verse 1
    state = relateWords(state, at('Павел,'), at('Бога'), total) as AnalysisState; // across the verses
    state = relateWords(state, at('мир'), at('Отца'), total) as AnalysisState; // inside verse 2
    const shrunk = reshapeAnalysis(state, total, 0, total - v2)!;
    expect(shrunk.state.relations.map((relation) => [relation.a, relation.b])).toEqual([[at('Апостол'), at('святым')]]);
    // The words taken off keep their own link, counted from their first word; a link across the edge goes.
    expect(shrunk.back!.relations).toEqual([{ a: at('мир') - v2, b: at('Отца') - v2, dir: 'fwd', color: 'pink' }]);
    expect(sliceAnalysis(state, v2, total).relations).toHaveLength(1);
    const joined = joinAnalyses(sliceAnalysis(state, 0, v2), v2, sliceAnalysis(state, v2, total), total - v2);
    expect(joined.relations.map((relation) => [relation.a, relation.b])).toEqual([[at('Апостол'), at('святым')], [at('мир'), at('Отца')]]);
  });

  it('settles stored links of meaning: past the end, on one word, a second on the same pair go', () => {
    const relations = [
      { a: 3, b: 5, dir: 'fwd', color: 'amber' }, { a: 5, b: 3, dir: 'fwd', color: 'teal' }, { a: 3, b: 5, dir: 'both', color: 'pink' },
      { a: 2, b: total, dir: 'fwd', color: 'sky' }, { a: 4, b: 4, dir: 'none', color: 'lime' },
    ] as AnalysisState['relations'];
    expect(settled({ cuts: [], links: {}, relations }, total).relations).toEqual([{ a: 3, b: 5, dir: 'fwd', color: 'amber' }]);
  });

  it('writes the analysis as a nested Markdown list for every place that shows a note as text', () => {
    const tied = tieTo(ownersExample(), at('волею'), at('Апостол'), total) as AnalysisState;
    expect(analysisMarkdown(words, tied).split('\n').slice(0, 4)).toEqual([
      '- Павел,', '    - волею Божиею', '  - Апостол', '    - Иисуса Христа,',
    ]);
  });
});

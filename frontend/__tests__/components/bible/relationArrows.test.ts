import { relationArrows, tieArrows, type Box, type Geometry, type Point } from '@/components/bible/analysis/analysisGeometry';
import { needsArrow, type AnalysisState, type Relation } from '@/utils/passageAnalysis';

/*
 * The owner's 1 John 3:22–24 as on his screenshot of 30.10, with «Все связи» on: ten lines, two level arrows (into
 * «соблюдаем» and into «заповедь», both from below), four links of meaning, all teal — drawn at once they lay on one
 * another. Spaced as the analysis screen measures (live, 30.10): lines 41 px apart, words 21 px tall — a gap of 20 px.
 * Words stand 90 px apart, 80 wide; a line's indent by its depth.
 */
const LINES = [{ start: 0, words: 7, depth: 1 }, { start: 7, words: 2, depth: 0 }, { start: 9, words: 3, depth: 1 }, { start: 12, words: 5, depth: 1 },
  { start: 17, words: 4, depth: 2 }, { start: 21, words: 9, depth: 3 }, { start: 30, words: 8, depth: 3 }, { start: 38, words: 2, depth: 0 },
  { start: 40, words: 3, depth: 3 }, { start: 43, words: 8, depth: 1 }];
const TOTAL = 51;
const PITCH = 41; const HEIGHT = 21;
const W = { sobl: 9, zapovedi: 10, zapoved: 18, zapovedal: 36, sohr: 40, zapovedi24: 41 };

const words: Record<string, Box> = {};
LINES.forEach(({ start, words: count, depth }, k) => {
  for (let j = 0; j < count; j += 1) words[String(start + j)] = { x: 100 + depth * 44 + j * 90, y: k * PITCH, w: 80, h: HEIGHT };
});
const geometry: Geometry = { words, leads: {}, mids: {}, flags: {}, width: 1400, height: 440 };
const sobl: Relation = { a: W.sobl, b: W.sohr, dir: 'both', color: 'teal' };
const toZapoved: Relation = { a: W.zapovedi, b: W.zapoved, dir: 'fwd', color: 'teal' };
const zapovedi: Relation = { a: W.zapovedi, b: W.zapovedi24, dir: 'both', color: 'teal' };
const zapovedal: Relation = { a: W.zapoved, b: W.zapovedal, dir: 'back', color: 'teal' };
const owners: AnalysisState = {
  cuts: LINES.slice(1).map((line) => line.start),
  // «и делаем…» and «соблюдаем…» hang on «потому»; «А заповедь…» on «соблюдаем», «сохраняет…» on «заповедь» — arrows.
  links: { 9: 7, 12: 7, 17: W.sobl, 40: W.zapoved },
  relations: [sobl, toZapoved, zapovedi, zapovedal],
};

type Segment = { owner: string; x1: number; y1: number; x2: number; y2: number };
/** Every straight piece of every link's arrow and of every level arrow, named by its arrow. */
function segments(state: AnalysisState, on: Geometry = geometry): Segment[] {
  const pieces = (owner: string, points: Point[]) => points.slice(1).map((end, n) => ({ owner, x1: points[n][0], y1: points[n][1], x2: end[0], y2: end[1] }));
  return [
    ...relationArrows(state, on, state.relations, TOTAL).flatMap((arrow) => pieces(`${arrow.relation.a}-${arrow.relation.b}`, arrow.points)),
    ...tieArrows(state, on).flatMap((arrow) => pieces(arrow.key, arrow.points!)),
  ];
}
const flat = (s: Segment) => s.y1 === s.y2 && s.x1 !== s.x2;
const upright = (s: Segment) => s.x1 === s.x2 && s.y1 !== s.y2;
const within = (v: number, a: number, b: number, margin: number) => v > Math.min(a, b) + margin && v < Math.max(a, b) - margin;
const overlap = (a1: number, a2: number, b1: number, b2: number) => Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));
/** Where one arrow's run passes across another's upright. */
const crossings = (all: Segment[]) => all.filter(flat).flatMap((h) => all.filter((v) => upright(v) && v.owner !== h.owner && within(v.x1, h.x1, h.x2, 1) && within(h.y1, v.y1, v.y2, 1)));
/** Two arrows lying on each other: runs nearer than 4 px along a shared stretch, or uprights. */
const lying = (all: Segment[]) => all.flatMap((p, i) => all.slice(i + 1).filter((q) => p.owner !== q.owner && (
  (flat(p) && flat(q) && Math.abs(p.y1 - q.y1) < 4 && overlap(p.x1, p.x2, q.x1, q.x2) > 2)
  || (upright(p) && upright(q) && Math.abs(p.x1 - q.x1) < 4 && overlap(p.y1, p.y2, q.y1, q.y2) > 2))));
/** A run nearer than 3 px to a row of words, or an upright through them — rows as they stand, a wrapped part on two. */
function onText(all: Segment[], on: Geometry = geometry) {
  const rows = new Map<number, Box[]>();
  Object.values(on.words).forEach((box) => rows.set(box.y, [...(rows.get(box.y) ?? []), box]));
  return all.filter((s) => [...rows.values()].some((row) => {
    const left = Math.min(...row.map((box) => box.x)); const right = Math.max(...row.map((box) => box.x + box.w));
    const top = row[0].y; const bottom = row[0].y + row[0].h;
    if (flat(s)) return s.y1 > top - 3 && s.y1 < bottom + 3 && overlap(s.x1, s.x2, left, right) > 0;
    return upright(s) && overlap(s.y1, s.y2, top + 1, bottom - 1) > 0 && s.x1 >= left - 1 && s.x1 <= right + 1;
  }));
}
const drawn = (state: AnalysisState = owners) => relationArrows(state, geometry, state.relations, TOTAL);
const pointsOf = (relation: Relation) => drawn().find((arrow) => arrow.relation === relation)!.points;

describe('the arrows of links of meaning drawn at once (the owner\'s choice on the canvas, «Распутать», 30.10)', () => {
  it('stands on the owner\'s analysis: the two level arrows are drawn', () => {
    expect(needsArrow(owners, 17)).toBe(true);
    expect(needsArrow(owners, 40)).toBe(true);
  });

  it('lays no arrow on another, keeps every run off the words, and crosses at most once on his four links', () => {
    const all = segments(owners);
    expect(lying(all)).toEqual([]);
    expect(onText(all)).toEqual([]);
    expect(crossings(all).length).toBeLessThanOrEqual(1);
  });

  it('gives each link its own point on a word; a level arrow coming into the word keeps its middle', () => {
    expect(pointsOf(toZapoved)[0]).not.toEqual(pointsOf(zapovedi)[0]);
    // The level arrow comes into «соблюдаем» from below at its middle: the link leaving it below stands right of it.
    const box = words[String(W.sobl)];
    const [x, y] = pointsOf(sobl)[0];
    expect(y).toBeGreaterThan(box.y + box.h);
    expect(x).toBeGreaterThan(box.x + box.w / 2);
  });

  it('sends the longest, rightmost link round the top of its word when the gap under the line cannot hold all three', () => {
    // Under «соблюдаем заповеди Его» the level arrow and three links would need 20 px of a 20 px gap.
    expect(pointsOf(zapovedi)[0][1]).toBeLessThan(words[String(W.zapovedi)].y);
    expect(pointsOf(toZapoved)[0][1]).toBeGreaterThan(words[String(W.zapovedi)].y);
  });

  it('keeps short links near the text and stands a long one further out than every short one it goes round', () => {
    const column = (relation: Relation) => pointsOf(relation)[2][0];
    expect(column(toZapoved)).toBeLessThan(column(sobl));
    expect(column(zapovedal)).toBeLessThan(column(sobl));
    expect(column(sobl)).not.toBe(column(zapovedi));
  });

  it('sends what a narrow gap cannot hold round the other side of its words: four links into the closing line', () => {
    // Two from the line above it and two from far above, all into «тот пребывает в Нем, и Он в том.» — six runs for a
    // gap of 20 px when each comes in from above (Eph 1:1–2 live, 30.10).
    const into: Relation[] = [{ a: 9, b: 44, dir: 'fwd', color: 'amber' }, { a: 13, b: 45, dir: 'fwd', color: 'teal' },
      { a: 40, b: 48, dir: 'fwd', color: 'pink' }, { a: 41, b: 49, dir: 'fwd', color: 'sky' }];
    const crowded: AnalysisState = { ...owners, relations: into };
    const all = segments(crowded);
    expect(lying(all)).toEqual([]);
    expect(onText(all)).toEqual([]);
    const closing = LINES.length - 1;
    const fromBelow = drawn(crowded).filter((arrow) => arrow.points[arrow.points.length - 1][1] > closing * PITCH);
    expect(fromBelow.length).toBeGreaterThan(0);
    expect(crossings(all).length).toBeLessThanOrEqual(1);
  });

  it('puts heads where the link points: both ends, the second word, the first', () => {
    const heads = (relation: Relation) => drawn().find((arrow) => arrow.relation === relation)!.heads.length;
    expect([heads(sobl), heads(toZapoved), heads(zapovedal)]).toEqual([2, 1, 1]);
  });

  it('draws two words of one row as a low bracket, two brackets of one row apart, each where the gap has room', () => {
    const near: Relation = { a: 21, b: 23, dir: 'fwd', color: 'amber' };
    const far: Relation = { a: 22, b: 25, dir: 'fwd', color: 'pink' };
    const inRow: AnalysisState = { ...owners, relations: [near, far] };
    const [first, second] = relationArrows(inRow, geometry, inRow.relations, TOTAL);
    expect(first.points[1][1]).not.toBe(second.points[1][1]);
    const all = segments(inRow);
    expect(onText(all)).toEqual([]);
    expect(lying(all)).toEqual([]);
  });

  it('keeps five brackets of one row off the rows around it (Codex, 30.10: the fourth and fifth ran into the row above)', () => {
    // «и любили друг друга, как Он заповедал нам.» — no level arrow in the gaps around it: room for three above, three below.
    const five: Relation[] = [[30, 31], [30, 32], [31, 34], [32, 36], [30, 37]].map(([a, b]) => ({ a, b, dir: 'fwd', color: 'teal' }));
    const inRow: AnalysisState = { ...owners, relations: five };
    const all = segments(inRow);
    expect(onText(all)).toEqual([]);
    expect(lying(all)).toEqual([]);
  });

  it('gives two brackets out of one word their own points on it (Codex, 30.10: they shared a stem and a head)', () => {
    const pair: Relation[] = [{ a: 21, b: 22, dir: 'fwd', color: 'teal' }, { a: 21, b: 23, dir: 'fwd', color: 'amber' }, { a: 21, b: 24, dir: 'fwd', color: 'pink' }];
    const inRow: AnalysisState = { ...owners, relations: pair };
    const starts = relationArrows(inRow, geometry, pair, TOTAL).map((arrow) => arrow.points[0][0]);
    expect(new Set(starts).size).toBe(3);
    expect(lying(segments(inRow))).toEqual([]);
  });

  it('goes by the rows a wrapped part stands on: a link between its two rows runs round, not through the words above', () => {
    // «чтобы мы веровали во имя Сына Его Иисуса Христа» too long for the width: «Сына Его Иисуса Христа» on a second row,
    // every line after it a row lower.
    const wrapped: Record<string, Box> = {};
    Object.entries(words).forEach(([key, box]) => {
      const word = Number(key);
      wrapped[key] = word >= 26 && word < 30 ? { ...box, x: box.x - 5 * 90, y: box.y + PITCH } : word >= 30 ? { ...box, y: box.y + PITCH } : box;
    });
    const narrow: Geometry = { ...geometry, words: wrapped, height: 480 };
    const across: Relation = { a: 23, b: 28, dir: 'fwd', color: 'amber' };
    const state: AnalysisState = { ...owners, relations: [across, sobl] };
    const all = segments(state, narrow);
    expect(onText(all, narrow)).toEqual([]);
    expect(lying(all)).toEqual([]);
  });
});

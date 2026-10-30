'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { holderOf, needsArrow, partEnd, partOf, partStarts, relationHeads, type AnalysisState, type Relation } from '@/utils/passageAnalysis';

/*
 * WHERE THE ANALYSIS'S WORDS STAND AND HOW ITS ARROWS RUN (case 2026-10-12-block-diagram): the places read from the page
 * after each layout, a tie's arrow through the left margin, a link of meaning's through the right one. Only reckoning:
 * the editor decides what is drawn and when.
 */

/** A place in the text; `mid` — for a line's first word, the height of the middle of its small letters. */
export type Box = { x: number; y: number; w: number; h: number; mid?: number };
/** `flags` — by a line's first word, the right edge of the flags at its end. */
export type Geometry = { words: Record<string, Box>; leads: Record<string, Box>; mids: Record<string, Box>; flags: Record<string, number>; width: number; height: number };
export type Point = [number, number];
/** A tie's arrow (`start` — its part, `mid` — where its × stands, `points` — its corners) or the one following a drag. */
export type Arrow = { key: string; d: string; head: string; lit: boolean; start?: number; mid?: { x: number; y: number }; points?: Point[] };

const EMPTY_GEOMETRY: Geometry = { words: {}, leads: {}, mids: {}, flags: {}, width: 0, height: 0 };

/** Where the words and verse numbers stand inside the text, read after each layout and on every resize, for the arrows. */
export function useGeometry() {
  const contentRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<Geometry>(EMPTY_GEOMETRY);
  const measure = useCallback(() => {
    const root = contentRef.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const scale = root.offsetWidth ? box.width / root.offsetWidth : 1;
    const read = (attribute: string) => Object.fromEntries(Array.from(root.querySelectorAll<HTMLElement>(`[${attribute}]`)).map((element) => {
      const rect = element.getBoundingClientRect();
      return [element.getAttribute(attribute) ?? '', { x: (rect.left - box.left) / scale, y: (rect.top - box.top) / scale, w: rect.width / scale, h: rect.height / scale }];
    }));
    const flags: Record<string, number> = {};
    root.querySelectorAll<HTMLElement>('[data-flagline]').forEach((element) => {
      const line = element.getAttribute('data-flagline') ?? '';
      flags[line] = Math.max(flags[line] ?? 0, (element.getBoundingClientRect().right - box.left) / scale);
    });
    const next: Geometry = { words: read('data-word'), leads: read('data-lead'), mids: read('data-mid'), flags, width: root.offsetWidth, height: root.offsetHeight };
    setGeometry((now) => (JSON.stringify(now) === JSON.stringify(next) ? now : next));
  }, []);
  useLayoutEffect(measure);
  useEffect(() => {
    const root = contentRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure]);
  /** A pointer's place inside the text. */
  const at = useCallback((x: number, y: number) => {
    const root = contentRef.current!;
    const box = root.getBoundingClientRect();
    const scale = root.offsetWidth ? box.width / root.offsetWidth : 1;
    return { x: (x - box.left) / scale, y: (y - box.top) / scale };
  }, []);
  return { contentRef, geometry, at };
}

/**
 * An arrow from a part's first word through the margin into the word it hangs on; `mid` is the middle of its upright.
 * The upright stands left of `clear` — the start of every line it passes — so it never runs through their words. Its
 * run along the gap stays close to its own word, a lane further for each arrow before it on that side of that gap: one
 * entering from below runs by the upper line, one entering from above by the lower (the owner, 2026-10-30: «свои
 * полосы» — two arrows held 8 px off their words met in the middle of one gap and lay on each other).
 */
export function arrowPath(from: Box, to: Box, k: number, clear: number, lane: number): { d: string; head: string; mid: { x: number; y: number }; points: Point[] } {
  const up = to.y < from.y; const dir = up ? 1 : -1;
  const cy = Math.round(from.mid ?? from.y + from.h / 2);
  const gx = Math.min(from.x - 13, clear - 8) - 5 * k;
  const ey = up ? to.y + to.h + 1 : to.y - 1;
  const gy = ey + dir * (5 + 4 * lane);
  const ax = Math.round(to.x + to.w / 2);
  const r = 5; const sx = ax >= gx ? 1 : -1;
  return {
    d: `M ${from.x - 4} ${cy} L ${gx + r} ${cy} Q ${gx} ${cy} ${gx} ${cy - dir * r} L ${gx} ${gy + dir * r} Q ${gx} ${gy} ${gx + sx * r} ${gy} L ${ax - sx * r} ${gy} Q ${ax} ${gy} ${ax} ${gy - dir * r} L ${ax} ${ey}`,
    head: `M ${ax - 4} ${ey + dir * 5} L ${ax} ${ey} L ${ax + 4} ${ey + dir * 5}`,
    mid: { x: gx, y: Math.round((cy + gy) / 2) },
    points: [[from.x - 4, cy], [gx, cy], [gx, gy], [ax, gy], [ax, ey]],
  };
}

/** How far a point is from the segment a–b. */
function segmentDistance([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax; const dy = by - ay; const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * The tie whose arrow runs within 7 px of the point, or null. Found by reckoning, not by an element over the text: a
 * wide clear stroke lying over the lines took the pointer from the arrows ‹ › and the line it crossed (2026-10-29).
 */
export function arrowNear(arrows: Arrow[], point: Point): number | null {
  let near: number | null = null; let best = 7;
  arrows.forEach(({ start, points }) => {
    if (start === undefined || !points) return;
    points.slice(1).forEach((end, n) => { const d = segmentDistance(point, points[n], end); if (d < best) { best = d; near = start; } });
  });
  return near;
}

/** Where an arrow leaves a line: its first word, reaching left over a verse number hung in the margin. */
export function fromLine(geometry: Geometry, start: number): Box | undefined {
  const word = geometry.words[String(start)];
  const lead = geometry.leads[String(start)];
  const mid = geometry.mids[String(start)]?.y;
  if (!word) return undefined;
  const box = lead ? { ...word, x: lead.x, w: word.x + word.w - lead.x } : word;
  return mid === undefined ? box : { ...box, mid };
}

/** The arrow being drawn from a line's start while one of its words is dragged, to the pointer at `to`. */
export function dragArrow(from: Box, to: { x: number; y: number }): Arrow {
  const sx = from.x - 4; const sy = from.mid ?? from.y + from.h / 2; const mx = (sx + to.x) / 2 - 30; const my = (sy + to.y) / 2;
  const angle = Math.atan2(to.y - my, to.x - mx);
  const hx = (a: number) => to.x - 9 * Math.cos(angle + a); const hy = (a: number) => to.y - 9 * Math.sin(angle + a);
  return { key: 'drag', d: `M ${sx} ${sy} Q ${mx} ${my} ${to.x} ${to.y}`, head: `M ${hx(0.45)} ${hy(0.45)} L ${to.x} ${to.y} L ${hx(-0.45)} ${hy(-0.45)}`, lit: true };
}

/** A path through the corners, each rounded off, and an arrowhead at either end when asked. */
function rounded(points: Point[], ends: { first: boolean; last: boolean }): { d: string; heads: string[] } {
  const r = 5;
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i - 1]; const [x, y] = points[i]; const [nx, ny] = points[i + 1];
    const a = Math.min(r, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    const ux = Math.sign(x - px); const uy = Math.sign(y - py); const vx = Math.sign(nx - x); const vy = Math.sign(ny - y);
    d += ` L ${x - ux * a} ${y - uy * a} Q ${x} ${y} ${x + vx * a} ${y + vy * a}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  const head = (tip: Point, from: Point) => {
    const ux = Math.sign(tip[0] - from[0]); const uy = Math.sign(tip[1] - from[1]);
    return `M ${tip[0] - ux * 5 - uy * 4} ${tip[1] - uy * 5 - ux * 4} L ${tip[0]} ${tip[1]} L ${tip[0] - ux * 5 + uy * 4} ${tip[1] - uy * 5 + ux * 4}`;
  };
  const heads = [ends.last ? head(last, points[points.length - 2]) : '', ends.first ? head(points[0], points[1]) : ''].filter(Boolean);
  return { d, heads };
}

/**
 * The arrows of links of meaning (the owner's choice on the canvas, «Распутать», 2026-10-30 — four links drawn at once
 * lay on one another): each out of its upper word by the bottom, along the right margin past the ends of every row it
 * passes and of their flags, into its lower word by the top; never across the text. Rows are the ones the eye sees: a
 * part too long for the width stands on two (Codex, 30.10). Kept apart three ways. A link's upright stands a step
 * further out than every shorter link whose gaps it shares, so short links keep near the text and long ones go round
 * them. On a word each link takes its own point, a tie's arrow coming into that word keeping its middle. Along a row
 * each link runs at its own height, past the heights of the ties' arrows there, in the order that keeps its run off the
 * others' uprights. A gap too narrow for all its runs sends some round the other side of their word — below the last
 * row there is always room (four links into one closing line, 30.10). Two words of one row get a low bracket over
 * them, brackets of one row stacked, the shorter nearer. Two links still cross where their words stand in the other
 * order than their uprights.
 */
export function relationArrows(state: AnalysisState, geometry: Geometry, relations: Relation[], total: number): { relation: Relation; d: string; heads: string[]; points: Point[] }[] {
  // The rows: words a few pixels apart in height stand on one.
  const rows: { top: number; bottom: number; right: number }[] = [];
  const boxes = Object.entries(geometry.words).map(([word, box]) => ({ word: Number(word), box })).sort((p, q) => p.box.y - q.box.y);
  boxes.forEach(({ box }) => {
    const row = rows[rows.length - 1];
    if (row && box.y - row.top < 4) { row.bottom = Math.max(row.bottom, box.y + box.h); row.right = Math.max(row.right, box.x + box.w); }
    else rows.push({ top: box.y, bottom: box.y + box.h, right: box.x + box.w });
  });
  const rowOf = (box: Box) => { let k = 0; rows.forEach((row, n) => { if (row.top <= box.y + 3) k = n; }); return k; };
  // A part's flags stand after its last word, on that word's row.
  partStarts(state).forEach((start) => {
    const edge = geometry.flags[String(start)]; const last = geometry.words[String(partEnd(state, start, total) - 1)];
    if (edge !== undefined && last) rows[rowOf(last)].right = Math.max(rows[rowOf(last)].right, edge);
  });
  type Side = 'top' | 'bottom';
  /** A link as drawn: `a` its upper word (`wa` the word's number), `b` its lower. */
  type Run = { relation: Relation; wa: number; wb: number; a: Box; b: Box; la: number; lb: number; x: number };
  /** A run's end at a word: `home` — the side it takes when there is room, `side` — the one it takes. */
  type End = { run: Run; role: 'a' | 'b'; word: number; box: Box; line: number; home: Side; side: Side; x: number; dist: number };
  const runs = relations.flatMap((relation): Run[] => {
    const a = geometry.words[String(relation.a)]; const b = geometry.words[String(relation.b)];
    if (!a || !b) return [];
    const la = rowOf(a); const lb = rowOf(b);
    // A word wrapped onto an earlier row than its partner (it cannot be, words keep their order) is read as it stands.
    return la <= lb ? [{ relation, wa: relation.a, wb: relation.b, a, b, la, lb, x: 0 }] : [{ relation, wa: relation.b, wb: relation.a, a: b, b: a, la: lb, lb: la, x: 0 }];
  });
  const across = runs.filter((run) => run.lb > run.la);
  // Brackets of one row, shorter first, each above or below it where the gap has more room left (Codex, 30.10: five above
  // ran into the row over it).
  const brackets = runs.filter((run) => run.lb === run.la).sort((p, q) => Math.abs(p.b.x - p.a.x) - Math.abs(q.b.x - q.a.x));
  const stacked = new Map<Run, { side: Side; at: number }>();
  const bracketsOn = (k: number, side: Side) => brackets.filter((run) => run.la === k && stacked.get(run)?.side === side).length;
  /** A bracket's end at a word: `toRight` — its other word stands to the right. */
  type BracketEnd = { run: Run; word: number; box: Box; side: Side; toRight: boolean; span: number; x: number };
  const ends = across.flatMap((run): End[] => [
    { run, role: 'a', word: run.wa, box: run.a, line: run.la, home: 'bottom', side: 'bottom', x: 0, dist: 0 },
    { run, role: 'b', word: run.wb, box: run.b, line: run.lb, home: 'top', side: 'top', x: 0, dist: 0 },
  ]);
  const endOf = (run: Run, role: End['role']) => ends.find((end) => end.run === run && end.role === role)!;
  // Where the ties' arrows come into words, and how many run along each side of each row.
  const tieIn = new Set<string>(); const tiesAlong = new Map<string, number>();
  partStarts(state).filter((start) => needsArrow(state, start)).forEach((start) => {
    const word = state.links[start]; const from = geometry.words[String(start)]; const to = geometry.words[String(word)];
    if (!from || !to) return;
    const side = to.y < from.y ? 'bottom' : 'top';
    tieIn.add(`${word}:${side}`);
    tiesAlong.set(`${rowOf(to)}:${side}`, (tiesAlong.get(`${rowOf(to)}:${side}`) ?? 0) + 1);
  });
  const tiesBy = (k: number, side: Side) => tiesAlong.get(`${k}:${side}`) ?? 0;
  const below = (k: number, side: Side) => 6 + 4 * tiesBy(k, side) + 5 * bracketsOn(k, side);

  // Room: a gap is a half row, `k + 0.5` between rows k and k + 1; the runs along each of its two sides need their
  // heights. What does not fit goes round its word where there is room — the longest run first, then the one furthest
  // right: its upright stands outside the others, so going round adds no crossing.
  const gapOf = (end: End) => end.line + (end.side === 'bottom' ? 0.5 : -0.5);
  const room = (gap: number) => {
    const above = rows[gap - 0.5]; const under = rows[gap + 0.5];
    if (!under) return Infinity;
    return above ? under.top - above.bottom : 26;
  };
  const along = (k: number, side: Side, n: number) => {
    if (n) return below(k, side) + 5 * (n - 1);
    const ties = tiesBy(k, side); const held = bracketsOn(k, side);
    return ties || held ? 2 + 4 * ties + 5 * held : 0;
  };
  const slack = (gap: number) => {
    const count = (side: Side) => ends.filter((end) => gapOf(end) === gap && end.side === side).length;
    return room(gap) - along(gap - 0.5, 'bottom', count('bottom')) - along(gap + 0.5, 'top', count('top')) - 4;
  };
  const flip = (end: End) => { end.side = end.side === 'top' ? 'bottom' : 'top'; };
  brackets.forEach((run) => {
    const k = run.la;
    const left = (side: Side) => {
      stacked.set(run, { side, at: 0 });
      const room = slack(k + (side === 'top' ? -0.5 : 0.5));
      stacked.delete(run);
      return room;
    };
    const side: Side = left('top') >= left('bottom') ? 'top' : 'bottom';
    stacked.set(run, { side, at: bracketsOn(k, side) });
  });
  const bracketEnds = brackets.flatMap((run): BracketEnd[] => {
    const { side } = stacked.get(run)!; const span = Math.abs(run.b.x - run.a.x); const right = run.b.x > run.a.x;
    return [{ run, word: run.wa, box: run.a, side, toRight: right, span, x: 0 }, { run, word: run.wb, box: run.b, side, toRight: !right, span, x: 0 }];
  });
  for (let turn = 0; turn < ends.length; turn += 1) {
    const crowded = [...new Set(ends.map(gapOf))].find((gap) => slack(gap) < 0);
    if (crowded === undefined) break;
    const fitting = ends.filter((end) => {
      if (gapOf(end) !== crowded || end.side !== end.home) return false;
      flip(end); const left = slack(gapOf(end)); flip(end);
      return left >= 0;
    });
    const span = (end: End) => end.run.lb - end.run.la;
    const best = fitting.sort((p, q) => span(q) - span(p) || q.word - p.word)[0];
    if (!best) break;
    flip(best);
  }

  // Uprights: shorter runs first, each a step further out than every one placed before whose gaps it shares.
  const gaps = (run: Run) => [gapOf(endOf(run, 'a')), gapOf(endOf(run, 'b'))];
  const placed: Run[] = [];
  [...across].sort((p, q) => p.lb - p.la - (q.lb - q.la) || p.wa - q.wa).forEach((run) => {
    let x = 0;
    for (let k = run.la; k <= run.lb; k += 1) x = Math.max(x, rows[k].right + 18);
    const [lo, hi] = gaps(run);
    placed.forEach((other) => { const [olo, ohi] = gaps(other); if (Math.max(lo, olo) <= Math.min(hi, ohi)) x = Math.max(x, other.x + 12); });
    run.x = Math.round(x);
    placed.push(run);
  });

  // An end that went round its word has its upright crossing that row ("back"); the others leave it behind. Along a
  // row the back ones run nearest it, the outer further; then the others, the outer nearest. On a word, left to right:
  // brackets to a word on the left, the shorter first; the runs to the margin, the others with the outer to the right,
  // then the back ones with the outer to the left; brackets to a word on the right, the longer first. So no run passes
  // over an upright, and no two ends share a point (Codex, 30.10).
  const back = (end: End) => end.side !== end.home;
  const grouped = (key: (end: End) => string) => {
    const groups = new Map<string, End[]>();
    ends.forEach((end) => groups.set(key(end), [...(groups.get(key(end)) ?? []), end]));
    return groups;
  };
  const slots = new Map<string, { runs: End[]; held: BracketEnd[] }>();
  const slot = (key: string) => { const found = slots.get(key) ?? { runs: [], held: [] }; slots.set(key, found); return found; };
  ends.forEach((end) => slot(`${end.word}:${end.side}`).runs.push(end));
  bracketEnds.forEach((end) => slot(`${end.word}:${end.side}`).held.push(end));
  slots.forEach(({ runs: list, held }, key) => {
    const order: (End | BracketEnd)[] = [
      ...held.filter((end) => !end.toRight).sort((p, q) => p.span - q.span),
      ...list.filter((end) => !back(end)).sort((p, q) => p.run.x - q.run.x), ...list.filter(back).sort((p, q) => q.run.x - p.run.x),
      ...held.filter((end) => end.toRight).sort((p, q) => q.span - p.span),
    ];
    order.forEach((end, j) => {
      const share = (j + 1) / (order.length + 1);
      end.x = Math.round(end.box.x + end.box.w * (tieIn.has(key) ? 0.5 + share / 2 : share));
    });
  });
  grouped((end) => `${end.line}:${end.side}`).forEach((list) => {
    const order = [...list.filter(back).sort((p, q) => p.run.x - q.run.x), ...list.filter((end) => !back(end)).sort((p, q) => q.run.x - p.run.x)];
    order.forEach((end, j) => { end.dist = below(end.line, end.side) + 5 * j; });
  });

  return runs.map((run) => {
    const heads = relationHeads(run.relation);
    const forward = run.wa === run.relation.a;
    const tips = forward ? { first: heads.atA, last: heads.atB } : { first: heads.atB, last: heads.atA };
    const { a, b } = run;
    if (run.lb === run.la) {
      const { side, at } = stacked.get(run)!;
      const ax = bracketEnds.find((end) => end.run === run && end.word === run.wa)!.x;
      const bx = bracketEnds.find((end) => end.run === run && end.word === run.wb)!.x;
      const step = 6 + 4 * tiesBy(run.la, side) + 5 * at;
      const points: Point[] = side === 'top'
        ? [[ax, a.y - 1], [ax, rows[run.la].top - step], [bx, rows[run.la].top - step], [bx, b.y - 1]]
        : [[ax, a.y + a.h + 1], [ax, rows[run.la].bottom + step], [bx, rows[run.la].bottom + step], [bx, b.y + b.h + 1]];
      return { relation: run.relation, points, ...rounded(points, tips) };
    }
    const edge = (end: End) => (end.side === 'bottom' ? end.box.y + end.box.h + 1 : end.box.y - 1);
    const height = (end: End) => (end.side === 'bottom' ? end.box.y + end.box.h + end.dist : end.box.y - end.dist);
    const from = endOf(run, 'a'); const to = endOf(run, 'b');
    const points: Point[] = [[from.x, edge(from)], [from.x, height(from)], [run.x, height(from)], [run.x, height(to)], [to.x, height(to)], [to.x, edge(to)]];
    return { relation: run.relation, points, ...rounded(points, tips) };
  });
}

/**
 * The arrows of an analysis's ties, only where the indent does not already say what a part hangs on (`needsArrow`):
 * grouped by the part they enter, each in its lane, its upright left of every line it passes. `lit` — whether a part's
 * arrow is drawn lit. One routing for the analysis screen and for the analysis drawn small in the reader's list.
 */
export function tieArrows(state: AnalysisState, geometry: Geometry, lit: (start: number) => boolean = () => false): Arrow[] {
  const starts = partStarts(state);
  const out: Arrow[] = [];
  const byHolder = new Map<number, number[]>();
  starts.filter((start) => needsArrow(state, start)).forEach((start) => { const holder = holderOf(state, start)!; byHolder.set(holder, [...(byHolder.get(holder) ?? []), start]); });
  const lanes = new Map<string, number>();
  byHolder.forEach((parts) => parts.forEach((start, k) => {
    const from = fromLine(geometry, start);
    const to = geometry.words[String(state.links[start])];
    if (!from || !to) return;
    const target = partOf(state, state.links[start]);
    const side = `${target}:${to.y < from.y ? 'below' : 'above'}`;
    const lane = lanes.get(side) ?? 0;
    lanes.set(side, lane + 1);
    const passed = starts.filter((part) => part > Math.min(start, target) && part < Math.max(start, target));
    const clear = Math.min(Infinity, ...passed.map((part) => fromLine(geometry, part)?.x ?? Infinity));
    out.push({ key: `a${start}`, start, ...arrowPath(from, to, k, clear, lane), lit: lit(start) });
  }));
  return out;
}

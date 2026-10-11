import { mergeOutline } from '@/utils/mergeOutline';

import type { OutlinePoint, SermonOutline } from '@/models/models';

const point = (id: string, text: string, extra: Partial<OutlinePoint> = {}): OutlinePoint => ({
  id,
  text,
  ...extra,
});

const outline = (main: OutlinePoint[], introduction: OutlinePoint[] = [], conclusion: OutlinePoint[] = []): SermonOutline => ({
  introduction,
  main,
  conclusion,
});

/**
 * The scenarios are written the way the app is actually used: one person, a
 * laptop in the evening, a phone in the morning, back to the laptop at noon.
 * Nobody is racing milliseconds — the gap between the two edits is hours, which
 * is exactly why the laptop's snapshot is stale enough to erase real work.
 */
describe('mergeOutline — two devices, hours apart', () => {
  it('keeps the point added on the phone when the laptop saves its own plan', () => {
    const base = outline([point('p1', 'Grace')]);
    const mine = outline([point('p1', 'Grace, expanded on the laptop')]);
    const theirs = outline([point('p1', 'Grace'), point('p2', 'Added on the phone')]);

    const { outline: merged, collisions } = mergeOutline(base, mine, theirs);

    expect(merged.main.map((p) => p.text)).toEqual([
      'Grace, expanded on the laptop',
      'Added on the phone',
    ]);
    expect(collisions).toEqual([]);
  });

  it('keeps the phone edit of a point the laptop never touched', () => {
    const base = outline([point('p1', 'Grace'), point('p2', 'Law')]);
    const mine = outline([point('p1', 'Grace, expanded'), point('p2', 'Law')]);
    const theirs = outline([point('p1', 'Grace'), point('p2', 'Law, rewritten on the phone')]);

    const { outline: merged, collisions } = mergeOutline(base, mine, theirs);

    expect(merged.main.map((p) => p.text)).toEqual(['Grace, expanded', 'Law, rewritten on the phone']);
    expect(collisions).toEqual([]);
  });

  it('reports a collision instead of guessing when BOTH devices rewrote the same point', () => {
    const base = outline([point('p1', 'Grace')]);
    const mine = outline([point('p1', 'Grace — laptop wording')]);
    const theirs = outline([point('p1', 'Grace — phone wording')]);

    const { outline: merged, collisions } = mergeOutline(base, mine, theirs);

    expect(collisions).toEqual(['p1']);
    // Nothing is silently discarded: the local text stays on screen and the caller
    // is told there is something to settle.
    expect(merged.main[0].text).toBe('Grace — laptop wording');
  });

  it('honours a deletion made here and does not resurrect the point from the server', () => {
    const base = outline([point('p1', 'Grace'), point('p2', 'Law')]);
    const mine = outline([point('p1', 'Grace')]);
    const theirs = outline([point('p1', 'Grace'), point('p2', 'Law')]);

    const { outline: merged } = mergeOutline(base, mine, theirs);

    expect(merged.main.map((p) => p.id)).toEqual(['p1']);
  });

  it('honours a deletion made on the other device when nothing was written here', () => {
    const base = outline([point('p1', 'Grace'), point('p2', 'Law')]);
    const mine = outline([point('p1', 'Grace'), point('p2', 'Law')]);
    const theirs = outline([point('p1', 'Grace')]);

    const { outline: merged } = mergeOutline(base, mine, theirs);

    expect(merged.main.map((p) => p.id)).toEqual(['p1']);
  });

  it('keeps text written here even when the other device deleted that point', () => {
    // Written words beat an absence: the person typed this after the plan opened.
    const base = outline([point('p1', 'Grace'), point('p2', 'Law')]);
    const mine = outline([point('p1', 'Grace'), point('p2', 'Law — with the illustration I want')]);
    const theirs = outline([point('p1', 'Grace')]);

    const { outline: merged } = mergeOutline(base, mine, theirs);

    expect(merged.main.map((p) => p.text)).toEqual(['Grace', 'Law — with the illustration I want']);
  });

  it('keeps a reorder made here and still lands their addition next to its neighbour', () => {
    const base = outline([point('p1', 'One'), point('p2', 'Two')]);
    const mine = outline([point('p2', 'Two'), point('p1', 'One')]);
    const theirs = outline([point('p1', 'One'), point('p3', 'Added after One'), point('p2', 'Two')]);

    const { outline: merged } = mergeOutline(base, mine, theirs);

    expect(merged.main.map((p) => p.id)).toEqual(['p2', 'p1', 'p3']);
  });

  it('asks instead of DUPLICATING when the same point was moved to different sections', () => {
    // Base: the point sits in the Introduction. The laptop moved it to Main, the
    // phone to the Conclusion. Sections merge independently, so each side looked
    // like a plain "added elsewhere" — and the point appeared TWICE with nobody
    // asked. Ownership of an id is global.
    const base: SermonOutline = {
      introduction: [point('p1', 'Grace')],
      main: [],
      conclusion: [],
    };
    const mine: SermonOutline = { introduction: [], main: [point('p1', 'Grace')], conclusion: [] };
    const theirs: SermonOutline = {
      introduction: [],
      main: [],
      conclusion: [point('p1', 'Grace')],
    };

    const { outline: merged, collisions } = mergeOutline(base, mine, theirs);

    const appearances = [...merged.introduction, ...merged.main, ...merged.conclusion].filter(
      (candidate) => candidate.id === 'p1'
    );
    expect(appearances).toHaveLength(1);
    expect(collisions).toEqual(['p1']);
    // This editor's placement stands until the person decides otherwise.
    expect(merged.main.map((candidate) => candidate.id)).toEqual(['p1']);
  });

  it('still takes a move made ONLY on the other device', () => {
    // One-sided move is not a conflict: nothing here contradicts it.
    const base: SermonOutline = { introduction: [point('p1', 'Grace')], main: [], conclusion: [] };
    const mine: SermonOutline = { introduction: [point('p1', 'Grace')], main: [], conclusion: [] };
    const theirs: SermonOutline = { introduction: [], main: [point('p1', 'Grace')], conclusion: [] };

    const { collisions } = mergeOutline(base, mine, theirs);

    expect(collisions).toEqual([]);
  });

  it('keeps the phone\'s REWRITE when the laptop only MOVED that point', () => {
    // Verified live by probe on the previous version: the point kept its new
    // placement with the OLD text and the phone's paragraph vanished, with no
    // collision reported. Placement and content are two separate decisions.
    const base: SermonOutline = { introduction: [point('p1', 'Grace')], main: [], conclusion: [] };
    const mine: SermonOutline = { introduction: [], main: [point('p1', 'Grace')], conclusion: [] };
    const theirs: SermonOutline = {
      introduction: [point('p1', 'Grace — rewritten on the phone')],
      main: [],
      conclusion: [],
    };

    const { outline: merged, collisions } = mergeOutline(base, mine, theirs);

    const all = [...merged.introduction, ...merged.main, ...merged.conclusion];
    expect(all).toHaveLength(1);
    // MY placement (I moved it), THEIR text (only they rewrote it).
    expect(merged.main.map((x) => x.text)).toEqual(['Grace — rewritten on the phone']);
    expect(collisions).toEqual([]);
  });

  it('keeps MY rewrite when the phone only MOVED that point, without duplicating it', () => {
    const base: SermonOutline = { introduction: [point('p1', 'Grace')], main: [], conclusion: [] };
    const mine: SermonOutline = {
      introduction: [point('p1', 'Grace — expanded on the laptop')],
      main: [],
      conclusion: [],
    };
    const theirs: SermonOutline = { introduction: [], main: [point('p1', 'Grace')], conclusion: [] };

    const { outline: merged, collisions } = mergeOutline(base, mine, theirs);

    const all = [...merged.introduction, ...merged.main, ...merged.conclusion];
    expect(all).toHaveLength(1);
    // THEIR placement (they moved it), MY text (only I rewrote it).
    expect(merged.main.map((x) => x.text)).toEqual(['Grace — expanded on the laptop']);
    expect(collisions).toEqual([]);
  });

  it('does NOT let a deletion here erase a rewrite made there', () => {
    // Verified by the eighth review: the laptop deleted a point while the phone was
    // rewriting it, and the rewrite disappeared with no question asked. An absence
    // must never outrank words someone typed.
    const base: SermonOutline = { introduction: [], main: [point('p1', 'Grace')], conclusion: [] };
    const mine: SermonOutline = { introduction: [], main: [], conclusion: [] };
    const theirs: SermonOutline = {
      introduction: [],
      main: [point('p1', 'Grace — rewritten on the phone')],
      conclusion: [],
    };

    const { outline: merged, collisions } = mergeOutline(base, mine, theirs);

    expect(merged.main.map((p) => p.text)).toEqual(['Grace — rewritten on the phone']);
    expect(collisions).toEqual(['p1']);
  });

  it('still honours a deletion when the other device left the point alone', () => {
    const base: SermonOutline = { introduction: [], main: [point('p1', 'Grace')], conclusion: [] };
    const mine: SermonOutline = { introduction: [], main: [], conclusion: [] };
    const theirs: SermonOutline = { introduction: [], main: [point('p1', 'Grace')], conclusion: [] };

    const { outline: merged, collisions } = mergeOutline(base, mine, theirs);

    expect(merged.main).toEqual([]);
    expect(collisions).toEqual([]);
  });

  it('merges the sub-points and the note of a point, not only its text', () => {
    const base = outline([point('p1', 'Grace', { subPoints: [] })]);
    const mine = outline([point('p1', 'Grace', { subPoints: [] })]);
    const theirs = outline([
      point('p1', 'Grace', {
        note: 'remember the illustration',
        subPoints: [{ id: 's1', text: 'from the phone', position: 1 }],
      }),
    ]);

    const { outline: merged, collisions } = mergeOutline(base, mine, theirs);

    expect(merged.main[0].note).toBe('remember the illustration');
    expect(merged.main[0].subPoints).toHaveLength(1);
    expect(collisions).toEqual([]);
  });

  it('merges each section independently', () => {
    const base: SermonOutline = {
      introduction: [point('i1', 'Opening')],
      main: [point('m1', 'Body')],
      conclusion: [],
    };
    const mine: SermonOutline = {
      introduction: [point('i1', 'Opening, sharper')],
      main: [point('m1', 'Body')],
      conclusion: [],
    };
    const theirs: SermonOutline = {
      introduction: [point('i1', 'Opening')],
      main: [point('m1', 'Body')],
      conclusion: [point('c1', 'Call, added on the phone')],
    };

    const { outline: merged, collisions } = mergeOutline(base, mine, theirs);

    expect(merged.introduction[0].text).toBe('Opening, sharper');
    expect(merged.conclusion.map((p) => p.text)).toEqual(['Call, added on the phone']);
    expect(collisions).toEqual([]);
  });

  it('passes the local plan through when the document has no server version yet', () => {
    const mine = outline([point('p1', 'First draft')]);
    expect(mergeOutline(null, mine, null).outline).toBe(mine);
  });

  /**
   * ORDER IS WORK TOO.
   *
   * The order of the points IS the shape of the sermon — moving the conclusion ahead
   * of the main part is a decision, not formatting. Until now the order of a section
   * was always taken from this editor, so a reordering done on the phone was undone
   * the moment anything at all was saved from a laptop that had been open since the
   * night before. Nothing was reported, because no point's TEXT had changed.
   *
   * Resolved the same way as content: whoever moved decides. It is deliberately NOT
   * reported as a collision — a refusal over ordering would teach the person to
   * dismiss the question, and then a real collision goes with it.
   */
  it('keeps a reordering made on the phone when nothing was reordered here', () => {
    const base = outline([point('a', 'A'), point('b', 'B'), point('c', 'C')]);
    // The laptop only rewords a point; it never touches the order.
    const mine = outline([point('a', 'A, reworded'), point('b', 'B'), point('c', 'C')]);
    const theirs = outline([point('b', 'B'), point('a', 'A'), point('c', 'C')]);

    const { outline: merged, collisions } = mergeOutline(base, mine, theirs);

    expect(merged.main.map((p) => p.id)).toEqual(['b', 'a', 'c']);
    // The wording written here still wins — only the order came from the phone.
    expect(merged.main.find((p) => p.id === 'a')?.text).toBe('A, reworded');
    expect(collisions).toEqual([]);
  });

  it('emits a server point only once when the server order contains its id twice', () => {
    const base = outline([point('a', 'A'), point('b', 'B'), point('c', 'C')]);
    const mine = outline([point('a', 'A'), point('b', 'B'), point('c', 'C')]);
    // Older app versions could persist duplicate ids. The phone-side reorder makes
    // the server sequence authoritative, which used to emit `b` once per occurrence.
    const theirs = outline([point('b', 'B'), point('a', 'A'), point('b', 'B'), point('c', 'C')]);

    expect(mergeOutline(base, mine, theirs).outline.main.map((p) => p.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('emits a duplicated server id in only one section', () => {
    const base = outline([]);
    const mine = outline([]);
    const theirs: SermonOutline = {
      introduction: [point('p', 'Opening copy')],
      main: [point('p', 'Main copy')],
      conclusion: [],
    };

    const merged = mergeOutline(base, mine, theirs).outline;

    expect([...merged.introduction, ...merged.main, ...merged.conclusion].map((p) => p.id)).toEqual([
      'p',
    ]);
    expect(merged.introduction.map((p) => p.text)).toEqual(['Opening copy']);
  });

  it('emits a local point only once when the local order contains its id twice', () => {
    const base = outline([point('a', 'A'), point('b', 'B'), point('c', 'C')]);
    const mine = outline([point('b', 'B'), point('a', 'A'), point('b', 'B'), point('c', 'C')]);
    const theirs = outline([point('a', 'A'), point('b', 'B'), point('c', 'C')]);

    expect(mergeOutline(base, mine, theirs).outline.main.map((p) => p.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('keeps the reordering made here when the phone left the order alone', () => {
    const base = outline([point('a', 'A'), point('b', 'B'), point('c', 'C')]);
    const mine = outline([point('c', 'C'), point('a', 'A'), point('b', 'B')]);
    const theirs = outline([point('a', 'A'), point('b', 'B'), point('c', 'C, reworded')]);

    const { outline: merged, collisions } = mergeOutline(base, mine, theirs);

    expect(merged.main.map((p) => p.id)).toEqual(['c', 'a', 'b']);
    expect(collisions).toEqual([]);
  });

  it('lets this editor win when BOTH reordered, without raising a question', () => {
    const base = outline([point('a', 'A'), point('b', 'B'), point('c', 'C')]);
    const mine = outline([point('b', 'B'), point('a', 'A'), point('c', 'C')]);
    const theirs = outline([point('a', 'A'), point('c', 'C'), point('b', 'B')]);

    const { outline: merged, collisions } = mergeOutline(base, mine, theirs);

    expect(merged.main.map((p) => p.id)).toEqual(['b', 'a', 'c']);
    // No refusal over ordering: see above.
    expect(collisions).toEqual([]);
  });

  /**
   * A POINT ADDED AT THE FRONT ELSEWHERE MUST NOT LAND AT THE BACK.
   *
   * Found by an independent review of this change (2026-08-10) and reproduced here
   * before fixing: only the immediate predecessor was consulted for placement, so a
   * point with nothing before it had no anchor at all and was appended last. The
   * preacher opens his plan and finds the thought he meant to start with sitting
   * after the conclusion of that section.
   */
  it('keeps a point the other device inserted at the FRONT at the front', () => {
    const base = outline([point('a', 'A'), point('b', 'B')]);
    const mine = outline([point('a', 'A'), point('b', 'B')]);
    const theirs = outline([point('x', 'Added first on the phone'), point('a', 'A'), point('b', 'B')]);

    expect(mergeOutline(base, mine, theirs).outline.main.map((p) => p.id)).toEqual(['x', 'a', 'b']);
  });

  it('keeps a point MOVED into this section ahead of everything at the front', () => {
    const base = outline([point('a', 'A'), point('b', 'B')], [point('m', 'M')]);
    const mine = outline([point('a', 'A'), point('b', 'B')], [point('m', 'M')]);
    // The phone moved `m` out of the introduction and put it first in the main part.
    const theirs = outline([point('m', 'M'), point('a', 'A'), point('b', 'B')], []);

    expect(mergeOutline(base, mine, theirs).outline.main.map((p) => p.id)).toEqual(['m', 'a', 'b']);
  });

  it('puts an addition first when its preceding server point was deleted by the merge', () => {
    const base = outline([point('removed', 'Remove me'), point('a', 'A'), point('b', 'B')]);
    const mine = outline([point('a', 'A'), point('b', 'B')]);
    const theirs = outline([
      point('removed', 'Remove me'),
      point('x', 'Added after the point that was removed'),
      point('a', 'A'),
      point('b', 'B'),
    ]);

    expect(mergeOutline(base, mine, theirs).outline.main.map((p) => p.id)).toEqual(['x', 'a', 'b']);
  });

  it('deduplicates a brand-new local plan within and across sections', () => {
    const mine: SermonOutline = {
      introduction: [point('p', 'Opening')],
      main: [point('p', 'Duplicate placement'), point('q', 'First copy'), point('q', 'Latest copy')],
      conclusion: [point('q', 'Duplicate placement')],
    };

    const merged = mergeOutline(null, mine, null).outline;

    expect(merged.introduction.map((p) => p.id)).toEqual(['p']);
    expect(merged.main.map((p) => [p.id, p.text])).toEqual([['q', 'Latest copy']]);
    expect(merged.conclusion).toEqual([]);
  });

  it('treats an unknown base as "changed on both sides" rather than assuming agreement', () => {
    // No base means we cannot tell who wrote what. A collision is the honest
    // answer — better an unnecessary question than a silent overwrite.
    const mine = outline([point('p1', 'Laptop wording')]);
    const theirs = outline([point('p1', 'Phone wording')]);

    expect(mergeOutline(null, mine, theirs).collisions).toEqual(['p1']);
  });

  /*
   * One point edited on both devices, in DIFFERENT parts (BUG-20261011-outline-point-merge-loses-subpoint-edit):
   * the point used to be taken whole from this side, so the phone's sub-point went back to its old words.
   * The parts merge like the rest of the plan — fields by name, sub-points by id; only the same part
   * written differently on both sides is a question.
   */
  it('keeps the phone edit of one sub-point and the laptop edit of another in the same point', () => {
    const subs = (x: string, y: string) => [{ id: 'sx', text: x, position: 1 }, { id: 'sy', text: y, position: 2 }];
    const base = outline([point('p1', 'Grace', { subPoints: subs('X', 'Y') })]);
    const mine = outline([point('p1', 'Grace', { subPoints: subs('X on the laptop', 'Y') })]);
    const theirs = outline([point('p1', 'Grace', { subPoints: subs('X', 'Y on the phone') })]);

    const { outline: merged, collisions } = mergeOutline(base, mine, theirs);

    expect(collisions).toEqual([]);
    expect(merged.main[0].subPoints?.map(sub => sub.text)).toEqual(['X on the laptop', 'Y on the phone']);
  });

  it("keeps the phone's note and the laptop's sub-point in the same point", () => {
    const base = outline([point('p1', 'Grace', { note: 'old note', subPoints: [{ id: 'sx', text: 'X', position: 1 }] })]);
    const mine = outline([point('p1', 'Grace', { note: 'old note', subPoints: [{ id: 'sx', text: 'X on the laptop', position: 1 }] })]);
    const theirs = outline([point('p1', 'Grace', { note: 'note from the phone', subPoints: [{ id: 'sx', text: 'X', position: 1 }] })]);

    const { outline: merged, collisions } = mergeOutline(base, mine, theirs);

    expect(collisions).toEqual([]);
    expect(merged.main[0].note).toBe('note from the phone');
    expect(merged.main[0].subPoints?.[0].text).toBe('X on the laptop');
  });

  it('still asks when the same sub-point was rewritten on both devices', () => {
    const base = outline([point('p1', 'Grace', { subPoints: [{ id: 'sx', text: 'X', position: 1 }] })]);
    const mine = outline([point('p1', 'Grace', { subPoints: [{ id: 'sx', text: 'X laptop', position: 1 }] })]);
    const theirs = outline([point('p1', 'Grace', { subPoints: [{ id: 'sx', text: 'X phone', position: 1 }] })]);

    const { outline: merged, collisions } = mergeOutline(base, mine, theirs);

    expect(collisions).toEqual(['p1']);
    expect(merged.main[0].subPoints?.[0].text).toBe('X laptop');
  });

  it('still asks when both devices changed the skeleton of a point (first sub-points added on each)', () => {
    // Words merge; the skeleton — which sub-points, in what order — stays a question, as before.
    const base = outline([point('p1', 'Grace')]);
    const mine = outline([point('p1', 'Grace', { subPoints: [{ id: 'a', text: 'From the laptop', position: 1 }] })]);
    const theirs = outline([point('p1', 'Grace', { subPoints: [{ id: 'b', text: 'From the phone', position: 2 }] })]);

    expect(mergeOutline(base, mine, theirs).collisions).toEqual(['p1']);
  });

  it('asks instead of handing over a plan that holds one sub-point in two places', () => {
    // The two devices moved "a" to different points, and an unrelated point merged cleanly:
    // the plan must not go out with "a" twice and no question.
    const sub = { id: 'a', text: 'Moving', position: 1 };
    const base = outline([point('p1', 'One', { subPoints: [sub] }), point('p2', 'Two', { subPoints: [] }), point('p3', 'Three', { subPoints: [] }), point('p4', 'Four')]);
    const mine = outline([point('p1', 'One', { subPoints: [] }), point('p2', 'Two', { subPoints: [sub] }), point('p3', 'Three', { subPoints: [] }), point('p4', 'Four on the laptop')]);
    const theirs = outline([point('p1', 'One', { subPoints: [] }), point('p2', 'Two', { subPoints: [] }), point('p3', 'Three', { subPoints: [sub] }), point('p4', 'Four', { note: 'phone note' })]);

    expect(mergeOutline(base, mine, theirs).collisions.sort()).toEqual(['p2', 'p3']);
  });

  it('keeps the visible order when one device appends a sub-point and the other reorders them', () => {
    const base = outline([point('p1', 'Grace', { subPoints: [{ id: 'a', text: 'A', position: 0 }, { id: 'b', text: 'B', position: 1 }] })]);
    const mine = outline([point('p1', 'Grace', { subPoints: [{ id: 'a', text: 'A', position: 0 }, { id: 'b', text: 'B', position: 1 }, { id: 'c', text: 'C', position: 1001 }] })]);
    const theirs = outline([point('p1', 'Grace', { subPoints: [{ id: 'b', text: 'B', position: 1000 }, { id: 'a', text: 'A', position: 2000 }] })]);

    const { outline: merged, collisions } = mergeOutline(base, mine, theirs);

    // The skeleton changed on both sides: a question, and this side's order stays as it was.
    expect(collisions).toEqual(['p1']);
    expect(merged.main[0].subPoints?.map(sub => sub.id)).toEqual(['a', 'b', 'c']);
  });

  it('asks, and under "keep mine" keeps one place, when the devices moved a sub-point under different points', () => {
    const sub = { id: 'a', text: 'Moving sub-point', position: 1 };
    const base = outline([point('p1', 'One', { subPoints: [sub] }), point('p2', 'Two', { subPoints: [] }), point('p3', 'Three', { subPoints: [] })]);
    // This device moves it under p2 and writes p3's note; the phone moves it under p3 and writes p2's note.
    const mine = outline([point('p1', 'One', { subPoints: [] }), point('p2', 'Two', { subPoints: [sub] }), point('p3', 'Three', { note: 'laptop note', subPoints: [] })]);
    const theirs = outline([point('p1', 'One', { subPoints: [] }), point('p2', 'Two', { note: 'phone note', subPoints: [] }), point('p3', 'Three', { subPoints: [sub] })]);

    expect(mergeOutline(base, mine, theirs).collisions.sort()).toEqual(['p2', 'p3']);
    const kept = mergeOutline(base, mine, theirs, true).outline;
    expect(kept.main.flatMap(p => (p.subPoints ?? []).map(s => `${p.id}/${s.id}`))).toEqual(['p2/a']);
  });

  it('asks when one device makes a sub-point a point and the other moves it under another point', () => {
    const sub = { id: 'a', text: 'Promoted or moved', position: 1 };
    const base = outline([point('p1', 'One', { subPoints: [sub] }), point('p2', 'Two', { subPoints: [] })]);
    const mine = outline([point('p1', 'One', { note: 'laptop note', subPoints: [] }), point('p2', 'Two', { subPoints: [] }), point('a', 'Promoted or moved')]);
    const theirs = outline([point('p1', 'One rewritten', { subPoints: [] }), point('p2', 'Two', { subPoints: [sub] })]);

    expect(mergeOutline(base, mine, theirs).collisions).toContain('p1');
  });

  it('does not count an empty note against a note written on the other device', () => {
    const base = outline([point('p1', 'Grace', { subPoints: [{ id: 'sx', text: 'X', position: 1 }] })]);
    const mine = outline([point('p1', 'Grace', { note: '', subPoints: [{ id: 'sx', text: 'X on the laptop', position: 1, note: '' }] })]);
    const theirs = outline([point('p1', 'Grace', { subPoints: [{ id: 'sx', text: 'X', position: 1, note: 'phone note' }] })]);

    const { outline: merged, collisions } = mergeOutline(base, mine, theirs);

    expect(collisions).toEqual([]);
    expect(merged.main[0].subPoints?.[0]).toEqual(expect.objectContaining({ text: 'X on the laptop', note: 'phone note' }));
  });

  it('tells a point id that looks like a place label from the place itself', () => {
    // A point literally named "top:a": the check must not mistake it for "point a at the top".
    const base = outline([point('p0', 'Zero', { subPoints: [{ id: 'a', text: 'A', position: 1 }] }), point('top:a', 'Named oddly', { subPoints: [] }), point('p4', 'Four')]);
    const mine = outline([point('p0', 'Zero', { subPoints: [] }), point('top:a', 'Named oddly', { subPoints: [] }), point('a', 'A'), point('p4', 'Four on the laptop')]);
    const theirs = outline([point('p0', 'Zero', { subPoints: [] }), point('top:a', 'Named oddly', { subPoints: [{ id: 'a', text: 'A', position: 1 }] }), point('p4', 'Four', { note: 'phone note' })]);

    expect(mergeOutline(base, mine, theirs).collisions).toEqual(expect.arrayContaining(['a', 'top:a']));
  });

  it('keeps the old question for a point whose sub-points have no id or repeat one', () => {
    const broken = [{ id: 'a', text: 'A', position: 1 }, { id: 'a', text: 'A again', position: 2 }];
    const base = outline([point('p1', 'Grace', { subPoints: broken })]);
    const mine = outline([point('p1', 'Grace on the laptop', { subPoints: broken })]);
    const theirs = outline([point('p1', 'Grace', { note: 'phone note', subPoints: broken })]);

    expect(mergeOutline(base, mine, theirs).collisions).toEqual(['p1']);
  });
});

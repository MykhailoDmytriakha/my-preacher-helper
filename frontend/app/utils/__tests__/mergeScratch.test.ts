import { mergeScratch } from '@/utils/mergeScratch';

import type { ScratchNote } from '@/models/models';

const note = (id: string, text: string): ScratchNote => ({
  id,
  text,
  createdAt: '2026-07-01T00:00:00.000Z',
});

/**
 * One person, a laptop and a phone, hours apart — not scripts racing. The whole
 * point is that a note captured on one device must not vanish because the other
 * device saved its own list.
 */
describe('mergeScratch', () => {
  it('KEEPS the note captured on the phone when the laptop saves its own list', () => {
    const base = [note('a', 'first')];
    const mine = [note('a', 'first'), note('b', 'added on the laptop')];
    const stored = [note('a', 'first'), note('c', 'captured on the phone')];

    const merged = mergeScratch(base, mine, stored);

    expect(merged.map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('honours a deletion made here and does not resurrect the note', () => {
    const base = [note('a', 'first'), note('b', 'second')];
    const mine = [note('a', 'first')];
    const stored = [note('a', 'first'), note('b', 'second')];

    expect(mergeScratch(base, mine, stored).map((n) => n.id)).toEqual(['a']);
  });

  it('does NOT let a deletion here erase a note rewritten there', () => {
    // The mirror of the plan case, found by the same review. Deleting a note while
    // the other device is rewriting it must not destroy those words.
    const base = [note('a', 'original')];
    const mine: ScratchNote[] = [];
    const stored = [note('a', 'rewritten on the phone')];

    expect(mergeScratch(base, mine, stored).map((n) => n.text)).toEqual(['rewritten on the phone']);
  });

  it('keeps the local wording when the same note was edited in both places', () => {
    // The only genuine overlap. Settled the way it was settled before this function
    // existed — local wins — so this can never be worse than the whole-array write.
    const base = [note('a', 'original')];
    const mine = [note('a', 'edited on the laptop')];
    const stored = [note('a', 'edited on the phone')];

    expect(mergeScratch(base, mine, stored).map((n) => n.text)).toEqual(['edited on the laptop']);
  });

  it('keeps this screen\'s order and appends what it has never seen', () => {
    const base = [note('a', 'first')];
    const mine = [note('b', 'new on top'), note('a', 'first')];
    const stored = [note('a', 'first'), note('z', 'from the phone')];

    expect(mergeScratch(base, mine, stored).map((n) => n.id)).toEqual(['b', 'a', 'z']);
  });

  it('passes the local list through when there is no base to compare with', () => {
    const mine = [note('a', 'only local')];
    expect(mergeScratch(null, mine, [note('x', 'server')])).toBe(mine);
  });
});

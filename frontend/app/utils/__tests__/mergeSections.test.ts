import { mergeSections } from '@/utils/mergeSections';

/**
 * A thought created on the phone is not in the laptop's map at all. The whole-map
 * write dropped it out of every section, so it stopped being shown anywhere.
 */
describe('mergeSections', () => {
  it('keeps a thought this screen has never heard of, in its stored section', () => {
    const mine = { introduction: ['t1'], main: ['t2'], conclusion: [] };
    const stored = { introduction: ['t1'], main: ['t2'], conclusion: ['from-the-phone'] };

    expect(mergeSections(mine, stored)).toEqual({
      introduction: ['t1'],
      main: ['t2'],
      conclusion: ['from-the-phone'],
    });
  });

  it('respects a MOVE made here — a mentioned id is never duplicated', () => {
    const mine = { introduction: [], main: ['t1'], conclusion: [] };
    const stored = { introduction: ['t1'], main: [], conclusion: [] };

    const merged = mergeSections(mine, stored);

    expect(merged.main).toEqual(['t1']);
    expect(merged.introduction).toEqual([]);
  });

  it('keeps this screen\'s order within a section', () => {
    const mine = { introduction: [], main: ['b', 'a'], conclusion: [] };
    const stored = { introduction: [], main: ['a', 'b'], conclusion: [] };

    expect(mergeSections(mine, stored).main).toEqual(['b', 'a']);
  });

  it('carries the ambiguous bucket too', () => {
    const mine = { introduction: [], main: [], conclusion: [], ambiguous: ['mine'] };
    const stored = { introduction: [], main: [], conclusion: [], ambiguous: ['theirs'] };

    expect(mergeSections(mine, stored).ambiguous?.sort()).toEqual(['mine', 'theirs']);
  });

  it('passes the map through when there is nothing stored yet', () => {
    const mine = { introduction: [], main: ['t1'], conclusion: [] };
    expect(mergeSections(mine, null)).toBe(mine);
  });

  /**
   * A MOVE MADE ON THE OTHER DEVICE IS SOMEBODY'S WORK TOO.
   *
   * Without an opening arrangement this function cannot tell "I moved this thought"
   * from "I am merely holding where it used to be", so it always kept the local
   * placement — and a thought moved on the phone in the morning silently jumped back
   * when the laptop saved an unrelated drag at noon. Nothing warned anyone.
   */
  it('takes a move made ONLY on the other device', () => {
    const base = { introduction: ['t1'], main: [], conclusion: [] };
    const mine = { introduction: ['t1'], main: [], conclusion: [] };
    const stored = { introduction: [], main: ['t1'], conclusion: [] };

    const merged = mergeSections(mine, stored, base);

    expect(merged.main).toEqual(['t1']);
    expect(merged.introduction).toEqual([]);
  });

  it('keeps MY move when only I moved it', () => {
    const base = { introduction: ['t1'], main: [], conclusion: [] };
    const mine = { introduction: [], main: ['t1'], conclusion: [] };
    const stored = { introduction: ['t1'], main: [], conclusion: [] };

    const merged = mergeSections(mine, stored, base);

    expect(merged.main).toEqual(['t1']);
    expect(merged.introduction).toEqual([]);
  });

  it('keeps MY placement when both devices moved it, without duplicating it', () => {
    // Two placements cannot both be true and neither is text, so the local one stands
    // — but it must appear exactly once, and the freshness pill is what tells the
    // person the arrangement changed elsewhere.
    const base = { introduction: ['t1'], main: [], conclusion: [] };
    const mine = { introduction: [], main: ['t1'], conclusion: [] };
    const stored = { introduction: [], main: [], conclusion: ['t1'] };

    const merged = mergeSections(mine, stored, base);

    const appearances = [
      ...merged.introduction,
      ...merged.main,
      ...merged.conclusion,
    ].filter((id) => id === 't1');
    expect(appearances).toHaveLength(1);
    expect(merged.main).toEqual(['t1']);
  });

  it('without an opening arrangement behaves exactly as before', () => {
    const mine = { introduction: ['t1'], main: [], conclusion: [] };
    const stored = { introduction: [], main: ['t1'], conclusion: [] };

    expect(mergeSections(mine, stored).introduction).toEqual(['t1']);
  });
});

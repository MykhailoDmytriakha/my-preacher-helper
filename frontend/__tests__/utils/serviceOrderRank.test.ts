import {
  RANK_STEP,
  needsRenumber,
  rankBetween,
  rankForAppend,
  rankForMove,
  renumber,
  sortByRank,
} from '@/utils/serviceOrderRank';

/**
 * The ordering of the pastor's rites is his decision, and it has to survive two phones that
 * cannot see each other. These tests pin the three things that make that true: the same
 * sequence everywhere, one write per move, and a collapsed gap that says so instead of
 * silently writing a rank that cannot hold.
 */

const at = (id: string, rank: number) => ({ id, rank });

describe('service order ranks', () => {
  it('sorts by rank', () => {
    const sorted = sortByRank([at('c', 3000), at('a', 1000), at('b', 2000)]);
    expect(sorted.map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });

  /**
   * Two devices, both offline, drop different rites into the same gap and compute the same
   * midpoint. Without a tie-break each device keeps its own sequence and the list disagrees
   * with itself; the document id is the same on both, so both land on the same answer.
   */
  it('breaks equal ranks by document id, so two devices agree without talking', () => {
    const onePhone = sortByRank([at('zulu', 1500), at('alpha', 1500)]);
    const otherPhone = sortByRank([at('alpha', 1500), at('zulu', 1500)]);

    expect(onePhone.map((o) => o.id)).toEqual(['alpha', 'zulu']);
    expect(otherPhone.map((o) => o.id)).toEqual(onePhone.map((o) => o.id));
  });

  it('sorts an unusable rank to the end instead of throwing', () => {
    const broken = { id: 'x', rank: Number.NaN } as { id: string; rank: number };
    const sorted = sortByRank([broken, at('a', 1000)]);

    expect(sorted.map((o) => o.id)).toEqual(['a', 'x']);
  });

  it('appends after the last rank, and starts a list from nothing', () => {
    expect(rankForAppend([])).toBe(RANK_STEP);
    expect(rankForAppend([at('a', 1000), at('b', 2000)])).toBe(2000 + RANK_STEP);
  });

  it('places between neighbours and at both edges', () => {
    expect(rankBetween(1000, 2000)).toBe(1500);
    expect(rankBetween(null, 1000)).toBe(1000 - RANK_STEP);
    expect(rankBetween(1000, null)).toBe(1000 + RANK_STEP);
    expect(rankBetween(null, null)).toBe(RANK_STEP);
  });

  /**
   * The assertion that keeps a move honest: when the gap is gone the answer is "renumber",
   * never a rank equal to a neighbour — that would put two rites in one place and let the
   * tie-break decide an order the person did not choose.
   */
  it('refuses a midpoint when the gap has collapsed', () => {
    expect(rankBetween(1000, 1000 + 1e-9)).toBeNull();
    expect(needsRenumber([at('a', 1000), at('b', 1000 + 1e-9)])).toBe(true);
    expect(needsRenumber([at('a', 1000), at('b', 2000)])).toBe(false);
  });

  it('spreads the list cleanly when renumbering, keeping the order people see', () => {
    const spread = renumber([at('b', 2000), at('a', 1000), at('c', 2000 + 1e-9)]);

    expect(spread).toEqual([
      { id: 'a', rank: 1000 },
      { id: 'b', rank: 2000 },
      { id: 'c', rank: 3000 },
    ]);
  });

  describe('moving one rite', () => {
    const list = [at('funeral', 1000), at('wedding', 2000), at('baptism', 3000)];

    it('to the front', () => {
      const rank = rankForMove(list, 'baptism', 0);
      expect(rank).not.toBeNull();
      expect(sortByRank([...list.filter((o) => o.id !== 'baptism'), at('baptism', rank as number)])
        .map((o) => o.id)).toEqual(['baptism', 'funeral', 'wedding']);
    });

    it('to the middle', () => {
      const rank = rankForMove(list, 'baptism', 1);
      expect(sortByRank([...list.filter((o) => o.id !== 'baptism'), at('baptism', rank as number)])
        .map((o) => o.id)).toEqual(['funeral', 'baptism', 'wedding']);
    });

    /** Downwards is where index arithmetic usually slips: the moved row is gone from the list. */
    it('to the end', () => {
      const rank = rankForMove(list, 'funeral', 2);
      expect(sortByRank([...list.filter((o) => o.id !== 'funeral'), at('funeral', rank as number)])
        .map((o) => o.id)).toEqual(['wedding', 'baptism', 'funeral']);
    });

    it('clamps an index that points outside the list', () => {
      expect(rankForMove(list, 'funeral', 99)).toBe(3000 + RANK_STEP);
      expect(rankForMove(list, 'baptism', -5)).toBe(1000 - RANK_STEP);
    });

    it('says renumber when there is no room left where the person is pointing', () => {
      const tight = [at('a', 1000), at('b', 1000 + 1e-9), at('c', 5000)];
      expect(rankForMove(tight, 'c', 1)).toBeNull();
    });
  });

  /**
   * What actually exhausts a double is a gap that HALVES each time — dropping one rite into
   * the same place twice does not narrow anything, because its neighbours stay put. This walks
   * the real case: every new midpoint becomes the next upper bound.
   */
  it('runs out of room only after the gap is genuinely halved away, and says so', () => {
    const low = 1000;
    let high = 2000;
    let rounds = 0;
    let asked = false;

    for (let i = 0; i < 200; i += 1) {
      const mid = rankBetween(low, high);
      if (mid === null) { asked = true; break; }
      expect(mid).toBeGreaterThan(low);
      expect(mid).toBeLessThan(high);
      high = mid;
      rounds += 1;
    }

    expect(asked).toBe(true);
    // Thirty-odd halvings of a 1000-wide gap: far more reordering than a list of rites sees.
    expect(rounds).toBeGreaterThan(25);
    expect(needsRenumber([at('a', low), at('b', high)])).toBe(true);
    expect(renumber([at('b', high), at('a', low)]).map((o) => o.id)).toEqual(['a', 'b']);
  });
});

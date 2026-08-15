import {
  allowedCollisions,
  dropTargetPriority,
  isDropTargetEnabled,
  orderCollisions,
  SCRATCH_POOL_DROP_ID,
} from '@/utils/boardDnd';

describe('boardDnd — which target a drag is allowed to hit', () => {
  describe('priority when the pointer is over several targets at once', () => {
    /**
     * The pointer is always inside the column, usually inside a card, and — when
     * aimed at a seam — inside all three. Without an order the library's first
     * hit wins, and the drop means something nobody aimed at.
     */
    it('prefers the seam over the card, and the card over the column', () => {
      const collisions = [
        { id: 'section:introduction' },
        { id: 'into-point:p1' },
        { id: 'gap:introduction:2' },
      ];

      expect(orderCollisions(collisions).map((c) => c.id)).toEqual([
        'gap:introduction:2',
        'into-point:p1',
        'section:introduction',
      ]);
    });

    it('puts the sub-point seam at the same precision as the point seam', () => {
      expect(dropTargetPriority('subgap:p1:0')).toBe(dropTargetPriority('gap:main:0'));
    });

    it('ranks note strips above cards — a strip only exists inside one', () => {
      const ordered = orderCollisions([{ id: 'into-point:p1' }, { id: 'scratch-point:p1' }]);
      expect(ordered[0].id).toBe('scratch-point:p1');
    });

    it('leaves an unknown id last instead of letting it win by accident', () => {
      const ordered = orderCollisions([{ id: 'mystery' }, { id: 'section:main' }]);
      expect(ordered[0].id).toBe('section:main');
    });

    it('does not mutate the collisions it was handed', () => {
      const collisions = [{ id: 'section:main' }, { id: 'gap:main:0' }];
      orderCollisions(collisions);
      expect(collisions.map((c) => c.id)).toEqual(['section:main', 'gap:main:0']);
    });
  });

  describe('targets that cannot accept the drag are switched off entirely', () => {
    // The owner's complaint, in one sentence: "I pick up a card and everything
    // lights up, including places it cannot go."
    it('offers a note the strips, the pool and the cards — never the seams', () => {
      expect(isDropTargetEnabled('note', 'scratch-point:p1')).toBe(true);
      expect(isDropTargetEnabled('note', 'scratch-subpoint:s1')).toBe(true);
      expect(isDropTargetEnabled('note', SCRATCH_POOL_DROP_ID)).toBe(true);
      expect(isDropTargetEnabled('note', 'into-point:p1')).toBe(true);
      expect(isDropTargetEnabled('note', 'gap:main:0')).toBe(false);
      expect(isDropTargetEnabled('note', 'subgap:p1:0')).toBe(false);
      expect(isDropTargetEnabled('note', 'section:main')).toBe(false);
    });

    it('offers a point the seams, the cards and the columns — never a note strip', () => {
      expect(isDropTargetEnabled('point', 'gap:main:1')).toBe(true);
      expect(isDropTargetEnabled('point', 'into-point:p2')).toBe(true);
      expect(isDropTargetEnabled('point', 'section:conclusion')).toBe(true);
      expect(isDropTargetEnabled('point', 'scratch-point:p1')).toBe(false);
      expect(isDropTargetEnabled('point', SCRATCH_POOL_DROP_ID)).toBe(false);
    });

    it('treats a sub-point exactly like a point — both live in the order', () => {
      const ids = ['gap:main:1', 'subgap:p1:0', 'into-point:p2', 'section:main', 'scratch-point:p1', SCRATCH_POOL_DROP_ID];
      ids.forEach((id) => {
        expect(isDropTargetEnabled('sub', id)).toBe(isDropTargetEnabled('point', id));
      });
    });
  });
});

describe('allowedCollisions — validity is decided here, not by switching targets off', () => {
  const ids = (list: { id: string }[]) => list.map((c) => c.id);
  const collisions = [
    { id: 'section:main' },
    { id: 'into-point:p1' },
    { id: 'scratch-point:p1' },
    { id: 'gap:main:2' },
  ];

  it('keeps only what this drag may land on, most precise first', () => {
    expect(ids(allowedCollisions('point', collisions))).toEqual([
      'gap:main:2',
      'into-point:p1',
      'section:main',
    ]);
  });

  it('lets a note land on note strips and on a card, and nowhere else', () => {
    expect(ids(allowedCollisions('note', collisions))).toEqual(['scratch-point:p1', 'into-point:p1']);
  });

  it('passes everything through when nothing is being dragged', () => {
    // Order still applies, but no filtering: the caller has no drag to judge by.
    expect(allowedCollisions(null, collisions)).toHaveLength(collisions.length);
  });
});

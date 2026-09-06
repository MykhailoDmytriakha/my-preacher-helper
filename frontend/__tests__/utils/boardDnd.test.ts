import {
  allowedCollisions,
  dropTargetPriority,
  isDropTargetEnabled,
  NOTE_POOL_ID,
  noteSlotHeight,
  notePointContainerId,
  noteSubContainerId,
  orderCollisions,
  parseNoteContainerId,
  pickDeepestNoteContainer,
  resolveNoteCollision,
  resolveNoteSlot,
} from '@/utils/boardDnd';

describe('boardDnd — structural drags: which target a point may hit', () => {
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
    it('offers a note the containers only — never a seam, a card band or a column', () => {
      expect(isDropTargetEnabled('note', notePointContainerId('p1'))).toBe(true);
      expect(isDropTargetEnabled('note', noteSubContainerId('s1'))).toBe(true);
      expect(isDropTargetEnabled('note', NOTE_POOL_ID)).toBe(true);
      expect(isDropTargetEnabled('note', 'into-point:p1')).toBe(false);
      expect(isDropTargetEnabled('note', 'gap:main:0')).toBe(false);
      expect(isDropTargetEnabled('note', 'subgap:p1:0')).toBe(false);
      expect(isDropTargetEnabled('note', 'section:main')).toBe(false);
    });

    it('offers a point the seams, the cards and the columns — never a note container', () => {
      expect(isDropTargetEnabled('point', 'gap:main:1')).toBe(true);
      expect(isDropTargetEnabled('point', 'into-point:p2')).toBe(true);
      expect(isDropTargetEnabled('point', 'section:conclusion')).toBe(true);
      expect(isDropTargetEnabled('point', notePointContainerId('p1'))).toBe(false);
      expect(isDropTargetEnabled('point', noteSubContainerId('s1'))).toBe(false);
      expect(isDropTargetEnabled('point', NOTE_POOL_ID)).toBe(false);
    });

    it('treats a sub-point exactly like a point — both live in the order', () => {
      const ids = ['gap:main:1', 'subgap:p1:0', 'into-point:p2', 'section:main', notePointContainerId('p1'), NOTE_POOL_ID];
      ids.forEach((id) => {
        expect(isDropTargetEnabled('sub', id)).toBe(isDropTargetEnabled('point', id));
      });
    });
  });

  describe('allowedCollisions — validity is decided here, not by switching targets off', () => {
    const ids = (list: { id: string }[]) => list.map((c) => c.id);
    const collisions = [
      { id: 'section:main' },
      { id: 'into-point:p1' },
      { id: notePointContainerId('p1') },
      { id: 'gap:main:2' },
    ];

    it('keeps only what this drag may land on, most precise first', () => {
      expect(ids(allowedCollisions('point', collisions))).toEqual(['gap:main:2', 'into-point:p1', 'section:main']);
    });

    it('passes everything through when nothing is being dragged', () => {
      expect(allowedCollisions(null, collisions)).toHaveLength(collisions.length);
    });
  });
});

describe('boardDnd — a note in the air lands in a container', () => {
  it('names the three kinds of container and nothing else', () => {
    expect(parseNoteContainerId(NOTE_POOL_ID)).toEqual({ kind: 'pool' });
    expect(parseNoteContainerId(notePointContainerId('p1'))).toEqual({ kind: 'point', pointId: 'p1' });
    expect(parseNoteContainerId(noteSubContainerId('s1'))).toEqual({ kind: 'sub', subPointId: 's1' });
    expect(parseNoteContainerId('into-point:p1')).toBeNull();
    expect(parseNoteContainerId('gap:main:0')).toBeNull();
  });

  it('lets the sub-point row win over the point card it sits in', () => {
    // The owner's screenshot: pointer over the sub-point's title, the PARENT lit,
    // the note landed on the parent. Depth decides, not DOM order.
    const picked = pickDeepestNoteContainer([
      { id: notePointContainerId('p1') },
      { id: noteSubContainerId('s1') },
      { id: NOTE_POOL_ID },
    ]);
    expect(picked?.id).toBe(noteSubContainerId('s1'));
  });

  describe('resolveNoteSlot — the nearest card and its half decide', () => {
    const card = (top: number, height = 80, left = 0, width = 300) => ({ top, left, width, height });
    const list = [card(0), card(100), card(200)]; // 20px gaps

    it('reads "before" from the upper half and "after" from the lower half', () => {
      expect(resolveNoteSlot({ x: 50, y: 110 }, list, false)).toMatchObject({ index: 1, side: 'before' });
      expect(resolveNoteSlot({ x: 50, y: 170 }, list, false)).toMatchObject({ index: 2, side: 'after' });
    });

    it('gives the gap between two cards to the nearer one — the same slot either way', () => {
      expect(resolveNoteSlot({ x: 50, y: 84 }, list, false).index).toBe(1); // just under card 0 → after it
      expect(resolveNoteSlot({ x: 50, y: 96 }, list, false).index).toBe(1); // just above card 1 → before it
    });

    it('lands above the first card and below the last without any seam to hit', () => {
      expect(resolveNoteSlot({ x: 50, y: -30 }, list, false).index).toBe(0);
      expect(resolveNoteSlot({ x: 50, y: 400 }, list, false).index).toBe(3);
    });

    it('reads left and right halves in the pool grid', () => {
      const grid = [card(0, 80, 0, 200), card(0, 80, 220, 200), card(100, 80, 0, 200)];
      expect(resolveNoteSlot({ x: 40, y: 40 }, grid, true)).toMatchObject({ index: 0, side: 'before' });
      expect(resolveNoteSlot({ x: 400, y: 40 }, grid, true)).toMatchObject({ index: 2, side: 'after' });
      expect(resolveNoteSlot({ x: 30, y: 150 }, grid, true)).toMatchObject({ index: 2, side: 'before' });
    });

    it('prefers the neighbour in the pointer\'s own row when the gaps tie', () => {
      // Lifted from the second cell of row two: the card above (12px up) and the
      // card to the left (12px left) are equally near. The row-mate must win, or
      // lifting a card opens a slot one row up and the whole pool reflows.
      const grid = [card(0, 195, 0, 200), card(0, 195, 220, 200), card(0, 195, 440, 200), card(207, 195, 0, 200)];
      const lifted = { x: 220 + 20, y: 207 + 170 }; // where the second card of row two used to be
      expect(resolveNoteSlot(lifted, grid, true)).toMatchObject({ anchorIndex: 3, side: 'after', index: 4 });
    });

    it('in a list, the card level with the pointer wins over a nearer corner', () => {
      const list = [card(0, 80, 0, 300), card(100, 80, 0, 300)];
      // Pointer to the right of the strip, level with the second card.
      expect(resolveNoteSlot({ x: 320, y: 140 }, list, false)).toMatchObject({ anchorIndex: 1 });
    });

    it('is the only slot of an empty container', () => {
      expect(resolveNoteSlot({ x: 10, y: 10 }, [], false)).toEqual({ index: 0, anchorIndex: null, side: 'after' });
    });
  });

  describe('resolveNoteCollision — one container, one slot, and the slot holds', () => {
    const rect = (top: number, height = 80) => ({ top, left: 0, width: 300, height });
    const measures: Record<string, { cards: ReturnType<typeof rect>[]; slot: ReturnType<typeof rect> | null; slotIndex: number | null; isGrid: boolean }> = {
      [notePointContainerId('p1')]: { cards: [rect(0), rect(100)], slot: null, slotIndex: null, isGrid: false },
      [noteSubContainerId('s1')]: { cards: [], slot: null, slotIndex: null, isGrid: false },
    };
    const measure = (id: string) => measures[id] ?? null;

    it('ignores every hit that is not a note container', () => {
      const slot = resolveNoteCollision({
        pointer: { x: 10, y: 10 },
        fallbackPoint: null,
        hits: [{ id: 'gap:main:0' }, { id: 'into-point:p1' }, { id: 'section:main' }],
        previous: null,
        measure,
      });
      expect(slot).toBeNull();
    });

    it('takes the deepest container and reads the slot from its cards', () => {
      const slot = resolveNoteCollision({
        pointer: { x: 10, y: 150 },
        fallbackPoint: null,
        hits: [{ id: notePointContainerId('p1') }, { id: NOTE_POOL_ID }],
        previous: null,
        measure,
      });
      expect(slot).toEqual({ containerId: notePointContainerId('p1'), index: 2 });
    });

    it('names the lifted card\'s own place at lift-off instead of its nearest neighbour', () => {
      // The finger is on the card it just picked up (index 3, alone in the last row of
      // the grid). The nearest OTHER card is the one above — "before it" would open a
      // slot at the top of the pool and reflow everything the moment the card lifts.
      const withHome: typeof measures = { ...measures, [NOTE_POOL_ID]: { cards: [rect(0), rect(0), rect(0)], slot: rect(200, 195), slotIndex: 3, isGrid: true } };
      const slot = resolveNoteCollision({
        pointer: { x: 30, y: 370 },
        fallbackPoint: null,
        hits: [{ id: NOTE_POOL_ID }],
        previous: null,
        measure: (id) => withHome[id] ?? null,
      });
      expect(slot).toEqual({ containerId: NOTE_POOL_ID, index: 3 });
    });

    it('holds the previous slot while the pointer rests on it', () => {
      const withSlot = { ...measures, [notePointContainerId('p1')]: { cards: [rect(0), rect(200)], slot: rect(100, 80), slotIndex: 1, isGrid: false } };
      const previous = { containerId: notePointContainerId('p1'), index: 1 };
      const slot = resolveNoteCollision({
        pointer: { x: 10, y: 140 },
        fallbackPoint: null,
        hits: [{ id: notePointContainerId('p1') }],
        previous,
        measure: (id) => withSlot[id] ?? null,
      });
      expect(slot).toBe(previous);
    });

    it('falls back to the dragged rect\'s centre when there is no pointer (keyboard)', () => {
      const slot = resolveNoteCollision({
        pointer: null,
        fallbackPoint: { x: 10, y: 10 },
        hits: [{ id: notePointContainerId('p1') }],
        previous: null,
        measure,
      });
      expect(slot).toEqual({ containerId: notePointContainerId('p1'), index: 0 });
    });
  });

  it('opens a full-height slot at home and a compact one elsewhere', () => {
    expect(noteSlotHeight(247, true)).toBe(247);
    expect(noteSlotHeight(247, false)).toBe(120);
    expect(noteSlotHeight(87, false)).toBe(87);
  });
});

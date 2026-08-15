import {
  findPointSection,
  findSubPointParent,
  movePoint,
  moveSubPoint,
  nestPointUnderPoint,
  nestPointUnderPointAt,
  outdentSubPoint,
} from '@/utils/outlineDnd';

import type { SermonOutline } from '@/models/models';

const outline = (): SermonOutline => ({
  introduction: [
    { id: 'p1', text: 'Opening' },
    {
      id: 'p2',
      text: 'Census',
      subPoints: [
        { id: 's1', text: 'Census in the OT', position: 0 },
        { id: 's2', text: 'Census in the NT', position: 1 },
      ],
    },
    { id: 'p3', text: 'Why it mattered' },
  ],
  main: [{ id: 'p4', text: 'Citizenship' }],
  conclusion: [],
});

describe('outlineDnd', () => {
  it('finds where a point and a sub-point live', () => {
    expect(findPointSection(outline(), 'p4')).toBe('main');
    expect(findPointSection(outline(), 'nope')).toBeNull();
    expect(findSubPointParent(outline(), 's2')?.point.id).toBe('p2');
    expect(findSubPointParent(outline(), 'p1')).toBeNull();
  });

  describe('movePoint', () => {
    it('reorders inside one section', () => {
      const next = movePoint(outline(), 'p3', 'introduction', 0);
      expect(next.introduction?.map((p) => p.id)).toEqual(['p3', 'p1', 'p2']);
    });

    it('accounts for the gap left behind when moving down', () => {
      // Indices come from the list as the person sees it — with the dragged point
      // still in place. Moving p1 to slot 2 must land it between p2 and p3, not
      // after p3.
      const next = movePoint(outline(), 'p1', 'introduction', 2);
      expect(next.introduction?.map((p) => p.id)).toEqual(['p2', 'p1', 'p3']);
    });

    it('carries a point into another section with its sub-points', () => {
      const next = movePoint(outline(), 'p2', 'conclusion', 0);
      expect(next.introduction?.map((p) => p.id)).toEqual(['p1', 'p3']);
      expect(next.conclusion?.[0].id).toBe('p2');
      expect(next.conclusion?.[0].subPoints?.map((s) => s.id)).toEqual(['s1', 's2']);
    });

    it('leaves the outline alone when the point does not exist', () => {
      const before = outline();
      expect(movePoint(before, 'ghost', 'main', 0)).toBe(before);
    });
  });

  describe('nestPointUnderPoint', () => {
    it('turns a point into a sub-point of the target', () => {
      const next = nestPointUnderPoint(outline(), 'p3', 'p1');
      expect(next.introduction?.map((p) => p.id)).toEqual(['p1', 'p2']);
      expect(next.introduction?.[0].subPoints?.map((s) => s.text)).toEqual(['Why it mattered']);
    });

    it('brings the nested point\'s own children along, right after it', () => {
      // Two levels is the whole model, so the grandchildren cannot stay nested —
      // they land beside their parent instead of being dropped.
      const next = nestPointUnderPoint(outline(), 'p2', 'p1');
      expect(next.introduction?.map((p) => p.id)).toEqual(['p1', 'p3']);
      expect(next.introduction?.[0].subPoints?.map((s) => s.id)).toEqual(['p2', 's1', 's2']);
      expect(next.introduction?.[0].subPoints?.map((s) => s.position)).toEqual([0, 1, 2]);
    });

    it('nests across sections', () => {
      const next = nestPointUnderPoint(outline(), 'p4', 'p1');
      expect(next.main).toEqual([]);
      expect(next.introduction?.[0].subPoints?.map((s) => s.id)).toEqual(['p4']);
    });

    it('refuses to nest a point into itself', () => {
      const before = outline();
      expect(nestPointUnderPoint(before, 'p1', 'p1')).toBe(before);
    });
  });

  describe('nestPointUnderPointAt — the seam between sub-points is a real target', () => {
    it('lands the point exactly where the line promised', () => {
      // Dropping p3 into the gap BEFORE 's2' under p2: it goes between s1 and s2,
      // not at the end. The board used to draw this line and then do nothing.
      const next = nestPointUnderPointAt(outline(), 'p3', 'p2', 1);
      expect(next.introduction?.[1].subPoints?.map((s) => s.id)).toEqual(['s1', 'p3', 's2']);
      expect(next.introduction?.map((p) => p.id)).toEqual(['p1', 'p2']);
    });

    it('accepts the first slot', () => {
      const next = nestPointUnderPointAt(outline(), 'p3', 'p2', 0);
      expect(next.introduction?.[1].subPoints?.map((s) => s.id)).toEqual(['p3', 's1', 's2']);
    });

    it('clamps a slot past the end instead of losing the row', () => {
      const next = nestPointUnderPointAt(outline(), 'p3', 'p2', 99);
      expect(next.introduction?.[1].subPoints?.map((s) => s.id)).toEqual(['s1', 's2', 'p3']);
      expect(next.introduction?.[1].subPoints?.map((s) => s.position)).toEqual([0, 1, 2]);
    });

    it('brings the point\'s own children with it, still in order', () => {
      const next = nestPointUnderPointAt(outline(), 'p2', 'p1', 0);
      expect(next.introduction?.[0].subPoints?.map((s) => s.id)).toEqual(['p2', 's1', 's2']);
    });
  });

  describe('outdentSubPoint', () => {
    it('promotes a sub-point to a point at the chosen slot', () => {
      const next = outdentSubPoint(outline(), 's1', 'introduction', 1);
      expect(next.introduction?.map((p) => p.id)).toEqual(['p1', 's1', 'p2', 'p3']);
      expect(next.introduction?.[2].subPoints?.map((s) => s.id)).toEqual(['s2']);
      expect(next.introduction?.[2].subPoints?.[0].position).toBe(0);
    });

    it('can promote into a different section', () => {
      const next = outdentSubPoint(outline(), 's2', 'conclusion', 0);
      expect(next.conclusion?.map((p) => p.id)).toEqual(['s2']);
      expect(next.introduction?.[1].subPoints?.map((s) => s.id)).toEqual(['s1']);
    });

    it('leaves the outline alone for an unknown sub-point', () => {
      const before = outline();
      expect(outdentSubPoint(before, 'ghost', 'main', 0)).toBe(before);
    });
  });

  describe('moveSubPoint', () => {
    it('moves a sub-point under another point', () => {
      const next = moveSubPoint(outline(), 's1', 'p1', 0);
      expect(next.introduction?.[0].subPoints?.map((s) => s.id)).toEqual(['s1']);
      expect(next.introduction?.[1].subPoints?.map((s) => s.id)).toEqual(['s2']);
    });

    it('reorders under the same parent, gap included', () => {
      const next = moveSubPoint(outline(), 's1', 'p2', 2);
      expect(next.introduction?.[1].subPoints?.map((s) => s.id)).toEqual(['s2', 's1']);
      expect(next.introduction?.[1].subPoints?.map((s) => s.position)).toEqual([0, 1]);
    });

    it('moves a sub-point across sections', () => {
      const next = moveSubPoint(outline(), 's2', 'p4', 0);
      expect(next.main?.[0].subPoints?.map((s) => s.id)).toEqual(['s2']);
      expect(next.introduction?.[1].subPoints?.map((s) => s.id)).toEqual(['s1']);
    });
  });

  it('never mutates the outline it was given', () => {
    const before = outline();
    const snapshot = JSON.stringify(before);
    movePoint(before, 'p1', 'main', 0);
    nestPointUnderPoint(before, 'p3', 'p1');
    outdentSubPoint(before, 's1', 'main', 0);
    moveSubPoint(before, 's1', 'p1', 0);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

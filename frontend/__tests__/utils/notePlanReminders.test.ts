import { notePlanContextKey, notePlanFiledNotes, notePlanTargetNodes } from '@/utils/notePlan';

import type { Sermon } from '@/models/models';

const sermon = {
  id: 's', title: 'T', verse: 'V', date: '', userId: 'u', thoughts: [],
  outline: {
    introduction: [],
    main: [{ id: 'p1', text: 'Point', note: 'Old glued reminder', subPoints: [{ id: 's1', text: 'Sub', position: 1 }] }],
    conclusion: [],
  },
  scratch: [
    { id: 'a', text: 'Filed on the point', createdAt: '2026-11-19', section: 'main', outlinePointId: 'p1' },
    { id: 'b', text: 'Filed on the sub-point', createdAt: '2026-11-19', section: 'main', outlinePointId: 'p1', subPointId: 's1' },
    { id: 'c', text: 'Still in the pool', createdAt: '2026-11-19' },
  ],
} as unknown as Sermon;

describe('note plan reminders', () => {
  it('reads a node\'s old reminder and the scratch notes filed on it, one per line', () => {
    const nodes = notePlanTargetNodes(sermon.outline!.main[0], undefined, notePlanFiledNotes(sermon));
    expect(nodes.map((node) => [node.nodeId, node.reminder])).toEqual([
      ['p1', 'Old glued reminder\nFiled on the point'],
      ['s1', 'Filed on the sub-point'],
    ]);
  });

  it('sees a newly filed note as a changed context, so a stale proposal is refused', () => {
    const before = notePlanContextKey(sermon, 'p1');
    const after = notePlanContextKey({ ...sermon, scratch: [...(sermon.scratch ?? []),
      { id: 'd', text: 'One more', createdAt: '2026-11-19', section: 'main', outlinePointId: 'p1' }] } as Sermon, 'p1');
    expect(after).not.toBe(before);
  });
});

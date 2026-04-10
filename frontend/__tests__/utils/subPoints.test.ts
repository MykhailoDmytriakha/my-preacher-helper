import { buildSubPointRenderableEntries, flattenSubPointRenderableEntries, normalizeSubPointId, resolveThoughtOutlineLocation } from '@/utils/subPoints';

describe('subPoints utils', () => {
  const subPoints = [
    { id: 'sp-1', text: 'First sub-point', position: 2000 },
    { id: 'sp-2', text: 'Second sub-point', position: 4000 },
  ];

  it('treats orphaned sub-point ids as direct thoughts and preserves mixed position order', () => {
    const thoughts = [
      { id: 't-1', subPointId: null, position: 1000 },
      { id: 't-2', subPointId: 'sp-1', position: 2500 },
      { id: 't-3', subPointId: 'missing-sub-point', position: 3000 },
      { id: 't-4', subPointId: 'sp-2', position: 4500 },
    ];

    const entries = buildSubPointRenderableEntries(thoughts, subPoints);

    expect(entries).toEqual([
      { type: 'item', item: thoughts[0] },
      { type: 'subPoint', subPoint: subPoints[0], items: [thoughts[1]] },
      { type: 'item', item: thoughts[2] },
      { type: 'subPoint', subPoint: subPoints[1], items: [thoughts[3]] },
    ]);
    expect(flattenSubPointRenderableEntries(entries).map((thought) => thought.id)).toEqual([
      't-1',
      't-2',
      't-3',
      't-4',
    ]);
  });

  it('normalizes invalid sub-point ids to null', () => {
    expect(normalizeSubPointId('sp-1', subPoints)).toBe('sp-1');
    expect(normalizeSubPointId('missing', subPoints)).toBeNull();
    expect(normalizeSubPointId(null, subPoints)).toBeNull();
  });

  it('resolves outline point and sub-point details for UI location labels', () => {
    const sermonOutline = {
      introduction: [],
      main: [{ id: 'p-1', text: 'Main point', subPoints }],
      conclusion: [],
    };

    expect(resolveThoughtOutlineLocation(sermonOutline, 'p-1', 'sp-2')).toEqual({
      outlinePoint: sermonOutline.main[0],
      section: 'main',
      subPoint: subPoints[1],
    });
    expect(resolveThoughtOutlineLocation(sermonOutline, 'p-1', 'missing')).toEqual({
      outlinePoint: sermonOutline.main[0],
      section: 'main',
      subPoint: null,
    });
    expect(resolveThoughtOutlineLocation(sermonOutline, 'missing-point', 'sp-1')).toBeNull();
  });
});

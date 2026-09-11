import { selectServiceOrderContent } from '@/utils/serviceOrderFreshness';

describe('service order freshness projection', () => {
  const original = { title: 'Visit', steps: [{ id: 'a', title: 'Listen' }] };
  it('ignores placement and revision bookkeeping', () => {
    expect(selectServiceOrderContent({ ...original, rank: 3, rev: { placement: 9 }, updatedAt: 'later' })).toEqual(selectServiceOrderContent(original));
  });
  it('normalizes optional fields so own round-trips are not foreign changes', () => {
    expect(selectServiceOrderContent({ ...original, summary: '', steps: [{ id: 'a', title: 'Listen', body: '', flagged: false, scriptureRefs: [] }] })).toEqual(selectServiceOrderContent(original));
  });
  it('detects text, removal and ordering changes', () => {
    const known = selectServiceOrderContent({ ...original, steps: [...original.steps, { id: 'b', title: 'Pray' }] });
    expect(selectServiceOrderContent({ ...original, steps: [{ id: 'a', title: 'New title' }] })).not.toEqual(known);
    expect(selectServiceOrderContent(original)).not.toEqual(known);
    expect(selectServiceOrderContent({ ...original, steps: [...known.steps].reverse() })).not.toEqual(known);
  });
});

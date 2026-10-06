import { renderHook } from '@testing-library/react';

import { usePlanTextBaseline } from '@/(pages)/(private)/sermons/[id]/plan/planTextBaseline';

import type { Sermon } from '@/models/models';

const sermonWith = (planText: Record<string, string>) => ({ id: 's1', planText }) as unknown as Sermon;
const nothingModified = () => false;

describe('the plan text baseline', () => {
  it('states null for a cell storage no longer holds, so its next save is not refused', () => {
    const { result } = renderHook(() => usePlanTextBaseline('s1'));
    result.current.adopt(sermonWith({ p1: 'Removed on this device', p2: 'Kept' }), nothingModified);
    result.current.adopt(sermonWith({ p2: 'Kept' }), nothingModified);

    expect(result.current.forNodes(['p1', 'p2'])).toEqual({ p1: null, p2: 'Kept' });
  });

  it('leaves the baseline of a cell being typed into as it was', () => {
    const { result } = renderHook(() => usePlanTextBaseline('s1'));
    result.current.adopt(sermonWith({ p1: 'Opened with' }), nothingModified);
    result.current.adopt(sermonWith({}), (nodeId) => nodeId === 'p1');

    expect(result.current.forNodes(['p1'])).toEqual({ p1: 'Opened with' });
  });
});

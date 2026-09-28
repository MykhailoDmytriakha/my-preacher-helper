import { act, renderHook } from '@testing-library/react';

import { useManualConspectus } from '@/(pages)/(private)/sermons/[id]/plan/manual/useManualConspectus';
import { savePlanTextViaClient } from '@/services/sermons.client';
import { toast } from 'sonner';

import type { Sermon } from '@/models/models';

jest.mock('@/services/outline.service', () => ({ updateSermonOutline: jest.fn() }));
jest.mock('@/services/sermons.client', () => ({
  ...jest.requireActual('@/services/sermons.client'),
  savePlanTextViaClient: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/services/thought.service', () => ({ updateThought: jest.fn() }));
jest.mock('@/utils/debugMode', () => ({ debugLog: jest.fn() }));
jest.mock('sonner', () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() }) }));

const sermon = {
  id: 'sermon-1', userId: 'user-1', title: 'T', verse: '', date: '2026-01-01', thoughts: [],
  outline: { introduction: [{ id: 'p1', text: 'First point' }], main: [], conclusion: [] },
  planText: {},
} as unknown as Sermon;

describe('saving everything while a card has vanished', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('writes only the cards that still exist and reports that not everything was saved', async () => {
    const { result } = renderHook(() => useManualConspectus({ sermon, setSermon: jest.fn(), t: (key: string) => key }));
    act(() => { result.current.restoreCells({ p1: 'Kept card', gone: 'Text of a removed point' }); });
    let saved: boolean | undefined;
    await act(async () => { saved = await result.current.saveModified(); });
    expect(saved).toBe(false);
    const written = jest.mocked(savePlanTextViaClient).mock.calls.map(call => call[1]);
    expect(written).toEqual([{ p1: 'Kept card' }]);
    expect(result.current.modifiedNodeIds.gone).toBe(true);
    expect(result.current.contentByNodeId.gone).toBe('Text of a removed point');
    // The page does not just sit there: the person is told why leaving waits.
    expect(toast.warning).toHaveBeenCalledWith('plan.orphanedBlocksLeaving');
  });

  /**
   * An emptied card whose point is gone holds nothing to decide about — and the orphan area
   * does not list it, so there is no control to decide with. It must not hold departure.
   */
  it('lets an emptied card of a removed point go instead of holding departure', async () => {
    const { result } = renderHook(() => useManualConspectus({ sermon, setSermon: jest.fn(), t: (key: string) => key }));
    act(() => { result.current.restoreCells({ gone: '   ' }); });
    let saved: boolean | undefined;
    await act(async () => { saved = await result.current.saveModified(); });
    expect(saved).toBe(true);
    expect(result.current.modifiedNodeIds.gone).toBeUndefined();
    expect(toast.warning).not.toHaveBeenCalled();
  });
});

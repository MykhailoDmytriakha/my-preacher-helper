import { renderHook, act } from '@testing-library/react';

import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useSeries } from '@/hooks/useSeries';
import { useSeriesDataCollection } from '@/hooks/useSeriesDataCollection';

jest.mock('@/hooks/useSeriesDataCollection', () => ({ useSeriesDataCollection: jest.fn() }));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: jest.fn() }));

const mockCollection = jest.mocked(useSeriesDataCollection);
const mockResolvedUid = jest.mocked(useResolvedUid);

describe('useSeries (read-only engine hook)', () => {
  const refreshSeries = jest.fn(async () => undefined);
  const series = [{ id: 's1', title: 'One' }];
  const withCollection = (patch: Record<string, unknown> = {}) =>
    mockCollection.mockReturnValue({ series, loading: false, error: null, refreshSeries, ...patch } as never);

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolvedUid.mockReturnValue({ uid: 'resolved-uid', isAuthLoading: false } as never);
    withCollection();
  });

  it('reads through the engine collection for the explicit user id', () => {
    const { result } = renderHook(() => useSeries('explicit-uid'));

    expect(mockCollection).toHaveBeenCalledWith(true, 'explicit-uid');
    expect(result.current.series).toBe(series);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('falls back to the resolved uid when no user id is given', () => {
    renderHook(() => useSeries());

    expect(mockCollection).toHaveBeenCalledWith(true, 'resolved-uid');
  });

  it('passes null when neither a user id nor a resolved uid exists', () => {
    mockResolvedUid.mockReturnValue({ uid: null, isAuthLoading: false } as never);

    renderHook(() => useSeries(null));

    expect(mockCollection).toHaveBeenCalledWith(true, null);
  });

  it('exposes only the read surface', () => {
    const { result } = renderHook(() => useSeries('u'));

    expect(Object.keys(result.current).sort()).toEqual(['error', 'loading', 'refreshSeries', 'series']);
  });

  it('maps the collection error to an Error', () => {
    withCollection({ error: 'read failed' });

    const { result } = renderHook(() => useSeries('u'));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toBe('read failed');
  });

  it('refreshSeries calls the collection refresh', async () => {
    const { result } = renderHook(() => useSeries('u'));

    await act(async () => { await result.current.refreshSeries(); });

    expect(refreshSeries).toHaveBeenCalledTimes(1);
  });
});

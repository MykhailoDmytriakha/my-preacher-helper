import { renderHook } from '@testing-library/react';

import { useEngineSermonSource } from '@/(pages)/(private)/sermons/[id]/hooks/useEngineSermonSource';
import { useDataDocument } from '@/data-engine/react.client';

jest.mock('@/data-engine/react.client', () => ({ useDataDocument: jest.fn() }));
jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

const documentWith = (data: Record<string, unknown> | null, error: string | null) =>
  ({ data, error, loading: false, retry: jest.fn(async () => undefined) }) as unknown as ReturnType<typeof useDataDocument>;

describe('useEngineSermonSource', () => {
  // Pages read `error` from this source as "the sermon could not be loaded" (the useSermon shape).
  it('does not report a sermon it shows as failed to load', () => {
    jest.mocked(useDataDocument).mockReturnValue(documentWith({ title: 'Grace', thoughts: [] }, 'Save failed'));

    const { result } = renderHook(() => useEngineSermonSource('s1'));

    expect(result.current.sermon?.title).toBe('Grace');
    expect(result.current.error).toBeNull();
  });

  it('reports the failure when there is no sermon to show', () => {
    jest.mocked(useDataDocument).mockReturnValue(documentWith(null, 'Not found'));

    const { result } = renderHook(() => useEngineSermonSource('s1'));

    expect(result.current.sermon).toBeNull();
    expect(result.current.error?.message).toBe('Not found');
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import React from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { auth } from '@/services/firebaseAuth.service';
import { getSermonById } from '@services/sermon.service';

import useSermon from '../useSermon';

import type { Sermon } from '@/models/models';

jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: jest.fn(),
}));

jest.mock('@services/sermon.service', () => ({
  getSermonById: jest.fn(),
}));

jest.mock('@/utils/debugMode', () => ({
  debugLog: jest.fn(),
}));

const mockUseOnlineStatus = useOnlineStatus as jest.MockedFunction<typeof useOnlineStatus>;
const mockGetSermonById = getSermonById as jest.MockedFunction<typeof getSermonById>;
const defaultAuthUser = auth.currentUser;
const mutableAuth = auth as { currentUser: unknown };

const makeSermon = (overrides: Partial<Sermon> = {}): Sermon => ({
  id: 'sermon-1',
  title: 'Cached sermon',
  verse: 'John 3:16',
  date: '2024-01-01',
  thoughts: [],
  userId: 'user-1',
  ...overrides,
});

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useSermon', () => {
  afterEach(() => {
    jest.clearAllMocks();
    mutableAuth.currentUser = defaultAuthUser;
    window.localStorage.clear();
  });

  it('hydrates sermon detail from cached list data immediately while online', () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    const cachedSermon = makeSermon();
    queryClient.setQueryData(['sermons', 'user-1'], [cachedSermon]);
    mutableAuth.currentUser = { uid: 'user-1' };
    mockUseOnlineStatus.mockReturnValue(true);
    mockGetSermonById.mockResolvedValue(makeSermon({ title: 'Server sermon' }));

    const { result } = renderHook(() => useSermon('sermon-1'), {
      wrapper: createWrapper(queryClient),
    });

    expect(result.current.sermon).toEqual(cachedSermon);
    expect(result.current.loading).toBe(false);
    expect(mockGetSermonById).not.toHaveBeenCalled();
  });
});

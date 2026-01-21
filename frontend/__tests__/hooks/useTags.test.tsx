import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { useTags } from '@/hooks/useTags';
import { addCustomTag, getTags, removeCustomTag, updateTag } from '@/services/tag.service';

import type { Tag } from '@/models/models';

jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: jest.fn(),
}));

jest.mock('@/hooks/useServerFirstQuery', () => ({
  useServerFirstQuery: jest.fn(),
}));

jest.mock('@/services/tag.service', () => ({
  addCustomTag: jest.fn(),
  getTags: jest.fn(),
  removeCustomTag: jest.fn(),
  updateTag: jest.fn(),
}));

const mockUseOnlineStatus = useOnlineStatus as jest.MockedFunction<typeof useOnlineStatus>;
const mockUseServerFirstQuery = useServerFirstQuery as jest.MockedFunction<typeof useServerFirstQuery>;
const mockGetTags = getTags as jest.MockedFunction<typeof getTags>;
const mockAddCustomTag = addCustomTag as jest.MockedFunction<typeof addCustomTag>;
const mockRemoveCustomTag = removeCustomTag as jest.MockedFunction<typeof removeCustomTag>;
const mockUpdateTag = updateTag as jest.MockedFunction<typeof updateTag>;

const buildServerFirstResult = <TData,>(data: TData) =>
  ({
    data,
    isLoading: false,
    error: null,
    refetch: jest.fn(),
    isOnline: true,
  } as unknown as ReturnType<typeof useServerFirstQuery>);

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useTags', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseOnlineStatus.mockReturnValue(true);
  });

  it('returns default tags when no user id is provided', async () => {
    const defaultTags = {
      requiredTags: [
        { id: '1', name: 'intro', color: '#3B82F6', translationKey: 'tags.introduction' },
        { id: '2', name: 'main', color: '#10B981', translationKey: 'tags.mainPart' },
        { id: '3', name: 'conclusion', color: '#F59E0B', translationKey: 'tags.conclusion' },
      ],
      customTags: [],
    };

    let capturedOptions: any;
    mockUseServerFirstQuery.mockImplementation((options: any) => {
      capturedOptions = options;
      return buildServerFirstResult(defaultTags);
    });

    const { result } = renderHook(() => useTags(null), { wrapper: createWrapper() });

    const queryResult = await capturedOptions.queryFn();

    expect(mockGetTags).not.toHaveBeenCalled();
    expect(result.current.requiredTags).toHaveLength(3);
    expect(result.current.customTags).toEqual([]);
    expect(result.current.allTags).toHaveLength(3);
    expect(queryResult.requiredTags).toHaveLength(3);
  });

  it('fetches tags when user id is provided', async () => {
    const tagsResponse = {
      requiredTags: [{ id: '1', name: 'intro', color: '#fff' } as Tag],
      customTags: [{ id: '2', name: 'custom', color: '#000' } as Tag],
    };

    mockGetTags.mockResolvedValue(tagsResponse);

    let capturedOptions: any;
    mockUseServerFirstQuery.mockImplementation((options: any) => {
      capturedOptions = options;
      return buildServerFirstResult(tagsResponse);
    });

    const { result } = renderHook(() => useTags('user-1'), { wrapper: createWrapper() });

    const queryResult = await capturedOptions.queryFn();

    expect(mockGetTags).toHaveBeenCalledWith('user-1');
    expect(result.current.tags).toEqual(tagsResponse);
    expect(queryResult).toEqual(tagsResponse);
  });

  it('rejects mutations when offline', async () => {
    mockUseOnlineStatus.mockReturnValue(false);
    mockUseServerFirstQuery.mockReturnValue(buildServerFirstResult({ requiredTags: [], customTags: [] }));

    const { result } = renderHook(() => useTags('user-1'), { wrapper: createWrapper() });

    await expect(result.current.addCustomTag({ id: '1', name: 'tag', color: '#000' } as Tag))
      .rejects.toThrow('Offline: operation not available.');
  });

  it('throws when removing tags without a user id', async () => {
    mockUseServerFirstQuery.mockReturnValue(buildServerFirstResult({ requiredTags: [], customTags: [] }));

    const { result } = renderHook(() => useTags(null), { wrapper: createWrapper() });

    await expect(result.current.removeCustomTag('intro')).rejects.toThrow('No user');
  });

  it('triggers mutation helpers when online', async () => {
    mockUseServerFirstQuery.mockReturnValue(buildServerFirstResult({ requiredTags: [], customTags: [] }));

    const newTag = { id: 'new', name: 'new', color: '#123' } as Tag;
    mockAddCustomTag.mockResolvedValue(newTag);
    mockRemoveCustomTag.mockResolvedValue(undefined);
    mockUpdateTag.mockResolvedValue(newTag);

    const { result } = renderHook(() => useTags('user-1'), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.addCustomTag(newTag);
      await result.current.removeCustomTag('new');
      await result.current.updateTag(newTag);
    });

    expect(mockAddCustomTag).toHaveBeenCalledWith(newTag);
    expect(mockRemoveCustomTag).toHaveBeenCalledWith('user-1', 'new');
    expect(mockUpdateTag).toHaveBeenCalledWith(newTag);
  });
});

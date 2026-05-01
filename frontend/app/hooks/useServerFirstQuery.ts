import { useQuery } from '@tanstack/react-query';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { debugLog } from '@/utils/debugMode';

import type {
  QueryFunction,
  QueryKey,
  UseQueryOptions,
  UseQueryResult,
} from '@tanstack/react-query';

type ServerFirstQueryOptions<
  TQueryFnData,
  TError,
  TData,
  TQueryKey extends QueryKey
> = Omit<UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>, 'queryFn'> & {
  queryFn: QueryFunction<TQueryFnData, TQueryKey>;
  mode?: 'cache-first' | 'server-first';
};

const CACHE_FIRST_STALE_TIME_MS = 30 * 1000;

export function useServerFirstQuery<
  TQueryFnData = unknown,
  TError = unknown,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey
>(options: ServerFirstQueryOptions<TQueryFnData, TError, TData, TQueryKey>): UseQueryResult<TData | undefined, TError> & {
  isOnline: boolean;
} {
  const isOnline = useOnlineStatus();
  const {
    mode = 'cache-first',
    enabled = true,
    queryFn,
    queryKey,
    staleTime,
    refetchOnMount,
    refetchOnWindowFocus,
    refetchOnReconnect,
    networkMode,
    ...queryOptions
  } = options;

  if (!queryFn) {
    throw new Error('useServerFirstQuery requires a queryFn.');
  }

  const canFetch = Boolean(enabled) && isOnline;
  const isCacheFirst = mode === 'cache-first';

  const queryResult = useQuery({
    ...queryOptions,
    queryKey,
    queryFn: async (context) => {
      return queryFn(context);
    },
    enabled: canFetch,
    staleTime: staleTime ?? (isCacheFirst ? CACHE_FIRST_STALE_TIME_MS : 0),
    refetchOnMount: refetchOnMount ?? (isCacheFirst ? true : 'always'),
    refetchOnWindowFocus: refetchOnWindowFocus ?? !isCacheFirst,
    refetchOnReconnect: refetchOnReconnect ?? true,
    networkMode: networkMode ?? (isCacheFirst ? 'offlineFirst' : 'online'),
  });

  const hasData = queryResult.data !== undefined;
  const isLoading = Boolean(enabled) && !hasData && queryResult.isLoading;

  debugLog(`useServerFirstQuery [${String(queryKey?.[0])}]: evaluation`, {
    mode,
    isOnline,
    canFetch,
    isLoading,
    isFetching: queryResult.isFetching,
    dataPresent: hasData,
    dataUpdatedAt: queryResult.dataUpdatedAt,
  });

  return {
    ...queryResult,
    isLoading,
    isOnline,
  } as UseQueryResult<TData | undefined, TError> & { isOnline: boolean };
}

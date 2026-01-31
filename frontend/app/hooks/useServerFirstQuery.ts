import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
};

export function useServerFirstQuery<
  TQueryFnData = unknown,
  TError = unknown,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey
>(options: ServerFirstQueryOptions<TQueryFnData, TError, TData, TQueryKey>): UseQueryResult<TData | undefined, TError> & {
  isOnline: boolean;
} {
  const isOnline = useOnlineStatus();
  const enabled = options.enabled ?? true;
  const keyHash = useMemo(() => JSON.stringify(options.queryKey), [options.queryKey]);

  // Internal state tracking
  const serverFetchedRef = useRef(false);
  const initialDataUpdatedAtRef = useRef<number | null>(null);

  // We use this to trigger re-render when the ref changes outside of a normal render cycle
  const [, setRenderTrigger] = useState(0);
  const forceUpdate = useCallback(() => setRenderTrigger(n => n + 1), []);

  // Synchronously reset state when key or online status changes
  const lastKeyHashRef = useRef(keyHash);
  const lastOnlineRef = useRef(isOnline);
  if (lastKeyHashRef.current !== keyHash || lastOnlineRef.current !== isOnline) {
    lastKeyHashRef.current = keyHash;
    lastOnlineRef.current = isOnline;
    serverFetchedRef.current = false;
    initialDataUpdatedAtRef.current = null;
  }

  if (!options.queryFn) {
    throw new Error('useServerFirstQuery requires a queryFn.');
  }

  const queryResult = useQuery({
    ...options,
    queryFn: async (context) => {
      const result = await options.queryFn!(context);
      // Update ref immediately so it's available in the same render cycle
      serverFetchedRef.current = true;
      return result;
    },
    enabled: Boolean(enabled) && isOnline,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    networkMode: 'online',
  });

  // Capture initial dataUpdatedAt (cached data) to detect subsequent updates
  if (initialDataUpdatedAtRef.current === null && queryResult.dataUpdatedAt !== 0) {
    initialDataUpdatedAtRef.current = queryResult.dataUpdatedAt;
  }

  useEffect(() => {
    if (!isOnline || !enabled) return;

    let changed = false;

    // Detect if data was updated manually (via setQueryData)
    if (
      queryResult.dataUpdatedAt !== 0 &&
      initialDataUpdatedAtRef.current !== null &&
      queryResult.dataUpdatedAt > initialDataUpdatedAtRef.current
    ) {
      if (!serverFetchedRef.current) {
        serverFetchedRef.current = true;
        changed = true;
      }
    }

    // Also reveal if fetch finished normally
    if (!queryResult.isFetching && (queryResult.isSuccess || queryResult.isError)) {
      if (!serverFetchedRef.current) {
        serverFetchedRef.current = true;
        changed = true;
      }
    }

    if (changed) {
      forceUpdate();
    }
  }, [
    isOnline,
    enabled,
    queryResult.dataUpdatedAt,
    queryResult.isSuccess,
    queryResult.isError,
    queryResult.isFetching,
    forceUpdate
  ]);

  // Reveal data when:
  // 1. serverFetchedRef marked fetch complete, OR
  // 2. React Query has successful data (covers cases where ref was reset but data exists), OR
  // 3. There's an error
  const shouldReveal = isOnline
    ? (serverFetchedRef.current || (queryResult.isSuccess && queryResult.data !== undefined) || queryResult.isError)
    : (queryResult.isSuccess || queryResult.isError || !enabled);

  const data = shouldReveal ? queryResult.data : undefined;

  // Loading when online: only if we haven't revealed data yet and no error
  const isLoading = isOnline
    ? Boolean(enabled) && !shouldReveal
    : queryResult.isLoading;

  debugLog(`useServerFirstQuery [${options.queryKey?.[0]}]: evaluation`, {
    isOnline,
    serverFetched: serverFetchedRef.current,
    shouldReveal,
    isLoading,
    dataPresent: !!data
  });



  return {
    ...queryResult,
    data,
    isLoading,
    isOnline,
  } as UseQueryResult<TData | undefined, TError> & { isOnline: boolean };
}

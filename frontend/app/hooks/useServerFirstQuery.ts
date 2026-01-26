import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';

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
  const serverFetchedRef = useRef(false);
  const initialDataUpdatedAtRef = useRef<number | null>(null);
  const enabled = options.enabled ?? true;

  const keyHash = useMemo(() => JSON.stringify(options.queryKey), [options.queryKey]);

  useEffect(() => {
    serverFetchedRef.current = false;
    initialDataUpdatedAtRef.current = null;
  }, [keyHash, isOnline]);

  if (!options.queryFn) {
    throw new Error('useServerFirstQuery requires a queryFn.');
  }

  const queryResult = useQuery({
    ...options,
    queryFn: async (context) => {
      const data = await options.queryFn!(context);
      serverFetchedRef.current = true;
      return data;
    },
    enabled: Boolean(enabled) && isOnline,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    networkMode: 'online',
  });

  useEffect(() => {
    if (!isOnline || !enabled) return;

    if (initialDataUpdatedAtRef.current === null) {
      initialDataUpdatedAtRef.current = queryResult.dataUpdatedAt;
      return;
    }

    if (
      queryResult.isSuccess &&
      queryResult.dataUpdatedAt &&
      queryResult.dataUpdatedAt !== initialDataUpdatedAtRef.current
    ) {
      serverFetchedRef.current = true;
    }
    if (!queryResult.isFetching && (queryResult.isSuccess || queryResult.isError)) {
      serverFetchedRef.current = true;
    }
  }, [
    isOnline,
    enabled,
    queryResult.dataUpdatedAt,
    queryResult.isSuccess,
    queryResult.isError,
    queryResult.isFetching,
  ]);


  const shouldReveal = isOnline
    ? (serverFetchedRef.current || queryResult.isError)
    : (queryResult.isSuccess || queryResult.isError || !enabled);

  const data = shouldReveal ? queryResult.data : undefined;

  const isLoading = isOnline
    ? Boolean(enabled) && !serverFetchedRef.current && !queryResult.isError
    : queryResult.isLoading;

  return {
    ...queryResult,
    data,
    isLoading,
    isOnline,
  } as UseQueryResult<TData | undefined, TError> & { isOnline: boolean };
}

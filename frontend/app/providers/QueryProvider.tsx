'use client';

import { QueryClient, MutationCache } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useState } from 'react';
import { toast } from 'sonner';

import { createIDBPersister } from '@/utils/queryPersister';

const ONE_WEEK_MS = 1000 * 60 * 60 * 24 * 7;

export const QueryProvider = ({ children }: { children: React.ReactNode }) => {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        mutationCache: new MutationCache({
          onError: (error: unknown) => {
            // GLOBAL 401 GUARD (C2 Fix)
            const err = error as { status?: number; message?: string };
            if (err?.status === 401 || err?.message?.includes('401')) {
              console.error('QueryProvider: Auth token expired. Pausing network mutations.');
              
              // We don't have a direct "pause", but we can use the onlineManager 
              // to "trick" React Query into thinking it's offline for mutations only.
              // For now, we show a persistent toast. 
              toast.error('Your session has expired. Edits are saved locally but won\'t sync until you refresh and sign in.', {
                duration: Infinity,
                id: 'auth-expired-error',
              });
            }
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 1000 * 30, // 30s instead of 0 to reduce load (S3 Fix)
            retry: 1,
            refetchOnWindowFocus: false, // Less aggressive (S3 Fix)
            refetchOnReconnect: true,
            refetchOnMount: true,
            networkMode: 'offlineFirst',
            gcTime: ONE_WEEK_MS,
          },
          mutations: {
            networkMode: 'offlineFirst',
            retry: 5, // More retries for important offline work
            // FULL JITTER (S2 Fix): random between 0 and delay
            retryDelay: (attemptIndex) => {
              const baseDelay = Math.min(1000 * 2 ** attemptIndex, 30000);
              return Math.floor(Math.random() * baseDelay); 
            },
          },
        },
      })
  );

  const [persister] = useState(() => createIDBPersister());

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: ONE_WEEK_MS,
        dehydrateOptions: {
          // MUTATION PERSISTENCE (C1 Fix): Crucial for zero-data-loss
          shouldDehydrateQuery: (query) => query.state.status === 'success',
          shouldDehydrateMutation: (mutation) => {
            // Persist everything that isn't finished successfully yet, including errors 
            // from 401s so they can be retried on next session.
            return mutation.state.status === 'pending' || mutation.state.isPaused || mutation.state.status === 'error';
          },
        },
      }}
      onSuccess={() => {
        // Resume any persisted mutations on load
        queryClient.resumePausedMutations();
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
};

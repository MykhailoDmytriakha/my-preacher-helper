'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { ReactNode } from 'react';

import { AuthProvider } from '@/providers/AuthProvider';
import { TextScaleProvider } from '@/providers/TextScaleProvider';

// Create a test QueryClient with test-specific settings
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: Infinity, // Disable stale time to avoid Date.now calls
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

// Test wrapper component that provides all necessary providers
export const TestProviders = ({ children }: { children: ReactNode }) => {
  const queryClient = createTestQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
};

// Helper function to create a wrapper for renderHook
export const createQueryWrapper = () => {
  const queryClient = createTestQueryClient();

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

// Helper function to create a full app wrapper for component tests
export const createAppWrapper = () => {
  const queryClient = createTestQueryClient();

  return ({ children }: { children: ReactNode }) => (
    <TextScaleProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </AuthProvider>
    </TextScaleProvider>
  );
};

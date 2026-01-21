import { useQueryClient } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';

import { QueryProvider } from '@/providers/QueryProvider';
import { createIDBPersister } from '@/utils/queryPersister';

jest.mock('@/utils/queryPersister', () => ({
  createIDBPersister: jest.fn(),
}));

const mockCreateIDBPersister = createIDBPersister as jest.MockedFunction<typeof createIDBPersister>;

const ClientProbe = ({ onReady }: { onReady: (client: ReturnType<typeof useQueryClient>) => void }) => {
  const client = useQueryClient();

  useEffect(() => {
    onReady(client);
  }, [client, onReady]);

  return null;
};

describe('QueryProvider', () => {
  it('configures the query client with expected defaults', async () => {
    mockCreateIDBPersister.mockReturnValue({
      persistClient: jest.fn(),
      restoreClient: jest.fn(),
      removeClient: jest.fn(),
    });

    const onReady = jest.fn();

    render(
      <QueryProvider>
        <ClientProbe onReady={onReady} />
      </QueryProvider>
    );

    await waitFor(() => expect(onReady).toHaveBeenCalled());

    const client = onReady.mock.calls[0][0];
    const defaults = client.getDefaultOptions().queries;

    expect(defaults?.staleTime).toBe(0);
    expect(defaults?.refetchOnMount).toBe('always');
    expect(defaults?.networkMode).toBe('online');
    expect(mockCreateIDBPersister).toHaveBeenCalled();
  });
});

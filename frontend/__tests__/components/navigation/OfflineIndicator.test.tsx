import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { OfflineIndicator } from '@/components/navigation/OfflineIndicator';
import { useConnection } from '@/providers/ConnectionProvider';

jest.mock('@/providers/ConnectionProvider', () => ({ useConnection: jest.fn() }));
jest.mock('sonner', () => ({ toast: { info: jest.fn(), warning: jest.fn(), success: jest.fn() } }));
const checkConnection = jest.fn();

describe('manual connectivity check messages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useConnection as jest.Mock).mockReturnValue({ isOnline: false, offlineShown: true, checkConnection });
  });

  it.each([
    ['reached', 'success', 'connection.probeBackOnline'],
    ['reached-with-error', 'warning', 'connection.probeServerUnhealthy'],
    ['unreachable', 'info', 'connection.probeStillOffline'],
  ] as const)('announces a current %s result', async (outcome, method, message) => {
    checkConnection.mockResolvedValue(outcome);
    render(<OfflineIndicator />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(toast[method]).toHaveBeenCalledWith(message, expect.any(Object)));
  });

  it('stays hidden while online', () => {
    (useConnection as jest.Mock).mockReturnValue({ isOnline: true, checkConnection });
    render(<OfflineIndicator />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

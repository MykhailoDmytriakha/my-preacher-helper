import { act, render, screen } from '@testing-library/react';
import OfflineShell from '@/~offline/page';

let mockReady = false;
let mockResolve: () => void;
let mockPending: Promise<void>;
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' }, loading: false }) }));
jest.mock('@/components/PrivateWorkspace', () => ({
  PrivateWorkspace: ({ children }: { children: import('react').ReactNode }) => children,
  PrivateChrome: ({ children }: { children: import('react').ReactNode }) => children,
}));
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/(pages)/(private)/dashboard/page', () => () => <p>Home content</p>);
jest.mock('@/(pages)/(private)/settings/layout', () => ({ children }: { children: import('react').ReactNode }) => children);
jest.mock('@/(pages)/(private)/settings/user/page', () => () => {
  if (!mockReady) throw mockPending;
  return <p>Saved user settings</p>;
});

describe('offline shell while page code is still loading', () => {
  beforeEach(() => {
    mockReady = false;
    mockPending = new Promise<void>(resolve => { mockResolve = resolve; });
    window.history.replaceState(null, '', '/settings/user');
  });
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('shows useful waiting and opens the page when it resolves without another action', async () => {
    const view = render(<OfflineShell />);
    try {
      expect(await screen.findByRole('status')).toHaveTextContent('connection.offlinePage.waiting');
      expect(screen.getByRole('link', { name: 'connection.offlinePage.home' })).toHaveAttribute('href', '/dashboard');
      expect(screen.getByRole('button', { name: 'buttons.retry' })).toBeInTheDocument();
      expect(screen.queryByText('connection.offlinePage.fromCache')).not.toBeInTheDocument();
      await act(async () => { mockReady = true; mockResolve(); });
      expect(await screen.findByText('Saved user settings')).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    } finally { view.unmount(); }
  });
});

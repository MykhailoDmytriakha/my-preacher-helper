import { act, render, screen } from '@testing-library/react';
import { usePathname } from 'next/navigation';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';

import RootLayout from '@/layout';
import { buildDiagnosticReport, diagnosticEvents } from '@/utils/appDiagnostics';

const mockAuth = { user: null as null | { uid: string }, loading: true };
let mockGateClosed = true;
jest.mock('next/font/google', () => ({ Inter: () => ({ variable: 'sans' }), Roboto_Mono: () => ({ variable: 'mono' }) }));
jest.mock('@/providers/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>, useAuth: () => mockAuth,
}));
jest.mock('@/providers/QueryProvider', () => ({
  QueryProvider: ({ children }: { children: ReactNode }) => mockGateClosed ? null : <>{children}</>,
}));
jest.mock('@/providers/ConnectionProvider', () => ({ ConnectionProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
jest.mock('@/providers/TextScaleProvider', () => ({ TextScaleProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
jest.mock('@/components/LocalizedToaster', () => ({ LocalizedToaster: () => null }));
jest.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
jest.mock('@/components/ThemeWatcher', () => ({ ThemeWatcher: () => null }));
jest.mock('@/components/navigation/SkipLink', () => ({ SkipLink: () => null }));
jest.mock('@/components/navigation/LanguageInitializer', () => ({ __esModule: true, default: () => null }));
jest.mock('nuqs/adapters/next/app', () => ({ NuqsAdapter: ({ children }: { children: ReactNode }) => <>{children}</> }));

// Render the real root composition without nesting another html/body inside jsdom's document.
function RootBody() {
  const tree = RootLayout({ children: <p>Workspace ready</p> });
  const body = Children.toArray(tree.props.children).find(child => isValidElement(child) && child.type === 'body') as ReactElement<{ children: ReactNode }>;
  return <>{body.props.children}</>;
}

it('keeps current boot, waiting auth and routes in the report while startup blocks the workspace', () => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn(() => ({ matches: false })) });
  jest.mocked(usePathname).mockReturnValue('/dashboard');
  const view = render(<RootBody />);
  expect(screen.queryByText('Workspace ready')).not.toBeInTheDocument();
  const waiting = buildDiagnosticReport();
  expect(waiting.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'boot' }),
    expect.objectContaining({ name: 'route', data: { route: '/dashboard' } }),
    expect.objectContaining({ name: 'auth', data: { authenticated: false, loading: true } }),
  ]));
  act(() => window.dispatchEvent(new Event('offline')));
  expect(diagnosticEvents().at(-1)?.name).toBe('offline');
  mockAuth.user = { uid: 'private-account-id' };
  mockAuth.loading = false;
  view.rerender(<RootBody />);
  expect(screen.queryByText('Workspace ready')).not.toBeInTheDocument();
  expect(buildDiagnosticReport().events).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'auth', data: { authenticated: true, loading: false } }),
  ]));
  mockGateClosed = false;
  view.rerender(<RootBody />);
  expect(screen.getByText('Workspace ready')).toBeVisible();
  expect(diagnosticEvents().filter(event => event.name === 'boot')).toHaveLength(1);
  // The precached offline shell is at /~offline in the router, at the real URL in the window.
  window.history.replaceState(null, '', '/studies/private-note-id?token=private-token');
  jest.mocked(usePathname).mockReturnValue('/~offline');
  view.rerender(<RootBody />);
  const report = buildDiagnosticReport();
  expect(report.events.at(-1)).toMatchObject({ name: 'route', data: { route: '/studies/:id', doc: expect.stringMatching(/^[a-f0-9]{8}$/) } });
  expect(JSON.stringify(report)).not.toMatch(/private-account-id|private-note-id|private-token/);
  view.unmount();
  const count = diagnosticEvents().length;
  window.dispatchEvent(new Event('focus'));
  expect(diagnosticEvents()).toHaveLength(count);
  window.history.replaceState(null, '', '/');
});

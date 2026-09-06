import { render } from '@testing-library/react';

import { recordDiagnostic } from '@/utils/appDiagnostics';

import { DiagnosticsRecorder } from '../DiagnosticsRecorder';

const mockAuth = { user: null as null | { uid: string }, loading: true };
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('@/utils/appDiagnostics', () => ({ recordDiagnostic: jest.fn() }));

it('records lifecycle, routes and coarse auth without account IDs or raw errors, then detaches', () => {
  const worker = new EventTarget();
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: worker });
  const { rerender, unmount } = render(<DiagnosticsRecorder pathname="/studies/note-id" />);
  expect(recordDiagnostic).toHaveBeenCalledWith('boot', expect.any(Object));
  expect(recordDiagnostic).toHaveBeenCalledWith('auth', { authenticated: false, loading: true });
  mockAuth.user = { uid: 'private-user' };
  mockAuth.loading = false;
  rerender(<DiagnosticsRecorder pathname="/groups" />);
  expect(recordDiagnostic).toHaveBeenCalledWith('auth', { authenticated: true, loading: false });
  document.dispatchEvent(new Event('visibilitychange'));
  for (const event of ['focus', 'online', 'offline', 'unhandledrejection']) window.dispatchEvent(new Event(event));
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  window.dispatchEvent(new ErrorEvent('error', { message: 'ChunkLoadError private content' }));
  window.dispatchEvent(new ErrorEvent('error', { message: 'private content' }));
  worker.dispatchEvent(new Event('controllerchange'));
  expect(recordDiagnostic).toHaveBeenCalledWith('pageshow', { persisted: true });
  expect(recordDiagnostic).toHaveBeenCalledWith('runtime-error', { code: 'chunk-load' });
  expect(recordDiagnostic).toHaveBeenCalledWith('runtime-error', { code: 'javascript' });
  expect(JSON.stringify((recordDiagnostic as jest.Mock).mock.calls)).not.toMatch(/private-user|private content/);
  unmount();
  const count = (recordDiagnostic as jest.Mock).mock.calls.length;
  window.dispatchEvent(new Event('focus'));
  worker.dispatchEvent(new Event('controllerchange'));
  expect(recordDiagnostic).toHaveBeenCalledTimes(count);
});

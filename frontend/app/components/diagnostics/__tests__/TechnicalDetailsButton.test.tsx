import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { diagnosticServerVersion } from '@/utils/appDiagnostics';

import { TechnicalDetailsButton, TechnicalDetailsDialog } from '../TechnicalDetailsButton';

jest.mock('react-dom', () => jest.requireActual('react-dom'));

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/utils/appDiagnostics', () => ({
  buildDiagnosticReport: () => ({ schema: 1, runningVersion: 'abc', events: [{ name: 'freshness-timeout' }] }),
  diagnosticServerVersion: jest.fn(),
}));
beforeEach(() => {
  (diagnosticServerVersion as jest.Mock).mockResolvedValue({ status: 'answered', version: 'def' });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn().mockResolvedValue(undefined) } });
});

it('opens a developer report, copies the exact report, and closes without any submission', async () => {
  render(<><TechnicalDetailsDialog /><TechnicalDetailsButton /></>);
  fireEvent.click(screen.getByRole('button', { name: 'diagnostics.open' }));
  const report = await screen.findByRole('textbox', { name: 'diagnostics.report' });
  await waitFor(() => expect((screen.getByRole('textbox', { name: 'diagnostics.report' }) as HTMLTextAreaElement).value).toContain('answered'));
  fireEvent.click(screen.getByRole('button', { name: 'diagnostics.copy' }));
  await screen.findByText('diagnostics.copied');
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith((report as HTMLTextAreaElement).value);
  fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('leaves selectable report text and manual instructions when clipboard permission fails', async () => {
  (navigator.clipboard.writeText as jest.Mock).mockRejectedValue(new Error('denied'));
  render(<><TechnicalDetailsDialog /><TechnicalDetailsButton /></>);
  fireEvent.click(screen.getByRole('button', { name: 'diagnostics.open' }));
  fireEvent.click(await screen.findByRole('button', { name: 'diagnostics.copy' }));
  await screen.findByText('diagnostics.copyFailed');
  expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
});

it('allows closing while collecting and ignores the late completion', async () => {
  let finish!: (value: unknown) => void;
  (diagnosticServerVersion as jest.Mock).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<><TechnicalDetailsDialog /><TechnicalDetailsButton /></>);
  fireEvent.click(screen.getByRole('button', { name: 'diagnostics.open' }));
  expect(await screen.findByRole('button', { name: 'diagnostics.collecting' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
  await act(async () => finish({ status: 'timeout', version: null }));
  expect(screen.queryByRole('dialog')).toBeNull();
});


it('keeps the report open when the warning that supplied the button recovers', async () => {
  const { rerender } = render(<><TechnicalDetailsDialog /><TechnicalDetailsButton /></>);
  fireEvent.click(screen.getByRole('button', { name: 'diagnostics.open' }));
  await screen.findByRole('button', { name: 'diagnostics.copy' });
  rerender(<><TechnicalDetailsDialog /></>);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'diagnostics.copy' }));
  await screen.findByText('diagnostics.copied');
});

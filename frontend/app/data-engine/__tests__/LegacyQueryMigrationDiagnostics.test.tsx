import { act, fireEvent, render, screen } from '@testing-library/react';

import { diagnosticEvents } from '@/utils/appDiagnostics';

import { LegacyQueryMigrationGate } from '../LegacyQueryRecovery';
import { preserveLegacyQueryCache } from '../legacyQueryRecovery.client';

jest.mock('../legacyQueryRecovery.client', () => ({
  ...jest.requireActual('../legacyQueryRecovery.client'), preserveLegacyQueryCache: jest.fn(),
}));
// Blocking failures use the actual i18n resource lookup before the language initializer mounts.
jest.unmock('i18next');
const enabled = () => true;
const startup = (seen: Set<string> = new Set()) => diagnosticEvents().filter(event => !seen.has(event.id) && String(event.name) === 'startup').map(event => event.data);
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

it('records waiting and successful local preparation before mounting the workspace', async () => {
  let finish!: () => void;
  const first = new Set(diagnosticEvents().map(event => event.id));
  jest.mocked(preserveLegacyQueryCache).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<LegacyQueryMigrationGate enabled={enabled}><p>Workspace</p></LegacyQueryMigrationGate>);
  expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
  expect(startup(first)).toEqual([{ source: 'legacy-migration', result: 'started' }]);
  await act(async () => finish());
  expect(screen.getByText('Workspace')).toBeVisible();
  expect(startup(first)).toEqual([
    { source: 'legacy-migration', result: 'started' },
    { source: 'legacy-migration', result: 'answered', elapsedMs: expect.any(Number) },
  ]);
});

it('distinguishes release after silence, late failure and explicit retry without recording the error text', async () => {
  jest.useFakeTimers();
  let fail!: (error: Error) => void;
  const first = new Set(diagnosticEvents().map(event => event.id));
  jest.mocked(preserveLegacyQueryCache).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; })).mockResolvedValue(undefined);
  render(<LegacyQueryMigrationGate enabled={enabled}><p>Workspace</p></LegacyQueryMigrationGate>);
  await act(async () => { await jest.advanceTimersByTimeAsync(3000); });
  expect(screen.getByText('Workspace')).toBeVisible();
  expect(startup(first)).toEqual([
    { source: 'legacy-migration', result: 'started' },
    { source: 'legacy-migration', result: 'deferred', elapsedMs: 3000 },
  ]);
  await act(async () => fail(new Error('private document words')));
  expect(screen.getByRole('alert')).toBeVisible();
  expect(startup(first).at(-1)).toEqual({ source: 'legacy-migration', result: 'failed', elapsedMs: 3000 });
  fireEvent.click(screen.getByRole('button'));
  await act(async () => undefined);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(startup(first).slice(-2)).toEqual([
    { source: 'legacy-migration', result: 'started' },
    { source: 'legacy-migration', result: 'answered', elapsedMs: 0 },
  ]);
  expect(JSON.stringify(startup())).not.toContain('private document words');
});

it('records a blocking storage refusal and its successful retry as separate attempts', async () => {
  const first = new Set(diagnosticEvents().map(event => event.id));
  jest.mocked(preserveLegacyQueryCache).mockRejectedValueOnce(new Error('private storage path')).mockResolvedValue(undefined);
  render(<LegacyQueryMigrationGate enabled={enabled}><p>Workspace</p></LegacyQueryMigrationGate>);
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(startup(first)).toEqual([
    { source: 'legacy-migration', result: 'started' },
    { source: 'legacy-migration', result: 'failed', elapsedMs: expect.any(Number) },
  ]);
  fireEvent.click(screen.getByRole('button'));
  expect(await screen.findByText('Workspace')).toBeVisible();
  expect(startup(first).map(event => event.result)).toEqual(['started', 'failed', 'started', 'answered']);
});

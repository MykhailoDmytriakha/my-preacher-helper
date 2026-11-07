import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DataMembershipStatus } from '@/data-engine/DataMembershipStatus';
import type { useDataMembership } from '@/data-engine/react.client';

type Action = ReturnType<typeof useDataMembership>;
const action = (patch: Partial<Action> = {}): Action => ({ ready: true, error: null, errorWords: null, values: [], phase: 'submitted', durable: true,
  action: null, creation: null, beginCreate: jest.fn(), openSeries: jest.fn(), updateCreation: jest.fn(), scopeId: 'scope', recoveryIdentity: {}, recoveryVersion: 0, delivery: { phase: 'unknown', canDiscard: false, code: null },
  begin: jest.fn(), recover: jest.fn(), dismiss: jest.fn(), update: jest.fn(), save: jest.fn(), cancel: jest.fn(), retry: jest.fn(), discard: jest.fn(), discardRecovery: jest.fn(), listRecoverable: jest.fn(), listRecoveryChoices: jest.fn(), ...patch });
it('offers only retry for uncertain delivery and does not call discard', async () => {
  const state = action(); render(<DataMembershipStatus action={state} />);
  expect(screen.getByRole('status')).toHaveTextContent('dataSync.phase.unknown');
  expect(screen.queryByRole('button', { name: 'dataSync.discardAction' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.retry' }));
  await waitFor(() => expect(state.retry).toHaveBeenCalledTimes(1)); expect(state.discard).not.toHaveBeenCalled();
});
it('offers whole-action discard only with engine proof and closes only after success', async () => {
  let resolve!: () => void;
  const state = action({ delivery: { phase: 'refused', canDiscard: true, code: 'deleted' }, discard: jest.fn(() => new Promise<void>(done => { resolve = done; })) });
  const onDiscarded = jest.fn(); render(<DataMembershipStatus action={state} onDiscarded={onDiscarded} />);
  expect(screen.queryByRole('button', { name: 'dataSync.retry' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.discardAction' })); expect(onDiscarded).not.toHaveBeenCalled();
  resolve(); await waitFor(() => expect(onDiscarded).toHaveBeenCalledTimes(1));
});
it('does not report a server acknowledgement while local capture persistence failed', () => {
  render(<DataMembershipStatus action={action({ durable: false, error: 'storage full', delivery: { phase: 'acknowledged', canDiscard: false, code: null } })} />);
  expect(screen.getByRole('status')).toHaveTextContent('dataSync.phase.localFailure'); expect(screen.getByRole('alert')).toHaveTextContent('storage full');
  expect(screen.getByRole('button', { name: 'dataSync.retry' })).toBeInTheDocument();
});
it('explains a changed membership stage without offering a local write retry', () => {
  const key = 'dataSync.failure.membershipStageChanged';
  render(<DataMembershipStatus action={action({
    phase: 'saving', durable: false, error: key, errorWords: { key }, delivery: null,
  })} />);
  expect(screen.getByRole('alert')).toHaveTextContent(key);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'dataSync.retry' })).not.toBeInTheDocument();
});

// BUG-20261107-outdated-tab-refusal-unexplained: a refused series action on a tab older than the server says the way out.
describe('a refused action on a tab older than the server', () => {
  const originalVersion = process.env.NEXT_PUBLIC_APP_VERSION;
  const originalFetch = global.fetch;
  afterEach(() => { process.env.NEXT_PUBLIC_APP_VERSION = originalVersion; global.fetch = originalFetch; });
  it.each([['9eac14b', true], ['391f890', false]])('server serving %s: the reload notice shown = %s', async (served, shown) => {
    process.env.NEXT_PUBLIC_APP_VERSION = '391f890';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ version: served }) }) as unknown as typeof fetch;
    render(<DataMembershipStatus action={action({ delivery: { phase: 'refused', canDiscard: true, code: 'decision-required' } })} />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    if (shown) expect(await screen.findByText('dataSync.outdatedTab.body')).toBeInTheDocument();
    else {
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(screen.queryByText('dataSync.outdatedTab.body')).not.toBeInTheDocument();
    }
  });
});

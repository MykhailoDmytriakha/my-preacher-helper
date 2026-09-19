import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DataMembershipStatus } from '@/data-engine/DataMembershipStatus';
import type { useDataMembership } from '@/data-engine/react.client';

type Action = ReturnType<typeof useDataMembership>;
const action = (patch: Partial<Action> = {}): Action => ({ ready: true, error: null, values: [], phase: 'submitted', durable: true,
  action: null, scopeId: 'scope', recoveryIdentity: {}, recoveryVersion: 0, delivery: { phase: 'unknown', canDiscard: false, code: null },
  begin: jest.fn(), recover: jest.fn(), dismiss: jest.fn(), update: jest.fn(), save: jest.fn(), cancel: jest.fn(), retry: jest.fn(), discard: jest.fn(), listRecoverable: jest.fn(), ...patch });
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
});

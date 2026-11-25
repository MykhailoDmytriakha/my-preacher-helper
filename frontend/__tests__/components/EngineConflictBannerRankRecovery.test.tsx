import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EngineConflictBanner } from '@/components/EngineConflictBanner';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { editorIdentity } from '@/data-engine/editorIdentity';
import { DataEngineProvider } from '@/data-engine/react.client';
import { DataSession } from '@/data-engine/session';
import { documentEngineHarness, settleEngine } from '@test-utils/documentEngineHarness';

import type { ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('next/navigation', () => ({ usePathname: () => '/care/orders' }));

const resource = { collection: 'serviceOrders', id: 'service' };
const baseline: ResourceSnapshot = {
  resource, value: { userId: 'owner', title: 'Saved service', rank: 10, steps: [], createdAt: '2026-11-24', date: '2026-11-24' },
  metadata: { protocol: 1, generation: 'generation', revision: 2, deleted: false },
};

beforeEach(() => { process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'serviceOrders'; });
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

it.each(['initial unreadable move', 'keep the saved position', 'save the restored move'] as const)('%s leaves independent words intact after restart', async mode => {
  const h = documentEngineHarness(baseline);
  const original = new DataSession(baseline);
  if (mode !== 'initial unreadable move') {
    const adjacent = { id: 'adjacent', generation: 'neighbor-generation' };
    original.stageServiceOrderPlacementRetry({ generation: 'generation', before: { exists: true, value: 10 }, rank: 30,
      placement: { opening: { previous: null, next: adjacent }, destination: { previous: adjacent, next: null }, observedRevision: 2, time: null } });
  }
  original.edit({ ...baseline.value, rank: 30, title: 'Title typed before closing' });
  const oldCheckpoint = {
    owner: 'owner', editorId: editorIdentity('previous-tab', resource, 'action', 'move'),
    checkpoint: original.checkpoint(), prepared: null, unfinalized: [],
  };
  await h.checkpoints.put(oldCheckpoint);
  jest.mocked(createBrowserDataEngine).mockImplementation(h.createBrowser);
  const view = render(<DataEngineProvider><EngineConflictBanner pollMs={50} /></DataEngineProvider>);
  try {
    const kept = await screen.findByRole('button', { name: 'serviceOrders.placementHistory.keepSavedPosition' });
    const save = screen.queryByRole('button', { name: 'serviceOrders.placementHistory.savePosition' });
    if (mode === 'initial unreadable move') expect(save).not.toBeInTheDocument();
    else expect(save).toBeInTheDocument();
    expect(h.transport.send).not.toHaveBeenCalled();
    await userEvent.click(mode === 'save the restored move' ? save! : kept);
    await act(async () => { await settleEngine(); });
    await waitFor(() => expect(h.server.value).toMatchObject({
      rank: mode === 'save the restored move' ? 30 : 10, title: 'Title typed before closing',
    }));
    const commands = jest.mocked(h.transport.send).mock.calls.map(([command]) => command);
    if (mode === 'save the restored move') {
      expect(commands).toHaveLength(2);
      expect(commands[0]).toMatchObject({ serviceOrderPlacement: { destination: { previous: { id: 'adjacent' }, next: null } },
        changes: [{ path: ['rank'] }] });
    } else expect(commands).toHaveLength(1);
    expect(commands.at(-1)).toMatchObject({ kind: 'update', changes: [{ path: ['title'] }] });
    expect(await h.engine.listRecoverable(resource)).toEqual([]);
  } finally { view.unmount(); }
});


it.each(['deleted', 'replaced'] as const)('keeps words copyable without applying the abandoned move after a service was %s', async variant => {
  const current: ResourceSnapshot = { ...baseline,
    value: variant === 'deleted' ? null : { ...baseline.value, title: 'Recreated service', rank: 99 },
    metadata: { ...baseline.metadata!, revision: 3, deleted: variant === 'deleted', generation: variant === 'deleted' ? 'generation' : 'replacement' },
  };
  const h = documentEngineHarness(current);
  const original = new DataSession(baseline);
  original.edit({ ...baseline.value, rank: 30, title: 'Words from the previous service' });
  await h.checkpoints.put({
    owner: 'owner', editorId: editorIdentity('previous-tab', resource, 'action', 'move'),
    checkpoint: { ...original.checkpoint(), remoteCandidate: current }, prepared: null, unfinalized: [],
  });
  jest.mocked(createBrowserDataEngine).mockImplementation(() => h.createBrowser({
    recoveryPresence: { held: async () => false, hold: () => () => undefined },
  }));
  const view = render(<DataEngineProvider><EngineConflictBanner pollMs={50} /></DataEngineProvider>);
  try {
    const remove = await screen.findByRole('button', { name: 'unsavedDraft.discard' });
    expect(screen.getByText(/Words from the previous service/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'freshness.copyTextAction' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'serviceOrders.placementHistory.keepSavedPosition' })).not.toBeInTheDocument();
    await userEvent.click(remove);
    const confirm = await screen.findByRole('button', { name: 'common.discardText.confirm' });
    await userEvent.click(confirm);
    await waitFor(() => expect(screen.queryByText(/Words from the previous service/)).not.toBeInTheDocument());
    expect(await h.engine.listRecoverable(resource)).toEqual([]);
    expect(h.transport.send).not.toHaveBeenCalled();
    expect(h.server).toEqual(current);
  } finally { view.unmount(); }
});

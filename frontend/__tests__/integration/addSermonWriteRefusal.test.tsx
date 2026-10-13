import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { Toaster, toast } from 'sonner';

import AddSermonModal from '@/components/AddSermonModal';
import { DataCollectionStatus } from '@/data-engine/DataCollectionStatus';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { useDashboardSermons } from '@/hooks/useDashboardSermons';

import { settleEngine } from '../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';

jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), createPortal: (node: React.ReactNode) => node }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/church/ChurchField', () => ({ __esModule: true, default: () => null }));

function setup() {
  const harness = membershipEngineHarness([]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const onClose = jest.fn();
  function Workspace() {
    const list = useDashboardSermons();
    const [open, setOpen] = React.useState(true);
    return <>
      <Toaster />
      <DataCollectionStatus state={list.state} />
      <AddSermonModal isOpen={open} showTriggerButton={false} onClose={() => { onClose(); setOpen(false); }} />
    </>;
  }
  const view = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
    <DataEngineProvider><Workspace /></DataEngineProvider></QueryClientProvider>);
  return { harness, onClose, view };
}

async function typeSermon(title: string, verse: string) {
  const field = await screen.findByLabelText('addSermon.titleLabel');
  await waitFor(() => expect(field).toBeEnabled());
  fireEvent.change(field, { target: { value: title } });
  fireEvent.change(screen.getByLabelText('addSermon.verseLabel'), { target: { value: verse } });
  await act(async () => { await settleEngine(); });
}

describe('AddSermonModal write refusal (data engine)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons,series';
  });
  afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

  it('reports a sermon the server refused on the dashboard and keeps the exact typed text retrievable', async () => {
    // Pins the loss where a denied sermon creation dropped the only copy of the person's title and verse.
    const { harness, onClose, view } = setup();
    jest.mocked(harness.transport.send).mockImplementation(async command =>
      ({ kind: 'refused', operationId: command.operationId, code: 'permission-denied' }));
    await typeSermon('Exact refused sermon title', 'Exact refused sermon verse');
    fireEvent.click(screen.getByRole('button', { name: 'addSermon.save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await act(async () => { await harness.engine.retry(); await settleEngine(); });

    await waitFor(() => expect(screen.getByText('dataSync.collectionAttention')).toBeInTheDocument());
    const [request] = await harness.commits.list('owner');
    expect(request.state).toBe('refused');
    expect(request.baseline.resource.collection).toBe('sermons');
    expect(JSON.stringify(request)).toContain('Exact refused sermon title');
    expect(JSON.stringify(request)).toContain('Exact refused sermon verse');
    view.unmount();
  });

  it('stays silent when the sermon create is deferred to the queue', async () => {
    const { harness, onClose, view } = setup();
    jest.mocked(harness.transport.send).mockRejectedValue(new Error('offline'));
    const errorSpy = jest.spyOn(toast, 'error');
    const successSpy = jest.spyOn(toast, 'success');
    await typeSermon('Queued sermon', 'John 3:16');
    fireEvent.click(screen.getByRole('button', { name: 'addSermon.save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await act(async () => { await settleEngine(); });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(successSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(await harness.commits.list('owner')).toHaveLength(1);
    errorSpy.mockRestore();
    successSpy.mockRestore();
    view.unmount();
  });
});

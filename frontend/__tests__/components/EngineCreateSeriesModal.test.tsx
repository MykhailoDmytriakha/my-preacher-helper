import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { EngineCreateSeriesModal } from '@/components/series/EngineCreateSeriesModal';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '../../test-utils/documentEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({ RichMarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
  <textarea aria-label="Description" value={value} onChange={event => onChange(event.target.value)} /> }));
const resource = { collection: 'series', id: 'new-series' };
function setup() {
  const harness = documentEngineHarness({ resource, value: null, metadata: null });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const onClose = jest.fn(), onQueued = jest.fn();
  function Workspace({ recoveryId }: { recoveryId?: string }) {
    return <DataEngineProvider><EngineCreateSeriesModal seriesId={resource.id} recoveryId={recoveryId} onClose={onClose} onQueued={onQueued} /></DataEngineProvider>;
  }
  return { harness, Workspace, view: render(<Workspace />), onQueued, onClose };
}
beforeEach(() => jest.clearAllMocks());
it('retains raw typing across restart and only captures creation on explicit submission', async () => {
  const { harness, Workspace, view, onQueued } = setup();
  const title = await screen.findByPlaceholderText('workspaces.series.form.titlePlaceholder');
  await waitFor(() => expect(title).toBeEnabled());
  fireEvent.change(title, { target: { value: 'Unsent series ' } });
  fireEvent.change(screen.getByPlaceholderText('workspaces.series.form.bookOrTopicPlaceholder'), { target: { value: 'Romans' } });
  await act(async () => { await settleEngine(); });
  expect(title).toHaveValue('Unsent series '); expect(harness.transport.send).not.toHaveBeenCalled();
  const choices = await harness.checkpoints.listRecoverable('owner', resource);
  const recoveryId = choices.find(item => item.record.checkpoint.draft?.title === 'Unsent series ')!.id;
  view.unmount(); const restored = render(<Workspace recoveryId={recoveryId} />);
  const input = await screen.findByDisplayValue('Unsent series');
  await waitFor(() => expect(input).toBeEnabled()); expect(input).toHaveValue('Unsent series ');
  expect(harness.transport.send).not.toHaveBeenCalled();
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(onQueued).toHaveBeenCalledWith(resource.id));
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.server.value).toMatchObject({ userId: 'owner', title: 'Unsent series', theme: 'Unsent series', bookOrTopic: 'Romans', items: [], sermonIds: [] });
  expect(harness.transport.send).toHaveBeenCalledTimes(1); restored.unmount();
});
it('reports missing fields and accepts an offline creation without claiming server confirmation', async () => {
  const { harness, view, onQueued } = setup();
  const title = await screen.findByPlaceholderText('workspaces.series.form.titlePlaceholder');
  await waitFor(() => expect(title).toBeEnabled()); act(() => harness.engine.setOnline(false));
  fireEvent.change(title, { target: { value: 'Offline series' } });
  fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.actions.createSeries' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('common.fillRequiredField'));
  expect(onQueued).not.toHaveBeenCalled();
  fireEvent.change(screen.getByPlaceholderText('workspaces.series.form.bookOrTopicPlaceholder'), { target: { value: 'Romans' } });
  fireEvent.submit(title.closest('form')!);
  await waitFor(() => expect(onQueued).toHaveBeenCalledWith(resource.id));
  expect(harness.server.value).toBeNull(); expect(harness.transport.send).not.toHaveBeenCalled();
  expect((await harness.commits.list('owner')).some(commit => commit.value?.title === 'Offline series')).toBe(true);
  expect(screen.getByRole('status')).toHaveTextContent('dataSync.phase.queued'); view.unmount();
});

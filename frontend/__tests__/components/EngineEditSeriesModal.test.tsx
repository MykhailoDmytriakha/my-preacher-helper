import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { EngineEditSeriesModal } from '@/components/series/EngineEditSeriesModal';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataDocumentProvider, DataEngineProvider, useDataDocument } from '@/data-engine/react.client';
import { documentEngineHarness, settleEngine } from '../../test-utils/documentEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({ RichMarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
  <textarea aria-label="Description" value={value} onChange={event => onChange(event.target.value)} /> }));
const resource = { collection: 'series', id: 'series' };
function setup() {
  const harness = documentEngineHarness({ resource, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
    value: { userId: 'owner', title: 'Opening title', theme: 'Opening title', description: 'Opening description', bookOrTopic: 'Romans',
      status: 'draft', items: [], sermonIds: [], seriesKind: 'sermon', createdAt: 'now', updatedAt: 'now' } });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const onClose = jest.fn();
  function ParentStatus() {
    const document = useDataDocument(resource, { autoSave: false });
    return <output data-testid="parent-state">{JSON.stringify({ phase: document.status?.phase, draft: document.data, conflicts: document.state?.checkpoint.conflicts })}</output>;
  }
  function Workspace() {
    return <DataEngineProvider><DataDocumentProvider resource={resource} options={{ autoSave: false }}>
      <ParentStatus /><EngineEditSeriesModal seriesId={resource.id} onClose={onClose} />
    </DataDocumentProvider></DataEngineProvider>;
  }
  return { harness, Workspace, view: render(<Workspace />), onClose };
}
beforeEach(() => jest.clearAllMocks());
it('pins metadata before typing, stages locally, then refuses a conflicting remote title', async () => {
  const { harness, onClose, view } = setup();
  const title = await screen.findByDisplayValue('Opening title'); await waitFor(() => expect(title).toBeEnabled());
  await act(async () => { await harness.remote({ title: 'Other device title', theme: 'Other device title' }); });
  expect(title).toHaveValue('Opening title');
  fireEvent.change(title, { target: { value: 'My title' } });
  await act(async () => { await settleEngine(); }); expect(harness.transport.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.actions.saveChanges' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.server.value?.title).toBe('Other device title');
  expect(screen.getByTestId('parent-state')).toHaveTextContent('conflict'); view.unmount();
});
it('preserves an unrelated remote field and sends only the explicit metadata edit', async () => {
  const { harness, onClose, view } = setup();
  const title = await screen.findByDisplayValue('Opening title'); await waitFor(() => expect(title).toBeEnabled());
  await act(async () => { await harness.remote({ description: 'Other device description' }); });
  fireEvent.change(title, { target: { value: 'My title' } }); await act(async () => { await settleEngine(); });
  fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.actions.saveChanges' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.server.value).toMatchObject({ title: 'My title', description: 'Other device description', items: [] });
  expect(harness.transport.send).toHaveBeenCalledTimes(1); view.unmount();
});
it('offers unsent metadata after restart and restores it only by explicit choice', async () => {
  const { harness, Workspace, view } = setup();
  const title = await screen.findByDisplayValue('Opening title'); await waitFor(() => expect(title).toBeEnabled());
  fireEvent.change(title, { target: { value: 'Recovered metadata' } }); await act(async () => { await settleEngine(); });
  view.unmount(); const restored = render(<Workspace />);
  const fresh = await screen.findByDisplayValue('Opening title'); await waitFor(() => expect(fresh).toBeEnabled());
  const choice = await screen.findByRole('option', { name: 'Opening title' });
  expect(harness.transport.send).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('dataSync.recoveryLabel'), { target: { value: choice.getAttribute('value') } });
  fireEvent.click(screen.getByRole('button', { name: 'dataSync.recover' }));
  await screen.findByDisplayValue('Recovered metadata'); expect(harness.transport.send).not.toHaveBeenCalled(); restored.unmount();
});

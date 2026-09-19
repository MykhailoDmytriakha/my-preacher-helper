import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { EngineSeriesDetail } from '@/components/series/EngineSeriesDetail';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';
import { settleEngine } from '../../test-utils/documentEngineHarness';
import type { ResourceSnapshot } from '@/data-engine/types';

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: mockReplace }) }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/hooks/useGroupsRead', () => ({ useGroupsRead: () => ({ groups: [{ id: 'g', title: 'Meeting' }], loading: false, error: null }) }));
jest.mock('@/hooks/useDashboardSermons', () => ({ useDashboardSermons: () => ({ sermons: [], loading: false, error: null }) }));
jest.mock('@/components/MarkdownDisplay', () => ({ __esModule: true, default: ({ content }: { content: string }) => <p>{content}</p> }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({ RichMarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
  <textarea aria-label="Description" value={value} onChange={event => onChange(event.target.value)} /> }));
const member = { id: 'group-g', type: 'group', refId: 'g', position: 1 };
const series = (id: string, occupied = false): ResourceSnapshot => ({ resource: { collection: 'series', id },
  metadata: { protocol: 1, generation: `g-${id}`, revision: 1, deleted: false },
  value: { userId: 'owner', title: id, theme: id, bookOrTopic: 'Romans', status: 'draft', createdAt: 'now', updatedAt: 'now',
    items: occupied ? [member] : [], sermonIds: [], seriesKind: occupied ? 'group' : 'sermon' } });
function setup(id = 'b') {
  const harness = membershipEngineHarness([series('a', true), series('b'), { resource: { collection: 'groups', id: 'g' }, metadata: null, value: { userId: 'owner', title: 'Meeting' } }]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  function Workspace() { return <DataEngineProvider><EngineSeriesDetail seriesId={id} /></DataEngineProvider>; }
  return { harness, Workspace, view: render(<Workspace />) };
}
beforeEach(() => { jest.clearAllMocks(); process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'series'; });
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });
it('projects a queued atomic move immediately, recovers its status after restart, then confirms it', async () => {
  const { harness, view, Workspace } = setup();
  await screen.findByRole('heading', { name: 'b', level: 1 });
  fireEvent.click(screen.getAllByRole('button', { name: 'workspaces.series.actions.addGroup' })[0]);
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Meeting' }));
  await act(async () => { await settleEngine(); harness.engine.setOnline(false); });
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  await screen.findByRole('heading', { name: 'Meeting' });
  expect(harness.read(series('b').resource).value!.items).toEqual([]); expect(harness.transport.send).not.toHaveBeenCalled();
  view.unmount();
  // Start the new runtime offline before mounting any editor or recovery UI.
  jest.mocked(createBrowserDataEngine).mockImplementation(() => { const browser = harness.createBrowser(); browser.engine.setOnline(false); return browser; });
  const restored = render(<Workspace />);
  await screen.findByRole('heading', { name: 'Meeting' });
  const recovery = await screen.findByRole('heading', { name: 'workspaces.series.membershipRecovery' });
  const panel = recovery.parentElement!;
  fireEvent.change(within(panel).getByRole('combobox'), { target: { value: within(panel).getByRole('option', { name: 'b' }).getAttribute('value') } });
  fireEvent.click(within(panel).getByRole('button', { name: 'dataSync.recover' }));
  await waitFor(() => expect(screen.getAllByRole('status').some(node => node.textContent === 'dataSync.phase.queued')).toBe(true));
  expect(screen.queryByRole('button', { name: 'dataSync.discardAction' })).not.toBeInTheDocument();
  await act(async () => { harness.engine.setOnline(true); await harness.engine.retry(); await settleEngine(); });
  await waitFor(() => expect(harness.read(series('b').resource).value!.items).toEqual([member]));
  expect(harness.read(series('a').resource).value!.items).toEqual([]); expect(harness.transport.send).toHaveBeenCalledTimes(1); restored.unmount();
});
it('captures deletion through the engine and navigates only after local persistence', async () => {
  const { harness, view } = setup(); await screen.findByRole('heading', { name: 'b', level: 1 });
  act(() => harness.engine.setOnline(false));
  fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.deleteSeries' }));
  const buttons = screen.getAllByRole('button', { name: 'workspaces.series.deleteSeries' });
  await waitFor(() => expect(buttons[buttons.length - 1]).toBeEnabled()); fireEvent.click(buttons[buttons.length - 1]);
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/series'));
  expect(harness.transport.send).not.toHaveBeenCalled(); expect(await harness.commits.list('owner')).toHaveLength(1);
  expect(harness.read(series('b').resource).value).not.toBeNull(); view.unmount();
});
it('keeps a closed unsent metadata form visible and offers it after restart without sending', async () => {
  const { harness, view, Workspace } = setup(); await screen.findByRole('heading', { name: 'b', level: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.editSeries' }));
  const title = await screen.findByDisplayValue('b'); await waitFor(() => expect(title).toBeEnabled());
  fireEvent.change(title, { target: { value: 'Unsent metadata' } }); await act(async () => { await settleEngine(); });
  fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
  await screen.findByRole('heading', { name: 'workspaces.series.metadataRecovery' });
  expect(harness.transport.send).not.toHaveBeenCalled();
  view.unmount(); const restored = render(<Workspace />);
  const heading = await screen.findByRole('heading', { name: 'workspaces.series.metadataRecovery' });
  const panel = within(heading.parentElement!);
  await waitFor(() => expect(panel.getByRole('combobox')).toBeEnabled());
  fireEvent.change(panel.getByRole('combobox'), { target: { value: panel.getByRole('option', { name: 'b' }).getAttribute('value') } });
  fireEvent.click(panel.getByRole('button', { name: 'dataSync.recover' }));
  await screen.findByDisplayValue('Unsent metadata'); expect(harness.transport.send).not.toHaveBeenCalled(); restored.unmount();
});

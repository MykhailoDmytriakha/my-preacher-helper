import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

import { EngineCreateSermonModal } from '@/components/sermon/EngineCreateSermonModal';
import { SeriesMembershipRecovery } from '@/components/series/SeriesMembershipRecovery';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { settleEngine } from '../../test-utils/documentEngineHarness';
import { holdWhileOpen } from '@/utils/openInTab';

import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/church/ChurchField', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/DatePickerField', () => ({ __esModule: true, default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
  <input aria-label="Planned date" value={value} onChange={event => onChange(event.target.value)} /> }));

function setup(open = true, preSelectedSeriesId?: string, catalogFails = false) {
  const harness = membershipEngineHarness([{ resource: { collection: 'series', id: 'target' }, metadata: null,
    value: { userId: 'owner', theme: 'Target', title: 'Target', bookOrTopic: '', status: 'draft', items: [], sermonIds: [], seriesKind: 'sermon' } }]);
  if (catalogFails) harness.collectionTransport.list.mockRejectedValue(new Error('catalog unavailable'));
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const queued = jest.fn();
  function Workspace({ initialOpen = open }: { initialOpen?: boolean }) {
    const [visible, setVisible] = useState(initialOpen);
    return <DataEngineProvider><SeriesMembershipRecovery />{visible && <EngineCreateSermonModal preSelectedSeriesId={preSelectedSeriesId} allowPlannedDate onClose={() => setVisible(false)}
      onQueued={id => { queued(id); setVisible(false); }} />}</DataEngineProvider>;
  }
  return { harness, queued, Workspace, view: render(<Workspace />) };
}
async function typeSermon() {
  const title = await screen.findByLabelText('addSermon.titleLabel'); await waitFor(() => expect(title).toBeEnabled());
  fireEvent.change(title, { target: { value: 'New sermon' } });
  fireEvent.change(screen.getByLabelText('addSermon.verseLabel'), { target: { value: 'Romans 1' } });
  await act(async () => { await settleEngine(); });
}
/** The browser's Web Locks, as tabs of one browser share them: a lock is held until its holder lets it go. */
const heldLocks = new Map<string, number>();
const webLocks = {
  request: (name: string, held: () => Promise<void>) => {
    heldLocks.set(name, (heldLocks.get(name) ?? 0) + 1);
    return held().finally(() => { const left = (heldLocks.get(name) ?? 1) - 1; if (left) heldLocks.set(name, left); else heldLocks.delete(name); });
  },
  query: async () => ({ held: [...heldLocks.keys()].map(name => ({ name })) }),
};
beforeEach(() => {
  jest.clearAllMocks(); process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'series,sermons';
  heldLocks.clear(); Object.defineProperty(navigator, 'locks', { configurable: true, value: webLocks });
});
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; Reflect.deleteProperty(navigator, 'locks'); });

it('stages typing and a planned date, then creates the sermon and selected series link in one command', async () => {
  const { harness, queued, view } = setup(); await typeSermon();
  fireEvent.change(screen.getByLabelText('Planned date'), { target: { value: '2026-10-01' } });
  // The series are shown at once, no button in between (the owner, 2026-10-31).
  expect(screen.queryByRole('button', { name: 'workspaces.series.actions.selectSeries' })).not.toBeInTheDocument();
  await screen.findByRole('option', { name: 'Target' });
  fireEvent.change(screen.getByLabelText('addSermon.seriesLabel'), { target: { value: 'target' } });
  await act(async () => { await settleEngine(); });
  expect(harness.transport.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'addSermon.save' })); await waitFor(() => expect(queued).toHaveBeenCalledTimes(1));
  const id = queued.mock.calls[0][0];
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(harness.read({ collection: 'sermons', id }).value).toMatchObject({ title: 'New sermon', verse: 'Romans 1',
    preachDates: [{ date: '2026-10-01', status: 'planned', church: { id: 'church-unspecified' } }] });
  expect(harness.read({ collection: 'series', id: 'target' }).value?.sermonIds).toEqual([id]); view.unmount();
});

// The owner, 2026-10-31: «кликнул в стороне — это почти равносильно отмене»; a draft banner over the pages is a bad answer.
it('closes by its ✕ as «Отмена» does: asks before throwing typing away, and keeps no draft behind', async () => {
  const { harness, view } = setup(); await typeSermon();
  fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
  fireEvent.click(await screen.findByRole('button', { name: 'common.discardChanges.confirm' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await act(async () => { await settleEngine(); });
  expect(await harness.engine.listMembershipRecovery()).toEqual([]);
  expect(harness.transport.send).not.toHaveBeenCalled(); view.unmount();
});

it('takes a press beside the window for «Отмена»: asks about what was typed, and keeps no draft behind', async () => {
  const { harness, view } = setup(); await typeSermon();
  const beside = () => screen.getByRole('dialog', { name: 'addSermon.newSermon' }).parentElement as HTMLElement;
  fireEvent.click(beside());
  fireEvent.click(await screen.findByRole('button', { name: 'common.discardChanges.confirm' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await act(async () => { await settleEngine(); });
  expect(await harness.engine.listMembershipRecovery()).toEqual([]); view.unmount();
});

// The owner, 2026-10-31: «вот это промежуточное состояние начал сохранять, но не доделал, не хранить».
it('keeps no half-made sermon: one a closed page left is thrown away when the next «Новая проповедь» opens, which starts clean', async () => {
  const { harness, Workspace, view } = setup(); await typeSermon();
  const left = (await harness.scopes.list('owner'))[0];
  view.unmount();
  render(<Workspace />);
  const title = await screen.findByLabelText('addSermon.titleLabel'); await waitFor(() => expect(title).toBeEnabled());
  expect(title).toHaveValue('');
  expect(screen.getByLabelText('addSermon.verseLabel')).toHaveValue('');
  // Neither offered in the window nor on a banner over the page.
  expect(screen.queryByText('workspaces.series.membershipRecovery')).not.toBeInTheDocument();
  await act(async () => { await settleEngine(); });
  const live = (await harness.scopes.list('owner')).filter(record => record.phase !== 'cancelled' && record.creation);
  expect(live.map(record => record.creation?.resource)).not.toContainEqual(left.creation?.resource);
  expect(harness.transport.send).not.toHaveBeenCalled();
});

// Codex, 31.10: the next opening's clean-up must not reach a window open in another tab, nor a Save a gone page pressed.
it('leaves alone a sermon being written in another tab of this browser', async () => {
  const { harness, Workspace, view } = setup(); await typeSermon();
  const left = (await harness.scopes.list('owner'))[0];
  view.unmount();
  // The same sermon open in another tab: its window holds the lock.
  const otherTab = holdWhileOpen(`sermon-creation:${left.scopeId}`);
  render(<Workspace />);
  const title = await screen.findByLabelText('addSermon.titleLabel'); await waitFor(() => expect(title).toBeEnabled());
  expect(title).toHaveValue('');
  await act(async () => { await settleEngine(); });
  expect((await harness.scopes.read('owner', left.scopeId))?.phase).toBe('editing');
  otherTab();
});

it('throws nothing away where this browser cannot tell whether another tab has it open', async () => {
  const { harness, Workspace, view } = setup(); await typeSermon();
  const left = (await harness.scopes.list('owner'))[0];
  view.unmount();
  Reflect.deleteProperty(navigator, 'locks');
  render(<Workspace />);
  const title = await screen.findByLabelText('addSermon.titleLabel'); await waitFor(() => expect(title).toBeEnabled());
  await act(async () => { await settleEngine(); });
  expect((await harness.scopes.read('owner', left.scopeId))?.phase).toBe('editing');
});

it('finishes a pressed Save also where this browser cannot tell another tab — finished twice it is the same sermon', async () => {
  const { harness, Workspace, view } = setup(); await typeSermon();
  const left = (await harness.scopes.list('owner'))[0];
  view.unmount();
  await harness.scopes.persist({ ...left, phase: 'saving' }, left.revision);
  Reflect.deleteProperty(navigator, 'locks');
  render(<Workspace />);
  const title = await screen.findByLabelText('addSermon.titleLabel'); await waitFor(() => expect(title).toBeEnabled());
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.read({ collection: 'sermons', id: left.creation!.resource.id }).value).toMatchObject({ title: 'New sermon' });
});

it('saves a sermon whose Save was pressed when its page went before handing it over', async () => {
  const { harness, Workspace, view } = setup(); await typeSermon();
  const left = (await harness.scopes.list('owner'))[0];
  view.unmount();
  // The page went right after Save froze the stage, before the sermon was handed to the server's queue.
  await harness.scopes.persist({ ...left, phase: 'saving' }, left.revision);
  render(<Workspace />);
  const title = await screen.findByLabelText('addSermon.titleLabel'); await waitFor(() => expect(title).toBeEnabled());
  expect(title).toHaveValue('');
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.read({ collection: 'sermons', id: left.creation!.resource.id }).value).toMatchObject({ title: 'New sermon', verse: 'Romans 1' });
});

it('never throws away a sermon whose Save was pressed: opening the next «Новая проповедь» leaves it on its way to the server', async () => {
  const { harness, Workspace, queued, view } = setup(); await typeSermon();
  fireEvent.click(screen.getByRole('button', { name: 'addSermon.save' })); await waitFor(() => expect(queued).toHaveBeenCalledTimes(1));
  const id = queued.mock.calls[0][0];
  view.unmount();
  render(<Workspace />);
  const title = await screen.findByLabelText('addSermon.titleLabel'); await waitFor(() => expect(title).toBeEnabled());
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.read({ collection: 'sermons', id }).value).toMatchObject({ title: 'New sermon', verse: 'Romans 1' });
});

it('cancels unsent input without creating a resource or leaving a recovery choice', async () => {
  const { harness, view } = setup(); await typeSermon();
  fireEvent.click(screen.getByRole('button', { name: 'addSermon.cancel' }));
  fireEvent.click(await screen.findByRole('button', { name: 'common.discardChanges.confirm' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await act(async () => { await settleEngine(); });
  expect(await harness.engine.listMembershipRecovery()).toEqual([]); expect(await harness.commits.list('owner')).toEqual([]);
  expect(harness.transport.send).not.toHaveBeenCalled(); view.unmount();
});

it('can create a standalone sermon after the series catalog fails, without losing typed input, and can ask for it again', async () => {
  const { harness, queued, view } = setup(true, undefined, true);
  // Asked at once, on opening; its failure is said by the shared status until the person goes on typing.
  await screen.findByRole('alert');
  expect(harness.collectionTransport.list).toHaveBeenCalled();
  await typeSermon();
  // The catalog did not come: no empty dropdown claiming there are no series — a button to ask again.
  expect(screen.queryByLabelText('addSermon.seriesLabel')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'workspaces.series.actions.selectSeries' })).toBeInTheDocument();
  expect(screen.getByLabelText('addSermon.titleLabel')).toHaveValue('New sermon');
  fireEvent.click(screen.getByRole('button', { name: 'addSermon.save' }));
  await waitFor(() => expect(queued).toHaveBeenCalledTimes(1));
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(jest.mocked(harness.transport.send).mock.calls[0][0].kind).toBe('create'); view.unmount();
});


it('pins a preset automatically and atomically creates in that series without a second selection', async () => {
  const { harness, queued, view } = setup(true, 'target'); await typeSermon();
  await waitFor(() => expect(screen.getByLabelText('addSermon.seriesLabel')).toHaveValue('target'));
  fireEvent.click(screen.getByRole('button', { name: 'addSermon.save' }));
  await waitFor(() => expect(queued).toHaveBeenCalledTimes(1));
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(harness.read({ collection: 'series', id: 'target' }).value?.sermonIds).toEqual([queued.mock.calls[0][0]]);
  view.unmount();
});

it('waits for a series the screen chose that did not load, and requires an explicit choice before saving outside it', async () => {
  const { harness, queued, view } = setup(true, 'missing'); await typeSermon();
  await screen.findByText('addSermon.pendingSeries');
  expect(screen.getByRole('button', { name: 'addSermon.save' })).toBeDisabled();
  expect(harness.transport.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'addSermon.createWithoutSeries' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'addSermon.save' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'addSermon.save' }));
  await waitFor(() => expect(queued).toHaveBeenCalledTimes(1));
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  expect(harness.transport.send).toHaveBeenCalledTimes(1);
  expect(jest.mocked(harness.transport.send).mock.calls[0][0].kind).toBe('create'); view.unmount();
});

it('closes an untouched new sermon at once, also when the screen chose its series', async () => {
  for (const series of [undefined, 'target']) {
    const { view } = setup(true, series);
    const title = await screen.findByLabelText('addSermon.titleLabel'); await waitFor(() => expect(title).toBeEnabled());
    if (series) await waitFor(() => expect(screen.getByLabelText('addSermon.seriesLabel')).toHaveValue(series));
    await act(async () => { await settleEngine(); });
    fireEvent.click(screen.getByRole('button', { name: 'addSermon.cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    view.unmount();
  }
});

// A sermon made from an analysis in the Bible (case 2026-10-12-block-diagram, phase 7, case 1).
describe('a sermon made from something', () => {
  function fromAnalysis() {
    // The analysis is a live note of the owner: the server takes a link only to such a note (serverRelations.ts).
    const harness = membershipEngineHarness([{ resource: { collection: 'studyNotes', id: 'analysis-1' }, metadata: null,
      value: { userId: 'owner', type: 'analysis', title: 'Разбор · Еф 1:3–14', content: '', scriptureRefs: [], tags: [] } }]);
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    const queued = jest.fn();
    const closed = jest.fn();
    function Workspace() {
      const [visible, setVisible] = useState(true);
      return <DataEngineProvider>{visible && <EngineCreateSermonModal initialVerse="Еф 1:3–14" sourceNoteIds={['analysis-1']} verseNote={<p>the analysis comes along</p>}
        onClose={() => { closed(); setVisible(false); }} onQueued={id => { queued(id); setVisible(false); }} />}</DataEngineProvider>;
    }
    return { harness, queued, closed, view: render(<Workspace />) };
  }

  it('starts with the passage written and says what comes along, under the verse', async () => {
    const { view } = fromAnalysis();
    await waitFor(() => expect(screen.getByLabelText('addSermon.verseLabel')).toHaveValue('Еф 1:3–14'));
    expect(screen.getByLabelText('addSermon.titleLabel')).toHaveValue('');
    expect(screen.getByText('the analysis comes along')).toBeInTheDocument();
    view.unmount();
  });

  it('closes untouched without asking to discard: the passage was the screen\'s, not the person\'s', async () => {
    const { closed, view } = fromAnalysis();
    const title = await screen.findByLabelText('addSermon.titleLabel'); await waitFor(() => expect(title).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'addSermon.cancel' }));
    await waitFor(() => expect(closed).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'common.discardChanges.confirm' })).not.toBeInTheDocument();
    view.unmount();
  });

  it('creates the sermon with the analysis linked by its one stored fact', async () => {
    const { harness, queued, view } = fromAnalysis();
    const title = await screen.findByLabelText('addSermon.titleLabel'); await waitFor(() => expect(title).toBeEnabled());
    fireEvent.change(title, { target: { value: 'Благословен Бог' } });
    await act(async () => { await settleEngine(); });
    fireEvent.click(screen.getByRole('button', { name: 'addSermon.save' })); await waitFor(() => expect(queued).toHaveBeenCalledTimes(1));
    const id = queued.mock.calls[0][0];
    await act(async () => { await harness.engine.retry(); await settleEngine(); });
    expect(harness.read({ collection: 'sermons', id }).value).toMatchObject({ title: 'Благословен Бог', verse: 'Еф 1:3–14', sourceNoteIds: ['analysis-1'] });
    view.unmount();
  });
});

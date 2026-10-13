import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import EditSermonModal from '@/components/EditSermonModal';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import '@testing-library/jest-dom';

import { settleEngine } from '../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';

import type { ResourceSnapshot } from '@/data-engine/types';
import type { Sermon } from '@/models/models';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/church/ChurchField', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/DatePickerField', () => ({ __esModule: true, default: () => null }));

const sermon: Sermon = { id: 'sermon-1', title: 'О терпении', verse: 'Иак 1:4', date: '2026-09-01T00:00:00Z', thoughts: [], userId: 'u1' };
const member = { id: 'sermon-sermon-1', type: 'sermon', refId: 'sermon-1', position: 1 };
const series = (id: string, title: string, occupied: boolean): ResourceSnapshot => ({ resource: { collection: 'series', id }, metadata: null,
  value: { userId: 'u1', title, theme: title, bookOrTopic: '', status: 'draft', items: occupied ? [member] : [],
    sermonIds: occupied ? ['sermon-1'] : [], seriesKind: 'sermon' } });
const sermonDoc: ResourceSnapshot = { resource: { collection: 'sermons', id: 'sermon-1' }, metadata: null,
  value: { userId: 'u1', title: sermon.title, verse: sermon.verse, date: sermon.date, thoughts: [] } };

function setup(rows: ResourceSnapshot[] = [series('s1', 'Первая серия', true), series('s2', 'Вторая серия', false)],
  configure?: (harness: ReturnType<typeof membershipEngineHarness>) => void) {
  const harness = membershipEngineHarness([...rows, sermonDoc]);
  configure?.(harness);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const onClose = jest.fn();
  const view = render(<DataEngineProvider><EditSermonModal sermon={sermon} onClose={onClose} onUpdate={jest.fn()} /></DataEngineProvider>);
  return { harness, onClose, view };
}
const seriesField = async () => (await screen.findByLabelText('addSermon.seriesLabel')) as HTMLSelectElement;
async function ready() {
  const title = await screen.findByLabelText('addSermon.titleLabel');
  await waitFor(() => expect(title).toBeEnabled());
  return title;
}
const clickSave = () => fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
const sentSeries = (harness: ReturnType<typeof setup>['harness']) => ({
  first: harness.read({ collection: 'series', id: 's1' }).value?.items,
  second: harness.read({ collection: 'series', id: 's2' }).value?.items,
});

describe('the edit door can move a sermon between series', () => {
  beforeEach(() => { jest.clearAllMocks(); process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'series'; });
  afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

  it("opens on the series the engine's playlist rows put the sermon in", async () => {
    const { view } = setup();
    expect(await seriesField()).toHaveValue('s1');
    view.unmount();
  });

  it('moves the sermon through the one membership action when another series is chosen', async () => {
    const { harness, onClose, view } = setup();
    fireEvent.change(await seriesField(), { target: { value: 's2' } });
    await act(async () => { await settleEngine(); });
    clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await act(async () => { await harness.engine.retry(); await settleEngine(); });
    expect(sentSeries(harness)).toEqual({ first: [], second: [expect.objectContaining({ type: 'sermon', refId: 'sermon-1' })] });
    view.unmount();
  });

  it('takes the sermon out of every series when "no series" is chosen', async () => {
    const { harness, onClose, view } = setup();
    fireEvent.change(await seriesField(), { target: { value: '' } });
    await act(async () => { await settleEngine(); });
    clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await act(async () => { await harness.engine.retry(); await settleEngine(); });
    expect(sentSeries(harness)).toEqual({ first: [], second: [] });
    view.unmount();
  });

  it('leaves membership alone when only the title changed', async () => {
    const { harness, onClose, view } = setup();
    await seriesField();
    const title = await ready();
    fireEvent.change(title, { target: { value: 'О терпении и вере' } });
    await act(async () => { await settleEngine(); });
    clickSave();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    await act(async () => { await harness.engine.retry(); await settleEngine(); });
    expect(harness.read({ collection: 'sermons', id: 'sermon-1' }).value?.title).toBe('О терпении и вере');
    expect(sentSeries(harness)).toEqual({ first: [member], second: [] });
    expect(jest.mocked(harness.transport.send).mock.calls.map(([command]) => command.resource.collection)).toEqual(['sermons']);
    view.unmount();
  });

  it('lets a series change alone be saved, with nothing else edited', async () => {
    const { view } = setup();
    const field = await seriesField();
    await ready();
    expect(screen.getByRole('button', { name: 'buttons.save' })).toBeDisabled();
    fireEvent.change(field, { target: { value: 's2' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled());
    view.unmount();
  });

  it('says the series are still loading rather than showing an empty picker', async () => {
    // The list of series never answers in this test: the picker must say so instead of looking empty.
    const { view } = setup(undefined, harness => harness.collectionTransport.list.mockImplementation(() => new Promise(() => undefined)));
    expect(await screen.findByText('workspaces.series.loadingSeries')).toBeInTheDocument();
    view.unmount();
  });
});

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { LegacyQueryCopies, LegacyQueryMigrationGate } from '../LegacyQueryRecovery';
import { compareLegacyCopy, listLegacyQueryCopies, preserveLegacyQueryCache, removeLegacyCopies, retireLegacyEchoes } from '../legacyQueryRecovery.client';

import en from '@locales/en/translation.json';
import ru from '@locales/ru/translation.json';

// The real translations: a blocking failure is said through the i18n instance, in the stored language.
jest.unmock('i18next');
const actualClient = jest.requireActual('../legacyQueryRecovery.client') as typeof import('../legacyQueryRecovery.client');
jest.mock('../legacyQueryRecovery.client', () => {
  const actual = jest.requireActual('../legacyQueryRecovery.client') as typeof import('../legacyQueryRecovery.client');
  return { ...actual, compareLegacyCopy: jest.fn(actual.compareLegacyCopy),
    preserveLegacyQueryCache: jest.fn(), listLegacyQueryCopies: jest.fn(), retireLegacyEchoes: jest.fn(), removeLegacyCopies: jest.fn() };
});
const mockServerCopies = new Map<string, Record<string, unknown> | null>();
jest.mock('../snapshots.client', () => ({
  createIndexedDbSnapshots: () => ({
    read: async (_owner: string, resource: { collection: string; id: string }) => {
      const key = `${resource.collection}/${resource.id}`;
      return mockServerCopies.has(key) ? { resource, metadata: null, value: mockServerCopies.get(key) } : undefined;
    },
  }),
}));
const mockCopy = jest.fn();
jest.mock('@/hooks/useClipboard', () => ({ useClipboard: () => ({ copyToClipboard: mockCopy }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const enabled = () => true;
const record = { id: 'copy', owner: 'owner', collection: 'councils', documentId: 'council', title: 'Private saved text', raw: '{"title":"Private saved text"}', savedAt: 1 };
const rowCopy = (id: string, value: Record<string, unknown>) => ({
  id, owner: 'owner', collection: 'series', documentId: String(value.id), title: String(value.title), raw: JSON.stringify(value), savedAt: 1,
});
/** Waits for the strip and opens the review from it. */
const openReview = async () => fireEvent.click(await screen.findByRole('button', { name: /legacyRecovery.review/ }));

describe('legacy cache preservation UI', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockServerCopies.clear();
    jest.mocked(retireLegacyEchoes).mockResolvedValue({ retired: 0, undecided: 0 });
    jest.mocked(removeLegacyCopies).mockResolvedValue(1);
    jest.mocked(compareLegacyCopy).mockImplementation(actualClient.compareLegacyCopy);
  });

  it('prevents cache hydration/expiry until preservation succeeds, and retries failed storage without mounting consumers', async () => {
    const mounted = jest.fn();
    function Consumer() { useEffect(() => { mounted(); }, []); return <p>Workspace</p>; }
    let complete!: () => void;
    jest.mocked(preserveLegacyQueryCache).mockRejectedValueOnce(new Error('disk full')).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    render(<LegacyQueryMigrationGate enabled={enabled}><Consumer /></LegacyQueryMigrationGate>);
    expect(await screen.findByRole('alert')).toHaveTextContent(en.legacyRecovery.preservationFailed);
    expect(mounted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: en.dataSync.retry }));
    await waitFor(() => expect(preserveLegacyQueryCache).toHaveBeenCalledTimes(2));
    expect(mounted).not.toHaveBeenCalled();
    await act(async () => complete());
    expect(screen.getByText('Workspace')).toBeVisible();
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  // BUG-20261004-reload-preserving-copies-flash: the wait put "Preserving local copies…" in place of every
  // page on every load — in the server's language, English, since the language setup sits below the gate.
  it('renders nothing of its own on the server', () => {
    jest.mocked(preserveLegacyQueryCache).mockReturnValue(new Promise(() => undefined));
    // The Node build, as on the server: the browser build needs a MessageChannel that jsdom lacks.
    const { renderToString } = jest.requireActual<typeof import('react-dom/server')>('react-dom/server.node');
    expect(renderToString(<LegacyQueryMigrationGate enabled={enabled}><p>Workspace</p></LegacyQueryMigrationGate>)).toBe('');
  });

  it('says nothing during an ordinary wait, shows the start spinner on a long one, and keeps the workspace unmounted', async () => {
    jest.useFakeTimers();
    try {
      jest.mocked(preserveLegacyQueryCache).mockReturnValue(new Promise(() => undefined));
      const { container } = render(<LegacyQueryMigrationGate enabled={enabled}><p>Workspace</p></LegacyQueryMigrationGate>);
      await act(async () => { await jest.advanceTimersByTimeAsync(399); });
      expect(container).toBeEmptyDOMElement();
      await act(async () => { await jest.advanceTimersByTimeAsync(1); });
      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByText('Workspace')).toBeNull();
    } finally { jest.useRealTimers(); }
  });

  // The language setup sits below the gate, so a blocking failure speaks the device's stored language itself.
  it.each([
    ['ru', 'ru', ru.legacyRecovery.preservationFailed, ru.dataSync.retry],
    ['ru-RU', 'ru', ru.legacyRecovery.preservationFailed, ru.dataSync.retry],
    ['de', 'en', en.legacyRecovery.preservationFailed, en.dataSync.retry],
  ])('tells a blocking failure in the stored language %s, marked as %s', async (stored, shown, text, retry) => {
    document.cookie = `lang=${stored}; path=/`;
    try {
      jest.mocked(preserveLegacyQueryCache).mockRejectedValue(new Error('disk full'));
      render(<LegacyQueryMigrationGate enabled={enabled}><p>Workspace</p></LegacyQueryMigrationGate>);
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(text);
      expect(alert).toHaveAttribute('lang', shown);
      expect(screen.getByRole('button', { name: retry })).toBeInTheDocument();
    } finally { document.cookie = 'lang=; path=/; max-age=0'; }
  });

  it('says so above the app, with Retry, when the archive fails after the app went on', async () => {
    jest.useFakeTimers();
    try {
      let fail!: (error: Error) => void;
      jest.mocked(preserveLegacyQueryCache).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; })).mockResolvedValue(undefined);
      render(<LegacyQueryMigrationGate enabled={enabled}><p>Workspace</p></LegacyQueryMigrationGate>);
      await act(async () => { await jest.advanceTimersByTimeAsync(3001); });
      expect(screen.getByText('Workspace')).toBeVisible();

      await act(async () => { fail(new Error('disk full')); await Promise.resolve(); });

      expect(screen.getByRole('alert')).toHaveTextContent('legacyRecovery.preservationFailed');
      expect(screen.getByText('Workspace')).toBeVisible();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'dataSync.retry' })); await Promise.resolve(); });
      expect(preserveLegacyQueryCache).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('alert')).toBeNull();
    } finally { jest.useRealTimers(); }
  });

  it('does not hold the whole app when device storage never answers; the archive keeps running (BUG-20260927-engine-open-hangs-on-silent-device-storage)', async () => {
    jest.useFakeTimers();
    try {
      jest.mocked(preserveLegacyQueryCache).mockImplementation(() => new Promise(() => undefined));
      render(<LegacyQueryMigrationGate enabled={enabled}><p>Workspace</p></LegacyQueryMigrationGate>);
      expect(screen.queryByText('Workspace')).toBeNull();

      await act(async () => { await jest.advanceTimersByTimeAsync(3001); });

      expect(screen.getByText('Workspace')).toBeVisible();
      expect(preserveLegacyQueryCache).toHaveBeenCalledTimes(1);
    } finally { jest.useRealTimers(); }
  });

  it('fences a late read from the previous account and keeps the raw copy available', async () => {
    let previous!: (value: typeof record[]) => void;
    jest.mocked(listLegacyQueryCopies).mockImplementationOnce(() => new Promise(resolve => { previous = resolve; })).mockResolvedValue([]);
    const view = render(<LegacyQueryCopies owner="owner" />);
    view.rerender(<LegacyQueryCopies owner="other" />);
    await act(async () => previous([record]));
    expect(screen.queryByText('legacyRecovery.strip')).not.toBeInTheDocument();
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([record]);
    view.rerender(<LegacyQueryCopies owner="owner" />);
    await openReview();
    expect(await screen.findByText(record.title)).toBeInTheDocument();
    expect(screen.getByText(record.raw)).toBeInTheDocument();
  });

  it('says how many records differ in one thin strip and opens the review from it', async () => {
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'Funerals', description: 'Server text', updatedAt: '2026-09-16T23:17:36.000Z' });
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([
      rowCopy('c1', { id: 's1', userId: 'owner', title: 'Funerals', description: 'Old text', updatedAt: '2026-09-03T10:00:00.000Z' }),
    ]);
    render(<LegacyQueryCopies owner="owner" />);
    expect(await screen.findByText('legacyRecovery.strip')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await openReview();
    const card = screen.getByText('Funerals').closest('article')!;
    expect(within(card).getByText('legacyRecovery.field.description')).toBeInTheDocument();
    expect(within(card).getByText('Old text')).toBeInTheDocument();
    expect(within(card).getByText('Server text')).toBeInTheDocument();
    expect(within(card).queryByText('legacyRecovery.field.title')).not.toBeInTheDocument();
  });

  it('lays a sermon out as git does: a removed thought and an added one, each accepted on its own', async () => {
    const stone = { id: 't1', text: 'The stone was rolled away' }, women = { id: 't2', text: 'The women came asking' }, tomb = { id: 't3', text: 'The empty tomb' };
    mockServerCopies.set('sermons/s1', { id: 's1', userId: 'owner', title: 'Easter', thoughts: [women, tomb] });
    const copy = { ...rowCopy('c1', { id: 's1', userId: 'owner', title: 'Easter', thoughts: [stone, women] }), collection: 'sermons' };
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([copy]);
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    const removed = screen.getByRole('group', { name: 'legacyRecovery.kindRemoved' });
    const added = screen.getByRole('group', { name: 'legacyRecovery.kindAdded' });
    expect(within(removed).getByText(stone.text)).toBeInTheDocument();
    expect(within(added).getByText(tomb.text)).toBeInTheDocument();
    // Unchanged lines stand between the changes, outside of them.
    expect(screen.getByText(women.text).closest('[role="group"]')).toBeNull();
    fireEvent.click(within(removed).getByRole('button', { name: /legacyRecovery.accept/ }));
    expect(screen.queryByRole('group', { name: 'legacyRecovery.kindRemoved' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'legacyRecovery.kindAdded' })).toBeInTheDocument();
    // One change left undecided keeps the copy when the review closes.
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(removeLegacyCopies).not.toHaveBeenCalled();
  });

  it('removes a copy only when the person asks: closing with every change accepted keeps it, the remove button takes it', async () => {
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'Funerals', description: 'Server', updatedAt: '2026-09-16T00:00:00.000Z' });
    const copy = rowCopy('c1', { id: 's1', userId: 'owner', title: 'Funerals', description: 'Old', updatedAt: '2026-09-03T00:00:00.000Z' });
    let removed = false;
    jest.mocked(listLegacyQueryCopies).mockImplementation(async () => (removed ? [] : [copy]));
    jest.mocked(removeLegacyCopies).mockImplementation(async () => { removed = true; return 1; });
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: /legacyRecovery\.accept$/ }));
    expect(screen.getByRole('status')).toHaveTextContent('legacyRecovery.accepted');
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.undo' }));
    expect(screen.getByRole('group', { name: 'legacyRecovery.kindReplaced' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /legacyRecovery\.accept$/ }));
    expect(screen.getByText('legacyRecovery.done')).toBeInTheDocument();
    // Closing decides nothing: the copy stays, and so do the decisions made on it.
    fireEvent.click(screen.getAllByRole('button', { name: 'common.close' }).at(-1)!);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(removeLegacyCopies).not.toHaveBeenCalled();
    await openReview();
    expect(screen.getByRole('status')).toHaveTextContent('legacyRecovery.accepted');
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.removeDecided' }));
    await waitFor(() => expect(removeLegacyCopies).toHaveBeenCalledWith('owner', [{ id: 'c1', raw: copy.raw }]));
    await waitFor(() => expect(screen.queryByText('legacyRecovery.strip')).not.toBeInTheDocument());
  });

  it('shows the day a removed preaching date was on, as a calendar day', async () => {
    mockServerCopies.set('sermons/s1', { id: 's1', userId: 'owner', title: 'Easter', preachDates: [] });
    const copy = { ...rowCopy('c1', { id: 's1', userId: 'owner', title: 'Easter', preachDates: [{ id: 'p1', date: '2026-04-05', church: { name: 'Grace Church' } }] }), collection: 'sermons' };
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([copy]);
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    const removed = screen.getByRole('group', { name: 'legacyRecovery.kindRemoved' });
    expect(removed).toHaveTextContent('April 5, 2026');
    expect(removed).toHaveTextContent('Grace Church');
    expect(screen.queryByText('legacyRecovery.partlyHidden')).not.toBeInTheDocument();
  });

  it('reads a week-start choice by its name, one change from the old day to the new', async () => {
    mockServerCopies.set('users/owner', { id: 'owner', firstDayOfWeek: 'monday', usage: { aiUsed: 23 } });
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([{
      ...record, collection: 'users', documentId: 'owner', title: 'owner',
      raw: JSON.stringify({ id: 'owner', firstDayOfWeek: 'sunday', usage: { aiUsed: 119 } }),
    }]);
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    const change = screen.getByRole('group', { name: 'legacyRecovery.kindReplaced' });
    expect(within(change).getByText('settings.firstDayOfWeek.sunday')).toBeInTheDocument();
    expect(within(change).getByText('settings.firstDayOfWeek.monday')).toBeInTheDocument();
    // What the server counts is not the person's: it never shows as a change (the raw data keeps it, as stored).
    expect(screen.getAllByRole('group', { name: /legacyRecovery\.kind/ }).filter(group => /119/.test(group.textContent ?? ''))).toEqual([]);
    expect(screen.queryByText('legacyRecovery.field.usage')).not.toBeInTheDocument();
  });

  it('names settings and every changed user preference with localized recovery labels', async () => {
    const fields = ['language', 'email', 'displayName', 'firstDayOfWeek', 'enablePrepMode', 'enableAudioGeneration',
      'enableStructurePreview', 'enableGroups', 'showAppVersion', 'preferredProviderId', 'preferredModelId',
      'preferredTranscription', 'preferredText', 'preferredTts'];
    mockServerCopies.set('users/owner', { id: 'owner', ...Object.fromEntries(fields.map(field => [field, 'server'])) });
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([{
      ...record, collection: 'users', documentId: 'owner', title: 'owner',
      raw: JSON.stringify({ id: 'owner', ...Object.fromEntries(fields.map(field => [field, 'device'])) }),
    }]);
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    expect(screen.getByText('legacyRecovery.collection.users')).toBeInTheDocument();
    for (const field of fields) {
      expect(screen.getByText(`legacyRecovery.field.${field}`)).toBeInTheDocument();
    }
  });

  it('accepts everything after one explicit confirmation, whatever the dates say', async () => {
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'A', updatedAt: '2026-09-01T00:00:00.000Z' });
    mockServerCopies.set('series/s2', { id: 's2', userId: 'owner', title: 'B', updatedAt: '2026-09-16T00:00:00.000Z' });
    const copies = [
      rowCopy('c1', { id: 's1', userId: 'owner', title: 'A', note: 'typed on the phone', updatedAt: '2026-09-20T00:00:00.000Z' }),
      rowCopy('c2', { id: 's2', userId: 'owner', title: 'B', note: 'old', updatedAt: '2026-09-02T00:00:00.000Z' }),
    ];
    jest.mocked(listLegacyQueryCopies).mockResolvedValueOnce(copies).mockResolvedValue([]);
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.acceptAllChanges' }));
    expect(await screen.findByText('legacyRecovery.acceptAllChangesConfirm')).toBeInTheDocument();
    // The question stands in place of the button: it cannot be skipped by pressing again.
    expect(screen.queryByRole('button', { name: 'legacyRecovery.acceptAllChanges' })).not.toBeInTheDocument();
    expect(removeLegacyCopies).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.acceptAllChangesYes' }));
    await waitFor(() => expect(removeLegacyCopies).toHaveBeenCalledWith('owner', copies.map(entry => ({ id: entry.id, raw: entry.raw }))));
  });

  it('keeps every other copy visible when one cannot be compared', async () => {
    mockServerCopies.set('series/s2', { id: 's2', userId: 'owner', title: 'Readable', updatedAt: '2026-09-16T00:00:00.000Z' });
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([
      rowCopy('c1', { id: 's1', userId: 'owner', title: 'Broken' }), rowCopy('c2', { id: 's2', userId: 'owner', title: 'Readable', note: 'x' }),
    ]);
    jest.mocked(compareLegacyCopy).mockImplementationOnce(() => { throw new TypeError('bad shape'); });
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    expect(screen.getAllByText('Broken').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Readable').length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // A failed comparison claims nothing about the server copy.
    expect(within(screen.getByRole('heading', { name: 'Broken' }).closest('article')!).getByText('legacyRecovery.serverUnknown')).toBeInTheDocument();
  });

  it('cuts a changed text into separate changes around the lines both sides share', async () => {
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'Reading copy', note: 'Common line\nServer words' });
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([
      rowCopy('c1', { id: 's1', userId: 'owner', title: 'Reading copy', note: 'Common line\nDevice words' }),
    ]);
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    const change = screen.getByRole('group', { name: 'legacyRecovery.kindReplaced' });
    expect(within(change).getByText('Device words')).toBeInTheDocument();
    expect(within(change).getByText('Server words')).toBeInTheDocument();
    expect(within(change).queryByText('Common line')).not.toBeInTheDocument();
    expect(screen.getByText('Common line')).toBeInTheDocument();
  });

  it('shows what a copy without a server copy holds and asks before removing it', async () => {
    // The archive holds the copy until it is removed, however often the screen reads it.
    let removed = false;
    jest.mocked(listLegacyQueryCopies).mockImplementation(async () => (removed ? [] : [record]));
    jest.mocked(removeLegacyCopies).mockImplementation(async () => { removed = true; return 1; });
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    const card = screen.getByRole('heading', { name: record.title }).closest('article')!;
    expect(within(card).getByText('legacyRecovery.serverMissing')).toBeInTheDocument();
    expect(within(card).getAllByText(/Private saved text/).length).toBeGreaterThan(1);
    expect(within(card).queryByRole('button', { name: /legacyRecovery.accept/ })).not.toBeInTheDocument();
    fireEvent.click(within(card).getByRole('button', { name: 'legacyRecovery.removeCopy' }));
    expect(within(card).getByRole('alert')).toHaveTextContent('legacyRecovery.removeCopyConfirm');
    expect(removeLegacyCopies).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole('button', { name: 'legacyRecovery.removeCopyYes' }));
    await waitFor(() => expect(removeLegacyCopies).toHaveBeenCalledWith('owner', [{ id: record.id, raw: record.raw }]));
  });

  it('removes only the copies the question was asked about', async () => {
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'A' });
    const asked = rowCopy('c1', { id: 's1', userId: 'owner', title: 'A', note: 'old' });
    const arrived = rowCopy('c9', { id: 's9', userId: 'owner', title: 'Archived meanwhile' });
    let decide!: (value: { retired: number; undecided: number }) => void;
    jest.mocked(retireLegacyEchoes).mockImplementationOnce(() => new Promise(resolve => { decide = resolve; }));
    jest.mocked(listLegacyQueryCopies).mockResolvedValueOnce([asked]).mockResolvedValueOnce([asked, arrived]).mockResolvedValue([]);
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.acceptAllChanges' }));
    await act(async () => decide({ retired: 1, undecided: 0 }));
    await waitFor(() => expect(listLegacyQueryCopies).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.acceptAllChangesYes' }));
    await waitFor(() => expect(removeLegacyCopies).toHaveBeenCalledWith('owner', [{ id: asked.id, raw: asked.raw }]));
  });

  it('names a failed removal as such', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.mocked(removeLegacyCopies).mockRejectedValueOnce(new Error('quota'));
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([record]);
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.acceptAllChanges' }));
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.acceptAllChangesYes' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('legacyRecovery.removeFailed'));
    jest.mocked(console.error).mockRestore();
  });

  it('says plainly when nothing the person could see differs: an empty field against a missing one', async () => {
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'A', note: null });
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([rowCopy('c1', { id: 's1', userId: 'owner', title: 'A' })]);
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    const card = screen.getByRole('heading', { name: 'A' }).closest('article')!;
    expect(within(card).getByText('legacyRecovery.noVisibleDifference')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'legacyRecovery.removeCopy' })).toBeInTheDocument();
  });

  it('says so when a download fails while the copies stay on screen', async () => {
    const createObjectURL = jest.fn((): string => { throw new Error('blocked'); });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([record]);
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.export' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('legacyRecovery.actionFailed');
    expect(screen.getByRole('heading', { name: record.title })).toBeInTheDocument();
    // The next download that works clears the failure instead of leaving it on screen for good.
    createObjectURL.mockImplementation(() => 'blob:copy');
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.export' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it('shows what an unsent operation carried and offers to remove it, never to accept it', async () => {
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'A' });
    const operation = { id: 'op', owner: 'owner', collection: 'series', documentId: 's1', title: 'update: s1', savedAt: 1,
      raw: JSON.stringify({ mutationKey: ['series', 'update'], state: { isPaused: true, variables: { updates: { title: 'Typed offline' } } } }) };
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([operation]);
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    expect(screen.getByText('legacyRecovery.operationNote')).toBeInTheDocument();
    expect(screen.getAllByText(/Typed offline/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'legacyRecovery.removeCopy' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /legacyRecovery.accept$/ })).not.toBeInTheDocument();
  });

  it('names every field a person writes in the four archived collections', async () => {
    const locales = ['en', 'ru', 'uk'].map(lang => jest.requireActual(`../../../locales/${lang}/translation.json`) as { legacyRecovery: { field: Record<string, string> } });
    const written = ['title', 'verse', 'description', 'date', 'thoughts', 'scratch', 'outline', 'structure', 'insights', 'plan', 'planText', 'planMode',
      'isPreached', 'preparation', 'seriesId', 'seriesPosition', 'sourceNoteIds', 'church', 'preachDates', 'audioChunks', 'audioMetadata',
      'theme', 'bookOrTopic', 'sermonIds', 'items', 'seriesKind', 'startDate', 'duration', 'color', 'status', 'templates', 'flow', 'meetingDates',
      'heldAt', 'topics', 'summary', 'decision', 'options', 'questions', 'introduction', 'main', 'conclusion', 'ambiguous'];
    for (const locale of locales) expect(written.filter(field => !locale.legacyRecovery.field[field])).toEqual([]);
  });

  it('shows a series field by its name, not by its code', async () => {
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'A', bookOrTopic: 'Romans', updatedAt: '2026-09-16T00:00:00.000Z' });
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([rowCopy('c1', { id: 's1', userId: 'owner', title: 'A', bookOrTopic: 'Galatians', updatedAt: '2026-09-01T00:00:00.000Z' })]);
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    expect(screen.getByText('legacyRecovery.field.bookOrTopic')).toBeInTheDocument();
    expect(screen.queryByText('bookOrTopic')).not.toBeInTheDocument();
  });

  it('copies the device side of a change', async () => {
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'A', description: 'Server', updatedAt: '2026-09-16T00:00:00.000Z' });
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([rowCopy('c1', { id: 's1', userId: 'owner', title: 'A', description: 'Phone', updatedAt: '2026-09-01T00:00:00.000Z' })]);
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.copyChange' }));
    expect(mockCopy).toHaveBeenCalledWith('Phone');
  });

  it('retires echoes of the server for the signed-in owner and shows only what still differs', async () => {
    const echo = { ...record, id: 'echo', title: 'Same as the server' };
    jest.mocked(listLegacyQueryCopies).mockResolvedValueOnce([echo, record]).mockResolvedValueOnce([record]);
    jest.mocked(retireLegacyEchoes).mockResolvedValueOnce({ retired: 1, undecided: 0 });
    render(<LegacyQueryCopies owner="owner" />);
    await waitFor(() => expect(listLegacyQueryCopies).toHaveBeenCalledTimes(2));
    expect(retireLegacyEchoes).toHaveBeenCalledWith('owner', expect.any(Function));
    await openReview();
    expect(await screen.findByRole('heading', { name: record.title })).toBeInTheDocument();
    expect(screen.queryByText(echo.title)).not.toBeInTheDocument();
  });

  it('shows the difference once a retry finds the server copy it was waiting for', async () => {
    jest.useFakeTimers();
    try {
      jest.mocked(listLegacyQueryCopies).mockResolvedValue([record]);
      jest.mocked(retireLegacyEchoes).mockResolvedValueOnce({ retired: 0, undecided: 1 }).mockResolvedValueOnce({ retired: 0, undecided: 0 });
      render(<LegacyQueryCopies owner="owner" />);
      await act(async () => { await jest.advanceTimersByTimeAsync(0); });
      fireEvent.click(screen.getByRole('button', { name: /legacyRecovery.review/ }));
      expect(screen.getByText('legacyRecovery.serverMissing')).toBeInTheDocument();
      // The engine reads the council meanwhile; the retry finds it different and keeps the copy.
      mockServerCopies.set('councils/council', { title: 'Server title' });
      await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
      expect(retireLegacyEchoes).toHaveBeenCalledTimes(2);
      expect(screen.queryByText('legacyRecovery.serverMissing')).not.toBeInTheDocument();
      expect(screen.getByText(/Server title/)).toBeInTheDocument();
    } finally { jest.useRealTimers(); }
  });

  it('shows the difference when the server copy arrives between the first look and the first pass', async () => {
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([record]);
    jest.mocked(retireLegacyEchoes).mockImplementationOnce(async () => {
      mockServerCopies.set('councils/council', { title: 'Server title' });
      return { retired: 0, undecided: 0 };
    });
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    expect(await screen.findByText(/Server title/)).toBeInTheDocument();
    expect(screen.queryByText('legacyRecovery.serverMissing')).not.toBeInTheDocument();
  });

  it('closes the remove question when the copy it was asked about is replaced under the same id', async () => {
    jest.useFakeTimers();
    try {
      const replaced = { ...record, raw: '{"title":"Words filed later by another tab"}' };
      // The first look and the pass right after it still read the copy the question will be asked about.
      jest.mocked(listLegacyQueryCopies).mockResolvedValueOnce([record]).mockResolvedValueOnce([record]).mockResolvedValue([replaced]);
      jest.mocked(retireLegacyEchoes).mockResolvedValueOnce({ retired: 0, undecided: 1 }).mockResolvedValueOnce({ retired: 0, undecided: 0 });
      render(<LegacyQueryCopies owner="owner" />);
      await act(async () => { await jest.advanceTimersByTimeAsync(0); });
      fireEvent.click(screen.getByRole('button', { name: /legacyRecovery.review/ }));
      fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.removeCopy' }));
      expect(screen.getByText('legacyRecovery.removeCopyConfirm')).toBeInTheDocument();
      await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
      expect(screen.queryByText('legacyRecovery.removeCopyConfirm')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'legacyRecovery.removeCopyYes' })).not.toBeInTheDocument();
      expect(removeLegacyCopies).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
  });

  it('keeps showing the archive when the comparison fails', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([record]);
    jest.mocked(retireLegacyEchoes).mockRejectedValueOnce(new Error('snapshot unreadable'));
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    expect(await screen.findByRole('heading', { name: record.title })).toBeInTheDocument();
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: record.title })).toBeInTheDocument();
    error.mockRestore();
  });
  it('shows a nested part that differs in full: a prepared answer under an unchanged question', async () => {
    const topic = (answer: string) => ({ id: 'm1', title: 'Camp', questions: [{ id: 'q1', question: 'Who leads?', answer }] });
    mockServerCopies.set('councils/council', { id: 'council', userId: 'owner', title: 'Council', topics: [topic('Server answer')] });
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([{ ...record, raw: JSON.stringify({ id: 'council', userId: 'owner', title: 'Council', topics: [topic('Device answer')] }) }]);
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    const change = screen.getByRole('group', { name: 'legacyRecovery.kindReplaced' });
    expect(within(change).getByText(/Device answer/)).toBeInTheDocument();
    expect(within(change).getByText(/Server answer/)).toBeInTheDocument();
  });

  it('keeps a copy whose difference is partly invisible when the review closes, and asks before removing it', async () => {
    const a = { id: 'm1', title: 'A' }, b = { id: 'm2', title: 'B' };
    mockServerCopies.set('councils/council', { id: 'council', userId: 'owner', title: 'Server title', topics: [b, a] });
    const copy = { ...record, raw: JSON.stringify({ id: 'council', userId: 'owner', title: 'Device title', topics: [a, b] }) };
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([copy]);
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    expect(screen.getByText('legacyRecovery.partlyHidden')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'legacyRecovery.removeCopy' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /legacyRecovery\.accept$/ }));
    // Every shown change accepted: the card now asks, and closing alone removes nothing.
    expect(screen.getByRole('button', { name: 'legacyRecovery.removeCopy' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'common.close' })[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(removeLegacyCopies).not.toHaveBeenCalled();
  });

  it('never lets a decision carry over to a change the person did not see: a refreshed comparison asks again', async () => {
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'A', note: 'A\nmid\nb' });
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([rowCopy('c1', { id: 's1', userId: 'owner', title: 'A', note: 'a\nmid\nb' })]);
    let refresh!: (value: { retired: number; undecided: number }) => void;
    jest.mocked(retireLegacyEchoes).mockImplementationOnce(() => new Promise(resolve => { refresh = resolve; }));
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: /legacyRecovery\.accept$/ }));
    expect(screen.getByRole('status')).toHaveTextContent('legacyRecovery.accepted');
    // The app's copy moves on meanwhile: the difference is now about another line.
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'A', note: 'a\nmid\nB' });
    await act(async () => refresh({ retired: 1, undecided: 0 }));
    await waitFor(() => expect(screen.getByRole('group', { name: 'legacyRecovery.kindReplaced' })).toHaveTextContent('B'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('names a left-out part that differs beside a visible change, and shows words under any key', async () => {
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'A', planText: { id: 'remote', p2: 'new' } });
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([rowCopy('c1', { id: 's1', userId: 'owner', title: 'A', planText: { id: 'UNSENT', p2: 'old' } })]);
    const { unmount } = render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    expect(screen.getByText('legacyRecovery.partlyHidden')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /legacyRecovery\.accept$/ }));
    // Something is still not shown, so nothing offers to take every copy at once.
    expect(screen.queryByRole('button', { name: 'legacyRecovery.removeDecided' })).not.toBeInTheDocument();
    unmount();

    const church = (id: string, city: string) => ({ id: 'p1', date: '2026-04-05', church: { id, name: 'Grace', city } });
    mockServerCopies.set('sermons/s2', { id: 's2', userId: 'owner', title: 'Easter', preachDates: [church('c2', 'Davis')] });
    const sermon = { ...rowCopy('c2', { id: 's2', userId: 'owner', title: 'Easter', preachDates: [church('c1', 'Sacramento')] }), collection: 'sermons' };
    const words = { id: 'm1', title: 'Camp', textId: 'Words typed under a reference key' };
    mockServerCopies.set('councils/council', { id: 'council', userId: 'owner', title: 'T', topics: [] });
    const council = { ...record, raw: JSON.stringify({ id: 'council', userId: 'owner', title: 'T', topics: [words] }) };
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([sermon, council]);
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    expect(within(screen.getByRole('heading', { name: 'Easter' }).closest('article')!).getByText('legacyRecovery.partlyHidden')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'legacyRecovery.kindRemoved' })).toHaveTextContent(words.textId);
  });

  it('shows the AI model the person picked as a change, not as something hidden', async () => {
    mockServerCopies.set('users/owner', { id: 'owner', language: 'en', preferredText: { providerId: 'openai', modelId: 'model-b' } });
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([{ ...record, collection: 'users', documentId: 'owner', title: 'owner',
      raw: JSON.stringify({ id: 'owner', language: 'ru', preferredText: { providerId: 'openai', modelId: 'model-a' } }) }]);
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    expect(screen.queryByText('legacyRecovery.partlyHidden')).not.toBeInTheDocument();
    const changes = screen.getAllByRole('group', { name: /legacyRecovery\.kind/ }).map(group => group.textContent).join('\n');
    expect(changes).toContain('model-a');
    expect(changes).toContain('model-b');
  });

  it('keeps what a copy holds a press away before any decision: its raw data, its file, every file', async () => {
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'Funerals', description: 'Server' });
    const copy = rowCopy('c1', { id: 's1', userId: 'owner', title: 'Funerals', description: 'Old' });
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([copy]);
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    const card = screen.getByRole('heading', { name: 'Funerals' }).closest('article')!;
    expect(within(card).getByText('legacyRecovery.rawData')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'legacyRecovery.export' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'legacyRecovery.removeCopy' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'legacyRecovery.downloadAll' })).toBeInTheDocument();
    expect(screen.queryByText('legacyRecovery.acceptAllChangesConfirm')).not.toBeInTheDocument();
  });

  it('asks again when the same words change at another place after the app copy moved on', async () => {
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'A', note: 'Q1\nYes\nQ2\nNo' });
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([rowCopy('c1', { id: 's1', userId: 'owner', title: 'A', note: 'Q1\nNo\nQ2\nNo' })]);
    let refresh!: (value: { retired: number; undecided: number }) => void;
    jest.mocked(retireLegacyEchoes).mockImplementationOnce(() => new Promise(resolve => { refresh = resolve; }));
    render(<LegacyQueryCopies owner="owner" />);
    await openReview();
    fireEvent.click(screen.getByRole('button', { name: /legacyRecovery\.accept$/ }));
    expect(screen.getByRole('status')).toHaveTextContent('legacyRecovery.accepted');
    // Now the second question changed in the app, with the very same words: "No" became "Yes".
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'A', note: 'Q1\nNo\nQ2\nYes' });
    await act(async () => refresh({ retired: 1, undecided: 0 }));
    await waitFor(() => expect(screen.getByRole('group', { name: 'legacyRecovery.kindReplaced' })).toBeInTheDocument());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'legacyRecovery.removeDecided' })).not.toBeInTheDocument();
  });
});

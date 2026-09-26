import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { LegacyQueryCopies, LegacyQueryMigrationGate } from '../LegacyQueryRecovery';
import { compareLegacyCopy, listLegacyQueryCopies, preserveLegacyQueryCache, removeLegacyCopies, retireLegacyEchoes } from '../legacyQueryRecovery.client';

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
const openDifferences = () => fireEvent.click(screen.getByText('legacyRecovery.showDifferences'));

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
    expect(await screen.findByRole('alert')).toHaveTextContent('legacyRecovery.preservationFailed');
    expect(mounted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.retry' }));
    await waitFor(() => expect(preserveLegacyQueryCache).toHaveBeenCalledTimes(2));
    expect(mounted).not.toHaveBeenCalled();
    await act(async () => complete());
    expect(screen.getByText('Workspace')).toBeVisible();
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it('fences a late read from the previous account and keeps the raw copy available', async () => {
    let previous!: (value: typeof record[]) => void;
    jest.mocked(listLegacyQueryCopies).mockImplementationOnce(() => new Promise(resolve => { previous = resolve; })).mockResolvedValue([]);
    const view = render(<LegacyQueryCopies owner="owner" />);
    view.rerender(<LegacyQueryCopies owner="other" />);
    await act(async () => previous([record]));
    expect(screen.queryByText(record.title)).not.toBeInTheDocument();
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([record]);
    view.rerender(<LegacyQueryCopies owner="owner" />);
    await screen.findByText('legacyRecovery.cacheTitle');
    openDifferences();
    expect(await screen.findByText(record.title)).toBeInTheDocument();
    expect(screen.getByText(record.raw)).toBeInTheDocument();
  });

  it('shows which side is newer, both dates and only the fields that differ', async () => {
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'Funerals', description: 'Server text', updatedAt: '2026-09-16T23:17:36.000Z' });
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([
      rowCopy('c1', { id: 's1', userId: 'owner', title: 'Funerals', description: 'Old text', updatedAt: '2026-09-03T10:00:00.000Z' }),
    ]);
    render(<LegacyQueryCopies owner="owner" />);
    expect(await screen.findByText('legacyRecovery.cacheTitle')).toBeInTheDocument();
    openDifferences();
    const row = screen.getByText('Funerals').closest('li')!;
    expect(within(row).getByText('legacyRecovery.freshness.serverNewer')).toBeInTheDocument();
    expect(within(row).getByText('legacyRecovery.field.description')).toBeInTheDocument();
    expect(within(row).getByText('Old text')).toBeInTheDocument();
    expect(within(row).getByText('Server text')).toBeInTheDocument();
    expect(within(row).queryByText('legacyRecovery.field.title')).not.toBeInTheDocument();
  });

  it('keeps the server version of one copy and reads the archive again', async () => {
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'Funerals', updatedAt: '2026-09-16T00:00:00.000Z' });
    const copy = rowCopy('c1', { id: 's1', userId: 'owner', title: 'Funerals', description: 'Old', updatedAt: '2026-09-03T00:00:00.000Z' });
    jest.mocked(listLegacyQueryCopies).mockResolvedValueOnce([copy]).mockResolvedValue([]);
    render(<LegacyQueryCopies owner="owner" />);
    await screen.findByText('legacyRecovery.cacheTitle');
    openDifferences();
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.keepServer' }));
    await waitFor(() => expect(removeLegacyCopies).toHaveBeenCalledWith('owner', [{ id: 'c1', raw: copy.raw }]));
    await waitFor(() => expect(screen.queryByText('legacyRecovery.cacheTitle')).not.toBeInTheDocument());
  });

  it('accepts everything from the server after one explicit confirmation, whatever the dates say', async () => {
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'A', updatedAt: '2026-09-16T00:00:00.000Z' });
    mockServerCopies.set('series/s2', { id: 's2', userId: 'owner', title: 'B', updatedAt: '2026-09-16T00:00:00.000Z' });
    const copies = [
      rowCopy('c1', { id: 's1', userId: 'owner', title: 'A', note: 'old', updatedAt: '2026-09-01T00:00:00.000Z' }),
      rowCopy('c2', { id: 's2', userId: 'owner', title: 'B', note: 'old', updatedAt: '2026-09-02T00:00:00.000Z' }),
    ];
    jest.mocked(listLegacyQueryCopies).mockResolvedValueOnce(copies).mockResolvedValue([]);
    render(<LegacyQueryCopies owner="owner" />);
    await screen.findByText('legacyRecovery.cacheTitle');
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.acceptAllServer' }));
    expect(await screen.findByText('legacyRecovery.acceptAllConfirm')).toBeInTheDocument();
    expect(removeLegacyCopies).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.acceptAllYes' }));
    await waitFor(() => expect(removeLegacyCopies).toHaveBeenCalledWith('owner', copies.map(entry => ({ id: entry.id, raw: entry.raw }))));
  });

  it('asks first when a copy is newer on this device, and removes nothing until confirmed', async () => {
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'A', updatedAt: '2026-09-01T00:00:00.000Z' });
    const copies = [rowCopy('c1', { id: 's1', userId: 'owner', title: 'A', note: 'typed on the phone', updatedAt: '2026-09-20T00:00:00.000Z' })];
    jest.mocked(listLegacyQueryCopies).mockResolvedValueOnce(copies).mockResolvedValue([]);
    render(<LegacyQueryCopies owner="owner" />);
    await screen.findByText('legacyRecovery.cacheTitle');
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.acceptAllServer' }));
    expect(await screen.findByText('legacyRecovery.acceptAllConfirm')).toBeInTheDocument();
    expect(removeLegacyCopies).not.toHaveBeenCalled();
    // Pressing the header again cannot skip the question: it waits until the person answers.
    expect(screen.getByRole('button', { name: 'legacyRecovery.acceptAllServer' })).toBeDisabled();
    const confirm = screen.getByRole('alert');
    fireEvent.click(within(confirm).getByRole('button', { name: 'legacyRecovery.acceptAllYes' }));
    await waitFor(() => expect(removeLegacyCopies).toHaveBeenCalledWith('owner', [{ id: 'c1', raw: copies[0].raw }]));
  });

  it('keeps every other copy visible when one cannot be compared', async () => {
    mockServerCopies.set('series/s2', { id: 's2', userId: 'owner', title: 'Readable', updatedAt: '2026-09-16T00:00:00.000Z' });
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([
      rowCopy('c1', { id: 's1', userId: 'owner', title: 'Broken' }), rowCopy('c2', { id: 's2', userId: 'owner', title: 'Readable', note: 'x' }),
    ]);
    jest.mocked(compareLegacyCopy).mockImplementationOnce(() => { throw new TypeError('bad shape'); });
    render(<LegacyQueryCopies owner="owner" />);
    await screen.findByText('legacyRecovery.cacheTitle');
    openDifferences();
    expect(screen.getByText('Broken')).toBeInTheDocument();
    expect(screen.getByText('Readable')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // A failed comparison claims nothing about the server copy.
    expect(within(screen.getByText('Broken').closest('li')!).getByText('legacyRecovery.serverUnknown')).toBeInTheDocument();
  });

  it('shows what a copy without a visible difference holds and asks before removing it', async () => {
    jest.mocked(listLegacyQueryCopies).mockResolvedValueOnce([record]).mockResolvedValue([]);
    render(<LegacyQueryCopies owner="owner" />);
    await screen.findByText('legacyRecovery.cacheTitle');
    openDifferences();
    const row = screen.getByText(record.title).closest('li')!;
    expect(within(row).getByText('legacyRecovery.copyContent')).toBeInTheDocument();
    expect(within(row).getAllByText(/Private saved text/).length).toBeGreaterThan(1);
    expect(within(row).queryByRole('button', { name: 'legacyRecovery.keepServer' })).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'legacyRecovery.removeCopy' }));
    expect(within(row).getByRole('alert')).toHaveTextContent('legacyRecovery.removeCopyConfirm');
    expect(removeLegacyCopies).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole('button', { name: 'legacyRecovery.removeCopyYes' }));
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
    await screen.findByText('legacyRecovery.cacheTitle');
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.acceptAllServer' }));
    await act(async () => decide({ retired: 1, undecided: 0 }));
    await waitFor(() => expect(listLegacyQueryCopies).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.acceptAllYes' }));
    await waitFor(() => expect(removeLegacyCopies).toHaveBeenCalledWith('owner', [{ id: asked.id, raw: asked.raw }]));
  });

  it('names a failed removal as such', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.mocked(removeLegacyCopies).mockRejectedValueOnce(new Error('quota'));
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([record]);
    render(<LegacyQueryCopies owner="owner" />);
    await screen.findByText('legacyRecovery.cacheTitle');
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.acceptAllServer' }));
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.acceptAllYes' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('legacyRecovery.removeFailed'));
    jest.mocked(console.error).mockRestore();
  });

  it('tells apart values that read alike: an empty field and a missing one', async () => {
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'A', note: null });
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([rowCopy('c1', { id: 's1', userId: 'owner', title: 'A' })]);
    render(<LegacyQueryCopies owner="owner" />);
    await screen.findByText('legacyRecovery.cacheTitle');
    openDifferences();
    const row = screen.getByText('A').closest('li')!;
    expect(within(row).getByText('legacyRecovery.absent')).toBeInTheDocument();
    expect(within(row).getByText('null')).toBeInTheDocument();
  });

  it('says so when a download fails while the copies stay on screen', async () => {
    const createObjectURL = jest.fn((): string => { throw new Error('blocked'); });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([record]);
    render(<LegacyQueryCopies owner="owner" />);
    await screen.findByText('legacyRecovery.cacheTitle');
    openDifferences();
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.export' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('legacyRecovery.actionFailed');
    expect(screen.getByText(record.title)).toBeInTheDocument();
    // The next download that works clears the failure instead of leaving it on screen for good.
    createObjectURL.mockImplementation(() => 'blob:copy');
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.export' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });

  it('shows what an unsent operation carried and offers to remove it, not to keep the server version', async () => {
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'A' });
    const operation = { id: 'op', owner: 'owner', collection: 'series', documentId: 's1', title: 'update: s1', savedAt: 1,
      raw: JSON.stringify({ mutationKey: ['series', 'update'], state: { isPaused: true, variables: { updates: { title: 'Typed offline' } } } }) };
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([operation]);
    render(<LegacyQueryCopies owner="owner" />);
    await screen.findByText('legacyRecovery.cacheTitle');
    openDifferences();
    expect(screen.getByText('legacyRecovery.operationContent')).toBeInTheDocument();
    expect(screen.getAllByText(/Typed offline/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'legacyRecovery.removeCopy' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'legacyRecovery.keepServer' })).not.toBeInTheDocument();
  });

  it('copies the device side of each difference, named by field', async () => {
    mockServerCopies.set('series/s1', { id: 's1', userId: 'owner', title: 'A', description: 'Server', updatedAt: '2026-09-16T00:00:00.000Z' });
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([rowCopy('c1', { id: 's1', userId: 'owner', title: 'A', description: 'Phone', updatedAt: '2026-09-01T00:00:00.000Z' })]);
    render(<LegacyQueryCopies owner="owner" />);
    await screen.findByText('legacyRecovery.cacheTitle');
    openDifferences();
    fireEvent.click(screen.getByRole('button', { name: 'legacyRecovery.copyDevice' }));
    expect(mockCopy).toHaveBeenCalledWith('legacyRecovery.field.description: Phone');
  });

  it('retires echoes of the server for the signed-in owner and shows only what still differs', async () => {
    const echo = { ...record, id: 'echo', title: 'Same as the server' };
    jest.mocked(listLegacyQueryCopies).mockResolvedValueOnce([echo, record]).mockResolvedValueOnce([record]);
    jest.mocked(retireLegacyEchoes).mockResolvedValueOnce({ retired: 1, undecided: 0 });
    render(<LegacyQueryCopies owner="owner" />);
    await waitFor(() => expect(listLegacyQueryCopies).toHaveBeenCalledTimes(2));
    expect(retireLegacyEchoes).toHaveBeenCalledWith('owner', expect.any(Function));
    openDifferences();
    expect(await screen.findByText(record.title)).toBeInTheDocument();
    expect(screen.queryByText(echo.title)).not.toBeInTheDocument();
  });

  it('keeps showing the archive when the comparison fails', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.mocked(listLegacyQueryCopies).mockResolvedValue([record]);
    jest.mocked(retireLegacyEchoes).mockRejectedValueOnce(new Error('snapshot unreadable'));
    render(<LegacyQueryCopies owner="owner" />);
    await screen.findByText('legacyRecovery.cacheTitle');
    openDifferences();
    expect(await screen.findByText(record.title)).toBeInTheDocument();
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(screen.getByText(record.title)).toBeInTheDocument();
    error.mockRestore();
  });
});

describe('line diff of a structured difference', () => {
  const { lineDiff } = jest.requireActual('../LegacyQueryRecovery') as typeof import('../LegacyQueryRecovery');

  it('keeps changed lines with two lines of context and folds the unchanged rest', () => {
    const lines = (changed: string) => ['a', 'b', 'c', 'd', 'e', changed, 'f', 'g', 'h', 'i'].join('\n');
    expect(lineDiff(lines('old'), lines('new'))).toEqual([
      { gap: 3 }, { op: ' ', text: 'd' }, { op: ' ', text: 'e' }, { op: '-', text: 'old' }, { op: '+', text: 'new' },
      { op: ' ', text: 'f' }, { op: ' ', text: 'g' }, { gap: 2 },
    ]);
  });

  it('shows added and removed lines where they belong', () => {
    expect(lineDiff('x\ny', 'x\nz\ny')).toEqual([{ op: ' ', text: 'x' }, { op: '+', text: 'z' }, { op: ' ', text: 'y' }]);
    expect(lineDiff('x\nz\ny', 'x\ny')).toEqual([{ op: ' ', text: 'x' }, { op: '-', text: 'z' }, { op: ' ', text: 'y' }]);
  });
});

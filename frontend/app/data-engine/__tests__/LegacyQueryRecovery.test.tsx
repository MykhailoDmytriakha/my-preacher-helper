import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';

import { LegacyQueryCopies, LegacyQueryMigrationGate } from '../LegacyQueryRecovery';
import { listLegacyQueryCopies, preserveLegacyQueryCache, retireLegacyEchoes } from '../legacyQueryRecovery.client';

jest.mock('../legacyQueryRecovery.client', () => ({ preserveLegacyQueryCache: jest.fn(), listLegacyQueryCopies: jest.fn(), retireLegacyEchoes: jest.fn() }));
const enabled = () => true;
const record = { id: 'copy', owner: 'owner', collection: 'councils', documentId: 'council', title: 'Private saved text', raw: '{"title":"Private saved text"}', savedAt: 1 };

describe('legacy cache preservation UI', () => {
  beforeEach(() => { jest.resetAllMocks(); jest.mocked(retireLegacyEchoes).mockResolvedValue({ retired: 0, undecided: 0 }); });
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
  it('exposes only explicit preview/export and fences a late previous-account read', async () => {
    let previous!: (value: typeof record[]) => void;
    jest.mocked(listLegacyQueryCopies).mockImplementationOnce(() => new Promise(resolve => { previous = resolve; })).mockResolvedValueOnce([]);
    const view = render(<LegacyQueryCopies owner="owner" />);
    view.rerender(<LegacyQueryCopies owner="other" />);
    await act(async () => previous([record]));
    expect(screen.queryByText(record.title)).not.toBeInTheDocument();
    jest.mocked(listLegacyQueryCopies).mockResolvedValueOnce([record]);
    view.rerender(<LegacyQueryCopies owner="owner" />);
    expect(await screen.findByText(record.title)).toBeInTheDocument();
    expect(screen.getByText(record.raw)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { hidden: true })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'legacyRecovery.export', hidden: true })).toBeInTheDocument();
  });
  it('retires echoes of the server for the signed-in owner and shows only what still differs', async () => {
    const echo = { ...record, id: 'echo', title: 'Same as the server' };
    jest.mocked(listLegacyQueryCopies).mockResolvedValueOnce([echo, record]).mockResolvedValueOnce([record]);
    jest.mocked(retireLegacyEchoes).mockResolvedValueOnce({ retired: 1, undecided: 0 });
    render(<LegacyQueryCopies owner="owner" />);
    await waitFor(() => expect(listLegacyQueryCopies).toHaveBeenCalledTimes(2));
    expect(retireLegacyEchoes).toHaveBeenCalledWith('owner', expect.any(Function));
    expect(await screen.findByText(record.title)).toBeInTheDocument();
    expect(screen.queryByText(echo.title)).not.toBeInTheDocument();
  });
  it('keeps showing the archive when the comparison fails', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.mocked(listLegacyQueryCopies).mockResolvedValueOnce([record]);
    jest.mocked(retireLegacyEchoes).mockRejectedValueOnce(new Error('snapshot unreadable'));
    render(<LegacyQueryCopies owner="owner" />);
    expect(await screen.findByText(record.title)).toBeInTheDocument();
    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(screen.getByText(record.title)).toBeInTheDocument();
    error.mockRestore();
  });
});

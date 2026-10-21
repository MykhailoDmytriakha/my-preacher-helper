import { fireEvent, render, screen } from '@testing-library/react';

import { useSearchInputQuery } from '@/hooks/useSearchInputQuery';

let mockQuery = '';
const mockWrite = jest.fn(() => Promise.resolve(new URLSearchParams()));
jest.mock('nuqs', () => ({ useQueryState: () => [mockQuery, mockWrite] }));

function Search({ emptyWhenBlank = false }: { emptyWhenBlank?: boolean }) {
  const { value, setValue, inputRef } = useSearchInputQuery('q', { emptyWhenBlank });
  return <input aria-label="Search" ref={inputRef} value={value}
    onChange={(event) => setValue(event.target.value)}
    onKeyDown={(event) => { if (event.key === 'Escape') setValue(''); }} />;
}

// Query snapshots are controlled here; real Nuqs history/navigation queues are tested in Chrome.
describe('useSearchInputQuery input ownership', () => {
  beforeEach(() => { mockQuery = ''; mockWrite.mockClear(); window.history.replaceState(null, '', '/'); });

  it('initializes from the URL and adopts an external URL while not editing', () => {
    mockQuery = 'faith';
    const view = render(<Search />);
    expect(screen.getByRole('textbox')).toHaveValue('faith');
    mockQuery = 'hope';
    view.rerender(<Search />);
    expect(screen.getByRole('textbox')).toHaveValue('hope');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('keeps authored input during renders before the URL snapshot catches up', () => {
    mockQuery = 'old';
    const view = render(<Search />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'new' } });
    view.rerender(<Search />);
    expect(input).toHaveValue('new');
    expect(mockWrite).toHaveBeenLastCalledWith('new');
    mockQuery = 'new';
    view.rerender(<Search />);
    expect(input).toHaveValue('new');
  });

  it('keeps Escape clear during a stale snapshot and after its acknowledgement', () => {
    mockQuery = 'faith';
    const view = render(<Search />);
    const input = screen.getByRole('textbox');
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });
    view.rerender(<Search />);
    expect(input).toHaveValue('');
    expect(mockWrite).toHaveBeenLastCalledWith('');
    mockQuery = '';
    view.rerender(<Search />);
    expect(input).toHaveValue('');
  });

  it('adopts Back and Forward with a focused input without writing another history entry', () => {
    mockQuery = 'faith';
    const view = render(<Search />);
    const input = screen.getByRole('textbox');
    input.focus();
    fireEvent.change(input, { target: { value: 'hope' } });
    mockQuery = 'hope';
    view.rerender(<Search />);
    mockWrite.mockClear();

    window.history.replaceState(null, '', '/?q=faith');
    fireEvent.popState(window);
    mockQuery = 'faith';
    view.rerender(<Search />);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('faith');

    window.history.replaceState(null, '', '/?q=hope');
    fireEvent.popState(window);
    mockQuery = 'hope';
    view.rerender(<Search />);
    expect(input).toHaveValue('hope');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('restores an absent history query immediately before the URL hook publishes its snapshot', () => {
    mockQuery = 'faith';
    render(<Search emptyWhenBlank />);
    const input = screen.getByRole('textbox');
    input.focus();
    window.history.replaceState(null, '', '/?tab=all#kept');
    fireEvent.popState(window);
    expect(input).toHaveValue('');
    expect(window.location.search).toBe('?tab=all');
    expect(window.location.hash).toBe('#kept');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('removes a blank query only when the consumer requests that policy', () => {
    render(<Search emptyWhenBlank />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  ' } });
    expect(screen.getByRole('textbox')).toHaveValue('  ');
    expect(mockWrite).toHaveBeenLastCalledWith(null);
  });
});

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
  beforeEach(() => { mockQuery = ''; mockWrite.mockClear(); });

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

  it('removes a blank query only when the consumer requests that policy', () => {
    render(<Search emptyWhenBlank />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  ' } });
    expect(screen.getByRole('textbox')).toHaveValue('  ');
    expect(mockWrite).toHaveBeenLastCalledWith(null);
  });
});

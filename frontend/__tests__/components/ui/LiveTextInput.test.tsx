import { act, fireEvent, render, screen } from '@testing-library/react';

import { LiveTextArea, LiveTextInput } from '@/components/ui/LiveTextInput';
import { BufferedTextScope } from '@/components/ui/useBufferedText';

describe.each([LiveTextInput, LiveTextArea])('Live text synchronization', Field => {
  it('shows a remote change while focused once the displayed text is owned by the document', () => {
    const onChange = jest.fn();
    const { rerender } = render(<Field aria-label="Text" value="original" onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    rerender(<Field aria-label="Text" value="other device" onChange={onChange} />);
    expect(input).toHaveValue('other device');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps rapid typing through delayed echoes, then follows the engine without requiring blur', () => {
    const onChange = jest.fn();
    const { rerender } = render(<Field aria-label="Text" value="A" onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'AB' } });
    fireEvent.change(input, { target: { value: 'ABC' } });
    rerender(<Field aria-label="Text" value="AB" onChange={onChange} />);
    expect(input).toHaveValue('ABC');
    rerender(<Field aria-label="Text" value="ABC" onChange={onChange} />);
    rerender(<Field aria-label="Text" value="remote" onChange={onChange} />);
    expect(input).toHaveValue('remote');
    expect(onChange.mock.calls).toEqual([['AB'], ['ABC']]);
  });

  it('does not discard an unacknowledged keystroke on blur', () => {
    const onChange = jest.fn();
    const { rerender } = render(<Field aria-label="Text" value="A" onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'AB' } });
    fireEvent.blur(input);
    expect(input).toHaveValue('AB');
    rerender(<Field aria-label="Text" value="AB" onChange={onChange} />);
    expect(input).toHaveValue('AB');
  });

  it('keeps refused words in view, yet shows the next value of the document', async () => {
    const onChange = jest.fn(() => Promise.reject(new Error('The sermon is not available for editing')));
    const { rerender } = render(<Field aria-label="Text" value="stored" onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'stored mine' } });
    await act(async () => { await Promise.resolve(); });
    // The refused words may be the only copy: they stay on screen.
    expect(input).toHaveValue('stored mine');
    // They no longer hold the document back.
    rerender(<Field aria-label="Text" value="other device" onChange={onChange} />);
    expect(input).toHaveValue('other device');
  });

  it('keeps the alternate words within the editing scope when its stored copy changes', async () => {
    const firstScope = {};
    const nextScope = {};
    const onChange = jest.fn().mockRejectedValueOnce(new Error('refused')).mockResolvedValue(undefined);
    const view = (scope: object, value: string) => <BufferedTextScope.Provider value={scope}>
      <Field aria-label="Text" value={value} onChange={onChange} />
    </BufferedTextScope.Provider>;
    const { rerender } = render(view(firstScope, 'Opening'));
    const field = screen.getByRole('textbox');
    await act(async () => { fireEvent.change(field, { target: { value: 'Only in this field' } }); });
    expect(field).toHaveValue('Only in this field');
    expect(screen.queryByText('dataSync.refusedInputText')).not.toBeInTheDocument();

    rerender(view(firstScope, 'Stored on phone'));
    expect(field).toHaveValue('Stored on phone');
    expect(screen.getByText('Only in this field')).toBeInTheDocument();
    fireEvent.change(field, { target: { value: 'Words on top of the phone version' } });
    rerender(view(firstScope, 'Words on top of the phone version'));
    expect(screen.getByText('Only in this field')).toBeInTheDocument();

    rerender(view(nextScope, 'Another opening'));
    expect(field).toHaveValue('Another opening');
    expect(screen.queryByText('Only in this field')).not.toBeInTheDocument();
  });

  it('retains an earlier distinct refusal when the stored value returns to the same opening', async () => {
    const editingScope = {};
    const onChange = jest.fn().mockRejectedValue(new Error('refused'));
    const view = (value: string) => <BufferedTextScope.Provider value={editingScope}>
      <Field aria-label="Text" value={value} onChange={onChange} />
    </BufferedTextScope.Provider>;
    const { rerender } = render(view('Opening'));
    const field = screen.getByRole('textbox');
    await act(async () => { fireEvent.change(field, { target: { value: 'First local text' } }); });
    rerender(view('Another stored value'));
    rerender(view('Opening'));
    await act(async () => { fireEvent.change(field, { target: { value: 'Second local text' } }); });
    rerender(view('Latest stored value'));
    expect(field).toHaveValue('Latest stored value');
    expect(screen.getByText('First local text')).toBeInTheDocument();
    expect(screen.getByText('Second local text')).toBeInTheDocument();
  });

  it.each(['Opening draft and another word', 'Opening'])('retires the refused text when continuing or undoing it to %s', async next => {
    const editingScope = {};
    const onChange = jest.fn().mockRejectedValueOnce(new Error('refused')).mockResolvedValue(undefined);
    const view = (value: string) => <BufferedTextScope.Provider value={editingScope}>
      <Field aria-label="Text" value={value} onChange={onChange} />
    </BufferedTextScope.Provider>;
    const { rerender } = render(view('Opening'));
    const field = screen.getByRole('textbox');
    await act(async () => { fireEvent.change(field, { target: { value: 'Opening draft' } }); });
    fireEvent.change(field, { target: { value: next } });
    rerender(view(next));
    rerender(view('A subsequent stored version'));
    expect(field).toHaveValue('A subsequent stored version');
    expect(screen.queryByText('Opening draft')).not.toBeInTheDocument();
  });

  it('lets an older refusal pass without releasing newer typing that happens to read the same', async () => {
    const answers: Array<{ reject: (error: Error) => void }> = [];
    const onChange = jest.fn(() => new Promise<void>((_, reject) => { answers.push({ reject }); }));
    const { rerender } = render(<Field aria-label="Text" value="base" onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'A' } });
    fireEvent.change(input, { target: { value: 'AB' } });
    fireEvent.change(input, { target: { value: 'A' } });
    await act(async () => { answers[0].reject(new Error('refused')); await Promise.resolve(); });
    expect(input).toHaveValue('A');
    // The latest A is still guarded: a stale document value does not replace it.
    rerender(<Field aria-label="Text" value="AB" onChange={onChange} />);
    expect(input).toHaveValue('A');
  });
});

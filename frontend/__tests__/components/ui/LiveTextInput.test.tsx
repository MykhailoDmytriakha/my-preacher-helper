import { act, fireEvent, render, screen } from '@testing-library/react';

import { LiveTextArea, LiveTextInput } from '@/components/ui/LiveTextInput';

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

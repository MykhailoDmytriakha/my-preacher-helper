import { fireEvent, render, screen } from '@testing-library/react';

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
});

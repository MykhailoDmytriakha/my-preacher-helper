import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import PointNote from '@/components/PointNote';

describe('PointNote editing', () => {
  const longNote = 'First paragraph\nSecond paragraph\nThird paragraph\nFourth paragraph';
  let scrollHeight: PropertyDescriptor | undefined;
  let style: HTMLStyleElement;

  beforeEach(() => {
    // JSDOM has no layout; give the real autosizer deterministic line measurements.
    scrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() { return this instanceof HTMLTextAreaElement ? this.value.split('\n').length * 20 + 8 : 0; },
    });
    style = document.createElement('style');
    style.textContent = 'textarea { box-sizing: border-box; width: 300px; padding: 4px; border: 1px solid; font-size: 14px; line-height: 20px; }';
    document.head.appendChild(style);
  });

  afterEach(() => {
    style.remove();
    if (scrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeight);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
  });

  it('fits existing multiline text and grows and shrinks while editing without saving', () => {
    const onChange = jest.fn();
    render(<PointNote note={longNote} onChange={onChange} />);
    fireEvent.click(screen.getByText(/First paragraph/));
    const editor = screen.getByRole('textbox');
    expect(editor).toHaveValue(longNote);
    expect(editor.style.height).toBe('90px');
    expect(editor).toHaveClass('overflow-hidden');
    fireEvent.change(editor, { target: { value: `${longNote}\nFifth paragraph` } });
    expect(editor.style.height).toBe('110px');
    fireEvent.change(editor, { target: { value: 'Short note' } });
    expect(editor.style.height).toBe('50px');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(editor);
    expect(onChange).toHaveBeenCalledWith('Short note');
  });

  it('cancels an expanded draft with Escape without persisting it', () => {
    const onChange = jest.fn();
    render(<PointNote note="Original note" onChange={onChange} />);
    fireEvent.click(screen.getByText('Original note'));
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: longNote } });
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('Original note')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps Shift+Enter for a newline and Enter for saving', () => {
    const onChange = jest.fn();
    render(<PointNote note="Original note" onChange={onChange} />);
    fireEvent.click(screen.getByText('Original note'));
    const editor = screen.getByRole('textbox');
    expect(fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true })).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(editor, { target: { value: longNote } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(longNote);
  });
});

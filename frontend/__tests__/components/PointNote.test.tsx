import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import PointNote from '@/components/PointNote';
import { useModalLayer } from '@/hooks/useModalLayer';

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

  it('cancels the note on Escape and leaves the window it sits in open', () => {
    const onClose = jest.fn();
    function InWindow() {
      const layer = useModalLayer({ onClose });
      return <div {...layer}><PointNote note="Original note" onChange={jest.fn()} /></div>;
    }
    render(<InWindow />);
    fireEvent.click(screen.getByText('Original note'));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
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

  it('closes the question on Escape pressed inside it and returns focus to the ×', async () => {
    const onChange = jest.fn();
    render(<PointNote note="Keep me" onChange={onChange} />);
    const clear = screen.getByLabelText('planEditor.note.delete');
    clear.focus();
    fireEvent.click(clear);
    const question = await screen.findByRole('dialog');
    // The key goes where a real key goes: to the focused control inside the question.
    fireEvent.keyDown(within(question).getByText('common.cancel'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText('planEditor.note.delete')).toHaveFocus());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not delete a note that became read-only while the question was open', async () => {
    const onChange = jest.fn();
    const { rerender } = render(<PointNote note="Locked meanwhile" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('planEditor.note.delete'));
    const question = await screen.findByRole('dialog');
    rerender(<PointNote note="Locked meanwhile" onChange={onChange} isReadOnly />);
    fireEvent.click(within(question).getByText('common.delete'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('asks before the × clears the note, and keeps it when the question is cancelled', async () => {
    const onChange = jest.fn();
    const hostClick = jest.fn();
    render(
      <div onClick={hostClick}>
        <PointNote note="What I want to say here" onChange={onChange} />
      </div>
    );

    fireEvent.click(screen.getByLabelText('planEditor.note.delete'));
    const question = await screen.findByRole('dialog');
    expect(within(question).getByText('planEditor.note.deleteConfirm')).toBeInTheDocument();
    expect(within(question).getByText('What I want to say here')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(within(question).getByText('common.cancel'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('What I want to say here')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('planEditor.note.delete'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByText('common.delete'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(undefined));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Answering the question must not fall through to the note or its host.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(hostClick).not.toHaveBeenCalled();
  });

  it('asks in the host\'s own words when the host renames the note', async () => {
    render(<PointNote note="Scratch idea" onChange={jest.fn()} labels={{ clear: 'Delete scratch', deleteConfirm: 'Delete this scratch?' }} />);
    fireEvent.click(screen.getByLabelText('Delete scratch'));
    expect(await screen.findByRole('dialog', { name: 'Delete this scratch?' })).toBeInTheDocument();
  });

  it('withdraws the question when the note text changes while asking, and never clears the new text', async () => {
    const onChange = jest.fn();
    const { rerender } = render(<PointNote note="Old text" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('planEditor.note.delete'));
    await screen.findByRole('dialog');
    rerender(<PointNote note="New text" onChange={onChange} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('New text')).toBeInTheDocument();
  });

  it('does not bring back a question once the note it was about is gone', async () => {
    const onChange = jest.fn();
    const { rerender } = render(<PointNote note="First" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('planEditor.note.delete'));
    await screen.findByRole('dialog');
    rerender(<PointNote note={undefined} onChange={onChange} />);
    rerender(<PointNote note="Written again" onChange={onChange} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps tracking the newest question when × is pressed again while one is open', async () => {
    const onChange = jest.fn();
    const { rerender } = render(<PointNote note="Old text" onChange={onChange} />);
    const clear = screen.getByLabelText('planEditor.note.delete');
    fireEvent.click(clear);
    await screen.findByRole('dialog');
    fireEvent.click(clear); // e.g. reached again with Shift+Tab and Enter behind the window
    await act(async () => {}); // let the replaced question's continuation run
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    rerender(<PointNote note="New text" onChange={onChange} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
  });
});


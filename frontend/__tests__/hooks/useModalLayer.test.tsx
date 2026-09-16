import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { useModalLayer } from '@/hooks/useModalLayer';
import '@testing-library/jest-dom';

/**
 * ONE PLACE THAT SAYS WHAT A MODAL WINDOW OWES THE PERSON, proven once here instead of
 * thirty-eight times in the windows that use it.
 */
function Window({
  name,
  onClose,
  closeDisabled,
  active = true,
  closeOnEscape,
}: {
  name: string;
  onClose: () => void;
  closeDisabled?: boolean;
  active?: boolean;
  closeOnEscape?: boolean;
}) {
  const layer = useModalLayer({ onClose, closeDisabled, active, closeOnEscape });
  return (
    <div {...layer} data-testid={name}>
      {name}
    </div>
  );
}

describe('a modal layer holds the page still', () => {
  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('locks the page while it is on screen', () => {
    render(<Window name="one" onClose={jest.fn()} />);

    expect(document.body.style.overflow).toBe('hidden');
  });

  it('gives the page back when it leaves', () => {
    const { unmount } = render(<Window name="one" onClose={jest.fn()} />);

    unmount();

    expect(document.body.style.overflow).toBe('');
  });

  it('holds nothing while it is mounted but not shown', () => {
    render(<Window name="one" onClose={jest.fn()} active={false} />);

    expect(document.body.style.overflow).toBe('');
  });

  it('keeps the page locked while a second window is still open', () => {
    const { rerender } = render(
      <>
        <Window name="one" onClose={jest.fn()} />
        <Window name="two" onClose={jest.fn()} />
      </>
    );

    rerender(<Window name="two" onClose={jest.fn()} />);

    expect(document.body.style.overflow).toBe('hidden');
  });
});

describe('a modal layer answers Escape, and only the topmost one does', () => {
  it('closes on Escape', () => {
    const onClose = jest.fn();
    render(<Window name="one" onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays put while closing is forbidden', () => {
    const onClose = jest.fn();
    render(<Window name="one" onClose={onClose} closeDisabled />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves the window beneath alone', () => {
    const outer = jest.fn();
    const inner = jest.fn();
    render(
      <>
        <Window name="outer" onClose={outer} />
        <Window name="inner" onClose={inner} />
      </>
    );

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('hands Escape back to the window beneath once the top one has gone', () => {
    const outer = jest.fn();
    const inner = jest.fn();
    const { rerender } = render(
      <>
        <Window name="outer" onClose={outer} />
        <Window name="inner" onClose={inner} />
      </>
    );

    rerender(<Window name="outer" onClose={outer} />);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('respects a window whose way out is not Escape', () => {
    const onClose = jest.fn();
    render(<Window name="one" onClose={onClose} closeOnEscape={false} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('marks its layer, so the windows can be told apart', () => {
    render(<Window name="one" onClose={jest.fn()} />);

    expect(screen.getByTestId('one')).toHaveAttribute('data-modal-layer', 'true');
  });
});

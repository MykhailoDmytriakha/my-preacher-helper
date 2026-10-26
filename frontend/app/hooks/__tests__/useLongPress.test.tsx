import { act, fireEvent, render, screen } from '@testing-library/react';

import { LONG_PRESS_MS, useLongPress } from '@/hooks/useLongPress';

function Tile({ onPress, onLongPress }: { onPress: () => void; onLongPress?: () => void }) {
  const { state, handlers } = useLongPress({ onPress, onLongPress });
  return <button type="button" data-state={state} {...handlers}>tile</button>;
}

// jsdom has no PointerEvent, and fireEvent.pointerDown would drop clientX and pointerType: a mouse event
// under the pointer's name keeps the place, and says which pointer it is (as `marks.test.tsx` does).
function pointer(target: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', init: { clientX?: number; clientY?: number; button?: number; pointerType?: string } = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX ?? 10, clientY: init.clientY ?? 10, button: init.button ?? 0 });
  Object.defineProperties(event, { pointerType: { value: init.pointerType ?? 'touch' }, pointerId: { value: 1 } });
  fireEvent(target, event);
}

const press = (tile: HTMLElement, at = { clientX: 10, clientY: 10 }) => pointer(tile, 'pointerdown', at);
/** A pointer's click counts its clicks (`detail` 1); a key's click (Enter, Space) has none (`detail` 0). */
const click = (tile: HTMLElement) => fireEvent.click(tile, { detail: 1 });

describe('useLongPress', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('does the press on a short tap, never the long action', () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    render(<Tile onPress={onPress} onLongPress={onLongPress} />);
    const tile = screen.getByRole('button');

    press(tile);
    act(() => { jest.advanceTimersByTime(LONG_PRESS_MS - 100); });
    fireEvent.pointerUp(tile);
    click(tile);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(tile).toHaveAttribute('data-state', 'idle');
  });

  it('fills while held, and does the long action when the finger lifts after half a second — the click after it is no press', () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    render(<Tile onPress={onPress} onLongPress={onLongPress} />);
    const tile = screen.getByRole('button');

    press(tile);
    expect(tile).toHaveAttribute('data-state', 'holding');
    act(() => { jest.advanceTimersByTime(LONG_PRESS_MS); });
    expect(tile).toHaveAttribute('data-state', 'armed');
    // Still held: nothing opens under the finger yet.
    expect(onLongPress).not.toHaveBeenCalled();

    fireEvent.pointerUp(tile);
    click(tile);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('gives a hold up when the finger moves away — it is scrolling the grid — and takes the click after it for no press', () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    render(<Tile onPress={onPress} onLongPress={onLongPress} />);
    const tile = screen.getByRole('button');

    press(tile, { clientX: 10, clientY: 10 });
    pointer(tile, 'pointermove', { clientX: 10, clientY: 40 });
    act(() => { jest.advanceTimersByTime(LONG_PRESS_MS + 100); });
    fireEvent.pointerUp(tile);
    // A mouse still clicks where it was lifted: moved away is changed mind (Codex review, 2026-10-23).
    click(tile);

    expect(onLongPress).not.toHaveBeenCalled();
    expect(onPress).not.toHaveBeenCalled();
    expect(tile).toHaveAttribute('data-state', 'idle');

    // The next press is a press again.
    press(tile);
    fireEvent.pointerUp(tile);
    click(tile);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('takes a press that left the button and came back for no press, but a touch leaving after its lift for one', () => {
    const onPress = jest.fn();
    render(<Tile onPress={onPress} onLongPress={jest.fn()} />);
    const tile = screen.getByRole('button');

    press(tile);
    fireEvent.pointerLeave(tile);
    fireEvent.pointerUp(tile);
    click(tile);
    expect(onPress).not.toHaveBeenCalled();

    // A finger: up, then leave, then the click.
    press(tile);
    fireEvent.pointerUp(tile);
    fireEvent.pointerLeave(tile);
    click(tile);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('keeps a hold through the small shake of a finger', () => {
    const onLongPress = jest.fn();
    render(<Tile onPress={jest.fn()} onLongPress={onLongPress} />);
    const tile = screen.getByRole('button');

    press(tile, { clientX: 10, clientY: 10 });
    pointer(tile, 'pointermove', { clientX: 14, clientY: 13 });
    act(() => { jest.advanceTimersByTime(LONG_PRESS_MS); });
    fireEvent.pointerUp(tile);

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('gives a hold up when the browser takes the touch for a scroll, or the finger leaves the button', () => {
    const onLongPress = jest.fn();
    render(<Tile onPress={jest.fn()} onLongPress={onLongPress} />);
    const tile = screen.getByRole('button');

    press(tile);
    fireEvent.pointerCancel(tile);
    act(() => { jest.advanceTimersByTime(LONG_PRESS_MS); });
    fireEvent.pointerUp(tile);
    press(tile);
    act(() => { jest.advanceTimersByTime(LONG_PRESS_MS); });
    fireEvent.pointerLeave(tile);
    fireEvent.pointerUp(tile);

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('turns the system\'s own long press off on the button, and takes no hold from a right click', () => {
    const onLongPress = jest.fn();
    render(<Tile onPress={jest.fn()} onLongPress={onLongPress} />);
    const tile = screen.getByRole('button');

    expect(fireEvent.contextMenu(tile)).toBe(false);
    pointer(tile, 'pointerdown', { pointerType: 'mouse', button: 2 });
    expect(tile).toHaveAttribute('data-state', 'idle');
  });

  it('takes a key\'s click for a press even right after a press dragged off the button sent no click of its own', () => {
    const onPress = jest.fn();
    render(<Tile onPress={onPress} onLongPress={jest.fn()} />);
    const tile = screen.getByRole('button');

    press(tile, { clientX: 10, clientY: 10 });
    pointer(tile, 'pointermove', { clientX: 10, clientY: 60 });
    // Lifted outside the button: no click comes. Then Enter on it.
    fireEvent.click(tile, { detail: 0 });

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('takes a click long after a hold for a press again', () => {
    const onPress = jest.fn();
    render(<Tile onPress={onPress} onLongPress={jest.fn()} />);
    const tile = screen.getByRole('button');

    press(tile);
    act(() => { jest.advanceTimersByTime(LONG_PRESS_MS); });
    fireEvent.pointerUp(tile);
    act(() => { jest.advanceTimersByTime(1000); });
    click(tile);

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is an ordinary button without a long action: the press, and the system menu left alone', () => {
    const onPress = jest.fn();
    render(<Tile onPress={onPress} />);
    const tile = screen.getByRole('button');

    press(tile);
    act(() => { jest.advanceTimersByTime(LONG_PRESS_MS * 2); });
    click(tile);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(tile).toHaveAttribute('data-state', 'idle');
    expect(fireEvent.contextMenu(tile)).toBe(true);
  });
});

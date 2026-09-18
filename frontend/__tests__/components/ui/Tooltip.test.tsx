import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import Tooltip from '@/components/ui/Tooltip';

const BRIDGE_MS = 160;

const renderTooltip = () => render(
  <Tooltip content={<a href="/settings">Open plan settings</a>} hoverDelay={250}>
    <button type="button">usage</button>
  </Tooltip>
);

/**
 * A TOOLTIP THAT HOLDS A CONTROL HAS TO BE REACHABLE AND HAS TO LET GO.
 *
 * The panel is a DOM child of the wrapper, so hovering it still counts as hovering the
 * wrapper — but the eight pixels between them belong to neither, and closing on that crossing
 * made reaching for the control inside the very gesture that dismissed it. The cure is a short
 * delay, and the delay brings its own trap: if the dismissal is released while the hover flag
 * is still up, walking off a control just used inside the panel re-opens it.
 */
describe('Tooltip', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });

  it('survives the gap between trigger and panel long enough to be walked into', () => {
    renderTooltip();
    const wrapper = screen.getByRole('button', { name: 'usage' }).parentElement as HTMLElement;

    fireEvent.pointerEnter(wrapper);
    advance(250);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.pointerLeave(wrapper);
    advance(BRIDGE_MS - 20);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    // Landing inside the panel re-enters the wrapper subtree and calls the dismissal off.
    fireEvent.pointerEnter(wrapper);
    advance(BRIDGE_MS + 250);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open plan settings' })).toBeInTheDocument();
  });

  it('closes once the pointer is truly gone', () => {
    renderTooltip();
    const wrapper = screen.getByRole('button', { name: 'usage' }).parentElement as HTMLElement;

    fireEvent.pointerEnter(wrapper);
    advance(250);
    fireEvent.pointerLeave(wrapper);
    advance(BRIDGE_MS + 10);

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('does not flash back after the trigger is tapped shut and the pointer walks away', () => {
    renderTooltip();
    const wrapper = screen.getByRole('button', { name: 'usage' }).parentElement as HTMLElement;

    fireEvent.pointerEnter(wrapper);
    advance(250);
    fireEvent.click(wrapper);
    fireEvent.click(wrapper);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    // Leaving releases the dismissal. If that release lands before the hover flag falls, the
    // panel counts as merely hovered again and comes back for the length of the delay.
    fireEvent.pointerLeave(wrapper);
    advance(BRIDGE_MS - 20);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    advance(300);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('stays shut after a click inside it dismisses it, even while the pointer lingers', () => {
    renderTooltip();
    const wrapper = screen.getByRole('button', { name: 'usage' }).parentElement as HTMLElement;

    fireEvent.pointerEnter(wrapper);
    advance(250);
    fireEvent.click(screen.getByRole('link', { name: 'Open plan settings' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    // The panel it was standing on is gone, so the pointer now leaves the wrapper — which
    // must not be read as "the reader is done dismissing it, show it again".
    fireEvent.pointerLeave(wrapper);
    advance(BRIDGE_MS + 250);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

import { act, render, screen } from '@testing-library/react';
import React from 'react';

import { useWindowFittedPanel } from '@/hooks/useStickyOffsets';

function Panel({ top }: { top: number }) {
  const fit = useWindowFittedPanel(top, '--panel-max-h');
  return <div ref={fit} data-testid="panel" />;
}

describe('useWindowFittedPanel', () => {
  const placeAt = (element: HTMLElement, top: number) => {
    element.getBoundingClientRect = () => ({ top } as DOMRect);
  };

  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 });
  });

  it('keeps the whole panel inside the window, also before it sticks, and follows the scroll', async () => {
    const { rerender } = render(<Panel top={81} />);
    const panel = screen.getByTestId('panel');

    // Lower on the page than its sticky place: only what is left down to the window's bottom.
    placeAt(panel, 431);
    rerender(<Panel top={82} />); // a new top re-attaches the ref, which measures again
    expect(panel.style.getPropertyValue('--panel-max-h')).toBe(`${1000 - 431 - 16}px`);

    // Scrolled until it sticks under the nav: the height grows to the window minus nav and gaps.
    placeAt(panel, 82);
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(panel.style.getPropertyValue('--panel-max-h')).toBe(`${1000 - 82 - 16}px`);
  });

  it('never gives the panel more than the window has left, even on a short window', async () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 500 });
    render(<Panel top={81} />);
    const panel = screen.getByTestId('panel');
    placeAt(panel, 431);
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(panel.style.getPropertyValue('--panel-max-h')).toBe(`${500 - 431 - 16}px`);
  });

  it('watches what stands before the panel, so a growing description re-fits it even when the page height does not change', async () => {
    let onLayoutChange: () => void = () => undefined;
    const observed: Element[] = [];
    const original = (window as { ResizeObserver?: unknown }).ResizeObserver;
    (window as { ResizeObserver?: unknown }).ResizeObserver = class {
      constructor(callback: () => void) { onLayoutChange = callback; }
      observe = (target: Element) => observed.push(target);
      disconnect = jest.fn();
    };
    try {
      render(
        <main>
          <header data-testid="above">Description</header>
          <div className="grid">
            <div data-testid="left">Flow</div>
            <div><Panel top={81} /></div>
          </div>
        </main>
      );
      const panel = screen.getByTestId('panel');
      // The header above the grid and the column beside the panel are both watched.
      expect(observed).toEqual(expect.arrayContaining([screen.getByTestId('above'), screen.getByTestId('left'), document.body]));
      placeAt(panel, 631); // the description grew by 200 px; the left column shrank as much
      await act(async () => {
        onLayoutChange();
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      });
      expect(panel.style.getPropertyValue('--panel-max-h')).toBe(`${1000 - 631 - 16}px`);
    } finally {
      (window as { ResizeObserver?: unknown }).ResizeObserver = original;
    }
  });

  it('re-fits when a block is inserted above the columns later, even if something below shrinks as much', async () => {
    const observed: Element[] = [];
    const original = (window as { ResizeObserver?: unknown }).ResizeObserver;
    (window as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe = (target: Element) => observed.push(target);
      disconnect = jest.fn();
    };
    try {
      render(
        <main data-testid="main">
          <div className="grid" data-testid="grid">
            <div>Flow</div>
            <div><Panel top={81} /></div>
          </div>
          <footer>Footer</footer>
        </main>
      );
      const panel = screen.getByTestId('panel');
      const banner = document.createElement('div');
      placeAt(panel, 551); // a 120 px banner pushes the columns down; the footer shrank by 120 px
      await act(async () => {
        screen.getByTestId('main').insertBefore(banner, screen.getByTestId('grid'));
        await new Promise((resolve) => setTimeout(resolve, 0)); // the structure watcher reacts
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      });
      expect(panel.style.getPropertyValue('--panel-max-h')).toBe(`${1000 - 551 - 16}px`);
      expect(observed).toContain(banner); // and its later size changes are watched from now on
    } finally {
      (window as { ResizeObserver?: unknown }).ResizeObserver = original;
    }
  });

  it('lets go of blocks that left the page above it', async () => {
    const unobserved: Element[] = [];
    const original = (window as { ResizeObserver?: unknown }).ResizeObserver;
    (window as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe = jest.fn();
      unobserve = (target: Element) => unobserved.push(target);
      disconnect = jest.fn();
    };
    try {
      render(
        <main data-testid="main">
          <div data-testid="grid"><div><Panel top={81} /></div></div>
        </main>
      );
      const banners = [1, 2, 3].map(() => document.createElement('div'));
      for (const banner of banners) {
        await act(async () => {
          screen.getByTestId('main').insertBefore(banner, screen.getByTestId('grid'));
          await new Promise((resolve) => setTimeout(resolve, 0));
          banner.remove();
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      }
      expect(unobserved).toEqual(banners);
    } finally {
      (window as { ResizeObserver?: unknown }).ResizeObserver = original;
    }
  });

  it('stops listening and watching once the panel is gone', () => {
    const remove = jest.spyOn(window, 'removeEventListener');
    const disconnect = jest.fn();
    const original = (window as { ResizeObserver?: unknown }).ResizeObserver;
    const structureDisconnect = jest.spyOn(MutationObserver.prototype, 'disconnect');
    (window as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = disconnect;
    };
    try {
      const { unmount } = render(<Panel top={81} />);
      unmount();
      expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
      expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
      expect(disconnect).toHaveBeenCalled();
      expect(structureDisconnect).toHaveBeenCalled();
    } finally {
      (window as { ResizeObserver?: unknown }).ResizeObserver = original;
      remove.mockRestore();
      structureDisconnect.mockRestore();
    }
  });
});

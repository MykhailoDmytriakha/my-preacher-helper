import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';

import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useModalLayer } from '@/hooks/useModalLayer';
import '@testing-library/jest-dom';

import { applicationFiles } from '../architecture/firestoreBoundary';

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
    document.documentElement.style.overflow = '';
  });

  it('locks the page while it is on screen', () => {
    render(<Window name="one" onClose={jest.fn()} />);

    expect(document.documentElement.style.overflow).toBe('hidden');
  });

  it('gives the page back when it leaves', () => {
    const { unmount } = render(<Window name="one" onClose={jest.fn()} />);

    unmount();

    expect(document.documentElement.style.overflow).toBe('');
  });

  it('holds nothing while it is mounted but not shown', () => {
    render(<Window name="one" onClose={jest.fn()} active={false} />);

    expect(document.documentElement.style.overflow).toBe('');
  });

  it('keeps the page locked while a second window is still open', () => {
    const { rerender } = render(
      <>
        <Window name="one" onClose={jest.fn()} />
        <Window name="two" onClose={jest.fn()} />
      </>
    );

    rerender(<Window name="two" onClose={jest.fn()} />);

    expect(document.documentElement.style.overflow).toBe('hidden');
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

/*
 * A WINDOW KEEPS TAB INSIDE — the keyboard agrees with the eye (BUG-20261023-windows-let-tab-out: in 14 windows drawn on
 * this layer Tab walked out onto the page under them, and Enter there opened a second window). The layer keeps the
 * ring itself, so no window can forget it; a window whose ring is a panel inside its overlay names that panel.
 */
function TabWindow({ ring, onClose = jest.fn() }: { ring?: 'panel'; onClose?: () => void }) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const layer = useModalLayer({ onClose, focusRing: ring === 'panel' ? panelRef : undefined });
  return (
    <div {...layer}>
      <button type="button">backdrop action</button>
      <div ref={panelRef} role="dialog">
        <button type="button">first</button>
        <button type="button">middle</button>
        <button type="button">last</button>
      </div>
    </div>
  );
}

/** A screen that covers the application and keeps its own ring (the council's meeting). */
function Screen({ children }: { children?: React.ReactNode }) {
  const frame = React.useRef<HTMLDivElement>(null);
  useFocusTrap(frame);
  return (
    <div ref={frame}>
      <button type="button">screen first</button>
      <button type="button">screen last</button>
      {children}
    </div>
  );
}

const tab = (shift = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey: shift });
const button = (name: string) => screen.getByRole('button', { name });

describe('a modal layer keeps Tab inside', () => {
  afterEach(() => {
    document.documentElement.style.overflow = '';
  });

  it('turns Tab round at the window’s edges, with no trap of the window’s own', () => {
    render(<TabWindow />);
    button('last').focus();
    tab();
    expect(button('backdrop action')).toHaveFocus();
    tab(true);
    expect(button('last')).toHaveFocus();
  });

  it('brings focus that got out back in', () => {
    render(<><button type="button">page</button><TabWindow /></>);
    button('page').focus();
    tab();
    expect(button('backdrop action')).toHaveFocus();
  });

  it('turns round inside the panel a window names as its ring', () => {
    render(<TabWindow ring="panel" />);
    button('last').focus();
    tab();
    expect(button('first')).toHaveFocus();
    tab(true);
    expect(button('last')).toHaveFocus();
  });

  it('leaves out a control the browser does not show: a phone’s button hidden on a computer', () => {
    const shown = HTMLElement.prototype.checkVisibility;
    HTMLElement.prototype.checkVisibility = function (this: HTMLElement) { return this.textContent !== 'last'; };
    try {
      render(<TabWindow ring="panel" />);
      button('middle').focus();
      tab();
      expect(button('first')).toHaveFocus();
    } finally {
      HTMLElement.prototype.checkVisibility = shown;
    }
  });

  it('a screen with a ring of its own gives the keyboard to a window opened over it', () => {
    render(<Screen><TabWindow ring="panel" /></Screen>);
    button('last').focus();
    tab();
    expect(button('first')).toHaveFocus();
  });

  // Codex review 2026-10-27: a form's calendar, a question portalled out of a window, another library's dialog —
  // a surface of its own over the window keeps the keyboard; the window does not pull focus back from it.
  it('leaves Tab to a surface of its own opened over the window and portalled out of it', () => {
    // The calendar opens from a field of the window, after the window.
    function Form({ calendar }: { calendar: boolean }) {
      return (
        <>
          <TabWindow />
          {calendar && (
            <div role="dialog" aria-label="calendar">
              <button type="button">previous month</button>
              <button type="button">next month</button>
            </div>
          )}
        </>
      );
    }
    const view = render(<Form calendar={false} />);
    view.rerender(<Form calendar />);
    button('previous month').focus();
    tab();
    expect(button('previous month')).toHaveFocus();
  });

  // Codex review 2026-10-28: a menu of the page itself is no surface opened over the window.
  it('brings focus back from a menu of the page that stood there before the window opened', () => {
    function Page({ open }: { open: boolean }) {
      return (
        <>
          <div role="menu"><button type="button">page menu item</button></div>
          {open && <TabWindow ring="panel" />}
        </>
      );
    }
    const view = render(<Page open={false} />);
    view.rerender(<Page open />);
    button('page menu item').focus();
    tab();
    expect(button('first')).toHaveFocus();
  });

  it('still brings focus back from the page under the window', () => {
    render(<><button type="button">page</button><TabWindow ring="panel" /></>);
    button('page').focus();
    tab(true);
    expect(button('last')).toHaveFocus();
  });

  it('leaves out a control hidden by its style where the browser cannot say what it shows', () => {
    render(<TabWindow ring="panel" />);
    button('last').style.visibility = 'hidden';
    button('middle').focus();
    tab();
    expect(button('first')).toHaveFocus();
  });

  it('leaves out a control inside a part hidden by its style', () => {
    render(<TabWindow ring="panel" />);
    const last = button('last');
    const wrapper = document.createElement('span');
    wrapper.style.display = 'none';
    last.replaceWith(wrapper);
    wrapper.append(last);
    button('middle').focus();
    tab();
    expect(button('first')).toHaveFocus();
  });

  it('no part of the app keeps Tab with a trap of its own: the layer and useFocusTrap are the one rule', () => {
    const own = applicationFiles(join(__dirname, '../../app'))
      .filter((file) => !file.endsWith('hooks/useFocusTrap.ts'))
      .filter((file) => /key\s*[!=]==?\s*['"]Tab['"]/.test(readFileSync(file, 'utf8')));
    expect(own).toEqual([]);
  });
});

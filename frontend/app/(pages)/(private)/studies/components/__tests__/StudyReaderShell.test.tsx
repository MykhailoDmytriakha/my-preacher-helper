import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import StudyReaderShell from '../StudyReaderShell';

jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (node: React.ReactNode) => node,
}));

const offsetParentDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetParent'
);

const isHiddenBySelfOrAncestor = (element: HTMLElement): boolean => {
  const style = window.getComputedStyle(element);
  if (element.hidden || style.display === 'none') return true;

  return element.parentElement
    ? isHiddenBySelfOrAncestor(element.parentElement)
    : false;
};

const getMockOffsetParent = function getMockOffsetParent(this: HTMLElement): HTMLElement | null {
  if (!this.isConnected) return null;

  return isHiddenBySelfOrAncestor(this) ? null : document.body;
};

function renderShell(children: React.ReactNode) {
  return render(
    <StudyReaderShell
      isOpen
      onClose={jest.fn()}
      ariaLabel="Study reader"
    >
      {children}
    </StudyReaderShell>
  );
}

describe('StudyReaderShell', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get: getMockOffsetParent,
    });
  });

  afterAll(() => {
    if (offsetParentDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetParentDescriptor);
      return;
    }

    Reflect.deleteProperty(HTMLElement.prototype, 'offsetParent');
  });

  it('moves focus from the last focusable back to the first focusable on Tab', async () => {
    renderShell(
      <>
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </>
    );

    const firstAction = await screen.findByRole('button', { name: 'First action' });
    const lastAction = screen.getByRole('button', { name: 'Last action' });

    lastAction.focus();
    expect(lastAction).toHaveFocus();

    fireEvent.keyDown(lastAction, { key: 'Tab', code: 'Tab' });

    expect(firstAction).toHaveFocus();
  });

  it('moves focus from the first focusable back to the last focusable on Shift+Tab', async () => {
    renderShell(
      <>
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </>
    );

    const firstAction = await screen.findByRole('button', { name: 'First action' });
    const lastAction = screen.getByRole('button', { name: 'Last action' });

    firstAction.focus();
    expect(firstAction).toHaveFocus();

    fireEvent.keyDown(firstAction, { key: 'Tab', code: 'Tab', shiftKey: true });

    expect(lastAction).toHaveFocus();
  });

  it('keeps Tab as a no-op when the dialog has zero focusables', async () => {
    renderShell(<p>No tabbable controls here.</p>);

    const dialog = await screen.findByRole('dialog', { name: 'Study reader' });

    await waitFor(() => expect(dialog).toHaveFocus());

    fireEvent.keyDown(dialog, { key: 'Tab', code: 'Tab' });

    expect(dialog).toHaveFocus();
  });

  it('focuses the first visible focusable when mounted', async () => {
    renderShell(
      <>
        <button type="button" style={{ display: 'none' }}>
          Hidden action
        </button>
        <button type="button">First visible action</button>
        <button type="button">Second visible action</button>
      </>
    );

    const firstVisibleAction = await screen.findByRole('button', {
      name: 'First visible action',
    });

    await waitFor(() => expect(firstVisibleAction).toHaveFocus());
  });
});

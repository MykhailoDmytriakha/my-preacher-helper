import { fireEvent, render, screen } from '@testing-library/react';
import React, { useCallback, useState } from 'react';

import { installHistoryTimers, runHistoryAction } from '@test-utils/historyTasks';

import { useModalLayer } from '@/hooks/useModalLayer';

import '@testing-library/jest-dom';

installHistoryTimers(() => window.history.replaceState(null, '', '/'));

function seedPageHistory() {
  window.history.replaceState(null, '', '/dashboard');
  window.history.pushState(null, '', '/bible');
}

async function goBack() {
  await runHistoryAction(() => window.history.back());
}

function Layer({
  name,
  onClose,
  children,
  active = true,
  closeDisabled = false,
  zIndex = 1,
}: {
  name: string;
  onClose: () => void;
  children?: React.ReactNode;
  active?: boolean;
  closeDisabled?: boolean;
  zIndex?: number;
}) {
  const [open, setOpen] = useState(true);
  const close = useCallback(() => {
    onClose();
    setOpen(false);
  }, [onClose]);
  const layer = useModalLayer({ onClose: close, active: active && open, closeDisabled });

  if (!open) return null;
  return (
    <div
      {...layer}
      hidden={!active}
      role={active ? 'dialog' : undefined}
      aria-label={name}
      aria-modal={active ? 'true' : undefined}
      style={{ position: 'fixed', zIndex }}
    >
      {children}
    </div>
  );
}

function DirtyLayer({ onClose }: { onClose: () => void }) {
  const [open] = useState(true);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [words, setWords] = useState('Keep these words');
  const askBeforeClosing = useCallback(() => {
    onClose();
    setQuestionOpen(true);
  }, [onClose]);
  const parentLayer = useModalLayer({
    onClose: askBeforeClosing,
    active: open,
  });
  const questionLayer = useModalLayer({
    onClose: () => setQuestionOpen(false),
    active: open && questionOpen,
  });

  return (
    <>
      {open && (
        <div {...parentLayer} role="dialog" aria-modal="true" aria-label="Draft window" style={{ position: 'fixed', zIndex: 100 }}>
          <textarea aria-label="Draft" value={words} onChange={event => setWords(event.target.value)} />
        </div>
      )}
      {questionOpen && (
        <div {...questionLayer} role="alertdialog" aria-modal="true" aria-label="Unsaved changes" style={{ position: 'fixed', zIndex: 200 }}>
          <p>Keep or discard the draft?</p>
          <button type="button" onClick={() => setQuestionOpen(false)}>Cancel</button>
        </div>
      )}
    </>
  );
}

beforeEach(seedPageHistory);

describe('modal layers and browser Back', () => {
  it('closes one visible empty window on Back without leaving its page', async () => {
    const onClose = jest.fn();
    const view = render(<Layer name="Empty window" onClose={onClose} />);

    await goBack();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Empty window' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/bible');
    view.unmount();
  });

  it('asks before closing a dirty window and Cancel keeps its words and page', async () => {
    const onClose = jest.fn();
    const view = render(<DirtyLayer onClose={onClose} />);

    await goBack();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Keep these words');
    expect(window.location.pathname).toBe('/bible');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog', { name: 'Unsaved changes' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Draft window' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Keep these words');
    expect(window.location.pathname).toBe('/bible');
    view.unmount();
  });

  it('Back closes only the visual top layer when it mounted before its lower parent', async () => {
    const parentClosed = jest.fn();
    const topClosed = jest.fn();
    const topHost = document.createElement('div');
    const parentHost = document.createElement('div');
    document.body.append(topHost, parentHost);
    const top = render(<Layer name="Top question" onClose={topClosed} zIndex={200} />, { container: topHost });
    const parent = render(
      <Layer name="Parent window" onClose={parentClosed} zIndex={100}>
        <textarea aria-label="Parent draft" defaultValue="Parent words stay" />
      </Layer>,
      { container: parentHost },
    );

    try {
      expect(Number(getComputedStyle(screen.getByRole('dialog', { name: 'Top question' })).zIndex)).toBeGreaterThan(
        Number(getComputedStyle(screen.getByRole('dialog', { name: 'Parent window' })).zIndex),
      );

      await goBack();

      expect(topClosed).toHaveBeenCalledTimes(1);
      expect(parentClosed).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog', { name: 'Top question' })).not.toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Parent window' })).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Parent draft' })).toHaveValue('Parent words stay');
      expect(window.location.pathname).toBe('/bible');
    } finally {
      top.unmount();
      parent.unmount();
      topHost.remove();
      parentHost.remove();
    }
  });

  it('keeps the visible window and page when Back arrives while close is disabled', async () => {
    const onClose = jest.fn();
    const view = render(<Layer name="Saving window" onClose={onClose} closeDisabled />);

    await goBack();

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Saving window' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/bible');
    view.unmount();
  });

  it('still closes through Escape', () => {
    const onClose = jest.fn();
    const view = render(<Layer name="Escape window" onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Escape window' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/bible');
    view.unmount();
  });

  it('lets browser Back navigate while a mounted layer is inactive', async () => {
    const onClose = jest.fn();
    const view = render(<Layer name="Inactive window" onClose={onClose} active={false} />);

    await goBack();

    expect(onClose).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/dashboard');
    view.unmount();
  });
});

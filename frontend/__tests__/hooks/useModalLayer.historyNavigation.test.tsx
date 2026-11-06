import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

async function goForward() {
  await runHistoryAction(() => window.history.forward());
}

function Layer({
  name,
  onClose,
  children,
  active = true,
  closeDisabled = false,
}: {
  name: string;
  onClose: () => void;
  children?: React.ReactNode;
  active?: boolean;
  closeDisabled?: boolean;
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
  const parentLayer = useModalLayer({ onClose: askBeforeClosing, active: open });
  const questionLayer = useModalLayer({
    onClose: () => setQuestionOpen(false),
    active: open && questionOpen,
  });

  return (
    <>
      {open && (
        <div {...parentLayer} role="dialog" aria-modal="true" aria-label="Draft window">
          <textarea aria-label="Draft" value={words} onChange={event => setWords(event.target.value)} />
        </div>
      )}
      {questionOpen && (
        <div {...questionLayer} role="alertdialog" aria-modal="true" aria-label="Unsaved changes">
          <p>Keep or discard the draft?</p>
          <button type="button" onClick={() => setQuestionOpen(false)}>Cancel</button>
        </div>
      )}
    </>
  );
}

beforeEach(seedPageHistory);

describe('modal layer browser-history navigation', () => {
  it('uses the next Back for the previous real page after a clean window closes', async () => {
    const onClose = jest.fn();
    const view = render(<Layer name="Bible window" onClose={onClose} />);

    await goBack();

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog', { name: 'Bible window' })).not.toBeInTheDocument();
      expect(window.location.pathname).toBe('/bible');
    });

    await goBack();

    await waitFor(() => expect(window.location.pathname).toBe('/dashboard'));
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('returns Forward to the real page without restoring the closed window, then Back works again', async () => {
    const onClose = jest.fn();
    const view = render(<Layer name="Bible window" onClose={onClose} />);

    await goBack();
    await waitFor(() => expect(window.location.pathname).toBe('/bible'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Bible window' })).not.toBeInTheDocument();

    await goBack();
    await waitFor(() => expect(window.location.pathname).toBe('/dashboard'));

    await goForward();
    await waitFor(() => expect(window.location.pathname).toBe('/bible'));
    expect(screen.queryByRole('dialog', { name: 'Bible window' })).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);

    await goBack();
    await waitFor(() => expect(window.location.pathname).toBe('/dashboard'));
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('keeps dirty words through repeated Back and Cancel in the discard question', async () => {
    const onClose = jest.fn();
    const view = render(<DirtyLayer onClose={onClose} />);
    const draft = () => screen.getByRole('textbox', { name: 'Draft' });
    const question = () => screen.queryByRole('alertdialog', { name: 'Unsaved changes' });

    await goBack();
    await waitFor(() => expect(question()).toBeInTheDocument());
    expect(draft()).toHaveValue('Keep these words');
    expect(window.location.pathname).toBe('/bible');
    expect(onClose).toHaveBeenCalledTimes(1);

    await goBack();
    await waitFor(() => expect(question()).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Draft window' })).toBeInTheDocument();
    expect(draft()).toHaveValue('Keep these words');
    expect(window.location.pathname).toBe('/bible');
    expect(onClose).toHaveBeenCalledTimes(1);

    await goBack();
    await waitFor(() => expect(question()).toBeInTheDocument());
    expect(draft()).toHaveValue('Keep these words');
    expect(window.location.pathname).toBe('/bible');
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(question()).not.toBeInTheDocument());
    expect(draft()).toHaveValue('Keep these words');
    expect(window.location.pathname).toBe('/bible');

    await goBack();
    await waitFor(() => expect(question()).toBeInTheDocument());
    expect(draft()).toHaveValue('Keep these words');
    expect(window.location.pathname).toBe('/bible');
    expect(onClose).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(question()).not.toBeInTheDocument());
    expect(draft()).toHaveValue('Keep these words');
    expect(window.location.pathname).toBe('/bible');
    view.unmount();
  });

  it('uses the latest close policy and callback after rerender without leaving a phantom Back', async () => {
    const oldClose = jest.fn();
    const latestClose = jest.fn();
    const view = render(<Layer name="Saving window" onClose={oldClose} />);

    view.rerender(<Layer name="Saving window" onClose={latestClose} closeDisabled />);
    await goBack();

    expect(oldClose).not.toHaveBeenCalled();
    expect(latestClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Saving window' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/bible');

    view.rerender(<Layer name="Saving window" onClose={latestClose} />);
    await goBack();

    await waitFor(() => {
      expect(latestClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog', { name: 'Saving window' })).not.toBeInTheDocument();
      expect(window.location.pathname).toBe('/bible');
    });

    await goBack();
    await waitFor(() => expect(window.location.pathname).toBe('/dashboard'));
    expect(oldClose).not.toHaveBeenCalled();
    expect(latestClose).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('closes a persistent window at the pushed and replaced route before navigating back again', async () => {
    const onClose = jest.fn();
    const view = render(<Layer name="Persistent window" onClose={onClose} />);

    act(() => {
      const currentState = window.history.state;
      window.history.pushState(currentState, '', '/studies');
      window.history.replaceState(window.history.state, '', '/sermons');
    });
    expect(window.location.pathname).toBe('/sermons');
    expect(screen.getByRole('dialog', { name: 'Persistent window' })).toBeInTheDocument();

    await goBack();

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog', { name: 'Persistent window' })).not.toBeInTheDocument();
      expect(window.location.pathname).toBe('/sermons');
    });

    await goBack();
    await waitFor(() => expect(window.location.pathname).toBe('/bible'));
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('does not let an unmounted window intercept Back after a new route is pushed', async () => {
    const onClose = jest.fn();
    const view = render(<Layer name="Transient window" onClose={onClose} />);

    view.unmount();
    act(() => window.history.pushState(window.history.state, '', '/studies'));
    expect(window.location.pathname).toBe('/studies');

    await goBack();
    await waitFor(() => expect(window.location.pathname).toBe('/bible'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Transient window' })).not.toBeInTheDocument();

    await goBack();
    await waitFor(() => expect(window.location.pathname).toBe('/dashboard'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

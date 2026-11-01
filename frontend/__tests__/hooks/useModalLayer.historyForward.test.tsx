import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useCallback, useState } from 'react';

import '@testing-library/jest-dom';

type UseModalLayer = typeof import('@/hooks/useModalLayer').useModalLayer;
let useModalLayer: UseModalLayer;
let activePopstatePaths: string[] | null = null;
const capturePopstate = () => {
  if (activePopstatePaths) activePopstatePaths.push(window.location.pathname);
};
// Install before loading the hook: its shared history listener may consume the event.
window.addEventListener('popstate', capturePopstate, true);

function seedPageHistory() {
  window.history.replaceState(null, '', '/dashboard');
  window.history.pushState(null, '', '/bible');
}

function pushRoute(path: string) {
  window.history.pushState(window.history.state, '', path);
}

async function goBack() {
  await act(async () => {
    window.history.back();
    // jsdom dispatches popstate asynchronously; callers also wait for the visible result.
    await new Promise(resolve => setTimeout(resolve, 25));
  });
}

async function goForward() {
  await act(async () => {
    window.history.forward();
    await new Promise(resolve => setTimeout(resolve, 25));
  });
}

function LayerSurface({
  name,
  onClose,
  children,
  zIndex = 1,
}: {
  name: string;
  onClose: () => void;
  children?: React.ReactNode;
  zIndex?: number;
}) {
  const layer = useModalLayer({ onClose });
  return (
    <div
      {...layer}
      role="dialog"
      aria-modal="true"
      aria-label={name}
      style={{ position: 'fixed', zIndex }}
    >
      {children}
    </div>
  );
}

function ManagedLayer({
  name,
  onClose,
  children,
  zIndex = 1,
}: {
  name: string;
  onClose: () => void;
  children?: React.ReactNode;
  zIndex?: number;
}) {
  const [open, setOpen] = useState(true);
  const close = useCallback(() => {
    onClose();
    setOpen(false);
  }, [onClose]);
  return open ? <LayerSurface name={name} onClose={close} zIndex={zIndex}>{children}</LayerSurface> : null;
}

function WindowHost({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const close = useCallback(() => {
    onClose();
    setOpen(false);
  }, [onClose]);

  return (
    <>
      {open
        ? <LayerSurface name="Bible window" onClose={close} />
        : <button type="button" onClick={() => setOpen(true)}>Open window</button>}
    </>
  );
}

function DirtyWindow({ onClose, onDiscard }: { onClose: () => void; onDiscard: () => void }) {
  const [open, setOpen] = useState(true);
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
        <div {...parentLayer} role="dialog" aria-modal="true" aria-label="Dirty window">
          <textarea aria-label="Draft" value={words} onChange={event => setWords(event.target.value)} />
        </div>
      )}
      {questionOpen && (
        <div {...questionLayer} role="alertdialog" aria-modal="true" aria-label="Unsaved changes">
          <p>Keep or discard the draft?</p>
          <button type="button" onClick={() => setQuestionOpen(false)}>Cancel</button>
          <button type="button" onClick={() => {
            onDiscard();
            setQuestionOpen(false);
            setOpen(false);
          }}>Discard</button>
        </div>
      )}
    </>
  );
}

beforeEach(seedPageHistory);

beforeAll(async () => {
  ({ useModalLayer } = await import('@/hooks/useModalLayer'));
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

afterAll(() => {
  window.removeEventListener('popstate', capturePopstate, true);
});

describe('Forward traversal with modal layers', () => {
  it('Forward closes a fresh window on a guarded page, then reaches the next page without reopening it', async () => {
    const onClose = jest.fn();
    const view = render(<WindowHost onClose={onClose} />);

    await goBack();
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog', { name: 'Bible window' })).not.toBeInTheDocument();
      expect(window.location.pathname).toBe('/bible');
    });

    act(() => pushRoute('/studies'));
    await waitFor(() => expect(window.location.pathname).toBe('/studies'));
    await goBack();
    await waitFor(() => expect(window.location.pathname).toBe('/bible'));

    fireEvent.click(screen.getByRole('button', { name: 'Open window' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Bible window' })).toBeInTheDocument());

    await goForward();
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('dialog', { name: 'Bible window' })).not.toBeInTheDocument();
      expect(window.location.pathname).toBe('/bible');
    });

    await goForward();
    await waitFor(() => expect(window.location.pathname).toBe('/studies'));
    expect(screen.queryByRole('dialog', { name: 'Bible window' })).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(2);

    await goBack();
    await waitFor(() => expect(window.location.pathname).toBe('/bible'));
    expect(screen.queryByRole('dialog', { name: 'Bible window' })).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('Forward asks about dirty words, Cancel keeps them, and explicit discard lets Forward reach the next page', async () => {
    const onClose = jest.fn();
    const onDiscard = jest.fn();
    const clean = render(<WindowHost onClose={jest.fn()} />);

    await goBack();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Bible window' })).not.toBeInTheDocument());
    act(() => pushRoute('/studies'));
    await waitFor(() => expect(window.location.pathname).toBe('/studies'));
    await goBack();
    await waitFor(() => expect(window.location.pathname).toBe('/bible'));
    clean.unmount();

    const dirty = render(<DirtyWindow onClose={onClose} onDiscard={onDiscard} />);

    await goForward();
    await waitFor(() => expect(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Keep these words');
    expect(screen.getByRole('dialog', { name: 'Dirty window' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/bible');
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: 'Unsaved changes' })).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Keep these words');
    expect(window.location.pathname).toBe('/bible');

    await goForward();
    await waitFor(() => expect(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('Keep these words');
    expect(window.location.pathname).toBe('/bible');
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Dirty window' })).not.toBeInTheDocument());
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/bible');

    await goForward();
    await waitFor(() => expect(window.location.pathname).toBe('/studies'));
    expect(screen.queryByRole('alertdialog', { name: 'Unsaved changes' })).not.toBeInTheDocument();
    dirty.unmount();
  });

  it('two rapid Back calls close only the visual top layer and keep the current page', async () => {
    const parentClosed = jest.fn();
    const topClosed = jest.fn();
    const popstatePaths: string[] = [];
    activePopstatePaths = popstatePaths;

    const parent = render(
      <ManagedLayer name="Parent window" onClose={parentClosed} zIndex={100}>
        <textarea aria-label="Parent draft" defaultValue="Parent words stay" />
      </ManagedLayer>,
    );
    const top = render(<ManagedLayer name="Top question" onClose={topClosed} zIndex={200} />);

    try {
      await act(async () => {
        window.history.back();
        window.history.back();
        await new Promise(resolve => setTimeout(resolve, 50));
      });
      await waitFor(() => expect(popstatePaths.length).toBeGreaterThan(0));
      console.info(`Observed ${popstatePaths.length} popstate event(s) after two rapid Back calls: ${popstatePaths.join(', ')}`);
      await waitFor(() => {
        expect(topClosed).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog', { name: 'Top question' })).not.toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Parent window' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Parent draft' })).toHaveValue('Parent words stay');
        expect(window.location.pathname).toBe('/bible');
      });
      expect(parentClosed).not.toHaveBeenCalled();
    } finally {
      activePopstatePaths = null;
      top.unmount();
      parent.unmount();
    }
  });
});

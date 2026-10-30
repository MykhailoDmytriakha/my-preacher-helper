import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { useCallback, useRef, useState } from 'react';

import { MarkToolbar } from '@/components/bible/marks/MarkToolbar';
import { resetMarkToolForTests, useMarkTool } from '@/components/bible/marks/markTool';
import { useUndoShortcut } from '@/components/bible/analysis/useUndoShortcut';
import { useModalLayer } from '@/hooks/useModalLayer';

import '@testing-library/jest-dom';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { meaning?: string }) => options?.meaning ? `${key}:${options.meaning}` : key,
  }),
}));

function AnalysisWithExternalDialog() {
  const [analysisOpen, setAnalysisOpen] = useState(true);
  const [externalOpen, setExternalOpen] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const scope = useRef<HTMLDivElement>(null);
  const portalAction = useRef<HTMLButtonElement>(null);
  const tool = useMarkTool();
  const closeAnalysis = useCallback(() => setAnalysisOpen(false), []);
  const layer = useModalLayer({ onClose: closeAnalysis, active: analysisOpen });
  const undo = useCallback(() => setUndoCount(count => count + 1), []);
  useUndoShortcut(analysisOpen, undo, scope);

  if (!analysisOpen) return null;
  return (
    <>
      <div {...layer} role="dialog" aria-modal="true" aria-label="Passage analysis" style={{ zIndex: 100 }}>
        <div ref={scope}>
          <p>Analysis words remain here.</p>
          <MarkToolbar tool={tool} />
          <button type="button" onClick={() => setExternalOpen(true)}>Open external chooser</button>
          <button type="button" onClick={undo}>Undo analysis</button>
          <output data-testid="undo-count">{undoCount}</output>
        </div>
      </div>
      <Dialog open={externalOpen} onClose={() => setExternalOpen(false)} initialFocus={portalAction}>
        <DialogPanel style={{ zIndex: 300 }}>
          <DialogTitle>External chooser</DialogTitle>
          <button ref={portalAction} type="button">Portal action</button>
          <button type="button" onClick={() => setExternalOpen(false)}>Close chooser</button>
        </DialogPanel>
      </Dialog>
    </>
  );
}

function ToolbarWithoutRegisteredLayer() {
  const [externalOpen, setExternalOpen] = useState(false);
  const portalAction = useRef<HTMLButtonElement>(null);
  const tool = useMarkTool();
  return (
    <>
      <div>
        <MarkToolbar tool={tool} />
        <button type="button" onClick={() => setExternalOpen(true)}>Open unregistered chooser</button>
      </div>
      <Dialog open={externalOpen} onClose={() => setExternalOpen(false)} initialFocus={portalAction}>
        <DialogPanel style={{ zIndex: 300 }}>
          <DialogTitle>Unregistered external chooser</DialogTitle>
          <button ref={portalAction} type="button">Unregistered portal action</button>
          <button type="button" onClick={() => setExternalOpen(false)}>Close unregistered chooser</button>
        </DialogPanel>
      </Dialog>
    </>
  );
}

const markerButton = () => screen.getByRole('button', { name: /^bible\.marks\.marker/ });
const pressMarker = async (user: ReturnType<typeof userEvent.setup>) => {
  const marker = markerButton();
  if (marker.getAttribute('aria-pressed') !== 'true') await user.click(marker);
  expect(marker).toHaveAttribute('aria-pressed', 'true');
};

beforeEach(() => resetMarkToolForTests());
afterEach(() => cleanup());

describe('keyboard scope across a Headless UI portal', () => {
  it('spends keys on the external portal, then handles undo, tool Escape, and analysis Escape separately', async () => {
    const user = userEvent.setup();
    render(<AnalysisWithExternalDialog />);
    await pressMarker(user);
    const opener = screen.getByRole('button', { name: 'Open external chooser' });
    await user.click(opener);
    const portalAction = await screen.findByRole('button', { name: 'Portal action' });
    await waitFor(() => expect(portalAction).toHaveFocus());

    await user.keyboard('{Control>}z{/Control}');
    expect(screen.getByTestId('undo-count')).toHaveTextContent('0');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'External chooser' })).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
    expect(markerButton()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Analysis words remain here.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Passage analysis' })).toBeInTheDocument();

    await user.keyboard('{Control>}z{/Control}');
    expect(screen.getByTestId('undo-count')).toHaveTextContent('1');
    await user.keyboard('{Escape}');
    expect(markerButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('dialog', { name: 'Passage analysis' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Passage analysis' })).not.toBeInTheDocument());
  });

  it('keeps a tool in hand when Escape closes an external portal above a toolbar with no registered layer', async () => {
    const user = userEvent.setup();
    render(<ToolbarWithoutRegisteredLayer />);
    await pressMarker(user);
    await user.click(screen.getByRole('button', { name: 'Open unregistered chooser' }));
    const portalAction = await screen.findByRole('button', { name: 'Unregistered portal action' });
    await waitFor(() => expect(portalAction).toHaveFocus());

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Unregistered external chooser' })).not.toBeInTheDocument());
    expect(markerButton()).toHaveAttribute('aria-pressed', 'true');

    await user.keyboard('{Escape}');
    expect(markerButton()).toHaveAttribute('aria-pressed', 'false');
  });
});

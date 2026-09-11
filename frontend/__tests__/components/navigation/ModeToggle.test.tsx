import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import '@testing-library/jest-dom';
import ModeToggle, { type ModeToggleProps, type SermonMode } from '@/components/navigation/ModeToggle';

// Real portals preserve the Listbox context; the global portal mock creates a separate root.
jest.unmock('react-dom');

const props: ModeToggleProps = {
  currentMode: 'raw',
  onSetMode: jest.fn(),
  tSwitchToClassic: 'Switch to classic',
  tSwitchToPrep: 'Switch to preparation',
  tPrepLabel: 'Preparation',
  tClassicLabel: 'Classic',
  tRawLabel: 'Scratch notes',
};

function resize(width: number) {
  act(() => {
    window.innerWidth = width;
    window.dispatchEvent(new Event('resize'));
  });
}

function ControlledToggle({ canUsePrep = true }) {
  const [mode, setMode] = React.useState<SermonMode>('raw');
  return <ModeToggle {...props} currentMode={mode} onSetMode={setMode} canUsePrep={canUsePrep} />;
}

describe('ModeToggle compact menu', () => {
  const originalWidth = window.innerWidth;

  beforeEach(() => {
    jest.clearAllMocks();
    resize(390);
  });

  afterEach(() => resize(originalWidth));

  it('expands all modes, selects one, and collapses to the new current mode', async () => {
    const user = userEvent.setup();
    render(<ControlledToggle />);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Scratch notes' }));
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByRole('option', { name: 'Scratch notes' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('option', { name: 'Classic' }));
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Classic' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('dismisses with Escape and keeps unavailable preparation disabled', async () => {
    const user = userEvent.setup();
    render(<ControlledToggle canUsePrep={false} />);
    await user.click(screen.getByRole('button', { name: 'Scratch notes' }));
    expect(screen.getByRole('option', { name: 'Preparation beta' })).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Scratch notes' })).toHaveFocus();
  });

  it('preserves selection when resizing between menu and desktop segments', async () => {
    const user = userEvent.setup();
    render(<ControlledToggle />);
    resize(639);
    await user.click(screen.getByRole('button', { name: 'Scratch notes' }));
    resize(640);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scratch notes' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Classic' }));
    resize(390);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Classic' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('adapts to the space left by neighboring controls without losing selection', async () => {
    const user = userEvent.setup();
    const originalObserver = globalThis.ResizeObserver;
    const observations: { target: Element; callback: ResizeObserverCallback }[] = [];
    globalThis.ResizeObserver = class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) { observations.push({ target, callback: this.callback }); }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    resize(1280);
    const { container, unmount } = render(<ControlledToggle />);
    try {
      const wrapper = container.firstElementChild!;
      const observer = observations.find(({ target }) => target === wrapper)!;
      const setAvailableWidth = (width: number) => act(() => {
        Object.defineProperty(wrapper, 'clientWidth', { configurable: true, value: width });
        observer.callback([], {} as ResizeObserver);
      });
      setAvailableWidth(420);
      expect(screen.getAllByRole('button')).toHaveLength(1);
      await user.click(screen.getByRole('button', { name: 'Scratch notes' }));
      await user.click(screen.getByRole('option', { name: 'Classic' }));
      setAvailableWidth(560);
      expect(screen.getAllByRole('button')).toHaveLength(3);
      expect(screen.getByRole('button', { name: 'Classic' })).toHaveAttribute('aria-pressed', 'true');
      setAvailableWidth(420);
      expect(screen.getByRole('button', { name: 'Classic' })).toHaveAttribute('aria-haspopup', 'listbox');
    } finally {
      unmount();
      globalThis.ResizeObserver = originalObserver;
    }
  });

  it('supports keyboard selection and outside dismissal', async () => {
    const user = userEvent.setup();
    render(<><ControlledToggle /><button>Outside</button></>);
    await user.click(screen.getByRole('button', { name: 'Scratch notes' }));
    await user.keyboard('{ArrowUp}{Enter}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Classic' }));
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Classic' })).toBeInTheDocument();
  });
});

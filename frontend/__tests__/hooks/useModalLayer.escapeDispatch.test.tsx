import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { flushSync } from 'react-dom';
import { useCallback, useState } from 'react';

import { useModalLayer } from '@/hooks/useModalLayer';

import '@testing-library/jest-dom';

type CloseOptions = { closeDisabled?: boolean; closeOnEscape?: boolean; consumeEscapeLocally?: boolean };

function ParentLayer({ onClosed }: { onClosed: () => void }) {
  const [open, setOpen] = useState(true);
  const close = useCallback(() => {
    onClosed();
    setOpen(false);
  }, [onClosed]);
  const layer = useModalLayer({ onClose: close, active: open });
  if (!open) return null;
  return (
    <div {...layer} role="dialog" aria-modal="true" aria-label="Parent window" style={{ zIndex: 100 }}>
      <textarea aria-label="Parent draft" defaultValue="Keep these words" />
    </div>
  );
}

function ChildLayer({ onClosed, options = {} }: { onClosed: () => void; options?: CloseOptions }) {
  const [open, setOpen] = useState(true);
  const close = useCallback(() => {
    onClosed();
    // Model the native close commit before a later listener on the same window receives this key.
    flushSync(() => setOpen(false));
  }, [onClosed]);
  const layer = useModalLayer({
    onClose: close,
    active: open,
    closeDisabled: options.closeDisabled,
    closeOnEscape: options.closeOnEscape,
  });
  if (!open) return null;
  return (
    <div {...layer} role="dialog" aria-modal="true" aria-label="Child window" style={{ zIndex: 200 }}>
      <input
        aria-label="Child field"
        onKeyDown={event => {
          if (options.consumeEscapeLocally && event.key === 'Escape') event.stopPropagation();
        }}
      />
    </div>
  );
}

/** Separate roots control native listener order; z-index controls the independent visual order. */
function mountPair(order: 'child-first' | 'parent-first', options?: CloseOptions) {
  const parentClosed = jest.fn();
  const childClosed = jest.fn();
  const parentHost = document.createElement('div');
  const childHost = document.createElement('div');
  document.body.append(parentHost, childHost);
  let parent: { unmount: () => void } | undefined;
  let child: { unmount: () => void } | undefined;

  if (order === 'child-first') {
    child = render(<ChildLayer onClosed={childClosed} options={options} />, { container: childHost });
    parent = render(<ParentLayer onClosed={parentClosed} />, { container: parentHost });
  } else {
    parent = render(<ParentLayer onClosed={parentClosed} />, { container: parentHost });
    screen.getByRole('textbox', { name: 'Parent draft' }).focus();
    child = render(<ChildLayer onClosed={childClosed} options={options} />, { container: childHost });
  }

  const teardown = () => {
    child?.unmount();
    parent?.unmount();
    parentHost.remove();
    childHost.remove();
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  };
  return { childClosed, parentClosed, teardown };
}

describe('nested modal Escape dispatch', () => {
  afterEach(() => {
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  });

  it.each([
    ['focused child control', 'child-control'],
    ['document', 'document'],
    ['window', 'window'],
  ] as const)('closes only the visually topmost layer on one Escape dispatched at %s', async (_label, target) => {
    const pair = mountPair('child-first');
    try {
      const parentDialog = screen.getByRole('dialog', { name: 'Parent window' });
      const childDialog = screen.getByRole('dialog', { name: 'Child window' });
      expect(Number(getComputedStyle(parentDialog).zIndex)).toBe(100);
      expect(Number(getComputedStyle(childDialog).zIndex)).toBe(200);
      expect(childDialog.contains(document.activeElement)).toBe(true);

      if (target === 'child-control') fireEvent.keyDown(screen.getByRole('textbox', { name: 'Child field' }), { key: 'Escape' });
      if (target === 'document') fireEvent.keyDown(document, { key: 'Escape' });
      if (target === 'window') fireEvent.keyDown(window, { key: 'Escape' });

      expect(pair.childClosed).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog', { name: 'Child window' })).not.toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Parent window' })).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Parent draft' })).toHaveValue('Keep these words');
      expect(pair.parentClosed).not.toHaveBeenCalled();

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => expect(pair.parentClosed).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('dialog', { name: 'Parent window' })).not.toBeInTheDocument();
    } finally {
      pair.teardown();
    }
  });

  it('keeps the parent after Escape when its listener runs before the child listener', () => {
    const pair = mountPair('parent-first');
    try {
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(pair.childClosed).toHaveBeenCalledTimes(1);
      expect(pair.parentClosed).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'Parent window' })).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Parent draft' })).toHaveValue('Keep these words');
    } finally {
      pair.teardown();
    }
  });

  it.each([
    ['disabled top layer', { closeDisabled: true }],
    ['top layer with Escape disabled', { closeOnEscape: false }],
    ['Escape consumed by a child control', { consumeEscapeLocally: true }],
  ] as const)('does not close the parent when Escape is unavailable to the child: %s', (_label, options) => {
    const settings: CloseOptions = options;
    const pair = mountPair('child-first', settings);
    try {
      if (settings.consumeEscapeLocally) {
        fireEvent.keyDown(screen.getByRole('textbox', { name: 'Child field' }), { key: 'Escape' });
      } else {
        fireEvent.keyDown(document, { key: 'Escape' });
      }
      expect(pair.childClosed).not.toHaveBeenCalled();
      expect(pair.parentClosed).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'Child window' })).toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Parent window' })).toBeInTheDocument();
    } finally {
      pair.teardown();
    }
  });

  it('does not treat Enter as Escape', () => {
    const pair = mountPair('child-first');
    try {
      fireEvent.keyDown(document, { key: 'Enter' });
      expect(pair.childClosed).not.toHaveBeenCalled();
      expect(pair.parentClosed).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'Child window' })).toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Parent window' })).toBeInTheDocument();
    } finally {
      pair.teardown();
    }
  });
});

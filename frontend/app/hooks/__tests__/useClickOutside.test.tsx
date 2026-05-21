import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';

import { useClickOutside } from '../useClickOutside';

interface ClickOutsideHarnessProps {
  handler: () => void;
  enabled?: boolean;
  capture?: boolean;
  event?: 'mousedown' | 'click';
  stopOutsideMouseDown?: boolean;
}

function ClickOutsideHarness({
  handler,
  enabled = true,
  capture = false,
  event = 'mousedown',
  stopOutsideMouseDown = false,
}: ClickOutsideHarnessProps) {
  const insideRef = useRef<HTMLDivElement>(null);

  useClickOutside([insideRef], handler, { enabled, capture, event });

  return (
    <div>
      <div ref={insideRef}>
        <button type="button">Inside</button>
      </div>
      <button
        type="button"
        onMouseDown={(mouseEvent) => {
          if (stopOutsideMouseDown) {
            mouseEvent.stopPropagation();
          }
        }}
      >
        Outside
      </button>
    </div>
  );
}

function MultiRefHarness({ handler }: { handler: () => void }) {
  const firstRef = useRef<HTMLDivElement>(null);
  const secondRef = useRef<HTMLDivElement>(null);

  useClickOutside([firstRef, secondRef], handler);

  return (
    <div>
      <div ref={firstRef}>
        <button type="button">Inside first</button>
      </div>
      <div ref={secondRef}>
        <button type="button">Inside second</button>
      </div>
      <button type="button">Outside</button>
    </div>
  );
}

function countDocumentCalls(
  spy: jest.SpyInstance,
  eventName: 'mousedown' | 'click'
): number {
  return spy.mock.calls.filter(([type]) => type === eventName).length;
}

describe('useClickOutside', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not call the handler when clicking inside the ref', () => {
    const handler = jest.fn();

    render(<ClickOutsideHarness handler={handler} />);

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Inside' }));

    expect(handler).not.toHaveBeenCalled();
  });

  it('calls the handler when clicking outside the ref', () => {
    const handler = jest.fn();

    render(<ClickOutsideHarness handler={handler} />);

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not attach a document listener when disabled', () => {
    const addListenerSpy = jest.spyOn(document, 'addEventListener');
    const handler = jest.fn();

    render(<ClickOutsideHarness handler={handler} enabled={false} />);

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));

    expect(countDocumentCalls(addListenerSpy, 'mousedown')).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it('handles outside clicks during the capture phase', () => {
    const handler = jest.fn();

    render(
      <ClickOutsideHarness
        handler={handler}
        capture
        stopOutsideMouseDown
      />
    );

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('skips the handler when any provided ref contains the target', () => {
    const handler = jest.fn();

    render(<MultiRefHarness handler={handler} />);

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Inside first' }));
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Inside second' }));

    expect(handler).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('keeps one listener across handler-only rerenders and calls the latest handler', () => {
    const addListenerSpy = jest.spyOn(document, 'addEventListener');
    const removeListenerSpy = jest.spyOn(document, 'removeEventListener');
    const firstHandler = jest.fn();
    const secondHandler = jest.fn();

    const { rerender, unmount } = render(<ClickOutsideHarness handler={firstHandler} />);
    const initialAdds = countDocumentCalls(addListenerSpy, 'mousedown');

    rerender(<ClickOutsideHarness handler={secondHandler} />);

    expect(countDocumentCalls(addListenerSpy, 'mousedown')).toBe(initialAdds);
    expect(countDocumentCalls(removeListenerSpy, 'mousedown')).toBe(0);

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));

    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledTimes(1);

    unmount();

    expect(countDocumentCalls(removeListenerSpy, 'mousedown')).toBe(1);
  });
});

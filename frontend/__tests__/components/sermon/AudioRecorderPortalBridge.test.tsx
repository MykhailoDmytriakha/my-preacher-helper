import { render, screen } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';

import AudioRecorderPortalBridge from '@/components/sermon/AudioRecorderPortalBridge';

describe('AudioRecorderPortalBridge', () => {
  const RecorderMock = ({ splitLeft, disabled }: { splitLeft?: React.ReactNode; disabled?: boolean }) => (
    <div>
      <div data-testid="recorder-disabled">{String(Boolean(disabled))}</div>
      {splitLeft}
    </div>
  );

  const commonProps = {
    RecorderComponent: RecorderMock,
    portalTarget: null as HTMLDivElement | null,
    onRecordingComplete: jest.fn(),
    isProcessing: false,
    onRetry: jest.fn(),
    retryCount: 0,
    maxRetries: 3,
    transcriptionError: null,
    onClearError: jest.fn(),
    hideKeyboardShortcuts: false,
    onOpenCreateModal: jest.fn(),
    manualThoughtTitle: 'Add manual thought',
  };

  it('keeps split button visible but disabled in read-only mode and disables recorder start side', () => {
    render(
      <AudioRecorderPortalBridge
        {...commonProps}
        isReadOnly
      />
    );

    expect(screen.getByTestId('recorder-disabled')).toHaveTextContent('true');
    expect(screen.getByTitle('Add manual thought')).toBeDisabled();
  });

  it('keeps split button enabled in writable mode and recorder remains enabled', () => {
    render(
      <AudioRecorderPortalBridge
        {...commonProps}
        isReadOnly={false}
      />
    );

    expect(screen.getByTestId('recorder-disabled')).toHaveTextContent('false');
    expect(screen.getByTitle('Add manual thought')).toBeEnabled();
  });

  it('renders into portal target and reacts to ResizeObserver updates', () => {
    const portalTarget = document.createElement('div');
    document.body.appendChild(portalTarget);

    const disconnect = jest.fn();
    const observe = jest.fn((element: Element) => {
      expect(element).toBeInstanceOf(HTMLDivElement);
      observerCallback?.([{ contentRect: { height: 222 } } as ResizeObserverEntry], {} as ResizeObserver);
    });
    let observerCallback:
      | ((entries: ResizeObserverEntry[], observer: ResizeObserver) => void)
      | null = null;

    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: jest.fn().mockImplementation((cb: (entries: ResizeObserverEntry[], observer: ResizeObserver) => void) => {
        observerCallback = cb;
        return { observe, disconnect };
      }),
    });

    const { unmount } = render(
      <AudioRecorderPortalBridge
        {...commonProps}
        portalTarget={portalTarget}
        isReadOnly={false}
      />
    );

    expect(portalTarget).toHaveTextContent('false');
    expect(observe).toHaveBeenCalled();

    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});

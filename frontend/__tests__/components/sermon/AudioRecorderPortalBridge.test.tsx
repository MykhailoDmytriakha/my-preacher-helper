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
});

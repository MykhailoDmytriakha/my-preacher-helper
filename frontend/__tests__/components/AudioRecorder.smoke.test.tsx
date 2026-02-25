import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';
import { AudioRecorder } from '@components/AudioRecorder';

// Minimal mocks for external deps that might crash JSDOM
jest.mock('lucide-react', () => ({
    Mic: () => <div data-testid="mic-icon" />,
    Square: () => <div data-testid="square-icon" />,
    X: () => <div data-testid="x-icon" />,
    Pause: () => <div data-testid="pause-icon" />,
    Play: () => <div data-testid="play-icon" />,
    RotateCcw: () => <div data-testid="rotate-icon" />,
    AlertCircle: () => <div data-testid="alert-icon" />,
}));

// Mock i18next
jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

// Mock browser APIs that are not in JSDOM
const mockMediaRecorder = {
    start: jest.fn(),
    stop: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    state: 'inactive'
};

Object.defineProperty(global.navigator, 'mediaDevices', {
    value: {
        getUserMedia: jest.fn().mockResolvedValue({
            getTracks: () => [{ stop: jest.fn() }]
        })
    },
    configurable: true
});

Object.defineProperty(global, 'MediaRecorder', {
    value: jest.fn().mockImplementation(() => mockMediaRecorder),
    configurable: true
});
(global.MediaRecorder as any).isTypeSupported = jest.fn().mockReturnValue(true);

describe('AudioRecorder - Smoke Test for Logic changes', () => {
    it('verifies attribute removals in StandardRecordingControls', async () => {
        render(
            <AudioRecorder
                onRecordingComplete={jest.fn()}
                variant="standard"
            />
        );

        // 1. Initial button (MainRecordButton) - Still HAS title (expected)
        const mainButton = screen.getByRole('button');
        expect(mainButton).toHaveAttribute('title');

        // 2. Start recording to show StandardRecordingControls
        fireEvent.click(mainButton);

        await waitFor(() => {
            expect(screen.getByText('audio.pauseRecording')).toBeInTheDocument();
        });

        const pauseButton = screen.getByText('audio.pauseRecording').closest('button');
        const cancelButton = screen.getByText('audio.cancelRecording').closest('button');

        // Verify attributes were removed in these specific buttons
        expect(pauseButton).not.toHaveAttribute('title');
        expect(pauseButton).not.toHaveClass('focus:ring-offset-2');

        expect(cancelButton).not.toHaveAttribute('title');
        // Note: Cancel button still has focus:ring-offset-2 in line 312 of AudioRecorder.tsx
        // The user's diff ONLY showed removal from pauseButton (line 299) and cancellation of title for both.

        // Re-check diff:
        // line 299: focus:ring-offset-2 removed
        // line 301 (pause button title): removed
        // line 315 (cancel button title): removed

        expect(cancelButton).not.toHaveAttribute('title');
    });
});

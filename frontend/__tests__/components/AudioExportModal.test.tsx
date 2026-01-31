import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

import AudioExportModal from '@components/AudioExportModal';

// --- Mocks --- //
jest.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, options: any) => options?.defaultValue || key }),
}));

// Mock StepByStepWizard
jest.mock('@components/audio/StepByStepWizard', () => (props: any) => {
    // Capture to trigger state changes from tests
    return (
        <div data-testid="step-by-step-wizard">
            Mock Wizard
            <button onClick={() => props.onGeneratingChange(true)}>Start Generating</button>
            <button onClick={() => props.onGeneratingChange(false)}>Stop Generating</button>
        </div>
    );
});

describe('AudioExportModal', () => {
    const defaultProps = {
        isOpen: true,
        onClose: jest.fn(),
        sermonId: 'sermon-123',
        sermonTitle: 'Test Sermon',
        isEnabled: true
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('does not render when isOpen is false', () => {
        render(<AudioExportModal {...defaultProps} isOpen={false} />);
        expect(screen.queryByText('Audio Generation')).not.toBeInTheDocument();
    });

    it('renders correctly when isOpen is true', () => {
        render(<AudioExportModal {...defaultProps} />);
        expect(screen.getByText('Audio Generation')).toBeInTheDocument();
        expect(screen.getByTestId('step-by-step-wizard')).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', () => {
        render(<AudioExportModal {...defaultProps} />);
        // Find close button (it has an SVG, let's look for button role)
        const closeButtons = screen.getAllByRole('button');
        // The modal has a close button in the header. 
        // Our mock wizard also has buttons, so we need to be specific or find the header button.
        // The header button has an SVG path.
        // Let's rely on the fact it's likely the first button or select by selector if possible.
        // Actually, the close button is in the header, usually first.
        fireEvent.click(closeButtons[0]);
        expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose when clicking overlay', () => {
        render(<AudioExportModal {...defaultProps} />);
        // The outer div is the overlay. We can find it by class or assuming it's the first div?
        // Let's retry finding by class name logic isn't great in tests.
        // We can add a data-testid to the overlay in the component or assume structure.
        // Better: let's modify the component to have a test id for overlay if needed, 
        // but let's try to click the first child of document body or something?
        // Actually, render returns the container.
        const overlay = screen.getByText('Audio Generation').closest('.fixed');
        fireEvent.click(overlay!);
        expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('prevents closing when generating', () => {
        render(<AudioExportModal {...defaultProps} />);

        // Start generating via mock wizard
        fireEvent.click(screen.getByText('Start Generating'));

        // Try to close via button
        const closeButtons = screen.getAllByRole('button');
        fireEvent.click(closeButtons[0]);
        expect(defaultProps.onClose).not.toHaveBeenCalled();

        // Try to close via overlay
        const overlay = screen.getByText('Audio Generation').closest('.fixed');
        fireEvent.click(overlay!);
        expect(defaultProps.onClose).not.toHaveBeenCalled();

        // Stop generating
        fireEvent.click(screen.getByText('Stop Generating'));

        // Now close should work
        fireEvent.click(closeButtons[0]);
        expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });
});

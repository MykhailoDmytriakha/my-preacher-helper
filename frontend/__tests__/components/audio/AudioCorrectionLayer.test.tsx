import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import '@testing-library/jest-dom';

jest.unmock('react-dom');

import AudioExportModal from '@/components/AudioExportModal';

let mockEditorSave: jest.Mock;

jest.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

jest.mock('@/components/audio/StepByStepWizard', () => {
    const React = require('react');
    const ChunkEditorModal = jest.requireActual('@/components/audio/ChunkEditorModal').default;
    return function StepByStepWizardWithRealChunkEditor({ onClose }: { onClose: () => void }) {
        return React.createElement(ChunkEditorModal, {
            chunk: { index: 0, text: 'Saved speech' },
            onSave: (index: number, text: string) => mockEditorSave(index, text),
            onClose,
        });
    };
});

function ParentHarness({ onClose }: { onClose: jest.Mock }) {
    const [open, setOpen] = useState(true);
    return <AudioExportModal isOpen={open} onClose={() => { onClose(); setOpen(false); }} sermonId="sermon-1" sermonTitle="Test sermon" />;
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(accept => { resolve = accept; });
    return { promise, resolve };
}

const layerStyles = document.createElement('style');
layerStyles.textContent = `
    [data-modal-layer] { position: fixed !important; z-index: 50 !important; }
    [data-testid="modal-overlay"] { z-index: 100 !important; }
    [data-modal-layer][class*="z-[110]"] { z-index: 110 !important; }
    [data-modal-layer][class*="z-[300]"] { z-index: 300 !important; }
`;
document.head.appendChild(layerStyles);

beforeEach(() => {
    jest.clearAllMocks();
});

afterAll(() => layerStyles.remove());

it('keeps Escape inside the pending correction editor instead of closing its parent audio modal', async () => {
    const save = deferred();
    mockEditorSave = jest.fn(() => save.promise);
    const onClose = jest.fn();
    render(<ParentHarness onClose={onClose} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Exact corrected speech' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockEditorSave).toHaveBeenCalledWith(0, 'Exact corrected speech'));

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('Exact corrected speech');
    expect(screen.getByTestId('modal-overlay')).toBeInTheDocument();
    await act(async () => { save.resolve(); await save.promise; });
});

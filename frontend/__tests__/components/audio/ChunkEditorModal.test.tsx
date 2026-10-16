import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React, { useState } from 'react';
import '@testing-library/jest-dom';

import ChunkEditorModal from '@/components/audio/ChunkEditorModal';
import type { SpeechCorrectionConflict } from '@/hooks/usePreparedSpeech';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

const chunk = { index: 0, text: 'Saved speech' };

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
    return { promise, resolve, reject };
}

function EditorHarness({ onSave, onClose }: { onSave: (index: number, text: string) => Promise<void>; onClose: jest.Mock }) {
    const [open, setOpen] = useState(true);
    return open
        ? <ChunkEditorModal chunk={chunk} onSave={onSave} onClose={() => { onClose(); setOpen(false); }} />
        : <p>Editor closed</p>;
}

function requestClose(route: 'X' | 'Cancel' | 'backdrop' | 'Escape', editor: HTMLElement) {
    if (route === 'X') fireEvent.click(within(editor).getAllByRole('button')[0]);
    else if (route === 'Cancel') fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }));
    else if (route === 'backdrop') fireEvent.click(editor);
    else fireEvent.keyDown(window, { key: 'Escape' });
}

it.each(['X', 'backdrop', 'Escape'] as const)('keeps the editor open and text intact when %s is attempted during a pending save', async route => {
    const save = deferred<void>();
    const onSave = jest.fn(() => save.promise);
    const onClose = jest.fn();
    render(<EditorHarness onSave={onSave} onClose={onClose} />);
    const editor = screen.getByRole('dialog');
    const input = within(editor).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Unsaved speech to keep' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(0, 'Unsaved speech to keep'));

    requestClose(route, editor);

    expect(onClose).not.toHaveBeenCalled();
    expect(input).toHaveValue('Unsaved speech to keep');
    expect(input).toBeDisabled();
    await act(async () => { save.resolve(); await save.promise; });
});

it.each(['X', 'Cancel', 'backdrop', 'Escape'] as const)('asks before discarding dirty text through %s, keeps on decline, and closes once on confirm', async route => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    render(<EditorHarness onSave={onSave} onClose={onClose} />);
    let editor = screen.getByRole('dialog');
    const input = within(editor).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Exact draft words' } });

    requestClose(route, editor);
    const keep = await screen.findByRole('button', { name: 'common.discardChanges.keep' });
    fireEvent.click(keep);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'common.discardChanges.keep' })).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
    expect(input).toHaveValue('Exact draft words');

    editor = screen.getByRole('dialog');
    requestClose(route, editor);
    fireEvent.click(await screen.findByRole('button', { name: 'common.discardChanges.confirm' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('Editor closed')).toBeInTheDocument();
});

it('closes an unchanged editor immediately without asking to discard', () => {
    const onClose = jest.fn();
    render(<EditorHarness onSave={jest.fn().mockResolvedValue(undefined)} onClose={onClose} />);
    const editor = screen.getByRole('dialog');

    requestClose('X', editor);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'common.discardChanges.confirm' })).not.toBeInTheDocument();
});

it('retains the edited words and stays open after a save refusal', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('Save was refused'));
    const onClose = jest.fn();
    render(<EditorHarness onSave={onSave} onClose={onClose} />);
    const editor = screen.getByRole('dialog');
    const input = within(editor).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Words that failed to save' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Save was refused')).toBeInTheDocument();
    expect(input).toHaveValue('Words that failed to save');
    expect(onClose).not.toHaveBeenCalled();
});

it('shows a correction resolution refusal while retaining the conflict and candidate text', async () => {
    const conflict: SpeechCorrectionConflict = {
        id: 'conflict-1', targetIndex: 0,
        source: { id: 'source-1', revision: 2, sections: ['introduction'], chunks: [{ index: 0, sectionId: 'introduction', text: 'Current stored words', createdAt: '2026-10-16' }] },
    };
    const onResolve = jest.fn().mockRejectedValue(new Error('Network unavailable'));
    const onClose = jest.fn();
    render(<ChunkEditorModal chunk={{ index: 0, text: 'My preserved candidate' }} onSave={jest.fn().mockResolvedValue(undefined)}
        onClose={onClose} conflict={conflict} onResolve={onResolve} onUseStored={jest.fn(() => ({ text: 'Current stored words' }))} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save my text' }));

    expect(onResolve).toHaveBeenCalledWith(conflict, 0, 'My preserved candidate');
    expect(await screen.findByText('Network unavailable')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The saved text changed. Your correction is still here.');
    expect(screen.getByRole('textbox')).toHaveValue('My preserved candidate');
    expect(onClose).not.toHaveBeenCalled();
});

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import CreateThoughtModal from '@/components/CreateThoughtModal';
import { persistedWrite, queuedWrite } from '@/utils/recoverableWrite';
import { UsageCapReachedError } from '@/services/usageLimits';
import { transcribeAudioWithRetry } from '@/utils/transcriptionRetryClient';

// Mock RichMarkdownEditor with a textarea shim (TipTap doesn't work in JSDOM)
jest.mock('@components/ui/RichMarkdownEditor', () => ({
    RichMarkdownEditor: ({ value, onChange, placeholder }: any) => (
        <textarea
            data-testid="mock-rich-editor"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
        />
    ),
}));

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

jest.mock('sonner', () => ({
    toast: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('@/hooks/useScrollLock', () => ({
    useScrollLock: jest.fn(),
}));

const mockUseConnection = jest.fn(() => ({ isOnline: true, isMagicAvailable: true, checkConnection: jest.fn() }));
jest.mock('@/providers/ConnectionProvider', () => ({
  useConnection: () => mockUseConnection(),
  ConnectionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('@services/thought.service', () => ({
    transcribeThoughtAudio: jest.fn(),
}));

jest.mock('@components/FocusRecorderButton', () => ({
    FocusRecorderButton: ({ disabled, onError, onRecordingComplete, onRetry, transcriptionError }: any) => (
        <div>
            <button
                data-testid="focus-recorder"
                disabled={disabled}
                onClick={() => onRecordingComplete?.(new Blob(['audio'], { type: 'audio/webm' }))}
            >
                Record
            </button>
            <button
                data-testid="focus-recorder-error"
                disabled={disabled}
                onClick={() => onError?.('Recorder failed')}
            >
                Recorder Error
            </button>
            <button data-testid="focus-recorder-retry" onClick={() => onRetry?.()}>Retry</button>
            {transcriptionError ? <span>{transcriptionError}</span> : null}
        </div>
    ),
}));

jest.mock('@/utils/transcriptionRetryClient', () => {
    const actual = jest.requireActual('@/utils/transcriptionRetryClient');
    return {
        ...actual,
        transcribeAudioWithRetry: jest.fn(),
    };
});

jest.mock('@utils/tagUtils', () => ({
    isStructureTag: jest.fn(() => false),
    getStructureIcon: jest.fn(() => null),
    getTagStyle: jest.fn(() => ({ bg: '', text: '', border: '' })),
    normalizeStructureTag: jest.fn(() => null),
}));

import { toast } from 'sonner';

const mockTranscribeAudioWithRetry = transcribeAudioWithRetry as jest.MockedFunction<typeof transcribeAudioWithRetry>;

const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    sermonId: 'sermon-1',
    onCreateThought: jest.fn(),
    allowedTags: [],
};

describe('CreateThoughtModal', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders the modal when isOpen is true', () => {
        render(<CreateThoughtModal {...defaultProps} />);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByTestId('mock-rich-editor')).toBeInTheDocument();
    });

    it('renders nothing when isOpen is false', () => {
        const { container } = render(<CreateThoughtModal {...defaultProps} isOpen={false} />);
        expect(container.firstChild).toBeNull();
    });

    it('closes without confirmation when text is empty (not dirty)', () => {
        const onClose = jest.fn();
        render(<CreateThoughtModal {...defaultProps} onClose={onClose} />);
        // Click backdrop
        fireEvent.click(screen.getByRole('dialog').parentElement!);
        expect(onClose).toHaveBeenCalled();
    });

    it('submits thought and calls onCreateThought on success', async () => {
        const onCreateThought = jest.fn(() => persistedWrite(Promise.resolve()));
        render(<CreateThoughtModal {...defaultProps} onCreateThought={onCreateThought} />);

        fireEvent.change(screen.getByTestId('mock-rich-editor'), { target: { value: 'Hello world' } });

        // Click the Save button (type=submit) to trigger form submission
        fireEvent.click(screen.getByRole('button', { name: /buttons\.save/i }));

        await waitFor(() => expect(onCreateThought).toHaveBeenCalledWith(expect.objectContaining({
            text: 'Hello world',
            tags: [],
            outlinePointId: undefined,
        })));
        expect(toast.success).toHaveBeenCalled();
    });

    it('does not submit when text is empty', async () => {
        render(<CreateThoughtModal {...defaultProps} />);
        const editor = screen.getByTestId('mock-rich-editor');
        fireEvent.change(editor, { target: { value: '   ' } });

        fireEvent.click(screen.getByRole('button', { name: /buttons\.save/i }));

        await waitFor(() => {
            expect(defaultProps.onCreateThought).not.toHaveBeenCalled();
        });
    });

    it('shows error toast when onCreateThought fails', async () => {
        const onCreateThought = jest.fn(() => persistedWrite(Promise.reject(Object.assign(new Error('Server error'), { code: 'permission-denied', name: 'FirebaseError' }))));

        render(<CreateThoughtModal {...defaultProps} onCreateThought={onCreateThought} />);
        fireEvent.change(screen.getByTestId('mock-rich-editor'), { target: { value: 'Some text' } });

        fireEvent.click(screen.getByRole('button', { name: /buttons\.save/i }));

        await waitFor(() => expect(toast.error).toHaveBeenCalled());
    });

    it('keeps the exact draft open when persistence rejects before local acceptance', async () => {
        const rejection = Object.assign(new Error('Permission denied'), { code: 'permission-denied' });
        const persistence = Promise.reject(rejection);
        void persistence.catch(() => undefined);
        const onClose = jest.fn();
        const onCreateThought = jest.fn(() => persistedWrite(persistence)) as jest.Mock;

        render(
            <CreateThoughtModal
                {...defaultProps}
                onClose={onClose}
                onCreateThought={onCreateThought}
            />
        );
        const editor = screen.getByTestId('mock-rich-editor');
        fireEvent.change(editor, { target: { value: '  Exact dictated thought  ' } });

        fireEvent.click(screen.getByRole('button', { name: /buttons\.save/i }));

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('writeRecovery.refused'));
        expect(onClose).not.toHaveBeenCalled();
        expect(editor).toHaveValue('  Exact dictated thought  ');
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('closes and clears after local acceptance without waiting for a server acknowledgement', async () => {
        const onClose = jest.fn();
        const persistence = new Promise<void>(() => undefined);
        const onCreateThought = jest.fn(() => queuedWrite('thought:create:queued', persistence)) as jest.Mock;

        render(
            <CreateThoughtModal
                {...defaultProps}
                onClose={onClose}
                onCreateThought={onCreateThought}
            />
        );
        const editor = screen.getByTestId('mock-rich-editor');
        fireEvent.change(editor, { target: { value: 'Queued while offline' } });

        fireEvent.click(screen.getByRole('button', { name: /buttons\.save/i }));

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(screen.getByTestId('mock-rich-editor')).toHaveValue('');
        // Queue ownership is not server persistence, so this outcome must stay silent.
        expect(toast.success).not.toHaveBeenCalledWith('manualThought.addedSuccess');
    });

    it('restores and reopens the exact submitted draft when an accepted write later rejects', async () => {
        let rejectPersistence!: (error: Error) => void;
        const persistence = new Promise<void>((_resolve, reject) => {
            rejectPersistence = reject;
        });
        const onClose = jest.fn();
        const onSubmissionRejected = jest.fn();
        const onCreateThought = jest.fn(() => queuedWrite('thought:create:late-failure', persistence)) as jest.Mock;

        render(
            <CreateThoughtModal
                {...defaultProps}
                onClose={onClose}
                onCreateThought={onCreateThought}
                onSubmissionRejected={onSubmissionRejected}
            />
        );
        fireEvent.change(screen.getByTestId('mock-rich-editor'), {
            target: { value: '  Rejected after local acceptance  ' },
        });
        fireEvent.click(screen.getByRole('button', { name: /buttons\.save/i }));
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

        rejectPersistence(new Error('Permission denied after local apply'));

        await waitFor(() => expect(onSubmissionRejected).toHaveBeenCalledTimes(1));
        expect(screen.getByTestId('mock-rich-editor')).toHaveValue('  Rejected after local acceptance  ');
        // Deliberately silent: by the time a LATE refusal arrives this modal has closed,
        // so its message would be invisible while the page reports the same refusal with
        // the dictated text. Restoring the fields stays here; announcing does not.
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('renders allowed tags and allows adding a tag', () => {
        const allowedTags = [{ name: 'intro', color: '#f00', translationKey: 'tags.introduction' }];
        render(<CreateThoughtModal {...defaultProps} allowedTags={allowedTags} />);

        // The tag should be visible as an option to add
        const tagButton = screen.getByText('tags.introduction');
        expect(tagButton).toBeInTheDocument();
        fireEvent.click(tagButton);
        // After adding, tag should appear as a selected tag (chip)
        expect(screen.getAllByText('tags.introduction').length).toBeGreaterThan(0);
    });

    it('renders RichMarkdownEditor for text input', () => {
        render(<CreateThoughtModal {...defaultProps} />);
        expect(screen.getByTestId('mock-rich-editor')).toBeInTheDocument();
    });

    it('closes when desktop backdrop is clicked', () => {
        const onClose = jest.fn();
        render(<CreateThoughtModal {...defaultProps} onClose={onClose} />);

        const backdrop = document.querySelector('div.bg-black.bg-opacity-50');
        expect(backdrop).toBeInTheDocument();
        fireEvent.click(backdrop!);

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('scroll container has mobile bg and sm:bg-transparent override to avoid white desktop background', () => {
        render(<CreateThoughtModal {...defaultProps} />);
        const scrollContainer = screen.getByRole('dialog').parentElement;
        expect(scrollContainer?.className).toContain('bg-white');
        expect(scrollContainer?.className).toContain('sm:bg-transparent');
        expect(scrollContainer?.className).toContain('sm:dark:bg-transparent');
    });

    it('does not close dirty modal when confirm is rejected', () => {
        const originalConfirm = window.confirm;
        window.confirm = jest.fn(() => false);
        const onClose = jest.fn();

        try {
            render(<CreateThoughtModal {...defaultProps} onClose={onClose} />);
            fireEvent.change(screen.getByTestId('mock-rich-editor'), { target: { value: 'Dirty text' } });

            const dialog = screen.getByRole('dialog');
            const overlaySheet = dialog.parentElement as HTMLElement | null;
            expect(overlaySheet).toBeInTheDocument();
            fireEvent.click(overlaySheet!);

            expect(window.confirm).toHaveBeenCalled();
            expect(onClose).not.toHaveBeenCalled();
        } finally {
            window.confirm = originalConfirm;
        }
    });

    it('shows toast when recorder reports an error', () => {
        render(<CreateThoughtModal {...defaultProps} />);
        fireEvent.click(screen.getByTestId('focus-recorder-error'));
        expect(toast.error).toHaveBeenCalledWith('Recorder failed');
    });

    it('lets the global handler own usage-cap errors without raw UI or a recovery blob', async () => {
        const capError = new UsageCapReachedError(
            'transcription',
            3960,
            3600,
            3960,
            '2026-08-01T00:00:00.000Z'
        );
        mockTranscribeAudioWithRetry.mockRejectedValueOnce(capError);

        render(<CreateThoughtModal {...defaultProps} />);
        fireEvent.click(screen.getByTestId('focus-recorder'));

        await waitFor(() => expect(mockTranscribeAudioWithRetry).toHaveBeenCalledTimes(1));
        expect(toast.error).not.toHaveBeenCalledWith(capError.message);
        expect(screen.queryByText(capError.message)).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId('focus-recorder-retry'));
        expect(mockTranscribeAudioWithRetry).toHaveBeenCalledTimes(1);
    });

    it('renders grouped outline point options for non-empty sections', () => {
        render(
            <CreateThoughtModal
                {...defaultProps}
                sermonOutline={{
                    introduction: [{ id: 'i1', text: 'Intro point' }],
                    main: [{ id: 'm1', text: 'Main point' }],
                    conclusion: [],
                }}
            />
        );

        expect(screen.getByRole('option', { name: 'Intro point' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Main point' })).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: 'outline.conclusion' })).not.toBeInTheDocument();
    });
});

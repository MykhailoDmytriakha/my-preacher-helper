import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import CreateThoughtModal from '@/components/CreateThoughtModal';

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

jest.mock('@/hooks/useOnlineStatus', () => ({
    useOnlineStatus: jest.fn(() => true),
}));

jest.mock('@services/thought.service', () => ({
    transcribeThoughtAudio: jest.fn(),
    createManualThought: jest.fn(),
}));

jest.mock('@components/FocusRecorderButton', () => ({
    FocusRecorderButton: ({ disabled, onError }: any) => (
        <div>
            <button data-testid="focus-recorder" disabled={disabled}>Record</button>
            <button
                data-testid="focus-recorder-error"
                disabled={disabled}
                onClick={() => onError?.('Recorder failed')}
            >
                Recorder Error
            </button>
        </div>
    ),
}));

jest.mock('@utils/tagUtils', () => ({
    isStructureTag: jest.fn(() => false),
    getStructureIcon: jest.fn(() => null),
    getTagStyle: jest.fn(() => ({ bg: '', text: '', border: '' })),
    normalizeStructureTag: jest.fn(() => null),
}));

import { createManualThought } from '@services/thought.service';
import { toast } from 'sonner';

const mockCreateManualThought = createManualThought as jest.MockedFunction<typeof createManualThought>;

const defaultProps = {
    isOpen: true,
    onClose: jest.fn(),
    sermonId: 'sermon-1',
    onNewThought: jest.fn(),
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

    it('submits thought and calls onNewThought on success', async () => {
        const savedThought = { id: 'thought-1', text: 'Hello world', tags: [], date: '' };
        mockCreateManualThought.mockResolvedValueOnce(savedThought as any);

        const onNewThought = jest.fn();
        render(<CreateThoughtModal {...defaultProps} onNewThought={onNewThought} />);

        fireEvent.change(screen.getByTestId('mock-rich-editor'), { target: { value: 'Hello world' } });

        // Click the Save button (type=submit) to trigger form submission
        fireEvent.click(screen.getByRole('button', { name: /buttons\.save/i }));

        await waitFor(() => expect(onNewThought).toHaveBeenCalledWith(savedThought));
        expect(toast.success).toHaveBeenCalled();
    });

    it('does not submit when text is empty', async () => {
        render(<CreateThoughtModal {...defaultProps} />);
        const editor = screen.getByTestId('mock-rich-editor');
        fireEvent.change(editor, { target: { value: '   ' } });

        fireEvent.click(screen.getByRole('button', { name: /buttons\.save/i }));

        await waitFor(() => {
            expect(mockCreateManualThought).not.toHaveBeenCalled();
        });
    });

    it('shows error toast when createManualThought fails', async () => {
        mockCreateManualThought.mockRejectedValueOnce(new Error('Server error'));

        render(<CreateThoughtModal {...defaultProps} />);
        fireEvent.change(screen.getByTestId('mock-rich-editor'), { target: { value: 'Some text' } });

        fireEvent.click(screen.getByRole('button', { name: /buttons\.save/i }));

        await waitFor(() => expect(toast.error).toHaveBeenCalled());
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

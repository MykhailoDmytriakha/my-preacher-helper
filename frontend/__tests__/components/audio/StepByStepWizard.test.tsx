import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';
import StepByStepWizard from '@/components/audio/StepByStepWizard';
import useSermon from '@/hooks/useSermon';

// Polyfills for JSDOM
if (typeof TextEncoder === 'undefined') {
    const { TextEncoder, TextDecoder } = require('util');
    (global as any).TextEncoder = TextEncoder;
    (global as any).TextDecoder = TextDecoder;
}

// --- Mocks --- //
let mockLanguage = 'en';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options: any) => options?.defaultValue || key,
        i18n: { language: mockLanguage, changeLanguage: jest.fn() },
    }),
}));

jest.mock('sonner', () => ({
    toast: { error: jest.fn() },
}));

jest.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({ user: { uid: 'user-123' } }),
}));

jest.mock('@/hooks/useSermon', () => ({
    __esModule: true,
    default: jest.fn(),
}));

jest.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
        button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
        span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
}));

jest.mock('lucide-react', () => ({
    ArrowRight: () => <div data-testid="icon-arrow-right" />,
    Loader2: () => <div data-testid="icon-loader" />,
    FileText: () => <div data-testid="icon-file-text" />,
    Activity: () => <div data-testid="icon-activity" />,
    Play: () => <div data-testid="icon-play" />,
    Square: () => <div data-testid="icon-square" />,
    Sparkles: () => <div data-testid="icon-sparkles" />,
    RefreshCw: () => <div data-testid="icon-refresh" />,
    AlertTriangle: () => <div data-testid="icon-alert" />,
    Check: () => <div data-testid="icon-check" />,
    Copy: () => <div data-testid="icon-copy" />,
    Pencil: () => <div data-testid="icon-pencil" />,
    Download: () => <div data-testid="icon-download" />,
    AudioLines: () => <div data-testid="icon-audio-lines" />,
}));

jest.mock('@/components/audio/ChunkEditorModal', () => (props: any) => (
    <div data-testid="chunk-editor-modal">
        <div>{props.chunk?.text}</div>
        <button type="button" onClick={() => props.onSave(props.chunk.index, 'Edited chunk text')}>
            Save chunk
        </button>
        <button type="button" onClick={props.onClose}>Close editor</button>
    </div>
));

window.HTMLAnchorElement.prototype.click = jest.fn();

const mockUseSermon = useSermon as jest.MockedFunction<typeof useSermon>;

const sermonWithChunks = (chunks: any[], extra: Record<string, any> = {}) => ({
    sermon: { title: 'Test Sermon', thoughts: [], audioChunks: chunks, ...extra },
    loading: false,
} as any);

describe('StepByStepWizard (Audio Studio)', () => {
    const defaultProps = {
        sermonId: 'sermon-123',
        sermonTitle: 'Test Sermon',
        onClose: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockLanguage = 'en';
        mockUseSermon.mockReturnValue({
            sermon: { title: 'Test Sermon', thoughts: [] },
            loading: false,
        } as any);
        global.fetch = jest.fn();
        global.URL.createObjectURL = jest.fn().mockReturnValue('blob:url');
        global.URL.revokeObjectURL = jest.fn();
    });

    it('renders the working surface with settings and the source toggle by default', () => {
        render(<StepByStepWizard {...defaultProps} />);
        expect(screen.getByText('Voice')).toBeInTheDocument();
        expect(screen.getByText('AI-optimized')).toBeInTheDocument();
        expect(screen.getByText('Original as-is')).toBeInTheDocument();
        // No chunks yet → prepare CTA visible
        expect(screen.getByRole('button', { name: 'Prepare Text for Audio' })).toBeInTheDocument();
    });

    it('prepares AI text and reveals chunks + the Generate button', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                chunks: [{ index: 0, text: 'Prepared chunk', sectionId: 'introduction' }],
                originalLength: 100,
                optimizedLength: 80,
            }),
        });

        render(<StepByStepWizard {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: 'Prepare Text for Audio' }));

        await waitFor(() => expect(screen.getByText('Prepared chunk')).toBeInTheDocument());

        const optimizeCalls = (global.fetch as jest.Mock).mock.calls.filter(
            ([url]) => String(url).includes('/audio/optimize'),
        );
        expect(optimizeCalls).toHaveLength(1);
        expect(JSON.parse(optimizeCalls[0][1].body)).toMatchObject({
            sections: 'all',
            saveToDb: true,
            userId: 'user-123',
            useRawText: false,
        });
        expect(screen.getByRole('button', { name: /Generate Audio/ })).toBeEnabled();
    });

    it('switching the source toggle to "Original as-is" re-prepares with raw text', async () => {
        mockUseSermon.mockReturnValue(sermonWithChunks(
            [{ index: 0, text: 'AI chunk', sectionId: 'introduction' }],
            { audioMetadata: { mode: 'ai', voice: 'onyx' } },
        ));
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                chunks: [{ index: 0, text: 'Raw chunk', sectionId: 'introduction' }],
                originalLength: 50,
                optimizedLength: 50,
            }),
        });

        render(<StepByStepWizard {...defaultProps} />);
        expect(await screen.findByText('AI chunk')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Original as-is' }));

        await waitFor(() => expect(screen.getByText('Raw chunk')).toBeInTheDocument());
        const optimizeCalls = (global.fetch as jest.Mock).mock.calls.filter(
            ([url]) => String(url).includes('/audio/optimize'),
        );
        expect(JSON.parse(optimizeCalls[0][1].body)).toMatchObject({ useRawText: true });
    });

    it('copies all chunks to clipboard', async () => {
        const mockWriteText = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: mockWriteText }, configurable: true });
        Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });

        mockUseSermon.mockReturnValue(sermonWithChunks([
            { index: 0, text: 'Unique Intro Content', sectionId: 'introduction' },
            { index: 1, text: 'Unique Main Content', sectionId: 'mainPart' },
            { index: 2, text: 'Unique Conclusion Content', sectionId: 'conclusion' },
        ]));

        render(<StepByStepWizard {...defaultProps} />);
        expect(await screen.findByText('Unique Intro Content')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Copy All/ }));

        expect(mockWriteText).toHaveBeenCalledWith('Unique Intro Content\n\nUnique Main Content\n\nUnique Conclusion Content');
        await waitFor(() => expect(screen.getByText('Copied')).toBeInTheDocument());
    });

    it('plays and stops a voice preview, and surfaces sample errors', async () => {
        const pause = jest.fn();
        const play = jest.fn().mockResolvedValue(undefined);
        const audioInstances: any[] = [];
        (global as any).Audio = jest.fn().mockImplementation((url: string) => {
            const audio = { url, volume: 0, play, pause, onended: null, onerror: null };
            audioInstances.push(audio);
            return audio;
        });

        render(<StepByStepWizard {...defaultProps} />);
        const previewButtons = screen.getAllByTitle('Preview voice');
        fireEvent.click(previewButtons[0]);

        expect((global as any).Audio).toHaveBeenCalledWith('/samples/onyx-standard-en.mp3');
        expect(play).toHaveBeenCalledTimes(1);

        fireEvent.click(previewButtons[0]);
        expect(pause).toHaveBeenCalledTimes(1);

        audioInstances[0].onerror?.();
        expect(jest.requireMock('sonner').toast.error).toHaveBeenCalledWith('Sample not available');
    });

    it('falls back to english samples for unsupported locales and pauses on unmount', () => {
        mockLanguage = 'pl-PL';
        const pause = jest.fn();
        const play = jest.fn().mockResolvedValue(undefined);
        (global as any).Audio = jest.fn().mockImplementation((url: string) => ({ url, volume: 0, play, pause, onended: null, onerror: null }));

        const { unmount } = render(<StepByStepWizard {...defaultProps} />);
        fireEvent.click(screen.getAllByTitle('Preview voice')[0]);

        expect((global as any).Audio).toHaveBeenCalledWith('/samples/onyx-standard-en.mp3');
        unmount();
        expect(pause).toHaveBeenCalled();
    });

    it('pauses the previous preview when switching to another voice sample', () => {
        const pauseFirst = jest.fn();
        const play = jest.fn().mockResolvedValue(undefined);
        const audioInstances: Array<{ pause: jest.Mock }> = [];
        (global as any).Audio = jest.fn().mockImplementation(() => {
            const audio = { volume: 0, play, pause: audioInstances.length === 0 ? pauseFirst : jest.fn(), onended: null, onerror: null };
            audioInstances.push(audio);
            return audio;
        });

        render(<StepByStepWizard {...defaultProps} />);
        const previewButtons = screen.getAllByTitle('Preview voice');
        fireEvent.click(previewButtons[0]);
        fireEvent.click(previewButtons[1]);

        expect(pauseFirst).toHaveBeenCalledTimes(1);
        expect((global as any).Audio).toHaveBeenCalledTimes(2);
    });

    it('opens the chunk editor and saves an edited chunk', async () => {
        mockUseSermon.mockReturnValue(sermonWithChunks([
            { index: 0, text: 'Editable chunk', sectionId: 'introduction' },
        ]));
        (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ success: true }) });

        render(<StepByStepWizard {...defaultProps} />);
        fireEvent.click(await screen.findByText('Editable chunk'));
        expect(screen.getByTestId('chunk-editor-modal')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Save chunk' }));
        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                '/api/sermons/sermon-123/audio/chunks/0',
                expect.objectContaining({ method: 'PUT' }),
            );
        });
    });

    it('surfaces preparation errors', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Optimize failed' }) });
        render(<StepByStepWizard {...defaultProps} />);
        fireEvent.click(screen.getByRole('button', { name: 'Prepare Text for Audio' }));
        await waitFor(() => expect(screen.getByText('Optimize failed')).toBeInTheDocument());
    });

    it('hydrates saved chunks from the sermon payload and notifies generating=false', async () => {
        const onGeneratingChange = jest.fn();
        mockUseSermon.mockReturnValue(sermonWithChunks([
            { index: 0, text: 'Saved intro', sectionId: 'introduction' },
            { index: 1, text: 'Saved conclusion', sectionId: 'conclusion' },
        ]));

        render(<StepByStepWizard {...defaultProps} onGeneratingChange={onGeneratingChange} />);

        expect(onGeneratingChange).toHaveBeenCalledWith(false);
        expect(await screen.findByText('Saved intro')).toBeInTheDocument();
        expect(screen.getByText('Saved conclusion')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Re-generate/ })).toBeInTheDocument();
    });

    it('generates audio and renders the success state, then closes', async () => {
        mockUseSermon.mockReturnValue(sermonWithChunks([
            { index: 0, text: 'Saved intro', sectionId: 'introduction' },
        ]));

        const encoder = new TextEncoder();
        const mockReader = {
            read: jest.fn()
                .mockResolvedValueOnce({ done: false, value: encoder.encode(JSON.stringify({ type: 'progress', percent: 50 }) + '\n') })
                .mockResolvedValueOnce({ done: false, value: encoder.encode(JSON.stringify({ type: 'audio_chunk', data: 'AAAA' }) + '\n') })
                .mockResolvedValueOnce({ done: false, value: encoder.encode(JSON.stringify({ type: 'complete', audioUrl: 'blob:final', filename: 'sermon.mp3' }) + '\n') })
                .mockResolvedValueOnce({ done: true, value: undefined }),
        };
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, body: { getReader: () => mockReader } });

        render(<StepByStepWizard {...defaultProps} />);
        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));

        expect(await screen.findByText('Audio Ready!', {}, { timeout: 3000 })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Download Again/ })).toHaveAttribute('download', 'sermon.mp3');

        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('handles download_complete streams and reassembles the audio url', async () => {
        mockUseSermon.mockReturnValue(sermonWithChunks([
            { index: 0, text: 'Saved intro', sectionId: 'introduction' },
        ]));

        const encoder = new TextEncoder();
        const mockReader = {
            read: jest.fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: encoder.encode(
                        JSON.stringify({ type: 'audio_chunk', data: 'AAAA' }) + '\n' +
                        JSON.stringify({ type: 'download_complete' }) + '\n',
                    ),
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
        };
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, body: { getReader: () => mockReader } });

        render(<StepByStepWizard {...defaultProps} />);
        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));

        const link = await screen.findByRole('link', { name: /Download Again/ });
        expect(link).toHaveAttribute('href', 'data:audio/mpeg;base64,AAAA');
        expect(link).toHaveAttribute('download', 'sermon_audio.mp3');
    });

    it('keeps pre-encoded data urls unchanged when generation completes', async () => {
        mockUseSermon.mockReturnValue(sermonWithChunks([
            { index: 0, text: 'Encoded chunk', sectionId: 'introduction' },
        ]));

        const encoder = new TextEncoder();
        const encodedUrl = 'data:audio/mpeg;base64,BBBB';
        const mockReader = {
            read: jest.fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: encoder.encode(
                        JSON.stringify({ type: 'audio_chunk', data: encodedUrl }) + '\n' +
                        JSON.stringify({ type: 'complete', filename: 'encoded.mp3' }) + '\n',
                    ),
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
        };
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, body: { getReader: () => mockReader } });

        render(<StepByStepWizard {...defaultProps} />);
        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));

        const link = await screen.findByRole('link', { name: /Download Again/ });
        expect(link).toHaveAttribute('href', encodedUrl);
        expect(link).toHaveAttribute('download', 'encoded.mp3');
    });

    it('logs malformed stream lines and returns to the working view on an error event', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        mockUseSermon.mockReturnValue(sermonWithChunks([
            { index: 0, text: 'Error chunk', sectionId: 'introduction' },
        ]));

        const encoder = new TextEncoder();
        const mockReader = {
            read: jest.fn()
                .mockResolvedValueOnce({ done: false, value: encoder.encode('\nnot json\n{"type":"error","message":"boom"}\n') })
                .mockResolvedValueOnce({ done: true, value: undefined }),
        };
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, body: { getReader: () => mockReader } });

        render(<StepByStepWizard {...defaultProps} />);
        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));

        await waitFor(() => {
            expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to parse stream line:', 'not json', expect.any(SyntaxError));
        });
        // The error event now propagates and returns to the working view with the message
        await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
        expect(screen.getByText('Voice')).toBeInTheDocument();
        consoleErrorSpy.mockRestore();
    });

    it('cancels generation and returns to the working view with an abort error', async () => {
        mockUseSermon.mockReturnValue(sermonWithChunks([
            { index: 0, text: 'Abort chunk', sectionId: 'introduction' },
        ]));

        (global.fetch as jest.Mock).mockImplementation((_url, options?: { signal?: AbortSignal }) => {
            return new Promise((_resolve, reject) => {
                options?.signal?.addEventListener('abort', () => {
                    reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                });
            });
        });

        render(<StepByStepWizard {...defaultProps} />);
        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel Generation' }));

        await waitFor(() => expect(screen.getByText('Generation cancelled')).toBeInTheDocument());
        expect(screen.getByText('Voice')).toBeInTheDocument();
    });
});

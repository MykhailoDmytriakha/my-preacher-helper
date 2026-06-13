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
        t: (key: string, options: any) => {
            if (options && typeof options.defaultValue === 'string') {
                return options.defaultValue
                    .replace('{{current}}', options.current)
                    .replace('{{total}}', options.total)
                    .replace('{{n}}', options.n);
            }
            return key;
        },
        i18n: { language: mockLanguage, changeLanguage: jest.fn() },
    }),
}));

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'user-123' } }) }));
jest.mock('@/hooks/useSermon', () => ({ __esModule: true, default: jest.fn() }));

jest.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
        button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
        span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Stub every lucide icon used by the wizard.
jest.mock('lucide-react', () => {
    const icon = (name: string) => (props: any) => <div data-testid={`icon-${name}`} {...props} />;
    return {
        ArrowRight: icon('arrow-right'), ArrowLeft: icon('arrow-left'), Loader2: icon('loader'),
        FileText: icon('file-text'), Play: icon('play'), Square: icon('square'), Sparkles: icon('sparkles'),
        AlertTriangle: icon('alert'), Check: icon('check'), Download: icon('download'), AudioLines: icon('audio-lines'),
        Pencil: icon('pencil'), Mic: icon('mic'), Cpu: icon('cpu'), Clock: icon('clock'), Eye: icon('eye'), Layers: icon('layers'),
    };
});

jest.mock('@/components/audio/ChunkEditorModal', () => (props: any) => (
    <div data-testid="chunk-editor-modal">
        <div>{props.chunk?.text}</div>
        <button type="button" onClick={() => props.onSave(props.chunk.index, 'Edited chunk text')}>Save chunk</button>
        <button type="button" onClick={props.onClose}>Close editor</button>
    </div>
));

window.HTMLAnchorElement.prototype.click = jest.fn();

const mockUseSermon = useSermon as jest.MockedFunction<typeof useSermon>;

const sermonWithChunks = (chunks: any[], extra: Record<string, any> = {}) => ({
    sermon: { title: 'Test Sermon', thoughts: [], audioChunks: chunks, ...extra },
    loading: false,
} as any);

const defaultProps = { sermonId: 'sermon-123', sermonTitle: 'Test Sermon', onClose: jest.fn() };

// Wizard navigation helpers (i18n mock returns defaultValue strings).
const goToSource = async () => fireEvent.click(await screen.findByText(/источник текста/i));
const goToPreview = async () => fireEvent.click(await screen.findByText(/предпросмотр/i));

describe('StepByStepWizard (Audio Studio — stepped wizard)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockLanguage = 'en';
        mockUseSermon.mockReturnValue({ sermon: { title: 'Test Sermon', thoughts: [] }, loading: false } as any);
        global.fetch = jest.fn();
        global.URL.createObjectURL = jest.fn().mockReturnValue('blob:url');
        global.URL.revokeObjectURL = jest.fn();
    });

    it('renders step 1 with provider, voice and the next button', () => {
        render(<StepByStepWizard {...defaultProps} />);
        expect(screen.getByText('Provider')).toBeInTheDocument();
        expect(screen.getByText('OpenAI')).toBeInTheDocument();
        expect(screen.getByText('Google')).toBeInTheDocument();
        expect(screen.getByText('Voice')).toBeInTheDocument();
        expect(screen.getByText(/источник текста/i)).toBeInTheDocument();
    });

    it('shows Gemini models and curated male voices for Google (no quality combobox)', () => {
        render(<StepByStepWizard {...defaultProps} />);
        fireEvent.click(screen.getByText('Google'));

        expect(screen.getByText(/Gemini 3\.1 TTS/)).toBeInTheDocument();
        expect(screen.getByText(/Gemini 2\.5 TTS/)).toBeInTheDocument();
        expect(screen.getByText(/Gemini 2\.5 TTS/).compareDocumentPosition(screen.getByText(/Gemini 3\.1 TTS/))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(screen.getByText('Puck')).toBeInTheDocument();
        expect(screen.getByText('Charon')).toBeInTheDocument();
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });

    it('generates AI-optimized text on step 2 and reveals editable chunks', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ chunks: [{ index: 0, text: 'Prepared chunk', sectionId: 'introduction' }], originalLength: 100, optimizedLength: 80 }),
        });

        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();
        fireEvent.click(await screen.findByText(/Сгенерировать оптимизированный текст/i));

        await waitFor(() => expect(screen.getByText('Prepared chunk')).toBeInTheDocument());

        const optimizeCalls = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('/audio/optimize'));
        expect(optimizeCalls).toHaveLength(1);
        expect(JSON.parse(optimizeCalls[0][1].body)).toMatchObject({
            sections: ['introduction', 'mainPart', 'conclusion'],
            saveToDb: true,
            userId: 'user-123',
            useRawText: false,
        });
    });

    it('the "Original as-is" tab prepares with raw text', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ chunks: [{ index: 0, text: 'Raw chunk', sectionId: 'introduction' }], originalLength: 50, optimizedLength: 50 }),
        });

        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();
        fireEvent.click(screen.getByText('Original as-is'));

        await waitFor(() => expect(screen.getByText('Raw chunk')).toBeInTheDocument());
        const optimizeCalls = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('/audio/optimize'));
        expect(JSON.parse(optimizeCalls[0][1].body)).toMatchObject({ useRawText: true });
    });

    it('re-prepares Google raw chunks on step 2 instead of reusing old persisted chunk splits', async () => {
        mockUseSermon.mockReturnValue(sermonWithChunks(
            [
                { index: 0, text: 'Old raw intro part one', sectionId: 'introduction' },
                { index: 1, text: 'Old raw intro part two', sectionId: 'introduction' },
            ],
            { audioMetadata: { provider: 'google', mode: 'raw', voice: 'Puck', model: 'gemini-2.5-flash-preview-tts' } }
        ));
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                chunks: [{ index: 0, text: 'Regrouped intro section', sectionId: 'introduction' }],
                originalLength: 24,
                optimizedLength: 24,
            }),
        });

        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();

        await waitFor(() => expect(screen.getByText('Regrouped intro section')).toBeInTheDocument());
        expect(screen.queryByText('Old raw intro part one')).not.toBeInTheDocument();

        const optimizeCalls = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('/audio/optimize'));
        expect(optimizeCalls).toHaveLength(1);
        expect(JSON.parse(optimizeCalls[0][1].body)).toMatchObject({
            provider: 'google',
            useRawText: true,
        });
    });

    it('re-prepares OpenAI raw chunks on step 2 so stale saved order is not reused', async () => {
        mockUseSermon.mockReturnValue(sermonWithChunks(
            [
                { index: 0, text: 'Old second thought', sectionId: 'introduction' },
                { index: 1, text: 'Old first thought', sectionId: 'introduction' },
            ],
            { audioMetadata: { provider: 'openai', mode: 'raw', voice: 'onyx', model: 'gpt-4o-mini-tts' } }
        ));
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                chunks: [
                    { index: 0, text: 'Fresh first thought', sectionId: 'introduction' },
                    { index: 1, text: 'Fresh second thought', sectionId: 'introduction' },
                ],
                originalLength: 38,
                optimizedLength: 38,
            }),
        });

        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();

        await waitFor(() => expect(screen.getByText('Fresh first thought')).toBeInTheDocument());
        expect(screen.queryByText('Old second thought')).not.toBeInTheDocument();

        const optimizeCalls = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('/audio/optimize'));
        expect(optimizeCalls).toHaveLength(1);
        expect(JSON.parse(optimizeCalls[0][1].body)).toMatchObject({
            provider: 'openai',
            useRawText: true,
        });
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

    it('uses a Google WAV sample url with the selected Gemini model', () => {
        const play = jest.fn().mockResolvedValue(undefined);
        (global as any).Audio = jest.fn().mockImplementation((url: string) => ({ url, volume: 0, play, pause: jest.fn(), onended: null, onerror: null }));

        render(<StepByStepWizard {...defaultProps} />);
        fireEvent.click(screen.getByText('Google'));
        fireEvent.click(screen.getAllByTitle('Preview voice')[0]); // Puck

        expect((global as any).Audio).toHaveBeenCalledWith('/samples/Puck-2.5-en.wav');
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

    it('opens the chunk editor and saves an edited chunk', async () => {
        mockUseSermon.mockReturnValue(sermonWithChunks(
            [{ index: 0, text: 'Editable chunk', sectionId: 'introduction' }],
            { audioMetadata: { mode: 'ai', voice: 'onyx' } },
        ));
        (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ success: true }) });

        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();
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
        await goToSource();
        fireEvent.click(await screen.findByText(/Сгенерировать оптимизированный текст/i));
        await waitFor(() => expect(screen.getByText('Optimize failed')).toBeInTheDocument());
    });

    it('hydrates saved chunks and notifies generating=false', async () => {
        const onGeneratingChange = jest.fn();
        mockUseSermon.mockReturnValue(sermonWithChunks([
            { index: 0, text: 'Saved intro', sectionId: 'introduction' },
            { index: 1, text: 'Saved conclusion', sectionId: 'conclusion' },
        ]));

        render(<StepByStepWizard {...defaultProps} onGeneratingChange={onGeneratingChange} />);
        expect(onGeneratingChange).toHaveBeenCalledWith(false);
        await goToSource();
        expect(await screen.findByText('Saved intro')).toBeInTheDocument();
    });

    it('generates audio and renders the success state, then closes', async () => {
        mockUseSermon.mockReturnValue(sermonWithChunks([{ index: 0, text: 'Saved intro', sectionId: 'introduction' }]));

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
        await goToSource();
        await goToPreview();
        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));

        expect(await screen.findByText('Audio Ready!', {}, { timeout: 3000 })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Download Again/ })).toHaveAttribute('download', 'sermon.mp3');

        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('sends Google provider, Gemini model, and Google voice when generating', async () => {
        mockUseSermon.mockReturnValue(sermonWithChunks(
            [{ index: 0, text: 'Saved intro', sectionId: 'introduction' }],
            { audioMetadata: { provider: 'google', mode: 'raw', voice: 'Puck', model: 'gemini-3.1-flash-tts-preview' } },
        ));

        const encoder = new TextEncoder();
        const mockReader = {
            read: jest.fn()
                .mockResolvedValueOnce({ done: false, value: encoder.encode(JSON.stringify({ type: 'download_complete', filename: 'sermon.wav', mimeType: 'audio/wav' }) + '\n') })
                .mockResolvedValueOnce({ done: true, value: undefined }),
        };
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    chunks: [{ index: 0, text: 'Fresh Google intro', sectionId: 'introduction' }],
                    originalLength: 18,
                    optimizedLength: 18,
                }),
            })
            .mockResolvedValueOnce({ ok: true, body: { getReader: () => mockReader } });

        render(<StepByStepWizard {...defaultProps} />);
        fireEvent.click(screen.getByText(/Gemini 2\.5 TTS/));
        fireEvent.click(screen.getByText('Charon'));
        await goToSource();
        await waitFor(() => expect(screen.getByText('Fresh Google intro')).toBeInTheDocument());
        await goToPreview();
        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                '/api/sermons/sermon-123/audio/generate',
                expect.objectContaining({ method: 'POST', body: expect.any(String) }),
            );
        });

        const generateCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url).includes('/audio/generate'));
        expect(JSON.parse(generateCall[1].body)).toMatchObject({
            provider: 'google',
            voice: 'Charon',
            model: 'gemini-2.5-flash-preview-tts',
            quality: 'standard',
            sections: ['introduction'], // seed restores selection from the only chunk's section
            userId: 'user-123',
        });
    });

    it('reassembles a streamed data url on download_complete', async () => {
        mockUseSermon.mockReturnValue(sermonWithChunks([{ index: 0, text: 'Saved intro', sectionId: 'introduction' }]));

        const encoder = new TextEncoder();
        const mockReader = {
            read: jest.fn()
                .mockResolvedValueOnce({ done: false, value: encoder.encode(JSON.stringify({ type: 'audio_chunk', data: 'AAAA' }) + '\n' + JSON.stringify({ type: 'download_complete' }) + '\n') })
                .mockResolvedValueOnce({ done: true, value: undefined }),
        };
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, body: { getReader: () => mockReader } });

        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();
        await goToPreview();
        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));

        const link = await screen.findByRole('link', { name: /Download Again/ });
        expect(link).toHaveAttribute('href', 'data:audio/mpeg;base64,AAAA');
        expect(link).toHaveAttribute('download', 'sermon_audio.mp3');
    });

    it('returns to the wizard on a stream error event and logs malformed lines', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        mockUseSermon.mockReturnValue(sermonWithChunks([{ index: 0, text: 'Error chunk', sectionId: 'introduction' }]));

        const encoder = new TextEncoder();
        const mockReader = {
            read: jest.fn()
                .mockResolvedValueOnce({ done: false, value: encoder.encode('\nnot json\n{"type":"error","message":"boom"}\n') })
                .mockResolvedValueOnce({ done: true, value: undefined }),
        };
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, body: { getReader: () => mockReader } });

        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();
        await goToPreview();
        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));

        await waitFor(() => expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to parse stream line:', 'not json', expect.any(SyntaxError)));
        await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument());
        expect(screen.getByRole('button', { name: /Generate Audio/ })).toBeInTheDocument();
        consoleErrorSpy.mockRestore();
    });

    it('cancels generation and returns to the wizard with an abort error', async () => {
        mockUseSermon.mockReturnValue(sermonWithChunks([{ index: 0, text: 'Abort chunk', sectionId: 'introduction' }]));

        (global.fetch as jest.Mock).mockImplementation((_url, options?: { signal?: AbortSignal }) => {
            return new Promise((_resolve, reject) => {
                options?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
            });
        });

        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();
        await goToPreview();
        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel Generation' }));

        await waitFor(() => expect(screen.getByText('Generation cancelled')).toBeInTheDocument());
        expect(screen.getByRole('button', { name: /Generate Audio/ })).toBeInTheDocument();
    });
});

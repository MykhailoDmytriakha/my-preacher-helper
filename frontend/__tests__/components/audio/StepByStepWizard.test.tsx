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
            if (key === 'audioExport.voiceLabel') return 'Voice';
            if (key === 'audioExport.stepOptimize') return 'Next: Review Content';
            if (key === 'audioExport.generateAudioButton') return 'Generate Audio';
            if (key === 'audioExport.sampleError') return 'Sample not available';
            if (key === 'audioExport.prepareTextBtn') return 'Prepare Text for Audio';
            if (key === 'buttons.cancel') return 'Cancel';
            if (key === 'buttons.save') return 'Save';
            return options?.defaultValue || key;
        },
        i18n: { language: mockLanguage, changeLanguage: jest.fn() }
    }),
}));

jest.mock('sonner', () => ({
    toast: {
        error: jest.fn(),
    },
}));

jest.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({ user: { uid: 'user-123' } }),
}));

jest.mock('@/hooks/useSermon', () => ({
    __esModule: true,
    default: jest.fn(),
}));

// Mock Framer Motion
jest.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
        button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
        span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
    },
    AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock Lucide icons
jest.mock('lucide-react', () => ({
    ArrowLeft: () => <div data-testid="icon-arrow-left" />,
    ArrowRight: () => <div data-testid="icon-arrow-right" />,
    Loader2: () => <div data-testid="icon-loader" />,
    FileText: () => <div data-testid="icon-file-text" />,
    Activity: () => <div data-testid="icon-activity" />,
    Play: () => <div data-testid="icon-play" />,
    Square: () => <div data-testid="icon-square" />,
    Mic: () => <div data-testid="icon-mic" />,
    AudioLines: () => <div data-testid="icon-audio-lines" />,
    Sparkles: () => <div data-testid="icon-sparkles" />,
    RefreshCw: () => <div data-testid="icon-refresh" />,
    AlertTriangle: () => <div data-testid="icon-alert" />,
    Check: () => <div data-testid="icon-check" />,
    Copy: () => <div data-testid="icon-copy" />,
}));

// Mock ChunkEditorModal
jest.mock('@/components/audio/ChunkEditorModal', () => (props: any) => (
    <div data-testid="chunk-editor-modal">
        <div>{props.chunk?.text}</div>
        <button type="button" onClick={() => props.onSave(props.chunk.index, 'Edited chunk text')}>
            Save chunk
        </button>
        <button type="button" onClick={props.onClose}>
            Close editor
        </button>
    </div>
));

// Mock window.HTMLAnchorElement.prototype.click
window.HTMLAnchorElement.prototype.click = jest.fn();

const mockUseSermon = useSermon as jest.MockedFunction<typeof useSermon>;

describe('StepByStepWizard', () => {
    const defaultProps = {
        sermonId: 'sermon-123',
        sermonTitle: 'Test Sermon',
        onClose: jest.fn(),
        onStepChange: jest.fn(),
        step: 'settings' as any,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockLanguage = 'en';
        mockUseSermon.mockReturnValue({
            sermon: {
                title: 'Test Sermon',
                thoughts: []
            },
            loading: false
        } as any);
        global.fetch = jest.fn();
        global.URL.createObjectURL = jest.fn().mockReturnValue('blob:url');
        global.URL.revokeObjectURL = jest.fn();
    });

    it('renders settings step by default', () => {
        render(<StepByStepWizard {...defaultProps} />);
        expect(screen.getByText('Voice')).toBeInTheDocument();
    });

    it('handles optimization transition', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                optimizedText: 'Optimized text',
                chunks: ['Chunk 1'],
                originalLength: 100,
                optimizedLength: 80,
            }),
        });

        render(<StepByStepWizard {...defaultProps} />);

        fireEvent.click(screen.getByText('Next: Review Content'));

        await waitFor(() => {
            expect(defaultProps.onStepChange).toHaveBeenCalledWith('review');
        });
    });

    it('renders generate step correctly', () => {
        render(<StepByStepWizard {...defaultProps} step="generate" />);
        expect(screen.getByText('Generating Your Audio')).toBeInTheDocument();
    });

    it('handles successful generation and success step transition', async () => {
        // Reset mocks
        (global.fetch as jest.Mock).mockReset();

        // 0. Mock Optimization Fetch (ONE sequential call for all sections)
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    optimizedText: 'Full sermon text',
                    chunks: [
                        { index: 0, text: 'intro chunk', preview: 'intro chunk', sectionId: 'introduction' },
                        { index: 1, text: 'main chunk', preview: 'main chunk', sectionId: 'mainPart' },
                        { index: 2, text: 'conclusion chunk', preview: 'conclusion chunk', sectionId: 'conclusion' }
                    ],
                    originalLength: 20,
                    optimizedLength: 16,
                }),
            });

        // 1. Mock Save Chunks Fetch (PUT) - Called after optimization finishes
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true }),
        });

        const { rerender } = render(<StepByStepWizard {...defaultProps} />);

        // Move to Review Step from Step 1
        fireEvent.click(screen.getByText('Next: Review Content'));
        await waitFor(() => expect(defaultProps.onStepChange).toHaveBeenCalledWith('review'));

        // Manually rerender with the new step
        rerender(<StepByStepWizard {...defaultProps} step="review" />);

        // Trigger Optimization (calls the 3 optimization mocks + 1 save mock)
        fireEvent.click(screen.getByText('Prepare Text for Audio'));

        // 2. Mock Generate Fetch (POST) - This is for handleGenerate later
        const encoder = new TextEncoder();
        const mockReader = {
            read: jest.fn()
                .mockResolvedValueOnce({ done: false, value: encoder.encode(JSON.stringify({ type: 'progress', percent: 50 }) + '\n') })
                .mockResolvedValueOnce({ done: false, value: encoder.encode(JSON.stringify({ type: 'audio_chunk', data: 'AAAA' }) + '\n') })
                .mockResolvedValueOnce({ done: false, value: encoder.encode(JSON.stringify({ type: 'complete', audioUrl: 'blob:final', filename: 'sermon.wav' }) + '\n') })
                .mockResolvedValueOnce({ done: true, value: undefined })
        };

        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            body: {
                getReader: () => mockReader
            },
        });

        // Use waitFor to ensure optimization state updates and "Generate Audio" button is ready
        await waitFor(() => {
            const btn = screen.getByText('Generate Audio');
            expect(btn).toBeInTheDocument();
            expect(btn).toBeEnabled();
        }, { timeout: 3000 });

        fireEvent.click(screen.getByText('Generate Audio'));

        await waitFor(() => {
            expect(defaultProps.onStepChange).toHaveBeenCalledWith('generate');
        }, { timeout: 2000 });

        // Again, manually rerender for the generate step
        rerender(<StepByStepWizard {...defaultProps} step="generate" />);

        // The component internal logic should move to success step after 'complete' event
        await waitFor(() => {
            expect(defaultProps.onStepChange).toHaveBeenCalledWith('success');
        }, { timeout: 2000 });
    });

    it('copies all chunks to clipboard when Copy All is clicked', async () => {
        // Mock navigator.clipboard and security context
        const mockWriteText = jest.fn().mockImplementation(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: mockWriteText },
            configurable: true,
        });
        Object.defineProperty(window, 'isSecureContext', {
            value: true,
            configurable: true
        });

        (global.fetch as jest.Mock)
            .mockResolvedValueOnce({ // One call for 'all' sections
                ok: true,
                json: async () => ({
                    chunks: [
                        { index: 0, text: 'Unique Intro Content', sectionId: 'introduction' },
                        { index: 1, text: 'Unique Main Content', sectionId: 'mainPart' },
                        { index: 2, text: 'Unique Conclusion Content', sectionId: 'conclusion' }
                    ],
                    originalLength: 20,
                    optimizedLength: 16,
                }),
            })
            .mockResolvedValueOnce({ // save chunks
                ok: true,
                json: async () => ({ success: true }),
            });

        render(<StepByStepWizard {...defaultProps} step="review" />);

        // Click prepare
        fireEvent.click(screen.getByText('Prepare Text for Audio'));

        const optimizeCalls = (global.fetch as jest.Mock).mock.calls.filter(
            ([url]) => String(url).includes('/audio/optimize')
        );
        expect(optimizeCalls).toHaveLength(1);
        const optimizeOptions = optimizeCalls[0][1];
        const optimizeBody = JSON.parse(optimizeOptions.body as string);
        expect(optimizeBody).toMatchObject({
            sections: 'all',
            saveToDb: false,
            userId: 'user-123',
        });

        // Wait for chunks to appear
        await waitFor(() => {
            expect(screen.getByText('Unique Intro Content')).toBeInTheDocument();
        }, { timeout: 3000 });

        // Click Copy All
        const copyBtn = screen.getByTitle('Copy All');
        fireEvent.click(copyBtn);

        expect(mockWriteText).toHaveBeenCalledWith('Unique Intro Content\n\nUnique Main Content\n\nUnique Conclusion Content');
        await waitFor(() => {
            expect(screen.getByText('Copied')).toBeInTheDocument();
        });
    });

    it('plays and stops a voice preview sample', async () => {
        const pause = jest.fn();
        const play = jest.fn().mockResolvedValue(undefined);
        const audioInstances: any[] = [];

        (global as any).Audio = jest.fn().mockImplementation((url: string) => {
            const audio = {
                url,
                volume: 0,
                play,
                pause,
                onended: null,
                onerror: null,
            };
            audioInstances.push(audio);
            return audio;
        });

        render(<StepByStepWizard {...defaultProps} />);

        const previewButtons = screen.getAllByTitle('Preview Voice Sample');
        fireEvent.click(previewButtons[0]);

        expect((global as any).Audio).toHaveBeenCalledWith('/samples/onyx-standard-en.mp3');
        expect(play).toHaveBeenCalledTimes(1);

        fireEvent.click(previewButtons[0]);
        expect(pause).toHaveBeenCalledTimes(1);

        const latestAudio = audioInstances[0];
        latestAudio.onerror?.();
        expect(jest.requireMock('sonner').toast.error).toHaveBeenCalledWith('Sample not available');
    });

    it('shows optimization errors and saves edited chunks', async () => {
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    chunks: [
                        { index: 0, text: 'Editable chunk', preview: 'Editable chunk', sectionId: 'introduction' },
                    ],
                    originalLength: 12,
                    optimizedLength: 12,
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true }),
            });

        const { rerender } = render(<StepByStepWizard {...defaultProps} step="review" />);

        fireEvent.click(screen.getByText('Prepare Text for Audio'));
        await waitFor(() => expect(screen.getByText('Editable chunk')).toBeInTheDocument());

        fireEvent.click(screen.getByText('Editable chunk'));
        expect(screen.getByTestId('chunk-editor-modal')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Save chunk' }));

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                '/api/sermons/sermon-123/audio/chunks/0',
                expect.objectContaining({
                    method: 'PUT',
                })
            );
        });

        rerender(<StepByStepWizard {...defaultProps} step="review" />);
        (global.fetch as jest.Mock).mockReset();
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: false,
            json: async () => ({ error: 'Optimize failed' }),
        });

        fireEvent.click(screen.getByRole('button', { name: 'Re-optimize' }));

        await waitFor(() => {
            expect(screen.getByText('Optimize failed')).toBeInTheDocument();
        });
    });

    it('calls onGeneratingChange and hydrates saved chunks from the sermon payload', async () => {
        const onGeneratingChange = jest.fn();
        mockUseSermon.mockReturnValue({
            sermon: {
                title: 'Hydrated Sermon',
                thoughts: [],
                audioChunks: [
                    { index: 0, text: 'Saved intro', sectionId: 'introduction' },
                    { index: 1, text: 'Saved conclusion', sectionId: 'conclusion' },
                ],
            },
            loading: false,
        } as any);

        render(<StepByStepWizard {...defaultProps} step="review" onGeneratingChange={onGeneratingChange} />);

        expect(onGeneratingChange).toHaveBeenCalledWith(false);
        expect(await screen.findByText('Saved intro')).toBeInTheDocument();
        expect(screen.getByText('Saved conclusion')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Re-optimize' })).toBeInTheDocument();
    });

    it('falls back to english preview samples for unsupported locales and pauses on unmount', () => {
        mockLanguage = 'pl-PL';
        const pause = jest.fn();
        const play = jest.fn().mockResolvedValue(undefined);
        (global as any).Audio = jest.fn().mockImplementation((url: string) => ({
            url,
            volume: 0,
            play,
            pause,
            onended: null,
            onerror: null,
        }));

        const { unmount } = render(<StepByStepWizard {...defaultProps} />);

        fireEvent.click(screen.getAllByTitle('Preview Voice Sample')[0]);

        expect((global as any).Audio).toHaveBeenCalledWith('/samples/onyx-standard-en.mp3');
        unmount();
        expect(pause).toHaveBeenCalled();
    });

    it('pauses the previous preview when switching to another voice sample', () => {
        const pauseFirst = jest.fn();
        const play = jest.fn().mockResolvedValue(undefined);
        const audioInstances: Array<{ pause: jest.Mock }> = [];

        (global as any).Audio = jest.fn().mockImplementation(() => {
            const audio = {
                volume: 0,
                play,
                pause: audioInstances.length === 0 ? pauseFirst : jest.fn(),
                onended: null,
                onerror: null,
            };
            audioInstances.push(audio);
            return audio;
        });

        render(<StepByStepWizard {...defaultProps} />);

        const previewButtons = screen.getAllByTitle('Preview Voice Sample');
        fireEvent.click(previewButtons[0]);
        fireEvent.click(previewButtons[1]);

        expect(pauseFirst).toHaveBeenCalledTimes(1);
        expect((global as any).Audio).toHaveBeenCalledTimes(2);
    });

    it('handles download_complete streams and renders the success state', async () => {
        mockUseSermon.mockReturnValue({
            sermon: {
                title: 'Test Sermon',
                thoughts: [],
                audioChunks: [
                    { index: 0, text: 'Saved intro', sectionId: 'introduction' },
                ],
            },
            loading: false,
        } as any);

        const encoder = new TextEncoder();
        const mockReader = {
            read: jest.fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: encoder.encode(
                        JSON.stringify({ type: 'audio_chunk', data: 'AAAA' }) +
                        '\n' +
                        JSON.stringify({ type: 'download_complete' }) +
                        '\n'
                    ),
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
        };

        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            body: { getReader: () => mockReader },
        });

        const onClose = jest.fn();
        const ControlledWizard = () => {
            const [step, setStep] = React.useState<'review' | 'generate' | 'success'>('review');
            return (
                <StepByStepWizard
                    {...defaultProps}
                    onClose={onClose}
                    step={step}
                    onStepChange={(next) => setStep(next as 'review' | 'generate' | 'success')}
                />
            );
        };

        render(<ControlledWizard />);

        fireEvent.click(screen.getByText('Generate Audio'));

        expect(await screen.findByText('Audio Ready!', {}, { timeout: 3000 })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Download Again' })).toHaveAttribute('download', 'sermon_audio.wav');

        fireEvent.click(screen.getByRole('button', { name: 'Close Window' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('keeps pre-encoded data urls unchanged when generation completes', async () => {
        mockUseSermon.mockReturnValue({
            sermon: {
                title: 'Encoded Sermon',
                thoughts: [],
                audioChunks: [
                    { index: 0, text: 'Encoded chunk', sectionId: 'introduction' },
                ],
            },
            loading: false,
        } as any);

        const encoder = new TextEncoder();
        const encodedUrl = 'data:audio/wav;base64,BBBB';
        const mockReader = {
            read: jest.fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: encoder.encode(
                        JSON.stringify({ type: 'audio_chunk', data: encodedUrl }) +
                        '\n' +
                        JSON.stringify({ type: 'complete', filename: 'encoded.wav' }) +
                        '\n'
                    ),
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
        };

        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            body: { getReader: () => mockReader },
        });

        const ControlledWizard = () => {
            const [step, setStep] = React.useState<'review' | 'generate' | 'success'>('review');
            return (
                <StepByStepWizard
                    {...defaultProps}
                    step={step}
                    onStepChange={(next) => setStep(next as 'review' | 'generate' | 'success')}
                />
            );
        };

        render(<ControlledWizard />);

        fireEvent.click(screen.getByText('Generate Audio'));

        const downloadLink = await screen.findByRole('link', { name: 'Download Again' });
        expect(downloadLink).toHaveAttribute('href', encodedUrl);
        expect(downloadLink).toHaveAttribute('download', 'encoded.wav');
    });

    it('ignores blank stream lines and logs malformed chunks plus unknown stream errors', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        mockUseSermon.mockReturnValue({
            sermon: {
                title: 'Error Sermon',
                thoughts: [],
                audioChunks: [
                    { index: 0, text: 'Error chunk', sectionId: 'introduction' },
                ],
            },
            loading: false,
        } as any);

        const encoder = new TextEncoder();
        const mockReader = {
            read: jest.fn()
                .mockResolvedValueOnce({
                    done: false,
                    value: encoder.encode('\nnot json\n{"type":"error"}\n'),
                })
                .mockResolvedValueOnce({ done: true, value: undefined }),
        };

        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            body: { getReader: () => mockReader },
        });

        const ControlledWizard = () => {
            const [step, setStep] = React.useState<'review' | 'generate'>('review');
            return (
                <StepByStepWizard
                    {...defaultProps}
                    step={step}
                    onStepChange={(next) => setStep(next as 'review' | 'generate')}
                />
            );
        };

        render(<ControlledWizard />);

        fireEvent.click(screen.getByText('Generate Audio'));

        await waitFor(() => {
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Failed to parse stream line:',
                'not json',
                expect.any(SyntaxError)
            );
        });
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Failed to parse stream line:',
            '{"type":"error"}',
            expect.objectContaining({ message: 'Unknown error' })
        );
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

        consoleErrorSpy.mockRestore();
    });

    it('cancels generation and returns to review with an abort error', async () => {
        mockUseSermon.mockReturnValue({
            sermon: {
                title: 'Abort Sermon',
                thoughts: [],
                audioChunks: [
                    { index: 0, text: 'Abort chunk', sectionId: 'introduction' },
                ],
            },
            loading: false,
        } as any);

        (global.fetch as jest.Mock).mockImplementation((_url, options?: { signal?: AbortSignal }) => {
            return new Promise((_resolve, reject) => {
                options?.signal?.addEventListener('abort', () => {
                    reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                });
            });
        });

        const ControlledWizard = () => {
            const [step, setStep] = React.useState<'review' | 'generate'>('review');
            return (
                <StepByStepWizard
                    {...defaultProps}
                    step={step}
                    onStepChange={(next) => setStep(next as 'review' | 'generate')}
                />
            );
        };

        render(<ControlledWizard />);

        fireEvent.click(screen.getByText('Generate Audio'));
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

        await waitFor(() => {
            expect(screen.getByText('Generation cancelled')).toBeInTheDocument();
        });
        expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    });
});

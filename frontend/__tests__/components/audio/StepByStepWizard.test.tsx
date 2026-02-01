import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';
import StepByStepWizard from '@/components/audio/StepByStepWizard';

// Polyfills for JSDOM
if (typeof TextEncoder === 'undefined') {
    const { TextEncoder, TextDecoder } = require('util');
    (global as any).TextEncoder = TextEncoder;
    (global as any).TextDecoder = TextDecoder;
}

// --- Mocks --- //
jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options: any) => {
            if (key === 'audioExport.voiceLabel') return 'Voice';
            if (key === 'audioExport.stepOptimize') return 'Next: Review Content';
            if (key === 'audioExport.generateAudioButton') return 'Generate Audio';
            return options?.defaultValue || key;
        },
        i18n: { language: 'en', changeLanguage: jest.fn() }
    }),
}));

jest.mock('@/hooks/useAuth', () => ({
    useAuth: () => ({ user: { uid: 'user-123' } }),
}));

jest.mock('@/hooks/useSermon', () => ({
    __esModule: true,
    default: () => ({
        sermon: {
            title: 'Test Sermon',
            thoughts: []
        },
        loading: false
    }),
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
}));

// Mock ChunkEditorModal
jest.mock('@/components/audio/ChunkEditorModal', () => () => <div data-testid="chunk-editor-modal" />);

// Mock window.HTMLAnchorElement.prototype.click
window.HTMLAnchorElement.prototype.click = jest.fn();

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

        // 0. Mock Optimization Fetches (3 parallel calls for all sections)
        // Each call should return its own chunk
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    optimizedText: 'Intro text',
                    chunks: [{ index: 0, text: 'intro chunk', preview: 'intro chunk', sectionId: 'introduction' }],
                    originalLength: 5,
                    optimizedLength: 4,
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    optimizedText: 'Main text',
                    chunks: [{ index: 1, text: 'main chunk', preview: 'main chunk', sectionId: 'mainPart' }],
                    originalLength: 10,
                    optimizedLength: 8,
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    optimizedText: 'Conclusion text',
                    chunks: [{ index: 2, text: 'conclusion chunk', preview: 'conclusion chunk', sectionId: 'conclusion' }],
                    originalLength: 5,
                    optimizedLength: 4,
                }),
            });

        // 1. Mock Save Chunks Fetch (PUT) - Called after parallel optimizations finish
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
});

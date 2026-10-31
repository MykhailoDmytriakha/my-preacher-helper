import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';
import { getFunctionCatalog } from '@/api/clients/ai/functionCatalog';
import StepByStepWizard from '@/components/audio/StepByStepWizard';
import { useSermonRead } from '@/hooks/useSermonRead';
import { useUserEntitlement } from '@/hooks/useUserEntitlement';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { __resetConnectivityForTests } from '@/utils/connectivity';

if (!Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = function () {
        return new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(this);
        });
    };
}

// Polyfills for JSDOM
if (typeof TextEncoder === 'undefined') {
    const { TextEncoder, TextDecoder } = require('util');
    (global as any).TextEncoder = TextEncoder;
    (global as any).TextDecoder = TextDecoder;
}

// --- Mocks --- //
let mockGenerationBlocked = false;
let mockLanguage = 'en';
let mockOwner = 'user-123';
let mockRealChunkEditor = false;
let mockConcatenateAudioBlobs: jest.Mock;
let mockRefreshAiUsage: jest.Mock;

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options: any) => {
            if (options && typeof options.defaultValue === 'string') {
                return options.defaultValue
                    .replace('{{current}}', options.current)
                    .replace('{{total}}', options.total)
                    .replace('{{n}}', options.n);
            }
            if (options && options.chunks !== undefined) return `${key}(${options.chunks})`;
            return key;
        },
        i18n: { language: mockLanguage, changeLanguage: jest.fn() },
    }),
}));

jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: mockOwner } }) }));
jest.mock('@/hooks/useSermonRead', () => ({ useSermonRead: jest.fn() }));
jest.mock('@/hooks/useUserEntitlement', () => ({ useUserEntitlement: jest.fn() }));
jest.mock('@/hooks/useAiUsage', () => ({
    useAiUsage: () => ({ aiBlocked: mockGenerationBlocked, blocked: () => mockGenerationBlocked, blockedLabelKey: () => mockGenerationBlocked ? 'settings.usage.audioUsageExhausted' : '', refresh: mockRefreshAiUsage }),
}));
jest.mock('@/utils/authenticatedRequest', () => ({ ...jest.requireActual('@/utils/authenticatedRequest'),
    getAuthenticatedRequestHeaders: jest.fn().mockResolvedValue({ Authorization: 'Bearer test-token' }),
}));
jest.mock('@/utils/audioConcat', () => ({
    concatenateAudioBlobs: (...args: any[]) => mockConcatenateAudioBlobs(...args),
}));

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

// Mirrors the real window: a refused save is shown inside it, and it stays open with the text.
jest.mock('@/components/audio/ChunkEditorModal', () => function MockChunkEditor(props: any) {
    const React = jest.requireActual('react');
    const [error, setError] = React.useState(null);
    if (mockRealChunkEditor) return React.createElement(jest.requireActual('@/components/audio/ChunkEditorModal').default, props);
    return (
        <div data-testid="chunk-editor-modal">
            <div>{props.chunk?.text}</div>
            <button type="button" onClick={() => { props.onSave(props.chunk.index, 'Edited chunk text').catch((err: Error) => setError(err.message)); }}>Save chunk</button>
            <button type="button" onClick={props.onClose}>Close editor</button>
            {error && <p>{error}</p>}
        </div>
    );
});

window.HTMLAnchorElement.prototype.click = jest.fn();

const mockUseSermon = useSermonRead as jest.MockedFunction<typeof useSermonRead>;
const mockUseUserEntitlement = useUserEntitlement as jest.MockedFunction<typeof useUserEntitlement>;
const ttsCatalog = getFunctionCatalog('tts');
const setTtsEntitlement = (
    effectiveTier: 'free' | 'tier2' = 'tier2',
    current: { providerId: 'gemini' | 'openai'; modelId: string } = {
        providerId: 'openai',
        modelId: 'gpt-4o-mini-tts',
    },
) => {
    mockUseUserEntitlement.mockReturnValue({
        data: {
            effectiveTier,
            functions: {
                tts: {
                    available: effectiveTier === 'free'
                        ? ttsCatalog.filter(entry => entry.providerId === current.providerId && entry.modelId === current.modelId)
                        : ttsCatalog,
                    current,
                },
            },
        },
        isLoading: false,
        isError: false,
    } as unknown as ReturnType<typeof useUserEntitlement>);
};

const sermonWithChunks = (chunks: any[], extra: Record<string, any> = {}) => ({
    sermon: { title: 'Test Sermon', thoughts: [], audioChunks: chunks, ...extra },
    loading: false,
} as any);
const preparedSource = (id: string, revision: number, chunks: any[], sections: string[] = ['introduction']) => ({
    id, revision, chunks: JSON.parse(JSON.stringify(chunks)), sections: [...sections],
});
const sermonWithSources = (
    aiChunks: any[],
    rawChunks: any[],
    active: 'ai' | 'raw' = 'ai',
    sections: { ai?: string[]; raw?: string[] } = {},
) => sermonWithChunks(active === 'ai' ? aiChunks : rawChunks, {
    audioMetadata: { mode: active },
    audioSources: {
        ai: preparedSource('ai-source', 3, aiChunks, sections.ai ?? ['introduction']),
        raw: preparedSource('raw-source', 5, rawChunks, sections.raw ?? ['introduction']),
    },
});

const wavBase64 = (data: number[]): string => {
    const buffer = Buffer.alloc(44 + data.length);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + data.length, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(24000, 24);
    buffer.writeUInt32LE(48000, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(data.length, 40);
    Buffer.from(data).copy(buffer, 44);
    return buffer.toString('base64');
};

const defaultProps = { sermonId: 'sermon-123', sermonTitle: 'Test Sermon', onClose: jest.fn() };

// Wizard navigation helpers (i18n mock returns defaultValue strings).
const goToSource = async () => fireEvent.click(await screen.findByText(/источник текста/i));
const goToPreview = async () => fireEvent.click(await screen.findByText(/предпросмотр/i));

describe('StepByStepWizard (Audio Studio — stepped wizard)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockLanguage = 'en';
        mockOwner = 'user-123';
        mockRealChunkEditor = false;
        mockGenerationBlocked = false;
        mockRefreshAiUsage = jest.fn().mockResolvedValue(undefined);
        mockConcatenateAudioBlobs = jest.fn((blobs: Blob[]) =>
            jest.requireActual('@/utils/audioConcat').concatenateAudioBlobs(blobs));
        setTtsEntitlement();
        mockUseSermon.mockReturnValue({ sermon: { title: 'Test Sermon', thoughts: [] }, loading: false } as any);
        global.fetch = jest.fn();
        global.URL.createObjectURL = jest.fn().mockReturnValue('blob:url');
        global.URL.revokeObjectURL = jest.fn();
    });

    // An API call in one test arms connectivity's 3 s recovery timer, which writes module-level
    // state after the test ends. Nothing here reads it yet; reset so no later test inherits it.
    afterEach(() => __resetConnectivityForTests());


    describe('real correction decisions', () => {
        beforeEach(() => { mockRealChunkEditor = true; });
        it.each([false, true])('resolves a shown conflict with an explicit target when preparation changed: %s', async changed => {
            const opening = [{ index: 0, text: 'Opening target', sectionId: 'introduction' }];
            const latest = changed
                ? [{ index: 0, text: 'New first fragment', sectionId: 'introduction' }, { index: 1, text: 'Current moved target', sectionId: 'introduction' }]
                : [{ index: 0, text: 'Current stored target', sectionId: 'introduction' }];
            const sourceId = changed ? 'new-preparation' : 'ai-source', targetIndex = changed ? 1 : 0;
            mockUseSermon.mockReturnValue(sermonWithSources(opening, []));
            (global.fetch as jest.Mock)
                .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({
                    code: 'chunks-changed', mode: 'ai', sources: { ai: preparedSource(sourceId, 4, latest) },
                }) })
                .mockResolvedValueOnce({ ok: true, json: async () => ({
                    sources: { ai: preparedSource(sourceId, 5, latest.map((chunk, index) => index === targetIndex ? { ...chunk, text: 'My retained correction' } : chunk)) },
                }) });
            render(<StepByStepWizard {...defaultProps} />);
            await goToSource();
            fireEvent.click(await screen.findByText('Opening target'));
            const editor = screen.getByRole('dialog');
            fireEvent.change(within(editor).getByRole('textbox'), { target: { value: 'My retained correction' } });
            fireEvent.click(within(editor).getByRole('button', { name: 'Save' }));
            if (changed) {
                const choice = await within(editor).findByRole('combobox', { name: 'Choose the fragment to change' });
                expect(within(editor).getByRole('button', { name: 'Save my text' })).toBeDisabled();
                fireEvent.change(choice, { target: { value: String(targetIndex) } });
            }
            expect(await within(editor).findByText(latest[targetIndex].text, { exact: true })).toBeInTheDocument();
            expect(within(editor).getByRole('textbox')).toHaveValue('My retained correction');
            fireEvent.click(within(editor).getByRole('button', { name: 'Save my text' }));
            await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
            const calls = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('/audio/chunks/'));
            expect(calls).toHaveLength(2);
            expect(String(calls[1][0])).toContain('/audio/chunks/' + targetIndex);
            expect(JSON.parse(calls[1][1].body)).toMatchObject({
                text: 'My retained correction', mode: 'ai', source: { id: sourceId, revision: 4 }, expected: latest,
            });
            if (changed) expect(screen.getByText('New first fragment')).toBeInTheDocument();
        });
    });

    describe('generation lifetime isolation', () => {
        const chunks = [0, 1, 2, 3].map(i => ({ index: i, text: `Saved narration ${i}`, sectionId: 'introduction' }));
        const waitingStream = () => {
            const encoder = new TextEncoder();
            let resolveRead!: (result: { done: boolean; value?: Uint8Array }) => void;
            const read = jest.fn()
                .mockImplementationOnce(() => new Promise(resolve => { resolveRead = resolve; }))
                .mockResolvedValueOnce({ done: true, value: undefined });
            const reader = { read };
            return {
                response: { ok: true, status: 200, body: { getReader: () => reader } },
                read,
                resolve: (result: { done: boolean; value?: Uint8Array }) => resolveRead(result),
                value: encoder.encode(JSON.stringify({ type: 'audio_chunk', data: 'AAAA' }) + '\n'
                    + JSON.stringify({ type: 'download_complete', filename: 'sermon.mp3', mimeType: 'audio/mpeg' }) + '\n'),
            };
        };

        it('aborts on unmount and ignores a stream that completes after the wizard leaves', async () => {
            mockUseSermon.mockReturnValue(sermonWithChunks(chunks.slice(0, 1)));
            let requestSignal: AbortSignal | undefined;
            const stream = waitingStream();
            (global.fetch as jest.Mock).mockImplementationOnce((_url, init?: { signal?: AbortSignal }) => {
                requestSignal = init?.signal;
                return Promise.resolve(stream.response);
            });
            const view = render(<StepByStepWizard {...defaultProps} />);
            await goToSource();
            await goToPreview();
            fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));
            await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
            expect(global.fetch).toHaveBeenCalledWith('/api/sermons/sermon-123/audio/generate', expect.anything());
            await waitFor(() => expect(stream.read).toHaveBeenCalledTimes(1));

            view.unmount();
            await act(async () => {
                stream.resolve({ done: false, value: stream.value });
                await new Promise(resolve => setTimeout(resolve, 20));
            });

            expect({ aborted: requestSignal?.aborted, createdUrl: (global.URL.createObjectURL as jest.Mock).mock.calls.length,
                clickedDownload: (window.HTMLAnchorElement.prototype.click as jest.Mock).mock.calls.length })
                .toEqual({ aborted: true, createdUrl: 0, clickedDownload: 0 });
        });

        it('does not publish a pending result after the same wizard changes to another sermon', async () => {
            mockUseSermon.mockReturnValue(sermonWithChunks(chunks.slice(0, 1)));
            const stream = waitingStream();
            (global.fetch as jest.Mock).mockResolvedValueOnce(stream.response);
            const view = render(<StepByStepWizard {...defaultProps} />);
            await goToSource();
            await goToPreview();
            fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));
            await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
            expect(global.fetch).toHaveBeenCalledWith('/api/sermons/sermon-123/audio/generate', expect.anything());
            await waitFor(() => expect(stream.read).toHaveBeenCalledTimes(1));

            mockUseSermon.mockReturnValue(sermonWithChunks([{ index: 0, text: 'Another sermon', sectionId: 'introduction' }]));
            view.rerender(<StepByStepWizard {...defaultProps} sermonId="sermon-456" />);
            expect(global.fetch).toHaveBeenCalledTimes(1);
            await act(async () => {
                stream.resolve({ done: false, value: stream.value });
                await new Promise(resolve => setTimeout(resolve, 20));
            });

            expect(global.URL.createObjectURL).not.toHaveBeenCalled();
            expect(window.HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
            expect(screen.queryByRole('link', { name: /Download Again/ })).not.toBeInTheDocument();
        });

        it('does not publish a pending result after the signed-in owner changes', async () => {
            mockUseSermon.mockReturnValue(sermonWithChunks(chunks.slice(0, 1)));
            const stream = waitingStream();
            (global.fetch as jest.Mock).mockResolvedValueOnce(stream.response);
            const view = render(<StepByStepWizard {...defaultProps} />);
            await goToSource();
            await goToPreview();
            fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));
            await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
            expect(global.fetch).toHaveBeenCalledWith('/api/sermons/sermon-123/audio/generate', expect.anything());
            await waitFor(() => expect(stream.read).toHaveBeenCalledTimes(1));

            mockOwner = 'user-456';
            view.rerender(<StepByStepWizard {...defaultProps} />);
            expect(global.fetch).toHaveBeenCalledTimes(1);
            await act(async () => {
                stream.resolve({ done: false, value: stream.value });
                await new Promise(resolve => setTimeout(resolve, 20));
            });

            expect(global.URL.createObjectURL).not.toHaveBeenCalled();
            expect(window.HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
            expect(screen.queryByRole('link', { name: /Download Again/ })).not.toBeInTheDocument();
        });

        it('does not send a stale sermon request with headers resolved for a different owner', async () => {
            mockUseSermon.mockReturnValue(sermonWithChunks(chunks));
            let resolveHeaders!: (value: Record<string, string>) => void;
            jest.mocked(getAuthenticatedRequestHeaders).mockImplementationOnce(() => new Promise(resolve => { resolveHeaders = resolve; }));
            const view = render(<StepByStepWizard {...defaultProps} />);
            await goToSource();
            await goToPreview();
            fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));
            await waitFor(() => expect(getAuthenticatedRequestHeaders).toHaveBeenCalledTimes(1));

            mockOwner = 'user-456';
            view.rerender(<StepByStepWizard {...defaultProps} sermonId="sermon-456" />);
            await act(async () => {
                resolveHeaders({ Authorization: 'Bearer new-owner-token' });
                await new Promise(resolve => setTimeout(resolve, 20));
            });

            const requests = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).endsWith('/audio/generate'));
            expect(requests).toHaveLength(0);
        });

        it('does not resume partial bytes for a different owner and sermon with identical legacy speech', async () => {
            mockUseSermon.mockReturnValue(sermonWithChunks(chunks));
            const encoder = new TextEncoder();
            const streamOf = (...events: object[]) => ({
                ok: true,
                body: { getReader: () => ({ read: jest.fn()
                    .mockResolvedValueOnce({ done: false, value: encoder.encode(events.map(event => JSON.stringify(event)).join('\n') + '\n') })
                    .mockResolvedValueOnce({ done: true, value: undefined }) }) },
            });
            (global.fetch as jest.Mock)
                .mockResolvedValueOnce(streamOf({ type: 'audio_chunk', data: 'AAAA' }, { type: 'download_complete', filename: 'old.mp3', mimeType: 'audio/mpeg' }))
                .mockResolvedValueOnce(streamOf({ type: 'error', code: 'tts-chunk-failed', chunks: [4], message: 'TTS chunk 4 failed' }));
            const view = render(<StepByStepWizard {...defaultProps} />);
            await goToSource();
            await goToPreview();
            fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));
            expect(await screen.findByText('audioExport.chunkFailed(4)')).toBeInTheDocument();

            mockOwner = 'user-456';
            view.rerender(<StepByStepWizard {...defaultProps} sermonId="sermon-456" />);
            await waitFor(() => expect(screen.getByRole('button', { name: /Generate Audio/ })).toBeEnabled());
            (global.fetch as jest.Mock)
                .mockResolvedValueOnce(streamOf({ type: 'audio_chunk', data: 'BBBB' }, { type: 'download_complete', filename: 'new.mp3', mimeType: 'audio/mpeg' }))
                .mockResolvedValueOnce(streamOf({ type: 'audio_chunk', data: 'CCCC' }, { type: 'download_complete', filename: 'new.mp3', mimeType: 'audio/mpeg' }));
            fireEvent.click(screen.getByRole('button', { name: /Generate Audio/ }));
            await screen.findByRole('link', { name: /Download Again/ });

            const bodies = (global.fetch as jest.Mock).mock.calls
                .filter(([url]) => String(url).endsWith('/audio/generate'))
                .map(([, init]) => JSON.parse(init.body));
            expect(bodies.map(body => body.offset)).toEqual([0, 3, 0, 3]);
            const finalBlob = (global.URL.createObjectURL as jest.Mock).mock.calls.at(-1)?.[0] as Blob;
            expect(finalBlob.size).toBe(6);
            expect(Array.from(new Uint8Array(await finalBlob.arrayBuffer())))
                .toEqual([...Buffer.from('BBBB', 'base64'), ...Buffer.from('CCCC', 'base64')]);
        });

        it('does not publish a Google result canceled while browser audio assembly is pending', async () => {
            setTtsEntitlement('tier2', { providerId: 'gemini', modelId: 'gemini-3.1-flash-tts' });
            const rawChunks = [0, 1].map(i => ({ index: i, text: `Raw narration ${i}`, sectionId: 'introduction' }));
            mockUseSermon.mockReturnValue(sermonWithSources([], rawChunks, 'raw', { ai: [], raw: ['introduction'] }));

            const encoder = new TextEncoder();
            const streamOf = (data: number[]) => ({
                ok: true,
                body: { getReader: () => ({ read: jest.fn()
                    .mockResolvedValueOnce({ done: false, value: encoder.encode(
                        JSON.stringify({ type: 'audio_chunk', data: wavBase64(data) }) + '\n'
                        + JSON.stringify({ type: 'download_complete', filename: 'sermon.wav', mimeType: 'audio/wav' }) + '\n',
                    ) })
                    .mockResolvedValueOnce({ done: true, value: undefined }) }) },
            });
            (global.fetch as jest.Mock).mockResolvedValueOnce(streamOf([1, 2])).mockResolvedValueOnce(streamOf([3, 4]));

            let resolveAssembly!: (blob: Blob) => void;
            mockConcatenateAudioBlobs.mockImplementationOnce(() =>
                new Promise(resolve => { resolveAssembly = resolve; }));
            render(<StepByStepWizard {...defaultProps} />);
            fireEvent.click(screen.getByText(/Gemini 2\.5 TTS/));
            fireEvent.click(screen.getByText('Charon'));
            await goToSource();
            await waitFor(() => expect(screen.getByText('Raw narration 0')).toBeInTheDocument());
            await goToPreview();
            fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));
            await waitFor(() => expect(mockConcatenateAudioBlobs).toHaveBeenCalledTimes(1));

            fireEvent.click(await screen.findByRole('button', { name: 'Cancel Generation' }));
            await waitFor(() => expect(screen.getByText('audioExport.generationCancelled')).toBeInTheDocument());
            await act(async () => {
                resolveAssembly(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }));
                await Promise.resolve();
            });

            expect(global.URL.createObjectURL).not.toHaveBeenCalled();
            expect(window.HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
            expect(screen.queryByRole('link', { name: /Download Again/ })).not.toBeInTheDocument();
        });

        it('retries the pending OpenAI batch without retaining a late response after cancellation', async () => {
            mockUseSermon.mockReturnValue(sermonWithChunks(chunks));
            const encoder = new TextEncoder();
            const streamOf = (data: string) => ({
                ok: true,
                body: { getReader: () => ({ read: jest.fn()
                    .mockResolvedValueOnce({ done: false, value: encoder.encode(
                        JSON.stringify({ type: 'audio_chunk', data }) + '\n'
                        + JSON.stringify({ type: 'download_complete', filename: 'sermon.mp3', mimeType: 'audio/mpeg' }) + '\n',
                    ) })
                    .mockResolvedValueOnce({ done: true, value: undefined }) }) },
            });
            const pending = waitingStream();
            (global.fetch as jest.Mock)
                .mockResolvedValueOnce(streamOf('AAAA'))
                .mockResolvedValueOnce(pending.response);
            render(<StepByStepWizard {...defaultProps} />);
            await goToSource();
            await goToPreview();
            fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));
            await waitFor(() => expect(pending.read).toHaveBeenCalledTimes(1));

            fireEvent.click(await screen.findByRole('button', { name: 'Cancel Generation' }));
            await act(async () => {
                pending.resolve({ done: false, value: pending.value });
                await new Promise(resolve => setTimeout(resolve, 20));
            });
            await waitFor(() => expect(screen.getByRole('button', { name: /Generate Audio/ })).toBeEnabled());
            (global.fetch as jest.Mock).mockResolvedValueOnce(streamOf('CCCC'));
            fireEvent.click(screen.getByRole('button', { name: /Generate Audio/ }));
            await screen.findByRole('link', { name: /Download Again/ });

            const calls = (global.fetch as jest.Mock).mock.calls
                .filter(([url]) => String(url).endsWith('/audio/generate'));
            const bodies = calls.map(([, init]) => JSON.parse(init.body));
            expect(bodies.map(body => body.offset)).toEqual([0, 3, 3]);
            expect(bodies[1]).toEqual(bodies[2]);
            const finalBlob = (global.URL.createObjectURL as jest.Mock).mock.calls.at(-1)?.[0] as Blob;
            expect(Array.from(new Uint8Array(await finalBlob.arrayBuffer())))
                .toEqual([...Buffer.from('AAAA', 'base64'), ...Buffer.from('CCCC', 'base64')]);
            expect(finalBlob.size).toBe(6);
        });

        it('keeps a completed download successful when refreshing usage fails', async () => {
            mockUseSermon.mockReturnValue(sermonWithChunks(chunks.slice(0, 1)));
            mockRefreshAiUsage.mockRejectedValueOnce(new Error('usage refresh failed'));
            const encoder = new TextEncoder();
            (global.fetch as jest.Mock).mockResolvedValueOnce({
                ok: true,
                body: { getReader: () => ({ read: jest.fn()
                    .mockResolvedValueOnce({ done: false, value: encoder.encode(
                        JSON.stringify({ type: 'audio_chunk', data: 'AAAA' }) + '\n'
                        + JSON.stringify({ type: 'download_complete', filename: 'sermon.mp3', mimeType: 'audio/mpeg' }) + '\n',
                    ) })
                    .mockResolvedValueOnce({ done: true, value: undefined }) }) },
            });
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
            render(<StepByStepWizard {...defaultProps} />);
            await goToSource();
            await goToPreview();
            fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));
            const link = await screen.findByRole('link', { name: /Download Again/ });
            await waitFor(() => expect(warn).toHaveBeenCalledWith('Audio usage refresh failed', expect.any(Error)));

            expect(link).toHaveAttribute('href', 'blob:url');
            expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
            expect(window.HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
            warn.mockRestore();
        });
    });

    describe('saved speech source consistency', () => {
        const savedWords = 'Saved narration with manual corrections';
        const saved = () => sermonWithChunks([{ index: 0, sectionId: 'introduction', text: savedWords }], { audioMetadata: { mode: 'ai', provider: 'openai' } });

        it('does not enable Google generation with saved AI text after original preparation fails', async () => {
            mockUseSermon.mockReturnValue(saved());
            (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'Original preparation unavailable' }) });
            render(<StepByStepWizard {...defaultProps} />);
            fireEvent.click(screen.getByText('Google'));
            await goToSource();
            await screen.findByText('Original preparation unavailable');
            await goToPreview();
            expect(screen.getByRole('button', { name: 'Generate Audio' })).toBeDisabled();
            expect(screen.queryByText(savedWords)).not.toBeInTheDocument();
        });

        it('never loads saved AI words into Original when free entitlement and saved text arrive together', async () => {
            mockUseSermon.mockReturnValue(saved());
            setTtsEntitlement('free', { providerId: 'gemini', modelId: 'gemini-3.1-flash-tts' });
            (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'Original preparation unavailable' }) });
            render(<StepByStepWizard {...defaultProps} />);
            await goToSource();
            await screen.findByText('Original preparation unavailable');
            expect(screen.queryByText(savedWords)).not.toBeInTheDocument();
        });

        it('moves to an allowed voice when entitlement closes the selected provider while open', async () => {
            mockUseSermon.mockReturnValue(saved());
            const view = render(<StepByStepWizard {...defaultProps} />);
            expect(screen.getByText('Onyx')).toBeInTheDocument();
            setTtsEntitlement('free', { providerId: 'gemini', modelId: 'gemini-3.1-flash-tts' });
            view.rerender(<StepByStepWizard {...defaultProps} />);
            await waitFor(() => expect(screen.getByText('Puck')).toBeInTheDocument());
            expect(screen.queryByText('Onyx')).not.toBeInTheDocument();
            expect(screen.getByText('OpenAI').closest('button')).toBeDisabled();
        });
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
        expect(screen.getByText(/Gemini 3\.1 TTS/).compareDocumentPosition(screen.getByText(/Gemini 2\.5 TTS/))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
        expect(screen.getByText('Puck')).toBeInTheDocument();
        expect(screen.getByText('Charon')).toBeInTheDocument();
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    });

    it('shows free users the other voice models as paid and lets them pick none of them', async () => {
        setTtsEntitlement('free', { providerId: 'gemini', modelId: 'gemini-3.1-flash-tts' });
        const { rerender } = render(<StepByStepWizard {...defaultProps} />);

        await waitFor(() => expect(screen.getByText('Google')).toBeInTheDocument());
        // The plan's model is chosen; the rest of the catalog is visible, marked paid, and inert.
        const gemini25 = screen.getByText(/Gemini 2\.5 TTS/).closest('button')!;
        expect(gemini25).toBeDisabled();
        expect(gemini25).toHaveTextContent('settings.modelSelector.paidLocked');
        const openai = screen.getByText('OpenAI').closest('button')!;
        expect(openai).toBeDisabled();
        expect(openai).toHaveTextContent('settings.modelSelector.paidLocked');
        // The closed provider's models are listed too, as paid.
        const openaiModel = screen.getByText('gpt-4o-mini-tts').closest('button')!;
        expect(openaiModel).toBeDisabled();
        expect(openaiModel).toHaveTextContent('settings.modelSelector.paidLocked');
        expect(openaiModel).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(openai);
        fireEvent.click(gemini25);
        expect(screen.getByText(/Gemini 3\.1 TTS/).closest('button')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText('Puck')).toBeInTheDocument(); // still on Google voices
        expect(screen.getByText('Your plan uses the configured default voice model.')).toBeInTheDocument();

        setTtsEntitlement('tier2', { providerId: 'openai', modelId: 'gpt-4o-mini-tts' });
        rerender(<StepByStepWizard {...defaultProps} />);
        expect(screen.getByText('OpenAI').closest('button')).toBeEnabled();
        expect(screen.queryByText('settings.modelSelector.paidLocked')).not.toBeInTheDocument();
        // With everything open, the model row shows the chosen provider (still Google) only, as before.
        expect(screen.getByText(/Gemini 2\.5 TTS/).closest('button')).toBeEnabled();
        expect(screen.queryByText('gpt-4o-mini-tts')).not.toBeInTheDocument();
    });

    it('has no quality switch: the voice model alone decides the sound, and the request carries no quality', async () => {
        render(<StepByStepWizard {...defaultProps} />);
        expect(screen.queryByText('Quality')).not.toBeInTheDocument();
        expect(screen.queryByText('HD')).not.toBeInTheDocument();
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
            useRawText: false,
        });
        expect(optimizeCalls[0][1].headers).toMatchObject({ Authorization: 'Bearer test-token' });
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

    it('keeps saved Google raw chunks when entering step 2 without requesting a re-prepare', async () => {
        setTtsEntitlement('tier2', { providerId: 'gemini', modelId: 'gemini-3.1-flash-tts' });
        mockUseSermon.mockReturnValue(sermonWithChunks(
            [
                { index: 0, text: 'Old raw intro part one', sectionId: 'introduction' },
                { index: 1, text: 'Old raw intro part two', sectionId: 'introduction' },
            ],
            { audioMetadata: { provider: 'google', mode: 'raw', voice: 'Puck', model: 'gemini-2.5-flash-preview-tts' } }
        ));
        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();

        expect(await screen.findByText('Old raw intro part one')).toBeInTheDocument();
        expect(screen.getByText('Old raw intro part two')).toBeInTheDocument();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('keeps saved OpenAI raw chunks and their order when entering step 2', async () => {
        mockUseSermon.mockReturnValue(sermonWithChunks(
            [
                { index: 0, text: 'Old second thought', sectionId: 'introduction' },
                { index: 1, text: 'Old first thought', sectionId: 'introduction' },
            ],
            { audioMetadata: { provider: 'openai', mode: 'raw', voice: 'onyx', model: 'gpt-4o-mini-tts' } }
        ));
        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();

        expect(await screen.findByText('Old second thought')).toBeInTheDocument();
        expect(screen.getByText('Old first thought')).toBeInTheDocument();
        expect(global.fetch).not.toHaveBeenCalled();
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
        fireEvent.click(screen.getByText(/Gemini 2\.5 TTS/));
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

    it('does not let a late save from a closed editor close its newer editor session', async () => {
        const original = [{ index: 0, text: 'Editable source text', sectionId: 'introduction' }];
        mockUseSermon.mockReturnValue(sermonWithSources(original, [], 'ai', { ai: ['introduction'], raw: [] }));
        let resolveSave!: (value: unknown) => void;
        (global.fetch as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();
        fireEvent.click(await screen.findByText('Editable source text'));
        fireEvent.click(screen.getByRole('button', { name: 'Save chunk' }));
        await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
        const sent = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
        expect(sent).toMatchObject({ mode: 'ai', source: { id: 'ai-source', revision: 3 } });

        fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
        fireEvent.click(screen.getByText('Editable source text'));
        expect(screen.getByTestId('chunk-editor-modal')).toBeInTheDocument();
        resolveSave({ ok: true, json: async () => ({ sources: {
            ai: preparedSource('ai-source', 4, [{ ...original[0], text: 'Edited after response' }]),
        } }) });
        await waitFor(() => expect(screen.getByTestId('chunk-editor-modal')).toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'Save chunk' })).toBeInTheDocument();
    });

    it('does not carry cached words into another sermon or owner identity', async () => {
        mockUseSermon.mockReturnValue(sermonWithSources(
            [{ index: 0, text: 'First owner sermon', sectionId: 'introduction' }],
            [{ index: 0, text: 'First owner Original', sectionId: 'introduction' }],
        ));
        const view = render(<StepByStepWizard {...defaultProps} />);
        await goToSource();
        expect(await screen.findByText('First owner sermon')).toBeInTheDocument();

        mockOwner = 'user-456';
        mockUseSermon.mockReturnValue(sermonWithChunks([{ index: 0, text: 'Second owner sermon', sectionId: 'introduction' }], { audioMetadata: { mode: 'ai' } }));
        view.rerender(<StepByStepWizard {...defaultProps} sermonId="sermon-456" />);
        await waitFor(() => expect(screen.getByText('Second owner sermon')).toBeInTheDocument());
        expect(screen.queryByText('First owner sermon')).not.toBeInTheDocument();
        expect(screen.queryByText('First owner Original')).not.toBeInTheDocument();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    describe('selecting saved speech sources', () => {
        const aiChunks = [{ index: 0, text: 'Polished opening', sectionId: 'introduction' }];
        const rawChunks = [{ index: 0, text: 'Raw opening', sectionId: 'introduction' }];

        it('switches between two saved sets locally without publishing either cached array', async () => {
            const sermon = sermonWithSources(aiChunks, rawChunks);
            mockUseSermon.mockReturnValue(sermon);
            render(<StepByStepWizard {...defaultProps} />);
            await goToSource();
            expect(await screen.findByText('Polished opening')).toBeInTheDocument();
            fireEvent.click(screen.getByText('Original as-is'));
            expect(await screen.findByText('Raw opening')).toBeInTheDocument();
            fireEvent.click(screen.getByText('AI-optimized'));
            expect(await screen.findByText('Polished opening')).toBeInTheDocument();
            expect(global.fetch).not.toHaveBeenCalled();
            expect(sermon.sermon.audioSources.ai.chunks[0].text).toBe('Polished opening');
            expect(sermon.sermon.audioSources.raw.chunks[0].text).toBe('Raw opening');
            expect(sermon.sermon.audioChunks).toBe(aiChunks);
        });

        it('keeps separate saved corrections when both sources have changed words', async () => {
            const aiCorrected = [{ index: 0, text: 'AI corrected elsewhere', sectionId: 'introduction' }];
            const rawCorrected = [{ index: 0, text: 'Original corrected elsewhere', sectionId: 'introduction' }];
            mockUseSermon.mockReturnValue(sermonWithSources(aiCorrected, rawCorrected));
            render(<StepByStepWizard {...defaultProps} />);
            await goToSource();
            expect(await screen.findByText('AI corrected elsewhere')).toBeInTheDocument();
            fireEvent.click(screen.getByText('Original as-is'));
            expect(await screen.findByText('Original corrected elsewhere')).toBeInTheDocument();
            fireEvent.click(screen.getByText('AI-optimized'));
            expect(await screen.findByText('AI corrected elsewhere')).toBeInTheDocument();
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('uses the selected source identity at generation even when both sets contain the same words', async () => {
            const sameWords = [{ index: 0, text: 'Amen', sectionId: 'introduction' }];
            mockUseSermon.mockReturnValue(sermonWithSources(sameWords, sameWords));
            const encoder = new TextEncoder();
            (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, body: { getReader: () => ({ read: jest.fn()
                .mockResolvedValueOnce({ done: false, value: encoder.encode(JSON.stringify({ type: 'download_complete', filename: 'sermon.mp3', mimeType: 'audio/mpeg' }) + '\n') })
                .mockResolvedValueOnce({ done: true, value: undefined }) }) } });
            render(<StepByStepWizard {...defaultProps} />);
            await goToSource();
            fireEvent.click(screen.getByText('Original as-is'));
            await goToPreview();
            fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));
            await screen.findByRole('link', { name: /Download Again/ });
            const call = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url).endsWith('/audio/generate'));
            expect(JSON.parse(call[1].body)).toMatchObject({ mode: 'raw', source: { id: 'raw-source', revision: 5 }, expected: sameWords });
        });

        it('merges a newer version of the other source without changing the current choice', async () => {
            const initial = sermonWithSources(aiChunks, rawChunks);
            mockUseSermon.mockReturnValue(initial);
            const updatedAi = [{ index: 0, text: 'New AI text from phone', sectionId: 'introduction' }];
            (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({
                code: 'chunks-changed', mode: 'raw', chunks: rawChunks,
                sources: { ai: preparedSource('ai-source-new', 4, updatedAi), raw: initial.sermon.audioSources.raw },
            }) });
            render(<StepByStepWizard {...defaultProps} />);
            await goToSource();
            expect(await screen.findByText('Polished opening')).toBeInTheDocument();
            // Explicitly refresh AI to receive a conflict containing the newer saved versions.
            fireEvent.click(screen.getByRole('button', { name: 'Regenerate text' }));
            await screen.findByText('audioExport.chunksChangedElsewhere');
            expect(screen.getByRole('button', { name: /AI-optimized/ })).toHaveAttribute('aria-pressed', 'true');
            expect(await screen.findByText('New AI text from phone')).toBeInTheDocument();
        });

        it('retains both corrected sources when the wizard is reopened', async () => {
            const sermon = sermonWithSources(
                [{ index: 0, text: 'Manually corrected AI text', sectionId: 'introduction' }],
                [{ index: 0, text: 'Corrected original text', sectionId: 'introduction' }],
            );
            mockUseSermon.mockReturnValue(sermon);
            const view = render(<StepByStepWizard {...defaultProps} />);
            await goToSource();
            expect(await screen.findByText('Manually corrected AI text')).toBeInTheDocument();
            fireEvent.click(screen.getByText('Original as-is'));
            expect(await screen.findByText('Corrected original text')).toBeInTheDocument();
            view.unmount();
            render(<StepByStepWizard {...defaultProps} />);
            await goToSource();
            expect(await screen.findByText('Manually corrected AI text')).toBeInTheDocument();
            fireEvent.click(screen.getByText('Original as-is'));
            expect(await screen.findByText('Corrected original text')).toBeInTheDocument();
            expect(global.fetch).not.toHaveBeenCalled();
        });

        it('does not change the active legacy projection when selecting a different saved source', async () => {
            const sermon = sermonWithSources(aiChunks, rawChunks, 'ai');
            mockUseSermon.mockReturnValue(sermon);
            render(<StepByStepWizard {...defaultProps} />);
            await goToSource();
            fireEvent.click(screen.getByText('Original as-is'));
            expect(await screen.findByText('Raw opening')).toBeInTheDocument();
            expect(sermon.sermon.audioMetadata.mode).toBe('ai');
            expect(sermon.sermon.audioChunks).toEqual(aiChunks);
            expect(global.fetch).not.toHaveBeenCalled();
        });
    });

    it('keeps the requested source selected after preparation fails without relabeling saved AI text', async () => {
        mockUseSermon.mockReturnValue(sermonWithChunks([{ index: 0, text: 'Polished opening', sectionId: 'introduction' }], { audioMetadata: { mode: 'ai', voice: 'onyx' } }));
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Optimize failed' }) });
        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();
        expect(await screen.findByText('Polished opening')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Original as-is'));
        await waitFor(() => expect(screen.getByText('Optimize failed')).toBeInTheDocument());
        expect(screen.getByRole('button', { name: /Original as-is/ })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: /AI-optimized/ })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.queryByText('Polished opening')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /AI-optimized/ }));
        await waitFor(() => expect(screen.getByRole('button', { name: /AI-optimized/ })).toHaveAttribute('aria-pressed', 'true'));
        expect(await screen.findByText('Polished opening')).toBeInTheDocument();
    });

    it('merges a versioned conflict without forcing the choice or assigning AI text to Original', async () => {
        const aiChunks = [{ index: 0, text: 'Polished opening', sectionId: 'introduction' }];
        const updatedAi = [{ index: 0, text: 'Opening corrected on the phone', sectionId: 'introduction' }];
        mockUseSermon.mockReturnValue(sermonWithChunks(aiChunks, { audioMetadata: { mode: 'ai', voice: 'onyx' } }));
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: false, status: 409,
            json: async () => ({ code: 'chunks-changed', mode: 'raw', chunks: [], sources: {
                ai: preparedSource('ai-source-new', 4, updatedAi),
            } }),
        });
        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();
        expect(await screen.findByText('Polished opening')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Original as-is'));
        await waitFor(() => expect(screen.getByText('audioExport.chunksChangedElsewhere')).toBeInTheDocument());
        expect(screen.getByRole('button', { name: /Original as-is/ })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByText('Opening corrected on the phone')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /AI-optimized/ }));
        expect(await screen.findByText('Opening corrected on the phone')).toBeInTheDocument();
        expect(screen.queryByText('Polished opening')).not.toBeInTheDocument();
    });

    it('keeps Original selected after an unanswered prepare and lets the user return to saved AI text', async () => {
        mockUseSermon.mockReturnValue(sermonWithChunks([{ index: 0, text: 'Polished opening', sectionId: 'introduction' }], { audioMetadata: { mode: 'ai', voice: 'onyx' } }));
        (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Failed to fetch'));
        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();
        expect(await screen.findByText('Polished opening')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Original as-is'));
        await waitFor(() => expect(screen.getByRole('button', { name: /Original as-is/ })).toHaveAttribute('aria-pressed', 'true'));
        expect(screen.queryByText('Polished opening')).not.toBeInTheDocument();
        expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();
        const aiSourceButton = screen.getByRole('button', { name: /AI-optimized/ });
        await waitFor(() => expect(aiSourceButton).toBeEnabled());
        fireEvent.click(aiSourceButton);
        await waitFor(() => expect(screen.getByRole('button', { name: /AI-optimized/ })).toHaveAttribute('aria-pressed', 'true'));
        expect(await screen.findByText('Polished opening')).toBeInTheDocument();
    });

    /**
     * THE TEXT ON SCREEN IS THE TEXT VOICED. Generation reads the database; whatever made the
     * wizard's view stale, the stored set comes back instead of audio made from other text.
     */
    it('shows the stored set instead of making audio from text other than the one shown', async () => {
        const aiChunks = [{ index: 0, text: 'Polished opening', sectionId: 'introduction' }];
        const rawChunks = [{ index: 0, text: 'Raw opening actually stored', sectionId: 'introduction' }];
        const sermon = sermonWithSources(aiChunks, [{ index: 0, text: 'Raw opening', sectionId: 'introduction' }]);
        mockUseSermon.mockReturnValue(sermon);
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({
            code: 'chunks-changed', mode: 'raw', chunks: rawChunks,
            sources: { ai: sermon.sermon.audioSources.ai, raw: preparedSource('raw-source-new', 6, rawChunks) },
        }) });
        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();
        expect(await screen.findByText('Polished opening')).toBeInTheDocument();
        await goToPreview();
        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));

        await waitFor(() => expect(screen.getByText('audioExport.chunksChangedBeforeAudio')).toBeInTheDocument());
        const generateCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url).endsWith('/audio/generate'));
        expect(JSON.parse(generateCall[1].body)).toMatchObject({ mode: 'ai', source: { id: 'ai-source', revision: 3 }, expected: aiChunks });
        expect(global.URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('keeps the typed correction when its chunk changed elsewhere, and never aims it at another', async () => {
        mockUseSermon.mockReturnValue(sermonWithChunks(
            [{ index: 0, text: 'Editable chunk', sectionId: 'introduction' }],
            { audioMetadata: { mode: 'ai', voice: 'onyx' } },
        ));
        (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 409, json: async () => ({
            code: 'chunks-changed', mode: 'ai', chunks: [{ index: 0, text: 'Changed on the phone', sectionId: 'introduction' }],
        }) });
        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();
        fireEvent.click(await screen.findByText('Editable chunk'));
        fireEvent.click(screen.getByRole('button', { name: 'Save chunk' }));

        await waitFor(() => expect(screen.getByText('audioExport.chunksChangedElsewhere')).toBeInTheDocument());
        expect(screen.getByTestId('chunk-editor-modal')).toBeInTheDocument();
        // A second save still names the set the window opened on — refused again, not re-aimed.
        fireEvent.click(screen.getByRole('button', { name: 'Save chunk' }));
        await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).endsWith('/audio/chunks/0'))).toHaveLength(2));
        const bodies = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).endsWith('/audio/chunks/0')).map(([, init]) => JSON.parse(init.body));
        expect(bodies.map(body => body.expected.map((chunk: { text: string }) => chunk.text))).toEqual([['Editable chunk'], ['Editable chunk']]);
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

        expect(await screen.findByText('Audio Ready!', {})).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Download Again/ })).toHaveAttribute('download', 'sermon.mp3');

        fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it('sends Google provider, Gemini model, and Google voice when generating', async () => {
        setTtsEntitlement('tier2', { providerId: 'gemini', modelId: 'gemini-3.1-flash-tts' });
        const rawChunks = [{ index: 0, text: 'Saved intro', sectionId: 'introduction' }];
        mockUseSermon.mockReturnValue(sermonWithSources([], rawChunks, 'raw', { ai: [], raw: ['introduction'] }));

        const encoder = new TextEncoder();
        const mockReader = {
            read: jest.fn()
                .mockResolvedValueOnce({ done: false, value: encoder.encode(JSON.stringify({ type: 'download_complete', filename: 'sermon.wav', mimeType: 'audio/wav' }) + '\n') })
                .mockResolvedValueOnce({ done: true, value: undefined }),
        };
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, body: { getReader: () => mockReader } });

        render(<StepByStepWizard {...defaultProps} />);
        fireEvent.click(screen.getByText(/Gemini 2\.5 TTS/));
        fireEvent.click(screen.getByText('Charon'));
        await goToSource();
        expect(await screen.findByText('Saved intro')).toBeInTheDocument();
        await goToPreview();
        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                '/api/sermons/sermon-123/audio/generate',
                expect.objectContaining({ method: 'POST', body: expect.any(String) }),
            );
        });

        const generateCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url).endsWith('/audio/generate'));
        expect(JSON.parse(generateCall[1].body)).not.toHaveProperty('quality');
        expect(JSON.parse(generateCall[1].body)).toMatchObject({
            provider: 'google',
            voice: 'Charon',
            model: 'gemini-2.5-flash-tts',
            mode: 'raw',
            source: { id: 'raw-source', revision: 5 },
            sections: ['introduction'], // seed restores selection from the only chunk's section
        });
        expect(generateCall[1].headers).toMatchObject({ Authorization: 'Bearer test-token' });
    });

    it('stitches a streamed batch into a downloadable blob on download_complete', async () => {
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
        expect(link).toHaveAttribute('href', 'blob:url');
        expect(link).toHaveAttribute('download', 'sermon_audio.mp3');

        // The base64 'AAAA' is decoded to BYTES (3 bytes) before going into the blob —
        // proving byte-level assembly, not base64-string concatenation.
        const blob = (global.URL.createObjectURL as jest.Mock).mock.calls.at(-1)?.[0] as Blob;
        expect(blob.type).toBe('audio/mpeg');
        expect(blob.size).toBe(3);
    });

    it('drives several sub-60s batches and byte-concatenates them (OpenAI)', async () => {
        // 4 intro chunks → 2 batches of 3 (offset 0/limit 3, then offset 3/limit 3).
        mockUseSermon.mockReturnValue(sermonWithChunks([0, 1, 2, 3].map(i => ({ index: i, text: `Intro ${i}`, sectionId: 'introduction' }))));

        const encoder = new TextEncoder();
        const streamFor = (data: string) => ({
            ok: true,
            body: {
                getReader: () => ({
                    read: jest.fn()
                        .mockResolvedValueOnce({ done: false, value: encoder.encode(JSON.stringify({ type: 'audio_chunk', data }) + '\n' + JSON.stringify({ type: 'download_complete', filename: 'sermon-audio.mp3', mimeType: 'audio/mpeg' }) + '\n') })
                        .mockResolvedValueOnce({ done: true, value: undefined }),
                }),
            },
        });
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce(streamFor('AAAA'))  // batch 1 → 3 bytes
            .mockResolvedValueOnce(streamFor('BBBB')); // batch 2 → 3 bytes

        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();
        await goToPreview();
        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));

        await screen.findByRole('link', { name: /Download Again/ });

        const generateCalls = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).endsWith('/audio/generate'));
        expect(generateCalls).toHaveLength(2);
        expect(JSON.parse(generateCalls[0][1].body)).toMatchObject({
            provider: 'openai',
            model: 'gpt-4o-mini-tts',
            sections: ['introduction'],
            offset: 0,
            limit: 3,
        });
        expect(JSON.parse(generateCalls[1][1].body)).toMatchObject({
            provider: 'openai',
            model: 'gpt-4o-mini-tts',
            sections: ['introduction'],
            offset: 3,
            limit: 3,
        });

        // Both batches' bytes land in one blob (3 + 3 = 6), concatenated in order.
        const blob = (global.URL.createObjectURL as jest.Mock).mock.calls.at(-1)?.[0] as Blob;
        expect(blob.size).toBe(6);
        expect(blob.type).toBe('audio/mpeg');
    });

    it('keeps finished batches and repeats only the batch whose chunk failed', async () => {
        // 4 intro chunks → batch 1 (chunks 1-3) succeeds, batch 2 (chunk 4) fails, then is repeated.
        mockUseSermon.mockReturnValue(sermonWithChunks([0, 1, 2, 3].map(i => ({ index: i, text: `Intro ${i}`, sectionId: 'introduction' }))));

        const encoder = new TextEncoder();
        const streamOf = (...events: object[]) => ({
            ok: true,
            body: {
                getReader: () => ({
                    read: jest.fn()
                        .mockResolvedValueOnce({ done: false, value: encoder.encode(events.map(e => JSON.stringify(e)).join('\n') + '\n') })
                        .mockResolvedValueOnce({ done: true, value: undefined }),
                }),
            },
        });
        const audio = (data: string) => streamOf({ type: 'audio_chunk', data }, { type: 'download_complete', filename: 'sermon-audio.mp3', mimeType: 'audio/mpeg' });
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce(audio('AAAA'))
            .mockResolvedValueOnce(streamOf({ type: 'error', code: 'tts-chunk-failed', chunks: [4], message: 'TTS chunk 4 failed' }))
            .mockResolvedValueOnce(audio('BBBB'));

        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();
        await goToPreview();
        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));

        // Nothing is downloaded with a hole in it; the person is told which part is missing.
        expect(await screen.findByText('audioExport.chunkFailed(4)')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /Download Again/ })).not.toBeInTheDocument();

        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));
        await screen.findByRole('link', { name: /Download Again/ });

        const bodies = (global.fetch as jest.Mock).mock.calls
            .filter(([url]) => String(url).endsWith('/audio/generate'))
            .map(([, init]) => JSON.parse(init.body));
        expect(bodies.map(body => body.offset)).toEqual([0, 3, 3]);
        const blob = (global.URL.createObjectURL as jest.Mock).mock.calls.at(-1)?.[0] as Blob;
        expect(blob.size).toBe(6);
    });

    it('resumes a Google export to the end of the server count, not the preview count', async () => {
        // One preview fragment that Google re-splits into two generation chunks; the second fails once.
        setTtsEntitlement('tier2', { providerId: 'gemini', modelId: 'gemini-3.1-flash-tts' });
        const googleChunks = [{ index: 0, text: 'Google long', sectionId: 'introduction' }];
        mockUseSermon.mockReturnValue(sermonWithSources([], googleChunks, 'raw', { ai: [], raw: ['introduction'] }));
        const encoder = new TextEncoder();
        const streamOf = (...events: object[]) => ({
            ok: true,
            body: { getReader: () => ({ read: jest.fn()
                .mockResolvedValueOnce({ done: false, value: encoder.encode(events.map(e => JSON.stringify(e)).join('\n') + '\n') })
                .mockResolvedValueOnce({ done: true, value: undefined }) }) },
        });
        const wav = (data: number[]) => streamOf({ type: 'audio_chunk', data: wavBase64(data) },
            { type: 'download_complete', filename: 'sermon-audio.wav', mimeType: 'audio/wav', totalChunks: 2 });
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce(wav([1, 2]))
            .mockResolvedValueOnce(streamOf({ type: 'error', code: 'tts-chunk-failed', chunks: [2], message: 'TTS chunk 2 failed' }))
            .mockResolvedValueOnce(wav([3, 4]));

        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();
        await waitFor(() => expect(screen.getByText('Google long')).toBeInTheDocument());
        await goToPreview();
        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));
        expect(await screen.findByText('audioExport.chunkFailed(2)')).toBeInTheDocument();

        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));
        await screen.findByRole('link', { name: /Download Again/ });

        const offsets = (global.fetch as jest.Mock).mock.calls
            .filter(([url]) => String(url).endsWith('/audio/generate'))
            .map(([, init]) => JSON.parse(init.body).offset);
        expect(offsets).toEqual([0, 1, 1]);
    });

    it('does not count a batch whose stream stopped before completion, and repeats it', async () => {
        mockUseSermon.mockReturnValue(sermonWithChunks([0, 1].map(i => ({ index: i, text: `Intro ${i}`, sectionId: 'introduction' }))));
        const encoder = new TextEncoder();
        const streamOf = (...events: object[]) => ({
            ok: true,
            body: { getReader: () => ({ read: jest.fn()
                .mockResolvedValueOnce({ done: false, value: encoder.encode(events.map(e => JSON.stringify(e)).join('\n') + '\n') })
                .mockResolvedValueOnce({ done: true, value: undefined }) }) },
        });
        (global.fetch as jest.Mock)
            // The connection drops after part of the audio: no completion event.
            .mockResolvedValueOnce(streamOf({ type: 'audio_chunk', data: 'AAAA' }))
            .mockResolvedValueOnce(streamOf({ type: 'audio_chunk', data: 'BBBB' }, { type: 'download_complete', filename: 'sermon-audio.mp3', mimeType: 'audio/mpeg' }));

        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();
        await goToPreview();
        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));

        expect(await screen.findByText('audioExport.streamInterrupted')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /Download Again/ })).not.toBeInTheDocument();

        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));
        await screen.findByRole('link', { name: /Download Again/ });
        const offsets = (global.fetch as jest.Mock).mock.calls
            .filter(([url]) => String(url).endsWith('/audio/generate'))
            .map(([, init]) => JSON.parse(init.body).offset);
        expect(offsets).toEqual([0, 0]);
        const bodies = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).endsWith('/audio/generate')).map(([, init]) => JSON.parse(init.body));
        expect(bodies[0].exportId).toEqual(expect.any(String));
        expect(bodies[1].exportId).toBe(bodies[0].exportId);
        const blob = (global.URL.createObjectURL as jest.Mock).mock.calls.at(-1)?.[0] as Blob;
        expect(blob.size).toBe(3);
    });

    // BUG-20261011-stream-and-clone-reads-unbounded: a stream that fails mid-way is the same broken
    // connection as one that stops short — said in the person's words, and only that batch repeats.
    it('lets matching retained work resume after allowance refresh reaches the cap', async () => {
        mockUseSermon.mockReturnValue(sermonWithChunks([0, 1].map(i => ({ index: i, text: `Intro ${i}`, sectionId: 'introduction' }))));
        const encoder = new TextEncoder();
        const streamOf = (...events: object[]) => ({
            ok: true,
            body: { getReader: () => ({ read: jest.fn()
                .mockResolvedValueOnce({ done: false, value: encoder.encode(events.map(e => JSON.stringify(e)).join('\n') + '\n') })
                .mockResolvedValueOnce({ done: true, value: undefined }) }) },
        });
        (global.fetch as jest.Mock)
            // The connection drops after part of the audio: no completion event.
            .mockResolvedValueOnce(streamOf({ type: 'audio_chunk', data: 'AAAA' }))
            .mockResolvedValueOnce(streamOf({ type: 'audio_chunk', data: 'BBBB' }, { type: 'download_complete', filename: 'sermon-audio.mp3', mimeType: 'audio/mpeg' }));

        const { rerender } = render(<StepByStepWizard {...defaultProps} />);
        await goToSource();
        await goToPreview();
        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));

        expect(await screen.findByText('audioExport.streamInterrupted')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /Download Again/ })).not.toBeInTheDocument();

        mockGenerationBlocked = true;
        rerender(<StepByStepWizard {...defaultProps} />);
        expect(await screen.findByRole('button', { name: /Generate Audio/ })).toBeEnabled();
        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));
        await screen.findByRole('link', { name: /Download Again/ });
        const offsets = (global.fetch as jest.Mock).mock.calls
            .filter(([url]) => String(url).endsWith('/audio/generate'))
            .map(([, init]) => JSON.parse(init.body).offset);
        expect(offsets).toEqual([0, 0]);
        const blob = (global.URL.createObjectURL as jest.Mock).mock.calls.at(-1)?.[0] as Blob;
        expect(blob.size).toBe(3);
    });

    // BUG-20261011-stream-and-clone-reads-unbounded: a stream that fails mid-way is the same broken
    // connection as one that stops short — said in the person's words, and only that batch repeats.
    it('says the connection broke when the stream fails mid-way, and repeats that batch', async () => {
        mockUseSermon.mockReturnValue(sermonWithChunks([0, 1].map(i => ({ index: i, text: `Intro ${i}`, sectionId: 'introduction' }))));
        const encoder = new TextEncoder();
        const line = (event: object) => encoder.encode(JSON.stringify(event) + '\n');
        const broken = { ok: true, body: { getReader: () => ({ read: jest.fn()
            .mockResolvedValueOnce({ done: false, value: line({ type: 'audio_chunk', data: 'AAAA' }) })
            .mockRejectedValueOnce(new TypeError('network error')) }) } };
        const whole = { ok: true, body: { getReader: () => ({ read: jest.fn()
            .mockResolvedValueOnce({ done: false, value: line({ type: 'audio_chunk', data: 'BBBB' }) })
            .mockResolvedValueOnce({ done: false, value: line({ type: 'download_complete', filename: 'sermon-audio.mp3', mimeType: 'audio/mpeg' }) })
            .mockResolvedValueOnce({ done: true, value: undefined }) }) } };
        (global.fetch as jest.Mock).mockResolvedValueOnce(broken).mockResolvedValueOnce(whole);

        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();
        await goToPreview();
        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));

        expect(await screen.findByText('audioExport.streamInterrupted')).toBeInTheDocument();
        expect(screen.queryByText('network error')).not.toBeInTheDocument();

        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));
        await screen.findByRole('link', { name: /Download Again/ });
        const offsets = (global.fetch as jest.Mock).mock.calls
            .filter(([url]) => String(url).endsWith('/audio/generate'))
            .map(([, init]) => JSON.parse(init.body).offset);
        expect(offsets).toEqual([0, 0]);
    });

    it('drives one quality chunk per Google batch and merges the WAV batches in-browser', async () => {
        setTtsEntitlement('tier2', { providerId: 'gemini', modelId: 'gemini-3.1-flash-tts' });
        const googleChunks = [0, 1, 2, 3].map(i => ({ index: i, text: `Google ${i}`, sectionId: i < 2 ? 'introduction' : 'mainPart' }));
        mockUseSermon.mockReturnValue(sermonWithSources([], googleChunks, 'raw', { ai: [], raw: ['introduction', 'mainPart'] }));

        const encoder = new TextEncoder();
        const streamFor = (data: number[]) => ({
            ok: true,
            body: {
                getReader: () => ({
                    read: jest.fn()
                        .mockResolvedValueOnce({
                            done: false,
                            value: encoder.encode(JSON.stringify({ type: 'audio_chunk', data: wavBase64(data) }) + '\n'
                                + JSON.stringify({ type: 'download_complete', filename: 'sermon-audio.wav', mimeType: 'audio/wav', totalChunks: 4 }) + '\n'),
                        })
                        .mockResolvedValueOnce({ done: true, value: undefined }),
                }),
            },
        });
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce(streamFor([1, 2]))
            .mockResolvedValueOnce(streamFor([3, 4]))
            .mockResolvedValueOnce(streamFor([5, 6]))
            .mockResolvedValueOnce(streamFor([7, 8]));

        render(<StepByStepWizard {...defaultProps} />);
        await goToSource();
        await waitFor(() => expect(screen.getByText('Google 0')).toBeInTheDocument());
        await goToPreview();
        fireEvent.click(await screen.findByRole('button', { name: /Generate Audio/ }));
        await screen.findByRole('link', { name: /Download Again/ });

        const generateCalls = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).endsWith('/audio/generate'));
        expect(generateCalls).toHaveLength(4);
        expect(generateCalls.map(([, init]) => JSON.parse(init.body))).toEqual([
            expect.objectContaining({ provider: 'google', offset: 0, limit: 1 }),
            expect.objectContaining({ provider: 'google', offset: 1, limit: 1 }),
            expect.objectContaining({ provider: 'google', offset: 2, limit: 1 }),
            expect.objectContaining({ provider: 'google', offset: 3, limit: 1 }),
        ]);

        const blob = (global.URL.createObjectURL as jest.Mock).mock.calls.at(-1)?.[0] as Blob;
        const merged = await blob.arrayBuffer();
        const view = new DataView(merged);
        expect(view.getUint32(0, false)).toBe(0x52494646);
        expect(view.getUint32(40, true)).toBe(8);
        expect(blob.type).toBe('audio/wav');
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

        // Said by its key when shown (BUG-20261006-screen-error-kept-as-translated-sentence); the key is in all three locales.
        await waitFor(() => expect(screen.getByText('audioExport.generationCancelled')).toBeInTheDocument());
        expect(screen.getByRole('button', { name: /Generate Audio/ })).toBeInTheDocument();
    });
});

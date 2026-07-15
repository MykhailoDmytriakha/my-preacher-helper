/**
 * Audio Studio — step-by-step wizard for sermon audio generation.
 *
 * Four screens, all inside one near-fullscreen modal:
 *  1. Settings — provider (OpenAI / Google), model, voice (with preview), sections.
 *  2. Source — "Original as-is" (one read-only column) or "AI-optimized"
 *     (two columns: original on the left for comparison, editable AI chunks on
 *     the right; the optimized text is produced on demand with a button).
 *     AI optimization is OpenAI-only, so the tab is hidden for Google.
 *  3. Preview — the final narration text assembled into one read-only block per
 *     major section (introduction / main / conclusion).
 *  4. Generation — streaming progress, then the player + download (unchanged).
 *
 * Invariant: the DB is the source of truth for generation — /generate reads
 * chunks from Firestore, so every source switch syncs the DB before Generate.
 *
 * Styling follows the site design system: clean white / gray-900 surfaces,
 * orange accent used sparingly (soft active states, one strong primary CTA).
 */

'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
    ArrowRight, ArrowLeft, Loader2, FileText, Play, Square, Sparkles,
    AlertTriangle, Check, Download, AudioLines, Pencil, Mic, Cpu, Clock, Eye, Layers,
} from 'lucide-react';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { GOOGLE_SMALL_CHUNKING } from '@/config/audioGeneration';
import { useAiUsage } from '@/hooks/useAiUsage';
import { useAuth } from '@/hooks/useAuth';
import useSermon from '@/hooks/useSermon';
import { useUserEntitlement } from '@/hooks/useUserEntitlement';
import {
    AVAILABLE_VOICES,
    SERMON_SECTIONS,
    AudioChunk,
    AudioQuality,
    AudioSourceMode,
    GoogleTTSModel,
    GoogleTTSVoice,
    TTSProvider,
    TTSVoice,
    SermonSection,
} from '@/types/audioGeneration.types';
import { concatenateAudioBlobs } from '@/utils/audioConcat';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { getSortedThoughts } from '@/utils/sermonSorting';
import { SERMON_SECTION_COLORS } from '@/utils/themeColors';

import ChunkEditorModal from './ChunkEditorModal';

// ============================================================================
// Types
// ============================================================================

interface ChunkPreview extends AudioChunk {
    preview?: string;
}

interface StreamEvent {
    type: 'progress' | 'complete' | 'error' | 'audio_chunk' | 'download_complete';
    current?: number;
    total?: number;
    percent?: number;
    status?: string;
    audioUrl?: string;
    filename?: string;
    mimeType?: string;
    message?: string;
    data?: string;
    totalChunks?: number;
}

type WizardStep = 1 | 2 | 3;
type StudioView = 'working' | 'generating' | 'success';

export interface StepByStepWizardProps {
    sermonId: string;
    sermonTitle: string;
    onClose: () => void;
    onGeneratingChange?: (generating: boolean) => void;
    onStepChange?: (step: number) => void;
    isEnabled?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const GOOGLE_MODEL_GEMINI_31: GoogleTTSModel = 'gemini-3.1-flash-tts';
const GOOGLE_MODEL_GEMINI_25: GoogleTTSModel = 'gemini-2.5-flash-tts';
const OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';

/** Curated male voices for Google TTS, ordered youngest → oldest sounding. */
const GOOGLE_VOICE_OPTIONS: { id: GoogleTTSVoice; descKey: string; descDefault: string }[] = [
    { id: 'Puck', descKey: 'audioExport.googleVoicePuck', descDefault: 'молодой, бодрый' },
    { id: 'Iapetus', descKey: 'audioExport.googleVoiceIapetus', descDefault: 'чёткий, ровный' },
    { id: 'Orus', descKey: 'audioExport.googleVoiceOrus', descDefault: 'твёрдый, уверенный' },
    { id: 'Charon', descKey: 'audioExport.googleVoiceCharon', descDefault: 'глубокий, тёплый' },
];

const ACTIVE_PILL = 'border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-500/60 dark:bg-orange-500/10 dark:text-orange-300';
const INACTIVE_PILL = 'border-gray-200 bg-white text-gray-600 hover:border-orange-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300';

/** Class for a secondary description: dimmed when its option is active, muted otherwise. */
const mutedDescClass = (active: boolean): string => (active ? 'opacity-70' : 'text-gray-400');

// ============================================================================
// Helpers
// ============================================================================

const googleModelShort = (model: GoogleTTSModel): string =>
    model === GOOGLE_MODEL_GEMINI_25 ? '2.5' : '3.1';

/**
 * How many chunks one /generate request handles. Each OpenAI TTS chunk takes
 * ~15-30s, and Vercel's free-tier function cap is a hard 60s, so the browser
 * drives several small requests instead of one big one that would time out.
 * 3 chunks run in parallel server-side (~one chunk's wall time + margin) — safely
 * under 60s — and the browser stitches the batches into one file.
 */
const GENERATION_BATCH_SIZE = 3;
const GOOGLE_GENERATION_BATCH_SIZE = 1;

/**
 * Decode a complete base64 string to raw bytes. We decode each batch to BYTES and
 * concatenate those — concatenating the base64 STRINGS instead would inject padding
 * '=' mid-stream wherever a part's length isn't a multiple of 3. OpenAI MP3 frames
 * are byte-concatenated; Google WAV batches go through the PCM-aware WAV merger.
 */
function base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/** Mutable accumulator for one batch's stream: base64 audio parts + final metadata. */
interface BatchAccumulator {
    audioDataParts: string[];
    filename?: string;
    mimeType?: string;
    totalChunks?: number;
}

/** Apply one parsed stream event to the accumulator. Throws on an `error` event. */
function applyBatchEvent(
    event: StreamEvent,
    acc: BatchAccumulator,
    onChunkProgress: (current: number, total: number) => void,
): void {
    if (event.type === 'audio_chunk') {
        if (event.data) acc.audioDataParts.push(event.data);
    } else if (event.type === 'progress') {
        if (typeof event.current === 'number' && typeof event.total === 'number') {
            onChunkProgress(event.current, event.total);
        }
    } else if (event.type === 'download_complete' || event.type === 'complete') {
        acc.filename = event.filename;
        acc.mimeType = event.mimeType;
        acc.totalChunks = event.totalChunks;
    } else if (event.type === 'error') {
        throw new Error(event.message || 'Generation failed');
    }
}

// ============================================================================
// Main Component
// ============================================================================

export default function StepByStepWizard({
    sermonId,
    sermonTitle: _sermonTitle,
    onClose,
    onGeneratingChange,
    onStepChange,
    isEnabled: _isEnabled = true,
}: StepByStepWizardProps) {
    const { t, i18n } = useTranslation();
    const { user } = useAuth();
    const charsLabel = t('audioExport.chars', { defaultValue: 'симв.' });
    const aiSourceLabel = t('audioExport.sourceAi', { defaultValue: 'AI-optimized' });

    // Settings
    const [ttsProvider, setTtsProvider] = useState<TTSProvider>('openai');
    const [voice, setVoice] = useState<TTSVoice>('onyx');
    const [quality, setQuality] = useState<AudioQuality>('standard');
    const [googleModel, setGoogleModel] = useState<GoogleTTSModel>(GOOGLE_MODEL_GEMINI_31);
    const [googleVoice, setGoogleVoice] = useState<GoogleTTSVoice>('Puck');
    const [sections, setSections] = useState<SermonSection[]>([...SERMON_SECTIONS]);

    // Source mode + per-mode cache so flipping back and forth is instant
    const [mode, setMode] = useState<AudioSourceMode>('ai');
    const chunksByMode = useRef<Partial<Record<AudioSourceMode, ChunkPreview[]>>>({});

    // Content
    const [chunks, setChunks] = useState<ChunkPreview[]>([]);

    // Wizard + view state
    const [step, setStep] = useState<WizardStep>(1);
    const [view, setView] = useState<StudioView>('working');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editingChunk, setEditingChunk] = useState<ChunkPreview | null>(null);

    // Generation
    const [genProgress, setGenProgress] = useState<{ current: number; total: number; percent?: number; status?: string }>({ current: 0, total: 0 });
    const [abortController, setAbortController] = useState<AbortController | null>(null);
    const [generatedFile, setGeneratedFile] = useState<{ url: string; filename: string } | null>(null);

    // Voice preview
    const [playingPreview, setPlayingPreview] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const { sermon } = useSermon(sermonId);
    const { aiBlocked, refresh: refreshAiUsage } = useAiUsage();
    const {
        data: userEntitlement,
        isLoading: entitlementLoading,
        isError: entitlementError,
    } = useUserEntitlement(user);

    const availableTtsTargets = userEntitlement?.functions?.tts.available ?? [];
    const entitlementSeeded = useRef(false);
    useEffect(() => {
        if (entitlementSeeded.current || !userEntitlement?.functions?.tts) return;
        const current = userEntitlement.functions.tts.current;
        if (current.providerId === 'gemini') {
            setTtsProvider('google');
            setGoogleModel(current.modelId === GOOGLE_MODEL_GEMINI_25
                ? GOOGLE_MODEL_GEMINI_25
                : GOOGLE_MODEL_GEMINI_31);
            setMode('raw');
        } else {
            setTtsProvider('openai');
        }
        entitlementSeeded.current = true;
    }, [userEntitlement]);

    // Report "busy" so the modal can guard its close button
    useEffect(() => {
        onGeneratingChange?.(isLoading || view === 'generating');
    }, [isLoading, view, onGeneratingChange]);

    // Report the active step (1-3 = wizard, 4 = generation/success) so the modal
    // header can render the stepper above the body.
    useEffect(() => {
        onStepChange?.(view === 'working' ? step : 4);
    }, [step, view, onStepChange]);

    // A stale error from a previous step shouldn't follow the user around.
    useEffect(() => { setError(null); }, [step]);

    // The generated file is now a blob: object URL (batches are stitched in-browser),
    // so revoke the previous one when it's replaced or the modal unmounts.
    useEffect(() => {
        const url = generatedFile?.url;
        return () => { if (url && url.startsWith('blob:')) URL.revokeObjectURL(url); };
    }, [generatedFile]);

    // ------------------------------------------------------------------
    // Load existing chunks (from a previous session) once the sermon loads
    // ------------------------------------------------------------------
    const seeded = useRef(false);
    useEffect(() => {
        if (seeded.current || !sermon) return;
        const savedProvider: TTSProvider = sermon.audioMetadata?.provider === 'google' ? 'google' : 'openai';
        if (savedProvider === 'google') {
            if (GOOGLE_VOICE_OPTIONS.some(option => option.id === sermon.audioMetadata?.voice)) {
                setGoogleVoice(sermon.audioMetadata?.voice as GoogleTTSVoice);
            }
        } else if (AVAILABLE_VOICES.some(option => option.id === sermon.audioMetadata?.voice)) {
            setVoice(sermon.audioMetadata?.voice as TTSVoice);
        }

        const existing = (sermon.audioChunks || []) as AudioChunk[];
        if (existing.length > 0) {
            const loaded: ChunkPreview[] = existing.map(c => ({ ...c, sectionId: c.sectionId as SermonSection, preview: c.text }));
            // Restore the section selection from the sections that actually have chunks,
            // so the checkboxes match what /generate will read from the DB.
            const present = SERMON_SECTIONS.filter(k => loaded.some(c => c.sectionId === k));
            if (present.length > 0) setSections(present);
            // The true source label of the persisted chunks.
            const trueMode: AudioSourceMode = sermon.audioMetadata?.mode === 'raw' ? 'raw' : 'ai';
            chunksByMode.current[trueMode] = loaded;
            if (ttsProvider === 'google') {
                // Google only supports raw. If the persisted chunks are AI-optimized,
                // do NOT present them as raw — leave raw empty so the user re-prepares.
                setMode('raw');
                if (trueMode === 'raw') setChunks(loaded);
            } else {
                setMode(trueMode);
                setChunks(loaded);
            }
        } else if (ttsProvider === 'google') {
            setMode('raw');
        }
        seeded.current = true;
    }, [sermon, ttsProvider]);

    // ------------------------------------------------------------------
    // Voice preview (samples in /public/samples)
    //   OpenAI:  {voice}-{quality}-{lang}.mp3
    //   Google:  {voice}-{modelShort}-{lang}.wav   (per Gemini 3.1 / 2.5)
    // ------------------------------------------------------------------
    const togglePreview = useCallback((voiceId: string) => {
        if (playingPreview === voiceId) {
            audioRef.current?.pause();
            audioRef.current = null;
            setPlayingPreview(null);
            return;
        }
        if (audioRef.current) audioRef.current.pause();

        const lang = i18n.language.split('-')[0] || 'en';
        const fileLang = ['en', 'ru', 'uk'].includes(lang) ? lang : 'en';
        const url = ttsProvider === 'google'
            ? `/samples/${voiceId}-${googleModelShort(googleModel)}-${fileLang}.wav`
            : `/samples/${voiceId}-${quality}-${fileLang}.mp3`;

        const audio = new Audio(url);
        audio.volume = 0.8;
        audio.onended = () => setPlayingPreview(null);
        audio.onerror = () => {
            console.warn(`Failed to load sample: ${url}`);
            toast.error(t('audioExport.sampleError', { defaultValue: 'Sample not available' }));
            setPlayingPreview(null);
        };
        audio.play().catch(e => console.error('Playback failed', e));
        audioRef.current = audio;
        setPlayingPreview(voiceId);
    }, [playingPreview, ttsProvider, googleModel, quality, t, i18n.language]);

    useEffect(() => () => { audioRef.current?.pause(); }, []);
    // Stop any preview when provider/model/quality changes (the sample URL changes).
    useEffect(() => { audioRef.current?.pause(); setPlayingPreview(null); }, [ttsProvider, googleModel, quality, voice, googleVoice]);

    // ------------------------------------------------------------------
    // Generate one request's worth of audio (a batch of chunks) and return its
    // decoded bytes. Parses the server's newline-delimited JSON stream: `progress`
    // events drive the callback, `audio_chunk` events carry base64 audio, and
    // `download_complete` carries the filename + mime type.
    // ------------------------------------------------------------------
    const fetchBatchBytes = useCallback(async (
        body: Record<string, unknown>,
        signal: AbortSignal,
        onChunkProgress: (current: number, total: number) => void,
    ): Promise<{ bytes: Uint8Array; filename?: string; mimeType?: string; totalChunks?: number }> => {
        const authHeaders = await getAuthenticatedRequestHeaders();
        const response = await fetch(`/api/sermons/${sermonId}/audio/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify(body),
            signal,
        });
        if (!response.ok || !response.body) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Generation failed');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const acc: BatchAccumulator = { audioDataParts: [] };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                let event: StreamEvent;
                try {
                    event = JSON.parse(trimmed);
                } catch (e) {
                    console.error('Failed to parse stream line:', trimmed, e);
                    continue;
                }
                applyBatchEvent(event, acc, onChunkProgress);
            }
        }

        return {
            bytes: base64ToUint8Array(acc.audioDataParts.join('')),
            filename: acc.filename,
            mimeType: acc.mimeType,
            totalChunks: acc.totalChunks,
        };
    }, [sermonId]);

    // ------------------------------------------------------------------
    // Persist a cached chunk set so /generate (which reads the DB) stays in sync
    // ------------------------------------------------------------------
    const syncChunksToDb = useCallback(async (cached: ChunkPreview[], targetMode: AudioSourceMode) => {
        setIsLoading(true);
        try {
            const authHeaders = await getAuthenticatedRequestHeaders();
            await fetch(`/api/sermons/${sermonId}/audio/chunks`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({ chunks: cached, mode: targetMode }),
            });
        } catch (err) {
            console.error('Mode sync failed:', err);
        } finally {
            setIsLoading(false);
        }
    }, [sermonId]);

    // ------------------------------------------------------------------
    // Prepare text for a given source (AI optimize OR raw split)
    // ------------------------------------------------------------------
    const prepareSource = useCallback(async (targetMode: AudioSourceMode) => {
        if (aiBlocked) return;
        setIsLoading(true);
        setError(null);
        setMode(targetMode); // switch the layout to the target source now so loading shows in place
        try {
            const authHeaders = await getAuthenticatedRequestHeaders();
            const response = await fetch(`/api/sermons/${sermonId}/audio/optimize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders },
                body: JSON.stringify({
                    sections,
                    provider: ttsProvider,
                    saveToDb: true,
                    useRawText: targetMode === 'raw',
                }),
            });
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Optimization failed');
            }
            const data = await response.json();
            const newChunks: ChunkPreview[] = data.chunks;

            chunksByMode.current[targetMode] = newChunks;
            setMode(targetMode);
            setChunks(newChunks);
            if (targetMode === 'ai') {
                await refreshAiUsage();
            }
        } catch (err: unknown) {
            console.error('Prepare error:', err);
            setError(err instanceof Error ? err.message : 'Optimization failed');
        } finally {
            setIsLoading(false);
        }
    }, [aiBlocked, refreshAiUsage, sermonId, sections, ttsProvider]);

    // ------------------------------------------------------------------
    // Switch source tab. Raw is mechanical (auto-prepared); AI is explicit
    // (a button triggers prepareSource('ai')).
    // ------------------------------------------------------------------
    const selectSource = useCallback(async (targetMode: AudioSourceMode) => {
        if (targetMode === mode) return;
        setError(null);
        const cached = chunksByMode.current[targetMode];

        if (targetMode === 'ai') {
            setMode('ai');
            if (cached && cached.length > 0) {
                setChunks(cached);
                await syncChunksToDb(cached, 'ai');
            } else {
                setChunks([]);
            }
            return;
        }

        // raw preview is view-only and must mirror the current Structure order,
        // so rebuild it instead of trusting possibly stale persisted chunks.
        await prepareSource('raw');
    }, [mode, prepareSource, syncChunksToDb]);

    // ------------------------------------------------------------------
    // Edit a single chunk
    // ------------------------------------------------------------------
    const handleSaveChunk = useCallback(async (index: number, newText: string) => {
        const authHeaders = await getAuthenticatedRequestHeaders();
        const response = await fetch(`/api/sermons/${sermonId}/audio/chunks/${index}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...authHeaders },
            body: JSON.stringify({ text: newText }),
        });
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Save failed');
        }
        await response.json();
        const updater = (c: ChunkPreview) => (c.index === index ? { ...c, text: newText, preview: newText } : c);
        setChunks(prev => {
            const next = prev.map(updater);
            chunksByMode.current[mode] = next;
            return next;
        });
        setEditingChunk(null);
    }, [sermonId, mode]);

    // ------------------------------------------------------------------
    // Generate audio (TTS)
    // ------------------------------------------------------------------
    const handleGenerate = useCallback(async () => {
        if (aiBlocked) return;
        const isGoogle = ttsProvider === 'google';
        const totalChunks = chunks.filter(c => sections.includes(c.sectionId)).length;

        setError(null);
        setView('generating');
        setGenProgress({ current: 0, total: totalChunks, percent: 0 });
        const controller = new AbortController();
        setAbortController(controller);

        const baseBody: Record<string, unknown> = {
            provider: ttsProvider,
            voice: isGoogle ? googleVoice : voice,
            quality,
            model: isGoogle ? googleModel : OPENAI_TTS_MODEL,
            sections,
        };

        try {
            const parts: Uint8Array[] = [];
            let filename: string | undefined;
            let mimeType: string | undefined;

            if (isGoogle && !GOOGLE_SMALL_CHUNKING) {
                // Reversible legacy path: one server request containing section pieces.
                const res = await fetchBatchBytes(baseBody, controller.signal, (current, total) =>
                    setGenProgress({ current, total, percent: Math.round((current / (total || 1)) * 100) }),
                );
                parts.push(res.bytes);
                filename = res.filename;
                mimeType = res.mimeType;
            } else if (isGoogle) {
                // Google runs serially server-side, so one ~1750-char quality chunk per
                // request keeps every function invocation safely below 60 seconds.
                let offset = 0;
                let serverTotal = Math.max(1, totalChunks);
                while (offset < serverTotal) {
                    const res = await fetchBatchBytes(
                        { ...baseBody, offset, limit: GOOGLE_GENERATION_BATCH_SIZE },
                        controller.signal,
                        (current) => {
                            const overall = Math.min(serverTotal, offset + current);
                            setGenProgress({ current: overall, total: serverTotal, percent: Math.round((overall / serverTotal) * 100) });
                        },
                    );
                    if (typeof res.totalChunks === 'number' && res.totalChunks > 0) {
                        serverTotal = res.totalChunks;
                    }
                    parts.push(res.bytes);
                    filename = res.filename ?? filename;
                    mimeType = res.mimeType ?? mimeType;
                    offset += GOOGLE_GENERATION_BATCH_SIZE;
                    const completed = Math.min(offset, serverTotal);
                    setGenProgress({ current: completed, total: serverTotal, percent: Math.round((completed / serverTotal) * 100) });
                }
            } else {
                // OpenAI: drive batches of GENERATION_BATCH_SIZE chunks, each its own
                // sub-60s request, then byte-concatenate the returned MP3 streams.
                const numBatches = Math.max(1, Math.ceil(totalChunks / GENERATION_BATCH_SIZE));
                let completedBefore = 0;
                for (let b = 0; b < numBatches; b++) {
                    const offset = b * GENERATION_BATCH_SIZE;
                    const sizeThisBatch = Math.min(GENERATION_BATCH_SIZE, totalChunks - offset);
                    const res = await fetchBatchBytes(
                        { ...baseBody, offset, limit: GENERATION_BATCH_SIZE },
                        controller.signal,
                        (current) => {
                            const overall = Math.min(totalChunks, completedBefore + current);
                            setGenProgress({ current: overall, total: totalChunks, percent: Math.round((overall / totalChunks) * 100) });
                        },
                    );
                    parts.push(res.bytes);
                    filename = res.filename ?? filename;
                    mimeType = res.mimeType ?? mimeType;
                    completedBefore += sizeThisBatch;
                    setGenProgress({ current: completedBefore, total: totalChunks, percent: Math.round((completedBefore / totalChunks) * 100) });
                }
            }

            const finalMime = mimeType || (isGoogle ? 'audio/wav' : 'audio/mpeg');
            const finalName = filename || (isGoogle ? 'sermon_audio.wav' : 'sermon_audio.mp3');
            const finalBlob = isGoogle && parts.length > 1
                ? await concatenateAudioBlobs(parts.map(bytes => new Blob([bytes], { type: finalMime })))
                : new Blob(parts, { type: finalMime });
            const url = URL.createObjectURL(finalBlob);

            const link = document.createElement('a');
            link.href = url;
            link.download = finalName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            setGeneratedFile({ url, filename: finalName });
            setGenProgress(prev => ({ ...prev, percent: 100 }));
            setView('success');
            await refreshAiUsage();
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                setError(t('audioExport.generationCancelled', { defaultValue: 'Generation cancelled' }));
            } else {
                setError(err instanceof Error ? err.message : 'Unknown error');
            }
            setView('working');
        } finally {
            setAbortController(null);
        }
    }, [aiBlocked, ttsProvider, googleVoice, voice, quality, googleModel, sections, chunks, fetchBatchBytes, refreshAiUsage, t]);

    const handleCancelGeneration = useCallback(() => abortController?.abort(), [abortController]);

    // ------------------------------------------------------------------
    // Navigation
    // ------------------------------------------------------------------
    const goToStep2 = useCallback(async () => {
        setStep(2);
        // Ensure raw preview/generation mirrors the current Structure order.
        if (mode === 'raw') {
            await prepareSource('raw');
        }
    }, [mode, prepareSource]);

    const setProvider = useCallback((p: TTSProvider) => {
        const providerId = p === 'google' ? 'gemini' : 'openai';
        const firstAllowed = availableTtsTargets.find(target => target.providerId === providerId);
        if (!firstAllowed) return;
        setTtsProvider(p);
        if (p === 'google') {
            // Google has no AI optimization — force the raw source.
            setMode('raw');
            setGoogleModel(firstAllowed.modelId === GOOGLE_MODEL_GEMINI_25
                ? GOOGLE_MODEL_GEMINI_25
                : GOOGLE_MODEL_GEMINI_31);
            setGoogleVoice(prev => prev || 'Puck');
        }
    }, [availableTtsTargets]);

    // ============================================================================
    // Section config / derived
    // ============================================================================
    const SECTIONS_CONFIG = [
        { id: 'introduction' as SermonSection, label: t('audioExport.sectionsIntro', { defaultValue: 'Introduction' }), colorKey: 'introduction' },
        { id: 'mainPart' as SermonSection, label: t('audioExport.sectionsMain', { defaultValue: 'Main Part' }), colorKey: 'mainPart' },
        { id: 'conclusion' as SermonSection, label: t('audioExport.sectionsConclusion', { defaultValue: 'Conclusion' }), colorKey: 'conclusion' },
    ];
    const visibleSections = SECTIONS_CONFIG.filter(s => sections.includes(s.id));

    const getThoughtsForSection = (sectionId: SermonSection) => {
        if (!sermon) return [];
        const mapped = sectionId === 'mainPart' ? 'main' : sectionId as 'introduction' | 'main' | 'conclusion';
        return getSortedThoughts(sermon, mapped);
    };

    const toggleSection = (id: SermonSection) => {
        const has = sections.includes(id);
        if (has && sections.length === 1) return; // keep at least one
        const next = has
            ? sections.filter(x => x !== id)
            : SERMON_SECTIONS.filter(k => k === id || sections.includes(k)); // canonical order
        setSections(next);
        // Prepared chunks no longer match the selection — invalidate so the user
        // re-prepares for the new set (keeps DB / preview / generate consistent).
        chunksByMode.current = {};
        setChunks([]);
    };

    const labelRow = (text: string) => (
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{text}</span>
    );

    // ============================================================================
    // Render: STEP 1 — settings
    // ============================================================================
    const renderStep1 = () => {
        if (entitlementError) {
            return (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300" role="alert">
                    {t('audioExport.modelsLoadError', { defaultValue: 'Could not load the voice models available for your plan.' })}
                </div>
            );
        }
        if (entitlementLoading || !userEntitlement?.functions?.tts) {
            return (
                <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400" data-testid="tts-models-loading">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('audioExport.modelsLoading', { defaultValue: 'Loading available voice models...' })}
                </div>
            );
        }

        const allProviderOptions: { id: TTSProvider; label: string; sub: string }[] = [
            { id: 'openai', label: t('audioExport.providerOpenai', { defaultValue: 'OpenAI' }), sub: t('audioExport.providerOpenaiSub', { defaultValue: 'Onyx · Echo' }) },
            { id: 'google', label: t('audioExport.providerGoogle', { defaultValue: 'Google' }), sub: t('audioExport.providerGoogleSub', { defaultValue: 'Gemini · 4 голоса' }) },
        ];
        const providerOptions = allProviderOptions.filter(option => availableTtsTargets.some(target =>
            target.providerId === (option.id === 'google' ? 'gemini' : 'openai')));
        const selectedProviderId = ttsProvider === 'google' ? 'gemini' : 'openai';
        const modelOptions = availableTtsTargets.filter(target => target.providerId === selectedProviderId);

        return (
            <div className="space-y-6">
                <div className="flex flex-col gap-6 sm:flex-row sm:gap-8">
                    {/* Provider — vertical list */}
                    <div className="flex flex-col items-start gap-2 sm:w-52 sm:flex-shrink-0">
                        {labelRow(t('audioExport.providerLabel', { defaultValue: 'Provider' }))}
                        <div className="flex w-full flex-col gap-2">
                            {providerOptions.map(p => {
                                const sel = ttsProvider === p.id;
                                return (
                                    <button
                                        key={p.id}
                                        onClick={() => setProvider(p.id)}
                                        className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm font-semibold transition-colors ${sel ? ACTIVE_PILL : INACTIVE_PILL}`}
                                    >
                                        <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 ${sel ? 'border-orange-500' : 'border-gray-300 dark:border-gray-600'}`}>
                                            {sel && <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />}
                                        </span>
                                        <span className="flex flex-col leading-tight">
                                            <span>{p.label}</span>
                                            <span className={`text-[11px] font-medium ${mutedDescClass(sel)}`}>{p.sub}</span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Model + Voice (reserved height so switching provider doesn't jump) */}
                    <div className="flex min-w-0 flex-1 flex-col gap-5">
                        <div className="flex flex-col items-start gap-2">
                            {labelRow(t('audioExport.modelLabel', { defaultValue: 'Model' }))}
                            <div className="flex flex-wrap gap-2">
                                {modelOptions.map(model => {
                                    const isGoogleModel = model.providerId === 'gemini';
                                    const selected = isGoogleModel
                                        ? googleModel === model.modelId
                                        : ttsProvider === 'openai';
                                    const defaultLabel = model.modelId === GOOGLE_MODEL_GEMINI_31
                                        ? 'Gemini 3.1 TTS'
                                        : model.modelId === GOOGLE_MODEL_GEMINI_25
                                            ? 'Gemini 2.5 TTS'
                                            : model.modelId;
                                    const description = model.modelId === GOOGLE_MODEL_GEMINI_31
                                        ? t('audioExport.googleModelGemini31Desc', { defaultValue: 'Expressive' })
                                        : model.modelId === GOOGLE_MODEL_GEMINI_25
                                            ? t('audioExport.googleModelGemini25Desc', { defaultValue: 'Reliable' })
                                            : t('audioExport.openaiModelDesc', { defaultValue: 'Natural, steerable speech' });
                                    return (
                                        <button
                                            key={`${model.providerId}:${model.modelId}`}
                                            type="button"
                                            onClick={() => {
                                                if (isGoogleModel) setGoogleModel(model.modelId as GoogleTTSModel);
                                            }}
                                            className={`rounded-lg border px-3 py-2 text-left transition-colors ${selected ? ACTIVE_PILL : INACTIVE_PILL}`}
                                        >
                                            <span className="block text-sm font-semibold leading-tight">{defaultLabel}</span>
                                            <span className={`block text-[11px] ${mutedDescClass(selected)}`}>{description}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="flex flex-col items-start gap-2">
                            {labelRow(t('audioExport.qualityLabel', { defaultValue: 'Quality' }))}
                            <div className="flex flex-wrap gap-2">
                                {(['standard', 'hd'] as AudioQuality[]).map(q => {
                                    const selected = quality === q;
                                    return (
                                        <button
                                            key={q}
                                            type="button"
                                            onClick={() => setQuality(q)}
                                            className={`rounded-lg border px-3 py-2 text-left transition-colors ${selected ? ACTIVE_PILL : INACTIVE_PILL}`}
                                        >
                                            <span className="block text-sm font-semibold leading-tight">
                                                {q === 'standard' ? t('audioExport.qualityStandard', { defaultValue: 'Standard' }) : t('audioExport.qualityHd', { defaultValue: 'HD' })}
                                            </span>
                                            <span className={`block text-[11px] ${mutedDescClass(selected)}`}>
                                                {q === 'standard' ? t('audioExport.qualityStandardDesc', { defaultValue: 'faster, cheaper' }) : t('audioExport.qualityHdDesc', { defaultValue: 'clearer sound' })}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="flex w-full flex-col items-start gap-2">
                            {labelRow(t('audioExport.voiceLabel', { defaultValue: 'Voice' }))}
                            <div className="min-h-[7.5rem] w-full">
                                <div className="flex flex-wrap gap-2">
                                    {ttsProvider === 'openai'
                                        ? AVAILABLE_VOICES.map(v => renderVoicePill(v.id, v.id.charAt(0).toUpperCase() + v.id.slice(1), t(v.descKey, { defaultValue: '' }), voice === v.id, () => setVoice(v.id)))
                                        : GOOGLE_VOICE_OPTIONS.map(v => renderVoicePill(v.id, v.id, t(v.descKey, { defaultValue: v.descDefault }), googleVoice === v.id, () => setGoogleVoice(v.id)))}
                                </div>
                                <p className="mt-2 text-[11px] text-gray-400">
                                    {ttsProvider === 'google'
                                        ? t('audioExport.googleVoiceHint', { defaultValue: '4 мужских голоса — от молодого (слева) к старшему (справа). ▷ — прослушать.' })
                                        : t('audioExport.openaiVoiceHint', { defaultValue: 'Голоса OpenAI. ▷ — прослушать.' })}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {userEntitlement.effectiveTier === 'free' && (
                    <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900/50 dark:text-gray-400">
                        {t('audioExport.freeModelLocked', { defaultValue: 'Your plan uses the configured default voice model.' })}
                    </p>
                )}

                {ttsProvider === 'google' && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] leading-snug text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <span>
                            {t('audioExport.googleQualityWarning', {
                                defaultValue: 'Google: на длинных текстах голос может искажаться к концу (свист, металл). Gemini 3.1 выразительнее, но «плывёт» раньше 2.5. Для длинных проповедей надёжнее OpenAI.',
                            })}
                        </span>
                    </div>
                )}

                {/* Sections — checkboxes */}
                <div className="flex flex-col items-start gap-2 border-t border-gray-100 pt-5 dark:border-gray-800">
                    {labelRow(t('audioExport.sectionsLabel', { defaultValue: 'Sections' }))}
                    <div className="flex flex-wrap gap-2">
                        {SECTIONS_CONFIG.map(s => {
                            const on = sections.includes(s.id);
                            const theme = SERMON_SECTION_COLORS[s.colorKey as keyof typeof SERMON_SECTION_COLORS];
                            return (
                                <button
                                    key={s.id}
                                    onClick={() => toggleSection(s.id)}
                                    className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${on ? 'border-gray-300 bg-white text-gray-700 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200' : 'border-gray-200 bg-gray-50 text-gray-400 dark:border-gray-800 dark:bg-gray-800/40'}`}
                                >
                                    <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? 'border-orange-500 bg-orange-500 text-white' : 'border-gray-300 dark:border-gray-600'}`}>
                                        {on && <Check className="h-3 w-3" />}
                                    </span>
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="h-2 w-2 rounded-full" style={{ background: theme.base }} />
                                        {s.label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    };

    const renderVoicePill = (id: string, label: string, desc: string, selected: boolean, onSelect: () => void) => {
        const isPlaying = playingPreview === id;
        return (
            <div key={id} className={`flex items-center overflow-hidden rounded-lg border text-sm font-medium transition-colors ${selected ? ACTIVE_PILL : INACTIVE_PILL}`}>
                <button
                    type="button"
                    onClick={() => togglePreview(id)}
                    className={`flex h-9 w-9 items-center justify-center transition-colors ${selected ? 'text-orange-600 dark:text-orange-300' : 'text-gray-400'} hover:bg-orange-50 dark:hover:bg-orange-900/20`}
                    title={t('audioExport.previewVoice', { defaultValue: 'Preview voice' })}
                    aria-label={`${t('audioExport.previewVoice', { defaultValue: 'Preview voice' })}: ${id}`}
                >
                    {isPlaying ? <Square className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current ml-0.5" />}
                </button>
                <button type="button" onClick={onSelect} className="flex items-center gap-2 py-2 pr-3 pl-1.5">
                    <span className="font-semibold">{label}</span>
                    {desc && <span className={`text-[11px] ${mutedDescClass(selected)}`}>{desc}</span>}
                </button>
            </div>
        );
    };

    // ============================================================================
    // Render: thought / chunk cards
    // ============================================================================
    const renderOriginalCards = () => (
        <div className="space-y-3">
            {visibleSections.map(section => {
                const thoughts = getThoughtsForSection(section.id);
                if (thoughts.length === 0) return null;
                const theme = SERMON_SECTION_COLORS[section.colorKey as keyof typeof SERMON_SECTION_COLORS];
                return thoughts.map(th => (
                    <div key={`${section.id}-${th.id}`} className="relative flex gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
                        <div className="absolute left-0 top-0 h-full w-1 rounded-l-xl" style={{ background: theme.base }} />
                        <div className="min-w-0 flex-1">
                            <div className="mb-1 flex items-center gap-2">
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${theme.text} dark:${theme.darkText}`} style={{ backgroundColor: `${theme.base}24` }}>{section.label}</span>
                                <span className="text-[10px] text-gray-400">{th.text.length} {charsLabel}</span>
                            </div>
                            <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{th.text}</p>
                        </div>
                    </div>
                ));
            })}
        </div>
    );

    const renderChunkCards = (editable: boolean) => (
        <div className="space-y-3">
            {visibleSections.map(section => {
                const sectionChunks = chunks.filter(c => c.sectionId === section.id);
                if (sectionChunks.length === 0) return null;
                const theme = SERMON_SECTION_COLORS[section.colorKey as keyof typeof SERMON_SECTION_COLORS];
                return sectionChunks.map(chunk => {
                    const isTransition = chunk.kind === 'transition';
                    return (
                    <div
                        key={chunk.index}
                        className={`group relative flex gap-3 rounded-xl border p-4 shadow-sm transition ${isTransition ? 'border-orange-200 bg-orange-50 dark:border-orange-900/50 dark:bg-orange-900/20' : 'border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900'} ${editable ? 'cursor-pointer hover:border-orange-300 hover:shadow-md dark:hover:border-orange-700' : ''}`}
                        onClick={editable ? () => setEditingChunk(chunk) : undefined}
                    >
                        <div className="absolute left-0 top-0 h-full w-1 rounded-l-xl" style={{ background: isTransition ? '#ea580c' : theme.base }} />
                        <div className="min-w-0 flex-1">
                            <div className="mb-1 flex items-center gap-2">
                                {isTransition ? (
                                    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-700 dark:text-orange-300" style={{ backgroundColor: '#ea580c24' }}><Sparkles className="h-2.5 w-2.5" />{t('audioExport.transitionBadge', { defaultValue: 'Переход' })}</span>
                                ) : (
                                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${theme.text} dark:${theme.darkText}`} style={{ backgroundColor: `${theme.base}24` }}>{section.label}</span>
                                )}
                                <span className="text-[10px] text-gray-400">{chunk.text.length} {charsLabel}</span>
                                {editable && <Pencil className="ml-auto h-3.5 w-3.5 text-gray-300 opacity-0 transition group-hover:opacity-100 group-hover:text-orange-500" />}
                            </div>
                            <p className={`text-sm leading-relaxed ${isTransition ? 'font-bold text-orange-900 dark:text-orange-200' : 'font-medium text-gray-800 dark:text-gray-200'}`}>{chunk.text}</p>
                        </div>
                    </div>
                    );
                });
            })}
        </div>
    );

    // ============================================================================
    // Render: STEP 2 — source
    // ============================================================================
    const colHead = (icon: React.ReactNode, title: string, editBadge?: boolean) => (
        <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            {icon}{title}
            {editBadge && (
                <span className="inline-flex items-center gap-1 rounded bg-orange-50 px-1.5 py-0.5 normal-case font-medium text-orange-600 dark:bg-orange-900/20 dark:text-orange-300">
                    <Pencil className="h-3 w-3" />{t('audioExport.editable', { defaultValue: 'редактируемо' })}
                </span>
            )}
        </div>
    );

    const renderStep2 = () => {
        const sourceTabs: { id: AudioSourceMode; label: string; icon: React.ReactNode }[] = [
            { id: 'raw', label: t('audioExport.sourceRaw', { defaultValue: 'Original as-is' }), icon: <FileText className="h-4 w-4" /> },
            { id: 'ai', label: aiSourceLabel, icon: <Sparkles className="h-4 w-4" /> },
        ];
        const availTabs = ttsProvider === 'google' ? sourceTabs.filter(s => s.id === 'raw') : sourceTabs;

        const loadingPanel = (
            <div className="flex h-72 flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 text-center dark:border-gray-700">
                <Loader2 className="mb-4 h-9 w-9 animate-spin text-orange-500" />
                <p className="font-medium text-gray-500 dark:text-gray-400">{t('audioExport.optimizing', { defaultValue: 'Preparing...' })}</p>
            </div>
        );

        return (
            <div className="space-y-4">
                <div className="flex flex-col items-start gap-2">
                    {labelRow(t('audioExport.sourceTitle', { defaultValue: 'Источник текста для озвучки' }))}
                    <div className="flex flex-wrap items-center gap-2">
                        {availTabs.map(s => {
                            const sel = mode === s.id;
                            return (
                                <button
                                    key={s.id}
                                    onClick={() => selectSource(s.id)}
                                    disabled={isLoading}
                                    className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold transition-colors disabled:opacity-60 ${sel ? ACTIVE_PILL : INACTIVE_PILL}`}
                                >
                                    {s.icon}{s.label}
                                </button>
                            );
                        })}
                        {ttsProvider === 'google' && (
                            <span className="ml-1 text-[11px] text-gray-400">{t('audioExport.aiOpenaiOnly', { defaultValue: 'AI-оптимизация — только для OpenAI' })}</span>
                        )}
                    </div>
                </div>

                <div className="flex items-start gap-2 rounded-lg bg-orange-50/60 px-3 py-2 text-xs text-orange-700/90 dark:bg-orange-900/15 dark:text-orange-200/80">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    <span>{mode === 'ai'
                        ? t('audioExport.sourceAiHint2', { defaultValue: 'Слева — оригинал как есть, справа — AI-оптимизация. Правую колонку можно править по мыслям. Сравнивай рядом.' })
                        : t('audioExport.sourceRawHint2', { defaultValue: 'Точный текст проповеди по мыслям, без изменений. Править нечего — только просмотр.' })}
                    </span>
                </div>

                {mode === 'raw' ? (
                    <div className="max-h-[calc(95vh-360px)] min-h-[16rem] overflow-y-auto pr-1">
                        {isLoading ? loadingPanel : renderChunkCards(false)}
                    </div>
                ) : (
                    <div className="grid max-h-[calc(95vh-360px)] min-h-[16rem] gap-4 overflow-y-auto pr-1 md:grid-cols-2">
                        <div>
                            {colHead(<FileText className="h-3.5 w-3.5" />, t('audioExport.originalText', { defaultValue: 'Original' }))}
                            {renderOriginalCards()}
                        </div>
                        <div>
                            {colHead(<Sparkles className="h-3.5 w-3.5" />, aiSourceLabel, chunks.length > 0)}
                            {isLoading ? loadingPanel : chunks.length > 0 ? renderChunkCards(true) : (
                                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 px-4 py-12 text-center dark:border-gray-700">
                                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50 dark:bg-orange-900/20">
                                        <Sparkles className="h-5 w-5 text-orange-500" />
                                    </div>
                                    <p className="mb-4 max-w-[16rem] text-sm text-gray-500 dark:text-gray-400">
                                        {t('audioExport.aiEmpty', { defaultValue: 'Оптимизированного текста ещё нет. Сгенерируйте — потом сможете править каждую мысль.' })}
                                    </p>
                                    <button
                                        onClick={() => prepareSource('ai')}
                                        disabled={isLoading || aiBlocked}
                                        title={aiBlocked ? t('settings.usage.aiUsageExhausted') : undefined}
                                        className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-orange-700 disabled:opacity-50"
                                    >
                                        <Sparkles className="h-4 w-4" />
                                        {t('audioExport.generateOptimized', { defaultValue: 'Сгенерировать оптимизированный текст' })}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // ============================================================================
    // Render: STEP 3 — preview (3 section blocks, read-only)
    // ============================================================================
    const renderStep3 = () => {
        const notReady = mode === 'ai' && chunks.length === 0;
        const voiceLabel = ttsProvider === 'google' ? googleVoice : voice.charAt(0).toUpperCase() + voice.slice(1);
        const modelLabel = ttsProvider === 'google'
            ? (googleModel === GOOGLE_MODEL_GEMINI_31 ? 'Gemini 3.1 TTS' : 'Gemini 2.5 TTS')
            : (quality === 'hd' ? t('audioExport.qualityHd', { defaultValue: 'HD' }) : t('audioExport.qualityStandard', { defaultValue: 'Standard' }));
        const providerLabel = ttsProvider === 'google' ? t('audioExport.providerGoogle', { defaultValue: 'Google' }) : t('audioExport.providerOpenai', { defaultValue: 'OpenAI' });
        const srcLabel = mode === 'ai' ? aiSourceLabel : t('audioExport.sourceRaw', { defaultValue: 'Original as-is' });
        // Estimate from the chunks actually in the current selection (not stale stats).
        const visibleChunks = chunks.filter(c => sections.includes(c.sectionId));
        const minutes = visibleChunks.length ? Math.max(1, Math.ceil(visibleChunks.reduce((a, c) => a + c.text.length, 0) / 800)) : 0;

        return (
            <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs font-medium text-gray-500 dark:border-gray-800 dark:bg-gray-800/50 dark:text-gray-400">
                    <span className="inline-flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5 text-orange-500" />{providerLabel} · {modelLabel}</span>
                    <span className="h-3 w-px bg-gray-300 dark:bg-gray-600" />
                    <span className="inline-flex items-center gap-1.5"><Mic className="h-3.5 w-3.5 text-orange-500" />{voiceLabel}</span>
                    <span className="h-3 w-px bg-gray-300 dark:bg-gray-600" />
                    <span className="inline-flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-orange-500" />{srcLabel}</span>
                    <span className="h-3 w-px bg-gray-300 dark:bg-gray-600" />
                    <span className="inline-flex items-center gap-1.5"><Layers className="h-3.5 w-3.5" /><b className="text-gray-800 dark:text-gray-200">{visibleSections.length}</b> {t('audioExport.sectionsCount', { defaultValue: 'секции' })}</span>
                    <span className="h-3 w-px bg-gray-300 dark:bg-gray-600" />
                    <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />≈ {minutes} {t('audioExport.mins', { defaultValue: 'мин' })}</span>
                </div>

                {notReady ? (
                    <div className="flex h-72 flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 text-center dark:border-gray-700">
                        <Sparkles className="mb-3 h-8 w-8 text-gray-300" />
                        <p className="max-w-sm text-sm text-gray-500 dark:text-gray-400">{t('audioExport.previewNotReady', { defaultValue: 'Сначала сгенерируйте оптимизированный текст на шаге «Источник».' })}</p>
                    </div>
                ) : (
                    <>
                        <p className="flex items-center gap-1.5 text-xs text-gray-400"><Eye className="h-3 w-3" />{t('audioExport.previewHint', { defaultValue: 'Финальный текст одним блоком на каждую секцию — только просмотр. Правки делаются на шаге «Источник».' })}</p>
                        <div className="max-h-[calc(95vh-360px)] min-h-[16rem] space-y-3 overflow-y-auto pr-1">
                            {visibleSections.map(section => {
                                const sectionChunks = chunks.filter(c => c.sectionId === section.id && c.text.trim());
                                if (sectionChunks.length === 0) return null;
                                const charCount = sectionChunks.reduce((a, c) => a + c.text.length, 0);
                                const theme = SERMON_SECTION_COLORS[section.colorKey as keyof typeof SERMON_SECTION_COLORS];
                                return (
                                    <div key={section.id} className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
                                        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5 dark:border-gray-800" style={{ backgroundColor: `${theme.base}1f` }}>
                                            <span className={`text-xs font-bold uppercase tracking-wider ${theme.text} dark:${theme.darkText}`}>{section.label}</span>
                                            <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500">{charCount} {charsLabel}</span>
                                        </div>
                                        <div className="space-y-2.5 px-5 py-4">
                                            {sectionChunks.map((c, i) => c.kind === 'transition' ? (
                                                <p key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-bold leading-relaxed text-orange-900 dark:border-orange-900/50 dark:bg-orange-900/20 dark:text-orange-200">
                                                    <span className="inline-flex items-center gap-1 rounded-full bg-orange-200/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-orange-700 dark:bg-orange-800/60 dark:text-orange-200"><Sparkles className="h-2.5 w-2.5" />{t('audioExport.transitionBadge', { defaultValue: 'Переход' })}</span>
                                                    <span className="whitespace-pre-wrap">{c.text}</span>
                                                </p>
                                            ) : (
                                                <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800 dark:text-gray-200">{c.text}</p>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>
        );
    };

    // ============================================================================
    // Render: STEP 4 — generation progress + success
    // ============================================================================
    const renderGenerating = () => {
        const percent = Math.round(genProgress.percent ?? (genProgress.current / (genProgress.total || 1)) * 100) || 0;
        return (
            <div className="flex h-full flex-1 flex-col items-center justify-center p-8 text-center">
                <div className="relative mb-8">
                    <div className="absolute inset-0 animate-ping rounded-full bg-orange-500/10" style={{ animationDuration: '3s' }} />
                    <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-orange-400 to-amber-600 shadow-xl shadow-orange-500/30">
                        <AudioLines className="h-10 w-10 animate-pulse text-white" />
                    </div>
                </div>
                <h2 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">{t('audioExport.generatingAudio', { defaultValue: 'Generating Audio' })}</h2>
                <p className="mb-8 max-w-md text-gray-500 dark:text-gray-400">{t('audioExport.generatingDesc', { defaultValue: 'Synthesizing high-quality speech...' })}</p>
                <div className="w-full max-w-md">
                    <div className="mb-2 flex justify-between text-xs font-bold uppercase tracking-wider text-gray-500">
                        <span>{t('audioExport.processingFragments', { defaultValue: 'Processing fragments' })}</span>
                        <span>{percent}%</span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                        <div className="h-full bg-gradient-to-r from-orange-500 to-amber-500 transition-all duration-500" style={{ width: `${percent}%` }} />
                    </div>
                    <p className="mt-3 font-mono text-xs text-gray-400">
                        {genProgress.current > 0
                            ? t('audioExport.generatingChunk', { defaultValue: 'Generating chunk {{current}}/{{total}}...', current: genProgress.current, total: genProgress.total })
                            : (genProgress.status || `${genProgress.current} / ${genProgress.total}`)}
                    </p>
                </div>
                <button
                    onClick={handleCancelGeneration}
                    className="mt-8 rounded-full border border-gray-200 px-6 py-2 text-sm font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                    {t('audioExport.cancelGeneration', { defaultValue: 'Cancel Generation' })}
                </button>
            </div>
        );
    };

    const renderSuccess = () => {
        if (!generatedFile) return null;
        return (
            <div className="flex h-full flex-1 flex-col items-center justify-center p-8">
                <div className="flex w-full max-w-md flex-col items-center text-center">
                    <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100 ring-8 ring-green-50 dark:bg-green-900/30 dark:ring-green-900/10">
                        <Check className="h-10 w-10 text-green-600 dark:text-green-400" />
                    </div>
                    <h2 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">{t('audioExport.successTitle', { defaultValue: 'Audio Ready!' })}</h2>
                    <p className="mb-8 text-gray-500 dark:text-gray-400">{t('audioExport.successDesc', { defaultValue: 'Your file has been generated and downloaded.' })}</p>
                    <div className="mb-6 w-full rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                        <audio controls src={generatedFile.url} className="h-10 w-full" controlsList="nodownload" />
                    </div>
                    <a
                        href={generatedFile.url}
                        download={generatedFile.filename}
                        className="mb-6 flex w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-6 py-3 font-bold text-white shadow-sm transition-colors hover:bg-orange-700"
                    >
                        <Download className="h-5 w-5" />
                        {t('audioExport.downloadAgain', { defaultValue: 'Download Again' })}
                    </a>
                    <div className="flex w-full gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-left dark:border-amber-800 dark:bg-amber-900/20">
                        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                        <p className="text-sm text-amber-800 dark:text-amber-200">{t('audioExport.closeWarning', { defaultValue: 'This file is saved locally. Closing this window will remove access to the playback.' })}</p>
                    </div>
                    <button onClick={onClose} className="mt-8 text-sm font-medium text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200">
                        {t('buttons.close', { defaultValue: 'Close' })}
                    </button>
                </div>
            </div>
        );
    };

    // ============================================================================
    // Render: wizard footer
    // ============================================================================
    const renderFooter = () => {
        if (step === 1) {
            return (
                <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">{t('audioExport.stepCount', { defaultValue: 'Шаг {{n}} из 3', n: 1 })}</span>
                    <button
                        onClick={goToStep2}
                        disabled={sections.length === 0 || entitlementLoading || entitlementError || !userEntitlement?.functions?.tts}
                        className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-orange-700 disabled:opacity-50"
                    >
                        {t('audioExport.nextSource', { defaultValue: 'Далее: источник текста' })}<ArrowRight className="h-4 w-4" />
                    </button>
                </div>
            );
        }
        if (step === 2) {
            return (
                <div className="flex items-center justify-between">
                    <button onClick={() => setStep(1)} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700">
                        <ArrowLeft className="h-4 w-4" />{t('buttons.back', { defaultValue: 'Назад' })}
                    </button>
                    <button
                        onClick={() => setStep(3)}
                        disabled={isLoading}
                        className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-orange-700 disabled:opacity-50"
                    >
                        {t('audioExport.nextPreview', { defaultValue: 'Далее: предпросмотр' })}<ArrowRight className="h-4 w-4" />
                    </button>
                </div>
            );
        }
        // step 3
        return (
            <div className="flex flex-wrap items-center justify-between gap-3">
                <button onClick={() => setStep(2)} className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700">
                    <ArrowLeft className="h-4 w-4" />{t('buttons.back', { defaultValue: 'Назад' })}
                </button>
                <button
                    onClick={handleGenerate}
                    disabled={isLoading || chunks.length === 0 || aiBlocked}
                    title={aiBlocked ? t('settings.usage.aiUsageExhausted') : undefined}
                    className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-orange-700 disabled:opacity-50"
                >
                    <AudioLines className="h-4 w-4" />{t('audioExport.generateAudioButton', { defaultValue: 'Generate Audio' })}
                </button>
            </div>
        );
    };

    // ============================================================================
    // Main wrapper
    // ============================================================================
    if (view === 'generating') return <div className="flex h-full min-h-0 flex-1 flex-col">{renderGenerating()}</div>;
    if (view === 'success') return <div className="flex h-full min-h-0 flex-1 flex-col">{renderSuccess()}</div>;

    return (
        <div className="flex h-full min-h-0 flex-1 flex-col">
            <AnimatePresence>
                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
                    >
                        <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                        <p className="text-sm font-medium">{error}</p>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Step body (the stepper lives in the modal header now) */}
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className={`w-full ${step === 1 ? 'mx-auto flex min-h-full max-w-3xl flex-col justify-center py-4' : 'py-2'}`}>
                    {step === 1 && renderStep1()}
                    {step === 2 && renderStep2()}
                    {step === 3 && renderStep3()}
                </div>
            </div>

            {/* Footer */}
            <div className="mt-4 flex-shrink-0 border-t border-gray-100 pt-4 dark:border-gray-800">{renderFooter()}</div>

            {!!editingChunk && (
                <ChunkEditorModal
                    onClose={() => setEditingChunk(null)}
                    chunk={editingChunk}
                    onSave={handleSaveChunk}
                />
            )}
        </div>
    );
}

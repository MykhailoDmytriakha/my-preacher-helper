/**
 * Audio Studio — single working surface for sermon audio generation.
 *
 * One screen does the whole job:
 *  - a compact settings bar (voice / quality / sections) at the top,
 *  - two panels: original sermon text (left) and the narration text (right),
 *  - a persistent SOURCE toggle on the right panel — AI-optimized vs original
 *    as-is — that can be flipped back and forth at any time, even after chunks
 *    already exist. Each mode is cached so switching back is instant.
 *  - generation progress and the success/player view replace the body in place.
 *
 * Styling follows the site design system (clean white / gray-900 surfaces,
 * orange accent — the audio feature's color among the export siblings).
 */

'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
    ArrowRight, Loader2, FileText, Activity, Play, Square, Sparkles,
    RefreshCw, AlertTriangle, Check, Copy, Pencil, Download, AudioLines,
} from 'lucide-react';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/useAuth';
import { useClipboard } from '@/hooks/useClipboard';
import useSermon from '@/hooks/useSermon';
import {
    AVAILABLE_VOICES,
    AudioChunk,
    AudioQuality,
    AudioSourceMode,
    SectionSelection,
    TTSVoice,
    SermonSection,
} from '@/types/audioGeneration.types';
import { getSortedThoughts } from '@/utils/sermonSorting';
import { SERMON_SECTION_COLORS } from '@/utils/themeColors';

import ChunkEditorModal from './ChunkEditorModal';

// ============================================================================
// Types
// ============================================================================

interface ChunkPreview extends AudioChunk {
    preview?: string;
}

interface OptimizationStats {
    originalLength: number;
    optimizedLength: number;
    totalChunks: number;
    estimatedMinutes: number;
}

interface StreamEvent {
    type: 'progress' | 'complete' | 'error' | 'audio_chunk' | 'download_complete';
    current?: number;
    total?: number;
    percent?: number;
    status?: string;
    audioUrl?: string;
    filename?: string;
    message?: string;
    data?: string;
}

type StudioView = 'working' | 'generating' | 'success';

export interface StepByStepWizardProps {
    sermonId: string;
    sermonTitle: string;
    onClose: () => void;
    onGeneratingChange?: (generating: boolean) => void;
    isEnabled?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

const statsFromChunks = (chunks: ChunkPreview[]): OptimizationStats => {
    const totalChars = chunks.reduce((sum, c) => sum + c.text.length, 0);
    return {
        originalLength: totalChars,
        optimizedLength: totalChars,
        totalChunks: chunks.length,
        estimatedMinutes: Math.max(1, Math.ceil(totalChars / 800)),
    };
};

// ============================================================================
// Main Component
// ============================================================================

export default function StepByStepWizard({
    sermonId,
    sermonTitle: _sermonTitle,
    onClose,
    onGeneratingChange,
    isEnabled: _isEnabled = true,
}: StepByStepWizardProps) {
    const { t, i18n } = useTranslation();
    const { user } = useAuth();

    // Settings
    const [voice, setVoice] = useState<TTSVoice>('onyx');
    const [quality, setQuality] = useState<AudioQuality>('standard');
    const [sections, setSections] = useState<SectionSelection>('all');

    // Source mode + per-mode cache so flipping back and forth is instant
    const [mode, setMode] = useState<AudioSourceMode>('ai');
    const chunksByMode = useRef<Partial<Record<AudioSourceMode, ChunkPreview[]>>>({});

    // Content state
    const [chunks, setChunks] = useState<ChunkPreview[]>([]);
    const [stats, setStats] = useState<OptimizationStats | null>(null);

    // View + flow state
    const [view, setView] = useState<StudioView>('working');
    const [isLoading, setIsLoading] = useState(false);     // preparing/switching text
    const [error, setError] = useState<string | null>(null);
    const [editingChunk, setEditingChunk] = useState<ChunkPreview | null>(null);

    // Generation state
    const [genProgress, setGenProgress] = useState<{ current: number; total: number; percent?: number; status?: string }>({ current: 0, total: 0 });
    const [abortController, setAbortController] = useState<AbortController | null>(null);
    const [generatedFile, setGeneratedFile] = useState<{ url: string; filename: string } | null>(null);

    // Voice preview
    const [playingPreview, setPlayingPreview] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const { isCopied, copyToClipboard } = useClipboard({ successDuration: 2000 });
    const { sermon } = useSermon(sermonId);

    // Report "busy" so the modal can guard its close button
    useEffect(() => {
        onGeneratingChange?.(isLoading || view === 'generating');
    }, [isLoading, view, onGeneratingChange]);

    // ------------------------------------------------------------------
    // Load existing chunks (from a previous session) once the sermon loads
    // ------------------------------------------------------------------
    const seeded = useRef(false);
    useEffect(() => {
        if (seeded.current || !sermon) return;
        const existing = (sermon.audioChunks || []) as AudioChunk[];
        if (existing.length === 0) {
            seeded.current = true;
            return;
        }
        const loaded: ChunkPreview[] = existing.map(c => ({
            ...c,
            sectionId: c.sectionId as SermonSection,
            preview: c.text,
        }));
        const savedMode: AudioSourceMode = sermon.audioMetadata?.mode === 'raw' ? 'raw' : 'ai';
        chunksByMode.current[savedMode] = loaded;
        setMode(savedMode);
        setChunks(loaded);
        setStats(statsFromChunks(loaded));
        if (sermon.audioMetadata?.voice) setVoice(sermon.audioMetadata.voice as TTSVoice);
        seeded.current = true;
    }, [sermon]);

    // ------------------------------------------------------------------
    // Voice preview
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
        const url = `/samples/${voiceId}-${quality}-${fileLang}.mp3`;
        const audio = new Audio(url);
        audio.volume = 0.7;
        audio.onended = () => setPlayingPreview(null);
        audio.onerror = () => {
            console.error(`Failed to load sample: ${url}`);
            toast.error(t('audioExport.sampleError', { defaultValue: 'Sample not available' }));
            setPlayingPreview(null);
        };
        audio.play().catch(e => console.error('Playback failed', e));
        audioRef.current = audio;
        setPlayingPreview(voiceId);
    }, [playingPreview, quality, t, i18n.language]);

    useEffect(() => () => { audioRef.current?.pause(); }, []);

    // ------------------------------------------------------------------
    // Stream parsing for generation
    // ------------------------------------------------------------------
    const dispatchStreamEvent = useCallback((
        event: StreamEvent,
        audioDataParts: string[],
        onProgress: (data: StreamEvent) => void,
        onComplete: (data: StreamEvent) => void,
        onError: (message: string) => void,
    ) => {
        if (event.type === 'progress') {
            onProgress(event);
        } else if (event.type === 'audio_chunk') {
            if (event.data) audioDataParts.push(event.data);
        } else if (event.type === 'complete' || event.type === 'download_complete') {
            let finalUrl = event.audioUrl;
            if (audioDataParts.length > 0) {
                const fullBase64 = audioDataParts.join('');
                finalUrl = fullBase64.startsWith('data:') ? fullBase64 : `data:audio/mpeg;base64,${fullBase64}`;
            }
            onComplete({ ...event, audioUrl: finalUrl });
        } else if (event.type === 'error') {
            onError(event.message || 'Unknown error');
        }
    }, []);

    const processStream = useCallback(async (
        reader: ReadableStreamDefaultReader<Uint8Array>,
        onProgress: (data: StreamEvent) => void,
        onComplete: (data: StreamEvent) => void,
        onError: (message: string) => void,
    ) => {
        const decoder = new TextDecoder();
        let buffer = '';
        const audioDataParts: string[] = [];

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
                    // Malformed line — log and skip, but keep reading the stream.
                    console.error('Failed to parse stream line:', trimmed, e);
                    continue;
                }
                // Dispatch is OUTSIDE the parse try so that an 'error' event
                // (onError throws) propagates to the caller instead of being
                // swallowed and logged, which would hang the progress view forever.
                dispatchStreamEvent(event, audioDataParts, onProgress, onComplete, onError);
            }
        }
    }, [dispatchStreamEvent]);

    // ------------------------------------------------------------------
    // Prepare text for a given source (AI optimize OR raw split)
    // ------------------------------------------------------------------
    const prepareSource = useCallback(async (targetMode: AudioSourceMode) => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/sermons/${sermonId}/audio/optimize`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sections,
                    saveToDb: true, // optimize persists chunks + audioMetadata.mode
                    userId: user?.uid,
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
            setStats({
                originalLength: data.originalLength || 0,
                optimizedLength: data.optimizedLength || 0,
                totalChunks: newChunks.length,
                estimatedMinutes: Math.max(1, Math.ceil((data.optimizedLength || 0) / 800)),
            });
        } catch (err: unknown) {
            console.error('Prepare error:', err);
            setError(err instanceof Error ? err.message : 'Optimization failed');
        } finally {
            setIsLoading(false);
        }
    }, [sermonId, user, sections]);

    // ------------------------------------------------------------------
    // Switch source mode — instant from cache, otherwise prepare it.
    // We keep the invariant "DB reflects the active mode" because /generate
    // reads chunks from the DB, not from the request body.
    // ------------------------------------------------------------------
    const switchMode = useCallback(async (targetMode: AudioSourceMode) => {
        if (targetMode === mode && chunks.length > 0) return;
        const cached = chunksByMode.current[targetMode];
        if (!cached) {
            await prepareSource(targetMode);
            return;
        }
        setMode(targetMode);
        setChunks(cached);
        setStats(statsFromChunks(cached));
        // Sync DB so the next Generate uses this mode's chunks.
        setIsLoading(true);
        try {
            await fetch(`/api/sermons/${sermonId}/audio/chunks`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chunks: cached, userId: user?.uid, mode: targetMode }),
            });
        } catch (err) {
            console.error('Mode sync failed:', err);
        } finally {
            setIsLoading(false);
        }
    }, [mode, chunks.length, prepareSource, sermonId, user?.uid]);

    // ------------------------------------------------------------------
    // Edit a single chunk
    // ------------------------------------------------------------------
    const handleSaveChunk = useCallback(async (index: number, newText: string) => {
        const response = await fetch(`/api/sermons/${sermonId}/audio/chunks/${index}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: newText, userId: user?.uid }),
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
    }, [sermonId, user?.uid, mode]);

    // ------------------------------------------------------------------
    // Generate audio (TTS)
    // ------------------------------------------------------------------
    const handleGenerate = useCallback(async () => {
        setError(null);
        setView('generating');
        setGenProgress({ current: 0, total: chunks.length, percent: 0 });
        const controller = new AbortController();
        setAbortController(controller);

        try {
            const response = await fetch(`/api/sermons/${sermonId}/audio/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ voice, quality, sections, userId: user?.uid }),
                signal: controller.signal,
            });
            if (!response.ok || !response.body) {
                const data = await response.json();
                throw new Error(data.error || 'Generation failed');
            }
            await processStream(
                response.body.getReader(),
                (data) => setGenProgress(prev => ({
                    current: data.current ?? prev.current,
                    total: data.total ?? chunks.length,
                    percent: data.percent,
                    status: data.status,
                })),
                (data) => {
                    if (data.audioUrl) {
                        const link = document.createElement('a');
                        link.href = data.audioUrl;
                        link.download = data.filename || 'sermon_audio.mp3';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        setGeneratedFile({ url: data.audioUrl, filename: data.filename || 'sermon_audio.mp3' });
                        setView('success');
                    }
                },
                (message) => { throw new Error(message); },
            );
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
    }, [sermonId, voice, quality, sections, chunks.length, user?.uid, processStream, t]);

    const handleCancelGeneration = useCallback(() => abortController?.abort(), [abortController]);

    // ============================================================================
    // Section config
    // ============================================================================
    const SECTIONS_CONFIG = [
        { id: 'introduction', label: t('audioExport.sectionsIntro', { defaultValue: 'Introduction' }), colorKey: 'introduction' },
        { id: 'mainPart', label: t('audioExport.sectionsMain', { defaultValue: 'Main Part' }), colorKey: 'mainPart' },
        { id: 'conclusion', label: t('audioExport.sectionsConclusion', { defaultValue: 'Conclusion' }), colorKey: 'conclusion' },
    ] as const;
    const visibleSections = SECTIONS_CONFIG.filter(s => sections === 'all' || s.id === sections);

    const getThoughtsForSection = (sectionId: string) => {
        if (!sermon) return [];
        const mapped = sectionId === 'mainPart' ? 'main' : sectionId as 'introduction' | 'main' | 'conclusion';
        return getSortedThoughts(sermon, mapped);
    };

    // ============================================================================
    // Render: settings bar
    // ============================================================================
    const renderSettingsBar = () => (
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-800/50">
            {/* Voice */}
            <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {t('audioExport.voiceLabel', { defaultValue: 'Voice' })}
                </span>
                <div className="flex gap-1.5">
                    {AVAILABLE_VOICES.map((v) => {
                        const selected = voice === v.id;
                        const isPlaying = playingPreview === v.id;
                        return (
                            <button
                                key={v.id}
                                onClick={() => setVoice(v.id)}
                                className={`group flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors ${selected
                                    ? 'border-orange-400 bg-orange-50 text-orange-700 dark:border-orange-500/60 dark:bg-orange-500/10 dark:text-orange-300'
                                    : 'border-gray-200 bg-white text-gray-600 hover:border-orange-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'}`}
                            >
                                <span
                                    role="button"
                                    tabIndex={-1}
                                    onClick={(e) => { e.stopPropagation(); togglePreview(v.id); }}
                                    className={`flex h-5 w-5 items-center justify-center rounded-full transition-colors ${selected ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-500 group-hover:bg-orange-200 dark:bg-gray-700 dark:text-gray-300'}`}
                                    title={t('audioExport.previewVoice', { defaultValue: 'Preview voice' })}
                                >
                                    {isPlaying ? <Square className="h-2.5 w-2.5 fill-current" /> : <Play className="h-2.5 w-2.5 fill-current ml-0.5" />}
                                </span>
                                <span>{v.id.charAt(0).toUpperCase() + v.id.slice(1)}</span>
                                <span className="text-xs text-gray-400">{t(v.descKey, { defaultValue: '' })}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Quality */}
            <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {t('audioExport.qualityLabel', { defaultValue: 'Quality' })}
                </span>
                <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900">
                    {(['standard', 'hd'] as AudioQuality[]).map((q) => (
                        <button
                            key={q}
                            onClick={() => setQuality(q)}
                            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${quality === q
                                ? 'bg-orange-500 text-white shadow-sm'
                                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
                        >
                            {q === 'standard'
                                ? t('audioExport.qualityStandard', { defaultValue: 'Standard' })
                                : t('audioExport.qualityHd', { defaultValue: 'HD' })}
                        </button>
                    ))}
                </div>
            </div>

            {/* Sections */}
            <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {t('audioExport.sectionsLabel', { defaultValue: 'Sections' })}
                </span>
                <select
                    value={sections}
                    onChange={(e) => setSections(e.target.value as SectionSelection)}
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-800 transition-colors focus:border-orange-400 focus:ring-1 focus:ring-orange-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                >
                    <option value="all">{t('audioExport.sectionsAll', { defaultValue: 'All sections' })}</option>
                    <option value="introduction">{t('audioExport.sectionsIntro', { defaultValue: 'Introduction' })}</option>
                    <option value="mainPart">{t('audioExport.sectionsMain', { defaultValue: 'Main part' })}</option>
                    <option value="conclusion">{t('audioExport.sectionsConclusion', { defaultValue: 'Conclusion' })}</option>
                </select>
            </div>
        </div>
    );

    // ============================================================================
    // Render: source toggle (right panel header)
    // ============================================================================
    const renderSourceToggle = () => {
        const opts: { id: AudioSourceMode; label: string; icon: React.ReactNode }[] = [
            { id: 'ai', label: t('audioExport.sourceAi', { defaultValue: 'AI-optimized' }), icon: <Sparkles className="h-3.5 w-3.5" /> },
            { id: 'raw', label: t('audioExport.sourceRaw', { defaultValue: 'Original as-is' }), icon: <FileText className="h-3.5 w-3.5" /> },
        ];
        return (
            <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900">
                {opts.map((o) => {
                    const active = mode === o.id;
                    return (
                        <button
                            key={o.id}
                            onClick={() => switchMode(o.id)}
                            disabled={isLoading}
                            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${active
                                ? 'bg-orange-500 text-white shadow-sm'
                                : 'text-gray-500 hover:text-orange-600 dark:text-gray-400 dark:hover:text-orange-300'}`}
                        >
                            {o.icon}
                            {o.label}
                        </button>
                    );
                })}
            </div>
        );
    };

    // ============================================================================
    // Render: the two-panel working surface
    // ============================================================================
    const renderWorking = () => (
        <div className="flex h-full min-h-0 flex-col gap-4">
            {renderSettingsBar()}

            <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row">
                {/* LEFT: original text */}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-100 bg-white/90 px-5 py-3.5 backdrop-blur dark:border-gray-800 dark:bg-gray-900/90">
                        <FileText className="h-4 w-4 text-gray-400" />
                        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">
                            {t('audioExport.originalText', { defaultValue: 'Original Text' })}
                        </h3>
                    </div>
                    <div className="flex-1 space-y-6 overflow-y-auto p-5">
                        {visibleSections.map((section) => {
                            const thoughts = getThoughtsForSection(section.id);
                            if (thoughts.length === 0) return null;
                            const theme = SERMON_SECTION_COLORS[section.colorKey as keyof typeof SERMON_SECTION_COLORS];
                            return (
                                <div key={section.id} className="border-l-2 pl-4" style={{ borderColor: theme.base }}>
                                    <h4 className={`mb-2 text-xs font-bold uppercase tracking-wider ${theme.text} dark:${theme.darkText}`}>
                                        {section.label}
                                    </h4>
                                    <div className="space-y-3">
                                        {thoughts.map((th) => (
                                            <p key={th.id} className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">{th.text}</p>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* RIGHT: narration text + source toggle */}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-white/90 px-5 py-3 backdrop-blur dark:border-gray-800 dark:bg-gray-900/90">
                        <div className="flex items-center gap-2">
                            <AudioLines className="h-4 w-4 text-orange-500" />
                            <h3 className="text-sm font-bold uppercase tracking-wider text-gray-600 dark:text-gray-300">
                                {t('audioExport.audioText', { defaultValue: 'For narration' })}
                            </h3>
                        </div>
                        {renderSourceToggle()}
                    </div>

                    {/* Source hint */}
                    <div className="border-b border-gray-100 px-5 py-2 dark:border-gray-800">
                        <p className="text-xs text-gray-400 dark:text-gray-500">
                            {mode === 'ai'
                                ? t('audioExport.sourceAiHint', { defaultValue: 'References and numbers expanded, cleaned up for natural speech' })
                                : t('audioExport.sourceRawHint', { defaultValue: 'Your exact text, only split into narration-sized parts' })}
                        </p>
                    </div>

                    <div className="flex-1 space-y-4 overflow-y-auto p-5">
                        {isLoading ? (
                            <div className="flex h-full flex-col items-center justify-center text-center">
                                <Loader2 className="mb-4 h-9 w-9 animate-spin text-orange-500" />
                                <p className="font-medium text-gray-500 dark:text-gray-400">
                                    {t('audioExport.optimizing', { defaultValue: 'Preparing...' })}
                                </p>
                            </div>
                        ) : chunks.length === 0 ? (
                            <div className="flex h-full flex-col items-center justify-center text-center text-gray-500">
                                <Sparkles className="mb-4 h-12 w-12 text-gray-200 dark:text-gray-700" />
                                <h4 className="mb-2 text-lg font-bold text-gray-900 dark:text-white">
                                    {t('audioExport.readyToOptimize', { defaultValue: 'Transform to Audio' })}
                                </h4>
                                <p className="mb-6 max-w-xs text-sm">
                                    {t('audioExport.prepareSubtitle', { defaultValue: 'Pick a source above, then prepare the text for narration.' })}
                                </p>
                                <button
                                    onClick={() => prepareSource(mode)}
                                    className="rounded-xl bg-orange-600 px-6 py-2.5 font-bold text-white shadow-sm transition-colors hover:bg-orange-700"
                                >
                                    {t('audioExport.prepareTextBtn', { defaultValue: 'Prepare Text for Audio' })}
                                </button>
                            </div>
                        ) : (
                            <>
                                <p className="flex items-center gap-1.5 text-xs text-gray-400">
                                    <Pencil className="h-3 w-3" />
                                    {t('audioExport.editHint', { defaultValue: 'Tap a fragment to edit it' })}
                                </p>
                                {visibleSections.map((section) => {
                                    const sectionChunks = chunks.filter(c => c.sectionId === section.id);
                                    if (sectionChunks.length === 0) return null;
                                    const theme = SERMON_SECTION_COLORS[section.colorKey as keyof typeof SERMON_SECTION_COLORS];
                                    return (
                                        <div key={section.id}>
                                            <div className={`mb-3 pl-1 text-xs font-bold uppercase tracking-wider ${theme.text} dark:${theme.darkText}`}>
                                                {section.label}
                                            </div>
                                            <div className="space-y-3">
                                                {sectionChunks.map((chunk) => (
                                                    <motion.div
                                                        key={chunk.index}
                                                        onClick={() => setEditingChunk(chunk)}
                                                        whileHover={{ scale: 1.01 }}
                                                        className="group relative cursor-pointer overflow-hidden rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-all hover:border-orange-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:border-orange-600"
                                                    >
                                                        <div className="absolute left-0 top-0 h-full w-1 bg-gray-100 transition-colors group-hover:bg-orange-400 dark:bg-gray-700" />
                                                        <div className="mb-2 flex items-center justify-between gap-4">
                                                            <span className="rounded bg-gray-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:bg-gray-900">
                                                                {t('audioExport.chunkLabel', { defaultValue: 'Fragment {{index}}', index: chunk.index + 1 })}
                                                            </span>
                                                            <Pencil className="h-3.5 w-3.5 text-gray-300 opacity-0 transition-opacity group-hover:opacity-100 group-hover:text-orange-500" />
                                                        </div>
                                                        <p className="text-sm font-medium leading-relaxed text-gray-700 dark:text-gray-300">{chunk.text}</p>
                                                    </motion.div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Footer action bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-gray-800/50">
                <div className="flex items-center gap-4 text-xs font-medium text-gray-500 dark:text-gray-400">
                    <span className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5 text-orange-500" />{stats?.estimatedMinutes || 0} {t('audioExport.mins', { defaultValue: 'min audio' })}</span>
                    <span className="h-3 w-px bg-gray-300 dark:bg-gray-600" />
                    <span className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 text-gray-400" />{stats?.totalChunks || 0} {t('audioExport.chunks', { defaultValue: 'chunks' })}</span>
                </div>

                <div className="flex items-center gap-2">
                    {chunks.length > 0 && (
                        <>
                            <button
                                onClick={() => copyToClipboard(chunks.map(c => c.text).join('\n\n'))}
                                className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                            >
                                {isCopied
                                    ? <><Check className="h-4 w-4 text-green-500" /><span className="text-green-600 dark:text-green-400">{t('export.copied', { defaultValue: 'Copied' })}</span></>
                                    : <><Copy className="h-4 w-4" />{t('export.copyAll', { defaultValue: 'Copy All' })}</>}
                            </button>
                            <button
                                onClick={() => prepareSource(mode)}
                                disabled={isLoading}
                                className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                                title={t('audioExport.regenerate', { defaultValue: 'Re-generate' })}
                            >
                                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                                {t('audioExport.regenerate', { defaultValue: 'Re-generate' })}
                            </button>
                        </>
                    )}
                    <button
                        onClick={handleGenerate}
                        disabled={isLoading || chunks.length === 0}
                        className="flex items-center gap-2 rounded-xl bg-orange-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-orange-700 disabled:opacity-50"
                    >
                        {t('audioExport.generateAudioButton', { defaultValue: 'Generate Audio' })}
                        <ArrowRight className="h-4 w-4" />
                    </button>
                </div>
            </div>
        </div>
    );

    // ============================================================================
    // Render: generation progress
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
                <h2 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">
                    {t('audioExport.generatingAudio', { defaultValue: 'Generating Audio' })}
                </h2>
                <p className="mb-8 max-w-md text-gray-500 dark:text-gray-400">
                    {t('audioExport.generatingDesc', { defaultValue: 'Synthesizing high-quality speech...' })}
                </p>
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

    // ============================================================================
    // Render: success
    // ============================================================================
    const renderSuccess = () => {
        if (!generatedFile) return null;
        return (
            <div className="flex h-full flex-1 flex-col items-center justify-center p-8">
                <div className="flex w-full max-w-md flex-col items-center text-center">
                    <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100 ring-8 ring-green-50 dark:bg-green-900/30 dark:ring-green-900/10">
                        <Check className="h-10 w-10 text-green-600 dark:text-green-400" />
                    </div>
                    <h2 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">
                        {t('audioExport.successTitle', { defaultValue: 'Audio Ready!' })}
                    </h2>
                    <p className="mb-8 text-gray-500 dark:text-gray-400">
                        {t('audioExport.successDesc', { defaultValue: 'Your file has been generated and downloaded.' })}
                    </p>
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
                        <p className="text-sm text-amber-800 dark:text-amber-200">
                            {t('audioExport.closeWarning', { defaultValue: 'This file is saved locally. Closing this window will remove access to the playback.' })}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="mt-8 text-sm font-medium text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
                    >
                        {t('buttons.close', { defaultValue: 'Close' })}
                    </button>
                </div>
            </div>
        );
    };

    // ============================================================================
    // Main wrapper
    // ============================================================================
    return (
        <div className="flex h-full min-h-0 flex-1 flex-col">
            <AnimatePresence>
                {error && view === 'working' && (
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

            <div className="relative min-h-0 flex-1">
                {view === 'working' && renderWorking()}
                {view === 'generating' && renderGenerating()}
                {view === 'success' && renderSuccess()}
            </div>

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

/**
 * Step-by-Step Wizard Component
 * 
 * Premium wizard with input/output visualization at each step.
 * styling aligned with project patterns (blue→purple gradients, section colors).
 * 
 * Features:
 * - Premium Stepper (controlled by parent)
 * - Voice Selection Grid (2x3) with large cards
 * - Pill-style toggle for quality
 * - 2-panel Review layout
 * - Immersive Generate step with animated waveform
 * - Framer Motion animations
 */

'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
    ArrowLeft, ArrowRight, Loader2, FileText,
    Activity, Play, Square, Mic, AudioLines, Sparkles, RefreshCw, AlertTriangle, Check, Copy
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
    SectionSelection,
    TTSVoice,
    SermonSection,
    SpeechOptimizationResult,
    WizardStep
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

export interface StepByStepWizardProps {
    sermonId: string;
    sermonTitle: string;
    onClose: () => void;
    onGeneratingChange?: (generating: boolean) => void;
    isEnabled?: boolean;
    step: WizardStep;
    onStepChange: (step: WizardStep) => void;
}

// ============================================================================
// Main Component
// ============================================================================

export default function StepByStepWizard({
    sermonId,
    sermonTitle: _sermonTitle,
    onClose,
    onGeneratingChange,
    isEnabled: _isEnabled = true,
    step,
    onStepChange,
}: StepByStepWizardProps) {
    const { t, i18n } = useTranslation();
    const { user } = useAuth();

    // Settings
    const [voice, setVoice] = useState<TTSVoice>('onyx');
    const [quality, setQuality] = useState<AudioQuality>('standard');
    const [sections, setSections] = useState<SectionSelection>('all');

    // Wizard state
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [chunks, setChunks] = useState<ChunkPreview[]>([]);
    const [stats, setStats] = useState<OptimizationStats | null>(null);

    // Notify parent of generating state changes
    React.useEffect(() => {
        onGeneratingChange?.(isLoading);
    }, [isLoading, onGeneratingChange]);

    // Progress state
    const [genProgress, setGenProgress] = useState<{
        current: number;
        total: number;
        percent?: number;
        status?: string;
    }>({ current: 0, total: 0 });
    const [abortController, setAbortController] = useState<AbortController | null>(null);

    // Editor state
    const [editingChunk, setEditingChunk] = useState<ChunkPreview | null>(null);

    // Generation Success State
    const [generatedFile, setGeneratedFile] = useState<{ url: string; filename: string } | null>(null);

    // Audio Preview State
    const [playingPreview, setPlayingPreview] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Clipboard
    const { isCopied, copyToClipboard } = useClipboard({ successDuration: 2000 });

    const togglePreview = useCallback((voiceId: string) => {
        if (playingPreview === voiceId) {
            audioRef.current?.pause();
            audioRef.current = null;
            setPlayingPreview(null);
        } else {
            if (audioRef.current) {
                audioRef.current.pause();
            }

            // Use current language for sample (fallback to 'en')
            const lang = i18n.language.split('-')[0] || 'en';
            // Ensure we have samples for supported langs, otherwise fallback to en
            const supportedLangs = ['en', 'ru', 'uk'];
            const fileLang = supportedLangs.includes(lang) ? lang : 'en';

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
        }
    }, [playingPreview, quality, t, i18n.language]);

    // Stop preview on unmount
    useEffect(() => {
        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
            }
        };
    }, []);

    // ============================================================================
    // Helpers
    // ============================================================================

    const handleStreamEvent = useCallback((
        event: StreamEvent,
        audioDataParts: string[],
        onProgress: (data: StreamEvent) => void,
        onComplete: (data: StreamEvent) => void,
        onError: (message: string) => void
    ) => {
        if (event.type === 'progress') {
            onProgress(event);
        }
        else if (event.type === 'audio_chunk') {
            if (event.data) {
                audioDataParts.push(event.data);
            }
        }
        else if (event.type === 'complete' || event.type === 'download_complete') {
            let finalUrl = event.audioUrl;
            if (audioDataParts.length > 0) {
                const fullBase64 = audioDataParts.join('');
                finalUrl = fullBase64.startsWith('data:') ? fullBase64 : `data:audio/wav;base64,${fullBase64}`;
            }
            onComplete({ ...event, audioUrl: finalUrl });
        }
        else if (event.type === 'error') {
            onError(event.message || 'Unknown error');
        }
    }, []);

    const processStream = useCallback(async (
        reader: ReadableStreamDefaultReader<Uint8Array>,
        onProgress: (data: StreamEvent) => void,
        onComplete: (data: StreamEvent) => void,
        onError: (message: string) => void
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
                try {
                    const event = JSON.parse(trimmed);
                    handleStreamEvent(event, audioDataParts, onProgress, onComplete, onError);
                } catch (e) {
                    console.error('Failed to parse stream line:', trimmed, e);
                }
            }
        }
    }, [handleStreamEvent]);

    // ============================================================================
    // Load existing chunks
    // ============================================================================

    const { sermon } = useSermon(sermonId);

    React.useEffect(() => {
        if (sermon?.audioChunks && sermon.audioChunks.length > 0 && chunks.length === 0) {
            const loadedChunks: ChunkPreview[] = sermon.audioChunks.map(c => ({
                ...c,
                sectionId: c.sectionId as SermonSection,
                preview: c.text
            }));

            setChunks(loadedChunks);

            const totalChars = loadedChunks.reduce((sum, c) => sum + c.text.length, 0);
            setStats({
                originalLength: totalChars,
                optimizedLength: totalChars,
                totalChunks: loadedChunks.length,
                estimatedMinutes: Math.ceil(totalChars / 800)
            });
        }
    }, [sermon, chunks.length]);

    // ============================================================================
    // Step 1: Optimize (GPT)
    // ============================================================================

    const handleOptimize = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            let newChunks: ChunkPreview[] = [];
            let totalOriginal = 0;
            let totalOptimized = 0;

            if (sections === 'all') {
                const sectionKeys: SectionSelection[] = ['introduction', 'mainPart', 'conclusion'];

                const results = await Promise.allSettled(
                    sectionKeys.map(section =>
                        fetch(`/api/sermons/${sermonId}/audio/optimize`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                sections: section,
                                saveToDb: false,
                                userId: user?.uid
                            }),
                        }).then(async res => {
                            if (!res.ok) {
                                const err = await res.json();
                                throw new Error(err.error || `Failed to optimize ${section}`);
                            }
                            return res.json();
                        })
                    )
                );

                const successfulData = results
                    .filter((r): r is PromiseFulfilledResult<SpeechOptimizationResult & { chunks: AudioChunk[] }> => r.status === 'fulfilled')
                    .map(r => r.value);

                if (successfulData.length === 0) {
                    const firstError = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
                    throw new Error(firstError?.reason?.message || 'Optimization failed for all sections');
                }

                newChunks = successfulData.flatMap(d => d.chunks);
                totalOriginal = successfulData.reduce((sum, d) => sum + (d.originalLength || 0), 0);
                totalOptimized = successfulData.reduce((sum, d) => sum + (d.optimizedLength || 0), 0);

            } else {
                const response = await fetch(`/api/sermons/${sermonId}/audio/optimize`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sections,
                        saveToDb: false,
                        userId: user?.uid
                    }),
                });

                if (!response.ok) {
                    const data = await response.json();
                    throw new Error(data.error || 'Optimization failed');
                }

                const data = await response.json();
                newChunks = data.chunks;
                totalOriginal = data.originalLength || 0;
                totalOptimized = data.optimizedLength || 0;
            }

            // Sort and re-index
            const sectionOrder: Record<string, number> = { introduction: 0, mainPart: 1, conclusion: 2 };
            newChunks.sort((a, b) => {
                const secDiff = (sectionOrder[a.sectionId || ''] || 0) - (sectionOrder[b.sectionId || ''] || 0);
                if (secDiff !== 0) return secDiff;
                return a.index - b.index;
            });

            newChunks = newChunks.map((c, i) => ({ ...c, index: i }));

            // Save to DB
            await fetch(`/api/sermons/${sermonId}/audio/chunks`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chunks: newChunks, userId: user?.uid }),
            });
            // Sort and re-index
            newChunks.sort((a, b) => {
                const sectOrder: Record<string, number> = { 'introduction': 0, 'mainPart': 1, 'conclusion': 2 };
                return (sectOrder[a.sectionId] || 0) - (sectOrder[b.sectionId] || 0) || a.index - b.index;
            });

            setChunks(newChunks);
            setStats({
                originalLength: totalOriginal,
                optimizedLength: totalOptimized,
                totalChunks: newChunks.length,
                estimatedMinutes: Math.ceil(totalOptimized / 800)
            });

            onStepChange('review');
        } catch (err: unknown) {
            console.error('Optimization error:', err);
            const message = err instanceof Error ? err.message : 'Optimization failed';
            setError(message);
        } finally {
            setIsLoading(false);
        }
    }, [sermonId, user, sections, onStepChange]);

    // ============================================================================
    // Step 2: Edit Chunk
    // ============================================================================

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
        setChunks(prev => prev.map(c => c.index === index ? { ...c, text: newText, preview: newText } : c));
        setEditingChunk(null);
    }, [sermonId, user?.uid]);

    // ============================================================================
    // Step 3: Generate (TTS)
    // ============================================================================

    const handleGenerate = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        onStepChange('generate');
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
                (data) => {
                    setGenProgress(prev => ({
                        current: data.current ?? prev.current,
                        total: data.total ?? chunks.length,
                        percent: data.percent,
                        status: data.status,
                    }));
                },
                (data) => {
                    const link = document.createElement('a');
                    link.href = data.audioUrl || '';
                    link.download = data.filename || 'sermon_audio.wav';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);

                    // Do not close, show success state instead
                    if (data.audioUrl) {
                        setGeneratedFile({
                            url: data.audioUrl,
                            filename: data.filename || 'sermon_audio.wav'
                        });
                        onStepChange('success');
                    }
                },
                (message) => {
                    throw new Error(message);
                }
            );
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                setError(t('audioExport.generationCancelled', { defaultValue: 'Generation cancelled' }));
            } else {
                setError(err instanceof Error ? err.message : 'Unknown error');
            }
            onStepChange('review');
        } finally {
            setIsLoading(false);
            setAbortController(null);
        }
    }, [sermonId, voice, quality, sections, chunks.length, user?.uid, processStream, onStepChange, t]);

    const handleCancelGeneration = useCallback(() => {
        if (abortController) {
            abortController.abort();
        }
    }, [abortController]);

    // ============================================================================
    // Section Config
    // ============================================================================

    const SECTIONS_CONFIG = [
        { id: 'introduction', label: t('audioExport.sectionsIntro', { defaultValue: 'Introduction' }), colorKey: 'introduction' },
        { id: 'mainPart', label: t('audioExport.sectionsMain', { defaultValue: 'Main Part' }), colorKey: 'mainPart' },
        { id: 'conclusion', label: t('audioExport.sectionsConclusion', { defaultValue: 'Conclusion' }), colorKey: 'conclusion' },
    ] as const;

    const visibleSections = SECTIONS_CONFIG.filter(s => sections === 'all' || s.id === sections);

    // ============================================================================
    // Render: Settings Step
    // ============================================================================

    const optimizationText = t('audioExport.optimizing', { defaultValue: 'Optimizing text for speech...' });

    const renderSettings = () => (
        <div className="space-y-8 max-w-4xl mx-auto py-4">
            {/* Top Row: Quality & Section Filters */}
            <div className="flex flex-col md:flex-row gap-6 justify-between items-start md:items-center bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-800">
                <div className="space-y-2">
                    <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        {t('audioExport.qualityLabel', { defaultValue: 'Audio Quality' })}
                    </label>
                    <div className="flex bg-white dark:bg-gray-900 rounded-lg p-1 border border-gray-200 dark:border-gray-700 shadow-sm w-full md:min-w-[240px]">
                        {(['standard', 'hd'] as AudioQuality[]).map((q) => (
                            <button
                                key={q}
                                onClick={() => setQuality(q)}
                                className={`flex-1 py-1.5 px-3 text-sm font-medium rounded-md transition-all text-center ${quality === q
                                    ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-sm'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                                    }`}
                            >
                                {q === 'standard' ? 'Standard' : 'HD'}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="space-y-2 flex-1 md:max-w-xs">
                    <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        {t('audioExport.sectionsLabel', { defaultValue: 'Target Sections' })}
                    </label>
                    <select
                        value={sections}
                        onChange={(e) => setSections(e.target.value as SectionSelection)}
                        className="w-full py-2 px-3 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-colors"
                    >
                        <option value="all">{t('audioExport.sectionsAll', { defaultValue: 'All Sections' })}</option>
                        <option value="introduction">{t('audioExport.sectionsIntro', { defaultValue: 'Introduction Only' })}</option>
                        <option value="mainPart">{t('audioExport.sectionsMain', { defaultValue: 'Main Part Only' })}</option>
                        <option value="conclusion">{t('audioExport.sectionsConclusion', { defaultValue: 'Conclusion Only' })}</option>
                    </select>
                </div>
            </div>

            {/* Voice Selection Grid */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <label className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Mic className="w-4 h-4 text-purple-500" />
                        {t('audioExport.voiceLabel', { defaultValue: 'Select Speaker' })}
                    </label>
                    <span className="text-xs text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                        {AVAILABLE_VOICES.length} available
                    </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {AVAILABLE_VOICES.map((v) => {
                        const isSelected = voice === v.id;
                        return (
                            <motion.div
                                key={v.id}
                                onClick={() => setVoice(v.id)}
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                className={`relative p-5 rounded-2xl border-2 transition-all duration-200 text-left group cursor-pointer min-h-[160px] flex flex-col justify-end ${isSelected
                                    ? 'border-purple-500 bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 shadow-lg ring-2 ring-purple-500/20'
                                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-purple-300 dark:hover:border-purple-700 hover:shadow-md'
                                    }`}
                            >
                                {/* Radio Indicator */}
                                <div className={`absolute top-4 right-4 w-5 h-5 rounded-full border-2 transition-colors ${isSelected
                                    ? 'border-purple-500 bg-purple-500'
                                    : 'border-gray-300 dark:border-gray-600 group-hover:border-purple-400'
                                    }`}>
                                    {isSelected && (
                                        <div className="w-2 h-2 bg-white rounded-full m-auto mt-1" />
                                    )}
                                </div>

                                {/* Waveform Icon (Voice ID) */}
                                <div className="absolute top-4 left-4">
                                    <AudioLines className={`w-5 h-5 ${isSelected ? 'text-purple-600 dark:text-purple-400' : 'text-gray-300 dark:text-gray-600 group-hover:text-purple-400'}`} />
                                </div>

                                {/* Play Preview Button - Centered */}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        togglePreview(v.id);
                                    }}
                                    className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 p-3 rounded-full shadow-md transition-all transform hover:scale-110 z-20 border ${isSelected
                                        ? 'bg-purple-100 text-purple-600 border-purple-200 hover:bg-white'
                                        : 'bg-white text-gray-500 border-gray-100 hover:text-purple-500'
                                        }`}
                                    title="Preview Voice Sample"
                                >
                                    {playingPreview === v.id ? (
                                        <Square className="w-5 h-5 fill-current" />
                                    ) : (
                                        <Play className="w-5 h-5 fill-current ml-0.5" />
                                    )}
                                </button>

                                {/* Details */}
                                <h4 className={`font-bold text-base mb-1 ${isSelected ? 'text-purple-900 dark:text-purple-100' : 'text-gray-900 dark:text-gray-100'}`}>
                                    {v.id.charAt(0).toUpperCase() + v.id.slice(1)}
                                </h4>
                                <p className={`text-xs leading-relaxed ${isSelected ? 'text-purple-700 dark:text-purple-300' : 'text-gray-500 dark:text-gray-400'}`}>
                                    {v.description}
                                </p>
                            </motion.div>
                        );
                    })}
                </div>
            </div>

            {/* Next Button */}
            <div className="pt-4 flex justify-end">
                <button
                    onClick={() => onStepChange('review')}
                    className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl py-4 font-bold shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group"
                >
                    <>
                        {t('audioExport.nextReview', { defaultValue: 'Next: Review Content' })}
                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </>
                </button>

            </div>
            {isLoading && (
                <div className="flex-1 flex flex-col items-center justify-center h-full mt-4">
                    <Loader2 className="w-10 h-10 text-purple-600 animate-spin mb-4" />
                    <p className="text-gray-600 dark:text-gray-400 font-medium">
                        {optimizationText}
                    </p>
                </div>
            )}
        </div>
    );

    // ============================================================================
    // Render: Review Step (2-Panel)
    // ============================================================================

    const renderReview = () => {
        const getThoughtsForSection = (sectionId: string) => {
            if (!sermon) return [];
            const mappedSection = sectionId === 'mainPart' ? 'main' : sectionId as 'introduction' | 'main' | 'conclusion';
            return getSortedThoughts(sermon, mappedSection);
        };

        return (
            <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-6 h-full font-sans relative">


                {/* LEFT Panel: Original Text */}
                <div className="flex-1 flex flex-col h-full bg-white/50 dark:bg-gray-900/30 backdrop-blur-sm rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
                    <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 flex items-center justify-between sticky top-0 z-10 backdrop-blur-md">
                        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-widest flex items-center gap-2">
                            <FileText className="w-4 h-4" />
                            {t('audioExport.originalText', { defaultValue: 'Original Text' })}
                        </h3>
                    </div>

                    <div className="flex-1 overflow-y-auto p-5 space-y-6 scrollbar-hide">
                        {visibleSections.map((section) => {
                            const thoughts = getThoughtsForSection(section.id);
                            if (thoughts.length === 0) return null;
                            const theme = SERMON_SECTION_COLORS[section.colorKey as keyof typeof SERMON_SECTION_COLORS];

                            return (
                                <div key={section.id} className="relative pl-4 border-l-2" style={{ borderColor: theme.base }}>
                                    <h4 className={`text-xs font-bold uppercase mb-2 ${theme.text} dark:${theme.darkText} tracking-wider`}>
                                        {section.label}
                                    </h4>
                                    <div className="space-y-3">
                                        {thoughts.map((t) => (
                                            <p key={t.id} className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                                                {t.text}
                                            </p>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* RIGHT Panel: Optimized Chunks */}
                <div className="flex-1 flex flex-col h-full bg-white/50 dark:bg-gray-900/30 backdrop-blur-sm rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-sm">
                    <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 flex items-center justify-between sticky top-0 z-10 backdrop-blur-md">
                        <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 uppercase tracking-widest flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-amber-500" />
                            {t('audioExport.optimizationResults', { defaultValue: 'Optimized for Speech' })}
                        </h3>

                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    const allText = chunks.map(c => c.text).join('\n\n');
                                    copyToClipboard(allText);
                                }}
                                className="bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 text-xs font-semibold transition-colors flex items-center gap-2"
                                title={t('export.copyAll', { defaultValue: 'Copy All' })}
                            >
                                {isCopied ? (
                                    <>
                                        <Check className="w-3.5 h-3.5 text-green-500" />
                                        <span className="text-green-600 dark:text-green-400">{t('export.copied', { defaultValue: 'Copied' })}</span>
                                    </>
                                ) : (
                                    <>
                                        <Copy className="w-3.5 h-3.5" />
                                        <span>{t('export.copyAll', { defaultValue: 'Copy All' })}</span>
                                    </>
                                )}
                            </button>
                            <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 self-center mx-1" />

                            <div className="flex items-center gap-4 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full">
                                <div className="flex items-center gap-1.5">
                                    <Activity className="w-3.5 h-3.5 text-purple-500" />
                                    <span>{stats?.estimatedMinutes || 0} {t('audioExport.mins', { defaultValue: 'min' })}</span>
                                </div>
                                <div className="w-px h-3 bg-gray-300 dark:bg-gray-600" />
                                <div className="flex items-center gap-1.5">
                                    <FileText className="w-3.5 h-3.5 text-blue-500" />
                                    <span>{stats?.totalChunks || 0} {t('audioExport.chunks', { defaultValue: 'chunks' })}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-5 space-y-4 scrollbar-hide">
                        {isLoading ? (
                            <div className="h-full flex flex-col items-center justify-center text-center">
                                <Loader2 className="w-10 h-10 text-purple-600 animate-spin mb-4" />
                                <p className="text-gray-600 dark:text-gray-400 font-medium">
                                    {optimizationText}
                                </p>
                            </div>
                        ) : chunks.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-center text-gray-500">
                                <Sparkles className="w-12 h-12 mb-4 text-gray-300 dark:text-gray-700" />
                                <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                                    {t('audioExport.readyToOptimize', { defaultValue: 'Ready to Optimize' })}
                                </h4>
                                <p className="max-w-xs text-sm mb-6">
                                    {t('audioExport.readyDesc', { defaultValue: 'We will analyze the text and break it into speech-friendly chunks.' })}
                                </p>
                                <button
                                    onClick={handleOptimize}
                                    className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-full font-bold shadow-md transition-colors"
                                >
                                    {t('audioExport.prepareTextBtn', { defaultValue: 'Prepare Text for Audio' })}
                                </button>
                            </div>
                        ) : (
                            visibleSections.map((section) => {
                                const sectionChunks = chunks.filter(c => c.sectionId === section.id);
                                if (sectionChunks.length === 0) return null;
                                const theme = SERMON_SECTION_COLORS[section.colorKey as keyof typeof SERMON_SECTION_COLORS];

                                return (
                                    <div key={section.id}>
                                        <div className={`text-xs font-bold uppercase mb-3 ${theme.text} dark:${theme.darkText} tracking-wider pl-1`}>
                                            {section.label}
                                        </div>
                                        <div className="space-y-3">
                                            {sectionChunks.map((chunk) => (
                                                <motion.div
                                                    key={chunk.index}
                                                    onClick={() => setEditingChunk(chunk)}
                                                    whileHover={{ scale: 1.01, x: 2 }}
                                                    className="group p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-600 shadow-sm hover:shadow-md transition-all cursor-pointer relative overflow-hidden"
                                                >
                                                    {/* Card Decoration */}
                                                    <div className="absolute left-0 top-0 w-1 h-full bg-gradient-to-b from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 group-hover:from-purple-400 group-hover:to-blue-400 transition-colors" />

                                                    <div className="flex justify-between items-start gap-4 mb-2">
                                                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50 dark:bg-gray-900 px-2 py-0.5 rounded">
                                                            Chunk {chunk.index + 1}
                                                        </span>
                                                        <Activity className="w-12 h-4 text-gray-200 dark:text-gray-700 group-hover:text-purple-200 dark:group-hover:text-purple-900 transition-colors" />
                                                    </div>

                                                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed font-medium">
                                                        {chunk.text}
                                                    </p>

                                                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <div className="bg-white dark:bg-gray-700 p-1.5 rounded-lg shadow-sm border border-gray-100 dark:border-gray-600">
                                                            <FileText className="w-3 h-3 text-purple-500" />
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Action Bar inside panel on Right */}
                    <div className="p-4 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 flex justify-between gap-3">
                        <button
                            onClick={() => onStepChange('settings')}
                            className="bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 text-sm font-semibold transition-colors flex items-center gap-2"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back
                        </button>

                        <div className="flex gap-2">
                            {chunks.length > 0 && (
                                <button
                                    onClick={handleOptimize}
                                    disabled={isLoading}
                                    className="bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 text-sm font-semibold transition-colors flex items-center gap-2 disabled:opacity-50"
                                >
                                    <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                                    Re-optimize
                                </button>
                            )}

                            <button
                                onClick={handleGenerate}
                                disabled={isLoading || chunks.length === 0}
                                className={`px-6 py-3 rounded-xl shadow-lg text-sm font-bold flex items-center gap-2 transition-transform hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 bg-gradient-to-r from-green-600 to-emerald-600 text-white shadow-green-500/20 ${chunks.length === 0 ? 'hidden' : ''}`}
                            >
                                {t('audioExport.generateAudioButton', { defaultValue: 'Generate Audio' })}
                                <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // ============================================================================
    // Render: Generate Step (Immersive)
    // ============================================================================

    const renderSuccess = () => {
        if (!generatedFile) return null;

        return (
            <div className="h-full flex-1 flex flex-col items-center justify-center p-8 bg-white dark:bg-gray-900 rounded-2xl relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-green-50 to-blue-50 dark:from-green-900/20 dark:to-blue-900/20" />

                <div className="relative z-10 flex flex-col items-center max-w-md text-center w-full">
                    <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-6 ring-8 ring-green-50 dark:ring-green-900/10">
                        <Check className="w-10 h-10 text-green-600 dark:text-green-400" />
                    </div>

                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                        {t('audioExport.successTitle', { defaultValue: 'Audio Ready!' })}
                    </h2>
                    <p className="text-gray-500 dark:text-gray-400 mb-8">
                        {t('audioExport.successDesc', { defaultValue: 'Your file has been generated and downloaded.' })}
                    </p>

                    {/* Audio Player */}
                    <div className="w-full bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 mb-6">
                        <audio
                            controls
                            src={generatedFile.url}
                            className="w-full h-10"
                            controlsList="nodownload"
                        />
                    </div>

                    {/* Download Button */}
                    <a
                        href={generatedFile.url}
                        download={generatedFile.filename}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl flex items-center justify-center gap-2 transition-colors mb-6 shadow-lg shadow-blue-500/20"
                    >
                        <ArrowRight className="w-5 h-5 rotate-90" />
                        {t('audioExport.downloadAgain', { defaultValue: 'Download Again' })}
                    </a>

                    {/* Warning */}
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex gap-3 text-left">
                        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-amber-800 dark:text-amber-200">
                            <strong>{t('common.warning', { defaultValue: 'Warning' })}:</strong>
                            {' '}
                            {t('audioExport.closeWarning', { defaultValue: 'This file is saved locally. Closing this window will remove access to the playback.' })}
                        </div>
                    </div>

                    <button
                        onClick={onClose}
                        className="mt-8 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm font-medium transition-colors"
                    >
                        {t('buttons.close', { defaultValue: 'Close Window' })}
                    </button>
                </div>
            </div>
        );
    };

    const renderGenerate = () => {
        if (generatedFile) {
            return renderSuccess();
        }

        const percent = Math.round((genProgress.percent ?? (genProgress.current / (genProgress.total || 1)) * 100)) || 0;

        return (
            <div className="h-full flex-1 flex flex-col relative overflow-hidden bg-white dark:bg-gray-900 rounded-2xl">
                {/* Immersive Background */}
                <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-purple-50/50 to-blue-50/50 dark:from-slate-900 dark:via-purple-900/20 dark:to-slate-900 z-0" />

                {/* Animated Particles (CSS-only for simplicity) */}
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(147,51,234,0.05),transparent_50%)] animate-pulse z-0" />

                <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-8 text-center">

                    {/* Animated Waveform Visualization */}
                    <div className="relative mb-8">
                        {/* Ping rings */}
                        <div className="absolute inset-0 animate-ping rounded-full bg-purple-500/10" style={{ animationDuration: '3s' }} />
                        <div className="absolute inset-[-12px] animate-ping rounded-full bg-blue-500/10" style={{ animationDuration: '3s', animationDelay: '1.5s' }} />

                        {/* Core Icon */}
                        <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-2xl shadow-purple-500/30">
                            <Activity className="w-10 h-10 text-white animate-pulse" />
                        </div>
                    </div>

                    <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
                        {t('audioExport.generatingAudio', { defaultValue: 'Generating Your Audio' })}
                    </h2>
                    <p className="text-gray-500 dark:text-gray-400 mb-8 max-w-md mx-auto">
                        {t('audioExport.generatingDesc', { defaultValue: 'Synthesizing high-quality speech...' })}
                    </p>

                    {/* Progress Bar with Gradient */}
                    <div className="w-full max-w-md">
                        <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                            <span>Processing chunks...</span>
                            <span>{percent}%</span>
                        </div>
                        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden shadow-inner">
                            <div
                                className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 transition-all duration-500 ease-out relative"
                                style={{ width: `${percent}%` }}
                            >
                                <div className="absolute inset-0 bg-white/20 animate-pulse" />
                            </div>
                        </div>
                        <p className="text-xs text-gray-400 mt-3 font-mono">
                            {genProgress.status || `${genProgress.current} / ${genProgress.total} chunks ready`}
                        </p>
                    </div>

                    {/* Cancel Button */}
                    <button
                        onClick={handleCancelGeneration}
                        className="mt-8 px-6 py-2 rounded-full border border-gray-200 dark:border-gray-700 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-sm font-medium"
                    >
                        {t('buttons.cancel', { defaultValue: 'Cancel Generation' })}
                    </button>
                </div>
            </div>
        );
    };

    // ============================================================================
    // Main Wrapper
    // ============================================================================

    return (
        <div className="flex flex-col flex-1 min-h-0 h-full font-sans">
            {/* Error Display */}
            <AnimatePresence>
                {error && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-center gap-3 text-red-700 dark:text-red-300"
                    >
                        <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                        <p className="text-sm font-medium">{error}</p>
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="flex-1 min-h-0 relative">
                <AnimatePresence mode="wait">
                    {step === 'settings' && (
                        <motion.div
                            key="settings"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            className="h-full overflow-y-auto pr-2 scrollbar-hide"
                        >
                            {renderSettings()}
                        </motion.div>
                    )}
                    {step === 'review' && (
                        <motion.div
                            key="review"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="h-full"
                        >
                            {renderReview()}
                        </motion.div>
                    )}
                    {(step === 'generate' || step === 'success') && (
                        <motion.div
                            key="generate"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 1.05 }}
                            className="h-full"
                        >
                            {renderGenerate()}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Chunk Editor Modal (nested) */}
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

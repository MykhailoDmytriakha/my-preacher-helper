/**
 * Audio Generation Feature - Type Definitions
 * 
 * This file contains all types and interfaces for the sermon audio generation feature.
 * Used across: API routes, clients, and UI components.
 */

// ============================================================================
// Voice & Quality Options
// ============================================================================

/** Available TTS voice options */
export type TTSVoice = 'onyx' | 'echo' | 'ash';

/** Voice metadata for UI display */
export interface VoiceOption {
    id: TTSVoice;
    nameKey: string;        // i18n key, e.g., 'audioExport.voiceOnyx'
    description: string;    // For display: 'deep', 'natural', 'strong'
}

/** Audio quality levels */
export type AudioQuality = 'standard' | 'hd';

/** Quality to model mapping */
export const QUALITY_MODEL_MAP: Record<AudioQuality, string> = {
    standard: 'tts-1',
    hd: 'tts-1-hd',
} as const;

/** Default TTS model for cost-effective generation */
export const DEFAULT_TTS_MODEL = 'gpt-4o-mini-tts';

// ============================================================================
// Section Selection
// ============================================================================

/** Sermon sections that can be included in audio */
export type SermonSection = 'introduction' | 'mainPart' | 'conclusion';

/** Section selection options */
export type SectionSelection = 'all' | SermonSection;

// ============================================================================
// Audio Chunk (Persisted to Firestore)
// ============================================================================

/** 
 * Represents a single chunk of optimized speech text.
 * Saved to sermon.audioChunks[] for caching and future editing.
 */
export interface AudioChunk {
    /** Optimized text ready for TTS */
    text: string;
    /** Section this chunk belongs to */
    sectionId: SermonSection;
    /** ISO timestamp of creation */
    createdAt: string;
    /** Order within the section (0-indexed) */
    index: number;
}

/**
 * Metadata about the last audio generation.
 * Saved to sermon.audioMetadata for cache validation.
 */
export interface AudioMetadata {
    /** Voice used for generation */
    voice: TTSVoice;
    /** Model used for TTS */
    model: string;
    /** ISO timestamp of last generation */
    lastGenerated: string;
    /** Total chunks count */
    chunksCount: number;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/** Request body for POST /api/sermons/[id]/audio */
export interface GenerateAudioRequest {
    /** Voice to use for TTS */
    voice: TTSVoice;
    /** Audio quality (maps to TTS model) */
    quality: AudioQuality;
    /** Sections to include (default: all) */
    sections?: SectionSelection;
    /** Force regenerate chunks even if cached */
    forceRegenerate?: boolean;
}

/** Progress update during generation */
export interface AudioGenerationProgress {
    /** Current step */
    step: 'checking' | 'optimizing' | 'generating' | 'merging' | 'downloading';
    /** Progress percentage (0-100) */
    percent: number;
    /** Current chunk being processed (if in 'generating' step) */
    currentChunk?: number;
    /** Total chunks (if in 'generating' step) */
    totalChunks?: number;
    /** Message to display */
    message: string;
}

/** Result of audio generation */
export interface AudioGenerationResult {
    /** Whether cached chunks were used */
    usedCache: boolean;
    /** Number of chunks processed */
    chunksProcessed: number;
    /** Total audio duration in seconds (approximate) */
    durationSeconds: number;
    /** Audio blob (MP3) */
    audioBlob: Blob;
}

// ============================================================================
// Speech Optimization Types
// ============================================================================

/** Options for speech optimization */
export interface SpeechOptimizationOptions {
    /** Sermon title for context */
    sermonTitle: string;
    /** Main scripture verse for context */
    scriptureVerse?: string;
    /** Sections to optimize */
    sections: SectionSelection;
    /** Context from previous chunk for smooth transitions */
    previousContext?: string;
}

/** Result of speech optimization */
export interface SpeechOptimizationResult {
    /** Optimized text ready for TTS */
    optimizedText: string;
    /** Semantic chunks returned by LLM */
    chunks: string[];
    /** Character count before optimization */
    originalLength: number;
    /** Character count after optimization */
    optimizedLength: number;
}

// ============================================================================
// TTS Client Types
// ============================================================================

/** Options for TTS generation */
export interface TTSGenerationOptions {
    /** Voice to use */
    voice: TTSVoice;
    /** Model to use (derived from quality) */
    model: string;
    /** Audio format */
    format?: 'mp3' | 'opus' | 'wav';
}

/** Result of single chunk TTS */
export interface TTSChunkResult {
    /** Audio data as Blob */
    audioBlob: Blob;
    /** Chunk index */
    index: number;
    /** Duration in seconds (approximate) */
    durationSeconds: number;
}

// ============================================================================
// UI State Types
// ============================================================================

/** State of the audio export modal */
export interface AudioExportModalState {
    /** Whether modal is open */
    isOpen: boolean;
    /** Selected voice */
    voice: TTSVoice;
    /** Selected quality */
    quality: AudioQuality;
    /** Selected sections */
    sections: SectionSelection;
    /** Force regenerate flag */
    forceRegenerate: boolean;
    /** Current generation progress (null if not generating) */
    progress: AudioGenerationProgress | null;
    /** Error message (null if no error) */
    error: string | null;
}

/** Initial state for audio export modal */
export const INITIAL_AUDIO_EXPORT_STATE: AudioExportModalState = {
    isOpen: false,
    voice: 'onyx',
    quality: 'standard',
    sections: 'all',
    forceRegenerate: false,
    progress: null,
    error: null,
};

// ============================================================================
// Constants
// ============================================================================

/** Maximum characters per TTS chunk */
export const MAX_CHUNK_SIZE = 4000;

/** Available voices with metadata */
export const AVAILABLE_VOICES: VoiceOption[] = [
    { id: 'onyx', nameKey: 'audioExport.voiceOnyx', description: 'deep' },
    { id: 'echo', nameKey: 'audioExport.voiceEcho', description: 'natural' },
];

/** Steps in the audio generation wizard */
export type WizardStep = 'settings' | 'optimize' | 'review' | 'preview' | 'generate' | 'success';

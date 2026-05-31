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

/** Available TTS providers */
export type TTSProvider = 'openai' | 'google';

/** Hardcoded Google/Gemini TTS models for the audio export experiment */
export type GoogleTTSModel = 'gemini-3.1-flash-tts-preview' | 'gemini-2.5-flash-preview-tts';

/** Hardcoded Gemini TTS prebuilt voice names */
export type GoogleTTSVoice =
    | 'Zephyr'
    | 'Puck'
    | 'Charon'
    | 'Kore'
    | 'Fenrir'
    | 'Leda'
    | 'Orus'
    | 'Aoede'
    | 'Callirrhoe'
    | 'Autonoe'
    | 'Enceladus'
    | 'Iapetus'
    | 'Umbriel'
    | 'Algieba'
    | 'Despina'
    | 'Erinome'
    | 'Algenib'
    | 'Rasalgethi'
    | 'Laomedeia'
    | 'Achernar'
    | 'Alnilam'
    | 'Schedar'
    | 'Gacrux'
    | 'Pulcherrima'
    | 'Achird'
    | 'Zubenelgenubi'
    | 'Vindemiatrix'
    | 'Sadachbia'
    | 'Sadaltager'
    | 'Sulafat';

/** Voice metadata for UI display */
export interface VoiceOption {
    id: TTSVoice;
    nameKey: string;        // i18n key, e.g., 'audioExport.voiceOnyx'
    descKey: string;        // i18n key for short description, e.g., 'audioExport.voiceDeep'
}

export interface GoogleTTSModelOption {
    id: GoogleTTSModel;
    labelKey: string;
    descKey: string;
}

export interface GoogleVoiceOption {
    id: GoogleTTSVoice;
    tone: string;
}

/** Audio quality levels */
export type AudioQuality = 'standard' | 'hd';

/**
 * Source of the audio text:
 * - 'ai'  — GPT-optimized for natural speech (references expanded, numbers spelled out, markdown stripped)
 * - 'raw' — the original sermon text as-is, only mechanically split into TTS-sized chunks
 */
export type AudioSourceMode = 'ai' | 'raw';

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

/** Canonical sermon section keys, in narration order. Single source of truth. */
export const SERMON_SECTIONS: SermonSection[] = ['introduction', 'mainPart', 'conclusion'];

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
    /** TTS provider used for generation */
    provider?: TTSProvider;
    /** Voice used for generation */
    voice: TTSVoice | GoogleTTSVoice;
    /** Model used for TTS */
    model: string;
    /** ISO timestamp of last generation */
    lastGenerated: string;
    /** Total chunks count */
    chunksCount: number;
    /** Which source produced the current chunks: AI-optimized or original-as-is */
    mode?: AudioSourceMode;
    /** ISO timestamp of last text preparation (optimize/use-as-is) */
    lastOptimized?: string;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/** Request body for POST /api/sermons/[id]/audio */
export interface GenerateAudioRequest {
    /** Provider to use for TTS generation */
    provider?: TTSProvider;
    /** Voice to use for TTS */
    voice: TTSVoice | GoogleTTSVoice;
    /** Audio quality (maps to TTS model) */
    quality: AudioQuality;
    /** Explicit model override, used by Google/Gemini TTS */
    model?: string;
    /** Sections to include (default: all) — single key, 'all', or an array of keys */
    sections?: SectionSelection | SermonSection[];
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
    /** TTS provider */
    provider?: TTSProvider;
    /** Voice to use */
    voice: TTSVoice | GoogleTTSVoice;
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
    /** MIME type of the returned audio blob */
    mimeType?: string;
}

// ============================================================================
// UI State Types
// ============================================================================

/** State of the audio export modal */
export interface AudioExportModalState {
    /** Selected TTS provider */
    provider: TTSProvider;
    /** Whether modal is open */
    isOpen: boolean;
    /** Selected voice */
    voice: TTSVoice;
    /** Selected quality */
    quality: AudioQuality;
    /** Selected Google/Gemini TTS model */
    googleModel: GoogleTTSModel;
    /** Selected Google/Gemini voice */
    googleVoice: GoogleTTSVoice;
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
    provider: 'openai',
    isOpen: false,
    voice: 'onyx',
    quality: 'standard',
    googleModel: 'gemini-2.5-flash-preview-tts',
    googleVoice: 'Kore',
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
    { id: 'onyx', nameKey: 'audioExport.voiceOnyx', descKey: 'audioExport.voiceDeep' },
    { id: 'echo', nameKey: 'audioExport.voiceEcho', descKey: 'audioExport.voiceNatural' },
];

export const GOOGLE_TTS_MODELS: GoogleTTSModelOption[] = [
    {
        id: 'gemini-2.5-flash-preview-tts',
        labelKey: 'audioExport.googleModelGemini25',
        descKey: 'audioExport.googleModelGemini25Desc',
    },
    {
        id: 'gemini-3.1-flash-tts-preview',
        labelKey: 'audioExport.googleModelGemini31',
        descKey: 'audioExport.googleModelGemini31Desc',
    },
];

export const GOOGLE_TTS_VOICES: GoogleVoiceOption[] = [
    { id: 'Kore', tone: 'Firm' },
    { id: 'Puck', tone: 'Upbeat' },
    { id: 'Charon', tone: 'Informative' },
    { id: 'Aoede', tone: 'Breezy' },
    { id: 'Algieba', tone: 'Smooth' },
    { id: 'Sulafat', tone: 'Warm' },
    { id: 'Achird', tone: 'Friendly' },
    { id: 'Gacrux', tone: 'Mature' },
    { id: 'Schedar', tone: 'Even' },
    { id: 'Vindemiatrix', tone: 'Gentle' },
    { id: 'Iapetus', tone: 'Clear' },
    { id: 'Algenib', tone: 'Gravelly' },
    { id: 'Zephyr', tone: 'Bright' },
    { id: 'Fenrir', tone: 'Excitable' },
    { id: 'Leda', tone: 'Youthful' },
    { id: 'Orus', tone: 'Firm' },
    { id: 'Callirrhoe', tone: 'Easy-going' },
    { id: 'Autonoe', tone: 'Bright' },
    { id: 'Enceladus', tone: 'Breathy' },
    { id: 'Umbriel', tone: 'Easy-going' },
    { id: 'Despina', tone: 'Smooth' },
    { id: 'Erinome', tone: 'Clear' },
    { id: 'Rasalgethi', tone: 'Informative' },
    { id: 'Laomedeia', tone: 'Upbeat' },
    { id: 'Achernar', tone: 'Soft' },
    { id: 'Alnilam', tone: 'Firm' },
    { id: 'Pulcherrima', tone: 'Forward' },
    { id: 'Zubenelgenubi', tone: 'Casual' },
    { id: 'Sadachbia', tone: 'Lively' },
    { id: 'Sadaltager', tone: 'Knowledgeable' },
];

/** Steps in the audio generation wizard */
export type WizardStep = 'settings' | 'optimize' | 'review' | 'preview' | 'generate' | 'success';

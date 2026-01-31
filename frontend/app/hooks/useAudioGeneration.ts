/**
 * Audio Generation Hook
 * 
 * Custom hook for managing audio generation state and API calls.
 */

import { useState, useCallback } from 'react';

import { downloadAudioAsFile, generateAudioFilename } from '@/utils/audioConcat';

import type {
    AudioGenerationProgress,
    GenerateAudioRequest,
} from '@/types/audioGeneration.types';

// ============================================================================
// Types
// ============================================================================

interface UseAudioGenerationOptions {
    sermonId: string;
    sermonTitle: string;
}

interface UseAudioGenerationResult {
    /** Current generation progress */
    progress: AudioGenerationProgress | null;
    /** Error message if any */
    error: string | null;
    /** Whether generation is in progress */
    isGenerating: boolean;
    /** Starts audio generation */
    generate: (options: GenerateAudioRequest) => Promise<void>;
    /** Resets state */
    reset: () => void;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for managing audio generation flow.
 * 
 * @example
 * ```typescript
 * const { progress, error, isGenerating, generate, reset } = useAudioGeneration({
 *   sermonId: sermon.id,
 *   sermonTitle: sermon.title,
 * });
 * 
 * const handleGenerate = async () => {
 *   await generate({ voice: 'onyx', quality: 'standard', sections: 'all' });
 * };
 * ```
 */
export function useAudioGeneration({
    sermonId,
    sermonTitle,
}: UseAudioGenerationOptions): UseAudioGenerationResult {
    const [progress, setProgress] = useState<AudioGenerationProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);

    const reset = useCallback(() => {
        setProgress(null);
        setError(null);
        setIsGenerating(false);
    }, []);

    const generate = useCallback(async (options: GenerateAudioRequest) => {
        setIsGenerating(true);
        setError(null);

        try {
            // Step 1: Check cache
            setProgress({ step: 'checking', percent: 10, message: 'Проверка кеша...' });

            // Call API endpoint
            const response = await fetch(`/api/sermons/${sermonId}/audio`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(options),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to generate audio');
            }

            // Step 5: Downloading
            setProgress({ step: 'downloading', percent: 95, message: 'Скачивание...' });

            // Get blob and download
            const blob = await response.blob();
            downloadAudioAsFile(blob, generateAudioFilename(sermonTitle));

            setProgress(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error occurred');
            setProgress(null);
        } finally {
            setIsGenerating(false);
        }
    }, [sermonId, sermonTitle]);

    return {
        progress,
        error,
        isGenerating,
        generate,
        reset,
    };
}

export default useAudioGeneration;

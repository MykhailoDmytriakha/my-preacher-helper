// Centralized audio recording configuration
// Provides consistent defaults with environment variable overrides

export const AUDIO_RECORDING_DEFAULTS = {
    /** Base recording duration in seconds */
    DURATION_SECONDS: 90,
    /** Grace period at end of recording (countdown 3-2-1) */
    GRACE_PERIOD_SECONDS: 3,
} as const;

/**
 * Get the main recording duration from environment or default
 * @returns Duration in seconds
 */
export const getAudioRecordingDuration = (): number => {
    if (typeof process === 'undefined' || !process.env) {
        return AUDIO_RECORDING_DEFAULTS.DURATION_SECONDS;
    }
    const envValue = process.env.NEXT_PUBLIC_AUDIO_RECORDING_DURATION;
    if (!envValue) {
        return AUDIO_RECORDING_DEFAULTS.DURATION_SECONDS;
    }
    const parsed = parseInt(envValue, 10);
    return isNaN(parsed) || parsed <= 0
        ? AUDIO_RECORDING_DEFAULTS.DURATION_SECONDS
        : parsed;
};

/**
 * Get the grace period duration from environment or default
 * @returns Grace period in seconds
 */
export const getAudioGracePeriod = (): number => {
    if (typeof process === 'undefined' || !process.env) {
        return AUDIO_RECORDING_DEFAULTS.GRACE_PERIOD_SECONDS;
    }
    const envValue = process.env.NEXT_PUBLIC_AUDIO_GRACE_PERIOD;
    if (!envValue) {
        return AUDIO_RECORDING_DEFAULTS.GRACE_PERIOD_SECONDS;
    }
    const parsed = parseInt(envValue, 10);
    return isNaN(parsed) || parsed < 0
        ? AUDIO_RECORDING_DEFAULTS.GRACE_PERIOD_SECONDS
        : parsed;
};

/**
 * Get the total maximum recording duration (base + grace period)
 * @returns Total duration in seconds
 */
export const getTotalRecordingDuration = (): number => {
    return getAudioRecordingDuration() + getAudioGracePeriod();
};

import {
    getAudioRecordingDuration,
    getAudioGracePeriod,
    getTotalRecordingDuration,
    AUDIO_RECORDING_DEFAULTS
} from '@/utils/audioRecorderConfig';

describe('audioRecorderConfig', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe('getAudioRecordingDuration', () => {
        it('returns default value when no env var is set', () => {
            delete process.env.NEXT_PUBLIC_AUDIO_RECORDING_DURATION;
            expect(getAudioRecordingDuration()).toBe(AUDIO_RECORDING_DEFAULTS.DURATION_SECONDS);
        });

        it('returns parsed env value when set', () => {
            process.env.NEXT_PUBLIC_AUDIO_RECORDING_DURATION = '120';
            expect(getAudioRecordingDuration()).toBe(120);
        });

        it('returns default when env value is invalid', () => {
            process.env.NEXT_PUBLIC_AUDIO_RECORDING_DURATION = 'invalid';
            expect(getAudioRecordingDuration()).toBe(AUDIO_RECORDING_DEFAULTS.DURATION_SECONDS);
        });

        it('returns default when env value is <= 0', () => {
            process.env.NEXT_PUBLIC_AUDIO_RECORDING_DURATION = '0';
            expect(getAudioRecordingDuration()).toBe(AUDIO_RECORDING_DEFAULTS.DURATION_SECONDS);

            process.env.NEXT_PUBLIC_AUDIO_RECORDING_DURATION = '-10';
            expect(getAudioRecordingDuration()).toBe(AUDIO_RECORDING_DEFAULTS.DURATION_SECONDS);
        });
    });

    describe('getAudioGracePeriod', () => {
        it('returns default value when no env var is set', () => {
            delete process.env.NEXT_PUBLIC_AUDIO_GRACE_PERIOD;
            expect(getAudioGracePeriod()).toBe(AUDIO_RECORDING_DEFAULTS.GRACE_PERIOD_SECONDS);
        });

        it('returns parsed env value when set', () => {
            process.env.NEXT_PUBLIC_AUDIO_GRACE_PERIOD = '10';
            expect(getAudioGracePeriod()).toBe(10);
        });

        it('returns default when env value is invalid', () => {
            process.env.NEXT_PUBLIC_AUDIO_GRACE_PERIOD = 'abc';
            expect(getAudioGracePeriod()).toBe(AUDIO_RECORDING_DEFAULTS.GRACE_PERIOD_SECONDS);
        });

        it('returns default when env value is < 0', () => {
            process.env.NEXT_PUBLIC_AUDIO_GRACE_PERIOD = '-5';
            expect(getAudioGracePeriod()).toBe(AUDIO_RECORDING_DEFAULTS.GRACE_PERIOD_SECONDS);
        });

        it('returns 0 if explicitly set to 0', () => {
            process.env.NEXT_PUBLIC_AUDIO_GRACE_PERIOD = '0';
            expect(getAudioGracePeriod()).toBe(0);
        });
    });

    describe('getTotalRecordingDuration', () => {
        it('returns sum of duration and grace period', () => {
            process.env.NEXT_PUBLIC_AUDIO_RECORDING_DURATION = '100';
            process.env.NEXT_PUBLIC_AUDIO_GRACE_PERIOD = '5';
            expect(getTotalRecordingDuration()).toBe(105);
        });
    });
});

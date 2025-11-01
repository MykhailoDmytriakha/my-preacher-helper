import {
  DEFAULT_TIMER_SETTINGS,
  TIMER_PRESETS,
  TIMER_INTERVALS,
  VISUAL_EFFECTS,
  TIMER_COLORS,
  TIMER_STATUSES,
  PHASE_TRANSITIONS,
  TIMER_VALIDATION,
  TIMER_LAYOUT,
  TIMER_ACCESSIBILITY,
  TIMER_ERRORS,
  TIMER_ERROR_MESSAGES,
  TIMER_SUCCESS_MESSAGES,
  getDefaultSettings,
  getTimerPreset,
  getPhaseColor,
  getEmergencyColor
} from '../timerConstants';
import { TimerSettings } from '../../types/TimerState';

describe('timerConstants', () => {
  describe('DEFAULT_TIMER_SETTINGS', () => {
    it('should have valid standard settings', () => {
      const settings = DEFAULT_TIMER_SETTINGS.STANDARD;
      expect(settings.totalDuration).toBe(1200); // 20 minutes
      expect(settings.introductionRatio).toBe(0.2);
      expect(settings.mainRatio).toBe(0.6);
      expect(settings.conclusionRatio).toBe(0.2);

      // Ratios should sum to 1
      const totalRatio = settings.introductionRatio + settings.mainRatio + settings.conclusionRatio;
      expect(totalRatio).toBeCloseTo(1, 2);
    });

    it('should have valid short settings', () => {
      const settings = DEFAULT_TIMER_SETTINGS.SHORT;
      expect(settings.totalDuration).toBe(600); // 10 minutes
      expect(settings.introductionRatio).toBe(0.25);
      expect(settings.mainRatio).toBe(0.65);
      expect(settings.conclusionRatio).toBe(0.1);
    });

    it('should have valid long settings', () => {
      const settings = DEFAULT_TIMER_SETTINGS.LONG;
      expect(settings.totalDuration).toBe(1800); // 30 minutes
      expect(settings.introductionRatio).toBe(0.15);
      expect(settings.mainRatio).toBe(0.8);
      expect(settings.conclusionRatio).toBe(0.05);
    });

    it('should have valid devotion settings', () => {
      const settings = DEFAULT_TIMER_SETTINGS.DEVOTION;
      expect(settings.totalDuration).toBe(300); // 5 minutes
      expect(settings.introductionRatio).toBe(0.3);
      expect(settings.mainRatio).toBe(0.6);
      expect(settings.conclusionRatio).toBe(0.1);
    });
  });

  describe('TIMER_PRESETS', () => {
    it('should have valid preset values', () => {
      expect(TIMER_PRESETS.DEVOTION).toBe(5);
      expect(TIMER_PRESETS.SHORT).toBe(10);
      expect(TIMER_PRESETS.STANDARD).toBe(20);
      expect(TIMER_PRESETS.LONG).toBe(30);
      expect(TIMER_PRESETS.EXTENDED).toBe(45);
    });
  });

  describe('TIMER_INTERVALS', () => {
    it('should have reasonable interval values', () => {
      expect(TIMER_INTERVALS.COUNTDOWN).toBe(1000); // 1 second
      expect(TIMER_INTERVALS.UI_UPDATE).toBe(100); // 100ms
      expect(TIMER_INTERVALS.PHASE_CHECK).toBe(500); // 500ms
      expect(TIMER_INTERVALS.EMERGENCY_THRESHOLD).toBe(60); // 1 minute
    });
  });

  describe('VISUAL_EFFECTS', () => {
    it('should have valid visual effect timings', () => {
      expect(VISUAL_EFFECTS.BLINK_DURATION).toBe(300);
      expect(VISUAL_EFFECTS.PHASE_BLINK_COUNT).toBe(4);
      expect(VISUAL_EFFECTS.FULLSCREEN_BLINK_DURATION).toBe(500);
      expect(VISUAL_EFFECTS.FULLSCREEN_BLINK_COUNT).toBe(5);
      expect(VISUAL_EFFECTS.TRANSITION_DURATION).toBe(500);
    });
  });

  describe('TIMER_COLORS', () => {
    it('should have valid phase colors', () => {
      expect(TIMER_COLORS.PHASES.introduction).toMatch(/^#[0-9A-F]{6}$/i);
      expect(TIMER_COLORS.PHASES.main).toMatch(/^#[0-9A-F]{6}$/i);
      expect(TIMER_COLORS.PHASES.conclusion).toMatch(/^#[0-9A-F]{6}$/i);
      expect(TIMER_COLORS.PHASES.finished).toMatch(/^#[0-9A-F]{6}$/i);
    });

    it('should have valid emergency colors', () => {
      expect(TIMER_COLORS.EMERGENCY.WARNING).toMatch(/^#[0-9A-F]{6}$/i);
      expect(TIMER_COLORS.EMERGENCY.CRITICAL).toMatch(/^#[0-9A-F]{6}$/i);
      expect(TIMER_COLORS.EMERGENCY.URGENT).toMatch(/^#[0-9A-F]{6}$/i);
    });

    it('should have valid UI colors', () => {
      expect(TIMER_COLORS.UI.BACKGROUND).toMatch(/^#[0-9A-F]{6}$/i);
      expect(TIMER_COLORS.UI.TEXT).toMatch(/^#[0-9A-F]{6}$/i);
      expect(TIMER_COLORS.DARK.BACKGROUND).toMatch(/^#[0-9A-F]{6}$/i);
    });
  });

  describe('TIMER_STATUSES', () => {
    it('should have valid status constants', () => {
      expect(TIMER_STATUSES.IDLE).toBe('idle');
      expect(TIMER_STATUSES.RUNNING).toBe('running');
      expect(TIMER_STATUSES.PAUSED).toBe('paused');
      expect(TIMER_STATUSES.FINISHED).toBe('finished');
    });
  });

  describe('PHASE_TRANSITIONS', () => {
    it('should define automatic transitions', () => {
      expect(PHASE_TRANSITIONS.AUTOMATIC.introduction.next).toBe('main');
      expect(PHASE_TRANSITIONS.AUTOMATIC.main.next).toBe('conclusion');
      expect(PHASE_TRANSITIONS.AUTOMATIC.conclusion.next).toBe('finished');
    });

    it('should define manual transitions', () => {
      expect(PHASE_TRANSITIONS.MANUAL.introduction.canSkipTo).toContain('main');
      expect(PHASE_TRANSITIONS.MANUAL.main.canSkipTo).toContain('conclusion');
      expect(PHASE_TRANSITIONS.MANUAL.conclusion.canSkipTo).toContain('finished');
    });
  });

  describe('TIMER_VALIDATION', () => {
    it('should have valid duration limits', () => {
      expect(TIMER_VALIDATION.DURATION.MIN).toBe(60); // 1 minute
      expect(TIMER_VALIDATION.DURATION.MAX).toBe(7200); // 2 hours
      expect(TIMER_VALIDATION.DURATION.DEFAULT).toBe(1200); // 20 minutes
    });

    it('should have valid ratio limits', () => {
      expect(TIMER_VALIDATION.RATIOS.INTRODUCTION.MIN).toBe(0.05);
      expect(TIMER_VALIDATION.RATIOS.INTRODUCTION.MAX).toBe(0.4);
      expect(TIMER_VALIDATION.RATIOS.MAIN.MIN).toBe(0.4);
      expect(TIMER_VALIDATION.RATIOS.MAIN.MAX).toBe(0.9);
    });

    it('should have valid phase warnings', () => {
      expect(TIMER_VALIDATION.PHASE_WARNINGS.TOO_SHORT).toBe(60);
      expect(TIMER_VALIDATION.PHASE_WARNINGS.TOO_LONG).toBe(1800);
    });
  });

  describe('TIMER_LAYOUT', () => {
    it('should have valid size definitions', () => {
      expect(TIMER_LAYOUT.SIZES.SMALL.width).toBe(320);
      expect(TIMER_LAYOUT.SIZES.MEDIUM.height).toBe(100);
      expect(TIMER_LAYOUT.SIZES.LARGE.width).toBe(480);
    });

    it('should have valid spacing', () => {
      expect(TIMER_LAYOUT.SPACING.PADDING).toBe(16);
      expect(TIMER_LAYOUT.SPACING.GAP).toBe(12);
    });

    it('should have valid font sizes', () => {
      expect(TIMER_LAYOUT.FONT_SIZES.TIME_DISPLAY).toBe(36);
      expect(TIMER_LAYOUT.FONT_SIZES.PHASE_LABEL).toBe(14);
    });
  });

  describe('TIMER_ACCESSIBILITY', () => {
    it('should have valid ARIA labels', () => {
      expect(TIMER_ACCESSIBILITY.LABELS.TIMER_DISPLAY).toBe('Current time remaining');
      expect(TIMER_ACCESSIBILITY.LABELS.START_BUTTON).toBe('Start timer');
      expect(TIMER_ACCESSIBILITY.LABELS.PAUSE_BUTTON).toBe('Pause timer');
    });

    it('should have valid keyboard shortcuts', () => {
      expect(TIMER_ACCESSIBILITY.SHORTCUTS.START).toBe('Space');
      expect(TIMER_ACCESSIBILITY.SHORTCUTS.STOP).toBe('Escape');
    });

    it('should have valid focus order', () => {
      expect(TIMER_ACCESSIBILITY.FOCUS_ORDER).toContain('start-button');
      expect(TIMER_ACCESSIBILITY.FOCUS_ORDER).toContain('stop-button');
    });
  });

  describe('TIMER_ERRORS and TIMER_ERROR_MESSAGES', () => {
    it('should have matching error codes and messages', () => {
      expect(TIMER_ERROR_MESSAGES[TIMER_ERRORS.INVALID_DURATION])
        .toBe('Timer duration must be between 1 minute and 2 hours');
      expect(TIMER_ERROR_MESSAGES[TIMER_ERRORS.INVALID_RATIOS])
        .toBe('Phase ratios must be valid percentages that sum to 100%');
    });
  });

  describe('TIMER_SUCCESS_MESSAGES', () => {
    it('should have valid success messages', () => {
      expect(TIMER_SUCCESS_MESSAGES.TIMER_STARTED).toBe('Timer started successfully');
      expect(TIMER_SUCCESS_MESSAGES.TIMER_FINISHED).toBe('Preaching session completed!');
    });
  });

  describe('Utility functions', () => {
    describe('getDefaultSettings', () => {
      it('should return standard settings by default', () => {
        const settings = getDefaultSettings();
        expect(settings.totalDuration).toBe(1200);
        expect(settings.introductionRatio).toBe(0.2);
      });

      it('should return correct settings for presets', () => {
        const shortSettings = getDefaultSettings('SHORT');
        expect(shortSettings.totalDuration).toBe(600);

        const longSettings = getDefaultSettings('LONG');
        expect(longSettings.totalDuration).toBe(1800);
      });
    });

    describe('getTimerPreset', () => {
      it('should return correct preset values', () => {
        expect(getTimerPreset('STANDARD')).toBe(20);
        expect(getTimerPreset('DEVOTION')).toBe(5);
        expect(getTimerPreset('EXTENDED')).toBe(45);
      });
    });

    describe('getPhaseColor', () => {
      it('should return valid hex colors for phases', () => {
        expect(getPhaseColor('introduction')).toMatch(/^#[0-9A-F]{6}$/i);
        expect(getPhaseColor('main')).toMatch(/^#[0-9A-F]{6}$/i);
        expect(getPhaseColor('conclusion')).toMatch(/^#[0-9A-F]{6}$/i);
        expect(getPhaseColor('finished')).toMatch(/^#[0-9A-F]{6}$/i);
      });
    });

    describe('getEmergencyColor', () => {
      it('should return critical color for very low time', () => {
        expect(getEmergencyColor(5)).toBe(TIMER_COLORS.EMERGENCY.CRITICAL);
      });

      it('should return urgent color for medium-low time', () => {
        expect(getEmergencyColor(20)).toBe(TIMER_COLORS.EMERGENCY.URGENT);
      });

      it('should return warning color for higher time', () => {
        expect(getEmergencyColor(45)).toBe(TIMER_COLORS.EMERGENCY.WARNING);
      });
    });
  });
});

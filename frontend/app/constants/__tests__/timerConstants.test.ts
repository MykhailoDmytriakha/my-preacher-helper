import { runScenarios } from '@test-utils/scenarioRunner'

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
  getEmergencyColor,
} from '../timerConstants'

describe('timerConstants', () => {
  it('validates constant objects', async () => {
    await runScenarios(
      [
        {
          name: 'default timer settings',
          run: () => {
            const standard = DEFAULT_TIMER_SETTINGS.STANDARD
            expect(standard.totalDuration).toBe(1200)
            expect(DEFAULT_TIMER_SETTINGS.SHORT.totalDuration).toBe(600)
          }
        },
        { name: 'presets map', run: () => expect(TIMER_PRESETS).toMatchObject({ DEVOTION: 5, EXTENDED: 45 }) },
        { name: 'intervals map', run: () => expect(TIMER_INTERVALS).toMatchObject({ COUNTDOWN: 1000 }) },
        { name: 'visual effects', run: () => expect(VISUAL_EFFECTS.BLINK_DURATION).toBe(300) },
        { name: 'color palettes', run: () => Object.values(TIMER_COLORS.PHASES).forEach((c) => expect(c).toMatch(/^#[0-9A-F]{6}$/i)) },
        { name: 'statuses', run: () => expect(TIMER_STATUSES).toMatchObject({ IDLE: 'idle' }) },
        { name: 'phase transitions', run: () => expect(PHASE_TRANSITIONS.AUTOMATIC.introduction.next).toBe('main') },
        { name: 'validation thresholds', run: () => expect(TIMER_VALIDATION.DURATION.MIN).toBe(60) },
        { name: 'layout tokens', run: () => expect(TIMER_LAYOUT.SIZES.SMALL.width).toBe(320) },
        { name: 'accessibility copy', run: () => expect(TIMER_ACCESSIBILITY.LABELS.TIMER_DISPLAY).toContain('time remaining') },
        { name: 'error messages', run: () => expect(TIMER_ERROR_MESSAGES[TIMER_ERRORS.INVALID_DURATION]).toContain('duration must be between') },
        { name: 'success messages', run: () => expect(TIMER_SUCCESS_MESSAGES.TIMER_STARTED).toContain('started') }
      ]
    )
  })

  it('validates helper functions', async () => {
    await runScenarios(
      [
        { name: 'getDefaultSettings', run: () => expect(getDefaultSettings('LONG').totalDuration).toBe(1800) },
        { name: 'getTimerPreset mirrors map', run: () => expect(getTimerPreset('DEVOTION')).toBe(5) },
        {
          name: 'phase colors return hex values',
          run: () => ['introduction', 'main', 'conclusion', 'finished'].forEach((phase) => expect(getPhaseColor(phase as any)).toMatch(/^#[0-9A-F]{6}$/i)),
        },
        {
          name: 'emergency colors map levels',
          run: () => {
            expect(getEmergencyColor(5)).toBe(TIMER_COLORS.EMERGENCY.CRITICAL)
            expect(getEmergencyColor(20)).toBe(TIMER_COLORS.EMERGENCY.URGENT)
          },
        },
      ]
    )
  })
})

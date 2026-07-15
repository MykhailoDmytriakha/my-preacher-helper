import {
  formatUsageResetDate,
  getAggregateUsageState,
  getDeterministicVerse,
  getDevUsageOverride,
  getGraceDedupKey,
  getUsageIndicatorTone,
  isConductRoute,
  normalizeGraceVerses,
  type UsageMetrics,
} from '@/utils/usageGrace';

import type { UsageMetricSnapshot, UsageState } from '@/services/usageLimits';

const metric = (used: number, baseLimit: number, state: UsageState): UsageMetricSnapshot => ({
  used,
  baseLimit,
  hardCap: baseLimit * 1.1,
  baseRemaining: Math.max(0, baseLimit - used),
  graceRemaining: Math.max(0, (baseLimit * 1.1) - Math.max(baseLimit, used)),
  state,
  resetsAt: '2026-08-01T00:00:00.000Z',
});

const metrics = (overrides: Partial<UsageMetrics> = {}): UsageMetrics => ({
  ai: metric(20, 100, 'normal'),
  transcription: metric(100, 1000, 'normal'),
  audio: metric(50, 1000, 'normal'),
  ...overrides,
});

describe('usageGrace utilities', () => {
  it('hides below 80%, shows amber at warning, and overage at or above base limit', () => {
    expect(getUsageIndicatorTone(metrics())).toBeNull();
    expect(getUsageIndicatorTone(metrics({ transcription: metric(800, 1000, 'warning') }))).toBe('warning');
    expect(getUsageIndicatorTone(metrics({ audio: metric(1000, 1000, 'grace') }))).toBe('overage');
  });

  it('uses the maximum utilization across all three resources', () => {
    const snapshot = metrics({
      ai: metric(79, 100, 'normal'),
      transcription: metric(810, 1000, 'warning'),
      audio: metric(50, 1000, 'normal'),
    });

    expect(getUsageIndicatorTone(snapshot)).toBe('warning');
    expect(getAggregateUsageState(snapshot)).toBe('warning');
  });

  it.each([
    ['production', '1', 'localhost', '95'],
    ['test', '1', 'localhost', '95'],
    ['development', '0', 'localhost', '95'],
    ['development', '1', 'example.com', '95'],
  ])('ignores dev override outside the exact guard (%s, %s, %s)', (nodeEnv, enabled, hostname, queryValue) => {
    expect(getDevUsageOverride({ nodeEnv, enabled, hostname, queryValue })).toBeNull();
  });

  it('accepts localhost development override and clamps only its presentation value', () => {
    expect(getDevUsageOverride({
      nodeEnv: 'development',
      enabled: '1',
      hostname: '127.0.0.1',
      queryValue: '150',
    })).toBe(120);
    expect(getUsageIndicatorTone(metrics(), 95)).toBe('warning');
  });

  it('rotates verses deterministically without empty entries', () => {
    const verses = normalizeGraceVerses(['one', '', 'two', null]);
    expect(verses).toEqual(['one', 'two']);
    expect(getDeterministicVerse(verses, '2026-08-01T00:00:00.000Z', 1)).toBe(
      getDeterministicVerse(verses, '2026-08-01T00:00:00.000Z', 1)
    );
    expect(getDeterministicVerse([], 'period', 1)).toBe('');
  });

  it('builds a uid+period+any-resource key and formats the reset by locale', () => {
    expect(getGraceDedupKey('u1', '2026-08-01T00:00:00.000Z')).toBe(
      'usage-grace:u1:2026-08-01T00:00:00.000Z:any-resource'
    );
    expect(formatUsageResetDate('2026-08-01T00:00:00.000Z', 'en-US')).toContain('Aug');
    expect(formatUsageResetDate('invalid', 'en-US')).toBe('');
  });

  it('matches only the exact conduct route', () => {
    expect(isConductRoute('/groups/group-1/conduct')).toBe(true);
    expect(isConductRoute('/groups/group-1/conduct/')).toBe(true);
    expect(isConductRoute('/groups/group-1')).toBe(false);
    expect(isConductRoute('/groups/group-1/conduct/notes')).toBe(false);
  });
});

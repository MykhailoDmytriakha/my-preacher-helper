import {
  hardCap,
  parseUsageCapError,
  UsageCapReachedError,
} from '@/services/usageLimits';

describe('usage limit shared contract', () => {
  it('uses flat grace with a minimum of two discrete actions', () => {
    expect(hardCap(1, 'discrete')).toBe(3);
    expect(hardCap(100, 'discrete')).toBe(110);
    expect(hardCap(1_200, 'continuous')).toBe(1_320);
  });

  it('parses the additive route envelope into a typed client error', () => {
    const error = parseUsageCapError({
      code: 'USAGE_CAP_REACHED',
      resource: 'audio',
      used: 1_320,
      baseLimit: 1_200,
      hardCap: 1_320,
      resetsAt: '2026-08-01T00:00:00.000Z',
    });

    expect(error).toBeInstanceOf(UsageCapReachedError);
    expect(error).toMatchObject({
      code: 'USAGE_CAP_REACHED',
      resource: 'audio',
      used: 1_320,
      baseLimit: 1_200,
      hardCap: 1_320,
      resetsAt: '2026-08-01T00:00:00.000Z',
    });
  });

  it('rejects malformed or legacy error bodies', () => {
    expect(parseUsageCapError({ error: 'AI usage limit exhausted' })).toBeNull();
    expect(parseUsageCapError({
      code: 'USAGE_CAP_REACHED',
      resource: 'ai',
      used: '110',
      baseLimit: 100,
      hardCap: 110,
      resetsAt: '2026-08-01T00:00:00.000Z',
    })).toBeNull();
  });
});

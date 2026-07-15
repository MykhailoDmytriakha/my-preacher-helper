import type {
  UsageMetricSnapshot,
  UsageResource,
  UsageState,
} from '@/services/usageLimits';

export type UsageIndicatorTone = 'warning' | 'overage' | null;
export type UsageMetrics = Record<UsageResource, UsageMetricSnapshot>;

const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1']);

const utilization = (metric: UsageMetricSnapshot): number => (
  metric.baseLimit > 0 ? metric.used / metric.baseLimit : 0
);

export function getMaxUsageMetric(metrics: UsageMetrics): {
  resource: UsageResource;
  metric: UsageMetricSnapshot;
  utilization: number;
} {
  const entries = Object.entries(metrics) as Array<[UsageResource, UsageMetricSnapshot]>;
  const [resource, metric] = entries.reduce((current, candidate) => (
    utilization(candidate[1]) > utilization(current[1]) ? candidate : current
  ));

  return { resource, metric, utilization: utilization(metric) };
}

export function getAggregateUsageState(metrics: UsageMetrics): UsageState {
  return getMaxUsageMetric(metrics).metric.state;
}

export function getUsageIndicatorTone(
  metrics: UsageMetrics,
  devUsageOverride: number | null = null
): UsageIndicatorTone {
  const percentage = devUsageOverride ?? getMaxUsageMetric(metrics).utilization * 100;
  if (percentage < 80) return null;
  return percentage >= 100 ? 'overage' : 'warning';
}

export function getDevUsageOverride(params: {
  nodeEnv: string | undefined;
  enabled: string | undefined;
  hostname: string | undefined;
  queryValue: string | null | undefined;
}): number | null {
  const { nodeEnv, enabled, hostname, queryValue } = params;
  if (
    nodeEnv !== 'development'
    || enabled !== '1'
    || !hostname
    || !LOCAL_DEV_HOSTS.has(hostname)
    || queryValue == null
    || queryValue.trim() === ''
  ) {
    return null;
  }

  const value = Number(queryValue);
  if (!Number.isFinite(value)) return null;
  return Math.min(120, Math.max(0, value));
}

export function getUsageRemaining(metric: UsageMetricSnapshot): number {
  return metric.state === 'grace' ? metric.graceRemaining : metric.baseRemaining;
}

export function formatUsageResetDate(resetsAt: string, locale: string): string {
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function normalizeGraceVerses(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((verse): verse is string => typeof verse === 'string' && verse.trim().length > 0)
    : [];
}

export function getDeterministicVerse(
  verses: string[],
  period: string,
  counter: number
): string {
  if (verses.length === 0) return '';

  let hash = Math.max(0, Math.trunc(counter));
  for (const character of period) {
    hash = ((hash * 31) + (character.codePointAt(0) ?? 0)) >>> 0;
  }

  return verses[hash % verses.length];
}

export function getGraceDedupKey(uid: string, resetsAt: string): string {
  return `usage-grace:${uid}:${resetsAt}:any-resource`;
}

export function isConductRoute(pathname: string | null | undefined): boolean {
  return /^\/groups\/[^/]+\/conduct\/?$/.test(pathname ?? '');
}

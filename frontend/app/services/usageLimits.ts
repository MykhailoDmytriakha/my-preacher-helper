export const GRACE_FRACTION = 0.10;
export const GRACE_MIN_DISCRETE = 2;
export const USAGE_CAP_REACHED_CODE = 'USAGE_CAP_REACHED' as const;

export type UsageKind = 'discrete' | 'continuous';
export type UsageResource = 'ai' | 'transcription' | 'audio';
export type UsageState = 'normal' | 'warning' | 'grace' | 'blocked';

export interface UsageMetricSnapshot {
  used: number;
  baseLimit: number;
  hardCap: number;
  baseRemaining: number;
  graceRemaining: number;
  state: UsageState;
  resetsAt: string;
}

export interface UsageCapErrorPayload {
  code: typeof USAGE_CAP_REACHED_CODE;
  resource: UsageResource;
  used: number;
  baseLimit: number;
  hardCap: number;
  resetsAt: string;
}

export function hardCap(baseLimit: number, kind: UsageKind): number {
  const proportionalGrace = Math.ceil(baseLimit * GRACE_FRACTION);
  const grace = kind === 'discrete'
    ? Math.max(proportionalGrace, GRACE_MIN_DISCRETE)
    : proportionalGrace;
  return baseLimit + grace;
}

export class UsageCapReachedError extends Error implements UsageCapErrorPayload {
  readonly code = USAGE_CAP_REACHED_CODE;

  constructor(
    readonly resource: UsageResource,
    readonly used: number,
    readonly baseLimit: number,
    readonly hardCap: number,
    readonly resetsAt: string
  ) {
    super(`Usage cap reached for ${resource}`);
    this.name = 'UsageCapReachedError';
  }
}

export const isUsageCapReachedError = (error: unknown): error is UsageCapReachedError =>
  error instanceof Error
  && (error as Error & { code?: unknown }).code === USAGE_CAP_REACHED_CODE;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isUsageResource = (value: unknown): value is UsageResource =>
  value === 'ai' || value === 'transcription' || value === 'audio';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function toUsageCapErrorPayload(error: UsageCapReachedError): UsageCapErrorPayload {
  return {
    code: error.code,
    resource: error.resource,
    used: error.used,
    baseLimit: error.baseLimit,
    hardCap: error.hardCap,
    resetsAt: error.resetsAt,
  };
}

/** Converts an API response body into the typed client error without trusting raw messages. */
export function parseUsageCapError(value: unknown): UsageCapReachedError | null {
  if (
    !isRecord(value)
    || value.code !== USAGE_CAP_REACHED_CODE
    || !isUsageResource(value.resource)
    || !isFiniteNumber(value.used)
    || !isFiniteNumber(value.baseLimit)
    || !isFiniteNumber(value.hardCap)
    || typeof value.resetsAt !== 'string'
    || Number.isNaN(Date.parse(value.resetsAt))
  ) {
    return null;
  }

  return new UsageCapReachedError(
    value.resource,
    value.used,
    value.baseLimit,
    value.hardCap,
    value.resetsAt
  );
}

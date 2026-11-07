export const ACCOUNT_READ_VERSION_HEADER = 'X-Account-Read-Version';

type ReadVersion = { seconds: number; nanoseconds: number };

export function formatAccountReadVersion({ seconds, nanoseconds }: ReadVersion): string {
  return `${seconds}:${String(nanoseconds).padStart(9, '0')}`;
}

function readVersion(value: unknown): ReadVersion | undefined {
  if (typeof value !== 'string') return;
  const match = /^(-?\d+):(\d{9})$/.exec(value);
  if (!match) return;
  const seconds = Number(match[1]);
  if (Number.isSafeInteger(seconds)) return { seconds, nanoseconds: Number(match[2]) };
}

export type VersionedAccountRead<T> = { readVersion: string; value: T };
export type AccountRead<T> = T | VersionedAccountRead<T>;

export function isVersionedAccountRead<T>(answer: AccountRead<T>): answer is VersionedAccountRead<T> {
  return Boolean(answer && typeof answer === 'object' && 'readVersion' in answer && 'value' in answer
    && readVersion(answer.readVersion));
}

export function accountReadValue<T>(answer: AccountRead<T>): T {
  return isVersionedAccountRead(answer) ? answer.value : answer;
}

export function accountReadFromResponse<T>(response: Response, value: T): AccountRead<T> {
  const version = response.headers?.get(ACCOUNT_READ_VERSION_HEADER);
  return version && readVersion(version) ? { readVersion: version, value } : value;
}

export function accountReadVersion(answer: unknown): string | undefined {
  return isVersionedAccountRead(answer) ? answer.readVersion : undefined;
}

/** A legacy answer remains readable, but cannot displace a known source version. */
export function keepCurrentReadVersion(current: unknown, candidate: unknown): boolean {
  const left = readVersion(current);
  if (!left) return false;
  const right = readVersion(candidate);
  return !right || left.seconds > right.seconds || (left.seconds === right.seconds && left.nanoseconds >= right.nanoseconds);
}

export function keepCurrentAccountRead(current: unknown, candidate: unknown): boolean {
  return keepCurrentReadVersion(accountReadVersion(current), accountReadVersion(candidate));
}

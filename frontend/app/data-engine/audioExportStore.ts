import type { UserEntitlement } from '@/models/models';

/** Internal owner/sermon-bound operational storage; no document paths or SDK handles. */
export type AudioExportKey =
  | { kind: 'head' }
  | { kind: 'admission'; exportId: string }
  | { kind: 'settlement'; exportId: string; outputId: string }
  | { kind: 'cache'; id: string };
export type AudioExportRecord = Record<string, unknown>;
export type AudioExportUsage = NonNullable<UserEntitlement['usage']>;
export interface AudioExportTransaction {
  read<T extends AudioExportRecord>(key: AudioExportKey): Promise<T | undefined>;
  readMany<T extends AudioExportRecord>(keys: AudioExportKey[]): Promise<Array<T | undefined>>;
  readUsage(): Promise<AudioExportUsage | undefined>;
  write(key: AudioExportKey, value: AudioExportRecord): void;
  writeUsage(usage: AudioExportUsage): void;
  removeCache(key: Extract<AudioExportKey, { kind: 'cache' }>): void;
}
export interface AudioExportStore {
  readonly userId: string;
  readonly sermonId: string;
  read<T extends AudioExportRecord>(key: AudioExportKey): Promise<T | undefined>;
  readMany<T extends AudioExportRecord>(keys: AudioExportKey[]): Promise<Array<T | undefined>>;
  cacheKeys(): Promise<Array<Extract<AudioExportKey, { kind: 'cache' }>>>;
  transaction<T>(run: (transaction: AudioExportTransaction) => Promise<T>): Promise<T>;
}

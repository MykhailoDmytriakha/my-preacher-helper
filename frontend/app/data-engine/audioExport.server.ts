import { createHash, randomUUID } from 'node:crypto';

import { AUDIO_EXPORT_BATCH_LIMIT, AUDIO_EXPORT_CHUNK_ATTEMPTS } from '@/config/audioGeneration';
import { createUsageAdmission, usageAfterConsumption } from '@/services/usageLimits.server';

import type { AudioExportKey, AudioExportStore, AudioExportTransaction } from './audioExportStore';
import type { UserEntitlement } from '@/models/models';
import type { TTSChunkResult } from '@/types/audioGeneration.types';

const MISSING = 'audio-export-missing';
const BUSY = 'audio-export-busy';
const CACHE_INVALID = 'audio-export-cache-invalid';
const NEWER_REQUEST = 'A newer request owns this audio batch';
const LEASE_MS = 90_000;
// Four fragments per transaction stay well below Firestore's 10 MiB request limit.
const FRAGMENT_BYTES = 512_000;
const CACHE_TRANSACTION_DOCUMENTS = 4;

type Receipt = {
  version: 1; userId: string; sermonId: string; exportId: string; fingerprint: string;
  total: number; limit: number; offset: number; end: number; generation: string;
  runId: string; leaseUntil: number; completed: boolean; retired: boolean;
};
type ChunkReceipt = {
  generation: string; attempts: number; ready?: boolean; partCount?: number;
  size?: number; hash?: string; durationSeconds?: number; mimeType?: string; outputId?: string;
};
export class AudioExportError extends Error {
  constructor(readonly code: 'audio-export-changed' | 'audio-export-busy' | 'audio-export-missing' | 'audio-export-cache-invalid', message: string) {
    super(message);
  }
}
const invalid = () => new AudioExportError('audio-export-changed', 'This export no longer matches the saved audio or generation settings');
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
export const audioExportFingerprint = (plan: unknown): string => digest(JSON.stringify(plan));

export interface BeginAudioExportInput {
  userId: string; sermonId: string; exportId?: unknown; fingerprint: string;
  offset: number; limit: number; total: number; entitlement: UserEntitlement | null | undefined;
}
interface Dependencies { store: AudioExportStore; now?: () => Date }

/** Server-only operational receipt. It never owns or edits the saved sermon/source. */
export async function beginAudioExportBatch(input: BeginAudioExportInput, dependencies: Dependencies) {
  const { store } = dependencies;
  assertStoreScope(store, input.userId, input.sermonId);
  const now = dependencies.now ?? (() => new Date());
  if (!Number.isInteger(input.offset) || input.offset < 0 || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > AUDIO_EXPORT_BATCH_LIMIT) {
    throw new AudioExportError(MISSING, 'Invalid audio batch window');
  }
  if (input.exportId !== undefined && (typeof input.exportId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(input.exportId))) {
    throw new AudioExportError(MISSING, 'Invalid audio export identity');
  }
  const ref: AudioExportKey = { kind: 'head' };
  const admissionRef = (exportId: string): AudioExportKey => ({ kind: 'admission', exportId });
  const runId = randomUUID();
  const time = now();
  const receipt = await store.transaction(async transaction => {
    const previous = await transaction.read<Receipt>(ref);
    const newStart = isNewStart(previous, input);
    let next: Receipt;
    if (newStart) {
      if (previous && !previous.completed && previous.leaseUntil > time.getTime()) {
        throw new AudioExportError(BUSY, 'The previous audio request is still running');
      }
      const exportId = typeof input.exportId === 'string' ? input.exportId : randomUUID();
      const admission = await transaction.read(admissionRef(exportId));
      if (admission) throw invalid();
      createUsageAdmission(input.userId, input.entitlement, ['ai', 'audio'], time);
      next = { version: 1, userId: input.userId, sermonId: input.sermonId,
        exportId,
        fingerprint: input.fingerprint, total: input.total, limit: input.limit,
        offset: 0, end: Math.min(input.total, input.limit), generation: randomUUID(), runId,
        leaseUntil: time.getTime() + LEASE_MS, completed: false, retired: false };
      transaction.write(admissionRef(exportId), { userId: input.userId, sermonId: input.sermonId, exportId,
        fingerprint: input.fingerprint, aiCharged: false });
    } else {
      next = resumedReceipt(previous, input, time, runId);
      if (next.completed) return next;
    }
    transaction.write(ref, next);
    return next;
  });

  const settlementRef = (outputId: string): AudioExportKey => ({ kind: 'settlement', exportId: receipt.exportId, outputId });
  const outputs = new Map<number, { outputId: string; durationSeconds: number }>();
  const assertCurrent = (value: Receipt | undefined, requireLease = false): Receipt => {
    if (!value || value.retired || value.generation !== receipt.generation || value.exportId !== receipt.exportId) throw invalid();
    if (requireLease && (value.completed || value.runId !== receipt.runId)) throw new AudioExportError(BUSY, NEWER_REQUEST);
    return value;
  };
  const current = async (transaction: AudioExportTransaction, requireLease = false) =>
    assertCurrent(await transaction.read<Receipt>(ref), requireLease);
  const metaRef = (index: number): AudioExportKey => ({ kind: 'cache', id: `chunk-${index}` });
  const partRef = (index: number, part: number): AudioExportKey => ({ kind: 'cache', id: `bytes-${index}-${part}` });
  const readMeta = async (index: number) => {
    const value = await store.read<ChunkReceipt>(metaRef(index));
    return value?.generation === receipt.generation ? value : undefined;
  };

  // Reuse fixed per-sermon cache slots; no TTL, background queue or new storage service.
  // Listing projects metadata only; fenced cleanup reads/deletes at most four cached records at a time.
  const stale = await store.cacheKeys();
  for (let offset = 0; offset < stale.length; offset += CACHE_TRANSACTION_DOCUMENTS) {
    const references = stale.slice(offset, offset + CACHE_TRANSACTION_DOCUMENTS);
    await store.transaction(async transaction => {
      await current(transaction);
      const documents = await transaction.readMany(references);
      documents.forEach((document, index) => {
        if (document && document.generation !== receipt.generation) transaction.removeCache(references[index]);
      });
    });
  }

  const cachedChunk = async (index: number, metadata: ChunkReceipt): Promise<TTSChunkResult | undefined> => {
    if (metadata.partCount === undefined || metadata.hash === undefined || metadata.size === undefined || metadata.durationSeconds === undefined || metadata.mimeType === undefined || metadata.outputId === undefined) return undefined;
    const documents = await store.readMany(Array.from({ length: metadata.partCount }, (_, part) => partRef(index, part)));
    if (documents.some(document => document?.generation !== receipt.generation)) {
      if (metadata.ready) throw new AudioExportError(CACHE_INVALID, 'Saved audio is incomplete');
      return undefined;
    }
    const bytes = Buffer.concat(documents.map(document => Buffer.from(document!.bytes as Uint8Array)));
    if (bytes.length !== metadata.size || digest(bytes) !== metadata.hash) {
      if (metadata.ready) throw new AudioExportError(CACHE_INVALID, 'Saved audio failed its integrity check');
      return undefined;
    }
    await store.transaction(async transaction => {
      const head = await current(transaction);
      if (!metadata.ready) {
        if (head.runId !== receipt.runId) throw new AudioExportError(BUSY, NEWER_REQUEST);
        const value = await transaction.read<ChunkReceipt>(metaRef(index));
        if (!value || value.generation !== metadata.generation || value.outputId !== metadata.outputId ||
          value.hash !== metadata.hash || value.size !== metadata.size || value.partCount !== metadata.partCount) {
          throw new AudioExportError(CACHE_INVALID, 'Saved audio changed during recovery');
        }
        if (head.completed) {
          const settlement = await transaction.read(settlementRef(metadata.outputId!));
          if (!settlement) throw new AudioExportError(CACHE_INVALID, 'Completed audio has no settlement');
        }
        transaction.write(metaRef(index), { ...value, ready: true });
      }
    });
    outputs.set(index, { outputId: metadata.outputId, durationSeconds: metadata.durationSeconds });
    return { audioBlob: new Blob([new Uint8Array(bytes)], { type: metadata.mimeType }), index,
      durationSeconds: metadata.durationSeconds, mimeType: metadata.mimeType };
  };

  return {
    exportId: receipt.exportId,
    async chunk(index: number, sourceText: string, produce: () => Promise<TTSChunkResult>): Promise<TTSChunkResult> {
      if (!Number.isInteger(index) || index < receipt.offset || index >= receipt.end) throw invalid();
      const prior = await readMeta(index);
      if (prior) {
        const result = await cachedChunk(index, prior);
        if (result) return result;
      }
      const outputId = randomUUID();
      let attempts = 0;
      await store.transaction(async transaction => {
        const head = await current(transaction);
        if (head.completed) throw new AudioExportError(CACHE_INVALID, 'Completed audio has no cached chunk');
        if (head.runId !== receipt.runId) throw new AudioExportError(BUSY, NEWER_REQUEST);
        const previous = await transaction.read<ChunkReceipt>(metaRef(index));
        const value = previous?.generation === receipt.generation ? previous : { generation: receipt.generation, attempts: 0 };
        // Lease recovery never grants more provider work. Exhaustion is a new paid attempt.
        if (value.attempts >= AUDIO_EXPORT_CHUNK_ATTEMPTS) {
          createUsageAdmission(input.userId, input.entitlement, ['ai', 'audio'], now());
          value.attempts = 0;
        }
        attempts = value.attempts + 1;
        transaction.write(metaRef(index), { generation: receipt.generation, attempts });
      });
      const generated = await produce();
      const bytes = Buffer.from(await generated.audioBlob.arrayBuffer());
      const { getMeteredAudioDurationSeconds } = await import('@/utils/server/audioDurationMetering.server');
      const metadata: ChunkReceipt = { generation: receipt.generation,
        attempts, outputId, ready: false,
        partCount: Math.max(1, Math.ceil(bytes.length / FRAGMENT_BYTES)), size: bytes.length, hash: digest(bytes),
        durationSeconds: await getMeteredAudioDurationSeconds(generated.audioBlob, generated.mimeType || generated.audioBlob.type || 'audio/mpeg', sourceText),
        mimeType: generated.mimeType || generated.audioBlob.type || 'audio/mpeg' };
      outputs.set(index, { outputId, durationSeconds: metadata.durationSeconds! });
      try {
        await store.transaction(async transaction => {
          await current(transaction, true);
          transaction.write(metaRef(index), metadata);
        });
        for (let part = 0; part < metadata.partCount!; part += CACHE_TRANSACTION_DOCUMENTS) {
          await store.transaction(async transaction => {
            await current(transaction, true);
            for (let i = part; i < Math.min(part + CACHE_TRANSACTION_DOCUMENTS, metadata.partCount!); i++) {
              transaction.write(partRef(index, i), { generation: receipt.generation, bytes: bytes.subarray(i * FRAGMENT_BYTES, (i + 1) * FRAGMENT_BYTES) });
            }
          });
        }
        await store.transaction(async transaction => {
          await current(transaction, true);
          transaction.write(metaRef(index), { ...metadata, ready: true });
        });
      } catch {
        // Available provider bytes remain deliverable/accountable even if caching fails or publication was revoked.
        // Never turn a storage error into a second paid provider attempt.
        console.warn('[TTS] Audio cache could not be completed; retaining the generated output for settlement');
      }
      return { ...generated, durationSeconds: metadata.durationSeconds! };
    },
    async complete(): Promise<boolean> {
      if (outputs.size !== receipt.end - receipt.offset) {
        throw new AudioExportError(CACHE_INVALID, 'Audio batch is not completely generated');
      }
      const settlements = [...outputs.values()].map(output => ({ ...output,
        ref: settlementRef(output.outputId),
      }));
      return store.transaction(async transaction => {
        const head = await transaction.read<Receipt>(ref);
        const admission = await transaction.read(admissionRef(receipt.exportId));
        if (!admission || admission.fingerprint !== receipt.fingerprint) throw invalid();
        const recorded = await transaction.readMany(settlements.map(settlement => settlement.ref));
        const usage = await transaction.readUsage();
        const unrecorded = settlements.filter((_, index) => !recorded[index]);
        const aiUsed = admission.aiCharged ? 0 : 1;
        if (unrecorded.length || aiUsed) {
          transaction.writeUsage(usageAfterConsumption(usage, {
            audioSecondsUsed: unrecorded.reduce((sum, output) => sum + output.durationSeconds, 0), aiUsed,
          }, now()));
          transaction.write(admissionRef(receipt.exportId), { ...admission, aiCharged: true });
          for (const output of unrecorded) transaction.write(output.ref, { userId: input.userId, sermonId: input.sermonId,
            exportId: receipt.exportId, outputId: output.outputId, durationSeconds: output.durationSeconds });
        }
        const mayPublish = Boolean(head && !head.retired && head.generation === receipt.generation &&
          head.exportId === receipt.exportId && head.runId === receipt.runId);
        if (mayPublish && !head!.completed) transaction.write(ref, { ...head!, completed: true, leaseUntil: 0 });
        return mayPublish;
      });
    },
    async fail(): Promise<void> {
      await store.transaction(async transaction => {
        const head = await transaction.read<Receipt>(ref);
        if (head && !head.retired && head.generation === receipt.generation && head.runId === runId && !head.completed) {
          transaction.write(ref, { ...head, leaseUntil: 0 });
        }
      });
    },
    async release(): Promise<void> {
      await acknowledgeAudioExport(input.userId, input.sermonId, receipt.exportId, { store, now });
    },
  };
}

/** Cleanup is independent of current sermon existence and is safe to retry after a lost ACK. */
export async function acknowledgeAudioExport(userId: string, sermonId: string, exportId: string, dependencies: Dependencies): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(exportId)) throw new AudioExportError(MISSING, 'Invalid audio export identity');
  const { store } = dependencies;
  assertStoreScope(store, userId, sermonId);
  const ref: AudioExportKey = { kind: 'head' };
  const generation = await store.transaction(async transaction => {
    const head = await transaction.read<Receipt>(ref);
    // An old ACK must never remove a newer export's bytes. A repeated absent ACK has nothing to clean.
    if (!head || head.userId !== userId || head.sermonId !== sermonId || head.exportId !== exportId) return undefined;
    if (!head.completed || head.end !== head.total) throw invalid();
    if (!head.retired) transaction.write(ref, { ...head, retired: true });
    return head.generation;
  });
  if (generation) await clearRetiredAudioCache(store, generation);
}

async function clearRetiredAudioCache(store: AudioExportStore, generation: string) {
  const documents = await store.cacheKeys();
  for (let offset = 0; offset < documents.length; offset += CACHE_TRANSACTION_DOCUMENTS) {
    const references = documents.slice(offset, offset + CACHE_TRANSACTION_DOCUMENTS);
    await store.transaction(async transaction => {
      const head = await transaction.read<Receipt>({ kind: 'head' });
      if (!head?.retired || head.generation !== generation) return;
      for (const reference of references) transaction.removeCache(reference);
    });
  }
}

function assertStoreScope(store: AudioExportStore, userId: string, sermonId: string): void {
  if (store.userId !== userId || store.sermonId !== sermonId) throw invalid();
}

function isNewStart(previous: Receipt | undefined, input: BeginAudioExportInput): boolean {
  if (input.offset !== 0) return false;
  if (!previous) return true;
  return input.exportId === undefined ? previous.completed : previous.exportId !== input.exportId;
}

function resumedReceipt(previous: Receipt | undefined, input: BeginAudioExportInput, time: Date, runId: string): Receipt {
  if (!previous) throw new AudioExportError(MISSING, 'Start an audio export before continuing it');
  if (previous.version !== 1 || previous.userId !== input.userId || previous.sermonId !== input.sermonId || previous.retired ||
    input.exportId !== undefined && previous.exportId !== input.exportId || previous.fingerprint !== input.fingerprint ||
    previous.total !== input.total || previous.limit !== input.limit) throw invalid();
  if (previous.offset === input.offset && previous.completed) return previous;
  if (previous.offset === input.offset) {
    if (previous.leaseUntil > time.getTime()) throw new AudioExportError(BUSY, 'The previous audio request is still running');
    return { ...previous, runId, leaseUntil: time.getTime() + LEASE_MS };
  }
  if (previous.completed && previous.end === input.offset && input.offset < input.total) {
    return { ...previous, offset: input.offset, end: Math.min(input.total, input.offset + input.limit),
      generation: randomUUID(), runId, leaseUntil: time.getTime() + LEASE_MS, completed: false };
  }
  throw invalid();
}

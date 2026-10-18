/** @jest-environment node */
import { audioExportFirestore } from '../../test-utils/audioExportFirestore';

import { beginAudioExportBatch, acknowledgeAudioExport } from '@/data-engine/audioExport.server';
import { createAudioExportStore } from '@/data-engine/server';
import { UsageCapReachedError } from '@/services/usageLimits';

jest.mock('@/config/firebaseAdminConfig', () => ({ adminDb: {} }));
jest.mock('@/utils/server/audioDurationMetering.server', () => ({ getMeteredAudioDurationSeconds: jest.fn(async () => 2) }));

const base = { userId: 'owner', sermonId: 'sermon', exportId: 'qa-export', fingerprint: 'plan-1', offset: 0, limit: 1, total: 2 };
const usage = (aiUsed = 0, audioSecondsUsed = 0) => ({ paidTier: 'free' as const, usage: { aiUsed, audioSecondsUsed, transcriptionSecondsUsed: 0, periodStart: '2026-10-01T00:00:00.000Z' } });
const audio = (value = 'saved audio') => ({ audioBlob: new Blob([value], { type: 'audio/mpeg' }), index: 0, durationSeconds: 999, mimeType: 'audio/mpeg' });

describe('server-owned audio export continuation', () => {
  const make = () => {
    const io = audioExportFirestore(); let milliseconds = Date.parse('2026-10-18T21:00:00Z');
    const now = () => new Date(milliseconds);
    io.documents.set('users/owner', usage(109, 1319));
    const start = (changes: Partial<Parameters<typeof beginAudioExportBatch>[0]> = {}) =>
      beginAudioExportBatch({ ...base, entitlement: usage(), ...changes }, { store: createAudioExportStore(changes.userId ?? base.userId, changes.sermonId ?? base.sermonId, io.db), now });
    return { ...io, start, advance: () => { milliseconds += 90_001; } };
  };

  it.each(['delivery acknowledgement', 'new export'])('cleans a large retained cache within a transaction byte budget: %s', async operation => {
    const io = make(); const store = createAudioExportStore(base.userId, base.sermonId, io.db);
    const batch = await io.start({ total: 1 }); await batch.chunk(0, 'Saved source words', async () => audio()); await batch.complete();
    const head = await store.read({ kind: 'head' });
    for (let part = 0; part < 24; part++) await store.transaction(async transaction =>
      transaction.write({ kind: 'cache', id: `bytes-0-${part}` }, { generation: head!.generation, bytes: Buffer.alloc(512_000) }));
    const native = io.db.runTransaction.bind(io.db); let peak = 0;
    const spy = jest.spyOn(io.db, 'runTransaction').mockImplementation((run: any) => native(async transaction => {
      let deletedBytes = 0;
      return run({ ...transaction, delete: (reference: any) => {
        deletedBytes += io.documents.get(reference.path)?.bytes?.byteLength ?? 0; peak = Math.max(peak, deletedBytes);
        if (deletedBytes > 10 * 1024 * 1024) throw new Error('Controlled 10 MiB delete-document budget exceeded');
        transaction.delete(reference);
      } });
    }) as never);
    try {
      if (operation === 'delivery acknowledgement') await acknowledgeAudioExport(base.userId, base.sermonId, base.exportId, { store });
      else await io.start({ total: 1, exportId: 'qa-next-export' });
      expect(await store.cacheKeys()).toHaveLength(0);
      expect(peak).toBeLessThanOrEqual(4 * 512_000);
    } finally { spy.mockRestore(); }
  });

  it('refuses a forged offset and a capped new start before granting work', async () => {
    const io = make();
    await expect(io.start({ offset: 1, entitlement: usage(110, 1320) })).rejects.toMatchObject({ code: 'audio-export-missing' });
    await expect(io.start({ entitlement: usage(110, 1320) })).rejects.toBeInstanceOf(UsageCapReachedError);
    expect([...io.documents.keys()]).toEqual(['users/owner']);
  });

  it('finishes admitted later chunks beyond the cap and replays identical bytes without another charge', async () => {
    const io = make(); const provider = jest.fn(async () => { expect(io.insideTransaction()).toBe(false); return audio(); });
    const first = await io.start(); await first.chunk(0, 'Saved source words', provider); await first.complete();
    expect(io.documents.get('users/owner')!.usage).toMatchObject({ aiUsed: 110, audioSecondsUsed: 1321 });
    const later = await io.start({ offset: 1, entitlement: usage(110, 1321) });
    const original = await later.chunk(1, 'Saved source words', provider); await later.complete();
    const replay = await io.start({ offset: 1, entitlement: usage(110, 1323) });
    expect(await (await replay.chunk(1, 'Saved source words', provider)).audioBlob.text()).toBe(await original.audioBlob.text());
    await replay.complete();
    expect(provider).toHaveBeenCalledTimes(2);
    expect(io.documents.get('users/owner')!.usage).toMatchObject({ aiUsed: 110, audioSecondsUsed: 1323 });
    expect([...io.documents.keys()].filter(key => key.includes('_audioExportCache'))).toHaveLength(2);
  });

  it('recognizes the first response retry by the identity already known to the browser', async () => {
    const io = make(); const provider = jest.fn(async () => audio());
    const first = await io.start(); await first.chunk(0, 'Saved source words', provider); await first.complete();
    const retry = await io.start({ entitlement: usage(110, 1321) });
    await retry.chunk(0, 'Saved source words', provider); await retry.complete();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(io.documents.get('users/owner')!.usage.aiUsed).toBe(110);
  });

  it.each([{ fingerprint: 'other words' }, { limit: 2 }, { offset: 1 }, { userId: 'other', offset: 1 }, { limit: 4 }])('refuses mismatched scope or cursor: %j', async changes => {
    const io = make(); await io.start();
    await expect(io.start(changes)).rejects.toBeDefined();
  });

  it('bounds uncertain retries across lease expiry and renews only against fresh admission', async () => {
    const io = make(); const failure = jest.fn(async () => { throw new Error('Provider response lost'); });
    const first = await io.start(); await expect(first.chunk(0, 'Saved source words', failure)).rejects.toThrow('Provider response lost');
    await expect(io.start()).rejects.toMatchObject({ code: 'audio-export-busy' });
    io.advance();
    const second = await io.start({ entitlement: usage(110, 1320) });
    await expect(second.chunk(0, 'Saved source words', failure)).rejects.toThrow('Provider response lost');
    await second.fail();
    const exhausted = await io.start({ entitlement: usage(110, 1320) });
    await expect(exhausted.chunk(0, 'Saved source words', failure)).rejects.toBeInstanceOf(UsageCapReachedError);
    expect(failure).toHaveBeenCalledTimes(2);
    await exhausted.fail();
    const renewed = await io.start(); const success = jest.fn(async () => audio());
    await renewed.chunk(0, 'Saved source words', success); await renewed.complete();
    expect(success).toHaveBeenCalledTimes(1);
  });

  it('retains a successful sibling while another chunk exhausts its attempts', async () => {
    const io = make(); const provider = jest.fn(async () => audio());
    const first = await io.start({ limit: 2 }); await first.chunk(0, 'Saved source words', provider);
    const failure = async () => { throw new Error('second chunk failed'); };
    await expect(first.chunk(1, 'Saved source words', failure)).rejects.toThrow(); await expect(first.chunk(1, 'Saved source words', failure)).rejects.toThrow(); await first.fail();
    const retry = await io.start({ limit: 2, entitlement: usage(110, 1320) });
    await retry.chunk(0, 'Saved source words', provider);
    await expect(retry.chunk(1, 'Saved source words', provider)).rejects.toBeInstanceOf(UsageCapReachedError);
    expect(provider).toHaveBeenCalledTimes(1);
    await expect(retry.complete()).rejects.toMatchObject({ code: 'audio-export-cache-invalid' });
    expect(io.documents.get('users/owner')!.usage.audioSecondsUsed).toBe(1319);
  });

  it('keeps the result and counts usage once after the completion acknowledgement is lost', async () => {
    const io = make(); const provider = jest.fn(async () => audio());
    const first = await io.start(); await first.chunk(0, 'Saved source words', provider);
    let once = true; io.fault(paths => { if (once && paths.includes('users/owner')) { once = false; return 'after'; } });
    await expect(first.complete()).rejects.toThrow('lost commit acknowledgement');
    const retry = await io.start({ entitlement: usage(110, 1321) }); await retry.chunk(0, 'Saved source words', provider); await retry.complete();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(io.documents.get('users/owner')!.usage).toMatchObject({ aiUsed: 110, audioSecondsUsed: 1321 });
  });

  it('does not publish usage or completion when their atomic commit fails', async () => {
    const io = make(); const first = await io.start(); await first.chunk(0, 'Saved source words', async () => audio());
    let once = true; io.fault(paths => { if (once && paths.includes('users/owner')) { once = false; return 'before'; } });
    await expect(first.complete()).rejects.toThrow('before publication');
    expect(io.documents.get('users/owner')!.usage.aiUsed).toBe(109);
    await first.complete(); expect(io.documents.get('users/owner')!.usage.aiUsed).toBe(110);
  });

  it('recovers a saved chunk after its final manifest acknowledgement is lost', async () => {
    const io = make(); const provider = jest.fn(async () => audio()); const first = await io.start();
    let metaWrites = 0; io.fault(paths => { if (paths.length === 1 && paths[0].endsWith('/chunk-0') && ++metaWrites === 3) return 'after'; });
    await expect(first.chunk(0, 'Saved source words', provider)).resolves.toBeDefined();
    await first.complete();
    io.fault(undefined); await first.fail();
    const retry = await io.start({ entitlement: usage(110, 1320) });
    expect(await (await retry.chunk(0, 'Saved source words', provider)).audioBlob.text()).toBe('saved audio');
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('records a fully successful old batch after its publication authority is superseded', async () => {
    const io = make(); const first = await io.start();
    let resolve!: (value: ReturnType<typeof audio>) => void;
    const pending = first.chunk(0, 'Saved source words', () => new Promise(done => { resolve = done; }));
    while (!resolve) await new Promise(done => setTimeout(done, 0));
    io.advance();
    const newer = await io.start({ exportId: 'qa-newer' }); resolve(audio('old bytes'));
    await expect(pending).resolves.toBeDefined();
    expect(await first.complete()).toBe(false);
    expect(io.documents.get('users/owner')!.usage.audioSecondsUsed).toBe(1321);
    await newer.chunk(0, 'Saved source words', async () => audio('newer bytes')); await newer.complete();
    expect([...io.documents.values()].filter(value => value.ready)).toHaveLength(1);
  });

  it('keeps the completed takeover bytes while settling a late old output and deduplicating their cached sibling', async () => {
    const io = make(); const first = await io.start({ limit: 2 });
    await first.chunk(0, 'Saved source words', async () => audio('shared sibling'));
    let resolve!: (value: ReturnType<typeof audio>) => void;
    const oldPending = first.chunk(1, 'Saved source words', () => new Promise(done => { resolve = done; }));
    while (!resolve) await new Promise(done => setTimeout(done, 0));
    io.advance();
    const takeover = await io.start({ limit: 2 });
    const shouldReuse = jest.fn(async () => audio('must not regenerate'));
    await takeover.chunk(0, 'Saved source words', shouldReuse);
    await takeover.chunk(1, 'Saved source words', async () => audio('current bytes'));
    expect(await takeover.complete()).toBe(true);
    resolve(audio('late old bytes')); await oldPending;
    const oldMayPublish = await first.complete();
    const replay = await io.start({ limit: 2, entitlement: usage(110, 1325) });
    const replayed = await replay.chunk(1, 'Saved source words', shouldReuse);
    expect({ oldMayPublish, replayed: await replayed.audioBlob.text(), usage: io.documents.get('users/owner')!.usage.audioSecondsUsed })
      .toEqual({ oldMayPublish: false, replayed: 'current bytes', usage: 1325 });
    expect(io.documents.get('users/owner')!.usage.aiUsed).toBe(110);
    expect(shouldReuse).not.toHaveBeenCalled();
  });

  it('delivers and accounts known successful audio when cache writes fail, without regenerating it on replay', async () => {
    const io = make(); const first = await io.start();
    const provider = jest.fn(async () => audio('still available bytes'));
    let once = true; io.fault(paths => { if (once && paths.some(path => path.includes('/bytes-'))) { once = false; return 'before'; } });
    const result = await first.chunk(0, 'Saved source words', provider);
    expect(await result.audioBlob.text()).toBe('still available bytes');
    expect(await first.complete()).toBe(true);
    expect(io.documents.get('users/owner')!.usage.audioSecondsUsed).toBe(1321);
    const replay = await io.start({ entitlement: usage(110, 1321) });
    await expect(replay.chunk(0, 'Saved source words', provider)).rejects.toMatchObject({ code: 'audio-export-cache-invalid' });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('does not replace an active paid request with a new export', async () => {
    const io = make(); await io.start();
    await expect(io.start({ exportId: 'qa-newer' })).rejects.toMatchObject({ code: 'audio-export-busy' });
  });

  it('retries final cleanup after its retired-state commit was acknowledged but cleanup failed', async () => {
    const io = make(); const first = await io.start({ total: 1 });
    await first.chunk(0, 'Saved source words', async () => audio()); await first.complete();
    let once = true; io.fault(paths => { if (once && paths.some(path => path.includes('/_audioExportCache/'))) { once = false; return 'before'; } });
    await expect(first.release()).rejects.toThrow('before publication');
    await expect(first.release()).resolves.toBeUndefined();
    expect([...io.documents.keys()].filter(key => key.includes('_audioExportCache'))).toHaveLength(0);
  });

  it('removes delivered final bytes and refuses reuse of the retired receipt', async () => {
    const io = make(); const first = await io.start({ total: 1 }); await first.chunk(0, 'Saved source words', async () => audio()); await first.complete(); await first.release();
    expect([...io.documents.keys()].filter(key => key.includes('_audioExportCache'))).toHaveLength(0);
    await expect(io.start({ total: 1 })).rejects.toMatchObject({ code: 'audio-export-changed' });
  });

  it('fragments a large binary chunk and verifies every byte on replay', async () => {
    const io = make(); const value = 'x'.repeat(1_600_000); const first = await io.start();
    const provider = jest.fn(async () => audio(value)); await first.chunk(0, 'Saved source words', provider); await first.complete();
    const parts = [...io.documents.values()].filter(data => data.bytes);
    expect(parts).toHaveLength(4); expect(parts.every(data => data.bytes.byteLength <= 512_000)).toBe(true);
    const retry = await io.start(); expect(await (await retry.chunk(0, 'Saved source words', provider)).audioBlob.text()).toBe(value);
    expect(provider).toHaveBeenCalledTimes(1);
  });
});

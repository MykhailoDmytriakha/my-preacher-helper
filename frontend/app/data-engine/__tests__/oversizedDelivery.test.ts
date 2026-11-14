/** @jest-environment node */
import { apiClient } from '@/utils/apiClient';

import { DataEngineRuntime } from '../runtime';
import { createHttpEngineTransport } from '../transport.client';

import type { DataCommand, JournalEntry, JournalStore } from '../types';

jest.mock('@/utils/apiClient', () => ({ apiClient: jest.fn() }));
jest.mock('@/utils/queryKeys', () => ({ resolveOwnerUid: () => 'owner' }));
jest.mock('@/utils/authenticatedRequest', () => ({
  getAuthenticatedRequestHeaders: async () => ({ Authorization: 'Bearer test' }),
  accountChangedError: () => new Error('Account changed'),
}));

const command = (content: string, operationId = 'large-save'): DataCommand => ({
  protocol: 1, operationId, owner: 'owner', resource: { collection: 'studyNotes', id: 'note' },
  generation: 'g', dependsOn: [], kind: 'update', changes: [{ path: ['content'],
    before: { exists: true, value: content }, after: { exists: true, value: content + 'b' } }],
});
const response = (status: number, value: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => value }) as Response;
function setup() {
  const entries = new Map<string, JournalEntry>();
  const journal: JournalStore = {
    put: async entry => { entries.set(entry.command.operationId, entry); },
    remove: async (_owner, id) => { entries.delete(id); },
    list: async () => [...entries.values()],
  };
  const boot = () => {
    const runtime = new DataEngineRuntime({ journal, transport: createHttpEngineTransport() });
    runtime.setOwner('owner');
    return runtime;
  };
  return { entries, boot };
}

beforeEach(() => jest.mocked(apiClient).mockReset());

it.each(['a'.repeat(530_000), 'я'.repeat(270_000)])('makes an oversized one-character save answerable after HTTP 413', async content => {
  const sent = command(content);
  expect(Buffer.byteLength(JSON.stringify(sent))).toBeGreaterThan(1024 * 1024);
  jest.mocked(apiClient).mockResolvedValue(response(413, { code: 'payload-too-large' }));
  const { entries, boot } = setup();
  const runtime = boot();
  await runtime.submit(sent); await runtime.drain();
  expect(entries.get(sent.operationId)).toMatchObject({ state: 'refused', attempts: 1,
    result: { kind: 'refused', operationId: sent.operationId, code: 'resource-exhausted' } });
  expect(entries.get(sent.operationId)?.command).toEqual(sent);
  const restored = boot(); await restored.drain();
  expect(apiClient).toHaveBeenCalledTimes(1);
  await restored.discard(sent.operationId);
  const shorter = command('shortened words', 'shorter-save');
  jest.mocked(apiClient).mockResolvedValue(response(200, { kind: 'acknowledged', operationId: shorter.operationId,
    snapshot: { resource: shorter.resource, value: { userId: 'owner', content: 'shortened wordsb' },
      metadata: { protocol: 1, generation: 'g', revision: 2, deleted: false } } }));
  await restored.submit(shorter); await restored.drain();
  expect(entries.get(shorter.operationId)?.state).toBe('acknowledged');
});

it.each([429, 500, 503])('keeps HTTP %i indeterminate and refuses to discard it', async status => {
  jest.mocked(apiClient).mockResolvedValue(response(status, { code: 'payload-too-large' }));
  const { entries, boot } = setup(); const runtime = boot();
  await runtime.submit(command('words')); await runtime.drain();
  expect(entries.get('large-save')?.state).toBe('unknown');
  await expect(runtime.discard('large-save')).rejects.toThrow('unresolved');
});

it.each(['deadline-exceeded', 'unavailable'])('keeps %s indeterminate', async code => {
  jest.mocked(apiClient).mockRejectedValue(Object.assign(new Error('No definitive answer'), { code }));
  const { entries, boot } = setup(); const runtime = boot();
  await runtime.submit(command('words')); await runtime.drain();
  expect(entries.get('large-save')?.state).toBe('unknown');
  await expect(runtime.discard('large-save')).rejects.toThrow('unresolved');
});

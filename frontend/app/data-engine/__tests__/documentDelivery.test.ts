import { canReplaceDocumentIntent, isDirectLegacyDocumentIntent, savedDocumentAnswer } from '../documentDelivery';

import type { CommitRequest } from '../commits';
import type { JournalEntry } from '../types';

const baseline = { resource: { collection: 'series', id: 'series' }, value: { userId: 'owner', title: 'Base' }, metadata: null };
const command = { protocol: 1 as const, owner: 'owner', operationId: 'relation', resource: baseline.resource,
  generation: null, kind: 'delete' as const, dependsOn: [], baseline: baseline.value };
const request = (id = 'request'): CommitRequest => ({ id, owner: 'owner', editorId: 'editor', editGeneration: 1, revision: 1,
  baseline, value: baseline.value, working: baseline, intended: baseline.value, predecessor: null, initialized: true,
  command, submitted: baseline.value, sequence: 1, state: 'conflict',
  result: { kind: 'conflict', operationId: id, snapshot: baseline, conflicts: [] }, unfinalized: [] });
const receipt = (state: JournalEntry['state']): JournalEntry => ({ command, state, attempts: 1, createdAt: 1 });
const canReplace = (requests: CommitRequest[], journal: JournalEntry[] = [receipt('acknowledged')], ids = ['request']) =>
  canReplaceDocumentIntent('owner', 'editor', ids, requests, journal);

it('uses the request conflict proof without mistaking a command ACK for a complete request', () => {
  expect(canReplace([request()])).toBe(true);
  expect(canReplace([{ ...request(), state: 'prepared', result: null }])).toBe(false);
  expect(canReplace([], [], [])).toBe(false);
});
it('requires every held identity and ignores evidence from another owner', () => {
  expect(canReplace([request()], [], ['request', 'missing'])).toBe(false);
  expect(canReplace([{ ...request(), owner: 'other' }])).toBe(false);
  const waiting = { ...request('waiting'), state: 'prepared' as const, result: null };
  expect(canReplace([request(), waiting], [{ ...receipt('refused'), command: { ...command, owner: 'other' } }])).toBe(false);
});
it.each(['queued', 'sending', 'unknown', 'blocked'] as const)('does not replace a same-editor sibling with %s delivery', state => {
  const sibling = { ...request('sibling'), state: 'prepared' as const, result: null,
    command: { ...command, operationId: 'sibling' }, editGeneration: 2 };
  expect(canReplace([request(), sibling], [receipt('acknowledged'), { ...receipt(state), command: sibling.command }])).toBe(false);
});
it('includes a dependent request from another editor and becomes available only when its delivery is terminal', () => {
  const dependent = { ...request('dependent'), editorId: 'another-editor', predecessor: 'request', state: 'prepared' as const,
    result: null, command: { ...command, operationId: 'dependent' } };
  expect(canReplace([request(), dependent])).toBe(false);
  expect(canReplace([request(), dependent], [{ ...receipt('conflict'), command: dependent.command }])).toBe(true);
});
it('leaves complete and incomplete atomic scopes to their action owner', () => {
  const a = { ...request(), atomic: { id: 'request', participants: ['request', 'b'] } };
  const b = { ...request('b'), editorId: 'atomic-b', atomic: a.atomic };
  expect(canReplace([a, b])).toBe(false);
  expect(canReplace([a])).toBe(false);
  const dependent = { ...b, predecessor: 'request' };
  expect(canReplace([request(), dependent])).toBe(false);
  const unrelated = { ...request('unrelated'), editorId: 'unrelated', atomic: { id: 'unrelated', participants: ['unrelated', 'other'] } };
  expect(canReplace([request(), unrelated, { ...unrelated, id: 'other', editorId: 'other' }])).toBe(true);
});


describe('the answer to a saved document request', () => {
  const answer = (requests: CommitRequest[], journal: JournalEntry[] = [], ids = ['request']) =>
    savedDocumentAnswer('owner', baseline.resource, ids, requests, journal);

  it.each(['queued', 'prepared', 'acknowledged', 'cancelled'] as const)('does not turn a %s request into a question because its old command failed', state => {
    const oldReceipt = { ...receipt('conflict'), command: { ...command, operationId: 'request' } };
    expect(answer([{ ...request(), state, result: null }], [oldReceipt])).toBeNull();
  });
  it('recognizes a request-only refusal and a conflict after a relation ACK', () => {
    expect(answer([request()], [receipt('acknowledged')])).toBe('conflict');
    expect(answer([{ ...request(), state: 'refused', result: { kind: 'refused', operationId: 'request', code: 'derived-field' } }])).toBe('refused');
  });
  it('keeps legacy direct-command answers, but stays silent while delivery is unresolved', () => {
    expect(answer([], [receipt('conflict')], ['relation'])).toBe('conflict');
    expect(answer([], [receipt('refused')], ['relation'])).toBe('refused');
    for (const state of ['queued', 'sending', 'unknown', 'blocked', 'acknowledged'] as const) {
      expect(answer([], [receipt(state)], ['relation'])).toBeNull();
    }
  });
  it('uses only held identities belonging to this owner and document', () => {
    expect(answer([request()], [], [])).toBeNull();
    expect(answer([{ ...request(), owner: 'another' }])).toBeNull();
    expect(answer([{ ...request(), baseline: { ...baseline, resource: { ...baseline.resource, id: 'another' } } }])).toBeNull();
    expect(answer([], [{ ...receipt('refused'), command: { ...command, owner: 'another' } }], ['relation'])).toBeNull();
    expect(answer([], [{ ...receipt('refused'), command: { ...command, resource: { ...baseline.resource, id: 'another' } } }], ['relation'])).toBeNull();
  });
});


it('recognizes only a sole directly prepared legacy command, never missing modern work', () => {
  expect(isDirectLegacyDocumentIntent(['old-command'], 'old-command')).toBe(true);
  expect(isDirectLegacyDocumentIntent([], undefined)).toBe(false);
  expect(isDirectLegacyDocumentIntent(['modern-request'], undefined)).toBe(false);
  expect(isDirectLegacyDocumentIntent(['modern-request'], 'old-command')).toBe(false);
  expect(isDirectLegacyDocumentIntent(['old-command', 'modern-request'], 'old-command')).toBe(false);
});

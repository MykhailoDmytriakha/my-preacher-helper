/** @jest-environment node */
import { prepareDomainCommand } from '../domainPolicy';
import { applyCommand, diffFields, validateCommand } from '../protocol';
import { planDataCommand } from '../serverRelations';

import type { DataCommand, DocumentData, ResourceSnapshot } from '../types';

const resource = { collection: 'studyNotes', id: 'note' };
const value: DocumentData = {
  userId: 'owner', title: 'Keep title', content: 'Original words', type: 'note',
  tags: ['keep-tag'], scriptureRefs: [], materialIds: [], isDraft: true,
  createdAt: 'created', updatedAt: 'updated',
};
const snapshot = (data: DocumentData | null = value): ResourceSnapshot => ({
  resource, value: data,
  metadata: data ? { protocol: 1, generation: 'generation', revision: 1, deleted: false } : null,
});
const update = (next: DocumentData): DataCommand => ({
  protocol: 1, owner: 'owner', operationId: 'save-recording', resource, generation: 'generation',
  dependsOn: [], kind: 'update', changes: diffFields(value, next),
});

describe('study note recording receipt admission', () => {
  it.each(['dictationSourceIds', 'recordingSourceIds'])(
    'prepares and applies %s without changing unrelated note fields', field => {
      const next = { ...value, [field]: ['recording-a'] };
      const prepared = prepareDomainCommand('owner', 'save-recording', snapshot(), next);
      expect(prepared.command).toEqual(update(next));
      expect(applyCommand(prepared.command, snapshot())).toMatchObject({
        kind: 'acknowledged', snapshot: { value: { ...value, [field]: ['recording-a'] } },
      });
      expect(value[field]).toBeUndefined();
    }
  );

  it('accepts restored text and both source identities in the actual server planner', async () => {
    const next = { ...value, content: 'Original words\n\nRestored words',
      dictationSourceIds: ['recording-a'], recordingSourceIds: ['recording-a'] };
    const plan = await planDataCommand(update(next), snapshot(), {
      get: async target => ({ resource: target, value: null, metadata: null }),
      list: async () => [],
    });
    expect(plan.result.kind).toBe('acknowledged');
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0].value).toEqual({ ...next, rev: { note: 1 } });
    expect(plan.writes[0].metadata).toMatchObject({ revision: 2, operationId: 'save-recording' });
  });

  it('retains recording metadata when creating a new note', () => {
    const next = { ...value, dictationSourceIds: ['recording-a'], recordingSourceIds: ['recording-a'] };
    const prepared = prepareDomainCommand('owner', 'create-recording', snapshot(null), next);
    expect(applyCommand(prepared.command, snapshot(null))).toMatchObject({
      kind: 'acknowledged', snapshot: { value: next },
    });
  });

  it('continues to reject an unregistered writable field', () => {
    expect(() => validateCommand(update({ ...value, administrativeGrant: true }))).toThrow('Invalid field change');
  });

  it.each(['dictationSourceIds', 'recordingSourceIds'])(
    'refuses malformed %s instead of accepting or dropping it', field => {
      const attempt = () => applyCommand(update({ ...value, [field]: 'not-an-id-array' }), snapshot());
      try {
        expect(attempt()).toMatchObject({ kind: 'refused', code: 'invalid-document' });
      } catch (error) {
        // Before admission, the envelope is refused earlier by the writable-field guard.
        // Either layer must refuse the malformed payload; a successful write never passes.
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Invalid field change');
      }
    }
  );

  it('does not permit an update of another owner\'s note', () => {
    expect(applyCommand(update({ ...value, content: 'Forbidden words' }), snapshot({ ...value, userId: 'other' })))
      .toMatchObject({ kind: 'refused', code: 'permission-denied' });
  });
});

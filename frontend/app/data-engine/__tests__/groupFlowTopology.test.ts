import { applyCommand, diffFields } from '../protocol';
import { DataSession } from '../session';

import type { DataCommand, DocumentData, ResourceSnapshot } from '../types';

const resource = { collection: 'groups', id: 'meeting-plan' };
const template = (id: string, content: string) => ({
  id, type: 'custom', title: id, content, status: 'filled', createdAt: 'created', updatedAt: 'updated',
});
const source = template('source', 'Words the copy must keep');
const neighbor = template('neighbor', 'Neighbor words');
const rows = (ids: string[]) => ids.map((id, index) => ({
  id, templateId: id === 'copy' ? source.id : id, order: index + 1,
}));
const opening = (ids: string[]): ResourceSnapshot => ({
  resource,
  value: { userId: 'owner', leaderNotes: 'Keep leader notes', flow: rows(ids), templates: [source, neighbor] },
  metadata: { protocol: 1, generation: 'group-generation', revision: 1, deleted: false, operationId: 'create' },
});
const update = (baseline: ResourceSnapshot, after: DocumentData, operationId: string): DataCommand => ({
  protocol: 1, owner: 'owner', resource, operationId, generation: baseline.metadata!.generation, dependsOn: [],
  kind: 'update', changes: diffFields(baseline.value!, after),
});
const apply = (command: DataCommand, current: ResourceSnapshot) => {
  const result = applyCommand(command, current);
  if (result.kind !== 'acknowledged') throw new Error(JSON.stringify(result));
  return result.snapshot;
};

describe('meeting-plan step topology', () => {
  it.each([
    { start: ['source', 'neighbor'], copy: ['source', 'copy', 'neighbor'], final: ['copy', 'neighbor'] },
    { start: ['neighbor', 'source'], copy: ['neighbor', 'source', 'copy'], final: ['neighbor', 'copy'] },
  ])('keeps the shared template when a previously unseen copy survives deletion ($start)', ({ start, copy, final }) => {
    const baseline = opening(start);
    const savedCopy = apply(update(baseline, { ...baseline.value, flow: rows(copy) }, 'duplicate'), baseline);
    const saved = apply(update(baseline, {
      ...baseline.value, flow: rows(['neighbor']), templates: [neighbor],
    }, 'delete-source'), savedCopy);

    expect(saved.value?.flow).toEqual(rows(final));
    expect(saved.value?.templates).toEqual([source, neighbor]);
    expect(saved.value?.leaderNotes).toBe('Keep leader notes');
  });

  it('does not acknowledge a legacy duplicate when its content cannot be recovered', () => {
    const baseline = opening(['neighbor', 'source']);
    const deleted = apply(update(baseline, {
      ...baseline.value, flow: rows(['neighbor']), templates: [neighbor],
    }, 'delete-source'), baseline);
    const stale = update(baseline, { ...baseline.value, flow: rows(['neighbor', 'source', 'copy']) }, 'duplicate');

    expect(applyCommand(stale, deleted)).toMatchObject({ kind: 'conflict', snapshot: deleted });
  });

  it('keeps the shown words when the owner explicitly recovers a previously prepared copy', () => {
    const baseline = opening(['source', 'neighbor']);
    const deleted = apply(update(baseline, {
      ...baseline.value, flow: rows(['neighbor']), templates: [neighbor],
    }, 'delete-source'), baseline);
    const session = new DataSession(baseline);
    const draft = { ...baseline.value, flow: rows(['source', 'copy', 'neighbor']) };
    session.edit(draft);
    session.registerCommit('legacy-copy', session.checkpoint().editGeneration, draft);
    session.accept(applyCommand(update(baseline, draft, 'legacy-copy'), deleted));
    session.release('legacy-copy');
    expect(session.checkpoint().conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['templates', 'id:source'] }),
    ]));

    session.keepLocal();
    expect(session.checkpoint().draft).toMatchObject({ flow: rows(['copy', 'neighbor']),
      templates: expect.arrayContaining([source, neighbor]) });
    const accepted = apply(session.prepare('confirmed-copy', 'owner')!, deleted);
    expect(accepted.value).toMatchObject({ flow: rows(['copy', 'neighbor']),
      templates: expect.arrayContaining([source, neighbor]) });
  });

  it('recovers the exact older request after its predecessor was compacted before reload', () => {
    const baseline = opening(['source', 'neighbor']);
    const deleted = apply(update(baseline, {
      ...baseline.value, flow: rows(['neighbor']), templates: [neighbor],
    }, 'delete-source'), baseline);
    const originalDraft = { ...baseline.value, flow: rows(['source', 'copy', 'neighbor']) };
    const rebasedDraft = { ...deleted.value, flow: rows(['copy', 'neighbor']) };
    const session = new DataSession(deleted);
    session.edit(rebasedDraft);
    session.registerCommit('legacy-rebased-copy', session.checkpoint().editGeneration, originalDraft);
    session.accept(applyCommand(update(deleted, rebasedDraft, 'legacy-rebased-copy'), deleted));
    session.release('legacy-rebased-copy');

    expect(session.checkpoint().draft?.templates).toEqual(expect.arrayContaining([source, neighbor]));
    session.keepLocal();
    const accepted = apply(session.prepare('confirmed-copy', 'owner')!, deleted);
    expect(accepted.value).toMatchObject({ flow: rows(['copy', 'neighbor']),
      templates: expect.arrayContaining([source, neighbor]) });
  });

  it('still removes the template when the explicitly deleted step was its last reference', () => {
    const baseline = opening(['source', 'neighbor']);
    const saved = apply(update(baseline, {
      ...baseline.value, flow: rows(['neighbor']), templates: [neighbor],
    }, 'delete-source'), baseline);

    expect(saved.value?.flow).toEqual(rows(['neighbor']));
    expect(saved.value?.templates).toEqual([neighbor]);
  });
});

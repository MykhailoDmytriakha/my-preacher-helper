import { submittedWorkCheckpoint } from '../submittedWork';
import type { CommitRequest } from '../commits';
const resource = { collection: 'groups', id: 'g' };
const original = { userId: 'owner', title: 'Original' };
const request = (id: string, predecessor: string | null = null): CommitRequest => ({
  id, owner: 'owner', editorId: id, editGeneration: 4, baseline: { resource, value: original, metadata: null },
  value: { ...original, title: id }, predecessor, revision: 1, initialized: false,
  working: { resource, value: original, metadata: null }, intended: { ...original, title: id },
  command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [],
});
it('filters owner and resource before selecting a submitted chain', () => {
  const stored = request('save');
  expect(submittedWorkCheckpoint('other', resource, [stored])).toBeNull();
  expect(submittedWorkCheckpoint('owner', { ...resource, id: 'elsewhere' }, [stored])).toBeNull();
  expect(submittedWorkCheckpoint('owner', resource, [stored])).toMatchObject({ draft: { title: 'save' }, confirmed: { value: original } });
});
it('leaves independent forks and incomplete ancestry to explicit recovery', () => {
  expect(submittedWorkCheckpoint('owner', resource, [request('a'), request('b')])).toBeNull();
  expect(submittedWorkCheckpoint('owner', resource, [request('child', 'missing')])).toBeNull();
});
it('uses a durable initialized working baseline after predecessor compaction', () => {
  const stored = { ...request('child', 'compacted'), initialized: true,
    working: { resource, value: { ...original, description: 'Remote sibling' }, metadata: null },
    intended: { ...original, title: 'child', description: 'Remote sibling' } };
  expect(submittedWorkCheckpoint('owner', resource, [stored])).toMatchObject({
    confirmed: { value: { description: 'Remote sibling' } }, draft: { title: 'child', description: 'Remote sibling' },
  });
});
it('retains immutable operation IDs and never mutates stored requests', () => {
  const records = [request('a'), request('b', 'a')];
  records[0].command = { protocol: 1, owner: 'owner', operationId: 'wire-a', resource, generation: null, dependsOn: [], kind: 'update', changes: [] };
  const captured = JSON.stringify(records);
  const checkpoint = submittedWorkCheckpoint('owner', resource, records)!;
  expect(Object.keys(checkpoint.pending)).toEqual(['a', 'b']);
  expect(checkpoint.pending.a.operations).toEqual(['wire-a']);
  checkpoint.draft!.title = 'new typing';
  expect(JSON.stringify(records)).toBe(captured);
});
it('ignores acknowledged or cancelled work and rejects dependency cycles', () => {
  expect(submittedWorkCheckpoint('owner', resource, [{ ...request('done'), state: 'acknowledged' }])).toBeNull();
  expect(submittedWorkCheckpoint('owner', resource, [{ ...request('cancelled'), state: 'cancelled' }, request('b', 'cancelled')])).toBeNull();
  expect(() => submittedWorkCheckpoint('owner', resource, [request('a', 'b'), request('b', 'a'), request('tip', 'a')])).toThrow('cycle');
  expect(submittedWorkCheckpoint('owner', resource, [request('a', 'b'), request('b', 'a'), request('independent')])).toBeNull();
});

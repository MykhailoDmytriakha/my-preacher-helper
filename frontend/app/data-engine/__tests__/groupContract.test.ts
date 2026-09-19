import { applyCommand, diffFields } from '../protocol';
import type { DataCommand, DocumentData, ResourceSnapshot } from '../types';
const resource = { collection: 'groups', id: 'group-1' };
const meeting = (id: string, date = '2026-09-19') => ({ id, date, createdAt: 'created', notes: 'Base' });
const base = (): DocumentData => ({ userId: 'owner', title: 'Group', status: 'draft', templates: [], flow: [], meetingDates: [meeting('a'), meeting('b')], createdAt: 'created', updatedAt: 'old' });
const snap = (value: DocumentData | null): ResourceSnapshot => ({ resource, value, metadata: null });
const command = (before: DocumentData, after: DocumentData): DataCommand => ({ protocol: 1, owner: 'owner', operationId: 'edit', resource, generation: null, dependsOn: [], kind: 'update', changes: diffFields(before, after) });
it('merges an offline meeting edit with a different device addition and sibling edit', () => {
  const opening = base();
  const result = applyCommand(command(opening, { ...opening, meetingDates: [meeting('a', '2026-09-21'), meeting('b')] }), snap({ ...opening, meetingDates: [meeting('a'), { ...meeting('b'), notes: 'Remote notes' }, meeting('c')] }));
  expect(result).toMatchObject({ kind: 'acknowledged', snapshot: { value: { meetingDates: [meeting('a', '2026-09-21'), { ...meeting('b'), notes: 'Remote notes' }, meeting('c')] } } });
});
it('preserves both versions when the same meeting field changes on two devices', () => {
  const opening = base();
  const result = applyCommand(command(opening, { ...opening, meetingDates: [meeting('a', '2026-09-21'), meeting('b')] }), snap({ ...opening, meetingDates: [meeting('a', '2026-09-22'), meeting('b')] }));
  expect(result).toMatchObject({ kind: 'conflict', conflicts: [expect.objectContaining({ base: { exists: true, value: '2026-09-19' }, mine: { exists: true, value: '2026-09-21' }, theirs: { exists: true, value: '2026-09-22' } })] });
});
it('does not let deletion erase remotely edited meeting notes', () => {
  const opening = base();
  expect(applyCommand(command(opening, { ...opening, meetingDates: [meeting('b')] }), snap({ ...opening, meetingDates: [{ ...meeting('a'), notes: 'New remote text' }, meeting('b')] }))).toMatchObject({ kind: 'conflict' });
});
it('cannot resurrect a remotely deleted group by replaying offline edits', () => {
  const opening = base();
  expect(applyCommand(command(opening, { ...opening, title: 'Offline text' }), { ...snap(null), metadata: { protocol: 1, generation: 'deleted', revision: 1, deleted: true } })).toMatchObject({ kind: 'deleted' });
});

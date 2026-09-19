import { sermonMetadataDateId, sermonMetadataPatch } from '@/components/sermon/sermonMetadataForm';
import type { Sermon } from '@/models/models';
import type { DocumentData } from '@/data-engine/types';

const named = { id: 'named', name: 'Named church' };
const unnamed = { id: 'church-unspecified', name: 'Unspecified' };
const value: DocumentData = { userId: 'owner', title: 'Title', verse: 'Romans', thoughts: [], date: 'now', preachDates: [
  { id: 'selected', date: '2099-01-01', status: 'planned', church: unnamed, notes: 'Keep notes', createdAt: 'old' },
  { id: 'other', date: '2099-01-02', status: 'planned', church: named, createdAt: 'old' },
] };

it('fills an unspecified planned church with the new sermon church while preserving dates and row details', () => {
  const patched = sermonMetadataPatch(value, { church: named }, 'selected', 'now', 'Unspecified');
  expect(patched).toMatchObject({ church: named, preachDates: [
    { id: 'selected', church: named, notes: 'Keep notes', createdAt: 'old' }, { id: 'other', church: named },
  ] });
  const changed = sermonMetadataPatch(patched, { church: { id: 'later', name: 'Later' }, plannedDate: '2099-02-01' }, 'selected', 'now', 'Unspecified');
  expect(changed.preachDates).toMatchObject([{ id: 'selected', date: '2099-02-01', church: named }, { id: 'other', date: '2099-01-02' }]);
  expect(value.preachDates).toMatchObject([{ church: unnamed }, { church: named }]);
});

it('removes only the selected date and clears the optional sermon church explicitly', () => {
  const result = sermonMetadataPatch({ ...value, church: named }, { church: undefined, plannedDate: '' }, 'selected', 'now', 'Unspecified');
  expect(result).not.toHaveProperty('church');
  expect(result.preachDates).toEqual([(value.preachDates as unknown[])[1]]);
});


it('keeps the edited or removed planned row after restart even when the calendar has moved past its original date', () => {
  const initial = value as unknown as Sermon;
  const moved = sermonMetadataPatch(value, { plannedDate: '2099-02-03' }, 'selected', 'now', 'Unspecified') as unknown as Sermon;
  expect(sermonMetadataDateId(initial, moved, 'new', new Date('2099-01-02T12:00:00Z'))).toBe('selected');
  const removed = sermonMetadataPatch(value, { plannedDate: '' }, 'selected', 'now', 'Unspecified') as unknown as Sermon;
  expect(sermonMetadataDateId(initial, removed, 'new', new Date('2099-01-02T12:00:00Z'))).toBe('selected');
});

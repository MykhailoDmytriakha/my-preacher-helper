import { sermonMetadataDateId, sermonMetadataForSave, sermonMetadataPatch } from '@/components/sermon/sermonMetadataForm';
import type { PreachDate, Sermon } from '@/models/models';
import type { DocumentData } from '@/data-engine/types';

const named = { id: 'named', name: 'Named church' };
const unnamed = { id: 'church-unspecified', name: 'Unspecified' };
const openingRow = { id: 'selected', date: '2099-01-01', status: 'planned' as const, church: unnamed, notes: 'Keep notes', createdAt: 'old' };
const sibling = { id: 'other', date: '2099-01-02', status: 'planned' as const, church: named, createdAt: 'old' };
const value: DocumentData = { userId: 'owner', title: 'Title', verse: 'Romans', thoughts: [], date: 'now', preachDates: [openingRow, sibling] };

it('fills an unspecified planned church with the new sermon church while preserving dates and row details', () => {
  const patched = sermonMetadataPatch(value, { church: named }, 'selected', 'now', 'Unspecified', openingRow);
  expect(patched).toMatchObject({ church: named, preachDates: [
    { id: 'selected', church: named, notes: 'Keep notes', createdAt: 'old' }, { id: 'other', church: named },
  ] });
  const [savedRow] = patched.preachDates as unknown as PreachDate[];
  const changed = sermonMetadataPatch(patched, { church: { id: 'later', name: 'Later' }, plannedDate: '2099-02-01' }, 'selected', 'now', 'Unspecified', savedRow);
  expect(changed.preachDates).toMatchObject([{ id: 'selected', date: '2099-02-01', church: named }, { id: 'other', date: '2099-01-02' }]);
  expect(value.preachDates).toMatchObject([{ church: unnamed }, { church: named }]);
});

it('clears only the selected day, preserving the date row and its notes', () => {
  const result = sermonMetadataPatch({ ...value, church: named }, { church: undefined, plannedDate: '' }, 'selected', 'now', 'Unspecified', openingRow);
  expect(result).not.toHaveProperty('church');
  const rows = value.preachDates as Array<Record<string, unknown>>;
  expect(result.preachDates).toEqual([{ ...rows[0], date: '' }, rows[1]]);
});


it('keeps the edited or cleared planned row after restart even when the calendar has moved past its original date', () => {
  const initial = value as unknown as Sermon;
  const moved = sermonMetadataPatch(value, { plannedDate: '2099-02-03' }, 'selected', 'now', 'Unspecified', openingRow) as unknown as Sermon;
  expect(sermonMetadataDateId(initial, moved, 'new', new Date('2099-01-02T12:00:00Z'))).toBe('selected');
  const cleared = sermonMetadataPatch(value, { plannedDate: '' }, 'selected', 'now', 'Unspecified', openingRow) as unknown as Sermon;
  expect(sermonMetadataDateId(initial, cleared, 'new', new Date('2099-01-02T12:00:00Z'))).toBe('selected');
});

it('uses the only existing unscheduled row when assigning a day again', () => {
  const [first] = value.preachDates as unknown as NonNullable<Sermon['preachDates']>;
  const opening = { ...value, preachDates: [{ ...first, date: '' }] } as unknown as Sermon;
  expect(sermonMetadataDateId(opening, opening, 'new', new Date('2099-01-01T12:00:00Z'))).toBe('selected');
});

it('drops a staged new date when its day is cleared before its first Save', () => {
  const opening = { ...value, preachDates: [] };
  const staged = sermonMetadataPatch(opening, { plannedDate: '2099-02-01' }, 'new', 'now', 'Unspecified', undefined);
  const cleared = sermonMetadataPatch(staged, { plannedDate: '' }, 'new', 'now', 'Unspecified', undefined);
  expect(cleared).toEqual(opening);
});

it.each([named, undefined])('reconciles a recovered provisional church with the final sermon value %j', finalChurch => {
  const draft: DocumentData = { ...value, ...(finalChurch && { church: finalChurch }),
    preachDates: [{ ...openingRow, church: { id: '', name: 'N', city: '' } }, sibling] };
  expect(sermonMetadataForSave(draft, openingRow.id, openingRow, 'Unspecified').preachDates).toEqual([
    { ...openingRow, church: finalChurch ?? unnamed }, sibling,
  ]);
});

it('does not fill an untouched unnamed row on a title-only Save', () => {
  const draft = { ...value, title: '  Revised  ', church: named };
  expect(sermonMetadataForSave(draft, openingRow.id, openingRow, 'Unspecified')).toEqual({ ...draft, title: 'Revised' });
});

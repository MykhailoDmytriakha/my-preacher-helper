import { keepUncontestedStudyNoteFields } from '../studyNoteTypeChoice';

import type { ConflictDetail, ResourceSnapshot } from '../types';

it('keeps the queued paragraph when taking the saved title of the same note', () => {
  const resource = { collection: 'studyNotes', id: 'note' };
  const metadata = { protocol: 1 as const, generation: 'generation', revision: 1, deleted: false };
  const basis: ResourceSnapshot = { resource, metadata, value: { title: 'Opening title', type: 'note', content: 'Opening body' } };
  const draft = { ...basis.value, title: 'Offline title', content: 'Offline paragraph' };
  const stored: ResourceSnapshot = { resource, metadata: { ...metadata, revision: 3 },
    value: { ...basis.value, title: 'Stored title' } };
  const conflicts: ConflictDetail[] = [{ path: ['title'], base: { exists: true, value: 'Opening title' },
    mine: { exists: true, value: 'Offline title' }, theirs: { exists: true, value: 'Stored title' } }];
  expect(keepUncontestedStudyNoteFields(basis, draft, stored, conflicts))
    .toEqual({ title: 'Stored title', type: 'note', content: 'Offline paragraph' });
});


it('keeps an independent paragraph when the queued title and type both conflict', () => {
  const resource = { collection: 'studyNotes', id: 'note' };
  const metadata = { protocol: 1 as const, generation: 'generation', revision: 1, deleted: false };
  const basis: ResourceSnapshot = { resource, metadata, value: { title: 'Original', type: 'note', content: 'Opening body' } };
  const draft = { ...basis.value, title: 'Offline', type: 'question', content: 'Offline paragraph' };
  const stored: ResourceSnapshot = { resource, metadata: { ...metadata, revision: 4 },
    value: { ...basis.value, title: 'Stored title' } };
  const conflicts: ConflictDetail[] = [
    { path: ['title'], base: { exists: true, value: 'Original' }, mine: { exists: true, value: 'Offline' }, theirs: { exists: true, value: 'Stored title' } },
    { path: ['type'], base: { exists: true, value: 'note' }, mine: { exists: true, value: 'question' }, theirs: { exists: true, value: 'note' } },
  ];
  expect(keepUncontestedStudyNoteFields(basis, draft, stored, conflicts))
    .toEqual({ title: 'Stored title', type: 'note', content: 'Offline paragraph' });
});

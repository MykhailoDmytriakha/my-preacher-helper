import { waitFor } from '@testing-library/react';

import { draftKey, readDraft, saveDraft } from '@/utils/durableDraft';

import { createOutlineTitleDraftStore, outlineTitleDraftResource } from '../outlineTitleDrafts.client';

import { installStorageHarness } from './storageHarness';

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const owner = 'owner';
const resource = outlineTitleDraftResource('planTemplates', 'template');
const value = { target: { kind: 'subpoint', id: 'subpoint' } as const, text: '  The exact words before Enter  ' };

beforeEach(() => localStorage.clear());

it('reads the accepted words from IndexedDB after an entirely new local session and scopes template discovery', async () => {
  installStorageHarness();
  const drafts = createOutlineTitleDraftStore().forDocument(owner, resource)!;
  const copy = drafts.remember('opening', value);
  expect(readDraft(copy.key)?.value).toEqual(value);
  expect(await drafts.readStored()).toMatchObject([{ key: copy.key, value }]);
  await expect(drafts.readStored()).resolves.toEqual([copy]);
  expect(readDraft(copy.key)).toBeNull();

  const reopened = createOutlineTitleDraftStore();
  expect(reopened.forDocument(owner, resource)!.readLocal()).toEqual([]);
  await expect(reopened.forDocument(owner, resource)!.readStored()).resolves.toEqual([copy]);
  await expect(reopened.listDocuments(owner, 'planTemplates')).resolves.toEqual(['template']);
  await expect(reopened.listDocuments(owner, 'sermons')).resolves.toEqual([]);
  await expect(reopened.listDocuments('other-owner', 'planTemplates')).resolves.toEqual([]);
  await expect(reopened.forDocument('other-owner', resource)!.readStored()).resolves.toEqual([]);
});

it('keeps the synchronous reserve when IndexedDB refuses the write and reads both an older unbound copy and the latest words', async () => {
  const storage = installStorageHarness();
  const backup = draftKey(owner, resource, 'outline-title', 'previous-build');
  const older = { ...value, text: 'Handwritten in the older build' };
  saveDraft(backup, older);
  storage.writeFailureFor = key => Array.isArray(key) && key[0] === 'outline-title-draft';
  const current = createOutlineTitleDraftStore();
  const copy = current.forDocument(owner, resource)!.remember('opening', value);
  const reader = createOutlineTitleDraftStore().forDocument(owner, resource)!;
  const views = await reader.readStored();
  expect(views).toMatchObject([{ key: copy.key, value }, { key: backup, value: older }]);
  await expect(reader.discard(views[1])).resolves.toBeUndefined();
  expect(readDraft(copy.key)?.value).toEqual(value);
  expect(readDraft(backup)).toBeNull();
});

it('allows an old view to retire only the version it shows, even if the latest words repeat', async () => {
  installStorageHarness();
  const editor = createOutlineTitleDraftStore().forDocument(owner, resource)!;
  const reader = createOutlineTitleDraftStore().forDocument(owner, resource)!;
  const original = editor.remember('opening', value);
  await editor.readStored();
  const [before] = await reader.readStored();
  const second = editor.remember('opening', { ...value, text: 'Different words' }, original);
  const latest = editor.remember('opening', value, second);
  await expect(reader.discard(before)).resolves.toMatchObject(latest);
  await waitFor(() => expect(readDraft(latest.key)).toBeNull());
  await expect(reader.readStored()).resolves.toEqual([latest]);
  await expect(reader.discard(latest)).resolves.toBeUndefined();
  await expect(reader.readStored()).resolves.toEqual([]);
});

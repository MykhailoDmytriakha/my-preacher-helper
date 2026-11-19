import { act, renderHook } from '@testing-library/react';

import { persistedWrite } from '@/utils/recoverableWrite';

import { useNoteAutoSave } from '../useNoteAutoSave';

import type { NoteDraftPayload } from '../noteDraft';
import type { NoteTagEdit, NoteTitleEdit, NoteTypeEdit } from '../useNoteAutoSave';

const empty: NoteDraftPayload = { title: '', content: '', tags: [], scriptureRefs: [], type: 'note' };
afterEach(() => { localStorage.clear(); jest.useRealTimers(); });

it.each([true, false])('pagehide takes the whole live snapshot, including the empty guard, new=%s', async isNew => {
  jest.useFakeTimers();
  let live = empty;
  const createNote = jest.fn(() => ({ ...persistedWrite(Promise.resolve()), note: { id: 'n1' } as never }));
  const updateNote = jest.fn(() => ({ ...persistedWrite(Promise.resolve()), result: Promise.resolve(undefined as never) }));
  renderHook(() => useNoteAutoSave({ ...empty, liveValues: () => live, noteId: isNew ? 'new' : 'n1', isNew, isInitialized: true,
    createNote, updateNote, uid: 'owner', setCreatedNoteId: jest.fn(), t: ((key: string) => key) as never,
    baselineRef: { current: empty }, revisionRef: { current: null },
    resaveNonce: 0, saveBlocked: false, onConflict: jest.fn(),
  }));
  live = { title: 'Live title', content: 'Arrival\n\nVoice', tags: ['live'], scriptureRefs: [], type: 'question', dictationSourceIds: ['source-1'], recordingSourceIds: ['source-1'] };
  await act(async () => { window.dispatchEvent(new Event('pagehide')); });
  if (isNew) expect(createNote).toHaveBeenCalledWith(expect.objectContaining(live));
  else expect(updateNote).toHaveBeenCalledWith(expect.objectContaining({ updates: expect.objectContaining({ title: live.title, content: live.content, tags: live.tags, type: live.type, dictationSourceIds: live.dictationSourceIds, recordingSourceIds: live.recordingSourceIds }) }));
});

it('does not save a new note cleared before render', async () => {
  jest.useFakeTimers();
  const createNote = jest.fn();
  renderHook(() => useNoteAutoSave({ ...empty, content: 'Stale', liveValues: () => empty,
    noteId: 'new', isNew: true, isInitialized: true, createNote, updateNote: jest.fn(), uid: 'owner', setCreatedNoteId: jest.fn(),
    t: ((key: string) => key) as never, baselineRef: { current: empty }, revisionRef: { current: null },
    resaveNonce: 0, saveBlocked: false, onConflict: jest.fn(),
  }));
  await act(async () => { window.dispatchEvent(new Event('pagehide')); });
  expect(createNote).not.toHaveBeenCalled();
});

it('uses live title, type and tags in capture predicates as well as the payload', async () => {
  jest.useFakeTimers();
  const titleCapture = { seen: { title: '', generation: 'g1', revision: 1 }, time: null };
  const typeCapture = { seen: { type: 'note', generation: 'g1', revision: 1 }, time: null };
  const titleEditRef = { current: { owner: 'owner', id: 'n1', value: 'Live title', capture: titleCapture } as NoteTitleEdit };
  const typeEditRef = { current: { owner: 'owner', id: 'n1', value: 'question', capture: typeCapture } as NoteTypeEdit };
  const edit = { owner: 'owner', id: 'n1', before: false, present: true, basis: { generation: 'g1', revision: 1 }, time: null } as NoteTagEdit;
  const tagEditsRef = { current: new Map([['live', edit]]) };
  const live: NoteDraftPayload = { ...empty, title: 'Live title', type: 'question', tags: ['live'] };
  const updateNote = jest.fn(() => ({ ...persistedWrite(Promise.resolve()), result: Promise.resolve(undefined as never) }));
  renderHook(() => useNoteAutoSave({ ...empty, liveValues: () => live, titleEditRef, typeEditRef, tagEditsRef,
    noteId: 'n1', isNew: false, isInitialized: true, updateNote, createNote: jest.fn(), uid: 'owner', setCreatedNoteId: jest.fn(),
    t: ((key: string) => key) as never, baselineRef: { current: empty }, revisionRef: { current: null },
    resaveNonce: 0, saveBlocked: false, onConflict: jest.fn(),
  }));
  await act(async () => { window.dispatchEvent(new Event('pagehide')); });
  expect(updateNote).toHaveBeenCalledWith(expect.objectContaining({ titleCapture, typeCapture,
    updates: { title: 'Live title', type: 'question', tags: ['live'] },
    tagMembership: [expect.objectContaining({ tag: 'live', before: false, after: true })],
  }));
});

it.each([false, true])('captures only source IDs carried in the submitted update, with new source=%s', async newSource => {
  jest.useFakeTimers();
  const baseline: NoteDraftPayload = { ...empty, content: 'Already represented', dictationSourceIds: ['prior-source'] };
  const live: NoteDraftPayload = { ...baseline, title: 'Changed title',
    ...(newSource && { content: 'Already represented\n\nNew words', dictationSourceIds: ['prior-source', 'new-source'] }),
  };
  const accepted = jest.fn(async () => undefined);
  const capture = jest.fn((_ids: readonly string[]) => ({ accepted, carryTo: jest.fn(async () => undefined) }));
  const updateNote = jest.fn(() => ({ ...persistedWrite(Promise.resolve()), result: Promise.resolve(live as never) }));
  renderHook(() => useNoteAutoSave({ ...live, liveValues: () => live, captureRecordingHandoff: capture,
    noteId: 'n1', isNew: false, isInitialized: true, createNote: jest.fn(), updateNote, uid: 'owner',
    setCreatedNoteId: jest.fn(), t: ((key: string) => key) as never, baselineRef: { current: baseline },
    revisionRef: { current: null }, resaveNonce: 0,
    saveBlocked: false, onConflict: jest.fn(),
  }));
  await act(async () => { window.dispatchEvent(new Event('pagehide')); });
  expect(capture).toHaveBeenCalledWith(newSource ? ['prior-source', 'new-source'] : []);
  expect(accepted).toHaveBeenCalledTimes(1);
  if (!newSource) expect(updateNote).toHaveBeenCalledWith(expect.objectContaining({ updates: { title: 'Changed title' } }));
});

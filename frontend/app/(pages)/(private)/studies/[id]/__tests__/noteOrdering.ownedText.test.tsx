import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import { writeFileSync } from 'node:fs';

import { stand, start, original, md, stored, phoneSave, insert, finish, settle, chooseNotice, hasNoteQuestion } from '@test-utils/noteOrdering';
import { noteRef } from '@test-utils/deviceWorld';

import { draftKey, saveDraft } from '@/utils/durableDraft';

import type { RichMarkdownEditorProps } from '@/components/ui/RichMarkdownEditor';

jest.mock('@/components/ui/RichMarkdownEditor', () => {
  const actual = jest.requireActual<typeof import('@/components/ui/RichMarkdownEditor')>('@/components/ui/RichMarkdownEditor');
  return { ...actual, RichMarkdownEditor: (props: RichMarkdownEditorProps) => {
    const supplied = stand.staleCreation && !props.ownedBy ? { ...props, value: original } : props;
    return <actual.RichMarkdownEditor {...supplied} />;
  } };
});

const records: unknown[] = [];
afterAll(() => { if (process.env.NOTE_ORDERING_DIRECTED_OUTPUT) writeFileSync(process.env.NOTE_ORDERING_DIRECTED_OUTPUT, JSON.stringify(records, null, 2) + '\n'); });
async function pulse() { await act(async () => { jest.advanceTimersByTime(0); for (let i = 0; i < 5000; i++) await Promise.resolve(); }); }
async function done() { fireEvent.click(screen.getByTitle('common.done')); await pulse(); }
async function edit() {
  fireEvent.click(screen.getByTitle('common.edit')); await pulse();
  stand.editor.view.setProps({ handleScrollToSelection: () => true });
}
const histories = ['R-a', 'R-c', 'R-f', 'K-1', 'K-2', 'K-3', 'K-4', 'K-5', 'K-6', 'K-7', 'K-8', 'C-1', 'D-1', 'D-2', 'D-3', 'D-4', 'D-5', 'W1', 'W2'];
it.each(histories)('%s meets the owned-text history contract', async id => {
  await start();
  const waiting: Array<() => void> = [];
  let hold = false;
  const deliver = stand.laptop.transport.send.bind(stand.laptop.transport);
  const sends = jest.spyOn(stand.laptop.transport, 'send').mockImplementation(async command => {
    if (hold) await new Promise<void>(resolve => waiting.push(resolve));
    return deliver(command);
  });
  const steps: unknown[] = [];
  const snap = async (event: string) => steps.push({ event, stored: await stored(), page: stand.autosave.content,
    editor: document.querySelector('.tiptap') ? md() : null, base: stand.autosave.baselineRef.current?.content,
    question: hasNoteQuestion(), sends: sends.mock.calls.length });
  const type = (word: string) => act(() => insert(' ' + word));
  if (id.startsWith('R-') || ['K-4', 'K-6', 'K-7', 'K-8', 'C-1', 'K-5'].includes(id)) {
    if (id === 'R-c' || id === 'K-8') stand.laptop.goOffline();
    type('Typedword'); await snap('typed');
    if (id === 'K-4') await finish();
    if (id === 'R-f') {
      // The timer starts only after the draft is durable and the session has rendered that state.
      await settle();
      hold = true;
      await act(async () => { jest.advanceTimersByTime(1600); });
      await pulse();
      expect(waiting).toHaveLength(1);
    }
    if (id === 'C-1') await phoneSave(md());
    await done();
    if (id === 'K-5') await phoneSave(original + '\n\nArrivedword');
    await edit(); await snap('remounted');
    if (id === 'K-6') { let undone = true; act(() => { undone = stand.editor.commands.undo(); }); expect(undone).toBe(false); }
    if (id === 'K-7') await phoneSave(original + '\n\nArrivedword');
    type('Laterword');
    if (id === 'K-8') { await done(); await edit(); type('Lastword'); }
    hold = false; waiting.splice(0).forEach(release => release());
    if (id === 'R-c' || id === 'K-8') { await finish(); stand.laptop.online = true; stand.laptop.run(() => stand.laptop.engine.setOnline(true)); }
  } else if (id === 'K-1' || id === 'K-2') {
    if (id === 'K-1') await done();
    await phoneSave(original + '\n\nArrivedword');
    if (id === 'K-1') await edit();
    type('Laterword');
  } else if (id === 'K-3') { type('Typedword'); await finish(); type('Laterword'); }
  else if (id === 'D-1' || id === 'D-4') {
    if (id === 'D-4') await phoneSave(original + '\n\nArrivedword');
    await act(async () => { insert(' Typedword'); await stand.voice.onText('Dictatedword', 'source-1'); });
    await finish(); type('Laterword');
    if (id === 'D-4') { await done(); await edit(); type('Lastword'); }
  } else if (id === 'D-5') {
    await done(); await act(async () => { await stand.voice.onText('Dictatedword', 'source-1'); });
    await edit(); type('Laterword');
  } else if (id === 'D-2' || id === 'D-3' || id === 'W1') {
    const target = original + '\n\nArrivedword';
    await phoneSave(target);
    expect(md()).toBe(target);
    await act(async () => {
      const transcript = id === 'W1' ? undefined : stand.voice.onText('Dictatedword', 'source-1');
      if (id === 'D-3') window.dispatchEvent(new Event('pagehide'));
      else insert(' Typedword');
      await transcript;
    });
  } else if (id === 'W2') {
    // The next task may run either side of passive adoption. Both outcomes are safe.
    const arrival = phoneSave(original + '\n\nArrivedword');
    setTimeout(() => insert(' Typedword'), 0);
    await arrival;
  }
  await finish(); await snap('settled');
  const final = { id, stored: String(await stored()), page: stand.autosave.content, editor: md(), question: hasNoteQuestion(), sends: sends.mock.calls.length, steps };
  records.push(final);
  if (id === 'C-1') {
    expect(final.question).toBe(false);
    expect(final.stored).toBe(original + ' Typedword Laterword');
    expect(final.page).toBe(final.stored);
    expect(final.editor).toBe(final.stored);
  } else if (id === 'K-5' || id === 'K-7') {
    expect(final.question).toBe(true); expect(final.stored).toContain('Arrivedword'); expect(final.page).toContain('Typedword');
  } else if (id === 'W2') {
    expect(final.stored).toContain('Arrivedword');
    expect(final.question || final.stored.includes('Typedword')).toBe(true);
    if (final.question) expect(final.page).toContain('Typedword');
  } else {
    expect(final.question).toBe(false);
    expect(final.editor).toBe(final.stored);
    for (const word of id.startsWith('D-') ? ['Dictatedword'] : id === 'W1' ? ['Arrivedword', 'Typedword'] : ['Laterword']) expect(final.stored).toContain(word);
    if (['D-1', 'D-4', 'R-a', 'R-c', 'R-f', 'K-3', 'K-4', 'K-6', 'K-8', 'C-1'].includes(id)) expect(final.stored).toContain('Typedword');
    if (['K-1', 'K-2', 'D-2', 'D-3', 'D-4'].includes(id)) expect(final.stored).toContain('Arrivedword');
  }
}, 60000);

it('accepts the same words and the independently changed fields without a choice', async () => {
  await start();
  act(() => insert(' Typedword'));
  const words = original + ' Typedword';
  await phoneSave(words, { title: 'Remote title', type: 'question', tags: ['remote'], dictationSourceIds: ['remote-source'] });
  expect(stand.confirmed?.content).toBe(words);
  await finish();
  expect(md()).toBe(words);
  expect(await stored()).toBe(words);
  expect(stand.autosave.title).toBe('Remote title');
  expect(stand.autosave.type).toBe('question');
  expect(stand.autosave.tags).toEqual(['remote']);
  expect(stand.autosave.dictationSourceIds).toEqual(['remote-source']);
  expect(hasNoteQuestion()).toBe(false);
});

it('preserves both versions when typing reaches the note before the new words are displayed', async () => {
  await start();
  const received = original + '\n\nArrivedword';
  let fired = false;
  stand.afterMarkSaved = content => {
    if (fired || content !== received) return;
    expect(md()).toBe(original);
    fired = true;
    insert(' Typedword');
  };

  await phoneSave(received);
  await finish();

  expect(fired).toBe(true);
  expect(await stored()).toBe(received);
  expect(md()).toContain('Typedword');
  expect(hasNoteQuestion()).toBe(true);
});

it.each(['comment', 'image'])('keeps raw %s source through dictation-only saving', async kind => {
  const source = original + '\n\n' + (kind === 'comment' ? '<!-- Hiddenword -->' : '![Hiddenword](https://example.invalid/image.png)');
  await start(source, true);
  await act(async () => { await stand.voice.onText('Dictatedword', 'source-1'); });
  await finish();
  expect(await stored()).toBe(source + '\n\nDictatedword');
  expect(hasNoteQuestion()).toBe(false);
});

it('inserts one source only once when two transcripts arrive in the same task', async () => {
  await start();
  await act(async () => {
    await Promise.all([stand.voice.onText('Dictatedword', 'source-1'), stand.voice.onText('Dictatedword', 'source-1')]);
  });
  await finish();
  expect(await stored()).toBe(original + '\n\nDictatedword');
  expect(stand.autosave.dictationSourceIds).toEqual(['source-1']);
});

it('keeps the arrival through forced stale construction and pre-create input', async () => {
  await start(); await done();
  const target = original + '\n\nArrivedword';
  await phoneSave(target);
  stand.forceStaleCreation();
  await edit(); await finish();
  expect(md()).toBe(target + ' Typedword');
  expect(await stored()).toBe(target + ' Typedword');
  expect(hasNoteQuestion()).toBe(false);
});

it('asks about dictation and typing when a dirty page cannot adopt the arrival', async () => {
  await start(); act(() => insert(' Unsavedword'));
  await phoneSave(original + '\n\nArrivedword');
  await act(async () => { await stand.voice.onText('Dictatedword', 'source-1'); insert(' Typedword'); });
  await finish();
  expect(hasNoteQuestion()).toBe(true);
  expect(await stored()).toContain('Arrivedword');
  expect(md()).toContain('Unsavedword');
  expect(md()).toContain('Dictatedword');
  expect(md()).toContain('Typedword');
});

it('restores a draft through replacement and keeps later typing without a false question', async () => {
  await start();
  const base = { title: 'Original', content: original, tags: [], scriptureRefs: [], type: 'note' };
  stand.leave();
  const key = draftKey('owner', noteRef.id, 'note', 'old-opening');
  expect(saveDraft(key, { ...base, content: original + '\n\nRecoveredword' }, undefined, false, Date.now(), base)).toBe(true);
  await stand.reopen();
  expect(screen.getByText('unsavedDraft.restore')).toBeInTheDocument();
  fireEvent.click(screen.getByText('unsavedDraft.restore'));
  await pulse();
  stand.editor.view.setProps({ handleScrollToSelection: () => true });
  expect(md()).toBe(original + '\n\nRecoveredword');
  act(() => insert(' Laterword')); await finish();
  expect(await stored()).toBe(original + '\n\nRecoveredword Laterword');
  expect(hasNoteQuestion()).toBe(false);
});

it('takes the remote row through adoption before subsequent dictation and typing', async () => {
  await start(); act(() => insert(' Abandonedword'));
  const target = original + '\n\nArrivedword';
  await phoneSave(target); await finish();
  expect(hasNoteQuestion()).toBe(true);
  await chooseNotice('take');
  expect(md()).toBe(target);
  await act(async () => { await stand.voice.onText('Dictatedword', 'source-1'); insert(' Typedword'); });
  await finish();
  expect(await stored()).toBe(target + '\n\nDictatedword Typedword');
  expect(hasNoteQuestion()).toBe(false);
});

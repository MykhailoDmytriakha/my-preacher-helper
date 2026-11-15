import { stand, start, original, md, stored, phoneSave, insert, finish, settle } from '@test-utils/noteOrdering';
import React from 'react';
import { act } from '@testing-library/react';
import { undoDepth } from '@tiptap/pm/history';
import type { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';

let mockW3Target: string | null = null;
let mockW3Fired = false;
jest.mock('@/components/ui/RichMarkdownEditor', () => {
  const actual = jest.requireActual<typeof import('@/components/ui/RichMarkdownEditor')>('@/components/ui/RichMarkdownEditor');
  const React = jest.requireActual<typeof import('react')>('react');
  return { ...actual, RichMarkdownEditor: (props: React.ComponentProps<typeof RichMarkdownEditor>) => {
    React.useLayoutEffect(() => {
      if (mockW3Target !== props.value) return;
      mockW3Target = null; mockW3Fired = true;
      insert(' Typedword');
    }, [props.value]);
    return <actual.RichMarkdownEditor {...props} />;
  } };
});

afterEach(() => { mockW3Target = null; mockW3Fired = false; });

it('injected W1 keeps the arrived words and asks before saving the old document', async () => {
  await start();
  const target = original + '\n\nArrivedword';
  const sends = jest.spyOn(stand.laptop.transport, 'send');
  let fired = false;
  stand.afterMarkSaved = content => {
    if (!fired && content === target) { fired = true; insert(' Typedword'); }
  };
  await phoneSave(target); await finish();
  expect(fired).toBe(true);
  expect(md()).toBe(original + ' Typedword');
  expect(await stored()).toBe(target);
  expect(stand.autosave.saveBlocked).toBe(true);
  expect(stand.notices).toContain('freshness.conflictTitle');
  expect(sends).toHaveBeenCalledTimes(0);
});

it('directed W3 on the page preserves words and Undo without passive replacements', async () => {
  await start();
  const replacements: string[] = [];
  stand.editor.on('transaction', ({ transaction }) => {
    if (transaction.getMeta('preventUpdate')) replacements.push(transaction.doc.textContent);
  });
  const sends = jest.spyOn(stand.laptop.transport, 'send');
  const target = original + '\n\nArrivedword'; mockW3Target = target;
  await phoneSave(target); await finish();
  expect(mockW3Fired).toBe(true);
  expect(md()).toBe(original + ' Typedword');
  expect(await stored()).toBe(target);
  expect(stand.autosave.saveBlocked).toBe(true);
  expect(stand.notices).toContain('freshness.conflictTitle');
  expect(sends).toHaveBeenCalledTimes(0);
  expect(replacements).toEqual([]);
  expect(undoDepth(stand.editor.state)).toBe(1);
});

it('Undo to saved text then typing in one task saves normally without a question', async () => {
  await start(); const sends = jest.spyOn(stand.laptop.transport, 'send');
  act(() => insert(' Retractedword')); await settle();
  act(() => { expect(stand.editor.commands.undo()).toBe(true); insert(' Newword'); });
  await finish();
  expect(await stored()).toBe(original + ' Newword');
  expect(md()).toBe(original + ' Newword');
  expect(stand.notices).toEqual([]);
  expect(stand.autosave.saveBlocked).toBe(false);
  expect(sends).toHaveBeenCalledTimes(1);
});

it('create acknowledgement advances the root while continued typing is already dirty', async () => {
  stand.routeId = 'new'; await start('');
  const requests: Parameters<typeof stand.laptop.transport.send>[0][] = [];
  const waiting: Array<() => void> = [];
  let hold = true; const deliver = stand.laptop.transport.send.bind(stand.laptop.transport);
  jest.spyOn(stand.laptop.transport, 'send').mockImplementation(async command => {
    requests.push(command); if (hold) await new Promise<void>(resolve => waiting.push(resolve)); return deliver(command);
  });
  act(() => insert('Firstword')); await settle();
  await act(async () => {
    jest.advanceTimersByTime(1500); insert(' Secondword');
    for (let i = 0; i < 3000; i++) { await Promise.resolve(); if (i % 300 === 0) jest.advanceTimersByTime(0); }
  });
  hold = false; waiting.splice(0).forEach(release => release()); await finish();
  const create = requests.find(command => command.kind === 'create');
  expect(create).toBeDefined();
  expect((await stand.world.snapshot(create!.resource)).value?.content).toBe('Firstword Secondword');
  expect(md()).toBe('Firstword Secondword');
  expect(stand.autosave.saveBlocked).toBe(false);
  expect(stand.notices).toEqual([]);
  expect(requests.map(command => command.kind)).toEqual(['create', 'update']);
});

it('two dictations each save once without a question', async () => {
  await start(); const sends = jest.spyOn(stand.laptop.transport, 'send');
  for (const word of ['Firstword', 'Secondword']) {
    await act(async () => { await stand.voice.onText(word, 'source-' + word); });
    await finish();
  }
  expect(await stored()).toBe(original + '\n\nFirstword\n\nSecondword');
  expect(md()).toBe(await stored());
  expect(sends).toHaveBeenCalledTimes(2);
  expect(stand.autosave.saveBlocked).toBe(false);
  expect(stand.notices).toEqual([]);
});

it('an own action drops a pending foreign mark before acknowledgement and later typing', async () => {
  await start();
  const target = original + '\n\nArrivedword';
  await phoneSave(target);
  // No keystroke has consumed the foreign mark. Dictation replaces it as an own action.
  await act(async () => { await stand.voice.onText('Dictatedword', 'source-1'); });
  await finish();
  act(() => insert(' Laterword')); await finish();
  expect(await stored()).toBe(target + '\n\nDictatedword Laterword');
  expect(md()).toBe(await stored());
  expect(stand.autosave.saveBlocked).toBe(false);
  expect(stand.notices).toEqual([]);
});

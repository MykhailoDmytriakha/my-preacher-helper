import { stand, start, original, md, stored, phoneSave, insert, finish, settle } from '@test-utils/noteOrdering';
import { act } from '@testing-library/react';
import { undoDepth } from '@tiptap/pm/history';
import type { RichMarkdownEditorProps } from '@/components/ui/RichMarkdownEditor';

let mockW3Target: string | null = null;
let mockW3Fired = false;
jest.mock('@/components/ui/RichMarkdownEditor', () => {
  const actual = jest.requireActual<typeof import('@/components/ui/RichMarkdownEditor')>('@/components/ui/RichMarkdownEditor');
  const React = jest.requireActual<typeof import('react')>('react');
  return { ...actual, RichMarkdownEditor: (props: RichMarkdownEditorProps) => {
    React.useLayoutEffect(() => {
      if (mockW3Target !== (props.ownedBy?.live() ?? props.value)) return;
      mockW3Target = null; mockW3Fired = true;
      insert(' Typedword');
    });
    return <actual.RichMarkdownEditor {...props} />;
  } };
});

afterEach(() => { mockW3Target = null; mockW3Fired = false; });

it('injected W1 types over the synchronously adopted document', async () => {
  await start();
  const target = original + '\n\nArrivedword';
  const sends = jest.spyOn(stand.laptop.transport, 'send');
  let fired = false;
  stand.afterMarkSaved = content => {
    if (!fired && content === target) { fired = true; insert(' Typedword'); }
  };
  await phoneSave(target); await finish();
  expect(fired).toBe(true);
  expect(md()).toBe(target + ' Typedword');
  expect(await stored()).toBe(target + ' Typedword');
  expect(stand.autosave.saveBlocked).toBe(false);
  expect(stand.notices).toEqual([]);
  expect(sends).toHaveBeenCalledTimes(1);
});

it('directed W3 on the page edits the synchronously installed arrival', async () => {
  await start();
  const replacements: string[] = [];
  stand.editor.on('transaction', ({ transaction }) => {
    if (transaction.getMeta('preventUpdate')) replacements.push(transaction.doc.textContent);
  });
  const sends = jest.spyOn(stand.laptop.transport, 'send');
  const target = original + '\n\nArrivedword'; mockW3Target = target;
  await phoneSave(target); await finish();
  expect(mockW3Fired).toBe(true);
  expect(md()).toBe(target + ' Typedword');
  expect(await stored()).toBe(target + ' Typedword');
  expect(stand.autosave.saveBlocked).toBe(false);
  expect(stand.notices).toEqual([]);
  expect(sends).toHaveBeenCalledTimes(1);
  expect(replacements.length).toBeGreaterThan(0);
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

it('create acknowledgement advances the baseline while continued typing is already dirty', async () => {
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

it('dictation follows an adopted arrival before acknowledgement and later typing', async () => {
  await start();
  const target = original + '\n\nArrivedword';
  await phoneSave(target);
  // Adoption has already installed the document before this own append.
  await act(async () => { await stand.voice.onText('Dictatedword', 'source-1'); });
  await finish();
  act(() => insert(' Laterword')); await finish();
  expect(await stored()).toBe(target + '\n\nDictatedword Laterword');
  expect(md()).toBe(await stored());
  expect(stand.autosave.saveBlocked).toBe(false);
  expect(stand.notices).toEqual([]);
});

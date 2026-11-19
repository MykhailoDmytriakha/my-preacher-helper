import { act, fireEvent, screen } from '@testing-library/react';

// Select the installed Android inactivity fallback before ProseMirror loads.
const originalAgent = navigator.userAgent;
Object.defineProperty(navigator, 'userAgent', {
  configurable: true,
  value: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36',
});
const { start, stand, md, finish, stored, pulse, settle } = require('@test-utils/noteDictationStand') as typeof import('@test-utils/noteDictationStand');
afterAll(() => Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalAgent }));

async function startNativeComposition() {
  await start('Original');
  await act(async () => {
    stand.editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    stand.editor.view.dom.querySelector('p')!.firstChild!.nodeValue = 'Original native';
    stand.editor.view.dom.dispatchEvent(new InputEvent('input', {
      bubbles: true, inputType: 'insertCompositionText', data: ' native',
    }));
    await pulse();
  });
  expect(stand.editor.view.composing).toBe(true);
  expect(md()).toBe('Original native');
}

it('releases a transcript after the installed Android IME inactivity end without another compositionend', async () => {
  await startNativeComposition();
  await act(async () => {
    stand.voiceController.complete(new Blob(['audio'], { type: 'audio/webm' }));
    await pulse();
  });
  expect(stand.voiceController.isProcessing).toBe(true);
  expect(stand.recordings).toHaveLength(1);
  expect(md()).toBe('Original native');
  await settle(6000);
  expect(stand.editor.view.composing).toBe(false);
  expect(stand.voiceController.isProcessing).toBe(false);
  expect(md()).toBe('Original native\n\nVoiceword');
  // Continue ordinary typing after the library has admitted the native text.
  act(() => stand.editor.view.dispatch(stand.editor.state.tr.insertText(' More', stand.editor.state.doc.content.size - 1)));
  await finish();
  const beforeRecovery = String(await stored());
  expect(stand.recordings).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'common.done' }));
  await settle(50);
  fireEvent.click(screen.getByTitle('common.edit'));
  await settle(50);
  await act(async () => { stand.voiceController.retry(); await pulse(); });
  await finish();
  expect(await stored()).toBe(beforeRecovery);
  expect(beforeRecovery).toBe('Original native\n\nVoiceword More');
  expect(md().match(/Voiceword/g)).toHaveLength(1);
});

it('accepts a brand-new transcript started long after the editor has stopped composing', async () => {
  await startNativeComposition();
  await settle(6000);
  expect(stand.editor.view.composing).toBe(false);
  await act(async () => {
    stand.voiceController.complete(new Blob(['audio'], { type: 'audio/webm' }));
    await pulse();
  });
  await finish();
  expect(stand.voiceController.isProcessing).toBe(false);
  expect(await stored()).toBe('Original native\n\nVoiceword');
  expect(stand.recordings).toHaveLength(0);
});

it('keeps two waiting transcript sources in arrival order after Android finishes composition internally', async () => {
  await startNativeComposition();
  let first!: Promise<unknown>, second!: Promise<unknown>;
  await act(async () => {
    first = Promise.resolve(stand.voice.onText('First voice', 'idle-first')).catch(error => error);
    second = Promise.resolve(stand.voice.onText('Second voice', 'idle-second')).catch(error => error);
    await pulse();
  });
  expect(md()).toBe('Original native');
  expect(stand.autosave.dictationSourceIds).toEqual([]);
  await settle(6000);
  await act(async () => { await Promise.all([first, second]); });
  await finish();
  expect(await stored()).toBe('Original native\n\nFirst voice\n\nSecond voice');
  expect(stand.autosave.dictationSourceIds).toEqual(['idle-first', 'idle-second']);
});

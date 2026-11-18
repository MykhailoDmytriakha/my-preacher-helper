import { act } from '@testing-library/react';
import { start, stand, md, finish, stored } from '@test-utils/noteOrdering';

it('retains native words in an empty document when a queued transcript callback runs before observation', async () => {
  await start('');
  await act(async () => {
    // Model a ready transcript continuation ahead of the DOM observer callback.
    // No forced DOMObserver deferral, internal flush, fabricated transaction or remote write.
    const transcript = Promise.resolve().then(() => stand.voice.onText('Voiceword', 'source-empty'));
    const p = stand.editor.view.dom.querySelector('p')!;
    const text = document.createTextNode('Nativeword');
    p.insertBefore(text, p.firstChild);
    const selection = window.getSelection()!;
    const range = document.createRange(); range.setStart(text, text.length); range.collapse(true);
    selection.removeAllRanges(); selection.addRange(range);
    stand.editor.view.dom.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:'Nativeword'}));
    await transcript;
  });
  await finish();
  const row = {editor:md(), page:stand.autosave.content, stored:await stored()};
  expect(row.editor).toBe('Nativeword\n\nVoiceword');
  expect(row.page).toBe(row.editor);
  expect(row.stored).toBe(row.editor);
});

it.each(['append', 'delete'] as const)('keeps native %s and dictation in a nonempty note', async kind => {
  await start('Original paragraph.\n\nSecond paragraph.');
  await act(async () => {
    const node = stand.editor.view.dom.querySelectorAll('p')[1].firstChild!;
    node.nodeValue = kind === 'append' ? 'Second paragraph. Nativeword' : 'Second';
    await stand.voice.onText('Voiceword', 'source-native');
  });
  await finish();
  expect(md()).toBe(kind === 'append'
    ? 'Original paragraph.\n\nSecond paragraph. Nativeword\n\nVoiceword'
    : 'Original paragraph.\n\nSecond\n\nVoiceword');
  expect(await stored()).toBe(md());
});

it('accepts a transcript source only after composition permits its text, without duplicate insertion', async () => {
  await start('');
  const composing = jest.spyOn(stand.editor.view, 'composing', 'get').mockReturnValue(true);
  try {
    let receipt!: Promise<unknown>, duplicate!: Promise<unknown>;
    await act(async () => {
      receipt = Promise.resolve(stand.voice.onText('Voiceword', 'source-composing'));
      duplicate = Promise.resolve(stand.voice.onText('Voiceword', 'source-composing'));
    });
    await finish();
    expect(stand.autosave.dictationSourceIds).not.toContain('source-composing');
    expect(await stored()).toBe('');
    composing.mockReturnValue(false);
    await act(async () => { await jest.advanceTimersByTimeAsync(20); await Promise.all([receipt, duplicate]); });
    await finish();
    expect(md()).toBe('Voiceword');
    expect(await stored()).toBe('Voiceword');
    expect(stand.autosave.dictationSourceIds).toEqual(['source-composing']);
  } finally { composing.mockRestore(); }
});

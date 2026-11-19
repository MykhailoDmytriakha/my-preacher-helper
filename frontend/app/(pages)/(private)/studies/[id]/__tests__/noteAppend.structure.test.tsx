import { act, fireEvent, screen } from '@testing-library/react';
import { start, stand, finish, stored } from '@test-utils/noteOrdering';

const cases = [
  ['empty heading', '#', 'Voiceword'],
  ['empty code', '```\n\n```', 'Voiceword'],
  ['bullet lists', '- First\n- Second', '- Third\n- Fourth'],
  ['ordered lists', '1. First\n2. Second', '1. Third\n2. Fourth'],
  ['quotes', '> First', '> Second'],
  ['empty paragraph', '', 'Voiceword'],
  ['ordinary paragraphs', 'Original', 'Voiceword'],
  ['heading plus paragraph', '# Original', 'Voiceword'],
  ['table', '| A | B |\n| --- | --- |\n| C | D |', 'Voiceword'],
];

// The trailing-node plugin may add an empty final paragraph after an update.
// Ignore that pre-existing transient difference, not authored nodes or list attributes.
function authored(doc: ReturnType<typeof stand.editor.getJSON>) {
  const clone = JSON.parse(JSON.stringify(doc));
  const last = clone.content?.at(-1);
  if (clone.content?.length > 1 && last?.type === 'paragraph' && !last.content && !last.attrs) clone.content.pop();
  return clone;
}

it.each(cases)('%s shows the same document before and after Done/Edit', async (name, source, block) => {
  await start(source, true);
  await act(async () => { await stand.voice.onText(block, 'structured-source'); });
  await finish();
  const before = stand.editor.getJSON();
  expect(await stored()).toBe(source ? `${source}\n\n${block}` : block);
  fireEvent.click(screen.getByTitle('common.done'));
  await finish();
  fireEvent.click(screen.getByTitle('common.edit'));
  await finish();
  const after = stand.editor.getJSON();
  expect(authored(before)).toEqual(authored(after));
});

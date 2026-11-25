import { finish, insert, original, phoneSave, start, stored } from '@test-utils/noteOrdering';

import { act } from '@testing-library/react';

const preservedMarkup = [
  ['an image with alt text and a title', '![Keep diagram](/diagram.png "Diagram title")'],
  ['an editorial comment', '<!-- Keep editorial comment -->'],
  ['comments within prose', 'Here <!-- keep these words --> and here.'],
  ['a multiline comment', '<!-- First invisible line\nSecond invisible line -->'],
  ['a comment inside a table', '<table><tbody><tr><th><p>First</p></th><th><p>Second</p></th></tr><tr><td><p>Visible <!-- keep this table comment --> content</p></td><td><p>Neighbor</p></td></tr></tbody></table>'],
] as const;

describe('preserving note Markdown while editing surrounding text', () => {
  it.each(preservedMarkup)('keeps %s present when opening the note', async (_label, markup) => {
    const opened = original + '\n\n' + markup + '\n\nLast paragraph.';
    await start(opened, true);
    act(() => insert(' Typedword'));
    await finish();

    const saved = await stored();
    expect(saved).toContain('Typedword');
    expect(saved).toContain(markup.startsWith('<table>') ? '<!-- keep this table comment -->' : markup);
    expect(saved).not.toContain('data-markdown-comment');
  });

  it.each(preservedMarkup)('keeps %s after it arrives from another device', async (_label, markup) => {
    const arrived = original + '\n\n' + markup + '\n\nLast paragraph.';
    await start();
    await phoneSave(arrived);
    expect(await stored()).toBe(arrived);
    act(() => insert(' Typedword'));
    await finish();

    const saved = await stored();
    expect(saved).toContain('Typedword');
    expect(saved).toContain(markup.startsWith('<table>') ? '<!-- keep this table comment -->' : markup);
    expect(saved).not.toContain('data-markdown-comment');
  });
});

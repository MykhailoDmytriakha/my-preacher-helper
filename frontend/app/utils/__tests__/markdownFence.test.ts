import { createFenceTracker } from '@/utils/markdownFence';

/** Which lines of the text the tracker calls code, in order. */
const codeLines = (text: string): boolean[] => {
  const fence = createFenceTracker();
  return text.split('\n').map((line) => fence.isCode(line));
};

describe('createFenceTracker', () => {
  it('reads fences in text with Windows line endings', () => {
    expect(codeLines('```\r\n# Fake\r\n```\r\n# Real')).toEqual([true, true, true, false]);
  });

  it('closes only on spaces or tabs after the fence, not on a non-breaking space', () => {
    expect(codeLines('~~~\n~~~ \n# Fake\n~~~\n# Real')).toEqual([true, true, true, true, false]);
  });

  it('opens a fence that starts a list item and closes it at the item\'s indent', () => {
    expect(codeLines('- ~~~\n  # Fake\n  ~~~\n\n# Real')).toEqual([true, true, true, false, false]);
  });

  it('ends an unclosed fence together with its list item', () => {
    expect(codeLines('- ```\n  code\n# Real')).toEqual([true, true, false]);
  });

  it('ends an indented block once the text comes back to the margin', () => {
    expect(codeLines('    ~~~\n    code\n\n# Real').at(-1)).toBe(false);
  });

  it('does not let a delimiter indented four spaces deeper close the fence', () => {
    expect(codeLines('```\n    ```\n# Fake\n```\n# Real')).toEqual([true, true, true, true, false]);
  });

  it('keeps a fence inside a nested list item, as the editor writes it', () => {
    expect(codeLines('1. item\n   - sub\n\n     ```\n     # Fake\n     ```\n# Real')).toEqual([
      false, false, false, true, true, true, false,
    ]);
  });

  it('keeps a line at the margin inside a fence indented less than four spaces', () => {
    expect(codeLines('  ```\n# Fake\n  ```\n# Real')).toEqual([true, true, true, false]);
  });
});

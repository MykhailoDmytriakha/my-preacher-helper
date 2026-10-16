import { markdownCodeLines, withoutMarkdownCode } from '@/utils/markdownCode';

/** Which lines of the text the tracker calls code, in order. */
const codeLines = (text: string): boolean[] => {
  const lines = markdownCodeLines(text);
  return text.split('\n').map((_line, index) => lines.has(index));
};

describe('markdownCodeLines', () => {
  it('maps mixed line endings back to the consumers LF-delimited lines', () => {
    expect(codeLines('# First\n```\rinside\r```\n# Real')).toEqual([false, true, false]);
  });

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

describe('withoutMarkdownCode', () => {
  it('keeps source offsets, Unicode and line endings outside code byte-for-byte', () => {
    const source = '🙂 **Before**\r\n> ~~~\r\n> hidden\r\n> ~~~\r\nAfter `hidden` end';
    const result = withoutMarkdownCode(source, true);
    expect(result).toBe('🙂 **Before**\r\n     \r\n        \r\n     \r\nAfter          end');
    expect(result.length).toBe(source.length);
  });

  it('leaves code-like plain text unchanged', () => {
    const source = 'Before \\`literal words\\` after';
    expect(withoutMarkdownCode(source, true)).toBe(source);
  });

  it('reads code spans in GFM table cells using the renderer syntax', () => {
    const source = '| Heading |\n| --- |\n| `hidden words` |';
    expect(withoutMarkdownCode(source, true)).not.toContain('hidden');
    expect(withoutMarkdownCode(source)).toBe(source);
  });
});

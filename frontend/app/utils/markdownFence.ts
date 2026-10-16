/** The longest run of one character in a text, counted without building a list of the runs. */
function longestRun(text: string, char: string): number {
  let longest = 0;
  let current = 0;
  for (const next of text) {
    current = next === char ? current + 1 : 0;
    if (current > longest) longest = current;
  }
  return longest;
}

/**
 * A fence the code inside cannot close (CommonMark): its character repeated one more time than the
 * longest run of it in the code, never fewer than three. Backticks, unless the info string after
 * the opening fence holds one — a backtick fence may not, so then it is tildes. Every writer of a
 * fence uses it: the editor's code block (tiptap-markdown always wrote three backticks, and a block
 * holding a line of ``` came back from a save as an empty block, loose text and a heading) and the
 * display's structured blocks.
 */
export function codeFenceFor(code: string, info = ''): string {
  const char = info.includes('`') ? '~' : '`';
  return char.repeat(Math.max(3, longestRun(code, char) + 1));
}

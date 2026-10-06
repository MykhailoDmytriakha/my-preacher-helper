/**
 * FENCED CODE BLOCKS, LINE BY LINE — the one rule every heading scanner in the app shares
 * (BUG-20260927-note-sections-ignore-fence-length).
 *
 * A fence opens with three or more backticks or tildes and closes only with a line of the SAME
 * character, at least as long, followed by nothing but spaces or tabs. Every line from the opening
 * fence to the closing one is text, never a heading. A plain on/off switch on any ``` or ~~~ let a
 * quoted shorter fence close a longer one (its "# heading" became a section) and let a backtick
 * line close a tilde block early (the real heading after it was swallowed).
 *
 * Where the fence stands matters too, as CommonMark has it. A fence that starts a list item belongs
 * to that item: it closes at the item's indent, and when the item ends, so does the fence. A fence
 * indented four or more columns is judged against its own indent the same way — in a note that is
 * the code of a nested list item, which is how the editor writes it. A Windows line ending is not
 * part of the line.
 */

const OPENER = /^([ \t]*)(?:([-+*]|\d{1,9}[.)])([ \t]+))?(`{3,}|~{3,})(.*)$/;
const CLOSER = /^([ \t]*)(`{3,}|~{3,})[ \t]*$/;
const LEADING_WHITESPACE = /^[ \t]*/;

/** The column a prefix ends at, a tab advancing to the next multiple of four. */
function columnOf(prefix: string): number {
  let column = 0;
  for (const char of prefix) column = char === '\t' ? column + 4 - (column % 4) : column + 1;
  return column;
}

export function createFenceTracker() {
  /** `container` — the column the fence's content lives at; 0 for a fence at the margin. */
  let open: { char: string; length: number; container: number } | null = null;
  return {
    /** Feed the next line; true when it belongs to a code block (its fences included). */
    isCode(input: string): boolean {
      const line = input.endsWith('\r') ? input.slice(0, -1) : input;
      if (open) {
        const lead = LEADING_WHITESPACE.exec(line)?.[0] ?? '';
        const blank = lead.length === line.length;
        if (open.container > 0 && !blank && columnOf(lead) < open.container) {
          // The list item (or indented block) ended, and its fence with it; this line is read afresh.
          open = null;
        } else {
          const close = CLOSER.exec(line);
          if (
            close &&
            close[2][0] === open.char &&
            close[2].length >= open.length &&
            columnOf(close[1]) <= open.container + 3
          ) {
            open = null;
          }
          return true;
        }
      }
      const fence = OPENER.exec(line);
      if (!fence) return false;
      const [, lead, marker, gap, run, info] = fence;
      // A backtick fence's info string may not contain a backtick (that is inline code).
      if (run[0] === '`' && info.includes('`')) return false;
      const column = columnOf(lead + (marker ?? '') + (gap ?? ''));
      open = { char: run[0], length: run.length, container: marker || column >= 4 ? column : 0 };
      return true;
    },
  };
}

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

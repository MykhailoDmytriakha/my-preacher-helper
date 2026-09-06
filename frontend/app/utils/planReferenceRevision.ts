/** Replace standalone reference paragraphs in the generated cue format, preserving every other byte. */
export function replacePlanReferenceParagraphs(content: string, refs: string[]): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const replacement = refs.map((ref) => ref.trim()).filter(Boolean).map((ref) => `*${ref}*`).join(newline + newline);
  const lines = content.split('\n');
  const ranges: { start: number; end: number }[] = [];
  let offset = 0;
  let fence: { marker: string; length: number } | null = null;
  lines.forEach((raw, index) => {
    const line = raw.replace(/\r$/, '');
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = { marker: delimiter[1][0], length: delimiter[1].length };
      else if (delimiter[1][0] === fence.marker && delimiter[1].length >= fence.length
        && line.slice(delimiter[0].length).trim() === '') fence = null;
    } else if (!fence) {
      const paragraph = line.match(/^\*([^*]+)\*[ \t]*$/);
      const standalone = (index === 0 || !lines[index - 1].trim())
        && (index === lines.length - 1 || !lines[index + 1].trim());
      // Restrict recognition to a book name followed by chapter:verse, not arbitrary italic prose.
      if (standalone && paragraph && /^(?:[1-3]\s*)?[\p{L}.]+(?:\s+[\p{L}.]+){0,5}\s+\d+\s*:\s*\d+/u.test(paragraph[1])) {
        ranges.push({ start: offset, end: offset + line.length });
      }
    }
    offset += raw.length + 1;
  });
  if (!ranges.length) return replacement ? content + (content ? newline + newline : '') + replacement : content;
  let result = '';
  let cursor = 0;
  ranges.forEach((range, index) => {
    result += content.slice(cursor, range.start) + (index === 0 ? replacement : '');
    cursor = range.end;
  });
  return result + content.slice(cursor);
}

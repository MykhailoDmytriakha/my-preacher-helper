import { replacePlanReferenceParagraphs } from '@/utils/planReferenceRevision';

it('replaces only standalone reference paragraphs, preserving turns, cues and arbitrary italic prose', () => {
  const content = '**→ My exact words!**\n\n- Cue with *emphasis*\n- Another cue\n\n*Keep this sentence.*\n\n*John 10:1: old wording*\n\n*1 Пар. 4:9: old text*';
  expect(replacePlanReferenceParagraphs(content, ['  Psalm 23:1: new reference  '])).toBe(
    '**→ My exact words!**\n\n- Cue with *emphasis*\n- Another cue\n\n*Keep this sentence.*\n\n*Psalm 23:1: new reference*\n\n');
});

it('does not treat references inside code fences, quotes or list items as replaceable paragraphs', () => {
  const content = '```md\n*John 1:1: code*\n```\n\n~~~\n*Psalm 1:1: more code*\n~~~\n\n> *John 2:1: quotation*\n\n- *John 3:1: list item*';
  expect(replacePlanReferenceParagraphs(content, ['John 4:1: new'])).toBe(content + '\n\n*John 4:1: new*');
});

it('requires standalone paragraphs and preserves adjacent prose', () => {
  const content = 'A sentence\n*John 1:1: continuation*\nAnother sentence';
  expect(replacePlanReferenceParagraphs(content, [])).toBe(content);
});

it('preserves CRLF and accepts numbered book names', () => {
  expect(replacePlanReferenceParagraphs('Body\r\n\r\n*1 John 1:1: old*\r\n', ['2 John 1:2: new']))
    .toBe('Body\r\n\r\n*2 John 1:2: new*\r\n');
});

it('adds references to an empty cell and ignores blank replacements', () => {
  expect(replacePlanReferenceParagraphs('', [' ', 'John 1:1: text'])).toBe('*John 1:1: text*');
  expect(replacePlanReferenceParagraphs('', [])).toBe('');
});

it('removes recognized reference paragraphs without rewriting other text', () => {
  expect(replacePlanReferenceParagraphs('- Original\n\n*John 1:1: old*', [])).toBe('- Original\n\n');
});

it('does not end a code fence with a mismatched or too short delimiter', () => {
  const content = '````\n~~~\n```\n*John 1:1: code*\n````';
  expect(replacePlanReferenceParagraphs(content, [])).toBe(content);
});

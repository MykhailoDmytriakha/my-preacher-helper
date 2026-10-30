import { prepareStructuredBlocks } from '@/utils/markdownStructuredBlocks';

it('maps every unchanged source position across several unequal callout replacements', () => {
  const segments = ['# A\n\n', '\n\nMiddle Ω 🕊️\n\n', '\n\n# Last\nBody'];
  const callouts = ['[Quote: x]', '[Definition: y is longer\n## literal\nend]'];
  const source = segments[0] + callouts[0] + segments[1] + callouts[1] + segments[2];
  const prepared = prepareStructuredBlocks(source);
  let originalCursor = 0;
  let preparedCursor = 0;
  segments.forEach((segment, index) => {
    const from = prepared.markdown.indexOf(segment, preparedCursor);
    expect(from).toBeGreaterThanOrEqual(0);
    for (let offset = 0; offset <= segment.length; offset++) {
      expect(prepared.originalOffset(from + offset)).toBe(originalCursor + offset);
    }
    preparedCursor = from + segment.length;
    originalCursor += segment.length;
    if (index < callouts.length) {
      const next = prepared.markdown.indexOf(segments[index + 1], preparedCursor);
      expect(prepared.originalOffset(preparedCursor + 1)).toBeNull();
      expect(prepared.originalOffset(next)).toBe(originalCursor + callouts[index].length);
      originalCursor += callouts[index].length;
    }
  });
  expect(prepared.originalOffset(-1)).toBeNull();
  expect(prepared.originalOffset(prepared.markdown.length + 1)).toBeNull();
});

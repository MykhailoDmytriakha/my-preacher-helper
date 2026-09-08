import { extractSearchSnippets } from '../searchUtils';

describe('extractSearchSnippets', () => {
  it.each([
    ['', 'test'],
    ['test content', ''],
    ['   ', 'test'],
    ['test content', '   '],
    ['hello world', 'missing'],
  ])('returns no snippets for content %j and query %j', (content, query) => {
    expect(extractSearchSnippets(content, query)).toEqual([]);
  });

  it('returns only the matching word when no context is requested', () => {
    expect(extractSearchSnippets('alpha beta gamma', 'beta', 0)).toEqual(['beta']);
  });

  it('includes whole context words instead of cutting their edges', () => {
    expect(extractSearchSnippets('The quick brown fox jumps over the lazy dog', 'brown', 2))
      .toEqual(['quick brown fox']);
  });

  it.each([
    ['word1 ... small gap ... word1', 'word1', 10, 'word1 ... small gap ... word1'],
    ['alpha beta gamma beta delta', 'beta', 1, 'beta gamma beta delta'],
  ])('merges nearby matches without losing either match in %j', (content, query, context, expected) => {
    expect(extractSearchSnippets(content, query, context)).toEqual([expected]);
  });

  it('keeps distant matches in separate snippets', () => {
    const snippets = extractSearchSnippets(`word1 ${'a '.repeat(100)} word1`, 'word1', 10);
    expect(snippets).toHaveLength(2);
    expect(snippets[0]).toMatch(/^word1 /);
    expect(snippets[1]).toMatch(/ word1$/);
  });

  it('finds all matches inside a long paragraph without line breaks', () => {
    const content = 'This is a very long paragraph that simulates a real note content without line breaks.'
      + 'It continues for quite a while to test the character windowing logic.'
      + 'We want to find the word TARGET inside this mess of text.'
      + 'It should extract context around it perfectly.Here is another TARGET for overlap testing.'
      + 'And finally one more TARGET way at the end.';
    const snippets = extractSearchSnippets(content, 'TARGET', 20);
    expect(snippets).toHaveLength(2);
    expect(snippets.join(' ').match(/TARGET/g)).toHaveLength(3);
    expect(snippets[0]).toContain('TARGET inside');
  });

  it('keeps a match at the start without leading whitespace', () => {
    expect(extractSearchSnippets('Start matches here.', 'Start', 10)).toEqual(['Start matches here.']);
  });

  it('matches literal punctuation case-insensitively and preserves the original text', () => {
    expect(extractSearchSnippets('One A+B? two a+b? three aaab', 'a+b?', 0))
      .toEqual(['A+B? two a+b?']);
  });
});

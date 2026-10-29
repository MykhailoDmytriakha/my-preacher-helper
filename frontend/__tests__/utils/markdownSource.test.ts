import { decodeBasicHtmlEntities, normalizePlanArrows, sanitizeMarkdown } from '../../app/utils/markdownUtils';
import { preparePlanMarkdown } from '../../app/utils/planHierarchy';

const code = 'value => next -> end ***** &gt; &amp;gt;';

describe('Markdown preparation preserves literal source', () => {
  it.each([
    ['inline code', '`' + code + '`'],
    ['long code span', '`` ' + code + ' ` literal ``'],
    ['tilde fence', '~~~text\n' + code + '\n~~~'],
    ['backtick fence', '```text\n' + code + '\n```'],
    ['list-contained fence', '- sample:\n\n  ```text\n  ' + code + '\n  ```'],
    ['quote-contained fence', '> ~~~text\n> ' + code + '\n> ~~~'],
    ['initial indented code', '    ' + code],
    ['trailing indented code', 'Prose.\n\n    ' + code + '  \n'],
    ['HTML code', '<code>' + code + '</code>'],
    ['HTML pre', '<pre>' + code + '</pre>'],
  ])('preserves %s', (_name, markdown) => {
    expect(preparePlanMarkdown(markdown)).toBe(markdown);
  });

  it('keeps real link labels, destinations, and definitions unchanged', () => {
    const markdown = '[First -> Second](https://example.test/a->b?next=a=>b)\n\n[route][target]\n\n[target]: https://example.test/a->b';
    expect(normalizePlanArrows(markdown)).toBe(markdown);
  });

  it('keeps HTML attributes and links literal while normalizing adjacent prose', () => {
    const markdown = '<table><tr><td title="a => b">First -&gt; Second <code>x => y *****</code></td></tr></table>';
    expect(preparePlanMarkdown(markdown)).toBe('<table><tr><td title="a => b">First → Second <code>x => y *****</code></td></tr></table>');
    const link = '<a href="https://example.test/a->b">First -> Second</a>';
    expect(normalizePlanArrows(link)).toBe(link);
  });

  it('does not turn escaped HTML into active markup or decode prose twice', () => {
    const markdown = '&lt;u&gt;literal&lt;/u&gt; &amp;gt; -&amp;gt; end';
    expect(preparePlanMarkdown(markdown)).toBe(markdown);
    expect(decodeBasicHtmlEntities('&amp;gt;')).toBe('&gt;');
  });

  it('retains ordinary prose normalization and malformed prose repair', () => {
    expect(preparePlanMarkdown('  First -> Second => Third -&gt; Fourth  ')).toBe('First → Second → Third → Fourth');
    expect(sanitizeMarkdown('**Hello****World**')).toBe('**Hello**World**');
    expect(sanitizeMarkdown('Hello\0\x1FWorld')).toBe('HelloWorld');
  });

  it('preserves Markdown line boundaries around prose arrows', () => {
    expect(normalizePlanArrows('First\n-> Second\n\nNext')).toBe('First\n → Second\n\nNext');
  });

  it('keeps preparation idempotent without re-decoding escaped source', () => {
    const markdown = 'First -&gt; Second &amp;gt;\n\n`' + code + '`';
    expect(preparePlanMarkdown(preparePlanMarkdown(markdown))).toBe(preparePlanMarkdown(markdown));
  });
});

/**
 * @jest-environment node
 */
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

import config from '../../tailwind.config';

/** The stylesheet Tailwind builds for a quoted paragraph in rendered Markdown (`prose`). */
async function proseQuoteCss(): Promise<string> {
  const result = await postcss([
    // The classes of the note's reading view and of the editor (`RichMarkdownEditor`).
    tailwindcss({ ...config, content: [{ raw: '<div class="prose prose-sm desktop:prose-base dark:prose-invert"><blockquote><p>«Но Он изъязвлен был»</p></blockquote></div>', extension: 'html' }] }),
  ]).process('@tailwind components;', { from: undefined });
  return result.css;
}

describe('a quote in rendered Markdown', () => {
  // A quote carries its own marks — «…» or "…" as the person wrote them; the plugin's “ ” doubled them.
  it('adds no quotation marks of its own around the quoted words', async () => {
    const css = await proseQuoteCss();
    expect(css).toContain('blockquote');
    expect(css).not.toMatch(/content:\s*open-quote/);
    expect(css).not.toMatch(/content:\s*close-quote/);
  });
});

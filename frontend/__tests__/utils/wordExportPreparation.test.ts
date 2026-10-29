import { Document, Packer } from 'docx';
import JSZip from 'jszip';

import { parseMarkdownToParagraphs } from '../../utils/wordExport';

async function documentXml(markdown: string): Promise<string> {
  const children = parseMarkdownToParagraphs(markdown);
  const bytes = await Packer.toBuffer(new Document({ sections: [{ children }] }));
  const zip = await JSZip.loadAsync(bytes);
  return zip.file('word/document.xml')!.async('string');
}

describe('Word prose consumes prepared Markdown entities once', () => {
  it('decodes ordinary paragraph and heading entities once', async () => {
    const xml = await documentXml('## Tom &amp; Jerry\n\nA &amp;gt; B; &quot;words&quot;.');
    expect(xml).toContain('Tom &amp; Jerry');
    expect(xml).not.toContain('Tom &amp;amp; Jerry');
    expect(xml).toContain('A &amp;gt; B; &quot;words&quot;.');
  });

  it('keeps escaped HTML as literal words', async () => {
    const xml = await documentXml('&lt;u&gt;literal&lt;/u&gt;');
    expect(xml).toContain('&lt;u&gt;literal&lt;/u&gt;');
    expect(xml).not.toContain('<w:u');
  });

  it('normalizes prose arrows and keeps literal code operators', async () => {
    const xml = await documentXml('First -&gt; Second.\n\n`value => next -> end`');
    expect(xml).toContain('First → Second.');
    expect(xml).toContain('value =&gt; next -&gt; end');
  });
});

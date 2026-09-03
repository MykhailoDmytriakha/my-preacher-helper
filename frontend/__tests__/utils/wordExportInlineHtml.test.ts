import { Document, Packer, Paragraph, Table } from 'docx';
import JSZip from 'jszip';

import { parseMarkdownToParagraphs } from '../../utils/wordExport';

// Build a real .docx from the markdown and return its document.xml, so we assert on the
// ACTUAL serialized output rather than opaque docx objects.
async function docXml(md: string): Promise<string> {
  const children = parseMarkdownToParagraphs(md) as (Paragraph | Table)[];
  const doc = new Document({ sections: [{ children }] });
  const buf = await Packer.toBuffer(doc);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml')!.async('string');
  return xml;
}

describe('wordExport inline HTML formatting (matches the plan UI)', () => {
  it('renders <u> as underline, with no literal tag leaking', async () => {
    const xml = await docXml('<u>Царем нашей жизни</u>');
    expect(xml).toContain('<w:u w:val="single"/>');
    expect(xml).toContain('Царем нашей жизни');
    expect(xml).not.toMatch(/&lt;\/?u&gt;/);
  });

  it('handles nested **<u>X</u>** as bold + underline (the reported case)', async () => {
    const xml = await docXml('воцаряется **<u>Царем нашей жизни</u>**, то');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:u w:val="single"/>');
    expect(xml).toContain('Царем нашей жизни');
    expect(xml).not.toMatch(/&lt;\/?u&gt;/);
  });

  it('maps the inline HTML formatting tags the UI allows', async () => {
    const xml = await docXml([
      '<b>bold-b</b>',
      '<strong>bold-strong</strong>',
      '<i>italic-i</i>',
      '<em>italic-em</em>',
      '<s>struck</s>',
      '<mark>highlighted</mark>',
    ].join(' '));
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const runs = Array.from(document.getElementsByTagName('w:r'));
    const formattedRun = (text: string) =>
      runs.find((run) => run.textContent === text);

    expect(formattedRun('bold-b')?.getElementsByTagName('w:b')).toHaveLength(1);
    expect(formattedRun('bold-strong')?.getElementsByTagName('w:b')).toHaveLength(1);
    expect(formattedRun('italic-i')?.getElementsByTagName('w:i')).toHaveLength(1);
    expect(formattedRun('italic-em')?.getElementsByTagName('w:i')).toHaveLength(1);
    expect(formattedRun('struck')?.getElementsByTagName('w:strike')).toHaveLength(1);
    expect(
      formattedRun('highlighted')?.getElementsByTagName('w:highlight')[0]?.getAttribute('w:val')
    ).toBe('yellow');
  });

  it('strips unknown tags (<a>, <span>) but keeps their text', async () => {
    const xml = await docXml('перед <a href="https://x.com">ссылка</a> после');
    expect(xml).toContain('ссылка');
    expect(xml).not.toContain('href');
    expect(xml).not.toMatch(/&lt;a /);
  });

  it('does not touch a bare "<" that is not a tag (e.g. 5 < 10)', async () => {
    const xml = await docXml('если 5 < 10 верно');
    expect(xml).toContain('5 ');
    expect(xml).toContain('10 верно');
  });
});

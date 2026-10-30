jest.unmock('remark-gfm');
jest.unmock('rehype-raw');
jest.unmock('rehype-sanitize');

import { Document, Packer } from 'docx';
import JSZip from 'jszip';

import { parseMarkdownToParagraphs } from '../../utils/wordExport';

const NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
async function rows(markdown: string) {
  const buffer = await Packer.toBuffer(new Document({ sections: [{ children: parseMarkdownToParagraphs(markdown) }] }));
  const zip = await JSZip.loadAsync(buffer);
  const document = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'application/xml');
  return Array.from(document.getElementsByTagNameNS(NS, 'p')).map(paragraph => ({
    text: Array.from(paragraph.getElementsByTagNameNS(NS, 't')).map(node => node.textContent ?? '').join(''),
    style: paragraph.getElementsByTagNameNS(NS, 'pStyle')[0]?.getAttributeNS(NS, 'val'),
  }));
}

describe('Word canonical root headings', () => {
  it.each([
    ['one-space ATX', ' ## Named heading', 'Heading2'],
    ['two-space ATX', '  ### Named heading', 'Heading3'],
    ['three-space ATX', '   #### Named heading', 'Heading3'],
    ['Setext', 'Named heading\n---', 'Heading2'],
    ['multiline Setext', 'Named\nheading\n---', 'Heading2'],
    ['HTML', '<h2>Named heading</h2>', 'Heading2'],
  ])('styles %s without leaking source markers', async (_name, heading, style) => {
    const paragraphs = await rows(`Intro paragraph.\n\n${heading}\nBody remains.`);
    expect(paragraphs.find(row => row.text.replace(/\s+/g, ' ') === 'Named heading')).toMatchObject({ style });
    expect(paragraphs.map(row => row.text).join('\n')).not.toMatch(/##|---|<h2>/);
    expect(paragraphs.map(row => row.text)).toContain('Body remains.');
  });

  it('leaves a literal code heading in code while retaining a real heading', async () => {
    const paragraphs = await rows('Intro.\n\n    ## Literal code\n\n  ## Real heading\nBody.');
    expect(paragraphs.find(row => row.text === '## Literal code')?.style).toBeFalsy();
    expect(paragraphs.find(row => row.text === 'Real heading')?.style).toBe('Heading2');
  });
});

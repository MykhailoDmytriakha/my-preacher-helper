import { Document, Packer, Table } from 'docx';
import JSZip from 'jszip';
import { parseMarkdownToParagraphs, parseTable } from '../../utils/wordExport';
import { readMarkdownHtml } from '../../app/utils/markdownHtml';

async function wordXml(markdown: string): Promise<string> {
  const document = new Document({ sections: [{ children: parseMarkdownToParagraphs(markdown) as never[] }] });
  const zip = await JSZip.loadAsync(await Packer.toBuffer(document));
  return zip.file('word/document.xml')!.async('string');
}

function wordTables(xml: string): string[][][] {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  return Array.from(document.getElementsByTagNameNS(ns, 'tbl')).map(table =>
    Array.from(table.getElementsByTagNameNS(ns, 'tr')).map(row =>
      Array.from(row.getElementsByTagNameNS(ns, 'tc')).map(cell =>
        Array.from(cell.getElementsByTagNameNS(ns, 't')).map(text => text.textContent ?? '').join(''),
      ),
    ),
  );
}

function safeTables(markdown: string): string[][][] {
  const tables: string[][][] = [];
  const textOf = (node: any): string => node.type === 'text' ? node.value : (node.children ?? []).map(textOf).join('');
  const visit = (node: any): void => {
    if (node.type === 'element' && node.tagName === 'table') {
      const rows: string[][] = [];
      const rowsIn = (parent: any): void => {
        for (const child of parent.children ?? []) {
          if (child.type === 'element' && child.tagName === 'tr') {
            rows.push((child.children ?? []).filter((cell: any) => cell.type === 'element' && ['th', 'td'].includes(cell.tagName)).map(textOf));
          } else if (child.type === 'element') rowsIn(child);
        }
      };
      rowsIn(node);
      tables.push(rows);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(readMarkdownHtml(markdown));
  return tables;
}

async function actualTables(markdown: string): Promise<string[][][]> {
  return wordTables(await wordXml(markdown));
}

const cases: Array<[string, string]> = [
  ['escaped pipe in header', '| Left \\| literal | Right |\n| --- | --- |\n| A | B |'],
  ['escaped pipe in body', '| Left | Right |\n| --- | --- |\n| A \\| literal | B |'],
  ['escaped pipe inside inline code', '| Code | Other |\n| --- | --- |\n| `x\\|y` | z |'],
  ['unescaped pipe in backtick-looking text follows GFM delimiters', '| Code | Other |\n| --- | --- |\n| `x|y` | z |'],
  ['GFM table without outer pipes', 'A | B\n--- | ---\nOne | Two'],
  ['uneven GFM rows', '| A | B |\n| --- | --- |\n| One |\n| Two | Three | Four |'],
  ['empty GFM row', '| A | B |\n| --- | --- |\n|  |  |'],
  ['header-only GFM table', '| A | B |\n| --- | --- |'],
  ['quoted GFM table', '> | A | B |\n> | --- | --- |\n> | x\\|y | z |'],
  ['list-contained GFM table', '- | A | B |\n  | --- | --- |\n  | x\\|y | z |'],
];

describe('table-211 Word pipe parsing against safe GFM', () => {
  it.each(cases)('exports the safe-reader cell matrix for %s', async (_label, markdown) => {
    const expected = safeTables(markdown);
    expect(expected).toHaveLength(1);
    expect(await actualTables(markdown)).toEqual(expected);
  });

  it('keeps ordinary two-column table structure as a passing control', async () => {
    const markdown = '| A | B |\n| --- | --- |\n| One | Two |';
    expect(await actualTables(markdown)).toEqual(safeTables(markdown));
    expect(await actualTables(markdown)).toEqual([[['A', 'B'], ['One', 'Two']]]);
  });

  it('does not turn a standalone prose pipe into a table', async () => {
    const markdown = 'Outside prose | stays prose.';
    expect(safeTables(markdown)).toEqual([]);
    const xml = await wordXml(markdown);
    expect(wordTables(xml)).toEqual([]);
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    expect(Array.from(document.getElementsByTagNameNS(ns, 't')).map(node => node.textContent ?? '').join('')).toContain(markdown);
  });
});


describe('Word table source and formatting boundaries', () => {
  it('keeps blank-line-separated tables as separate tables', async () => {
    const markdown = '| A |\n| --- |\n| a |\n\n| B |\n| --- |\n| b |';
    expect(await actualTables(markdown)).toEqual([[['A'], ['a']], [['B'], ['b']]]);
  });

  it('retains prose containing several pipes as prose', async () => {
    const markdown = 'first | middle | last\nnext | middle | last';
    expect(safeTables(markdown)).toEqual([]);
    expect(await actualTables(markdown)).toEqual([]);
  });

  it.each([['CRLF', '\r\n'], ['bare CR', '\r']])('recognizes %s table boundaries', async (_name, ending) => {
    const markdown = ['| A | B |', '| --- | --- |', '| x\\|y | z |'].join(ending);
    expect(await actualTables(markdown)).toEqual([[['A', 'B'], ['x|y', 'z']]]);
  });

  it('preserves legacy Word scripts, nested formatting and literal code in cells', async () => {
    const markdown = '| Scripts | Formatted | Code |\n| --- | --- | --- |\n| x^2^ H~2~O <sup>3</sup><sub>4</sub> | **<u>both</u>** | `<u>literal</u> **stars** a\\|b` |';
    const xml = await wordXml(markdown);
    expect(wordTables(xml)).toEqual([[['Scripts', 'Formatted', 'Code'], ['x2 H2O 34', 'both', '<u>literal</u> **stars** a|b']]]);
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const cells = document.getElementsByTagNameNS(ns, 'tc');
    const scripts = Array.from(cells[3].getElementsByTagNameNS(ns, 'vertAlign')).map(n => n.getAttributeNS(ns, 'val'));
    expect(scripts).toEqual(['superscript', 'subscript', 'superscript', 'subscript']);
    expect(cells[4].getElementsByTagNameNS(ns, 'b')).toHaveLength(1);
    expect(cells[4].getElementsByTagNameNS(ns, 'u')).toHaveLength(1);
    expect(cells[5].getElementsByTagNameNS(ns, 'b')).toHaveLength(0);
    expect(cells[5].getElementsByTagNameNS(ns, 'u')).toHaveLength(0);
    expect(cells[5].getElementsByTagNameNS(ns, 'rFonts')[0].getAttributeNS(ns, 'ascii')).toBe('Courier New');
  });

  it('keeps original source offsets through recursive emphasis around table code', async () => {
    const markdown = '| A |\n| --- |\n| **before `x\\|y **inside**` after** |';
    expect(await actualTables(markdown)).toEqual([[['A'], ['before x|y **inside** after']]]);
  });

  it('decodes prose entities once and preserves literal code entity spelling', async () => {
    const markdown = '| Prose | Code |\n| --- | --- |\n| Tom &amp; Jerry; &amp;gt; | `&gt; &amp;gt; a\\|b` |';
    expect(await actualTables(markdown)).toEqual([[['Prose', 'Code'], ['Tom & Jerry; &gt;', '&gt; &amp;gt; a|b']]]);
  });

  it('keeps the explicit malformed-table compatibility entry point', () => {
    expect(parseTable(['| Column 1 | Column 2', '|----------|', '| Row 1 |'])).toBeInstanceOf(Table);
  });

  it('does not convert table-looking literal block code into a table', async () => {
    const markdown = '```text\n| A | B |\n| --- | --- |\n| a | b |\n```';
    expect(await actualTables(markdown)).toEqual([]);
  });
});

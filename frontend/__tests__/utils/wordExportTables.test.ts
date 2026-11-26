import { Document, Packer, Table } from 'docx';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { exportToWord, parseMarkdownToParagraphs, parseTable } from '../../utils/wordExport';
import { readMarkdownHtml } from '../../app/utils/markdownHtml';
import { getSermonPlanData } from '../../app/utils/sermonPlanAccess';

import type { Sermon } from '../../app/models/models';

jest.mock('file-saver', () => ({ saveAs: jest.fn() }));

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

// BUG-20261121-word-html-table-flattened: the owner's plan table, as the editor saved it (an empty first column, a
// `&nbsp;` heading cell, a cell of two paragraphs), comes out of real DOCX as the same table, cell for cell.
it('writes a table the editor saved as HTML as the same Word table', async () => {
  const html = '<table><tbody>'
    + '<tr><th><p></p></th><td><p>&nbsp;</p></td><td><p>Братьям</p></td><td><p>Сёстрам</p></td></tr>'
    + '<tr><td><p></p></td><td><p>Дети</p></td><td><p>Евр. 11:7</p></td><td><p>2 Тим. 1:5</p><p>вера матери</p></td></tr>'
    + '<tr><td colspan="2"><p>Вместе</p></td><td><p>Еф. 5:21</p></td><td><p>Еф. 5:21</p></td></tr>'
    + '</tbody></table>';
  const tables = await actualTables(`Отдельно братьям и сёстрам.\n\n${html}`);
  expect(tables).toEqual([[
    ['', '', 'Братьям', 'Сёстрам'],
    ['', 'Дети', 'Евр. 11:7', '2 Тим. 1:5вера матери'],
    ['Вместе', 'Еф. 5:21', 'Еф. 5:21'],
  ]]);
  const xml = await wordXml(html);
  expect(xml).not.toContain('&amp;nbsp;');
  expect(xml).toMatch(/<w:gridSpan w:val="2"\/>/);
});

// Codex ship check, 2026-11-21: what an HTML table must keep in Word besides its cells.
describe('a table written as HTML keeps everything around and inside it', () => {
  it('skips an empty table instead of failing the whole export', async () => {
    const xml = await wordXml('Before\n\n<table></table>\n\nAfter');
    expect(xml).toContain('Before');
    expect(xml).toContain('After');
  });

  it('keeps the words written before the table on its line, and its caption', async () => {
    const xml = await wordXml('Keep me <table><caption>Topic</caption><tr><td>Inside</td></tr></table> after');
    expect(xml).toContain('Keep me');
    expect(xml).toContain('Topic');
    expect(wordTables(xml)).toEqual([[['Inside']]]);
  });

  it('keeps literal marks and decodes the editor\'s entities once', async () => {
    const tables = await actualTables('<table><tr><td><p>Keep *these* and `these`</p></td><td><code>&lt;tag&gt;&amp;</code></td></tr></table>');
    expect(tables).toEqual([[['Keep *these* and `these`', '<tag>&']]]);
  });

  it('puts rows where the browser draws them: head, body, foot, with a span to the end of its group', async () => {
    const tables = await actualTables('<table><tfoot><tr><td>Foot</td><td>F</td></tr></tfoot><tbody><tr><td rowspan="0">A</td><td>B</td></tr><tr><td>C</td></tr></tbody></table>');
    expect(tables[0][0]).toEqual(['A', 'B']);
    expect(tables[0][1][1]).toBe('C');
    expect(tables[0][2]).toEqual(['Foot', 'F']);
  });
});

describe('an HTML table, the second look (Codex re-check)', () => {
  it('keeps a caption with its marked words', async () => {
    const xml = await wordXml('<table><caption>Read <strong>this</strong> now.</caption><tr><td>Cell</td></tr></table>');
    expect(xml).toContain('Read this now.');
  });

  it('keeps a merge inside its own group of rows', async () => {
    const tables = await actualTables('<table><tbody><tr><td rowspan="2">A</td><td>B</td></tr></tbody><tbody><tr><td>C</td><td>D</td></tr></tbody></table>');
    expect(tables[0][1]).toEqual(['C', 'D']);
  });
});

it('downloads a plan without letting the open table in one card consume its neighbor', async () => {
  const sermon: Sermon = {
    id: 'table-boundary',
    userId: 'word-fixture-owner',
    date: '2026-11-26',
    title: 'Plan card boundary',
    verse: 'John 3:16',
    planText: { first: '<table><tr><td>Unclosed cell', next: '<table>Before <tr><td>Next cell</td></tr> After</table>' },
    outline: {
      introduction: [{ id: 'first', text: 'First card', subPoints: [] }, { id: 'next', text: 'Second card', subPoints: [] }],
      main: [], conclusion: [],
    },
    thoughts: [],
  };
  const data = getSermonPlanData(sermon);
  expect(data).toBeDefined();
  await exportToWord({ data: data!, focusedSection: 'introduction' });
  const [download] = jest.mocked(saveAs).mock.calls.at(-1) ?? [];
  expect(download).toBeInstanceOf(Blob);
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(download as Blob);
  });
  const packed = await JSZip.loadAsync(bytes);
  const xml = await packed.file('word/document.xml')!.async('string');
  expect(wordTables(xml)).toEqual([[['Unclosed cell']], [['Next cell']]]);
  const rendered = new DOMParser().parseFromString(xml, 'application/xml');
  const words = Array.from(rendered.getElementsByTagName('w:t')).map(run => run.textContent).join(' ');
  expect(words.replace(/\s+/g, ' ')).toContain('First card Unclosed cell Second card Before After Next cell');
  expect(words.match(/Unclosed cell/g)).toHaveLength(1);
});

it.each([
  '<h2>Separate heading</h2>\n<table><tr><td>Table remains</td></tr></table>',
  '<table><tr><td>Table remains</td></tr></table><h2>Separate heading</h2>',
])('preserves the Word heading style for a heading outside the table', async markdown => {
  const xml = await wordXml(markdown);
  expect(wordTables(xml)).toEqual([[['Table remains']]]);
  const rendered = new DOMParser().parseFromString(xml, 'application/xml');
  const heading = Array.from(rendered.getElementsByTagName('w:p')).find(p => p.textContent === 'Separate heading');
  expect(heading?.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val')).toBe('Heading2');
});

it('gives the blank row a visible cell alongside a continuing vertical merge', async () => {
  const xml = await wordXml('<table><tr><td rowspan="0">Tall</td><td>First</td></tr><tr></tr><tr><td>Third</td></tr></table>');
  expect(wordTables(xml)).toEqual([[['Tall', 'First'], ['', ''], ['', 'Third']]]);
});

it('gives a fully covered empty row height without adding a column', async () => {
  const xml = await wordXml('<table><tr><td rowspan="0">Tall</td></tr><tr></tr></table>');
  expect(wordTables(xml)).toEqual([[['Tall'], ['']]]);
  expect(xml).toMatch(/<w:trHeight\b[^>]*w:hRule="atLeast"/);
});

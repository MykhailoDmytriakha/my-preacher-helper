import { Paragraph, Table, TableCell, TableRow, TextRun } from 'docx'

import { parseMarkdownToParagraphs } from '../wordExport'

jest.mock('docx', () => ({
  Document: jest.fn(), Paragraph: jest.fn(), TextRun: jest.fn(), ColumnBreak: jest.fn(), PageBreak: jest.fn(),
  HeadingLevel: { HEADING_1: 'Heading1', HEADING_2: 'Heading2', HEADING_3: 'Heading3' },
  AlignmentType: { CENTER: 'center', JUSTIFIED: 'justified', LEFT: 'left' },
  BorderStyle: { SINGLE: 'single' }, ShadingType: { SOLID: 'solid' }, WidthType: { PERCENTAGE: 'percentage', DXA: 'dxa' },
  Packer: { toBuffer: jest.fn() }, Table: jest.fn(), TableRow: jest.fn(), TableCell: jest.fn(),
}))

/*
 * BUG-20261121-word-html-table-flattened. The editor saves a table it cannot write as Markdown (an empty first
 * column, a `&nbsp;` cell, a cell of two paragraphs) as HTML. On screen it is a table; in Word it must be one too —
 * not a run-on line of its cells with a literal «&nbsp;».
 */
const OWNER_TABLE = '<table><tbody>'
  + '<tr><th><p></p></th><td><p>&nbsp;</p></td><td><p>Братьям</p></td><td><p>Сёстрам</p></td></tr>'
  + '<tr><td><p></p></td><td><p>Дети</p></td><td><p><em>Евр. 11:7</em>: «Ной… приготовил ковчег»</p></td><td><p>2 Тим. 1:5</p><p>вера матери</p></td></tr>'
  + '</tbody></table>'

beforeEach(() => jest.clearAllMocks())

it('exports a table the editor saved as HTML as a Word table, cell by cell', () => {
  parseMarkdownToParagraphs(['Что это значит для нас? Отдельно братьям и отдельно сёстрам.', OWNER_TABLE].join('\n\n'))
  expect(Table).toHaveBeenCalledTimes(1)
  expect(TableRow).toHaveBeenCalledTimes(2)
  expect(TableCell).toHaveBeenCalledTimes(8)
  const texts = jest.mocked(TextRun).mock.calls.map(([options]) => (options as { text?: string }).text ?? '')
  expect(texts).toEqual(expect.arrayContaining(['Братьям', 'Сёстрам', 'Дети', 'Евр. 11:7', '2 Тим. 1:5', 'вера матери']))
  expect(texts.join('|')).not.toMatch(/&nbsp;|БратьямСёстрам|<\/?(p|td|tr)\b/)
})

it('keeps the emphasis inside a cell and puts a cell\'s second paragraph on its own line', () => {
  parseMarkdownToParagraphs(OWNER_TABLE)
  const runs = jest.mocked(TextRun).mock.calls.map(([options]) => options as { text?: string; italics?: boolean; break?: number })
  expect(runs).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Евр. 11:7', italics: true })]))
  const second = runs.findIndex((run) => run.text === 'вера матери')
  expect(runs[second - 1]).toEqual(expect.objectContaining({ break: 1 }))
})

it('puts each block of a cell on its own line — paragraphs and list items, with their marks', () => {
  parseMarkdownToParagraphs('<table><tr><td><p>Applications</p><ul><li><p>First</p></li><li><p><strong>Second</strong></p></li></ul><p>After</p></td></tr></table>')
  const runs = jest.mocked(TextRun).mock.calls.map(([options]) => options as { text?: string; bold?: boolean; break?: number })
  const lines: string[] = ['']
  for (const run of runs) {
    if (run.break) lines.push('')
    if (run.text) lines[lines.length - 1] += run.text
  }
  expect(lines).toEqual(['Applications', '• First', '• Second', 'After'])
  expect(runs).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Second', bold: true })]))
})

it('keeps the blank line two breaks make, and a nested table\'s rows in drawing order', () => {
  parseMarkdownToParagraphs('<table><tr><td>A<br><br>B</td><td><table><tfoot><tr><td>Foot</td></tr></tfoot><tbody><tr><td>Body</td></tr></tbody></table></td></tr></table>')
  const runs = jest.mocked(TextRun).mock.calls.map(([options]) => options as { text?: string; break?: number })
  const flat = runs.map((run) => run.break ? '\n' : run.text ?? '').join('')
  expect(flat).toContain('A\n\nB')
  expect(flat.indexOf('Body')).toBeLessThan(flat.indexOf('Foot'))
})

describe('Word exports for HTML table fragments', () => {
  const emittedText = () => {
    const runs = jest.mocked(TextRun).mock
    const text = new Map<unknown, string>(runs.instances.map((run, index) => {
      const [options] = runs.calls[index]
      return [run, typeof options === 'string' ? options : options.text ?? '']
    }))
    return jest.mocked(Paragraph).mock.calls.flatMap(([options]) =>
      typeof options === 'string' ? [options] : options.children?.map(child => text.get(child) ?? '') ?? [])
      .join(' ').replace(/\s+/g, ' ').trim()
  }

  it('writes a cell only once when the last table has no closing tag', () => {
    parseMarkdownToParagraphs('<table><tr><td>Unclosed cell')
    expect(Table).toHaveBeenCalledTimes(1)
    expect(emittedText()).toBe('Unclosed cell')
  })

  it('keeps the visible words moved around a table by the reader, in reading order', () => {
    parseMarkdownToParagraphs('<div>Outside before <table>Moved before <tr><td>Cell words</td></tr> Moved after</table> Outside after</div>')
    expect(Table).toHaveBeenCalledTimes(1)
    expect(emittedText()).toBe('Outside before Moved before Moved after Cell words Outside after')
  })

  it('preserves an empty row crossed by a vertical merge', () => {
    parseMarkdownToParagraphs('<table><tbody><tr><td rowspan="0">Tall</td><td>First</td></tr><tr></tr><tr><td>Third</td></tr></tbody></table>')
    expect(TableRow).toHaveBeenCalledTimes(3)
    expect(TableCell).toHaveBeenCalledWith(expect.objectContaining({ rowSpan: 3 }))
    expect(emittedText()).toBe('Tall First Third')
  })

  it('exports two tables and their repaired prose in the order the reader shows', () => {
    parseMarkdownToParagraphs('<table>Before A <tr><td>Cell A</td></tr> After A</table> Between <table>Before B <tr><td>Cell B</td></tr> After B</table> Last')
    expect(Table).toHaveBeenCalledTimes(2)
    expect(emittedText()).toBe('Before A After A Cell A Between Before B After B Cell B Last')
  })

  it('preserves repaired text inside a numbered step and resumes its continuation', () => {
    parseMarkdownToParagraphs('1. **Step**\n\n   <table>Before\n   <tr><td>Cell</td></tr> After</table>---\n\n   > Continued quote')
    expect(Table).toHaveBeenCalledTimes(1)
    expect(emittedText()).toBe('1. Step Before After Cell --- Continued quote')
  })

  it('keeps a fenced block in the cell that contains it and preserves the following fence', () => {
    parseMarkdownToParagraphs('<table><tr><td>First line\n\n```text\nCell code\n```\n\n</td></tr></table>\n\n```text\nOutside code\n```')
    expect(Table).toHaveBeenCalledTimes(1)
    expect(emittedText()).toBe('First line Cell code Outside code')
    expect(TextRun).toHaveBeenCalledWith(expect.objectContaining({ text: 'Outside code', font: 'Courier New' }))
  })

  it('gives an uncovered empty row one empty cell', () => {
    parseMarkdownToParagraphs('<table><tr><td>First</td></tr><tr></tr><tr><td>Third</td></tr></table>')
    expect(TableRow).toHaveBeenCalledTimes(3)
    expect(TableCell).toHaveBeenCalledTimes(3)
    expect(emittedText()).toBe('First Third')
  })

  it('prints the literal tail of the raw HTML line and resumes Markdown on a later line', () => {
    parseMarkdownToParagraphs('<table><tr><td>Cell words</td></tr></table>---\n\n**Next paragraph**')
    expect(Table).toHaveBeenCalledTimes(1)
    expect(emittedText()).toBe('Cell words --- Next paragraph')
    expect(TextRun).toHaveBeenCalledWith(expect.objectContaining({ text: 'Next paragraph', bold: true }))
  })
})

it('keeps an inline HTML table suffix as literal text', () => {
  parseMarkdownToParagraphs('Start <table><tr><td>Inline cell</td></tr></table>---')
  expect(Table).toHaveBeenCalledTimes(1)
  expect(TextRun).toHaveBeenCalledWith(expect.objectContaining({ text: '---' }))
})

it('follows the reader when an unclosed table moves the next paragraph before it', () => {
  parseMarkdownToParagraphs('<table><tr><td>Cell words</td></tr>After row\n\nFurther text')
  const texts = jest.mocked(TextRun).mock.calls.map(([options]) =>
    typeof options === 'string' ? options : options.text ?? '')
  expect(texts.map(value => value.trim()).filter(Boolean)).toEqual(['After row', 'Further text', 'Cell words'])
})

it('exports a heading moved outside an HTML table without cutting off the table', () => {
  parseMarkdownToParagraphs('<table><h2>Fostered heading</h2><tr><td>Table remains</td></tr></table>\n\n## Ordinary heading')
  expect(Table).toHaveBeenCalledTimes(1)
  const texts = jest.mocked(TextRun).mock.calls.map(([options]) =>
    typeof options === 'string' ? options : options.text ?? '').map(value => value.trim()).filter(Boolean)
  expect(texts).toEqual(['Fostered heading', 'Table remains', 'Ordinary heading'])
})

it.each([
  ['<div>Early\n\n<table>Before<tr><td>Cell words</td></tr>After</table> Late</div>', ['Early BeforeAfter', 'Cell words', 'Late']],
  ['<div>Early\n\n<table><tr><td>Cell words</td></tr>Foster\n\nLate', ['Early Foster', 'Late', 'Cell words']],
])('keeps text merged by the browser across separate HTML blocks', (source, expected) => {
  parseMarkdownToParagraphs(source)
  const texts = jest.mocked(TextRun).mock.calls.map(([options]) =>
    typeof options === 'string' ? options : options.text ?? '')
  expect(texts.map(value => value.replace(/\s+/g, ' ').trim()).filter(Boolean)).toEqual(expected)
})

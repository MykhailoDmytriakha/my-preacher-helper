import { Table, TableCell, TableRow, TextRun } from 'docx'

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

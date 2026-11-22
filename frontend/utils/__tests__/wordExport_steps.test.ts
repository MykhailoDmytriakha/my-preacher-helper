import { Paragraph } from 'docx'

import { parseMarkdownToParagraphs } from '../wordExport'

jest.mock('docx', () => ({
  Document: jest.fn(), Paragraph: jest.fn(), TextRun: jest.fn(), ColumnBreak: jest.fn(), PageBreak: jest.fn(),
  HeadingLevel: { HEADING_1: 'Heading1', HEADING_2: 'Heading2', HEADING_3: 'Heading3' },
  AlignmentType: { CENTER: 'center', JUSTIFIED: 'justified', LEFT: 'left' },
  BorderStyle: { SINGLE: 'single' }, ShadingType: { SOLID: 'solid' }, WidthType: { PERCENTAGE: 'percentage', DXA: 'dxa' },
  Packer: { toBuffer: jest.fn() }, Table: jest.fn(), TableRow: jest.fn(), TableCell: jest.fn(),
}))

/*
 * A plan step from a note is a numbered list item with its verse, its quote and its thoughts indented under it
 * (`utils/notePlanMarkdown.ts`). In Word the step's content sits under the number, where its bullets sit — not
 * level with the number (owner, 2026-11-21: «место описания идёт без отступа, структуру сбивает»).
 */
it('indents a step\'s verse, quote and thoughts under its number', () => {
  parseMarkdownToParagraphs([
    '1. **Иосиф и Мария** — хотел тайно отпустить',
    '   *Мф. 1:19–20: «хотел тайно отпустить Её»*',
    '   > «была других мыслей» — Климент Римский',
    '   - Бог открыл Иосифу то, что знала Мария',
    '**Вывод:** Бог не оставил их.',
  ].join('\n\n'))
  const indents = jest.mocked(Paragraph).mock.calls.map(([options]) => (options as { indent?: { left?: number } }).indent?.left)
  expect(indents).toEqual([720, 1080, 1080, 1080, undefined])
})

it('keeps an indented line of ordinary prose, outside any list, at the body indent', () => {
  jest.mocked(Paragraph).mockClear()
  parseMarkdownToParagraphs(['Обычный абзац', '  продолжение с отступом', '  > цитата с отступом'].join('\n\n'))
  const indents = jest.mocked(Paragraph).mock.calls.map(([options]) => (options as { indent?: { left?: number } }).indent?.left)
  expect(indents).toEqual([undefined, undefined, 720])
})

it('draws step 9 and step 10 the same way, and leaves a quote that is not inside the item at the body indent', () => {
  jest.mocked(Paragraph).mockClear()
  parseMarkdownToParagraphs([
    '9. **Девятый**', '   *Ин. 9:1: «стих»*', '   - мысль',
    '10. **Десятый**', '    *Ин. 10:1: «стих»*', '    - мысль',
    '  > цитата не из пункта',
  ].join('\n\n'))
  const indents = jest.mocked(Paragraph).mock.calls.map(([options]) => (options as { indent?: { left?: number } }).indent?.left)
  expect(indents).toEqual([720, 1080, 1080, 720, 1080, 1080, 720])
})

it('keeps a step\'s quote under the step after a table or a code block inside it', () => {
  jest.mocked(Paragraph).mockClear()
  parseMarkdownToParagraphs([
    '1. **Шаг**',
    '   > до таблицы',
    '   | Кому | Что |\n   | --- | --- |\n   | Братьям | Ef 5:25 |',
    '   > после таблицы',
    '   ```\n   код\n   ```',
    '   > после кода',
  ].join('\n\n'))
  const quoteIndents = jest.mocked(Paragraph).mock.calls
    .map(([options]) => options as { indent?: { left?: number }; border?: unknown })
    .filter((options) => options.border)
    .map((options) => options.indent?.left)
  expect(quoteIndents).toEqual([1080, 1080, 1080])
})

it('ends the list items at a code block written outside the list', () => {
  jest.mocked(Paragraph).mockClear()
  parseMarkdownToParagraphs('1. **Faith**\n\n   - Thought\n\n```\ncode\n```\n\n   > Separate quote')
  const quoteIndents = jest.mocked(Paragraph).mock.calls
    .map(([options]) => options as { indent?: { left?: number }; border?: unknown })
    .filter((options) => options.border)
    .map((options) => options.indent?.left)
  expect(quoteIndents).toEqual([720])
})

it('takes «- - -» for a rule, so a quote after it is outside the list', () => {
  jest.mocked(Paragraph).mockClear()
  parseMarkdownToParagraphs('1. **Faith**\n\n- - -\n\n  > Separate quote')
  const quoteIndents = jest.mocked(Paragraph).mock.calls
    .map(([options]) => options as { indent?: { left?: number }; border?: unknown; children?: unknown[] })
    .filter((options) => options.border && options.indent)
    .map((options) => options.indent?.left)
  expect(quoteIndents).toEqual([720])
})

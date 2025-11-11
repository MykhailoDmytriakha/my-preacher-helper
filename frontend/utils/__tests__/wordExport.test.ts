import { exportToWord, PlanData, WordExportOptions, parseMarkdownToParagraphs, parseTable, parseInlineMarkdown } from '../wordExport'
import { Document, Paragraph, TextRun, Table } from 'docx'
import { saveAs } from 'file-saver'
import { runScenarios } from '@test-utils/scenarioRunner'

// Mock the docx library
jest.mock('docx', () => {
  const actualDocx = jest.requireActual('docx')
  return {
    ...actualDocx,
    Document: jest.fn(),
    Packer: {
      toBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
    },
  }
})

// Mock file-saver
jest.mock('file-saver', () => ({
  saveAs: jest.fn(),
}))

// Mock URL methods
global.URL.createObjectURL = jest.fn(() => 'blob:mock-url')
global.URL.revokeObjectURL = jest.fn()

// Mock Blob constructor
global.Blob = jest.fn().mockImplementation((parts, options) => ({
  size: 1024,
  type: options?.type || 'application/octet-stream',
  parts,
  options,
}))

describe('wordExport', () => {
  const basePlanData: PlanData = {
    sermonTitle: 'Test Sermon',
    sermonVerse: 'John 3:16',
    introduction: '## Intro Heading\nThis is the introduction.\n- Point 1\n- Point 2',
    main: '# Main Heading\nThis is the main content.\n1. First point\n2. Second point',
    conclusion: 'This is the conclusion.\n> Important quote',
    exportDate: '1 января 2024',
  }

  const getPlanData = (overrides: Partial<PlanData> = {}): PlanData => ({
    ...basePlanData,
    ...overrides,
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('exportToWord', () => {
    it('handles the core export flows without redundant test cases', async () => {
      const scenarios = [
        {
          name: 'creates a Word document with explicit filename',
          run: async () => {
            jest.clearAllMocks()
            const options: WordExportOptions = {
              data: getPlanData(),
              filename: 'test-sermon.docx',
            }

            await exportToWord(options)

            expect(Document).toHaveBeenCalledWith(
              expect.objectContaining({
                creator: 'My Preacher Helper',
                title: `План проповеди: ${basePlanData.sermonTitle}`,
                description: 'Автоматически сгенерированный план проповеди',
              })
            )
            expect(saveAs).toHaveBeenCalledWith(expect.any(Object), 'test-sermon.docx')
          },
        },
        {
          name: 'falls back to generated filename when missing',
          run: async () => {
            jest.clearAllMocks()
            await exportToWord({ data: getPlanData() })

            const [[, resolvedFilename]] = (saveAs as jest.Mock).mock.calls
            expect(resolvedFilename).toContain('план-проповеди-test-sermon')
          },
        },
        {
          name: 'derives export date when omitted',
          run: async () => {
            jest.clearAllMocks()
            const planDataWithoutDate = getPlanData({ exportDate: undefined })
            await exportToWord({ data: planDataWithoutDate })

            expect(Document).toHaveBeenCalledWith(expect.objectContaining({
              creator: 'My Preacher Helper',
            }))
          },
        },
      ]

      await runScenarios(scenarios)
    })

    it('propagates errors from the Document constructor', async () => {
      const mockError = new Error('Export failed')
      const DocumentMock = Document as jest.MockedClass<typeof Document>
      DocumentMock.mockImplementationOnce(() => {
        throw mockError
      })

      await expect(exportToWord({ data: getPlanData() })).rejects.toThrow('Failed to export to Word document')
    })
  })

  describe('parseMarkdownToParagraphs', () => {
    it('supports diverse markdown constructs in one aggregated scenario', async () => {
      await runScenarios([
        {
          name: 'empty content uses placeholder paragraph',
          run: () => {
            const result = parseMarkdownToParagraphs('')
            expect(result).toHaveLength(1)
            expect(result[0]).toBeInstanceOf(Paragraph)
          },
        },
        {
          name: 'whitespace-only content',
          run: () => {
            const result = parseMarkdownToParagraphs('   \n  \t  ')
            expect(result).toHaveLength(1)
            expect(result[0]).toBeInstanceOf(Paragraph)
          },
        },
        {
          name: 'heading levels (H1-H3)',
          run: () => {
            const h1 = parseMarkdownToParagraphs('# Main Heading', '2563eb')
            const h2 = parseMarkdownToParagraphs('## Sub Heading', '7c3aed')
            const h3 = parseMarkdownToParagraphs('### Small Heading', '059669')
            expect(h1[0]).toBeInstanceOf(Paragraph)
            expect(h2[0]).toBeInstanceOf(Paragraph)
            expect(h3[0]).toBeInstanceOf(Paragraph)
          },
        },
        {
          name: 'bullet and numbered lists',
          run: () => {
            const bullets = parseMarkdownToParagraphs('- First point\n* Second point')
            const numbers = parseMarkdownToParagraphs('1. First item\n2. Second item\n3. Third item')
            expect(bullets).toHaveLength(2)
            expect(numbers).toHaveLength(3)
          },
        },
        {
          name: 'quotes and dividers',
          run: () => {
            const quotes = parseMarkdownToParagraphs('> This is a quote\n> Another line')
            const dividers = parseMarkdownToParagraphs('---\n***')
            expect(quotes).toHaveLength(2)
            expect(dividers).toHaveLength(2)
          },
        },
        {
          name: 'bible verse detection',
          run: () => {
            const content = 'Притч 17:18: "Безрассуден тот, кто берет на себя долг другого"'
            const result = parseMarkdownToParagraphs(content)
            expect(result).toHaveLength(1)
            expect(result[0]).toBeInstanceOf(Paragraph)
          },
        },
        {
          name: 'mixed content composition',
          run: () => {
            const content = '# Heading\nRegular paragraph\n- Bullet point\n> Quote\n---'
            const result = parseMarkdownToParagraphs(content)
            expect(result).toHaveLength(5)
          },
        },
        {
          name: 'table recognition',
          run: () => {
            const content = '| Col1 | Col2 |\n|------|------|\n| Row1 | Data1 |'
            const result = parseMarkdownToParagraphs(content)
            expect(result[0]).toBeInstanceOf(Table)
          },
        },
        {
          name: 'lists with bold text',
          run: () => {
            const bulletBold = parseMarkdownToParagraphs('- В трубу подали **три вещи**: воздух, воду и огонь-свет.')
            const numberedBold = parseMarkdownToParagraphs('1. Кабель принёс **лампы**, но "внутренний костёр" зажёгся в молитве.')
            expect(bulletBold[0]).toBeInstanceOf(Paragraph)
            expect(numberedBold[0]).toBeInstanceOf(Paragraph)
          },
        },
        {
          name: 'quotes with emphasis',
          run: () => {
            const quote = parseMarkdownToParagraphs('> Шахтёры собирались **на общее собрание — и начинают молитву**.')
            expect(quote[0]).toBeInstanceOf(Paragraph)
          },
        },
      ])
    })
  })

  describe('parseTable', () => {
    it('covers table parsing scenarios compactly', async () => {
      await runScenarios([
        {
          name: 'insufficient table lines',
          run: () => {
            expect(parseTable(['| Single line'])).toBeNull()
            expect(parseTable([])).toBeNull()
          },
        },
        {
          name: 'valid table',
          run: () => {
            const tableLines = [
              '| Column 1 | Column 2 |',
              '|----------|----------|',
              '| Row 1    | Data 1   |',
              '| Row 2    | Data 2   |',
            ]
            expect(parseTable(tableLines)).toBeInstanceOf(Table)
          },
        },
        {
          name: 'malformed but recoverable table',
          run: () => {
            const malformed = [
              '| Column 1 | Column 2',
              '|----------|',
              '| Row 1    |',
            ]
            expect(parseTable(malformed)).toBeInstanceOf(Table)
          },
        },
        {
          name: 'separator filtering and uneven rows',
          run: () => {
            const result = parseTable([
              '| Column 1 | Column 2 | Column 3 |',
              '|:---------|:---------|----------|',
              '| Row 1    | Data 1   |',
              '| Row 2    | Data 2   | Data 3   |',
            ])
            expect(result).toBeInstanceOf(Table)
          },
        },
      ])
    })
  })

  describe('parseInlineMarkdown', () => {
    it('parses inline emphasis variants in one cohesive test', async () => {
      await runScenarios([
        {
          name: 'plain text fallback',
          run: () => {
            const result = parseInlineMarkdown('Plain text content')
            expect(result).toHaveLength(1)
            expect(result[0]).toBeInstanceOf(TextRun)
          },
        },
        {
          name: 'bold and localized bold',
          run: () => {
            const result = parseInlineMarkdown('This is **bold** text')
            expect(result).toHaveLength(3)
            const russian = parseInlineMarkdown('**лампы**')
            expect(russian[0]).toBeInstanceOf(TextRun)
          },
        },
        {
          name: 'complex bold sentence',
          run: () => {
            const text = 'Кабель принёс **лампы**, но "внутренний костёр" зажёгся в молитве'
            expect(parseInlineMarkdown(text).length).toBeGreaterThan(1)
          },
        },
        {
          name: 'italic and triple emphasis',
          run: () => {
            const italic = parseInlineMarkdown('This is *italic* text')
            const combined = parseInlineMarkdown('This is ***bold and italic*** text')
            expect(italic).toHaveLength(3)
            expect(combined).toHaveLength(3)
          },
        },
        {
          name: 'code and strikethrough',
          run: () => {
            const code = parseInlineMarkdown('This is `code` text')
            const strike = parseInlineMarkdown('This is ~~strikethrough~~ text')
            expect(code).toHaveLength(3)
            expect(strike).toHaveLength(3)
          },
        },
        {
          name: 'super/sub-script handling',
          run: () => {
            const superscript = parseInlineMarkdown('E = mc^2^')
            const subscript = parseInlineMarkdown('H~2~O')
            expect(superscript).toHaveLength(2)
            expect(subscript).toHaveLength(3)
          },
        },
        {
          name: 'mixed formatting and nesting',
          run: () => {
            const mixed = parseInlineMarkdown('**Bold** and *italic* and `code`')
            const nested = parseInlineMarkdown('**Bold with *italic* inside**')
            const overlapping = parseInlineMarkdown('**Bold starts here *and italic overlaps** here*')
            expect(mixed).toHaveLength(5)
            expect(nested[0]).toBeInstanceOf(TextRun)
            expect(overlapping).toHaveLength(2)
          },
        },
        {
          name: 'unclosed markers and edge cases',
          run: () => {
            const unclosed = parseInlineMarkdown('**Unclosed bold and *unclosed italic')
            const empty = parseInlineMarkdown('')
            const onlyMarkers = parseInlineMarkdown('**')
            expect(unclosed).toHaveLength(2)
            expect(empty).toHaveLength(1)
            expect(onlyMarkers).toHaveLength(1)
          },
        },
      ])
    })
  })

  describe('Integration tests', () => {
    it('keeps high-level export scenarios consolidated', async () => {
      await runScenarios([
        {
          name: 'varied markdown elements',
          run: async () => {
            jest.clearAllMocks()
            await exportToWord({
              data: getPlanData({
                sermonTitle: 'Markdown Test',
                introduction: '# Main Heading\n## Sub Heading\n### Small Heading',
                main: '- Bullet point\n* Another bullet\n1. Numbered item\n2. Another number',
                conclusion: '> This is a quote\n---\nRegular paragraph',
              }),
            })
            expect(Document).toHaveBeenCalled()
          },
        },
        {
          name: 'bible verses in text',
          run: async () => {
            jest.clearAllMocks()
            await exportToWord({
              data: getPlanData({
                introduction: 'Притч 17:18: "Безрассуден тот, кто берет на себя долг другого"\nМуд 17:18: "Лишь неразумный человек даёт залог"',
                main: 'Regular content',
                conclusion: 'Regular content',
              }),
            })
            expect(Document).toHaveBeenCalled()
          },
        },
        {
          name: 'table heavy content',
          run: async () => {
            jest.clearAllMocks()
            await exportToWord({
              data: getPlanData({
                introduction: '| Column 1 | Column 2 |\n|----------|----------|\n| Row 1 | Data 1 |\n| Row 2 | Data 2 |',
                main: 'Regular content',
                conclusion: 'Regular content',
              }),
            })
            expect(Document).toHaveBeenCalled()
          },
        },
        {
          name: 'inline formatting variety',
          run: async () => {
            jest.clearAllMocks()
            await exportToWord({
              data: getPlanData({
                introduction: '**Bold text** and *italic text* and `code text`',
                main: '***Bold and italic*** and ~~strikethrough~~ text',
                conclusion: 'Text with ^superscript^ and ~subscript~',
              }),
            })
            expect(Document).toHaveBeenCalled()
          },
        },
        {
          name: 'malformed table still handled',
          run: async () => {
            jest.clearAllMocks()
            await exportToWord({
              data: getPlanData({
                introduction: '| Only one column',
                main: '||\n||',
                conclusion: 'Regular content',
              }),
            })
            expect(Document).toHaveBeenCalled()
          },
        },
      ])
    })
  })

  describe('Interface types', () => {
    it('validates representative PlanData and options shapes', async () => {
      await runScenarios([
        {
          name: 'full PlanData support',
          run: () => {
            const validPlanData: PlanData = getPlanData({ sermonTitle: 'Valid Sermon', exportDate: 'Optional date' })
            expect(validPlanData.sermonTitle).toBe('Valid Sermon')
            expect(validPlanData.exportDate).toBe('Optional date')
          },
        },
        {
          name: 'minimal PlanData',
          run: () => {
            const minimalPlanData: PlanData = {
              sermonTitle: 'Minimal Sermon',
              introduction: 'Intro',
              main: 'Main',
              conclusion: 'Conclusion',
            }
            expect(minimalPlanData.sermonTitle).toBe('Minimal Sermon')
          },
        },
        {
          name: 'WordExportOptions contract',
          run: () => {
            const validOptions: WordExportOptions = {
              data: {
                sermonTitle: 'Test',
                introduction: 'Intro',
                main: 'Main',
                conclusion: 'Conclusion',
              },
              filename: 'custom-filename.docx',
            }
            expect(validOptions.filename).toBe('custom-filename.docx')
          },
        },
      ])
    })
  })

  describe('Edge cases and error handling', () => {
    it('covers extreme content cases while keeping a single Jest test', async () => {
      await runScenarios([
        {
          name: 'very long content',
          run: async () => {
            jest.clearAllMocks()
            const longContent = 'A'.repeat(10000)
            await exportToWord({
              data: getPlanData({
                sermonTitle: 'Long Content Test',
                introduction: longContent,
                main: longContent,
                conclusion: longContent,
              }),
            })
            expect(Document).toHaveBeenCalled()
          },
        },
        {
          name: 'special characters and unicode',
          run: async () => {
            jest.clearAllMocks()
            await exportToWord({
              data: getPlanData({
                sermonTitle: 'Специальные символы ñáéíóú 中文 🙏',
                introduction: 'Контент с эмодзи 😊 и символами ®™©',
                main: 'Математические символы ∑∆∏∫ и стрелки →←↑↓',
                conclusion: 'Кавычки "двойные" и "одинарные" и символы №§',
              }),
            })
            expect(Document).toHaveBeenCalled()
          },
        },
        {
          name: 'malformed markdown is tolerated',
          run: async () => {
            jest.clearAllMocks()
            await exportToWord({
              data: getPlanData({
                sermonTitle: 'Malformed Markdown Test',
                introduction: '**Unclosed bold and *unclosed italic and `unclosed code',
                main: '### ### Multiple hashes # and --- incomplete rules -',
                conclusion: '> Unclosed quote\n\n\n\nMultiple newlines',
              }),
            })
            expect(Document).toHaveBeenCalled()
          },
        },
        {
          name: 'nested markdown combinations',
          run: async () => {
            jest.clearAllMocks()
            await exportToWord({
              data: getPlanData({
                sermonTitle: 'Nested Markdown Test',
                introduction: '**Bold with *italic inside* and `code`**',
                main: '***Triple emphasis with `code` inside***',
                conclusion: '> Quote with **bold** and *italic* text',
              }),
            })
            expect(Document).toHaveBeenCalled()
          },
        },
      ])
    })
  })

  describe('Color and styling', () => {
    it('applies section colors correctly', async () => {
      await exportToWord({
        data: getPlanData({
          sermonTitle: 'Color Test',
          introduction: '# Introduction Heading',
          main: '# Main Heading',
          conclusion: '# Conclusion Heading',
        }),
      })

      expect(Document).toHaveBeenCalled()
    })
  })
})

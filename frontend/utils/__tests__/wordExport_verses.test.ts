
import { TextRun } from 'docx'
import { exportToWord, PlanData } from '../wordExport'

// Mock the docx library
jest.mock('docx', () => {
    return {
        Document: jest.fn(),
        Paragraph: jest.fn(),
        TextRun: jest.fn(),
        HeadingLevel: { HEADING_1: 'Heading1', HEADING_2: 'Heading2', HEADING_3: 'Heading3' },
        AlignmentType: { CENTER: 'center', JUSTIFIED: 'justified' },
        BorderStyle: { SINGLE: 'single' },
        ShadingType: { SOLID: 'solid' },
        WidthType: { PERCENTAGE: 'percentage' },
        Packer: {
            toBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
        },
        Table: jest.fn(),
        TableRow: jest.fn(),
        TableCell: jest.fn(),
    }
})

// Mock file-saver
jest.mock('file-saver', () => ({
    saveAs: jest.fn(),
}))

// Mock URL methods
global.URL.createObjectURL = jest.fn(() => 'blob:mock-url')
global.URL.revokeObjectURL = jest.fn()
global.Blob = jest.fn().mockImplementation((parts, options) => ({
    size: 1024,
    type: options?.type || 'application/octet-stream',
    parts,
    options,
}))

describe('wordExport - Verses', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('splits multiple verses into separate lines', async () => {
        const data: PlanData = {
            sermonTitle: 'Test Sermon',
            sermonVerse: 'John 1:1\nJohn 1:2',
            introduction: 'Intro',
            main: 'Main',
            conclusion: 'Conclusion',
        }

        await exportToWord({ data })

        const TextRunMock = TextRun as unknown as jest.Mock
        const calls = TextRunMock.mock.calls

        const firstVerseCall = calls.find(call => call[0].text === 'John 1:1')
        const secondVerseCall = calls.find(call => call[0].text === 'John 1:2')

        expect(firstVerseCall).toBeDefined()
        expect(secondVerseCall).toBeDefined()

        expect(firstVerseCall[0]).toEqual(expect.objectContaining({
            text: 'John 1:1',
            break: 0
        }))

        expect(secondVerseCall[0]).toEqual(expect.objectContaining({
            text: 'John 1:2',
            break: 1
        }))
    })

    it('filters out empty lines and trims whitespace', async () => {
        const data: PlanData = {
            sermonTitle: 'Test Sermon',
            sermonVerse: '  John 1:1  \n\n  \nJohn 1:2',
            introduction: 'Intro',
            main: 'Main',
            conclusion: 'Conclusion',
        }

        await exportToWord({ data })

        const TextRunMock = TextRun as unknown as jest.Mock
        const verseCalls = TextRunMock.mock.calls.filter(call =>
            call[0].text && (call[0].text.includes('John 1:1') || call[0].text.includes('John 1:2'))
        )

        expect(verseCalls).toHaveLength(2)

        expect(verseCalls[0][0]).toEqual(expect.objectContaining({
            text: 'John 1:1',
            break: 0
        }))

        expect(verseCalls[1][0]).toEqual(expect.objectContaining({
            text: 'John 1:2',
            break: 1
        }))
    })
})

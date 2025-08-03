import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, ShadingType, TableRow, Table, TableCell, WidthType } from 'docx';
import { saveAs } from 'file-saver';

interface PlanData {
  sermonTitle: string;
  sermonVerse?: string;
  introduction: string;
  main: string;
  conclusion: string;
  exportDate?: string;
}

interface WordExportOptions {
  data: PlanData;
  filename?: string;
}

export const parseMarkdownToParagraphs = (content: string, sectionColor?: string): (Paragraph | Table)[] => {
  if (!content || content.trim() === '') {
    return [
      new Paragraph({
        children: [
          new TextRun({
            text: 'Содержание будет добавлено позже...',
            italics: true,
            color: '666666',
          }),
        ],
        spacing: { after: 100 },
      }),
    ];
  }

  const lines = content.split('\n').filter(line => line.trim() !== '');
  const elements: (Paragraph | Table)[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmedLine = lines[i].trim();
    
    // Check for table
    if (trimmedLine.includes('|')) {
      const tableLines = [];
      let j = i;
      
      // Collect all table lines
      while (j < lines.length && lines[j].trim().includes('|')) {
        tableLines.push(lines[j]);
        j++;
      }
      
      if (tableLines.length > 0) {
        const table = parseTable(tableLines);
        if (table) {
          elements.push(table);
          i = j;
          continue;
        }
      }
    }
    
    // Handle headings with section colors
    if (trimmedLine.startsWith('### ')) {
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: trimmedLine.replace('### ', ''),
              bold: true,
              size: 20,
              color: sectionColor || '374151',
              font: 'Arial',
            }),
          ],
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 0, after: 0 },
          indent: { left: 360 },
        })
      );
    } else if (trimmedLine.startsWith('## ')) {
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: trimmedLine.replace('## ', ''),
              bold: true,
              underline: {},
              size: 22,
              color: sectionColor || '374151',
              font: 'Arial',
            }),
          ],
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 0, after: 0 },
        })
      );
    } else if (trimmedLine.startsWith('# ')) {
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: trimmedLine.replace('# ', ''),
              bold: true,
              size: 24,
              color: sectionColor || '374151',
              font: 'Arial',
            }),
          ],
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 0, after: 0 },
        })
      );
    } else if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
      // Handle bullet points with markdown formatting
      const bulletContent = trimmedLine.replace(/^[-*] /, '');
      const bulletChildren = parseInlineMarkdown(bulletContent);
      elements.push(
        new Paragraph({
          children: [
            new TextRun({ text: '• ' }),
            ...bulletChildren,
          ],
          spacing: { after: 0 },
          indent: { left: 720 },
        })
      );
    } else if (trimmedLine.match(/^\d+\. /)) {
      // Handle numbered lists with markdown formatting
      const number = trimmedLine.match(/^(\d+)\. (.*)$/);
      if (number) {
        const listContent = number[2];
        const listChildren = parseInlineMarkdown(listContent);
        elements.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${number[1]}. ` }),
              ...listChildren,
            ],
            spacing: { after: 0 },
            indent: { left: 720 },
          })
        );
      }
    } else if (trimmedLine.startsWith('> ')) {
      // Handle blockquotes with markdown formatting
      const quoteContent = trimmedLine.replace('> ', '');
      const quoteChildren = parseInlineMarkdown(quoteContent);
      elements.push(
        new Paragraph({
          children: quoteChildren,
          spacing: { after: 0 },
          indent: { left: 720 },
          border: {
            left: {
              color: 'auto',
              space: 1,
              style: BorderStyle.SINGLE,
              size: 6,
            },
          },
        })
      );
    } else if (trimmedLine === '---' || trimmedLine === '***') {
      // Handle horizontal rules
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
              color: 'e5e7eb',
            }),
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 0 },
        })
      );
    } else {
      // Regular paragraph with markdown formatting
      const children = parseInlineMarkdown(trimmedLine);
      
      // Check if this looks like a Bible verse reference (starts with book name and chapter:verse)
      const isBibleVerse = /^[А-Яа-я\w\s]+\s+\d+:\d+:/.test(trimmedLine);
      
      elements.push(
        new Paragraph({
          children,
          spacing: { after: 0 },
          alignment: AlignmentType.JUSTIFIED,
          // Add same left indent for Bible verses to align with list items
          indent: isBibleVerse ? { left: 720 } : undefined,
        })
      );
    }
    
    i++;
  }

  return elements;
};

export const parseTable = (tableLines: string[]): Table | null => {
  if (tableLines.length < 2) return null;
  
  // Parse table rows
  const rows = tableLines
    .filter(line => !line.trim().match(/^[\|\s\-:]*$/)) // Skip separator lines
    .map(line => {
      return line.split('|')
        .map(cell => cell.trim())
        .filter((cell, index, array) => index > 0 && index < array.length - 1); // Remove empty first/last cells
    })
    .filter(row => row.length > 0);
  
  if (rows.length === 0) return null;
  
  const tableRows = rows.map((row, rowIndex) => {
    const cells = row.map(cellText => {
      return new TableCell({
        children: [
          new Paragraph({
            children: parseInlineMarkdown(cellText),
                          spacing: { after: 0 },
          }),
        ],
        shading: rowIndex === 0 ? {
          type: ShadingType.SOLID,
          fill: 'f8f9fa',
        } : undefined,
        borders: {
          top: { style: BorderStyle.SINGLE, size: 1, color: 'd1d5db' },
          bottom: { style: BorderStyle.SINGLE, size: 1, color: 'd1d5db' },
          left: { style: BorderStyle.SINGLE, size: 1, color: 'd1d5db' },
          right: { style: BorderStyle.SINGLE, size: 1, color: 'd1d5db' },
        },
      });
    });
    
    return new TableRow({ children: cells });
  });
  
  return new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    margins: {
      top: 100,
      bottom: 100,
      left: 100,
      right: 100,
    },
  });
};

export const parseInlineMarkdown = (text: string): TextRun[] => {
  if (!text || text.trim() === '') {
    return [new TextRun('')];
  }

  const runs: TextRun[] = [];
  let currentIndex = 0;

  // Define patterns in order of priority (most specific first to avoid conflicts)
  const patterns = [
    { regex: /\*\*\*(.*?)\*\*\*/g, format: { bold: true, italics: true } },
    { regex: /\*\*(.*?)\*\*/g, format: { bold: true } },
    { regex: /__(.*?)__/g, format: { bold: true } },
    { regex: /~~(.*?)~~/g, format: { strike: true } },
    { regex: /`(.*?)`/g, format: { font: 'Courier New', shading: { type: ShadingType.SOLID, fill: 'f5f5f5' } } },
    { regex: /\^(.*?)\^/g, format: { superScript: true, size: 16 } },
    { regex: /~(.*?)~/g, format: { subScript: true, size: 16 } },
    { regex: /\*(.*?)\*/g, format: { italics: true } },
    { regex: /_(.*?)_/g, format: { italics: true } },
  ];

  // Find all matches across all patterns
  const allMatches: Array<{
    start: number;
    end: number;
    content: string;
    format: any;
  }> = [];

  for (const { regex, format } of patterns) {
    let match;
    // Reset regex lastIndex to ensure we start from the beginning
    regex.lastIndex = 0;
    
    while ((match = regex.exec(text)) !== null) {
      const start = match.index;
      const end = match.index + match[0].length;
      
      // Check if this match overlaps with any existing matches
      const hasOverlap = allMatches.some(existing => 
        (start < existing.end && end > existing.start)
      );
      
      // Only add if no overlap (first pattern wins)
      if (!hasOverlap) {
        allMatches.push({
          start,
          end,
          content: match[1],
          format
        });
      }
    }
  }

  // Sort matches by start position
  allMatches.sort((a, b) => a.start - b.start);

  // Build TextRuns
  for (const match of allMatches) {
    // Add unformatted text before this match
    if (match.start > currentIndex) {
      const beforeText = text.slice(currentIndex, match.start);
      if (beforeText) {
        runs.push(new TextRun(beforeText));
      }
    }

    // Add formatted text
    runs.push(new TextRun({
      text: match.content,
      ...match.format,
    }));

    currentIndex = match.end;
  }

  // Add any remaining unformatted text
  if (currentIndex < text.length) {
    const remainingText = text.slice(currentIndex);
    if (remainingText) {
      runs.push(new TextRun(remainingText));
    }
  }

  // If no runs were created, add the original text
  if (runs.length === 0) {
    runs.push(new TextRun(text));
  }

  return runs;
};

export const exportToWord = async (options: WordExportOptions): Promise<void> => {
  try {
    const { data, filename = 'sermon-plan.docx' } = options;
    
    // Add current date if not provided
    const exportDate = data.exportDate || new Date().toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Create document
    const doc = new Document({
      creator: 'My Preacher Helper',
      title: `План проповеди: ${data.sermonTitle}`,
      description: 'Автоматически сгенерированный план проповеди',
      styles: {
        paragraphStyles: [
          {
            id: 'customHeading1',
            name: 'Custom Heading 1',
            basedOn: 'Heading1',
            next: 'Normal',
            run: {
              size: 32,
              bold: true,
              color: '2563eb',
              font: 'Arial',
            },
            paragraph: {
              spacing: { before: 400, after: 200 },
              alignment: AlignmentType.CENTER,
            },
          },
          {
            id: 'customHeading2',
            name: 'Custom Heading 2',
            basedOn: 'Heading2',
            next: 'Normal',
            run: {
              size: 28,
              bold: true,
              color: '1e40af',
              font: 'Arial',
            },
            paragraph: {
              spacing: { before: 300, after: 200 },
              alignment: AlignmentType.CENTER,
            },
          },
          {
            id: 'sectionHeading',
            name: 'Section Heading',
            basedOn: 'Heading3',
            next: 'Normal',
            run: {
              size: 24,
              bold: true,
              font: 'Arial',
            },
            paragraph: {
              spacing: { before: 0, after: 0 },
              border: {
                bottom: {
                  color: 'auto',
                  space: 1,
                  style: BorderStyle.SINGLE,
                  size: 6,
                },
              },
            },
          },
        ],
      },
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 288,    // 0.2 inch (minimal)
                right: 288,  // 0.2 inch (minimal)
                bottom: 288, // 0.2 inch (minimal)
                left: 288,   // 0.2 inch (minimal)
              },
              size: {
                width: 15840,  // 11 inches (landscape)
                height: 12240, // 8.5 inches (landscape)
              },
            },
            column: {
              space: 300,    // 0.2 inch between columns
              count: 2,      // Two columns
              equalWidth: true,
            },
          },
          children: [
            // Sermon Title
            new Paragraph({
              children: [
                new TextRun({
                  text: data.sermonTitle,
                  bold: true,
                  size: 28,
                  color: '2563eb',
                  font: 'Arial',
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { after: 0 },
            }),

            // Scripture Verse (if provided)
            ...(data.sermonVerse ? [
              new Paragraph({
                children: [
                  new TextRun({
                    text: data.sermonVerse,
                    italics: true,
                    size: 22,
                    color: '6b7280',
                    font: 'Arial',
                  }),
                ],
                alignment: AlignmentType.CENTER,
                spacing: { after: 0 },
              }),
            ] : []),

            // Introduction Section
            new Paragraph({
              children: [
                new TextRun({
                  text: 'ВСТУПЛЕНИЕ',
                  bold: true,
                  size: 28,
                  color: '2563eb',
                  font: 'Arial',
                }),
              ],
              alignment: AlignmentType.CENTER,
              style: 'sectionHeading',
              spacing: { before: 0, after: 0 },
            }),

            ...parseMarkdownToParagraphs(data.introduction, '2563eb'),

            // Main Section
            new Paragraph({
              children: [
                new TextRun({
                  text: 'ОСНОВНАЯ ЧАСТЬ',
                  bold: true,
                  size: 28,
                  color: '7c3aed',
                  font: 'Arial',
                }),
              ],
              alignment: AlignmentType.CENTER,
              style: 'sectionHeading',
              spacing: { before: 0, after: 0 },
            }),

            ...parseMarkdownToParagraphs(data.main, '7c3aed'),

            // Conclusion Section
            new Paragraph({
              children: [
                new TextRun({
                  text: 'ЗАКЛЮЧЕНИЕ',
                  bold: true,
                  size: 28,
                  color: '059669',
                  font: 'Arial',
                }),
              ],
              alignment: AlignmentType.CENTER,
              style: 'sectionHeading',
              spacing: { before: 0, after: 0 },
            }),

            ...parseMarkdownToParagraphs(data.conclusion, '059669')
          ],
        },
      ],
    });

    // Generate buffer
    const buffer = await Packer.toBuffer(doc);
    
    // Create blob and download
    const blob = new Blob([buffer], { 
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    
    // Generate filename with timestamp if default
    const finalFilename = filename === 'sermon-plan.docx' 
      ? `план-проповеди-${data.sermonTitle.replace(/[^a-zA-Zа-яА-Я0-9]/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.docx`
      : filename;
    
    saveAs(blob, finalFilename);
    
  } catch (error) {
    console.error('Error exporting to Word:', error);
    throw new Error('Failed to export to Word document');
  }
};

export type { PlanData, WordExportOptions }; 
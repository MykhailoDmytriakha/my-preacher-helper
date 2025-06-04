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

const parseMarkdownToParagraphs = (content: string, sectionColor?: string): (Paragraph | Table)[] => {
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
          spacing: { before: 200, after: 100 },
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
          spacing: { before: 250, after: 100 },
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
          spacing: { before: 300, after: 100 },
        })
      );
    } else if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
      // Handle bullet points
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `• ${trimmedLine.replace(/^[-*] /, '')}`,
            }),
          ],
          spacing: { after: 80 },
          indent: { left: 720 },
        })
      );
    } else if (trimmedLine.match(/^\d+\. /)) {
      // Handle numbered lists
      const number = trimmedLine.match(/^(\d+)\. (.*)$/);
      if (number) {
        elements.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `${number[1]}. ${number[2]}`,
              }),
            ],
            spacing: { after: 80 },
            indent: { left: 720 },
          })
        );
      }
    } else if (trimmedLine.startsWith('> ')) {
      // Handle blockquotes
      elements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: trimmedLine.replace('> ', ''),
              italics: true,
              color: '4a5568',
            }),
          ],
          spacing: { after: 120 },
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
          spacing: { before: 150, after: 150 },
        })
      );
    } else {
      // Regular paragraph with markdown formatting
      const children = parseInlineMarkdown(trimmedLine);
      elements.push(
        new Paragraph({
          children,
          spacing: { after: 100 },
          alignment: AlignmentType.JUSTIFIED,
        })
      );
    }
    
    i++;
  }

  return elements;
};

const parseTable = (tableLines: string[]): Table | null => {
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
            spacing: { after: 50 },
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
      top: 200,
      bottom: 200,
      left: 200,
      right: 200,
    },
  });
};

const parseInlineMarkdown = (text: string): TextRun[] => {
  const runs: TextRun[] = [];
  let currentIndex = 0;
  
  // Enhanced markdown parsing patterns
  const patterns = [
    { regex: /\*\*\*(.*?)\*\*\*/g, format: { bold: true, italics: true } },
    { regex: /\*\*(.*?)\*\*/g, format: { bold: true } },
    { regex: /\*(.*?)\*/g, format: { italics: true } },
    { regex: /_(.*?)_/g, format: { italics: true } },
    { regex: /~~(.*?)~~/g, format: { strike: true } },
    { regex: /`(.*?)`/g, format: { font: 'Courier New', shading: { type: ShadingType.SOLID, fill: 'f5f5f5' } } },
    { regex: /\^(.*?)\^/g, format: { superScript: true, size: 16 } },
    { regex: /~(.*?)~/g, format: { subScript: true, size: 16 } },
  ];

  const matches: Array<{ start: number; end: number; text: string; format: any }> = [];

  patterns.forEach(pattern => {
    let match;
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[1],
        format: pattern.format,
      });
    }
  });

  // Sort matches by start position
  matches.sort((a, b) => a.start - b.start);

  // Process non-overlapping matches
  const processedMatches: typeof matches = [];
  matches.forEach(match => {
    const hasOverlap = processedMatches.some(processed => 
      (match.start < processed.end && match.end > processed.start)
    );
    if (!hasOverlap) {
      processedMatches.push(match);
    }
  });

  // Build text runs
  processedMatches.forEach(match => {
    // Add text before match
    if (match.start > currentIndex) {
      const beforeText = text.slice(currentIndex, match.start);
      if (beforeText) {
        runs.push(new TextRun(beforeText));
      }
    }
    
    // Add formatted text
    runs.push(new TextRun({
      text: match.text,
      ...match.format,
    }));
    
    currentIndex = match.end;
  });

  // Add remaining text
  if (currentIndex < text.length) {
    const remainingText = text.slice(currentIndex);
    if (remainingText) {
      runs.push(new TextRun(remainingText));
    }
  }

  // If no formatting was found, return simple text
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
              spacing: { before: 400, after: 200 },
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
          children: [
            // Title
            new Paragraph({
              children: [
                new TextRun({
                  text: 'ПЛАН ПРОПОВЕДИ',
                  bold: true,
                  size: 36,
                  color: '1e40af',
                  font: 'Arial',
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { after: 200 },
            }),

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
              spacing: { after: 150 },
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
                spacing: { after: 150 },
              }),
            ] : []),

            // Date
            new Paragraph({
              children: [
                new TextRun({
                  text: `Дата: ${exportDate}`,
                  size: 20,
                  color: '6b7280',
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { after: 250 },
            }),

            // Decorative line
            new Paragraph({
              children: [
                new TextRun({
                  text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                  color: 'e5e7eb',
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { after: 250 },
            }),

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
              spacing: { before: 300, after: 200 },
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
              spacing: { before: 300, after: 200 },
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
              spacing: { before: 300, after: 200 },
            }),

            ...parseMarkdownToParagraphs(data.conclusion, '059669'),

            // Footer
            new Paragraph({
              children: [
                new TextRun({
                  text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
                  color: 'e5e7eb',
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { before: 300, after: 150 },
            }),

            new Paragraph({
              children: [
                new TextRun({
                  text: 'Сгенерировано с помощью My Preacher Helper',
                  size: 18,
                  color: '9ca3af',
                  italics: true,
                  font: 'Arial',
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { after: 100 },
            }),
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
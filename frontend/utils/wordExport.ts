import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, ShadingType, TableRow, Table, TableCell, WidthType, PageBreak, ColumnBreak, type IRunOptions } from 'docx';
import { saveAs } from 'file-saver';

import { PlanData } from '@/models/models';
import { markdownCodeRanges, withoutMarkdownCode, type MarkdownCodeRange } from '@/utils/markdownCode';
import { readMarkdownHtml } from '@/utils/markdownHtml';
import { splitMarkdownSections, type MarkdownSection } from '@/utils/markdownSections';
import { decodeBasicHtmlEntities } from '@/utils/markdownUtils';
import { planBodyIndent, planHeadingIndent, preparePlanMarkdown } from '@/utils/planHierarchy';
import { getSectionBaseColor } from '@lib/sections';
import i18n from '@locales/i18n';

import type { Root, RootContent } from 'hast';

interface WordExportOptions {
  data: PlanData;
  filename?: string;
  focusedSection?: string;
}

const interpolate = (value: string, options?: Record<string, unknown>): string => {
  if (!options) return value;
  return value.replace(/\{\{(\w+)\}\}/g, (_match, optionKey) => {
    const replacement = options[optionKey];
    return replacement === undefined || replacement === null ? '' : String(replacement);
  });
};

const t = (key: string, defaultValue: string, options?: Record<string, unknown>) => {
  const result = i18n.t(key, { defaultValue, ...(options ?? {}) });
  const resolved = result === key ? defaultValue : result;
  return interpolate(resolved, options);
};

// Pick straight from docx's run options so the formats we collect are guaranteed to be
// assignable to TextRun (e.g. `highlight` is a fixed colour union, not an arbitrary string).
type TextRunFormat = Partial<
  Pick<IRunOptions, 'color' | 'bold' | 'italics' | 'strike' | 'font' | 'superScript' | 'subScript' | 'size' | 'underline' | 'highlight'>
>;

const WORD_CODE_FONT = 'Courier New';

// Read the original heading, preserving code and link labels before Word styling.
const createHeadingParagraph = (markdown: string, level: number, sectionColor?: string): Paragraph => {
  const format: TextRunFormat = {
    bold: true, color: sectionColor || '374151', font: 'Arial',
    size: level === 1 ? 24 : level === 2 ? 22 : 20,
    ...(level === 2 ? { underline: {} } : {}),
  };
  const render = (node: Root | RootContent, inCode = false): TextRun[] => {
    if (node.type === 'text') return [new TextRun({
      ...format, text: node.value, ...(inCode ? { font: WORD_CODE_FONT } : {}),
    })];
    const literal = inCode || (node.type === 'element' && node.tagName === 'code');
    return 'children' in node ? node.children.flatMap(child => render(child, literal)) : [];
  };
  return new Paragraph({
    children: render(readMarkdownHtml(markdown)),
    spacing: { before: 0, after: 0 },
    heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
    ...(level >= 3 ? { indent: { left: planHeadingIndent(level) * 360 } } : {}),
  });
};

// Helper function to parse bullet points
const parseBulletPoint = (trimmedLine: string, indent: number): Paragraph => {
  const bulletContent = trimmedLine.replace(/^[-*] /, '');
  const bulletChildren = parseInlineMarkdown(bulletContent);
  return new Paragraph({
    children: [
      new TextRun({ text: '• ' }),
      ...bulletChildren,
    ],
    spacing: { after: 0 },
    indent: { left: indent },
  });
};

// Helper function to parse numbered lists
const parseNumberedList = (trimmedLine: string, indent: number): Paragraph => {
  const number = trimmedLine.match(/^(\d+)\. (.*)$/);
  if (!number) throw new Error('Invalid numbered list format');

  const listContent = number[2];
  const listChildren = parseInlineMarkdown(listContent);
  return new Paragraph({
    children: [
      new TextRun({ text: `${number[1]}. ` }),
      ...listChildren,
    ],
    spacing: { after: 0 },
    indent: { left: indent },
  });
};

const quoteBorder = {
  left: { color: 'auto', space: 1, style: BorderStyle.SINGLE, size: 6 },
} as const;

// Helper function to parse blockquotes
const parseBlockquote = (trimmedLine: string, indent: number): Paragraph => {
  const quoteContent = trimmedLine.replace('> ', '');
  const quoteChildren = parseInlineMarkdown(quoteContent);
  return new Paragraph({
    children: quoteChildren,
    spacing: { after: 0 },
    indent: { left: indent },
    border: quoteBorder,
  });
};

// Helper function to parse horizontal rules
const parseHorizontalRule = (): Paragraph => {
  return new Paragraph({
    children: [
      new TextRun({
        text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        color: 'e5e7eb',
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
  });
};

// Helper function to parse regular paragraphs
const parseRegularParagraph = (trimmedLine: string, indent?: number): Paragraph => {
  const children = parseInlineMarkdown(trimmedLine);

  // Check if this looks like a Bible-verse ref line so it can be indented to align with
  // the cues it sits under. Refs render as "*Руф. 1:21: ...*", so strip leading emphasis
  // markers first; the old regex required no markers AND no "." in the book name, so it
  // never matched abbreviated, italic-wrapped refs.
  const refStart = trimmedLine.replace(/^[*_]+\s*/, "");
  const isBibleVerse = /^[А-Яа-яЁёA-Za-z0-9.\s]+\d+:\d+/.test(refStart);

  return new Paragraph({
    children,
    spacing: { after: 0 },
    alignment: AlignmentType.JUSTIFIED,
    // Indent verse refs to align with the bulleted cues of their sub-point.
    indent: indent !== undefined ? { left: indent } : isBibleVerse ? { left: 720 } : undefined,
  });
};

// Helper function to collect and parse table lines
const parseTableLines = (lines: string[], startIndex: number, indent: number): { table: Table | null; newIndex: number } => {
  const tableLines = [];
  let j = startIndex;

  // Collect all table lines
  while (j < lines.length && lines[j].trim().includes('|')) {
    tableLines.push(lines[j]);
    j++;
  }

  const table = tableLines.length > 0 ? parseTable(tableLines, indent) : null;
  return { table, newIndex: j };
};

/** Split prose lines without splitting a real multiline code span or its literal <br>. */
const wordProseLines = (content: string): string[] => {
  const code = markdownCodeRanges(content).filter(range => range.kind === 'inline');
  const lines: string[] = [];
  let cursor = 0;
  let codeIndex = 0;
  for (const match of content.matchAll(/<br\s*\/?>|\r\n|\r|\n/gi)) {
    const at = match.index!;
    while (codeIndex < code.length && code[codeIndex].end <= at) codeIndex++;
    if (code[codeIndex] && code[codeIndex].start <= at && at < code[codeIndex].end) continue;
    lines.push(content.slice(cursor, at));
    cursor = at + match[0].length;
  }
  lines.push(content.slice(cursor));
  return lines.filter(line => line.trim() !== '');
};

const parseMarkdownProse = (content: string, bodyIndent?: number): (Paragraph | Table)[] => {
  if (!content || content.trim() === '') {
    const placeholderText = t('export.planEmptyContent', 'Content will be added later...');
    return [
      new Paragraph({
        children: [
          new TextRun({
            text: placeholderText,
            italics: true,
            color: '666666',
          }),
        ],
        spacing: { after: 100 },
      }),
    ];
  }

  const lines = wordProseLines(content);
  const elements: (Paragraph | Table)[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmedLine = lines[i].trim();

    const listIndent = (bodyIndent ?? 360) + 360 + Math.floor((lines[i].length - lines[i].trimStart().length) / 2) * 360;

    // Check for table
    if (trimmedLine.includes('|')) {
      const { table, newIndex } = parseTableLines(lines, i, bodyIndent ?? 0);
      if (table) {
        elements.push(table);
        i = newIndex;
        continue;
      }
    }

    // Handle different markdown elements using helper functions
    try {
      if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
        elements.push(parseBulletPoint(trimmedLine, listIndent));
      } else if (trimmedLine.match(/^\d+\. /)) {
        elements.push(parseNumberedList(trimmedLine, listIndent));
      } else if (trimmedLine.startsWith('> ')) {
        elements.push(parseBlockquote(trimmedLine, bodyIndent ?? 720));
      } else if (trimmedLine === '---' || trimmedLine === '***') {
        elements.push(parseHorizontalRule());
      } else {
        elements.push(parseRegularParagraph(trimmedLine, bodyIndent));
      }
    } catch {
      // Fallback to regular paragraph if parsing fails
      elements.push(parseRegularParagraph(trimmedLine, bodyIndent));
    }

    i++;
  }

  return elements;
};

const literalCodeParagraphs = (code: MarkdownCodeRange, source: string, bodyIndent?: number): Paragraph[] => {
  let left = bodyIndent ?? 0;
  if (code.listDepth) left = (bodyIndent ?? 360) + code.listDepth * 360;
  if (code.quoteDepth) left = Math.max(left, bodyIndent ?? 720) + (code.quoteDepth - 1) * 360;
  // A block beginning on the marker line still owns that visible list marker.
  const marker = code.listDepth ? source.slice(code.blockStart, code.start).match(/([-*+]|\d+[.)])[ \t]+$/)?.[1] : undefined;
  const prefix = marker ? (/^\d/.test(marker) ? marker + ' ' : '• ') : '';
  return code.value.split(/\r\n|\r|\n/).map((line, index) => new Paragraph({
    children: [
      ...(index === 0 && prefix ? [new TextRun({ text: prefix })] : []),
      new TextRun({ text: line, font: WORD_CODE_FONT }),
    ],
    spacing: { after: 0 }, alignment: AlignmentType.LEFT, indent: { left },
    ...(code.quoteDepth ? { border: quoteBorder } : {}),
  }));
};

const parseMarkdownBody = (content: string, bodyIndent?: number): (Paragraph | Table)[] => {
  const code = markdownCodeRanges(content).filter(range => range.kind === 'block');
  if (!code.length) return parseMarkdownProse(content, bodyIndent);
  const elements: (Paragraph | Table)[] = [];
  let cursor = 0;
  for (const block of code) {
    const prose = content.slice(cursor, block.blockStart);
    if (prose.trim()) elements.push(...parseMarkdownProse(prose, bodyIndent));
    elements.push(...literalCodeParagraphs(block, content, bodyIndent));
    cursor = block.end;
  }
  const tail = content.slice(cursor);
  if (tail.trim()) elements.push(...parseMarkdownProse(tail, bodyIndent));
  return elements;
};

export const parseMarkdownToParagraphs = (content: string, sectionColor?: string): (Paragraph | Table)[] => {
  const outline = splitMarkdownSections(preparePlanMarkdown(content), { preserveBodyWhitespace: true });
  if (!outline.sections.length) return parseMarkdownBody(outline.intro);
  const renderSection = (section: MarkdownSection): (Paragraph | Table)[] => [
    createHeadingParagraph(section.headingMarkdown.replace(/^#{1,6}\s+/, ''), section.level, sectionColor),
    ...(section.body ? parseMarkdownBody(section.body, planBodyIndent(section.level) * 360) : []),
    ...section.children.flatMap(renderSection),
  ];
  return [
    ...(outline.intro ? parseMarkdownBody(outline.intro) : []),
    ...outline.sections.flatMap(renderSection),
  ];
};

export const parseTable = (tableLines: string[], indent = 0): Table | null => {
  if (tableLines.length < 2) return null;

  // Parse table rows
  const rows = tableLines
    .filter(line => !line.trim().match(/^[\|\s\-:]*$/)) // Skip separator lines
    .map(line => {
      return line.split('|')
        .map(cell => cell.trim())
        .filter((_, index, array) => index > 0 && index < array.length - 1); // Remove empty first/last cells
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
    indent: { size: indent, type: WidthType.DXA },
    width: { size: 100, type: WidthType.PERCENTAGE },
    margins: {
      top: 100,
      bottom: 100,
      left: 100,
      right: 100,
    },
  });
};

// Inline formatting patterns. HTML tags come first so the Word export honors the SAME
// inline formatting the plan UI renders (MarkdownDisplay uses rehype-raw + a sanitize
// schema allowing b/i/em/strong/sub/sup/u/mark/del/code). Without this, "<u>...</u>" and
// friends leak into the document as literal text.
const INLINE_PATTERNS: Array<{ regex: RegExp; format: TextRunFormat }> = [
  { regex: /<(?:b|strong)>([\s\S]*?)<\/(?:b|strong)>/gi, format: { bold: true } },
  { regex: /<(?:i|em)>([\s\S]*?)<\/(?:i|em)>/gi, format: { italics: true } },
  { regex: /<u>([\s\S]*?)<\/u>/gi, format: { underline: {} } },
  { regex: /<(?:s|del|strike)>([\s\S]*?)<\/(?:s|del|strike)>/gi, format: { strike: true } },
  { regex: /<sup>([\s\S]*?)<\/sup>/gi, format: { superScript: true, size: 16 } },
  { regex: /<sub>([\s\S]*?)<\/sub>/gi, format: { subScript: true, size: 16 } },
  { regex: /<mark>([\s\S]*?)<\/mark>/gi, format: { highlight: 'yellow' } },
  { regex: /<code>([\s\S]*?)<\/code>/gi, format: { font: WORD_CODE_FONT } },
  // Markdown emphasis, most specific first.
  { regex: /\*\*\*(.*?)\*\*\*/g, format: { bold: true, italics: true } },
  { regex: /\*\*(.*?)\*\*/g, format: { bold: true } },
  { regex: /__(.*?)__/g, format: { bold: true } },
  { regex: /~~(.*?)~~/g, format: { strike: true } },
  { regex: /\^(.*?)\^/g, format: { superScript: true, size: 16 } },
  { regex: /~(.*?)~/g, format: { subScript: true, size: 16 } },
  { regex: /\*(.*?)\*/g, format: { italics: true } },
  { regex: /_(.*?)_/g, format: { italics: true } },
];

// Remove any inline HTML tag we don't explicitly format (e.g. <a>, <span>) so it never
// leaks as literal text. Requires a letter after "<" so "5 < 10" / "a > b" are untouched.
const stripStrayTags = (s: string): string => s.replace(/<\/?[a-zA-Z][^>]*>/g, '');

// Recursive so nested formatting works: "**<u>X</u>**" -> bold + underline. Each matched
// span inherits the outer format and re-parses its inner content; plain text gets the
// inherited format with stray tags removed.
const parseInlineInherited = (text: string, inherited: TextRunFormat): TextRun[] => {
  // Recompute inside every recursive call: outer prose marks may contain literal code.
  const candidates: Array<{ start: number; end: number; content: string; format: TextRunFormat; literal?: boolean }> =
    markdownCodeRanges(text).filter(range => range.kind === 'inline').map(range => ({
      start: range.start, end: range.end, content: range.value,
      format: { font: WORD_CODE_FONT }, literal: true,
    }));
  const masked = withoutMarkdownCode(text, true).replace(/[\r\n]/g, ' ');
  for (const { regex, format } of INLINE_PATTERNS) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(masked)) !== null) {
      const prefix = match[0].startsWith('<') ? match[0].indexOf('>') + 1 : (match[0].length - match[1].length) / 2;
      const captured = text.slice(match.index + prefix, match.index + prefix + match[1].length);
      candidates.push({ start: match.index, end: match.index + match[0].length, content: captured, format });
      if (match.index === regex.lastIndex) regex.lastIndex++; // guard zero-length matches
    }
  }
  // Prefer the outermost/leftmost span: earliest start, then longest.
  candidates.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  const runs: TextRun[] = [];
  const pushPlain = (raw: string) => {
    // Decode after stripping actual tags: escaped tags are authored text, not markup.
    const clean = inherited.font === WORD_CODE_FONT ? stripStrayTags(raw) : decodeBasicHtmlEntities(stripStrayTags(raw));
    if (clean) runs.push(new TextRun({ text: clean, ...inherited }));
  };

  let cursor = 0;
  for (const c of candidates) {
    if (c.start < cursor) continue; // overlaps an already-chosen span
    if (c.start > cursor) pushPlain(text.slice(cursor, c.start));
    if (c.literal) runs.push(new TextRun({ text: c.content, ...inherited, ...c.format }));
    else runs.push(...parseInlineInherited(c.content, { ...inherited, ...c.format }));
    cursor = c.end;
  }
  if (cursor < text.length) pushPlain(text.slice(cursor));

  return runs;
};

export const parseInlineMarkdown = (text: string): TextRun[] => {
  if (!text || text.trim() === '') {
    return [new TextRun('')];
  }
  const runs = parseInlineInherited(text, {});
  return runs.length > 0 ? runs : [new TextRun('')];
};

export const exportToWord = async (options: WordExportOptions): Promise<void> => {
  try {
    const { data, filename = 'sermon-plan.docx', focusedSection } = options;

    const planDocTitle = t('export.planDocTitle', 'Sermon Plan: {{title}}', { title: data.sermonTitle });
    const planDocDescription = t('export.planDocDescription', 'Auto-generated sermon plan');
    const planFilenamePrefix = t('export.planFilenamePrefix', 'sermon-plan');
    const sectionIntroLabel = t('sections.introduction', 'Introduction').toUpperCase();
    const sectionMainLabel = t('sections.main', 'Main Part').toUpperCase();
    const sectionConclusionLabel = t('sections.conclusion', 'Conclusion').toUpperCase();
    // Resolve canonical section colors (strip leading '#')
    const introHex = getSectionBaseColor('introduction').replace('#', '');
    const mainHex = getSectionBaseColor('main').replace('#', '');
    const conclHex = getSectionBaseColor('conclusion').replace('#', '');

    // Create document
    const doc = new Document({
      creator: 'My Preacher Helper',
      title: planDocTitle,
      description: planDocDescription,
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
            // Render different layout based on whether it's a full export (booklet) or focused
            ...(focusedSection ? [
              // Single Section Layout (Linear)
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
                spacing: { after: 200 },
              }),

              ...(data.sermonVerse ? [
                new Paragraph({
                  children: data.sermonVerse
                    .split('\n')
                    .filter(line => line.trim() !== '')
                    .map((verse, index) =>
                      new TextRun({
                        text: verse.trim(),
                        italics: true,
                        size: 18, // 9pt
                        color: '6b7280',
                        font: 'Arial',
                        break: index > 0 ? 1 : 0,
                      })
                    ),
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 400 },
                }),
              ] : []),

              ...(focusedSection === 'introduction' ? [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: sectionIntroLabel,
                      bold: true,
                      size: 28,
                      color: introHex,
                      font: 'Arial',
                    }),
                  ],
                  alignment: AlignmentType.CENTER,
                  style: 'sectionHeading',
                  spacing: { before: 200, after: 200 },
                }),
                ...parseMarkdownToParagraphs(data.introduction, introHex),
              ] : []),

              ...((focusedSection === 'main' || focusedSection === 'mainPart') ? [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: sectionMainLabel,
                      bold: true,
                      size: 28,
                      color: mainHex,
                      font: 'Arial',
                    }),
                  ],
                  alignment: AlignmentType.CENTER,
                  style: 'sectionHeading',
                  spacing: { before: 200, after: 200 },
                }),
                ...parseMarkdownToParagraphs(data.main, mainHex),
              ] : []),

              ...(focusedSection === 'conclusion' ? [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: sectionConclusionLabel,
                      bold: true,
                      size: 28,
                      color: conclHex,
                      font: 'Arial',
                    }),
                  ],
                  alignment: AlignmentType.CENTER,
                  style: 'sectionHeading',
                  spacing: { before: 200, after: 200 },
                }),
                ...parseMarkdownToParagraphs(data.conclusion, conclHex),
              ] : []),

            ] : [
              // Full Export Layout (Booklet format)

              // Page 1, Left Column (Back Cover): Conclusion
              new Paragraph({
                children: [
                  new TextRun({
                    text: sectionConclusionLabel,
                    bold: true,
                    size: 28,
                    color: conclHex,
                    font: 'Arial',
                  }),
                ],
                alignment: AlignmentType.CENTER,
                style: 'sectionHeading',
                spacing: { before: 200, after: 200 },
              }),
              ...parseMarkdownToParagraphs(data.conclusion, conclHex),

              // Break to Right Column (Front Cover)
              new Paragraph({
                children: [new ColumnBreak()],
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
                spacing: { after: 200 },
              }),

              // Scripture Verse (if provided)
              ...(data.sermonVerse ? [
                new Paragraph({
                  children: data.sermonVerse
                    .split('\n')
                    .filter(line => line.trim() !== '')
                    .map((verse, index) =>
                      new TextRun({
                        text: verse.trim(),
                        italics: true,
                        size: 18, // 9pt
                        color: '6b7280',
                        font: 'Arial',
                        break: index > 0 ? 1 : 0,
                      })
                    ),
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 400 },
                }),
              ] : []),

              // Introduction Section
              new Paragraph({
                children: [
                  new TextRun({
                    text: sectionIntroLabel,
                    bold: true,
                    size: 28,
                    color: introHex,
                    font: 'Arial',
                  }),
                ],
                alignment: AlignmentType.CENTER,
                style: 'sectionHeading',
                spacing: { before: 200, after: 200 },
              }),
              ...parseMarkdownToParagraphs(data.introduction, introHex),

              // Break to Next Page (Inner Spread)
              new Paragraph({
                children: [new PageBreak()],
              }),

              // Main Section
              new Paragraph({
                children: [
                  new TextRun({
                    text: sectionMainLabel,
                    bold: true,
                    size: 28,
                    color: mainHex,
                    font: 'Arial',
                  }),
                ],
                alignment: AlignmentType.CENTER,
                style: 'sectionHeading',
                spacing: { before: 200, after: 200 },
              }),
              ...parseMarkdownToParagraphs(data.main, mainHex),
            ]),
          ],
        },
      ],
    });

    // Generate buffer
    const buffer = await Packer.toBuffer(doc);

    // Create blob and download
    const blob = new Blob([buffer as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });

    // Generate filename with timestamp if default
    const finalFilename = filename === 'sermon-plan.docx'
      ? `${planFilenamePrefix}-${data.sermonTitle.replace(/[^a-zA-Zа-яА-Я0-9]/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.docx`
      : filename;

    saveAs(blob, finalFilename);

  } catch (error) {
    console.error('Error exporting to Word:', error);
    throw new Error('Failed to export to Word document');
  }
};

export type { PlanData, WordExportOptions }; 

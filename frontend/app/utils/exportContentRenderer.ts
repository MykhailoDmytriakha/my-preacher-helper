import { planMarkdownToPlainText } from '@/utils/planHierarchy';
import { buildSubPointRenderableEntries } from '@/utils/subPoints';

import type { Sermon, Thought } from '@/models/models';
import type { ExportBlock, ExportSection } from '@/utils/exportContentModel';

export type ExportFormat = 'plain' | 'markdown';
export interface ExportTextOptions { format: ExportFormat; includeMetadata: boolean; includeTags: boolean }
export interface ExportLabels {
  sermonTitle: string;
  scriptureText: string;
  tagsLabel: string;
  multipleTagsThoughts: string;
  unassignedThoughts: string;
  noEntries: string;
  introduction: string;
  main: string;
  conclusion: string;
  ambiguous: string;
}

function renderHeader(sermon: Sermon, { format, includeMetadata }: ExportTextOptions, labels: ExportLabels): string {
  if (!includeMetadata) return '';
  const markdown = format === 'markdown';
  let header = markdown ? `# ${labels.sermonTitle}${sermon.title}\n\n` : `${labels.sermonTitle}${sermon.title}\n`;
  if (sermon.verse?.trim()) {
    const verse = markdown
      ? sermon.verse.trim().split('\n').filter(line => line.trim()).map(line => `> ${line.trim()}`).join('\n> \n')
      : sermon.verse;
    header += markdown ? `**${labels.scriptureText.trim()}**\n${verse}\n\n` : `${labels.scriptureText.trim()}\n${verse}\n`;
  }
  return markdown ? header : `${header}\n`;
}

function renderThought(thought: Thought, prefix: string, indent: string, options: ExportTextOptions, labels: ExportLabels): string {
  let text = String(thought.text ?? '').split('\n')
    .map((line, index) => index === 0 ? `${prefix}${line}` : line.trim() ? `${indent}${line}` : '')
    .join('\n') + '\n';
  if (options.includeTags && thought.tags?.length) {
    const tags = `${labels.tagsLabel}${thought.tags.join(', ')}`;
    text += options.format === 'markdown' ? `${indent}*${tags}*\n` : `${indent}${tags}\n`;
  }
  return text;
}

function renderOutline(block: Extract<ExportBlock, { type: 'outline' }>, number: number, options: ExportTextOptions, labels: ExportLabels): string {
  const style = options.format === 'markdown'
    ? { heading: `### ${number}. ${block.title}\n\n`, subHeading: `#### ${number}.`, subEnd: '\n\n', bullet: '- ', indent: '  ', subBullet: '- ', subIndent: '  ', afterSub: '\n' }
    : { heading: `${number}. ${block.title}\n`, subHeading: `   ${number}.`, subEnd: '\n', bullet: '   - ', indent: '     ', subBullet: '       - ', subIndent: '         ', afterSub: '' };
  let content = style.heading;
  let subNumber = 0;
  for (const entry of buildSubPointRenderableEntries(block.thoughts, block.subPoints)) {
    if (entry.type === 'subPoint') {
      content += `${style.subHeading}${++subNumber} ${entry.subPoint.text}${style.subEnd}`;
      for (const thought of entry.items) content += renderThought(thought, style.subBullet, style.subIndent, options, labels);
      content += style.afterSub;
    } else content += renderThought(entry.item, style.bullet, style.indent, options, labels);
  }
  return `${content}\n`;
}

function renderLoose(block: Extract<ExportBlock, { type: 'loose' }>, sectionTitle: string, firstNumber: number, options: ExportTextOptions, labels: ExportLabels): string {
  const markdown = options.format === 'markdown';
  const title = block.label ? labels[block.label] : sectionTitle;
  let content = '';
  if (title && title !== sectionTitle) content += markdown ? `### ${title}\n\n` : `${title}:\n`;
  if (!block.thoughts.length) content += markdown ? `_${labels.noEntries}_\n` : `${labels.noEntries}\n`;
  block.thoughts.forEach((thought, index) => {
    const prefix = `${firstNumber + index}. `;
    content += renderThought(thought, prefix, markdown ? '   ' : ' '.repeat(prefix.length), options, labels);
  });
  return `${content}\n`;
}

/** Literal N/N.M headings preserve the hierarchy; continuation lines stay with their thought. */
export function renderThoughtExport(sermon: Sermon, sections: ExportSection[], options: ExportTextOptions, labels: ExportLabels): string {
  let content = renderHeader(sermon, options, labels);
  let pointNumber = 0;
  for (const section of sections) {
    const title = labels[section.key];
    content += options.format === 'markdown' ? `## ${title}\n\n` : `${title}:\n\n`;
    for (const block of section.blocks) {
      if (block.type === 'outline') content += renderOutline(block, ++pointNumber, options, labels);
      else {
        content += renderLoose(block, title, pointNumber + 1, options, labels);
        pointNumber += block.thoughts.length;
      }
    }
  }
  return content;
}

/** Saved plan takes precedence over the legacy draft; author markdown remains intact in MD. */
export function renderPlanExport(sermon: Sermon, options: ExportTextOptions, labels: ExportLabels): string {
  const plan = sermon.plan || sermon.draft;
  if (!plan) return '';
  const markdown = options.format === 'markdown';
  let content = renderHeader(sermon, options, labels);
  for (const key of ['introduction', 'main', 'conclusion'] as const) {
    const outline = plan[key]?.outline;
    if (!outline?.trim()) continue;
    content += markdown ? `## ${labels[key]}\n\n${outline}\n\n---\n\n` : `${labels[key]}:\n\n${planMarkdownToPlainText(outline)}\n\n---------------------\n\n`;
  }
  return content;
}

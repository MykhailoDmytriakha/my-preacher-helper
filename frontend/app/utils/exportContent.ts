import {
  getVisualOrderedThoughtsBySection,
  getVisualSectionOutlinePoints,
  normalizeVisualSectionKey,
  VISUAL_SECTION_ORDER,
  type VisualSectionKey,
} from "@/utils/sermonVisualOrder";
import { buildSubPointRenderableEntries } from "@/utils/subPoints";
import { normalizeStructureTag, isStructureTag } from "@/utils/tagUtils";
import { i18n } from '@locales/i18n';

import type { Sermon, ThoughtsBySection, Thought, SermonPoint, SubPoint } from "@/models/models";

// Debug flag
const DEBUG_EXPORT = false;
const debugLog = (message: string, data?: unknown) => { if (DEBUG_EXPORT) console.log(`[Export] ${message}`, data ? data : ''); };

// --- Data Structures for Organized Content ---

interface OrganizedBlock {
  type: 'outline' | 'structure' | 'tag' | 'chronological' | 'unassigned';
  title: string;
  thoughts: Thought[];
  outlineId?: string;
  subPoints?: SubPoint[];
}

interface ProcessedSection {
  sectionTitle: string;
  sectionKey: string;
  organizedBlocks: OrganizedBlock[];
}

// ThoughtsBySection to hold all organized data before formatting
interface ExportData {
  sermon: Sermon; // Keep original sermon for header info
  processedSections: ProcessedSection[];
}

// --- Export Options ---

type ExportFormat = 'plain' | 'markdown';

interface ExportOptions {
  type?: 'thoughts' | 'plan';
  format?: ExportFormat;
  includeTags?: boolean;
  includeMetadata?: boolean;
}

// --- Translation Keys ---
const TRANSLATIONS = {
  multipleTagsThoughts: i18n.t('export.multipleTagsThoughts', 'Thoughts with Multiple Tags'),
  unassignedThoughts: i18n.t('export.unassignedThoughts', 'Unassigned Thoughts'),
  thoughts: i18n.t('export.thoughts', 'Thoughts'),
  noEntries: i18n.t('export.noEntries', 'No entries'),
  sermonTitle: i18n.t('export.sermonTitle', 'Sermon: '),
  scriptureText: i18n.t('export.scriptureText', 'Scripture Text: '),
  tagsLabel: i18n.t('export.tagsLabel', 'Tags: '),
  // Section titles
  introTitle: i18n.t('tags.introduction', 'Introduction'),
  mainTitle: i18n.t('tags.mainPart', 'Main Part'),
  conclusionTitle: i18n.t('tags.conclusion', 'Conclusion'),
  otherTitle: i18n.t('export.otherThoughts', 'Other Thoughts')
};

// --- Main Export Function ---

/**
 * Organizes sermon content based on structure, outline, tags, or date.
 * Returns a structured representation of the data.
 */
function organizeSermonContent(
  sermon: Sermon,
  focusedSection?: string,
): ExportData { // Returns structured data, not string
  debugLog("Starting content organization", { id: sermon.id, title: sermon.title, focusedSection });

  // Basic validation
  if (!sermon || sermon.title.trim() === '') {
    debugLog("Invalid sermon data provided");
    // Return a minimal structure for empty/invalid data
    return { sermon, processedSections: [] };
  }

  // Determine which sections to process
  const focusedVisualSection = normalizeVisualSectionKey(focusedSection);
  const sectionsToProcess: VisualSectionKey[] = focusedSection
    ? (focusedVisualSection ? [focusedVisualSection] : [])
    : [...VISUAL_SECTION_ORDER]; // Standard sections + ambiguous

  const processedSections: ProcessedSection[] = [];

  sectionsToProcess.forEach(sectionKey => {
    const sectionTitle = getSectionTitle(sectionKey);
    const sectionThoughts = getVisualOrderedThoughtsBySection(sermon, sectionKey);

    debugLog(`Processing section ${sectionKey}`, { thoughtCount: sectionThoughts.length });

    // Get outline points from the same visual-order source used by Structure/Plan.
    const outlinePoints = getVisualSectionOutlinePoints(sermon, sectionKey);

    // Process the section using the waterfall logic
    const organizedBlocks = processSection(
      sectionThoughts,
      outlinePoints,
      sermon.structure,
      sectionKey
    );

    // Only add section if it contains blocks with thoughts
    if (organizedBlocks.some(block => block.thoughts.length > 0)) {
      processedSections.push({
        sectionTitle,
        sectionKey,
        organizedBlocks
      });
    } else {
      debugLog(`Skipping empty section ${sectionKey}`);
    }
  });

  debugLog("Content organization completed", { numberOfSections: processedSections.length });
  return { sermon, processedSections };
}


/**
 * Main exported function: Organizes content and then formats it.
 */
export function getExportContent(
  sermon: Sermon,
  focusedSection?: string,
  options: ExportOptions = {}
): Promise<string> {
  debugLog("getExportContent called", { title: sermon?.title, focusedSection, options });

  // Default options
  const {
    type = 'thoughts',
    format = 'plain',
    includeTags = false,
    includeMetadata = true
  } = options;

  if (type === 'plan') {
    // Prioritize sermon.plan as it is the source for the "Preaching Plan" view
    const plan = sermon.plan || sermon.draft;
    if (!plan) return Promise.resolve(i18n.t('export.noPlanAvailable', 'No plan available for export'));

    let formattedPlan = '';
    if (format === 'markdown') {
      formattedPlan = formatPlanMarkdown(sermon, includeMetadata);
    } else {
      formattedPlan = formatPlanPlainText(sermon, includeMetadata);
    }
    return Promise.resolve(formattedPlan);
  }

  // Step 1: Organize the data (Separation of Concerns - Priority 2)
  const organizedData = organizeSermonContent(sermon, focusedSection);

  // Step 2: Format the organized data (Separation of Concerns - Priority 2)
  let formattedContent = '';
  if (format === 'markdown') {
    formattedContent = formatMarkdown(organizedData, includeMetadata, includeTags);
  } else {
    formattedContent = formatPlainText(organizedData, includeMetadata, includeTags);
  }

  debugLog("Formatting complete", { format, contentLength: formattedContent.length });
  return Promise.resolve(formattedContent);
}

/**
 * Formats the sermon plan into a plain text string.
 */
function formatPlanPlainText(
  sermon: Sermon,
  includeMetadata: boolean
): string {
  const plan = sermon.plan || sermon.draft;
  if (!plan) return '';

  let content = '';

  // Add header
  if (includeMetadata) {
    content += `${TRANSLATIONS.sermonTitle}${sermon.title}\n`;
    if (sermon.verse && sermon.verse.trim()) {
      content += `${TRANSLATIONS.scriptureText.trim()}\n${sermon.verse}\n`;
    }
    content += '\n';
  }

  const sections = [
    { key: 'introduction', title: TRANSLATIONS.introTitle },
    { key: 'main', title: TRANSLATIONS.mainTitle },
    { key: 'conclusion', title: TRANSLATIONS.conclusionTitle }
  ];

  sections.forEach(({ key, title }) => {
    const sectionData = plan[key as keyof typeof plan];
    if (sectionData && sectionData.outline && sectionData.outline.trim()) {
      content += `${title}:\n\n`;
      content += `${sectionData.outline}\n\n`;
      content += '---------------------\n\n';
    }
  });

  return content;
}

/**
 * Formats the sermon plan into a Markdown string.
 */
function formatPlanMarkdown(
  sermon: Sermon,
  includeMetadata: boolean
): string {
  const plan = sermon.plan || sermon.draft;
  if (!plan) return '';

  let content = '';

  // Add header
  if (includeMetadata) {
    content += `# ${TRANSLATIONS.sermonTitle}${sermon.title}\n\n`;
    if (sermon.verse && sermon.verse.trim()) {
      const lines = sermon.verse.trim().split(/\n/).filter(line => line.trim() !== '');
      const formattedVerse = lines.map(line => '> ' + line.trim()).join('\n> \n');
      content += `**${TRANSLATIONS.scriptureText.trim()}**\n${formattedVerse}\n\n`;
    }
  }

  const sections = [
    { key: 'introduction', title: TRANSLATIONS.introTitle },
    { key: 'main', title: TRANSLATIONS.mainTitle },
    { key: 'conclusion', title: TRANSLATIONS.conclusionTitle }
  ];

  sections.forEach(({ key, title }) => {
    const sectionData = plan[key as keyof typeof plan];
    if (sectionData && sectionData.outline && sectionData.outline.trim()) {
      content += `## ${title}\n\n`;
      content += `${sectionData.outline}\n\n`;
      content += '---\n\n';
    }
  });

  return content;
}


// --- Formatting Functions (Priority 2) ---

/**
 * Render the numbered body: sections -> numbered outline points -> sub-points -> thoughts.
 *
 * Numbering rules (shared by plain text & markdown, so both stay in sync):
 *  - Outline points get a CONTINUOUS top-level number across all sections (1, 2, 3 ...).
 *    A focused / single-section export naturally restarts at 1 because only one section
 *    is present in the data.
 *  - Sub-points under a point are numbered N.M (1.1, 1.2 ...); their thoughts are bullets.
 *  - Thoughts attached directly to a point (no sub-point) are bullets under the point.
 *  - Loose thoughts not tied to any outline point (unassigned / multi-tag / a section that
 *    has no outline points) are themselves numbered as top-level items, so the whole export
 *    reads as one ordered skeleton instead of a flat dump.
 *
 * Plain text builds the hierarchy with indentation + a hanging indent for multi-line
 * thoughts. Markdown can't express the hierarchy with leading spaces (they collapse / get
 * swallowed by the parent list item), so it uses real headings instead: `###` for a point,
 * `####` for a sub-point, and flush `-` bullets for thoughts (2-space continuation keeps a
 * multi-line thought inside its list item). The N / N.M numbers are literal text in the
 * heading, so the parser can't renumber them.
 */
function renderNumberedSections(
  data: ExportData,
  includeTags: boolean,
  fmt: 'plain' | 'markdown',
): string {
  const isMd = fmt === 'markdown';
  let content = '';
  let pointNumber = 0;

  const tagLine = (thought: Thought, indent: string): string => {
    if (!includeTags || !thought.tags || thought.tags.length === 0) return '';
    return isMd
      ? `${indent}*${TRANSLATIONS.tagsLabel}${thought.tags.join(', ')}*\n`
      : `${indent}${TRANSLATIONS.tagsLabel}${thought.tags.join(', ')}\n`;
  };

  // Render a thought's text after its bullet/number prefix. Continuation lines of a
  // multi-line thought are indented (hanging indent) so they stay attached to their bullet
  // instead of reading as separate top-level items; blank lines are preserved as breaks.
  const renderThought = (text: string, bulletPrefix: string, contIndent: string): string => {
    return String(text ?? '')
      .split('\n')
      .map((line, i) => (i === 0 ? `${bulletPrefix}${line}` : (line.trim() === '' ? '' : `${contIndent}${line}`)))
      .join('\n') + '\n';
  };

  data.processedSections.forEach((section) => {
    content += isMd ? `## ${section.sectionTitle}\n\n` : `${section.sectionTitle}:\n\n`;

    section.organizedBlocks.forEach((block) => {
      if (block.type === 'outline') {
        // Outline point = numbered top-level item; sub-points = N.M; thoughts = bullets.
        pointNumber += 1;
        content += isMd ? `### ${pointNumber}. ${block.title}\n\n` : `${pointNumber}. ${block.title}\n`;

        let subNumber = 0;
        const entries = buildSubPointRenderableEntries(block.thoughts, block.subPoints ?? []);
        entries.forEach((entry) => {
          if (entry.type === 'subPoint') {
            subNumber += 1;
            content += isMd
              ? `#### ${pointNumber}.${subNumber} ${entry.subPoint.text}\n\n`
              : `   ${pointNumber}.${subNumber} ${entry.subPoint.text}\n`;
            entry.items.forEach((thought) => {
              content += isMd
                ? renderThought(thought.text, '- ', '  ')
                : renderThought(thought.text, '       - ', '         ');
              content += tagLine(thought, isMd ? '  ' : '         ');
            });
            if (isMd) content += '\n';
          } else {
            content += isMd
              ? renderThought(entry.item.text, '- ', '  ')
              : renderThought(entry.item.text, '   - ', '     ');
            content += tagLine(entry.item, isMd ? '  ' : '     ');
          }
        });
        content += '\n';
      } else {
        // Loose thoughts with no outline point. Keep the block label (e.g. "Unassigned")
        // as a context header, then number each thought as a top-level item.
        if (block.title && block.title !== section.sectionTitle) {
          content += isMd ? `### ${block.title}\n\n` : `${block.title}:\n`;
        }
        if (block.thoughts.length === 0) {
          content += isMd ? `_${TRANSLATIONS.noEntries}_\n` : `${TRANSLATIONS.noEntries}\n`;
        } else {
          block.thoughts.forEach((thought) => {
            pointNumber += 1;
            const prefix = `${pointNumber}. `;
            const contIndent = isMd ? '   ' : ' '.repeat(prefix.length);
            content += renderThought(thought.text, prefix, contIndent);
            content += tagLine(thought, contIndent);
          });
        }
        content += '\n';
      }
    });
  });

  return content;
}

/**
 * Formats the organized data into a plain text string.
 */
function formatPlainText(
  data: ExportData,
  includeMetadata: boolean,
  includeTags: boolean
): string {
  let content = '';

  // Add header
  if (includeMetadata) {
    let header = `${TRANSLATIONS.sermonTitle}${data.sermon.title}\n`;
    if (data.sermon.verse && data.sermon.verse.trim()) {
      // Use the translation key directly, assuming it includes the colon, and trim whitespace.
      header += `${TRANSLATIONS.scriptureText.trim()}\n${data.sermon.verse}\n`;
    }
    header += '\n';
    content += header;
  }

  content += renderNumberedSections(data, includeTags, 'plain');
  return content;
}

/**
 * Formats the organized data into a Markdown string.
 */
function formatMarkdown(
  data: ExportData,
  includeMetadata: boolean,
  includeTags: boolean
): string {
  let content = '';

  // Add header
  if (includeMetadata) {
    let header = `# ${TRANSLATIONS.sermonTitle}${data.sermon.title}\n\n`;
    if (data.sermon.verse && data.sermon.verse.trim()) {
      const trimmedVerse = data.sermon.verse.trim();
      // Split by *any* newline, filter empty lines
      const lines = trimmedVerse.split(/\n/).filter(line => line.trim() !== '');
      // Prepend > to each line (trimming it first) and join with the paragraph separator
      const formattedVerse = lines.map(line => '> ' + line.trim()).join('\n> \n');

      header += `**${TRANSLATIONS.scriptureText.trim()}**\n${formattedVerse}\n\n`;
    }
    content += header;
  }

  content += renderNumberedSections(data, includeTags, 'markdown');
  return content;
}


// --- Section/Thought Processing Logic (Refactoring Priority 3) ---

/**
 * Helper to extract thoughts with multiple structure tags.
 */
function extractMultiTagThoughts(thoughts: Thought[]) {
  const multiTagThoughts: Thought[] = [];
  const thoughtsWithoutMultiTag: Thought[] = [];

  thoughts.forEach(thought => {
    // Ensure tags array exists before filtering
    const thoughtStructureTags = thought.tags?.filter(tag => isStructureTag(tag)) || [];
    if (thoughtStructureTags.length > 1) {
      multiTagThoughts.push(thought);
    } else {
      thoughtsWithoutMultiTag.push(thought);
    }
  });
  debugLog(`extractMultiTagThoughts`, { extracted: multiTagThoughts.length, remaining: thoughtsWithoutMultiTag.length });
  return { multiTagThoughts, thoughtsWithoutMultiTag };
}

/**
 * Helper to separate thoughts based on outline assignment.
 */
function separateThoughtsByOutline(thoughts: Thought[], outlineMap: Map<string, SermonPoint>) {
  const assignedThoughts: Thought[] = [];
  const unassignedThoughts: Thought[] = [];
  thoughts.forEach(thought => {
    if (thought.outlinePointId && outlineMap.has(thought.outlinePointId)) {
      assignedThoughts.push(thought);
    } else {
      unassignedThoughts.push(thought);
    }
  });
  debugLog(`separateThoughtsByOutline`, { assigned: assignedThoughts.length, unassigned: unassignedThoughts.length });
  return { assignedThoughts, unassignedThoughts };
}


/**
 * Process thoughts assigned to specific outline points.
 */
function processThoughtsByOutline(
  thoughts: Thought[],
  outlineMap: Map<string, SermonPoint>,
  sectionOrderIds?: string[]
): OrganizedBlock[] {
  // Group thoughts by outline point ID
  const thoughtsByOutline = new Map<string, Thought[]>();
  thoughts.forEach(thought => {
    if (!thought.outlinePointId) return; // Should not happen here, but safe check
    if (!thoughtsByOutline.has(thought.outlinePointId)) {
      thoughtsByOutline.set(thought.outlinePointId, []);
    }
    thoughtsByOutline.get(thought.outlinePointId)!.push(thought);
  });

  // Get outline points in the order they appear in the map (insertion order from sermon.outline)
  const pointsInOrder = Array.from(outlineMap.values());

  // Create a block for each outline point that has thoughts
  return pointsInOrder.map(point => {
    const pointThoughts = thoughtsByOutline.get(point.id) || [];
    const sortedThoughts = sortThoughtsForOutlinePoint(pointThoughts, sectionOrderIds); // Prefer structure order, then date
    return {
      type: 'outline' as const,
      title: point.text, // Use outline point text as block title
      outlineId: point.id,
      subPoints: point.subPoints ?? [],
      thoughts: sortedThoughts
    };
  }).filter(block => block.thoughts.length > 0); // Filter out blocks with no thoughts
}


/**
 * Process thoughts based on the defined structure for a section.
 * Returns only the thoughts that match the structure definition for that section.
 */
function processThoughtsByStructure(thoughts: Thought[], structure: ThoughtsBySection, sectionKey: string): Thought[] {
  const structuredIds = structure[sectionKey as keyof ThoughtsBySection] || [];
  if (!structuredIds || structuredIds.length === 0) {
    debugLog(`processThoughtsByStructure - No structure defined for section ${sectionKey}`);
    return []; // Return empty if no structure defined for this section
  }

  const thoughtMap = new Map<string, Thought>(thoughts.map(t => [t.id, t]));
  const orderedThoughts: Thought[] = [];

  structuredIds.forEach(id => {
    if (thoughtMap.has(id)) {
      orderedThoughts.push(thoughtMap.get(id)!);
      // Do not delete from map here if thoughts might be used elsewhere
    }
  });

  const structuredIdSet = new Set(orderedThoughts.map((t) => t.id));
  const orphans = thoughts.filter((t) => !structuredIdSet.has(t.id));
  const orderedOrphans = sortThoughtsByDate(orphans);

  debugLog(`processThoughtsByStructure - Found ${orderedThoughts.length} structured thoughts for ${sectionKey}`);
  return [...orderedThoughts, ...orderedOrphans];
}


/**
 * Process thoughts by sorting them based on section tags (Intro, Main, Conclusion).
 */
function processThoughtsByTags(thoughts: Thought[]): Thought[] {
  // Create a copy before sorting
  const order: Record<string, number> = { intro: 0, main: 1, conclusion: 2 };
  const sorted = [...thoughts].sort((a, b) => {
    const aCanon = a.tags?.map(normalizeStructureTag).find(Boolean) as string | null | undefined;
    const bCanon = b.tags?.map(normalizeStructureTag).find(Boolean) as string | null | undefined;
    if (aCanon && bCanon && aCanon !== bCanon) return order[aCanon] - order[bCanon];
    if (aCanon && !bCanon) return -1;
    if (!aCanon && bCanon) return 1;
    return sortByDateHelper(a, b);
  });
  debugLog(`processThoughtsByTags - Sorted ${sorted.length} thoughts`);
  return sorted;
}

/**
 * Apply the organization waterfall logic (ThoughtsBySection -> Tags -> Date) 
 * to a list of thoughts within a specific section context.
 */
function organizeThoughtsWithinSection(
  thoughts: Thought[],
  structure: ThoughtsBySection | undefined,
  sectionKey: string // Key of the section these thoughts belong to ('introduction', 'main', etc.)
): Thought[] { // Returns thoughts ordered according to the first applicable logic

  if (!thoughts || thoughts.length === 0) return [];

  debugLog(`organizeThoughtsWithinSection - Start for ${sectionKey}`, { count: thoughts.length });

  // 1. Try ThoughtsBySection
  // ThoughtsBySection only applies to specific sections, not 'ambiguous'
  if (sectionKey !== 'ambiguous' && structure && isValidStructure(structure)) {
    const structuredThoughts = processThoughtsByStructure(thoughts, structure, sectionKey);
    // If structure ordering produced a result for this section, use it.
    if (structuredThoughts.length > 0) {
      debugLog(`organizeThoughtsWithinSection - Using STRUCTURE order for ${sectionKey}`);
      // Note: processThoughtsByStructure currently only returns thoughts *in* the structure.
      // Decide if remaining thoughts should be appended (sorted by date?).
      // For now, assuming structure is definitive for the section if present.
      return structuredThoughts;
    }
  }

  // 2. Try Tags (if structure didn't apply or wasn't relevant)
  if (hasValidSectionTags(thoughts)) {
    debugLog(`organizeThoughtsWithinSection - Using TAG order for ${sectionKey}`);
    return processThoughtsByTags(thoughts);
  }

  // 3. Fallback to Date
  debugLog(`organizeThoughtsWithinSection - Using DATE order for ${sectionKey}`);
  return sortThoughtsByDate(thoughts);
}

/**
 * Main function to process thoughts within a single section 
 * (e.g., 'introduction', 'main', 'conclusion', 'ambiguous').
 * Handles outline points if present, otherwise uses the organization waterfall.
 */
function processSection(
  sectionThoughts: Thought[], // Thoughts already filtered for this section
  outlinePoints: SermonPoint[] = [],
  structure?: ThoughtsBySection,
  sectionKey?: string // The key ('introduction', 'main', etc.)
): OrganizedBlock[] {
  const organizedBlocks: OrganizedBlock[] = [];
  if (!sectionKey) return organizedBlocks; // Need sectionKey for context

  let thoughtsToProcess = sectionThoughts ? [...sectionThoughts] : [];
  if (thoughtsToProcess.length === 0) return organizedBlocks; // No thoughts in this section

  debugLog(`processSection - Start for ${sectionKey}`, { initialCount: thoughtsToProcess.length, outlinePoints: outlinePoints.length });

  // Step 0: Handle thoughts with multiple structure tags - applies to the whole section batch first
  const { multiTagThoughts, thoughtsWithoutMultiTag } = extractMultiTagThoughts(thoughtsToProcess);
  if (multiTagThoughts.length > 0) {
    organizedBlocks.push({
      type: 'tag', // Special block type for these
      title: TRANSLATIONS.multipleTagsThoughts,
      thoughts: sortThoughtsByDate(multiTagThoughts) // Sort them by date
    });
    debugLog(`processSection - Extracted multi-tag thoughts for ${sectionKey}`, { count: multiTagThoughts.length });
  }
  thoughtsToProcess = thoughtsWithoutMultiTag; // Work with the remainder

  // Step 1: Check for SermonOutline Points specific to this section
  if (outlinePoints.length > 0) {
    debugLog(`processSection - Processing with outline points for ${sectionKey}`);
    const outlineMap = new Map<string, SermonPoint>(outlinePoints.map(p => [p.id, p]));
    const sectionOrderIds = sectionKey !== 'ambiguous'
      ? thoughtsToProcess.map((t) => t.id)
      : undefined;

    // Separate thoughts based on assignment to *these* outline points
    const { assignedThoughts, unassignedThoughts } = separateThoughtsByOutline(thoughtsToProcess, outlineMap);

    // Create blocks for thoughts assigned to outline points
    if (assignedThoughts.length > 0) {
      const outlineBlocks = processThoughtsByOutline(assignedThoughts, outlineMap, sectionOrderIds);
      organizedBlocks.push(...outlineBlocks);
      debugLog(`processSection - Added outline blocks for ${sectionKey}`, { count: outlineBlocks.length });
    }

    // Process the remaining unassigned thoughts using the standard waterfall
    if (unassignedThoughts.length > 0) {
      debugLog(`processSection - Processing unassigned thoughts via waterfall for ${sectionKey}`, { count: unassignedThoughts.length });
      const processedUnassigned = organizeThoughtsWithinSection(unassignedThoughts, structure, sectionKey);
      if (processedUnassigned.length > 0) {
        organizedBlocks.push({
          type: 'unassigned', // Block type indicating these weren't tied to an outline point
          title: TRANSLATIONS.unassignedThoughts, // Generic title for this block
          thoughts: processedUnassigned // Thoughts are ordered by the waterfall
        });
        debugLog(`processSection - Added unassigned block for ${sectionKey}`, { count: processedUnassigned.length });
      }
    }
  } else {
    // No outline points for this section - process all thoughts using the waterfall
    debugLog(`processSection - No outline points for ${sectionKey}, processing all via waterfall`);
    const processedThoughts = organizeThoughtsWithinSection(thoughtsToProcess, structure, sectionKey);

    if (processedThoughts.length > 0) {
      // Create a single block for the entire section's organized thoughts
      organizedBlocks.push({
        // Determine block type based on which method succeeded inside organizeThoughtsWithinSection?
        // For simplicity, default to 'chronological' or maybe 'tag' if tags were used?
        // Let's default to chronological as the fallback type.
        type: 'chronological',
        title: getSectionTitle(sectionKey), // Use the main section title
        thoughts: processedThoughts
      });
      debugLog(`processSection - Added single block for section ${sectionKey}`, { count: processedThoughts.length });
    }
  }

  debugLog(`processSection - End for ${sectionKey}`, { blockCount: organizedBlocks.length });
  // Filter out any blocks that somehow ended up empty
  return organizedBlocks.filter(block => block.thoughts.length > 0);
}



/** Sort thoughts chronologically */
function sortThoughtsByDate(thoughts: Thought[]): Thought[] {
  if (!thoughts) return [];
  return [...thoughts].sort(sortByDateHelper);
}

/** Sort thoughts within an outline point using structure order when available, then date */
function sortThoughtsForOutlinePoint(thoughts: Thought[], sectionOrderIds?: string[]): Thought[] {
  if (!thoughts) return [];
  if (sectionOrderIds && sectionOrderIds.length > 0) {
    const orderIndex = new Map(sectionOrderIds.map((id, index) => [id, index]));
    return [...thoughts].sort((a, b) => {
      const orderA = orderIndex.get(a.id);
      const orderB = orderIndex.get(b.id);
      if (orderA !== undefined || orderB !== undefined) {
        const idxA = orderA ?? Number.POSITIVE_INFINITY;
        const idxB = orderB ?? Number.POSITIVE_INFINITY;
        if (idxA !== idxB) return idxA - idxB;
      }
      return sortByDateHelper(a, b);
    });
  }
  return [...thoughts].sort(sortByDateHelper);
}

/** Helper for date comparison */
function sortByDateHelper(a: Thought, b: Thought): number {
  const dateA = new Date(a.date || 0).getTime();
  const dateB = new Date(b.date || 0).getTime();
  return dateA - dateB; // Ascending order
}

/** Filter thoughts relevant to a specific section key */
/** Get localized section title */
function getSectionTitle(sectionKey: string): string {
  const titleMap: Record<string, string> = {
    'introduction': TRANSLATIONS.introTitle,
    'main': TRANSLATIONS.mainTitle,
    'conclusion': TRANSLATIONS.conclusionTitle,
    'ambiguous': TRANSLATIONS.otherTitle
  };
  return titleMap[sectionKey] || sectionKey; // Fallback to key name
}

/** Check if structure object is valid */
function isValidStructure(structure: ThoughtsBySection | undefined): boolean {
  // Ensure structure is not null/undefined before checking keys
  return !!structure && typeof structure === 'object' && Object.keys(structure).length > 0;
}

/** Check if any thoughts have relevant section tags */
function hasValidSectionTags(thoughts: Thought[]): boolean {
  if (!thoughts) return false;
  return thoughts.some(thought =>
    thought.tags?.some(tag => normalizeStructureTag(tag) !== null)
  );
}

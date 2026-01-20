import { Sermon, Thought } from "@/models/models";

// Common tag words to avoid duplicate strings
const TAG_MAIN = "main";
const TAG_MAIN_PART = "main part";
const TAG_OSNOVNAYA_CHAST = "основная часть";
const TAG_ZAKLYUCHENIE = "заключение";

// Tag constants for section identification (expanded to cover all known variations)
const SECTION_TAGS = {
  INTRO: ["вступление", "introduction", "вступ"] as readonly string[],
  MAIN: [TAG_OSNOVNAYA_CHAST, TAG_MAIN, TAG_MAIN_PART, "основна частина"] as readonly string[],
  CONCLUSION: [TAG_ZAKLYUCHENIE, "conclusion", "заключ", "закінчення", "заключення"] as readonly string[],
};

// Helper function to check if a tag matches any of the intro tags
const isIntroTag = (tag: string) => SECTION_TAGS.INTRO.includes(tag.toLowerCase());
const isMainTag = (tag: string) => SECTION_TAGS.MAIN.includes(tag.toLowerCase());
const isConclusionTag = (tag: string) => SECTION_TAGS.CONCLUSION.includes(tag.toLowerCase());

const isDebugMode = process.env.DEBUG_MODE === 'true';

// UUID regex pattern for identifying thought IDs
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Helper to check if a string is a UUID
function isUUID(str: string): boolean {
  return UUID_PATTERN.test(str);
}

// Helper to resolve thought ID to text
function resolveThoughtById(
  thoughtId: string,
  thoughtsById: Map<string, Thought>,
  usedThoughtIds: Set<string>
): string | null {
  const thought = thoughtsById.get(thoughtId);
  if (thought && thought.text && !usedThoughtIds.has(thought.id)) {
    usedThoughtIds.add(thought.id);
    return thought.text;
  }
  return null;
}

// Helper to extract content check items (IDs or text)
function extractSectionContentItems(
  items: string[],
  thoughtsById: Map<string, Thought>,
  usedThoughtIds: Set<string>
): string[] {
  const content: string[] = [];

  for (const item of items) {
    if (isUUID(item)) {
      const thoughtText = resolveThoughtById(item, thoughtsById, usedThoughtIds);
      if (thoughtText) {
        content.push(thoughtText);
      }
    } else {
      content.push(item);
    }
  }

  return content;
}

// Helper to filter thoughts by tag
function filterThoughtsByTags(
  thoughts: Thought[] | undefined,
  tagPredicate: (tag: string) => boolean,
  usedThoughtIds: Set<string>
): string[] {
  if (!thoughts) return [];

  const filteredThoughts = thoughts.filter(
    t => t.tags?.some(tag => tagPredicate(tag)) && !usedThoughtIds.has(t.id)
  );

  return filteredThoughts.map(t => {
    usedThoughtIds.add(t.id);
    return t.text;
  });
}

// Helper to build section content (with fallback)
function buildSectionContent(
  sectionName: string,
  sectionItems: string[] | undefined,
  thoughtsById: Map<string, Thought>,
  usedThoughtIds: Set<string>,
  thoughts: Thought[] | undefined,
  tagPredicate: (tag: string) => boolean
): string {
  if (sectionItems && sectionItems.length > 0) {
    const content = extractSectionContentItems(sectionItems, thoughtsById, usedThoughtIds);
    if (content.length > 0) {
      return `\n\n${sectionName}:\n${content.join('\n')}`;
    }
  }

  // Fallback to tags if no structure structure or empty result
  const taggedContent = filterThoughtsByTags(thoughts, tagPredicate, usedThoughtIds);
  if (taggedContent.length > 0) {
    return `\n\n${sectionName}:\n${taggedContent.join('\n')}`;
  }

  return "";
}



// Helper to process unstructured sermon thoughts
function processUnstructuredSermon(sermon: Sermon): string {
  if (isDebugMode) {
    console.log("Processing unstructured sermon thoughts");
  }

  if (!sermon.thoughts) return "";

  // Filter out very short thoughts and map to text
  const meaningfulThoughts = sermon.thoughts
    .filter(t => t.text && t.text.trim().length > 10)
    .map(t => {
      // Include tags as context
      if (t.tags && t.tags.length > 0) {
        return `[${t.tags.join(', ')}] ${t.text}`;
      }
      return t.text;
    });

  if (meaningfulThoughts.length > 0) {
    return meaningfulThoughts.join("\n\n");
  }

  return "";
}

// Helper to process structured sermon content
function processStructuredSermon(
  sermon: Sermon,
  thoughtsById: Map<string, Thought>,
  usedThoughtIds: Set<string>
): string {
  if (isDebugMode) {
    console.log("Processing structured sermon content");
  }

  let sermonContent = "";

  // Process Introduction
  sermonContent += buildSectionContent(
    "Introduction",
    sermon.structure!.introduction,
    thoughtsById,
    usedThoughtIds,
    sermon.thoughts,
    isIntroTag
  );

  // Process Main Part
  sermonContent += buildSectionContent(
    "Main Part",
    sermon.structure!.main,
    thoughtsById,
    usedThoughtIds,
    sermon.thoughts,
    isMainTag
  );

  // Process Conclusion
  sermonContent += buildSectionContent(
    "Conclusion",
    sermon.structure!.conclusion,
    thoughtsById,
    usedThoughtIds,
    sermon.thoughts,
    isConclusionTag
  );

  // Add ambiguous / additional thoughts if any
  if (sermon.structure!.ambiguous && sermon.structure!.ambiguous.length > 0) {
    const ambiguousContent = extractSectionContentItems(
      sermon.structure!.ambiguous,
      thoughtsById,
      usedThoughtIds
    );

    if (ambiguousContent.length > 0) {
      sermonContent += `\n\nAdditional Thoughts:\n${ambiguousContent.join('\n')}`;
    }
  }

  return sermonContent;
}

export function extractSermonContent(sermon: Sermon): string {
  let sermonContent = "";
  const usedThoughtIds = new Set<string>();

  // Create a map from thought ID to thought object for O(1) lookups
  const thoughtsById = new Map<string, Thought>();
  if (sermon.thoughts) {
    sermon.thoughts.forEach(t => {
      if (t.id) thoughtsById.set(t.id, t);
    });
  }

  // First, check if the sermon has structure
  const hasStructure = sermon.structure &&
    ((sermon.structure.introduction?.length ?? 0) > 0 ||
      (sermon.structure.main?.length ?? 0) > 0 ||
      (sermon.structure.conclusion?.length ?? 0) > 0 ||
      (sermon.structure.ambiguous?.length ?? 0) > 0);


  // If there's no structure, use all thoughts
  if (!hasStructure && sermon.thoughts && sermon.thoughts.length > 0) {
    sermonContent = processUnstructuredSermon(sermon);
  } else if (hasStructure && sermon.structure) {
    sermonContent = processStructuredSermon(sermon, thoughtsById, usedThoughtIds);
  }

  // If we don't have meaningful content after all this, use a fallback message
  if (sermonContent.trim().length === 0) {
    if (isDebugMode) {
      console.log("Minimal sermon content detected, using fallback");
    }
    sermonContent = `This sermon with title "${sermon.title}" and reference "${sermon.verse}" appears to be in early stages of development with minimal content.`;
  }

  // Log content size for debugging and optimization
  if (isDebugMode) {
    console.log(`Content size: ${sermonContent.length} characters`);
  }

  // console.error('DEBUG: Final Result:', JSON.stringify(sermonContent));
  return sermonContent;
}

/**
 * Formats a duration into a human-readable string
 * @param durationMs Duration in milliseconds
 * @returns Formatted string (e.g. "1.5s", "2m 30s", "1h 20m")
 */
export function formatDuration(durationMs: number): string {
  // If less than 1 second, show milliseconds
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  // Convert to seconds
  const seconds = durationMs / 1000;

  // If less than 60 seconds, show seconds
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  // Convert to minutes and seconds
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);

  // If less than 60 minutes, show minutes and seconds
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  // Convert to hours, minutes, and seconds
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.floor(minutes % 60);

  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Unified logger for consistent logging throughout the application
 *
 * Usage examples:
 *
 * 1. Basic logging:
 *    logger.info('ComponentName', 'Message goes here');
 *
 * 2. With additional data:
 *    logger.info('ComponentName', 'Found items', items);
 *
 * 3. Error logging:
 *    try {
 *      // Some code that may throw
 *    } catch (err) {
 *      logger.error('ComponentName', 'Failed to process data', err);
 *    }
 *
 * 4. Debug logging (only shows in debug mode):
 *    logger.debug('ComponentName', 'Detailed debug info', debugData);
 *
 * 5. Success logging:
 *    logger.success('ComponentName', 'Operation completed successfully');
 *
 * 6. Warning logging:
 *    logger.warn('ComponentName', 'Resource usage is high', { cpu: 90, memory: 85 });
 */
export const logger = {
  /**
   * Log information with a specified module name
   * @param module The name of the module/component logging the message
   * @param message The message to log
   * @param data Optional data to include with the log
   */
  info: (module: string, message: string, data?: unknown) => {
    if (data) {
      console.log(`ℹ️ [${module}] ${message}`, data);
    } else {
      console.log(`ℹ️ [${module}] ${message}`);
    }
  },

  /**
   * Log a warning with a specified module name
   * @param module The name of the module/component logging the warning
   * @param message The warning message
   * @param data Optional data to include with the warning
   */
  warn: (module: string, message: string, data?: unknown) => {
    if (data) {
      console.warn(`⚠️ [${module}] ${message}`, data);
    } else {
      console.warn(`⚠️ [${module}] ${message}`);
    }
  },

  /**
   * Log an error with a specified module name
   * @param module The name of the module/component logging the error
   * @param message The error message
   * @param error Optional error object or data to include
   */
  error: (module: string, message: string, error?: unknown) => {
    if (error) {
      console.error(`❌ [${module}] ${message}`, error);
    } else {
      console.error(`❌ [${module}] ${message}`);
    }
  },

  /**
   * Log a debug message (only in debug mode)
   * @param module The name of the module/component logging the debug message
   * @param message The debug message
   * @param data Optional data to include with the debug message
   */
  debug: (module: string, message: string, data?: unknown) => {
    if (isDebugMode) {
      if (data) {
        console.log(`🔍 [${module}] ${message}`, data);
      } else {
        console.log(`🔍 [${module}] ${message}`);
      }
    }
  },

  /**
   * Log a success message with a specified module name
   * @param module The name of the module/component logging the success message
   * @param message The success message
   * @param data Optional data to include with the success message
   */
  success: (module: string, message: string, data?: unknown) => {
    if (data) {
      console.log(`✅ [${module}] ${message}`, data);
    } else {
      console.log(`✅ [${module}] ${message}`);
    }
  }
};

/**
 * Extracts meaningful content from a specific section of a sermon for AI processing
 * @param sermon The sermon to extract content from
 * @param section The section to extract ('introduction', 'main', or 'conclusion')
 * @returns Formatted sermon section content as a string
 */
// Helper to get section configuration
function getSectionConfiguration(sectionLower: string): {
  tagPredicate: (tag: string) => boolean;
  sectionDisplayName: string;
  sectionItemsGetter: (structure: NonNullable<Sermon['structure']>) => string[] | undefined;
} {
  switch (sectionLower) {
    case 'introduction':
      return {
        tagPredicate: isIntroTag,
        sectionDisplayName: 'Introduction',
        sectionItemsGetter: (s) => s.introduction
      };
    case 'main':
      return {
        tagPredicate: isMainTag,
        sectionDisplayName: 'Main Part',
        sectionItemsGetter: (s) => s.main
      };
    case 'conclusion':
      return {
        tagPredicate: isConclusionTag,
        sectionDisplayName: 'Conclusion',
        sectionItemsGetter: (s) => s.conclusion
      };
    default:
      throw new Error(`Invalid section: ${sectionLower}. Must be one of: introduction, main, conclusion`);
  }
}

// Helper to process structured section content
function processStructuredSection(
  sectionItems: string[] | undefined,
  sectionDisplayName: string,
  tagPredicate: (tag: string) => boolean,
  thoughts: Thought[] | undefined,
  thoughtsById: Map<string, Thought>,
  usedThoughtIds: Set<string>
): string {
  if (sectionItems && sectionItems.length > 0) {
    // Try to get content from structure items
    const contentList = extractSectionContentItems(sectionItems, thoughtsById, usedThoughtIds);

    // If found content, use it
    if (contentList.length > 0) {
      return `${sectionDisplayName}:\n${contentList.join('\n')}`;
    } else {
      // Fallback to tags if structure items yielded nothing (unresolvable UUIDs)
      const taggedContent = filterThoughtsByTags(thoughts, tagPredicate, usedThoughtIds);
      if (taggedContent.length > 0) {
        return `${sectionDisplayName}:\n${taggedContent.join('\n')}`;
      }
    }
  }
  return "";
}

// Helper to process unstructured section content
function processUnstructuredSection(
  thoughts: Thought[] | undefined,
  tagPredicate: (tag: string) => boolean,
  usedThoughtIds: Set<string>
): string {
  if (thoughts) {
    const sectionThoughts = thoughts.filter(t =>
      t.tags?.some(tag => tagPredicate(tag)) && !usedThoughtIds.has(t.id) &&
      t.text && t.text.trim().length > 10
    );

    const formatted = sectionThoughts.map(t => {
      usedThoughtIds.add(t.id);
      if (t.tags && t.tags.length > 0) {
        return `[${t.tags.join(', ')}] ${t.text}`;
      }
      return t.text;
    });

    if (formatted.length > 0) {
      return formatted.join("\n\n");
    }
  }
  return "";
}

export function extractSectionContent(sermon: Sermon, section: string): string {
  const sectionLower = section.toLowerCase();

  // Validate section and determine configuration
  const { tagPredicate, sectionDisplayName, sectionItemsGetter } = getSectionConfiguration(sectionLower);

  const sectionItems = sermon.structure ? sectionItemsGetter(sermon.structure) : undefined;

  // Create a map from thought ID to thought object
  const thoughtsById = new Map<string, Thought>();
  const usedThoughtIds = new Set<string>();

  if (sermon.thoughts) {
    sermon.thoughts.forEach(t => {
      if (t.id) thoughtsById.set(t.id, t);
    });
  }

  let sectionContent = "";

  // Check if the sermon has structure
  const hasStructure = sermon.structure &&
    ((sermon.structure.introduction?.length ?? 0) > 0 ||
      (sermon.structure.main?.length ?? 0) > 0 ||
      (sermon.structure.conclusion?.length ?? 0) > 0);

  if (hasStructure) {
    // Structured path
    sectionContent = processStructuredSection(
      sectionItems,
      sectionDisplayName,
      tagPredicate,
      sermon.thoughts,
      thoughtsById,
      usedThoughtIds
    );
  } else {
    // Unstructured path: just tags, no header
    sectionContent = processUnstructuredSection(
      sermon.thoughts,
      tagPredicate,
      usedThoughtIds
    );
  }

  // Fallback message
  if (sectionContent.trim().length === 0) {
    if (isDebugMode) {
      console.log(`Minimal sermon ${sectionLower} content detected, using fallback`);
    }
    sectionContent = `This sermon with title "${sermon.title}" and reference "${sermon.verse}" appears to be in early stages of development with minimal content for the ${sectionLower} section.`;
  }

  // Log content size for debugging and optimization
  if (isDebugMode) {
    console.log(`${sectionLower} content size: ${sectionContent.length} characters`);
  }

  return sectionContent;
}

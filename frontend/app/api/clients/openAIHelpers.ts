import { Sermon, Thought } from "@/models/models";

/**
 * Helper flag for debug mode access across helper functions
 */
const isDebugMode = process.env.DEBUG_MODE === 'true';

/**
 * Extracts meaningful content from a sermon for AI processing
 * @param sermon The sermon to extract content from
 * @returns Formatted sermon content as a string
 */
export function extractSermonContent(sermon: Sermon): string {
  let sermonContent = "";
  const usedThoughtIds = new Set<string>();
  
  // First, check if the sermon has structure
  const hasStructure = sermon.structure && 
    (sermon.structure.introduction?.length > 0 || 
     sermon.structure.main?.length > 0 || 
     sermon.structure.conclusion?.length > 0);
  
  // If there's no structure, use all thoughts
  if (!hasStructure && sermon.thoughts && sermon.thoughts.length > 0) {
    if (isDebugMode) {
      console.log(`Processing ${sermon.thoughts.length} thoughts (unstructured)`);
    }
    
    const meaningfulThoughts = sermon.thoughts
      .filter(t => t.text && t.text.trim().length > 10) // Filter out very short thoughts
      .map(t => {
        // Include tags as context
        if (t.tags && t.tags.length > 0) {
          return `[${t.tags.join(', ')}] ${t.text}`;
        }
        return t.text;
      });
    
    sermonContent = meaningfulThoughts.join("\n\n");
  } else if (sermon.thoughts && sermon.thoughts.length > 0) {
    // If we have structure, we'll only use the thoughts referenced in the structure
    if (isDebugMode) {
      console.log(`Processing ${sermon.thoughts.length} thoughts (structured)`);
    }
  } else if (isDebugMode) {
    console.log("No thoughts found in sermon");
  }
  
  // Add content from sermon structure if available
  if (sermon.structure) {
    // Create a map from thought ID to thought object
    const thoughtsById = new Map<string, Thought>();
    
    if (sermon.thoughts) {
      sermon.thoughts.forEach(t => {
        if (t.id) thoughtsById.set(t.id, t);
      });
    }
    
    // For introduction
    if (sermon.structure.introduction && sermon.structure.introduction.length > 0) {
      sermonContent += "\n\nIntroduction:";
      let introContent: string[] = [];
      
      // First try to resolve IDs to actual thoughts
      for (const item of sermon.structure.introduction) {
        // Check if item is a UUID
        if (item.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
          const thought = thoughtsById.get(item);
          if (thought && thought.text && !usedThoughtIds.has(thought.id)) {
            introContent.push(thought.text);
            usedThoughtIds.add(thought.id);
          }
        } else {
          // It's already text content
          introContent.push(item);
        }
      }
      
      // If we couldn't resolve any IDs to content, try to find thoughts by tag
      if (introContent.length === 0) {
        const introThoughts = sermon.thoughts?.filter(t => 
          t.tags?.some(tag => 
            tag.toLowerCase() === "вступление" || 
            tag.toLowerCase() === "introduction" || 
            tag.toLowerCase() === "вступ"
          ) && !usedThoughtIds.has(t.id)
        ) || [];
        
        introContent = introThoughts.map(t => {
          usedThoughtIds.add(t.id);
          return t.text;
        });
      }
      
      if (introContent.length > 0) {
        sermonContent += "\n" + introContent.join("\n");
      }
    }
    
    // For main part
    if (sermon.structure.main && sermon.structure.main.length > 0) {
      sermonContent += "\n\nMain Part:";
      let mainContent: string[] = [];
      
      // First try to resolve IDs to actual thoughts
      for (const item of sermon.structure.main) {
        // Check if item is a UUID
        if (item.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
          const thought = thoughtsById.get(item);
          if (thought && thought.text && !usedThoughtIds.has(thought.id)) {
            mainContent.push(thought.text);
            usedThoughtIds.add(thought.id);
          }
        } else {
          // It's already text content
          mainContent.push(item);
        }
      }
      
      // If we couldn't resolve any IDs to content, try to find thoughts by tag
      if (mainContent.length === 0) {
        const mainThoughts = sermon.thoughts?.filter(t => 
          t.tags?.some(tag => 
            tag.toLowerCase() === "основная часть" || 
            tag.toLowerCase() === "main part" || 
            tag.toLowerCase() === "основна частина"
          ) && !usedThoughtIds.has(t.id)
        ) || [];
        
        mainContent = mainThoughts.map(t => {
          usedThoughtIds.add(t.id);
          return t.text;
        });
      }
      
      if (mainContent.length > 0) {
        sermonContent += "\n" + mainContent.join("\n");
      }
    }
    
    // For conclusion
    if (sermon.structure.conclusion && sermon.structure.conclusion.length > 0) {
      sermonContent += "\n\nConclusion:";
      let conclusionContent: string[] = [];
      
      // First try to resolve IDs to actual thoughts
      for (const item of sermon.structure.conclusion) {
        // Check if item is a UUID
        if (item.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
          const thought = thoughtsById.get(item);
          if (thought && thought.text && !usedThoughtIds.has(thought.id)) {
            conclusionContent.push(thought.text);
            usedThoughtIds.add(thought.id);
          }
        } else {
          // It's already text content
          conclusionContent.push(item);
        }
      }
      
      // If we couldn't resolve any IDs to content, try to find thoughts by tag
      if (conclusionContent.length === 0) {
        const conclusionThoughts = sermon.thoughts?.filter(t => 
          t.tags?.some(tag => 
            tag.toLowerCase() === "заключение" || 
            tag.toLowerCase() === "conclusion" || 
            tag.toLowerCase() === "закінчення" || 
            tag.toLowerCase() === "заключення"
          ) && !usedThoughtIds.has(t.id)
        ) || [];
        
        conclusionContent = conclusionThoughts.map(t => {
          usedThoughtIds.add(t.id);
          return t.text;
        });
      }
      
      if (conclusionContent.length > 0) {
        sermonContent += "\n" + conclusionContent.join("\n");
      }
    }
    
    // For thoughts that are in the structure but not in any specific section
    if (sermon.structure.ambiguous && sermon.structure.ambiguous.length > 0) {
      sermonContent += "\n\nAdditional Thoughts:";
      let ambiguousContent: string[] = [];
      
      for (const item of sermon.structure.ambiguous) {
        // Check if item is a UUID
        if (item.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)) {
          const thought = thoughtsById.get(item);
          if (thought && thought.text && !usedThoughtIds.has(thought.id)) {
            ambiguousContent.push(thought.text);
            usedThoughtIds.add(thought.id);
          }
        } else {
          // It's already text content
          ambiguousContent.push(item);
        }
      }
      
      if (ambiguousContent.length > 0) {
        sermonContent += "\n" + ambiguousContent.join("\n");
      }
    }
  }
  
  // If we don't have meaningful content after all this, use a fallback message
  if (sermonContent.trim().length < 30) {
    if (isDebugMode) {
      console.log("Minimal sermon content detected, using fallback");
    }
    sermonContent = `This sermon with title "${sermon.title}" and reference "${sermon.verse}" appears to be in early stages of development with minimal content.`;
  }

  // Log content size for debugging and optimization
  if (isDebugMode) {
    console.log(`Content size: ${sermonContent.length} characters`);
  }
  
  return sermonContent;
}

/**
 * Parses OpenAI JSON response with standardized error handling
 * @param rawJson The raw JSON string from OpenAI
 * @param fieldName The expected field name in the response
 * @param functionName The calling function name for error messages
 * @returns The parsed result or null if failed
 */
export function parseAIResponse<T>(rawJson: string | null, fieldName: string, functionName: string): T[] | null {
  if (!rawJson) return null;
  
  try {
    const result = JSON.parse(rawJson);
    
    if (isDebugMode) {
      console.log(`DEBUG MODE: Parsed ${fieldName} from AI response:`, result[fieldName]);
    }
    
    if (Array.isArray(result[fieldName])) {
      return result[fieldName];
    }
    
    console.error(`${functionName}: Expected ${fieldName} field not found or not an array`);
    return null;
  } catch (jsonError) {
    console.error(`${functionName}: JSON parsing error:`, jsonError);
    return null;
  }
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
 * Logs timing information for AI operations
 * @param operation Name of the operation being timed
 * @param startTime Start time in milliseconds from performance.now()
 */
export function logOperationTiming(operation: string, startTime: number): void {
  const endTime = performance.now();
  const durationMs = endTime - startTime;
  const formattedDuration = formatDuration(durationMs);
  logger.info(operation, `Completed in ${formattedDuration}`);
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
  info: (module: string, message: string, data?: any) => {
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
  warn: (module: string, message: string, data?: any) => {
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
  error: (module: string, message: string, error?: any) => {
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
  debug: (module: string, message: string, data?: any) => {
    if (isDebugMode) {
      if (data) {
        console.log(`🔍 [${module}] ${message}`, data);
      } else {
        console.log(`🔍 [${module}] ${message}`);
      }
    }
  },
  
  /**
   * Log a success message
   * @param module The name of the module/component logging the success
   * @param message The success message
   * @param data Optional data to include with the success message
   */
  success: (module: string, message: string, data?: any) => {
    if (data) {
      console.log(`✅ [${module}] ${message}`, data);
    } else {
      console.log(`✅ [${module}] ${message}`);
    }
  }
}; 
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
  
  // Extract text from thoughts, removing empty or very short entries
  if (sermon.thoughts && sermon.thoughts.length > 0) {
    console.log(`Processing ${sermon.thoughts.length} thoughts`);
    
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
  } else {
    console.log("No thoughts found in sermon");
  }
  
  // Add content from sermon structure if available
  if (sermon.structure) {
    // Create a map from thought ID to thought object
    const thoughtsById = new Map<string, Thought>();
    const usedThoughtIds = new Set<string>();
    
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
          if (thought && thought.text) {
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
          if (thought && thought.text) {
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
          if (thought && thought.text) {
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
  }
  
  // If we don't have meaningful content after all this, use a fallback message
  if (sermonContent.trim().length < 30) {
    console.log("Minimal sermon content detected, using fallback");
    sermonContent = `This sermon with title "${sermon.title}" and reference "${sermon.verse}" appears to be in early stages of development with minimal content.`;
  }

  // Log content size for debugging and optimization
  console.log(`Content size: ${sermonContent.length} characters`);
  
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
 * Logs timing information for AI operations
 * @param operation Name of the operation being timed
 * @param startTime Start time in milliseconds
 */
export function logOperationTiming(operation: string, startTime: number): void {
  const endTime = Date.now();
  console.log(`${operation} completed in ${(endTime - startTime) / 1000} seconds`);
} 
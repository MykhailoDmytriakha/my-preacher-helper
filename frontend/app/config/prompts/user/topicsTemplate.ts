import { Sermon } from "@/models/models";

/**
 * Creates a user message for the AI sermon topics generation function
 * @param sermon The sermon to generate topics for
 * @param sermonContent The extracted content from the sermon
 * @returns A formatted user message string
 */
export function createTopicsUserMessage(
  sermon: Sermon,
  sermonContent: string
): string {
  return `
    Analyze this sermon and provide ONLY the main topics and themes:
    
    Sermon Title: ${sermon.title}
    Scripture Verse: ${sermon.verse}
    
    Sermon Content:
    ${sermonContent}
    
    Based on this sermon content, please provide:
    
    10 TOPICS: Identify the main topics and themes already present in the sermon. These should reflect the current direction of the sermon to help the preacher see where their thoughts are moving, serving as a first draft of a sermon plan.
    
    IMPORTANT: Your response should be in the EXACT SAME LANGUAGE as the sermon content - this is critically important. If the sermon is in Russian, respond in Russian. If the sermon is in Ukrainian, respond in Ukrainian. If the sermon is in English, respond in English.
  `;
} 
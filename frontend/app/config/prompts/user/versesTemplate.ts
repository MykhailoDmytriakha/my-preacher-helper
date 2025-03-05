import { Sermon } from "@/models/models";

/**
 * Creates a user message for the AI sermon verses generation function
 * @param sermon The sermon to generate related verses for
 * @param sermonContent The extracted content from the sermon
 * @returns A formatted user message string
 */
export function createVersesUserMessage(
  sermon: Sermon,
  sermonContent: string
): string {
  return `
    Analyze this sermon and provide ONLY related Bible verses:
    
    Sermon Title: ${sermon.title}
    Scripture Verse: ${sermon.verse}
    
    Sermon Content:
    ${sermonContent}
    
    Based on this sermon content, please provide:
    
    10 RELATED VERSES: Provide 10 Bible verses that connect to the sermon's themes. Include verses that offer new biblical perspectives on the same themes. IMPORTANT: Show ONLY verses that are NOT already mentioned in the sermon content/thoughts above. For each verse, explain its relevance to the sermon.
    
    IMPORTANT: Your response should be in the EXACT SAME LANGUAGE as the sermon content - this is critically important. If the sermon is in Russian, respond in Russian. If the sermon is in Ukrainian, respond in Ukrainian. If the sermon is in English, respond in English.
  `;
} 
import { Sermon } from "@/models/models";

/**
 * Creates a user message for the AI sermon research directions generation function
 * @param sermon The sermon to generate research directions for
 * @param sermonContent The extracted content from the sermon
 * @returns A formatted user message string
 */
export function createDirectionsUserMessage(
  sermon: Sermon,
  sermonContent: string
): string {
  return `
    Analyze this sermon and provide ONLY research directions:
    
    Sermon Title: ${sermon.title}
    Scripture Verse: ${sermon.verse}
    
    Sermon Content:
    ${sermonContent}
    
    Based on this sermon content, please provide:
    
    10 RESEARCH DIRECTIONS: Suggest 10 areas for further biblical exploration that might enrich the sermon:
       - Highlight different interpretations of the biblical text being discussed
       - Suggest historical or cultural context of the biblical passage that could add depth
       - Propose connections to other biblical narratives or teachings that relate to the theme
       - Recommend exploring theological concepts in the text from different angles
       - Suggest how the biblical passage applies to different life situations or contexts
       - Identify related biblical themes that could expand the sermon's impact
       - Propose ways to connect the biblical text to contemporary challenges
       - Suggest exploring how different biblical characters approached similar situations
       - Recommend looking at how different church traditions have interpreted this passage
       - Propose rhetorical or communication approaches from biblical examples
    
    IMPORTANT: Your response should be in the EXACT SAME LANGUAGE as the sermon content - this is critically important. If the sermon is in Russian, respond in Russian. If the sermon is in Ukrainian, respond in Ukrainian. If the sermon is in English, respond in English.
  `;
} 
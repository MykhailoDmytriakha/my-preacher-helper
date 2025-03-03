import { Sermon } from "@/models/models";

export function createInsightsUserMessage(
  sermon: Sermon,
  sermonContent: string
): string {
  return `
    Analyze this sermon and provide insights to help understand the current direction while also exploring biblical perspectives:
    
    Sermon Title: ${sermon.title}
    Scripture Verse: ${sermon.verse}
    
    Sermon Content:
    ${sermonContent}
    
    Based on this sermon content, please provide:
    
    1. TOPICS (10): Identify the main topics and themes already present in the sermon. These should reflect the current direction of the sermon to help the preacher see where their thoughts are moving, serving as a first draft of a sermon plan.
    
    2. RELATED VERSES (10): Provide 10 Bible verses that connect to the sermon's themes. Include both verses that support the existing sermon direction and verses that offer new biblical perspectives on the same themes. For each verse, explain its relevance to the sermon.
    
    3. RESEARCH DIRECTIONS (10): Suggest 10 areas for further biblical exploration that might enrich the sermon:
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
      
    IMPORTANT: Your goal is to help the preacher understand their current direction while also exploring the richness of biblical perspectives on their topic. The Bible is multifaceted (многогранна) and can be viewed from different angles - help the preacher explore these facets while staying true to the biblical text. Respond in the EXACT SAME LANGUAGE as the sermon content - this is critically important. If the sermon is in Russian, respond in Russian. If the sermon is in Ukrainian, respond in Ukrainian. If the sermon is in English, respond in English.
  `;
} 
import { Sermon } from "@/models/models";

/**
 * Creates a user message for the AI sermon brainstorm suggestion generation function
 * @param sermon The sermon to generate brainstorm suggestion for
 * @param sermonContent The extracted content from the sermon
 * @returns A formatted user message string
 */
export function createBrainstormUserMessage(
  sermon: Sermon,
  sermonContent: string
): string {
  return `
    Generate a single brainstorm suggestion to help the preacher overcome mental blocks and continue thinking:
    
    Sermon Title: ${sermon.title}
    Scripture Verse: ${sermon.verse}
    
    Current Sermon Content:
    ${sermonContent}
    
    TASK: Generate ONE thoughtful suggestion that will stimulate the preacher's thinking and help them break through creative blocks. This should be:
    
    1. ENCOURAGING rather than prescriptive - help them think, don't give answers
    2. QUESTION-ORIENTED to promote reflection and discovery
    3. EXPLORATION-FOCUSED to suggest new directions and perspectives
    4. BIBLICALLY-GROUNDED but not providing ready-made insights
    5. MOMENTUM-BUILDING to help them get unstuck and continue writing
    
    Choose one of these proven approaches based on what would be most helpful:
    
    - TEXT: Suggest ways to read or study the biblical text differently (different translations, original language insights, literary structure)
    - QUESTION: Pose thoughtful questions about the text, characters, themes, or contemporary applications
    - CONTEXT: Encourage exploration of historical, cultural, literary, or theological context that could unlock new insights
    - REFLECTION: Prompt personal, spiritual, or emotional reflection on the text and its meaning
    - RELATIONSHIP: Suggest examining relationships between biblical characters, concepts, themes, or connections to other passages
    - APPLICATION: Encourage thinking about contemporary relevance, practical applications, or unexpected connections to modern life
    
    BRAINSTORMING TECHNIQUES TO CONSIDER:
    - Look for unexpected connections between the text and everyday life
    - Explore different angles and perspectives on familiar passages
    - Find tension points that create compelling narrative
    - Identify problems the text addresses that people face today
    - Discover surprising elements that challenge assumptions
    - Make analogies that help complex concepts become relatable
    
    IMPORTANT: Your suggestion should help the preacher THINK MORE DEEPLY and CREATE MOMENTUM, not give them ready-made content. Focus on sparking their own creativity and insights. Respond in the EXACT SAME LANGUAGE as the sermon content - this is critically important. If the sermon is in Russian, respond in Russian. If the sermon is in Ukrainian, respond in Ukrainian. If the sermon is in English, respond in English.
  `;
} 
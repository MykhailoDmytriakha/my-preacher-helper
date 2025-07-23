import { Sermon } from "@/models/models";

/**
 * Analyzes the contextual richness of a sermon
 * @param sermon The sermon to analyze
 * @returns Object with contextual analysis
 */
function analyzeSermonContext(sermon: Sermon) {
  const thoughtsCount = sermon.thoughts?.length || 0;
  const uniqueTags = new Set(sermon.thoughts?.flatMap(t => t.tags || []) || []);
  const tagDiversity = uniqueTags.size;
  
  // Calculate content length
  const totalContentLength = sermon.thoughts?.reduce((sum, t) => sum + (t.text?.length || 0), 0) || 0;
  
  // Check for structure
  const hasStructure = sermon.structure && 
    (sermon.structure.introduction?.length > 0 || 
     sermon.structure.main?.length > 0 || 
     sermon.structure.conclusion?.length > 0);
  
  // Check for outline
  const hasOutline = sermon.outline && 
    (sermon.outline.introduction?.length > 0 || 
     sermon.outline.main?.length > 0 || 
     sermon.outline.conclusion?.length > 0);
  
  // Determine context richness level
  let contextLevel: 'minimal' | 'basic' | 'rich' | 'extensive' = 'minimal';
  
  if (thoughtsCount >= 20 && tagDiversity >= 8 && totalContentLength >= 3000) {
    contextLevel = 'extensive';
  } else if (thoughtsCount >= 10 && tagDiversity >= 5 && totalContentLength >= 1500) {
    contextLevel = 'rich';
  } else if (thoughtsCount >= 5 && tagDiversity >= 3) {
    contextLevel = 'basic';
  }
  
  return {
    thoughtsCount,
    tagDiversity,
    totalContentLength,
    hasStructure,
    hasOutline,
    contextLevel,
    uniqueTags: Array.from(uniqueTags)
  };
}

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
  const contextAnalysis = analyzeSermonContext(sermon);
  
  // Create context-aware instructions based on sermon richness
  let depthInstructions = "";
  let suggestionComplexity = "";
  
  switch (contextAnalysis.contextLevel) {
    case 'extensive':
      depthInstructions = `
EXTENSIVE CONTEXT DETECTED (${contextAnalysis.thoughtsCount} thoughts, ${contextAnalysis.tagDiversity} topic areas):
Generate a MULTI-DIMENSIONAL brainstorm suggestion that explores SEVERAL perspectives simultaneously. Your suggestion should:
- Combine 2-3 different thinking approaches (e.g., textual analysis + contemporary application + theological depth)
- Suggest connections between different themes present in the sermon
- Propose multi-layered exploration techniques
- Include specific references to the diverse content already present
- Challenge the preacher to synthesize different aspects of their material`;

      suggestionComplexity = `
COMPLEXITY LEVEL: HIGH
- Create sophisticated, layered suggestions that match the richness of existing content
- Reference specific themes or tensions you notice across multiple thoughts
- Suggest synthesis approaches that combine different theological/practical dimensions
- Include techniques for connecting disparate elements already present`;
      break;
      
    case 'rich':
      depthInstructions = `
RICH CONTEXT DETECTED (${contextAnalysis.thoughtsCount} thoughts, ${contextAnalysis.tagDiversity} topic areas):
Generate a DUAL-PERSPECTIVE brainstorm suggestion that explores TWO complementary angles. Your suggestion should:
- Combine different thinking approaches (e.g., historical context + modern application)
- Reference the variety of themes already developed
- Suggest deeper exploration of connections between existing thoughts
- Propose ways to bridge different aspects of the current content`;

      suggestionComplexity = `
COMPLEXITY LEVEL: MODERATE-HIGH
- Create suggestions that acknowledge the diversity of existing content
- Reference specific themes or patterns you observe
- Suggest ways to deepen or connect existing material
- Include both analytical and creative thinking approaches`;
      break;
      
    case 'basic':
      depthInstructions = `
DEVELOPING CONTEXT (${contextAnalysis.thoughtsCount} thoughts, ${contextAnalysis.tagDiversity} topic areas):
Generate a FOCUSED brainstorm suggestion that builds on existing foundations. Your suggestion should:
- Acknowledge the themes already present
- Suggest ways to expand or deepen current thinking
- Propose one clear direction for further development`;

      suggestionComplexity = `
COMPLEXITY LEVEL: MODERATE
- Build on the foundation already established
- Suggest clear next steps for development
- Reference existing themes while proposing expansion`;
      break;
      
    default:
      depthInstructions = `
EARLY DEVELOPMENT STAGE (${contextAnalysis.thoughtsCount} thoughts):
Generate a FOUNDATIONAL brainstorm suggestion to help establish core directions.`;

      suggestionComplexity = `
COMPLEXITY LEVEL: BASIC
- Focus on establishing strong foundations
- Suggest clear starting points for exploration`;
      break;
  }
  
  // Add tag-specific insights if diverse tags are present
  let tagInsights = "";
  if (contextAnalysis.tagDiversity >= 4) {
    tagInsights = `
THEMATIC DIVERSITY PRESENT: ${contextAnalysis.uniqueTags.join(', ')}
Consider how these different themes might connect or create productive tensions in your brainstorming.`;
  }

  return `
    Generate a single brainstorm suggestion to help the preacher overcome mental blocks and continue thinking:
    
    Sermon Title: ${sermon.title}
    Scripture Verse: ${sermon.verse}
    
    Current Sermon Content:
    ${sermonContent}
    
    ${depthInstructions}
    ${suggestionComplexity}
    ${tagInsights}
    
    TASK: Generate ONE thoughtful suggestion that will stimulate the preacher's thinking and help them break through creative blocks. This should be:
    
    1. ENCOURAGING rather than prescriptive - help them think, don't give answers
    2. QUESTION-ORIENTED to promote reflection and discovery
    3. EXPLORATION-FOCUSED to suggest new directions and perspectives
    4. BIBLICALLY-GROUNDED but not providing ready-made insights
    5. MOMENTUM-BUILDING to help them get unstuck and continue writing
    6. CONTEXT-AWARE - match the sophistication level to the existing content richness
    
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
    
    ${contextAnalysis.contextLevel === 'extensive' || contextAnalysis.contextLevel === 'rich' ? 
      `ADVANCED TECHNIQUES FOR RICH CONTENT:
    - Synthesis: Combine multiple themes or perspectives already present
    - Dialectical thinking: Explore tensions between different ideas in the content
    - Cross-referencing: Connect themes across different sections or thoughts
    - Meta-analysis: Step back and analyze patterns in the existing material
    - Integration challenges: Find ways to weave diverse elements into coherent narrative` : ''}
    
    IMPORTANT: Your suggestion should help the preacher THINK MORE DEEPLY and CREATE MOMENTUM, not give them ready-made content. Focus on sparking their own creativity and insights. ${contextAnalysis.contextLevel === 'extensive' || contextAnalysis.contextLevel === 'rich' ? 'Given the rich context available, provide a sophisticated suggestion that matches the depth of existing material and encourages synthesis of multiple dimensions.' : ''} Respond in the EXACT SAME LANGUAGE as the sermon content - this is critically important. If the sermon is in Russian, respond in Russian. If the sermon is in Ukrainian, respond in Ukrainian. If the sermon is in English, respond in English.
  `;
} 
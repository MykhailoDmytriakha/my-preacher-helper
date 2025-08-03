import { Sermon, OutlinePoint } from '@/models/models';

export function createPlanUserMessage(
  sermon: Sermon,
  section: string,
  sermonContent: string
): string {
  // Convert section to lowercase for standardization
  const sectionLower = section.toLowerCase();
  
  // Validate that section is one of the required values
  if (!['introduction', 'main', 'conclusion'].includes(sectionLower)) {
    throw new Error(`Invalid section: ${section}. Must be one of: introduction, main, conclusion`);
  }

  // Detect language - simple heuristic based on non-Latin characters
  const hasNonLatinChars = /[^\u0000-\u007F]/.test(sermon.title + sermon.verse);
  
  // Extract outline points for the specific section if available
  let outlinePointsText = '';
  if (sermon.outline && sermon.outline[sectionLower as keyof typeof sermon.outline]) {
    const outlinePoints = sermon.outline[sectionLower as keyof typeof sermon.outline] as OutlinePoint[];
    if (outlinePoints && outlinePoints.length > 0) {
      outlinePointsText = `\n\n==== MANDATORY OUTLINE STRUCTURE ====`;
      outlinePointsText += `\nThe following outline points MUST be used as the exact structure for your response:`;
      outlinePoints.forEach((point, index) => {
        outlinePointsText += `\n${index + 1}. ${point.text}`;
      });
      outlinePointsText += `\n\nCRITICAL REQUIREMENT: You MUST organize your entire outline following these exact points in precisely this order. Each point must be expanded with supporting content while maintaining the exact structure above. DO NOT add, remove, or modify any main points.`;
    }
  }

  const hasOutline = sermon.outline && 
                     sermon.outline[sectionLower as keyof typeof sermon.outline] && 
                     (sermon.outline[sectionLower as keyof typeof sermon.outline] as OutlinePoint[]).length > 0;

  return `Create a PREACHING-FRIENDLY outline for the ${sectionLower.toUpperCase()} section that can be quickly scanned during sermon delivery:

SERMON TITLE: ${sermon.title}
SCRIPTURE: ${sermon.verse}${outlinePointsText}

CONTENT:
${sermonContent}

CRITICAL REQUIREMENTS FOR PREACHING:

1. **MEMORY-FRIENDLY FORMAT**: 
   - Each main point should be 3-6 words maximum
   - Use **bold** for key concepts that trigger memory
   - Use *italic* for Bible references and supporting details
   - Create visual hierarchy for quick scanning

2. **INSTANT RECOGNITION**:
   - Every point should be immediately recognizable
   - Use memorable phrases that capture the essence
   - Include memory triggers that recall full context
   - Make each point actionable for the preacher

3. **QUICK SCANNING STRUCTURE**:
   - Use bullet points (*) for easy visual scanning
   - Keep subpoints to 1-2 words maximum
   - Use clear transitions between ideas
   - Structure for logical preaching flow

4. **PREACHING OPTIMIZATION**:
   - Focus on what the preacher needs to SAY
   - Include key theological terms in **bold**
   - Highlight Bible verses in *italic*
   - Use action-oriented language

MANDATORY BIBLE VERSE REQUIREMENT: 
CRITICAL: For every Bible reference mentioned, you MUST write out the COMPLETE TEXT of the verse(s) in the plan, not just the reference. 
Example: Instead of "Деян. 3:6", write "Деян. 3:6: «Серебра и золота нет у меня, а что имею, то даю тебе: во имя Иисуса Христа Назарея встань и ходи»"
The preacher must be able to read the full verse directly from the plan without opening a Bible.

THOUGHT FLOW REQUIREMENT:
Create a logical flow of thought development, showing how one idea naturally flows into the next. Each point should build upon the previous one, creating a smooth narrative progression rather than just a list of disconnected points.

LANGUAGE REQUIREMENT: Generate in the SAME LANGUAGE as the sermon content. DO NOT translate.

FORMAT EXAMPLE:
## **Main Concept** 
*Supporting detail or Bible reference*

* Key subpoint
* Another subpoint

RESPONSE LANGUAGE: Generate in the EXACT SAME LANGUAGE as the sermon content${hasNonLatinChars ? ' (non-English)' : ''}. DO NOT translate.

${hasOutline ? `STRUCTURAL REQUIREMENT: Follow the exact outline points provided above, but format them for quick preaching reference.` : `Create a well-structured outline optimized for preaching delivery.`}

FINAL CHECK: Each point should be scannable in under 2 seconds and immediately trigger the full context for the preacher.`;
}

/**
 * Creates a user message for the AI thoughts plan generation function
 * @param sermon The sermon to generate plan for
 * @param sermonContent The extracted content from the sermon
 * @returns A formatted user message string
 */
export function createThoughtsPlanUserMessage(
  sermon: Sermon,
  sermonContent: string
): string {
  return `
    Create a PREACHING-FRIENDLY plan structure from the preacher's thoughts:
    
    Sermon Title: ${sermon.title}
    Scripture Verse: ${sermon.verse}
    
    Preacher's Thoughts and Notes:
    ${sermonContent}
    
    Generate a plan optimized for quick scanning during preaching:
    
    INTRODUCTION: Create 2-3 memory-friendly points that can be quickly referenced to open the sermon effectively.
    
    MAIN PART: Organize into 3-5 key points, each with a memorable phrase that instantly recalls the full context.
    
    CONCLUSION: Provide 1-2 powerful closing points that can be quickly referenced for strong ending.
    
    CRITICAL REQUIREMENTS:
    - Use **bold** for key theological concepts and memory triggers
    - Use *italic* for Bible references and supporting details
    - Keep main points to 3-6 words maximum
    - Make each point immediately recognizable and actionable
    - Structure for quick visual scanning during preaching
    - Respond in the EXACT SAME LANGUAGE as the sermon content
    - Focus on organizing existing thoughts into preaching-friendly format
    - Use bullet points (*) for easy scanning
    - Create logical flow that guides the preacher naturally
    
    MANDATORY BIBLE VERSE REQUIREMENT: 
    CRITICAL: For every Bible reference mentioned, you MUST write out the COMPLETE TEXT of the verse(s) in the plan, not just the reference. 
    Example: Instead of "Деян. 3:6", write "Деян. 3:6: «Серебра и золота нет у меня, а что имею, то даю тебе: во имя Иисуса Христа Назарея встань и ходи»"
    The preacher must be able to read the full verse directly from the plan without opening a Bible.
    
    THOUGHT FLOW REQUIREMENT:
    Create a logical flow of thought development, showing how one idea naturally flows into the next. Each point should build upon the previous one, creating a smooth narrative progression rather than just a list of disconnected points.
    
    LANGUAGE REQUIREMENT: Generate in the SAME LANGUAGE as the sermon content. DO NOT translate.
  `;
} 
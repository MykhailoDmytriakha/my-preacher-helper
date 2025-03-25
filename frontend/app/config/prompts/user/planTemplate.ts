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

  return `Please generate a detailed outline for the ${sectionLower.toUpperCase()} section of the following sermon:

SERMON TITLE: ${sermon.title}
SCRIPTURE: ${sermon.verse}${outlinePointsText}

CONTENT:
${sermonContent}

IMPORTANT: 
1. Generate the outline in the SAME LANGUAGE as the sermon content${hasNonLatinChars ? ' (non-English)' : ''}. DO NOT translate.
2. DO NOT include "${sectionLower.toUpperCase()}" as a title or heading at the beginning of your response. Start directly with the content.
3. HEADING HIERARCHY: 
   - All main numbered points should use level 2 headings (##)
   - DO NOT use level 1 headings (#) for any points
   - Use proper Markdown structure (##, ### for subsections, etc.)

${hasOutline ? `FORMAT REQUIREMENT: 
1. Format your response in valid Markdown.
2. Main points MUST begin with the EXACT numbering and text from the outline structure provided above.
3. For subpoints, use proper Markdown hierarchical formatting:
   * First level subpoints should use asterisks (*)
     * Second level subpoints should use indented asterisks
       * Third level subpoints should use further indented asterisks
4. Ensure proper indentation to show the hierarchy visually.
5. Use concise, clear language for each point - keep subpoints to 1-2 short sentences maximum.
6. HIGHLIGHT KEY TERMS: Use **bold** formatting for important concepts, theological terms, and central ideas. Use *italic* formatting for scripture references, quotes, and secondary emphasis.
7. Keep all content well-organized and logically grouped under the appropriate point.
8. FOLLOW THE EXACT THOUGHT ORDER: Respect the logical flow of ideas exactly as presented. Do not rearrange, reorder, or restructure the user's intended progression of thoughts.

STRUCTURAL REQUIREMENT: Maintain the precise structure and ordering of the outline points above in your response. Your final outline must reflect exactly the same logical progression and organizational hierarchy.` : `Please create a well-structured outline in Markdown format specifically for the ${sectionLower} section of this sermon. DO NOT include "${sectionLower.toUpperCase()}" as a title at the beginning.

IMPORTANT: Follow the thoughts in the exact order as they appear in the sermon content.`}

Focus on the guidelines provided for ${sectionLower} sections.
${hasOutline ? `\nRemember: The success of this outline depends entirely on following the existing structure while adding valuable content under each predefined point.` : ''}

KEYWORD HIGHLIGHTING: Highlight key theological concepts, important terms, biblical principles, and central ideas using **bold** formatting. Use *italic* formatting for Bible references, quotes, and supporting points. This makes the outline more scannable and emphasizes the most important elements.

RESPONSE FORMAT: Your entire response must be in valid Markdown format that can be directly copied and used in a Markdown document. DO NOT include a heading with the section name (${sectionLower.toUpperCase()}) at the beginning of your response.

CRITICAL INSTRUCTION: 
1. INCLUDE ALL THOUGHTS from the original notes. Do not omit or skip ANY thought, example, verse reference, or point from the provided content.
2. Each and every element from the original notes, including all examples, translations, and specific questions must appear in your outline.
3. MAINTAIN ORIGINAL GROUPING: Thoughts must remain in their original sections. DO NOT move thoughts between different sections (e.g., from "Introduction" to "Main Points"). Each thought must appear under the SAME section heading as in the original notes.
4. PRESERVE ORIGINAL ORDER: The sequence of thoughts within each section must match the original notes exactly.
5. DO NOT ADD ANY CONTENT that isn't in the original notes. Do not add formal sermon structure elements like "hook", "roadmap", "thesis", "discussion goal", or similar terms unless they are explicitly mentioned in the original content. 
6. Do not add theological interpretations or applications that weren't in the original notes. 
7. Stay strictly within the content provided and only format what's there.
8. Double-check your output before submitting to ensure EVERY thought from the original notes is represented in its original section.
9. ALL BIBLE REFERENCES MUST BE PRESENT.
10. ALWAYS FIX GRAMMAR ERRORS: You MUST correct all spelling errors, syntax errors, punctuation, capitalization, and general grammar issues without changing the meaning or content. This includes:
    - Correct all misspelled words
    - Fix incorrect grammar structures
    - Correct punctuation and spacing issues
    - Ensure proper capitalization
    - Fix verb conjugations and noun declensions as appropriate
    Be thorough in finding and correcting ALL such errors while preserving the original meaning.
11. FIX HEADING/OUTLINE TITLES: You MUST correct any spelling or grammar errors in the main outline point titles/headings provided to you. For example, "приминение" should be corrected to "применение" in the heading itself. The corrected spelling should appear in both the heading and any subsequent references to it.
    - CAPITALIZATION: Ensure the first word of each main point starts with a capital letter (e.g., "Очевидное применение" not "очевидное применение")
    - Apply proper capitalization rules to proper nouns and terms as appropriate for the language
12. PROPER JSON FORMATTING: When outputting Markdown content within JSON:
    - Escape special characters properly (especially quotes, backslashes)
    - Use \\n for line breaks within the JSON string
    - Make sure all quotes within the Markdown are properly escaped with a backslash (\\")
    - Ensure the entire JSON structure is valid
    - Do not use literal line breaks in the JSON string - use \\n instead`;
} 
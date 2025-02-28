import { NextResponse } from 'next/server';
import { sermonsRepository } from '@repositories/sermons.repository';
import { Sermon, Insights } from '@/models/models';
import { adminDb } from 'app/config/firebaseAdminConfig';
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const gptModel = process.env.OPENAI_GPT_MODEL as string;
const isDebugMode = process.env.DEBUG_MODE === 'true';

// POST /api/insights?sermonId=<id>
export async function POST(request: Request) {
  console.log("Insights route: Received POST request for generating insights");
  
  try {
    const { searchParams } = new URL(request.url);
    const sermonId = searchParams.get("sermonId");
    
    if (!sermonId) {
      console.error("Insights route: sermonId is missing");
      return NextResponse.json({ error: "sermonId is required" }, { status: 400 });
    }
    
    // Fetch the sermon data
    const sermon = await sermonsRepository.fetchSermonById(sermonId) as Sermon;
    if (!sermon) {
      console.error(`Insights route: Sermon with id ${sermonId} not found`);
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }
    
    // Generate insights using OpenAI
    const insights = await generateSermonInsights(sermon);
    if (!insights) {
      console.error("Insights route: Failed to generate insights");
      return NextResponse.json({ error: "Failed to generate insights" }, { status: 500 });
    }
    
    // Update the sermon with insights using adminDb instead of client-side db
    const sermonDocRef = adminDb.collection("sermons").doc(sermonId);
    await sermonDocRef.update({ insights });
    console.log("Insights route: Updated sermon with generated insights");
    
    return NextResponse.json({ insights });
  } catch (error) {
    console.error('Insights route: Error generating insights:', error);
    return NextResponse.json({ error: 'Failed to generate insights' }, { status: 500 });
  }
}

/**
 * Generate insights for a sermon using OpenAI
 * @param sermon The sermon to generate insights for
 * @returns Generated insights or null if failed
 */
async function generateSermonInsights(sermon: Sermon): Promise<Insights | null> {
  try {
    console.log(`Starting insights generation for sermon: ${sermon.title}`);
    
    // Better extract meaningful content from the sermon
    let sermonContent = "";
    
    // Extract text from thoughts, removing empty or very short entries
    const thoughtTexts: string[] = [];
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
      
      // Add thoughts to both our collection and the sermon content
      thoughtTexts.push(...meaningfulThoughts);
      sermonContent = meaningfulThoughts.join("\n\n");
    } else {
      console.log("No thoughts found in sermon");
    }
    
    // Keep track of thoughts used by tag to avoid duplicates
    const usedThoughtIds = new Set<string>();
    
    // Add structure content if available - properly handle structure content
    if (sermon.structure) {
      console.log("Processing sermon structure");
      
      // Map to help us find thoughts by ID
      const thoughtsById = new Map();
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

    // Extract already covered themes and ideas through semantic analysis
    console.log(`Analyzing sermon content for themes in "${sermon.title || 'Untitled sermon'}"`);
    
    // Track runtime for analytics
    const startTime = Date.now();
    
    // Prepare sermon context
    const sermonContext = `
      Title: ${sermon.title || "Untitled Sermon"}
      Scripture: ${sermon.verse || "No verse provided"}
      
      Content:
      ${sermonContent}
    `;
    
    // Log content size for debugging and optimization
    console.log(`Content size: ${sermonContent.length} characters`);
    
    const userMessage = `
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
    
    if (isDebugMode) {
      console.log("DEBUG MODE: User message for insights:", userMessage);
    }
    
    // Call OpenAI API to generate insights
    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        { 
          role: "system", 
          content: "You are a theological analysis assistant with expertise in biblical studies, hermeneutics, exegesis, and sermon preparation. Your task is to analyze sermon content and provide insights that both clarify the current direction and explore biblical perspectives. The Bible is multifaceted (многогранна) and can be viewed from different angles - help the preacher explore these facets while staying true to the biblical text. First, thoroughly analyze the sermon to recognize themes and concepts already present. Then, suggest ways to explore these themes from different biblical perspectives. Respond with a JSON object containing 'topics' (array of strings), 'relatedVerses' (array of objects with 'reference' and 'relevance' fields), and 'possibleDirections' (array of objects with 'area' and 'suggestion' fields). The content may be in English, Russian, or Ukrainian - you MUST analyze it in whatever language it's provided and respond ONLY in the EXACT SAME LANGUAGE as the sermon content. This language matching is CRITICAL - if the sermon is in Ukrainian, your entire response must be in Ukrainian, if it's in Russian, respond entirely in Russian, etc."
        },
        { role: "user", content: userMessage },
      ],
      max_tokens: 2000
    });
    
    const rawJson = response.choices[0].message.content;
    
    // Log completion time
    const endTime = Date.now();
    console.log(`Insights generation completed in ${(endTime - startTime) / 1000} seconds`);
    
    if (isDebugMode) {
      console.log("DEBUG MODE: Raw API response for insights:", rawJson);
    }
    
    // Parse the response
    let result;
    try {
      result = JSON.parse(rawJson || "{}");
      
      // Debug logging to understand tone analysis (if available)
      if (isDebugMode && result.toneAnalysis) {
        console.log("DEBUG MODE: Detected sermon tone:", result.toneAnalysis);
      }
    } catch (jsonError) {
      console.error("generateSermonInsights: JSON parsing error:", jsonError);
      throw new Error("Invalid JSON structure from OpenAI");
    }
    
    // Transform the new structured format back to the expected format
    let topics = [];
    let relatedVerses = [];
    let possibleDirections = [];
    
    // Handle topics (simple array of strings)
    if (Array.isArray(result.topics)) {
      topics = result.topics.slice(0, 10); // Limit to 10 items
    }
    
    // Handle related verses (transform objects to strings)
    if (Array.isArray(result.relatedVerses)) {
      relatedVerses = result.relatedVerses.slice(0, 10).map((item: any) => {
        if (typeof item === 'string') return item;
        if (item && item.reference && item.relevance) {
          return `${item.reference} - ${item.relevance}`;
        }
        return JSON.stringify(item);
      });
    }
    
    // Handle possible directions (transform objects to strings)
    if (Array.isArray(result.possibleDirections)) {
      possibleDirections = result.possibleDirections.slice(0, 10).map((item: any) => {
        if (typeof item === 'string') return item;
        if (item && item.area && item.suggestion) {
          return `${item.area}: ${item.suggestion}`;
        }
        return JSON.stringify(item);
      });
    }
    
    // Validate the response has at least partial data
    if (!Array.isArray(topics) || !Array.isArray(relatedVerses) || !Array.isArray(possibleDirections)) {
      console.error("generateSermonInsights: Invalid JSON structure received", result);
      
      // Create fallback values if needed
      topics = topics || [`Key themes from ${sermon.title || "this sermon"}`];
      relatedVerses = relatedVerses || [`Verses related to ${sermon.verse || "the main scripture"}`];
      possibleDirections = possibleDirections || ["Consider the historical context of this passage"];
    }
    
    return {
      topics,
      relatedVerses,
      possibleDirections
    };
  } catch (error) {
    console.error("generateSermonInsights: OpenAI API Error:", error);
    return null;
  }
} 
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

// POST /api/insights/directions?sermonId=<id>
export async function POST(request: Request) {
  console.log("Directions route: Received POST request for generating possible directions");
  
  try {
    const { searchParams } = new URL(request.url);
    const sermonId = searchParams.get("sermonId");
    
    if (!sermonId) {
      console.error("Directions route: sermonId is missing");
      return NextResponse.json({ error: "sermonId is required" }, { status: 400 });
    }
    
    // Fetch the sermon data
    const sermon = await sermonsRepository.fetchSermonById(sermonId) as Sermon;
    if (!sermon) {
      console.error(`Directions route: Sermon with id ${sermonId} not found`);
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }
    
    // Get current insights to preserve other sections
    const currentInsights = sermon.insights || { topics: [], relatedVerses: [], possibleDirections: [] };
    
    // Generate possible directions using OpenAI
    const possibleDirections = await generateSermonDirections(sermon);
    if (!possibleDirections || possibleDirections.length === 0) {
      console.error("Directions route: Failed to generate possible directions");
      return NextResponse.json({ error: "Failed to generate possible directions" }, { status: 500 });
    }
    
    // Update the sermon with new directions but preserve other insights
    const updatedInsights: Insights = {
      ...currentInsights,
      possibleDirections
    };
    
    // Update the sermon with insights using adminDb instead of client-side db
    const sermonDocRef = adminDb.collection("sermons").doc(sermonId);
    await sermonDocRef.update({ insights: updatedInsights });
    console.log("Directions route: Updated sermon with generated possible directions");
    
    return NextResponse.json({ insights: updatedInsights });
  } catch (error) {
    console.error('Directions route: Error generating possible directions:', error);
    return NextResponse.json({ error: 'Failed to generate possible directions' }, { status: 500 });
  }
}

/**
 * Generate only possible directions for a sermon using OpenAI
 * @param sermon The sermon to generate possible directions for
 * @returns Generated possible directions array or empty array if failed
 */
async function generateSermonDirections(sermon: Sermon): Promise<string[]> {
  try {
    console.log(`Starting possible directions generation for sermon: ${sermon.title}`);
    
    // Extract content from the sermon to analyze
    let sermonContent = "";
    
    // Extract text from thoughts
    if (sermon.thoughts && sermon.thoughts.length > 0) {
      const meaningfulThoughts = sermon.thoughts
        .filter(t => t.text && t.text.trim().length > 10)
        .map(t => {
          if (t.tags && t.tags.length > 0) {
            return `[${t.tags.join(', ')}] ${t.text}`;
          }
          return t.text;
        });
      
      sermonContent = meaningfulThoughts.join("\n\n");
    }
    
    // Add content from sermon structure if available
    if (sermon.structure) {
      // Add intro content
      if (sermon.structure.introduction && sermon.structure.introduction.length > 0) {
        sermonContent += "\n\nIntroduction:\n" + sermon.structure.introduction.join("\n");
      }
      
      // Add main content
      if (sermon.structure.main && sermon.structure.main.length > 0) {
        sermonContent += "\n\nMain Part:\n" + sermon.structure.main.join("\n");
      }
      
      // Add conclusion content
      if (sermon.structure.conclusion && sermon.structure.conclusion.length > 0) {
        sermonContent += "\n\nConclusion:\n" + sermon.structure.conclusion.join("\n");
      }
    }
    
    // Prepare the sermon context
    const sermonContext = `
      Title: ${sermon.title || "Untitled Sermon"}
      Scripture: ${sermon.verse || "No verse provided"}
      
      Content:
      ${sermonContent}
    `;
    
    const userMessage = `
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
    
    // Call OpenAI API to generate possible directions
    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        { 
          role: "system", 
          content: "You are a theological analysis assistant with expertise in biblical studies. Your task is to analyze sermon content and suggest possible directions for further exploration. Respond with a JSON object containing 'possibleDirections' (array of objects with 'area' and 'suggestion' fields). The content may be in English, Russian, or Ukrainian - you MUST analyze it in whatever language it's provided and respond ONLY in the EXACT SAME LANGUAGE as the sermon content."
        },
        { role: "user", content: userMessage },
      ],
      max_tokens: 1000
    });
    
    const rawJson = response.choices[0].message.content;
    
    if (isDebugMode) {
      console.log("DEBUG MODE: Raw API response for possible directions:", rawJson);
    }
    
    // Parse the response
    let result;
    try {
      result = JSON.parse(rawJson || "{}");
    } catch (jsonError) {
      console.error("generateSermonDirections: JSON parsing error:", jsonError);
      return [];
    }
    
    // Transform and return the possible directions
    if (Array.isArray(result.possibleDirections)) {
      return result.possibleDirections.slice(0, 10).map((item: any) => {
        if (typeof item === 'string') return item;
        if (item && item.area && item.suggestion) {
          return `${item.area}: ${item.suggestion}`;
        }
        return JSON.stringify(item);
      });
    }
    
    // Fallback if no possible directions found
    return ["Consider the historical context of this passage"];
  } catch (error) {
    console.error("generateSermonDirections: OpenAI API Error:", error);
    return [];
  }
} 
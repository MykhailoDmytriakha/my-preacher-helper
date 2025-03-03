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

// POST /api/insights/verses?sermonId=<id>
export async function POST(request: Request) {
  console.log("Verses route: Received POST request for generating related verses");
  
  try {
    const { searchParams } = new URL(request.url);
    const sermonId = searchParams.get("sermonId");
    
    if (!sermonId) {
      console.error("Verses route: sermonId is missing");
      return NextResponse.json({ error: "sermonId is required" }, { status: 400 });
    }
    
    // Fetch the sermon data
    const sermon = await sermonsRepository.fetchSermonById(sermonId) as Sermon;
    if (!sermon) {
      console.error(`Verses route: Sermon with id ${sermonId} not found`);
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }
    
    // Get current insights to preserve other sections
    const currentInsights = sermon.insights || { topics: [], relatedVerses: [], possibleDirections: [] };
    
    // Generate related verses using OpenAI
    const relatedVerses = await generateSermonVerses(sermon);
    if (!relatedVerses || relatedVerses.length === 0) {
      console.error("Verses route: Failed to generate related verses");
      return NextResponse.json({ error: "Failed to generate related verses" }, { status: 500 });
    }
    
    // Update the sermon with new verses but preserve other insights
    const updatedInsights: Insights = {
      ...currentInsights,
      relatedVerses
    };
    
    // Update the sermon with insights using adminDb instead of client-side db
    const sermonDocRef = adminDb.collection("sermons").doc(sermonId);
    await sermonDocRef.update({ insights: updatedInsights });
    console.log("Verses route: Updated sermon with generated related verses");
    
    return NextResponse.json({ insights: updatedInsights });
  } catch (error) {
    console.error('Verses route: Error generating related verses:', error);
    return NextResponse.json({ error: 'Failed to generate related verses' }, { status: 500 });
  }
}

/**
 * Generate only related verses for a sermon using OpenAI
 * @param sermon The sermon to generate related verses for
 * @returns Generated related verses array or empty array if failed
 */
async function generateSermonVerses(sermon: Sermon): Promise<string[]> {
  try {
    console.log(`Starting related verses generation for sermon: ${sermon.title}`);
    
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
      Analyze this sermon and provide ONLY related Bible verses:
      
      Sermon Title: ${sermon.title}
      Scripture Verse: ${sermon.verse}
      
      Sermon Content:
      ${sermonContent}
      
      Based on this sermon content, please provide:
      
      10 RELATED VERSES: Provide 10 Bible verses that connect to the sermon's themes. Include both verses that support the existing sermon direction and verses that offer new biblical perspectives on the same themes. For each verse, explain its relevance to the sermon.
      
      IMPORTANT: Your response should be in the EXACT SAME LANGUAGE as the sermon content - this is critically important. If the sermon is in Russian, respond in Russian. If the sermon is in Ukrainian, respond in Ukrainian. If the sermon is in English, respond in English.
    `;
    
    // Call OpenAI API to generate related verses
    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        { 
          role: "system", 
          content: "You are a theological analysis assistant with expertise in biblical studies. Your task is to analyze sermon content and identify related Bible verses. Respond with a JSON object containing 'relatedVerses' (array of objects with 'reference' and 'relevance' fields). The content may be in English, Russian, or Ukrainian - you MUST analyze it in whatever language it's provided and respond ONLY in the EXACT SAME LANGUAGE as the sermon content."
        },
        { role: "user", content: userMessage },
      ],
      max_tokens: 1000
    });
    
    const rawJson = response.choices[0].message.content;
    
    if (isDebugMode) {
      console.log("DEBUG MODE: Raw API response for related verses:", rawJson);
    }
    
    // Parse the response
    let result;
    try {
      result = JSON.parse(rawJson || "{}");
    } catch (jsonError) {
      console.error("generateSermonVerses: JSON parsing error:", jsonError);
      return [];
    }
    
    // Transform and return the related verses
    if (Array.isArray(result.relatedVerses)) {
      return result.relatedVerses.slice(0, 10).map((item: any) => {
        if (typeof item === 'string') return item;
        if (item && item.reference && item.relevance) {
          return `${item.reference} - ${item.relevance}`;
        }
        return JSON.stringify(item);
      });
    }
    
    // Fallback if no related verses found
    return [`Verses related to ${sermon.verse || "the main scripture"}`];
  } catch (error) {
    console.error("generateSermonVerses: OpenAI API Error:", error);
    return [];
  }
} 
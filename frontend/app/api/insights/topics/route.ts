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

// POST /api/insights/topics?sermonId=<id>
export async function POST(request: Request) {
  console.log("Topics route: Received POST request for generating sermon topics");
  
  try {
    const { searchParams } = new URL(request.url);
    const sermonId = searchParams.get("sermonId");
    
    if (!sermonId) {
      console.error("Topics route: sermonId is missing");
      return NextResponse.json({ error: "sermonId is required" }, { status: 400 });
    }
    
    // Fetch the sermon data
    const sermon = await sermonsRepository.fetchSermonById(sermonId) as Sermon;
    if (!sermon) {
      console.error(`Topics route: Sermon with id ${sermonId} not found`);
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }
    
    // Get current insights to preserve other sections
    const currentInsights = sermon.insights || { topics: [], relatedVerses: [], possibleDirections: [] };
    
    // Generate topics using OpenAI
    const topics = await generateSermonTopics(sermon);
    if (!topics || topics.length === 0) {
      console.error("Topics route: Failed to generate topics");
      return NextResponse.json({ error: "Failed to generate topics" }, { status: 500 });
    }
    
    // Update the sermon with new topics but preserve other insights
    const updatedInsights: Insights = {
      ...currentInsights,
      topics
    };
    
    // Update the sermon with insights using adminDb instead of client-side db
    const sermonDocRef = adminDb.collection("sermons").doc(sermonId);
    await sermonDocRef.update({ insights: updatedInsights });
    console.log("Topics route: Updated sermon with generated topics");
    
    return NextResponse.json({ insights: updatedInsights });
  } catch (error) {
    console.error('Topics route: Error generating topics:', error);
    return NextResponse.json({ error: 'Failed to generate topics' }, { status: 500 });
  }
}

/**
 * Generate only topics for a sermon using OpenAI
 * @param sermon The sermon to generate topics for
 * @returns Generated topics array or empty array if failed
 */
async function generateSermonTopics(sermon: Sermon): Promise<string[]> {
  try {
    console.log(`Starting topics generation for sermon: ${sermon.title}`);
    
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
      Analyze this sermon and provide ONLY the main topics and themes:
      
      Sermon Title: ${sermon.title}
      Scripture Verse: ${sermon.verse}
      
      Sermon Content:
      ${sermonContent}
      
      Based on this sermon content, please provide:
      
      10 TOPICS: Identify the main topics and themes already present in the sermon. These should reflect the current direction of the sermon to help the preacher see where their thoughts are moving, serving as a first draft of a sermon plan.
      
      IMPORTANT: Your response should be in the EXACT SAME LANGUAGE as the sermon content - this is critically important. If the sermon is in Russian, respond in Russian. If the sermon is in Ukrainian, respond in Ukrainian. If the sermon is in English, respond in English.
    `;
    
    // Call OpenAI API to generate topics
    const response = await openai.chat.completions.create({
      model: gptModel,
      response_format: { type: "json_object" },
      messages: [
        { 
          role: "system", 
          content: "You are a theological analysis assistant with expertise in biblical studies. Your task is to analyze sermon content and identify the main topics and themes present. Respond with a JSON object containing 'topics' (array of strings). The content may be in English, Russian, or Ukrainian - you MUST analyze it in whatever language it's provided and respond ONLY in the EXACT SAME LANGUAGE as the sermon content."
        },
        { role: "user", content: userMessage },
      ],
      max_tokens: 1000
    });
    
    const rawJson = response.choices[0].message.content;
    
    if (isDebugMode) {
      console.log("DEBUG MODE: Raw API response for topics:", rawJson);
    }
    
    // Parse the response
    let result;
    try {
      result = JSON.parse(rawJson || "{}");
    } catch (jsonError) {
      console.error("generateSermonTopics: JSON parsing error:", jsonError);
      return [];
    }
    
    // Return the topics array
    if (Array.isArray(result.topics)) {
      return result.topics.slice(0, 10); // Limit to 10 items
    }
    
    // Fallback if no topics found
    return [`Key themes from ${sermon.title || "this sermon"}`];
  } catch (error) {
    console.error("generateSermonTopics: OpenAI API Error:", error);
    return [];
  }
} 
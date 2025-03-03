import { NextResponse } from 'next/server';
import { sermonsRepository } from '@repositories/sermons.repository';
import { Sermon, Insights } from '@/models/models';
import { adminDb } from 'app/config/firebaseAdminConfig';
import { generateSermonTopics } from '@clients/openAI.client';

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


import { NextResponse } from 'next/server';
import { sermonsRepository } from '@repositories/sermons.repository';
import { Sermon, Insights } from '@/models/models';
import { adminDb } from '@/config/firebaseAdminConfig';
import { generateSermonVerses } from '@clients/openAI.client';

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


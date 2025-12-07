import { NextResponse } from 'next/server';
import { sermonsRepository } from '@repositories/sermons.repository';
import { Sermon, Insights } from '@/models/models';
import { adminDb } from '@/config/firebaseAdminConfig';
import { generateSectionHints } from '@clients/openAI.client';

// POST /api/insights/plan?sermonId=<id>
export async function POST(request: Request) {
  console.log("Plan route: Received POST request for generating thoughts plan");
  
  try {
    const { searchParams } = new URL(request.url);
    const sermonId = searchParams.get("sermonId");
    
    if (!sermonId) {
      console.error("Plan route: sermonId is missing");
      return NextResponse.json({ error: "sermonId is required" }, { status: 400 });
    }
    
    // Fetch the sermon data
    const sermon = await sermonsRepository.fetchSermonById(sermonId) as Sermon;
    if (!sermon) {
      console.error(`Plan route: Sermon with id ${sermonId} not found`);
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }
    
    // Get current insights to preserve other sections
    const currentInsights = sermon.insights || { topics: [], relatedVerses: [], possibleDirections: [] };
    
    // Generate thoughts plan using OpenAI
    const sectionHints = await generateSectionHints(sermon);
    if (!sectionHints) {
      console.error("Plan route: Failed to generate thoughts plan");
      return NextResponse.json({ error: "Failed to generate thoughts plan" }, { status: 500 });
    }
    
    // Update the sermon with new plan but preserve other insights
    const updatedInsights: Insights = {
      ...currentInsights,
      sectionHints
    };
    
    // Update the sermon with insights using adminDb instead of client-side db
    const sermonDocRef = adminDb.collection("sermons").doc(sermonId);
    await sermonDocRef.update({ insights: updatedInsights });
    console.log("Plan route: Updated sermon with generated thoughts plan");
    
    return NextResponse.json({ insights: updatedInsights });
  } catch (error) {
    console.error('Plan route: Error generating thoughts plan:', error);
    return NextResponse.json({ error: 'Failed to generate thoughts plan' }, { status: 500 });
  }
} 
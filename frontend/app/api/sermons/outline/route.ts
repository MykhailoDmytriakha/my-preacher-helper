import { NextResponse } from 'next/server';

import { sermonsRepository } from '@repositories/sermons.repository';


// GET /api/sermons/outline?sermonId=<id>
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sermonId = searchParams.get("sermonId");
    
    if (!sermonId) {
      return NextResponse.json({ error: "sermonId is required" }, { status: 400 });
    }
    
    const outline = await sermonsRepository.fetchSermonOutlineBySermonId(sermonId);
    return NextResponse.json(outline);
  } catch (error: unknown) {
    if ((error as Error).message === "Sermon not found") {
      return NextResponse.json({ error: (error as Error).message }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to fetch sermon outline' }, { status: 500 });
  }
}

// PUT /api/sermons/outline?sermonId=<id>
export async function PUT(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const sermonId = searchParams.get("sermonId");
    
    if (!sermonId) {
      return NextResponse.json({ error: "sermonId is required" }, { status: 400 });
    }
    
    const { outline } = await request.json();
    console.log(`Updating sermon outline for sermon ${sermonId}`);
    console.log(`SermonOutline data:`, outline);
    
    if (!outline) {
      return NextResponse.json({ error: "SermonOutline data is required" }, { status: 400 });
    }
    
    // Use repository to update the sermon outline
    const updatedOutline = await sermonsRepository.updateSermonOutline(sermonId, outline);
    
    return NextResponse.json(updatedOutline);
  } catch (error: unknown) {
    if ((error as Error).message === "Sermon not found") {
      return NextResponse.json({ error: (error as Error).message }, { status: 404 });
    }
    console.error("Error updating sermon outline:", error);
    return NextResponse.json({ error: 'Failed to update sermon outline' }, { status: 500 });
  }
} 
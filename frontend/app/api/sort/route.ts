import { NextResponse } from 'next/server';
import { sermonsRepository } from '@repositories/sermons.repository';
import { Item, Sermon, OutlinePoint } from '@/models/models';
import { sortItemsWithAI } from '@clients/openAI.client';

/**
 * POST /api/sort
 * Sorts items within a column using AI
 */
export async function POST(request: Request) {
  console.log("Sort route: Received POST request for AI sorting");
  
  try {
    // Start execution time measurement
    const startTime = performance.now();
    
    const { columnId, items, sermonId, outlinePoints } = await request.json();

    if (!columnId || !items || !Array.isArray(items) || !sermonId) {
      console.error("Sort route: Missing required parameters", { columnId, itemsLength: items?.length, sermonId });
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });
    }

    console.log(`Sort route: Sorting ${items.length} items in column ${columnId} for sermon ${sermonId}`);

    // Fetch the sermon data for context
    const sermon = await sermonsRepository.fetchSermonById(sermonId) as Sermon;
    if (!sermon) {
      console.error(`Sort route: Sermon with id ${sermonId} not found`);
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }
    
    // Log item IDs for easier tracking
    console.log("Sort route: Items to sort (IDs):", items.map((item: Item) => item.id.slice(0, 4)).join(', '));
    
    // Perform the AI sorting
    const sortedItems = await sortItemsWithAI(columnId, items, sermon, outlinePoints);
    
    // Calculate execution time
    const executionTime = performance.now() - startTime;
    console.log(`AI sorting completed in ${executionTime.toFixed(2)}ms`);
    
    console.log(`Sort route: Successfully sorted ${sortedItems.length} items`);
    return NextResponse.json({ sortedItems });
  } catch (error) {
    console.error('Sort route: Error sorting items:', error);
    return NextResponse.json({ error: 'Failed to sort items' }, { status: 500 });
  }
}


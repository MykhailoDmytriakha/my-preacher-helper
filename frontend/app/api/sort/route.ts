import { NextResponse } from 'next/server';
import { sermonsRepository } from '@repositories/sermons.repository';
import { Item, Sermon, OutlinePoint } from '@/models/models';
import { sortItemsWithAI } from '@clients/openAI.client';

const MAX_THOUGHTS_FOR_SORTING = 25;

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

    // Filter out items that already have an outline point assigned
    const unassignedItems = items.filter(item => !item.outlinePointId);
    
    // Limit to MAX_THOUGHTS_FOR_SORTING (25)
    const itemsToSort = unassignedItems.slice(0, MAX_THOUGHTS_FOR_SORTING);
    
    console.log(`Sort route: Sorting ${itemsToSort.length} unassigned items (from total ${items.length}) in column ${columnId} for sermon ${sermonId}`);

    // Check if there are any items to sort
    if (itemsToSort.length === 0) {
      console.log("Sort route: No unassigned items to sort");
      return NextResponse.json({ sortedItems: items }, { status: 200 });
    }

    // Fetch the sermon data for context
    const sermon = await sermonsRepository.fetchSermonById(sermonId) as Sermon;
    if (!sermon) {
      console.error(`Sort route: Sermon with id ${sermonId} not found`);
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }
    
    // Log item IDs for easier tracking
    console.log("Sort route: Items to sort (IDs):", itemsToSort.map((item: Item) => item.id.slice(0, 4)).join(', '));
    
    // Perform the AI sorting
    const sortedUnassignedItems = await sortItemsWithAI(columnId, itemsToSort, sermon, outlinePoints);
    
    // Calculate execution time
    const executionTime = performance.now() - startTime;
    console.log(`AI sorting completed in ${executionTime.toFixed(2)}ms`);
    
    // Combine sorted unassigned items with the items that already had outline points assigned
    const assignedItems = items.filter(item => item.outlinePointId);
    const sortedItems = [...sortedUnassignedItems, ...assignedItems];
    
    console.log(`Sort route: Successfully sorted ${sortedUnassignedItems.length} unassigned items`);
    return NextResponse.json({ sortedItems });
  } catch (error) {
    console.error('Sort route: Error sorting items:', error);
    return NextResponse.json({ error: 'Failed to sort items' }, { status: 500 });
  }
}


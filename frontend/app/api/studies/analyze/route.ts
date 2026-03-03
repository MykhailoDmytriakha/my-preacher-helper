import 'openai/shims/node';

import { NextResponse } from 'next/server';

import { analyzeStudyNote } from '@clients/studyNote.structured';

/**
 * POST /api/studies/analyze
 * 
 * Analyze a study note using AI to extract:
 * - title: Short descriptive title
 * - scriptureRefs: Array of Scripture references found in the note
 * - tags: Suggested categorization tags
 * 
 * Request body:
 * {
 *   content: string;        // The note content to analyze
 *   existingTags?: string[]; // Optional existing tags to prefer
 *   analysisType?: 'all' | 'title' | 'tags' | 'scriptureRefs'; // What to analyze
 * }
 * 
 * Response:
 * {
 *   success: boolean;
 *   data?: {
 *     title: string;
 *     scriptureRefs: Array<{ book: string; chapter: number; fromVerse: number; toVerse?: number }>;
 *     tags: string[];
 *   };
 *   error?: string;
 * }
 */
export async function POST(request: Request) {
  console.log("Studies analyze route: Received POST request.");

  try {
    const body = await request.json();
    const { content, existingTags, analysisType } = body;

    // Validate required fields
    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Content is required and must be a string' },
        { status: 400 }
      );
    }

    if (content.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Content cannot be empty' },
        { status: 400 }
      );
    }

    // Validate existingTags if provided
    if (existingTags && !Array.isArray(existingTags)) {
      return NextResponse.json(
        { success: false, error: 'existingTags must be an array of strings' },
        { status: 400 }
      );
    }

    console.log("Studies analyze route: Analyzing note", {
      contentLength: content.length,
      existingTagsCount: existingTags?.length ?? 0,
      analysisType: analysisType || 'all',
    });

    // Call the AI analysis function
    const result = await analyzeStudyNote(content, existingTags, analysisType as 'all' | 'title' | 'tags' | 'scriptureRefs');

    if (!result.success) {
      console.error("Studies analyze route: Analysis failed", result.error);
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    console.log("Studies analyze route: Analysis successful", {
      title: result.data?.title,
      refsCount: result.data?.scriptureRefs?.length ?? 0,
      tagsCount: result.data?.tags?.length ?? 0,
    });

    return NextResponse.json({
      success: true,
      data: result.data,
    });

  } catch (error) {
    console.error('Studies analyze route: Error', error);
    return NextResponse.json(
      { success: false, error: 'Failed to analyze study note' },
      { status: 500 }
    );
  }
}


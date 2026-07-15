import 'openai/shims/node';

import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { usageCapResponse } from '@/api/errors/usageCapResponse';
import { isUsageCapReachedError } from '@/services/usageLimits';
import { analyzeStudyNote } from '@clients/studyNote.structured';
import { studiesRepository } from '@repositories/studies.repository';

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
    // Auth first: this route runs an AI model and meters usage, so the caller must
    // be authenticated and must own the study note (else an attacker could bill a
    // victim's tier/quota by passing someone else's studyId + arbitrary content).
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { content, existingTags, analysisType, studyId } = body;

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

    // studyId is optional. Analysis runs on the request-body `content` (the draft in
    // the editor) and is metered against the authenticated caller's uid — so there is
    // no victim to protect: the caller analyzes their own text and pays their own quota.
    // An unsaved draft ('new', missing, or not-yet-persisted because create is
    // fire-and-forget) is therefore allowed. When a study DOES exist and belongs to
    // someone else, we still refuse (defense-in-depth: don't act on a foreign resource).
    if (studyId && typeof studyId === 'string' && studyId !== 'new') {
      const study = await studiesRepository.getNote(studyId);
      if (study && study.userId !== uid) {
        return NextResponse.json(
          { success: false, error: 'Forbidden: you do not own this study note' },
          { status: 403 }
        );
      }
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
    const result = await analyzeStudyNote(
      content,
      existingTags,
      analysisType as 'all' | 'title' | 'tags' | 'scriptureRefs',
      uid
    );

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
    if (isUsageCapReachedError(error)) return usageCapResponse(error);
    console.error('Studies analyze route: Error', error);
    return NextResponse.json(
      { success: false, error: 'Failed to analyze study note' },
      { status: 500 }
    );
  }
}

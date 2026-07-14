import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdminEmail } from '@/api/admin/adminAuth';
import {
  aiFunctionIds,
  isFunctionCatalogTarget,
} from '@/api/clients/ai/functionCatalog';
import { providerIds } from '@/api/clients/ai/providerId';
import { adminDb } from '@/config/firebaseAdminConfig';
import { getAiModelDefaultsState } from '@/services/aiModelDefaults.server';

import type { AiFunctionId } from '@/api/clients/ai/functionCatalog';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
};

const targetSchema = z.object({
  providerId: z.enum(providerIds),
  modelId: z.string().min(1),
}).strict();

// Each function default is optional in a patch, but every persisted target feeds
// both entitlement display and the matching text/transcription/TTS execution path.
const defaultsPatchSchema = z.object({
  text: targetSchema.optional(),
  transcription: targetSchema.optional(),
  tts: targetSchema.optional(),
}).strict().refine(
  (patch) => Object.values(patch).some((value) => value !== undefined),
  { message: 'At least one function default is required' }
);

const jsonResponse = (body: unknown, status = 200): NextResponse =>
  NextResponse.json(body, { status, headers: NO_STORE_HEADERS });

export async function GET(request: Request): Promise<NextResponse> {
  const admin = await requireAdminEmail(request);
  if (!admin.ok) return admin.response;

  try {
    return jsonResponse(await getAiModelDefaultsState());
  } catch {
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const admin = await requireAdminEmail(request);
  if (!admin.ok) return admin.response;

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const patchResult = defaultsPatchSchema.safeParse(requestBody);
  if (!patchResult.success) {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const hasInvalidCatalogTarget = aiFunctionIds.some((fn: AiFunctionId) => {
    const target = patchResult.data[fn];
    return target !== undefined && !isFunctionCatalogTarget(fn, target);
  });
  if (hasInvalidCatalogTarget) {
    return jsonResponse({ error: 'Invalid model for function' }, 400);
  }

  try {
    await adminDb.collection('config').doc('aiModelDefaults').set(patchResult.data, { merge: true });
    return jsonResponse(await getAiModelDefaultsState());
  } catch {
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

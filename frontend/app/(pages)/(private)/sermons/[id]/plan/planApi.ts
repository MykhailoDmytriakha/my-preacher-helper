import { PlanStyle } from "@/api/clients/openAI.client";
import { apiClient } from '@/utils/apiClient';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { NotePlanResultSchema, type NotePlanResult } from '@/utils/notePlan';

import type { Plan } from "@/models/models";

interface GeneratePlanPointContentParams {
  sermonId: string;
  outlinePointId: string;
  style: PlanStyle;
}

interface GeneratePlanPointContentResponse {
  content: string;
}

interface SaveSermonPlanParams {
  sermonId: string;
  /**
   * ONLY the sections this save actually changed. The route writes each stated
   * section by its own nested path and leaves the rest alone, so an editor open since
   * last night no longer carries its stale copy of the other sections over a rewrite
   * made on another device.
   */
  plan: Partial<Plan>;
}

export async function generateNotePlanContent(
  params: GeneratePlanPointContentParams & { expectedContext: string },
  signal?: AbortSignal,
): Promise<NotePlanResult> {
  const { sermonId, ...body } = params;
  const response = await apiClient(`/api/sermons/${sermonId}/plan`, {
    method: 'POST', category: 'ai', cache: 'no-store', signal,
    headers: { ...await getAuthenticatedRequestHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const code = response.status === 409 ? 'contextChanged'
      : response.status === 422 ? 'sourceUnavailable'
      : response.status === 413 ? 'sourceTooLarge' : 'generationFailed';
    throw new Error(code);
  }
  return NotePlanResultSchema.parse(await response.json());
}

function createPlanGenerationRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function generatePlanPointContent({
  sermonId,
  outlinePointId,
  style,
}: GeneratePlanPointContentParams): Promise<GeneratePlanPointContentResponse> {
  const queryParams = new URLSearchParams({
    outlinePointId,
    style,
    requestId: createPlanGenerationRequestId(),
  });
  const authHeaders = await getAuthenticatedRequestHeaders();
  const response = await apiClient(`/api/sermons/${sermonId}/plan?${queryParams.toString()}`, {
    cache: "no-store",
    headers: authHeaders,
    category: 'ai',
  });

  if (!response.ok) {
    throw new Error(`Failed to generate content: ${response.status}`);
  }

  const data = await response.json();
  if (typeof data?.content !== "string") {
    throw new Error("Failed to generate content: invalid response payload");
  }

  return { content: data.content };
}

export async function saveSermonPlan({
  sermonId,
  plan,
}: SaveSermonPlanParams): Promise<void> {
  const authHeaders = await getAuthenticatedRequestHeaders();
  const response = await apiClient(`/api/sermons/${sermonId}/plan`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body: JSON.stringify(plan),
  });

  if (!response.ok) {
    throw new Error(`Failed to save plan: ${response.status}`);
  }
}

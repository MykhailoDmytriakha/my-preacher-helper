import { PlanStyle } from "@/api/clients/openAI.client";
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';

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
  plan: Plan;
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
  const response = await fetch(`/api/sermons/${sermonId}/plan?${queryParams.toString()}`, {
    cache: "no-store",
    headers: authHeaders,
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
  const response = await fetch(`/api/sermons/${sermonId}/plan`, {
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

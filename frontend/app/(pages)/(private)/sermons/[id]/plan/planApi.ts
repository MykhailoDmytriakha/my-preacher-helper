import { PlanStyle } from "@/api/clients/openAI.client";
import { withStatus } from '@/utils/aiTimeFailure';
import { apiClient } from '@/utils/apiClient';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { NotePlanResultSchema, type NotePlanResult, type NotePlanRevision } from '@/utils/notePlan';


interface GeneratePlanPointContentParams {
  sermonId: string;
  outlinePointId: string;
  style: PlanStyle;
}

interface GeneratePlanPointContentResponse {
  content: string;
}

export async function generateNotePlanContent(
  params: GeneratePlanPointContentParams & { expectedContext: string; targetNodeId?: string; revision?: NotePlanRevision },
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
    throw withStatus(new Error(`Failed to generate content: ${response.status}`), response.status);
  }

  const data = await response.json();
  if (typeof data?.content !== "string") {
    throw new Error("Failed to generate content: invalid response payload");
  }

  return { content: data.content };
}

import { PlanStyle } from "@/api/clients/openAI.client";
import { aiResultErrorCode } from '@/utils/aiResultAttempt.client';
import { AI_RESULT_OPERATION_HEADER, AI_RESULT_RECOVERY_ONLY_HEADER } from '@/utils/aiResultOperation';
import { withStatus } from '@/utils/aiTimeFailure';
import { apiClient } from '@/utils/apiClient';
import { accountChangedError, getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { NotePlanResultSchema, type NotePlanResult, type NotePlanRevision } from '@/utils/notePlan';
import { resolveOwnerUid } from '@/utils/queryKeys';


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

export async function generatePlanPointContent({
  sermonId,
  outlinePointId,
  style,
}: GeneratePlanPointContentParams, { ownerId, operationId, recoverOnly = false }: {
  ownerId: string;
  operationId: string;
  recoverOnly?: boolean;
}): Promise<GeneratePlanPointContentResponse> {
  const path = `/api/sermons/${encodeURIComponent(sermonId)}/plan?${new URLSearchParams({ outlinePointId, style })}`;
  const authHeaders = await getAuthenticatedRequestHeaders(ownerId);
  if (resolveOwnerUid() !== ownerId) throw accountChangedError();
  // The plan already keeps this identity in the proposal record before the request starts.
  const response = await apiClient(path, {
    cache: "no-store",
    headers: {
      ...authHeaders,
      [AI_RESULT_OPERATION_HEADER]: operationId,
      ...(recoverOnly && { [AI_RESULT_RECOVERY_ONLY_HEADER]: '1' }),
    },
    category: 'ai',
    timeout: 60_000,
  });
  const data = await response.json().catch(() => null);
  if (resolveOwnerUid() !== ownerId) throw accountChangedError();

  if (!response.ok) {
    throw Object.assign(withStatus(new Error(`Failed to generate content: ${response.status}`), response.status), {
      code: aiResultErrorCode(data),
      operationEnded: data?.operationEnded === true,
    });
  }

  if (typeof data?.content !== "string") {
    throw new Error("Failed to generate content: invalid response payload");
  }

  return { content: data.content };
}

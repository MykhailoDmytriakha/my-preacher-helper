import { PlanStyle } from "@/api/clients/openAI.client";
import { aiResultErrorCode } from '@/utils/aiResultAttempt.client';
import { AI_RESULT_OPERATION_HEADER, AI_RESULT_RECOVERY_ONLY_HEADER } from '@/utils/aiResultOperation';
import { withStatus } from '@/utils/aiTimeFailure';
import { apiClient } from '@/utils/apiClient';
import { APP_LANGUAGE_HEADER, type AppLocale } from '@/utils/appLocale';
import { accountChangedError, getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { NotePlanResultSchema, type NotePlanRequest, type NotePlanResult } from '@/utils/notePlan';
import { resolveOwnerUid } from '@/utils/queryKeys';


interface GeneratePlanPointContentParams {
  sermonId: string;
  outlinePointId: string;
  style: PlanStyle;
}

interface GeneratePlanPointContentResponse {
  content: string;
}

type PlanOperation = { ownerId: string; operationId: string; recoverOnly?: boolean };

function assertPlanOwner(ownerId?: string) {
  if (ownerId && resolveOwnerUid() !== ownerId) throw accountChangedError();
}

export async function generateNotePlanContent(
  params: NotePlanRequest & { sermonId: string },
  signal?: AbortSignal,
  operation?: PlanOperation & { language?: AppLocale },
): Promise<NotePlanResult> {
  const { sermonId, ...body } = params;
  const headers = await getAuthenticatedRequestHeaders(operation?.ownerId);
  assertPlanOwner(operation?.ownerId);
  const usedOperationHeaders = operation ? {
    [AI_RESULT_OPERATION_HEADER]: operation.operationId,
    ...(operation.language && { [APP_LANGUAGE_HEADER]: operation.language }),
    ...(operation.recoverOnly && { [AI_RESULT_RECOVERY_ONLY_HEADER]: '1' }),
  } : {};
  const response = await apiClient(`/api/sermons/${encodeURIComponent(sermonId)}/plan`, {
    method: 'POST', category: 'ai', cache: 'no-store', signal,
    headers: { ...headers, ...usedOperationHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(operation && { timeout: 60_000 }),
  });
  assertPlanOwner(operation?.ownerId);
  if (!response.ok) {
    const payload = operation ? await response.json().catch(() => null) : undefined;
    const message = response.status === 409 ? 'contextChanged'
      : response.status === 422 ? 'sourceUnavailable'
      : response.status === 413 ? 'sourceTooLarge' : 'generationFailed';
    throw Object.assign(withStatus(new Error(message), response.status), { code: aiResultErrorCode(payload) });
  }
  const result = NotePlanResultSchema.parse(await response.json());
  assertPlanOwner(operation?.ownerId);
  return result;
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
  assertPlanOwner(ownerId);
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
  assertPlanOwner(ownerId);

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

import { createHash, randomUUID } from 'node:crypto';

import { AiResultPendingError, AiResultReceiptConflict, AiResultUnavailableError, isAiResultRecoveryError } from '@/api/errors/aiResultRecovery.server';
import { AI_RESULT_CONFLICT, AI_RESULT_OPERATION_HEADER, AI_RESULT_PENDING, AI_RESULT_RECOVERY_ONLY_HEADER, AI_RESULT_UNAVAILABLE } from '@/utils/aiResultOperation';
import { serializeContent } from '@/utils/contentFingerprint';
import { withinDeadline } from '@/utils/withinDeadline';

import type { StructuredOutputResult } from '@/api/clients/structuredOutput';
import type { aiResultReceipt } from '@/data-engine/aiOperations.server';

const RUNNING_ATTEMPT_WINDOW_MS = 60_000;
/** Both text routes have a 60s platform wall and need time to assemble the reply. */
export const AI_RESULT_RESPONSE_BUDGET_MS = 56_000;

type StoreInput = Parameters<typeof aiResultReceipt>[0];
export type RecoverableAiResult<T> = StructuredOutputResult<T> & { completedAtMs?: number };
export type SettleParsedAiResult = (parsed: unknown) => Promise<void>;

export function recoverableAiResult(input: StoreInput & { deadline: number; recoverOnly?: boolean }) {
  const now = input.now ?? (() => new Date());

  const wait = <T>(work: () => Promise<T>) =>
    withinDeadline(work, input.deadline, () => new AiResultPendingError());

  async function preserveUncertainOutcome<T>(work: () => Promise<T>) {
    try {
      return await wait(work);
    } catch (error) {
      if (isAiResultRecoveryError(error)) throw error;
      // A failed acknowledgment does not say whether the write committed.
      throw new AiResultPendingError(error);
    }
  }

  return {
    operationId: input.operationId,
    async run<T>(
      parse: (value: unknown) => T,
      generate: (settleResult: SettleParsedAiResult) => Promise<StructuredOutputResult<T>>,
    ): Promise<RecoverableAiResult<T>> {
      const { aiResultReceipt: createReceipt } = await import('@/data-engine/aiOperations.server');
      const receipt = createReceipt(input);
      let claim = input.recoverOnly
        ? await preserveUncertainOutcome(() => receipt.read())
        : await preserveUncertainOutcome(() => receipt.claim());
      if (!claim) throw new AiResultUnavailableError();
      const expiredBefore = now().getTime() - RUNNING_ATTEMPT_WINDOW_MS;
      if (claim.state === 'running' && claim.startedAtMs <= expiredBefore) {
        claim = await preserveUncertainOutcome(() => receipt.expireRunning(expiredBefore));
      }
      switch (claim.state) {
        case 'ready':
        case 'settled': {
          const { value, completedAtMs } = await preserveUncertainOutcome(() => receipt.settle());
          return { success: true, data: parse(value), refusal: null, error: null, completedAtMs };
        }
        case 'running':
          throw new AiResultPendingError();
        case 'failed':
          throw new AiResultUnavailableError();
      }

      let publicationStarted = false;
      let completedAtMs: number | undefined;
      try {
        const result = await generate(async parsed => {
          publicationStarted = true;
          ({ completedAtMs } = await preserveUncertainOutcome(async () => {
            await claim.save(parsed);
            return receipt.settle();
          }));
        });
        if (result.error instanceof AiResultPendingError) throw result.error;
        if (result.success && completedAtMs === undefined) {
          throw new Error('A successful AI result was not settled');
        }
        return { ...result, completedAtMs };
      } finally {
        // Only an attempt that did not start publishing can be marked failed.
        // The result may have reached the store even when its acknowledgment did not.
        if (!publicationStarted) await wait(() => claim.fail()).catch(() => undefined);
      }
    },
  };
}

export type AiResultRecovery = ReturnType<typeof recoverableAiResult>;

export function aiResultRecoveryForRequest(
  request: Request,
  { ownerId, source, deadline }: { ownerId: string; source: unknown; deadline: number },
) {
  const operationId = request.headers.get(AI_RESULT_OPERATION_HEADER) ?? randomUUID();
  const fingerprint = createHash('sha256').update(serializeContent(source)).digest('hex');
  return {
    operationId,
    recovery: recoverableAiResult({
      ownerId, operationId, fingerprint, deadline,
      recoverOnly: request.headers.get(AI_RESULT_RECOVERY_ONLY_HEADER) === '1',
    }),
  };
}

export function aiResultRecoveryRefusal(error: unknown) {
  if (error instanceof AiResultPendingError) {
    return { status: 504, body: { code: AI_RESULT_PENDING, error: error.message } };
  }
  if (error instanceof AiResultUnavailableError) {
    return { status: 409, body: { code: AI_RESULT_UNAVAILABLE, error: error.message } };
  }
  if (error instanceof AiResultReceiptConflict) {
    return { status: 409, body: { code: AI_RESULT_CONFLICT, error: error.message } };
  }
  return null;
}

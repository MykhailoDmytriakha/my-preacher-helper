import { serviceOrderStepHistoryResponse } from '@/api/data-engine/serviceOrderStepHistory.server';
import { listServiceOrderStepTitleHistory } from '@/data-engine/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request, context: Parameters<typeof serviceOrderStepHistoryResponse>[1]): Promise<Response> {
  return serviceOrderStepHistoryResponse(request, context, listServiceOrderStepTitleHistory);
}

import { readDocumentRowHistory } from '@/data-engine/serverOperations.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request, context: Parameters<typeof readDocumentRowHistory>[1]): Promise<Response> {
  return readDocumentRowHistory(request, context, 'planMode');
}

/** Read presentation is independent of the rows retained on this device. */
export type ListReadState = 'ready' | 'loading' | 'incomplete' | 'failed';
export interface ListReadSource {
  loading?: boolean;
  error?: unknown;
  complete?: boolean;
  checking?: boolean;
}

/** A combined total or absence claim requires every contributing source to have answered. */
export function listReadState(...sources: readonly ListReadSource[]): ListReadState {
  if (sources.some(source => Boolean(source.error))) return 'failed';
  if (sources.some(source => source.loading || (source.complete === false && source.checking))) return 'loading';
  if (sources.some(source => source.complete === false)) return 'incomplete';
  return 'ready';
}

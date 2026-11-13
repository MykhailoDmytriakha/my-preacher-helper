/** The worker supplies this header only when a Bible asset cannot reach the network. */
// Keep the wire name for clients running under the previous worker.
export const BIBLE_ASSET_NETWORK_FAILURE_HEADER = 'x-bible-text-network-failure';

export const isBibleAssetNetworkFailure = (response: Response): boolean =>
  response.headers?.get(BIBLE_ASSET_NETWORK_FAILURE_HEADER) === '1';

export function unavailableBibleAsset(): Response {
  return new Response(null, { status: 503, headers: { [BIBLE_ASSET_NETWORK_FAILURE_HEADER]: '1' } });
}

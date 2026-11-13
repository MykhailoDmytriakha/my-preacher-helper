import { isBibleAssetNetworkFailure } from './bibleAssetResponse';
import { beginConnectivityRequest, reportServerUnreachable } from './connectivity';

/** Cache hits cannot confirm connectivity. Report a network failure once per load cycle. */
export function bibleAssetFetch(mayReportFailure: () => boolean): typeof fetch {
  return async (...args) => {
    const started = beginConnectivityRequest();
    const reportFailure = () => reportServerUnreachable(started, mayReportFailure);
    // The loader's deadline also aborts a response whose headers arrived but whose body stalled.
    args[1]?.signal?.addEventListener('abort', reportFailure, { once: true });
    try {
      const response = await fetch(...args);
      if (isBibleAssetNetworkFailure(response)) reportFailure();
      return response;
    } catch (error) {
      reportFailure();
      throw error;
    }
  };
}

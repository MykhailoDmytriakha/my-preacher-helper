import { useEffect, useState } from 'react';

import { serializeContent } from '@/utils/contentFingerprint';

import { planResultDigest } from './planResultInbox.client';

export type PlanOriginCheck = {
  id: string;
  cells: Record<string, string>;
  context: string;
  openingKey: string;
  contextKey: string;
};

export function usePlanResultOriginChecks(checks: PlanOriginCheck[]) {
  // The words and structure, rather than the current object identity, define a reproducible check.
  const signature = serializeContent(checks);
  const [result, setResult] = useState<{ signature: string; matches: Record<string, boolean> }>();
  useEffect(() => {
    const inputs = JSON.parse(signature) as PlanOriginCheck[];
    if (!inputs.length) return;
    let active = true;
    void Promise.all(inputs.map(async ({ id, cells, context, openingKey, contextKey }) => {
      const keys = await Promise.all([planResultDigest(serializeContent(cells)), planResultDigest(context)]);
      return [id, keys[0] === openingKey && keys[1] === contextKey] as const;
    })).then(entries => {
      if (active) setResult({ signature, matches: Object.fromEntries(entries) });
    });
    return () => { active = false; };
  }, [signature]);
  return result?.signature === signature ? result.matches : undefined;
}

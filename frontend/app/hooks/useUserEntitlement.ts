import { useQuery } from '@tanstack/react-query';

import type { AiFunctionId, FunctionCatalogEntry } from '@/api/clients/ai/functionCatalog';
import type { TierLimits } from '@/api/clients/ai/tierPolicy';
import type { Tier, UserEntitlement } from '@/models/models';
import type { UsageRemaining } from '@/services/usageLimits.server';
import type { User } from 'firebase/auth';

export const USER_ENTITLEMENT_QUERY_KEY = ['me', 'entitlement', 'v2'] as const;

export interface UserEntitlementResponse {
  effectiveTier: Tier;
  functions: Record<AiFunctionId, {
    available: FunctionCatalogEntry[];
    current: { providerId: FunctionCatalogEntry['providerId']; modelId: string };
  }>;
  usage: UsageRemaining;
  limits: TierLimits;
  paidTier: Tier;
  promotion?: UserEntitlement['promotion'];
}

export async function fetchUserEntitlement(user: Pick<User, 'getIdToken'>): Promise<UserEntitlementResponse> {
  const token = await user.getIdToken();
  const response = await fetch('/api/me/entitlement', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error('Could not load entitlement');
  }

  return response.json() as Promise<UserEntitlementResponse>;
}

export function useUserEntitlement(user: User | null) {
  return useQuery({
    queryKey: [...USER_ENTITLEMENT_QUERY_KEY, user?.uid ?? null],
    queryFn: () => fetchUserEntitlement(user as User),
    enabled: Boolean(user),
  });
}

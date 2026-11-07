import { useQuery } from '@tanstack/react-query';

import { accountReadHttpFailure, accountReadQuery } from '@/utils/accountReadQuery';
import { accountReadFromResponse, accountReadValue, type AccountRead } from '@/utils/accountReadVersion';
import { apiClient } from '@/utils/apiClient';

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

async function readUserEntitlement(user: Pick<User, 'getIdToken'>): Promise<AccountRead<UserEntitlementResponse>> {
  const token = await user.getIdToken();
  const response = await apiClient('/api/me/entitlement', { category: 'metadata',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw accountReadHttpFailure(response.status, 'Could not load entitlement');
  }

  return accountReadFromResponse(response, await response.json() as UserEntitlementResponse);
}

export async function fetchUserEntitlement(user: Pick<User, 'getIdToken'>): Promise<UserEntitlementResponse> {
  return accountReadValue(await readUserEntitlement(user));
}

export function userEntitlementQuery(user: User | null) {
  return {
    ...accountReadQuery([...USER_ENTITLEMENT_QUERY_KEY, user?.uid ?? null], () => readUserEntitlement(user!)),
    enabled: Boolean(user),
  };
}

export function useUserEntitlement(user: User | null) {
  return useQuery(userEntitlementQuery(user));
}

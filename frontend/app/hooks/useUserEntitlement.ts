import { useQuery } from '@tanstack/react-query';

import type { AiFunctionId, FunctionCatalogEntry } from '@/api/clients/ai/functionCatalog';
import type { Tier, UserEntitlement } from '@/models/models';
import type { User } from 'firebase/auth';

export interface UserEntitlementResponse {
  effectiveTier: Tier;
  functions: Record<AiFunctionId, {
    available: FunctionCatalogEntry[];
    current: { providerId: FunctionCatalogEntry['providerId']; modelId: string };
  }>;
  usage: {
    aiLimit: number;
    aiUsed: number;
    aiRemaining: number;
    transcriptionSecondsLimit: number;
    transcriptionSecondsUsed: number;
    transcriptionSecondsRemaining: number;
    aiBlocked: boolean;
    transcriptionBlocked: boolean;
    periodResets: boolean;
  };
  limits: {
    aiCallsPerPeriod: number;
    transcriptionSecondsPerPeriod: number;
  };
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
    queryKey: ['me', 'entitlement', user?.uid ?? null],
    queryFn: () => fetchUserEntitlement(user as User),
    enabled: Boolean(user),
  });
}

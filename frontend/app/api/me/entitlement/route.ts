import { NextResponse } from 'next/server';

import { aiFunctionIds, getFunctionCatalog, getFunctionDefault } from '@/api/clients/ai/functionCatalog';
import { TIER_LIMITS } from '@/api/clients/ai/tierPolicy';
import { adminAuth } from '@/config/firebaseAdminConfig';
import { getAiModelDefaults } from '@/services/aiModelDefaults.server';
import { resolveUsageRemaining } from '@/services/usageLimits.server';
import { getUserEntitlementServerSide, resolveEffectiveTier } from '@/services/userEntitlement.server';

import type { AiFunctionId, FunctionCatalogEntry } from '@/api/clients/ai/functionCatalog';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
} as const;

const jsonNoStore = (body: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  Object.entries(NO_STORE_HEADERS).forEach(([key, value]) => headers.set(key, value));
  return NextResponse.json(body, { ...init, headers });
};

const getBearerToken = (request: Request): string | null => {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length).trim() || null;
};

async function getAuthenticatedUid(request: Request): Promise<string | null> {
  const token = getBearerToken(request);
  if (!token) return null;

  try {
    return (await adminAuth.verifyIdToken(token)).uid || null;
  } catch {
    return null;
  }
}

const sameTarget = (
  left: { providerId: string; modelId: string } | undefined,
  right: { providerId: string; modelId: string }
) => left?.providerId === right.providerId && left.modelId === right.modelId;

const getAllowedFunctionModels = (
  fn: AiFunctionId,
  effectiveTier: string,
  configuredDefault: FunctionCatalogEntry
): FunctionCatalogEntry[] =>
  effectiveTier === 'free'
    ? [configuredDefault]
    : getFunctionCatalog(fn);

/** Returns entitlement for the Firebase caller only; no caller-supplied UID is accepted. */
export async function GET(request: Request) {
  const uid = await getAuthenticatedUid(request);
  if (!uid) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });

  try {
    const [entitlement, configuredDefaults] = await Promise.all([
      getUserEntitlementServerSide(uid, { includeModelPreferences: true }),
      getAiModelDefaults(),
    ]);
    const now = new Date();
    const effectiveTier = resolveEffectiveTier(entitlement, now);
    const preferences = {
      // Existing settings documents keep working until the user changes this preference.
      text: entitlement.preferredText ?? (
        entitlement.preferredProviderId && entitlement.preferredModelId
          ? { providerId: entitlement.preferredProviderId, modelId: entitlement.preferredModelId }
          : undefined
      ),
      transcription: entitlement.preferredTranscription,
      tts: entitlement.preferredTts,
    };
    const functions = Object.fromEntries(aiFunctionIds.map((fn) => {
      const catalogModels = getFunctionCatalog(fn);
      const configuredDefault = catalogModels.find((entry) =>
        sameTarget(configuredDefaults[fn], entry)) ?? getFunctionDefault(fn);
      const available = getAllowedFunctionModels(fn, effectiveTier, configuredDefault);
      const current = available.find((entry) => sameTarget(preferences[fn], entry)) ?? configuredDefault;
      // `current` is resolved only from `available`: a stored paid choice cannot
      // become a privilege grant after a downgrade or expired promotion.
      return [fn, {
        available,
        current: { providerId: current.providerId, modelId: current.modelId },
      }];
    }));

    return jsonNoStore({
      effectiveTier,
      functions,
      usage: resolveUsageRemaining(entitlement, now),
      limits: TIER_LIMITS[effectiveTier],
      paidTier: entitlement.paidTier,
      ...(entitlement.promotion ? { promotion: entitlement.promotion } : {}),
    });
  } catch (error) {
    console.error('me/entitlement: failed to read entitlement', error);
    return jsonNoStore({ error: 'Internal server error' }, { status: 500 });
  }
}

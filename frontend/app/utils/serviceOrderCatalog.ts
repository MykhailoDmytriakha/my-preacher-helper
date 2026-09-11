import { newClientId } from '@/utils/clientId';
import { RANK_STEP } from '@/utils/serviceOrderRank';

import type { ServiceOrder, ServiceOrderCatalogKey, ServiceOrderStep } from '@/models/models';

/**
 * THE STANDARD SET, AND WHAT IT IS ALLOWED TO CONTAIN.
 *
 * Ten rites a Slavic evangelical pastor performs, in the order they are offered. Each one
 * arrives as a SEQUENCE OF STEP TITLES and nothing else: no prayer, no formula, no wording.
 * That boundary is the product decision, not an omission — a pastor's words belong to his
 * church and his conscience, and an app that shipped them would quietly hand him another
 * tradition's service to read out. The owner asked for the starting sequence in those terms.
 *
 * The text itself lives in the locale files, so the set arrives in the language he uses.
 */
export const SERVICE_ORDER_CATALOG: ServiceOrderCatalogKey[] = [
  'funeral',
  'wedding',
  'baptism',
  'communion',
  'childBlessing',
  'visit',
  'ordination',
  'membership',
  'anointing',
  'houseBlessing',
];

/** Anything that is not a non-empty string is dropped: a locale can be missing a line. */
export function normalizeSteps(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((step): step is string => typeof step === 'string' && step.trim().length > 0)
    : [];
}

type Translate = (key: string, options?: Record<string, unknown>) => unknown;

/**
 * Builds the documents for the standard set. `startRank` lets a partial seed land after
 * whatever the pastor already has, so nothing jumps above an order he arranged himself.
 */
export function buildSeedOrders(
  userId: string,
  t: Translate,
  keys: ServiceOrderCatalogKey[] = SERVICE_ORDER_CATALOG,
  startRank: number = RANK_STEP
): Omit<ServiceOrder, 'id'>[] {
  const now = new Date().toISOString();

  return keys.map((key, index) => {
    const titles = normalizeSteps(t(`serviceOrders.catalog.${key}.steps`, { returnObjects: true }));
    const steps: ServiceOrderStep[] = titles.map((title) => ({
      id: newClientId(),
      title,
      body: '',
      scriptureRefs: [],
    }));

    const title = t(`serviceOrders.catalog.${key}.title`);
    const summary = t(`serviceOrders.catalog.${key}.summary`);

    return {
      userId,
      catalogKey: key,
      title: typeof title === 'string' ? title : key,
      summary: typeof summary === 'string' ? summary : '',
      steps,
      rank: startRank + index * RANK_STEP,
      createdAt: now,
      updatedAt: now,
    };
  });
}

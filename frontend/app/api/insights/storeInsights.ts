import { writeOwnedDocument } from '@/data-engine/serverEdit.server';
import { sermonsRepository } from '@repositories/sermons.repository';

import type { DocumentData } from '@/data-engine/types';
import type { Insights } from '@/models/models';

const EMPTY: Insights = { topics: [], relatedVerses: [], possibleDirections: [] };

/**
 * Stores generated insights and returns what the sermon holds afterwards.
 *
 * `change` receives the insights the sermon holds AT WRITE TIME. On an engine document that is the
 * current copy, so two generations running side by side (topics and verses) keep each other's
 * section; the legacy road keeps its old behaviour and applies the change to the copy read before
 * the AI call.
 */
export async function storeInsights(owner: string, sermonId: string, readBefore: Insights | undefined,
  change: (current: Insights) => Insights): Promise<Insights> {
  const legacyValue = change(readBefore ?? EMPTY);
  const accepted = await writeOwnedDocument({
    owner,
    resource: { collection: 'sermons', id: sermonId },
    legacy: () => sermonsRepository.updateSermonData(sermonId, { insights: legacyValue }, 'insights'),
    engine: current => ({
      ...current,
      insights: change((current.insights as unknown as Insights | undefined) ?? EMPTY) as unknown as DocumentData,
      updatedAt: new Date().toISOString(),
    }),
  });
  return accepted ? accepted.insights as unknown as Insights : legacyValue;
}

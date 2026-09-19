import { compareById, timeOrZero } from '@/utils/sortHelpers';

import type { Sermon } from '@/models/models';

/**
 * Mirrors the server hydration (sermons.repository.fetchSermonById): keep the
 * modern field and its legacy alias in sync so consumers see the same shape
 * whether the doc stored `thoughtsBySection`/`structure` or `draft`/`plan`.
 */
export function hydrateSermon(raw: Sermon): Sermon {
  const sermon: Sermon = { ...raw };

  const hydratedStructure = raw.thoughtsBySection || raw.structure;
  if (hydratedStructure) {
    sermon.thoughtsBySection = hydratedStructure;
    sermon.structure = raw.structure || hydratedStructure;
  }

  const hydratedDraft = raw.draft || raw.plan;
  if (hydratedDraft) {
    sermon.draft = hydratedDraft;
    sermon.plan = raw.plan || hydratedDraft;
  }

  return sermon;
}

export function sortSermons(sermons: Sermon[]): Sermon[] {
  return [...sermons].sort((a, b) => {
    const byDate = timeOrZero(b.date) - timeOrZero(a.date);
    if (byDate !== 0) return byDate;
    return compareById(a, b);
  });
}


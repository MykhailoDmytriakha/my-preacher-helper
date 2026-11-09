'use client';

import { TagHistory } from '@/components/ui/TagHistory';

import type { ThoughtTagHistoryPage } from '@/data-engine/thoughtTagAction';
import type { Thought } from '@/models/models';

export function ThoughtTagHistory({ owner, sermonId, generation, thought, disabled, onRestore }: {
  owner: string; sermonId: string; generation: string; thought: Thought; disabled: boolean;
  onRestore: (tag: string, present: boolean) => Promise<void>;
}) {
  return <TagHistory<ThoughtTagHistoryPage['entries'][number], ThoughtTagHistoryPage>
    owner={owner} id={sermonId} generation={generation} tags={thought.tags} disabled={disabled} onRestore={onRestore}
    identify={page => page.sermonId} path={'/api/data-engine/documents/sermons/' + encodeURIComponent(sermonId) + '/thought-tag-history'}
    select={entries => entries.flatMap(entry => entry.fields.filter(field => field.rowId === thought.id && field.rowCreatedAt === thought.date)
      .map(({ field, value, winnerValue }) => ({ id: entry.id, tag: field, value, winnerValue })))} />;
}

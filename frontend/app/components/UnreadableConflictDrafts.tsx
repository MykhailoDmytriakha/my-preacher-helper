'use client';

import UnreadableDraftCopies from '@/components/UnreadableDraftCopies';

import type { LegacyRecoverySource } from '@/data-engine/legacyRecovery.client';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const TEXT_FIELDS = new Set(['title', 'content', 'name', 'text', 'description', 'answerText']);
const CONTAINERS = new Set(['updates', 'outline', 'introduction', 'main', 'conclusion', 'subPoints']);

/** Read authored strings without asking an invalid tree to behave like a typed outline. */
function authoredWords(value: unknown, depth = 0): string[] {
  if (depth > 20) return [];
  if (Array.isArray(value)) return value.flatMap(child => authoredWords(child, depth + 1));
  return Object.entries(object(value)).flatMap(([key, child]) => {
    if (TEXT_FIELDS.has(key) && typeof child === 'string') return [child];
    return CONTAINERS.has(key) ? authoredWords(child, depth + 1) : [];
  });
}

export default function UnreadableConflictDrafts({ owner, sources = [], failed = false }: {
  owner: string | null | undefined;
  sources?: readonly LegacyRecoverySource[];
  failed?: boolean;
}) {
  const copies = sources.map(source => {
    const record = object(object(source.payload).value);
    const payload = object(record.payload);
    return { source, title: typeof payload.label === 'string' ? payload.label : '', content: authoredWords(payload).join('\n\n') };
  });
  return <UnreadableDraftCopies owner={owner} copies={copies} failed={failed} />;
}

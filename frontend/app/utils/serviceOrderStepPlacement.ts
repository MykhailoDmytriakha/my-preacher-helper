import type { ServiceOrderStepGap } from '@/data-engine/types';

export function stepGap(rows: readonly { id: string }[], id: string): ServiceOrderStepGap | undefined {
  const index = rows.findIndex(row => row.id === id);
  return index < 0 ? undefined : {
    previous: rows[index - 1]?.id ?? null,
    next: rows[index + 1]?.id ?? null,
  };
}

export function projectServiceOrderStep<Step extends { id: string }>(rows: Step[], id: string, gap: ServiceOrderStepGap): Step[] | undefined {
  const from = rows.findIndex(row => row.id === id);
  if (from < 0) return undefined;
  const previous = gap.previous === null ? -1 : rows.findIndex(row => row.id === gap.previous);
  const next = gap.next === null ? rows.length : rows.findIndex(row => row.id === gap.next);
  if ((gap.previous !== null && previous < 0) || next < 0 || previous >= next) return undefined;
  if (from > previous && from < next) return rows;
  const target = gap.next === null ? previous + 1 : next;
  const other = rows.filter(row => row.id !== id);
  other.splice(target - Number(from < target), 0, rows[from]);
  return other;
}

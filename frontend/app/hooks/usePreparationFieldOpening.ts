import { useEffect } from 'react';

import type { PreparationFieldBinding } from '@/components/common/manualTextBinding';

/** Only a rendered control opens a stage; folding retains the already-owned durable stage. */
export function usePreparationFieldOpening(binding?: Pick<PreparationFieldBinding<unknown>, 'active' | 'canBegin' | 'begin'>) {
  const active = binding?.active, canBegin = binding?.canBegin, begin = binding?.begin;
  useEffect(() => {
    if (!active && canBegin && begin) void begin().catch(() => undefined);
  }, [active, canBegin, begin]);
}

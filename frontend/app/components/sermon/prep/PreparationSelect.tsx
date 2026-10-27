import Select from '@/components/ui/Select';
import { useBufferedText } from '@/components/ui/useBufferedText';
import { usePreparationFieldOpening } from '@/hooks/usePreparationFieldOpening';

import { PreparationFieldActions, PreparationFieldStatus } from './PreparationTextarea';

import type { PreparationTextBinding } from '@/components/common/manualTextBinding';
import type { ReactNode } from 'react';

function Input({ binding, label, children }: { binding: PreparationTextBinding; label: string; children: ReactNode }) {
  usePreparationFieldOpening(binding);
  const text = useBufferedText(binding.value, binding.update);
  return <>
    <Select accent="blue" value={text.draft} onChange={event => text.change(event.target.value)} aria-label={label} disabled={!binding.ready}>{children}</Select>
    <PreparationFieldActions binding={binding} value={text.draft} dirty={binding.dirty || text.draft !== binding.value} />
    <PreparationFieldStatus binding={binding} />
  </>;
}
export function PreparationSelect(props: { binding: PreparationTextBinding; label: string; children: ReactNode }) {
  return <Input key={props.binding.subject} {...props} />;
}

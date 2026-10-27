import { useBufferedText } from '@/components/ui/useBufferedText';
import { usePreparationFieldOpening } from '@/hooks/usePreparationFieldOpening';

import { PreparationFieldStatus } from '../PreparationTextarea';

import AuthorIntentSection from './AuthorIntentSection';

import type { PreparationTextBinding } from '@/components/common/manualTextBinding';


export function AuthorIntentField({ binding }: { binding: PreparationTextBinding }) {
  usePreparationFieldOpening(binding);
  const text = useBufferedText(binding.value, binding.update);
  return <>
    <AuthorIntentSection value={text.draft} onChange={text.change} onSave={() => binding.save(text.draft)}
      onCancel={() => { void binding.cancel().catch(() => undefined); }} isSaving={binding.busy}
      disabled={!binding.ready} hasChanges={binding.dirty || text.draft !== binding.value} />
    <PreparationFieldStatus binding={binding} />
  </>;
}

import { useTranslation } from 'react-i18next';

import Chip from '@/components/ui/Chip';
import { getStructureIcon, getTagStyle, getTranslationKeyForTag } from '@/utils/tagUtils';

export interface ThoughtTagOption { name: string; color?: string; translationKey?: string }
interface ThoughtTagsFieldProps {
  tags: string[];
  allowedTags: ThoughtTagOption[];
  availableTags: ThoughtTagOption[];
  onAddTag: (name: string) => void;
  onRemoveTag: (index: number) => void;
  disabled?: boolean;
}

/** Tags are presentation here; each editor retains its selection and submission policy. */
export function ThoughtTagsField({ tags, allowedTags, availableTags, onAddTag, onRemoveTag, disabled = false }: ThoughtTagsFieldProps) {
  const { t } = useTranslation();
  const tagChip = (tag: ThoughtTagOption, selected: boolean, onClick: () => void, key: string) => {
    const translationKey = tag.translationKey || getTranslationKeyForTag(tag.name);
    const label = translationKey ? t(translationKey) : tag.name;
    const appearance = getTagStyle(tag.name, tag.color);
    const icon = getStructureIcon(tag.name);
    return <Chip key={key} tone="custom" size="sm" selected={selected} disabled={disabled} onClick={onClick}
      className={appearance.className} style={appearance.style}
      ariaLabel={t(selected ? 'thought.removeTagAria' : 'thought.addTagAria', { tag: label })}
      icon={icon ? <span aria-hidden="true" className={icon.className} dangerouslySetInnerHTML={{ __html: icon.svg }} /> : undefined}>
      {label}{selected && <span aria-hidden="true">×</span>}
    </Chip>;
  };
  return <div className="mb-4">
    <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">{t('thought.tagsLabel')}</p>
    <div className="flex flex-wrap gap-1.5 overflow-x-hidden">
      {tags.map((name, index) => tagChip(allowedTags.find(tag => tag.name === name) ?? { name }, true, () => onRemoveTag(index), `${name}-${index}`))}
    </div>
    <p className="mb-1 mt-2 text-xs text-gray-500">{t('editThought.availableTags')}</p>
    <div className="flex flex-wrap gap-1.5 overflow-x-hidden">
      {availableTags.map(tag => tagChip(tag, false, () => onAddTag(tag.name), tag.name))}
    </div>
  </div>;
}

'use client';

import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Chip } from '@/components/ui/Chip';
import { useAppLocale } from '@/hooks/useAppLocale';
import { ScriptureReference } from '@/models/models';
import { formatScriptureReference } from '@/utils/scriptureReference';

interface ScriptureRefBadgeProps {
  reference: ScriptureReference;
  onClick?: () => void;
  onRemove?: () => void;
  isEditing?: boolean;
}

/**
 * A Scripture reference as a chip.
 *
 * The shell — shape, size, hover, the ✕ and its keyboard contract — belongs to `Chip`, the
 * app's one pill. What stays here is what only a reference knows: how to abbreviate itself
 * for the reading language ("Ис.4:5-8" / "Isa.4:5-8" / "Іс.4:5-8") and how to say itself in
 * full to a screen reader, because the abbreviation is unreadable aloud.
 */
const ScriptureRefBadge = memo(function ScriptureRefBadge({
  reference,
  onClick,
  onRemove,
  isEditing = false,
}: ScriptureRefBadgeProps) {
  const { t } = useTranslation();

  // Get current locale for Bible data
  const { locale: bibleLocale } = useAppLocale();

  const displayText = formatScriptureReference(reference, { locale: bibleLocale });

  // Spoken form of the reference: the visible text is an abbreviation, which a screen
  // reader would read as letters.
  const spokenReference = useMemo(
    () => formatScriptureReference(reference, { locale: bibleLocale, style: 'long' }),
    [reference, bibleLocale]
  );

  return (
    <Chip
      tone="emerald"
      selected={isEditing}
      onClick={onClick}
      onRemove={onRemove}
      removeLabel={t('studiesWorkspace.removeReference', { reference: spokenReference })}
      ariaLabel={spokenReference}
    >
      {displayText}
    </Chip>
  );
});

export default ScriptureRefBadge;

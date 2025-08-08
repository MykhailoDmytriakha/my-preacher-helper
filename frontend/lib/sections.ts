import { SERMON_SECTION_COLORS } from '@/utils/themeColors';

export type SermonSectionId = 'introduction' | 'main' | 'conclusion' | 'ambiguous' | 'unassigned' | 'mainPart';

export function normalizeSectionId(sectionId: SermonSectionId): Exclude<SermonSectionId, 'mainPart'> {
  if (sectionId === 'mainPart') return 'main';
  return sectionId as Exclude<SermonSectionId, 'mainPart'>;
}

export function getSectionLabel(t: (key: string) => string, sectionId: SermonSectionId): string {
  const id = normalizeSectionId(sectionId);
  switch (id) {
    case 'introduction':
      return t('structure.introduction');
    case 'main':
      return t('structure.mainPart');
    case 'conclusion':
      return t('structure.conclusion');
    case 'unassigned':
    case 'ambiguous':
      return t('structure.underConsideration');
    default:
      return String(sectionId);
  }
}

export function getSectionBaseColor(sectionId: SermonSectionId): string {
  const id = normalizeSectionId(sectionId);
  if (id === 'introduction') return SERMON_SECTION_COLORS.introduction.base;
  if (id === 'main') return SERMON_SECTION_COLORS.mainPart.base;
  if (id === 'conclusion') return SERMON_SECTION_COLORS.conclusion.base;
  return '#6b7280';
}



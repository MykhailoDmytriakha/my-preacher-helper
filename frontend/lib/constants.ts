export const STRUCTURE_TAGS = {
  INTRODUCTION: "Вступление",
  MAIN_BODY: "Основная часть",
  CONCLUSION: "Заключение",
};

// Optional: Include Ukrainian variants if used interchangeably in sorting/filtering logic
export const UKRAINIAN_STRUCTURE_TAGS = {
  INTRODUCTION: "Вступ",
  MAIN_BODY: "Основна частина",
  CONCLUSION: "Висновок",
};

// Combine all possible structure tags used for identification/sorting
export const ALL_STRUCTURE_TAGS = [
  STRUCTURE_TAGS.INTRODUCTION,
  STRUCTURE_TAGS.MAIN_BODY,
  STRUCTURE_TAGS.CONCLUSION,
  UKRAINIAN_STRUCTURE_TAGS.INTRODUCTION,
  UKRAINIAN_STRUCTURE_TAGS.MAIN_BODY,
  UKRAINIAN_STRUCTURE_TAGS.CONCLUSION,
];

// Mapping for canonical sorting (if needed outside the hook)
export const getStructureTagCanonicalIndex = (tag: string): number => {
  if (tag === STRUCTURE_TAGS.INTRODUCTION || tag === UKRAINIAN_STRUCTURE_TAGS.INTRODUCTION) return 0;
  if (tag === STRUCTURE_TAGS.MAIN_BODY || tag === UKRAINIAN_STRUCTURE_TAGS.MAIN_BODY) return 1;
  if (tag === STRUCTURE_TAGS.CONCLUSION || tag === UKRAINIAN_STRUCTURE_TAGS.CONCLUSION) return 2;
  return -1; // Not a structure tag or unknown
};

// Helper to get the primary structure tag (e.g., Russian version) for display/filtering
export const getPrimaryStructureTag = (section: 'introduction' | 'main' | 'conclusion'): string => {
    switch (section) {
        case 'introduction': return STRUCTURE_TAGS.INTRODUCTION;
        case 'main': return STRUCTURE_TAGS.MAIN_BODY;
        case 'conclusion': return STRUCTURE_TAGS.CONCLUSION;
        default: return '';
    }
} 
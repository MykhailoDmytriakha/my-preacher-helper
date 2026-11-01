/** Reverse indexes and retired back-references; the material/series owns the relationship. */
const mirrors: Record<string, readonly string[]> = {
  studyNotes: ['materialIds'],
  sermons: ['seriesId', 'seriesPosition'],
  groups: ['seriesId', 'seriesPosition'],
};

export const relationMirrorFields = (collection: string): readonly string[] => mirrors[collection] ?? [];

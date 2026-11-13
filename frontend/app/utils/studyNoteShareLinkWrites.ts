export const STUDY_NOTE_SHARE_LINKS_KEY = 'study-note-share-links';
export const SHARE_LINK_MUTATION_KEYS = {
  create: [STUDY_NOTE_SHARE_LINKS_KEY, 'create'] as const,
  delete: [STUDY_NOTE_SHARE_LINKS_KEY, 'delete'] as const,
};

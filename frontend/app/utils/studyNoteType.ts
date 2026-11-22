export type OrdinaryStudyNoteType = 'note' | 'question';

export const isOrdinaryStudyNoteType = (value: unknown): value is OrdinaryStudyNoteType => value === 'note' || value === 'question';

export function isOrdinaryStudyNote(value: { type?: unknown } | null): boolean {
  return Boolean(value && (value.type === undefined || isOrdinaryStudyNoteType(value.type)));
}

/** Notes, questions and comments use the shared document body editor. Analysis has its own authoring rules. */
export function isStudyNoteBodyDocument(value: { type?: unknown } | null): boolean {
  return value?.type === 'comment' || isOrdinaryStudyNote(value);
}

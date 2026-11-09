export type OrdinaryStudyNoteType = 'note' | 'question';

export const isOrdinaryStudyNoteType = (value: unknown): value is OrdinaryStudyNoteType => value === 'note' || value === 'question';

export function isOrdinaryStudyNote(value: { type?: unknown } | null): boolean {
  return Boolean(value && (value.type === undefined || isOrdinaryStudyNoteType(value.type)));
}

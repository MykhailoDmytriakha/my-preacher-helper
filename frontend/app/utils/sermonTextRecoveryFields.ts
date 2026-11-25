import { isPreparationTextField, preparationTextField, preparationTextPaths, type PreparationTextField } from './preparationFieldValues';

export type SermonTextRecoveryField = 'title' | 'verse' | PreparationTextField;

export function isSermonTextRecoveryField(field: unknown): field is SermonTextRecoveryField {
  return field === 'title' || field === 'verse' || isPreparationTextField(field);
}

export const SERMON_TEXT_RECOVERY_FIELDS = [
  'title', 'verse', ...Object.keys(preparationTextPaths).filter(isPreparationTextField),
] as const satisfies readonly SermonTextRecoveryField[];

export function sermonTextRecoveryPath(field: SermonTextRecoveryField): readonly string[] {
  return isPreparationTextField(field) ? preparationTextPaths[field] : [field];
}

export function sermonTextRecoveryField(path: readonly string[]): SermonTextRecoveryField | undefined {
  const [field] = path;
  if (path.length === 1 && (field === 'title' || field === 'verse')) return field;
  return preparationTextField(path);
}

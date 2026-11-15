import type { StudyNote } from '@/models/models';

/** Keep raw ownership links distinct from receipts saying dictated text is already represented. */
export function noteRecordingMetadata(dictationSourceIds: readonly string[] = [], recordingSourceIds: readonly string[] = []): Pick<StudyNote, 'dictationSourceIds' | 'recordingSourceIds'> {
  return {
    ...(dictationSourceIds.length ? { dictationSourceIds: [...dictationSourceIds] } : {}),
    ...(recordingSourceIds.length ? { recordingSourceIds: [...recordingSourceIds] } : {}),
  };
}

export function appendNoteParagraph(body: string, paragraph: string): string {
  return body ? body + '\n\n' + paragraph : paragraph;
}

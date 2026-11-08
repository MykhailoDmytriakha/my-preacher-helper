/** Storage metadata omitted when comparing or displaying what the person wrote. */
export const DOCUMENT_BOOKKEEPING_FIELDS: ReadonlySet<string> = new Set([
  'updatedAt', 'createdAt', 'rev', 'userId', 'isDraft', 'planMode',
  'dictationSourceIds', 'recordingSourceIds', '_dataEngine', '_dataEngineOwner',
]);

/**
 * Fields whose name the person reads in their own words, for every place that shows a document's
 * fields as the person wrote them: the list of copies from the previous version and the notice of a
 * refused change. One list, so the two never name the same field differently. Any other field shows
 * as stored.
 */
const NAMED_FIELDS = new Set(['title', 'name', 'verse', 'description', 'date', 'items', 'sermonIds', 'seriesKind', 'thoughts',
  'structure', 'thoughtsBySection', 'plan', 'draft', 'outline', 'topics', 'status', 'meetingDates', 'preachDates', 'tags', 'isPreached',
  'language', 'email', 'displayName', 'firstDayOfWeek', 'enablePrepMode', 'enableAudioGeneration', 'enableStructurePreview',
  'enableGroups', 'showAppVersion', 'preferredProviderId', 'preferredModelId', 'preferredTranscription', 'preferredText', 'preferredTts',
  // Every other field the person writes in councils, groups, series, sermons, prayers and study notes (models.ts).
  'scratch', 'insights', 'planText', 'planMode', 'preparation', 'seriesId', 'seriesPosition', 'sourceNoteIds', 'church',
  'audioChunks', 'audioMetadata', 'theme', 'bookOrTopic', 'startDate', 'duration', 'color', 'templates', 'flow', 'heldAt',
  'answerText', 'text', 'updates', 'content', 'scriptureRefs',
  // Inside a list item or a sermon's sections: a council matter's parts, the sections of a plan.
  'summary', 'decision', 'options', 'questions', 'introduction', 'main', 'conclusion', 'ambiguous',
  // Inside a preaching or meeting date, and its church.
  'audience', 'city', 'location', 'notes', 'outcome',
  // Inside an AI preference: the provider and the model the person picked.
  'providerId', 'modelId']);

/** The field's name as `legacyRecovery.field.*` says it; a field without a name of its own shows as stored. */
export const fieldLabel = (t: (key: string) => string, field: string): string =>
  NAMED_FIELDS.has(field) ? t(`legacyRecovery.field.${field}`) : field;

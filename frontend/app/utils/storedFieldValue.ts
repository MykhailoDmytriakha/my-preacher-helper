type Translate = (key: string) => string;

/** Only schema-owned choices are translated; authored text and unknown values stay verbatim. */
const choices = (prefix: string, values: readonly string[]): Record<string, string> =>
  Object.fromEntries(values.map(value => [value, `${prefix}.${value}`]));
const documentStatus = choices('workspaces.series.form.statuses', ['draft', 'active', 'completed']);
const outcomes = choices('calendar.outcomes', ['excellent', 'good', 'average', 'poor']);
const CHOICES: Record<string, Record<string, string>> = {
  'groups.status': documentStatus,
  'series.status': documentStatus,
  'series.seriesKind': choices('workspaces.series.kind', ['sermon', 'group', 'mixed']),
  'series.items.type': choices('studiesWorkspace.materialTypes', ['sermon', 'group']),
  'groups.templates.status': choices('groupFlow.status', ['empty', 'draft', 'filled']),
  'groups.templates.type': choices('groupFlow.types', ['announcement', 'topic', 'scripture', 'questions', 'explanation', 'notes', 'prayer', 'custom']),
  'groups.meetingDates.outcome': outcomes,
  'prayerRequests.status': choices('prayer.status', ['active', 'answered', 'not_answered']),
  'studyNotes.type': choices('studiesWorkspace.type', ['note', 'question']),
  'studyMaterials.type': choices('studiesWorkspace.materialTypes', ['sermon', 'study', 'group', 'guide']),
  'councils.status': choices('council.status', ['preparing', 'held']),
  'councils.topics.kind': { decision: 'council.topic.kindDecision', info: 'council.topic.kindInfo' },
  'councils.topics.resolution': choices('council.topic', ['postponed', 'dropped']),
  'sermons.planMode': { manual: 'plan.modeManual', ai: 'plan.modeFromThoughts', note: 'plan.fromNote.mode' },
  'sermons.scratch.section': choices('scratch.sections', ['introduction', 'main', 'conclusion']),
  'sermons.audioMetadata.mode': { ai: 'audioExport.sourceAi', raw: 'audioExport.sourceRaw' },
  'sermons.preachDates.status': choices('calendar.status', ['planned', 'preached']),
  'sermons.preachDates.outcome': outcomes,
  'sermons.preparation.preachingGoal.type': choices('wizard.steps.goals.goal.types', ['informative', 'proclamation', 'didactic', 'exhortative']),
  'users.firstDayOfWeek': choices('settings.firstDayOfWeek', ['sunday', 'monday']),
  'users.language': { en: 'bible.translations.kjv.language', ru: 'bible.translations.rst.language', uk: 'bible.translations.ubio.language' },
};

/** A display-only copy. Paths include the collection so equal words in unrelated fields stay text. */
export function storedFieldValue(t: Translate, scope: string, field: string, value: unknown): unknown {
  const visit = (current: unknown, path: string): unknown => {
    if (path === 'studyNotes.paragraph') return t(current === true ? 'comment.kind.paragraph' : current === false ? 'comment.kind.comment' : 'comment.automaticKind');
    if (path === 'groups.flow.durationMin') {
      if (typeof current === 'number' && Number.isFinite(current) && current >= 0) return `${current} ${t('groupFlow.minutesShort')}`;
      if (current === null) return t('legacyRecovery.absent');
    }
    if ((path === 'serviceOrders.steps.flagged' || path === 'councils.topics.forAssembly') && typeof current === 'boolean') {
      return t(current ? 'legacyRecovery.valueOn' : 'legacyRecovery.valueOff');
    }
    if (typeof current === 'string') {
      const key = Object.hasOwn(CHOICES, path) && Object.hasOwn(CHOICES[path], current) ? CHOICES[path][current] : undefined;
      return key ? t(key) : current;
    }
    if (Array.isArray(current)) return current.map(item => visit(item, path));
    if (current && typeof current === 'object') {
      return Object.fromEntries(Object.entries(current).map(([key, entry]) => [key, visit(entry, `${path}.${key}`)]));
    }
    return current;
  };
  return visit(value, field ? `${scope}.${field}` : scope);
}

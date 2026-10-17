import { fieldLabel } from '@/utils/storedFieldLabel';
import { storedFieldValue } from '@/utils/storedFieldValue';

import en from '@locales/en/translation.json';
import ru from '@locales/ru/translation.json';
import uk from '@locales/uk/translation.json';

const resources = { en, ru, uk };
const translate = (language: keyof typeof resources) => (key: string): string => {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], resources[language]);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${language} choice label: ${key}`);
  return value;
};

const choices: [string, string, string[], string][] = [
  ['groups', 'status', ['draft', 'active', 'completed'], 'workspaces.series.form.statuses'],
  ['series', 'status', ['draft', 'active', 'completed'], 'workspaces.series.form.statuses'],
  ['series', 'seriesKind', ['sermon', 'group', 'mixed'], 'workspaces.series.kind'],
  ['series.items', 'type', ['sermon', 'group'], 'studiesWorkspace.materialTypes'],
  ['groups.templates', 'status', ['empty', 'draft', 'filled'], 'groupFlow.status'],
  ['groups.templates', 'type', ['announcement', 'topic', 'scripture', 'questions', 'explanation', 'notes', 'prayer', 'custom'], 'groupFlow.types'],
  ['groups.meetingDates', 'outcome', ['excellent', 'good', 'average', 'poor'], 'calendar.outcomes'],
  ['prayerRequests', 'status', ['active', 'answered', 'not_answered'], 'prayer.status'],
  ['studyNotes', 'type', ['note', 'question'], 'studiesWorkspace.type'],
  ['studyMaterials', 'type', ['sermon', 'study', 'group', 'guide'], 'studiesWorkspace.materialTypes'],
  ['councils', 'status', ['preparing', 'held'], 'council.status'],
  ['councils.topics', 'resolution', ['postponed', 'dropped'], 'council.topic'],
  ['sermons.scratch', 'section', ['introduction', 'main', 'conclusion'], 'scratch.sections'],
  ['sermons.preachDates', 'status', ['planned', 'preached'], 'calendar.status'],
  ['sermons.preachDates', 'outcome', ['excellent', 'good', 'average', 'poor'], 'calendar.outcomes'],
  ['sermons.preparation.preachingGoal', 'type', ['informative', 'proclamation', 'didactic', 'exhortative'], 'wizard.steps.goals.goal.types'],
  ['users', 'firstDayOfWeek', ['sunday', 'monday'], 'settings.firstDayOfWeek'],
];

describe.each(['en', 'ru', 'uk'] as const)('Stored choices in %s', language => {
  const t = translate(language);
  it.each(choices)('uses screen labels for %s.%s', (scope, field, values, prefix) => {
    for (const value of values) expect(storedFieldValue(t, scope, field, value)).toBe(t(`${prefix}.${value}`));
  });

  it('labels council section kinds and interface language choices', () => {
    expect(storedFieldValue(t, 'councils.topics', 'kind', 'decision')).toBe(t('council.topic.kindDecision'));
    expect(storedFieldValue(t, 'councils.topics', 'kind', 'info')).toBe(t('council.topic.kindInfo'));
    for (const [value, bible] of [['en', 'kjv'], ['ru', 'rst'], ['uk', 'ubio']]) {
      expect(storedFieldValue(t, 'users', 'language', value)).toBe(t(`bible.translations.${bible}.language`));
    }
  });

  it('labels stored plan and narration source modes with the choices on their screens', () => {
    for (const [value, key] of [['manual', 'plan.modeManual'], ['ai', 'plan.modeFromThoughts'], ['note', 'plan.fromNote.mode']]) {
      expect(storedFieldValue(t, 'sermons', 'planMode', value)).toBe(t(key));
    }
    for (const [value, key] of [['ai', 'audioExport.sourceAi'], ['raw', 'audioExport.sourceRaw']]) {
      expect(storedFieldValue(t, 'sermons', 'audioMetadata', { mode: value })).toEqual({ mode: t(key) });
    }
  });

  it('keeps authored words and unknown choices exact, including enum-like words and object keys', () => {
    for (const value of ['draft', 'active', 'constructor', 'toString', 'not-a-choice']) {
      expect(storedFieldValue(t, 'groups', 'title', value)).toBe(value);
      expect(storedFieldValue(t, 'unregistered', 'status', value)).toBe(value);
    }
    expect(storedFieldValue(t, 'groups', 'status', 'not-a-choice')).toBe('not-a-choice');
    expect(storedFieldValue(t, 'sermons', 'planText', { status: 'draft' })).toEqual({ status: 'draft' });
    expect(storedFieldValue(t, 'groups', 'status', null)).toBeNull();
    expect(storedFieldValue(t, 'groups', 'status', 42)).toBe(42);
  });

  it('reads only declared authored scalar paths with their existing screen labels', () => {
    expect(storedFieldValue(t, 'groups.flow', 'durationMin', 12)).toBe(`12 ${t('groupFlow.minutesShort')}`);
    expect(storedFieldValue(t, 'groups.flow', 'durationMin', 0)).toBe(`0 ${t('groupFlow.minutesShort')}`);
    expect(storedFieldValue(t, 'groups.flow', 'durationMin', null)).toBe(t('legacyRecovery.absent'));
    expect(storedFieldValue(t, 'groups.flow', 'durationMin', undefined)).toBeUndefined();
    for (const value of [true, false]) {
      const label = t(`legacyRecovery.${value ? 'valueOn' : 'valueOff'}`);
      expect(storedFieldValue(t, 'serviceOrders.steps', 'flagged', value)).toBe(label);
      expect(storedFieldValue(t, 'councils.topics', 'forAssembly', value)).toBe(label);
    }
    expect(fieldLabel(t, 'durationMin')).toBe(t('legacyRecovery.field.duration'));
    expect(fieldLabel(t, 'flagged')).toBe(t('serviceOrders.flag'));
    expect(fieldLabel(t, 'forAssembly')).toBe(t('council.topic.forAssembly'));
  });

  it('keeps raw evidence and unrelated scalar fields structurally unchanged', () => {
    for (const value of [42, null, true, false]) expect(storedFieldValue(t, 'unregistered', 'durationMin', value)).toBe(value);
    const value = [{ id: 'step', order: 7, durationMin: null, instanceTitle: 'Keep exact words.', extension: { durationMin: 12 }, flagged: true }];
    const before = JSON.stringify(value);
    expect(storedFieldValue(t, 'groups', 'flow', value)).toEqual([{ ...value[0], durationMin: t('legacyRecovery.absent') }]);
    expect(JSON.stringify(value)).toBe(before);
    expect(storedFieldValue(t, 'groups.flow', 'durationMin', 'twelve')).toBe('twelve');
    expect(storedFieldValue(t, 'groups.flow', 'durationMin', -1)).toBe(-1);
    expect(storedFieldValue(t, 'serviceOrders.steps', 'flagged', 'true')).toBe('true');
  });

  it('formats nested choices without changing the source or its identifiers, positions and authored text', () => {
    const value = [{ id: 'block', title: 'draft', content: 'filled', type: 'prayer', status: 'empty', order: 1 }];
    const before = JSON.stringify(value);
    expect(storedFieldValue(t, 'groups', 'templates', value)).toEqual([
      { ...value[0], type: t('groupFlow.types.prayer'), status: t('groupFlow.status.empty') },
    ]);
    expect(JSON.stringify(value)).toBe(before);
  });
});

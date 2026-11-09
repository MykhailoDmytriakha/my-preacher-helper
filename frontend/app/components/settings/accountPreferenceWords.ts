import type { AccountPreferenceField, PreferenceValue } from '@/data-engine/accountPreference';

export const accountPreferenceLabels: Record<AccountPreferenceField, string> = {
  firstDayOfWeek: 'settings.firstDayOfWeek.title',
  enableAudioGeneration: 'settings.audioGeneration.title',
  showAppVersion: 'settings.showVersion.title',
  language: 'navigation.language',
  preferredText: 'settings.modelSelector.functions.text.title',
  preferredTranscription: 'settings.modelSelector.functions.transcription.title',
  preferredTts: 'settings.modelSelector.functions.tts.title',
  'reading.trail.history': 'settings.bible.trail.history',
  'reading.trail.recent': 'settings.bible.trail.recent',
  'reading.trail.shown': 'bible.trail.title',
  'reading.trail.verseStart': 'bible.trail.verseStart',
  'reading.crossReferences.show': 'settings.bible.crossRefs.marks',
  'reading.crossReferences.inWindow': 'settings.bible.crossRefs.inWindow',
  'reading.crossReferences.mode': 'settings.bible.crossRefs.count',
  'reading.crossReferences.othersAsVerses': 'settings.bible.crossRefs.others',
  'reading.mine.show': 'settings.bible.mine.show',
  'reading.mine.comments': 'settings.bible.mine.comments',
  'reading.analysisHelp.short': 'settings.preferenceHistory.analysisHelp',
};

export function accountPreferenceWords(field: AccountPreferenceField, value: PreferenceValue | null, t: (key: string) => string): string {
  if (value === 'sunday') return t('settings.firstDayOfWeek.sunday');
  if (value === 'monday') return t('settings.firstDayOfWeek.monday');
  if (value === null) return t('settings.preferenceHistory.default');
  if (value === 'en') return t('settings.preferenceHistory.english');
  if (value === 'ru') return t('settings.preferenceHistory.russian');
  if (value === 'uk') return t('settings.preferenceHistory.ukrainian');
  if (value === 'main') return t('settings.bible.crossRefs.countMain');
  if (value === 'all') return t('settings.bible.crossRefs.countAll');
  if (value === 'text') return t('settings.bible.mine.commentsText');
  if (value === 'badge') return t('settings.bible.mine.commentsBadge');
  if (typeof value === 'number') return String(value);
  if (field === 'reading.crossReferences.othersAsVerses') return t(value ? 'settings.bible.crossRefs.othersVerses' : 'settings.bible.crossRefs.othersAddresses');
  if (field === 'reading.analysisHelp.short') return t(value ? 'settings.preferenceHistory.shortHelp' : 'settings.preferenceHistory.fullHelp');
  if (typeof value === 'object') return `${t(`settings.modelSelector.providers.${value.providerId}`)} · ${value.modelId}`;
  return t(value ? 'settings.preferenceHistory.on' : 'settings.preferenceHistory.off');
}

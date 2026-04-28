import enTranslation from '../../locales/en/translation.json';
import ruTranslation from '../../locales/ru/translation.json';
import ukTranslation from '../../locales/uk/translation.json';

const translationsByLang = {
  en: enTranslation,
  ru: ruTranslation,
  uk: ukTranslation,
};

const collectLeafPaths = (value: unknown, prefix = ''): string[] => {
  if (!value || typeof value !== 'object') {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => collectLeafPaths(child, prefix ? `${prefix}.${key}` : key))
    .sort();
};

  it('should have audio mini keys in all languages', () => {
    const languages = ['en', 'ru', 'uk'];
    
    languages.forEach(lang => {
      const translation = translationsByLang[lang as keyof typeof translationsByLang];
      
      // Check that audio section exists
      expect(translation).toHaveProperty('audio');
      
      // Check that mini subsection exists
      expect(translation.audio).toHaveProperty('mini');
      
      // Check that mini has required keys
      expect(translation.audio.mini).toHaveProperty('title');
      expect(translation.audio.mini).toHaveProperty('description');
      
      // Check that values are not empty
      expect(translation.audio.mini.title).toBeTruthy();
      expect(translation.audio.mini.description).toBeTruthy();
    });
  });

  it('should have consistent audio mini translations across languages', () => {
    // Check that all languages have the same structure
    expect(Object.keys(enTranslation.audio.mini)).toEqual(
      Object.keys(ruTranslation.audio.mini)
    );
    expect(Object.keys(enTranslation.audio.mini)).toEqual(
      Object.keys(ukTranslation.audio.mini)
    );
    
    // Check that all languages have the same keys
    const expectedKeys = ['title', 'description'];
    expect(Object.keys(enTranslation.audio.mini)).toEqual(expectedKeys);
  });

  it('should have dashboard home translations in all supported languages', () => {
    const expectedDashboardKeys = collectLeafPaths(enTranslation.dashboardHome);

    expect(collectLeafPaths(ruTranslation.dashboardHome)).toEqual(expectedDashboardKeys);
    expect(collectLeafPaths(ukTranslation.dashboardHome)).toEqual(expectedDashboardKeys);

    Object.values(translationsByLang).forEach((translation) => {
      expect(translation.navigation.appName).toBeTruthy();
      expect(translation.dashboardHome.metrics.studyNotes.label).toBeTruthy();
      expect(translation.dashboardHome.sections.sermons.status.preached).toBeTruthy();
      expect(translation.dashboardHome.sections.sermons.status.preparing).toBeTruthy();
      expect(translation.dashboardHome.sections.groups.status.active).toBeTruthy();
      expect(translation.dashboardHome.sections.groups.status.completed).toBeTruthy();
    });
  });

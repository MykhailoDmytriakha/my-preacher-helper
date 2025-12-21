import enTranslation from '../../locales/en/translation.json';
import ruTranslation from '../../locales/ru/translation.json';
import ukTranslation from '../../locales/uk/translation.json';

const translationsByLang = {
  en: enTranslation,
  ru: ruTranslation,
  uk: ukTranslation,
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

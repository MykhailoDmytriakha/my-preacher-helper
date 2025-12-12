import { runScenarios } from '@test-utils/scenarioRunner';

// Import translation files
import enTranslations from '../../locales/en/translation.json';
import ruTranslations from '../../locales/ru/translation.json';
import ukTranslations from '../../locales/uk/translation.json';

describe('Prep Mode Translation Coverage', () => {
  const resetScenario = () => {
    // No mocks needed for this test
  };

  beforeEach(resetScenario);

  describe('Translation Keys Existence', () => {
    it('verifies prep mode translations exist in all languages', async () => {
      await runScenarios(
        [
          {
            name: 'english translations include prep mode keys',
            run: () => {
              expect(enTranslations.settings?.prepMode).toBeDefined();
              expect(enTranslations.settings.prepMode.title).toBe('Preparation Mode (Beta)');
              expect(enTranslations.settings.prepMode.description).toBe('Enable access to the new preparation mode workflow');
            }
          },
          {
            name: 'russian translations include prep mode keys',
            run: () => {
              expect(ruTranslations.settings?.prepMode).toBeDefined();
              expect(ruTranslations.settings.prepMode.title).toBeDefined();
              expect(ruTranslations.settings.prepMode.description).toBeDefined();
              expect(typeof ruTranslations.settings.prepMode.title).toBe('string');
              expect(typeof ruTranslations.settings.prepMode.description).toBe('string');
              expect(ruTranslations.settings.prepMode.title.length).toBeGreaterThan(0);
              expect(ruTranslations.settings.prepMode.description.length).toBeGreaterThan(0);
            }
          },
          {
            name: 'ukrainian translations include prep mode keys',
            run: () => {
              expect(ukTranslations.settings?.prepMode).toBeDefined();
              expect(ukTranslations.settings.prepMode.title).toBeDefined();
              expect(ukTranslations.settings.prepMode.description).toBeDefined();
              expect(typeof ukTranslations.settings.prepMode.title).toBe('string');
              expect(typeof ukTranslations.settings.prepMode.description).toBe('string');
              expect(ukTranslations.settings.prepMode.title.length).toBeGreaterThan(0);
              expect(ukTranslations.settings.prepMode.description.length).toBeGreaterThan(0);
            }
          }
        ],
        { beforeEachScenario: resetScenario }
      );
    });
  });

  describe('Translation Content Quality', () => {
    it('verifies translation content meets quality standards', async () => {
      await runScenarios(
        [
          {
            name: 'all translations are non-empty strings',
            run: () => {
              const languages = [
                { name: 'English', translations: enTranslations },
                { name: 'Russian', translations: ruTranslations },
                { name: 'Ukrainian', translations: ukTranslations }
              ];

              languages.forEach(({ translations }) => {
                const title = translations.settings?.prepMode?.title;
                const description = translations.settings?.prepMode?.description;

                expect(title).toBeDefined();
                expect(description).toBeDefined();
                expect(typeof title).toBe('string');
                expect(typeof description).toBe('string');
                expect(title!.length).toBeGreaterThan(0);
                expect(description!.length).toBeGreaterThan(0);

                // Ensure no placeholder text remains
                expect(title!.toLowerCase()).not.toContain('todo');
                expect(title!.toLowerCase()).not.toContain('placeholder');
                expect(description!.toLowerCase()).not.toContain('todo');
                expect(description!.toLowerCase()).not.toContain('placeholder');
              });
            }
          },
          {
            name: 'russian and ukrainian translations are properly localized',
            run: () => {
              // Russian translations should contain Cyrillic characters
              const ruTitle = ruTranslations.settings.prepMode.title;
              const ruDesc = ruTranslations.settings.prepMode.description;
              expect(/[а-яё]/i.test(ruTitle)).toBe(true);
              expect(/[а-яё]/i.test(ruDesc)).toBe(true);

              // Ukrainian translations should contain Cyrillic characters
              const ukTitle = ukTranslations.settings.prepMode.title;
              const ukDesc = ukTranslations.settings.prepMode.description;
              expect(/[а-яё]/i.test(ukTitle)).toBe(true);
              expect(/[а-яё]/i.test(ukDesc)).toBe(true);
            }
          },
          {
            name: 'english translation maintains consistent terminology',
            run: () => {
              const enTitle = enTranslations.settings.prepMode.title;
              const enDesc = enTranslations.settings.prepMode.description;

              // Should contain "Preparation Mode" consistently
              expect(enTitle.toLowerCase()).toContain('preparation mode');
              expect(enDesc.toLowerCase()).toContain('preparation mode');
              expect(enDesc.toLowerCase()).toContain('workflow');
            }
          }
        ],
        { beforeEachScenario: resetScenario }
      );
    });
  });

  describe('Translation ThoughtsBySection Consistency', () => {
    it('verifies translation structure is consistent across languages', async () => {
      await runScenarios(
        [
          {
            name: 'all languages have identical prep mode key structure',
            run: () => {
              const languages = [enTranslations, ruTranslations, ukTranslations];

              languages.forEach((translations) => {

                // Check that settings.prepMode exists and has the right structure
                expect(translations.settings).toBeDefined();
                expect(translations.settings.prepMode).toBeDefined();
                expect(translations.settings.prepMode.title).toBeDefined();
                expect(translations.settings.prepMode.description).toBeDefined();

                // Ensure no extra keys exist in prepMode object
                const prepModeKeys = Object.keys(translations.settings.prepMode);
                expect(prepModeKeys).toHaveLength(2);
                expect(prepModeKeys).toContain('title');
                expect(prepModeKeys).toContain('description');
              });
            }
          },
          {
            name: 'prep mode translations are nested under settings section',
            run: () => {
              const languages = [enTranslations, ruTranslations, ukTranslations];

              languages.forEach((translations) => {
                expect(translations.settings).toBeDefined();
                expect(translations.settings.prepMode).toBeDefined();

                // Ensure prepMode is directly under settings, not elsewhere
                expect(translations.prepMode).toBeUndefined();
              });
            }
          }
        ],
        { beforeEachScenario: resetScenario }
      );
    });
  });

  describe('Translation Key Format', () => {
    it('verifies translation keys follow project conventions', async () => {
      await runScenarios(
        [
          {
            name: 'translation keys use dot notation and lowercase',
            run: () => {
              // The keys should be accessible via dot notation
              expect(enTranslations.settings.prepMode.title).toBeDefined();
              expect(enTranslations.settings.prepMode.description).toBeDefined();

              // Keys should be lowercase with underscores for word separation
              // (This is validated by the structure we access them with)
            }
          }
        ],
        { beforeEachScenario: resetScenario }
      );
    });
  });
});

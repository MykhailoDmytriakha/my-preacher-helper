import { createInstance } from 'i18next';

import uk from '@locales/uk/translation.json';

jest.unmock('i18next');

describe('Ukrainian freshness warnings', () => {
  it.each(['description', 'descriptionNoAction', 'dirtyDescription'] as const)(
    'uses gender-neutral wording for every entity in %s', async (key) => {
      const i18n = createInstance();
      await i18n.init({ lng: 'uk', resources: { uk: { translation: uk } }, interpolation: { escapeValue: false } });
      for (const entityKey of ['entityRecord', 'entityNote', 'entitySermon', 'entitySeries', 'entitySettings'] as const) {
        const entity = i18n.t(`freshness.${entityKey}`);
        const rendered = i18n.t(`freshness.${key}`, { entity });
        expect(rendered).toContain(`В іншому місці відредагували ${entity}.`);
        expect(rendered).not.toContain('{{');
      }
    }
  );
});

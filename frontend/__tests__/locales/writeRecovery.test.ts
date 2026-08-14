import en from '@/../locales/en/translation.json';
import ru from '@/../locales/ru/translation.json';
import uk from '@/../locales/uk/translation.json';

describe('truthful write recovery copy', () => {
  it.each([en, ru, uk])('names a refused save without guessing that connectivity caused it', (locale) => {
    expect(locale.writeRecovery.refused).toBeTruthy();
    expect(locale.writeRecovery.refused).not.toMatch(/offline|connection|связ|мереж/i);
  });

  it.each([en, ru, uk])('keeps unknown freshness cause-neutral', (locale) => {
    expect(locale.freshness.unknownDescription).not.toMatch(/offline|connection|связ|мереж/i);
  });
});

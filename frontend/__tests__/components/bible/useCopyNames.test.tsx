import { renderHook } from '@testing-library/react';

import { useCopyNames } from '@/components/bible/verseCopy/useVerseCopy';
import { verseCopyText } from '@/utils/verseCopy';

// The interface's language is the test's to change; the translations are the real ones of the three locales.
let mockLanguage = 'ru';
jest.mock('react-i18next', () => {
  const locales: Record<string, unknown> = {
    ru: require('../../../locales/ru/translation.json'),
    uk: require('../../../locales/uk/translation.json'),
    en: require('../../../locales/en/translation.json'),
  };
  return {
    useTranslation: () => ({
      t: (key: string) => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], locales[mockLanguage.slice(0, 2)]) ?? key,
      i18n: { language: mockLanguage },
    }),
  };
});

const namesOf = (bible: 'rst' | 'ubio' | 'kjv', bookId: string) => renderHook(() => useCopyNames(bible, bookId)).result.current;

/*
 * The owner, 2026-10-27: «не указывается, что синодальный перевод, если он совпадает с локализацией. Если не совпадает —
 * тогда уже подписываются (King James, KJV, Огієнко).» The Bible is marked only when it is not the interface's own.
 */
describe('useCopyNames — the Bible is named only when it is not the interface’s own', () => {
  it('the Synodal Bible in a Russian interface carries no mark, and the Ukrainian and English ones likewise in theirs', () => {
    mockLanguage = 'ru';
    expect(namesOf('rst', 'Isaiah')).toEqual({ book: 'Ис' });
    mockLanguage = 'uk-UA';
    expect(namesOf('ubio', 'Isaiah').mark).toBeUndefined();
    mockLanguage = 'en';
    expect(namesOf('kjv', 'Isaiah')).toEqual({ book: 'Isa' });
  });

  it('another Bible carries its short mark in the interface’s language', () => {
    mockLanguage = 'ru';
    expect(namesOf('kjv', 'Isaiah')).toEqual({ book: 'Isa', mark: 'KJV' });
    expect(namesOf('ubio', 'Isaiah').mark).toBe('Огиенко');
    mockLanguage = 'ru-RU';
    expect(namesOf('rst', 'Isaiah').mark).toBeUndefined();
    mockLanguage = 'uk';
    expect(namesOf('rst', 'Isaiah').mark).toBe('Синод.');
    expect(namesOf('ubio', 'Isaiah').mark).toBeUndefined();
    mockLanguage = 'en';
    expect(namesOf('rst', 'Isaiah')).toEqual({ book: 'Ис', mark: 'Synodal' });
  });

  it('the book stays in the Bible’s own language, whatever the interface speaks', () => {
    mockLanguage = 'en';
    expect(namesOf('rst', 'Romans').book).toBe('Рим');
    mockLanguage = 'ru';
    expect(namesOf('kjv', 'Romans').book).toBe('Rom');
  });

  it('the texts a copy makes: the Synodal verse in a Russian and an English interface, a King James verse in a Russian one', () => {
    const isaiah = (words: string) => [{ chapter: 47, verse: 4, words }];
    const synodal = 'Искупитель наш — Господь Саваоф имя Ему, Святый Израилев.';
    const kjv = 'As for our redeemer, the LORD of hosts is his name, the Holy One of Israel.';
    mockLanguage = 'ru';
    expect(verseCopyText(isaiah(synodal), 'quote', namesOf('rst', 'Isaiah'))).toBe(`Ис 47:4: "${synodal}"`);
    expect(verseCopyText(isaiah(kjv), 'quote', namesOf('kjv', 'Isaiah'))).toBe(`Isa 47:4 (KJV): "${kjv}"`);
    mockLanguage = 'en';
    expect(verseCopyText(isaiah(synodal), 'quote', namesOf('rst', 'Isaiah'))).toBe(`Ис 47:4 (Synodal): "${synodal}"`);
  });
});

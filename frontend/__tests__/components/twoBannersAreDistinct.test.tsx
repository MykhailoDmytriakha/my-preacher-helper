import { render, screen } from '@testing-library/react';

import { DataFreshnessBanner } from '@/components/DataFreshnessBanner';
import en from '@locales/en/translation.json';
import ru from '@locales/ru/translation.json';
import uk from '@locales/uk/translation.json';
import '@testing-library/jest-dom';

/**
 * TWO DIFFERENT EVENTS MUST NOT SOUND THE SAME.
 *
 * "The app has a new version" and "this document changed on another device" call for
 * opposite reactions: one is safe to postpone, the other means the text on screen is
 * already someone's yesterday. The app used to have only the first, worded facelessly
 * ("A new version is available"), so there was nothing to distinguish. These pin the
 * distinction in all three locales — a wording change that quietly merges them again
 * fails here.
 */
const locales: Record<string, Record<string, unknown>> = { en, ru, uk };

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const value = key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], locales.ru);
      const text = typeof value === 'string' ? value : key;
      return options?.entity ? text.replace('{{entity}}', String(options.entity)) : text;
    },
  }),
}));

describe('the data pill and the app update say different things', () => {
  it.each(['en', 'ru', 'uk'])('%s: neither wording is a copy of the other', (locale) => {
    const bundle = locales[locale] as unknown as {
      pwa: { updateAvailable: { hint: string; action: string } };
      freshness: { title: string; description: string };
    };

    // The app update is no longer a toast with a title — it is a header button whose
    // tooltip carries the whole explanation. The distinction it must keep is the same.
    const appHint = bundle.pwa.updateAvailable.hint;
    const dataTitle = bundle.freshness.title;

    expect(appHint).toBeTruthy();
    expect(dataTitle).toBeTruthy();
    expect(appHint).not.toBe(dataTitle);
    // Each says WHICH of the two things happened, rather than a bare
    // "something is available".
    expect(appHint.toLowerCase()).toMatch(/app|прилож|застосун|програм/);
    expect(`${dataTitle} ${bundle.freshness.description}`.toLowerCase()).toMatch(
      /device|устройств|пристро/
    );
    // And the app update must not claim the person's RECORDS changed — the whole
    // confusion this separation exists to prevent.
    expect(appHint.toLowerCase()).not.toMatch(/device|устройств|пристро/);
  });

  it('the data pill names the entity and offers to load the newer version', () => {
    render(
      <DataFreshnessBanner dirty={false} entityKey="entitySermon" onRefresh={() => undefined} onDismiss={() => undefined} />
    );

    expect(screen.getByRole('status')).toHaveTextContent(ru.freshness.title);
    // The entity is interpolated, so the person knows WHAT changed.
    expect(screen.getByRole('status')).toHaveTextContent(ru.freshness.entitySermon);
    expect(screen.getByText(ru.freshness.refreshAction)).toBeInTheDocument();
  });
});

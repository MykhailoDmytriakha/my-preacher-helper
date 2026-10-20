import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import en from '../../locales/en/translation.json';
import ru from '../../locales/ru/translation.json';
import uk from '../../locales/uk/translation.json';
import { RecordUnavailable } from '@/components/RecordUnavailable';
import { refusalMessage } from '@/utils/actionFailureMessage';
import { __resetServerAvailabilityForTests, isServerUnavailable, reportServerUnavailable } from '@/utils/serverAvailability';

type Language = 'en' | 'ru' | 'uk';
const languages: Language[] = ['en', 'ru', 'uk'];
const mockDictionaries = { en, ru, uk };
let mockLanguage: Language = 'en';
const mockTranslate = (key: string): string => {
  let value: unknown = mockDictionaries[mockLanguage];
  for (const part of key.split('.')) {
    value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined;
  }
  return typeof value === 'string' ? value : key;
};

jest.mock('@locales/useTranslation', () => ({
  useTranslation: () => ({ t: mockTranslate, language: mockLanguage }),
}));

// An answered store refusal establishes no failure of the person's connection.
const transportAdvice: Record<Language, RegExp> = {
  en: /connection|internet|online/i,
  ru: /\u0441\u0432\u044f\u0437|\u0441\u043e\u0435\u0434\u0438\u043d|\u0438\u043d\u0442\u0435\u0440\u043d\u0435\u0442/iu,
  uk: /\u0437.\u0454\u0434\u043d\u0430\u043d|\u0456\u043d\u0442\u0435\u0440\u043d\u0435\u0442|\u043c\u0435\u0440\u0435\u0436/iu,
};

beforeEach(() => {
  __resetServerAvailabilityForTests();
  reportServerUnavailable(1);
});
afterEach(() => __resetServerAvailabilityForTests());

it.each(languages)('keeps record recovery usable without diagnosing the connection in %s', async language => {
  mockLanguage = language;
  const back = jest.fn(), retry = jest.fn().mockResolvedValue(undefined);
  render(<RecordUnavailable onBack={back} onRetry={retry}>
    <p>Words retained before the store refusal.</p>
  </RecordUnavailable>);

  expect(isServerUnavailable()).toBe(true);
  const advice = screen.getByText(mockTranslate('recordAvailability.checkConnection'));
  expect(advice.textContent).not.toMatch(transportAdvice[language]);
  expect(screen.getByText('Words retained before the store refusal.')).toBeInTheDocument();
  const retryButton = screen.getByRole('button', { name: mockTranslate('dataSync.retry') });
  fireEvent.click(retryButton);
  await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(retryButton).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: mockTranslate('common.back') }));
  expect(back).toHaveBeenCalledTimes(1);
});

it.each(languages)('explains an incomplete series action without inventing a connection failure in %s', language => {
  mockLanguage = language;
  const refusal = Object.assign(new Error('A complete saved series list is required for membership editing'), { code: 'series-list-incomplete' });
  const message = refusalMessage(refusal, mockTranslate, 'dataSync.documentFailed');
  expect(isServerUnavailable()).toBe(true);
  expect(message).toBe(mockTranslate('dataSync.failure.seriesListIncomplete'));
  expect(message).not.toBe(refusal.message);
  expect(message).not.toMatch(transportAdvice[language]);
});

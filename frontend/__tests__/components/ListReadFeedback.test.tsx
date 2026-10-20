import { render, screen } from '@testing-library/react';
import { ListReadFeedback } from '@/components/ListReadFeedback';
import en from '../../locales/en/translation.json';
import ru from '../../locales/ru/translation.json';
import uk from '../../locales/uk/translation.json';
import '@testing-library/jest-dom';

let mockWords = en;
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({
  t: (key: string) => key.split('.').reduce<any>((value, part) => value?.[part], mockWords) ?? key,
}) }));

it.each([['en', en], ['ru', ru], ['uk', uk]] as const)('describes an unavailable data read, not an update check, in %s', (_language, words) => {
  mockWords = words as typeof en;
  render(<ListReadFeedback state="failed" />);
  expect(screen.getByRole('alert')).toHaveTextContent(words.dataSync.backgroundFailure);
  expect(screen.getByRole('alert')).not.toHaveTextContent(words.dataSync.readFailed);
});

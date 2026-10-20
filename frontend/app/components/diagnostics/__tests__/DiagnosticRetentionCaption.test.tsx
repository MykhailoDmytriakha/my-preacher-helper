import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';

import { buildDiagnosticReport, recordDiagnostic } from '@/utils/appDiagnostics';
import en from '@locales/en/translation.json';
import ru from '@locales/ru/translation.json';
import uk from '@locales/uk/translation.json';

import { TechnicalDetailsButton, TechnicalDetailsDialog } from '../TechnicalDetailsButton';

jest.unmock('i18next');
jest.unmock('react-i18next');
jest.mock('react-dom', () => jest.requireActual('react-dom'));
jest.mock('@/utils/appDiagnostics', () => ({
  ...jest.requireActual('@/utils/appDiagnostics'),
  diagnosticServerVersion: async () => ({ status: 'answered', version: 'test' }),
}));

it.each(['en', 'ru', 'uk'])('describes the actual retained history in the %s viewer', async language => {
  const i18n = createInstance();
  await i18n.init({ lng: language, fallbackLng: 'en', resources: { en: { translation: en }, ru: { translation: ru }, uk: { translation: uk } }, interpolation: { escapeValue: false } });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() }) });
  for (let index = 0; index < 160; index++) recordDiagnostic('route', { route: '/dashboard' });
  const retained = buildDiagnosticReport();
  expect(retained.events).toHaveLength(retained.retention.maxEvents);
  const view = render(<I18nextProvider i18n={i18n}><TechnicalDetailsDialog /><TechnicalDetailsButton /></I18nextProvider>);
  fireEvent.click(screen.getByRole('button', { name: i18n.t('diagnostics.open') }));
  await waitFor(() => expect(screen.getByRole('button', { name: i18n.t('diagnostics.copy') })).toBeEnabled());
  const report = JSON.parse((screen.getByRole('textbox', { name: i18n.t('diagnostics.report') }) as HTMLTextAreaElement).value);
  expect(report.retention).toEqual(retained.retention);
  expect(screen.getByRole('status')).toHaveTextContent(String(report.retention.maxEvents));
  expect(screen.getByRole('status')).toHaveTextContent(String(report.retention.hours));
  expect(screen.getByRole('status').textContent).not.toContain('{{');
  // A language change keeps the same policy and the same open report.
  await act(async () => { await i18n.changeLanguage(language === 'en' ? 'ru' : 'en'); });
  expect(screen.getByRole('status')).toHaveTextContent(String(report.retention.maxEvents));
  expect(screen.getByRole('dialog')).toBeVisible();
  view.unmount();
});

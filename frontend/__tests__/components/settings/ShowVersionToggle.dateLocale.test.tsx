import { render } from '@testing-library/react';

let mockLanguage = 'ru';
const originalBuildTime = process.env.NEXT_PUBLIC_BUILD_TIME;
let ShowVersionToggle: typeof import('@/components/settings/ShowVersionToggle').default;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: mockLanguage } }),
}));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'owner' } }),
}));
jest.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: () => ({
    settings: { showAppVersion: true }, loading: false, readOnly: false,
    updateShowAppVersion: jest.fn(), updatingShowAppVersion: false,
  }),
}));

beforeAll(async () => {
  process.env.NEXT_PUBLIC_BUILD_TIME = new Date(2026, 0, 15, 12, 34, 56).toISOString();
  ShowVersionToggle = (await import('@/components/settings/ShowVersionToggle')).default;
});
afterAll(() => {
  if (originalBuildTime === undefined) delete process.env.NEXT_PUBLIC_BUILD_TIME;
  else process.env.NEXT_PUBLIC_BUILD_TIME = originalBuildTime;
});

it('updates the visible build timestamp with the selected app language', () => {
  mockLanguage = 'ru';
  const view = render(<ShowVersionToggle />);
  expect(view.container).toHaveTextContent('15.01.2026, 12:34:56');
  mockLanguage = 'en';
  view.rerender(<ShowVersionToggle />);
  expect(view.container).toHaveTextContent('1/15/2026, 12:34:56 PM');
  mockLanguage = 'uk';
  view.rerender(<ShowVersionToggle />);
  expect(view.container).toHaveTextContent('15.01.2026, 12:34:56');
});

import { fireEvent, render, screen } from '@testing-library/react';

import BiblePage from '@/(pages)/(private)/bible/page';

const mockChangeBible = jest.fn();
let mockParams: URLSearchParams;
jest.mock('next/navigation', () => ({ useSearchParams: () => mockParams }));
jest.mock('@/components/bible/useReadingBible', () => ({ useReadingBible: () => ({ bible: 'rst', changeBible: mockChangeBible }) }));
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@locales/i18n', () => ({}));
jest.mock('@/components/bible/BibleBookList', () => ({ BibleBookList: () => null }));
jest.mock('@/components/bible/BibleBookReader', () => ({
  BibleBookReader: ({ onChangeBible }: { onChangeBible: (bible: string) => void }) => <button onClick={() => onChangeBible('kjv')}>Choose KJV</button>,
}));

beforeEach(() => { mockChangeBible.mockClear(); jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

it('clears an explicit reading arrival using the current address without reviving a closed analysis', () => {
  mockParams = new URLSearchParams('book=ephesians&at=1:1&tr=rst&read=rst&analysis=closed-analysis&mode=view&from=/studies');
  window.history.replaceState({ __NA: true, _N: true, bibleEntry: 'visit', custom: 'kept' }, '', '/bible?book=ephesians&at=1:1&tr=rst&read=rst&from=/studies');
  render(<BiblePage />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose KJV' }));
  const address = new URL(window.location.href);
  expect(address.searchParams.has('read')).toBe(false);
  expect(address.searchParams.has('analysis')).toBe(false);
  expect(address.searchParams.has('mode')).toBe(false);
  expect(address.searchParams.get('book')).toBe('ephesians');
  expect(address.searchParams.get('from')).toBe('/studies');
  expect(mockChangeBible).toHaveBeenCalledWith('kjv');
});

it('publishes the manual choice to Next while preserving custom entry state', () => {
  mockParams = new URLSearchParams('book=ephesians&at=1:1&tr=rst&read=rst');
  window.history.replaceState({ __NA: true, _N: true, bibleEntry: 'visit', custom: 'kept' }, '', `/bible?${mockParams}`);
  render(<BiblePage />);
  const replace = jest.spyOn(window.history, 'replaceState');
  fireEvent.click(screen.getByRole('button', { name: 'Choose KJV' }));
  const arrival = replace.mock.calls.find(([, , url]) => String(url).startsWith('/bible?'));
  expect(arrival).toBeDefined();
  expect(arrival![0]).not.toHaveProperty('__NA');
  expect(arrival![0]).not.toHaveProperty('_N');
  expect(arrival![0]).toMatchObject({ bibleEntry: 'visit', custom: 'kept' });
  expect(mockChangeBible).toHaveBeenCalledWith('kjv');
});

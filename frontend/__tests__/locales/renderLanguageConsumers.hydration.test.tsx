import React from 'react';
import { act, waitFor, within } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

import SourceNoteChips from '@/components/sermon/SourceNoteChips';
import type { Sermon, StudyNote } from '@/models/models';
import i18n from '@locales/i18n';
import en from '@locales/en/translation.json';
import ru from '@locales/ru/translation.json';
import uk from '@locales/uk/translation.json';

const { renderToString } = require('react-dom/server.node') as typeof import('react-dom/server');
jest.mock('i18next', () => jest.requireActual('i18next'));
jest.mock('react-i18next', () => jest.requireActual('react-i18next'));

interface AnchorProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: AnchorProps) => <a href={href} {...props}>{children}</a>,
}));
jest.mock('next/navigation', () => ({ usePathname: () => '/sermons/s1' }));

const mockSourceNotes: StudyNote[] = [];
jest.mock('@/hooks/useSermonNoteLinks', () => ({ useSourceNotes: () => ({ notes: mockSourceNotes }) }));

const sermon: Sermon = {
  id: 's1', title: 'Sermon', verse: '', date: '2026-01-01', thoughts: [], userId: 'u1', sourceNoteIds: ['n1'],
};
const note = (bible?: 'rst' | 'kjv'): StudyNote => ({
  id: 'n1', userId: 'u1', content: '', title: 'Note',
  scriptureRefs: [{ id: 'r1', ...(bible ? { bible } : {}), book: 'John', chapter: 3, fromVerse: 16 }],
  tags: [], createdAt: '2026-01-01', updatedAt: '2026-01-01', isDraft: false, type: 'analysis',
});
const tree = () => <I18nextProvider i18n={i18n}><SourceNoteChips sermon={sermon} /></I18nextProvider>;
const hrefOf = (html: string) => {
  const href = html.match(/href="([^"]+)"/)?.[1];
  if (!href) throw new Error('SSR output did not contain a source-note anchor');
  return new URL(href.replace(/&amp;/g, '&'), 'https://app.invalid');
};
const htmlForCurrentLanguage = () => renderToString(tree());
const locales = { en, ru, uk } as const;

beforeEach(() => { mockSourceNotes.splice(0, mockSourceNotes.length, note()); });
afterEach(async () => { await i18n.changeLanguage('en'); jest.restoreAllMocks(); });

describe('actual SourceNoteChips SSR snapshot contract', () => {
  it.each(['en', 'ru', 'uk'] as const)('uses the English SSR snapshot for live %s while the reference has no Bible', async (language) => {
    await i18n.changeLanguage(language);
    const html = htmlForCurrentLanguage();
    expect(html).toContain(locales.en.sermon.sourceNotes.label);
    expect(hrefOf(html).searchParams.get('tr')).toBe('kjv');
    expect(hrefOf(html).searchParams.get('read')).toBe('kjv');
  });

  it.each([
    ['en', 'rst'], ['ru', 'rst'], ['uk', 'rst'],
    ['en', 'kjv'], ['ru', 'kjv'], ['uk', 'kjv'],
  ] as const)('preserves explicit scriptureRefs Bible %s / %s through SSR', async (language, bible) => {
    mockSourceNotes.splice(0, mockSourceNotes.length, note(bible));
    await i18n.changeLanguage(language);
    const html = htmlForCurrentLanguage();
    const href = hrefOf(html);
    expect(html).toContain(locales.en.sermon.sourceNotes.label);
    expect(href.searchParams.get('tr')).toBe(bible);
    expect(href.searchParams.get('read')).toBe(bible);
  });
});

describe('actual SourceNoteChips hydration boundary', () => {
  it.each(['ru', 'uk'] as const)('hydrates the English SSR anchor into live %s without mismatch or replacement', async (language) => {
    await i18n.changeLanguage('en');
    const container = document.createElement('div');
    container.innerHTML = htmlForCurrentLanguage();
    document.body.appendChild(container);
    const original = within(container).getByTestId('source-note-chip');
    expect(hrefOf(container.innerHTML).searchParams.get('tr')).toBe('kjv');

    await i18n.changeLanguage(language);
    const recoverableErrors: unknown[] = [];
    const consoleErrors: unknown[][] = [];
    const consoleError = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { consoleErrors.push(args); });
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, tree(), { onRecoverableError: error => recoverableErrors.push(error) });
      });
      await waitFor(() => expect(within(container).getByTestId('source-note-chip')).toHaveAttribute('aria-label', locales[language].sermon.sourceNotes.openAnalysis.replace('{{title}}', 'Note')));
      const current = within(container).getByTestId('source-note-chip');
      const observation = {
        language, href: current.getAttribute('href'), ariaLabel: current.getAttribute('aria-label'),
        sameAnchor: current === original, recoverableErrors: recoverableErrors.map(error => String(error)),
        consoleErrors: consoleErrors.map(args => args.map(String)),
      };
      console.log('HYDRATION_OBSERVATION ' + JSON.stringify(observation));
      expect(observation.recoverableErrors).toEqual([]);
      expect(observation.consoleErrors).toEqual([]);
      expect(observation.href).toContain(`tr=${language === 'ru' ? 'rst' : 'ubio'}`);
      expect(observation.sameAnchor).toBe(true);
    } finally {
      await act(async () => { root?.unmount(); });
      container.remove();
      consoleError.mockRestore();
    }
  });
});

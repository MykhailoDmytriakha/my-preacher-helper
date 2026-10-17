import { act, renderHook } from '@testing-library/react';
import { createInstance } from 'i18next';
import React, { type PropsWithChildren } from 'react';
import { I18nextProvider } from 'react-i18next';

import { useTranslation } from '@locales/useTranslation';

jest.mock('i18next', () => jest.requireActual('i18next'));
jest.mock('react-i18next', () => jest.requireActual('react-i18next'));

async function fixture() {
  const instance = createInstance();
  await instance.init({
    lng: 'en', fallbackLng: 'en', defaultNS: 'first',
    resources: Object.fromEntries(['en', 'ru', 'uk'].map(language => [language, {
      first: { label: `${language} first`, nested: { label: `${language} nested`, other: `${language} other` } },
      second: { fallback: `${language} fallback` },
    }])),
    react: { useSuspense: false },
  });
  function Provider({ children }: PropsWithChildren) {
    return <I18nextProvider i18n={instance}>{children}</I18nextProvider>;
  }
  return { instance, Provider };
}

it('preserves the live writer, tuple response, readiness and stable translator', async () => {
  const { instance, Provider } = await fixture();
  const view = renderHook(() => useTranslation(), { wrapper: Provider });
  expect(view.result.current.i18n).toBe(instance);
  expect(view.result.current[0]).toBe(view.result.current.t);
  expect(view.result.current[1]).toBe(instance);
  expect(view.result.current[2]).toBe(true);
  expect(view.result.current.ready).toBe(true);
  expect(view.result.current.t('label')).toBe('en first');
  const originalT = view.result.current.t;
  view.rerender();
  expect(view.result.current.t).toBe(originalT);
  await act(async () => { await view.result.current.i18n.changeLanguage('ru'); });
  expect(instance.language).toBe('ru');
  expect(view.result.current.language).toBe('ru');
  expect(view.result.current.resolvedLanguage).toBe('ru');
  expect(view.result.current.t('label')).toBe('ru first');
  expect(view.result.current.i18n).toBe(instance);
});

it('preserves namespace fallback, interpolation, default text and per-call overrides', async () => {
  const { instance, Provider } = await fixture();
  const { result } = renderHook(() => useTranslation(['first', 'second'], { nsMode: 'fallback' }), { wrapper: Provider });
  await act(async () => { await instance.changeLanguage('ru'); });
  expect(result.current.t('fallback')).toBe('ru fallback');
  expect(result.current.t('label', { lng: 'uk' })).toBe('uk first');
  expect(result.current.t('second:fallback', { lng: 'en' })).toBe('en fallback');
  expect(result.current.t('missing', 'Hello {{name}}', { name: 'reader' })).toBe('Hello reader');
  expect(result.current.t(['missing', 'label'])).toBe('ru first');
});

it('preserves and updates key prefixes without losing per-call escape', async () => {
  const { Provider } = await fixture();
  const view = renderHook(({ prefix }) => useTranslation('first', { keyPrefix: prefix }), {
    wrapper: Provider, initialProps: { prefix: 'nested' },
  });
  expect(view.result.current.t('label')).toBe('en nested');
  expect(view.result.current.t('label', { keyPrefix: '' })).toBe('en first');
  view.rerender({ prefix: '' });
  expect(view.result.current.t('label')).toBe('en first');
});

it('honors an explicit translation language while the interface changes', async () => {
  const { instance, Provider } = await fixture();
  const { result } = renderHook(() => useTranslation('first', { lng: 'uk' }), { wrapper: Provider });
  expect(result.current.t('label')).toBe('uk first');
  await act(async () => { await instance.changeLanguage('ru'); });
  expect(result.current.language).toBe('ru');
  expect(result.current.t('label')).toBe('uk first');
  expect(result.current.t('label', { lng: 'en' })).toBe('en first');
});

it('subscribes to an explicit instance instead of the surrounding provider', async () => {
  const surrounding = await fixture();
  const explicit = await fixture();
  const { result } = renderHook(() => useTranslation(undefined, { i18n: explicit.instance }), { wrapper: surrounding.Provider });
  await act(async () => { await surrounding.instance.changeLanguage('ru'); });
  expect(result.current.language).toBe('en');
  expect(result.current.t('label')).toBe('en first');
  await act(async () => { await explicit.instance.changeLanguage('uk'); });
  expect(result.current.language).toBe('uk');
  expect(result.current.t('label')).toBe('uk first');
  expect(result.current.i18n).toBe(explicit.instance);
});

it('uses a provider namespace when none was passed to the hook', async () => {
  const { instance } = await fixture();
  function Provider({ children }: PropsWithChildren) {
    return <I18nextProvider i18n={instance} defaultNS="second">{children}</I18nextProvider>;
  }
  const { result } = renderHook(() => useTranslation(), { wrapper: Provider });
  expect(result.current.t('fallback')).toBe('en fallback');
});

it('keeps a translator captured by an in-flight callback in the current language', async () => {
  const { instance, Provider } = await fixture();
  const { result } = renderHook(() => useTranslation(), { wrapper: Provider });
  const capturedT = result.current.t;
  let finish = () => {};
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const answer = pending.then(() => capturedT('label'));
  await act(async () => { await instance.changeLanguage('ru'); });
  finish();
  expect(await answer).toBe('ru first');
});

it('keeps an explicitly fixed translator fixed when a callback completes later', async () => {
  const { instance, Provider } = await fixture();
  const { result } = renderHook(() => useTranslation('first', { lng: 'uk' }), { wrapper: Provider });
  const capturedT = result.current.t;
  await act(async () => { await instance.changeLanguage('ru'); });
  expect(capturedT('label')).toBe('uk first');
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { toast } from 'sonner';

import DashboardPage from '@/(pages)/(private)/dashboard/page';
import PlanEditorModal from '@/components/plan-editor/PlanEditorModal';
import CreatePrayerModal from '@/components/prayer/CreatePrayerModal';
import PlanTemplatesSection from '@/components/settings/PlanTemplatesSection';
import TagsSection from '@/components/settings/TagsSection';
import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { usePrayerRequests } from '@/hooks/usePrayerRequests';

import type { Sermon } from '@/models/models';
import type { User } from 'firebase/auth';
import '@testing-library/jest-dom';

const mockRouterPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, refresh: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => '/dashboard', useSearchParams: () => new URLSearchParams(), useParams: () => ({}),
}));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'capture-owner' }, loading: false }) }));
jest.mock('@/hooks/useDashboardSermons', () => ({ useDashboardSermons: () => ({ sermons: [], state: null }) }));
jest.mock('@/hooks/useSeries', () => ({ useSeries: () => ({ series: [] }) }));
jest.mock('@/hooks/useStudyNotes', () => ({ useStudyNotes: () => ({ notes: [] }) }));
jest.mock('@/hooks/useGroupsRead', () => ({ useGroupsRead: () => ({ groups: [] }) }));
jest.mock('@/hooks/useCouncilsRead', () => ({ useCouncilsRead: () => ({ councils: [] }) }));

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataCollection: jest.fn(),
  useDocumentActions: jest.fn(),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/hooks/useScrollLock', () => ({ useScrollLock: () => undefined }));

const owner = { uid: 'capture-owner' } as User;
const sermon = {
  id: 'capture-sermon', userId: owner.uid, title: 'Sermon', verse: '', date: '2026-10-17', thoughts: [],
  outline: { introduction: [], main: [{ id: 'one', text: 'Retained point' }], conclusion: [] },
} as Sermon;
const actions = {
  ready: true, create: jest.fn(), commit: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined), resolve: jest.fn().mockResolvedValue(0),
};
const collection = {
  state: { snapshots: [], documents: [], complete: true, freshness: 'server', checking: false, version: 1, error: null },
  loading: false, error: null, refresh: jest.fn().mockResolvedValue(undefined),
};
const name = 'Retained create words';

function PrayerCreator() {
  const { createPrayer } = usePrayerRequests(owner.uid);
  const [open, setOpen] = useState(true);
  return open ? <CreatePrayerModal onClose={() => setOpen(false)}
    onSubmit={payload => createPrayer({ userId: owner.uid, ...payload })} /> : <span>prayer-closed</span>;
}

const cases = [
  {
    label: 'settings template', collection: 'planTemplates',
    element: () => <PlanTemplatesSection user={owner} />,
    open: () => undefined,
    input: () => screen.queryByPlaceholderText('planTemplates.createPlaceholder'),
    submit: () => fireEvent.click(screen.getByRole('button', { name: 'planTemplates.create' })),
    extra: () => undefined,
    expectExtra: () => undefined,
  },
  {
    label: 'save structure as template', collection: 'planTemplates',
    element: () => <PlanEditorModal isOpen onClose={() => undefined} sermon={sermon} />,
    open: () => {
      fireEvent.click(screen.getByRole('button', { name: /planEditor.templates/ }));
      fireEvent.click(screen.getByRole('button', { name: 'planEditor.saveAsTemplate' }));
    },
    input: () => screen.queryByPlaceholderText('planEditor.saveAs.namePlaceholder'),
    submit: () => fireEvent.click(screen.getByRole('button', { name: 'planEditor.saveAs.save' })),
    extra: () => undefined,
    expectExtra: () => undefined,
  },
  {
    label: 'custom tag', collection: 'tags',
    element: () => <TagsSection user={owner} />,
    open: () => undefined,
    input: () => screen.queryByLabelText('settings.tagName'),
    submit: () => fireEvent.submit(screen.getByTestId('add-tag-form-element')),
    extra: () => screen.getByRole('button', { name: 'settings.selectColor' }).style.backgroundColor,
    expectExtra: (color: unknown) => expect(screen.getByRole('button', { name: 'settings.selectColor' }).style.backgroundColor).toBe(color),
  },
  {
    label: 'prayer request', collection: 'prayerRequests',
    element: () => <PrayerCreator />,
    open: () => undefined,
    input: () => screen.queryByPlaceholderText('prayer.create.titlePlaceholder'),
    submit: () => fireEvent.click(screen.getByRole('button', { name: 'prayer.create.submit' })),
    extra: () => {
      fireEvent.change(screen.getByPlaceholderText('prayer.create.descriptionPlaceholder'), { target: { value: 'Retained prayer context' } });
      fireEvent.change(screen.getByPlaceholderText('prayer.create.tagsPlaceholder'), { target: { value: 'family, hope' } });
    },
    expectExtra: () => {
      expect(screen.getByPlaceholderText('prayer.create.descriptionPlaceholder')).toHaveValue('Retained prayer context');
      expect(screen.getByPlaceholderText('prayer.create.tagsPlaceholder')).toHaveValue('family, hope');
    },
  },

  {
    label: 'dashboard prayer', collection: 'prayerRequests',
    element: () => <DashboardPage />,
    open: () => fireEvent.click(screen.getByRole('button', { name: 'dashboardHome.actions.addPrayer' })),
    input: () => screen.queryByPlaceholderText('prayer.create.titlePlaceholder'),
    submit: () => fireEvent.click(screen.getByRole('button', { name: 'prayer.create.submit' })),
    extra: () => {
      fireEvent.change(screen.getByPlaceholderText('prayer.create.descriptionPlaceholder'), { target: { value: 'Retained prayer context' } });
      fireEvent.change(screen.getByPlaceholderText('prayer.create.tagsPlaceholder'), { target: { value: 'family, hope' } });
    },
    expectExtra: () => {
      expect(screen.getByPlaceholderText('prayer.create.descriptionPlaceholder')).toHaveValue('Retained prayer context');
      expect(screen.getByPlaceholderText('prayer.create.tagsPlaceholder')).toHaveValue('family, hope');
    },
  },

];

function deferred() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = async () => { await act(async () => { await jest.advanceTimersByTimeAsync(25); }); };

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  localStorage.clear();
  jest.mocked(useDataCollection).mockReturnValue(collection as never);
  jest.mocked(useDocumentActions).mockReturnValue(actions as never);
});
afterEach(() => { cleanup(); jest.useRealTimers(); });

for (const item of cases) {
  const start = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    render(<QueryClientProvider client={client}>{item.element()}</QueryClientProvider>);
    item.open();
    fireEvent.change(item.input()!, { target: { value: name } });
    const extra = item.extra();
    item.submit();
    return extra;
  };

  describe(`${item.label} durable create capture`, () => {
    it('keeps the entered words while device capture is still pending', async () => {
      const capture = deferred();
      actions.create.mockReturnValueOnce(capture.promise);
      const extra = start();
      await settle();
      try {
        expect(item.input()).toBeInTheDocument();
        expect(item.input()).toHaveValue(name);
        item.expectExtra(extra);
        expect(mockRouterPush).not.toHaveBeenCalled();
        expect(actions.create).toHaveBeenCalledTimes(1);
      } finally {
        await act(async () => { capture.resolve(); });
        await settle();
      }
    });

    it('keeps the complete form usable when device capture fails after launch', async () => {
      const capture = deferred();
      actions.create.mockReturnValueOnce(capture.promise);
      const extra = start();
      await settle();
      await act(async () => { capture.reject(new Error('Device capture failed')); });
      await settle();
      expect(item.input()).toBeInTheDocument();
      expect(item.input()).toHaveValue(name);
      expect(item.input()).toBeEnabled();
      expect(mockRouterPush).not.toHaveBeenCalled();
      item.expectExtra(extra);
      expect(actions.create).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledTimes(1);
      actions.create.mockResolvedValueOnce(undefined);
      item.submit();
      await settle();
      expect(actions.create).toHaveBeenCalledTimes(2);
      const input = item.input();
      if (item.label === 'dashboard prayer') {
        expect(mockRouterPush).toHaveBeenCalledWith(expect.stringMatching(/^\/prayers\//));
        expect(input).toBeDisabled();
      } else if (input) expect(input).toHaveValue('');
      else expect(input).not.toBeInTheDocument();
    });

    it('ignores another submit while device capture is pending', async () => {
      const capture = deferred();
      actions.create.mockReturnValueOnce(capture.promise);
      start();
      await settle();
      const input = item.input()!;
      const form = input.closest('form');
      if (form) fireEvent.submit(form);
      else fireEvent.keyDown(input, { key: 'Enter' });
      await settle();
      try { expect(actions.create).toHaveBeenCalledTimes(1); }
      finally { await act(async () => { capture.resolve(); }); await settle(); }
    });

    if (item.collection !== 'prayerRequests') it('preserves words typed for the next create while the first capture waits', async () => {
      const capture = deferred();
      actions.create.mockReturnValueOnce(capture.promise);
      start();
      await settle();
      fireEvent.change(item.input()!, { target: { value: `${name} next` } });
      await act(async () => { capture.resolve(); });
      await settle();
      expect(item.input()).toHaveValue(`${name} next`);
      expect(actions.create).toHaveBeenCalledTimes(1);
    });

    it('clears or closes only after successful local capture', async () => {
      actions.create.mockResolvedValueOnce(undefined);
      start();
      await settle();
      const input = item.input();
      if (item.label === 'dashboard prayer') {
        expect(mockRouterPush).toHaveBeenCalledWith(expect.stringMatching(/^\/prayers\//));
        expect(input).toBeDisabled();
      } else if (input) expect(input).toHaveValue('');
      else expect(input).not.toBeInTheDocument();
      expect(actions.create).toHaveBeenCalledTimes(1);
      expect(actions.create).toHaveBeenCalledWith(
        expect.objectContaining({ collection: item.collection }),
        expect.objectContaining({ userId: owner.uid, [item.collection === 'prayerRequests' ? 'title' : 'name']: name }),
      );
    });
  });
}

import { render, screen } from '@testing-library/react';
import React from 'react';

import CouncilConductPage from '../[id]/conduct/page';
import CouncilDetailPage from '../[id]/page';

import type { Council, CouncilTopic } from '@/models/models';
import '@testing-library/jest-dom';

/**
 * A COUNCIL SHOWN WHILE DEVICE STORAGE IS SILENT (BUG-20260927-engine-open-hangs-on-silent-device-storage).
 *
 * The editor cannot open, so the screen gets a copy for reading. Everything prepared must be on
 * the page — that is what the pastor came to the meeting for — and nothing may offer a change the
 * copy could not keep: a typed answer that vanishes is worse than no field at all.
 */

const state: { council: Council | null; readOnly: boolean } = { council: null, readOnly: true };

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), useParams: () => ({ id: 'council-1' }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() } }));
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  isCollectionOnEngine: () => true,
  DataDocumentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('@/data-engine/DataSyncStatus', () => ({ DataSyncStatus: () => null }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({ RichMarkdownEditor: () => null }));
jest.mock('@/components/FloatingTextScaleControls', () => ({ __esModule: true, default: () => null }));
jest.mock('@/hooks/useCouncils', () => ({ useCouncil: jest.fn() }));
jest.mock('@/hooks/useCouncilsRead', () => ({
  useCouncilsRead: () => ({ councils: state.council ? [state.council] : [], loading: false, error: null, refresh: jest.fn() }),
}));
jest.mock('@/hooks/useCouncilDataDocument', () => ({
  useCouncilDataDocument: () => ({
    council: state.council, loading: false, readOnly: state.readOnly, error: null, status: null, confirmed: null, remote: null,
    refresh: jest.fn(), acceptRemote: jest.fn(), keepLocal: jest.fn(),
    updateCouncil: jest.fn().mockResolvedValue(undefined), deleteCouncil: jest.fn().mockResolvedValue(undefined),
    carryTopicToNext: jest.fn(), listRecoverable: jest.fn().mockResolvedValue([]), recover: jest.fn(),
    recovery: { choices: [], loading: false, error: null, refresh: jest.fn(), recover: jest.fn() },
  }),
}));

const topic: CouncilTopic = {
  id: 'topic-1', title: 'Bible Truck route', questions: [{ id: 'q1', question: 'Who drives?', answer: 'Brother Ivan' }],
  options: [{ id: 'o1', text: 'Buy a trailer' }],
};
const council = (status: Council['status']): Council => ({
  id: 'council-1', userId: 'owner', title: 'Council - Bible Truck', status, topics: [topic], date: '2026-09-27',
  createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z',
  ...(status === 'held' ? { heldAt: '2026-09-27T19:00:00.000Z' } : {}),
});

describe('a council copy for reading', () => {
  beforeEach(() => { state.readOnly = true; });

  it('shows everything prepared and offers no change it could not keep', () => {
    state.council = council('preparing');
    render(<CouncilDetailPage />);

    expect(screen.getByRole('heading', { name: 'Council - Bible Truck' })).toBeInTheDocument();
    expect(screen.getByText('Bible Truck route')).toBeInTheDocument();
    expect(screen.queryByTestId('council-title')).toBeNull();
    expect(screen.queryByTestId('council-add-topic')).toBeNull();
    expect(screen.queryByTestId('council-add-topic-bottom')).toBeNull();
    expect(screen.queryByTestId('council-conduct')).toBeNull();
    expect(screen.queryByTestId('council-topic-edit-topic-1')).toBeNull();
    expect(screen.queryByTestId('council-topic-outcome-topic-1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'council.detail.delete' })).toBeNull();
    expect(document.querySelector('input, textarea')).toBeNull();
  });

  it('shows a held council\'s outcomes without the buttons that change them', () => {
    state.council = council('held');
    render(<CouncilDetailPage />);

    expect(screen.getByText('Bible Truck route')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /council.topic.editOutcome/ })).toBeNull();
    expect(screen.queryByTestId('council-topic-carry-topic-1')).toBeNull();
  });

  it('gives the editing controls back once the editor is open', () => {
    state.readOnly = false;
    state.council = council('preparing');
    render(<CouncilDetailPage />);

    expect(screen.getByTestId('council-title')).toBeInTheDocument();
    expect(screen.getByTestId('council-add-topic')).toBeInTheDocument();
    expect(screen.getByTestId('council-topic-edit-topic-1')).toBeInTheDocument();
  });
});

/*
 * CONDUCTING OVER A COPY. Found by review: the meeting screen wrote every mark fire-and-forget,
 * so on a copy it showed a refusal toast AND "council finished", navigated away, and dropped a typed
 * decision on blur. On a copy it is a reading screen: every section and answer, no marks, no finish.
 */
describe('conducting a council copy', () => {
  beforeEach(() => { state.readOnly = true; state.council = council('preparing'); });

  it('lets the pastor read every prepared answer and offers no mark or finish it could not keep', () => {
    render(<CouncilConductPage />);

    expect(screen.getAllByText('Bible Truck route').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('council-finish')).toBeNull();
    expect(screen.queryByRole('button', { name: 'council.conduct.finish' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Buy a trailer/ })).toBeNull();
    expect(document.querySelector('input, textarea')).toBeNull();
  });

  it('offers marking again once the editor is open', () => {
    state.readOnly = false;
    render(<CouncilConductPage />);

    expect(screen.getByRole('button', { name: /Buy a trailer/ })).toBeInTheDocument();
  });
});


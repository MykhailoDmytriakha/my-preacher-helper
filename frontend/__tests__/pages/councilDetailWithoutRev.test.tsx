import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import CouncilDetailPage from '@/(pages)/(private)/care/council/[id]/page';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import type { CouncilTopic } from '@/models/models';

import { documentEngineHarness, settleEngine } from '../../test-utils/documentEngineHarness';

import type { Json, ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ settings: { firstDayOfWeek: 'monday' } }) }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), useParams: () => ({ id: 'council-1' }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('@/data-engine/react.client', () => ({ ...jest.requireActual('@/data-engine/react.client'), isCollectionOnEngine: () => true }));
jest.mock('@/hooks/useCouncilsRead', () => ({ useCouncilsRead: () => ({ councils: [], loading: false, error: null, refresh: jest.fn() }) }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({ RichMarkdownEditor: () => null }));
jest.mock('@/components/FloatingTextScaleControls', () => ({ __esModule: true, default: () => null }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() } }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const resource = { collection: 'councils', id: 'council-1' };
const topic: CouncilTopic = { id: 'topic-1', title: 'Bring all notes', summary: 'Prepared', questions: [], options: [] };
const asJson = <T,>(value: T): Json => JSON.parse(JSON.stringify(value)) as Json;
/** A council written before the counter existed (BUG-20261004-council-without-rev-refuses-title). */
const revless: ResourceSnapshot = {
  resource,
  metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
  value: { userId: 'owner', title: 'Original council', status: 'preparing', date: '2026-09-27', topics: asJson([topic]),
    createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z' },
};

const settle = async () => { await act(async () => { await settleEngine(); }); };

async function renderCouncilWithTopics(topics: CouncilTopic[]) {
  const harness = documentEngineHarness({
    ...revless,
    value: { ...revless.value, topics: asJson(topics) },
  });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  render(<DataEngineProvider><CouncilDetailPage /></DataEngineProvider>);
  await screen.findByTestId('council-topic-topic-1');
  await settle();
  return harness;
}

async function deliverCouncilChanges(harness: ReturnType<typeof documentEngineHarness>) {
  await act(async () => {
    window.dispatchEvent(new Event('pagehide'));
    await settleEngine();
  });
  await act(async () => {
    await harness.engine.retry(resource);
    await settleEngine();
  });
}

it('delivers a new title for a council written before it had a version counter', async () => {
  const harness = documentEngineHarness(revless);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const Workspace = ({ active = true }: { active?: boolean }) => <DataEngineProvider>{active && <CouncilDetailPage />}</DataEngineProvider>;
  const view = render(<Workspace />);
  await screen.findByDisplayValue('Original council');
  await settle();

  fireEvent.change(screen.getByDisplayValue('Original council'), { target: { value: 'Renamed old council' } });
  await settle();
  view.rerender(<Workspace active={false} />);
  await settle();

  await waitFor(() => expect(harness.server.value?.title).toBe('Renamed old council'));
  expect(harness.server.value?.rev).toBe(1);
  view.unmount();
});

describe('council nested deletion guards', () => {
  const decisionTopic = {
    ...topic,
    questions: [{ id: 'question-1', question: 'What did we decide?', answer: 'Keep the hall booking.' }],
    options: [{ id: 'option-1', text: 'Keep the hall booking' }],
    acceptedOptionId: 'option-1',
    decision: 'Keep the hall booking.',
    discussed: true,
  };

  async function askAndCancel(trigger: HTMLElement, harness: ReturnType<typeof documentEngineHarness>) {
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    await deliverCouncilChanges(harness);
    expect((harness.server.value as any)?.topics[0]).toMatchObject(decisionTopic);
    fireEvent.click(dialog.querySelectorAll('button')[1]);
    await deliverCouncilChanges(harness);
    expect((harness.server.value as any)?.topics[0]).toMatchObject(decisionTopic);
  }

  it('asks before removing a question and its answer, and cancellation keeps both', async () => {
    const harness = await renderCouncilWithTopics([decisionTopic]);
    fireEvent.click(screen.getByTestId('council-topic-edit-topic-1'));
    const question = screen.getByDisplayValue('What did we decide?').closest('li') as HTMLElement;
    await askAndCancel(within(question).getByRole('button'), harness);

    const retryQuestion = screen.getByDisplayValue('What did we decide?').closest('li') as HTMLElement;
    fireEvent.click(within(retryQuestion).getByRole('button'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(dialog.querySelectorAll('button')[0]);
    await waitFor(() => expect(screen.queryByDisplayValue('What did we decide?')).not.toBeInTheDocument());
    await deliverCouncilChanges(harness);
    expect((harness.server.value as any)?.topics[0].questions).toEqual([]);
  });

  it('does not apply an old question-removal confirmation after that question is edited', async () => {
    const harness = await renderCouncilWithTopics([decisionTopic]);
    fireEvent.click(screen.getByTestId('council-topic-edit-topic-1'));
    const question = screen.getByDisplayValue('What did we decide?').closest('li') as HTMLElement;
    fireEvent.click(within(question).getByRole('button'));
    const dialog = await screen.findByRole('dialog');

    const latestTopic: CouncilTopic = {
      ...decisionTopic,
      questions: [{
        id: 'question-1', question: 'What did we decide?', answer: 'The hall is now reserved for Saturday.',
      }],
    };
    await act(async () => { await harness.remote({ topics: asJson([latestTopic]) }); await settleEngine(); });
    fireEvent.click(dialog.querySelectorAll('button')[0]);
    await settle();
    await deliverCouncilChanges(harness);

    expect((harness.server.value as any)?.topics[0].questions).toEqual(latestTopic.questions);
    expect(screen.getByDisplayValue('What did we decide?')).toBeInTheDocument();
  });

  it('does not apply an old option-removal confirmation after its option text changes', async () => {
    const harness = await renderCouncilWithTopics([decisionTopic]);
    fireEvent.click(screen.getByTestId('council-topic-edit-topic-1'));
    const option = screen.getByDisplayValue('Keep the hall booking').closest('li') as HTMLElement;
    fireEvent.click(within(option).getByRole('button'));
    const dialog = await screen.findByRole('dialog');
    const latestTopic: CouncilTopic = {
      ...decisionTopic,
      options: [{ id: 'option-1', text: 'Keep the hall booking for Saturday' }],
    };
    await act(async () => { await harness.remote({ topics: asJson([latestTopic]) }); await settleEngine(); });
    fireEvent.click(dialog.querySelectorAll('button')[0]);
    await settle();
    await deliverCouncilChanges(harness);

    expect((harness.server.value as any)?.topics[0].options).toEqual(latestTopic.options);
  });

  it('does not apply an old topic-removal confirmation after the topic changes', async () => {
    const harness = await renderCouncilWithTopics([decisionTopic]);
    fireEvent.click(screen.getByTestId('council-topic-edit-topic-1'));
    fireEvent.click(screen.getByRole('button', { name: 'council.topic.delete' }));
    const dialog = await screen.findByRole('dialog');
    const latestTopic: CouncilTopic = { ...decisionTopic, summary: 'Newly written summary' };
    await act(async () => { await harness.remote({ topics: asJson([latestTopic]) }); await settleEngine(); });
    fireEvent.click(dialog.querySelectorAll('button')[0]);
    await settle();
    await deliverCouncilChanges(harness);

    expect((harness.server.value as any)?.topics).toEqual([latestTopic]);
  });

  it('asks before removing the accepted option that carries the recorded decision', async () => {
    const harness = await renderCouncilWithTopics([decisionTopic]);
    fireEvent.click(screen.getByTestId('council-topic-edit-topic-1'));
    const option = screen.getByDisplayValue('Keep the hall booking').closest('li') as HTMLElement;
    await askAndCancel(within(option).getByRole('button'), harness);

    const retryOption = screen.getByDisplayValue('Keep the hall booking').closest('li') as HTMLElement;
    fireEvent.click(within(retryOption).getByRole('button'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(dialog.querySelectorAll('button')[0]);
    await waitFor(() => expect(screen.queryByDisplayValue('Keep the hall booking')).not.toBeInTheDocument());
    await deliverCouncilChanges(harness);
    const stored = (harness.server.value as any)?.topics[0];
    expect(stored.options).toEqual([]);
    expect(stored.acceptedOptionId).toBeUndefined();
    expect(stored.decision).toBe('Keep the hall booking.');
  });

  it('asks before removing a whole section with its question, answer, option and decision', async () => {
    const harness = await renderCouncilWithTopics([decisionTopic]);
    fireEvent.click(screen.getByTestId('council-topic-edit-topic-1'));
    await askAndCancel(screen.getByRole('button', { name: 'council.topic.delete' }), harness);

    fireEvent.click(screen.getByRole('button', { name: 'council.topic.delete' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(dialog.querySelectorAll('button')[0]);
    await waitFor(() => expect(screen.queryByTestId('council-topic-topic-1')).not.toBeInTheDocument());
    await deliverCouncilChanges(harness);
    expect((harness.server.value as any)?.topics).toEqual([]);
  });
});

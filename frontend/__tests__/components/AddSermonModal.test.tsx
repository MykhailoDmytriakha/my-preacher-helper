import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import AddSermonModal from '@/components/AddSermonModal';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';

import { settleEngine } from '../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';
import '@testing-library/jest-dom';

// Sermons are engine-owned: the modal is a thin shell around the engine create stage, so
// these tests run the REAL engine (only I/O is replaced) and assert on the stored document.
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/church/ChurchField', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/ui/DatePickerField', () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
    <input aria-label="Planned date" value={value} onChange={event => onChange(event.target.value)} />,
}));

function setup(ui: React.ReactElement) {
  const harness = membershipEngineHarness([]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  return { harness, view: render(<DataEngineProvider>{ui}</DataEngineProvider>) };
}

async function typeSermon(title: string, verse: string) {
  const field = await screen.findByLabelText('addSermon.titleLabel');
  await waitFor(() => expect(field).toBeEnabled());
  fireEvent.change(field, { target: { value: title } });
  fireEvent.change(screen.getByLabelText('addSermon.verseLabel'), { target: { value: verse } });
  await act(async () => { await settleEngine(); });
}

async function sentSermon(harness: ReturnType<typeof membershipEngineHarness>) {
  await act(async () => { await harness.engine.retry(); await settleEngine(); });
  const [request] = await harness.commits.list('owner');
  return harness.read(request.baseline.resource).value;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons,series';
});
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

describe('AddSermonModal on the data engine', () => {
  test('renders the add button but not the dialog initially', () => {
    const { view } = setup(<AddSermonModal />);
    expect(screen.getByRole('button', { name: 'addSermon.newSermon' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    view.unmount();
  });

  test('opens the dialog when the add button is clicked and closes it on cancel', async () => {
    const { view, harness } = setup(<AddSermonModal />);
    fireEvent.click(screen.getByRole('button', { name: 'addSermon.newSermon' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'addSermon.cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await harness.commits.list('owner')).toEqual([]);
    view.unmount();
  });

  test('calls onClose when provided and cancel is clicked', async () => {
    const onClose = jest.fn();
    const { view } = setup(<AddSermonModal onClose={onClose} isOpen showTriggerButton={false} />);
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'addSermon.cancel' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    view.unmount();
  });

  test('falls back to onCancel as the close handler when onClose is not given', async () => {
    const onCancel = jest.fn();
    const { view } = setup(<AddSermonModal onCancel={onCancel} isOpen showTriggerButton={false} />);
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'addSermon.cancel' }));
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
    view.unmount();
  });

  test('renders the dialog without a trigger button when isOpen is true and the trigger is hidden', async () => {
    const { view } = setup(<AddSermonModal isOpen showTriggerButton={false} />);
    expect(screen.queryByRole('button', { name: 'addSermon.newSermon' })).not.toBeInTheDocument();
    await screen.findByRole('dialog');
    view.unmount();
  });

  test('reports its open state to the page behind it', async () => {
    const onOpenChange = jest.fn();
    const { view } = setup(<AddSermonModal onOpenChange={onOpenChange} />);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'addSermon.newSermon' }));
    await screen.findByRole('dialog');
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    view.unmount();
  });

  test('stores the typed sermon as one new document owned by the person', async () => {
    const onClose = jest.fn();
    const { harness, view } = setup(<AddSermonModal isOpen showTriggerButton={false} onClose={onClose} />);
    await typeSermon('Test Sermon Title', 'Test 1:1-2');
    fireEvent.click(screen.getByRole('button', { name: 'addSermon.save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(await sentSermon(harness)).toMatchObject({
      title: 'Test Sermon Title', verse: 'Test 1:1-2', userId: 'owner', thoughts: [], date: expect.any(String),
    });
    view.unmount();
  });

  test('stores a planned preach date with the unspecified church when only a date is filled', async () => {
    const onClose = jest.fn();
    const { harness, view } = setup(<AddSermonModal isOpen showTriggerButton={false} allowPlannedDate onClose={onClose} />);
    await typeSermon('Planned Sermon Title', 'Matt 5:1-2');
    fireEvent.change(screen.getByLabelText('Planned date'), { target: { value: '2026-04-10' } });
    await act(async () => { await settleEngine(); });
    fireEvent.click(screen.getByRole('button', { name: 'addSermon.save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(await sentSermon(harness)).toMatchObject({
      title: 'Planned Sermon Title',
      preachDates: [{ date: '2026-04-10', status: 'planned', church: { id: 'church-unspecified' } }],
    });
    view.unmount();
  });

  test('does not offer a planned date unless the caller allows it', async () => {
    const { view } = setup(<AddSermonModal isOpen showTriggerButton={false} />);
    await screen.findByRole('dialog');
    expect(screen.queryByLabelText('Planned date')).not.toBeInTheDocument();
    view.unmount();
  });

  // The owner, 2026-10-31: «должна показываться серия, а не так, что кнопка «Выбрать серию», а потом серия».
  test('shows the series row at once, never behind a button', async () => {
    const { view } = setup(<AddSermonModal isOpen showTriggerButton={false} />);
    await screen.findByRole('dialog');
    expect(await screen.findByLabelText('addSermon.seriesLabel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'workspaces.series.actions.selectSeries' })).not.toBeInTheDocument();
    view.unmount();
  });
});

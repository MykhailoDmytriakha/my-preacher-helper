import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import CreateSeriesModal from '@/components/series/CreateSeriesModal';
import EditSeriesModal from '@/components/series/EditSeriesModal';
import type { Series } from '@/models/models';
import { persistedWrite, queuedWrite } from '@/utils/recoverableWrite';

jest.unmock('react-dom');

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({
  RichMarkdownEditor: ({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) =>
    <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />,
}));
jest.mock('@/components/ColorPickerModal', () => ({
  __esModule: true,
  default: ({ initialColor, onOk, onCancel }: { initialColor: string; onOk: (value: string) => void; onCancel: () => void }) =>
    <div data-testid="color-picker"><span>{initialColor}</span><button type="button" onClick={() => onOk('#123456')}>Choose custom</button><button type="button" onClick={onCancel}>Cancel custom</button></div>,
}));

const series: Series = {
  id: 'series', userId: 'owner', title: 'Original title', theme: 'Original title', description: 'Original description',
  bookOrTopic: 'Romans', status: 'draft', color: '#3B82F6', sermonIds: ['sermon-one'], createdAt: '2026-01-01', updatedAt: '2026-01-01',
};
const field = (name: string) => screen.getByPlaceholderText(`workspaces.series.form.${name}Placeholder`);
const change = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } });
const draft = { title: 'Updated title', theme: 'Updated title', description: '**Exact description**', bookOrTopic: 'Genesis', status: 'active', color: '#10B981' };
function fillDraft() {
  change(field('title'), '  Updated title  ');
  change(field('description'), '  **Exact description**  ');
  change(field('bookOrTopic'), '  Genesis  ');
  change(screen.getByRole('combobox'), 'active');
  fireEvent.click(screen.getByTitle('#10B981'));
}
beforeEach(() => jest.clearAllMocks());

describe.each(['create', 'edit'] as const)('%s series contract', (mode) => {
  const saveLabel = `workspaces.series.actions.${mode === 'create' ? 'createSeries' : 'saveChanges'}`;
  function mount(submit: jest.Mock = jest.fn(() => queuedWrite('series-write', new Promise(() => undefined))), close = jest.fn()) {
    const view = render(mode === 'create'
      ? <CreateSeriesModal onCreate={submit} onClose={close} initialSermonIds={['sermon-one']} />
      : <EditSeriesModal series={series} onUpdate={submit} onClose={close} />);
    return { ...view, submit, close };
  }
  const payload = (submit: jest.Mock) => submit.mock.calls[0][mode === 'create' ? 0 : 1];
  const save = () => fireEvent.click(screen.getByRole('button', { name: saveLabel }));

  it('loads values and all eight presets, exposes the custom picker, and cancels without saving', () => {
    const { close, submit } = mount();
    for (const name of ['title', 'description', 'bookOrTopic'] as const) expect(field(name)).toHaveValue(mode === 'create' ? '' : series[name]);
    expect(screen.getByRole('combobox')).toHaveValue('draft');
    for (const color of ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6B7280', '#000000']) expect(screen.getByTitle(color)).toHaveStyle({ backgroundColor: color });
    expect(screen.getByTitle('workspaces.series.form.customColor')).toHaveTextContent('+');
    fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.actions.cancel' }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it('submits the exact normalized draft and closes on outbox acceptance before delivery', async () => {
    const { submit, close } = mount();
    fillDraft();
    save();
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(payload(submit)).toEqual(mode === 'create' ? { ...draft, sermonIds: ['sermon-one'], userId: 'owner', createdAt: expect.any(String), updatedAt: expect.any(String) } : draft);
    if (mode === 'edit') expect(submit.mock.calls[0][0]).toBe(series.id);
  });

  it('waits for remote acceptance, disables resubmission, and preserves every field after refusal', async () => {
    let refuse!: (reason: unknown) => void;
    const accepted = new Promise<never>((_, reject) => { refuse = reject; });
    const submit = jest.fn(() => persistedWrite(accepted));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { close } = mount(submit);
    fillDraft();
    save();
    expect(screen.getByRole('button', { name: 'common.saving' })).toBeDisabled();
    expect(close).not.toHaveBeenCalled();
    await act(async () => { refuse(Object.assign(new Error('Refused'), { code: 'permission-denied' })); });
    expect(screen.getByRole('button', { name: saveLabel })).toBeEnabled();
    expect(close).not.toHaveBeenCalled();
    expect(field('title')).toHaveValue('  Updated title  ');
    expect(field('description')).toHaveValue('  **Exact description**  ');
    expect(field('bookOrTopic')).toHaveValue('  Genesis  ');
    expect(screen.getByRole('combobox')).toHaveValue('active');
    expect(screen.getByTitle('#10B981')).toHaveClass('scale-110');
    expect(payload(submit)).toEqual(expect.objectContaining(draft));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('commits a custom color only on confirmation and keeps it when the picker is cancelled', async () => {
    const { submit, close } = mount();
    fillDraft();
    fireEvent.click(screen.getByTitle('workspaces.series.form.customColor'));
    expect(screen.getByTestId('color-picker')).toHaveTextContent('#10B981');
    fireEvent.click(screen.getByRole('button', { name: 'Choose custom' }));
    expect(screen.queryByTestId('color-picker')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('workspaces.series.form.customColor'));
    expect(screen.getByTestId('color-picker')).toHaveTextContent('#123456');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel custom' }));
    expect(screen.queryByTestId('color-picker')).not.toBeInTheDocument();
    save();
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(payload(submit).color).toBe('#123456');
  });
});

it('refreshes an untouched edit form but preserves the entire draft after any field changes', () => {
  const props = { onClose: jest.fn(), onUpdate: jest.fn() };
  const { rerender } = render(<EditSeriesModal series={series} {...props} />);
  const refreshed = { ...series, title: 'Fresh title', bookOrTopic: 'Fresh topic', description: 'Fresh description', color: '#123456', status: 'completed' as const };
  rerender(<EditSeriesModal series={refreshed} {...props} />);
  for (const name of ['title', 'description', 'bookOrTopic'] as const) expect(field(name)).toHaveValue(refreshed[name]);
  expect(screen.getByRole('combobox')).toHaveValue('completed');
  change(field('bookOrTopic'), 'My local topic');
  rerender(<EditSeriesModal series={series} {...props} />);
  expect(field('title')).toHaveValue('Fresh title');
  expect(field('description')).toHaveValue('Fresh description');
  expect(field('bookOrTopic')).toHaveValue('My local topic');
  expect(screen.getByRole('combobox')).toHaveValue('completed');
  fireEvent.click(screen.getByTitle('workspaces.series.form.customColor'));
  expect(screen.getByTestId('color-picker')).toHaveTextContent('#123456');
});

it('shows the initial sermon count only when creating a series with selected sermons', () => {
  const props = { onCreate: jest.fn(), onClose: jest.fn() };
  const { rerender } = render(<CreateSeriesModal {...props} />);
  expect(screen.queryByText('workspaces.series.form.initialSermonsHint')).not.toBeInTheDocument();
  rerender(<CreateSeriesModal {...props} initialSermonIds={['one', 'two']} />);
  expect(screen.getByText('workspaces.series.form.initialSermonsHint')).toBeInTheDocument();
});

it.each(['transient', 'stale'])('retains transient failures locally and steps aside for a stale-write decision: %s', async kind => {
  const error = Object.assign(new Error('Failed'), kind === 'stale' ? { isStaleWrite: true } : {});
  const close = jest.fn();
  const update = jest.fn(() => persistedWrite(Promise.reject(error)));
  render(<EditSeriesModal series={series} onClose={close} onUpdate={update} />);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'workspaces.series.actions.saveChanges' })); });
  if (kind === 'stale') {
    expect(close).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  } else {
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('common.saveError');
    change(field('title'), 'Keep working');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(field('title')).toHaveValue('Keep working');
  }
});

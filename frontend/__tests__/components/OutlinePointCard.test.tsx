import { LockClosedIcon, LockOpenIcon } from '@heroicons/react/24/outline';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import React from 'react';

import { OutlinePointCard } from '@/components/column/OutlinePointCard';
import { SortableItemActions } from '@/components/SortableItem';
import { createAudioThought } from '@/services/thought.service';
import { sayFailure, type FailureWords } from '@/utils/actionFailureMessage';
import en from '@locales/en/translation.json';
import ru from '@locales/ru/translation.json';
import uk from '@locales/uk/translation.json';

import type { Translate } from '@/components/column/types';
import type { Item } from '@/models/models';

jest.unmock('i18next');

const mockDropNodes = new Map<string, HTMLElement | null>();
jest.mock('@dnd-kit/core', () => ({ useDroppable: ({ id }: { id: string }) => ({ setNodeRef: (node: HTMLElement | null) => { mockDropNodes.set(id, node); }, isOver: false }) }));
jest.mock('@dnd-kit/sortable', () => ({ SortableContext: ({ children }: React.PropsWithChildren) => <>{children}</>, verticalListSortingStrategy: jest.fn() }));
jest.mock('@/services/thought.service', () => ({ createAudioThought: jest.fn() }));
jest.mock('@/components/column/SubPointList', () => ({ SubPointList: () => <div data-testid="subpoint-editor" /> }));
jest.mock('@/components/SermonGuidanceTooltips', () => ({ OutlinePointGuidanceTooltip: () => <span>Point help</span> }));
jest.mock('@/components/PointNote', () => ({ __esModule: true, default: ({ note, onChange, isReadOnly }: { note?: string; onChange: (note: string) => void; isReadOnly: boolean }) =>
  <input aria-label="Note" value={note ?? ''} onChange={event => onChange(event.target.value)} readOnly={isReadOnly} /> }));

type RecorderProps = { disabled?: boolean; isProcessing?: boolean; transcriptionError?: FailureWords | null; onClearError: () => void; onError: (words: FailureWords) => void; onRecordingComplete: (blob: Blob) => void };
function mockRecorder(label: string, props: RecorderProps) {
  return <div>
    <button type="button" disabled={props.disabled} aria-busy={props.isProcessing} onClick={() => props.onRecordingComplete(new Blob(['audio']))}>{label} record</button>
    <button type="button" onClick={() => props.onError({ said: 'Device error' })}>{label} error</button>
    {props.transcriptionError && <button type="button" onClick={props.onClearError}>{label} clear: {sayFailure(props.transcriptionError, key => key)}</button>}
  </div>;
}
jest.mock('@/components/FocusRecorderButton', () => ({ FocusRecorderButton: (props: RecorderProps) => mockRecorder('Point', props) }));
jest.mock('@/components/FlatRecorderButton', () => ({ FlatRecorderButton: (props: RecorderProps) => mockRecorder('Sub', props) }));

const t = (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key);
const point = { id: 'point', text: 'Point', note: 'Point note', isReviewed: false, subPoints: [{ id: 'sub', text: 'Sub', position: 1, note: 'Sub note' }] };
const item = (id: string, isLocked = false): Item => ({ id, content: id, customTagNames: [], outlinePointId: 'point', isLocked });
const base = { point, pointItems: [], containerId: 'main', t, isOnline: true, setAudioError: jest.fn(), onClearAudioError: jest.fn(), renderItem: (entry: Item) => <p key={entry.id}>{entry.content}</p> };
beforeEach(() => jest.clearAllMocks());

it('keeps normalized inline save, blank rejection, cancel, delete and collapse local to the card', () => {
  const onSaveEdit = jest.fn(); const onDeletePoint = jest.fn();
  render(<OutlinePointCard {...base} onSaveEdit={onSaveEdit} onDeletePoint={onDeletePoint} />);
  fireEvent.click(screen.getByRole('heading', { name: 'Point' }));
  const editor = screen.getByRole('textbox');
  expect(editor).toHaveFocus();
  fireEvent.change(editor, { target: { value: '  revised title  ' } });
  fireEvent.keyDown(editor, { key: 'Enter' });
  expect(onSaveEdit).toHaveBeenCalledWith('point', 'Revised title');
  fireEvent.click(screen.getByRole('heading', { name: 'Point' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
  expect(onSaveEdit).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('heading', { name: 'Point' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Discard this' } });
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'common.collapse' }));
  expect(screen.queryByTestId('subpoint-editor')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'common.expand' }));
  expect(screen.getByTestId('subpoint-editor')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'common.delete' }));
  expect(onDeletePoint).toHaveBeenCalledWith('point');
});

it('preserves focus actions, all-thought lock semantics, note ownership and AI gating', () => {
  const onAddThought = jest.fn(); const onTogglePointLock = jest.fn(); const onAiSortPoint = jest.fn(); const onSetPointNote = jest.fn(); const onSetSubPointNote = jest.fn();
  const props = { ...base, pointItems: [item('first'), item('second')], isFocusMode: true, onAddThought, onTogglePointLock, onAiSortPoint, onSetPointNote, onSetSubPointNote, showNotes: true };
  const { rerender } = render(<OutlinePointCard {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'structure.addThoughtToPoint' }));
  expect(onAddThought).toHaveBeenCalledWith('main', 'point');
  fireEvent.click(screen.getByTestId('outline-point-ai-sort-point'));
  expect(onAiSortPoint).toHaveBeenCalledWith('point');
  fireEvent.click(screen.getByRole('button', { name: 'Lock all thoughts in this structure point' }));
  expect(onTogglePointLock).toHaveBeenCalledWith('point', true);
  fireEvent.change(screen.getAllByRole('textbox', { name: 'Note' })[0], { target: { value: 'Updated point' } });
  fireEvent.change(screen.getAllByRole('textbox', { name: 'Note' })[1], { target: { value: 'Updated sub' } });
  expect(onSetPointNote).toHaveBeenCalledWith('point', 'Updated point');
  expect(onSetSubPointNote).toHaveBeenCalledWith('point', 'sub', 'Updated sub');
  rerender(<OutlinePointCard {...props} pointItems={[item('first', true)]} />);
  expect(screen.getByRole('button', { name: 'All thoughts in this structure point are locked' })).toBeDisabled();
  expect(screen.getByTestId('outline-point-ai-sort-point')).toBeDisabled();
  expect(screen.getAllByRole('textbox', { name: 'Note' }).every(input => input.hasAttribute('readonly'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Unlock all thoughts in this structure point' }));
  expect(onTogglePointLock).toHaveBeenLastCalledWith('point', false);
});

it('keeps point and subpoint recording targets, processing and error feedback separate', async () => {
  const onAudioThoughtCreated = jest.fn();
  let resolveAudio!: (value: Awaited<ReturnType<typeof createAudioThought>>) => void;
  jest.mocked(createAudioThought).mockImplementationOnce(() => new Promise(resolve => { resolveAudio = resolve; }) as ReturnType<typeof createAudioThought>);
  render(<OutlinePointCard {...base} sermonId="sermon" onAudioThoughtCreated={onAudioThoughtCreated} audioError={{ said: 'Point failure' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Point record' }));
  await waitFor(() => expect(createAudioThought).toHaveBeenCalledWith(expect.any(Blob), 'sermon', 0, 3, 'point'));
  expect(screen.getByRole('button', { name: 'Point record' })).toHaveAttribute('aria-busy', 'true');
  await act(async () => resolveAudio({ id: 'created' } as Awaited<ReturnType<typeof createAudioThought>>));
  expect(onAudioThoughtCreated).toHaveBeenCalledWith({ id: 'created' }, 'main');
  expect(screen.getByRole('button', { name: 'Point record' })).toHaveAttribute('aria-busy', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Point clear: Point failure' }));
  expect(base.onClearAudioError).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Point error' }));
  expect(base.setAudioError).toHaveBeenLastCalledWith({ said: 'Device error' });
  jest.mocked(createAudioThought).mockResolvedValueOnce({ id: 'sub-created' } as Awaited<ReturnType<typeof createAudioThought>>);
  fireEvent.click(screen.getByRole('button', { name: 'Sub record' }));
  await waitFor(() => expect(createAudioThought).toHaveBeenLastCalledWith(expect.any(Blob), 'sermon', 0, 3, 'point', 'sub'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sub record' })).toHaveAttribute('aria-busy', 'false'));
  fireEvent.click(screen.getByRole('button', { name: 'Sub error' }));
  expect(screen.getByRole('button', { name: 'Sub clear: Device error' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Sub clear: Device error' }));
  expect(screen.queryByRole('button', { name: 'Sub clear: Device error' })).not.toBeInTheDocument();
});

// The header locks every thought of the point; a thought card locks one. Same action, same sign:
// an open padlock while the thoughts can move, a closed one once they are locked.
const glyphOf = (element: React.ReactElement) => {
  const { container, unmount } = render(element);
  const glyph = container.querySelector('svg path')?.getAttribute('d');
  unmount();
  return glyph;
};
const padlockGlyph = (isLocked: boolean) => glyphOf(isLocked ? <LockClosedIcon /> : <LockOpenIcon />);
const thoughtCardLockGlyph = (isLocked: boolean) => glyphOf(
  <SortableItemActions item={item('card', isLocked)} containerId="main" isHighlighted={false} isDragging={false} isDeleting={false}
    canEdit={false} isLocked={isLocked} mutationDisabled={false} canToggleLock showDeleteIcon={false}
    sectionIconColorClasses="" t={t} isOverlay={false} />
);

it.each([false, true])('draws the point lock toggle as the same padlock a thought card shows (locked=%s)', isLocked => {
  const padlock = padlockGlyph(isLocked);
  expect(padlock).toBeTruthy();
  expect(padlock).not.toBe(padlockGlyph(!isLocked));
  expect(thoughtCardLockGlyph(isLocked)).toBe(padlock);
  render(<OutlinePointCard {...base} pointItems={[item('first', isLocked)]} onTogglePointLock={jest.fn()} />);
  const toggle = screen.getByRole('button', {
    name: isLocked ? 'Unlock all thoughts in this structure point' : 'Lock all thoughts in this structure point',
  });
  expect(toggle.querySelector('svg path')?.getAttribute('d')).toBe(padlock);
  expect(toggle).toHaveAttribute('data-state', isLocked ? 'locked' : 'unlocked');
});

const locales = { en, ru, uk } as const;
it.each([
  ['ru', 1, '1 мысль'], ['ru', 3, '3 мысли'], ['ru', 5, '5 мыслей'], ['ru', 21, '21 мысль'],
  ['uk', 1, '1 думка'], ['uk', 3, '3 думки'], ['uk', 5, '5 думок'],
  ['en', 1, '1 thought'], ['en', 3, '3 thoughts'],
] as const)('%s: a point with %i thoughts reads "%s"', async (lng, count, expected) => {
  const i18n = createInstance();
  await i18n.init({ lng, resources: { [lng]: { translation: locales[lng] } }, interpolation: { escapeValue: false } });
  const pointItems = Array.from({ length: count }, (_, index) => item(`thought-${index}`));
  render(<OutlinePointCard {...base} t={i18n.t.bind(i18n) as Translate} pointItems={pointItems} />);
  expect(screen.getByText(expected)).toBeInTheDocument();
});

// BUG-20261004-point-add-thought-only-in-one-column: the point's "+" opened manual entry only when one
// column was on screen; with two or three columns the header kept the microphone and lost the "+".
it.each([false, true])('offers manual entry of a thought into the point on any board (focus=%s)', isFocusMode => {
  const onAddThought = jest.fn();
  const { rerender } = render(<OutlinePointCard {...base} isFocusMode={isFocusMode} onAddThought={onAddThought} pointItems={[item('first')]} />);
  fireEvent.click(screen.getByRole('button', { name: 'structure.addThoughtToPoint' }));
  expect(onAddThought).toHaveBeenCalledWith('main', 'point');
  rerender(<OutlinePointCard {...base} isFocusMode={isFocusMode} onAddThought={onAddThought} pointItems={[item('first', true)]} />);
  expect(screen.getByRole('button', { name: 'All thoughts in this structure point are locked' })).toBeDisabled();
});

// BUG-20261004-point-title-crushed-on-phone: the title group started at zero width (flex-1), so the
// header actions squeezed the title to "нач…". jsdom does not lay out, so this guards the mechanism;
// the widths were measured live at 1280 and 386 px.
it('lets the header actions take a second line instead of squeezing the title', () => {
  render(<OutlinePointCard {...base} onAddThought={jest.fn()} pointItems={[item('first')]} />);
  const title = screen.getByRole('heading', { name: 'Point' });
  const row = title.closest('.flex-wrap');
  expect(row).not.toBeNull();
  const titleGroup = Array.from(row!.children).find((child) => child.contains(title))!;
  expect(titleGroup).toHaveClass('grow');
  expect(titleGroup).not.toHaveClass('flex-1');
  const actions = Array.from(row!.children).find((child) => child.contains(screen.getByRole('button', { name: 'structure.addThoughtToPoint' })))!;
  expect(actions).toHaveClass('ml-auto');
});

it.each([false, true])('collapses nested content and restores it without emitting writes (focus=%s)', isFocusMode => {
  const onSaveEdit = jest.fn();
  render(<OutlinePointCard {...base} isFocusMode={isFocusMode} onSaveEdit={onSaveEdit} pointItems={[{ ...item('nested'), subPointId: 'sub' }]} />);
  expect(screen.getByText('nested')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'common.collapse' }));
  expect(screen.queryByTestId('sub-point-drop-sub')).not.toBeInTheDocument();
  expect(screen.queryByText('nested')).not.toBeInTheDocument();
  expect(mockDropNodes.get('outline-point-point')).toContainElement(screen.getByRole('heading', { name: 'Point' }));
  expect(screen.getByRole('button', { name: 'common.expand' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('heading', { name: 'Point' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'common.expand' }));
  expect(screen.getByText('nested')).toBeVisible();
  expect(onSaveEdit).not.toHaveBeenCalled();
});

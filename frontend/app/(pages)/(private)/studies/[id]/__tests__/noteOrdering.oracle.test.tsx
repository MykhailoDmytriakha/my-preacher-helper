import { hasNoteQuestion } from '@test-utils/noteOrdering';
import { render } from '@testing-library/react';
import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import { NoteDraftRecovery } from '../NoteDraftRecovery';

it('does not accept unrelated alerts, dialogs or save errors as a note question', () => {
  render(<div data-note-workspace><div role="alert">Microphone failed</div><div role="dialog" aria-modal="true">Other dialog</div>
    <div role="status">common.saveError</div></div>);
  expect(hasNoteQuestion()).toBe(false);
});

it('accepts the real actionable note conflict banner', () => {
  render(<div data-note-workspace><SaveConflictBanner entityKey="entityNote" onKeepMine={() => undefined} onTakeTheirs={() => undefined} /></div>);
  expect(hasNoteQuestion()).toBe(true);
});

it('accepts an actionable note draft offer but not its read only preview', () => {
  const draft = { title: 'Draft', content: 'Words', type: 'note' as const, tags: [], scriptureRefs: [] };
  const props = { draft, copies: [], selectedKey: '', onSelect: () => undefined, onRestore: () => undefined, onDiscard: () => undefined };
  const view = render(<div data-note-workspace><NoteDraftRecovery {...props} readOnly /></div>);
  expect(hasNoteQuestion()).toBe(false);
  view.rerender(<div data-note-workspace><NoteDraftRecovery {...props} /></div>);
  expect(hasNoteQuestion()).toBe(true);
});

it('does not accept a real conflict banner outside the current note workspace', () => {
  render(<SaveConflictBanner entityKey="entitySermon" onKeepMine={() => undefined} onTakeTheirs={() => undefined} />);
  expect(hasNoteQuestion()).toBe(false);
});

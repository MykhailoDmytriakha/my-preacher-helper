import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React, { useRef, useState } from 'react';

import { useSermonActions } from '@/(pages)/(private)/sermons/[id]/structure/hooks/useSermonActions';
import EditThoughtModal from '@/components/EditThoughtModal';
import type { WriteSubmission } from '@/utils/recoverableWrite';

import type { Item, Sermon } from '@/models/models';

// FirestoreError's constructor is private, so TypeScript refuses `new FirestoreError(...)`
// even though the class is exported. The cast keeps the REAL SDK class at runtime — which is
// the point of these tests, they assert on the object a denied write actually produces —
// while satisfying the type checker. Resolve it lazily so this suite's selective
// Firestore mock cannot replace the SDK error class.
const makeFirestoreError = (code: string, message = code): Error & { code: string } => {
  const { FirestoreError } = jest.requireActual<typeof import('firebase/firestore')>('firebase/firestore');
  const Ctor = FirestoreError as unknown as new (code: string, message: string) => Error & { code: string };
  return new Ctor(code, message);
};

const mockUpdateThought = jest.fn();
let capturedThoughtSubmission: WriteSubmission | null = null;

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  onSnapshot: jest.fn(() => jest.fn()),
}));

jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: () => ({}) }));

jest.mock('@/services/thought.service', () => ({
  createManualThought: jest.fn(),
  deleteThought: jest.fn(),
  updateThought: (...args: unknown[]) => mockUpdateThought(...args),
}));

jest.mock('@/services/structure.service', () => ({ updateStructure: jest.fn() }));

jest.mock('@/providers/ConnectionProvider', () => ({
  useConnection: () => ({ isOnline: true, isMagicAvailable: true }),
}));

jest.mock('@/hooks/useAiUsage', () => ({
  useAiUsage: () => ({ transcriptionBlocked: false, refresh: jest.fn() }),
}));

jest.mock('@/hooks/useScrollLock', () => ({ useScrollLock: jest.fn() }));

jest.mock('@components/ui/RichMarkdownEditor', () => ({
  RichMarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label="Thought text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

jest.mock('@components/FocusRecorderButton', () => ({
  FocusRecorderButton: () => null,
}));

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'editThought.editTitle': 'Edit Thought',
        'editThought.textLabel': 'Text',
        'editThought.availableTags': 'Available tags',
        'thought.tagsLabel': 'Tags',
        'buttons.cancel': 'Cancel',
        'buttons.save': 'Save',
        'buttons.saving': 'Saving',
        'writeRecovery.refused': 'Save refused. Nothing was saved; your text is still here.',
      };
      return translations[key] ?? key;
    },
  }),
}));

const storedThought = {
  id: 'thought-1',
  text: 'Stored thought text',
  tags: [],
  date: '2026-08-11T00:00:00.000Z',
};

const initialSermon: Sermon = {
  id: 'sermon-1',
  userId: 'user-1',
  title: 'Sermon',
  verse: 'John 3:16',
  date: '2026-08-11T00:00:00.000Z',
  thoughts: [storedThought],
};

const initialItem: Item = {
  id: 'thought-1',
  content: storedThought.text,
  requiredTags: [],
  customTagNames: [],
};

function ThoughtEditHarness() {
  const [sermon, setSermon] = useState<Sermon | null>(initialSermon);
  const [containers, setContainers] = useState<Record<string, Item[]>>({
    introduction: [],
    main: [],
    conclusion: [],
    ambiguous: [initialItem],
  });
  const containersRef = useRef(containers);
  containersRef.current = containers;
  const actions = useSermonActions({
    sermon,
    setSermon,
    containers,
    setContainers,
    containersRef,
    allowedTags: [],
    debouncedSaveThought: jest.fn(),
    debouncedSaveStructure: jest.fn(),
  });

  return (
    <>
      <section aria-label="Rendered saved thought">
        <p>{sermon?.thoughts[0]?.text}</p>
      </section>
      <button type="button" onClick={() => actions.handleEdit(initialItem)}>
        Edit stored thought
      </button>
      {actions.editingItem && (
        <EditThoughtModal
          initialText={actions.editingItem.content}
          initialTags={[]}
          allowedTags={[]}
          onSave={(text, tags, outlinePointId, subPointId) => {
            const submission = actions.handleSaveEdit(text, tags, outlinePointId, subPointId);
            capturedThoughtSubmission = submission as typeof capturedThoughtSubmission;
            return submission;
          }}
          onClose={actions.handleCloseEdit}
          allowOffline
        />
      )}
    </>
  );
}

describe('thought edit refusal through the real sermon action hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateThought.mockReset();
    capturedThoughtSubmission = null;
  });

  it('keeps the exact edit open, tells the refusal, and rolls rendered content back', async () => {
    mockUpdateThought.mockRejectedValue(
      makeFirestoreError('permission-denied', 'Permission denied')
    );
    render(<ThoughtEditHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit stored thought' }));
    fireEvent.change(screen.getByLabelText('Thought text'), {
      target: { value: 'Exact refused thought text' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdateThought).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const currentDialog = screen.getByRole('dialog', { name: 'Edit Thought' });
      expect(within(currentDialog).getByRole('alert')).toHaveTextContent(
        'Save refused. Nothing was saved; your text is still here.'
      );
    });
    await act(async () => {
      await expect(mockUpdateThought.mock.results[0]?.value).rejects.toThrow('Permission denied');
      // The refusal now arrives BEFORE acceptance, so acceptance rejects and the
      // editor never closes over a refused write. Previously acceptance resolved as
      // `queued` and the refusal had to chase the person through a late toast.
      await expect(capturedThoughtSubmission?.acceptance).rejects.toThrow('Permission denied');
      await expect(capturedThoughtSubmission?.persistence).rejects.toThrow('Permission denied');
      await Promise.resolve();
    });
    const dialog = screen.getByRole('dialog', { name: 'Edit Thought' });
    expect(within(dialog).getByRole('heading', { name: 'Edit Thought' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Thought text')).toHaveValue('Exact refused thought text');

    const savedOutput = screen.getByRole('region', { name: 'Rendered saved thought' });
    expect(within(savedOutput).getByText('Stored thought text')).toBeInTheDocument();
    expect(within(savedOutput).queryByText('Exact refused thought text')).not.toBeInTheDocument();
  });
});

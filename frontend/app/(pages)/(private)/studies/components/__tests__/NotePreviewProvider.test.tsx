import { act, fireEvent, render, screen } from '@testing-library/react';

import NotePreviewProvider from '../NotePreviewProvider';

// react-i18next is consumed transitively by NotePreviewModal.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? _key,
    i18n: { language: 'en' },
  }),
}));

// Next's Link is just an <a> for this test — we want real anchor click
// semantics so the capture-phase handler in the provider gets exercised.
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Modal pulls a hook that touches React Query — stub it. Returning an empty
// list keeps the modal in its "note isn't loaded" branch, which still renders
// the dialog (we only need to assert the dialog opened, not its body shape).
jest.mock('@/hooks/useStudyNotes', () => ({
  useStudyNotes: () => ({ notes: [], uid: 'user-1', loading: false }),
}));

jest.mock('@/hooks/useWikilinkResolver', () => ({
  useWikilinkResolver: () => () => undefined,
}));

// useScrollLock manipulates document.body.style — safe in jsdom but stub
// anyway so the test isolates the click delegation under test.
jest.mock('@/hooks/useScrollLock', () => ({
  useScrollLock: () => undefined,
}));

// NodeTreeEditor pulls dnd-kit + tiptap-related deps in the modal branch.
// Replace with a lightweight stub — we never reach this branch with empty
// notes anyway, but keeping the dependency tree shallow speeds Jest up.
jest.mock('@/components/studies/node/NodeTreeEditor', () => ({
  __esModule: true,
  default: () => <div data-testid="node-tree-editor" />,
}));

jest.mock('@components/MarkdownDisplay', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => (
    <div data-testid="markdown-display">{content}</div>
  ),
}));

function renderProvider(child: React.ReactNode) {
  return render(<NotePreviewProvider>{child}</NotePreviewProvider>);
}

describe('NotePreviewProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('intercepts plain left-clicks on wikilink chips and opens the preview modal without navigating', () => {
    renderProvider(
      <a data-wikilink-id="abc" href="/studies/abc">
        chip
      </a>
    );

    const chip = screen.getByText('chip');

    const initialHref = window.location.href;

    // Real MouseEvent so the capture-phase listener registered on
    // `document` actually fires (fireEvent.click works for capture too,
    // but we want explicit button:0 + no modifier so the test mirrors
    // production click handling 1:1).
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    act(() => {
      chip.dispatchEvent(event);
    });

    // Capture-phase handler called preventDefault before the anchor
    // navigated — URL stays put.
    expect(event.defaultPrevented).toBe(true);
    expect(window.location.href).toBe(initialHref);

    // Modal mounted with the chip's noteId.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('lets Cmd+click on wikilink chips fall through to default navigation (no preventDefault)', () => {
    renderProvider(
      <a data-wikilink-id="abc" href="/studies/abc">
        chip
      </a>
    );

    const chip = screen.getByText('chip');

    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    // Modifier-click means "open in new tab" — provider must NOT
    // preventDefault, so the browser handles navigation normally.
    Object.defineProperty(event, 'metaKey', { value: true });
    act(() => {
      chip.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('removes the capture-phase listener on unmount so wikilink clicks stop opening the modal', () => {
    const { unmount } = renderProvider(
      <a data-wikilink-id="abc" href="/studies/abc">
        chip
      </a>
    );

    // First click opens the modal — proves the listener is wired.
    const firstEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    act(() => {
      screen.getByText('chip').dispatchEvent(firstEvent);
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Unmount tears down the provider — its useEffect cleanup must
    // remove the document-level listener.
    unmount();

    // Render an orphan chip somewhere else in the document (the provider
    // is gone). Click it — nothing should open and no errors should fire
    // because the listener was successfully removed.
    const orphanChip = document.createElement('a');
    orphanChip.setAttribute('data-wikilink-id', 'def');
    orphanChip.setAttribute('href', '/studies/def');
    orphanChip.textContent = 'orphan';
    document.body.appendChild(orphanChip);

    try {
      const secondEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      act(() => {
        orphanChip.dispatchEvent(secondEvent);
      });

      // Without preventDefault the default action stays allowed.
      expect(secondEvent.defaultPrevented).toBe(false);
      // No modal in the DOM — provider is unmounted.
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      orphanChip.remove();
    }
  });
});

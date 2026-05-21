import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { act, render, screen } from '@testing-library/react';
import { Markdown } from 'tiptap-markdown';

import NodeTextEditor from '../NodeTextEditor';
import Wikilink from '../wikilinkExtension';

jest.mock('react-dom', () => jest.requireActual('react-dom'));

let mockResolvedTitleById: Record<string, string | undefined> = {};
let mockResolverVersion = 0;
const mockResolverSubscribers = new Set<() => void>();

const mockResolver = jest.fn((id: string) => mockResolvedTitleById[id]);

function notifyResolverChanged(): void {
  mockResolverVersion += 1;
  for (const subscriber of Array.from(mockResolverSubscribers)) {
    subscriber();
  }
}

jest.mock('@/hooks/useWikilinkResolver', () => {
  const React = jest.requireActual<typeof import('react')>('react');

  return {
    useWikilinkResolver: () => {
      React.useSyncExternalStore(
        (onStoreChange: () => void) => {
          mockResolverSubscribers.add(onStoreChange);
          return () => {
            mockResolverSubscribers.delete(onStoreChange);
          };
        },
        () => mockResolverVersion,
        () => mockResolverVersion
      );

      return mockResolver;
    },
  };
});

jest.mock('@/(pages)/(private)/studies/components/WikilinkPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="wikilink-picker" />,
}));

describe('NodeTextEditor wikilinks', () => {
  beforeEach(() => {
    mockResolvedTitleById = { abc: 'Resolved Note' };
    mockResolverVersion = 0;
    mockResolverSubscribers.clear();
    mockResolver.mockClear();
    mockResolver.mockImplementation((id: string) => mockResolvedTitleById[id]);
  });

  it('renders an initial markdown wikilink as a resolved inline chip', async () => {
    render(<NodeTextEditor value="See [[abc]]" onChange={jest.fn()} />);

    const chip = await screen.findByRole('link', { name: '● Resolved Note' });
    expect(chip).toHaveAttribute('data-wikilink-id', 'abc');
    expect(chip).toHaveAttribute('href', '/studies/abc');
    expect(chip).toHaveClass('bg-emerald-50');
    expect(chip).toHaveClass('rounded-full');
  });

  it('re-renders an existing chip when the resolver cache hydrates', async () => {
    mockResolvedTitleById = {};

    render(<NodeTextEditor value="See [[abc]]" onChange={jest.fn()} />);

    const unresolvedChip = await screen.findByRole('link', { name: '● abc' });
    expect(unresolvedChip).toHaveAttribute('data-wikilink-id', 'abc');

    mockResolvedTitleById = { abc: 'Hydrated Note' };

    act(() => {
      notifyResolverChanged();
    });

    const hydratedChip = await screen.findByRole('link', { name: '● Hydrated Note' });
    expect(hydratedChip).toHaveAttribute('data-wikilink-id', 'abc');
  });

  it('serializes wikilink nodes back to literal markdown tokens', () => {
    const editor = new Editor({
      extensions: [
        StarterKit,
        Wikilink.configure(),
        Markdown,
      ],
      content: '',
    });

    editor.commands.setContent('text [[abc]] more');

    expect(editor.getHTML()).toContain('data-wikilink-id="abc"');
    expect(editor.getHTML()).toContain('● abc');
    // @ts-expect-error - tiptap-markdown types don't extend core storage types properly
    expect(editor.storage.markdown.getMarkdown()).toBe('text [[abc]] more');

    editor.destroy();
  });

  it('roundtrips multiple wikilinks in a single paragraph without losing either chip', () => {
    // Two wikilinks on the same line — the markdown-it inline rule has to
    // emit them as separate nodes, the renderer has to mount two chips with
    // distinct data-wikilink-id values, and the serializer has to put both
    // tokens back in their original positions with the surrounding text
    // preserved character-for-character.
    const editor = new Editor({
      extensions: [
        StarterKit,
        Wikilink.configure(),
        Markdown,
      ],
      content: '',
    });

    editor.commands.setContent('a [[abc]] b [[def]] c');

    const html = editor.getHTML();
    expect(html).toContain('data-wikilink-id="abc"');
    expect(html).toContain('data-wikilink-id="def"');

    // @ts-expect-error - tiptap-markdown types don't extend core storage types properly
    expect(editor.storage.markdown.getMarkdown()).toBe('a [[abc]] b [[def]] c');

    editor.destroy();
  });
});

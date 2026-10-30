// Exercise the production reader pipeline, not the global react-markdown stub.
jest.unmock('react-markdown');
jest.unmock('remark-gfm');
jest.unmock('rehype-raw');
jest.unmock('rehype-sanitize');

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { FoldableMarkdown } from '@components/ui/FoldableMarkdown';
import { useMarkdownOutline } from '@/hooks/useMarkdownOutline';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { title?: string }) => {
      if (key === 'textOutline.toggleSection') return `Toggle ${options?.title ?? ''}`;
      if (key === 'textOutline.collapseAll') return 'Collapse all';
      if (key === 'textOutline.expandAll') return 'Expand all';
      if (key === 'textOutline.untitledSection') return 'Untitled section';
      return key;
    },
  }),
}));

const TARGET = 'https://example.com/shared-destination';
const DIRECT_TARGET = 'https://example.com/direct-destination';
const FOOTNOTE_BODY = 'The shared footnote body stays with the whole note.';
const CODE_REFERENCE = '[literal][place] [^note]';

const NOTE = [
  'Intro [intro forward][place] and [^note].',
  '',
  '# [First heading][place] [^note]',
  '',
  'Body [body forward][place] and [^note], plus [direct destination](' + DIRECT_TARGET + ').',
  '',
  '`' + CODE_REFERENCE + '`',
  '',
  '```text',
  CODE_REFERENCE,
  '```',
  '',
  '# Definitions',
  '[place]: ' + TARGET + ' "Shared target"',
  '[^note]: ' + FOOTNOTE_BODY,
  '',
  '# [After heading][place]',
  '',
  'After [backward reference][place] and [^note].',
].join('\n');

function inspectReferenceSemantics(root: HTMLElement) {
  const links = [...root.querySelectorAll('a')];
  const referenceLinks = links.filter(link => link.getAttribute('href') === TARGET);
  const footnoteReferences = [...root.querySelectorAll('a[data-footnote-ref]')];
  const footnoteBacklinks = [...root.querySelectorAll('a[data-footnote-backref]')];
  const footnoteLists = [...root.querySelectorAll('section[data-footnotes]')];
  const footnoteItems = footnoteLists.flatMap(section => [...section.querySelectorAll('li[id]')]);
  const ids = [...root.querySelectorAll('[id]')].map(element => element.id);
  const targetIsOwned = (href: string | null) => {
    if (!href?.startsWith('#')) return false;
    const targetId = decodeURIComponent(href.slice(1));
    const target = root.ownerDocument.getElementById(targetId);
    return Boolean(target && root.contains(target));
  };
  return {
    links,
    referenceLinks,
    footnoteReferences,
    footnoteBacklinks,
    footnoteLists,
    footnoteHeadings: footnoteLists.flatMap(section => [...section.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]')]),
    footnoteItems,
    ids,
    uniqueIds: new Set(ids).size === ids.length,
    referencesOwned: footnoteReferences.every(reference => targetIsOwned(reference.getAttribute('href'))),
    backlinksOwned: footnoteBacklinks.every(backlink => targetIsOwned(backlink.getAttribute('href'))),
  };
}

describe('FoldableMarkdown document-wide reference definitions', () => {
  it('resolves forward, backward and repeated references across intro, headings, bodies and a definitions-only section', () => {
    const { container } = render(<FoldableMarkdown content={NOTE} />);
    const result = inspectReferenceSemantics(container);

    expect(result.referenceLinks).toHaveLength(5);
    expect(result.referenceLinks.map(link => (link.textContent ?? '').trim()).sort()).toEqual([
      'After heading',
      'First heading',
      'backward reference',
      'body forward',
      'intro forward',
    ]);
    expect(result.referenceLinks.every(link => link.getAttribute('href') === TARGET)).toBe(true);

    expect(result.footnoteReferences).toHaveLength(4);
    expect(result.footnoteReferences.every(reference => (reference.textContent ?? '').trim().length > 0)).toBe(true);
    expect(result.footnoteLists).toHaveLength(1);
    expect(result.footnoteHeadings).toHaveLength(1);
    expect(result.footnoteItems).toHaveLength(1);
    expect(result.footnoteItems[0]).toHaveTextContent(FOOTNOTE_BODY);
    expect(result.footnoteBacklinks).toHaveLength(4);
    expect(result.uniqueIds).toBe(true);
    expect(result.referencesOwned).toBe(true);
    expect(result.backlinksOwned).toBe(true);

    const directLinks = result.links.filter(link => link.getAttribute('href') === DIRECT_TARGET);
    expect(directLinks).toHaveLength(1);
    expect(directLinks[0]).toHaveTextContent('direct destination');
    const codeNodes = [...container.querySelectorAll('code')];
    expect(codeNodes.map(code => (code.textContent ?? '').replace(/\n$/, ''))).toEqual([CODE_REFERENCE, CODE_REFERENCE]);
    expect(codeNodes.every(code => code.querySelector('a') === null)).toBe(true);
    expect(container.textContent).not.toContain('[place]:');
    expect(container.textContent).not.toContain('[^note]:');
  });

  it('keeps the rendered footnote and its body visible when its source definition section folds', () => {
    const { container } = render(<FoldableMarkdown content={NOTE} />);
    expect(screen.getAllByText(FOOTNOTE_BODY)).toHaveLength(1);

    const toggle = screen.getByRole('button', { name: 'Toggle Definitions' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('[data-section-id="1"]')).toBeInTheDocument();
    expect(screen.getAllByText(FOOTNOTE_BODY)).toHaveLength(1);
    const afterFold = inspectReferenceSemantics(container);
    expect(afterFold.footnoteLists).toHaveLength(1);
    expect(afterFold.footnoteHeadings).toHaveLength(1);
    expect(afterFold.footnoteItems).toHaveLength(1);
    expect(afterFold.footnoteReferences).toHaveLength(4);
    expect(afterFold.footnoteBacklinks).toHaveLength(4);
    expect(afterFold.referencesOwned).toBe(true);
    expect(afterFold.backlinksOwned).toBe(true);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByText(FOOTNOTE_BODY)).toHaveLength(1);
  });

  it('keeps all existing legacy callout types readable beside cross-section references', () => {
    const types = ['Illustration', 'Application', 'Question', 'Quote', 'Definition'];
    const content = [
      '# First',
      'Before [forward][place].',
      ...types.map(type => `[${type}: Single line ${type}.]`),
      '# Definitions',
      '[place]: https://example.com/prepared-target',
      '# Last',
      'After [backward][place].',
    ].join('\n\n');
    const { container } = render(<FoldableMarkdown content={content} />);
    const callouts = [...container.querySelectorAll('.markdown-callout')];
    const links = [...container.querySelectorAll('a')].filter(link => link.getAttribute('href') === 'https://example.com/prepared-target');

    expect(callouts).toHaveLength(types.length);
    for (const type of types) {
      expect(callouts.filter(callout => callout.textContent?.includes(type))).toHaveLength(1);
    }
    expect(links.map(link => (link.textContent ?? '').trim()).sort()).toEqual(['backward', 'forward']);
  });

  it('keeps same-label links and footnotes independent in separate rendered documents', () => {
    const first = '# First\n\n[one][same] and [^shared].\n\n[same]: https://example.com/first\n[^shared]: First document note.';
    const second = '# Second\n\n[two][same] and [^shared].\n\n[same]: https://example.com/second\n[^shared]: Second document note.';
    const { container } = render(
      <>
        <article data-testid="first-document"><FoldableMarkdown content={first} /></article>
        <article data-testid="second-document"><FoldableMarkdown content={second} /></article>
      </>,
    );
    const firstRoot = container.querySelector('[data-testid="first-document"]') as HTMLElement;
    const secondRoot = container.querySelector('[data-testid="second-document"]') as HTMLElement;
    const firstResult = inspectReferenceSemantics(firstRoot);
    const secondResult = inspectReferenceSemantics(secondRoot);
    const firstLink = firstResult.links.find(link => (link.textContent ?? '').trim() === 'one');
    const secondLink = secondResult.links.find(link => (link.textContent ?? '').trim() === 'two');

    expect(firstLink?.getAttribute('href')).toBe('https://example.com/first');
    expect(secondLink?.getAttribute('href')).toBe('https://example.com/second');
    expect(firstResult.footnoteReferences).toHaveLength(1);
    expect(secondResult.footnoteReferences).toHaveLength(1);
    expect(firstResult.footnoteBacklinks).toHaveLength(1);
    expect(secondResult.footnoteBacklinks).toHaveLength(1);
    expect(firstResult.footnoteItems).toHaveLength(1);
    expect(secondResult.footnoteItems).toHaveLength(1);
    expect(firstResult.footnoteItems[0]).toHaveTextContent('First document note.');
    expect(secondResult.footnoteItems[0]).toHaveTextContent('Second document note.');
    expect(firstResult.uniqueIds).toBe(true);
    expect(secondResult.uniqueIds).toBe(true);
    expect(firstResult.ids.some(id => secondResult.ids.includes(id))).toBe(false);
    expect(firstResult.referencesOwned && firstResult.backlinksOwned).toBe(true);
    expect(secondResult.referencesOwned && secondResult.backlinksOwned).toBe(true);
  });

  it('preserves the ordinary section and collapse-all fold controls', () => {
    const content = '# First\n\nFirst body.\n\n# Second\n\nSecond body.';
    const { container } = render(<FoldableMarkdown content={content} />);
    const first = screen.getByRole('button', { name: 'Toggle First' });
    const second = screen.getByRole('button', { name: 'Toggle Second' });

    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(second).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(second).toHaveAttribute('aria-expanded', 'false');
    expect(container).not.toHaveTextContent('First body.');
    expect(container).not.toHaveTextContent('Second body.');

    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(second).toHaveAttribute('aria-expanded', 'true');
    expect(container).toHaveTextContent('First body.');
    expect(container).toHaveTextContent('Second body.');
  });

  it('preserves ordinary folding controls and one shared outline control across readers', () => {
    const content = '# First\n\nFirst body.\n\n# Second\n\nSecond body.';
    function SharedReaders() {
      const control = useMarkdownOutline(content);
      return (
        <>
          <article data-testid="reader-one">
            <FoldableMarkdown content={content} control={control} showToggleAll={false} />
          </article>
          <article data-testid="reader-two">
            <FoldableMarkdown content={content} control={control} showToggleAll={false} />
          </article>
        </>
      );
    }
    const { container } = render(<SharedReaders />);
    const firstButtons = screen.getAllByRole('button', { name: 'Toggle First' });
    expect(firstButtons).toHaveLength(2);
    expect(firstButtons.every(button => button.getAttribute('aria-expanded') === 'true')).toBe(true);

    fireEvent.click(firstButtons[0]);
    expect(firstButtons.every(button => button.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(container.querySelector('[data-testid="reader-one"]')).not.toHaveTextContent('First body.');
    expect(container.querySelector('[data-testid="reader-two"]')).not.toHaveTextContent('First body.');
    expect(container.querySelector('[data-testid="reader-one"]')).toHaveTextContent('Second body.');
    expect(container.querySelector('[data-testid="reader-two"]')).toHaveTextContent('Second body.');

    fireEvent.click(firstButtons[1]);
    expect(firstButtons.every(button => button.getAttribute('aria-expanded') === 'true')).toBe(true);
    expect(container.querySelector('[data-testid="reader-one"]')).toHaveTextContent('First body.');
    expect(container.querySelector('[data-testid="reader-two"]')).toHaveTextContent('First body.');
  });
  it('reopens a folded section before following a footnote backlink to its body', async () => {
    const { container } = render(<FoldableMarkdown content={NOTE} />);
    const references = [...container.querySelectorAll('a[data-footnote-ref]')];
    expect(references).toHaveLength(4);
    const targetId = references[2].id;
    const backlink = [...container.querySelectorAll('a[data-footnote-backref]')].find(link => link.getAttribute('href') === '#' + targetId);
    expect(backlink).toBeDefined();
    const first = container.querySelector('[data-section-id="0"] button[aria-expanded]') as HTMLButtonElement;
    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelectorAll('a[data-footnote-ref]')).toHaveLength(3);
    fireEvent.click(backlink!);
    await waitFor(() => expect(first).toHaveAttribute('aria-expanded', 'true'));
    expect(container.ownerDocument.getElementById(targetId)).toBeInTheDocument();
    await waitFor(() => expect(container.ownerDocument.activeElement?.id).toBe(targetId));
    expect(screen.getByRole('button', { name: 'Toggle Definitions' })).toBeInTheDocument();
  });

  it('keeps an open host editor mounted when another section folds', () => {
    function Editor() {
      const [text, setText] = React.useState('Original draft');
      return <input aria-label="Host draft" value={text} onChange={event => setText(event.target.value)} />;
    }
    render(<FoldableMarkdown content={'# First\nBody.\n# Second\nOther body.'} sectionExtra={section => section.id === '0' ? <Editor /> : null} />);
    const editor = screen.getByRole('textbox', { name: 'Host draft' });
    fireEvent.change(editor, { target: { value: 'Uncommitted host words' } });
    fireEvent.click(screen.getByRole('button', { name: 'Toggle Second' }));
    expect(screen.getByRole('textbox', { name: 'Host draft' })).toBe(editor);
    expect(editor).toHaveValue('Uncommitted host words');
  });

  it('keeps a heading link independent of the fold gesture', () => {
    const { container } = render(<FoldableMarkdown content={'# [Heading][place]\nBody.\n# Definitions\n[place]: https://example.com/heading'} />);
    const link = container.querySelector('a[href="https://example.com/heading"]');
    expect(link).toBeInTheDocument();
    link!.addEventListener('click', event => event.preventDefault());
    const toggle = container.querySelector('[data-section-id="0"] button[aria-expanded]');
    fireEvent.click(link!);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps authored footnote-looking HTML in its original section', () => {
    render(<FoldableMarkdown content={'# First\n\n<section data-footnotes><p>Authored block.</p></section>\n\n# Second\nBody.'} />);
    expect(screen.getByText('Authored block.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle First' }));
    expect(screen.queryByText('Authored block.')).not.toBeInTheDocument();
  });

  it('reveals and focuses a nonfocusable authored target without changing its original attributes', async () => {
    const { container } = render(<FoldableMarkdown content={'# First\n\n<p id="hidden-target">Owned target.</p>\n\n# Last\n\n[Return](#hidden-target)'} />);
    const target = screen.getByText('Owned target.');
    expect(target).not.toHaveAttribute('tabindex');
    const targetId = target.id;
    const link = screen.getByRole('link', { name: 'Return' });
    expect(link).toHaveAttribute('href', '#' + targetId);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle First' }));
    expect(screen.queryByText('Owned target.')).not.toBeInTheDocument();
    fireEvent.click(link);
    await waitFor(() => expect(container.ownerDocument.activeElement?.id).toBe(targetId));
    const revealed = screen.getByText('Owned target.');
    expect(revealed).toHaveAttribute('tabindex', '-1');
    revealed.blur();
    expect(revealed).not.toHaveAttribute('tabindex');
  });

  it('keeps the first child section first when its parent has no own prose', () => {
    const { container } = render(<FoldableMarkdown content={'# Parent\n## Child\nBody.'} />);
    const parent = container.querySelector('[data-section-id="0"]');
    const guide = parent?.querySelector(':scope > .border-l');
    expect(guide?.firstElementChild).toHaveAttribute('data-section-id', '0.0');
  });

});

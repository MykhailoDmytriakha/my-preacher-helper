import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import StructurePreview from '@/components/sermon/StructurePreview';

import type { Sermon, Thought } from '@/models/models';

// Tags mirror the section a thought is stored in, as the app does: the real ordering also
// lists an unassigned, untagged thought under "under consideration".
const makeThought = (id: string, text: string, tags: string[] = []): Thought => ({
  id,
  text,
  tags,
  date: '2024-01-01T00:00:00.000Z',
});

const thoughts = [
  makeThought('t1', 'Opening thought', ['intro']),
  makeThought('t2', 'Central argument', ['main']),
  makeThought('t3', 'Closing appeal', ['conclusion']),
  makeThought('t4', 'Undecided idea'),
];

const buildSermon = (structure?: Sermon['structure']): Sermon => ({
  id: 's1',
  title: 'Sermon',
  verse: 'John 3:16',
  date: '2024-01-01',
  userId: 'u1',
  thoughts,
  structure,
});

describe('StructurePreview', () => {
  it('renders nothing when the sermon has no structure', () => {
    const { container } = render(<StructurePreview sermon={buildSermon(undefined)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the preview heading and a collapse button', () => {
    render(<StructurePreview sermon={buildSermon({ introduction: [], main: [], conclusion: [] })} />);
    expect(screen.getByRole('heading', { name: 'structure.preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
  });

  it('shows no section labels when every section is empty', () => {
    render(<StructurePreview sermon={buildSermon({ introduction: [], main: [], conclusion: [] })} />);
    expect(screen.queryByText('tags.introduction')).not.toBeInTheDocument();
    expect(screen.queryByText('tags.mainPart')).not.toBeInTheDocument();
    expect(screen.queryByText('tags.conclusion')).not.toBeInTheDocument();
    expect(screen.queryByText('structure.underConsideration')).not.toBeInTheDocument();
  });

  it('shows the introduction section with its thought text', () => {
    render(<StructurePreview sermon={buildSermon({ introduction: ['t1'], main: [], conclusion: [] })} />);
    expect(screen.getByText('tags.introduction')).toBeInTheDocument();
    expect(screen.getByText('Opening thought...')).toBeInTheDocument();
    expect(screen.queryByText('tags.mainPart')).not.toBeInTheDocument();
  });

  it('shows the main part section with its thought text', () => {
    render(<StructurePreview sermon={buildSermon({ introduction: [], main: ['t2'], conclusion: [] })} />);
    expect(screen.getByText('tags.mainPart')).toBeInTheDocument();
    expect(screen.getByText('Central argument...')).toBeInTheDocument();
    expect(screen.queryByText('tags.introduction')).not.toBeInTheDocument();
  });

  it('shows the conclusion section with its thought text', () => {
    render(<StructurePreview sermon={buildSermon({ introduction: [], main: [], conclusion: ['t3'] })} />);
    expect(screen.getByText('tags.conclusion')).toBeInTheDocument();
    expect(screen.getByText('Closing appeal...')).toBeInTheDocument();
  });

  it('shows the under-consideration section for ambiguous thoughts', () => {
    render(<StructurePreview sermon={buildSermon({ introduction: [], main: [], conclusion: [], ambiguous: ['t4'] })} />);
    expect(screen.getByText('structure.underConsideration')).toBeInTheDocument();
    expect(screen.getByText('Undecided idea...')).toBeInTheDocument();
  });

  it('shows all four sections together', () => {
    render(
      <StructurePreview
        sermon={buildSermon({ introduction: ['t1'], main: ['t2'], conclusion: ['t3'], ambiguous: ['t4'] })}
      />
    );
    ['tags.introduction', 'tags.mainPart', 'tags.conclusion', 'structure.underConsideration'].forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
    ['Opening thought...', 'Central argument...', 'Closing appeal...', 'Undecided idea...'].forEach((text) => {
      expect(screen.getByText(text)).toBeInTheDocument();
    });
  });

  it('truncates long thought text to 100 characters plus an ellipsis', () => {
    const long = `${'a'.repeat(100)}TAIL`;
    const sermon = { ...buildSermon({ introduction: ['t1'], main: [], conclusion: [] }), thoughts: [makeThought('t1', long)] };
    render(<StructurePreview sermon={sermon} />);
    expect(screen.getByText(`${'a'.repeat(100)}...`)).toBeInTheDocument();
    expect(screen.queryByText(/TAIL/)).not.toBeInTheDocument();
  });

  it('hides the sections when collapsed and shows them again when expanded', () => {
    render(<StructurePreview sermon={buildSermon({ introduction: ['t1'], main: ['t2'], conclusion: [] })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(screen.queryByText('tags.introduction')).not.toBeInTheDocument();
    expect(screen.queryByText('Central argument...')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'structure.preview' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByText('tags.introduction')).toBeInTheDocument();
    expect(screen.getByText('Central argument...')).toBeInTheDocument();
  });
});

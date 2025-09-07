import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';

import ThoughtFilterControls from '@/components/sermon/ThoughtFilterControls';
import { STRUCTURE_TAGS } from '@lib/constants';

function makeProps(overrides: Partial<React.ComponentProps<typeof ThoughtFilterControls>> = {}) {
  const buttonRef = React.createRef<HTMLButtonElement>();
  return {
    isOpen: true,
    setIsOpen: jest.fn(),
    viewFilter: 'all' as const,
    setViewFilter: jest.fn(),
    structureFilter: 'all',
    setStructureFilter: jest.fn(),
    tagFilters: [] as string[],
    toggleTagFilter: jest.fn(),
    resetFilters: jest.fn(),
    sortOrder: 'date' as const,
    setSortOrder: jest.fn(),
    allowedTags: [
      { name: STRUCTURE_TAGS.INTRODUCTION, color: '#f00' },
      { name: 'Grace', color: '#0f0' },
      { name: STRUCTURE_TAGS.CONCLUSION, color: '#00f' },
    ],
    hasStructureTags: true,
    buttonRef,
    ...overrides,
  };
}

describe('ThoughtFilterControls', () => {
  it('closes when clicking outside and stays open for inside clicks', () => {
    const setIsOpen = jest.fn();
    const buttonRef = React.createRef<HTMLButtonElement>();

    // Render an outside area and the trigger button the menu expects
    const { container } = render(
      <div>
        <div data-testid="outside" />
        <button ref={buttonRef} data-testid="thought-filter-button">Toggle</button>
        <ThoughtFilterControls {...makeProps({ setIsOpen, buttonRef })} />
      </div>
    );

    // Clicking inside the menu should NOT close it
    const menu = screen.getByTestId('thought-filter-controls');
    fireEvent.pointerDown(menu);
    expect(setIsOpen).not.toHaveBeenCalled();

    // Clicking the document outside should close it
    const outside = screen.getByTestId('outside');
    fireEvent.pointerDown(outside);
    expect(setIsOpen).toHaveBeenCalledWith(false);
  });

  it('uses unique radio group names per instance (no cross-group interference)', () => {
    const buttonRef1 = React.createRef<HTMLButtonElement>();
    const buttonRef2 = React.createRef<HTMLButtonElement>();

    render(
      <div>
        <button ref={buttonRef1} data-testid="btn1">One</button>
        <div data-testid="wrap1">
          <ThoughtFilterControls {...makeProps({ buttonRef: buttonRef1 })} />
        </div>
        <button ref={buttonRef2} data-testid="btn2">Two</button>
        <div data-testid="wrap2">
          <ThoughtFilterControls {...makeProps({ buttonRef: buttonRef2 })} />
        </div>
      </div>
    );

    const wrap1 = screen.getByTestId('wrap1');
    const wrap2 = screen.getByTestId('wrap2');

    // The 'All' view radio exists in both instances; ensure their name attributes differ
    const radio1 = within(wrap1).getByLabelText('filters.all') as HTMLInputElement;
    const radio2 = within(wrap2).getByLabelText('filters.all') as HTMLInputElement;
    expect(radio1).toBeInTheDocument();
    expect(radio2).toBeInTheDocument();
    expect(radio1.name).toMatch(/^viewFilter-/);
    expect(radio2.name).toMatch(/^viewFilter-/);
    expect(radio1.name).not.toEqual(radio2.name);
  });

  it('excludes structure tags from the tag checklist and shows custom tags', () => {
    const buttonRef = React.createRef<HTMLButtonElement>();
    render(
      <div>
        <button ref={buttonRef}>Toggle</button>
        <ThoughtFilterControls {...makeProps({ buttonRef })} />
      </div>
    );

    // Custom tag appears
    expect(screen.getByText('Grace')).toBeInTheDocument();
    // Structure tags are filtered out from the tag checklist
    expect(screen.queryByText(STRUCTURE_TAGS.INTRODUCTION)).not.toBeInTheDocument();
    expect(screen.queryByText(STRUCTURE_TAGS.CONCLUSION)).not.toBeInTheDocument();
  });
});


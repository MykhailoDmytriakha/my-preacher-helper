import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import ClassicThoughtsPanel from "@/components/sermon/ClassicThoughtsPanel";

jest.mock("@/components/sermon/BrainstormModule", () => () => (
  <div data-testid="brainstorm-module">Brainstorm module</div>
));

jest.mock("@/components/sermon/ThoughtFilterControls", () => () => (
  <div data-testid="thought-filter-controls">Filter controls</div>
));

jest.mock("@/components/sermon/ThoughtList", () => () => (
  <div data-testid="thought-list">Thought list</div>
));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "sermon.allThoughts": "All Thoughts",
        "filters.filter": "Filter",
        "filters.activeFilters": "Active Filters",
        "filters.clear": "Clear",
        "filters.missingTags": "Missing Tags",
        "filters.sortByStructure": "Sorted by ThoughtsBySection",
        "brainstorm.title": "Brainstorm",
      };
      return map[key] ?? key;
    },
  }),
}));

type Props = React.ComponentProps<typeof ClassicThoughtsPanel>;

const createProps = (overrides: Partial<Props> = {}): Props => ({
  withBrainstorm: true,
  portalRef: React.createRef<HTMLDivElement>(),
  isClassicMode: true,
  activeCount: 3,
  totalThoughts: 7,
  isFilterOpen: false,
  setIsFilterOpen: jest.fn(),
  viewFilter: "all",
  setViewFilter: jest.fn(),
  structureFilter: "all",
  setStructureFilter: jest.fn(),
  tagFilters: [],
  toggleTagFilter: jest.fn(),
  resetFilters: jest.fn(),
  sortOrder: "date",
  setSortOrder: jest.fn(),
  allowedTags: [
    { name: "grace", color: "#0f172a" },
    { name: "hope", color: "#fef08a" },
  ],
  hasStructureTags: true,
  filterButtonRef: React.createRef<HTMLButtonElement>(),
  isBrainstormOpen: false,
  setIsBrainstormOpen: jest.fn(),
  sermonId: "sermon-1",
  brainstormSuggestion: null,
  setBrainstormSuggestion: jest.fn(),
  filteredThoughts: [],
  sermonOutline: {
    introduction: [],
    main: [],
    conclusion: [],
  },
  onDelete: jest.fn(),
  onEditStart: jest.fn(),
  onThoughtUpdate: jest.fn(),
  isReadOnly: false,
  ...overrides,
});

describe("ClassicThoughtsPanel", () => {
  it("renders active filter badges for structure mappings and fallback value", () => {
    const { rerender } = render(
      <ClassicThoughtsPanel
        {...createProps({
          structureFilter: "intro",
        })}
      />
    );
    expect(screen.getByText("structure.introduction")).toBeInTheDocument();

    rerender(
      <ClassicThoughtsPanel
        {...createProps({
          structureFilter: "main",
        })}
      />
    );
    expect(screen.getByText("structure.mainPart")).toBeInTheDocument();

    rerender(
      <ClassicThoughtsPanel
        {...createProps({
          structureFilter: "conclusion",
        })}
      />
    );
    expect(screen.getByText("structure.conclusion")).toBeInTheDocument();

    rerender(
      <ClassicThoughtsPanel
        {...createProps({
          structureFilter: "custom-structure",
        })}
      />
    );
    expect(screen.getByText("custom-structure")).toBeInTheDocument();
  });

  it("toggles filter and brainstorm controls in classic mode", () => {
    const setIsFilterOpen = jest.fn();
    const setIsBrainstormOpen = jest.fn();
    render(
      <ClassicThoughtsPanel
        {...createProps({
          setIsFilterOpen,
          setIsBrainstormOpen,
          isFilterOpen: false,
          isBrainstormOpen: false,
        })}
      />
    );

    const filterButton = screen.getByTestId("thought-filter-button");
    fireEvent.click(filterButton);
    expect(setIsFilterOpen).toHaveBeenCalledWith(true);
    expect(screen.getByTestId("thought-filter-controls")).toBeInTheDocument();

    const brainstormButton = screen.getByLabelText("Brainstorm");
    fireEvent.click(brainstormButton);
    expect(setIsBrainstormOpen).toHaveBeenCalledWith(true);
  });

  it("renders full active filter summary, tag colors, and clear action", () => {
    const resetFilters = jest.fn();

    render(
      <ClassicThoughtsPanel
        {...createProps({
          viewFilter: "missingTags",
          structureFilter: "all",
          sortOrder: "structure",
          tagFilters: ["grace", "unknown-tag"],
          resetFilters,
        })}
      />
    );

    expect(screen.getAllByText("Active Filters:").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Missing Tags").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sorted by ThoughtsBySection").length).toBeGreaterThan(0);
    expect(screen.getAllByText("grace").length).toBeGreaterThan(0);
    expect(screen.getAllByText("unknown-tag").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByText("Clear")[0]);
    expect(resetFilters).toHaveBeenCalled();
  });
});

import { render, screen } from '@testing-library/react';

import { ReaderAnalysis } from '@/components/bible/analysis/ReaderAnalysis';

import type { AnalysisDoor } from '@/components/bible/analysis/AnalysisParts';
import type { VerseCopy } from '@/components/bible/verseCopy/useVerseCopy';
import type { BookText } from '@/utils/bibleText';

/*
 * The owner, 03.11: «если я был в Библии… нашел какой-то разбор, и я его открыл, и работал, то я могу выйти туда к
 * изучению». An analysis open over the reader's text has a door to its other home — the list of all analyses — opened at
 * this one, the reader's own way to another screen taking it there.
 */
let mockDoor: AnalysisDoor | undefined;
let mockOpenScreen: ((href: string) => void) | undefined;
jest.mock('@/components/bible/analysis/AnalysisEditor', () => ({
  AnalysisEditor: ({ door, onOpenScreen }: { door?: AnalysisDoor; onOpenScreen?: (href: string) => void }) => {
    mockDoor = door;
    mockOpenScreen = onOpenScreen;
    return <div data-testid="editor" />;
  },
}));
jest.mock('@/components/bible/analysis/useAnalysisReshape', () => ({ useAnalysisReshape: () => jest.fn() }));
jest.mock('@/components/bible/verseCopy/VerseCopyBar', () => ({ VerseCopyBar: () => null }));
jest.mock('@/components/bible/verseCopy/PassagePickBar', () => ({ PassagePickBar: () => null }));

const TEXT: BookText = { id: 'Ephesians', chapters: [['Павел, волею Божиею Апостол Иисуса Христа']] };
const copy = { purpose: null, picking: false, clear: jest.fn(), startPassage: jest.fn() } as unknown as VerseCopy;

describe('an analysis open over the reader — its door to all analyses', () => {
  it('leads to the list of analyses opened at this one, by the reader\'s way to another screen', () => {
    const onOpenScreen = jest.fn();
    render(
      <ReaderAnalysis copy={copy} text={TEXT} wide bookId="Ephesians" bible="rst" locale="ru"
        opening={{ kind: 'open', id: 'an-1', editing: false }} onOpening={jest.fn()} onOpenScreen={onOpenScreen} />,
    );
    expect(screen.getByTestId('editor')).toBeInTheDocument();
    expect(mockDoor?.home).toBe('analyses');
    expect(mockDoor?.href('an-1')).toBe('/studies?tab=analyses&at=an-1');
    // A new analysis not yet kept has no card to be opened at: the list, at its top.
    expect(mockDoor?.href(null)).toBe('/studies?tab=analyses');
    expect(mockOpenScreen).toBe(onOpenScreen);
  });
});

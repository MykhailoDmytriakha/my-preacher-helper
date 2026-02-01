import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import ExportButtons, { ExportTxtModal } from '../../app/components/ExportButtons';
import '@testing-library/jest-dom';

// Mock the required dependencies
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: jest.fn() }
  })
}));

jest.mock('@locales/i18n', () => ({}));

jest.mock('react-markdown', () => ({ children }: any) => <div>{children}</div>);

jest.mock('remark-gfm', () => ({}));

jest.mock('jspdf', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    save: jest.fn(),
    addPage: jest.fn(),
    text: jest.fn(),
    setFontSize: jest.fn(),
    setFont: jest.fn(),
    setTextColor: jest.fn(),
    setFillColor: jest.fn(),
    rect: jest.fn(),
    html: jest.fn()
  }))
}));

jest.mock('html2canvas', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue({
    toDataURL: jest.fn().mockReturnValue('data:image/png;base64,test')
  })
}));

jest.mock('@/components/AudioExportModal', () => ({
  __esModule: true,
  default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="audio-export-modal" /> : null),
}));

const mockExportToWord = jest.fn();
jest.mock('../../utils/wordExport', () => ({
  exportToWord: (args: any) => mockExportToWord(args),
  PlanData: {}
}));

describe('ExportButtons Component', () => {
  const mockGetExportContent = jest.fn(() => Promise.resolve('Test content'));
  const mockSermonId = 'test-sermon-id';
  const mockGetPdfContent = jest.fn(() => Promise.resolve('<div>PDF</div>'));
  const planData = {
    sermonTitle: 'Test Sermon',
    sermonVerse: 'John 1:1',
    introduction: 'Intro',
    main: 'Main',
    conclusion: 'Conclusion',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(
      <ExportButtons
        getExportContent={mockGetExportContent}
        sermonId={mockSermonId}
      />
    );

    expect(screen.getByText('TXT')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
    expect(screen.getByText('Word')).toBeInTheDocument();
  });

  it('handles getExportContent prop correctly', () => {
    render(
      <ExportButtons
        getExportContent={mockGetExportContent}
        sermonId={mockSermonId}
      />
    );

    expect(mockGetExportContent).not.toHaveBeenCalled(); // Should not be called on render
  });

  it('disables PDF export when PDF is not available', () => {
    render(
      <ExportButtons
        getExportContent={mockGetExportContent}
        sermonId={mockSermonId}
      />
    );

    expect(screen.getByRole('button', { name: 'Export to PDF (coming soon)' })).toBeDisabled();
    expect(screen.getByText('Coming soon!')).toBeInTheDocument();
  });

  it('enables PDF export when getPdfContent is provided', () => {
    render(
      <ExportButtons
        getExportContent={mockGetExportContent}
        getPdfContent={mockGetPdfContent}
        sermonId={mockSermonId}
      />
    );

    expect(screen.getByRole('button', { name: 'Export to PDF' })).toBeEnabled();
    expect(screen.queryByText('Coming soon!')).not.toBeInTheDocument();
  });

  it('positions PDF tooltip to the right when orientation is vertical', () => {
    render(
      <ExportButtons
        getExportContent={mockGetExportContent}
        sermonId={mockSermonId}
        orientation="vertical"
      />
    );

    const tooltip = screen.getByText('Coming soon!');
    expect(tooltip).toHaveClass('tooltiptext');
    expect(tooltip).toHaveClass('tooltiptext-right');
  });

  it('renders icon variant correctly', () => {
    render(
      <ExportButtons
        getExportContent={mockGetExportContent}
        sermonId={mockSermonId}
        variant="icon"
      />
    );

    // Should render buttons with icons but no text
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);

    // Check that buttons contain SVG icons but not text
    buttons.forEach(button => {
      expect(button).toContainElement(button.querySelector('svg'));
      expect(button.textContent).toBe(''); // No text content in icon variant
    });
  });

  it('renders default variant with text buttons', () => {
    render(
      <ExportButtons
        getExportContent={mockGetExportContent}
        sermonId={mockSermonId}
        variant="default"
      />
    );

    expect(screen.getByText('TXT')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
    expect(screen.getByText('Word')).toBeInTheDocument();
  });

  it('applies preached styling when isPreached prop is true', () => {
    render(
      <ExportButtons
        getExportContent={mockGetExportContent}
        sermonId={mockSermonId}
        isPreached={true}
        planData={planData}
      />
    );

    const txtButton = screen.getByText('TXT');
    const pdfButton = screen.getByText('PDF');
    const wordButton = screen.getByText('Word');

    // Check that preached styling is applied
    expect(txtButton).toHaveClass('bg-gray-300', 'dark:bg-gray-600', 'text-gray-700', 'dark:text-gray-200');
    expect(pdfButton).toHaveClass('bg-gray-300', 'dark:bg-gray-600', 'text-gray-700', 'dark:text-gray-200');
    expect(wordButton).toHaveClass('bg-gray-300', 'dark:bg-gray-600', 'text-gray-700', 'dark:text-gray-200');
  });

  it('applies non-preached styling when isPreached prop is false', () => {
    render(
      <ExportButtons
        getExportContent={mockGetExportContent}
        sermonId={mockSermonId}
        isPreached={false}
        planData={planData}
      />
    );

    const txtButton = screen.getByText('TXT');
    const pdfButton = screen.getByText('PDF');
    const wordButton = screen.getByText('Word');

    // Check that non-preached styling is applied
    expect(txtButton).toHaveClass('bg-blue-100', 'dark:bg-blue-900', 'text-blue-600', 'dark:text-blue-300');
    expect(pdfButton).toHaveClass('bg-purple-100', 'dark:bg-purple-900', 'text-purple-600', 'dark:text-purple-300');
    expect(wordButton).toHaveClass('bg-green-100', 'dark:bg-green-900', 'text-green-600', 'dark:text-green-300');
  });

  it('disables Word export when planData is not provided', () => {
    render(
      <ExportButtons
        getExportContent={mockGetExportContent}
        sermonId={mockSermonId}
      />
    );

    expect(screen.getByRole('button', { name: 'Export to Word' })).toBeDisabled();
  });

  it('exports to Word using planData on Word click', async () => {
    const user = userEvent.setup();
    const customPlanData = {
      sermonTitle: 'Sermon Title',
      sermonVerse: 'Verse line 1\nVerse line 2',
      introduction: 'Intro content',
      main: 'Main content',
      conclusion: 'Conclusion content'
    };

    render(
      <ExportButtons
        getExportContent={mockGetExportContent}
        sermonId={mockSermonId}
        title="Custom Title"
        sermonTitle="Sermon Title"
        planData={customPlanData}
      />
    );

    const wordButton = screen.getByText('Word');
    await user.click(wordButton);

    expect(mockExportToWord).toHaveBeenCalledWith({
      data: customPlanData,
      filename: 'sermon-plan-sermon-title.docx',
      focusedSection: undefined
    });
  });

  it('renders extra buttons and applies slot class', () => {
    render(
      <ExportButtons
        getExportContent={mockGetExportContent}
        sermonId={mockSermonId}
        slotClassName="slot-test"
        extraButtons={<div data-testid="extra-button">Extra</div>}
      />
    );

    expect(screen.getByTestId('extra-button')).toBeInTheDocument();
    const txtWrapper = screen.getByText('TXT').closest('div');
    expect(txtWrapper).toHaveClass('slot-test');
  });

  it('opens TXT modal and loads content', async () => {
    const user = userEvent.setup();

    render(
      <ExportButtons
        getExportContent={mockGetExportContent}
        sermonId={mockSermonId}
      />
    );

    await user.click(screen.getByText('TXT'));
    expect(await screen.findByTestId('export-txt-modal')).toBeInTheDocument();
    await waitFor(() => expect(mockGetExportContent).toHaveBeenCalled());
  });

  it('opens TXT modal when showTxtModalDirectly is true', async () => {
    render(
      <ExportButtons
        getExportContent={mockGetExportContent}
        sermonId={mockSermonId}
        showTxtModalDirectly
      />
    );

    expect(await screen.findByTestId('export-txt-modal')).toBeInTheDocument();
  });

  it('opens PDF modal when PDF export is available', async () => {
    const user = userEvent.setup();

    render(
      <ExportButtons
        getExportContent={mockGetExportContent}
        getPdfContent={mockGetPdfContent}
        sermonId={mockSermonId}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Export to PDF' }));
    expect(await screen.findByText('export.savePdf')).toBeInTheDocument();
  });

  it('renders audio export button and opens modal', async () => {
    const user = userEvent.setup();

    render(
      <ExportButtons
        getExportContent={mockGetExportContent}
        sermonId={mockSermonId}
        enableAudio
        sermonTitle="Test Sermon"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Audio (Beta)' }));
    expect(screen.getByTestId('audio-export-modal')).toBeInTheDocument();
  });

  describe('ExportTxtModal Interactions', () => {
    const mockClose = jest.fn();
    const mockGetContent = jest.fn();

    beforeAll(() => {
      // Setup clipboard mock
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: jest.fn().mockResolvedValue(undefined),
        },
        writable: true,
        configurable: true,
      });

      // Setup URL mocks
      if (typeof window.URL.createObjectURL === 'undefined') {
        Object.defineProperty(window.URL, 'createObjectURL', { value: jest.fn(() => 'blob:test'), writable: true, configurable: true });
      } else {
        jest.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:test');
      }

      if (typeof window.URL.revokeObjectURL === 'undefined') {
        Object.defineProperty(window.URL, 'revokeObjectURL', { value: jest.fn(), writable: true, configurable: true });
      } else {
        jest.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => { });
      }
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('toggles between Plain and Markdown formats', async () => {
      mockGetContent.mockResolvedValue('Content');
      const user = userEvent.setup();

      render(
        <ExportTxtModal
          isOpen={true}
          onClose={mockClose}
          getContent={mockGetContent}
          format="plain"
        />
      );

      await waitFor(() => expect(screen.getByText('Content')).toBeInTheDocument());

      const mdButton = screen.getByText('export.formatMarkdown');
      await user.click(mdButton);

      await waitFor(() => expect(mockGetContent).toHaveBeenCalledWith('markdown', { includeTags: false }));
    });

    it('toggles tags inclusion', async () => {
      mockGetContent.mockResolvedValue('Content');
      const user = userEvent.setup();
      render(<ExportTxtModal isOpen={true} onClose={mockClose} getContent={mockGetContent} />);
      await waitFor(() => expect(screen.getByText('Content')).toBeInTheDocument());
      const toggle = screen.getByRole('switch');
      await user.click(toggle);
      await waitFor(() => expect(mockGetContent).toHaveBeenCalledWith('plain', { includeTags: true }));
    });

    it('handles download', async () => {
      mockGetContent.mockResolvedValue('Content to download');
      const user = userEvent.setup();
      render(<ExportTxtModal isOpen={true} onClose={mockClose} getContent={mockGetContent} />);
      await waitFor(() => expect(screen.getByText('Content to download')).toBeInTheDocument());

      // Spy on click
      const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click');
      const downloadButton = screen.getByText('export.downloadTxt');
      await user.click(downloadButton);
      expect(clickSpy).toHaveBeenCalled();
    });
  });
});

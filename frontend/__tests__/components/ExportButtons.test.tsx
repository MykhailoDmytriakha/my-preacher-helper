import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import ExportButtons from '../../app/components/ExportButtons';
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

const mockExportToWord = jest.fn();
jest.mock('../../utils/wordExport', () => ({
  exportToWord: (args: any) => mockExportToWord(args),
  PlanData: {}
}));

describe('ExportButtons Component', () => {
  const mockGetExportContent = jest.fn(() => Promise.resolve('Test content'));
  const mockSermonId = 'test-sermon-id';
  const mockGetPdfContent = jest.fn(() => Promise.resolve('<div>PDF</div>'));

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

    expect(screen.getByRole('button', { name: 'PDF export (coming soon)' })).toBeDisabled();
    expect(screen.getByText('export.soonAvailable')).toBeInTheDocument();
  });

  it('enables PDF export when getPdfContent is provided', () => {
    render(
      <ExportButtons
        getExportContent={mockGetExportContent}
        getPdfContent={mockGetPdfContent}
        sermonId={mockSermonId}
      />
    );

    expect(screen.getByRole('button', { name: 'PDF export' })).toBeEnabled();
    expect(screen.queryByText('export.soonAvailable')).not.toBeInTheDocument();
  });

  it('positions PDF tooltip to the right when orientation is vertical', () => {
    render(
      <ExportButtons
        getExportContent={mockGetExportContent}
        sermonId={mockSermonId}
        orientation="vertical"
      />
    );

    const tooltip = screen.getByText('export.soonAvailable');
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

  it('calls getExportContent with markdown and exports to word on Word click', async () => {
    const user = userEvent.setup();

    // Custom content with multiple verses and section headers
    // Using ## headers as expected by the fixed parser
    const markdownContent = `# Sermon Title
> Verse line 1
> Verse line 2

## Introduction
Intro content

## Main Part
Main content

## Conclusion
Conclusion content`;

    mockGetExportContent.mockResolvedValueOnce(markdownContent);

    render(
      <ExportButtons
        getExportContent={mockGetExportContent}
        sermonId={mockSermonId}
        title="Custom Title"
      />
    );

    const wordButton = screen.getByText('Word');
    await user.click(wordButton);

    expect(mockGetExportContent).toHaveBeenCalledWith('markdown', { includeTags: false });
    expect(mockExportToWord).toHaveBeenCalledWith({
      data: {
        sermonTitle: 'Sermon Title',
        sermonVerse: 'Verse line 1\nVerse line 2',
        introduction: 'Intro content',
        main: 'Main content',
        conclusion: 'Conclusion content'
      }
    });
  });
});

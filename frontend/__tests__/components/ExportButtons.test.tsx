import React from 'react';
import { render, screen } from '@testing-library/react';
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

jest.mock('../../utils/wordExport', () => ({
  exportToWord: jest.fn(),
  PlanData: {}
}));

describe('ExportButtons Component', () => {
  const mockGetExportContent = jest.fn(() => Promise.resolve('Test content'));
  const mockSermonId = 'test-sermon-id';

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
}); 
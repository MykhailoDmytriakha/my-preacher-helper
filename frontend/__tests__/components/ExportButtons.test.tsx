import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ExportButtons, { ExportButtonsLayout, ExportTxtModal } from '@/components/ExportButtons';
import { act } from 'react-dom/test-utils';

// Mock createPortal to render children directly
jest.mock('react-dom', () => {
  const originalModule = jest.requireActual('react-dom');
  return {
    ...originalModule,
    createPortal: (node: React.ReactNode) => node,
  };
});

// Mock the i18n module
jest.mock('@locales/i18n', () => {}, { virtual: true });

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn(),
  },
});

// Mock URL methods
global.URL.createObjectURL = jest.fn(() => 'blob:url');
global.URL.revokeObjectURL = jest.fn();

// Mock document methods that are used in the component
document.createElement = jest.fn().mockImplementation(() => ({
  href: '',
  download: '',
  click: jest.fn(),
}));
document.body.appendChild = jest.fn();
document.body.removeChild = jest.fn();

// Mock i18n
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'export.txtTitle': 'Export as Text',
        'export.copy': 'Copy to Clipboard',
        'export.copied': 'Copied!',
        'export.downloadTxt': 'Download as TXT',
        'export.prepareError': 'Error preparing export',
        'export.soonAvailable': 'Coming soon',
      };
      return translations[key] || key;
    },
  }),
}));

describe('ExportButtonsLayout Component', () => {
  const mockHandlers = {
    onTxtClick: jest.fn(),
    onPdfClick: jest.fn(),
    onWordClick: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.skip('renders horizontal layout correctly', () => {
    render(<ExportButtonsLayout {...mockHandlers} />);
    
    // Check buttons
    expect(screen.getByText('TXT')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
    expect(screen.getByText('Word')).toBeInTheDocument();
    
    // Check horizontal class
    const container = screen.getByText('TXT').closest('div');
    expect(container).toHaveClass('flex-row');
  });
  
  test.skip('renders vertical layout correctly', () => {
    render(<ExportButtonsLayout {...mockHandlers} orientation="vertical" />);
    
    // Check vertical class
    const container = screen.getByText('TXT').closest('div');
    expect(container).toHaveClass('flex-col');
  });
  
  test.skip('calls handler when TXT button is clicked', () => {
    render(<ExportButtonsLayout {...mockHandlers} />);
    
    const txtButton = screen.getByText('TXT');
    fireEvent.click(txtButton);
    
    expect(mockHandlers.onTxtClick).toHaveBeenCalledTimes(1);
  });
  
  test.skip('has disabled PDF and Word buttons', () => {
    render(<ExportButtonsLayout {...mockHandlers} />);
    
    const pdfButton = screen.getByText('PDF');
    const wordButton = screen.getByText('Word');
    
    expect(pdfButton).toBeDisabled();
    expect(wordButton).toBeDisabled();
  });
});

describe('ExportTxtModal Component', () => {
  const mockProps = {
    content: 'Test export content',
    onClose: jest.fn(),
  };
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  test.skip('renders content correctly', () => {
    render(<ExportTxtModal {...mockProps} />);
    
    expect(screen.getByText('Export as Text')).toBeInTheDocument();
    expect(screen.getByText('Test export content')).toBeInTheDocument();
    expect(screen.getByText('Copy to Clipboard')).toBeInTheDocument();
    expect(screen.getByText('Download as TXT')).toBeInTheDocument();
  });
  
  test.skip('copies content to clipboard when copy button is clicked', async () => {
    jest.useFakeTimers();
    
    render(<ExportTxtModal {...mockProps} />);
    
    const copyButton = screen.getByText('Copy to Clipboard');
    fireEvent.click(copyButton);
    
    // Check if clipboard API was called
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Test export content');
    
    // Check if button text changes to "Copied!"
    expect(screen.getByText('Copied!')).toBeInTheDocument();
    
    // Fast-forward timer to check if button text changes back
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    
    expect(screen.getByText('Copy to Clipboard')).toBeInTheDocument();
    
    jest.useRealTimers();
  });
  
  test.skip('has a download button', () => {
    render(<ExportTxtModal {...mockProps} />);
    
    const downloadButton = screen.getByText('Download as TXT');
    expect(downloadButton).toBeInTheDocument();
  });
  
  test.skip('calls onClose when close button is clicked', () => {
    render(<ExportTxtModal {...mockProps} />);
    
    const closeButton = screen.getByText('✕');
    fireEvent.click(closeButton);
    
    expect(mockProps.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ExportButtons Component', () => {
  const mockProps = {
    sermonId: 'test-sermon-id',
    getExportContent: jest.fn().mockResolvedValue('Test sermon content'),
  };
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  test.skip('renders export buttons', () => {
    render(<ExportButtons {...mockProps} />);
    
    expect(screen.getByText('TXT')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
    expect(screen.getByText('Word')).toBeInTheDocument();
  });
  
  test.skip('shows modal with content when TXT button is clicked', async () => {
    render(<ExportButtons {...mockProps} />);
    
    const txtButton = screen.getByText('TXT');
    fireEvent.click(txtButton);
    
    // Wait for the content to be loaded
    await waitFor(() => {
      expect(mockProps.getExportContent).toHaveBeenCalledWith('test-sermon-id');
      expect(screen.getByText('Export as Text')).toBeInTheDocument();
      expect(screen.getByText('Test sermon content')).toBeInTheDocument();
    });
  });
  
  test.skip('handles errors in getExportContent', async () => {
    // Mock the getExportContent to reject with an error
    mockProps.getExportContent.mockRejectedValueOnce(new Error('Test error'));
    
    // Mock window.alert
    const alertMock = jest.fn();
    window.alert = alertMock;
    
    render(<ExportButtons {...mockProps} />);
    
    const txtButton = screen.getByText('TXT');
    fireEvent.click(txtButton);
    
    // Wait for the error message to be displayed
    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith('Error preparing export');
    });
  });
  
  test.skip('closes modal when close button is clicked', async () => {
    render(<ExportButtons {...mockProps} />);
    
    // Open the modal
    const txtButton = screen.getByText('TXT');
    fireEvent.click(txtButton);
    
    // Wait for the modal to open
    await waitFor(() => {
      expect(screen.getByText('Export as Text')).toBeInTheDocument();
    });
    
    // Close the modal
    const closeButton = screen.getByText('✕');
    fireEvent.click(closeButton);
    
    // Check if the modal is closed
    await waitFor(() => {
      expect(screen.queryByText('Export as Text')).not.toBeInTheDocument();
    });
  });
}); 
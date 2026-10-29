jest.unmock('react-markdown');
jest.unmock('remark-gfm');
jest.unmock('rehype-raw');
jest.unmock('rehype-sanitize');

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { ExportTxtModal } from '@/components/export-buttons/ExportTxtModal';
import { downloadBlobToDevice } from '@/utils/download';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (node: React.ReactNode) => node,
}));

jest.mock('@/utils/download', () => ({
  downloadBlobToDevice: jest.fn(),
}));


const getContent = jest.fn(async () => 'Prepared Markdown');

const markdownProps = (content: string, isOpen = true) => ({
  isOpen,
  onClose: jest.fn(),
  content,
  getContent,
  format: 'markdown' as const,
});

describe('ExportTxtModal rich Markdown preview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders authored underline and HTML table cells without splitting literal pipes', async () => {
    render(<ExportTxtModal {...markdownProps('<table><thead><tr><th>Passage</th><th>Words</th></tr></thead><tbody><tr><td>John 3:16</td><td><u>Grace | truth</u></td></tr></tbody></table>')} />);

    const table = await screen.findByRole('table');
    expect(table.querySelectorAll('tbody td')).toHaveLength(2);
    expect(table.querySelector('u')).toHaveTextContent('Grace | truth');
  });

  it('keeps Markdown and code readable while excluding unsafe HTML tags and attributes', async () => {
    const { baseElement } = render(<ExportTxtModal {...markdownProps('**Bold words** and `<u>code sample</u> **literal stars**`.\n\n<h2 id="location">Safe heading</h2><a href="javascript:alert(1)" onclick="alert(1)">Safe link</a><script>evil()</script><iframe src="javascript:alert(1)"></iframe>')} />);

    expect(await screen.findByText('Bold words')).toBeInTheDocument();
    expect(baseElement.querySelector('p > code')).toHaveTextContent('<u>code sample</u> **literal stars**');
    expect(baseElement.querySelector('strong')).toHaveTextContent('Bold words');
    expect(baseElement.querySelector('script, iframe, [onclick], [href^="javascript:"], #location')).toBeNull();
    expect(baseElement.textContent).toContain('Safe heading');
    expect(baseElement.textContent).toContain('Safe link');
  });

  it('renders updated content after close and reopen without changing hook order', async () => {
    const { rerender } = render(<ExportTxtModal {...markdownProps('**First preview**')} />);
    expect(await screen.findByText('First preview')).toBeInTheDocument();

    rerender(<ExportTxtModal {...markdownProps('**Updated preview**', false)} />);
    expect(screen.queryByTestId('export-txt-modal')).toBeNull();
    rerender(<ExportTxtModal {...markdownProps('**Updated preview**')} />);

    expect(await screen.findByText('Updated preview')).toBeInTheDocument();
    expect(screen.queryByText('First preview')).toBeNull();
  });

  it('downloads the original Markdown source rather than the rendered preview', async () => {
    const source = '<table><tr><td><u>Source | text</u></td></tr></table>\n\n**Original Markdown**';
    render(<ExportTxtModal {...markdownProps(source)} />);
    await screen.findByText('Original Markdown');

    fireEvent.click(screen.getByRole('button', { name: 'Download MD' }));
    expect(downloadBlobToDevice).toHaveBeenCalledWith(expect.any(Blob), 'export.md');
    const blob = (downloadBlobToDevice as jest.Mock).mock.calls[0][0] as Blob;
    const reader = new FileReader();
    const text = new Promise<string>((resolve, reject) => {
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(String(reader.result));
    });
    reader.readAsText(blob);
    expect(await text).toBe(source);
  });
});

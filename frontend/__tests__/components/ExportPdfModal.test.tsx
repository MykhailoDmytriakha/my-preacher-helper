import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

import "@testing-library/jest-dom";
import { ExportPdfModal } from "@/components/ExportButtons";

const mockAddImage = jest.fn();
const mockSave = jest.fn();
const mockHtml2Canvas = jest.fn();

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

jest.mock("react-dom", () => ({
  ...jest.requireActual("react-dom"),
  createPortal: (node: React.ReactNode) => node,
}));

jest.mock("html2canvas", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockHtml2Canvas(...args),
}));

jest.mock("jspdf", () => ({
  jsPDF: jest.fn().mockImplementation(() => ({
    internal: {
      pageSize: {
        getWidth: () => 210,
        getHeight: () => 297,
      },
    },
    addImage: mockAddImage,
    save: mockSave,
  })),
}));

describe("ExportPdfModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHtml2Canvas.mockResolvedValue({
      width: 800,
      height: 1200,
      toDataURL: jest.fn(() => "data:image/png;base64,export"),
    });
  });

  it("returns null when closed", () => {
    const { container } = render(
      <ExportPdfModal
        isOpen={false}
        onClose={jest.fn()}
        getContent={jest.fn()}
        title="Hidden"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("loads content on open and exports PDF with fallback filename", async () => {
    const getContent = jest.fn().mockResolvedValue(<div>PDF Preview</div>);

    render(
      <ExportPdfModal
        isOpen
        onClose={jest.fn()}
        getContent={getContent}
        title=""
      />,
    );

    expect(await screen.findByText("PDF Preview")).toBeInTheDocument();
    expect(getContent).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Save as PDF" }));

    await waitFor(() => expect(mockHtml2Canvas).toHaveBeenCalledTimes(1));
    expect(mockAddImage).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith("export.pdf");
  });

  it("renders loading failure state when PDF content cannot be prepared", async () => {
    const getContent = jest.fn().mockRejectedValue(new Error("load failed"));

    render(
      <ExportPdfModal
        isOpen
        onClose={jest.fn()}
        getContent={getContent}
        title="Failure"
      />,
    );

    expect(await screen.findByText("Error preparing PDF content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save as PDF" })).toBeDisabled();
  });

  it("surfaces export errors after content loads", async () => {
    const getContent = jest.fn().mockResolvedValue(<div>PDF Preview</div>);
    mockHtml2Canvas.mockRejectedValueOnce(new Error("canvas failed"));

    render(
      <ExportPdfModal
        isOpen
        onClose={jest.fn()}
        getContent={getContent}
        title="Broken export"
      />,
    );

    expect(await screen.findByText("PDF Preview")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save as PDF" }));

    expect(await screen.findByText("Error preparing PDF content")).toBeInTheDocument();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("calls onClose from both close affordances", async () => {
    const onClose = jest.fn();

    render(
      <ExportPdfModal
        isOpen
        onClose={onClose}
        getContent={jest.fn().mockResolvedValue(<div>PDF Preview</div>)}
        title="Close test"
      />,
    );

    expect(await screen.findByText("PDF Preview")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "actions.cancel" }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

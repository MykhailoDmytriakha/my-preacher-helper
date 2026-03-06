import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import "@testing-library/jest-dom";
import { ExportButtonsLayout } from "@/components/export-buttons/ExportButtonsLayout";

describe("ExportButtonsLayout", () => {
  it("renders the default variant with vertical tooltips and disabled export states", async () => {
    const user = userEvent.setup();
    const onTxtClick = jest.fn();
    const onPdfClick = jest.fn();
    const onWordClick = jest.fn();
    const { container } = render(
      <ExportButtonsLayout
        onTxtClick={onTxtClick}
        onPdfClick={onPdfClick}
        onWordClick={onWordClick}
        orientation="vertical"
        isWordDisabled
        extraButtons={<button type="button">Extra action</button>}
      />,
    );

    expect(container.firstChild).toHaveClass("flex", "flex-col", "gap-1.5");
    expect(screen.getByText("Extra action")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "TXT" }));
    expect(onTxtClick).toHaveBeenCalledTimes(1);

    expect(screen.getByRole("button", { name: "Export to PDF (coming soon)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export to Word" })).toBeDisabled();
    expect(screen.getByText("Coming soon")).toHaveClass("tooltiptext", "tooltiptext-right");
    expect(screen.getByText("Plan required for Word")).toHaveClass("tooltiptext", "tooltiptext-right");
    expect(onPdfClick).not.toHaveBeenCalled();
    expect(onWordClick).not.toHaveBeenCalled();
  });

  it("renders the icon variant with audio enabled and wires all click handlers", async () => {
    const user = userEvent.setup();
    const onTxtClick = jest.fn();
    const onPdfClick = jest.fn();
    const onWordClick = jest.fn();
    const onAudioClick = jest.fn();
    const { container } = render(
      <ExportButtonsLayout
        onTxtClick={onTxtClick}
        onPdfClick={onPdfClick}
        onWordClick={onWordClick}
        onAudioClick={onAudioClick}
        isPdfAvailable
        isAudioEnabled
        isPreached
        variant="icon"
      />,
    );

    expect(container.firstChild).toHaveClass("flex", "flex-row", "gap-2", "items-center");

    const txtButton = screen.getByRole("button", { name: "Export as Text" });
    const pdfButton = screen.getByRole("button", { name: "Export to PDF" });
    const wordButton = screen.getByRole("button", { name: "Export to Word" });
    const audioButton = screen.getByRole("button", { name: "Audio (Beta)" });

    await user.click(txtButton);
    await user.click(pdfButton);
    await user.click(wordButton);
    await user.click(audioButton);

    expect(onTxtClick).toHaveBeenCalledTimes(1);
    expect(onPdfClick).toHaveBeenCalledTimes(1);
    expect(onWordClick).toHaveBeenCalledTimes(1);
    expect(onAudioClick).toHaveBeenCalledTimes(1);

    expect(txtButton).toHaveClass("text-gray-500");
    expect(pdfButton).toHaveClass("hover:text-purple-600");
    expect(wordButton).toHaveClass("hover:text-green-600");
    expect(audioButton).toHaveClass("hover:text-orange-600");

    expect(screen.getByText("TXT")).toBeInTheDocument();
    expect(screen.getByText("PDF")).toBeInTheDocument();
    expect(screen.getByText("Word")).toBeInTheDocument();
    expect(screen.getByText("Audio (Beta)")).toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import "@testing-library/jest-dom";
import { ExportButtonsLayout } from "@/components/export-buttons/ExportButtonsLayout";

describe("ExportButtonsLayout", () => {
  it("slides the reason of a disabled audio button back inside a narrow window on hover", () => {
    // The last export button sits by the right edge of a phone; its tooltip is centred on it.
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    render(
      <ExportButtonsLayout
        onTxtClick={jest.fn()}
        onPdfClick={jest.fn()}
        onWordClick={jest.fn()}
        onAudioClick={jest.fn()}
        isAudioEnabled
        isAudioDisabled
        audioDisabledLabelKey="Not enough AI allowance left."
      />,
    );
    const tip = screen.getAllByText("Not enough AI allowance left.").find((el) => el.classList.contains("tooltiptext"))!;
    jest.spyOn(tip, "getBoundingClientRect").mockReturnValue({ left: 230, right: 490, width: 260, top: 0, bottom: 20, height: 20, x: 230, y: 0, toJSON: () => ({}) } as DOMRect);
    fireEvent.mouseEnter(tip.parentElement!);
    expect(tip.style.getPropertyValue("--tooltip-shift")).toBe("-112px");
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  });

  it("places a hovered tooltip again when its text changes, and stops watching when the pointer leaves", () => {
    const callbacks: Array<() => void> = [];
    const disconnect = jest.fn();
    const original = (window as { ResizeObserver?: unknown }).ResizeObserver;
    (window as { ResizeObserver?: unknown }).ResizeObserver = class {
      constructor(callback: () => void) { callbacks.push(callback); }
      observe() {}
      disconnect() { disconnect(); }
    };
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    render(
      <ExportButtonsLayout onTxtClick={jest.fn()} onPdfClick={jest.fn()} onWordClick={jest.fn()} onAudioClick={jest.fn()} isAudioEnabled />,
    );
    const tip = screen.getAllByText("Audio (Beta)").find((el) => el.classList.contains("tooltiptext"))!;
    const rect = jest.spyOn(tip, "getBoundingClientRect").mockReturnValue({ left: 280, right: 360, width: 80, top: 0, bottom: 20, height: 20, x: 280, y: 0, toJSON: () => ({}) } as DOMRect);
    fireEvent.mouseEnter(tip.parentElement!);
    expect(tip.style.getPropertyValue("--tooltip-shift")).toBe("0px");
    // The reason arrives while the pointer rests: the tooltip grows past the edge.
    rect.mockReturnValue({ left: 230, right: 490, width: 260, top: 0, bottom: 20, height: 20, x: 230, y: 0, toJSON: () => ({}) } as DOMRect);
    callbacks.forEach((callback) => callback());
    expect(tip.style.getPropertyValue("--tooltip-shift")).toBe("-112px");
    fireEvent.mouseLeave(tip.parentElement!);
    expect(disconnect).toHaveBeenCalledTimes(1);
    (window as { ResizeObserver?: unknown }).ResizeObserver = original;
    Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  });

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

    // Every available icon wears its colour at rest, so a working button cannot be mistaken
    // for a dead one — the whole row used to be grey until the cursor found it.
    expect(txtButton).toHaveClass("text-blue-600");
    expect(pdfButton).toHaveClass("text-purple-600");
    expect(wordButton).toHaveClass("text-green-600");
    expect(audioButton).toHaveClass("text-orange-600");

    expect(screen.getByText("TXT")).toBeInTheDocument();
    expect(screen.getByText("PDF")).toBeInTheDocument();
    expect(screen.getByText("Word")).toBeInTheDocument();
    expect(screen.getByText("Audio (Beta)")).toBeInTheDocument();
  });
});

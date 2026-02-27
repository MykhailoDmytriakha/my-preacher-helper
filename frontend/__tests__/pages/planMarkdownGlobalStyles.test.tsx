import { cleanup, render } from "@testing-library/react";
import React from "react";

import PlanMarkdownGlobalStyles from "@/(pages)/(private)/sermons/[id]/plan/PlanMarkdownGlobalStyles";

const collectStyles = (): string =>
  Array.from(document.querySelectorAll("style"))
    .map((styleElement) => styleElement.textContent ?? "")
    .join("\n");

describe("PlanMarkdownGlobalStyles", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders common markdown marker styles", () => {
    render(<PlanMarkdownGlobalStyles variant="main" />);
    const styles = collectStyles();

    expect(styles).toContain(".markdown-content h2::before");
    expect(styles).toContain(".markdown-content.prose-main h3::before");
    expect(styles).toContain("@media (prefers-color-scheme: dark)");
  });

  it("includes main-layout specific styles", () => {
    render(<PlanMarkdownGlobalStyles variant="main" />);
    const styles = collectStyles();

    expect(styles).toContain("[data-testid=\"plan-introduction-left-section\"]");
    expect(styles).toContain("overflow-anchor: none");
    expect(styles).toContain(".markdown-content > p:first-child");
  });

  it("includes preaching-content styles for immersive and preaching variants", () => {
    const { unmount } = render(<PlanMarkdownGlobalStyles variant="immersive" />);
    let styles = collectStyles();
    expect(styles).toContain(".preaching-content");

    unmount();
    render(<PlanMarkdownGlobalStyles variant="preaching" />);
    styles = collectStyles();
    expect(styles).toContain(".preaching-content");
  });
});

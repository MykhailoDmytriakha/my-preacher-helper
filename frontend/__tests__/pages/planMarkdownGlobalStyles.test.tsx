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
  });

  /**
   * THE MARKDOWN RULES TRAVEL WITH EVERY VARIANT, and the column rules with none but `main`.
   *
   * They used to be one block, so the assembled plan was laid out only on the screens that
   * happened to mount `main` — the overlay opened from the hand-written editor had no rules at
   * all and read with different spacing than the very same plan beside the thoughts.
   */
  it.each(["main", "overlay", "immersive", "preaching"] as const)(
    "lays out the assembled plan the same way in the %s variant",
    (variant) => {
      render(<PlanMarkdownGlobalStyles variant={variant} />);
      const styles = collectStyles();

      expect(styles).toContain(".markdown-content > p:first-child");
      expect(styles).toContain(".markdown-content h3 {");
    }
  );

  it("keeps the paired columns' scroll anchoring out of every other variant", () => {
    render(<PlanMarkdownGlobalStyles variant="overlay" />);

    expect(collectStyles()).not.toContain("overflow-anchor: none");
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

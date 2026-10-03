import { render } from "@testing-library/react";
import React from "react";

import "@testing-library/jest-dom";
import { TooltipStyles } from "@/components/export-buttons/TooltipStyles";

describe("TooltipStyles", () => {
  it("renders the expected global tooltip CSS rules", () => {
    const styleElement = TooltipStyles();
    render(<TooltipStyles />);

    expect(styleElement).toBeTruthy();
    expect(styleElement.props.children).toContain(".tooltip");
    expect(styleElement.props.children).toContain(".tooltiptext-top");
    expect(styleElement.props.children).toContain(".tooltiptext-right");
    expect(styleElement.props.children).toContain("border-color:rgba(0,0,0,.8)transparent transparent transparent");
  });

  /*
   * A HIDDEN TOOLTIP TAKES NO ROOM (BUG-20261003-sermon-list-hidden-tooltips-scroll-sideways).
   * `visibility: hidden` keeps an absolutely placed box in the page's scrollable area, so the
   * tooltips over the last card's export buttons widened a 390 px phone page to 410 px and it slid
   * sideways under the finger. Hidden, a tooltip is not laid out at all; it appears on hover.
   */
  it("keeps a hidden tooltip out of the layout and shows it on hover", () => {
    // Whitespace collapsed, not removed: ".tooltip .tooltiptext" (descendant) must not read as ".tooltip.tooltiptext".
    const css = String(TooltipStyles().props.children).replace(/\s+/g, " ");
    const rule = (selector: string) => (css.match(new RegExp(`(?:^|[}\\s])${selector.replace(/[.:]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "").replace(/\s+/g, "");
    expect(rule(".tooltip .tooltiptext")).toContain("display:none");
    expect(rule(".tooltip .tooltiptext")).not.toContain("visibility");
    expect(rule(".tooltip:hover .tooltiptext")).toContain("display:block");
  });
});

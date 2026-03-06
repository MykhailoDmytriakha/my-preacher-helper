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
    expect(styleElement.props.children).toContain("visibility:hidden");
    expect(styleElement.props.children).toContain("border-color:rgba(0,0,0,.8)transparent transparent transparent");
  });
});

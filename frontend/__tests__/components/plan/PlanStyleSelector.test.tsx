import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import "@testing-library/jest-dom";
import PlanStyleSelector from "@/components/plan/PlanStyleSelector";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue || _key,
  }),
}));

describe("PlanStyleSelector", () => {
  it("presents generation choices as plan length controls", () => {
    const handleChange = jest.fn();

    render(<PlanStyleSelector value="memory" onChange={handleChange} />);

    expect(screen.getByText("Plan Length")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Short/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Medium/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Detailed/i })).toBeInTheDocument();
    expect(screen.getByText("Minimal cue sheet: main anchors only")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Medium/i }));

    expect(handleChange).toHaveBeenCalledWith("narrative");
  });
});

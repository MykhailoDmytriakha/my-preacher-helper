import { fireEvent, render, screen } from "@testing-library/react";

import { DeletePointConfirmModal } from "@/components/column/DeletePointConfirmModal";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      (options?.defaultValue as string | undefined) ?? key,
  }),
}));

jest.mock("@/components/ui/ConfirmModal", () => ({
  __esModule: true,
  default: ({
    isOpen,
    onClose,
    onConfirm,
    confirmText,
    confirmDisabled,
    children,
  }: any) =>
    isOpen ? (
      <div role="dialog">
        <button onClick={onClose}>Close</button>
        <button onClick={onConfirm} disabled={confirmDisabled}>
          {confirmText}
        </button>
        {children}
      </div>
    ) : null,
}));

describe("DeletePointConfirmModal", () => {
  it("resets the typed confirmation value whenever the modal opens", () => {
    const { rerender } = render(
      <DeletePointConfirmModal
        isOpen={true}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        pointName="Point A"
      />
    );

    const input = screen.getByPlaceholderText("Point A") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Point A" } });
    expect(input.value).toBe("Point A");

    rerender(
      <DeletePointConfirmModal
        isOpen={false}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        pointName="Point A"
      />
    );
    rerender(
      <DeletePointConfirmModal
        isOpen={true}
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        pointName="Point A"
      />
    );

    expect((screen.getByPlaceholderText("Point A") as HTMLInputElement).value).toBe("");
  });
});

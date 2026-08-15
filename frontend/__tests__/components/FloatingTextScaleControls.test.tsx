import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import FloatingTextScaleControls from '@/components/FloatingTextScaleControls';
import { TextScaleProvider } from '@/providers/TextScaleProvider';

describe('FloatingTextScaleControls', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('renders floating action button', async () => {
    render(
      <TextScaleProvider>
        <FloatingTextScaleControls />
      </TextScaleProvider>
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Text size')).toBeInTheDocument();
    });
  });

  it('shows modal when FAB is clicked', async () => {
    const user = userEvent.setup();

    render(
      <TextScaleProvider>
        <FloatingTextScaleControls />
      </TextScaleProvider>
    );

    const fabButton = await screen.findByLabelText('Text size');
    await user.click(fabButton);

    // The island carries controls only — no heading and no hint to read mid-service.
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Text size');
    expect(screen.getByLabelText('Decrease text size')).toBeInTheDocument();
    expect(screen.getByLabelText('Increase text size')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
    expect(screen.queryByText('Pick the size that reads comfortably')).not.toBeInTheDocument();
  });

  /**
   * The button does not sit next to the island — it BECOMES it. While the island
   * is open the button is gone from sight, from the tab order and from assistive
   * technology; the way back is a click outside or Escape.
   *
   * Asserted on attributes, not on classes: jsdom applies no CSS, so a test that
   * "clicks the hidden button" would pass against a button that is still there
   * for real users. There is no close button to hunt for either.
   */
  it('hands the corner over to the island: the button leaves tab order and the a11y tree', async () => {
    const user = userEvent.setup();

    render(
      <TextScaleProvider>
        <FloatingTextScaleControls />
      </TextScaleProvider>
    );

    const fabButton = await screen.findByLabelText('Text size');
    expect(fabButton).toHaveAttribute('tabindex', '0');

    await user.click(fabButton);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(fabButton).toHaveAttribute('aria-hidden', 'true');
    expect(fabButton).toHaveAttribute('tabindex', '-1');
    expect(screen.queryByLabelText('Close text size')).not.toBeInTheDocument();
  });

  it('closes modal when clicking outside', async () => {
    const user = userEvent.setup();

    render(
      <TextScaleProvider>
        <FloatingTextScaleControls />
      </TextScaleProvider>
    );

    const fabButton = await screen.findByLabelText('Text size');
    await user.click(fabButton);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Click outside the modal
    await user.click(document.body);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('closes modal when Escape key is pressed', async () => {
    const user = userEvent.setup();

    render(
      <TextScaleProvider>
        <FloatingTextScaleControls />
      </TextScaleProvider>
    );

    const fabButton = await screen.findByLabelText('Text size');
    await user.click(fabButton);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('toggles modal when FAB is clicked multiple times', async () => {
    const user = userEvent.setup();

    render(
      <TextScaleProvider>
        <FloatingTextScaleControls />
      </TextScaleProvider>
    );

    const fabButton = await screen.findByLabelText('Text size');

    // Open modal
    await user.click(fabButton);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Close modal
    await user.click(fabButton);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('has proper accessibility attributes', async () => {
    render(
      <TextScaleProvider>
        <FloatingTextScaleControls />
      </TextScaleProvider>
    );

    const fabButton = await screen.findByLabelText('Text size');

    expect(fabButton).toHaveAttribute('aria-expanded', 'false');
    expect(fabButton).toHaveAttribute('aria-haspopup', 'dialog');
    expect(fabButton).toHaveAttribute('title', 'Text size');
  });

  it('updates aria-expanded when modal opens', async () => {
    const user = userEvent.setup();

    render(
      <TextScaleProvider>
        <FloatingTextScaleControls />
      </TextScaleProvider>
    );

    const fabButton = await screen.findByLabelText('Text size');

    expect(fabButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(fabButton);
    expect(fabButton).toHaveAttribute('aria-expanded', 'true');

    await user.click(fabButton);
    expect(fabButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders overlay when modal is open', async () => {
    const user = userEvent.setup();

    render(
      <TextScaleProvider>
        <FloatingTextScaleControls />
      </TextScaleProvider>
    );

    const fabButton = await screen.findByLabelText('Text size');
    await user.click(fabButton);

    // Check for backdrop
    const backdrop = document.querySelector('.bg-black\\/20');
    expect(backdrop).toBeInTheDocument();
  });

  it('applies custom className', async () => {
    render(
      <TextScaleProvider>
        <FloatingTextScaleControls className="custom-class" />
      </TextScaleProvider>
    );

    const container = await screen.findByLabelText('Text size');
    expect(container.parentElement).toHaveClass('custom-class');
  });
});

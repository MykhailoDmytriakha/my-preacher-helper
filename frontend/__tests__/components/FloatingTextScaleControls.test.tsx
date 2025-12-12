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
      expect(screen.getByLabelText('Text size controls')).toBeInTheDocument();
    });
  });

  it('shows modal when FAB is clicked', async () => {
    const user = userEvent.setup();

    render(
      <TextScaleProvider>
        <FloatingTextScaleControls />
      </TextScaleProvider>
    );

    const fabButton = await screen.findByLabelText('Text size controls');
    await user.click(fabButton);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Text Size')).toBeInTheDocument();
    expect(screen.getByLabelText('Decrease text size')).toBeInTheDocument();
    expect(screen.getByLabelText('Increase text size')).toBeInTheDocument();
  });

  it('closes modal when close button is clicked', async () => {
    const user = userEvent.setup();

    render(
      <TextScaleProvider>
        <FloatingTextScaleControls />
      </TextScaleProvider>
    );

    const fabButton = await screen.findByLabelText('Text size controls');
    await user.click(fabButton);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const closeButton = screen.getByLabelText('Close text size controls');
    await user.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('closes modal when clicking outside', async () => {
    const user = userEvent.setup();

    render(
      <TextScaleProvider>
        <FloatingTextScaleControls />
      </TextScaleProvider>
    );

    const fabButton = await screen.findByLabelText('Text size controls');
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

    const fabButton = await screen.findByLabelText('Text size controls');
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

    const fabButton = await screen.findByLabelText('Text size controls');

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

    const fabButton = await screen.findByLabelText('Text size controls');

    expect(fabButton).toHaveAttribute('aria-expanded', 'false');
    expect(fabButton).toHaveAttribute('aria-haspopup', 'dialog');
    expect(fabButton).toHaveAttribute('title', 'Adjust text size (A/A+)');
  });

  it('updates aria-expanded when modal opens', async () => {
    const user = userEvent.setup();

    render(
      <TextScaleProvider>
        <FloatingTextScaleControls />
      </TextScaleProvider>
    );

    const fabButton = await screen.findByLabelText('Text size controls');

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

    const fabButton = await screen.findByLabelText('Text size controls');
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

    const container = await screen.findByLabelText('Text size controls');
    expect(container.parentElement).toHaveClass('custom-class');
  });
});

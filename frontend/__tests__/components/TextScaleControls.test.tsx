import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TextScaleControls } from '@/components/TextScaleControls';
import { TextScaleProvider } from '@/providers/TextScaleProvider';

describe('TextScaleControls', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('renders with A- and A+ buttons', () => {
    render(
      <TextScaleProvider>
        <TextScaleControls />
      </TextScaleProvider>
    );

    expect(screen.getByLabelText('Decrease text size')).toBeInTheDocument();
    expect(screen.getByLabelText('Increase text size')).toBeInTheDocument();
  });

  it('displays current scale percentage', async () => {
    render(
      <TextScaleProvider>
        <TextScaleControls showPercentage={true} />
      </TextScaleProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('100%')).toBeInTheDocument();
    });
  });

  it('does not display percentage when showPercentage is false', () => {
    render(
      <TextScaleProvider>
        <TextScaleControls showPercentage={false} />
      </TextScaleProvider>
    );

    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });

  it('increases scale on A+ button click', async () => {
    render(
      <TextScaleProvider>
        <TextScaleControls showPercentage={true} />
      </TextScaleProvider>
    );

    const increaseBtn = screen.getByLabelText('Increase text size');

    await waitFor(() => {
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    fireEvent.click(increaseBtn);
    await waitFor(() => {
      expect(screen.getByText('120%')).toBeInTheDocument();
    });

    fireEvent.click(increaseBtn);
    await waitFor(() => {
      expect(screen.getByText('140%')).toBeInTheDocument();
    });
  });

  it('decreases scale on A- button click', async () => {
    render(
      <TextScaleProvider>
        <TextScaleControls showPercentage={true} />
      </TextScaleProvider>
    );

    const increaseBtn = screen.getByLabelText('Increase text size');
    const decreaseBtn = screen.getByLabelText('Decrease text size');

    await waitFor(() => {
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    fireEvent.click(increaseBtn);
    fireEvent.click(increaseBtn);
    await waitFor(() => {
      expect(screen.getByText('140%')).toBeInTheDocument();
    });

    fireEvent.click(decreaseBtn);
    await waitFor(() => {
      expect(screen.getByText('120%')).toBeInTheDocument();
    });

    fireEvent.click(decreaseBtn);
    await waitFor(() => {
      expect(screen.getByText('100%')).toBeInTheDocument();
    });
  });

  it('disables decrease button at minimum scale', async () => {
    render(
      <TextScaleProvider>
        <TextScaleControls showPercentage={true} />
      </TextScaleProvider>
    );

    const decreaseBtn = screen.getByLabelText('Decrease text size');
    await waitFor(() => {
      expect(decreaseBtn).toBeDisabled();
    });
  });

  it('disables increase button at maximum scale', async () => {
    render(
      <TextScaleProvider>
        <TextScaleControls showPercentage={true} />
      </TextScaleProvider>
    );

    const increaseBtn = screen.getByLabelText('Increase text size');

    // Click to reach maximum (200%)
    for (let i = 0; i < 5; i++) {
      fireEvent.click(increaseBtn);
    }

    await waitFor(() => {
      expect(increaseBtn).toBeDisabled();
    });
  });

  it('shows reset button when scale is not default', async () => {
    render(
      <TextScaleProvider>
        <TextScaleControls showPercentage={true} />
      </TextScaleProvider>
    );

    const increaseBtn = screen.getByLabelText('Increase text size');
    expect(screen.queryByText('Reset')).not.toBeInTheDocument();

    fireEvent.click(increaseBtn);
    await waitFor(() => {
      expect(screen.getByText('Reset')).toBeInTheDocument();
    });
  });

  it('hides reset button when scale is default', async () => {
    render(
      <TextScaleProvider>
        <TextScaleControls showPercentage={true} />
      </TextScaleProvider>
    );

    const increaseBtn = screen.getByLabelText('Increase text size');
    fireEvent.click(increaseBtn);
    await waitFor(() => {
      expect(screen.getByText('Reset')).toBeInTheDocument();
    });

    const resetBtn = screen.getByText('Reset');
    fireEvent.click(resetBtn);
    await waitFor(() => {
      expect(screen.queryByText('Reset')).not.toBeInTheDocument();
    });
  });

  it('applies custom className', () => {
    render(
      <TextScaleProvider>
        <TextScaleControls className="custom-class" />
      </TextScaleProvider>
    );

    const container = screen.getByLabelText('Decrease text size').parentElement;
    expect(container).toHaveClass('custom-class');
  });

  it('has proper accessibility attributes', () => {
    render(
      <TextScaleProvider>
        <TextScaleControls />
      </TextScaleProvider>
    );

    const decreaseBtn = screen.getByLabelText('Decrease text size');
    const increaseBtn = screen.getByLabelText('Increase text size');

    expect(decreaseBtn).toHaveAttribute('title', 'Decrease text size (A-)');
    expect(increaseBtn).toHaveAttribute('title', 'Increase text size (A+)');
  });
});

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

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
      expect(screen.getByText('110%')).toBeInTheDocument();
    });

    fireEvent.click(increaseBtn);
    await waitFor(() => {
      expect(screen.getByText('120%')).toBeInTheDocument();
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
      expect(screen.getByText('120%')).toBeInTheDocument();
    });

    fireEvent.click(decreaseBtn);
    await waitFor(() => {
      expect(screen.getByText('110%')).toBeInTheDocument();
    });

    fireEvent.click(decreaseBtn);
    await waitFor(() => {
      expect(screen.getByText('100%')).toBeInTheDocument();
    });
  });

  it('can still go DOWN from the default — the floor is 80%, not 100%', async () => {
    // Smaller than default is a real need: more text on screen at a glance.
    render(
      <TextScaleProvider>
        <TextScaleControls showPercentage={true} />
      </TextScaleProvider>
    );

    const decreaseBtn = screen.getByLabelText('Decrease text size');
    expect(decreaseBtn).toBeEnabled();

    fireEvent.click(decreaseBtn);
    await waitFor(() => {
      expect(screen.getByText('90%')).toBeInTheDocument();
    });
  });

  it('disables decrease button at minimum scale (80%)', async () => {
    render(
      <TextScaleProvider>
        <TextScaleControls showPercentage={true} />
      </TextScaleProvider>
    );

    const decreaseBtn = screen.getByLabelText('Decrease text size');
    fireEvent.click(decreaseBtn);
    fireEvent.click(decreaseBtn);

    await waitFor(() => {
      expect(screen.getByText('80%')).toBeInTheDocument();
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

    // Click to reach maximum (200%) — 10% steps from 100% need 10 clicks
    for (let i = 0; i < 10; i++) {
      fireEvent.click(increaseBtn);
    }

    await waitFor(() => {
      expect(increaseBtn).toBeDisabled();
    });
  });

  /**
   * BUG-20260814-text-scale-panel-reflows.
   *
   * The panel is pinned to the right edge of the screen, so ANY element that
   * appears or disappears with the scale widens it and drags every button
   * leftwards — out from under the finger that just pressed one. Measured live:
   * 224 px → 248 px after a single A+, and the second press in the same spot
   * landed in the gap and did nothing.
   *
   * jsdom has no layout, so the invariant is expressed structurally: the SET of
   * controls may not depend on the current scale. Actual pixel stability is
   * verified in the browser (see the session journal).
   */
  it('keeps the same set of controls at every scale — nothing appears or vanishes', async () => {
    render(
      <TextScaleProvider>
        <TextScaleControls showPercentage={true} />
      </TextScaleProvider>
    );

    const controlsAt = () =>
      screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    const atDefault = controlsAt();

    const increaseBtn = screen.getByLabelText('Increase text size');
    fireEvent.click(increaseBtn);
    await waitFor(() => {
      expect(screen.getByText('110%')).toBeInTheDocument();
    });
    expect(controlsAt()).toEqual(atDefault);

    for (let i = 0; i < 9; i++) fireEvent.click(increaseBtn);
    await waitFor(() => {
      expect(screen.getByText('200%')).toBeInTheDocument();
    });
    expect(controlsAt()).toEqual(atDefault);

    const decreaseBtn = screen.getByLabelText('Decrease text size');
    for (let i = 0; i < 12; i++) fireEvent.click(decreaseBtn);
    await waitFor(() => {
      expect(screen.getByText('80%')).toBeInTheDocument();
    });
    expect(controlsAt()).toEqual(atDefault);
  });

  it('resets to 100% through the percentage itself, without a button that comes and goes', async () => {
    render(
      <TextScaleProvider>
        <TextScaleControls showPercentage={true} />
      </TextScaleProvider>
    );

    fireEvent.click(screen.getByLabelText('Increase text size'));
    await waitFor(() => {
      expect(screen.getByText('110%')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Reset to 100%'));

    await waitFor(() => {
      expect(screen.getByText('100%')).toBeInTheDocument();
    });
  });

  /**
   * The rail is what makes the control fast: crossing the whole range with the
   * step buttons takes twelve presses, and during a service that is a chore. One
   * tap on a tick has to land on a real step — no in-between values.
   */
  describe('rail', () => {
    const railAt = () => {
      const rail = screen.getByRole('slider');
      jest.spyOn(rail, 'getBoundingClientRect').mockReturnValue({
        left: 0, width: 120, top: 0, height: 44, right: 120, bottom: 44, x: 0, y: 0,
        toJSON: () => ({}),
      } as DOMRect);
      return rail;
    };

    it('jumps straight to the step under the finger', async () => {
      render(
        <TextScaleProvider>
          <TextScaleControls showPercentage={true} />
        </TextScaleProvider>
      );

      const rail = railAt();
      // jsdom has no PointerEvent, and fireEvent.pointerDown then drops clientX —
      // which would make this test pass against a rail that reads no coordinate
      // at all. Dispatching a MouseEvent under the pointerdown name keeps the
      // coordinate real.
      const pressAt = (clientX: number) =>
        fireEvent(rail, new MouseEvent('pointerdown', { bubbles: true, clientX, buttons: 1 }));

      pressAt(120);
      await waitFor(() => {
        expect(screen.getByText('200%')).toBeInTheDocument();
      });

      pressAt(0);
      await waitFor(() => {
        expect(screen.getByText('80%')).toBeInTheDocument();
      });

      pressAt(60);
      await waitFor(() => {
        expect(screen.getByText('140%')).toBeInTheDocument();
      });
    });

    it('reports its position to assistive technology', async () => {
      render(
        <TextScaleProvider>
          <TextScaleControls showPercentage={true} />
        </TextScaleProvider>
      );

      const rail = screen.getByRole('slider');
      expect(rail).toHaveAttribute('aria-valuemin', '80');
      expect(rail).toHaveAttribute('aria-valuemax', '200');
      expect(rail).toHaveAttribute('aria-valuenow', '100');

      fireEvent.click(screen.getByLabelText('Increase text size'));
      await waitFor(() => {
        expect(rail).toHaveAttribute('aria-valuenow', '110');
      });
    });

    it('is drivable from the keyboard, Home included', async () => {
      render(
        <TextScaleProvider>
          <TextScaleControls showPercentage={true} />
        </TextScaleProvider>
      );

      const rail = screen.getByRole('slider');
      fireEvent.keyDown(rail, { key: 'ArrowRight' });
      await waitFor(() => {
        expect(screen.getByText('110%')).toBeInTheDocument();
      });

      fireEvent.keyDown(rail, { key: 'ArrowLeft' });
      fireEvent.keyDown(rail, { key: 'ArrowLeft' });
      await waitFor(() => {
        expect(screen.getByText('90%')).toBeInTheDocument();
      });

      fireEvent.keyDown(rail, { key: 'Home' });
      await waitFor(() => {
        expect(screen.getByText('100%')).toBeInTheDocument();
      });

      fireEvent.keyDown(rail, { key: 'End' });
      await waitFor(() => {
        expect(screen.getByText('200%')).toBeInTheDocument();
      });
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

    // Labels come from the locale files now — no hardcoded English in the panel.
    expect(decreaseBtn).toHaveAttribute('title', 'Decrease text size');
    expect(increaseBtn).toHaveAttribute('title', 'Increase text size');
  });
});

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TextScaleProvider, useTextScale } from '@/providers/TextScaleProvider';

describe('TextScaleProvider', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  it('provides default scale of 1', () => {
    const TestComponent = () => {
      const { scale, scalePercentage } = useTextScale();
      return <div data-testid="scale">{scalePercentage}%</div>;
    };

    render(
      <TextScaleProvider>
        <TestComponent />
      </TextScaleProvider>
    );

    expect(screen.getByTestId('scale')).toHaveTextContent('100%');
  });

  it('increaseScale increases the scale by 0.2 steps', () => {
    const TestComponent = () => {
      const { scalePercentage, increaseScale } = useTextScale();
      return (
        <div>
          <div data-testid="scale">{scalePercentage}%</div>
          <button onClick={increaseScale} data-testid="increase-btn">
            Increase
          </button>
        </div>
      );
    };

    render(
      <TextScaleProvider>
        <TestComponent />
      </TextScaleProvider>
    );

    expect(screen.getByTestId('scale')).toHaveTextContent('100%');

    fireEvent.click(screen.getByTestId('increase-btn'));
    expect(screen.getByTestId('scale')).toHaveTextContent('120%');

    fireEvent.click(screen.getByTestId('increase-btn'));
    expect(screen.getByTestId('scale')).toHaveTextContent('140%');
  });

  it('decreaseScale decreases the scale by 0.2 steps', () => {
    const TestComponent = () => {
      const { scalePercentage, decreaseScale, setScale } = useTextScale();
      return (
        <div>
          <div data-testid="scale">{scalePercentage}%</div>
          <button onClick={() => setScale(1.4)} data-testid="set-btn">
            Set to 140%
          </button>
          <button onClick={decreaseScale} data-testid="decrease-btn">
            Decrease
          </button>
        </div>
      );
    };

    render(
      <TextScaleProvider>
        <TestComponent />
      </TextScaleProvider>
    );

    fireEvent.click(screen.getByTestId('set-btn'));
    expect(screen.getByTestId('scale')).toHaveTextContent('140%');

    fireEvent.click(screen.getByTestId('decrease-btn'));
    expect(screen.getByTestId('scale')).toHaveTextContent('120%');
  });

  it('resetScale resets to default (100%)', () => {
    const TestComponent = () => {
      const { scalePercentage, increaseScale, resetScale } = useTextScale();
      return (
        <div>
          <div data-testid="scale">{scalePercentage}%</div>
          <button onClick={increaseScale} data-testid="increase-btn">
            Increase
          </button>
          <button onClick={resetScale} data-testid="reset-btn">
            Reset
          </button>
        </div>
      );
    };

    render(
      <TextScaleProvider>
        <TestComponent />
      </TextScaleProvider>
    );

    fireEvent.click(screen.getByTestId('increase-btn'));
    fireEvent.click(screen.getByTestId('increase-btn'));
    expect(screen.getByTestId('scale')).toHaveTextContent('140%');

    fireEvent.click(screen.getByTestId('reset-btn'));
    expect(screen.getByTestId('scale')).toHaveTextContent('100%');
  });

  it('setScale clamps values between 1 and 2', () => {
    const TestComponent = () => {
      const { scalePercentage, setScale } = useTextScale();
      return (
        <div>
          <div data-testid="scale">{scalePercentage}%</div>
          <button onClick={() => setScale(3)} data-testid="set-high">
            Set 3
          </button>
          <button onClick={() => setScale(0)} data-testid="set-low">
            Set 0
          </button>
          <button onClick={() => setScale(1.5)} data-testid="set-valid">
            Set 1.5
          </button>
        </div>
      );
    };

    render(
      <TextScaleProvider>
        <TestComponent />
      </TextScaleProvider>
    );

    fireEvent.click(screen.getByTestId('set-high'));
    expect(screen.getByTestId('scale')).toHaveTextContent('200%');

    fireEvent.click(screen.getByTestId('set-low'));
    expect(screen.getByTestId('scale')).toHaveTextContent('100%');

    fireEvent.click(screen.getByTestId('set-valid'));
    expect(screen.getByTestId('scale')).toHaveTextContent('150%');
  });

  it('saves scale to localStorage', async () => {
    const TestComponent = () => {
      const { scalePercentage, increaseScale } = useTextScale();
      return (
        <div>
          <div data-testid="scale">{scalePercentage}%</div>
          <button onClick={increaseScale} data-testid="increase-btn">
            Increase
          </button>
        </div>
      );
    };

    const { unmount } = render(
      <TextScaleProvider>
        <TestComponent />
      </TextScaleProvider>
    );

    fireEvent.click(screen.getByTestId('increase-btn'));
    fireEvent.click(screen.getByTestId('increase-btn'));

    await waitFor(() => {
      expect(localStorage.getItem('text-scale-preference')).toBe('1.4');
    });

    unmount();
  });

  it('loads scale from localStorage on mount', async () => {
    localStorage.setItem('text-scale-preference', '1.6');

    const TestComponent = () => {
      const { scalePercentage } = useTextScale();
      return <div data-testid="scale">{scalePercentage}%</div>;
    };

    render(
      <TextScaleProvider>
        <TestComponent />
      </TextScaleProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('scale')).toHaveTextContent('160%');
    });
  });

  it('provides available scales array', () => {
    const TestComponent = () => {
      const { availableScales } = useTextScale();
      return <div data-testid="scales">{availableScales.join(',')}</div>;
    };

    render(
      <TextScaleProvider>
        <TestComponent />
      </TextScaleProvider>
    );

    expect(screen.getByTestId('scales')).toHaveTextContent('1,1.2,1.4,1.6,1.8,2');
  });

  it('throws error when useTextScale is used outside provider', () => {
    const TestComponent = () => {
      const { scale } = useTextScale();
      return <div>{scale}</div>;
    };

    // Suppress console.error for this test
    const spy = jest.spyOn(console, 'error').mockImplementation();

    expect(() => {
      render(<TestComponent />);
    }).toThrow('useTextScale must be used within a TextScaleProvider');

    spy.mockRestore();
  });
});

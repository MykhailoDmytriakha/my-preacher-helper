import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import CustomTimePicker from '@/components/CustomTimePicker';
import SectionTimePicker from '@/components/SectionTimePicker';

const originalScrollTo = Element.prototype.scrollTo;

const cases = [
  { name: 'custom', section: false },
  { name: 'sections', section: true },
];

describe.each(cases)('$name time selection', ({ section }) => {
  beforeEach(() => {
    jest.useFakeTimers();
    // jsdom has no native smooth motion. Scroll events below supply the observed position.
    Element.prototype.scrollTo = jest.fn();
  });

  afterEach(() => {
    cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
    Element.prototype.scrollTo = originalScrollTo;
  });

  const setup = () => {
    const onConfirm = jest.fn();
    const props = { onConfirm, onCancel: jest.fn() };
    if (section) {
      render(<SectionTimePicker initialDurations={{ introduction: 120, main: 900, conclusion: 300 }} {...props} />);
    } else {
      render(<CustomTimePicker initialMinutes={2} {...props} />);
    }
    return onConfirm;
  };

  const scrollMinutes = (minutes: number) => {
    fireEvent.scroll(screen.getByRole('listbox', { name: 'common.minutes' }), {
      target: { scrollTop: minutes * 32 },
    });
  };
  const confirm = () => fireEvent.click(screen.getByRole('button', { name: /plan\.setTime/ }));
  const expectMinutes = (onConfirm: jest.Mock, minutes: number) => {
    if (section) {
      expect(onConfirm).toHaveBeenLastCalledWith({ introduction: minutes * 60, main: 900, conclusion: 300 });
    } else {
      expect(onConfirm).toHaveBeenLastCalledWith(0, minutes, 0);
    }
  };

  it('keeps a later preset when an earlier scroll callback would settle', () => {
    const onConfirm = setup();
    scrollMinutes(4);
    fireEvent.click(screen.getByRole('button', { name: '15m' }));
    act(() => jest.advanceTimersByTime(200));
    confirm();
    expectMinutes(onConfirm, 15);
  });

  it('keeps an explicit preset even when its value was already selected', () => {
    const onConfirm = setup();
    fireEvent.click(screen.getByRole('button', { name: '15m' }));
    scrollMinutes(14);
    fireEvent.click(screen.getByRole('button', { name: '15m' }));
    act(() => jest.advanceTimersByTime(200));
    confirm();
    expectMinutes(onConfirm, 15);
  });

  it('confirms the visible wheel choice immediately', () => {
    const onConfirm = setup();
    scrollMinutes(8);
    confirm();
    expectMinutes(onConfirm, 8);
  });

  it('still accepts a later manual wheel choice after a preset', () => {
    const onConfirm = setup();
    fireEvent.click(screen.getByRole('button', { name: '15m' }));
    scrollMinutes(8);
    act(() => jest.advanceTimersByTime(200));
    confirm();
    expectMinutes(onConfirm, 8);
  });
});

it('keeps the wheel choice with its section when the person immediately changes tabs', () => {
  jest.useFakeTimers();
  Element.prototype.scrollTo = jest.fn();
  const onConfirm = jest.fn();
  try {
    render(<SectionTimePicker initialDurations={{ introduction: 120, main: 900, conclusion: 300 }} onConfirm={onConfirm} onCancel={jest.fn()} />);
    fireEvent.scroll(screen.getByRole('listbox', { name: 'common.minutes' }), { target: { scrollTop: 4 * 32 } });
    fireEvent.click(screen.getByRole('button', { name: /sections\.main/ }));
    fireEvent.click(screen.getByRole('button', { name: '15m' }));
    fireEvent.click(screen.getByRole('button', { name: /sections\.conclusion/ }));
    fireEvent.click(screen.getByRole('button', { name: '5m' }));
    act(() => jest.advanceTimersByTime(200));
    fireEvent.click(screen.getByRole('button', { name: /plan\.setTime/ }));
    expect(onConfirm).toHaveBeenLastCalledWith({ introduction: 240, main: 900, conclusion: 300 });
  } finally {
    cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
    Element.prototype.scrollTo = originalScrollTo;
  }
});

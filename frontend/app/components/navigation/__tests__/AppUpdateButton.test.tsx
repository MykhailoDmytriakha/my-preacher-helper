import { render, screen, fireEvent, act } from '@testing-library/react';

import { AppUpdateButton } from '../AppUpdateButton';
import '@testing-library/jest-dom';

/**
 * BUG-20260810-app-update-prompt-is-intrusive
 *
 * A newer build is not an emergency — it is something the person MAY take. It used
 * to arrive as a toast pinned over the interface with `duration: Infinity`, able to
 * appear mid-sentence while a thought was being dictated, worded so that "reload"
 * read as "you are about to lose something".
 *
 * Now it is an icon in the header: absent while there is nothing to update, quiet
 * when there is, and explaining itself on hover.
 */
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

type Listener = () => void;

function mockServiceWorker({ hasController }: { hasController: boolean }) {
  const listeners: Listener[] = [];
  const container = {
    controller: hasController ? {} : null,
    addEventListener: (_event: string, fn: Listener) => listeners.push(fn),
    removeEventListener: (_event: string, fn: Listener) => {
      const index = listeners.indexOf(fn);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    value: container,
    configurable: true,
    writable: true,
  });
  return { fireControllerChange: () => listeners.forEach((fn) => fn()) };
}

describe('AppUpdateButton', () => {
  const originalReload = window.location.reload;

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: originalReload },
      configurable: true,
      writable: true,
    });
  });

  it('shows nothing while there is no update — the header stays quiet', () => {
    mockServiceWorker({ hasController: true });

    render(<AppUpdateButton />);

    expect(screen.queryByTestId('app-update-button')).not.toBeInTheDocument();
  });

  it('appears once a newer version has taken over', () => {
    const { fireControllerChange } = mockServiceWorker({ hasController: true });

    render(<AppUpdateButton />);
    act(() => fireControllerChange());

    expect(screen.getByTestId('app-update-button')).toBeInTheDocument();
  });

  /**
   * The FIRST service worker install also claims the page. Prompting then would ask
   * people to reload into exactly what they already have.
   */
  it('stays hidden on the very first install, when there is nothing to update to', () => {
    const { fireControllerChange } = mockServiceWorker({ hasController: false });

    render(<AppUpdateButton />);
    act(() => fireControllerChange());

    expect(screen.queryByTestId('app-update-button')).not.toBeInTheDocument();
  });

  it('reloads only when the person presses it, never on its own', () => {
    const reload = jest.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      configurable: true,
      writable: true,
    });
    const { fireControllerChange } = mockServiceWorker({ hasController: true });

    render(<AppUpdateButton />);
    act(() => fireControllerChange());
    expect(reload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('app-update-button'));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('says what it is for, so the icon is not a guess', () => {
    const { fireControllerChange } = mockServiceWorker({ hasController: true });

    render(<AppUpdateButton />);
    act(() => fireControllerChange());

    expect(screen.getByTestId('app-update-button')).toHaveAttribute(
      'aria-label',
      'pwa.updateAvailable.action'
    );
  });
});

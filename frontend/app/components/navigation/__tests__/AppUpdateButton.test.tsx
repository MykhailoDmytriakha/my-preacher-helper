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

  /**
   * A GENUINE update: the server serves a build this tab is not running. The changeover event
   * alone no longer shows anything — see the version-comparison suite below for why.
   */
  const serverHasNewerBuild = () => {
    process.env.NEXT_PUBLIC_APP_VERSION = '80ef473';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: 'beca201' }),
    }) as unknown as typeof fetch;
  };

  afterEach(() => {
    delete (global as { fetch?: unknown }).fetch;
  });

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

  it('appears once a newer version has taken over', async () => {
    serverHasNewerBuild();
    const { fireControllerChange } = mockServiceWorker({ hasController: true });

    render(<AppUpdateButton />);
    await act(async () => { fireControllerChange(); });

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

  it('reloads only when the person presses it, never on its own', async () => {
    serverHasNewerBuild();
    const reload = jest.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload },
      configurable: true,
      writable: true,
    });
    const { fireControllerChange } = mockServiceWorker({ hasController: true });

    render(<AppUpdateButton />);
    await act(async () => { fireControllerChange(); });
    expect(reload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('app-update-button'));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('says what it is for, so the icon is not a guess', async () => {
    serverHasNewerBuild();
    const { fireControllerChange } = mockServiceWorker({ hasController: true });

    render(<AppUpdateButton />);
    await act(async () => { fireControllerChange(); });

    expect(screen.getByTestId('app-update-button')).toHaveAttribute(
      'aria-label',
      'pwa.updateAvailable.action'
    );
  });
});

/**
 * AN EVENT IS NOT AN ANSWER — BUG-20260816-update-button-after-fresh-load.
 *
 * `controllerchange` says a new worker took charge; it says nothing about which code is
 * running in this tab. Measured live on production: the page loaded the NEW build at second
 * one (its new labels were on screen), the changeover fired at 255s, and the button appeared
 * at 256s — offering an update to what was already open. A button that sometimes cries wolf
 * is a button people stop reading, and then the real one is missed too.
 *
 * So the question asked is the honest one: does the version running here differ from the
 * version the server is serving now?
 */
describe('AppUpdateButton compares versions, not lifecycle events', () => {
  const setRunningVersion = (version: string) => {
    process.env.NEXT_PUBLIC_APP_VERSION = version;
  };
  const serverSays = (version: string | null, ok = true) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok,
      json: async () => (version === null ? {} : { version }),
    }) as unknown as typeof fetch;
  };

  afterEach(() => {
    delete (global as { fetch?: unknown }).fetch;
  });

  it('stays hidden when the page already runs what the server serves', async () => {
    setRunningVersion('beca201');
    serverSays('beca201');
    const { fireControllerChange } = mockServiceWorker({ hasController: true });

    render(<AppUpdateButton />);
    await act(async () => { fireControllerChange(); });

    expect(screen.queryByTestId('app-update-button')).not.toBeInTheDocument();
  });

  it('appears when the server is serving a different build', async () => {
    setRunningVersion('80ef473');
    serverSays('beca201');
    const { fireControllerChange } = mockServiceWorker({ hasController: true });

    render(<AppUpdateButton />);
    await act(async () => { fireControllerChange(); });

    expect(screen.getByTestId('app-update-button')).toBeInTheDocument();
  });

  /**
   * COULD NOT ASK ⇒ SAY NOTHING. Guessing "probably newer" is how the false button came
   * back; and missing one costs nothing, because the update arrives by itself the next time
   * the app is opened from scratch.
   */
  it('stays hidden when the server cannot be asked', async () => {
    setRunningVersion('beca201');
    global.fetch = jest.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    const { fireControllerChange } = mockServiceWorker({ hasController: true });

    render(<AppUpdateButton />);
    await act(async () => { fireControllerChange(); });

    expect(screen.queryByTestId('app-update-button')).not.toBeInTheDocument();
  });
});

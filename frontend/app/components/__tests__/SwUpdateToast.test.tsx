import { render } from '@testing-library/react';
import { toast } from 'sonner';

import { SwUpdateToast } from '../SwUpdateToast';

jest.mock('sonner', () => ({ toast: jest.fn() }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

type Listener = () => void;

function installFakeServiceWorker(hasController: boolean) {
  const listeners: Record<string, Listener[]> = {};
  const container = {
    controller: hasController ? ({} as ServiceWorker) : null,
    addEventListener: (type: string, cb: Listener) => {
      (listeners[type] ||= []).push(cb);
    },
    removeEventListener: (type: string, cb: Listener) => {
      listeners[type] = (listeners[type] || []).filter((fn) => fn !== cb);
    },
    emit: (type: string) => {
      (listeners[type] || []).forEach((fn) => fn());
    },
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: container,
  });
  return container;
}

describe('SwUpdateToast', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

  afterEach(() => {
    jest.clearAllMocks();
    if (originalDescriptor) {
      Object.defineProperty(navigator, 'serviceWorker', originalDescriptor);
    } else {
      // @ts-expect-error cleanup of the test-only stub
      delete navigator.serviceWorker;
    }
  });

  it('shows a reload toast when an updated SW takes control (prior controller existed)', () => {
    const sw = installFakeServiceWorker(true);
    render(<SwUpdateToast />);

    expect(toast).not.toHaveBeenCalled();
    sw.emit('controllerchange');

    expect(toast).toHaveBeenCalledTimes(1);
    const [title, opts] = jest.mocked(toast).mock.calls[0] as [string, { action: { label: string; onClick: () => void }; duration: number }];
    expect(title).toBe('pwa.updateAvailable.title');
    expect(opts.action.label).toBe('pwa.updateAvailable.action');
    expect(opts.duration).toBe(Infinity);
  });

  it('does NOT prompt on the first install (no controller at boot)', () => {
    const sw = installFakeServiceWorker(false);
    render(<SwUpdateToast />);

    sw.emit('controllerchange');

    expect(toast).not.toHaveBeenCalled();
  });

  it('prompts at most once across repeated controllerchange events', () => {
    const sw = installFakeServiceWorker(true);
    render(<SwUpdateToast />);

    sw.emit('controllerchange');
    sw.emit('controllerchange');
    sw.emit('controllerchange');

    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('reloads the page when the toast action is clicked', () => {
    const sw = installFakeServiceWorker(true);
    const reload = jest.fn();
    const locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });

    render(<SwUpdateToast />);
    sw.emit('controllerchange');

    const [, opts] = jest.mocked(toast).mock.calls[0] as [string, { action: { label: string; onClick: () => void }; duration: number }];
    opts.action.onClick();
    expect(reload).toHaveBeenCalledTimes(1);

    if (locationDescriptor) {
      Object.defineProperty(window, 'location', locationDescriptor);
    }
  });

  it('renders nothing and is safe when serviceWorker is unsupported', () => {
    // @ts-expect-error simulate a browser without SW support
    delete navigator.serviceWorker;
    const { container } = render(<SwUpdateToast />);
    expect(container).toBeEmptyDOMElement();
    expect(toast).not.toHaveBeenCalled();
  });
});

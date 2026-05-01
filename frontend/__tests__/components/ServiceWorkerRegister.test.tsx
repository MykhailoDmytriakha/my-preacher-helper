import { render, waitFor } from '@testing-library/react';
import React from 'react';

jest.mock('@/utils/debugMode', () => ({
  debugLog: jest.fn(),
}));

describe('ServiceWorkerRegister', () => {
  const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
  let ServiceWorkerRegister: React.ComponentType;
  let register: jest.Mock;
  let serviceWorkerAddEventListener: jest.Mock;
  let serviceWorkerRemoveEventListener: jest.Mock;

  beforeAll(() => {
    process.env.NEXT_PUBLIC_ENABLE_SERVICE_WORKER = 'true';
    ServiceWorkerRegister = require('@/components/ServiceWorkerRegister').ServiceWorkerRegister;
  });

  beforeEach(() => {
    register = jest.fn().mockResolvedValue({
      scope: '/',
      active: {},
      addEventListener: jest.fn(),
      installing: null,
    });
    serviceWorkerAddEventListener = jest.fn();
    serviceWorkerRemoveEventListener = jest.fn();

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register,
        ready: Promise.resolve({ scope: '/', active: {} }),
        addEventListener: serviceWorkerAddEventListener,
        removeEventListener: serviceWorkerRemoveEventListener,
        controller: null,
      },
    });
  });

  afterAll(() => {
    delete process.env.NEXT_PUBLIC_ENABLE_SERVICE_WORKER;
    if (originalServiceWorker) {
      Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
    }
  });

  it('registers the service worker when local PWA mode is explicitly enabled', async () => {
    render(<ServiceWorkerRegister />);

    window.dispatchEvent(new Event('load'));

    await waitFor(() => {
      expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    });

    expect(serviceWorkerAddEventListener).toHaveBeenCalledWith(
      'controllerchange',
      expect.any(Function)
    );
  });

  it('cleans up the controllerchange listener on unmount', () => {
    const { unmount } = render(<ServiceWorkerRegister />);

    unmount();

    expect(serviceWorkerRemoveEventListener).toHaveBeenCalledWith(
      'controllerchange',
      expect.any(Function)
    );
  });
});

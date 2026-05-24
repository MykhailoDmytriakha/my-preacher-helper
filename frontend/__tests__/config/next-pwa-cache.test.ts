describe('next-pwa runtime caching', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  function setNodeEnv(value: string | undefined) {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value,
      configurable: true,
      writable: true,
    });
  }

  afterEach(() => {
    jest.resetModules();
    jest.dontMock('next-pwa');
    jest.dontMock('next-pwa/cache');
    setNodeEnv(originalNodeEnv);
  });

  it('keeps sermon plan generation GETs out of the default API cache', () => {
    setNodeEnv('production');

    jest.doMock('next-pwa/cache', () => [
      {
        urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/api/'),
        handler: 'NetworkFirst',
        method: 'GET',
        options: {
          cacheName: 'apis',
          expiration: { maxEntries: 16, maxAgeSeconds: 86400 },
          networkTimeoutSeconds: 10,
        },
      },
    ]);

    jest.doMock('next-pwa', () => (pwaConfig: Record<string, unknown>) => (
      nextConfig: Record<string, unknown>
    ) => ({
      ...nextConfig,
      __pwaConfig: pwaConfig,
    }));

    const nextConfig = require('../../next.config.js') as { __pwaConfig: { runtimeCaching: Array<{
      urlPattern?: ({ url }: { url: URL }) => boolean;
      handler?: string;
      method?: string;
      options?: { cacheName?: string };
    }> } };
    const runtimeCaching = nextConfig.__pwaConfig.runtimeCaching;
    const planRuleIndex = runtimeCaching.findIndex((entry) =>
      entry.handler === 'NetworkOnly' &&
      entry.method === 'GET' &&
      String(entry.urlPattern).includes('sermons') &&
      String(entry.urlPattern).includes('plan')
    );
    const defaultApiRuleIndex = runtimeCaching.findIndex((entry) => entry.options?.cacheName === 'apis');

    expect(planRuleIndex).toBeGreaterThanOrEqual(0);
    expect(defaultApiRuleIndex).toBeGreaterThan(planRuleIndex);
  });
});

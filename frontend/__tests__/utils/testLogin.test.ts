import { isTestLoginAvailable, testAccount } from '@/utils/testLogin';

/**
 * The dev test account may exist only in builds that decide so at build time
 * (BUG-20260919-test-account-password-in-production-bundle). These cases pin the decision;
 * the proof that a production bundle carries no credentials is a real `next build` — see the
 * commit that introduced this file.
 */
describe('test account availability', () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { NODE_ENV: env.NODE_ENV, FLAG: env.NEXT_PUBLIC_ENABLE_TEST_LOGIN };
  afterEach(() => {
    env.NODE_ENV = saved.NODE_ENV;
    if (saved.FLAG === undefined) delete env.NEXT_PUBLIC_ENABLE_TEST_LOGIN;
    else env.NEXT_PUBLIC_ENABLE_TEST_LOGIN = saved.FLAG;
  });

  it('gives no credentials to a production build without the flag', () => {
    env.NODE_ENV = 'production';
    delete env.NEXT_PUBLIC_ENABLE_TEST_LOGIN;
    expect(testAccount()).toBeNull();
    expect(isTestLoginAvailable()).toBe(false);
    env.NEXT_PUBLIC_ENABLE_TEST_LOGIN = 'false';
    expect(testAccount()).toBeNull();
  });

  it('gives them to a development build', () => {
    env.NODE_ENV = 'development';
    delete env.NEXT_PUBLIC_ENABLE_TEST_LOGIN;
    expect(testAccount()).toEqual({ email: 'testuser@example.com', password: expect.any(String) });
    expect(isTestLoginAvailable()).toBe(true);
  });

  it('gives them to a production build that opted in, and only for the exact word', () => {
    env.NODE_ENV = 'production';
    env.NEXT_PUBLIC_ENABLE_TEST_LOGIN = 'true';
    expect(isTestLoginAvailable()).toBe(true);
    env.NEXT_PUBLIC_ENABLE_TEST_LOGIN = '1';
    expect(isTestLoginAvailable()).toBe(false);
  });
});

/**
 * THE DEV TEST ACCOUNT, AND THE ONLY BUILDS ALLOWED TO CARRY IT.
 *
 * The test user exists so a developer, or an agent, can walk the app without a real account.
 * Its e-mail and password used to sit in the landing page's click handler, outside the
 * condition that hid the button — so every production bundle shipped them, and anyone could
 * sign in to the test account of the production project and spend its AI allowance
 * (BUG-20260919-test-account-password-in-production-bundle).
 *
 * Now the credentials live inside ONE condition that the build decides: Next replaces
 * `process.env.NODE_ENV` and `process.env.NEXT_PUBLIC_ENABLE_TEST_LOGIN` with their values,
 * the minifier folds the condition, and a build in which it is false carries neither the
 * button nor the strings. next.config.mjs always defines the flag, because an unset
 * NEXT_PUBLIC_ variable is left in the code as a runtime lookup and could not be folded.
 * The flag is set only for a Vercel Preview, which Vercel's own sign-in already guards.
 *
 * Read at call time, never at import time: the component tests switch NODE_ENV between renders.
 */
export function testAccount(): { email: string; password: string } | null {
  return process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_ENABLE_TEST_LOGIN === 'true'
    ? { email: 'testuser@example.com', password: 'TestPassword123' }
    : null;
}

export function isTestLoginAvailable(): boolean {
  return testAccount() !== null;
}

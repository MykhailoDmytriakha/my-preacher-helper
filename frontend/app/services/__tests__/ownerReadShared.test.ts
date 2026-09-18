import {
  accountChangedError,
  codeForHttpStatus,
  isAccountChangedError,
} from '@/services/ownerHttpTransport.client';
import { isSilentReadError } from '@/services/ownerListRead.client';

jest.mock('@/utils/apiClient', () => ({ apiClient: jest.fn() }));
jest.mock('@/utils/authenticatedRequest', () => ({ getAuthenticatedRequestHeaders: jest.fn() }));
jest.mock('@/utils/queryKeys', () => ({ resolveOwnerUid: () => 'owner-1' }));
jest.mock('@/utils/appDiagnostics', () => ({ recordDiagnostic: jest.fn(), diagnosticErrorCode: () => undefined }));

/**
 * THE PIECES EVERY OWNER READ SHARES — written once.
 *
 * "The account changed while this was in the air" was built by hand in seven places, the HTTP
 * status → error code table in four, and the list of codes that mean "the transport said
 * nothing" in two. Copies of a rule are how one screen retries where another gives up.
 */
describe('a request that outlived its account', () => {
  it('is refused with one recognisable error', () => {
    const error = accountChangedError();
    expect(error.message).toBe('Account changed');
    expect((error as { code?: string }).code).toBe('unauthenticated');
    expect(isAccountChangedError(error)).toBe(true);
  });

  it('is not confused with any other refusal', () => {
    expect(isAccountChangedError(Object.assign(new Error('nope'), { code: 'unauthenticated' }))).toBe(false);
    expect(isAccountChangedError(null)).toBe(false);
  });
});

describe('what an HTTP status means as an error code', () => {
  it.each([
    [400, 'invalid-argument'],
    [401, 'unauthenticated'],
    [403, 'permission-denied'],
    [404, 'not-found'],
    [500, 'unavailable'],
    [502, 'unavailable'],
    [429, 'unavailable'],
  ])('%s → %s', (status, code) => {
    expect(codeForHttpStatus(status)).toBe(code);
  });
});

describe('a read the transport never answered', () => {
  it.each(['unavailable', 'deadline-exceeded', 'internal', 'unknown', 'cancelled'])(
    'treats %s as silence, worth asking the other road',
    (code) => {
      expect(isSilentReadError(Object.assign(new Error('x'), { code }))).toBe(true);
    }
  );

  it.each(['permission-denied', 'unauthenticated', 'not-found', 'invalid-argument'])(
    'treats %s as an answer — asking again would only repeat it',
    (code) => {
      expect(isSilentReadError(Object.assign(new Error('x'), { code }))).toBe(false);
    }
  );

  it('treats an error with no code as an answer, not as silence', () => {
    expect(isSilentReadError(new Error('broken'))).toBe(false);
    expect(isSilentReadError(undefined)).toBe(false);
  });
});

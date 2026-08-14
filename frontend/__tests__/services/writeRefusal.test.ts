import { isWriteRefusedError } from '@/services/conflictSafeUpdate.client';

const { FirestoreError } = jest.requireActual<typeof import('firebase/firestore')>('firebase/firestore');

// FirestoreError's constructor is private, so TypeScript refuses `new FirestoreError(...)`
// even though the class is exported. The cast keeps the REAL SDK class at runtime — which is
// the point of these tests, they assert on the object a denied write actually produces —
// while satisfying the type checker.
const makeFirestoreError = (code: string, message = code): Error & { code: string } => {
  const Ctor = FirestoreError as unknown as new (code: string, message: string) => Error & { code: string };
  return new Ctor(code, message);
};

/**
 * Repeating a refusal cannot change its answer — and while it is being repeated the
 * screen still shows the entry as stored, so the person is told nothing for the whole
 * length of the retry ladder. Reproduced live against rules that deny every write: an
 * added prayer update looked saved, said nothing, and was gone after a reload.
 */
describe('a refused write is told apart from a delayed one', () => {
  it('classifies the real browser Firestore error object received by a denied write', () => {
    const error = makeFirestoreError(
      'permission-denied',
      'Missing or insufficient permissions.'
    );

    expect({
      constructor: error.constructor.name,
      name: error.name,
      code: error.code,
      message: error.message,
    }).toEqual({
      constructor: 'FirebaseError',
      name: 'FirebaseError',
      code: 'permission-denied',
      message: 'Missing or insufficient permissions.',
    });
    expect(isWriteRefusedError(error)).toBe(true);
  });

  it.each([
    'permission-denied',
    'unauthenticated',
    'not-found',
    'invalid-argument',
    'failed-precondition',
  ])('treats %s as final, because asking again gets the same answer', (code) => {
    expect(isWriteRefusedError(Object.assign(new Error('refused'), { code }))).toBe(true);
  });

  it.each([
    'unavailable',
    'deadline-exceeded',
    'internal',
    'aborted',
    'resource-exhausted',
  ])('does not classify retryable %s as a refusal', (code) => {
    expect(isWriteRefusedError(Object.assign(new Error('hiccup'), { code }))).toBe(false);
  });

  it('reads the code even when the SDK prefixes it with its service name', () => {
    expect(isWriteRefusedError(Object.assign(new Error('x'), { code: 'firestore/permission-denied' }))).toBe(true);
  });

  it('keeps retrying an error carrying no code at all, rather than discarding the work', () => {
    expect(isWriteRefusedError(new Error('who knows'))).toBe(false);
    expect(isWriteRefusedError(null)).toBe(false);
  });
});

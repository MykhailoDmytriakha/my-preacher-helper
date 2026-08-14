import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

import { useWriteRecovery } from '@/utils/recoverableWrite';
import { forgetReportedFailures } from '@/utils/writeRecovery';

const mockToastError = jest.fn();
jest.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args), success: jest.fn() },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const MUTATION_KEY = ['things', 'update'] as const;

const refusal = () =>
  Object.assign(new Error('Missing or insufficient permissions.'), {
    code: 'permission-denied',
    name: 'FirebaseError',
  });

/**
 * Ownership is often decided against a list that is still LOADING when a restored
 * failure is first examined. If the answer is only ever asked once, the person's
 * refused text stays unreachable for the whole session — so this suite pins the
 * re-examination, and pins that it does not turn into a second message.
 */
function Harness({
  queryClient,
  ids,
  user = 'user-1',
}: {
  queryClient: QueryClient;
  ids: string[];
  user?: string;
}) {
  useWriteRecovery<{ id: string; title: string }>(queryClient, {
    mutationKey: MUTATION_KEY,
    fallbackTitleKey: 'common.saveError',
    recoveryText: (vars) => vars.title,
    toastId: (vars) => `write-recovery:thing:${vars.id}`,
    // Same shape the real hooks use: signed-in user first, then the list it judges
    // ownership against.
    ownershipEpoch: `${user}:${ids.join(',')}`,
    owns: (vars) => ids.includes(vars.id),
    retry: () => undefined,
  });
  return null;
}

const failOne = async (queryClient: QueryClient) => {
  const mutation = queryClient.getMutationCache().build(queryClient, {
    mutationKey: MUTATION_KEY,
    mutationFn: () => Promise.reject(refusal()),
  });
  await mutation.execute({ id: 'thing-1', title: 'Words worth keeping' }).catch(() => undefined);
};

describe('useWriteRecovery re-examines a refusal once ownership becomes knowable', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports the restored failure after the list that proves ownership arrives', async () => {
    const queryClient = new QueryClient({
      mutationCache: new MutationCache(),
      defaultOptions: { mutations: { retry: false } },
    });
    await failOne(queryClient);

    // Mounted while the list is still empty: ownership cannot be proven yet.
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <Harness queryClient={queryClient} ids={[]} />
      </QueryClientProvider>
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(mockToastError).not.toHaveBeenCalled();

    // The list lands, and with it the answer.
    rerender(
      <QueryClientProvider client={queryClient}>
        <Harness queryClient={queryClient} ids={['thing-1']} />
      </QueryClientProvider>
    );

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    const [, options] = mockToastError.mock.calls[0] as [string, { description: string }];
    expect(options.description).toBe('Words worth keeping');
  });

  it('does not repeat itself when the list changes again', async () => {
    const queryClient = new QueryClient({
      mutationCache: new MutationCache(),
      defaultOptions: { mutations: { retry: false } },
    });
    await failOne(queryClient);

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <Harness queryClient={queryClient} ids={['thing-1']} />
      </QueryClientProvider>
    );
    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));

    rerender(
      <QueryClientProvider client={queryClient}>
        <Harness queryClient={queryClient} ids={['thing-1', 'thing-2']} />
      </QueryClientProvider>
    );
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(mockToastError).toHaveBeenCalledTimes(1);
  });

  it('re-examines when the list CONTENTS change, not merely its length', async () => {
    // An epoch built from a count cannot see a same-length list whose contents changed
    // — ownership flips from false to true and nothing looks at the failure again.
    const queryClient = new QueryClient({
      mutationCache: new MutationCache(),
      defaultOptions: { mutations: { retry: false } },
    });
    await failOne(queryClient);

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <Harness queryClient={queryClient} ids={['other-thing']} />
      </QueryClientProvider>
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(mockToastError).not.toHaveBeenCalled();

    // Same length, different contents — and now the failure IS this person's.
    rerender(
      <QueryClientProvider client={queryClient}>
        <Harness queryClient={queryClient} ids={['thing-1']} />
      </QueryClientProvider>
    );

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
  });

  it('says it again to the same person after they sign back in', async () => {
    // Signing out clears the shared record of what has been announced; this hook keeps
    // its OWN record in a ref, and without clearing that too the person who returns
    // never sees their unresolved refusal again — it looks handled when it is not.
    const queryClient = new QueryClient({
      mutationCache: new MutationCache(),
      defaultOptions: { mutations: { retry: false } },
    });
    await failOne(queryClient);

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <Harness queryClient={queryClient} ids={['thing-1']} user="user-1" />
      </QueryClientProvider>
    );
    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));

    // Sign out, then back in as the same person: a new session, same unresolved write.
    forgetReportedFailures();
    rerender(
      <QueryClientProvider client={queryClient}>
        <Harness queryClient={queryClient} ids={[]} user="" />
      </QueryClientProvider>
    );
    rerender(
      <QueryClientProvider client={queryClient}>
        <Harness queryClient={queryClient} ids={['thing-1']} user="user-1" />
      </QueryClientProvider>
    );

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(2));
  });
});


/**
 * Found by hand, in the browser: a refused settings TOGGLE (no text at all) was persisted
 * as a failed mutation, and every launch restored it and threw a red "your change was
 * refused" onto whatever page happened to open — days later, with nothing to act on and
 * no way to tell which change it meant. A refusal that holds a person's draft must still
 * come back; one that holds nothing was already said when it happened.
 */
describe('a refusal restored from a PREVIOUS session', () => {
  const TEXTLESS_KEY = ['settings', 'firstDayOfWeek'] as const;

  function TextlessHarness({ queryClient }: { queryClient: QueryClient }) {
    useWriteRecovery<{ userId: string; value: string }>(queryClient, {
      mutationKey: TEXTLESS_KEY,
      fallbackTitleKey: 'common.saveError',
      // A toggle: there is no typed text to hand back.
      recoveryText: () => undefined,
      toastId: (vars) => `write-recovery:setting:${vars.userId}`,
      owns: () => true,
      retry: () => undefined,
    });
    return null;
  }

  const failToggle = async (queryClient: QueryClient, submittedAt?: number) => {
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationKey: TEXTLESS_KEY,
      mutationFn: () => Promise.reject(refusal()),
    });
    await mutation.execute({ userId: 'user-1', value: 'monday' }).catch(() => undefined);
    if (submittedAt !== undefined) {
      (mutation.state as { submittedAt: number }).submittedAt = submittedAt;
    }
    return mutation;
  };

  beforeEach(() => {
    mockToastError.mockClear();
    forgetReportedFailures();
  });

  it('stays silent and drops it when it carries no text to recover', async () => {
    const queryClient = new QueryClient({ mutationCache: new MutationCache() });
    // Stamped before this session began — i.e. restored from IndexedDB, not made here.
    await failToggle(queryClient, Date.now() - 60 * 60 * 1000);

    render(
      <QueryClientProvider client={queryClient}>
        <TextlessHarness queryClient={queryClient} />
      </QueryClientProvider>
    );

    await waitFor(() =>
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0)
    );
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('still speaks for a refusal made in THIS session, text or not', async () => {
    // The person just pressed the switch and it was refused: silence here is the very
    // defect this whole mechanism exists to prevent.
    const queryClient = new QueryClient({ mutationCache: new MutationCache() });

    render(
      <QueryClientProvider client={queryClient}>
        <TextlessHarness queryClient={queryClient} />
      </QueryClientProvider>
    );
    await failToggle(queryClient);

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
  });

  it('still brings back a restored refusal that DOES hold the person\'s draft', async () => {
    const queryClient = new QueryClient({ mutationCache: new MutationCache() });
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationKey: MUTATION_KEY,
      mutationFn: () => Promise.reject(refusal()),
    });
    await mutation.execute({ id: 'thing-1', title: 'Words worth keeping' }).catch(() => undefined);
    (mutation.state as { submittedAt: number }).submittedAt = Date.now() - 60 * 60 * 1000;

    render(
      <QueryClientProvider client={queryClient}>
        <Harness queryClient={queryClient} ids={['thing-1']} user="user-1" />
      </QueryClientProvider>
    );

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);
  });
});

import { render, screen } from '@testing-library/react';
import React from 'react';

import { SermonSyncBadge } from '@/components/dashboard/SermonSyncBadge';

import type { DashboardSermonSyncState } from '@/models/dashboardOptimistic';
import type { TFunction } from 'i18next';

const t = ((key: string, options?: { defaultValue?: string }) => {
  const translations: Record<string, string> = {
    'freshness.copyTextAction': 'Copy my text',
    'freshness.conflictKeepMine': 'Send mine anyway',
    'freshness.conflictTakeTheirs': 'Keep theirs',
    'freshness.title': 'Newer version',
    'freshness.staleSaveToast': 'This changed on another device.',
    'buttons.retry': 'Retry',
    'buttons.dismiss': 'Dismiss',
    'writeRecovery.refusedLabel': 'Save refused',
    'optionMenu.delete': 'Delete',
    'addSermon.newSermon': 'New sermon',
  };
  return translations[key] ?? options?.defaultValue ?? key;
}) as unknown as TFunction;

const actions = {
  retrySync: jest.fn(),
  dismissSyncError: jest.fn(),
} as unknown as Parameters<typeof SermonSyncBadge>[0]['optimisticActions'];

const errorState = (state: Partial<DashboardSermonSyncState>): DashboardSermonSyncState =>
  ({
    status: 'error',
    operation: 'create',
    submissionId: 1,
    message: 'Sermon changes were not saved.',
    ...state,
  }) as DashboardSermonSyncState;

describe('SermonSyncBadge — an action is offered only when it can do something', () => {
  it('offers to copy the draft when a refused write carries one', () => {
    render(
      <SermonSyncBadge
        sermonId="sermon-1"
        syncState={errorState({ refused: true, recoveryText: 'Title I typed' })}
        optimisticActions={actions}
        t={t}
      />
    );

    expect(screen.getByRole('button', { name: 'Copy my text' })).toBeInTheDocument();
    expect(screen.getByText('Title I typed')).toBeInTheDocument();
  });

  it('offers NO copy button for a refused delete, which has no draft to hand back', () => {
    // The defect: "Copy my text" was rendered unconditionally for refusals, so pressing it
    // on a delete or a preached-status change replaced the clipboard with an empty string —
    // the app claiming to return text it never held.
    render(
      <SermonSyncBadge
        sermonId="sermon-1"
        syncState={errorState({ refused: true, operation: 'delete', recoveryText: undefined })}
        optimisticActions={actions}
        t={t}
      />
    );

    expect(screen.queryByRole('button', { name: 'Copy my text' })).not.toBeInTheDocument();
    // The refusal is still SAID, and can still be acknowledged.
    expect(screen.getByRole('alert')).toHaveTextContent('Save refused');
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('keeps Retry for an ordinary failure, which is what a retry is for', () => {
    render(
      <SermonSyncBadge
        sermonId="sermon-1"
        syncState={errorState({ refused: false, operation: 'delete' })}
        optimisticActions={actions}
        t={t}
      />
    );

    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('keeps the conflict CHOICE, which is two live actions rather than a message', () => {
    render(
      <SermonSyncBadge
        sermonId="sermon-1"
        syncState={errorState({ conflict: true, recoveryText: undefined })}
        optimisticActions={actions}
        t={t}
      />
    );

    expect(screen.getByRole('button', { name: 'Send mine anyway' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep theirs' })).toBeInTheDocument();
  });
});

import { act, render, screen } from '@testing-library/react';

import { DraftStorageNotice } from '@/components/DraftStorageNotice';
import { saveDraft } from '@/utils/durableDraft';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
let mockUid: string | undefined = 'u';
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: mockUid ? { uid: mockUid } : null, loading: false }) }));

const refuseWrites = () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  return jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
};

describe('the app-wide notice that unsaved text has no safety net', () => {
  afterEach(() => { jest.restoreAllMocks(); localStorage.clear(); mockUid = 'u'; });

  it('appears when the browser refuses a draft and goes away once a draft lands', () => {
    saveDraft('draft:v1:u:d:a', 'earlier');
    render(<DraftStorageNotice />);
    expect(screen.queryByText('draftStorage.title')).not.toBeInTheDocument();
    const setItem = refuseWrites();
    act(() => { saveDraft('draft:v1:u:d:a', 'typed'); });
    expect(screen.getByText('draftStorage.title')).toBeInTheDocument();
    setItem.mockRestore();
    act(() => { saveDraft('draft:v1:u:d:a', 'typed'); });
    expect(screen.queryByText('draftStorage.title')).not.toBeInTheDocument();
  });

  // BUG-20260928-draft-storage-notice-not-owner-scoped: the debt is the text of one account; the
  // next account signed in to the same tab is not told about it.
  it('speaks only to the account whose text has no safety net', () => {
    const setItem = refuseWrites();
    saveDraft('draft:v1:a:d:a', 'text of account a');
    setItem.mockRestore();

    mockUid = 'b';
    const asB = render(<DraftStorageNotice />);
    expect(screen.queryByText('draftStorage.title')).not.toBeInTheDocument();
    asB.unmount();

    mockUid = 'a';
    render(<DraftStorageNotice />);
    expect(screen.getByText('draftStorage.title')).toBeInTheDocument();
    act(() => { saveDraft('draft:v1:a:d:a', 'text of account a'); });
    expect(screen.queryByText('draftStorage.title')).not.toBeInTheDocument();
  });

  it('tells the signed-in account when its own copy is refused while another account still owes one', () => {
    const setItem = refuseWrites();
    saveDraft('draft:v1:a:d:a', 'text of account a');
    mockUid = 'b';
    render(<DraftStorageNotice />);
    expect(screen.queryByText('draftStorage.title')).not.toBeInTheDocument();
    act(() => { saveDraft('draft:v1:b:d:a', 'text of account b'); });
    expect(screen.getByText('draftStorage.title')).toBeInTheDocument();
    setItem.mockRestore();
    act(() => { saveDraft('draft:v1:a:d:a', 'text of account a'); saveDraft('draft:v1:b:d:a', 'text of account b'); });
  });

  it('does not take an account whose id merely starts like another for that account', () => {
    const setItem = refuseWrites();
    saveDraft('draft:v1:ab:d:a', 'text of account ab');
    setItem.mockRestore();
    mockUid = 'a';
    render(<DraftStorageNotice />);
    expect(screen.queryByText('draftStorage.title')).not.toBeInTheDocument();
    act(() => { saveDraft('draft:v1:ab:d:a', 'text of account ab'); });
  });
});

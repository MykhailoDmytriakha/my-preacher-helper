import { act, render, screen } from '@testing-library/react';

import { DraftStorageNotice } from '@/components/DraftStorageNotice';
import { saveDraft } from '@/utils/durableDraft';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('the app-wide notice that unsaved text has no safety net', () => {
  afterEach(() => { jest.restoreAllMocks(); localStorage.clear(); });

  it('appears when the browser refuses a draft and goes away once a draft lands', () => {
    saveDraft('draft:v1:u:d:a', 'earlier');
    render(<DraftStorageNotice />);
    expect(screen.queryByText('draftStorage.title')).not.toBeInTheDocument();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError'); });
    act(() => { saveDraft('draft:v1:u:d:a', 'typed'); });
    expect(screen.getByText('draftStorage.title')).toBeInTheDocument();
    setItem.mockRestore();
    act(() => { saveDraft('draft:v1:u:d:a', 'typed'); });
    expect(screen.queryByText('draftStorage.title')).not.toBeInTheDocument();
  });
});

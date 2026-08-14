import { render, screen } from '@testing-library/react';
import React from 'react';

import { OfflineBanner } from '@/components/OfflineBanner';

const mockIsOnline = jest.fn();
jest.mock('@/providers/ConnectionProvider', () => ({
  useConnection: () => ({ isOnline: mockIsOnline() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('OfflineBanner', () => {
  it('says it through the translation layer, not in hardcoded English', () => {
    /**
     * Found in the browser: the banner read "Working in offline mode…" in a fully Russian
     * interface — at the exact moment a person most needs to understand what is happening
     * to the text they just typed. Every user-visible string belongs in locales/{en,ru,uk}.
     */
    mockIsOnline.mockReturnValue(false);

    render(<OfflineBanner />);

    expect(screen.getByText('connection.offlineBanner')).toBeInTheDocument();
    expect(screen.queryByText(/Working in offline mode/i)).not.toBeInTheDocument();
  });

  it('stays out of the way while the connection is up', () => {
    mockIsOnline.mockReturnValue(true);

    const { container } = render(<OfflineBanner />);

    expect(container).toBeEmptyDOMElement();
  });
});

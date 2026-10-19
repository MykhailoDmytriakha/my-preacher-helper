import { render } from '@testing-library/react';
import type { User } from 'firebase/auth';

import { GuestBanner } from '@/components/GuestBanner';

let mockUser: User | null = null;
let mockValidGuest = true;
const mockLogOut = jest.fn();
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: mockUser, loading: false }) }));
jest.mock('@services/firebaseAuth.service', () => ({
  auth: { get currentUser() { return mockUser; } },
  logOut: () => mockLogOut(),
  checkGuestExpiration: () => mockValidGuest,
}));

describe('GuestBanner expiration', () => {
  beforeEach(() => { jest.clearAllMocks(); mockUser = null; mockValidGuest = true; });

  it('renders nothing and leaves a signed-out visitor alone', () => {
    const view = render(<GuestBanner />);
    expect(view.container).toBeEmptyDOMElement();
    expect(mockLogOut).not.toHaveBeenCalled();
  });

  it('leaves a valid anonymous session alone', () => {
    mockUser = { uid: 'guest', isAnonymous: true } as User;
    render(<GuestBanner />);
    expect(mockLogOut).not.toHaveBeenCalled();
  });

  it('does not expire a non-anonymous session', () => {
    mockUser = { uid: 'registered', isAnonymous: false } as User;
    mockValidGuest = false;
    render(<GuestBanner />);
    expect(mockLogOut).not.toHaveBeenCalled();
  });

  it('expires an anonymous session through the canonical logout without mirror cleanup', () => {
    mockUser = { uid: 'expired', isAnonymous: true } as User;
    mockValidGuest = false;
    const removeItem = jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    try {
      render(<GuestBanner />);
      expect(mockLogOut).toHaveBeenCalledTimes(1);
      expect(removeItem).not.toHaveBeenCalled();
    } finally { removeItem.mockRestore(); }
  });

  it('checks the current identity when an expired guest replaces the prior user', () => {
    mockUser = { uid: 'registered', isAnonymous: false } as User;
    const view = render(<GuestBanner />);
    mockUser = { uid: 'expired', isAnonymous: true } as User;
    mockValidGuest = false;
    view.rerender(<GuestBanner />);
    expect(mockLogOut).toHaveBeenCalledTimes(1);
  });
});

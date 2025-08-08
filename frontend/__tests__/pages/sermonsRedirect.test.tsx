import React from 'react';
import '@testing-library/jest-dom';

// Mock next/navigation redirect
const redirectMock = jest.fn();
jest.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}));

describe('Sermons index redirect', () => {
  it('redirects /sermons to /dashboard', async () => {
    // Import after mocks
    const SermonsIndexRedirect = (await import('@/(pages)/(private)/sermons/page')).default;
    // Render triggers redirect (component returns null after redirect)
    SermonsIndexRedirect();
    expect(redirectMock).toHaveBeenCalledWith('/dashboard');
  });
});



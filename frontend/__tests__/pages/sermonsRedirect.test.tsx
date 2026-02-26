import '@testing-library/jest-dom';

// Mock next/navigation redirect
const redirectMock = jest.fn();
jest.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}));

describe('Dashboard redirect', () => {
  it('redirects /dashboard to /sermons', async () => {
    // Import after mocks
    const DashboardRedirect = (await import('@/(pages)/(private)/dashboard/page')).default;
    // Render triggers redirect (component returns null after redirect)
    DashboardRedirect();
    expect(redirectMock).toHaveBeenCalledWith('/sermons');
  });
});



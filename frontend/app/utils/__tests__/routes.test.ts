import { isStudyEditRoute } from '../routes';

describe('routes utilities', () => {
  it('matches only canonical study edit routes', () => {
    expect(isStudyEditRoute('/studies/edit')).toBe(false);
    expect(isStudyEditRoute('/studies/abc/edit')).toBe(true);
    expect(isStudyEditRoute('/studies/abc/version/v1/edit')).toBe(false);
    expect(isStudyEditRoute(null)).toBe(false);
  });
});

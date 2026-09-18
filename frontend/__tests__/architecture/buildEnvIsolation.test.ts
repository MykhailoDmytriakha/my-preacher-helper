/**
 * The Vercel build runs this suite with the PRODUCTION env. Any switch that changes which code
 * path a screen takes must be cleared in `jest.setup.js`, or the deploy that flips the switch
 * fails its own test gate. This suite is the alarm for the DataEngine switches: run the whole
 * suite with them set (`NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS=councils DATA_ENGINE_COLLECTIONS=councils
 * npm run test:fast`) and it must stay green.
 */
describe('build environment isolation', () => {
  it('starts every suite with the DataEngine switches cleared', () => {
    const leaked = Object.keys(process.env).filter(key => /^(NEXT_PUBLIC_)?DATA_ENGINE_/.test(key));
    expect(leaked).toEqual([]);
  });
});

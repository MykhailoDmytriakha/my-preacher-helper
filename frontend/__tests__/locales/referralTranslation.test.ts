import en from '../../locales/en/translation.json';
import ru from '../../locales/ru/translation.json';
import uk from '../../locales/uk/translation.json';

describe('referral stats translations', () => {
  it.each([
    ['en', en],
    ['ru', ru],
    ['uk', uk],
  ])('provides inviter and admin count labels in %s', (_locale, translation) => {
    expect(translation.settings.referral.invitedCount).toEqual(expect.any(String));
    expect(translation.admin.users.fields.invitedCount).toEqual(expect.any(String));
  });
});

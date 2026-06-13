import { adminDb } from '@/config/firebaseAdminConfig';
import { getCustomTags, isRequiredTag } from '@clients/firestore.client';

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn(),
  },
}));

describe('firestore.client tag helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('treats localized section names as reserved required tags', () => {
    expect(isRequiredTag('Вступление')).toBe(true);
    expect(isRequiredTag('Основная часть')).toBe(true);
    expect(isRequiredTag('Main Part')).toBe(true);
    expect(isRequiredTag('Примеры')).toBe(false);
  });

  it('filters legacy structural tags out of custom tags', async () => {
    const getMock = jest.fn().mockResolvedValue({
      docs: [
        { id: 'legacy-main', data: () => ({ name: 'Основная часть', required: false, userId: 'u1' }) },
        { id: 'legacy-intro', data: () => ({ name: 'Intro', required: false, userId: 'u1' }) },
        { id: 'aux', data: () => ({ name: 'Примеры', required: false, userId: 'u1', color: '#00ff00' }) },
      ],
    });
    const whereUserIdMock = jest.fn(() => ({ get: getMock }));
    const whereRequiredMock = jest.fn(() => ({ where: whereUserIdMock }));
    (adminDb.collection as jest.Mock).mockReturnValue({ where: whereRequiredMock });

    const tags = await getCustomTags('u1');

    expect(tags).toEqual([
      { id: 'aux', name: 'Примеры', required: false, userId: 'u1', color: '#00ff00' },
    ]);
    expect(whereRequiredMock).toHaveBeenCalledWith('required', '==', false);
    expect(whereUserIdMock).toHaveBeenCalledWith('userId', '==', 'u1');
  });
});

import { addCustomTag, removeCustomTag } from '@/services/tag.service';

describe('tag.service API contracts', () => {
  const originalFetch = global.fetch;
  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '';

  afterEach(() => {
    global.fetch = originalFetch as any;
  });

  it('addCustomTag handles reserved-name 400 response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: 'Reserved tag name' }) });
    const tag: any = { id: '', userId: 'u1', name: 'Introduction', color: '#fff', required: false };
    await expect(addCustomTag(tag)).rejects.toBeTruthy();
  });

  it('removeCustomTag returns success and supports cascade info', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ message: 'Tag removed', affectedThoughts: 5 }) });
    const res: any = await removeCustomTag('u1', 'Custom');
    expect(res.message).toBe('Tag removed');
    expect(res.affectedThoughts).toBe(5);
  });
});



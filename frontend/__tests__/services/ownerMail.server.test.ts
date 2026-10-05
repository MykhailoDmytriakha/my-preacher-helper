jest.mock('nodemailer', () => {
  const createTransport = jest.fn();
  return { __esModule: true, default: { createTransport }, createTransport };
});

type OwnerMail = typeof import('@/services/ownerMail.server');

describe('sendOwnerNotice', () => {
  const sendMail = jest.fn();
  const notice = { subject: 'Referral check', text: 'text', html: '<p>text</p>' };
  let ownerMail: OwnerMail;
  let createTransport: jest.Mock;

  beforeAll(async () => {
    // The mail settings are read when the module loads, as in production.
    process.env.EMAIL_USER = 'sender@example.com';
    process.env.EMAIL_PASSWORD = 'secret';
    process.env.OWNER_EMAIL = 'owner@example.com';
    ownerMail = await import('@/services/ownerMail.server');
    createTransport = (jest.requireMock('nodemailer') as { createTransport: jest.Mock }).createTransport;
  });

  afterAll(() => {
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_PASSWORD;
    delete process.env.OWNER_EMAIL;
  });

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    sendMail.mockReset().mockResolvedValue({});
    createTransport.mockReset().mockReturnValue({ sendMail });
  });

  afterEach(() => jest.restoreAllMocks());

  it('caps every wait on the mail server when the caller has a budget', async () => {
    await expect(ownerMail.sendOwnerNotice(notice, { timeoutMs: 5_000 })).resolves.toBe(true);

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      dnsTimeout: 5_000,
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 5_000,
    }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner@example.com', subject: 'Referral check' }));
  });

  it('keeps the transport as it was for a caller without a budget, like feedback', async () => {
    await ownerMail.sendOwnerNotice(notice);

    const config = createTransport.mock.calls[0][0] as Record<string, unknown>;
    expect(config).not.toHaveProperty('dnsTimeout');
    expect(config).not.toHaveProperty('connectionTimeout');
    expect(config).not.toHaveProperty('greetingTimeout');
    expect(config).not.toHaveProperty('socketTimeout');
  });
});

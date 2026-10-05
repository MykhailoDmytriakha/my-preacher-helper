import nodemailer from 'nodemailer';

/**
 * ONE MAIL CHANNEL FOR EVERY NOTICE TO THE OWNER — feedback, referral warnings.
 *
 * A second notice must not grow its own transport or its own idea of the owner's address: the
 * settings come from the same environment variables, and a notice is skipped (not failed) when
 * the credentials are not configured, exactly as feedback has always done.
 */
interface OwnerMailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

export const OWNER_MAIL_CONFIG: OwnerMailConfig = {
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASSWORD || '',
  },
};

/** The owner's address for notices. */
export const OWNER_EMAIL = process.env.OWNER_EMAIL || 'my@gmail.com';

export const ownerMailConfigured = (): boolean =>
  Boolean(OWNER_MAIL_CONFIG.auth.user && OWNER_MAIL_CONFIG.auth.pass);

export const ownerMailFrom = (): string => `"Preacher Helper" <${OWNER_MAIL_CONFIG.auth.user}>`;

/** Waits on the mail server, in ms; nodemailer's own defaults reach an hour of silence. */
interface MailServerLimits {
  dnsTimeout: number;
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
}

export function createOwnerMailTransport(limits?: MailServerLimits) {
  console.log(`Creating email transporter with host: ${OWNER_MAIL_CONFIG.host}, port: ${OWNER_MAIL_CONFIG.port}`);
  return nodemailer.createTransport(limits ? { ...OWNER_MAIL_CONFIG, ...limits } : OWNER_MAIL_CONFIG);
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

/**
 * Sends a plain notice to the owner. Returns false without sending when mail is not configured;
 * a failure to send is thrown for the caller to decide whether it matters. `timeoutMs` caps each
 * wait on the mail server (resolving it, connecting, its greeting, its silence) for a caller that
 * must not keep a function alive. These are per-wait caps, not a total: a non-pooled transport
 * cannot be aborted mid-send, so the caller's hard stop is its function's `maxDuration`.
 */
export async function sendOwnerNotice(
  notice: { subject: string; text: string; html: string },
  options: { timeoutMs?: number } = {}
): Promise<boolean> {
  if (!ownerMailConfigured()) {
    console.log('Email credentials not configured, skipping owner notice');
    return false;
  }
  const { timeoutMs } = options;
  const transport = createOwnerMailTransport(timeoutMs === undefined
    ? undefined
    : { dnsTimeout: timeoutMs, connectionTimeout: timeoutMs, greetingTimeout: timeoutMs, socketTimeout: timeoutMs });
  await transport.sendMail({ from: ownerMailFrom(), to: OWNER_EMAIL, ...notice });
  return true;
}

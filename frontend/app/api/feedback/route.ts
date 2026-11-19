import { NextRequest, NextResponse } from 'next/server';

import { getAuthenticatedIdentity } from '@/api/auth/getAuthenticatedIdentity.server';
import { resolveFirestoreWriteRefusal } from '@/api/errors/firestoreWriteRefusal.server';
import { adminDb } from '@/config/firebaseAdminConfig';
import {
  createOwnerMailTransport,
  escapeHtml,
  OWNER_EMAIL,
  ownerMailConfigured,
  ownerMailFrom,
} from '@/services/ownerMail.server';
import {
  consumeSlidingWindowRateLimit,
  FEEDBACK_RATE_LIMIT_MAX_SUBMISSIONS,
  FEEDBACK_RATE_LIMIT_WINDOW_MS,
} from '@/services/rateLimit.server';
import { StoreUnavailableError, storeUnavailableResponse, withStore } from '@/services/storeAvailability.server';
import {
  checkFeedbackDiagnostics,
  getFeedbackImageDecodedSize,
  getUtf8ByteLength,
  MAX_FEEDBACK_IMAGE_BYTES,
  MAX_FEEDBACK_IMAGES,
  MAX_FEEDBACK_PAYLOAD_BYTES,
  MAX_FEEDBACK_TEXT_BYTES,
} from '@/utils/feedbackPayload';
import { isIPadDevice } from '@/utils/pwaEnv';
import { afterResponse } from '@/utils/server/afterResponse.server';

// Define types for better code safety
interface FeedbackData {
  text: string;
  type: string;
  userId: string;
  userEmail: string;
  createdAt: string;
  status: string;
  userAgent: string;
  images?: string[];   // only used transiently for email; not persisted to Firestore
  imageCount?: number; // stored in Firestore instead of raw Base64
  /** The technical report, beside the words: a JSON string in Firestore, a file in the letter. */
  diagnostics?: { json: string; report: Record<string, unknown> };
  /** Why a report that was asked for is missing — so the reader knows it was not forgotten. */
  diagnosticsDropped?: 'invalid' | 'too-large';
}

const NOT_PROVIDED = 'Not provided';
const MAX_FEEDBACK_TYPE_LENGTH = 32;
const ALLOWED_FEEDBACK_TYPES = new Set([
  'suggestion',
  'bug',
  'question',
  'other',
]);

function resolveFeedbackType(value: unknown): string {
  if (
    typeof value === 'string' &&
    value.length <= MAX_FEEDBACK_TYPE_LENGTH &&
    ALLOWED_FEEDBACK_TYPES.has(value)
  ) {
    return value;
  }
  return 'other';
}

type ImageValidationResult =
  | { ok: true; images: string[] }
  | { ok: false; error: string; status: number };

function validateImages(images: unknown): ImageValidationResult {
  if (images === undefined) return { ok: true, images: [] };
  if (!Array.isArray(images) || images.length > MAX_FEEDBACK_IMAGES) {
    return {
      ok: false,
      error: `Images must be an array with at most ${MAX_FEEDBACK_IMAGES} items`,
      status: 400,
    };
  }

  for (const image of images) {
    if (typeof image !== 'string') {
      return { ok: false, error: 'Each image must be a valid data URL', status: 400 };
    }

    const decodedSize = getFeedbackImageDecodedSize(image);
    if (decodedSize === null) {
      return {
        ok: false,
        error: 'Images must be PNG, JPEG, or WebP base64 data URLs',
        status: 400,
      };
    }
    if (decodedSize > MAX_FEEDBACK_IMAGE_BYTES) {
      return { ok: false, error: 'Image is too large', status: 413 };
    }
  }

  return { ok: true, images };
}


/**
 * Builds inline image HTML for the email body using CID references.
 * CIDs must match the `cid` field in the nodemailer `attachments` array.
 */
function buildImageHtml(images: string[]): string {
  if (!images.length) return '';
  const imgTags = images
    .map(
      (_, i) =>
        `<img src="cid:attachment${i + 1}@preacher" alt="Attachment ${i + 1}" style="max-width:480px;max-height:320px;border-radius:4px;margin:4px 0;display:block;" />`
    )
    .join('\n');
  return `<p><strong>Attachments:</strong></p>\n${imgTags}`;
}

/**
 * Converts Base64 data URLs to nodemailer inline attachments with CID references.
 */
const DIAGNOSTICS_FILENAME = 'technical-details.json';

/**
 * One line about the attached report, for the body of the letter: version, page, device, what waited
 * to be sent. Only short plain values — the report came from a browser and is not trusted as text.
 */
const plainValue = (value: unknown) => (typeof value === 'string' && /^[\w./:-]{1,80}$/.test(value) ? value : null);

const DEVICES: [RegExp, string][] = [[/iPhone/, 'iPhone'], [/Android/, 'Android'], [/Macintosh/, 'Mac'], [/Windows/, 'Windows']];

function deviceOf(environment: Record<string, unknown>): string | null {
  const agent = typeof environment.userAgent === 'string' ? environment.userAgent : '';
  const touchPoints = typeof environment.maxTouchPoints === 'number' && Number.isFinite(environment.maxTouchPoints)
    ? environment.maxTouchPoints : 0;
  const device = isIPadDevice(agent, touchPoints) ? 'iPad' : DEVICES.find(([pattern]) => pattern.test(agent))?.[1];
  if (!device) return null;
  return environment.standalone === true ? `${device} (installed app)` : device;
}

function silentStorageCount(report: Record<string, unknown>): number {
  const silent = (report.storage as { silent?: unknown } | undefined)?.silent;
  return Array.isArray(silent) ? silent.length : 0;
}

/**
 * The tab's version, and the server's beside it when they differ: a tab open across a deploy runs old code
 * against new rules (BUG-20261107-outdated-tab-refusal-unexplained). The server knows its own build, so the
 * person's send path makes no extra request for it.
 */
function versionLine(running: string | null): string | null {
  if (!running) return null;
  const served = plainValue(process.env.NEXT_PUBLIC_APP_VERSION);
  return served && served !== running ? `version ${running} (server serves ${served})` : `version ${running}`;
}

function diagnosticsSummary(report: Record<string, unknown>): string {
  if (report.unavailable === true) return 'the browser did not let the app collect them';
  const version = versionLine(plainValue(report.runningVersion));
  const route = plainValue(report.route);
  const pending = (report.edits as { pending?: unknown } | null | undefined)?.pending;
  const silent = silentStorageCount(report);
  return [
    version,
    route && `page ${route}`,
    deviceOf((report.environment ?? {}) as Record<string, unknown>),
    typeof pending === 'number' && `edits waiting to be sent: ${pending}`,
    silent > 0 && `device storage silent: ${silent}`,
  ].filter(Boolean).join(' · ');
}

function diagnosticsLine(feedbackData: FeedbackData): string | null {
  if (feedbackData.diagnostics) {
    const summary = diagnosticsSummary(feedbackData.diagnostics.report);
    return `Technical details: ${DIAGNOSTICS_FILENAME} attached${summary ? ` — ${summary}` : ''}`;
  }
  if (feedbackData.diagnosticsDropped) return `Technical details: not attached (${feedbackData.diagnosticsDropped})`;
  return null;
}

function buildAttachments(images: string[]) {
  return images.map((dataUrl, i) => {
    // dataUrl format: "data:<mime>;base64,<data>"
    const [header, base64Data] = dataUrl.split(',');
    const mimeType = header.replace('data:', '').replace(';base64', '') || 'image/png';
    const ext = mimeType.split('/')[1] || 'png';
    return {
      filename: `attachment${i + 1}.${ext}`,
      content: Buffer.from(base64Data, 'base64'),
      contentType: mimeType,
      cid: `attachment${i + 1}@preacher`,
    };
  });
}

/**
 * Helper function to send email notification
 */
async function sendEmailNotification(
  feedbackData: FeedbackData,
  userEmailVerified: boolean
) {
  console.log(`Starting email notification process for feedback type: ${feedbackData.type}`);

  try {
    // If email credentials are not configured, skip sending email
    if (!ownerMailConfigured()) {
      console.log('Email credentials not configured, skipping email notification');
      return;
    }

    console.log(`Preparing to send email to: ${OWNER_EMAIL}`);
    const { text, type, userId, userEmail, createdAt, images = [] } = feedbackData;
    const escapedText = escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>');
    const technicalLine = diagnosticsLine(feedbackData);
    const reportFile = feedbackData.diagnostics
      // Exactly the checked string: re-formatting a deeply nested report could outgrow the ceiling.
      ? [{ filename: DIAGNOSTICS_FILENAME, content: feedbackData.diagnostics.json, contentType: 'application/json' }]
      : [];
    const displayedUserEmail =
      userEmail !== NOT_PROVIDED && !userEmailVerified
        ? `${userEmail} (unverified)`
        : userEmail;

    // Create a transporter for this specific email
    const transporter = createOwnerMailTransport();

    // Prepare email content
    const emailContent = {
      from: ownerMailFrom(),
      to: OWNER_EMAIL,
      ...(userEmail !== NOT_PROVIDED && { replyTo: userEmail }),
      subject: `New Feedback (${type}) from Preacher Helper`,
      attachments: [...buildAttachments(images), ...reportFile],
      html: `
        <h2>New Feedback Submitted</h2>
        <p><strong>Type:</strong> ${escapeHtml(type)}</p>
        <p><strong>User ID:</strong> ${escapeHtml(userId)}</p>
        <p><strong>User Email:</strong> ${escapeHtml(displayedUserEmail)}</p>
        <p><strong>Time:</strong> ${new Date(createdAt).toLocaleString()}</p>
        <p><strong>Message:</strong></p>
        <blockquote style="border-left: 4px solid #ccc; padding-left: 16px;">
          ${escapedText}
        </blockquote>
        ${technicalLine ? `<p><strong>${escapeHtml(technicalLine)}</strong></p>` : ''}
        ${buildImageHtml(images)}
        <p>You can view all feedback in your Firestore database.</p>
      `,
      text: `
New Feedback Submitted
Type: ${type}
User ID: ${userId}
User Email: ${userEmail}
Time: ${new Date(createdAt).toLocaleString()}
Message:
${text}
${technicalLine ? `\n${technicalLine}` : ''}
${images.length ? `\nAttachments: ${images.length} image(s) attached (view HTML version)` : ''}
      `
    };

    console.log('Sending email with the following details:', {
      to: OWNER_EMAIL,
      subject: emailContent.subject,
      feedbackType: type,
      userId,
      imagesCount: images.length
    });

    // Send the email using promise-based approach
    const info = await transporter.sendMail(emailContent);

    console.log('Email notification sent successfully', {
      messageId: info.messageId,
      response: info.response
    });

    return info;
  } catch (error) {
    console.error('Failed to send email notification:', error);

    // Log specific error details for easier debugging
    if (error instanceof Error) {
      console.error({
        errorName: error.name,
        errorMessage: error.message,
        errorStack: error.stack
      });
    }

    // Rethrow to ensure the caller knows the email failed
    throw error;
  }
}

/**
 * A feedback lives 90 days in the database (owner, 2026-10-10); the letter in the mailbox stays. Once
 * `expiresAt` passes, the next feedback deletes the document (`deleteExpiredFeedback`). A timestamp
 * field also serves Firestore's own TTL, should the project ever be billed.
 */
const FEEDBACK_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** How many expired documents one feedback clears; the next one takes the rest. */
const EXPIRED_FEEDBACK_BATCH = 50;

/**
 * NO TTL WITHOUT BILLING. Firestore's own time-to-live is refused on a project without billing
 * ("403: billing disabled", 2026-10-10), so each new feedback clears the ones whose date has passed.
 * Best effort and after the response: a failed clean-up never costs anyone their feedback.
 */
async function deleteExpiredFeedback(now: Date): Promise<void> {
  try {
    const expired = await adminDb.collection('feedback').where('expiresAt', '<', now).limit(EXPIRED_FEEDBACK_BATCH).get();
    if (expired.empty) return;
    const batch = adminDb.batch();
    expired.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    console.log(`Deleted ${expired.size} expired feedback document(s)`);
  } catch (error) {
    console.error('Expired feedback clean-up failed:', error);
  }
}

/**
 * Stores feedback data in Firestore.
 * IMPORTANT: Images are NOT persisted here (TRIZ: inbox is already persistent).
 * Only imageCount is stored so queries stay fast and documents stay small.
 */
async function storeFeedbackInDatabase(feedbackData: FeedbackData, feedbackId?: string): Promise<{ id: string; created: boolean }> {
  console.log('Storing feedback in Firestore database');
  const feedbackRef = adminDb.collection('feedback');

  // Strip Base64 images — email is the delivery channel, not Firestore
  const { images, diagnostics, ...dataWithoutImages } = feedbackData;
  const docToStore = {
    ...dataWithoutImages,
    // A named feedback records whether its letter left: the letter and its screenshots travel only by
    // mail, so a stored document alone is not proof they arrived (Codex review 2026-11-17).
    ...(feedbackId && { emailed: false }),
    ...(images && images.length > 0 && { imageCount: images.length }),
    // A string, not a nested map: a browser's report can be deeper than Firestore allows or carry a
    // reserved key, and a refused document would cost the person their words.
    ...(diagnostics && { diagnostics: diagnostics.json }),
    expiresAt: new Date(Date.parse(feedbackData.createdAt) + FEEDBACK_RETENTION_MS),
  };

  // A device names its feedback, so a send repeated after a lost answer finds it already stored; an
  // older app sends no name and the database gives one. One creation either way, never an overwrite.
  const ref = feedbackId ? feedbackRef.doc(feedbackId) : feedbackRef.doc();
  try {
    await ref.create(docToStore);
  } catch (error) {
    if (!feedbackId || resolveFirestoreWriteRefusal(error)?.code !== 'already-exists') throw error;
    console.log(`Feedback ${feedbackId} was already stored; not storing or emailing it again`);
    return { id: feedbackId, created: false };
  }
  console.log(`Feedback stored successfully with ID: ${ref.id}`);
  return { id: ref.id, created: true };
}

/** A device-chosen feedback id: one document name, the way `newClientId` makes it. */
const FEEDBACK_ID = /^[A-Za-z0-9_-]{8,128}$/;

/** The device's id for this feedback: undefined when none was sent, null when it cannot name a document. */
function readFeedbackId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' && FEEDBACK_ID.test(value) ? value : null;
}

/** Sends the letter; false when it could not leave now. Unconfigured mail counts as sent: nothing more can be done. */
async function emailFeedback(feedbackData: FeedbackData, userEmailVerified: boolean): Promise<boolean> {
  try {
    await sendEmailNotification(feedbackData, userEmailVerified);
    return true;
  } catch (emailError) {
    console.error('Email sending failed:', emailError);
    return false;
  }
}

/** The letter of a named feedback left; a later repeat of it answers without mailing again. */
const markEmailed = (feedbackId: string) => adminDb.collection('feedback').doc(feedbackId).update({ emailed: true });

const duplicateResponse = (id: string) =>
  NextResponse.json({ success: true, message: 'Feedback already submitted', id, duplicate: true });

/** Stored, but the letter has not left: the device keeps the feedback and sends it again later. No Retry-After — this is not an outage. */
const letterPendingResponse = (id: string) =>
  NextResponse.json({ error: 'Feedback stored; its letter could not be sent yet', code: 'email-pending', id }, { status: 503 });

/** The feedback as stored and mailed: the words exactly as sent, the sender from the verified token. */
function buildFeedbackData({ text, feedbackType, images, identity, diagnostics, userAgent }: {
  text: string; feedbackType: unknown; images: string[]; diagnostics: unknown; userAgent: string | null;
  identity: { uid: string; email?: string | null };
}): FeedbackData {
  const trimmedTokenEmail = typeof identity.email === 'string' ? identity.email.trim() : '';
  const tokenEmail = trimmedTokenEmail || NOT_PROVIDED;
  const resolvedType = resolveFeedbackType(feedbackType);

  console.log('Parsed feedback request:', {
    type: resolvedType,
    userId: identity.uid,
    userEmail: tokenEmail,
    textLength: text.length,
    imagesCount: images.length
  });

  // The words are stored exactly as sent. An older app version that still glues its report under
  // them keeps that text as it was — cutting it apart risked cutting a person's own quoted words
  // (two review rounds), and such versions update themselves within days.
  const report = checkFeedbackDiagnostics(diagnostics);

  return {
    text,
    type: resolvedType,
    userId: identity.uid,
    userEmail: tokenEmail,
    createdAt: new Date().toISOString(),
    status: 'new', // Can be used for tracking feedback status: new, reviewed, addressed, etc.
    userAgent: userAgent || 'unknown',
    ...(images.length > 0 && { images }),
    ...(report.kind === 'ok' && { diagnostics: { json: report.json, report: report.diagnostics } }),
    ...(report.kind === 'dropped' && { diagnosticsDropped: report.reason }),
  };
}

/** Stores a new feedback and mails its letter; a named one is answered as done only once its letter left. */
async function storeAndMail(feedbackData: FeedbackData, feedbackId: string | undefined, userEmailVerified: boolean): Promise<NextResponse> {
  const result = await storeFeedbackInDatabase(feedbackData, feedbackId);
  // Another send of the same feedback stored it a moment ago and has not said its letter left: the
  // device keeps its copy and asks again (Codex review round 2, 2026-11-17).
  if (!result.created) return letterPendingResponse(result.id);
  afterResponse(() => deleteExpiredFeedback(new Date()));

  // Send email notification - ensure it completes before the function returns
  console.log('Triggering email notification');
  const emailed = await emailFeedback(feedbackData, userEmailVerified);
  if (feedbackId) {
    // The device keeps a named feedback until its letter left; an older app's feedback stays as it
    // always was — stored, with the failure logged.
    if (!emailed) return letterPendingResponse(result.id);
    await markEmailed(result.id);
  }

  console.log('Feedback submission completed successfully');
  return NextResponse.json({ success: true, message: 'Feedback submitted successfully', id: result.id });
}

/**
 * A FEEDBACK THE DEVICE SENDS AGAIN FINISHES WHAT THE FIRST SEND LEFT. The device sends a queued
 * feedback until it hears an answer (`utils/feedbackOutbox.ts`), so the same name can arrive after the
 * first send stored it, mailed it, or stopped in between. Already stored and mailed → the same answer
 * again, nothing repeated; stored but not mailed → the letter is sent now, with this send's
 * screenshots. Null when nothing is stored under the name yet.
 */
async function finishStoredFeedback(feedbackId: string, feedbackData: FeedbackData, userEmailVerified: boolean): Promise<NextResponse | null> {
  const ref = adminDb.collection('feedback').doc(feedbackId);
  const stored = await ref.get();
  if (!stored.exists) return null;
  const storedData = stored.data() as { userId?: unknown; emailed?: unknown } | undefined;
  if (storedData?.userId !== feedbackData.userId) {
    return NextResponse.json({ error: 'This feedback belongs to another account', code: 'owner-mismatch' }, { status: 409 });
  }
  if (storedData?.emailed !== false) return duplicateResponse(feedbackId);
  if (!await emailFeedback(feedbackData, userEmailVerified)) return letterPendingResponse(feedbackId);
  await markEmailed(feedbackId);
  return duplicateResponse(feedbackId);
}

/**
 * Handles feedback submission requests
 */
export async function POST(request: NextRequest) {
  console.log('Received new feedback submission request');

  try {
    // Auth: the feedback button lives only in the authenticated nav, so the endpoint must
    // require a token too — a hidden button never protects an open endpoint. Identity comes
    // from the verified token, not a spoofable body field.
    const identity = await getAuthenticatedIdentity(request);
    if (!identity) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawBody = await request.text();
    if (getUtf8ByteLength(rawBody) > MAX_FEEDBACK_PAYLOAD_BYTES) {
      return NextResponse.json({ error: 'Feedback payload is too large' }, { status: 413 });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { feedbackText, feedbackType, images } = body as Record<string, unknown>;
    const feedbackId = readFeedbackId((body as Record<string, unknown>).feedbackId);
    if (feedbackId === null) return NextResponse.json({ error: 'Invalid feedback id' }, { status: 400 });

    if (typeof feedbackText !== 'string' || !feedbackText) {
      console.log('Validation failed: Feedback text is missing');
      return NextResponse.json(
        { error: 'Feedback text is required' },
        { status: 400 }
      );
    }
    if (getUtf8ByteLength(feedbackText) > MAX_FEEDBACK_TEXT_BYTES) {
      return NextResponse.json({ error: 'Feedback text is too large' }, { status: 413 });
    }

    const imageValidation = validateImages(images);
    if (!imageValidation.ok) {
      return NextResponse.json(
        { error: imageValidation.error },
        { status: imageValidation.status }
      );
    }

    const feedbackData = buildFeedbackData({
      text: feedbackText, feedbackType, images: imageValidation.images, identity,
      diagnostics: (body as Record<string, unknown>).diagnostics, userAgent: request.headers.get('user-agent'),
    });

    if (feedbackId) {
      // A queue drained after signing in to another account must not send the first account's words
      // under the second one's name (Codex review 2026-11-17).
      if ((body as Record<string, unknown>).userId !== identity.uid) {
        return NextResponse.json({ error: 'This feedback was written by another account', code: 'owner-mismatch' }, { status: 409 });
      }
      // A repeat is not a new submission: it is answered before the rate limit counts it.
      const finished = await withStore(() => finishStoredFeedback(feedbackId, feedbackData, identity.emailVerified), { write: true });
      if (finished) return finished;
    }

    const rateLimit = await withStore(() => consumeSlidingWindowRateLimit({
      scope: 'feedback',
      key: identity.uid,
      limit: FEEDBACK_RATE_LIMIT_MAX_SUBMISSIONS,
      windowMs: FEEDBACK_RATE_LIMIT_WINDOW_MS,
    }), { write: true });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many feedback submissions. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': Math.ceil(rateLimit.retryAfterMs / 1000).toString(),
          },
        }
      );
    }

    return await storeAndMail(feedbackData, feedbackId, identity.emailVerified);
  } catch (error) {
    if (error instanceof StoreUnavailableError) return storeUnavailableResponse(error);
    console.error('Error submitting feedback:', error);

    // Log detailed error information
    if (error instanceof Error) {
      console.error({
        errorName: error.name,
        errorMessage: error.message,
        errorStack: error.stack
      });
    }

    const refusal = resolveFirestoreWriteRefusal(error);
    if (refusal) {
      return NextResponse.json(
        { error: 'Feedback write was refused', code: refusal.code },
        { status: refusal.status }
      );
    }

    // Return error response
    return NextResponse.json(
      { error: 'Failed to submit feedback' },
      { status: 500 }
    );
  }
}

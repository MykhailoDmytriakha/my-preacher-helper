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
import {
  checkFeedbackDiagnostics,
  getFeedbackImageDecodedSize,
  getUtf8ByteLength,
  MAX_FEEDBACK_IMAGE_BYTES,
  MAX_FEEDBACK_IMAGES,
  MAX_FEEDBACK_PAYLOAD_BYTES,
  MAX_FEEDBACK_TEXT_BYTES,
} from '@/utils/feedbackPayload';

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

const DEVICES: [RegExp, string][] = [[/iPad/, 'iPad'], [/iPhone/, 'iPhone'], [/Android/, 'Android'], [/Macintosh/, 'Mac'], [/Windows/, 'Windows']];

function deviceOf(environment: Record<string, unknown>): string | null {
  const agent = typeof environment.userAgent === 'string' ? environment.userAgent : '';
  const device = DEVICES.find(([pattern]) => pattern.test(agent))?.[1];
  if (!device) return null;
  return environment.standalone === true ? `${device} (installed app)` : device;
}

function silentStorageCount(report: Record<string, unknown>): number {
  const silent = (report.storage as { silent?: unknown } | undefined)?.silent;
  return Array.isArray(silent) ? silent.length : 0;
}

function diagnosticsSummary(report: Record<string, unknown>): string {
  if (report.unavailable === true) return 'the browser did not let the app collect them';
  const version = plainValue(report.runningVersion);
  const route = plainValue(report.route);
  const pending = (report.edits as { pending?: unknown } | null | undefined)?.pending;
  const silent = silentStorageCount(report);
  return [
    version && `version ${version}`,
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
 * Stores feedback data in Firestore.
 * IMPORTANT: Images are NOT persisted here (TRIZ: inbox is already persistent).
 * Only imageCount is stored so queries stay fast and documents stay small.
 */
/**
 * A feedback lives 90 days in the database (owner, 2026-10-10); the letter in the mailbox stays. The
 * Firestore TTL policy on `feedback.expiresAt` deletes the document by itself once this date passes —
 * it must be a timestamp, which a Date becomes through the Admin SDK.
 */
const FEEDBACK_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

async function storeFeedbackInDatabase(feedbackData: FeedbackData) {
  console.log('Storing feedback in Firestore database');
  const feedbackRef = adminDb.collection('feedback');

  // Strip Base64 images — email is the delivery channel, not Firestore
  const { images, diagnostics, ...dataWithoutImages } = feedbackData;
  const docToStore = {
    ...dataWithoutImages,
    ...(images && images.length > 0 && { imageCount: images.length }),
    // A string, not a nested map: a browser's report can be deeper than Firestore allows or carry a
    // reserved key, and a refused document would cost the person their words.
    ...(diagnostics && { diagnostics: diagnostics.json }),
    expiresAt: new Date(Date.parse(feedbackData.createdAt) + FEEDBACK_RETENTION_MS),
  };

  const result = await feedbackRef.add(docToStore);
  console.log(`Feedback stored successfully with ID: ${result.id}`);
  return result;
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

    const rateLimit = await consumeSlidingWindowRateLimit({
      scope: 'feedback',
      key: identity.uid,
      limit: FEEDBACK_RATE_LIMIT_MAX_SUBMISSIONS,
      windowMs: FEEDBACK_RATE_LIMIT_WINDOW_MS,
    });
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

    const trimmedTokenEmail =
      typeof identity.email === 'string' ? identity.email.trim() : '';
    const tokenEmail = trimmedTokenEmail || NOT_PROVIDED;
    const resolvedType = resolveFeedbackType(feedbackType);

    console.log('Parsed feedback request:', {
      type: resolvedType,
      userId: identity.uid,
      userEmail: tokenEmail,
      textLength: typeof feedbackText === 'string' ? feedbackText.length : 0,
      imagesCount: imageValidation.images.length
    });

    // Create a new feedback document
    // The words are stored exactly as sent. An older app version that still glues its report under
    // them keeps that text as it was — cutting it apart risked cutting a person's own quoted words
    // (two review rounds), and such versions update themselves within days.
    const report = checkFeedbackDiagnostics((body as Record<string, unknown>).diagnostics);

    const feedbackData: FeedbackData = {
      text: feedbackText,
      type: resolvedType,
      userId: identity.uid,
      userEmail: tokenEmail,
      createdAt: new Date().toISOString(),
      status: 'new', // Can be used for tracking feedback status: new, reviewed, addressed, etc.
      userAgent: request.headers.get('user-agent') || 'unknown',
      ...(imageValidation.images.length > 0 && { images: imageValidation.images }),
      ...(report.kind === 'ok' && { diagnostics: { json: report.json, report: report.diagnostics } }),
      ...(report.kind === 'dropped' && { diagnosticsDropped: report.reason }),
    };

    // Add the feedback to Firestore
    const result = await storeFeedbackInDatabase(feedbackData);

    // Send email notification - ensure it completes before the function returns
    console.log('Triggering email notification');
    try {
      await sendEmailNotification(feedbackData, identity.emailVerified);
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      // Still proceed with success response as the feedback was stored
    }

    // Return success response
    console.log('Feedback submission completed successfully');
    return NextResponse.json({
      success: true,
      message: 'Feedback submitted successfully',
      id: result.id
    });
  } catch (error) {
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

import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

import { getAuthenticatedIdentity } from '@/api/auth/getAuthenticatedIdentity.server';
import { adminDb } from '@/config/firebaseAdminConfig';
import {
  consumeSlidingWindowRateLimit,
  FEEDBACK_RATE_LIMIT_MAX_SUBMISSIONS,
  FEEDBACK_RATE_LIMIT_WINDOW_MS,
} from '@/services/rateLimit.server';
import {
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
}

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

// Email configuration
const EMAIL_CONFIG: EmailConfig = {
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASSWORD || '',
  },
};

// The owner's email to receive feedback notifications
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'my@gmail.com';
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

function escapeHtml(value: string): string {
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
 * Creates an email transporter with the configured settings
 */
function createTransporter() {
  console.log(`Creating email transporter with host: ${EMAIL_CONFIG.host}, port: ${EMAIL_CONFIG.port}`);
  return nodemailer.createTransport(EMAIL_CONFIG);
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
    if (!EMAIL_CONFIG.auth.user || !EMAIL_CONFIG.auth.pass) {
      console.log('Email credentials not configured, skipping email notification');
      return;
    }

    console.log(`Preparing to send email to: ${OWNER_EMAIL}`);
    const { text, type, userId, userEmail, createdAt, images = [] } = feedbackData;
    const escapedText = escapeHtml(text).replace(/\r\n|\r|\n/g, '<br>');
    const displayedUserEmail =
      userEmail !== NOT_PROVIDED && !userEmailVerified
        ? `${userEmail} (unverified)`
        : userEmail;

    // Create a transporter for this specific email
    const transporter = createTransporter();

    // Prepare email content
    const emailContent = {
      from: `"Preacher Helper" <${EMAIL_CONFIG.auth.user}>`,
      to: OWNER_EMAIL,
      ...(userEmail !== NOT_PROVIDED && { replyTo: userEmail }),
      subject: `New Feedback (${type}) from Preacher Helper`,
      attachments: buildAttachments(images),
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
async function storeFeedbackInDatabase(feedbackData: FeedbackData) {
  console.log('Storing feedback in Firestore database');
  const feedbackRef = adminDb.collection('feedback');

  // Strip Base64 images — email is the delivery channel, not Firestore
  const { images, ...dataWithoutImages } = feedbackData;
  const docToStore = {
    ...dataWithoutImages,
    ...(images && images.length > 0 && { imageCount: images.length }),
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
    const feedbackData: FeedbackData = {
      text: feedbackText,
      type: resolvedType,
      userId: identity.uid,
      userEmail: tokenEmail,
      createdAt: new Date().toISOString(),
      status: 'new', // Can be used for tracking feedback status: new, reviewed, addressed, etc.
      userAgent: request.headers.get('user-agent') || 'unknown',
      ...(imageValidation.images.length > 0 && { images: imageValidation.images }),
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

    // Return error response
    return NextResponse.json(
      { error: 'Failed to submit feedback' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

import { adminDb } from '@/config/firebaseAdminConfig';

// Define types for better code safety
interface FeedbackData {
  text: string;
  type: string;
  userId: string;
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

/**
 * Creates an email transporter with the configured settings
 */
function createTransporter() {
  console.log(`Creating email transporter with host: ${EMAIL_CONFIG.host}, port: ${EMAIL_CONFIG.port}`);
  return nodemailer.createTransport(EMAIL_CONFIG);
}

/**
 * Builds inline image HTML for the email body
 */
function buildImageHtml(images: string[]): string {
  if (!images.length) return '';
  const imgTags = images
    .map(
      (src, i) =>
        `<img src="${src}" alt="Attachment ${i + 1}" style="max-width:480px;max-height:320px;border-radius:4px;margin:4px 0;display:block;" />`
    )
    .join('\n');
  return `<p><strong>Attachments:</strong></p>\n${imgTags}`;
}

/**
 * Helper function to send email notification
 */
async function sendEmailNotification(feedbackData: FeedbackData) {
  console.log(`Starting email notification process for feedback type: ${feedbackData.type}`);

  try {
    // If email credentials are not configured, skip sending email
    if (!EMAIL_CONFIG.auth.user || !EMAIL_CONFIG.auth.pass) {
      console.log('Email credentials not configured, skipping email notification');
      return;
    }

    console.log(`Preparing to send email to: ${OWNER_EMAIL}`);
    const { text, type, userId, createdAt, images = [] } = feedbackData;

    // Create a transporter for this specific email
    const transporter = createTransporter();

    // Prepare email content
    const emailContent = {
      from: `"Preacher Helper" <${EMAIL_CONFIG.auth.user}>`,
      to: OWNER_EMAIL,
      subject: `New Feedback (${type}) from Preacher Helper`,
      html: `
        <h2>New Feedback Submitted</h2>
        <p><strong>Type:</strong> ${type}</p>
        <p><strong>User ID:</strong> ${userId}</p>
        <p><strong>Time:</strong> ${new Date(createdAt).toLocaleString()}</p>
        <p><strong>Message:</strong></p>
        <blockquote style="border-left: 4px solid #ccc; padding-left: 16px;">
          ${text.replace(/\n/g, '<br>')}
        </blockquote>
        ${buildImageHtml(images)}
        <p>You can view all feedback in your Firestore database.</p>
      `,
      text: `
New Feedback Submitted
Type: ${type}
User ID: ${userId}
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
    // Parse the request body
    const body = await request.json();
    const { feedbackText, feedbackType, images, userId = 'anonymous' } = body;

    // Validate images: must be an array of strings, max 3 items
    const validatedImages: string[] = Array.isArray(images)
      ? images.filter((img): img is string => typeof img === 'string').slice(0, 3)
      : [];

    console.log('Parsed feedback request:', {
      type: feedbackType,
      userId,
      textLength: feedbackText?.length || 0,
      imagesCount: validatedImages.length
    });

    // Validate required fields
    if (!feedbackText) {
      console.log('Validation failed: Feedback text is missing');
      return NextResponse.json(
        { error: 'Feedback text is required' },
        { status: 400 }
      );
    }

    // Create a new feedback document
    const feedbackData: FeedbackData = {
      text: feedbackText,
      type: feedbackType || 'other',
      userId,
      createdAt: new Date().toISOString(),
      status: 'new', // Can be used for tracking feedback status: new, reviewed, addressed, etc.
      userAgent: request.headers.get('user-agent') || 'unknown',
      ...(validatedImages.length > 0 && { images: validatedImages }),
    };

    // Add the feedback to Firestore
    const result = await storeFeedbackInDatabase(feedbackData);

    // Send email notification - ensure it completes before the function returns
    console.log('Triggering email notification');
    try {
      await sendEmailNotification(feedbackData);
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
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from 'app/config/firebaseAdminConfig';
import nodemailer from 'nodemailer';

// Define types for better code safety
interface FeedbackData {
  text: string;
  type: string;
  userId: string;
  createdAt: string;
  status: string;
  userAgent: string;
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
    const { text, type, userId, createdAt } = feedbackData;
    
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
        <p>You can view all feedback in your Firestore database.</p>
      `,
      text: `
New Feedback Submitted
Type: ${type}
User ID: ${userId}
Time: ${new Date(createdAt).toLocaleString()}
Message:
${text}
      `
    };
    
    console.log('Sending email with the following details:', {
      to: OWNER_EMAIL,
      subject: emailContent.subject,
      feedbackType: type,
      userId
    });
    
    // Send the email
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
    
    // We don't throw the error here to avoid affecting the feedback submission process
  }
}

/**
 * Stores feedback data in Firestore
 */
async function storeFeedbackInDatabase(feedbackData: FeedbackData) {
  console.log('Storing feedback in Firestore database');
  const feedbackRef = adminDb.collection('feedback');
  const result = await feedbackRef.add(feedbackData);
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
    const { feedbackText, feedbackType, userId = 'anonymous' } = body;
    
    console.log('Parsed feedback request:', {
      type: feedbackType,
      userId,
      textLength: feedbackText?.length || 0
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
    };

    // Add the feedback to Firestore
    const result = await storeFeedbackInDatabase(feedbackData);

    // Send email notification (async - doesn't affect response time)
    console.log('Triggering background email notification');
    sendEmailNotification(feedbackData).catch(err => 
      console.error('Background email sending failed:', err)
    );

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
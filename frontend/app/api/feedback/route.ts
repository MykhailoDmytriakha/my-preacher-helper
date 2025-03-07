import { NextRequest, NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { adminDb } from 'app/config/firebaseAdminConfig';
import nodemailer from 'nodemailer';

// Configure nodemailer with email settings
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASSWORD || '',
  },
});

// The owner's email to receive feedback notifications
const OWNER_EMAIL = process.env.OWNER_EMAIL || 'my@gmail.com';

/**
 * Helper function to send email notification
 */
async function sendEmailNotification(feedbackData: any) {
  try {
    // If email credentials are not configured, skip sending email
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      console.log('Email credentials not configured, skipping email notification');
      return;
    }

    const { text, type, userId, createdAt } = feedbackData;
    
    await transporter.sendMail({
      from: `"Preacher Helper" <${process.env.EMAIL_USER}>`,
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
    });
    
    console.log('Email notification sent successfully');
  } catch (error) {
    console.error('Failed to send email notification:', error);
    // We don't throw the error here to avoid affecting the feedback submission process
  }
}

export async function POST(request: NextRequest) {
  try {
    // Parse the request body
    const { feedbackText, feedbackType, userId = 'anonymous' } = await request.json();

    // Validate required fields
    if (!feedbackText) {
      return NextResponse.json(
        { error: 'Feedback text is required' },
        { status: 400 }
      );
    }
    
    // Create a new feedback document
    const feedbackData = {
      text: feedbackText,
      type: feedbackType || 'other',
      userId,
      createdAt: new Date().toISOString(),
      status: 'new', // Can be used for tracking feedback status: new, reviewed, addressed, etc.
      userAgent: request.headers.get('user-agent') || 'unknown',
    };

    // Add the feedback to Firestore
    const feedbackRef = adminDb.collection('feedback');
    const result = await feedbackRef.add(feedbackData);

    // Send email notification (async - doesn't affect response time)
    sendEmailNotification(feedbackData).catch(err => 
      console.error('Background email sending failed:', err)
    );

    // Return success response
    return NextResponse.json({ 
      success: true, 
      message: 'Feedback submitted successfully',
      id: result.id
    });
  } catch (error) {
    console.error('Error submitting feedback:', error);
    
    // Return error response
    return NextResponse.json(
      { error: 'Failed to submit feedback' },
      { status: 500 }
    );
  }
} 
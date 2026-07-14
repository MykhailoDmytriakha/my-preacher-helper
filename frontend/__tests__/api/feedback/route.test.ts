import { NextRequest } from 'next/server';
import nodemailer from 'nodemailer';
import { getAuthenticatedIdentity } from '@/api/auth/getAuthenticatedIdentity.server';
import { adminDb } from '@/config/firebaseAdminConfig';
import {
    consumeSlidingWindowRateLimit,
    FEEDBACK_RATE_LIMIT_MAX_SUBMISSIONS,
} from '@/services/rateLimit.server';
import {
    getUtf8ByteLength,
    MAX_FEEDBACK_IMAGE_BYTES,
    MAX_FEEDBACK_PAYLOAD_BYTES,
    MAX_FEEDBACK_TEXT_BYTES,
} from '@/utils/feedbackPayload';

// Polyfill Response.json if it doesn't exist in the environment
if (typeof Response.json !== 'function') {
    (Response as any).json = (data: any, init?: ResponseInit) => {
        const res = new Response(JSON.stringify(data), init);
        res.headers.set('Content-Type', 'application/json');
        return res;
    };
}

// Mock dependencies
jest.mock('nodemailer');
const mockAdd = jest.fn().mockResolvedValue({ id: 'new-feedback-id' });
jest.mock('@/config/firebaseAdminConfig', () => ({
    adminDb: {
        collection: jest.fn().mockReturnValue({
            add: (...args: any[]) => mockAdd(...args),
        }),
    },
}));
jest.mock('@/api/auth/getAuthenticatedIdentity.server', () => ({
    getAuthenticatedIdentity: jest.fn(),
}));
jest.mock('@/services/rateLimit.server', () => ({
    consumeSlidingWindowRateLimit: jest.fn(),
    FEEDBACK_RATE_LIMIT_MAX_SUBMISSIONS: 20,
    FEEDBACK_RATE_LIMIT_WINDOW_MS: 60 * 60 * 1000,
}));
const mockGetIdentity = getAuthenticatedIdentity as jest.Mock;
const mockConsumeRateLimit = consumeSlidingWindowRateLimit as jest.Mock;

describe('api/feedback/route', () => {
    let POST: any;
    let mockSendMail: jest.Mock;
    let mockTransporter: any;

    beforeAll(async () => {
        // Set environment variables BEFORE importing the route
        process.env.EMAIL_USER = 'test@example.com';
        process.env.EMAIL_PASSWORD = 'password';
        process.env.OWNER_EMAIL = 'owner@example.com';

        // Use dynamic import after setting env vars
        const route = await import('@/api/feedback/route');
        POST = route.POST;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockAdd.mockReset().mockResolvedValue({ id: 'new-feedback-id' });
        mockGetIdentity.mockResolvedValue({
            uid: 'auth-user-1',
            email: 'verified@example.com',
            emailVerified: true,
        });
        mockConsumeRateLimit.mockResolvedValue({ allowed: true, remaining: 19 });

        // Setup nodemailer mock
        mockSendMail = jest.fn().mockResolvedValue({ messageId: 'msg-id', response: '250 OK' });
        mockTransporter = {
            sendMail: mockSendMail,
        };
        (nodemailer.createTransport as jest.Mock).mockReturnValue(mockTransporter);
    });

    test('POST stores feedback and sends email (TRIZ+IFR validation)', async () => {
        const images = ['data:image/png;base64,aW1nMQ==', 'data:image/png;base64,aW1nMg=='];
        const body = {
            feedbackText: 'Test feedback message',
            feedbackType: 'bug',
            images,
            userId: 'user-123',
        };

        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: JSON.stringify(body),
            headers: {
                'user-agent': 'test-agent',
            },
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(data.id).toBe('new-feedback-id');

        // 1. Verify Firestore storage (TRIZ+IFR: images stripped, imageCount added)
        expect(adminDb.collection).toHaveBeenCalledWith('feedback');
        const storedDoc = (mockAdd).mock.calls[0][0];

        expect(storedDoc.text).toBe('Test feedback message');
        expect(storedDoc.type).toBe('bug');
        expect(storedDoc.userId).toBe('auth-user-1'); // verified caller, not the body-supplied userId
        expect(storedDoc.userEmail).toBe('verified@example.com');
        expect(storedDoc.imageCount).toBe(2);
        expect(storedDoc.images).toBeUndefined(); // Base64 should NOT be in Firestore
        expect(storedDoc.userAgent).toBe('test-agent');

        // 2. Verify Email notification (Images included)
        expect(nodemailer.createTransport).toHaveBeenCalled();
        expect(mockSendMail).toHaveBeenCalled();
        const emailContent = mockSendMail.mock.calls[0][0];

        expect(emailContent.to).toBe('owner@example.com');
        expect(emailContent.replyTo).toBe('verified@example.com');
        expect(emailContent.html).toContain('Test feedback message');
        // Images should be sent as CID attachments, NOT inline data: URIs (Gmail blocks data: URIs)
        expect(emailContent.html).toContain('cid:attachment1@preacher');
        expect(emailContent.html).toContain('cid:attachment2@preacher');
        expect(emailContent.html).not.toContain('data:image/png;base64,aW1nMQ==');
        expect(emailContent.attachments).toHaveLength(2);
        expect(emailContent.attachments[0]).toMatchObject({ cid: 'attachment1@preacher', contentType: 'image/png' });
        expect(emailContent.attachments[1]).toMatchObject({ cid: 'attachment2@preacher', contentType: 'image/png' });
        expect(emailContent.text).toContain('Attachments: 2 image(s)');
    });

    test('POST handles minimal data', async () => {
        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: JSON.stringify({ feedbackText: 'Simple feedback' }),
        });

        const response = await POST(request);
        await response.json();

        expect(response.status).toBe(200);

        const storedDoc = (mockAdd).mock.calls[0][0];
        expect(storedDoc.text).toBe('Simple feedback');
        expect(storedDoc.type).toBe('other');
        expect(storedDoc.userId).toBe('auth-user-1'); // identity from token, never body/anonymous
        expect(storedDoc.imageCount).toBeUndefined();
    });

    test('POST returns 401 when the caller is not authenticated', async () => {
        mockGetIdentity.mockResolvedValueOnce(null);
        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: JSON.stringify({ feedbackText: 'x' }),
        });

        const response = await POST(request);
        expect(response.status).toBe(401);
        expect(mockConsumeRateLimit).not.toHaveBeenCalled();
        expect(mockAdd).not.toHaveBeenCalled();
    });

    test('POST returns 429 for the (N+1)th valid submission without storing or emailing it', async () => {
        let consumed = 0;
        mockConsumeRateLimit.mockImplementation(async () => {
            consumed += 1;
            return consumed <= FEEDBACK_RATE_LIMIT_MAX_SUBMISSIONS
                ? {
                    allowed: true,
                    remaining: FEEDBACK_RATE_LIMIT_MAX_SUBMISSIONS - consumed,
                }
                : { allowed: false, remaining: 0, retryAfterMs: 30_000 };
        });

        for (let requestNumber = 0; requestNumber < FEEDBACK_RATE_LIMIT_MAX_SUBMISSIONS; requestNumber += 1) {
            const allowedResponse = await POST(new NextRequest('http://localhost/api/feedback', {
                method: 'POST',
                body: JSON.stringify({ feedbackText: `Allowed ${requestNumber + 1}` }),
            }));
            expect(allowedResponse.status).toBe(200);
        }

        const rejectedResponse = await POST(new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: JSON.stringify({ feedbackText: 'One too many' }),
        }));
        const rejectedBody = await rejectedResponse.json();

        expect(rejectedResponse.status).toBe(429);
        expect(rejectedResponse.headers.get('retry-after')).toBe('30');
        expect(rejectedBody.error).toMatch(/too many feedback submissions/i);
        expect(mockConsumeRateLimit).toHaveBeenLastCalledWith({
            scope: 'feedback',
            key: 'auth-user-1',
            limit: FEEDBACK_RATE_LIMIT_MAX_SUBMISSIONS,
            windowMs: 60 * 60 * 1000,
        });
        expect(mockAdd).toHaveBeenCalledTimes(FEEDBACK_RATE_LIMIT_MAX_SUBMISSIONS);
        expect(mockSendMail).toHaveBeenCalledTimes(FEEDBACK_RATE_LIMIT_MAX_SUBMISSIONS);
    });

    test('POST returns 400 if feedback text is missing', async () => {
        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: JSON.stringify({ feedbackType: 'bug' }),
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBe('Feedback text is required');
        expect(mockAdd).not.toHaveBeenCalled();
    });

    test('POST proceeds even if email sending fails', async () => {
        mockSendMail.mockRejectedValue(new Error('SMTP error'));

        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: JSON.stringify({ feedbackText: 'Feedback text' }),
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
        expect(mockAdd).toHaveBeenCalled(); // Still stored in DB
    });

    test('POST returns 500 if DB storage fails', async () => {
        mockAdd.mockRejectedValue(new Error('Firestore error'));

        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: JSON.stringify({ feedbackText: 'Feedback text' }),
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe('Failed to submit feedback');
    });

    test('POST escapes all displayed identity and message fields and converts newlines after escaping', async () => {
        mockGetIdentity.mockResolvedValueOnce({
            uid: 'custom<uid>',
            email: 'verified<tag>@example.com',
            emailVerified: true,
        });
        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: JSON.stringify({
                feedbackText: '<script>alert("message")</script>\nnext line',
                feedbackType: 'bug<script>alert("type")</script>',
            }),
        });

        const response = await POST(request);
        expect(response.status).toBe(200);

        const emailContent = mockSendMail.mock.calls[0][0];
        expect(emailContent.html).not.toContain('<script>');
        expect(emailContent.html).toContain('&lt;script&gt;alert(&quot;message&quot;)&lt;/script&gt;<br>next line');
        expect(emailContent.html).toContain('<strong>Type:</strong> other');
        expect(emailContent.html).toContain('custom&lt;uid&gt;');
        expect(emailContent.html).toContain('verified&lt;tag&gt;@example.com');
    });

    test('POST ignores a spoofed body email and uses the verified token email', async () => {
        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: JSON.stringify({
                feedbackText: 'Reply to the verified caller',
                userEmail: 'attacker@example.com',
            }),
        });

        const response = await POST(request);
        expect(response.status).toBe(200);

        const storedDoc = mockAdd.mock.calls[0][0];
        const emailContent = mockSendMail.mock.calls[0][0];
        expect(storedDoc.userEmail).toBe('verified@example.com');
        expect(emailContent.replyTo).toBe('verified@example.com');
        expect(emailContent.html).not.toContain('attacker@example.com');
    });

    test('POST preserves an unverified token email for storage and reply-to and annotates only its HTML display', async () => {
        mockGetIdentity.mockResolvedValueOnce({
            uid: 'auth-user-1',
            email: 'unverified@example.com',
            emailVerified: false,
        });
        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: JSON.stringify({ feedbackText: 'Reply to my account email' }),
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
        const storedDoc = mockAdd.mock.calls[0][0];
        const emailContent = mockSendMail.mock.calls[0][0];
        expect(storedDoc.userEmail).toBe('unverified@example.com');
        expect(emailContent.replyTo).toBe('unverified@example.com');
        expect(emailContent.html).toContain('unverified@example.com (unverified)');
        expect(emailContent.text).toContain('User Email: unverified@example.com');
        expect(emailContent.text).not.toContain('(unverified)');
    });

    test('POST trims a token email even when it is unverified', async () => {
        mockGetIdentity.mockResolvedValueOnce({
            uid: 'auth-user-1',
            email: '  unverified@example.com  ',
            emailVerified: false,
        });
        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: JSON.stringify({ feedbackText: 'Trim my email' }),
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
        expect(mockAdd.mock.calls[0][0].userEmail).toBe('unverified@example.com');
        expect(mockSendMail.mock.calls[0][0].replyTo).toBe('unverified@example.com');
    });

    test('POST falls back to Not provided only when the token has no email', async () => {
        mockGetIdentity.mockResolvedValueOnce({
            uid: 'auth-user-1',
            email: '   ',
            emailVerified: false,
        });
        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: JSON.stringify({ feedbackText: 'No account email' }),
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
        expect(mockAdd.mock.calls[0][0].userEmail).toBe('Not provided');
        expect(mockSendMail.mock.calls[0][0].replyTo).toBeUndefined();
        expect(mockSendMail.mock.calls[0][0].html).toContain('User Email:</strong> Not provided');
    });

    test.each([
        ['unknown', 'feature-request'],
        ['oversized', 'x'.repeat(1_000)],
    ])('POST falls back to a short known type for an %s feedbackType', async (_label, feedbackType) => {
        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: JSON.stringify({ feedbackText: 'Type fallback', feedbackType }),
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
        expect(mockAdd.mock.calls[0][0].type).toBe('other');
        expect(mockSendMail.mock.calls[0][0].subject).toBe(
            'New Feedback (other) from Preacher Helper'
        );
    });

    test.each([
        ['wrong MIME', 'data:image/svg+xml;base64,PHN2Zz4='],
        ['malformed base64', 'data:image/png;base64,%%%'],
    ])('POST rejects an invalid image data URL: %s', async (_label, image) => {
        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: JSON.stringify({ feedbackText: 'Invalid image', images: [image] }),
        });

        const response = await POST(request);
        expect(response.status).toBe(400);
        expect(mockAdd).not.toHaveBeenCalled();
        expect(mockSendMail).not.toHaveBeenCalled();
    });

    test('POST rejects a non-string image entry', async () => {
        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: JSON.stringify({ feedbackText: 'Invalid image', images: [42] }),
        });

        const response = await POST(request);
        expect(response.status).toBe(400);
        expect(mockAdd).not.toHaveBeenCalled();
    });

    test('POST rejects an oversized image using a production-reachable payload', async () => {
        const image = `data:image/png;base64,${Buffer.alloc(MAX_FEEDBACK_IMAGE_BYTES + 1).toString('base64')}`;
        const serializedBody = JSON.stringify({ feedbackText: 'Oversized image', images: [image] });
        expect(getUtf8ByteLength(serializedBody)).toBeLessThan(MAX_FEEDBACK_PAYLOAD_BYTES);

        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: serializedBody,
        });

        const response = await POST(request);
        expect(response.status).toBe(413);
        expect(mockAdd).not.toHaveBeenCalled();
    });

    test('POST rejects a serialized payload above the defensive server cap', async () => {
        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: JSON.stringify({ feedbackText: 'x'.repeat(MAX_FEEDBACK_PAYLOAD_BYTES) }),
        });

        const response = await POST(request);
        expect(response.status).toBe(413);
        expect(mockAdd).not.toHaveBeenCalled();
    });

    test('POST rejects feedback text that would exceed Firestore document limits', async () => {
        const serializedBody = JSON.stringify({
            feedbackText: 'x'.repeat(MAX_FEEDBACK_TEXT_BYTES + 1),
        });
        expect(getUtf8ByteLength(serializedBody)).toBeLessThan(MAX_FEEDBACK_PAYLOAD_BYTES);

        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: serializedBody,
        });

        const response = await POST(request);
        expect(response.status).toBe(413);
        expect(mockAdd).not.toHaveBeenCalled();
    });

    test('POST rejects malformed JSON', async () => {
        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: '{"feedbackText":',
        });

        const response = await POST(request);
        expect(response.status).toBe(400);
        expect(mockAdd).not.toHaveBeenCalled();
    });

    test.each([
        ['null', 'null'],
        ['an array', '[]'],
        ['a primitive', '42'],
    ])('POST returns 400 for %s JSON request body', async (_label, body) => {
        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body,
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBe('Invalid request body');
        expect(mockAdd).not.toHaveBeenCalled();
        expect(mockConsumeRateLimit).not.toHaveBeenCalled();
    });

    test('POST rejects more than 3 images instead of silently truncating them', async () => {
        const body = {
            feedbackText: 'Too many images',
            images: Array.from({ length: 4 }, () => 'data:image/png;base64,eA=='),
        };

        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        const response = await POST(request);
        expect(response.status).toBe(400);
        expect(mockAdd).not.toHaveBeenCalled();
    });
});

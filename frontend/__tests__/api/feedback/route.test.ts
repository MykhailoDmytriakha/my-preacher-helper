import { NextRequest } from 'next/server';
import nodemailer from 'nodemailer';
import { adminDb } from '@/config/firebaseAdminConfig';

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

        // Setup nodemailer mock
        mockSendMail = jest.fn().mockResolvedValue({ messageId: 'msg-id', response: '250 OK' });
        mockTransporter = {
            sendMail: mockSendMail,
        };
        (nodemailer.createTransport as jest.Mock).mockReturnValue(mockTransporter);
    });

    test('POST stores feedback and sends email (TRIZ+IFR validation)', async () => {
        const images = ['data:image/png;base64,img1', 'data:image/png;base64,img2'];
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
        expect(storedDoc.userId).toBe('user-123');
        expect(storedDoc.imageCount).toBe(2);
        expect(storedDoc.images).toBeUndefined(); // Base64 should NOT be in Firestore
        expect(storedDoc.userAgent).toBe('test-agent');

        // 2. Verify Email notification (Images included)
        expect(nodemailer.createTransport).toHaveBeenCalled();
        expect(mockSendMail).toHaveBeenCalled();
        const emailContent = mockSendMail.mock.calls[0][0];

        expect(emailContent.to).toBe('owner@example.com');
        expect(emailContent.html).toContain('Test feedback message');
        expect(emailContent.html).toContain('data:image/png;base64,img1');
        expect(emailContent.html).toContain('data:image/png;base64,img2');
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
        expect(storedDoc.userId).toBe('anonymous');
        expect(storedDoc.imageCount).toBeUndefined();
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

    test('POST validates max 3 images', async () => {
        const body = {
            feedbackText: 'Too many images',
            images: ['img1', 'img2', 'img3', 'img4'],
        };

        const request = new NextRequest('http://localhost/api/feedback', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        await POST(request);

        const storedDoc = (mockAdd).mock.calls[0][0];
        expect(storedDoc.imageCount).toBe(3); // Sliced to 3
    });
});

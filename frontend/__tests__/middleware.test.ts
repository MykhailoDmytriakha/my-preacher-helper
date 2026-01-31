import { NextRequest, NextResponse } from 'next/server';
import { middleware } from '../middleware';

// Mock NextResponse

// Mock NextResponse
// Actually lint said line 3:22.
// Line 3: import { middleware, config } from '../middleware';
// 'config' unused.

// Line 43: const res = middleware(req);
// 'res' assigned but unused.


// Mock NextResponse
jest.mock('next/server', () => {
    const actual = jest.requireActual('next/server');

    const NextResponse = jest.fn((body, init) => ({
        headers: init?.headers || new Headers(),
        status: init?.status || 200,
    }));

    (NextResponse as any).next = jest.fn(() => ({
        headers: new Headers(),
    }));

    (NextResponse as any).json = jest.fn();

    return {
        ...actual,
        NextResponse,
    };
});

describe('Middleware', () => {
    let req: NextRequest;
    let savedCorsEnv: string | undefined;

    beforeEach(() => {
        jest.clearAllMocks();
        savedCorsEnv = process.env.CORS_ALLOWED_ORIGINS;
    });

    afterEach(() => {
        if (savedCorsEnv !== undefined) {
            process.env.CORS_ALLOWED_ORIGINS = savedCorsEnv;
        } else {
            delete process.env.CORS_ALLOWED_ORIGINS;
        }
    });

    const createRequest = (url: string, origin?: string, method = 'GET') => {
        const request = new NextRequest(new URL(url, 'http://localhost:3000'), {
            method,
            headers: origin ? { origin } : undefined,
        });
        return request;
    };

    it('should passthrough for non-api routes', () => {
        req = createRequest('/dashboard');
        middleware(req);
        expect(NextResponse.next).toHaveBeenCalled();
    });

    it('should set CORS headers for allowed origin on API routes', () => {
        delete process.env.CORS_ALLOWED_ORIGINS;
        req = createRequest('/api/sermons', 'http://localhost:3000');
        const res = middleware(req);

        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
        expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, PUT, PATCH, DELETE, OPTIONS');
    });

    it('should NOT set allow-origin if origin is not allowed', () => {
        delete process.env.CORS_ALLOWED_ORIGINS;
        req = createRequest('/api/sermons', 'http://evil.com');
        const res = middleware(req);

        expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    it('should handle OPTIONS preflight request', () => {
        delete process.env.CORS_ALLOWED_ORIGINS;
        req = createRequest('/api/sermons', 'http://localhost:3000', 'OPTIONS');

        // For OPTIONS, middleware returns a new Response (not next())
        const res = middleware(req);

        expect(res.status).toBe(204);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    });

    it('should use DEFAULT_ALLOWED_ORIGINS if env var is missing', () => {
        const originalEnv = process.env.CORS_ALLOWED_ORIGINS;
        delete process.env.CORS_ALLOWED_ORIGINS;

        req = createRequest('/api/sermons', 'https://my-preacher-helper.com');
        const res = middleware(req);

        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://my-preacher-helper.com');

        process.env.CORS_ALLOWED_ORIGINS = originalEnv;
    });

    it('should parse CORS_ALLOWED_ORIGINS from env', () => {
        process.env.CORS_ALLOWED_ORIGINS = 'https://custom-domain.com, https://another.com';

        req = createRequest('/api/sermons', 'https://custom-domain.com');
        const res = middleware(req);
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://custom-domain.com');

        req = createRequest('/api/sermons', 'https://another.com');
        const res2 = middleware(req);
        expect(res2.headers.get('Access-Control-Allow-Origin')).toBe('https://another.com');
    });
});

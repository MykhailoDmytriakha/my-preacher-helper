import {
  getFeedbackImageDecodedSize,
  getFeedbackPayloadByteLength,
  getUtf8ByteLength,
  MAX_FEEDBACK_ATTACHMENT_PAYLOAD_BYTES,
  MAX_FEEDBACK_CLIENT_PAYLOAD_BYTES,
  MAX_FEEDBACK_IMAGE_BYTES,
  MAX_FEEDBACK_IMAGES,
  MAX_FEEDBACK_PAYLOAD_BYTES,
  MAX_FEEDBACK_TEXT_BYTES,
  serializeFeedbackPayload,
} from '@/utils/feedbackPayload';

describe('feedbackPayload', () => {
  it('serializes exactly the client request shape without an email field', () => {
    const serialized = serializeFeedbackPayload({
      feedbackText: 'hello',
      feedbackType: 'bug',
      images: [],
      userId: 'user-1',
    });

    expect(JSON.parse(serialized)).toEqual({
      feedbackText: 'hello',
      feedbackType: 'bug',
      images: [],
      userId: 'user-1',
    });
    expect(serialized).not.toContain('userEmail');
  });

  it('measures the cumulative serialized payload and reserves text headroom for attachments', () => {
    const images = [
      'data:image/png;base64,eA==',
      'data:image/jpeg;base64,eQ==',
    ];
    const payload = {
      feedbackText: '',
      feedbackType: 'suggestion',
      images,
      userId: '',
    };

    expect(getFeedbackPayloadByteLength(payload)).toBe(
      getUtf8ByteLength(serializeFeedbackPayload(payload))
    );
    expect(MAX_FEEDBACK_ATTACHMENT_PAYLOAD_BYTES).toBeLessThan(
      MAX_FEEDBACK_PAYLOAD_BYTES
    );
    expect(MAX_FEEDBACK_ATTACHMENT_PAYLOAD_BYTES).toBeGreaterThan(0);
    expect(MAX_FEEDBACK_CLIENT_PAYLOAD_BYTES).toBeLessThan(
      MAX_FEEDBACK_PAYLOAD_BYTES
    );
  });

  it('measures JSON escaping expansion instead of assuming raw text bytes', () => {
    const feedbackText = '\\'.repeat(100);
    const payload = {
      feedbackText,
      feedbackType: 'bug',
      images: [],
      userId: '',
    };

    expect(getFeedbackPayloadByteLength(payload)).toBeGreaterThan(
      getUtf8ByteLength(feedbackText)
    );
  });

  it.each([
    ['ASCII', 'abc', 3],
    ['two-byte code points', 'Пр', 4],
    ['a surrogate pair', '🙂', 4],
    ['a lone surrogate replacement', '\ud800', 3],
  ])('counts UTF-8 bytes for %s', (_label, value, expected) => {
    expect(getUtf8ByteLength(value)).toBe(expected);
  });

  it.each(['png', 'jpeg', 'webp'])('accepts a valid %s data URL', (mime) => {
    expect(getFeedbackImageDecodedSize(`data:image/${mime};base64,eA==`)).toBe(1);
  });

  it.each([
    'data:image/svg+xml;base64,eA==',
    'data:image/png,raw',
    'data:image/png;base64,%%%',
    'data:image/png;base64,abc',
    'data:image/png;base64,',
  ])('rejects an invalid image data URL: %s', (dataUrl) => {
    expect(getFeedbackImageDecodedSize(dataUrl)).toBeNull();
  });

  it('exposes one reconciled set of bounded limits', () => {
    expect(MAX_FEEDBACK_IMAGES).toBe(3);
    expect(MAX_FEEDBACK_IMAGE_BYTES).toBe(3 * 1024 * 1024);
    expect(MAX_FEEDBACK_TEXT_BYTES).toBe(900_000);
    expect(MAX_FEEDBACK_PAYLOAD_BYTES).toBeLessThan(4_500_000);
  });
});

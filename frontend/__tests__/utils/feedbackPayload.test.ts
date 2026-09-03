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

  it('enforces cumulative attachments and escaped text at the real production limits', () => {
    const attachment = `data:image/png;base64,${'A'.repeat(1_800_000)}`;
    expect(getFeedbackPayloadByteLength({
      feedbackText: '',
      feedbackType: 'suggestion',
      images: [attachment, attachment],
      userId: '',
    })).toBeGreaterThan(MAX_FEEDBACK_ATTACHMENT_PAYLOAD_BYTES);

    const nearBudgetAttachment = `data:image/png;base64,${'A'.repeat(3_300_000)}`;
    expect(getFeedbackPayloadByteLength({
      feedbackText: '\\'.repeat(700_000),
      feedbackType: 'suggestion',
      images: [nearBudgetAttachment],
      userId: '',
    })).toBeGreaterThan(MAX_FEEDBACK_CLIENT_PAYLOAD_BYTES);
    expect(getFeedbackPayloadByteLength({
      feedbackText: 'Fits with the accepted attachment',
      feedbackType: 'suggestion',
      images: [nearBudgetAttachment],
      userId: '',
    })).toBeLessThan(MAX_FEEDBACK_CLIENT_PAYLOAD_BYTES);
  });

  it.each([
    ['ASCII', 'abc', 3],
    ['two-byte code points', 'Пр', 4],
    ['a three-byte BMP code point', '€', 3],
    ['a surrogate pair', '🙂', 4],
    ['a lone surrogate replacement', '\ud800', 3],
    ['a lone low surrogate replacement', '\udc00', 3],
    ['a high surrogate followed by ASCII', '\ud800a', 4],
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

  /**
   * SIZING A BIG IMAGE MUST NOT THROW.
   *
   * The size was measured with a regex that captured the entire base64 body, and on
   * a multi-megabyte attachment V8 ran out of regex stack: `RangeError: Maximum call
   * stack size exceeded at RegExp.exec`. The feedback route caught it and answered
   * 500, so a person attaching a ~3 MB image was told "something went wrong" instead
   * of "the image is too large". It reproduced only on the build machine — the same
   * expression is fine on a bigger stack — which is why the size check no longer
   * runs a regex over the body at all.
   */
  it('measures a multi-megabyte image without blowing up', () => {
    const groups = Math.floor(MAX_FEEDBACK_IMAGE_BYTES / 3) + 1;
    const dataUrl = `data:image/png;base64,${'A'.repeat(groups * 4)}`;

    expect(getFeedbackImageDecodedSize(dataUrl)).toBe(groups * 3);
    expect(getFeedbackImageDecodedSize(dataUrl)).toBeGreaterThan(MAX_FEEDBACK_IMAGE_BYTES);
  });

  it('still rejects a big body that is not base64, wherever the bad character sits', () => {
    const groups = 4096;
    const body = 'A'.repeat(groups * 4);
    const withBadCharAtEnd = `${body.slice(0, -1)}!`;
    const withBadCharInside = `${body.slice(0, 100)}!${body.slice(101)}`;

    expect(getFeedbackImageDecodedSize(`data:image/png;base64,${withBadCharAtEnd}`)).toBeNull();
    expect(getFeedbackImageDecodedSize(`data:image/png;base64,${withBadCharInside}`)).toBeNull();
  });

  it('counts padding, and refuses padding that is not at the end', () => {
    expect(getFeedbackImageDecodedSize('data:image/png;base64,QUJD')).toBe(3);
    expect(getFeedbackImageDecodedSize('data:image/png;base64,QQ==')).toBe(1);
    expect(getFeedbackImageDecodedSize('data:image/png;base64,QUJ=')).toBe(2);
    expect(getFeedbackImageDecodedSize('data:image/png;base64,Q=JD')).toBeNull();
  });

  it('exposes one reconciled set of bounded limits', () => {
    expect(MAX_FEEDBACK_IMAGES).toBe(3);
    expect(MAX_FEEDBACK_IMAGE_BYTES).toBe(3 * 1024 * 1024);
    expect(MAX_FEEDBACK_TEXT_BYTES).toBe(900_000);
    expect(MAX_FEEDBACK_PAYLOAD_BYTES).toBeLessThan(4_500_000);
  });
});

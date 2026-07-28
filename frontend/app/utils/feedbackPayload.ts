export const MAX_FEEDBACK_IMAGES = 3;
export const MAX_FEEDBACK_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_FEEDBACK_TEXT_BYTES = 900_000;

// Leave headroom below Vercel's 4.5 MB request-body limit.
export const MAX_FEEDBACK_PAYLOAD_BYTES = 4_400_000;
const FEEDBACK_PAYLOAD_METADATA_HEADROOM_BYTES = 1_024;
export const MAX_FEEDBACK_CLIENT_PAYLOAD_BYTES =
  MAX_FEEDBACK_PAYLOAD_BYTES - FEEDBACK_PAYLOAD_METADATA_HEADROOM_BYTES;
export const MAX_FEEDBACK_ATTACHMENT_PAYLOAD_BYTES =
  MAX_FEEDBACK_CLIENT_PAYLOAD_BYTES - MAX_FEEDBACK_TEXT_BYTES;

/**
 * Only the HEADER is matched by a regex. Deliberately.
 *
 * The previous pattern captured the whole base64 body — `([A-Za-z0-9+/]+={0,2})$`
 * over a payload that is megabytes long — and V8's regex engine ran out of stack on
 * it. Measured on the Vercel build (2 cores, Node there, not here):
 * `RangeError: Maximum call stack size exceeded at RegExp.exec`, which the feedback
 * route caught and turned into a 500. So a person attaching a ~3 MB image was told
 * "something went wrong" instead of "the image is too large" — and the failure was
 * invisible locally, where the same expression runs fine.
 *
 * The body is therefore scanned by hand below: one pass, no backtracking, no stack.
 */
const FEEDBACK_IMAGE_HEADER_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,/;

/** Base64 alphabet check without a regex — see the note above. */
function isBase64Body(body: string): boolean {
  const length = body.length;
  if (length === 0 || length % 4 !== 0) return false;

  let end = length;
  while (end > 0 && end > length - 2 && body.charCodeAt(end - 1) === 61 /* '=' */) {
    end -= 1;
  }

  for (let i = 0; i < end; i += 1) {
    const code = body.charCodeAt(i);
    const isAlphaNumeric =
      (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
    if (!isAlphaNumeric && code !== 43 /* + */ && code !== 47 /* / */) return false;
  }

  return true;
}

export interface FeedbackRequestPayload {
  feedbackText: string;
  feedbackType: string;
  images: string[];
  userId: string;
}

export function serializeFeedbackPayload(payload: FeedbackRequestPayload): string {
  return JSON.stringify(payload);
}

export function getFeedbackPayloadByteLength(
  payload: FeedbackRequestPayload
): number {
  return getUtf8ByteLength(serializeFeedbackPayload(payload));
}

export function getUtf8ByteLength(value: string): number {
  return new Blob([value]).size;
}

export function getFeedbackImageDecodedSize(dataUrl: string): number | null {
  const header = FEEDBACK_IMAGE_HEADER_PATTERN.exec(dataUrl);
  if (!header) return null;

  const base64 = dataUrl.slice(header[0].length);
  if (!isBase64Body(base64)) return null;

  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

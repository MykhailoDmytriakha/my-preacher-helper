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

const FEEDBACK_IMAGE_DATA_URL_PATTERN =
  /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

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
  const match = FEEDBACK_IMAGE_DATA_URL_PATTERN.exec(dataUrl);
  if (!match) return null;

  const base64 = match[2];
  if (!base64 || base64.length % 4 !== 0) return null;

  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

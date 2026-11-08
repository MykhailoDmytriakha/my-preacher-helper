export const TRANSCRIPTION_RETRY_HEADER = 'x-transcription-retry';

/** The retry decision survives an interruption while the browser reads the JSON body. */
export function transcriptionResponseInit(status: number, retryable?: boolean): ResponseInit {
  return retryable === false
    ? { status, headers: { [TRANSCRIPTION_RETRY_HEADER]: 'false' } }
    : { status };
}

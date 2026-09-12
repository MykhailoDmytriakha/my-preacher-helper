/**
 * Backwards-compatible facade for audio file and MediaRecorder utilities.
 */

export {
  getExtensionFromMimeType,
  validateAudioBlob,
  detectActualFormat,
  hasKnownIssues,
  getFormatRecommendation,
  createAudioFile,
  logAudioInfo,
  buildRecordingFilename,
} from '@/utils/audioFileUtils';
export {
  getBestSupportedFormat,
  getAllSupportedFormats,
  createConfiguredMediaRecorder,
} from '@/utils/mediaRecorderUtils';
export type { MediaRecorderConfig } from '@/utils/mediaRecorderUtils';
export { downloadBlobToDevice } from '@/utils/download';

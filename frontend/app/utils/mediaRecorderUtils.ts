/**
 * Audio Format Utilities for OpenAI Transcription Compatibility
 */

import { AUDIO_MIME_PREFIX, DEFAULT_AUDIO_FORMAT } from '@/utils/audioFileUtils';

// Types for MediaRecorder configuration
export interface MediaRecorderConfig {
  onDataAvailable: (event: BlobEvent) => void;
  onStop: () => Promise<void>;
  onError: () => void;
}

/**
 * Format priority for MediaRecorder selection
 * Ordered by OpenAI compatibility (best to worst)
 * 
 * CRITICAL NOTE: audio/mp4 is first in the list, BUT getBestSupportedFormat() 
 * will automatically skip it on macOS/iOS due to a system-wide MediaRecorder bug
 * where browsers claim MP4 support but actually record WebM+Opus with wrong MIME type.
 * 
 * This affects ALL browsers on macOS (Chrome, Safari, Firefox).
 */
const FORMAT_PRIORITY = [
  AUDIO_MIME_PREFIX + 'mp4',                    // Best compatibility - but SKIPPED on macOS/iOS
  AUDIO_MIME_PREFIX + 'mpeg',                   // MP3, excellent compatibility
  AUDIO_MIME_PREFIX + 'wav',                    // Uncompressed, reliable
  AUDIO_MIME_PREFIX + 'ogg',                    // Ogg Vorbis, good compatibility
  AUDIO_MIME_PREFIX + 'webm;codecs=vorbis',     // WebM with Vorbis (better than Opus)
  AUDIO_MIME_PREFIX + 'webm',                   // WebM without codec specification (may use Opus!)
  AUDIO_MIME_PREFIX + 'webm;codecs=opus'        // Last resort - known issues with OpenAI
] as const;

/**
 * Detect if browser/platform is known to lie about MP4 support
 *
 * CRITICAL FINDINGS:
 * 1. macOS: ALL browsers (Chrome, Safari, Firefox) claim MP4 support but produce WebM+Opus
 * 2. iOS: WebKit MediaRecorder limitations affect all browsers
 * 3. Android: MediaRecorder claims MP4 support but produces WebM containers with wrong MIME type
 *
 * Root cause: Platform-level MediaRecorder bugs where browsers claim MP4 support
 * but actually record in incompatible containers with mismatched MIME types.
 */
function isBrowserWithMP4Issues(): boolean {
  if (typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent.toLowerCase();
  const isMac = /mac os/.test(ua);
  const isAndroid = /android/.test(ua);

  // CRITICAL: On macOS, ALL browsers (Chrome, Safari, Firefox) have this issue
  // They claim to support audio/mp4 but actually record WebM+Opus
  if (isMac) {
    console.log('🍎 macOS detected - will skip audio/mp4 due to known MediaRecorder bugs across all browsers');
    return true;
  }

  // Also check for iOS (same WebKit issues)
  const isIOS = /iphone|ipad|ipod/.test(ua);
  if (isIOS) {
    console.log('📱 iOS detected - will skip audio/mp4 due to WebKit MediaRecorder limitations');
    return true;
  }

  // CRITICAL: Android MediaRecorder claims audio/mp4 support but produces WebM containers
  // This causes "Audio file might be corrupted or unsupported" errors with OpenAI
  if (isAndroid) {
    console.log('🤖 Android detected - will skip audio/mp4 due to MediaRecorder MIME type mismatch bug');
    return true;
  }

  return false;
}

/**
 * Get best supported format for current browser
 *
 * IMPORTANT: Automatically skips audio/mp4 on problematic platforms:
 * - macOS: System-wide MediaRecorder bug affects ALL browsers (Chrome, Safari, Firefox)
 * - iOS: WebKit MediaRecorder limitations affect all browsers
 * - Android: MediaRecorder MIME type mismatch bug produces WebM in MP4 containers
 */
export function getBestSupportedFormat(): string {
  if (typeof MediaRecorder === 'undefined') {
    return DEFAULT_AUDIO_FORMAT; // Default fallback
  }
  
  // Skip MP4 on macOS/iOS - system-wide MediaRecorder bug, not browser-specific
  const skipMP4 = isBrowserWithMP4Issues();
  
  for (const format of FORMAT_PRIORITY) {
    // Skip audio/mp4 on macOS/iOS (affects ALL browsers)
    if (skipMP4 && format === 'audio/mp4') {
      console.log('⚠️ Skipping audio/mp4 format due to macOS/iOS MediaRecorder bug (affects all browsers)');
      continue;
    }
    
    if (MediaRecorder.isTypeSupported(format)) {
      return format;
    }
  }
  
  return DEFAULT_AUDIO_FORMAT; // Fallback
}

/**
 * Get all supported formats by current browser
 */
export function getAllSupportedFormats(): string[] {
  if (typeof MediaRecorder === 'undefined') {
    return [];
  }
  
  return FORMAT_PRIORITY.filter(format => 
    MediaRecorder.isTypeSupported(format)
  );
}

/**
 * Creates and configures a MediaRecorder with proper event handlers
 *
 * This function encapsulates the complex MediaRecorder setup logic to reduce
 * cognitive complexity in components that use audio recording.
 */
export function createConfiguredMediaRecorder(
  stream: MediaStream,
  mimeType: string,
  onDataAvailable: (event: BlobEvent) => void,
  onStop: () => Promise<void>,
  onError: () => void
): MediaRecorder {
  const mediaRecorder = new MediaRecorder(stream, { mimeType });

  mediaRecorder.ondataavailable = onDataAvailable;
  mediaRecorder.onstop = onStop;
  mediaRecorder.onerror = onError;

  return mediaRecorder;
}

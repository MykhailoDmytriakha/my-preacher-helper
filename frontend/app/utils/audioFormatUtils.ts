/**
 * Audio Format Utilities for OpenAI Transcription Compatibility
 * 
 * This module provides utilities to detect, validate, and convert audio formats
 * to ensure maximum compatibility with OpenAI's transcription API.
 */

/**
 * Supported audio formats by OpenAI API
 * Source: OpenAI documentation
 */
export const OPENAI_SUPPORTED_FORMATS = [
  'audio/flac',
  'audio/m4a',
  'audio/mp3',
  'audio/mp4',
  'audio/mpeg',
  'audio/mpga',
  'audio/oga',
  'audio/ogg',
  'audio/wav',
  'audio/webm'
] as const;

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
export const FORMAT_PRIORITY = [
  'audio/mp4',                    // Best compatibility - but SKIPPED on macOS/iOS
  'audio/mpeg',                   // MP3, excellent compatibility
  'audio/wav',                    // Uncompressed, reliable
  'audio/ogg',                    // Ogg Vorbis, good compatibility
  'audio/webm;codecs=vorbis',     // WebM with Vorbis (better than Opus)
  'audio/webm',                   // WebM without codec specification (may use Opus!)
  'audio/webm;codecs=opus'        // Last resort - known issues with OpenAI
] as const;

/**
 * Get file extension from MIME type
 */
export function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'audio/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/webm;codecs=opus': 'webm',
    'audio/webm;codecs=vorbis': 'webm',
    'audio/ogg': 'ogg',
    'audio/ogg;codecs=opus': 'ogg',
    'audio/ogg;codecs=vorbis': 'ogg',
    'audio/oga': 'oga',
    'audio/flac': 'flac',
    'audio/m4a': 'm4a'
  };
  
  // Handle cases with codec specification
  const baseType = mimeType.split(';')[0].trim();
  return mimeToExt[mimeType] || mimeToExt[baseType] || 'webm';
}

/**
 * Validate if audio blob meets minimum requirements
 */
export function validateAudioBlob(blob: Blob): { valid: boolean; error?: string } {
  if (!blob) {
    return { valid: false, error: 'No audio data provided' };
  }
  
  if (blob.size === 0) {
    return { valid: false, error: 'Audio file is empty' };
  }
  
  // Minimum size check (1KB)
  if (blob.size < 1000) {
    return { valid: false, error: 'Audio file is too small (less than 1KB)' };
  }
  
  // Maximum size check (25MB - OpenAI limit)
  const MAX_SIZE = 25 * 1024 * 1024;
  if (blob.size > MAX_SIZE) {
    return { valid: false, error: 'Audio file is too large (exceeds 25MB)' };
  }
  
  return { valid: true };
}

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
    return 'audio/webm'; // Default fallback
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
  
  return 'audio/webm'; // Fallback
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
 * Detect actual file format by reading magic bytes
 * @param blob The audio blob to check
 * @returns Promise with detected format or null if unknown
 */
export async function detectActualFormat(blob: Blob): Promise<string | null> {
  try {
    // Read first 12 bytes to check file signature
    const arrayBuffer = await blob.slice(0, 12).arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    // WebM signature: 0x1A 0x45 0xDF 0xA3
    if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) {
      return 'webm';
    }
    
    // MP4/M4A signature: starts with ftyp box
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
      return 'mp4';
    }
    
    // WAV signature: "RIFF....WAVE"
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) {
      return 'wav';
    }
    
    // Ogg signature: "OggS"
    if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
      return 'ogg';
    }
    
    return null;
  } catch (error) {
    console.error('Failed to detect audio format:', error);
    return null;
  }
}

/**
 * Check if format is known to have issues with OpenAI
 */
export function hasKnownIssues(mimeType: string): boolean {
  // WebM with Opus codec is known to cause issues
  const hasOpusCodec = mimeType.toLowerCase().includes('opus');
  
  // audio/mp4;codecs=opus is definitely problematic (likely misidentified WebM)
  const claimsMp4WithOpus = mimeType.toLowerCase().includes('mp4') && hasOpusCodec;
  
  return hasOpusCodec || claimsMp4WithOpus;
}

/**
 * Get format recommendation message
 */
export function getFormatRecommendation(mimeType: string): string | null {
  if (hasKnownIssues(mimeType)) {
    return 'Warning: This audio format may have compatibility issues with transcription. Consider using MP3 or MP4 format.';
  }
  return null;
}

/**
 * Create a properly named File object from Blob
 */
export function createAudioFile(blob: Blob, mimeType?: string): File {
  const finalMimeType = mimeType || blob.type || 'audio/webm';
  const extension = getExtensionFromMimeType(finalMimeType);
  const filename = `recording.${extension}`;
  
  return new File([blob], filename, { type: finalMimeType });
}

/**
 * Log audio format information for debugging
 */
export async function logAudioInfo(blob: Blob, context: string = 'Audio'): Promise<void> {
  const actualFormat = await detectActualFormat(blob);
  const declaredFormat = blob.type.split(';')[0].replace('audio/', '');
  const hasFormatMismatch = actualFormat && declaredFormat !== actualFormat && 
                            !declaredFormat.includes(actualFormat);
  
  console.log(`[${context}] Format Info:`, {
    mimeType: blob.type,
    declaredFormat,
    actualFormat: actualFormat || 'unknown',
    formatMismatch: hasFormatMismatch ? '⚠️ MISMATCH DETECTED!' : 'OK',
    size: blob.size,
    sizeKB: (blob.size / 1024).toFixed(2),
    sizeMB: (blob.size / (1024 * 1024)).toFixed(2),
    hasKnownIssues: hasKnownIssues(blob.type),
    recommendation: getFormatRecommendation(blob.type)
  });
  
  if (hasFormatMismatch) {
    console.error(`❌ FORMAT MISMATCH: Browser claims "${blob.type}" but file is actually "${actualFormat}"`);
    console.error(`❌ This is a browser bug - MediaRecorder lied about the format it produced`);
  }
}


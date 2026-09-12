/**
 * Audio Format Utilities for OpenAI Transcription Compatibility
 *
 * This module provides utilities to detect, validate, and convert audio formats
 * to ensure maximum compatibility with OpenAI's transcription API.
 */

// Constants for repeated strings
export const AUDIO_MIME_PREFIX = 'audio/';
export const DEFAULT_AUDIO_FORMAT = AUDIO_MIME_PREFIX + 'webm';

/**
 * Get file extension from MIME type
 */
export function getExtensionFromMimeType(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    [AUDIO_MIME_PREFIX + 'mp4']: 'mp4',
    [AUDIO_MIME_PREFIX + 'mpeg']: 'mp3',
    [AUDIO_MIME_PREFIX + 'mp3']: 'mp3',
    [AUDIO_MIME_PREFIX + 'wav']: 'wav',
    [AUDIO_MIME_PREFIX + 'webm']: 'webm',
    [AUDIO_MIME_PREFIX + 'webm;codecs=opus']: 'webm',
    [AUDIO_MIME_PREFIX + 'webm;codecs=vorbis']: 'webm',
    [AUDIO_MIME_PREFIX + 'ogg']: 'ogg',
    [AUDIO_MIME_PREFIX + 'ogg;codecs=opus']: 'ogg',
    [AUDIO_MIME_PREFIX + 'ogg;codecs=vorbis']: 'ogg',
    [AUDIO_MIME_PREFIX + 'oga']: 'oga',
    [AUDIO_MIME_PREFIX + 'flac']: 'flac',
    [AUDIO_MIME_PREFIX + 'm4a']: 'm4a'
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
  const finalMimeType = mimeType || blob.type || DEFAULT_AUDIO_FORMAT;
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

/**
 * Build a sensible download filename for a recorded blob
 * e.g. recording-1720099200000.webm
 */
export function buildRecordingFilename(mimeType: string): string {
  const extension = getExtensionFromMimeType(mimeType || DEFAULT_AUDIO_FORMAT);
  return `recording-${Date.now()}.${extension}`;
}

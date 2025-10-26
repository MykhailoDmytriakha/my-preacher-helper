import {
  getBestSupportedFormat,
  getAllSupportedFormats,
  hasKnownIssues,
  getExtensionFromMimeType,
  validateAudioBlob,
  detectActualFormat,
  createAudioFile,
  getFormatRecommendation,
} from '@/utils/audioFormatUtils';

describe('audioFormatUtils', () => {
  describe('getExtensionFromMimeType', () => {
    it('should return correct extension for common formats', () => {
      expect(getExtensionFromMimeType('audio/mp4')).toBe('mp4');
      expect(getExtensionFromMimeType('audio/mpeg')).toBe('mp3');
      expect(getExtensionFromMimeType('audio/mp3')).toBe('mp3');
      expect(getExtensionFromMimeType('audio/wav')).toBe('wav');
      expect(getExtensionFromMimeType('audio/webm')).toBe('webm');
      expect(getExtensionFromMimeType('audio/ogg')).toBe('ogg');
    });

    it('should handle codec specifications', () => {
      expect(getExtensionFromMimeType('audio/webm;codecs=opus')).toBe('webm');
      expect(getExtensionFromMimeType('audio/webm;codecs=vorbis')).toBe('webm');
      expect(getExtensionFromMimeType('audio/ogg;codecs=opus')).toBe('ogg');
    });

    it('should fallback to webm for unknown formats', () => {
      expect(getExtensionFromMimeType('audio/unknown')).toBe('webm');
      expect(getExtensionFromMimeType('')).toBe('webm');
    });

    it('should strip base type for codec formats', () => {
      expect(getExtensionFromMimeType('audio/mp4;codecs=aac')).toBe('mp4');
    });
  });

  describe('validateAudioBlob', () => {
    it('should reject empty blob', () => {
      const blob = new Blob([], { type: 'audio/webm' });
      const result = validateAudioBlob(blob);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should reject blob smaller than 1KB', () => {
      const blob = new Blob(['a'.repeat(500)], { type: 'audio/webm' });
      const result = validateAudioBlob(blob);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too small');
    });

    it('should accept valid blob size', () => {
      const blob = new Blob(['a'.repeat(2000)], { type: 'audio/webm' });
      const result = validateAudioBlob(blob);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject blob larger than 25MB', () => {
      // Create a blob larger than 25MB (26MB)
      const size = 26 * 1024 * 1024;
      const chunks = [];
      const chunkSize = 1024 * 1024; // 1MB chunks
      for (let i = 0; i < Math.ceil(size / chunkSize); i++) {
        chunks.push('a'.repeat(chunkSize));
      }
      const blob = new Blob(chunks, { type: 'audio/webm' });
      
      const result = validateAudioBlob(blob);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too large');
    });
  });

  describe('hasKnownIssues', () => {
    it('should detect Opus codec issues', () => {
      expect(hasKnownIssues('audio/webm;codecs=opus')).toBe(true);
      expect(hasKnownIssues('audio/ogg;codecs=opus')).toBe(true);
    });

    it('should detect MP4+Opus contradiction', () => {
      expect(hasKnownIssues('audio/mp4;codecs=opus')).toBe(true);
    });

    it('should not flag safe formats', () => {
      expect(hasKnownIssues('audio/mp4')).toBe(false);
      expect(hasKnownIssues('audio/mpeg')).toBe(false);
      expect(hasKnownIssues('audio/wav')).toBe(false);
      expect(hasKnownIssues('audio/webm;codecs=vorbis')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(hasKnownIssues('AUDIO/WEBM;CODECS=OPUS')).toBe(true);
      expect(hasKnownIssues('Audio/Mp4;Codecs=Opus')).toBe(true);
    });
  });

  describe('getFormatRecommendation', () => {
    it('should return warning for problematic formats', () => {
      const recommendation = getFormatRecommendation('audio/webm;codecs=opus');
      expect(recommendation).toContain('compatibility issues');
      expect(recommendation).toContain('MP3 or MP4');
    });

    it('should return null for safe formats', () => {
      expect(getFormatRecommendation('audio/mp4')).toBeNull();
      expect(getFormatRecommendation('audio/mpeg')).toBeNull();
    });
  });

  describe('detectActualFormat', () => {
    // Mock Blob to support arrayBuffer() in tests
    const originalBlob = global.Blob;
    let mockBlob: jest.Mocked<Blob>;

    beforeEach(() => {
      mockBlob = {
        slice: jest.fn(),
        arrayBuffer: jest.fn(),
        size: 1000,
        type: 'audio/webm'
      } as any;

      // Mock Blob constructor
      global.Blob = jest.fn().mockImplementation((parts, options) => {
        const data = new Uint8Array(parts[0] || []);
        const padding = parts[1] || new Uint8Array(0);
        const combined = new Uint8Array(data.length + padding.length);
        combined.set(data);
        combined.set(padding, data.length);

        return {
          slice: jest.fn((start, end) => ({
            arrayBuffer: jest.fn().mockResolvedValue(combined.slice(start, end || combined.length).buffer)
          })),
          arrayBuffer: jest.fn().mockResolvedValue(combined.buffer),
          size: combined.length,
          type: options?.type || 'audio/webm'
        };
      });
    });

    afterEach(() => {
      global.Blob = originalBlob;
    });

    it('should detect WebM format by magic bytes', async () => {
      // WebM signature: 0x1A 0x45 0xDF 0xA3
      const header = new Uint8Array([0x1A, 0x45, 0xDF, 0xA3]);
      const padding = new Uint8Array(100);
      const blob = new Blob([header, padding], { type: 'audio/mp4' }); // Claim MP4 but is WebM

      const format = await detectActualFormat(blob);
      expect(format).toBe('webm');
    });

    it('should detect MP4 format by ftyp box', async () => {
      // MP4 signature: ftyp at offset 4
      const header = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]);
      const padding = new Uint8Array(100);
      const blob = new Blob([header, padding], { type: 'audio/mp4' });

      const format = await detectActualFormat(blob);
      expect(format).toBe('mp4');
    });

    it('should detect WAV format', async () => {
      // WAV signature: "RIFF....WAVE"
      const header = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]);
      const padding = new Uint8Array(100);
      const blob = new Blob([header, padding], { type: 'audio/wav' });

      const format = await detectActualFormat(blob);
      expect(format).toBe('wav');
    });

    it('should detect Ogg format', async () => {
      // Ogg signature: "OggS"
      const header = new Uint8Array([0x4F, 0x67, 0x67, 0x53]);
      const padding = new Uint8Array(100);
      const blob = new Blob([header, padding], { type: 'audio/ogg' });

      const format = await detectActualFormat(blob);
      expect(format).toBe('ogg');
    });

    it('should return null for unknown format', async () => {
      const header = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]);
      const padding = new Uint8Array(100);
      const blob = new Blob([header, padding], { type: 'audio/unknown' });

      const format = await detectActualFormat(blob);
      expect(format).toBeNull();
    });
  });

  describe('createAudioFile', () => {
    it('should create File with correct extension from blob', () => {
      const blob = new Blob(['test'], { type: 'audio/mp4' });
      const file = createAudioFile(blob);
      
      expect(file).toBeInstanceOf(File);
      expect(file.name).toBe('recording.mp4');
      expect(file.type).toBe('audio/mp4');
    });

    it('should handle blob with codec specification', () => {
      const blob = new Blob(['test'], { type: 'audio/webm;codecs=opus' });
      const file = createAudioFile(blob);
      
      expect(file.name).toBe('recording.webm');
      expect(file.type).toBe('audio/webm;codecs=opus');
    });

    it('should override mime type if provided', () => {
      const blob = new Blob(['test'], { type: 'audio/webm' });
      const file = createAudioFile(blob, 'audio/mp3');
      
      expect(file.name).toBe('recording.mp3');
      expect(file.type).toBe('audio/mp3');
    });

    it('should handle blob without type', () => {
      const blob = new Blob(['test']);
      const file = createAudioFile(blob);
      
      expect(file.name).toBe('recording.webm'); // Default fallback
      expect(file.type).toBe('audio/webm');
    });
  });

  describe('getBestSupportedFormat', () => {
    // Mock MediaRecorder
    const mockMediaRecorder = {
      isTypeSupported: jest.fn(),
    };

    beforeEach(() => {
      // Reset mock
      mockMediaRecorder.isTypeSupported.mockReset();
      (global as any).MediaRecorder = mockMediaRecorder;
    });

    afterEach(() => {
      delete (global as any).MediaRecorder;
      delete (global as any).navigator;
    });

    it('should return webm if MediaRecorder is undefined', () => {
      delete (global as any).MediaRecorder;
      expect(getBestSupportedFormat()).toBe('audio/webm');
    });

    it('should skip MP4 on Safari macOS', () => {
      (global as any).navigator = {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15'
      };

      mockMediaRecorder.isTypeSupported.mockImplementation((format: string) => {
        return format === 'audio/mp4' || format === 'audio/webm';
      });

      const format = getBestSupportedFormat();
      
      // Should skip audio/mp4 and return audio/webm
      expect(format).not.toBe('audio/mp4');
      expect(format).toBe('audio/webm');
    });

    it('should skip MP4 on Firefox macOS', () => {
      (global as any).navigator = {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/115.0'
      };

      mockMediaRecorder.isTypeSupported.mockImplementation((format: string) => {
        return format === 'audio/mp4' || format === 'audio/webm';
      });

      const format = getBestSupportedFormat();
      
      expect(format).not.toBe('audio/mp4');
    });

    it('should skip MP4 on Chrome macOS (ARM64)', () => {
      (global as any).navigator = {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.123 Safari/537.36'
      };

      mockMediaRecorder.isTypeSupported.mockImplementation((format: string) => {
        return format === 'audio/mp4' || format === 'audio/webm';
      });

      const format = getBestSupportedFormat();
      
      // CRITICAL: Chrome on macOS ALSO has this bug!
      expect(format).not.toBe('audio/mp4');
      expect(format).toBe('audio/webm');
    });

    it('should use MP4 on Chrome Windows (NOT macOS)', () => {
      (global as any).navigator = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      };

      mockMediaRecorder.isTypeSupported.mockImplementation((format: string) => {
        return format === 'audio/mp4';
      });

      const format = getBestSupportedFormat();
      // On Windows/Linux, MP4 works fine
      expect(format).toBe('audio/mp4');
    });

    it('should return first supported format from priority list', () => {
      (global as any).navigator = {
        userAgent: 'Chrome'
      };

      mockMediaRecorder.isTypeSupported.mockImplementation((format: string) => {
        return format === 'audio/wav';
      });

      const format = getBestSupportedFormat();
      expect(format).toBe('audio/wav');
    });

    it('should fallback to webm if nothing supported', () => {
      (global as any).navigator = {
        userAgent: 'Chrome'
      };

      mockMediaRecorder.isTypeSupported.mockReturnValue(false);

      const format = getBestSupportedFormat();
      expect(format).toBe('audio/webm');
    });
  });

  describe('getAllSupportedFormats', () => {
    const mockMediaRecorder = {
      isTypeSupported: jest.fn(),
    };

    beforeEach(() => {
      mockMediaRecorder.isTypeSupported.mockReset();
      (global as any).MediaRecorder = mockMediaRecorder;
    });

    afterEach(() => {
      delete (global as any).MediaRecorder;
    });

    it('should return empty array if MediaRecorder undefined', () => {
      delete (global as any).MediaRecorder;
      expect(getAllSupportedFormats()).toEqual([]);
    });

    it('should return all supported formats', () => {
      mockMediaRecorder.isTypeSupported.mockImplementation((format: string) => {
        return format === 'audio/mp4' || format === 'audio/webm';
      });

      const formats = getAllSupportedFormats();
      expect(formats).toContain('audio/mp4');
      expect(formats).toContain('audio/webm');
      expect(formats.length).toBeGreaterThan(0);
    });
  });
});


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
    it('covers all mime permutations in one test', () => {
      const cases: Array<{ mime: string; expected: string }> = [
        { mime: 'audio/mp4', expected: 'mp4' },
        { mime: 'audio/mpeg', expected: 'mp3' },
        { mime: 'audio/mp3', expected: 'mp3' },
        { mime: 'audio/wav', expected: 'wav' },
        { mime: 'audio/webm', expected: 'webm' },
        { mime: 'audio/ogg', expected: 'ogg' },
        { mime: 'audio/webm;codecs=opus', expected: 'webm' },
        { mime: 'audio/webm;codecs=vorbis', expected: 'webm' },
        { mime: 'audio/ogg;codecs=opus', expected: 'ogg' },
        { mime: 'audio/mp4;codecs=aac', expected: 'mp4' },
        { mime: 'audio/unknown', expected: 'webm' },
        { mime: '', expected: 'webm' },
      ];

      cases.forEach(({ mime, expected }) => {
        expect(getExtensionFromMimeType(mime)).toBe(expected);
      });
    });
  });

  describe('validateAudioBlob', () => {
    it('runs the entire size matrix once', () => {
      const emptyBlob = new Blob([], { type: 'audio/webm' });
      let result = validateAudioBlob(emptyBlob);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');

      const tinyBlob = new Blob(['a'.repeat(500)], { type: 'audio/webm' });
      result = validateAudioBlob(tinyBlob);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too small');

      const validBlob = new Blob(['a'.repeat(2000)], { type: 'audio/webm' });
      result = validateAudioBlob(validBlob);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();

      const size = 26 * 1024 * 1024;
      const chunkSize = 1024 * 1024;
      const chunks: string[] = [];
      for (let i = 0; i < Math.ceil(size / chunkSize); i++) {
        chunks.push('a'.repeat(chunkSize));
      }
      const oversizedBlob = new Blob(chunks, { type: 'audio/webm' });
      result = validateAudioBlob(oversizedBlob);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too large');
    });
  });

  describe('hasKnownIssues', () => {
    it('evaluates problematic codecs in one sweep', () => {
      const problematic = [
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/mp4;codecs=opus',
        'AUDIO/WEBM;CODECS=OPUS',
        'Audio/Mp4;Codecs=Opus',
      ];
      const safe = ['audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/webm;codecs=vorbis'];

      problematic.forEach((mime) => expect(hasKnownIssues(mime)).toBe(true));
      safe.forEach((mime) => expect(hasKnownIssues(mime)).toBe(false));
    });
  });

  describe('getFormatRecommendation', () => {
    it('handles warnings and safe defaults inside one test', () => {
      const warning = getFormatRecommendation('audio/webm;codecs=opus');
      expect(warning).toContain('compatibility issues');
      expect(warning).toContain('MP3 or MP4');
      expect(getFormatRecommendation('audio/mp4')).toBeNull();
      expect(getFormatRecommendation('audio/mpeg')).toBeNull();
    });
  });

  describe('detectActualFormat', () => {
    // Mock Blob to support arrayBuffer() in tests
    const originalBlob = global.Blob;

    beforeEach(() => {
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

    it('detects all supported formats sequentially', async () => {
      const cases = [
        {
          name: 'webm signature (0x1A45DFA3)',
          header: new Uint8Array([0x1A, 0x45, 0xDF, 0xA3]),
          type: 'audio/mp4',
          expected: 'webm',
        },
        {
          name: 'mp4 ftyp box',
          header: new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]),
          type: 'audio/mp4',
          expected: 'mp4',
        },
        {
          name: 'wav RIFF header',
          header: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45]),
          type: 'audio/wav',
          expected: 'wav',
        },
        {
          name: 'ogg OggS header',
          header: new Uint8Array([0x4F, 0x67, 0x67, 0x53]),
          type: 'audio/ogg',
          expected: 'ogg',
        },
        {
          name: 'unknown format returns null',
          header: new Uint8Array([0xff, 0xff, 0xff, 0xff]),
          type: 'audio/unknown',
          expected: null,
        },
      ]

      const padding = new Uint8Array(100)
      for (const { header, type, expected } of cases) {
        const blob = new Blob([header, padding], { type })
        const format = await detectActualFormat(blob)
        expect(format).toBe(expected)
      }
    })
  });

  describe('createAudioFile', () => {
    it('covers extension overrides in one pass', () => {
      const mp4 = createAudioFile(new Blob(['test'], { type: 'audio/mp4' }));
      expect(mp4).toBeInstanceOf(File);
      expect(mp4.name).toBe('recording.mp4');
      expect(mp4.type).toBe('audio/mp4');

      const codecBlob = createAudioFile(new Blob(['test'], { type: 'audio/webm;codecs=opus' }));
      expect(codecBlob.name).toBe('recording.webm');
      expect(codecBlob.type).toBe('audio/webm;codecs=opus');

      const overridden = createAudioFile(new Blob(['test'], { type: 'audio/webm' }), 'audio/mp3');
      expect(overridden.name).toBe('recording.mp3');
      expect(overridden.type).toBe('audio/mp3');

      const fallback = createAudioFile(new Blob(['test']));
      expect(fallback.name).toBe('recording.webm');
      expect(fallback.type).toBe('audio/webm');
    });
  });

  describe('getBestSupportedFormat', () => {
    // Mock MediaRecorder
    const mockMediaRecorder = {
      isTypeSupported: jest.fn(),
    };

    const resetEnv = () => {
      mockMediaRecorder.isTypeSupported.mockReset();
      (global as any).MediaRecorder = mockMediaRecorder;
      delete (global as any).navigator;
    };

    beforeEach(resetEnv);

    afterEach(() => {
      delete (global as any).MediaRecorder;
      delete (global as any).navigator;
    });

    it('handles platform quirks sequentially', () => {
      delete (global as any).MediaRecorder;
      expect(getBestSupportedFormat()).toBe('audio/webm');

      const safariUA =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15';
      const firefoxUA =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/115.0';
      const chromeMacUA =
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.123 Safari/537.36';
      const chromeWinUA =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      const chromeAndroidUA =
        'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
      const firefoxAndroidUA =
        'Mozilla/5.0 (Android 13; Mobile; rv:109.0) Gecko/109.0 Firefox/120.0';
      const samsungInternetUA =
        'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36';

      const dualSupport = (format: string) => format === 'audio/mp4' || format === 'audio/webm';

      const assertSkipsMp4 = (userAgent: string) => {
        resetEnv();
        (global as any).navigator = { userAgent };
        mockMediaRecorder.isTypeSupported.mockImplementation(dualSupport);
        const format = getBestSupportedFormat();
        expect(format).toBe('audio/webm');
      };

      assertSkipsMp4(safariUA);
      assertSkipsMp4(firefoxUA);
      assertSkipsMp4(chromeMacUA);

      // Test Android devices skip MP4 due to MIME type mismatch bug
      assertSkipsMp4(chromeAndroidUA);
      assertSkipsMp4(firefoxAndroidUA);
      assertSkipsMp4(samsungInternetUA);

      resetEnv();
      (global as any).navigator = { userAgent: chromeWinUA };
      mockMediaRecorder.isTypeSupported.mockImplementation((format: string) => format === 'audio/mp4');
      expect(getBestSupportedFormat()).toBe('audio/mp4');

      resetEnv();
      (global as any).navigator = { userAgent: 'Chrome' };
      mockMediaRecorder.isTypeSupported.mockImplementation((format: string) => format === 'audio/wav');
      expect(getBestSupportedFormat()).toBe('audio/wav');

      resetEnv();
      (global as any).navigator = { userAgent: 'Chrome' };
      mockMediaRecorder.isTypeSupported.mockReturnValue(false);
      expect(getBestSupportedFormat()).toBe('audio/webm');
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

    it('covers undefined environment and supported lists together', () => {
      delete (global as any).MediaRecorder;
      expect(getAllSupportedFormats()).toEqual([]);

      (global as any).MediaRecorder = mockMediaRecorder;
      mockMediaRecorder.isTypeSupported.mockImplementation((format: string) => format === 'audio/mp4' || format === 'audio/webm');
      const formats = getAllSupportedFormats();
      expect(formats).toEqual(expect.arrayContaining(['audio/mp4', 'audio/webm']));
      expect(formats.length).toBeGreaterThan(0);
    });
  });
});

import {
  buildRecordingFilename,
  createAudioFile,
  detectActualFormat,
  getFormatRecommendation,
  getExtensionFromMimeType,
  logAudioInfo,
  validateAudioBlob,
} from '@/utils/audioFileUtils';

describe('audioFileUtils direct module contract', () => {
  it('preserves MIME extension mapping and webm defaults', () => {
    expect(getExtensionFromMimeType('audio/mp4;codecs=aac')).toBe('mp4');
    expect(getExtensionFromMimeType('audio/mpeg')).toBe('mp3');
    expect(getExtensionFromMimeType('audio/unknown')).toBe('webm');
    expect(getExtensionFromMimeType('')).toBe('webm');
    const file = createAudioFile(new Blob(['test']));
    expect(file.name).toBe('recording.webm');
    expect(file.type).toBe('audio/webm');
    expect(getFormatRecommendation('audio/webm;codecs=opus')).toContain('compatibility issues');
  });

  it('builds timestamped filenames with the default extension', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1720099200000);
    expect(buildRecordingFilename('audio/mp4')).toBe('recording-1720099200000.mp4');
    expect(buildRecordingFilename('')).toBe('recording-1720099200000.webm');
    jest.restoreAllMocks();
  });

  it('preserves blob size boundary behavior', () => {
    expect(validateAudioBlob(null as unknown as Blob).valid).toBe(false);
    expect(validateAudioBlob(new Blob()).error).toContain('empty');
    expect(validateAudioBlob(new Blob(['a'.repeat(999)])).error).toContain('too small');
    expect(validateAudioBlob(new Blob(['a'.repeat(1000)])).valid).toBe(true);
    expect(validateAudioBlob({ size: 25 * 1024 * 1024 } as Blob).valid).toBe(true);
    expect(validateAudioBlob({ size: 25 * 1024 * 1024 + 1 } as Blob).error).toContain('too large');
  });

  it('sniffs supported magic byte signatures and unknown data', async () => {
    const cases = [
      [[0x1A, 0x45, 0xDF, 0xA3], 'webm'],
      [[0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70], 'mp4'],
      [[0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45], 'wav'],
      [[0x4F, 0x67, 0x67, 0x53], 'ogg'],
      [[0xFF, 0xFF, 0xFF, 0xFF], null],
    ] as const;

    for (const [header, expected] of cases) {
      const bytes = new Uint8Array([...header, ...new Array(20).fill(0)]);
      const blob = { slice: () => ({ arrayBuffer: async () => bytes.buffer }) } as unknown as Blob;
      await expect(detectActualFormat(blob)).resolves.toBe(expected);
    }
  });

  it('logs mismatches, unknown formats, and read failures', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const webmBytes = new Uint8Array([0x1A, 0x45, 0xDF, 0xA3]);
    const mismatchBlob = {
      type: 'audio/mp4',
      size: 4,
      slice: () => ({ arrayBuffer: async () => webmBytes.buffer }),
    } as unknown as Blob;
    await logAudioInfo(mismatchBlob, 'Mismatch');
    expect(logSpy).toHaveBeenCalledWith('[Mismatch] Format Info:', expect.objectContaining({
      actualFormat: 'webm',
      formatMismatch: '⚠️ MISMATCH DETECTED!',
    }));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('FORMAT MISMATCH'));

    await logAudioInfo({
      type: 'audio/unknown', size: 4,
      slice: () => ({ arrayBuffer: async () => new Uint8Array([0, 0, 0, 0]).buffer }),
    } as unknown as Blob);
    expect(logSpy).toHaveBeenLastCalledWith('[Audio] Format Info:', expect.objectContaining({
      actualFormat: 'unknown', formatMismatch: 'OK',
    }));

    await expect(detectActualFormat({
      slice: () => ({ arrayBuffer: async () => { throw new Error('read failed'); } }),
    } as unknown as Blob)).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith('Failed to detect audio format:', expect.any(Error));
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

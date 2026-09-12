import {
  createConfiguredMediaRecorder,
  getAllSupportedFormats,
  getBestSupportedFormat,
} from '@/utils/mediaRecorderUtils';

describe('mediaRecorderUtils direct module contract', () => {
  const originalMediaRecorder = global.MediaRecorder;
  const originalNavigator = global.navigator;

  afterEach(() => {
    global.MediaRecorder = originalMediaRecorder;
    Object.defineProperty(global, 'navigator', { configurable: true, value: originalNavigator });
  });

  it('returns webm and an empty list when MediaRecorder is unsupported', () => {
    delete (globalThis as any).MediaRecorder;
    expect(getBestSupportedFormat()).toBe('audio/webm');
    expect(getAllSupportedFormats()).toEqual([]);
  });

  it('keeps priority order and skips mp4 on macOS', () => {
    const mock = { isTypeSupported: jest.fn((format: string) => format === 'audio/mp4' || format === 'audio/wav') };
    (globalThis as any).MediaRecorder = mock;
    Object.defineProperty(global, 'navigator', { configurable: true, value: { userAgent: 'Mac OS X' } });
    expect(getBestSupportedFormat()).toBe('audio/wav');
    expect(getAllSupportedFormats()).toEqual(['audio/mp4', 'audio/wav']);
  });

  it('skips mp4 on iOS and Android platforms', () => {
    const mock = { isTypeSupported: jest.fn((format: string) => format === 'audio/mp4' || format === 'audio/wav') };
    (globalThis as any).MediaRecorder = mock;
    for (const userAgent of ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', 'Mozilla/5.0 (Linux; Android 13)']) {
      Object.defineProperty(global, 'navigator', { configurable: true, value: { userAgent } });
      expect(getBestSupportedFormat()).toBe('audio/wav');
    }
  });

  it('falls back to webm when no format is supported', () => {
    (globalThis as any).MediaRecorder = { isTypeSupported: jest.fn(() => false) };
    Object.defineProperty(global, 'navigator', { configurable: true, value: { userAgent: 'Chrome' } });
    expect(getBestSupportedFormat()).toBe('audio/webm');
  });

  it('uses format priority when navigator is unavailable', () => {
    (globalThis as any).MediaRecorder = { isTypeSupported: jest.fn((format: string) => format === 'audio/mp4') };
    delete (globalThis as any).navigator;
    expect(getBestSupportedFormat()).toBe('audio/mp4');
  });

  it('wires MediaRecorder construction and all event handlers', async () => {
    const onDataAvailable = jest.fn();
    const onStop = jest.fn(async () => undefined);
    const onError = jest.fn();
    const recorder = {
      ondataavailable: null,
      onstop: null,
      onerror: null,
    } as unknown as MediaRecorder;
    const constructor = jest.fn(() => recorder);
    (globalThis as any).MediaRecorder = constructor;
    const stream = {} as MediaStream;

    const result = createConfiguredMediaRecorder(stream, 'audio/webm', onDataAvailable, onStop, onError);
    expect(result).toBe(recorder);
    expect(constructor).toHaveBeenCalledWith(stream, { mimeType: 'audio/webm' });
    expect(recorder.ondataavailable).toBe(onDataAvailable);
    expect(recorder.onstop).toBe(onStop);
    expect(recorder.onerror).toBe(onError);
  });
});

import { downloadBlobToDevice } from '@/utils/download';
import { downloadBlobToDevice as downloadRecording } from '@/utils/audioFormatUtils';
import { downloadAudioAsFile } from '@/utils/audioConcat';

beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: jest.fn(() => 'blob:download-proof') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

it.each([['generic', downloadBlobToDevice], ['recording', downloadRecording], ['audio', downloadAudioAsFile]] as const)('downloads the exact blob and filename through the %s entry point', (_name, download) => {
  const blob = new Blob(['Exact content'], { type: 'text/plain' });
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) {
    expect(document.body.contains(this)).toBe(true);
    expect(this.download).toBe('sermon.txt');
    expect(this.href).toBe('blob:download-proof');
  });
  download(blob, 'sermon.txt');
  expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  expect(click).toHaveBeenCalledTimes(1);
  expect(document.querySelector('a[download]')).toBeNull();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1000);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:download-proof');
});

it('cleans both the element and URL when browser navigation throws', () => {
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('Download failed'); });
  expect(() => downloadBlobToDevice(new Blob(['Text']), 'sermon.txt')).toThrow('Download failed');
  expect(document.querySelector('a[download]')).toBeNull();
  jest.advanceTimersByTime(1000);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:download-proof');
});

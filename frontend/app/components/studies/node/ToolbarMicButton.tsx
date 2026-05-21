'use client';

import { Loader2, Mic, MicOff } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { getBestSupportedFormat } from '@/utils/audioFormatUtils';
import { getAudioRecordingDuration } from '@/utils/audioRecorderConfig';
import { ToolbarButton } from '@components/ui/RichMarkdownToolbar';

interface ToolbarMicButtonProps {
  /** Called with the transcribed text once recording + transcription succeeds. */
  onTranscribed: (text: string) => void;
}

type MicState = 'idle' | 'recording' | 'processing';

const WARNING_THRESHOLD_SEC = 10;
const URGENT_THRESHOLD_SEC = 3;
const ROSE_TEXT_CLASS = 'text-rose-600';

function formatRemaining(seconds: number): string {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ToolbarMicButton({ onTranscribed }: ToolbarMicButtonProps) {
  const [state, setState] = useState<MicState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxDuration = getAudioRecordingDuration();

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    clearTimer();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, [clearTimer]);

  useEffect(() => cleanup, [cleanup]);

  const transcribe = useCallback(async (blob: Blob): Promise<void> => {
    setState('processing');
    try {
      const formData = new FormData();
      formData.append('audio', blob);
      const response = await fetch('/api/studies/transcribe', { method: 'POST', body: formData });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Transcription failed');
      const text: string = result.polishedText || result.originalText || '';
      if (text) onTranscribed(text);
    } catch (error) {
      console.error('Voice transcription failed', error);
      toast.error('Не удалось расшифровать запись');
    } finally {
      setState('idle');
      setElapsed(0);
    }
  }, [onTranscribed]);

  const stopRecording = useCallback((): void => {
    clearTimer();
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  }, [clearTimer]);

  const startRecording = useCallback(async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const mimeType = getBestSupportedFormat();
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType });
        cleanup();
        if (blob.size > 0) void transcribe(blob);
      };
      recorder.onerror = () => {
        toast.error('Ошибка записи');
        cleanup();
        setState('idle');
        setElapsed(0);
      };
      recorderRef.current = recorder;
      recorder.start();
      setState('recording');
      setElapsed(0);
      // Hard cap at maxDuration: auto-stop when the user has been recording
      // longer than the configured limit (90s by default). The visible
      // countdown lets them see this coming so an auto-stop never feels
      // arbitrary. Otherwise we'd hit the Whisper 25MB ceiling silently
      // and fail at transcribe time.
      timerRef.current = setInterval(() => {
        setElapsed((prev) => {
          const next = prev + 1;
          if (next >= maxDuration) {
            stopRecording();
          }
          return next;
        });
      }, 1000);
    } catch (error) {
      console.error('Microphone unavailable', error);
      toast.error('Микрофон недоступен');
      cleanup();
      setState('idle');
      setElapsed(0);
    }
  }, [cleanup, transcribe, stopRecording, maxDuration]);

  const handleClick = useCallback((event: React.MouseEvent): void => {
    event.preventDefault();
    if (state === 'idle') void startRecording();
    else if (state === 'recording') stopRecording();
  }, [state, startRecording, stopRecording]);

  const remaining = Math.max(0, maxDuration - elapsed);
  const isWarning = state === 'recording' && remaining <= WARNING_THRESHOLD_SEC && remaining > URGENT_THRESHOLD_SEC;
  const isUrgent = state === 'recording' && remaining <= URGENT_THRESHOLD_SEC;
  const countdownColor = isWarning ? 'text-amber-600' : ROSE_TEXT_CLASS;

  const label = (() => {
    if (state === 'recording') return `Остановить запись (${formatRemaining(remaining)})`;
    if (state === 'processing') return 'Расшифровка…';
    return `Голосовой ввод (до ${formatRemaining(maxDuration)})`;
  })();

  return (
    <ToolbarButton
      onClick={handleClick}
      isActive={state === 'recording'}
      ariaLabel={label}
    >
      {state === 'processing' && <Loader2 className="w-4 h-4 animate-spin" />}
      {state === 'recording' && (
        <span className="flex items-center gap-1">
          <MicOff className={`w-4 h-4 ${ROSE_TEXT_CLASS} ${isUrgent ? 'animate-pulse' : ''}`} />
          <span className={`text-[11px] font-mono font-semibold tabular-nums ${countdownColor}`}>
            {formatRemaining(remaining)}
          </span>
        </span>
      )}
      {state === 'idle' && <Mic className="w-4 h-4" />}
    </ToolbarButton>
  );
}

export default ToolbarMicButton;

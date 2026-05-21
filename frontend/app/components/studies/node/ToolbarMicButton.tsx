'use client';

import { Loader2, Mic, MicOff } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { useMediaRecorder } from '@/hooks/useMediaRecorder';
import { getAudioRecordingDuration } from '@/utils/audioRecorderConfig';
import { ToolbarButton } from '@components/ui/RichMarkdownToolbar';

interface ToolbarMicButtonProps {
  /** Called with the transcribed text once recording + transcription succeeds. */
  onTranscribed: (text: string) => void;
}

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
  const [isTranscribing, setIsTranscribing] = useState(false);
  const maxDuration = getAudioRecordingDuration();

  const transcribe = useCallback(async (blob: Blob): Promise<void> => {
    setIsTranscribing(true);
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
      setIsTranscribing(false);
    }
  }, [onTranscribed]);

  const recorder = useMediaRecorder({
    onComplete: (blob) => { void transcribe(blob); },
    onError: (message) => toast.error(message),
    maxDuration,
  });

  const handleClick = useCallback((event: React.MouseEvent): void => {
    event.preventDefault();
    if (recorder.state === 'idle' && !isTranscribing) void recorder.start();
    else if (recorder.state === 'recording') recorder.stop();
  }, [recorder, isTranscribing]);

  const remaining = Math.max(0, maxDuration - recorder.elapsedSeconds);
  const isRecording = recorder.state === 'recording';
  const isProcessing = isTranscribing || recorder.state === 'stopping';
  const isWarning = isRecording && remaining <= WARNING_THRESHOLD_SEC && remaining > URGENT_THRESHOLD_SEC;
  const isUrgent = isRecording && remaining <= URGENT_THRESHOLD_SEC;
  const countdownColor = isWarning ? 'text-amber-600' : ROSE_TEXT_CLASS;

  const label = (() => {
    if (isRecording) return `Остановить запись (${formatRemaining(remaining)})`;
    if (isProcessing) return 'Расшифровка…';
    return `Голосовой ввод (до ${formatRemaining(maxDuration)})`;
  })();

  return (
    <ToolbarButton onClick={handleClick} isActive={isRecording} ariaLabel={label}>
      {isProcessing && <Loader2 className="w-4 h-4 animate-spin" />}
      {isRecording && (
        <span className="flex items-center gap-1">
          <MicOff className={`w-4 h-4 ${ROSE_TEXT_CLASS} ${isUrgent ? 'animate-pulse' : ''}`} />
          <span className={`text-[11px] font-mono font-semibold tabular-nums ${countdownColor}`}>
            {formatRemaining(remaining)}
          </span>
        </span>
      )}
      {!isRecording && !isProcessing && <Mic className="w-4 h-4" />}
    </ToolbarButton>
  );
}

export default ToolbarMicButton;

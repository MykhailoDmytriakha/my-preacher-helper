"use client";

import { useState, useRef, useEffect } from "react";
import { MicrophoneIcon } from "@components/Icons";

interface AudioRecorderProps {
  onRecordingComplete: (audioBlob: Blob) => void;
  isProcessing?: boolean;
}

export const AudioRecorder = ({
  onRecordingComplete,
  isProcessing = false,
}: AudioRecorderProps) => {
  const [recordingTime, setRecordingTime] = useState(0);
  const [isRecording, setIsRecording] = useState(false);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const chunks = useRef<Blob[]>([]);
  const prevIsProcessing = useRef(isProcessing);
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);

      mediaRecorder.current.ondataavailable = (e) => {
        chunks.current.push(e.data);
      };

      mediaRecorder.current.onstop = () => {
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        onRecordingComplete(blob);
        chunks.current = [];
      };


      mediaRecorder.current.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Error accessing microphone:", error);
      alert("Микрофон не доступен");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current) {

      mediaRecorder.current.stop();
      setIsRecording(false);
      mediaRecorder.current.stream.getTracks().forEach((track) => track.stop());
    }
  };


  useEffect(() => {
    if (isRecording) {

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          if (prev >= 60) {
            stopRecording();
            if (timerRef.current) {

              clearInterval(timerRef.current);
            }
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRecording]);

  useEffect(() => {
    if (prevIsProcessing.current && !isProcessing && !isRecording) {

      setRecordingTime(0);
    }
    prevIsProcessing.current = isProcessing;
  }, [isProcessing, isRecording]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };


  const buttonClass = isProcessing

    ? "bg-blue-600 hover:bg-blue-700 text-white animate-pulse cursor-wait"
    : isRecording
    ? "bg-red-500 hover:bg-red-600 text-white animate-pulse"
    : "bg-green-600 hover:bg-green-700 text-white";

  const buttonText = isProcessing ? (
    "Обработка..."
  ) : isRecording ? (

    <>
      <MicrophoneIcon className="w-5 h-5 shrink-0" fill="white" />
      <span className="flex-1 text-center">Остановить запись</span>
    </>
  ) : (
    <>
      <MicrophoneIcon className="w-5 h-5 shrink-0" fill="white" />
      <span className="flex-1 text-center">Новая запись</span>
    </>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              if (!isProcessing) {
                isRecording ? stopRecording() : startRecording();
              }
            }}
            className={`w-52 px-4 py-2 rounded-lg flex items-center ${buttonClass}`}
            disabled={isProcessing}
          >
            {buttonText}
          </button>
          <div className="text-sm text-gray-600 dark:text-gray-300">
            {formatTime(recordingTime)} / 1:00
          </div>
        </div>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2 dark:bg-gray-700">
        <div
          className="bg-blue-600 h-2 rounded-full"
          style={{ width: `${(recordingTime / 60) * 100}%` }}
        />
      </div>
    </div>
  );
};

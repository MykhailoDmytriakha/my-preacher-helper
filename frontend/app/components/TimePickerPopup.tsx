"use client";

import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import '../time-picker.css';

interface TimePickerPopupProps {
  isOpen: boolean;
  onClose: () => void;
  onSetTimer: (hours: number, minutes: number, seconds: number) => void;
  onStartPreaching: (hours: number, minutes: number, seconds: number) => void;
  initialHours?: number;
  initialMinutes?: number;
  initialSeconds?: number;
  initialDuration?: number; // Alternative way to set initial time in seconds
}

const TimePickerPopup: React.FC<TimePickerPopupProps> = ({
  isOpen,
  onClose,
  onSetTimer,
  onStartPreaching,
  initialHours = 0,
  initialMinutes = 20,
  initialSeconds = 0,
  initialDuration,
}) => {
  const { t } = useTranslation();

  // Convert initialDuration to hours/minutes/seconds if provided
  const getInitialValues = () => {
    if (initialDuration !== undefined) {
      const h = Math.floor(initialDuration / 3600);
      const m = Math.floor((initialDuration % 3600) / 60);
      const s = initialDuration % 60;
      return { hours: h, minutes: m, seconds: s };
    }
    return { hours: initialHours, minutes: initialMinutes, seconds: initialSeconds };
  };

  const [hours, setHours] = useState(getInitialValues().hours);
  const [minutes, setMinutes] = useState(getInitialValues().minutes);
  const [seconds, setSeconds] = useState(getInitialValues().seconds);

  // Update state when initialDuration changes
  useEffect(() => {
    if (initialDuration !== undefined) {
      const h = Math.floor(initialDuration / 3600);
      const m = Math.floor((initialDuration % 3600) / 60);
      const s = initialDuration % 60;
      setHours(h);
      setMinutes(m);
      setSeconds(s);
    }
  }, [initialDuration]);

  const popupRef = useRef<HTMLDivElement>(null);

  // Close popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  const handleSetTimer = () => {
    onSetTimer(hours, minutes, seconds);
    onClose();
  };

  const handleStartPreaching = () => {
    onStartPreaching(hours, minutes, seconds);
    onClose();
  };

  const handlePresetSelect = (presetMinutes: number) => {
    setHours(0);
    setMinutes(presetMinutes);
    setSeconds(0);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div
        ref={popupRef}
        className="time-picker-container shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="time-picker-header">
          <h2 className="time-picker-title">
            {t("plan.timePicker.title") || "Set Timer"}
          </h2>
          <button
            onClick={onClose}
            className="time-picker-close"
          >
            <X className="h-5 w-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Time Picker Wheels */}
        <div className="wheels-container">
          <div className="wheels-row">
            {/* Hours Wheel */}
            <div className="wheel-container">
              <label className="wheel-label">
                {t("plan.timePicker.hours") || "Hours"}
              </label>
              <div className="wheel">
                <div className="wheel-selector"></div>
                <div className="wheel-scroll scrollbar-hide">
                  <div className="wheel-items">
                    {Array.from({ length: 24 }, (_, i) => (
                      <div
                        key={i}
                        className={`time-picker-item ${
                          i === hours ? 'selected' : ''
                        }`}
                        onClick={() => setHours(i)}
                      >
                        {i.toString().padStart(2, '0')}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Minutes Wheel */}
            <div className="wheel-container">
              <label className="wheel-label">
                {t("plan.timePicker.minutes") || "Minutes"}
              </label>
              <div className="wheel">
                <div className="wheel-selector"></div>
                <div className="wheel-scroll scrollbar-hide">
                  <div className="wheel-items">
                    {Array.from({ length: 60 }, (_, i) => (
                      <div
                        key={i}
                        className={`time-picker-item ${
                          i === minutes ? 'selected' : ''
                        }`}
                        onClick={() => setMinutes(i)}
                      >
                        {i.toString().padStart(2, '0')}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Seconds Wheel */}
            <div className="wheel-container">
              <label className="wheel-label">
                {t("plan.timePicker.seconds") || "Seconds"}
              </label>
              <div className="wheel">
                <div className="wheel-selector"></div>
                <div className="wheel-scroll scrollbar-hide">
                  <div className="wheel-items">
                    {Array.from({ length: 60 }, (_, i) => (
                      <div
                        key={i}
                        className={`time-picker-item ${
                          i === seconds ? 'selected' : ''
                        }`}
                        onClick={() => setSeconds(i)}
                      >
                        {i.toString().padStart(2, '0')}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Current Time Display */}
          <div className="time-display">
            <div className="current-time">
              {hours.toString().padStart(2, '0')}:
              {minutes.toString().padStart(2, '0')}:
              {seconds.toString().padStart(2, '0')}
            </div>
            <div className="time-label">
              {t("plan.timePicker.totalTime") || "Total time"}
            </div>
          </div>

          {/* Preset Buttons */}
          <div className="presets-section">
            <div className="presets-label">
              {t("plan.timePicker.presets") || "Quick presets"}
            </div>
            <div className="presets-row">
              {[1, 15, 20, 25, 30].map((preset) => (
                <button
                  key={preset}
                  onClick={() => handlePresetSelect(preset)}
                  className="preset-button px-3 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300"
                  data-testid={`${preset}min-btn`}
                  style={{ minWidth: '60px' }}
                >
                  {preset} {t("plan.timePicker.min") || "min"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="action-buttons">
          <button
            onClick={handleSetTimer}
            className="action-button set-timer-button"
          >
            {t("plan.timePicker.setTimer") || "Set Timer"}
          </button>
          <button
            onClick={handleStartPreaching}
            className="action-button start-preaching-button"
          >
            {t("plan.timePicker.startPreaching") || "Start Preaching"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TimePickerPopup;

'use client';

import { Type } from 'lucide-react';
import React, { useState, useRef, useEffect } from 'react';

import { TextScaleControls } from './TextScaleControls';

interface FloatingTextScaleControlsProps {
  className?: string;
}

const FloatingTextScaleControls: React.FC<FloatingTextScaleControlsProps> = ({
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Показывать кнопку через небольшой delay для smooth entrance
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Закрывать при клике вне компонента
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        modalRef.current &&
        !modalRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Закрывать при нажатии Escape
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const toggleModal = () => {
    setIsOpen(!isOpen);
  };

  return (
    <>
      {/* Floating Action Button */}
      <div className={`fixed bottom-6 right-6 z-50 ${className}`}>
        <button
          ref={buttonRef}
          onClick={toggleModal}
          className={`
            w-14 h-14 rounded-full bg-violet-500/10 hover:bg-violet-600/15
            dark:bg-violet-400/8 dark:hover:bg-violet-500/12
            border-2 border-violet-300 dark:border-violet-300
            text-white shadow-lg transition-all duration-300 ease-out
            hover:shadow-xl hover:scale-110 active:scale-95
            focus:outline-none focus:ring-4 focus:ring-violet-300 dark:focus:ring-violet-800
            flex items-center justify-center group backdrop-blur-sm
            ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}
          `}
          aria-label="Text size controls"
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          title="Adjust text size (A/A+)"
        >
          <Type className="w-6 h-6 transition-transform duration-200 group-hover:scale-110" />
        </button>
      </div>

      {/* Modal Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 animate-in fade-in duration-200"
          aria-hidden="true"
        />
      )}

      {/* Modal Content */}
      {isOpen && (
        <div
          ref={modalRef}
          className={`
            fixed bottom-20 right-6 z-50 bg-white dark:bg-gray-800
            border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl
            p-4 min-w-48 animate-in slide-in-from-bottom-2 fade-in duration-200
            ${className}
          `}
          role="dialog"
          aria-modal="true"
          aria-labelledby="text-scale-title"
        >
          <div className="flex flex-col space-y-3">
            <div className="flex items-center justify-between">
              <h3
                id="text-scale-title"
                className="text-sm font-medium text-gray-900 dark:text-gray-100"
              >
                Text Size
              </h3>
              <button
                onClick={toggleModal}
                className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300
                         transition-colors duration-200 rounded-full p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
                aria-label="Close text size controls"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <TextScaleControls showPercentage={true} />

            <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Adjust text size for better readability
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default FloatingTextScaleControls;

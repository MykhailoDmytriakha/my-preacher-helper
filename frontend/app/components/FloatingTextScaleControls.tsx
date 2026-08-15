'use client';

import { Type } from 'lucide-react';
import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { TextScaleControls } from './TextScaleControls';

interface FloatingTextScaleControlsProps {
  className?: string;
}

const FloatingTextScaleControls: React.FC<FloatingTextScaleControlsProps> = ({
  className = ''
}) => {
  const { t } = useTranslation();
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
      {/* Modal Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 animate-in fade-in duration-200"
          aria-hidden="true"
        />
      )}

      {/*
        THE BUTTON *BECOMES* THE ISLAND — they share one anchor in the corner.
        A panel floating above the button needs a gap, and any gap is a number
        somebody has to justify. Unfolding in place removes the question: press
        "T" and it opens into the capsule from its own right edge, press outside
        and it folds back. One object, two states.

        The island is a capsule, not a window: during a service there is nothing
        here to read, only something to press — so no heading, no hint line, no
        close button. Its width is fixed by construction (every child is
        `shrink-0` with a set size, and the percentage is tabular so 80% and 200%
        measure the same). See BUG-20260814-text-scale-panel-reflows.
      */}
      <div className={`fixed bottom-6 right-4 sm:right-6 z-50 flex justify-end ${className}`}>
        <button
          ref={buttonRef}
          onClick={toggleModal}
          aria-hidden={isOpen}
          tabIndex={isOpen ? -1 : 0}
          className={`
            w-14 h-14 rounded-full bg-violet-500/10 hover:bg-violet-600/15
            dark:bg-violet-400/8 dark:hover:bg-violet-500/12
            border-2 border-violet-300 dark:border-violet-300
            text-white shadow-lg transition-all duration-300 ease-out
            hover:shadow-xl hover:scale-110 active:scale-95
            focus:outline-none focus:ring-4 focus:ring-violet-300 dark:focus:ring-violet-800
            flex items-center justify-center group backdrop-blur-sm
            ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}
            ${isOpen ? 'pointer-events-none scale-75 opacity-0' : ''}
          `}
          aria-label={t('textScale.open')}
          aria-expanded={isOpen}
          aria-haspopup="dialog"
          title={t('textScale.open')}
        >
          <Type className="w-6 h-6 transition-transform duration-200 group-hover:scale-110" />
        </button>

        {isOpen && (
          <div
            ref={modalRef}
            className="
              absolute bottom-0 right-0 origin-bottom-right
              rounded-full border border-gray-200/80 dark:border-white/10
              bg-white/85 dark:bg-gray-900/80 backdrop-blur-xl
              shadow-xl shadow-black/10 dark:shadow-black/50
              p-1.5 animate-in zoom-in-90 fade-in duration-200 ease-out
            "
            role="dialog"
            aria-modal="true"
            aria-label={t('textScale.title')}
          >
            <TextScaleControls showPercentage={true} />
          </div>
        )}
      </div>
    </>
  );
};

export default FloatingTextScaleControls;

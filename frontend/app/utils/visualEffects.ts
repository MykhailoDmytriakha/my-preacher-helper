"use client";

/**
 * Visual Effects Utilities for Preaching Timer
 * Handles screen blinking, text highlighting, and other visual feedback
 */

export interface VisualEffectOptions {
  duration?: number; // Duration in milliseconds
  intensity?: number; // Effect intensity (0-1)
  repeat?: number; // Number of repetitions
  color?: string; // Effect color
  target?: string; // CSS selector for target element
}

/**
 * Screen blinking effect for timer completion
 */
export const triggerScreenBlink = async (options: VisualEffectOptions = {}): Promise<void> => {
  const {
    duration = 500,
    intensity = 0.8,
    repeat = 3,
    color = '#EF4444'
  } = options;

  return new Promise((resolve) => {
    // Create overlay element
    const overlay = document.createElement('div');
    overlay.className = 'screen-blink-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background-color: ${color};
      opacity: 0;
      pointer-events: none;
      z-index: 9999;
      transition: opacity ${duration / 2}ms ease-in-out;
    `;

    document.body.appendChild(overlay);

    let blinkCount = 0;

    const blink = () => {
      if (blinkCount >= repeat) {
        // Remove overlay after final blink
        setTimeout(() => {
          if (overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
          }
          resolve();
        }, duration / 2);
        return;
      }

      // Fade in
      overlay.style.opacity = intensity.toString();

      setTimeout(() => {
        // Fade out
        overlay.style.opacity = '0';

        blinkCount++;
        setTimeout(blink, duration / 2);
      }, duration / 2);
    };

    blink();
  });
};

/**
 * Text highlighting effect for phase transitions
 */
export const triggerTextHighlight = async (
  selector: string,
  options: VisualEffectOptions = {}
): Promise<void> => {
  const {
    duration = 300,
    intensity = 0.6,
    repeat = 4,
    color = '#3B82F6'
  } = options;

  return new Promise((resolve) => {
    const elements = document.querySelectorAll(selector);

    if (elements.length === 0) {
      console.warn(`No elements found for selector: ${selector}`);
      resolve();
      return;
    }

    elements.forEach((element) => {
      const htmlElement = element as HTMLElement;
      const originalBackground = htmlElement.style.backgroundColor;
      const originalTransition = htmlElement.style.transition;

      // Set transition for smooth effect
      htmlElement.style.transition = `background-color ${duration}ms ease-in-out`;

      let highlightCount = 0;

      const highlight = () => {
        if (highlightCount >= repeat) {
          // Restore original styles
          htmlElement.style.backgroundColor = originalBackground;
          htmlElement.style.transition = originalTransition;
          resolve();
          return;
        }

        // Apply highlight color
        htmlElement.style.backgroundColor = color;

        setTimeout(() => {
          // Remove highlight
          htmlElement.style.backgroundColor = originalBackground;

          highlightCount++;
          setTimeout(highlight, duration);
        }, duration);
      };

      highlight();
    });
  });
};

/**
 * Phase transition effect - combines screen blink with text highlighting
 */
export const triggerPhaseTransition = async (
  textSelector: string,
  options: VisualEffectOptions = {}
): Promise<void> => {
  const {
    duration = 200,
    repeat = 3,
    color = '#FCD34D'
  } = options;

  // Trigger text highlighting and screen blink simultaneously
  await Promise.all([
    triggerTextHighlight(textSelector, { duration, repeat, color }),
    triggerScreenBlink({ duration: duration * 2, repeat: Math.ceil(repeat / 2), color })
  ]);
};

/**
 * Emergency alert effect - stronger blinking for critical situations
 */
export const triggerEmergencyAlert = async (
  options: VisualEffectOptions = {}
): Promise<void> => {
  const {
    duration = 1000,
    intensity = 1.0,
    repeat = 5,
    color = '#EF4444'
  } = options;

  await triggerScreenBlink({ duration, intensity, repeat, color });
};

/**
 * Success completion effect - celebratory blinking
 */
export const triggerSuccessEffect = async (
  options: VisualEffectOptions = {}
): Promise<void> => {
  const {
    duration = 300,
    intensity = 0.7,
    repeat = 6,
    color = '#10B981'
  } = options;

  await triggerScreenBlink({ duration, intensity, repeat, color });
};

/**
 * Cancel any ongoing visual effects
 */
export const cancelVisualEffects = (): void => {
  // Remove all blink overlays
  const overlays = document.querySelectorAll('.screen-blink-overlay');
  overlays.forEach((overlay) => {
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  });

  // Reset any highlighted elements
  const highlightedElements = document.querySelectorAll('[style*="background-color"]');
  highlightedElements.forEach((element) => {
    const htmlElement = element as HTMLElement;
    // Only reset if it looks like our highlighting (simple heuristic)
    if (htmlElement.style.backgroundColor &&
        (htmlElement.style.backgroundColor.includes('#') ||
         htmlElement.style.backgroundColor.includes('rgb'))) {
      htmlElement.style.backgroundColor = '';
    }
  });
};

/**
 * Check if visual effects are supported in current environment
 */
export const areVisualEffectsSupported = (): boolean => {
  return typeof document !== 'undefined' &&
         typeof document.createElement === 'function' &&
         typeof document.querySelector === 'function';
};

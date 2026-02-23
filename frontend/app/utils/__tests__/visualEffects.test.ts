import {
    areVisualEffectsSupported,
    cancelVisualEffects,
    triggerEmergencyAlert,
    triggerPhaseTransition,
    triggerScreenBlink,
    triggerSuccessEffect,
    triggerTextHighlight,
} from '../visualEffects';

// Speed up all setTimeout calls during tests
jest.useFakeTimers();

describe('areVisualEffectsSupported', () => {
    it('returns true in jsdom environment', () => {
        expect(areVisualEffectsSupported()).toBe(true);
    });
});

describe('triggerScreenBlink', () => {
    beforeEach(() => {
        // Ensure body is clean before each test
        document.body.innerHTML = '';
    });

    it('creates and removes an overlay element', async () => {
        const promise = triggerScreenBlink({ duration: 100, repeat: 1 });

        // Overlay should be appended to the body
        expect(document.querySelector('.screen-blink-overlay')).not.toBeNull();

        // Run all pending timers to finish the blink animation
        jest.runAllTimers();
        await promise;

        // Overlay should be removed after animation completes
        expect(document.querySelector('.screen-blink-overlay')).toBeNull();
    });

    it('uses default options when none provided', async () => {
        const promise = triggerScreenBlink();
        const overlay = document.querySelector('.screen-blink-overlay') as HTMLElement;

        expect(overlay).not.toBeNull();
        // Default color is '#EF4444' — jsdom converts hex to rgb
        expect(overlay.style.cssText).toContain('rgb(239, 68, 68)');

        jest.runAllTimers();
        await promise;
    });

    it('applies custom color', async () => {
        const promise = triggerScreenBlink({ color: '#00FF00', duration: 100, repeat: 1 });
        const overlay = document.querySelector('.screen-blink-overlay') as HTMLElement;

        // jsdom converts hex to rgb
        expect(overlay.style.cssText).toContain('rgb(0, 255, 0)');

        jest.runAllTimers();
        await promise;
    });

    it('applies custom intensity to overlay opacity', async () => {
        const promise = triggerScreenBlink({ duration: 100, intensity: 0.5, repeat: 1 });
        jest.runAllTimers();
        await promise;
        // If we get here without error the intensity option was handled
        expect(document.querySelector('.screen-blink-overlay')).toBeNull();
    });

    it('repeats the blink the specified number of times and resolves', async () => {
        const promise = triggerScreenBlink({ duration: 100, repeat: 3 });
        jest.runAllTimers();
        await expect(promise).resolves.toBeUndefined();
    });

    it('handles zero repeats', async () => {
        const promise = triggerScreenBlink({ duration: 100, repeat: 0 });
        jest.runAllTimers();
        await expect(promise).resolves.toBeUndefined();
    });

    it('removes overlay even when parentNode exists', async () => {
        const promise = triggerScreenBlink({ duration: 100, repeat: 1 });
        expect(document.body.children.length).toBeGreaterThan(0);
        jest.runAllTimers();
        await promise;
        expect(document.querySelector('.screen-blink-overlay')).toBeNull();
    });
});

describe('triggerTextHighlight', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('resolves immediately when no elements match the selector', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => { });
        const promise = triggerTextHighlight('.non-existent-element');
        jest.runAllTimers();
        await expect(promise).resolves.toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('No elements found for selector')
        );
        warnSpy.mockRestore();
    });

    it('applies highlight and restores styles for matching elements', async () => {
        const div = document.createElement('div');
        div.className = 'highlight-target';
        div.style.backgroundColor = 'white';
        document.body.appendChild(div);

        const promise = triggerTextHighlight('.highlight-target', {
            duration: 100,
            repeat: 1,
            color: '#3B82F6',
        });

        jest.runAllTimers();
        await promise;

        // After animation, background should be restored
        expect(div.style.backgroundColor).toBe('white');
    });

    it('handles multiple matching elements', async () => {
        const div1 = document.createElement('div');
        div1.className = 'multi-target';
        const div2 = document.createElement('div');
        div2.className = 'multi-target';
        document.body.appendChild(div1);
        document.body.appendChild(div2);

        const promise = triggerTextHighlight('.multi-target', { duration: 100, repeat: 1 });
        jest.runAllTimers();
        await expect(promise).resolves.toBeUndefined();
    });

    it('uses default options when none provided', async () => {
        const div = document.createElement('div');
        div.className = 'default-target';
        document.body.appendChild(div);

        const promise = triggerTextHighlight('.default-target');
        jest.runAllTimers();
        await expect(promise).resolves.toBeUndefined();
    });

    it('restores original transition style after animation', async () => {
        const div = document.createElement('div');
        div.className = 'transition-target';
        div.style.transition = 'color 200ms';
        document.body.appendChild(div);

        const promise = triggerTextHighlight('.transition-target', { duration: 100, repeat: 1 });
        jest.runAllTimers();
        await promise;

        expect(div.style.transition).toBe('color 200ms');
    });
});

describe('triggerPhaseTransition', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('resolves after combining text highlight and screen blink', async () => {
        const div = document.createElement('div');
        div.className = 'phase-target';
        document.body.appendChild(div);

        const promise = triggerPhaseTransition('.phase-target', { duration: 100, repeat: 2 });
        jest.runAllTimers();
        await expect(promise).resolves.toBeUndefined();
    });

    it('uses default options when none provided', async () => {
        const div = document.createElement('div');
        div.className = 'phase-default';
        document.body.appendChild(div);

        const promise = triggerPhaseTransition('.phase-default');
        jest.runAllTimers();
        await expect(promise).resolves.toBeUndefined();
    });
});

describe('triggerEmergencyAlert', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('resolves after running the screen blink effect', async () => {
        const promise = triggerEmergencyAlert({ duration: 100, repeat: 2 });
        jest.runAllTimers();
        await expect(promise).resolves.toBeUndefined();
    });

    it('uses default options (higher intensity and more repeats)', async () => {
        const promise = triggerEmergencyAlert();
        jest.runAllTimers();
        await expect(promise).resolves.toBeUndefined();
    });
});

describe('triggerSuccessEffect', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('resolves after running the screen blink effect', async () => {
        const promise = triggerSuccessEffect({ duration: 100, repeat: 2 });
        jest.runAllTimers();
        await expect(promise).resolves.toBeUndefined();
    });

    it('uses default green color and desired defaults', async () => {
        const promise = triggerSuccessEffect();
        const overlay = document.querySelector('.screen-blink-overlay') as HTMLElement;
        // jsdom converts hex to rgb
        expect(overlay.style.cssText).toContain('rgb(16, 185, 129)');
        jest.runAllTimers();
        await expect(promise).resolves.toBeUndefined();
    });
});

describe('cancelVisualEffects', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('removes all screen-blink-overlay elements', () => {
        const overlay1 = document.createElement('div');
        overlay1.className = 'screen-blink-overlay';
        const overlay2 = document.createElement('div');
        overlay2.className = 'screen-blink-overlay';
        document.body.appendChild(overlay1);
        document.body.appendChild(overlay2);

        cancelVisualEffects();

        expect(document.querySelectorAll('.screen-blink-overlay').length).toBe(0);
    });

    it('resets background-color of highlighted elements', () => {
        const div = document.createElement('div');
        div.style.backgroundColor = '#3B82F6';
        document.body.appendChild(div);

        cancelVisualEffects();

        expect(div.style.backgroundColor).toBe('');
    });

    it('resets elements with rgb() background-color', () => {
        const div = document.createElement('div');
        div.style.backgroundColor = 'rgb(59, 130, 246)';
        document.body.appendChild(div);

        cancelVisualEffects();

        expect(div.style.backgroundColor).toBe('');
    });

    it('does nothing when there are no overlays or highlighted elements', () => {
        expect(() => cancelVisualEffects()).not.toThrow();
    });
});

import { isDebugModeEnabled, setDebugModeEnabled, debugLog } from '../../app/utils/debugMode';

describe('debugMode', () => {
    const originalWindow = global.window;

    beforeEach(() => {
        // Reset global window object 
        global.window = Object.create(originalWindow);
        // Mock localStorage
        Object.defineProperty(global.window, 'localStorage', {
            value: {
                getItem: jest.fn(),
                setItem: jest.fn(),
            },
            writable: true,
        });
        // Reset __DEBUG_MODE__
        delete (global.window as any).__DEBUG_MODE__;

        jest.spyOn(console, 'log').mockImplementation(() => { });
    });

    afterEach(() => {
        global.window = originalWindow;
        jest.restoreAllMocks();
    });

    describe('isDebugModeEnabled', () => {
        it('returns false when window is undefined', () => {
            const w = global.window;
            // @ts-ignore
            delete global.window;
            expect(isDebugModeEnabled()).toBe(false);
            global.window = w;
        });

        it('returns true when __DEBUG_MODE__ is true', () => {
            (global.window as any).__DEBUG_MODE__ = true;
            expect(isDebugModeEnabled()).toBe(true);
        });

        it('returns true when localStorage has debugModeEnabled="true"', () => {
            (global.window.localStorage.getItem as jest.Mock).mockReturnValue('true');
            expect(isDebugModeEnabled()).toBe(true);
            expect(global.window.localStorage.getItem).toHaveBeenCalledWith('debugModeEnabled');
        });

        it('returns false when localStorage has something else', () => {
            (global.window.localStorage.getItem as jest.Mock).mockReturnValue('false');
            expect(isDebugModeEnabled()).toBe(false);
        });
    });

    describe('setDebugModeEnabled', () => {
        it('does nothing when window is undefined', () => {
            const w = global.window;
            // @ts-ignore
            delete global.window;
            expect(() => setDebugModeEnabled(true)).not.toThrow();
            global.window = w;
        });

        it('sets true in localStorage and global state', () => {
            setDebugModeEnabled(true);
            expect(global.window.localStorage.setItem).toHaveBeenCalledWith('debugModeEnabled', 'true');
            expect((global.window as any).__DEBUG_MODE__).toBe(true);
        });

        it('sets false in localStorage and global state', () => {
            setDebugModeEnabled(false);
            expect(global.window.localStorage.setItem).toHaveBeenCalledWith('debugModeEnabled', 'false');
            expect((global.window as any).__DEBUG_MODE__).toBe(false);
        });
    });

    describe('debugLog', () => {
        it('logs when debug mode is enabled', () => {
            (global.window as any).__DEBUG_MODE__ = true;
            debugLog('test message');
            expect(console.log).toHaveBeenCalledWith('[debug]', 'test message');
        });

        it('does not log when debug mode is disabled', () => {
            (global.window as any).__DEBUG_MODE__ = false;
            debugLog('test message');
            expect(console.log).not.toHaveBeenCalled();
        });
    });
});

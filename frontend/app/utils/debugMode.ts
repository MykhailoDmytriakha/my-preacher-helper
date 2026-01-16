const DEBUG_MODE_STORAGE_KEY = "debugModeEnabled";

export const isDebugModeEnabled = (): boolean => {
  if (typeof window === "undefined") return false;
  if ((window as Window & { __DEBUG_MODE__?: boolean }).__DEBUG_MODE__ === true) {
    return true;
  }
  return window.localStorage.getItem(DEBUG_MODE_STORAGE_KEY) === "true";
};

export const setDebugModeEnabled = (enabled: boolean) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEBUG_MODE_STORAGE_KEY, enabled ? "true" : "false");
  (window as Window & { __DEBUG_MODE__?: boolean }).__DEBUG_MODE__ = enabled;
};

export const debugLog = (...args: unknown[]) => {
  if (isDebugModeEnabled()) {
    console.log("[debug]", ...args);
  }
};

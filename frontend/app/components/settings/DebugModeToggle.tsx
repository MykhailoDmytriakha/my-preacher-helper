"use client";

import { useTranslation } from "react-i18next";

import { useDebugMode } from "@/hooks/useDebugMode";
import { debugLog } from "@/utils/debugMode";

export default function DebugModeToggle() {
  const { t } = useTranslation();
  const { enabled, setEnabled, hasLoaded } = useDebugMode();

  const handleToggle = () => {
    const nextValue = !enabled;
    setEnabled(nextValue);
    debugLog("Debug mode toggled", { enabled: nextValue });
  };

  if (!hasLoaded) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6">
        <div className="animate-pulse" data-testid="debug-mode-loading">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-4"></div>
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t("settings.debugMode.title", { defaultValue: "Debug Mode" })}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {t("settings.debugMode.description", {
              defaultValue: "Enable extra console logging for troubleshooting",
            })}
          </p>
        </div>
        <button
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${enabled ? "bg-blue-600" : "bg-gray-200 dark:bg-gray-600"
            }`}
          role="switch"
          aria-checked={enabled}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${enabled ? "translate-x-5" : "translate-x-0"
              }`}
          />
        </button>
      </div>
    </div>
  );
}

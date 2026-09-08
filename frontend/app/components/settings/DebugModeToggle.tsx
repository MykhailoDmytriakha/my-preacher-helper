"use client";

import { useTranslation } from "react-i18next";

import SettingsToggleRow from "@/components/settings/SettingsToggleRow";
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

  return (
    <SettingsToggleRow
      title={t("settings.debugMode.title", { defaultValue: "Debug Mode" })}
      description={t("settings.debugMode.description", { defaultValue: "Enable extra console logging for troubleshooting" })}
      enabled={enabled}
      onToggle={handleToggle}
      loading={!hasLoaded}
      testId="debug-mode"
    />
  );
}

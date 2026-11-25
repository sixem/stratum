// Collect live diagnostics only while their disclosure is open in Settings.
import { useContext, useEffect, useRef, useState } from "react";
import { formatBytes, getPlatformLabel } from "@/lib";
import { SettingsSearchMatches, type SettingsItemText } from "./SettingsItem";

export const DIAGNOSTICS_SETTINGS_ITEM = {
  label: "Diagnostics",
  description: "Window size, pixel ratio, JavaScript heap, CPU cores, platform, and uptime.",
  keywords: "vitals js heap memory performance webview",
} satisfies SettingsItemText;

const formatUptime = (valueMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(valueMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
};

const readWindowStats = () => ({
  size: `${window.innerWidth} × ${window.innerHeight}`,
  pixelRatio: (window.devicePixelRatio || 1).toFixed(2),
});

const readRuntimeStats = () => {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return {
    heap: memory && Number.isFinite(memory.usedJSHeapSize) ? formatBytes(memory.usedJSHeapSize) : "n/a",
    uptime: formatUptime(performance.now()),
  };
};

const DiagnosticsStats = () => {
  const [windowStats, setWindowStats] = useState(readWindowStats);
  const [runtimeStats, setRuntimeStats] = useState(readRuntimeStats);
  const [platform] = useState(getPlatformLabel);

  useEffect(() => {
    const resize = () => setWindowStats(readWindowStats());
    const interval = window.setInterval(() => setRuntimeStats(readRuntimeStats()), 2000);
    window.addEventListener("resize", resize);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const stats = [
    ["Window", windowStats.size],
    ["Pixel ratio", windowStats.pixelRatio],
    ["JS heap", runtimeStats.heap],
    ["Logical cores", navigator.hardwareConcurrency || "n/a"],
    ["Platform", platform],
    ["Uptime", runtimeStats.uptime],
  ];
  return (
    <dl className="settings-stats">
      {stats.map(([label, value]) => (
        <div className="settings-stat" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
};

export const SettingsDiagnostics = ({ open }: { open: boolean }) => {
  const matches = useContext(SettingsSearchMatches);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (open || !detailsRef.current) return;
    detailsRef.current.open = false;
    setExpanded(false);
  }, [open]);

  if (matches && !matches.has(DIAGNOSTICS_SETTINGS_ITEM)) return null;

  return (
    <details
      className="settings-diagnostics"
      ref={detailsRef}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>{DIAGNOSTICS_SETTINGS_ITEM.label}</summary>
      {open && expanded ? <DiagnosticsStats /> : null}
    </details>
  );
};

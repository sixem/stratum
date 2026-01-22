// Sidebar vitals block for the settings panel.
import { useEffect, useMemo, useState } from "react";
import { formatBytes } from "@/lib";

type SettingsVitalsProps = {
  open: boolean;
};

type WindowStats = {
  width: number;
  height: number;
  dpr: number;
};

const formatUptime = (valueMs: number | null) => {
  if (valueMs == null || !Number.isFinite(valueMs)) return "...";
  const totalSeconds = Math.max(0, Math.floor(valueMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
};

const getPlatformLabel = () => {
  if (typeof navigator === "undefined") return "Unknown";
  const typedNavigator = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  return typedNavigator.userAgentData?.platform ?? navigator.platform ?? "Unknown";
};

const getCoreLabel = () => {
  if (typeof navigator === "undefined" || !navigator.hardwareConcurrency) return "n/a";
  return `${navigator.hardwareConcurrency}`;
};

export function SettingsVitals({ open }: SettingsVitalsProps) {
  const [windowStats, setWindowStats] = useState<WindowStats | null>(null);
  const [heapUsageBytes, setHeapUsageBytes] = useState<number | null>(null);
  const [uptimeMs, setUptimeMs] = useState<number | null>(null);

  const platformLabel = useMemo(() => getPlatformLabel(), []);
  const coreLabel = useMemo(() => getCoreLabel(), []);

  useEffect(() => {
    if (!open) return;

    const updateWindowStats = () => {
      if (typeof window === "undefined") return;
      setWindowStats({
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      });
    };

    const updateHeapUsage = () => {
      if (typeof performance === "undefined") {
        setHeapUsageBytes(null);
        return;
      }
      const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
      if (!memory || !Number.isFinite(memory.usedJSHeapSize)) {
        setHeapUsageBytes(null);
        return;
      }
      setHeapUsageBytes(memory.usedJSHeapSize);
    };

    const updateUptime = () => {
      if (typeof performance === "undefined") {
        setUptimeMs(null);
        return;
      }
      setUptimeMs(performance.now());
    };

    updateWindowStats();
    updateHeapUsage();
    updateUptime();

    const handleResize = () => updateWindowStats();
    window.addEventListener("resize", handleResize);
    const interval = window.setInterval(() => {
      updateHeapUsage();
      updateUptime();
    }, 2000);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.clearInterval(interval);
    };
  }, [open]);

  const windowLabel = windowStats
    ? `${windowStats.width} x ${windowStats.height}`
    : "...";
  const dprLabel = windowStats ? windowStats.dpr.toFixed(2) : "...";
  const heapLabel = heapUsageBytes == null ? "n/a" : formatBytes(heapUsageBytes);
  const uptimeLabel = formatUptime(uptimeMs);

  return (
    <div className="settings-sidebar-footer">
      <div className="settings-sidebar-title">Vitals</div>
      <div className="settings-stats">
        <div className="settings-stat">
          <span>Window</span>
          <span>{windowLabel}</span>
        </div>
        <div className="settings-stat">
          <span>DPR</span>
          <span>{dprLabel}</span>
        </div>
        <div className="settings-stat">
          <span>JS heap</span>
          <span>{heapLabel}</span>
        </div>
        <div className="settings-stat">
          <span>Cores</span>
          <span>{coreLabel}</span>
        </div>
        <div className="settings-stat">
          <span>Platform</span>
          <span>{platformLabel}</span>
        </div>
        <div className="settings-stat">
          <span>Uptime</span>
          <span>{uptimeLabel}</span>
        </div>
      </div>
    </div>
  );
}

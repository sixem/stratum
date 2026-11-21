// Sidebar vitals block for the settings panel.
import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { formatBytes, getPlatformLabel } from "@/lib";
import { TooltipWrapper } from "@/components/overlay/Tooltip";
import { PressButton } from "@/components/primitives/PressButton";
import { usePromptStore, useSettingsStore, useShellStore } from "@/modules";

type SettingsVitalsProps = {
  open: boolean;
};

type WindowStats = {
  width: number;
  height: number;
  dpr: number;
};

const isTauriEnv = () => "__TAURI_INTERNALS__" in globalThis || "__TAURI__" in globalThis;

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

const getCoreLabel = () => {
  if (typeof navigator === "undefined" || !navigator.hardwareConcurrency) return "n/a";
  return `${navigator.hardwareConcurrency}`;
};

export const SettingsVitals = ({ open }: SettingsVitalsProps) => {
  const [windowStats, setWindowStats] = useState<WindowStats | null>(null);
  const [heapUsageBytes, setHeapUsageBytes] = useState<number | null>(null);
  const [uptimeMs, setUptimeMs] = useState<number | null>(null);
  const shellAvailability = useShellStore((state) => state.availability);
  const ffmpegPath = useSettingsStore((state) => state.ffmpegPath);
  const updateSettings = useSettingsStore((state) => state.updateSettings);

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
  const ffmpegStatus = !shellAvailability ? "Checking…" : !shellAvailability.ffmpeg
    ? "Unavailable" : shellAvailability.ffmpegMessage ? "Using automatic" : "Available";
  const ffmpegStatusClass = shellAvailability ? (shellAvailability.ffmpeg ? "is-ok" : "is-missing") : "";
  const ffmpegDetails = shellAvailability?.ffmpegMessage || shellAvailability?.ffmpegPath || undefined;

  const showLocatePrompt = () => {
    const initialValue = ffmpegPath;
    const pathRef = { current: initialValue };
    const runSave = () => {
      updateSettings({ ffmpegPath: pathRef.current.trim() });
    };

    usePromptStore.getState().showPrompt({
      title: "Locate FFmpeg",
      content: (
        <div className="prompt-field">
          <span className="prompt-label">FFmpeg path</span>
          <input
            className="prompt-input"
            type="text"
            aria-label="FFmpeg path"
            placeholder="C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe"
            defaultValue={initialValue}
            autoFocus
            onChange={(event) => {
              pathRef.current = event.currentTarget.value;
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              runSave();
              usePromptStore.getState().hidePrompt();
            }}
          />
        </div>
      ),
      confirmLabel: "Save",
      cancelLabel: "Cancel",
      onConfirm: runSave,
    });
  };

  const handleLocateFfmpeg = async () => {
    if (isTauriEnv()) {
      try {
        const selection = await openDialog({
          multiple: false,
          directory: false,
          title: "Locate FFmpeg",
          filters: [{ name: "Executable", extensions: ["exe"] }],
          defaultPath: shellAvailability?.ffmpegPath || undefined,
        });
        if (typeof selection === "string" && selection.trim()) {
          updateSettings({ ffmpegPath: selection.trim() });
        }
        return;
      } catch {
        // Fall back to the manual path prompt.
      }
    }

    showLocatePrompt();
  };

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
        <div className="settings-stat">
          <span>FFmpeg</span>
          <TooltipWrapper text={ffmpegDetails ?? ""}>
            <span className={`settings-stat-value ${ffmpegStatusClass}`}>{ffmpegStatus}</span>
          </TooltipWrapper>
        </div>
      </div>
      <div className="settings-vitals-actions">
        <PressButton type="button" className="btn" onClick={handleLocateFfmpeg}>
          Locate FFmpeg
        </PressButton>
        {ffmpegPath && (
          <PressButton type="button" className="btn" onClick={() => updateSettings({ ffmpegPath: "" })}>
            Use automatic
          </PressButton>
        )}
      </div>
    </div>
  );
};

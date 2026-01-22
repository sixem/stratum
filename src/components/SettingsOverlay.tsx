// Settings panel for view, flair, and thumbnail options.
import { useCallback, useEffect, useId, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { getThumbCacheSize } from "@/api";
import { SettingsVitals } from "@/components/settings/SettingsVitals";
import { useSettings } from "@/hooks";
import { formatBytes } from "@/lib";
import type {
  AccentTheme,
  GridNameEllipsis,
  GridSize,
  KeybindAction,
  SidebarSectionId,
} from "@/modules";
import {
  DEFAULT_KEYBINDS,
  KEYBIND_DEFINITIONS,
  RESERVED_KEYBINDS,
  SIDEBAR_RECENT_LIMIT_MAX,
  SIDEBAR_RECENT_LIMIT_MIN,
  SIDEBAR_SECTION_DEFINITIONS,
  buildKeybindFromEvent,
  formatKeybind,
  isBareCharacterKeybind,
  isReservedKeybind,
  normalizeSidebarSectionOrder,
  normalizeKeybind,
} from "@/modules";

type SettingsOverlayProps = {
  open: boolean;
  onClose: () => void;
  onOpenCacheLocation?: () => Promise<void>;
  onClearCache?: () => Promise<void>;
};

const SIZE_MIN = 96;
const SIZE_MAX = 320;
const SIZE_STEP = 16;
const QUALITY_MIN = 50;
const QUALITY_MAX = 95;
const QUALITY_STEP = 5;
const CACHE_MIN = 128;
const CACHE_MAX = 4096;
const CACHE_STEP = 128;
const RECENT_STEP = 1;
const GRID_SIZES: { id: GridSize; label: string }[] = [
  { id: "compact", label: "Compact" },
  { id: "large", label: "Large" },
];
const GRID_NAME_ELLIPSIS: { id: GridNameEllipsis; label: string }[] = [
  { id: "end", label: "End" },
  { id: "middle", label: "Middle" },
];
const ACCENT_THEMES: { id: AccentTheme; label: string }[] = [
  { id: "red", label: "Red" },
  { id: "purple", label: "Purple" },
  { id: "green", label: "Green" },
  { id: "yellow", label: "Yellow" },
  { id: "orange", label: "Orange" },
  { id: "teal", label: "Teal" },
  { id: "white", label: "White" },
];

export function SettingsOverlay({
  open,
  onClose,
  onOpenCacheLocation,
  onClearCache,
}: SettingsOverlayProps) {
  const {
    thumbnailsEnabled,
    thumbnailSize,
    thumbnailQuality,
    thumbnailFormat,
    thumbnailVideos,
    thumbnailCacheMb,
    defaultViewMode,
    accentTheme,
    categoryTinting,
    showParentEntry,
    ambientBackground,
    blurOverlays,
    keybinds,
    gridSize,
    gridRounded,
    gridCentered,
    gridShowSize,
    gridShowExtension,
    gridNameEllipsis,
    gridNameHideExtension,
    sidebarRecentLimit,
    sidebarShowTips,
    sidebarSectionOrder,
    updateSettings,
  } = useSettings();
  const titleId = useId();
  const [cacheBusy, setCacheBusy] = useState(false);
  const viewSectionId = "settings-view";
  const flairSectionId = "settings-flair";
  const thumbSectionId = "settings-thumbnails";
  const sidebarSectionId = "settings-sidebar";
  const keybindSectionId = "settings-keybinds";
  const cacheSectionId = "settings-cache";
  const [captureAction, setCaptureAction] = useState<KeybindAction | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [cacheUsageBytes, setCacheUsageBytes] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (captureAction) return;
      onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [captureAction, onClose, open]);

  useEffect(() => {
    if (open) return;
    setCaptureAction(null);
    setCaptureError(null);
  }, [open]);

  const refreshCacheUsage = useCallback(async () => {
    try {
      const nextSize = await getThumbCacheSize();
      setCacheUsageBytes(Number.isFinite(nextSize) ? nextSize : null);
    } catch {
      setCacheUsageBytes(null);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    refreshCacheUsage();
  }, [open, refreshCacheUsage]);

  const handleOpenCache = async () => {
    if (!open || cacheBusy || !onOpenCacheLocation) return;
    setCacheBusy(true);
    try {
      await onOpenCacheLocation();
    } finally {
      setCacheBusy(false);
    }
  };

  const handleClearCache = async () => {
    if (!open || cacheBusy || !onClearCache) return;
    setCacheBusy(true);
    try {
      await onClearCache();
      await refreshCacheUsage();
    } finally {
      setCacheBusy(false);
    }
  };

  const handleStartCapture = (action: KeybindAction) => {
    if (!open) return;
    if (captureAction === action) {
      setCaptureAction(null);
      setCaptureError(null);
      return;
    }
    setCaptureAction(action);
    setCaptureError(null);
  };

  const handleResetKeybind = (action: KeybindAction) => {
    updateSettings({ keybinds: { ...keybinds, [action]: DEFAULT_KEYBINDS[action] } });
  };

  const handleResetKeybinds = () => {
    updateSettings({ keybinds: { ...DEFAULT_KEYBINDS } });
  };

  const normalizedSidebarOrder = normalizeSidebarSectionOrder(sidebarSectionOrder);
  const handleMoveSidebarSection = (id: SidebarSectionId, direction: -1 | 1) => {
    const order = normalizeSidebarSectionOrder(sidebarSectionOrder);
    const index = order.indexOf(id);
    if (index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    updateSettings({ sidebarSectionOrder: next });
  };

  useEffect(() => {
    if (!open || !captureAction) return;
    const handleKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setCaptureAction(null);
        setCaptureError(null);
        return;
      }
      if (event.repeat) return;
      const next = buildKeybindFromEvent(event);
      if (!next) return;
      const normalized = normalizeKeybind(next);
      if (!normalized) return;
      if (isReservedKeybind(normalized)) {
        setCaptureError("That shortcut is reserved.");
        return;
      }
      if (isBareCharacterKeybind(normalized)) {
        setCaptureError("Use Ctrl or Alt with single-character shortcuts.");
        return;
      }
      const conflict = KEYBIND_DEFINITIONS.find((definition) => {
        if (definition.id === captureAction) return false;
        return normalizeKeybind(keybinds[definition.id]) === normalized;
      });
      if (conflict) {
        setCaptureError(`Already used by ${conflict.label}.`);
        return;
      }
      updateSettings({
        keybinds: {
          ...keybinds,
          [captureAction]: normalized,
        },
      });
      setCaptureAction(null);
      setCaptureError(null);
    };

    window.addEventListener("keydown", handleKey, { capture: true });
    return () => window.removeEventListener("keydown", handleKey, { capture: true });
  }, [captureAction, keybinds, open, updateSettings]);

  const handleJump = (id: string) => (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const target = document.getElementById(id);
    if (!target) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  };

  const isThumbsDisabled = !thumbnailsEnabled;
  const canAdjustQuality = !isThumbsDisabled && thumbnailFormat === "jpeg";
  const qualityLabel = thumbnailFormat === "jpeg" ? `${thumbnailQuality}%` : "Lossless";
  const cacheUsageLabel = `Used: ${formatBytes(cacheUsageBytes)}`;

  return (
    <div
      className="settings-overlay"
      data-open={open ? "true" : "false"}
      aria-hidden={open ? "false" : "true"}
      onClick={onClose}
    >
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-header">
          <div>
            <h2 className="settings-title" id={titleId}>
              Settings
            </h2>
            <p className="settings-subtitle">
              Manage view defaults, flair, thumbnails, and cached previews.
            </p>
          </div>
          <button type="button" className="btn ghost settings-close" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="settings-body">
          <nav className="settings-sidebar" aria-label="Settings sections">
            <div className="settings-nav">
              <button
                type="button"
                className="settings-nav-item"
                onClick={handleJump(viewSectionId)}
              >
                View
              </button>
              <button
                type="button"
                className="settings-nav-item"
                onClick={handleJump(flairSectionId)}
              >
                Flair
              </button>
              <button
                type="button"
                className="settings-nav-item"
                onClick={handleJump(sidebarSectionId)}
              >
                Sidebar
              </button>
              <button
                type="button"
                className="settings-nav-item"
                onClick={handleJump(thumbSectionId)}
              >
                Thumbnails
              </button>
              <button
                type="button"
                className="settings-nav-item"
                onClick={handleJump(keybindSectionId)}
              >
                Keybinds
              </button>
              <button
                type="button"
                className="settings-nav-item"
                onClick={handleJump(cacheSectionId)}
              >
                Cache
              </button>
            </div>
            <SettingsVitals open={open} />
          </nav>
          <div className="settings-content">
            <section className="settings-section" id={viewSectionId}>
              <div className="settings-section-title">View</div>
              <div className="settings-item">
                <div>
                  <div className="settings-label">Default view</div>
                  <div className="settings-desc">Used for new tabs and new sessions.</div>
                </div>
                <div className="settings-pills" role="group" aria-label="Default view">
                  <button
                    type="button"
                    className={`settings-pill${defaultViewMode === "thumbs" ? " is-active" : ""}`}
                    onClick={() => updateSettings({ defaultViewMode: "thumbs" })}
                  >
                    Grid
                  </button>
                  <button
                    type="button"
                    className={`settings-pill${defaultViewMode === "list" ? " is-active" : ""}`}
                    onClick={() => updateSettings({ defaultViewMode: "list" })}
                  >
                    List
                  </button>
                </div>
              </div>
              <div className="settings-item">
                <div>
                  <div className="settings-label">Grid size</div>
                  <div className="settings-desc">Adjust the grid density in thumbnail view.</div>
                </div>
                <div className="settings-pills" role="group" aria-label="Grid size">
                  {GRID_SIZES.map((size) => (
                    <button
                      key={size.id}
                      type="button"
                      className={`settings-pill${gridSize === size.id ? " is-active" : ""}`}
                      onClick={() => updateSettings({ gridSize: size.id })}
                    >
                      {size.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-item">
                <div>
                  <div className="settings-label">Grid corners</div>
                  <div className="settings-desc">Rounded cards or straight edges.</div>
                </div>
                <div className="settings-pills" role="group" aria-label="Grid corners">
                  <button
                    type="button"
                    className={`settings-pill${gridRounded ? " is-active" : ""}`}
                    onClick={() => updateSettings({ gridRounded: true })}
                  >
                    Rounded
                  </button>
                  <button
                    type="button"
                    className={`settings-pill${gridRounded ? "" : " is-active"}`}
                    onClick={() => updateSettings({ gridRounded: false })}
                  >
                    Straight
                  </button>
                </div>
              </div>
              <div className="settings-item">
                <div>
                  <div className="settings-label">Center grid items</div>
                  <div className="settings-desc">Center the grid within the viewport.</div>
                </div>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={gridCentered}
                    onChange={(event) =>
                      updateSettings({ gridCentered: event.currentTarget.checked })
                    }
                  />
                  <span />
                </label>
              </div>
              <div className="settings-item">
                <div>
                  <div className="settings-label">Grid details</div>
                  <div className="settings-desc">Name is always shown in grid cards.</div>
                </div>
                <div className="settings-pills" role="group" aria-label="Grid details">
                  <label
                    className={`settings-pill settings-pill-check${
                      gridShowSize ? " is-active" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={gridShowSize}
                      onChange={(event) =>
                        updateSettings({ gridShowSize: event.currentTarget.checked })
                      }
                    />
                    <span>File size</span>
                  </label>
                  <label
                    className={`settings-pill settings-pill-check${
                      gridShowExtension ? " is-active" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={gridShowExtension}
                      onChange={(event) =>
                        updateSettings({ gridShowExtension: event.currentTarget.checked })
                      }
                    />
                    <span>Extension</span>
                  </label>
                </div>
              </div>
              <div className="settings-item">
                <div>
                  <div className="settings-label">Hide extension in grid names</div>
                  <div className="settings-desc">
                    Keep the base filename in the title line.
                  </div>
                </div>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={gridNameHideExtension}
                    onChange={(event) =>
                      updateSettings({ gridNameHideExtension: event.currentTarget.checked })
                    }
                  />
                  <span />
                </label>
              </div>
              <div className="settings-item">
                <div>
                  <div className="settings-label">Grid name truncation</div>
                  <div className="settings-desc">
                    Choose how long names are shortened. Middle keeps the ending visible.
                  </div>
                </div>
                <div className="settings-pills" role="group" aria-label="Grid name truncation">
                  {GRID_NAME_ELLIPSIS.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      className={`settings-pill${gridNameEllipsis === mode.id ? " is-active" : ""}`}
                      onClick={() => updateSettings({ gridNameEllipsis: mode.id })}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-item">
                <div>
                  <div className="settings-label">Parent directory entry</div>
                  <div className="settings-desc">Show a pseudo entry for moving up one level.</div>
                </div>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={showParentEntry}
                    onChange={(event) =>
                      updateSettings({ showParentEntry: event.currentTarget.checked })
                    }
                  />
                  <span />
                </label>
              </div>
            </section>
            <section className="settings-section" id={flairSectionId}>
              <div className="settings-section-title">Flair</div>
              <div className="settings-item">
                <div>
                  <div className="settings-label">Accent color</div>
                  <div className="settings-desc">Tint highlights and accents across the app.</div>
                </div>
                <div className="settings-pills" role="group" aria-label="Accent color">
                  {ACCENT_THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      data-accent={theme.id}
                      className={`settings-pill${accentTheme === theme.id ? " is-active" : ""}`}
                      onClick={() => updateSettings({ accentTheme: theme.id })}
                    >
                      <span className="settings-swatch" aria-hidden="true" />
                      {theme.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-item">
                <div>
                  <div className="settings-label">Category tints</div>
                  <div className="settings-desc">Subtle color cues for file types in grid view.</div>
                </div>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={categoryTinting}
                    onChange={(event) =>
                      updateSettings({ categoryTinting: event.currentTarget.checked })
                    }
                  />
                  <span />
                </label>
              </div>
              <div className="settings-item">
                <div>
                  <div className="settings-label">Ambient background</div>
                  <div className="settings-desc">Slow moving gradient glow behind the UI.</div>
                </div>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={ambientBackground}
                    onChange={(event) =>
                      updateSettings({ ambientBackground: event.currentTarget.checked })
                    }
                  />
                  <span />
                </label>
              </div>
              <div className="settings-item">
                <div>
                  <div className="settings-label">Blur overlays</div>
                  <div className="settings-desc">
                    Backdrop blur for tooltips and menus.
                  </div>
                </div>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={blurOverlays}
                    onChange={(event) =>
                      updateSettings({ blurOverlays: event.currentTarget.checked })
                    }
                  />
                  <span />
                </label>
              </div>
            </section>
            <section className="settings-section" id={sidebarSectionId}>
              <div className="settings-section-title">Sidebar</div>
              <div className="settings-item">
                <div>
                  <div className="settings-label">Recent jumps window</div>
                  <div className="settings-desc">
                    Control how many locations stay in the rolling list.
                  </div>
                </div>
                <div className="settings-range">
                  <input
                    type="range"
                    min={SIDEBAR_RECENT_LIMIT_MIN}
                    max={SIDEBAR_RECENT_LIMIT_MAX}
                    step={RECENT_STEP}
                    value={sidebarRecentLimit}
                    onChange={(event) =>
                      updateSettings({ sidebarRecentLimit: Number(event.currentTarget.value) })
                    }
                  />
                  <span className="settings-value">{sidebarRecentLimit}</span>
                </div>
              </div>
              <div className="settings-item">
                <div>
                  <div className="settings-label">Tips</div>
                  <div className="settings-desc">
                    Show helpful tips at the bottom of the sidebar.
                  </div>
                </div>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={sidebarShowTips}
                    onChange={(event) =>
                      updateSettings({ sidebarShowTips: event.currentTarget.checked })
                    }
                  />
                  <span />
                </label>
              </div>
              <div className="settings-item is-stacked">
                <div>
                  <div className="settings-label">Sidebar order</div>
                  <div className="settings-desc">
                    Reorder sections so the sidebar matches your flow.
                  </div>
                </div>
                <div className="settings-order">
                  {normalizedSidebarOrder.map((sectionId, index) => {
                    const section = SIDEBAR_SECTION_DEFINITIONS.find(
                      (item) => item.id === sectionId,
                    );
                    return (
                      <div className="settings-order-item" key={sectionId}>
                        <span className="settings-order-label">
                          {section?.label ?? sectionId}
                        </span>
                        <div className="settings-order-actions">
                          <button
                            type="button"
                            className="btn ghost"
                            disabled={index === 0}
                            onClick={() => handleMoveSidebarSection(sectionId, -1)}
                            aria-label={`Move ${section?.label ?? sectionId} up`}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            className="btn ghost"
                            disabled={index === normalizedSidebarOrder.length - 1}
                            onClick={() => handleMoveSidebarSection(sectionId, 1)}
                            aria-label={`Move ${section?.label ?? sectionId} down`}
                          >
                            Down
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
            <section className="settings-section" id={thumbSectionId}>
              <div className="settings-section-title">Thumbnails</div>
              <div className="settings-item">
                <div>
                  <div className="settings-label">Enable thumbnails</div>
                  <div className="settings-desc">Generate preview images in grid view.</div>
                </div>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={thumbnailsEnabled}
                    onChange={(event) =>
                      updateSettings({ thumbnailsEnabled: event.currentTarget.checked })
                    }
                  />
                  <span />
                </label>
              </div>
              <div className={`settings-item${isThumbsDisabled ? " is-disabled" : ""}`}>
                <div>
                  <div className="settings-label">Thumbnail size</div>
                  <div className="settings-desc">Max edge size for generated previews.</div>
                </div>
                <div className="settings-range">
                  <input
                    type="range"
                    min={SIZE_MIN}
                    max={SIZE_MAX}
                    step={SIZE_STEP}
                    value={thumbnailSize}
                    disabled={isThumbsDisabled}
                    onChange={(event) =>
                      updateSettings({ thumbnailSize: Number(event.currentTarget.value) })
                    }
                  />
                  <span className="settings-value">{thumbnailSize}px</span>
                </div>
              </div>
              <div className={`settings-item${isThumbsDisabled ? " is-disabled" : ""}`}>
                <div>
                  <div className="settings-label">Quality (JPEG)</div>
                  <div className="settings-desc">Balance size against visual detail.</div>
                </div>
                <div className="settings-range">
                  <input
                    type="range"
                    min={QUALITY_MIN}
                    max={QUALITY_MAX}
                    step={QUALITY_STEP}
                    value={thumbnailQuality}
                    disabled={!canAdjustQuality}
                    onChange={(event) =>
                      updateSettings({ thumbnailQuality: Number(event.currentTarget.value) })
                    }
                  />
                  <span className="settings-value">{qualityLabel}</span>
                </div>
              </div>
              <div className={`settings-item${isThumbsDisabled ? " is-disabled" : ""}`}>
                <div>
                  <div className="settings-label">Video previews</div>
                  <div className="settings-desc">
                    Attempt thumbnails for local videos when supported.
                  </div>
                </div>
                <label className="settings-toggle">
                  <input
                    type="checkbox"
                    checked={thumbnailVideos}
                    disabled={isThumbsDisabled}
                    onChange={(event) =>
                      updateSettings({ thumbnailVideos: event.currentTarget.checked })
                    }
                  />
                  <span />
                </label>
              </div>
            </section>
            <section className="settings-section" id={keybindSectionId}>
              <div className="settings-section-title">Keybinds</div>
              <div className="settings-item">
                <div>
                  <div className="settings-label">Custom shortcuts</div>
                  <div className="settings-desc">
                    Click a shortcut to rebind it. Press Escape to cancel.
                  </div>
                </div>
                <div className="settings-actions">
                  <button type="button" className="btn ghost" onClick={handleResetKeybinds}>
                    Reset all
                  </button>
                </div>
              </div>
              {KEYBIND_DEFINITIONS.map((definition) => {
                const current = keybinds[definition.id];
                const normalizedCurrent = normalizeKeybind(current);
                const normalizedDefault = normalizeKeybind(DEFAULT_KEYBINDS[definition.id]);
                const isCapturing = captureAction === definition.id;
                const showError = isCapturing && Boolean(captureError);
                const displayLabel = isCapturing
                  ? "Press keys..."
                  : formatKeybind(current) || "Unassigned";
                return (
                  <div className="settings-item" key={definition.id}>
                    <div>
                      <div className="settings-label">{definition.label}</div>
                      <div className="settings-desc">{definition.description}</div>
                      {showError ? (
                        <div className="settings-desc settings-desc-error">{captureError}</div>
                      ) : null}
                    </div>
                    <div className="settings-actions">
                      <button
                        type="button"
                        className={`keybind-button${isCapturing ? " is-capturing" : ""}${
                          showError ? " is-error" : ""
                        }`}
                        onClick={() => handleStartCapture(definition.id)}
                      >
                        {displayLabel}
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={normalizedCurrent === normalizedDefault}
                        onClick={() => handleResetKeybind(definition.id)}
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                );
              })}
              <div className="settings-item">
                <div>
                  <div className="settings-label">Fixed shortcuts</div>
                  <div className="settings-desc">
                    Reserved for search, copy, paste, and refresh.
                  </div>
                </div>
                <div className="settings-actions">
                  {RESERVED_KEYBINDS.map((binding) => (
                    <span className="keybind-pill" key={binding}>
                      {formatKeybind(binding)}
                    </span>
                  ))}
                </div>
              </div>
            </section>
            <section className="settings-section" id={cacheSectionId}>
              <div className="settings-section-title">Cache</div>
              <div className={`settings-item${isThumbsDisabled ? " is-disabled" : ""}`}>
                <div>
                  <div className="settings-label">Image format</div>
                  <div className="settings-desc">Pick the saved thumbnail format.</div>
                </div>
                <div className="settings-pills" role="group" aria-label="Thumbnail format">
                  <button
                    type="button"
                    className={`settings-pill${thumbnailFormat === "webp" ? " is-active" : ""}`}
                    disabled={isThumbsDisabled}
                    onClick={() => updateSettings({ thumbnailFormat: "webp" })}
                  >
                    WebP
                  </button>
                  <button
                    type="button"
                    className={`settings-pill${thumbnailFormat === "jpeg" ? " is-active" : ""}`}
                    disabled={isThumbsDisabled}
                    onClick={() => updateSettings({ thumbnailFormat: "jpeg" })}
                  >
                    JPEG
                  </button>
                </div>
              </div>
              <div className={`settings-item${isThumbsDisabled ? " is-disabled" : ""}`}>
                <div>
                  <div className="settings-label">Cache size limit</div>
                  <div className="settings-desc">Approximate max size for disk cache.</div>
                </div>
                <div className="settings-range">
                  <input
                    type="range"
                    min={CACHE_MIN}
                    max={CACHE_MAX}
                    step={CACHE_STEP}
                    value={thumbnailCacheMb}
                    disabled={isThumbsDisabled}
                    onChange={(event) =>
                      updateSettings({ thumbnailCacheMb: Number(event.currentTarget.value) })
                    }
                  />
                  <span className="settings-value">{thumbnailCacheMb} MB</span>
                </div>
              </div>
              <div className="settings-item">
                <div>
                  <div className="settings-label settings-label-row">
                    <span>Thumbnail cache</span>
                    <span className="settings-chip">{cacheUsageLabel}</span>
                  </div>
                  <div className="settings-desc">Open the cache folder or clear stored previews.</div>
                </div>
                <div className="settings-actions">
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={cacheBusy || !onOpenCacheLocation}
                    onClick={handleOpenCache}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={cacheBusy || !onClearCache}
                    onClick={handleClearCache}
                  >
                    Clear
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

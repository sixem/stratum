// Sidebar order and visibility settings.
import type { SidebarSectionId } from "@/modules";
import {
  SIDEBAR_RECENT_LIMIT_MAX,
  SIDEBAR_RECENT_LIMIT_MIN,
  SIDEBAR_SECTION_DEFINITIONS,
  normalizeSidebarSectionOrder,
} from "@/modules";
import type { SettingsUpdateHandler } from "./types";

type SettingsSidebarSectionProps = {
  sectionId: string;
  sidebarRecentLimit: number;
  sidebarShowTips: boolean;
  sidebarSectionOrder: SidebarSectionId[];
  onUpdate: SettingsUpdateHandler;
};

const RECENT_STEP = 1;

export function SettingsSidebarSection({
  sectionId,
  sidebarRecentLimit,
  sidebarShowTips,
  sidebarSectionOrder,
  onUpdate,
}: SettingsSidebarSectionProps) {
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
    onUpdate({ sidebarSectionOrder: next });
  };

  return (
    <section className="settings-section" id={sectionId}>
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
              onUpdate({ sidebarRecentLimit: Number(event.currentTarget.value) })
            }
          />
          <span className="settings-value">{sidebarRecentLimit}</span>
        </div>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Tips</div>
          <div className="settings-desc">Show helpful tips at the bottom of the sidebar.</div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={sidebarShowTips}
            onChange={(event) => onUpdate({ sidebarShowTips: event.currentTarget.checked })}
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
          {normalizedSidebarOrder.map((sectionIdValue, index) => {
            const section = SIDEBAR_SECTION_DEFINITIONS.find(
              (item) => item.id === sectionIdValue,
            );
            return (
              <div className="settings-order-item" key={sectionIdValue}>
                <span className="settings-order-label">
                  {section?.label ?? sectionIdValue}
                </span>
                <div className="settings-order-actions">
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={index === 0}
                    onClick={() => handleMoveSidebarSection(sectionIdValue, -1)}
                    aria-label={`Move ${section?.label ?? sectionIdValue} up`}
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={index === normalizedSidebarOrder.length - 1}
                    onClick={() => handleMoveSidebarSection(sectionIdValue, 1)}
                    aria-label={`Move ${section?.label ?? sectionIdValue} down`}
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
  );
}

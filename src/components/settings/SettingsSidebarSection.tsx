// Sidebar order and visibility settings.
import type { SidebarSectionId } from "@/modules";
import {
  SIDEBAR_RECENT_LIMIT_MAX,
  SIDEBAR_RECENT_LIMIT_MIN,
  SIDEBAR_SECTION_DEFINITIONS,
  normalizeSidebarHiddenSections,
  normalizeSidebarSectionOrder,
} from "@/modules";
import { EyeIcon, EyeOffIcon } from "@/components";
import type { SettingsUpdateHandler } from "./types";

type SettingsSidebarSectionProps = {
  sectionId: string;
  sidebarRecentLimit: number;
  sidebarSectionOrder: SidebarSectionId[];
  sidebarHiddenSections: SidebarSectionId[];
  onUpdate: SettingsUpdateHandler;
};

const RECENT_STEP = 1;

export function SettingsSidebarSection({
  sectionId,
  sidebarRecentLimit,
  sidebarSectionOrder,
  sidebarHiddenSections,
  onUpdate,
}: SettingsSidebarSectionProps) {
  const normalizedSidebarOrder = normalizeSidebarSectionOrder(sidebarSectionOrder);
  const normalizedHiddenSections = normalizeSidebarHiddenSections(sidebarHiddenSections);
  const hiddenSet = new Set(normalizedHiddenSections);
  const buildHiddenList = (nextHidden: Set<SidebarSectionId>) =>
    SIDEBAR_SECTION_DEFINITIONS.filter((item) => nextHidden.has(item.id)).map(
      (item) => item.id,
    );
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
  const handleToggleSection = (id: SidebarSectionId) => {
    const nextHidden = new Set(hiddenSet);
    if (nextHidden.has(id)) {
      nextHidden.delete(id);
    } else {
      nextHidden.add(id);
    }
    onUpdate({ sidebarHiddenSections: buildHiddenList(nextHidden) });
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
      <div className="settings-item is-stacked">
        <div>
          <div className="settings-label">Sidebar order</div>
          <div className="settings-desc">
            Reorder sections or toggle visibility to match your flow.
          </div>
        </div>
        <div className="settings-order">
          {normalizedSidebarOrder.map((sectionIdValue, index) => {
            const section = SIDEBAR_SECTION_DEFINITIONS.find(
              (item) => item.id === sectionIdValue,
            );
            const isHidden = hiddenSet.has(sectionIdValue);
            return (
              <div
                className={`settings-order-item${isHidden ? " is-hidden" : ""}`}
                key={sectionIdValue}
              >
                <span className="settings-order-label">
                  {section?.label ?? sectionIdValue}
                </span>
                <div className="settings-order-actions">
                  <button
                    type="button"
                    className={`settings-order-visibility${
                      isHidden ? " is-hidden" : ""
                    }`}
                    onClick={() => handleToggleSection(sectionIdValue)}
                    aria-label={`${
                      isHidden ? "Show" : "Hide"
                    } ${section?.label ?? sectionIdValue} section`}
                  >
                    {isHidden ? (
                      <EyeOffIcon className="settings-order-icon" />
                    ) : (
                      <EyeIcon className="settings-order-icon" />
                    )}
                  </button>
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

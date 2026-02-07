// Header, navigation bar, and sidebar presentation controls.
import type { SidebarSectionId } from "@/modules";
import {
  SIDEBAR_RECENT_LIMIT_MAX,
  SIDEBAR_RECENT_LIMIT_MIN,
  SIDEBAR_SECTION_DEFINITIONS,
  normalizeSidebarHiddenSections,
  normalizeSidebarSectionOrder,
} from "@/modules";
import { EyeIcon, EyeOffIcon } from "@/components";
import { PressButton } from "../PressButton";
import { useDeferredRange } from "./useDeferredRange";
import type { SettingsUpdateHandler } from "./types";

type SettingsBarsSectionProps = {
  sectionId: string;
  showTabNumbers: boolean;
  fixedWidthTabs: boolean;
  sidebarRecentLimit: number;
  sidebarSectionOrder: SidebarSectionId[];
  sidebarHiddenSections: SidebarSectionId[];
  onUpdate: SettingsUpdateHandler;
};

const RECENT_STEP = 1;

export const SettingsBarsSection = ({
  sectionId,
  showTabNumbers,
  fixedWidthTabs,
  sidebarRecentLimit,
  sidebarSectionOrder,
  sidebarHiddenSections,
  onUpdate,
}: SettingsBarsSectionProps) => {
  const normalizedSidebarOrder = normalizeSidebarSectionOrder(sidebarSectionOrder);
  const normalizedHiddenSections = normalizeSidebarHiddenSections(sidebarHiddenSections);
  const hiddenSet = new Set(normalizedHiddenSections);
  const recentRange = useDeferredRange({
    value: sidebarRecentLimit,
    onCommit: (value) => onUpdate({ sidebarRecentLimit: value }),
  });
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
      <div className="settings-section-title">Bars</div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Tab numbers</div>
          <div className="settings-desc">
            Show a small index number beside each tab title.
          </div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={showTabNumbers}
            onChange={(event) =>
              onUpdate({ showTabNumbers: event.currentTarget.checked })
            }
          />
          <span />
        </label>
      </div>
      <div className="settings-item">
        <div>
          <div className="settings-label">Fixed-width tabs</div>
          <div className="settings-desc">
            Keep every tab the same width instead of sizing to the title.
          </div>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={fixedWidthTabs}
            onChange={(event) =>
              onUpdate({ fixedWidthTabs: event.currentTarget.checked })
            }
          />
          <span />
        </label>
      </div>
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
            {...recentRange.bind}
          />
          <span className="settings-value">{recentRange.draft}</span>
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
                  <PressButton
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
                  </PressButton>
                  <PressButton
                    type="button"
                    className="btn ghost"
                    disabled={index === 0}
                    onClick={() => handleMoveSidebarSection(sectionIdValue, -1)}
                    aria-label={`Move ${section?.label ?? sectionIdValue} up`}
                  >
                    Up
                  </PressButton>
                  <PressButton
                    type="button"
                    className="btn ghost"
                    disabled={index === normalizedSidebarOrder.length - 1}
                    onClick={() => handleMoveSidebarSection(sectionIdValue, 1)}
                    aria-label={`Move ${section?.label ?? sectionIdValue} down`}
                  >
                    Down
                  </PressButton>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

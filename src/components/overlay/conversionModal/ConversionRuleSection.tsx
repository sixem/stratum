// Default per-kind output format selectors for the conversion modal.
import { DropdownSelect } from "@/components/primitives";
import { QUICK_CONVERT_PRESET_LABELS } from "@/constants";
import type {
  ConversionMediaKind,
  ConversionModalDraft,
  ConversionModalRequest,
} from "@/types";
import {
  KIND_LABELS,
  findRuleFormat,
  ruleGroupsByKind,
} from "./conversionModalConfig";

type ConversionRuleSectionProps = {
  request: ConversionModalRequest;
  draft: ConversionModalDraft;
  hasQuickPrefill: boolean;
  runInProgress: boolean;
  onRuleFormatChange: (
    kind: ConversionMediaKind,
    targetFormat: string | null,
  ) => void;
};

export const ConversionRuleSection = ({
  request,
  draft,
  hasQuickPrefill,
  runInProgress,
  onRuleFormatChange,
}: ConversionRuleSectionProps) => {
  return (
    <div className="conversion-block">
      {request.sourceKinds.map((kind) => {
        const selectedFormat = findRuleFormat(draft, kind) ?? "";
        return (
          <div key={kind} className="conversion-rule-card">
            <div className="conversion-section-label">
              <span>{KIND_LABELS[kind]} default format</span>
            </div>
            <DropdownSelect
              value={selectedFormat}
              groups={ruleGroupsByKind[kind]}
              placeholder="Choose target format"
              ariaLabel={`${KIND_LABELS[kind]} target format`}
              onChange={(next) => onRuleFormatChange(kind, next)}
              disabled={runInProgress}
            />
            {hasQuickPrefill &&
            request.quickTargetKind === kind &&
            request.quickTargetFormat ? (
              <div className="conversion-rule-note">
                {QUICK_CONVERT_PRESET_LABELS[request.quickTargetFormat] ??
                  "Quick convert preset"}{" "}
                prefilled this rule.
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

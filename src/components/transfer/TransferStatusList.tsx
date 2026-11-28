// The Work popover mounts this list only while its rows are visible.
import { useMemo } from "react";
import { useNowTick } from "@/hooks";
import type { TransferJob } from "@/modules/transferStore.types";
import type { TransferDestination } from "@/types";
import { TransferStatusItem } from "./TransferStatusItem";
import { RecoveryDetails } from "./RecoveryDetails";
import { sortWorkListJobs } from "./transferStatusView";

type TransferStatusListProps = {
  jobs: TransferJob[];
  onOpenDestination: (destination: TransferDestination) => void;
};

export const TransferStatusList = ({ jobs, onOpenDestination }: TransferStatusListProps) => {
  const orderedJobs = useMemo(() => sortWorkListJobs(jobs), [jobs]);
  const now = useNowTick({ enabled: true });

  return (
    <div className="toolbar-popover-list transfer-list" role="list" data-window-drag-ignore="true">
      <RecoveryDetails />
      {orderedJobs.map((job) => (
        <TransferStatusItem key={job.id} job={job} now={now} onOpenDestination={onOpenDestination} />
      ))}
    </div>
  );
};

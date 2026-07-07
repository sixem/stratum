// Bottom status line for counts and messages.
import loader from "@/assets/icons/loaders/ring.svg";

type StatusBarProps = {
  message: string;
  level: "idle" | "loading" | "error";
  countLabel: string;
  selectionLabel?: string;
};

export const StatusBar = ({
  message,
  level,
  countLabel,
  selectionLabel,
}: StatusBarProps) => {
  return (
    <footer className="statusbar tnum">
      <div className="status-left">
        <span className="status-count tnum">{countLabel}</span>
        {selectionLabel ? <span className="status-selection tnum">{selectionLabel}</span> : null}
      </div>
      <span
        className={`status-text ${level} tnum`}
        role={level === "error" ? "alert" : "status"}
        aria-live={level === "error" ? "assertive" : "polite"}
        aria-atomic="true"
      >
        <span className="status-text-content">
          <span className="status-text-label">{message}</span>
          {level === "loading" ? (
            <img
              src={loader}
              alt=""
              aria-hidden="true"
              className="status-text-loading-icon"
            />
          ) : null}
        </span>
      </span>
    </footer>
  );
};

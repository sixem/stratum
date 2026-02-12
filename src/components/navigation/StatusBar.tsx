// Bottom status line for counts and messages.
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
        {message}
      </span>
    </footer>
  );
};

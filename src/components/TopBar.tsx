// Deprecated legacy top bar; not wired in App. Remove when safe.
import type { FormEvent } from "react";
import { ChevronUpIcon, RefreshIcon } from "./icons";

type TopBarProps = {
  path: string;
  onPathChange: (value: string) => void;
  onSubmit: () => void;
  onUp: () => void;
  onRefresh: () => void;
  canGoUp: boolean;
  loading: boolean;
};

export const TopBar = ({
  path,
  onPathChange,
  onSubmit,
  onUp,
  onRefresh,
  canGoUp,
  loading,
}: TopBarProps) => {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  const canSubmit = path.trim().length > 0;

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <img src="/favicon.png" alt="" aria-hidden="true" />
        </div>
        <div>
          <div className="brand-title">Drives:</div>
          <div className="brand-subtitle">File Manager</div>
        </div>
      </div>

      <form className="pathbar" onSubmit={handleSubmit}>
        <button
          className="btn ghost"
          type="button"
          onClick={onUp}
          disabled={loading || !canGoUp}
          aria-label="Up one level"
        >
          <ChevronUpIcon className="btn-icon" />
        </button>
        <input
          value={path}
          onChange={(event) => onPathChange(event.currentTarget.value)}
          placeholder="Enter a path"
          spellCheck={false}
        />
        <button className="btn" type="submit" disabled={loading || !canSubmit}>
          Go
        </button>
      </form>

      <div className="actions">
        <button
          className="btn ghost"
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh"
        >
          <RefreshIcon className="btn-icon" />
        </button>
        <div className={`pulse ${loading ? "is-on" : ""}`} aria-hidden="true" />
      </div>
    </header>
  );
};

// Spinner with optional label for loading states.
import loader from "@/assets/icons/loaders/ring.svg";

type LoadingIndicatorProps = {
  label?: string;
};

export const LoadingIndicator = ({ label = "Loading" }: LoadingIndicatorProps) => {
  return (
    <div className="loading-indicator" aria-live="polite">
      <img src={loader} alt="" />
      {label ? <span className="loading-label">{label}</span> : null}
    </div>
  );
};

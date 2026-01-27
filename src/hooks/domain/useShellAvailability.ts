// Fetches shell availability once on startup and caches it in a store.
import { useEffect } from "react";
import { getShellAvailability } from "@/api";
import { useShellStore } from "@/modules";

type UseShellAvailabilityOptions = {
  enabled: boolean;
};

export const useShellAvailability = ({ enabled }: UseShellAvailabilityOptions) => {
  const availability = useShellStore((state) => state.availability);
  const setAvailability = useShellStore((state) => state.setAvailability);

  useEffect(() => {
    if (!enabled || availability) return;
    let mounted = true;
    void getShellAvailability()
      .then((result) => {
        if (!mounted) return;
        setAvailability(result);
      })
      .catch(() => {
        // Ignore shell detection errors for now.
      });
    return () => {
      mounted = false;
    };
  }, [availability, enabled, setAvailability]);

  return availability;
};

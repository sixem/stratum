// Recheck when the FFmpeg override changes or the user reopens Settings after installing it.
import { useEffect, useRef } from "react";
import { getShellAvailability } from "@/api";
import { useShellStore } from "@/modules";

type UseShellAvailabilityOptions = {
  enabled: boolean;
  ffmpegPath: string;
  settingsOpen: boolean;
};

export const useShellAvailability = ({ enabled, ffmpegPath, settingsOpen }: UseShellAvailabilityOptions) => {
  const availability = useShellStore((state) => state.availability);
  const setAvailability = useShellStore((state) => state.setAvailability);
  const checkedPath = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || (!settingsOpen && checkedPath.current === ffmpegPath)) return;
    let mounted = true;
    checkedPath.current = null;
    setAvailability(null);
    void getShellAvailability(ffmpegPath)
      .then((result) => {
        if (!mounted) return;
        checkedPath.current = ffmpegPath;
        setAvailability(result);
      })
      .catch(() => {
        if (mounted) setAvailability({
          pwsh: false, wsl: false, ffmpeg: false, ffmpegPath: null,
          ffmpegMessage: "Could not check FFmpeg on this computer.",
        });
      });
    return () => {
      mounted = false;
    };
  }, [enabled, ffmpegPath, settingsOpen, setAvailability]);

  return availability;
};

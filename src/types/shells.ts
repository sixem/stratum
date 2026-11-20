export type ShellAvailability = {
  pwsh: boolean;
  wsl: boolean;
  ffmpeg: boolean;
  ffmpegPath: string | null;
  ffmpegMessage: string | null;
};

export type ShellKind = "pwsh" | "wsl";

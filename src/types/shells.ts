export type ShellAvailability = {
  pwsh: boolean;
  wsl: boolean;
  ffmpeg: boolean;
};

export type ShellKind = "pwsh" | "wsl";

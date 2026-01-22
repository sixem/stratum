// Helpers for working with file names without touching filesystem paths.

export type NameParts = {
  base: string;
  extension: string | null;
  dotExtension: string | null;
};

export const splitNameExtension = (name: string): NameParts => {
  const lastDot = name.lastIndexOf(".");
  // Treat dotfiles and trailing dots as extensionless for display.
  if (lastDot <= 0 || lastDot === name.length - 1) {
    return { base: name, extension: null, dotExtension: null };
  }

  return {
    base: name.slice(0, lastDot),
    extension: name.slice(lastDot + 1),
    dotExtension: name.slice(lastDot),
  };
};

export const stripNameExtension = (name: string): string => {
  return splitNameExtension(name).base;
};

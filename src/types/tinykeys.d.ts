declare module "tinykeys" {
  export type KeyBindingMap = Record<string, (event: KeyboardEvent) => void>;
  export function tinykeys(
    target: Window | Document | HTMLElement,
    keyBindings: KeyBindingMap,
  ): () => void;
}

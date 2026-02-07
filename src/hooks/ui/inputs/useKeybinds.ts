// Binds configurable keybinds using tinykeys.
import { useEffect, useMemo } from "react";
import { tinykeys } from "tinykeys";
import type { KeyBindingMap } from "tinykeys";
import { normalizeKeybind } from "@/modules";
import type { KeybindAction, KeybindMap } from "@/modules";

// Return true when the keybind is handled so default shortcuts are blocked.
type KeybindHandler = (event: KeyboardEvent) => boolean;

type UseKeybindsOptions = {
  keybinds: KeybindMap;
  handlers: Record<KeybindAction, KeybindHandler>;
  reserved?: Record<string, KeybindHandler>;
  enabled?: boolean;
};

export const useKeybinds = ({
  keybinds,
  handlers,
  reserved,
  enabled = true,
}: UseKeybindsOptions) => {
  const bindingMap = useMemo<KeyBindingMap>(() => {
    if (!enabled) return {};
    const map: KeyBindingMap = {};
    const add = (combo: string | undefined, handler: KeybindHandler) => {
      if (!combo) return;
      const normalized = normalizeKeybind(combo);
      if (!normalized) return;
      if (normalized.split("+").includes("MouseMiddle")) return;
      map[normalized] = (event) => {
        if (event.repeat) return;
        const handled = handler(event);
        if (!handled) return;
        event.preventDefault();
        event.stopPropagation();
      };
    };
    (Object.entries(keybinds) as [KeybindAction, string][]).forEach(
      ([action, combo]) => {
        add(combo, handlers[action]);
      },
    );
    if (reserved) {
      Object.entries(reserved).forEach(([combo, handler]) => {
        add(combo, handler);
      });
    }
    return map;
  }, [enabled, handlers, keybinds, reserved]);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = tinykeys(window, bindingMap);
    return () => unsubscribe();
  }, [bindingMap, enabled]);
};

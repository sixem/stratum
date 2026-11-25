import { useLayoutEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";
import { useBottomSessionStore, useSessionStore } from "@/modules/sessionStore";
import { useSettingsStore } from "@/modules/settings.store";
import { DEFAULT_TERMINAL_THEME } from "@/modules/terminalThemes";
import type { Tab } from "@/types";
import type { LinkedPane } from "@/lib/paneLink";
import { DirectorySync } from "./directorySync";
import { readTerminalTheme } from "./terminalTheme";

type Profile = NonNullable<Tab["terminal"]>;
const sessions = new Map<string, Shell>();
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(n)));

// Let the existing pane shortcuts switch tabs while the shell owns all editing keys.
const switchTab = (event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey">) =>
  event.key === "Tab" && event.ctrlKey && !event.altKey && !event.metaKey;

class Shell {
  private readonly directorySync = new DirectorySync();
  readonly element = document.createElement("div");
  private readonly viewport = document.createElement("div");
  private readonly status = document.createElement("div");
  private readonly term: Terminal;
  private id?: number;
  private closed = false;
  private ended = false;
  private writing = false;
  private resizing = false;
  private pending = "";
  private readonly observer = new ResizeObserver(() => this.fit());

  constructor(host: HTMLElement, directory: string) {
    this.element.className = "powershell-surface";
    this.viewport.className = "powershell-viewport";
    this.status.className = "powershell-status";
    this.status.setAttribute("role", "status");
    this.element.append(this.viewport, this.status);
    host.append(this.element);
    this.term = new Terminal({
      fontFamily: 'Consolas, "Cascadia Mono", monospace', fontSize: 14,
      scrollback: 1500, theme: this.applySurfaceTheme(),
      linkHandler: { activate() {} },
    });
    this.term.open(this.viewport);
    // Shell output cannot write or query the system clipboard.
    this.term.parser.registerOscHandler(52, () => true);
    this.term.attachCustomKeyEventHandler(event => !switchTab(event));
    this.term.onData(data => this.enqueue(data));
    this.observer.observe(this.viewport);
    this.fit();
    void this.start(directory);
  }

  attach(host: HTMLElement, autoFocus: boolean) {
    if (this.element.parentNode !== host) {
      host.append(this.element);
      this.updateTheme();
    }
    this.fit();
    if (autoFocus) this.focus();
  }

  focus() {
    this.term.focus();
  }

  updateTheme() {
    this.term.options.theme = this.applySurfaceTheme();
  }

  private applySurfaceTheme() {
    const theme = readTerminalTheme(this.element, useSettingsStore.getState().terminalTheme);
    this.element.style.setProperty("--terminal-background", theme.background);
    this.element.style.setProperty("--terminal-foreground", theme.foreground);
    this.element.style.setProperty("--terminal-muted", theme.brightBlack);
    return theme;
  }

  syncFolder(pane: LinkedPane, tab: Tab) {
    if (this.id !== undefined) this.directorySync.update(this.id, pane, tab, message => { this.status.textContent = message; });
  }

  private fit() {
    const screen = this.viewport.querySelector(".xterm-screen")?.getBoundingClientRect();
    if (!screen?.width || !screen.height || !this.viewport.clientWidth) return;
    const cols = clamp((this.viewport.clientWidth - 16) / (screen.width / this.term.cols), 2, 512);
    const rows = clamp(this.viewport.clientHeight / (screen.height / this.term.rows), 1, 256);
    if (cols === this.term.cols && rows === this.term.rows) return;
    this.term.resize(cols, rows);
    if (this.id !== undefined) void this.resizeNative();
  }

  private async resizeNative() {
    if (this.resizing) return;
    this.resizing = true;
    try {
      // Coalesce observer notifications while the console is applying a size.
      while (this.id !== undefined) {
        const { cols, rows } = this.term;
        await invoke("terminal_resize", { id: this.id, cols, rows });
        if (cols === this.term.cols && rows === this.term.rows) break;
      }
    } catch (error) {
      if (!this.closed && !this.ended) this.status.textContent = String(error);
    } finally { this.resizing = false; }
  }

  private async start(directory: string) {
    try {
      const { cols, rows } = this.term;
      this.id = await invoke<number>("terminal_open", { directory, cols, rows });
      if (this.closed) return;
      reconcileSessions();
      if (cols !== this.term.cols || rows !== this.term.rows) void this.resizeNative();
      void this.flush();
      while (!this.closed) {
        const bytes = await invoke<ArrayBuffer>("terminal_read", { id: this.id });
        if (this.closed || !bytes.byteLength) break;
        await new Promise<void>(done => this.term.write(new Uint8Array(bytes), done));
      }
      if (!this.closed) this.status.textContent = "PowerShell exited.";
    } catch (error) {
      if (!this.closed) this.status.textContent = String(error);
    } finally {
      this.ended = true;
      this.pending = "";
      this.closeNative();
    }
  }

  private enqueue(data: string) {
    if (this.closed || this.ended) return;
    if (data.length + this.pending.length > 128 * 1024) {
      this.status.textContent = "Input too large. Paste a smaller selection.";
      return;
    }
    this.status.textContent = "";
    this.pending += data;
    void this.flush();
  }

  private async flush() {
    if (this.writing || this.id === undefined) return;
    this.writing = true;
    try {
      while (this.pending && !this.closed && !this.ended) {
        // Even four-byte characters fit the backend's 32 KiB message limit.
        let end = Math.min(8192, this.pending.length);
        if (end < this.pending.length && /[\uD800-\uDBFF]/.test(this.pending[end - 1])) end--;
        const data = this.pending.slice(0, end);
        this.pending = this.pending.slice(end);
        await invoke("terminal_write", { id: this.id, data });
      }
    } catch (error) {
      this.pending = "";
      if (!this.closed && !this.ended) this.status.textContent = String(error);
    } finally { this.writing = false; }
  }

  private closeNative() {
    if (this.id === undefined) return;
    const id = this.id;
    this.id = undefined;
    void invoke("terminal_close", { id }).catch(() => {});
  }

  dispose() {
    this.closed = true;
    this.closeNative();
    this.observer.disconnect();
    this.term.dispose();
    this.element.remove();
  }
}

// Moving a tab updates both stores synchronously. Reconcile after the destination owns it.
function reconcileSessions() {
  if (!sessions.size) return;
  queueMicrotask(() => {
    const live = new Set<string>();
    for (const [pane, store] of [["main", useSessionStore], ["bottom", useBottomSessionStore]] as const) {
      for (const tab of store.getState().tabs) {
        const key = (tab.terminal ?? tab.split?.terminal)?.key;
        if (key) { live.add(key); sessions.get(key)?.syncFolder(pane, tab); }
      }
    }
    for (const [key, shell] of sessions) {
      if (live.has(key)) continue;
      sessions.delete(key);
      shell.dispose();
    }
  });
}
for (const store of [useSessionStore, useBottomSessionStore]) {
  store.subscribe((next, previous) => { if (next.tabs !== previous.tabs) reconcileSessions(); });
}

export default function PowerShell({ terminal, autoFocus }: { terminal: Profile; autoFocus: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = host.current!;
    const shell = sessions.get(terminal.key) ?? new Shell(container, terminal.directory);
    sessions.set(terminal.key, shell);
    shell.attach(container, autoFocus);
    const unsubscribeTheme = useSettingsStore.subscribe((next, previous) => {
      if (next.terminalTheme !== previous.terminalTheme) shell.updateTheme();
    });
    // In Follow app mode, read the shared tokens after the root attributes change.
    const appearance = new MutationObserver(() => {
      if (useSettingsStore.getState().terminalTheme === DEFAULT_TERMINAL_THEME) shell.updateTheme();
    });
    appearance.observe(document.documentElement, { attributeFilter: ["data-dark-mode", "data-accent"] });
    return () => {
      unsubscribeTheme();
      appearance.disconnect();
      if (shell.element.parentNode === container) shell.element.remove();
    };
  }, [terminal, autoFocus]);
  return <div data-terminal="" className="powershell-host" ref={host} aria-label="PowerShell terminal" tabIndex={-1}
    onFocus={event => { if (event.target === event.currentTarget) sessions.get(terminal.key)?.focus(); }}
    onKeyDown={event => { if (!switchTab(event)) event.stopPropagation(); }} onKeyUp={event => event.stopPropagation()}
    onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()} />;
}

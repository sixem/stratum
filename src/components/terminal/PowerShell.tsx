import { useLayoutEffect, useRef } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";
import { useBottomSessionStore, useSessionStore } from "@/modules/sessionStore";
import { useSettingsStore } from "@/modules/settings.store";
import { terminalFontStack } from "@/modules/terminalFonts";
import { DEFAULT_TERMINAL_THEME } from "@/modules/terminalThemes";
import type { Tab } from "@/types";
import type { TerminalSession } from "@/types/tabs";
import type { LinkedPane } from "@/lib/paneLink";
import { DirectorySync, type TerminalLocation } from "./directorySync";
import { readTerminalTheme } from "./terminalTheme";
import { TerminalInput } from "./terminalInput";

type OpenedTerminal = { id: number; directory: string };
const sessions = new Map<string, Shell>();
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(n)));

// Let the existing pane shortcuts switch tabs while the shell owns all editing keys.
const switchTab = (event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey">) =>
  event.key === "Tab" && event.ctrlKey && !event.altKey && !event.metaKey;

class Shell {
  private readonly directorySync: DirectorySync;
  readonly element = document.createElement("div");
  private readonly viewport = document.createElement("div");
  private readonly status = document.createElement("div");
  private readonly term: Terminal;
  private id?: number;
  private closed = false;
  private ended = false;
  private writing = false;
  private resizing = false;
  private readonly pending = new TerminalInput();
  private readonly observer = new ResizeObserver(() => this.fit());

  constructor(host: HTMLElement, terminal: TerminalSession) {
    this.directorySync = new DirectorySync(terminal.key, message => { this.status.textContent = message; });
    this.element.className = "powershell-surface";
    this.viewport.className = "powershell-viewport";
    this.status.className = "powershell-status";
    this.status.setAttribute("role", "status");
    this.element.append(this.viewport, this.status);
    host.append(this.element);
    this.term = new Terminal({
      fontFamily: terminalFontStack(useSettingsStore.getState().terminalFontFamily), fontSize: 14,
      scrollback: 1500, theme: this.applySurfaceTheme(),
      linkHandler: { activate() {} },
    });
    this.term.open(this.viewport);
    // Shell output cannot write or query the system clipboard.
    this.term.parser.registerOscHandler(52, () => true);
    this.term.attachCustomKeyEventHandler(event => !switchTab(event));
    this.term.onData(data => this.enqueue(data, false));
    this.term.onBinary(data => this.enqueue(data, true));
    this.observer.observe(this.viewport);
    this.fit();
    void this.start(terminal.directory);
  }

  attach(host: HTMLElement, autoFocus: boolean) {
    if (this.element.parentNode !== host) {
      host.append(this.element);
      this.updateTheme();
    }
    this.updateFont();
    if (autoFocus) this.focus();
  }

  focus() {
    const retry = this.status.querySelector("button");
    if (retry) retry.focus({ preventScroll: true });
    else this.term.focus();
  }

  updateTheme() {
    this.term.options.theme = this.applySurfaceTheme();
  }

  updateFont() {
    const fontFamily = terminalFontStack(useSettingsStore.getState().terminalFontFamily);
    if (this.term.options.fontFamily !== fontFamily) this.term.options.fontFamily = fontFamily;
    this.fit();
  }

  private applySurfaceTheme() {
    const theme = readTerminalTheme(this.element, useSettingsStore.getState().terminalTheme);
    this.element.style.setProperty("--terminal-background", theme.background);
    this.element.style.setProperty("--terminal-foreground", theme.foreground);
    this.element.style.setProperty("--terminal-muted", theme.brightBlack);
    return theme;
  }

  syncFolder(pane: LinkedPane, tab: Tab) {
    if (this.id !== undefined) this.directorySync.update(this.id, pane, tab);
  }

  private fit() {
    const screen = this.viewport.querySelector(".xterm-screen")?.getBoundingClientRect();
    if (!screen?.width || !screen.height || !this.viewport.clientWidth) return;
    const cols = clamp(this.viewport.clientWidth / (screen.width / this.term.cols), 2, 512);
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
      const location = new Channel<TerminalLocation>(message => {
        if (!this.closed) this.directorySync.receive(message);
      });
      const opened = await invoke<OpenedTerminal>("terminal_open", { directory, cols, rows, location });
      this.id = opened.id;
      if (this.closed) return;
      this.directorySync.setStartingDirectory(opened.directory);
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
      if (!this.closed) {
        this.status.textContent = String(error);
        if (this.id === undefined) this.showLaunchRetry(directory);
      }
    } finally {
      this.ended = true;
      this.pending.clear();
      this.closeNative();
    }
  }

  private showLaunchRetry(directory: string) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn ghost";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => {
      if (this.closed || !this.ended) return;
      this.ended = false;
      this.status.textContent = "";
      this.focus();
      void this.start(directory);
    }, { once: true });
    this.status.append(" ", retry);
    if (this.element.contains(document.activeElement)) retry.focus({ preventScroll: true });
  }

  private enqueue(data: string, binary: boolean) {
    if (this.closed || this.ended) return;
    if (!this.pending.push(data, binary)) {
      this.status.textContent = "Input too large. Paste a smaller selection.";
      return;
    }
    this.status.textContent = "";
    void this.flush();
  }

  private async flush() {
    if (this.writing || this.id === undefined) return;
    this.writing = true;
    try {
      while (!this.closed && !this.ended) {
        const data = this.pending.take();
        if (data === undefined) break;
        await invoke("terminal_write", { id: this.id, data });
      }
    } catch (error) {
      this.pending.clear();
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

export default function PowerShell({ terminal, autoFocus }: { terminal: TerminalSession; autoFocus: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  // TerminalPane keys this component by session. A directory report must not refocus it.
  const launch = useRef(terminal).current;
  useLayoutEffect(() => {
    const container = host.current!;
    const shell = sessions.get(launch.key) ?? new Shell(container, launch);
    sessions.set(launch.key, shell);
    shell.attach(container, autoFocus);
    const unsubscribeAppearance = useSettingsStore.subscribe((next, previous) => {
      if (next.terminalTheme !== previous.terminalTheme) shell.updateTheme();
      if (next.terminalFontFamily !== previous.terminalFontFamily) shell.updateFont();
    });
    // In Follow app mode, read the shared tokens after the root attributes change.
    const appearance = new MutationObserver(() => {
      if (useSettingsStore.getState().terminalTheme === DEFAULT_TERMINAL_THEME) shell.updateTheme();
    });
    appearance.observe(document.documentElement, { attributeFilter: ["data-dark-mode", "data-accent"] });
    return () => {
      unsubscribeAppearance();
      appearance.disconnect();
      if (shell.element.parentNode === container) shell.element.remove();
    };
  }, [launch, autoFocus]);
  return <div data-terminal="" className="powershell-host" ref={host} aria-label="PowerShell terminal" tabIndex={-1}
    onFocus={event => { if (event.target === event.currentTarget) sessions.get(launch.key)?.focus(); }}
    onKeyDown={event => { if (!switchTab(event)) event.stopPropagation(); }} onKeyUp={event => event.stopPropagation()}
    onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()} />;
}

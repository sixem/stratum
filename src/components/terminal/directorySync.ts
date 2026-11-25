// Remember the shell's directory independently of the optional two-way folder link.
import { invoke } from "@tauri-apps/api/core";
import { folderPathKey } from "@/lib/paths";
import type { LinkedPane } from "@/lib/paneLink";
import { getPaneSessionStore } from "@/modules/sessionStore";
import { saveTerminalDirectory, setDirectoryLinked, showShellDirectory } from "@/modules/terminalSplit";
import type { Tab } from "@/types";

export type TerminalLocation = { version: number; path: string | null; error: string | null };

export class DirectorySync {
  private version = 0;
  private folder = "";
  private reported = "";
  private directory?: string;
  private pendingDirectory?: string;
  private parkedLocation?: TerminalLocation;
  private owner?: { pane: LinkedPane; id: string };

  constructor(private readonly key: string, private readonly showError: (message: string) => void) {}

  setStartingDirectory(path: string) {
    if (this.directory === undefined) this.rememberDirectory(path);
  }

  receive(message: TerminalLocation) {
    if (message.path) this.rememberDirectory(message.path);
    const owner = this.currentOwner();
    if (!owner) {
      this.parkedLocation = message;
      return;
    }
    if (!owner.tab.split?.linkDirectory || message.version !== this.version) return;
    if (message.error) {
      this.failLink(message.version, message.error);
      return;
    }
    if (!message.path || folderPathKey(owner.tab.path) !== this.folder) return;
    const path = folderPathKey(message.path);
    if (path === this.reported) return;
    this.reported = path;
    if (path !== this.folder) showShellDirectory(owner.pane, owner.tab, message.path);
  }

  update(id: number, pane: LinkedPane, tab: Tab) {
    this.owner = { pane, id: tab.id };
    this.persistDirectory();
    const target = tab.split?.linkDirectory ? tab.path : "";
    const key = folderPathKey(target);
    const parkedLocation = this.parkedLocation;
    this.parkedLocation = undefined;
    if (this.folder === key) {
      if (parkedLocation) this.receive(parkedLocation);
      return;
    }
    this.folder = key;
    // A shell-driven folder change has already put the terminal at this location.
    if (key && key === this.reported) return;
    this.reported = "";
    const version = ++this.version;
    void invoke("terminal_link_directory", { id, version, path: target || null })
      .catch(error => this.failLink(version, String(error)));
  }

  private currentOwner() {
    if (!this.owner) return;
    const { pane, id } = this.owner;
    const tab = getPaneSessionStore(pane).getState().tabs.find(tab => tab.id === id);
    if (tab && (tab.terminal ?? tab.split?.terminal)?.key === this.key) return { pane, tab };
  }

  private rememberDirectory(path: string) {
    if (path === this.directory) return;
    this.directory = path;
    this.pendingDirectory = path;
    this.persistDirectory();
  }

  private persistDirectory() {
    const path = this.pendingDirectory;
    if (path === undefined) return;
    // The report can arrive before terminal_open returns or while a tab is moving.
    const owner = this.currentOwner();
    if (!owner) return;
    this.pendingDirectory = undefined;
    saveTerminalDirectory(owner.pane, owner.tab.id, this.key, path);
  }

  private failLink(version: number, message: string) {
    const owner = this.currentOwner();
    if (!owner?.tab.split?.linkDirectory || version !== this.version) return;
    setDirectoryLinked(owner.pane, owner.tab.id, false);
    this.showError(message);
  }
}

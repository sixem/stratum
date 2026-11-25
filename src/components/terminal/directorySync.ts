import { Channel, invoke } from "@tauri-apps/api/core";
import { folderPathKey } from "@/lib/paths";
import type { LinkedPane } from "@/lib/paneLink";
import { getPaneSessionStore } from "@/modules/sessionStore";
import { setDirectoryLinked, showShellDirectory } from "@/modules/terminalSplit";
import type { Tab } from "@/types";

type Location = { version: number; path: string | null; error: string | null };

export class DirectorySync {
  private version = 0;
  private folder = "";
  private reported = "";
  private owner?: { pane: LinkedPane; id: string };

  update(id: number, pane: LinkedPane, tab: Tab, showError: (message: string) => void) {
    this.owner = { pane, id: tab.id };
    const target = tab.split?.linkDirectory ? tab.path : "";
    const key = folderPathKey(target);
    if (this.folder === key) return;
    this.folder = key;
    if (key && key === this.reported) return;
    this.reported = "";
    const version = ++this.version;
    const sessionKey = tab.split?.terminal.key;
    const channel = new Channel<Location>();
    const current = () => {
      if (version !== this.version || !this.owner) return;
      const owner = this.owner;
      const tab = getPaneSessionStore(owner.pane).getState().tabs.find(tab => tab.id === owner.id);
      if (tab?.split?.linkDirectory && tab.split.terminal.key === sessionKey) return { pane: owner.pane, tab };
    };
    const fail = (error: string) => {
      const owner = current();
      if (owner) { setDirectoryLinked(owner.pane, owner.tab.id, false); showError(error); }
    };
    channel.onmessage = message => {
      if (message.version !== version) return;
      const owner = current();
      if (!owner) return;
      if (message.error) { fail(message.error); return; }
      if (!message.path || folderPathKey(owner.tab.path) !== this.folder) return;
      const path = folderPathKey(message.path);
      if (path === this.reported) return;
      this.reported = path;
      if (path !== this.folder) showShellDirectory(owner.pane, owner.tab, message.path);
    };
    void invoke("terminal_link_directory", { id, version, path: target || null, channel }).catch(error => fail(String(error)));
  }
}

// Exercise the dialog and its settings toggle with deterministic download events.
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { PromptModal } from "@/components/overlay/PromptModal";
import { openRemoteFile } from "@/components/remote/remoteOpen";
import { SettingsRemotesSection } from "@/components/settings/SettingsRemotesSection";
import { SETTINGS_STORAGE_KEY } from "@/constants/settings";
import "@/styles/app.scss";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const next = () => new Promise(resolve => setTimeout(resolve, 10));
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>(".prompt-actions button"))
  .find(element => element.textContent === label);
const bounds = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();

async function run() {
  const started: string[] = [], cancelled: string[] = [];
  mockIPC((command, args) => {
    if (command === "remote_start_open") started.push(args.id as string);
    if (command === "remote_cancel_open") cancelled.push(args.id as string);
  }, { shouldMockEvents: true });
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<><SettingsRemotesSection /><PromptModal /></>));
  let previews = 0;
  const open = () => flushSync(() => openRemoteFile("host", 1, "/music/Live recording.mp4", () => previews++));
  open();
  check(button("Download & open") && !started.length, "Opening skipped confirmation");
  button("Cancel")!.click();
  await next();
  open();
  button("Preview")!.click();
  await next();
  check(previews === 1 && !started.length, "Cancel or Preview started an external open");
  open();
  button("Download & open")!.click();
  await next();
  check(started.length === 1, "Confirmed open did not start");
  await emit("remote-open-progress", { id: started[0], state: "downloading", done: 149, total: 170 });
  await next();
  check(document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow") === "88", "Download progress did not update");
  const track = bounds(".remote-open-track"), content = bounds(".prompt-content");
  check(track.width > 300 && Math.abs(content.width - track.width) < 1, "Track does not span the dialog content");
  const note = bounds(".prompt-footer-note"), actions = bounds(".prompt-actions");
  check(note.right < actions.left && note.top < actions.bottom && note.bottom > actions.top, "Footer note and actions should share a row");
  document.querySelector<HTMLElement>(".prompt-panel")!.style.width = "200px";
  check(bounds(".prompt-footer-note").bottom <= bounds(".prompt-actions").top, "Narrow footer failed to wrap");
  button("Cancel")!.click();
  await next();
  check(cancelled[0] === started[0], "Cancel did not stop the download");
  document.querySelector<HTMLInputElement>("#settings-remotes input")!.click();
  check(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!).settings.confirmRemoteOpen === false, "Opt-out was not saved");
  open();
  await next();
  check(started.length === 2 && !button("Download & open"), "Opt-out did not skip confirmation");
  await emit("remote-open-progress", { id: started[1], state: "done", done: 170, total: 170 });
  await next();
  check(!document.querySelector(".prompt-modal"), "Finished dialog stayed open");
}

run().then(() => { document.documentElement.dataset.testResult = "passed"; }).catch(error => {
  document.documentElement.dataset.testResult = "failed";
  document.documentElement.dataset.testError = String(error?.stack ?? error);
});

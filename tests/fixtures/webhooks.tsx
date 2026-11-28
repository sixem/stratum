// Drive the real Settings and Work components with the native command contract.
import { flushSync } from "react-dom";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { TooltipDisplay } from "@/components/overlay/Tooltip";
import { SettingsOverlay } from "@/components/overlay/SettingsOverlay";
import type { Webhook, WebhookEdit } from "@/components/settings/WebhookEditor";
import { TransferStatusButton } from "@/components/transfer/TransferStatusButton";
import { captureStratumBackup } from "@/modules/backup/profile";
import { captureWorkspaceLayout } from "@/lib/captureWorkspaceLayout";
import { saveWorkspace, useWorkspaceStore } from "@/modules/workspaceStore";
import "@/styles/app.scss";

const wait = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms));
function check(ok: unknown, reason: string): asserts ok { if (!ok) throw new Error(reason); }
const button = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
  .find(b => (b.getAttribute("aria-label") ?? b.textContent)?.trim() === name)!;
function input(selector: string, value: string) {
  const element = document.querySelector<HTMLInputElement>(selector)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

async function run() {
  // Edge's dump-dom runner has no foreground window or regular paint loop.
  Object.defineProperty(document, "hasFocus", { value: () => true });
  Object.defineProperty(document, "visibilityState", { value: "visible" });
  window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 16);
  window.cancelAnimationFrame = id => window.clearTimeout(id);
  const types = ["file.created", "directory.deleted", "transfer.completed", "transfer.failed", "transfer.cancelled"];
  const hooks: Webhook[] = [], writes: WebhookEdit[] = [];
  const failure = { id: 19, name: "Local receiver", origin: "https://example.test", eventId: "event-1",
    kind: "webhook.test", attempts: 3, error: "Request timed out.", canRetry: true };
  let failures: typeof failure[] = [], retried = false;
  mockIPC((cmd, args) => {
    if (cmd === "webhook_settings") return { hooks: [...hooks], eventTypes: types };
    if (cmd === "webhook_save") {
      const change = args.edit as WebhookEdit; writes.push(change);
      hooks.splice(0, hooks.length, { id: "hook", name: change.name, origin: "https://example.test", enabled: change.enabled,
        events: change.events, hasToken: true });
    }
    if (cmd === "webhook_test") {
      check(args.id === "hook", "Wrong webhook tested");
      failures = [failure];
    }
    if (cmd === "webhook_work") return { failures, total: failures.length, missed: 0, error: null };
    if (cmd === "webhook_retry") { check(args.id === failure.id, "Wrong delivery retried"); retried = true; failures = []; }
    if (cmd === "remote_recovery_details") return [];
  }, { shouldMockEvents: true });
  const root = createRoot(document.getElementById("root")!);
  function Fixture() {
    const [open, setOpen] = useState(true);
    return <><SettingsOverlay open={open} onClose={() => setOpen(false)} /><TooltipDisplay />
      <TransferStatusButton onOpenDestination={() => {}} /></>;
  }
  flushSync(() => root.render(<Fixture />));
  button("Webhooks").click();
  await wait();
  check(!document.querySelector("#settings-webhooks details"), "Help still requires a disclosure");
  const add = button("Add webhook");
  const rect = add.getBoundingClientRect();
  const point = { bubbles: true, clientX: rect.left + 4, clientY: rect.top + 4 };
  add.dispatchEvent(new MouseEvent("mouseover", point));
  add.dispatchEvent(new MouseEvent("mousemove", { ...point, clientX: point.clientX + 2 }));
  await wait(500);
  check(document.querySelector(".tooltip.is-visible")?.textContent === "Choose a destination and events", "Missing Stratum tooltip on Add webhook");
  button("Add webhook").click(); await wait();
  const descriptions = document.querySelector(".webhook-types")?.textContent ?? "";
  for (const text of ["One event per file changed.", "One event per folder changed.", "One outcome per copy or move job."]) {
    check(descriptions.includes(text), `Missing event description: ${text}`);
  }
  check(!Array.from(document.querySelectorAll("label")).find(label => label.textContent === "Enable webhook")!
    .querySelector("input")!.checked, "New webhook should start disabled");
  input('input[name="name"]', "Local receiver");
  input('input[name="url"]', "https://example.test/a-private-path");
  input('input[name="token"]', "fixture-bearer-secret");
  button("Created").click(); await wait();
  check(button("Created").getAttribute("aria-pressed") === "true", "Event selection is not exposed");
  button("Save").click(); await wait();
  check(writes[0]?.enabled === false && writes[0].events.includes("file.created") && writes[0].token === "fixture-bearer-secret", "Disabled state, events, or credentials lost");
  button("Edit webhook").click(); await wait();
  check(Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]')).every(i => i.value === ""), "Saved secrets exposed in editor");
  Array.from(document.querySelectorAll("label")).find(label => label.textContent === "Enable webhook")!
    .querySelector("input")!.click(); await wait();
  button("Save").click(); await wait();
  check(writes[1]?.enabled === true && writes[1].url === undefined && writes[1].token === undefined, "Enabling replaced saved credentials");
  button("Edit webhook").click(); await wait();
  Array.from(document.querySelectorAll("label")).find(label => label.textContent === "Enable webhook")!
    .querySelector("input")!.click(); await wait();
  button("Save").click(); await wait();
  check(writes[2]?.enabled === false && writes[2].url === undefined && writes[2].token === undefined, "Disabling replaced saved credentials");
  saveWorkspace("Fixture workspace", captureWorkspaceLayout());
  const selection = new Set(useWorkspaceStore.getState().workspaces.map(w => w.id));
  for (const scope of ["full", "workspaces"] as const) {
    const backup = JSON.stringify(captureStratumBackup(scope, selection, true));
    check(!["fixture-bearer-secret", "a-private-path", "Local receiver"].some(s => backup.includes(s)), "Export leaked webhook configuration");
  }
  button("Send test event").click(); await wait();
  await emit("webhook-test-finished", { hook: "hook", ok: false });
  await emit("webhook-work-changed"); await wait(200);
  check(document.querySelector('[role="status"]')?.textContent?.includes("failed"), "Missing test result");
  document.querySelector<HTMLButtonElement>(".settings-header button")!.click(); await wait();
  document.querySelector<HTMLButtonElement>(".transfer-button")!.click(); await wait();
  check(document.querySelector(".recovery-item")?.textContent?.includes("event-1"), "Delivery failure absent from Work");
  button("Retry").click(); await wait();
  check(retried && !document.querySelector(".transfer-button"), "Work retry did not clear the failure");
}
run().then(() => { document.documentElement.dataset.testResult = "passed"; }).catch(error => {
  document.documentElement.dataset.testResult = "failed";
  document.documentElement.dataset.testError = String(error?.stack ?? error);
});

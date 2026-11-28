// Exercise the real remote views in a disposable browser with mocked SFTP.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const edge = process.platform === "win32" && [
  join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
  join(process.env.ProgramFiles ?? "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
].find(existsSync);

const fixtures = {
  remoteTools: "both panes inspect remote properties and Quick Move distinguishes connected hosts and sessions",
  stableBrowsing: "local and SFTP views defer offscreen removals independently in both panes, and Work retains recovery notices",
  remotePaneKeyboard: "remote breadcrumbs support keyboard shortcuts and file drops in both panes and layouts",
  remoteOpen: "SFTP opens respect confirmation settings and show responsive download progress",
};
for (const [fixture, description] of Object.entries(fixtures)) test(description, {
  skip: !edge && "Microsoft Edge is not installed", timeout: 60_000,
}, async () => {
  const { createServer } = await import("vite");
  const profile = await mkdtemp(join(tmpdir(), "stratum-remote-fixture-"));
  let server;
  try {
    server = await createServer({
      cacheDir: join(profile, "vite-cache"), logLevel: "silent",
      server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: { ignored: ["**"] } },
    });
    await server.listen();
    const address = server.httpServer.address();
    const url = `http://127.0.0.1:${address.port}/tests/fixtures/${fixture}.html`;
    const browser = spawn(edge, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
      "--disable-background-networking", "--no-proxy-server", "--window-size=1200,1200",
      `--user-data-dir=${join(profile, "edge")}`, "--virtual-time-budget=20000", "--dump-dom", url], { stdio: ["ignore", "pipe", "pipe"] });
    let html = "", diagnostics = "";
    browser.stdout.on("data", chunk => { html += chunk.toString(); });
    browser.stderr.on("data", chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-4000); });
    const timer = setTimeout(() => browser.kill(), 45_000);
    const code = await new Promise((resolveExit, reject) => {
      browser.once("error", reject);
      browser.once("close", resolveExit);
    }).finally(() => clearTimeout(timer));
    assert.equal(code, 0, `Edge failed: ${diagnostics}`);
    const result = html.match(/<html\s+[^>]*data-test-result="([^"]+)"[^>]*>/);
    assert.equal(result?.[1], "passed", `Browser fixture failed: ${result?.[0] ?? diagnostics}`);
  } finally {
    await server?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// Start the regular Tauri dev app with disposable Windows app data.
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const PROFILE_PREFIX = "com.emy.stratum.dev-fresh-";
const profilePattern = PROFILE_PREFIX.replaceAll(".", "\\.") + "[a-f0-9]{32}";
const markerPattern = new RegExp(`^(${profilePattern})\\.([1-9]\\d*)$`);
const runFile = promisify(execFile);
const projectDir = fileURLToPath(new URL("..", import.meta.url));

const processExists = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
};

const activeProfiles = async () => {
  // The same identifier appears in the dev CLI and app arguments, and in
  // WebView2's user data path. WebView2 can outlive the app briefly on exit.
  const { stdout } = await runFile("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    `$ErrorActionPreference = "Stop"
     Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='cargo.exe' OR Name='stratum.exe' OR Name='msedgewebview2.exe'" |
       ForEach-Object {
         $pattern = if ($_.Name -eq "msedgewebview2.exe") { '${profilePattern}' }
                    else { '(?<=--stratum-dev-profile=)${profilePattern}' }
         [regex]::Matches([string]$_.CommandLine, $pattern, 'IgnoreCase').Value
       }`,
  ], { windowsHide: true, timeout: 5000 });
  return new Set(stdout.trim().toLowerCase().split(/\s+/));
};

const orphanedProfiles = async (registry) => {
  const profiles = [];
  for (const entry of await readdir(registry, { withFileTypes: true })) {
    const match = entry.isFile() && markerPattern.exec(entry.name);
    if (match && !processExists(Number(match[2]))) {
      profiles.push({ id: match[1], marker: join(registry, entry.name) });
    }
  }
  return profiles;
};

const removeProfile = async (profile, dataDirs) => {
  for (const base of dataDirs) {
    const path = join(base, profile.id);
    const stat = await lstat(path).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (!stat) continue;
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error(`Unexpected profile location ${path}`);
    }
    await rm(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 150 });
  }
  // Keep the marker until all of the app data has been removed.
  await rm(profile.marker, { force: true });
};

const removeIdleProfiles = async (profiles, dataDirs) => {
  if (profiles.length === 0) return [];
  const active = await activeProfiles();
  const remaining = [];
  for (const profile of profiles) {
    if (active.has(profile.id)) {
      remaining.push(profile);
      continue;
    }
    try {
      await removeProfile(profile, dataDirs);
    } catch (error) {
      // Windows may still have a cache file open. The next launch can retry.
      if (!["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"].includes(error.code)) throw error;
      remaining.push(profile);
    }
  }
  return remaining;
};

const run = async () => {
  if (process.platform !== "win32") {
    throw new Error("Run dev:fresh with Windows Node.js.");
  }
  const { LOCALAPPDATA: localData, APPDATA: roamingData } = process.env;
  if (!localData || !roamingData || !isAbsolute(localData) || !isAbsolute(roamingData)) {
    throw new Error("Windows app data directories are unavailable.");
  }
  const dataDirs = [...new Set([resolve(localData), resolve(roamingData)])];
  const registry = join(dataDirs[0], "com.emy.stratum.dev-fresh");
  await mkdir(registry, { recursive: true });
  if (!(await lstat(registry)).isDirectory()) {
    throw new Error("The fresh profile registry is redirected.");
  }
  try {
    await removeIdleProfiles(await orphanedProfiles(registry), dataDirs);
  } catch (error) {
    console.warn("Couldn't clean up previous fresh profiles.", error.message);
  }

  const id = PROFILE_PREFIX + randomUUID().replaceAll("-", "");
  const profile = { id, marker: join(registry, `${id}.${process.pid}`) };
  await writeFile(profile.marker, "", { flag: "wx" });

  // Windows sends Ctrl+C to the Tauri CLI in the same console. Keep this
  // launcher alive until the CLI exits so it can finish cleaning up.
  const keepRunning = () => {};
  process.on("SIGINT", keepRunning);
  try {
    const cli = join(projectDir, "node_modules", "@tauri-apps", "cli", "tauri.js");
    const config = JSON.stringify({ build: { beforeDevCommand: "node node_modules/vite/bin/vite.js" } });
    const child = spawn(process.execPath, [
      cli, "dev", "--config", config, "--", "--", `--stratum-dev-profile=${id}`,
    ], { cwd: projectDir, stdio: "inherit" });
    const [code, signal] = await once(child, "exit");
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
  } finally {
    try {
      let pending = [profile];
      for (let attempt = 0; attempt < 5 && pending.length > 0; attempt += 1) {
        if (attempt > 0) await delay(400);
        pending = await removeIdleProfiles(pending, dataDirs);
      }
      if (pending.length > 0) {
        console.warn("Fresh profile is busy. Cleanup will retry on the next fresh launch.");
      }
    } catch (error) {
      console.warn("Couldn't clean up this fresh profile.", error.message);
    } finally {
      process.off("SIGINT", keepRunning);
    }
  }
};

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

// Check local folders in batches and preview each explicit path-prefix rule.
import { useEffect, useId, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { probeBackupFolders } from "@/api/backup";
import { PressButton } from "@/components/primitives/PressButton";
import { toMessage } from "@/lib";
import { backupLocationKey, createBackupPathRemapper, parseBackupLocation } from "@/modules/backup/locations";
import type { BackupPathMapping } from "@/modules/backup/locations";

type Props = {
  locations: string[];
  mappings: BackupPathMapping[];
  setMappings: (mappings: BackupPathMapping[]) => void;
};

const BATCH_SIZE = 64;

export const BackupPathReview = ({ locations, mappings, setMappings }: Props) => {
  const optionsId = useId();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [issue, setIssue] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [checkFailed, setCheckFailed] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const preview = useMemo(() => {
    const remap = createBackupPathRemapper(mappings);
    const local = new Map<string, string>();
    const origins = new Map<string, string>();
    const roots = new Set<string>();
    let changed = 0;
    let example: { from: string; to: string } | undefined;
    let hasNetworkLocations = false;
    for (const source of locations) {
      const path = remap(source);
      if (path !== source) {
        changed += 1;
        example ??= { from: source, to: path };
      }
      const location = parseBackupLocation(path);
      const original = parseBackupLocation(source);
      if (original) roots.add(original.root);
      // UNC locations may be offline or require network authentication.
      if (location?.localSyntax) {
        const key = backupLocationKey(path);
        local.set(key, path);
        origins.set(key, source);
      } else if (location) {
        hasNetworkLocations = true;
      }
    }
    return { paths: [...local.values()], origins, roots: [...roots], example, changed, hasNetworkLocations };
  }, [locations, mappings]);

  useEffect(() => {
    let canceled = false;
    setMissing([]);
    setCheckFailed(false);
    setChecking(preview.paths.length > 0);
    const check = async () => {
      try {
        const failures: string[] = [];
        for (let offset = 0; !canceled && offset < preview.paths.length; offset += BATCH_SIZE) {
          failures.push(...await probeBackupFolders(preview.paths.slice(offset, offset + BATCH_SIZE)));
        }
        if (!canceled) setMissing(failures);
      } catch {
        if (!canceled) setCheckFailed(true);
      } finally {
        if (!canceled) setChecking(false);
      }
    };
    if (preview.paths.length) void check();
    return () => { canceled = true; };
  }, [preview.paths]);

  const addMapping = () => {
    const mapping = { from: from.trim(), to: to.trim() };
    const sourceKey = backupLocationKey(mapping.from);
    if (!sourceKey || !backupLocationKey(mapping.to)) {
      setIssue("Enter two absolute folder paths.");
      return;
    }
    const remap = createBackupPathRemapper([mapping]);
    if (!locations.some((path) => remap(path) !== path)) {
      setIssue("This rule would leave all backup locations unchanged.");
      return;
    }
    setMappings([...mappings.filter((previous) => backupLocationKey(previous.from) !== sourceKey), mapping]);
    setFrom("");
    setTo("");
    setIssue(null);
  };

  const browse = async () => {
    setBrowsing(true);
    setIssue(null);
    try {
      const result = await open({ directory: true, multiple: false, title: "Choose a replacement folder" });
      if (typeof result === "string") setTo(result);
    } catch (error) {
      setIssue(toMessage(error, "Couldn't open the folder picker."));
    } finally {
      setBrowsing(false);
    }
  };

  if (!locations.length) return null;
  const remapSuggestions = [...new Set([...preview.roots, ...locations])];
  return (
    <div className="settings-backup-form">
      <div className="settings-label">Folder locations</div>
      {checking ? <p className="settings-desc" role="status">Checking folders…</p> : null}
      {checkFailed ? <p className="settings-desc" role="status">Location checks failed. You can still remap or import these folders.</p> : null}
      {missing.length ? (
        <details className="settings-backup-locations" open>
          <summary>{missing.length} unavailable {missing.length === 1 ? "folder" : "folders"}</summary>
          <ul className="settings-backup-list">
            {missing.map((path) => <li key={path}><button type="button" className="settings-backup-path" onClick={() => setFrom(preview.origins.get(backupLocationKey(path)) ?? path)}>{path}</button></li>)}
          </ul>
        </details>
      ) : null}
      {preview.hasNetworkLocations ? <p className="settings-desc">Network folders are checked when opened.</p> : null}

      <div className="settings-backup-fields">
        <div>
          <span id={`${optionsId}-from`}>Old folder or drive</span>
          <input className="settings-backup-input" aria-labelledby={`${optionsId}-from`} type="text" spellCheck={false} list={optionsId} value={from} onChange={(event) => setFrom(event.currentTarget.value)} />
        </div>
        <datalist id={optionsId}>{remapSuggestions.map((path) => <option key={path} value={path} />)}</datalist>
        <div>
          <span id={`${optionsId}-to`}>Replacement folder</span>
          <input className="settings-backup-input" aria-labelledby={`${optionsId}-to`} type="text" spellCheck={false} value={to} onChange={(event) => setTo(event.currentTarget.value)} />
        </div>
      </div>
      <div className="settings-actions">
        <PressButton type="button" className="btn ghost" disabled={browsing} onClick={browse}>Browse…</PressButton>
        <PressButton type="button" className="btn ghost" disabled={browsing || !from.trim() || !to.trim()} onClick={addMapping}>Add remap</PressButton>
      </div>
      {issue ? <p className="settings-desc settings-desc-error" role="alert">{issue}</p> : null}
      {mappings.length ? (
        <ul className="settings-backup-list" aria-label="Applied remaps">
          {mappings.map((rule) => (
            <li key={rule.from} className="settings-backup-mapping">
              <span><samp>{rule.from}</samp> → <samp>{rule.to}</samp></span>
              <PressButton type="button" className="btn ghost" aria-label={`Remove remap from ${rule.from}`} onClick={() => setMappings(mappings.filter((item) => item !== rule))}>Remove</PressButton>
            </li>
          ))}
        </ul>
      ) : null}
      {preview.example ? (
        <p className="settings-desc settings-backup-example">
          {preview.changed} {preview.changed === 1 ? "location" : "locations"} will change. <samp>{preview.example.from}</samp> → <samp>{preview.example.to}</samp>
        </p>
      ) : null}
    </div>
  );
};

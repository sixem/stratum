// Review remote profiles separately from local folder remapping.
import { listBackupRemoteHostIds, UNLINKED_REMOTE_HOST } from "@/modules/backup/remoteHosts";
import type { BackupHostMappings } from "@/modules/backup/remoteHosts";
import type { StratumBackup } from "@/modules/backup/types";
import { useRemoteHosts } from "@/modules/remoteHosts";

type Props = {
  backup: StratumBackup;
  mappings: BackupHostMappings;
  setMappings: (mappings: BackupHostMappings) => void;
};

export function BackupRemoteHostsReview({ backup, mappings, setMappings }: Props) {
  const existing = useRemoteHosts(state => state.profiles);
  const included = backup.remoteHosts ?? [];
  const references = listBackupRemoteHostIds(backup);
  const ids = [...new Set([...included.map(host => host.id), ...references])];
  if (!ids.length) return null;
  const byId = new Map(included.map(host => [host.id, host]));
  const existingById = new Map(existing.map(host => [host.id, host]));
  const existingByDestination = new Map(existing.map(host => [host.destination, host]));
  return <div className="settings-backup-hosts">
    <div className="settings-section-title">Remote hosts</div>
    <p className="settings-desc">Existing hosts are kept. Matching SSH destinations are reused; an ID conflict creates a separate host. Restored tabs may connect automatically using this PC’s SSH configuration.</p>
    <ul className="settings-backup-list" aria-label="Remote hosts to import">
      {ids.map(id => {
        const host = byId.get(id);
        const sameId = host && existingById.get(id);
        const collision = sameId && sameId.destination !== host.destination;
        const matching = host && existingByDestination.get(host.destination);
        return <li key={id} className="settings-backup-host">
          <label>
            <span>{host ? `${host.name || host.destination} (${host.destination})` : `Host details missing (${id})`}</span>
            <select className="settings-backup-input" value={mappings[id] ?? ""} onChange={event => {
              const next = Object.assign(Object.create(null) as Record<string, string>, mappings);
              if (event.currentTarget.value) next[id] = event.currentTarget.value;
              else delete next[id];
              setMappings(next);
            }}>
              <option value="">{host ? "Import or reuse matching host" : "Leave tabs unlinked"}</option>
              {host && <option value={UNLINKED_REMOTE_HOST}>Do not import; leave tabs unlinked</option>}
              {existing.map(item => <option key={item.id} value={item.id}>Use {item.name || item.destination} ({item.destination})</option>)}
            </select>
          </label>
          {host && !mappings[id] && (matching || collision) ? <p className="settings-desc">
            {matching ? `Uses the existing ${matching.name || matching.destination} host.` : "This ID belongs to another host; the imported host gets a new ID."}
          </p> : null}
        </li>;
      })}
    </ul>
    {references.some(id => !byId.has(id)) && <p className="settings-desc">Some host details are missing. Choose an existing host, or save one and reopen this backup to map those tabs.</p>}
  </div>;
}

// A host is saved after SFTP authenticates and the starting folder is readable.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toMessage } from "@/lib/fsUtils";
import { verifyRemote, saveRemote, type RemoteProfile } from "@/modules/remoteHosts";

type Props = {
  profile?: RemoteProfile;
  onClose: () => void;
};

export function RemoteHostEditor({ profile, onClose }: Props) {
  const [id] = useState(() => profile?.id ?? crypto.randomUUID());
  const [destination, setDestination] = useState(profile?.destination ?? "");
  const [name, setName] = useState(profile?.name ?? "");
  const [startPath, setStartPath] = useState(profile?.startPath ?? "");
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [verified, setVerified] = useState<string | null>(profile ? JSON.stringify([profile.destination, profile.startPath]) : null);
  const signature = JSON.stringify([destination.trim(), startPath]);
  const draft = { id, destination: destination.trim(), name: name.trim() || destination.trim(), startPath };
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const verify = async () => {
    setTesting(true);
    setVerified(null);
    setError("");
    try {
      await verifyRemote(draft);
      if (mounted.current) setVerified(signature);
    } catch (failure) {
      if (mounted.current) setError(toMessage(failure, "Could not verify the host."));
    } finally {
      if (mounted.current) setTesting(false);
    }
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (testing || verified !== signature || !destination.trim()) return;
    setError("");
    setTesting(true);
    try {
      await saveRemote(draft);
      if (mounted.current) onClose();
    } catch (failure) {
      setError(toMessage(failure, "Could not save the host."));
    } finally {
      setTesting(false);
    }
  };
  return <form className="remote-editor" onSubmit={save}>
    <label>SSH destination
      <input autoFocus={!profile} autoCapitalize="off" autoComplete="off" spellCheck={false} required
        maxLength={255} disabled={testing}
        value={destination} placeholder="user@server or SSH alias" onChange={event => setDestination(event.target.value)} />
    </label>
    <label>Display name <small>(optional)</small>
      <input autoFocus={Boolean(profile)} autoComplete="off" maxLength={80} disabled={testing}
        value={name} placeholder={destination.trim()} onChange={event => setName(event.target.value)} />
    </label>
    <label>Starting folder <small>(optional)</small>
      <input autoComplete="off" spellCheck={false} maxLength={4096} disabled={testing}
        value={startPath} placeholder="Remote home folder" onChange={event => setStartPath(event.target.value)} />
    </label>
    {profile && profile.destination !== destination.trim() && <p className="remote-placeholder">Tabs using this host will connect to the new destination.</p>}
    {error && <p role="alert" className="remote-error">{error}</p>}
    <div className="remote-editor-actions">
      <button className="btn ghost" type="button" disabled={testing} onClick={onClose}>Cancel</button>
      <button className="btn ghost" type="button" disabled={testing || !destination.trim()} onClick={verify}>
        {testing ? "Working…" : verified === signature ? "Verified" : "Verify"}
      </button>
      <button className="btn" type="submit" disabled={testing || verified !== signature}>Save</button>
    </div>
  </form>;
}

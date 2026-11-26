"""Build the public updater feed from one published GitHub release and its downloaded assets."""
import base64
from datetime import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def build_feed(work, tag, repo, public_key):
    release = json.loads((work / "release.json").read_text())
    if not re.fullmatch(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", tag, re.ASCII):
        raise ValueError("Expected a stable release tag")
    if release["tag_name"] != tag or release["draft"] or release["prerelease"]:
        raise ValueError("Expected a published stable release")
    if datetime.fromisoformat(release["published_at"].replace("Z", "+00:00")).tzinfo is None:
        raise ValueError("Missing publication timezone")

    version = tag[1:]
    setup = f"Stratum_{version}_x64-setup.exe"
    names = [setup, setup + ".sig", f"Stratum_{version}_portable.exe", f"Stratum_{version}_x64_en-US.msi"]
    assets = {asset["name"]: asset for asset in release["assets"]}
    for name in names:
        asset = assets[name]
        url = f"https://github.com/{repo}/releases/download/{tag}/{name}"
        if asset["state"] != "uploaded" or asset["size"] <= 0 or asset["browser_download_url"] != url:
            raise ValueError(f"Invalid release asset: {name}")

    signature = (work / (setup + ".sig")).read_text().strip()
    decoded = base64.b64decode(signature, validate=True)
    (work / "installer.minisig").write_bytes(decoded)
    (work / "signer.pub").write_bytes(base64.b64decode(public_key.strip(), validate=True))
    subprocess.run(["minisign", "-V", "-q", "-m", setup, "-x", "installer.minisig", "-p", "signer.pub"],
                   cwd=work, check=True)
    trusted = decoded.decode().splitlines()[2].removeprefix("trusted comment: ").split("\t")
    if f"file:{setup}" not in trusted or f"version:{version}" not in trusted:
        raise ValueError("Installer signature must bind this filename and release version")

    return {"version": version, "notes": release["body"] or "", "pub_date": release["published_at"],
            "platforms": {"windows-x86_64": {"url": assets[setup]["browser_download_url"], "signature": signature}}}


if __name__ == "__main__":
    feed = build_feed(Path(sys.argv[1]), os.environ["RELEASE_TAG"], os.environ["GITHUB_REPOSITORY"],
                      os.environ["STRATUM_UPDATER_PUBLIC_KEY"])
    Path(sys.argv[2]).write_text(json.dumps(feed, indent=2) + "\n")

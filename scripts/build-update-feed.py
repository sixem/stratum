"""Build the public updater feed from one published GitHub release and its downloaded assets."""
from datetime import datetime
import json
import os
from pathlib import Path
import sys

from verify_update_installer import release_asset_names, verify_installer


def build_feed(work, tag, repo, public_key):
    release = json.loads((work / "release.json").read_text())
    if not tag.startswith("v"):
        raise ValueError("Expected a stable release tag")
    if release["tag_name"] != tag or release["draft"] or release["prerelease"]:
        raise ValueError("Expected a published stable release")
    if datetime.fromisoformat(release["published_at"].replace("Z", "+00:00")).tzinfo is None:
        raise ValueError("Missing publication timezone")

    version = tag[1:]
    names = release_asset_names(version)
    setup = names[0]
    assets = {asset["name"]: asset for asset in release["assets"]}
    for name in names:
        asset = assets[name]
        url = f"https://github.com/{repo}/releases/download/{tag}/{name}"
        if asset["state"] != "uploaded" or asset["size"] <= 0 or asset["browser_download_url"] != url:
            raise ValueError(f"Invalid release asset: {name}")

    signature = verify_installer(work, version, public_key)

    return {"version": version, "notes": release["body"] or "", "pub_date": release["published_at"],
            "platforms": {"windows-x86_64": {"url": assets[setup]["browser_download_url"], "signature": signature}}}


if __name__ == "__main__":
    feed = build_feed(Path(sys.argv[1]), os.environ["RELEASE_TAG"], os.environ["GITHUB_REPOSITORY"],
                      os.environ["STRATUM_UPDATER_PUBLIC_KEY"])
    Path(sys.argv[2]).write_text(json.dumps(feed, indent=2) + "\n")
